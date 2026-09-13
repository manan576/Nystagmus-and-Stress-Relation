# ============================================================================
# OscillationTracker.py — Nystagmus Head Oscillation + HRV Stress Pipeline
# ============================================================================
# Integrated system that runs TWO concurrent loops:
#
#   MAIN THREAD (synchronous):
#     OpenCV + MediaPipe face detection → oscillation detection → video/CSV logging
#
#   BLE THREAD (asynchronous):
#     bleak + asyncio → Polar H9 connection → RR interval collection → HRV computation
#
# When an oscillation triggers, the main thread samples the latest HRV data
# from the BLE thread (via a thread-safe lock) and logs it alongside the event.
#
# Architecture:
#   ┌─────────────────────────┐       ┌─────────────────────────┐
#   │   MAIN THREAD           │       │   BLE THREAD            │
#   │   (OpenCV loop)         │       │   (asyncio + bleak)     │
#   │                         │       │                         │
#   │   frame = cap.read()    │       │   connect to Polar H9   │
#   │   detect oscillation    │       │   subscribe to 0x2A37   │
#   │   if trigger:           │       │   on_notify:            │
#   │     hrv = sample_hrv()  │◄──────│     parse BPM, RR       │
#   │     log to CSV          │ Lock  │     update shared data  │
#   └─────────────────────────┘       └─────────────────────────┘
# ============================================================================

import cv2
import mediapipe as mp
import time
from collections import deque
import os
import datetime
import csv
import threading
import asyncio
import struct
import numpy as np
from bleak import BleakScanner, BleakClient

# ============================================================================
# SECTION 1: BLE / HRV MODULE
# ============================================================================

# --- GATT UUIDs ---
HR_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb"

# --- BLE Configuration ---
DEVICE_NAME_PREFIX = "Polar H9"
BLE_SCAN_TIMEOUT = 15
RMSSD_WINDOW_SECONDS = 60

# --- Thread-Safe Shared State ---
# The BLE thread writes to this, the main thread reads from it
hr_data_lock = threading.Lock()
hr_shared_state = {
    "connected": False,
    "current_bpm": 0,
    "rr_buffer": deque(maxlen=300),   # (timestamp, rr_ms) tuples
    "bpm_buffer": deque(maxlen=120),  # (timestamp, bpm) tuples
    "last_update": 0,
}


def parse_hr_measurement(data: bytearray):
    """Parse the Heart Rate Measurement GATT characteristic (0x2A37)."""
    flags = data[0]
    hr_format_16bit = bool(flags & 0x01)
    rr_present = bool(flags & 0x10)

    offset = 1
    if hr_format_16bit:
        heart_rate = struct.unpack_from("<H", data, offset)[0]
        offset += 2
    else:
        heart_rate = data[offset]
        offset += 1

    # Skip Energy Expended if present
    if flags & 0x08:
        offset += 2

    rr_intervals_ms = []
    if rr_present:
        while offset + 1 < len(data):
            rr_raw = struct.unpack_from("<H", data, offset)[0]
            rr_ms = (rr_raw / 1024.0) * 1000.0
            rr_intervals_ms.append(rr_ms)
            offset += 2

    return heart_rate, rr_intervals_ms


def compute_rmssd(rr_intervals_ms):
    """Compute RMSSD from a list of RR intervals (ms). Returns -1 if insufficient data."""
    if len(rr_intervals_ms) < 3:
        return -1.0
    rr = np.array(rr_intervals_ms)
    successive_diffs = np.diff(rr)
    if len(successive_diffs) == 0:
        return -1.0
    return round(float(np.sqrt(np.mean(successive_diffs ** 2))), 2)


def compute_sdnn(rr_intervals_ms):
    """Compute SDNN from a list of RR intervals (ms). Returns -1 if insufficient data."""
    if len(rr_intervals_ms) < 3:
        return -1.0
    return round(float(np.std(rr_intervals_ms, ddof=1)), 2)


