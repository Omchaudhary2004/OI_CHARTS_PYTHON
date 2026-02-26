"""
main.py – Entry point for the Upstox Option Chain Python backend.

Run:
    python main.py

Or with uvicorn for production:
    uvicorn main:app --port 4000

All routes are defined in the routes/ package.
All formulas live in calculator.py.
DB operations are in database.py.
Config (token, port, paths) is in config.py.
"""

from flask import Flask, jsonify
from flask_cors import CORS
from datetime import datetime, timezone

from config import PORT
from database import init_db
from routes import register_routes
from logger import log_to_file, log_to_console

# ── App factory ───────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from the React frontend

# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return "Python backend is running"


@app.get("/ping")
def ping():
    return jsonify({"ok": True, "time": datetime.now(timezone.utc).isoformat()})


# ── Register all route blueprints ─────────────────────────────────────────────
register_routes(app)

# ── Startup ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    start_msg = f"Python backend listening on http://localhost:{PORT}"
    log_to_console(start_msg)
    log_to_file(f"[STARTUP] {start_msg}")
    log_to_file(f"[STARTUP] Date: {datetime.now(timezone.utc).strftime('%Y-%m-%d')}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
