"""
Comprehensive Local & Unit Test Suite for AWS Serverless Backend
Tests all 3 Lambda handlers, data transformers, and Bedrock fallback logic.
Usage:
  python aws_backend/test_backend.py
"""

import json
import os
import sys
import unittest
from decimal import Decimal
from unittest.mock import MagicMock, patch

# Ensure aws_backend is in sys.path
sys.path.insert(0, os.path.dirname(__file__))

import lambda_ingest
import lambda_query
import lambda_bedrock_summary
import seed_dynamodb


class TestAWSBackend(unittest.TestCase):

    def setUp(self):
        self.mock_context = MagicMock()

    @patch("lambda_ingest.table")
    @patch("lambda_ingest.s3_client")
    def test_lambda_ingest_success(self, mock_s3, mock_dynamo):
        """Test event ingestion and pre-signed S3 URL generation."""
        mock_s3.generate_presigned_url.return_value = "https://s3.amazonaws.com/test-bucket/test-upload-url"
        mock_dynamo.put_item.return_value = {"ResponseMetadata": {"HTTPStatusCode": 200}}

        event_payload = {
            "httpMethod": "POST",
            "body": json.dumps({
                "patient_id": "patient_001",
                "timestamp": "2026-09-18T14:22:10Z",
                "oscillation_freq_hz": 3.4,
                "duration_sec": 2.1,
                "baseline_rmssd": 45.0,
                "incident_rmssd": 18.0,
                "device_model": "Polar H9 ECG"
            })
        }

        response = lambda_ingest.lambda_handler(event_payload, self.mock_context)
        self.assertEqual(response["statusCode"], 200)

        body = json.loads(response["body"])
        self.assertEqual(body["status"], "success")
        self.assertEqual(body["patient_id"], "patient_001")
        # ((45.0 - 18.0) / 45.0) * 100 = 60.0%
        self.assertEqual(body["stress_drop_pct"], 60.0)
        self.assertIn("upload_url", body)
        self.assertTrue(body["s3_video_key"].startswith("clips/patient_001/incident_"))

    @patch("lambda_ingest.table")
    def test_lambda_ingest_missing_fields(self, mock_dynamo):
        """Test payload validation for missing required fields."""
        event_payload = {
            "httpMethod": "POST",
            "body": json.dumps({
                "patient_id": "patient_001"
                # Missing timestamp, frequency, rmssd
            })
        }
        response = lambda_ingest.lambda_handler(event_payload, self.mock_context)
        self.assertEqual(response["statusCode"], 400)
        body = json.loads(response["body"])
        self.assertIn("error", body)

    @patch("lambda_query.table")
    @patch("lambda_query.s3_client")
    def test_lambda_query_events(self, mock_s3, mock_dynamo):
        """Test querying telemetry events and calculating aggregate KPI metrics."""
        mock_s3.generate_presigned_url.return_value = "https://s3.amazonaws.com/test-bucket/test-view-url"
        mock_dynamo.query.return_value = {
            "Items": [
                {
                    "patient_id": "patient_001",
                    "timestamp": "2026-09-18 14:00:00",
                    "baseline_rmssd": Decimal("45.0"),
                    "incident_rmssd": Decimal("18.0"),
                    "stress_drop_pct": Decimal("60.0"),
                    "verification_status": "VERIFIED_TRUE_POSITIVE",
                    "s3_video_key": "clips/patient_001/nod_1.mp4"
                },
                {
                    "patient_id": "patient_001",
                    "timestamp": "2026-09-18 15:00:00",
                    "baseline_rmssd": Decimal("43.0"),
                    "incident_rmssd": Decimal("21.0"),
                    "stress_drop_pct": Decimal("51.16"),
                    "verification_status": "DISMISSED_FALSE_POSITIVE",
                    "s3_video_key": "clips/patient_001/nod_2.mp4"
                }
            ]
        }

        event_payload = {
            "httpMethod": "GET",
            "queryStringParameters": {"patient_id": "patient_001"}
        }

        response = lambda_query.lambda_handler(event_payload, self.mock_context)
        self.assertEqual(response["statusCode"], 200)

        body = json.loads(response["body"])
        kpi = body["kpi_metrics"]
        self.assertEqual(kpi["total_episodes"], 2)
        self.assertEqual(kpi["avg_baseline_rmssd_ms"], 44.0)
        self.assertEqual(kpi["avg_incident_rmssd_ms"], 19.5)
        self.assertEqual(kpi["verified_true_positives"], 1)
        self.assertEqual(kpi["dismissed_false_positives"], 1)
        self.assertEqual(kpi["clinical_precision_pct"], 50.0)

    @patch("lambda_query.table")
    def test_lambda_query_post_verify(self, mock_dynamo):
        """Test updating episode verification status."""
        mock_dynamo.update_item.return_value = {
            "Attributes": {
                "patient_id": "patient_001",
                "timestamp": "2026-09-18 14:00:00",
                "verification_status": "VERIFIED_TRUE_POSITIVE",
                "doctor_notes": "Confirmed true nystagmus oscillation on video"
            }
        }

        event_payload = {
            "httpMethod": "POST",
            "path": "/verify",
            "body": json.dumps({
                "patient_id": "patient_001",
                "timestamp": "2026-09-18 14:00:00",
                "verification_status": "VERIFIED_TRUE_POSITIVE",
                "doctor_notes": "Confirmed true nystagmus oscillation on video"
            })
        }

        response = lambda_query.lambda_handler(event_payload, self.mock_context)
        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertEqual(body["status"], "success")

    @patch("lambda_bedrock_summary.table")
    def test_lambda_bedrock_summary(self, mock_dynamo):
        """Test Bedrock AI clinical progress note generation."""
        mock_dynamo.query.return_value = {
            "Items": [
                {
                    "patient_id": "patient_001",
                    "timestamp": "2026-09-18 14:30:00",
                    "baseline_rmssd": Decimal("44.5"),
                    "incident_rmssd": Decimal("18.2"),
                    "stress_drop_pct": Decimal("59.1"),
                    "oscillation_freq_hz": Decimal("3.4"),
                    "verification_status": "VERIFIED_TRUE_POSITIVE"
                }
            ]
        }

        event_payload = {
            "httpMethod": "POST",
            "body": json.dumps({"patient_id": "patient_001"})
        }

        response = lambda_bedrock_summary.lambda_handler(event_payload, self.mock_context)
        self.assertEqual(response["statusCode"], 200)

        body = json.loads(response["body"])
        self.assertEqual(body["status"], "success")
        self.assertIn("clinical_summary_markdown", body)
        self.assertIn("Autonomic", body["clinical_summary_markdown"])

    def test_seed_dynamodb_transform(self):
        """Test CSV transformation into DynamoDB schema."""
        csv_path = os.path.join(os.path.dirname(__file__), "..", "oscillation_log.csv")
        if os.path.exists(csv_path):
            items = seed_dynamodb.load_and_transform_csv(csv_path, shift_to_sept=True)
            self.assertEqual(len(items), 400)
            self.assertEqual(items[0]["patient_id"], "patient_001")
            self.assertTrue(items[0]["timestamp"].startswith("2026-09-"))


if __name__ == "__main__":
    print("=" * 60)
    print("  RUNNING AWS SERVERLESS BACKEND UNIT TESTS")
    print("=" * 60)
    unittest.main()
