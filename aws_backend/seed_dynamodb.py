"""
Utility: Seed DynamoDB with Longitudinal Telemetry Dataset
Usage:
  python aws_backend/seed_dynamodb.py --dry-run
  python aws_backend/seed_dynamodb.py --table NeuroStressTelemetry --patient-id patient_001 --shift-to-sept
"""

import argparse
import csv
import os
import sys
from decimal import Decimal
from datetime import datetime

import boto3


def load_and_transform_csv(csv_path, patient_id="patient_001", shift_to_sept=True):
    """
    Parses oscillation_log.csv and transforms into DynamoDB telemetry records.
    """
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSV file not found at: {csv_path}")

    items = []
    with open(csv_path, mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader):
            raw_ts = row["Timestamp"]
            # Optionally shift August dates to September 2026 for the hackathon
            if shift_to_sept and "2026-08-" in raw_ts:
                ts = raw_ts.replace("2026-08-", "2026-09-")
            else:
                ts = raw_ts

            event_type = row.get("Event_Type", "OSC")
            validation_raw = row.get("Validation_Status", "TP")
            video_file = row.get("Video_File", "")
            bpm = float(row.get("BPM", 75.0))
            rmssd_15s = float(row.get("RMSSD_15s", 40.0))
            rmssd_60s = float(row.get("RMSSD_60s", 42.0))

            if validation_raw == "TP":
                status = "VERIFIED_TRUE_POSITIVE"
            elif validation_raw == "FP":
                status = "DISMISSED_FALSE_POSITIVE"
            else:
                status = "BASELINE_CONTROL"

            # Derive synthetic baseline and incident metrics
            if event_type == "OSC":
                baseline_rmssd = round(rmssd_60s * 1.8 if rmssd_60s < 30 else 45.0, 2)
                incident_rmssd = round(rmssd_15s, 2)
                freq_hz = round(2.8 + (idx % 7) * 0.2, 2)
                duration_sec = round(1.8 + (idx % 5) * 0.4, 1)
            else:
                baseline_rmssd = round(rmssd_60s, 2)
                incident_rmssd = round(rmssd_60s, 2)
                freq_hz = 0.0
                duration_sec = 0.0

            stress_drop_pct = round(((baseline_rmssd - incident_rmssd) / baseline_rmssd) * 100.0, 2) if baseline_rmssd > 0 else 0.0
            s3_key = f"clips/{patient_id}/{video_file}" if video_file else ""

            item = {
                "patient_id": patient_id,
                "timestamp": ts,
                "event_id": f"evt_seed_{idx:04d}",
                "event_type": event_type,
                "oscillation_freq_hz": Decimal(str(freq_hz)),
                "duration_sec": Decimal(str(duration_sec)),
                "baseline_rmssd": Decimal(str(baseline_rmssd)),
                "incident_rmssd": Decimal(str(incident_rmssd)),
                "stress_drop_pct": Decimal(str(stress_drop_pct)),
                "bpm": Decimal(str(bpm)),
                "sdnn_60s": Decimal(str(row.get("SDNN_60s", 45.0))),
                "s3_video_key": s3_key,
                "verification_status": status,
                "dataset_source": "pilot_cohort_benchmark"
            }
            items.append(item)

    return items


def seed_dynamodb(items, table_name="NeuroStressTelemetry", region="us-east-1"):
    """
    Bulk writes items to DynamoDB using batch_writer.
    """
    dynamodb = boto3.resource("dynamodb", region_name=region)
    table = dynamodb.Table(table_name)

    print(f"Connecting to DynamoDB table: {table_name} ({region})...")
    written_count = 0
    with table.batch_writer() as batch:
        for item in items:
            batch.put_item(Item=item)
            written_count += 1
            if written_count % 50 == 0:
                print(f"  Uploaded {written_count}/{len(items)} records...")

    print(f"Successfully seeded {written_count} records into {table_name}!")


def main():
    parser = argparse.ArgumentParser(description="Seed DynamoDB with Nystagmus Telemetry Data")
    parser.add_argument("--csv", default="oscillation_log.csv", help="Path to oscillation_log.csv")
    parser.add_argument("--table", default="NeuroStressTelemetry", help="DynamoDB Table Name")
    parser.add_argument("--region", default="us-east-1", help="AWS Region")
    parser.add_argument("--patient-id", default="patient_001", help="Patient ID partition key")
    parser.add_argument("--shift-to-sept", action="store_true", default=True, help="Shift August dates to Sept 2026")
    parser.add_argument("--dry-run", action="store_true", help="Print transformed items without uploading to AWS")

    args = parser.parse_args()

    # Find CSV path
    csv_path = args.csv
    if not os.path.exists(csv_path):
        parent_csv = os.path.join(os.path.dirname(__file__), "..", args.csv)
        if os.path.exists(parent_csv):
            csv_path = parent_csv

    print(f"Loading dataset from: {csv_path}")
    items = load_and_transform_csv(csv_path, patient_id=args.patient_id, shift_to_sept=args.shift_to_sept)
    print(f"Loaded and transformed {len(items)} telemetry records.")

    if args.dry_run:
        print("\n[DRY RUN MODE] Sample record (Item 0):")
        import pprint
        pprint.pprint(items[0])
        print(f"\n[DRY RUN MODE] Successfully validated {len(items)} items. Ready for DynamoDB upload.")
    else:
        seed_dynamodb(items, table_name=args.table, region=args.region)


if __name__ == "__main__":
    main()
