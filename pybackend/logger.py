"""
logger.py – File + console logging utilities.
Keeps one log file per day in the logs/ directory.
Old log files are auto-deleted on startup.
"""

import os
import json
from datetime import datetime, timezone
from config import LOGS_DIR

LOGS_DIR.mkdir(parents=True, exist_ok=True)
_current_log_path = None


def _get_log_path() -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return str(LOGS_DIR / f"data-gathering-{today}.log")


def _cleanup_old_logs():
    """Delete log files that are not for today."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        for fname in LOGS_DIR.iterdir():
            if fname.name.startswith("data-gathering-") and fname.suffix == ".log":
                file_date = fname.stem.replace("data-gathering-", "")
                if file_date != today:
                    fname.unlink(missing_ok=True)
    except Exception as e:
        print(f"[LOG CLEANUP ERROR] {e}")


_cleanup_old_logs()


def log_to_file(message: str):
    ts = datetime.now(timezone.utc).isoformat()
    line = f"[{ts}] {message}\n"
    try:
        with open(_get_log_path(), "a", encoding="utf-8") as f:
            f.write(line)
    except Exception as e:
        print(f"[LOGGING ERROR] {e}")


def log_to_console(message: str):
    print(message)


def log_data_point(details: dict):
    msg = f"[DATA POINT] {json.dumps(details)}"
    log_to_file(msg)
    log_to_console(msg)


def log_error(context: str, error):
    msg = f"[ERROR] [{context}] {error}"
    log_to_file(msg)
    print(msg)


def read_log(date_str: str = None) -> list[str]:
    """Return all log lines for the given date (YYYY-MM-DD), or today."""
    if not date_str:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    log_path = LOGS_DIR / f"data-gathering-{date_str}.log"
    if not log_path.exists():
        return []
    lines = log_path.read_text(encoding="utf-8").strip().splitlines()
    return [l for l in lines if l]


def delete_log(date_str: str = None) -> bool:
    if not date_str:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    log_path = LOGS_DIR / f"data-gathering-{date_str}.log"
    if log_path.exists():
        log_path.unlink()
        return True
    return False
