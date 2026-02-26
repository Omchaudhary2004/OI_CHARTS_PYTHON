"""
routes/indicators.py

GET  /api/indicators?date=YYYY-MM-DD   – indicator rows for a day
GET  /api/history                      – full history (all dates)
GET  /api/export?date=YYYY-MM-DD       – CSV download
"""

import io
import csv
from datetime import datetime, timezone, timedelta
from flask import Blueprint, request, jsonify, Response
from database import get_indicators_for_date, get_all_history, get_snapshots_for_export
from logger import log_error, log_to_file

bp = Blueprint("indicators", __name__)

IST_OFFSET = timedelta(hours=5, minutes=30)


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _parse_date(req) -> str:
    d = req.args.get("date", "")
    return d if (isinstance(d, str) and len(d) == 10) else _today()


# ── GET /api/indicators ───────────────────────────────────────────────────────

@bp.get("/api/indicators")
def get_indicators():
    date_str = _parse_date(request)
    log_to_file(f"[GET] /api/indicators date={date_str}")
    try:
        rows = get_indicators_for_date(date_str)
        return jsonify({"date": date_str, "points": rows})
    except Exception as e:
        log_error("GET /api/indicators", e)
        return jsonify({"error": "DB error"}), 500


# ── GET /api/history ──────────────────────────────────────────────────────────

@bp.get("/api/history")
def get_history():
    try:
        rows = get_all_history()
        return jsonify(rows)
    except Exception as e:
        log_error("GET /api/history", e)
        return jsonify({"error": "DB error"}), 500


# ── GET /api/export ───────────────────────────────────────────────────────────

CSV_HEADER = [
    "timestamp_IST", "underlying", "nifty_price",
    "total_ce_oi_value", "total_pe_oi_value",
    "total_ce_oi_change_value", "total_pe_oi_change_value",
    "total_ce_trade_value", "total_pe_trade_value",
    "diff_oi_value", "ratio_oi_value", "diff_trade_value", "test_value",
    "ce_oi", "pe_oi", "ce_chg_oi", "pe_chg_oi", "ce_vol", "pe_vol",
]


def _to_ist(ts_str: str) -> str:
    """Convert ISO UTC timestamp string → IST string."""
    try:
        utc = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        ist = utc + IST_OFFSET
        return ist.strftime("%Y-%m-%d %H:%M:%S") + " IST"
    except Exception:
        return ts_str


@bp.get("/api/export")
def export_csv():
    date_str = _parse_date(request)
    try:
        rows = get_snapshots_for_export(date_str)

        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=CSV_HEADER)
        writer.writeheader()

        for r in rows:
            writer.writerow({
                "timestamp_IST":            _to_ist(r["timestamp"]),
                "underlying":               r["underlying"],
                "nifty_price":              r["nifty_price"],
                "total_ce_oi_value":        r["total_ce_oi_value"],
                "total_pe_oi_value":        r["total_pe_oi_value"],
                "total_ce_oi_change_value": r["total_ce_oi_change_value"],
                "total_pe_oi_change_value": r["total_pe_oi_change_value"],
                "total_ce_trade_value":     r["total_ce_trade_value"],
                "total_pe_trade_value":     r["total_pe_trade_value"],
                "diff_oi_value":            r["diff_oi_value"],
                "ratio_oi_value":           r["ratio_oi_value"],
                "diff_trade_value":         r["diff_trade_value"],
                "test_value":               r["test_value"],
                "ce_oi":    r["ce_oi"],
                "pe_oi":    r["pe_oi"],
                "ce_chg_oi": r["ce_chg_oi"],
                "pe_chg_oi": r["pe_chg_oi"],
                "ce_vol":   r["ce_vol"],
                "pe_vol":   r["pe_vol"],
            })

        csv_bytes = output.getvalue().encode("utf-8")
        return Response(
            csv_bytes,
            mimetype="text/csv",
            headers={"Content-Disposition": f'attachment; filename="indicators-{date_str}.csv"'}
        )
    except Exception as e:
        log_error("GET /api/export", e)
        return jsonify({"error": "Export failed", "details": str(e)}), 500
