"""
routes/logs.py

GET    /api/logs?date=YYYY-MM-DD   – read today's (or specified) log lines
DELETE /api/logs?date=YYYY-MM-DD   – delete that day's log file
"""

from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from logger import read_log, delete_log, log_error

bp = Blueprint("logs", __name__)


def _parse_date(req) -> str:
    d = req.args.get("date", "")
    return d if (isinstance(d, str) and len(d) == 10) else datetime.now(timezone.utc).strftime("%Y-%m-%d")


@bp.get("/api/logs")
def get_logs():
    date_str = _parse_date(request)
    try:
        lines = read_log(date_str)
        return jsonify({"date": date_str, "logs": lines, "count": len(lines)})
    except Exception as e:
        log_error("GET /api/logs", e)
        return jsonify({"error": "Failed to read logs", "details": str(e)}), 500


@bp.delete("/api/logs")
def clear_logs():
    date_str = _parse_date(request)
    try:
        deleted = delete_log(date_str)
        if deleted:
            return jsonify({"ok": True, "message": f"Logs for {date_str} deleted"})
        return jsonify({"message": f"No logs found for {date_str}"})
    except Exception as e:
        log_error("DELETE /api/logs", e)
        return jsonify({"error": "Failed to delete logs", "details": str(e)}), 500
