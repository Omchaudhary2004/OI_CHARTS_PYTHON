"""
routes/connect.py

POST /api/connect  –  called by the frontend when the user changes the API URL.
Clears stored snapshots if the URL has changed (so the chart starts fresh).
"""

from flask import Blueprint, request, jsonify
from database import check_and_clear_for_url_change
from logger import log_error, log_to_file
from session import set_session  # FIX: update global session on connect

bp = Blueprint("connect", __name__)


@bp.post("/api/connect")
def connect():
    body = request.get_json(silent=True) or {}
    token       = (body.get("token", "") or "").strip()
    expiry_date = (body.get("expiry_date", "") or "").strip()

    if not expiry_date:
        log_error("POST /api/connect", "Missing expiry_date in body")
        return jsonify({"error": "Missing expiry_date in body"}), 400

    masked_token = f"...{token[-4:]}" if token and len(token) > 4 else "env"
    source_identifier = f"upstox|Nifty 50|{expiry_date}|{masked_token}"

    log_to_file(f"[CONNECT] Expiry: {expiry_date}")

    try:
        was_cleared = check_and_clear_for_url_change(source_identifier)
        # FIX: update global session so APScheduler starts fetching with new credentials
        set_session(token or None, expiry_date)
        log_to_file(f"[CONNECT SUCCESS] cleared={was_cleared} scheduler session updated")
        return jsonify({
            "ok": True,
            "message": (
                "New data source detected. Cleared previous data."
                if was_cleared else
                "Data source updated."
            ),
            "cleared": was_cleared,
        })
    except Exception as e:
        log_error("POST /api/connect", e)
        return jsonify({"error": "Failed to update connection", "details": str(e)}), 500