def sample_hrv():
    """
    Thread-safe function called by the MAIN THREAD when an oscillation triggers.
    Returns a dict of HRV features computed from multiple time windows (15s, 30s, 60s).
    """
    with hr_data_lock:
        connected = hr_shared_state["connected"]
        current_bpm = hr_shared_state["current_bpm"]

        # Snapshot the buffers under lock, compute outside
        now = time.time()
        all_rr = list(hr_shared_state["rr_buffer"])
        all_bpm = list(hr_shared_state["bpm_buffer"])

    # Compute windowed RR intervals for 15s, 30s, 60s
    rr_15s = [rr for ts, rr in all_rr if ts >= now - 15]
    rr_30s = [rr for ts, rr in all_rr if ts >= now - 30]
    rr_60s = [rr for ts, rr in all_rr if ts >= now - 60]

    # Compute RMSSD for each window
    rmssd_15s = compute_rmssd(rr_15s)
    rmssd_30s = compute_rmssd(rr_30s)
    rmssd_60s = compute_rmssd(rr_60s)

    # Compute other features from the 60s window
    rr_count = len(rr_60s)
    sdnn = compute_sdnn(rr_60s)
    mean_rr = round(float(np.mean(rr_60s)), 1) if rr_count >= 1 else -1.0

    windowed_bpm = [bpm for ts, bpm in all_bpm if ts >= now - 60]
    mean_hr = round(float(np.mean(windowed_bpm)), 1) if len(windowed_bpm) >= 1 else -1.0

    # Determine data quality
    if not connected:
        quality = "no_connection"
    elif rr_count >= 30:
        quality = "good"
    elif rr_count >= 10:
        quality = "low"
    else:
        quality = "insufficient"

    return {
        "bpm": mean_hr,
        "rmssd_15s": rmssd_15s,
        "rmssd_30s": rmssd_30s,
        "rmssd_60s": rmssd_60s,
        "mean_rr_60s": mean_rr,
        "sdnn_60s": sdnn,
        "rr_count_60s": rr_count,
        "hrv_quality": quality,
    }


def compute_session_baseline_from_rr(calibration_records, window_sec=60):
    """
    Computes the True Resting Baseline RMSSD for the session.
    Protocol:
      1. Slices the 3-5 minute resting calibration stream into 60-second windows.
      2. Computes RMSSD for each 60-second window.
      3. Takes the MEDIAN of these 60s window values to eliminate ectopic/motion outliers.
    """
    if not calibration_records:
        return 45.0, []

    start_time = calibration_records[0][0]
    end_time = calibration_records[-1][0]
    total_duration = end_time - start_time

    window_rmssds = []
    current_start = start_time

    while current_start + window_sec <= end_time + 1.0:
        win_rr = [rr for ts, rr in calibration_records if current_start <= ts < current_start + window_sec]
        rmssd = compute_rmssd(win_rr)
        if rmssd > 0:
            window_rmssds.append(rmssd)
        current_start += window_sec

    # If short calibration or window slicing produced no chunks, use all available RR
    if not window_rmssds:
        all_rr = [rr for ts, rr in calibration_records]
        single_rmssd = compute_rmssd(all_rr)
        fallback = single_rmssd if single_rmssd > 0 else 45.0
        return fallback, [fallback]

    session_baseline = round(float(np.median(window_rmssds)), 2)
    return session_baseline, window_rmssds



def ble_notification_handler(sender, data: bytearray):
    """BLE callback — fires every ~1 second when the Polar H9 sends data."""
    heart_rate, rr_intervals = parse_hr_measurement(data)
    now = time.time()

    with hr_data_lock:
        hr_shared_state["current_bpm"] = heart_rate
        hr_shared_state["bpm_buffer"].append((now, heart_rate))
        hr_shared_state["last_update"] = now

        for rr_ms in rr_intervals:
            if 300.0 <= rr_ms <= 2000.0:  # Physiological sanity check
                hr_shared_state["rr_buffer"].append((now, rr_ms))


