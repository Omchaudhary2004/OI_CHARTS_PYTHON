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
from datetime import datetime, timezone, timedelta

from flask import Flask, jsonify
from flask_cors import CORS

from config import PORT
from database import init_db
from routes import register_routes
from logger import log_to_file, log_to_console

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] [%(levelname)s] %(message)s')
log = logging.getLogger(__name__)

# ── IST helpers ───────────────────────────────────────────────────────────────

_IST = timedelta(hours=5, minutes=30)

def _now_ist() -> datetime:
    """Return the current datetime in IST (UTC+5:30)."""
    return datetime.now(timezone.utc) + _IST

def _is_market_hours() -> bool:
    """
    Return True only during NSE trading hours: 09:14–15:31 IST Monday–Friday.
    A 1-minute buffer on each side ensures we never miss the open/close prints.
    """
    now = _now_ist()
    if now.weekday() >= 5:          # Saturday=5, Sunday=6
        return False
    hm = now.hour * 60 + now.minute
    return (9 * 60 + 14) <= hm <= (15 * 60 + 31)

# ── App factory ───────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from the React frontend


@app.errorhandler(Exception)
def handle_exception(e):
    log.error(f'Unhandled exception: {e}', exc_info=True)
    return jsonify({'error': str(e)}), 500  # never crash, always return JSON


@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'timestamp': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')})


def fetch_with_retry(fn, retries=5):
    """
    Exponential back-off retry: 1 s, 2 s, 4 s, 8 s, 16 s.
    Handles HTTP 429 / 503 by honouring the Retry-After header.
    Total worst-case wait before final attempt: ~31 s, well within the 60 s window.
    """
    for i in range(retries):
        try:
            return fn()
        except Exception as e:
            err_str = str(e)
            # If the exception carries a retry_after hint (set by upstox_client)
            retry_after = getattr(e, 'retry_after', None)
            wait = retry_after if retry_after else (2 ** i)
            log.warning(f'Fetch attempt {i+1}/{retries} failed ({err_str}). Retrying in {wait}s…')
            if i == retries - 1:
                raise
            time.sleep(wait)


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
    Runs every minute at :00 s independently of the frontend.

    Guarantees:
    - Market-hours gate: skips quietly outside 09:14–15:31 IST Mon–Fri.
    - Session guard:     skips if user hasn't called /api/connect yet.
    - 5-retry fetch:     up to ~31 s of total wait time per attempt.
    - Minute-bucket dedup in save_snapshot: safe even if the frontend
      also saved data for this minute.
    - Never raises: all exceptions are caught and logged so the thread
      does not die and future jobs keep running.
    """
    from session import get_session, session_ready
    from upstox_client import fetch_option_chain
    from calculator import calculate_indicators
    from database import save_snapshot

    # Skip outside market hours — conserves API rate-limit quota
    if not _is_market_hours():
        return

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
        # Do NOT re-raise — let the scheduler thread stay alive for the next minute


def _start_scheduler():
    """
    Start APScheduler background job. Called only once (not in Flask reloader child).

    Key settings:
    - CronTrigger(second=0)   → fires at exactly :00 of every minute
    - misfire_grace_time=59   → if the job fires up to 59 s late, still run it
                                (default 30 s caused silent skips)
    - coalesce=True           → if multiple misfires accumulated (e.g. after
                                PC sleep/hibernate), run only ONE catch-up job,
                                not a flood that hammers the API
    """
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger

        scheduler = BackgroundScheduler(
            timezone="UTC",
            job_defaults={
                "misfire_grace_time": 59,  # raised from 30 → full minute window
                "coalesce": True,           # one catch-up job after sleep/hibernate
            },
        )
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

    # Restore session from DB so scheduler can resume immediately on restart
    from session import restore_session_from_db
    restored = restore_session_from_db()
    if restored:
        from session import get_session
        sess = get_session()
        log_to_file(f"[STARTUP] Session restored from DB — expiry={sess['expiry_date']}")
        log_to_console(f"[STARTUP] Session restored — scheduler will resume fetching immediately")
    else:
        log_to_console("[STARTUP] No saved session — waiting for user to connect via frontend")

    start_msg = f"Python backend listening on http://localhost:{PORT}"
    log_to_console(start_msg)
    log_to_file(f"[STARTUP] {start_msg}")
    log_to_file(f"[STARTUP] Date IST: {(_now_ist()).strftime('%Y-%m-%d')}")

    # Start scheduler only once (guard against Flask dev-server reloader double-start)
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        _start_scheduler()

    app.run(host="0.0.0.0", port=PORT, debug=False)
