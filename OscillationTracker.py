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
    Returns a dict of HRV features computed from the last 60 seconds of RR data.
    """
    with hr_data_lock:
        connected = hr_shared_state["connected"]
        current_bpm = hr_shared_state["current_bpm"]

        # Get RR intervals from the last 60 seconds
        now = time.time()
        cutoff = now - RMSSD_WINDOW_SECONDS
        windowed_rr = [rr for ts, rr in hr_shared_state["rr_buffer"] if ts >= cutoff]

        # Get BPM readings from the last 60 seconds
        windowed_bpm = [bpm for ts, bpm in hr_shared_state["bpm_buffer"] if ts >= cutoff]

    # Compute features (outside the lock to minimize lock hold time)
    rr_count = len(windowed_rr)
    rmssd = compute_rmssd(windowed_rr)
    sdnn = compute_sdnn(windowed_rr)
    mean_rr = round(float(np.mean(windowed_rr)), 1) if rr_count >= 1 else -1.0
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
        "rmssd_60s": rmssd,
        "mean_rr_60s": mean_rr,
        "sdnn_60s": sdnn,
        "rr_count_60s": rr_count,
        "hrv_quality": quality,
    }


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

# Updated CSV schema with HRV columns
LOG_FILE = "oscillation_log.csv"
CSV_HEADERS = [
    "Timestamp", "Video_File", "Validation_Status", "Event_Type",
    "BPM", "RMSSD_60s", "Mean_RR_60s", "SDNN_60s", "RR_Count_60s", "HRV_Quality"
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

# --- Background HRV Sampling ---
BACKGROUND_SAMPLE_INTERVAL = 300   # Log HRV every 5 minutes (300 seconds)
last_background_sample_time = 0    # Initialized to 0 so first sample triggers after interval

# ============================================================================
# SECTION 3: LAUNCH BLE THREAD AND START MAIN LOOP
# ============================================================================

# Create a stop event to cleanly shut down the BLE thread
ble_stop_event = threading.Event()

# Start the BLE thread
ble_thread = threading.Thread(target=ble_thread_entry, args=(ble_stop_event,), daemon=True)
ble_thread.start()

print(f"\nCamera FPS: {FPS} (detected: {actual_fps})")
print(f"System Active. Saving {SECONDS_BEFORE + SECONDS_AFTER}s clips "
      f"({SECONDS_BEFORE}s pre + {SECONDS_AFTER}s post) to /{VIDEO_DIR}")
print(f"Cooldown: {COOLDOWN_SECONDS / 60:.1f} min | Velocity threshold: {VELOCITY_THRESHOLD}px")
print(f"Background HRV sampling every {BACKGROUND_SAMPLE_INTERVAL // 60} minutes.")
print(f"BLE thread started — connecting to Polar H9 in background...")
print(f"Press ESC to exit.\n")

while True:
    ret, frame = cap.read()
    if not ret:
        break

    h, w, _ = frame.shape

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
            save_data = pending_save_data

            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            out = cv2.VideoWriter(save_data["video_path"], fourcc, FPS, (w, h))

            for buffered_frame in save_data["pre_frames"]:
                out.write(buffered_frame)
            for post_frame in post_capture_frames:
                out.write(post_frame)
            out.release()

            # Sample HRV data and log to CSV
            hrv = save_data["hrv_snapshot"]

            with open(LOG_FILE, mode='a', newline='') as file:
                writer = csv.writer(file)
                writer.writerow([
                    save_data["timestamp_str"],
                    save_data["video_filename"],
                    "",                           # Validation_Status (filled later)
                    "OSC",                        # Event_Type: oscillation
                    hrv["bpm"],
                    hrv["rmssd_60s"],
                    hrv["mean_rr_60s"],
                    hrv["sdnn_60s"],
                    hrv["rr_count_60s"],
                    hrv["hrv_quality"],
                ])

            total_frames = len(save_data["pre_frames"]) + len(post_capture_frames)
            quality_icon = "✅" if hrv["hrv_quality"] == "good" else "⚠️"
            print(f"[{save_data['timestamp_str']}] Oscillation captured! "
                  f"Video: {total_frames} frames ({total_frames / FPS:.1f}s) | "
                  f"RMSSD: {hrv['rmssd_60s']}ms | BPM: {hrv['bpm']} | "
                  f"HRV Quality: {quality_icon} {hrv['hrv_quality']}")

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
                          f"HRV sampled (RMSSD: {hrv_snapshot['rmssd_60s']}ms). "
                          f"Capturing {SECONDS_AFTER}s of post-trigger footage...")

                elif post_capture_active:
                    pass
                else:
                    time_left = int(COOLDOWN_SECONDS - (time.time() - last_save_time))
                    print(f"Nod detected, but system is on cooldown for {time_left} more seconds.")

    # --- HUD: On-Screen Status ---
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

    # BLE / HRV status indicator
    with hr_data_lock:
        ble_connected = hr_shared_state["connected"]
        ble_bpm = hr_shared_state["current_bpm"]
        ble_last_update = hr_shared_state["last_update"]

    if ble_connected and (time.time() - ble_last_update) < 5:
        ble_color = (0, 255, 0)
        ble_text = f"HR: {ble_bpm} bpm"
    elif ble_connected:
        ble_color = (0, 255, 255)
        ble_text = "HR: stale data"
    else:
        ble_color = (0, 0, 255)
        ble_text = "HR: disconnected"

    cv2.putText(frame, ble_text,
                (10, h - 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, ble_color, 2)

    # Oscillation detected flash
    if time.time() - oscillation_time < 1 and post_capture_active:
        cv2.putText(frame, "OSCILLATION DETECTED!", (50, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)

    # --- Background HRV Sampling (every 5 minutes) ---
    if time.time() - last_background_sample_time >= BACKGROUND_SAMPLE_INTERVAL:
        last_background_sample_time = time.time()
        bg_hrv = sample_hrv()

        # Only log if the Polar H9 is connected and has data
        if bg_hrv["hrv_quality"] in ("good", "low"):
            bg_timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with open(LOG_FILE, mode='a', newline='') as file:
                writer = csv.writer(file)
                writer.writerow([
                    bg_timestamp,
                    "",              # No video for background samples
                    "BG",            # Validation_Status = background (not an oscillation)
                    "BG",            # Event_Type: background sample
                    bg_hrv["bpm"],
                    bg_hrv["rmssd_60s"],
                    bg_hrv["mean_rr_60s"],
                    bg_hrv["sdnn_60s"],
                    bg_hrv["rr_count_60s"],
                    bg_hrv["hrv_quality"],
                ])
            print(f"[BG] Background HRV sample logged: RMSSD={bg_hrv['rmssd_60s']}ms, BPM={bg_hrv['bpm']}")

    cv2.imshow("Head Movement Tracker", frame)

    if cv2.waitKey(1) & 0xFF == 27:
        break

# --- Cleanup ---
print("\nShutting down...")
ble_stop_event.set()  # Signal the BLE thread to stop
cap.release()
cv2.destroyAllWindows()
ble_thread.join(timeout=5)  # Wait up to 5 seconds for BLE thread to finish
print("Done.")