"""
Validation Reviewer — Label oscillation clips as True/False Positives
=====================================================================
Opens each unreviewed video clip from the validation_videos directory,
plays it on loop, and waits for your keypress:

    Y = True Positive  (real oscillation)
    N = False Positive  (not a real oscillation)
    S = Skip (review later)
    Q = Quit

Automatically updates oscillation_log.csv with your label.

Usage:
    python validate_clips.py
"""

import cv2
import csv
import os
import sys

VIDEO_DIR = "validation_videos"
LOG_FILE = "oscillation_log.csv"


def load_log():
    """Load the CSV log and return rows + header."""
    if not os.path.exists(LOG_FILE):
        print(f"❌ {LOG_FILE} not found. Run OscillationTracker.py first.")
        sys.exit(1)

    with open(LOG_FILE, mode='r', newline='') as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = list(reader)

    return header, rows


def save_log(header, rows):
    """Write the full CSV back to disk."""
    with open(LOG_FILE, mode='w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)


def play_video_loop(video_path, hrv_info=None):
    """Play a video on loop until the user presses a key. Returns the key."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"  ⚠️  Could not open {video_path}")
        return None

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30
    delay = int(1000 / fps)

    print("  Playing on loop... Press Y (true), N (false), S (skip), Q (quit)")

    while True:
        ret, frame = cap.read()

        if not ret:
            # Loop back to start
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue

        h, w = frame.shape[:2]

        # Add instruction overlay
        cv2.putText(frame, "Y=True  N=False  S=Skip  Q=Quit",
                    (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)

        # Add HRV data overlay if available
        if hrv_info:
            y_pos = h - 50
            for line in reversed(hrv_info):
                cv2.putText(frame, line, (10, y_pos),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)
                y_pos -= 35

        cv2.imshow("Validation Review", frame)

        key = cv2.waitKey(delay) & 0xFF

        if key == ord('y') or key == ord('Y'):
            cap.release()
            return 'TP'
        elif key == ord('n') or key == ord('N'):
            cap.release()
            return 'FP'
        elif key == ord('s') or key == ord('S'):
            cap.release()
            return None  # Skip
        elif key == ord('q') or key == ord('Q') or key == 27:
            cap.release()
            return 'QUIT'

    cap.release()
    return None


def main():
    header, rows = load_log()

    # Find the Validation_Status column index
    try:
        status_idx = header.index("Validation_Status")
    except ValueError:
        print(f"❌ 'Validation_Status' column not found in {LOG_FILE}")
        sys.exit(1)

    # Find the Video_File column index
    try:
        video_idx = header.index("Video_File")
    except ValueError:
        print(f"❌ 'Video_File' column not found in {LOG_FILE}")
        sys.exit(1)

    # Find unreviewed rows (empty Validation_Status, skip background samples)
    unreviewed = [(i, row) for i, row in enumerate(rows)
                  if len(row) > status_idx and row[status_idx].strip() == ""
                  and row[video_idx].strip() != ""]  # Skip BG rows (no video file)

    if not unreviewed:
        print("✅ All clips have been reviewed! Nothing to do.")
        return

    print(f"\n{'='*50}")
    print(f"  Validation Reviewer")
    print(f"  {len(unreviewed)} unreviewed clips found")
    print(f"{'='*50}\n")

    reviewed_count = 0
    tp_count = 0
    fp_count = 0

    for idx, (row_idx, row) in enumerate(unreviewed):
        video_file = row[video_idx]
        video_path = os.path.join(VIDEO_DIR, video_file)
        timestamp = row[0]

        print(f"\n[{idx + 1}/{len(unreviewed)}] {video_file}  (recorded: {timestamp})")

        if not os.path.exists(video_path):
            print(f"  ⚠️  Video file missing, skipping.")
            continue

        # Build HRV info overlay lines from CSV data
        hrv_info = []
        def safe_get(col_name):
            try:
                idx = header.index(col_name)
                val = row[idx].strip() if idx < len(row) else ""
                return val if val else "--"
            except (ValueError, IndexError):
                return "--"

        rmssd_15 = safe_get("RMSSD_15s")
        rmssd_30 = safe_get("RMSSD_30s")
        rmssd_60 = safe_get("RMSSD_60s")
        bpm = safe_get("BPM")
        quality = safe_get("HRV_Quality")

        hrv_info.append(f"RMSSD: 15s={rmssd_15}  30s={rmssd_30}  60s={rmssd_60} ms")
        hrv_info.append(f"BPM: {bpm}  |  Quality: {quality}")

        # Also print to console
        print(f"  HRV: RMSSD 15s={rmssd_15} 30s={rmssd_30} 60s={rmssd_60}ms | BPM={bpm} | {quality}")

        result = play_video_loop(video_path, hrv_info=hrv_info)

        if result == 'QUIT':
            print("\n  Quitting review session.")
            break
        elif result == 'TP':
            rows[row_idx][status_idx] = 'TP'
            tp_count += 1
            reviewed_count += 1
            print(f"  ✅ Labeled: TRUE POSITIVE")
        elif result == 'FP':
            rows[row_idx][status_idx] = 'FP'
            fp_count += 1
            reviewed_count += 1
            print(f"  ❌ Labeled: FALSE POSITIVE")
        else:
            print(f"  ⏭️  Skipped")

        # Save after each label (in case of crash/quit)
        save_log(header, rows)

    cv2.destroyAllWindows()

    # Summary
    print(f"\n{'='*50}")
    print(f"  Session Complete")
    print(f"  Reviewed: {reviewed_count} clips")
    print(f"  True Positives:  {tp_count}")
    print(f"  False Positives: {fp_count}")
    if tp_count + fp_count > 0:
        precision = tp_count / (tp_count + fp_count) * 100
        print(f"  Detection Precision: {precision:.0f}%")
    print(f"{'='*50}\n")


if __name__ == "__main__":
    main()
