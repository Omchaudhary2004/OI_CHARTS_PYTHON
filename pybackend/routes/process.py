"""
routes/process.py
POST /api/process  –  fetch Upstox option-chain, calculate indicators, save + return.

The front-end POSTs: { "url": "<upstox-or-proxy-url>" }
The backend fetches the URL (with Bearer auth), calculates all indicators,
stores a snapshot, and returns the full indicator dict.

Upstox JSON detection:
  If response has  { "status": "success", "data": [...] }  → Upstox format
  Otherwise we fall through to a graceful error.
"""

from flask import Blueprint, request, jsonify
from calculator      import calculate_indicators
from database        import check_and_clear_for_url_change, save_snapshot
from upstox_client   import fetch_option_chain
from logger          import log_error, log_to_file

bp = Blueprint("process", __name__)


@bp.post("/api/process")
def process():
    body = request.get_json(silent=True) or {}
    token       = (body.get("token", "") or "").strip()
    expiry_date = (body.get("expiry_date", "") or "").strip()

    if not expiry_date:
        log_error("POST /api/process", "Missing expiry_date in body")
        return jsonify({"error": "Missing expiry_date in body"}), 400

    # Create a unique identifier for this data source to detect when it changes
    # We use a masked token + expiry to know if we need to clear old snapshots
    masked_token = f"...{token[-4:]}" if token and len(token) > 4 else "env"
    source_identifier = f"upstox|Nifty 50|{expiry_date}|{masked_token}"

    log_to_file(f"[REQUEST] POST /api/process - expiry: {expiry_date}")

    try:
        # Clear snapshots if data source changed
        check_and_clear_for_url_change(source_identifier)

        # Fetch from Upstox
        api_resp = fetch_option_chain(
            instrument_key="NSE_INDEX|Nifty 50",
            expiry_date=expiry_date,
            token=token if token else None
        )

        # Calculate all indicators using Upstox formulas
        ind = calculate_indicators(api_resp)

        # Persist to DB
        saved = save_snapshot(ind, api_resp)

        log_to_file(f"[SUCCESS] Data saved – id={saved['id']} ts={saved['timestamp']}")

        return jsonify({
            "id":                       saved["id"],
            "timestamp":                saved["timestamp"],
            "date":                     saved["date"],
            "underlying":               ind["underlying"],
            "nifty_price":              ind["nifty_price"],
            "total_ce_oi_value":        ind["total_ce_oi_value"],
            "total_pe_oi_value":        ind["total_pe_oi_value"],
            "total_ce_oi_value_2":      ind["total_ce_oi_value_2"],
            "total_pe_oi_value_2":      ind["total_pe_oi_value_2"],
            "total_ce_oi_change_value": ind["total_ce_oi_change_value"],
            "total_pe_oi_change_value": ind["total_pe_oi_change_value"],
            "total_ce_trade_value":     ind["total_ce_trade_value"],
            "total_pe_trade_value":     ind["total_pe_trade_value"],
            "diff_oi_value":            ind["diff_oi_value"],
            "ratio_oi_value":           ind["ratio_oi_value"],
            "diff_oi_value_2":          ind["diff_oi_value_2"],
            "ratio_oi_value_2":         ind["ratio_oi_value_2"],
            "diff_trade_value":         ind["diff_trade_value"],
            "test_value":               ind["test_value"],
            "ce_oi":     ind["ce_oi"],
            "pe_oi":     ind["pe_oi"],
            "ce_chg_oi": ind["ce_chg_oi"],
            "pe_chg_oi": ind["pe_chg_oi"],
            "ce_vol":    ind["ce_vol"],
            "pe_vol":    ind["pe_vol"],
        })

    except ValueError as e:
        log_error("POST /api/process – ValueError", e)
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        log_error("POST /api/process", e)
        return jsonify({"error": "Failed to process data", "details": str(e)}), 500
