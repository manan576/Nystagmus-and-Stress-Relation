"""
AWS Lambda Handler: Telemetry Query, Analytics & Clinician Verification
Endpoints:
  - GET  /events : Queries DynamoDB time-series records & calculates summary KPIs
  - POST /verify : Updates clinical verification status (True Positive / False Positive)
"""

import json
import os
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key, Attr
from botocore.exceptions import ClientError

# Environment variables
TABLE_NAME = os.environ.get("DYNAMODB_TABLE", "NeuroStressTelemetry")
BUCKET_NAME = os.environ.get("S3_BUCKET", "neurostress-video-clips-prod")
VIEW_URL_EXPIRATION_SECONDS = int(os.environ.get("VIEW_URL_EXPIRATION", "900"))  # 15 minutes
AWS_REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
s3_client = boto3.client("s3", region_name=AWS_REGION)
table = dynamodb.Table(TABLE_NAME)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json"
}


def decimal_default(obj):
    """JSON serializer helper for Decimal types."""
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError


def generate_s3_view_url(s3_key):
    """Generates a temporary pre-signed GET URL for web video playback."""
    if not s3_key:
        return None
    try:
        url = s3_client.generate_presigned_url(
            ClientMethod="get_object",
            Params={
                "Bucket": BUCKET_NAME,
                "Key": s3_key
            },
            ExpiresIn=VIEW_URL_EXPIRATION_SECONDS
        )
        return url
    except Exception as e:
        print(f"Failed to generate view URL for {s3_key}: {e}")
        return None


def handle_get_events(query_params):
    """
    Query telemetry records for a patient and compute aggregate KPIs.
    """
    patient_id = query_params.get("patient_id", "patient_001")
    limit = int(query_params.get("limit", 100))
    status_filter = query_params.get("status")
    start_date = query_params.get("start_date")
    end_date = query_params.get("end_date")

    # Query DynamoDB by Partition Key
    key_condition = Key("patient_id").eq(patient_id)
    if start_date and end_date:
        key_condition = key_condition & Key("timestamp").between(start_date, end_date)
    elif start_date:
        key_condition = key_condition & Key("timestamp").gte(start_date)

    query_kwargs = {
        "KeyConditionExpression": key_condition,
        "Limit": limit,
        "ScanIndexForward": False  # Most recent first
    }

    if status_filter:
        query_kwargs["FilterExpression"] = Attr("verification_status").eq(status_filter)

    response = table.query(**query_kwargs)
    items = response.get("Items", [])

    # Enrich items with S3 streaming URLs and compute analytics
    total_episodes = len(items)
    baseline_sum = 0.0
    incident_sum = 0.0
    stress_drop_sum = 0.0
    tp_count = 0
    fp_count = 0
    pending_count = 0

    enriched_items = []
    for item in items:
        baseline = float(item.get("baseline_rmssd", 0))
        incident = float(item.get("incident_rmssd", 0))
        drop_pct = float(item.get("stress_drop_pct", 0))
        status = item.get("verification_status", "PENDING_REVIEW")

        baseline_sum += baseline
        incident_sum += incident
        stress_drop_sum += drop_pct

        if status in ["VERIFIED_TRUE_POSITIVE", "TP", "VERIFIED"]:
            tp_count += 1
        elif status in ["DISMISSED_FALSE_POSITIVE", "FP", "DISMISSED"]:
            fp_count += 1
        else:
            pending_count += 1

        # Generate fresh S3 view URL
        s3_key = item.get("s3_video_key")
        item_copy = dict(item)
        item_copy["video_stream_url"] = generate_s3_view_url(s3_key)
        enriched_items.append(item_copy)

    # Compute KPI statistics
    avg_baseline = round(baseline_sum / total_episodes, 2) if total_episodes > 0 else 0.0
    avg_incident = round(incident_sum / total_episodes, 2) if total_episodes > 0 else 0.0
    avg_drop_pct = round(stress_drop_sum / total_episodes, 2) if total_episodes > 0 else 0.0

    reviewed_count = tp_count + fp_count
    precision_pct = round((tp_count / reviewed_count) * 100.0, 1) if reviewed_count > 0 else 0.0

    result = {
        "patient_id": patient_id,
        "kpi_metrics": {
            "total_episodes": total_episodes,
            "avg_baseline_rmssd_ms": avg_baseline,
            "avg_incident_rmssd_ms": avg_incident,
            "avg_stress_drop_pct": avg_drop_pct,
            "verified_true_positives": tp_count,
            "dismissed_false_positives": fp_count,
            "pending_review_count": pending_count,
            "clinical_precision_pct": precision_pct
        },
        "episodes": enriched_items
    }

    return {
        "statusCode": 200,
        "headers": CORS_HEADERS,
        "body": json.dumps(result, default=decimal_default)
    }


