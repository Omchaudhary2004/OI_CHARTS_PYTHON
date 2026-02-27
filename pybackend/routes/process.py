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
from calculator      import calculate_indicators, calculate_future_indicators
from database        import (check_and_clear_for_url_change, save_snapshot,
                              get_latest_snapshot)
from upstox_client   import (fetch_option_chain, fetch_nifty_future_quote,
                              get_current_nifty_future)
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
        # ── Nifty Futures raw data ────────────────────────────────────
        "fut_ltp":            row.get("fut_ltp"),
        "fut_atp":            row.get("fut_atp"),
        "fut_oi":             row.get("fut_oi"),
        "fut_volume":         row.get("fut_volume"),
        "fut_total_buy_qty":  row.get("fut_total_buy_qty"),
        "fut_total_sell_qty": row.get("fut_total_sell_qty"),
        # ── Nifty Futures derived indicators ──────────────────────────
        # 1. Future OI value LTP  = OI × LTP
        "fut_oi_value_ltp":  row.get("fut_oi_value_ltp"),
        # 2. Future OI value ATP  = OI × ATP
        "fut_oi_value_atp":  row.get("fut_oi_value_atp"),
        # 3. Future Trade value LTP = Volume × LTP
        "fut_trade_val_ltp": row.get("fut_trade_val_ltp"),
        # 4. Future Trade value ATP = Volume × ATP
        "fut_trade_val_atp": row.get("fut_trade_val_atp"),
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

        # Check if scheduler already saved data for this minute using
        # minute-bucket comparison (first 16 chars: "YYYY-MM-DDTHH:MM").
        # Exact-second comparison never matched because the frontend arrives
        # a few seconds after the scheduler's :00 tick.
        current_minute = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")
        latest = get_latest_snapshot()
        if latest and latest.get("timestamp", "")[:16] == current_minute:
            log_to_file(f"[CACHE HIT] Returning scheduler-saved data for minute {current_minute}")
            return jsonify(_snapshot_to_response(latest))

        # FIX: scheduler hasn't saved yet (or we're ahead of it) — fetch directly
        from main import fetch_with_retry
        api_resp = fetch_with_retry(lambda: fetch_option_chain(
            instrument_key="NSE_INDEX|Nifty 50",
            expiry_date=expiry_date,
            token=token if token else None
        ))

        ind = calculate_indicators(api_resp)

        # ── Nifty Futures quote ────────────────────────────────────────────
        try:
            fut_contract = get_current_nifty_future()
            fut_quote    = fetch_with_retry(
                lambda: fetch_nifty_future_quote(
                    instrument_key=fut_contract["instrument_key"],
                    token=token if token else None,
                )
            )
            fut_ind = calculate_future_indicators(fut_quote)
            log_to_file(
                f"[FUTURE] {fut_contract['trading_symbol']} "
                f"ltp={fut_ind['fut_ltp']} oi={fut_ind['fut_oi']} "
                f"oi_val_ltp={fut_ind['fut_oi_value_ltp']:.0f}"
            )
        except FileNotFoundError as e:
            log_to_file(f"[FUTURE] BOD file missing — futures data skipped: {e}")
            fut_ind = {}
        except Exception as e:
            log_error("POST /api/process – future quote", e)
            fut_ind = {}  # non-fatal: option-chain data still saved

        ind.update(fut_ind)  # merge future indicators into main indicator dict
        saved = save_snapshot(ind, api_resp)  # dedup inside: safe if scheduler beat us

        log_to_file(f"[SUCCESS] Data saved – id={saved['id']} ts={saved['timestamp']}")

        return jsonify(_snapshot_to_response({**ind, **saved}))

    except ValueError as e:
        log_error("POST /api/process – ValueError", e)
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        log_error("POST /api/process", e)
        return jsonify({"error": "Failed to process data", "details": str(e)}), 500