async def ble_main_loop(stop_event: threading.Event):
    """
    The async BLE loop that runs in a background thread.
    Scans for the Polar H9, connects, subscribes, and keeps the connection alive.
    Includes auto-reconnection logic.
    """
    while not stop_event.is_set():
        try:
            # Scan for the Polar H9
            print("[BLE] Scanning for Polar H9...")
            devices = await BleakScanner.discover(timeout=BLE_SCAN_TIMEOUT)
            polar_device = None
            for d in devices:
                if d.name and DEVICE_NAME_PREFIX.lower() in d.name.lower():
                    polar_device = d
                    break

            if polar_device is None:
                print("[BLE] Polar H9 not found. Retrying in 10 seconds...")
                print("[BLE] Make sure the strap is moistened and worn on your chest.")
                for _ in range(100):  # 10 seconds in 0.1s increments
                    if stop_event.is_set():
                        return
                    await asyncio.sleep(0.1)
                continue

            print(f"[BLE] Found: {polar_device.name} [{polar_device.address}]")
            print(f"[BLE] Connecting...")

            # Set up disconnect detection
            disconnect_event = asyncio.Event()

            def on_disconnect(client):
                print("[BLE] Disconnected from Polar H9!")
                with hr_data_lock:
                    hr_shared_state["connected"] = False
                disconnect_event.set()

            async with BleakClient(polar_device.address, timeout=20.0,
                                   disconnected_callback=on_disconnect) as client:
                if not client.is_connected:
                    print("[BLE] Connection failed. Retrying...")
                    continue

                print(f"[BLE] ✅ Connected to {polar_device.name}!")

                with hr_data_lock:
                    hr_shared_state["connected"] = True

                # Subscribe to heart rate notifications
                await client.start_notify(HR_MEASUREMENT_UUID, ble_notification_handler)
                print("[BLE] ✅ Subscribed to Heart Rate Measurement. Streaming data...")

                # Keep alive until disconnect or stop signal
                while not stop_event.is_set() and not disconnect_event.is_set():
                    await asyncio.sleep(0.5)

                # Clean up
                try:
                    if client.is_connected:
                        await client.stop_notify(HR_MEASUREMENT_UUID)
                except Exception:
                    pass

            # If we get here due to disconnect, retry
            if not stop_event.is_set():
                print("[BLE] Will attempt to reconnect in 5 seconds...")
                with hr_data_lock:
                    hr_shared_state["connected"] = False
                for _ in range(50):
                    if stop_event.is_set():
                        return
                    await asyncio.sleep(0.1)

        except Exception as e:
            print(f"[BLE] Error: {e}")
            print("[BLE] Retrying in 10 seconds...")
            with hr_data_lock:
                hr_shared_state["connected"] = False
            for _ in range(100):
                if stop_event.is_set():
                    return
                await asyncio.sleep(0.1)


