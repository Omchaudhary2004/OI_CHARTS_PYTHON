"""
routes/process.py
POST /api/process  –  fetch Upstox option-chain, calculate indicators, save + return.

FIX: Now checks DB for scheduler-saved data before calling Upstox.
  - If scheduler already saved this minute's data → return cached row (no Upstox call)
  - Otherwise → fetch from Upstox, save, return (fallback)
  - Always updates global session so scheduler has latest credentials
"""

from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from calculator      import calculate_indicators
from database        import (check_and_clear_for_url_change, save_snapshot,
                              get_latest_snapshot)
from upstox_client   import fetch_option_chain
from logger          import log_error, log_to_file
from session         import set_session  # FIX: update global session on every call

bp = Blueprint("process", __name__)


def _snapshot_to_response(row: dict) -> dict:
    """Convert a DB row / indicator dict to the frontend response shape."""
    return {
        "id":                       row.get("id"),
        "timestamp":                row.get("timestamp"),
        "date":                     row.get("date"),
        "underlying":               row.get("underlying"),
        "nifty_price":              row.get("nifty_price"),
        "total_ce_oi_value":        row.get("total_ce_oi_value"),
        "total_pe_oi_value":        row.get("total_pe_oi_value"),
        "total_ce_oi_value_2":      row.get("total_ce_oi_value_2"),
        "total_pe_oi_value_2":      row.get("total_pe_oi_value_2"),
        "total_ce_oi_change_value": row.get("total_ce_oi_change_value"),
        "total_pe_oi_change_value": row.get("total_pe_oi_change_value"),
        "total_ce_trade_value":     row.get("total_ce_trade_value"),
        "total_pe_trade_value":     row.get("total_pe_trade_value"),
        "diff_oi_value":            row.get("diff_oi_value"),
        "ratio_oi_value":           row.get("ratio_oi_value"),
        "diff_oi_value_2":          row.get("diff_oi_value_2"),
        "ratio_oi_value_2":         row.get("ratio_oi_value_2"),
        "diff_trade_value":         row.get("diff_trade_value"),
        "test_value":               row.get("test_value"),
        "ce_oi":     row.get("ce_oi"),
        "pe_oi":     row.get("pe_oi"),
        "ce_chg_oi": row.get("ce_chg_oi"),
        "pe_chg_oi": row.get("pe_chg_oi"),
        "ce_vol":    row.get("ce_vol"),
        "pe_vol":    row.get("pe_vol"),
    }


@bp.post("/api/process")
def process():
    body        = request.get_json(silent=True) or {}
    token       = (body.get("token", "") or "").strip()
    expiry_date = (body.get("expiry_date", "") or "").strip()

    if not expiry_date:
        log_error("POST /api/process", "Missing expiry_date in body")
        return jsonify({"error": "Missing expiry_date in body"}), 400

    # FIX: always update global session so APScheduler has latest credentials
    set_session(token or None, expiry_date)

    masked_token = f"...{token[-4:]}" if token and len(token) > 4 else "env"
    source_identifier = f"upstox|Nifty 50|{expiry_date}|{masked_token}"

    log_to_file(f"[REQUEST] POST /api/process - expiry: {expiry_date}")

    try:
        # Clear snapshots if data source changed (e.g. new expiry date)
        check_and_clear_for_url_change(source_identifier)

        # FIX: check if scheduler already saved data for this minute
        # If so, return the cached row — no Upstox API call needed
        current_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        latest = get_latest_snapshot()
        if latest and latest.get("timestamp") == current_ts:
            log_to_file(f"[CACHE HIT] Returning scheduler-saved data for {current_ts}")
            return jsonify(_snapshot_to_response(latest))

        # FIX: scheduler hasn't saved yet (or we're ahead of it) — fetch directly
        from main import fetch_with_retry
        api_resp = fetch_with_retry(lambda: fetch_option_chain(
            instrument_key="NSE_INDEX|Nifty 50",
            expiry_date=expiry_date,
            token=token if token else None
        ))

        ind = calculate_indicators(api_resp)
        saved = save_snapshot(ind, api_resp)  # dedup inside: safe if scheduler beat us

        log_to_file(f"[SUCCESS] Data saved – id={saved['id']} ts={saved['timestamp']}")

        return jsonify(_snapshot_to_response({**ind, **saved}))

    except ValueError as e:
        log_error("POST /api/process – ValueError", e)
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        log_error("POST /api/process", e)
        return jsonify({"error": "Failed to process data", "details": str(e)}), 500