def handle_post_verify(body):
    """
    Update clinician verification status for an episode.
    """
    patient_id = body.get("patient_id")
    timestamp = body.get("timestamp")
    new_status = body.get("verification_status")  # e.g. "VERIFIED_TRUE_POSITIVE" or "DISMISSED_FALSE_POSITIVE"
    notes = body.get("doctor_notes", "")

    if not patient_id or not timestamp or not new_status:
        return {
            "statusCode": 400,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": "Missing patient_id, timestamp, or verification_status"})
        }

    update_expr = "SET verification_status = :s"
    expr_vals = {":s": new_status}

    if notes:
        update_expr += ", doctor_notes = :n"
        expr_vals[":n"] = notes

    response = table.update_item(
        Key={"patient_id": patient_id, "timestamp": timestamp},
        UpdateExpression=update_expr,
        ExpressionAttributeValues=expr_vals,
        ReturnValues="ALL_NEW"
    )

    return {
        "statusCode": 200,
        "headers": CORS_HEADERS,
        "body": json.dumps({
            "status": "success",
            "message": "Verification status updated",
            "updated_item": response.get("Attributes", {})
        }, default=decimal_default)
    }


def lambda_handler(event, context):
    """
    Routing dispatcher for query and verification endpoints.
    """
    http_method = event.get("httpMethod") or event.get("requestContext", {}).get("http", {}).get("method", "GET")
    
    # Handle CORS preflight
    if http_method == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps({"message": "OK"})
        }

    path = event.get("path") or event.get("requestContext", {}).get("http", {}).get("path", "")

    # Zero-Trust Role & Patient Scoping via Cognito Claims
    auth_claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    if auth_claims:
        groups = auth_claims.get("cognito:groups", [])
        if isinstance(groups, str):
            groups = [groups]
        scoped_patient_id = auth_claims.get("custom:patient_id") or auth_claims.get("sub")
        
        # 1. Clinician-only endpoint protection
        if http_method == "POST" and "Clinicians" not in groups:
            return {
                "statusCode": 403,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "Forbidden: Verification review requires Clinician Investigator credentials."})
            }
        
        # 2. Cross-patient data isolation: Patients cannot access other patient records
        if http_method == "GET" and "Patients" in groups and scoped_patient_id:
            query_params = event.get("queryStringParameters") or {}
            requested_id = query_params.get("patient_id")
            if requested_id and requested_id != scoped_patient_id:
                return {
                    "statusCode": 403,
                    "headers": CORS_HEADERS,
                    "body": json.dumps({"error": "Forbidden: Trial subjects may only access their own telemetry records."})
                }
            query_params["patient_id"] = scoped_patient_id
            return handle_get_events(query_params)

    try:
        if http_method == "GET":
            query_params = event.get("queryStringParameters") or {}
            return handle_get_events(query_params)
        elif http_method == "POST":
            body = event.get("body", {})
            if isinstance(body, str):
                body = json.loads(body)
            return handle_post_verify(body)
        else:
            return {
                "statusCode": 405,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": f"Method {http_method} not allowed"})
            }
    except Exception as e:
        print(f"Error in lambda_query: {e}")
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": str(e)})
        }
