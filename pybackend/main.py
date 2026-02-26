"""
main.py – Entry point for the Upstox Option Chain Python backend.

Run:
    python main.py

All routes are defined in the routes/ package.
All formulas live in calculator.py.
DB operations are in database.py.
Config (token, port, paths) is in config.py.
"""

import logging
import os
import time
from datetime import datetime, timezone

from flask import Flask, jsonify
from flask_cors import CORS

from config import PORT
from database import init_db
from routes import register_routes
from logger import log_to_file, log_to_console

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] [%(levelname)s] %(message)s')
log = logging.getLogger(__name__)

# ── App factory ───────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from the React frontend


@app.errorhandler(Exception)
def handle_exception(e):
    log.error(f'Unhandled exception: {e}', exc_info=True)
    return jsonify({'error': str(e)}), 500  # FIX: never crash, always return JSON


@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'timestamp': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')})


def fetch_with_retry(fn, retries=3):
    """FIX: exponential backoff — 1s, 2s, 4s before giving up."""
    for i in range(retries):
        try:
            return fn()
        except Exception as e:
            log.warning(f'Fetch attempt {i+1}/{retries} failed: {e}')
            if i == retries - 1:
                raise
            time.sleep(2 ** i)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return "Python backend is running"


@app.get("/ping")
def ping():
    return jsonify({"ok": True, "time": datetime.now(timezone.utc).isoformat()})


# ── Register all route blueprints ─────────────────────────────────────────────
register_routes(app)


# ── Background scheduler ──────────────────────────────────────────────────────

def scheduled_fetch():
    """
    FIX: Runs every minute at :00s independently of the frontend.
    If the browser is closed / sleeping, data is still collected.
    Uses dedup in save_snapshot so no duplicate rows even if frontend also polls.
    """
    from session import get_session, session_ready
    from upstox_client import fetch_option_chain
    from calculator import calculate_indicators
    from database import save_snapshot

    if not session_ready():
        return  # user hasn't connected yet — nothing to fetch

    sess = get_session()
    try:
        api_resp = fetch_with_retry(lambda: fetch_option_chain(
            instrument_key="NSE_INDEX|Nifty 50",
            expiry_date=sess["expiry_date"],
            token=sess["token"],
        ))
        ind = calculate_indicators(api_resp)
        result = save_snapshot(ind, api_resp)
        if result.get("already_existed"):
            log_to_file(f"[SCHEDULER] Dedup — snapshot for {result['timestamp']} already saved by frontend")
        else:
            log_to_file(f"[SCHEDULER] Saved snapshot id={result['id']} ts={result['timestamp']}")
    except Exception as e:
        from logger import log_error
        log_error("SCHEDULER", e)


def _start_scheduler():
    """Start APScheduler background job. Only called once (not in Flask reloader child)."""
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger

        scheduler = BackgroundScheduler(timezone="UTC", job_defaults={"misfire_grace_time": 30})
        scheduler.add_job(
            scheduled_fetch,
            CronTrigger(second=0),  # fire at :00 of every minute
            id="fetch_job",
            replace_existing=True,
        )
        scheduler.start()
        log_to_file("[SCHEDULER] APScheduler started — fetching every minute at :00")
        log_to_console("[SCHEDULER] APScheduler started — will fetch every minute at :00 independently of the browser")
        return scheduler
    except ImportError:
        log_to_console("[SCHEDULER] APScheduler not installed — run: pip install APScheduler>=3.10.0")
        return None


# ── Startup ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    start_msg = f"Python backend listening on http://localhost:{PORT}"
    log_to_console(start_msg)
    log_to_file(f"[STARTUP] {start_msg}")
    log_to_file(f"[STARTUP] Date: {datetime.now(timezone.utc).strftime('%Y-%m-%d')}")

    # FIX: start scheduler only once (guard against Flask dev-server reloader double-start)
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        _start_scheduler()

    app.run(host="0.0.0.0", port=PORT, debug=False)