def ble_thread_entry(stop_event: threading.Event):
    """Entry point for the BLE background thread. Creates its own asyncio event loop."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(ble_main_loop(stop_event))
    except Exception as e:
        print(f"[BLE] Thread crashed: {e}")
    finally:
        loop.close()
        print("[BLE] Thread stopped.")


# ============================================================================
# SECTION 2: COMPUTER VISION + OSCILLATION DETECTION (MAIN THREAD)
# ============================================================================

# --- Setup Validation Directories and Logs ---
VIDEO_DIR = "validation_videos"
if not os.path.exists(VIDEO_DIR):
    os.makedirs(VIDEO_DIR)

# --- AWS Cloud Sync Configuration ---
AWS_API_URL = os.environ.get("AWS_API_URL", "")
PATIENT_ID = os.environ.get("PATIENT_ID", "patient_001")
AWS_CLOUD_ENABLED = bool(AWS_API_URL)


def upload_event_to_aws_worker(payload, video_path, api_url):
    """Background worker thread to upload telemetry and video to AWS without blocking the OpenCV loop."""
    try:
        import requests
        # 1. Post telemetry metadata to API Gateway
        events_endpoint = f"{api_url.rstrip('/')}/events"
        res = requests.post(events_endpoint, json=payload, timeout=10)
        if res.status_code == 200:
            res_data = res.json()
            event_id = res_data.get("event_id")
            upload_url = res_data.get("upload_url")
            print(f"[AWS CLOUD] ✓ Telemetry logged to DynamoDB (ID: {event_id})")

            # 2. Upload MP4 clip to S3 via Pre-Signed URL
            if upload_url and os.path.exists(video_path):
                with open(video_path, "rb") as vf:
                    s3_res = requests.put(upload_url, data=vf, headers={"Content-Type": "video/mp4"}, timeout=30)
                    if s3_res.status_code in [200, 204]:
                        print(f"[AWS CLOUD] ✓ 5s MP4 clip uploaded to S3 ({res_data.get('s3_video_key')})")
                    else:
                        print(f"[AWS CLOUD] ⚠️ S3 upload returned status {s3_res.status_code}")
        else:
            print(f"[AWS CLOUD] ⚠️ Ingestion endpoint returned {res.status_code}: {res.text}")
    except Exception as err:
        print(f"[AWS CLOUD] ⚠️ Cloud sync offline/skipped: {err}")


# Updated CSV schema with HRV columns
LOG_FILE = "oscillation_log.csv"
CSV_HEADERS = [
    "Timestamp", "Video_File", "Validation_Status", "Event_Type",
    "BPM", "RMSSD_15s", "RMSSD_30s", "RMSSD_60s", "Mean_RR_60s", "SDNN_60s",
    "RR_Count_60s", "HRV_Quality"
]

if not os.path.exists(LOG_FILE):
    with open(LOG_FILE, mode='w', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(CSV_HEADERS)
else:
    # Check if existing CSV has the old schema (3 columns) and migrate
    with open(LOG_FILE, mode='r', newline='') as file:
        reader = csv.reader(file)
        existing_headers = next(reader, [])
    if len(existing_headers) < len(CSV_HEADERS):
        # Read all existing data
        with open(LOG_FILE, mode='r', newline='') as file:
            reader = csv.reader(file)
            next(reader)  # skip old header
            old_rows = list(reader)
        # Rewrite with new headers, padding old rows with empty values
        with open(LOG_FILE, mode='w', newline='') as file:
            writer = csv.writer(file)
            writer.writerow(CSV_HEADERS)
            for row in old_rows:
                padded = row + [""] * (len(CSV_HEADERS) - len(row))
                writer.writerow(padded)
        print(f"[CSV] Migrated {LOG_FILE} to new schema with HRV columns.")

def run_tracker(patient_name=None, session_name=None):
    """Main execution entry point for real-time edge tracking and session calibration."""
    global PATIENT_ID

    # --- Interactive Patient & Session Initiation ---
    print("\n" + "="*65)
    print("  NEUROTRIAL — DECENTRALIZED CLINICAL TRIAL TRACKER")
    print("="*65)
    
    if patient_name is None:
        default_patient = os.environ.get("PATIENT_ID", "patient_001 (Manan B.)")
        user_input_name = input(f"Enter Patient Name / ID [Press Enter for '{default_patient}']: ").strip()
        if user_input_name:
            PATIENT_ID = user_input_name
        else:
            PATIENT_ID = default_patient
    else:
        PATIENT_ID = patient_name

    auto_session_id = datetime.datetime.now().strftime("sess_%Y%m%d_%H%M%S")
    if session_name:
        SESSION_ID = f"{auto_session_id}_{session_name.replace(' ', '_')}"
    else:
        SESSION_ID = auto_session_id

    print(f"[OK] Patient Profile:  {PATIENT_ID}")
    print(f"[OK] Session ID:       {SESSION_ID}")
    print(f"[OK] BLE Polar Strap:  Scanning for '{DEVICE_NAME_PREFIX}'...")
    print("="*65 + "\n")

    # --- Setup Camera and MediaPipe ---
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    actual_fps = cap.get(cv2.CAP_PROP_FPS)
    if actual_fps <= 0 or actual_fps > 120:
        actual_fps = 30
    FPS = int(round(actual_fps))

    mp_face_mesh = mp.solutions.face_mesh
    face_mesh = mp_face_mesh.FaceMesh()

    # --- Video Buffer Configuration ---
    SECONDS_BEFORE = 5
    SECONDS_AFTER = 5
    PRE_BUFFER_SIZE = int(FPS * SECONDS_BEFORE)
    POST_BUFFER_SIZE = int(FPS * SECONDS_AFTER)
    frame_buffer = deque(maxlen=PRE_BUFFER_SIZE)

    # --- Oscillation Detection Variables ---
    prev_nose_x = None
    prev_velocity = 0
    direction_changes = 0
    oscillation_time = 0

    # --- Constraints and Filters ---
    last_movement_time = time.time()
    OSCILLATION_TIMEOUT = 2.0       # Reset direction count if no reversal within 1 second
    smoothed_nose_x = None
    SMOOTHING_FACTOR = 0.4
    VELOCITY_THRESHOLD = 1

    # --- Rate Limiting / Cooldown ---
    last_save_time = 0
    COOLDOWN_SECONDS = 30

    # --- Post-Trigger Capture State ---
    post_capture_active = False
    post_capture_frames = []
    post_capture_remaining = 0
    pending_save_data = None

    # --- Session & Calibration State Configuration ---
    CALIBRATION_DURATION_SECONDS = int(os.environ.get("CALIBRATION_SECONDS", 180)) # Default 3 mins (180s)
    SESSION_BASELINE_RMSSD = None
    calibration_started_at = None
    calibration_rr_records = []
    calibration_completed = False
    chunk_rmssds = []

    # State machine: "CONNECTING_BLE" -> "CALIBRATING_BASELINE" -> "ACTIVE_TRACKING"
    system_state = "CONNECTING_BLE"


    # Create a stop event to cleanly shut down the BLE thread
    ble_stop_event = threading.Event()

    # Start the BLE thread
    ble_thread = threading.Thread(target=ble_thread_entry, args=(ble_stop_event,), daemon=True)
    ble_thread.start()

    print(f"\n============================================================")
    print(f"  NEUROTRIAL — DECENTRALIZED CLINICAL TRIAL PIPELINE")
    print(f"============================================================")
    print(f"Session ID:             {SESSION_ID}")
    print(f"Calibration Duration:   {CALIBRATION_DURATION_SECONDS}s ({CALIBRATION_DURATION_SECONDS//60} min resting protocol)")
    print(f"Camera FPS:             {FPS} (detected: {actual_fps})")
    print(f"Incident Clip Length:   {SECONDS_BEFORE + SECONDS_AFTER}s ({SECONDS_BEFORE}s pre + {SECONDS_AFTER}s post)")
    print(f"Cooldown Interval:      {COOLDOWN_SECONDS}s")
    print(f"Background Sampling:    Every {BACKGROUND_SAMPLE_INTERVAL // 60} min")
    print(f"BLE Status:             Connecting to Polar H9 in background...")
    print(f"Controls:               'C' = finalize baseline early | ESC = exit")
    print(f"============================================================\n")


    while True:
        ret, frame = cap.read()
        if not ret:
            break

        h, w, _ = frame.shape
        now_time = time.time()

        # Query BLE connection status
        with hr_data_lock:
            ble_connected = hr_shared_state["connected"]
            ble_bpm = hr_shared_state["current_bpm"]
            ble_last_update = hr_shared_state["last_update"]
            current_rr_snapshot = list(hr_shared_state["rr_buffer"])

        # --- STATE 1: WAITING FOR BLE CONNECTION ---
        if system_state == "CONNECTING_BLE":
            if ble_connected and len(current_rr_snapshot) >= 3:
                system_state = "CALIBRATING_BASELINE"
                calibration_started_at = now_time
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] ✅ Polar H9 Connected & Streaming.")
                print(f"Starting {CALIBRATION_DURATION_SECONDS}s Resting Baseline Calibration Protocol...")
                print(f"Protocol: Sit quietly, eyes open, looking at a blank wall/screen.")

        # --- STATE 2: CALIBRATING RESTING BASELINE (3 to 5 Minutes) ---
        if system_state == "CALIBRATING_BASELINE":
            if calibration_started_at is None:
                calibration_started_at = now_time

            elapsed_calib = now_time - calibration_started_at
            remaining_calib = max(0, CALIBRATION_DURATION_SECONDS - elapsed_calib)

            # Collect RR records during calibration
            with hr_data_lock:
                for ts, rr in hr_shared_state["rr_buffer"]:
                    if ts >= calibration_started_at and (ts, rr) not in calibration_rr_records:
                        calibration_rr_records.append((ts, rr))

            # Check if calibration completed or manually finished
            if remaining_calib <= 0:
                SESSION_BASELINE_RMSSD, chunk_rmssds = compute_session_baseline_from_rr(calibration_rr_records, window_sec=60)
                calibration_completed = True
                system_state = "ACTIVE_TRACKING"
                print(f"\n============================================================")
                print(f"✅ SESSION RESTING BASELINE ESTABLISHED")
                print(f"------------------------------------------------------------")
                print(f"Session ID:         {SESSION_ID}")
                print(f"Calibration Time:   {int(elapsed_calib)} seconds")
                print(f"60s Windows RMSSD:  {chunk_rmssds} ms")
                print(f"Median Baseline:    {SESSION_BASELINE_RMSSD} ms")
                print(f"Status:             Transitioned to ACTIVE_TRACKING mode.")
                print(f"============================================================\n")

            # --- Draw Calibration HUD Overlay ---
            overlay = frame.copy()
            cv2.rectangle(overlay, (40, 40), (w - 40, 220), (15, 23, 42), -1)
            cv2.addWeighted(overlay, 0.85, frame, 0.15, 0, frame)
            cv2.rectangle(frame, (40, 40), (w - 40, 220), (6, 182, 212), 2)

            cv2.putText(frame, "RESTING BASELINE CALIBRATION PROTOCOL", (60, 80),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (6, 182, 212), 2)
            cv2.putText(frame, "Sit quietly with eyes open (relaxed state, no distractions)", (60, 115),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (203, 213, 225), 1)

            progress = min(1.0, elapsed_calib / CALIBRATION_DURATION_SECONDS)
            bar_w = w - 160
            cv2.rectangle(frame, (60, 135), (60 + bar_w, 155), (51, 65, 85), -1)
            cv2.rectangle(frame, (60, 135), (60 + int(bar_w * progress), 155), (16, 185, 129), -1)

            rem_min = int(remaining_calib // 60)
            rem_sec = int(remaining_calib % 60)
            calib_stats = f"Time Remaining: {rem_min:02d}:{rem_sec:02d} ({int(progress * 100)}%)  |  HR: {ble_bpm} BPM  |  RR Samples: {len(calibration_rr_records)}"
            cv2.putText(frame, calib_stats, (60, 185),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (248, 250, 252), 1)
            cv2.putText(frame, "[Press 'C' to finalize baseline immediately]", (60, 210),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (148, 163, 184), 1)

        # --- STATE 3: ACTIVE TRACKING (Oscillation Detection + Incident Recording) ---
        elif system_state == "ACTIVE_TRACKING":
            # Save a CLEAN copy of the frame to the rolling pre-buffer
            clean_frame = frame.copy()
            frame_buffer.append(clean_frame)

            # --- If we're in post-capture mode, collect frames ---
            if post_capture_active:
                post_capture_frames.append(clean_frame.copy())
                post_capture_remaining -= 1

                # Show recording indicator
                cv2.putText(frame, "RECORDING POST-TRIGGER...", (50, 100),
                            cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 165, 255), 2)
                progress = 1.0 - (post_capture_remaining / POST_BUFFER_SIZE)
                bar_width = 300
                cv2.rectangle(frame, (50, 120), (50 + bar_width, 140), (100, 100, 100), -1)
                cv2.rectangle(frame, (50, 120), (50 + int(bar_width * progress), 140), (0, 165, 255), -1)

                if post_capture_remaining <= 0:
                    # --- SAVE: Stitch pre-buffer + post-capture frames ---
                    post_capture_active = False
                    # Use avc1 (H.264) for direct HTML5 browser playback compatibility
                    try:
                        fourcc = cv2.VideoWriter_fourcc(*'avc1')
                        out = cv2.VideoWriter(save_data["video_path"], fourcc, FPS, (w, h))
                        if not out.isOpened():
                            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                            out = cv2.VideoWriter(save_data["video_path"], fourcc, FPS, (w, h))
                    except Exception:
                        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                        out = cv2.VideoWriter(save_data["video_path"], fourcc, FPS, (w, h))

                    for buffered_frame in save_data["pre_frames"]:
                        out.write(buffered_frame)
                    for post_frame in post_capture_frames:
                        out.write(post_frame)
                    out.release()

                    # Sample HRV data and log to CSV
                    hrv = save_data["hrv_snapshot"]
                    total_frames = len(save_data["pre_frames"]) + len(post_capture_frames)
                    duration_sec = round(total_frames / FPS, 1)

                    # Use Established Session Baseline and 60-second Incident RMSSD
                    final_baseline_rmssd = SESSION_BASELINE_RMSSD if SESSION_BASELINE_RMSSD else (float(hrv["rmssd_60s"]) if hrv["rmssd_60s"] > 0 else 45.0)
                    final_incident_rmssd = float(hrv["rmssd_60s"]) if hrv["rmssd_60s"] > 0 else (float(hrv["rmssd_30s"]) if hrv["rmssd_30s"] > 0 else 20.0)
                    stress_drop_pct = round(((final_baseline_rmssd - final_incident_rmssd) / final_baseline_rmssd) * 100.0, 1) if final_baseline_rmssd > 0 else 0.0

                    with open(LOG_FILE, mode='a', newline='') as file:
                        writer = csv.writer(file)
                        writer.writerow([
                            save_data["timestamp_str"],
                            save_data["video_filename"],
                            "",                           # Validation_Status (filled later)
                            "OSC",                        # Event_Type: oscillation
                            hrv["bpm"],
                            hrv["rmssd_15s"],
                            hrv["rmssd_30s"],
                            hrv["rmssd_60s"],
                            hrv["mean_rr_60s"],
                            hrv["sdnn_60s"],
                            hrv["rr_count_60s"],
                            hrv["hrv_quality"],
                        ])

                    quality_icon = "✅" if hrv["hrv_quality"] == "good" else "⚠️"
                    print(f"[{save_data['timestamp_str']}] Oscillation captured! "
                          f"Video: {total_frames} frames ({duration_sec}s) | "
                          f"Session Baseline: {final_baseline_rmssd}ms | Incident (60s): {final_incident_rmssd}ms (Drop: -{stress_drop_pct}%) | "
                          f"BPM: {hrv['bpm']} | {quality_icon} {hrv['hrv_quality']}")

                    # --- Async Dispatch to AWS Cloud Backend ---
                    if AWS_CLOUD_ENABLED and AWS_API_URL:
                        cloud_payload = {
                            "patient_id": PATIENT_ID,
                            "session_id": SESSION_ID,
                            "timestamp": save_data["timestamp_str"],
                            "duration_sec": duration_sec,
                            "baseline_rmssd": final_baseline_rmssd,
                            "incident_rmssd": final_incident_rmssd,
                            "stress_drop_pct": stress_drop_pct,
                            "bpm": float(hrv["bpm"]) if hrv["bpm"] > 0 else 75.0,
                            "device_model": "Polar H9 ECG + MediaPipe Vision"
                        }
                        threading.Thread(
                            target=upload_event_to_aws_worker,
                            args=(cloud_payload, save_data["video_path"], AWS_API_URL),
                            daemon=True
                        ).start()

                    # Cleanup
                    post_capture_frames = []
                    pending_save_data = None

            # --- MediaPipe Face Detection ---
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = face_mesh.process(rgb_frame)

            if results.multi_face_landmarks:
                for face_landmarks in results.multi_face_landmarks:
                    nose = face_landmarks.landmark[1]
                    nose_x_raw = int(nose.x * w)
                    nose_y = int(nose.y * h)

                    # --- EMA Low-Pass Filter ---
                    if smoothed_nose_x is None:
                        smoothed_nose_x = nose_x_raw
                    else:
                        smoothed_nose_x = int((SMOOTHING_FACTOR * nose_x_raw) +
                                              ((1 - SMOOTHING_FACTOR) * smoothed_nose_x))

                    cv2.circle(frame, (smoothed_nose_x, nose_y), 5, (0, 255, 0), -1)

                    # --- Core Oscillation Logic ---
                    if prev_nose_x is not None:
                        velocity = smoothed_nose_x - prev_nose_x

                        if abs(velocity) >= VELOCITY_THRESHOLD:
                            if velocity * prev_velocity < 0:
                                direction_changes += 1
                                last_movement_time = time.time()

                        prev_velocity = velocity

                    prev_nose_x = smoothed_nose_x

                    # --- Time-Series Constraint ---
                    if time.time() - last_movement_time > OSCILLATION_TIMEOUT:
                        direction_changes = 0

                    # --- TRIGGER: Oscillation Detected ---
                    if direction_changes >= 5:
                        oscillation_time = time.time()
                        direction_changes = 0

                        # --- Check Cooldown Timer ---
                        if (not post_capture_active and
                                time.time() - last_save_time >= COOLDOWN_SECONDS):

                            last_save_time = time.time()

                            timestamp_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                            filename_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                            video_filename = f"nod_{filename_str}.mp4"
                            video_path = os.path.join(VIDEO_DIR, video_filename)

                            pre_frames = list(frame_buffer)

                            # Sample HRV at the moment of trigger
                            hrv_snapshot = sample_hrv()

                            post_capture_active = True
                            post_capture_remaining = POST_BUFFER_SIZE
                            post_capture_frames = []
                            pending_save_data = {
                                "timestamp_str": timestamp_str,
                                "video_filename": video_filename,
                                "video_path": video_path,
                                "pre_frames": pre_frames,
                                "hrv_snapshot": hrv_snapshot,
                            }

                            print(f"[{timestamp_str}] Oscillation triggered! "
                                  f"Session Baseline: {SESSION_BASELINE_RMSSD}ms | "
                                  f"Capturing {SECONDS_AFTER}s of post-trigger footage...")

                        elif post_capture_active:
                            pass
                        else:
                            time_left = int(COOLDOWN_SECONDS - (time.time() - last_save_time))
                            print(f"Nod detected, but system is on cooldown for {time_left} more seconds.")

            # --- HUD: On-Screen Status ---
            # Top banner: Session & Baseline RMSSD
            cv2.rectangle(frame, (10, 10), (w - 10, 45), (15, 23, 42), -1)
            cv2.putText(frame, f"Session: {SESSION_ID}  |  Resting Baseline RMSSD: {SESSION_BASELINE_RMSSD} ms",
                        (20, 33), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (16, 185, 129), 2)

            # Direction changes indicator
            status_color = (0, 255, 0) if direction_changes == 0 else (0, 255, 255)
            if direction_changes >= 2:
                status_color = (0, 165, 255)

            cv2.putText(frame, f"Dir Changes: {direction_changes}/5",
                        (10, h - 90), cv2.FONT_HERSHEY_SIMPLEX, 0.6, status_color, 2)

            # Cooldown indicator
            cooldown_remaining = max(0, COOLDOWN_SECONDS - (time.time() - last_save_time))
            if cooldown_remaining > 0 and last_save_time > 0:
                cv2.putText(frame, f"Cooldown: {int(cooldown_remaining)}s",
                            (10, h - 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (128, 128, 128), 1)

            # Oscillation detected flash
            if time.time() - oscillation_time < 1 and post_capture_active:
                cv2.putText(frame, "OSCILLATION DETECTED!", (50, 80),
                            cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)

        # --- Global HUD: BLE Status Bottom Left ---
        if ble_connected and (time.time() - ble_last_update) < 5:

            ble_color = (0, 255, 0)
            ble_text = f"HR: {ble_bpm} bpm"
        elif ble_connected:
            ble_color = (0, 255, 255)
            ble_text = "HR: stale data"
        else:
            ble_color = (0, 0, 255)
            ble_text = "HR: connecting..."

        cv2.putText(frame, ble_text,
                    (10, h - 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, ble_color, 2)

        cv2.imshow("Head Movement Tracker", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == 27:  # ESC
            break
        elif key == ord('c') or key == ord('C'):
            # Early finalize baseline calibration
            if system_state == "CALIBRATING_BASELINE":
                SESSION_BASELINE_RMSSD, chunk_rmssds = compute_session_baseline_from_rr(calibration_rr_records, window_sec=60)
                calibration_completed = True
                system_state = "ACTIVE_TRACKING"
                print(f"\n[USER OVERRIDE] Baseline calibration finalized early.")
                print(f"Session Baseline RMSSD: {SESSION_BASELINE_RMSSD} ms (from {len(calibration_rr_records)} samples)")

    # --- Cleanup ---
    print("\nShutting down...")
    ble_stop_event.set()  # Signal the BLE thread to stop
    cap.release()
    cv2.destroyAllWindows()
    ble_thread.join(timeout=5)  # Wait up to 5 seconds for BLE thread to finish
    print("Done.")


if __name__ == "__main__":
    run_tracker()