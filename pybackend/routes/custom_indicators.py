"""
routes/custom_indicators.py

GET    /api/custom-indicators          – list all saved indicators
POST   /api/custom-indicators          – create / update  { name, formula }
DELETE /api/custom-indicators/<int:id> – remove by id
"""

from flask import Blueprint, request, jsonify
from database import list_custom_indicators, upsert_custom_indicator, delete_custom_indicator
from logger import log_error

bp = Blueprint("custom_indicators", __name__)


@bp.get("/api/custom-indicators")
def list_indicators():
    try:
        return jsonify(list_custom_indicators())
    except Exception as e:
        log_error("GET /api/custom-indicators", e)
        return jsonify({"error": "DB error"}), 500


@bp.post("/api/custom-indicators")
def create_indicator():
    body    = request.get_json(silent=True) or {}
    name    = (body.get("name", "") or "").strip()
    formula = (body.get("formula", "") or "").strip()

    if not name or not formula:
        return jsonify({"error": "name and formula are required"}), 400

    try:
        row = upsert_custom_indicator(name, formula)
        return jsonify(row)
    except Exception as e:
        log_error("POST /api/custom-indicators", e)
        return jsonify({"error": "DB error", "details": str(e)}), 500


@bp.delete("/api/custom-indicators/<int:ind_id>")
def remove_indicator(ind_id: int):
    try:
        deleted = delete_custom_indicator(ind_id)
        return jsonify({"deleted": deleted})
    except Exception as e:
        log_error("DELETE /api/custom-indicators", e)
        return jsonify({"error": "DB error"}), 500
