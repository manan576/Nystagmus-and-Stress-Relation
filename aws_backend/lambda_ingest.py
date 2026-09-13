"""
AWS Lambda Handler: Event Ingestion & S3 Pre-Signed Upload URL Generator
Endpoint: POST /events
Description: Receives real-time oscillation & HRV telemetry from edge tracker,
             saves metadata into DynamoDB, and issues an S3 pre-signed URL for MP4 clip upload.
"""

import json
import os
import uuid
from decimal import Decimal
import boto3
from botocore.exceptions import ClientError

# Environment variables with defaults
TABLE_NAME = os.environ.get("DYNAMODB_TABLE", "NeuroStressTelemetry")
BUCKET_NAME = os.environ.get("S3_BUCKET", "neurostress-video-clips-prod")
URL_EXPIRATION_SECONDS = int(os.environ.get("URL_EXPIRATION", "300"))
AWS_REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))

# Initialize AWS clients
dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
s3_client = boto3.client("s3", region_name=AWS_REGION)
table = dynamodb.Table(TABLE_NAME)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json"
}


def decimal_default(obj):
    """JSON serializer helper for Decimal types."""
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError


def lambda_handler(event, context):
    """
    AWS Lambda entrypoint for event ingestion.
    """
    # Handle CORS preflight
    http_method = event.get("httpMethod") or event.get("requestContext", {}).get("http", {}).get("method")
    if http_method == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps({"message": "OK"})
        }

    try:
        body = event.get("body", {})
        if isinstance(body, str):
            body = json.loads(body)

        # Validate required fields
        required_fields = ["patient_id", "timestamp", "baseline_rmssd", "incident_rmssd"]
        for field in required_fields:
            if field not in body:
                return {
                    "statusCode": 400,
                    "headers": CORS_HEADERS,
                    "body": json.dumps({"error": f"Missing required field: {field}"})
                }

        patient_id = str(body["patient_id"]).strip()
        timestamp = str(body["timestamp"]).strip()
        event_id = body.get("event_id", f"evt_{uuid.uuid4().hex[:12]}")
        
        # Zero-Trust Patient Isolation: Extract and enforce verified patient identity from Cognito claims
        auth_claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
        if auth_claims:
            scoped_id = auth_claims.get("custom:patient_id") or auth_claims.get("sub")
            groups = auth_claims.get("cognito:groups", [])
            if isinstance(groups, str):
                groups = [groups]
            if "Patients" in groups and scoped_id:
                patient_id = scoped_id  # Override request body with verified token claim

        freq_hz = float(body.get("oscillation_freq_hz", 0.0))
        baseline_rmssd = float(body["baseline_rmssd"])
        incident_rmssd = float(body["incident_rmssd"])
        duration_sec = float(body.get("duration_sec", 10.0))
        
        # Calculate stress drop percentage
        if baseline_rmssd > 0:
            stress_drop_pct = round(((baseline_rmssd - incident_rmssd) / baseline_rmssd) * 100.0, 2)
        else:
            stress_drop_pct = 0.0

        # Construct S3 Object Key
        clean_ts = timestamp.replace(":", "-").replace(".", "-").replace(" ", "_")
        s3_key = f"clips/{patient_id}/incident_{clean_ts}.mp4"

        # Generate S3 Pre-Signed Upload URL (PUT method)
        try:
            upload_url = s3_client.generate_presigned_url(
                ClientMethod="put_object",
                Params={
                    "Bucket": BUCKET_NAME,
                    "Key": s3_key,
                    "ContentType": "video/mp4"
                },
                ExpiresIn=URL_EXPIRATION_SECONDS
            )
        except Exception as s3_err:
            upload_url = None
            print(f"Warning: S3 Presigned URL generation failed: {s3_err}")

        # Prepare DynamoDB Item (Convert floats to Decimal for DynamoDB)
        db_item = {
            "patient_id": patient_id,
            "timestamp": timestamp,
            "event_id": event_id,
            "oscillation_freq_hz": Decimal(str(freq_hz)),
            "duration_sec": Decimal(str(duration_sec)),
            "baseline_rmssd": Decimal(str(baseline_rmssd)),
            "incident_rmssd": Decimal(str(incident_rmssd)),
            "stress_drop_pct": Decimal(str(stress_drop_pct)),
            "s3_video_key": s3_key,
            "verification_status": body.get("verification_status", "PENDING_REVIEW"),
            "device_model": body.get("device_model", "Polar H9 ECG + MediaPipe Vision"),
            "session_id": body.get("session_id", "live_session")
        }

        # Put item into DynamoDB
        table.put_item(Item=db_item)

        response_payload = {
            "status": "success",
            "message": "Telemetry logged successfully",
            "event_id": event_id,
            "patient_id": patient_id,
            "timestamp": timestamp,
            "stress_drop_pct": stress_drop_pct,
            "s3_video_key": s3_key,
            "upload_url": upload_url,
            "upload_url_expires_seconds": URL_EXPIRATION_SECONDS
        }

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps(response_payload, default=decimal_default)
        }

    except Exception as e:
        print(f"Error processing ingestion: {e}")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": str(e)})
        }
