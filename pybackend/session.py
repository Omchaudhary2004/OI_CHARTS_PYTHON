"""
session.py – Global in-process session state.

Stores the active Upstox token + expiry_date so the background scheduler
can fetch data independently of any HTTP request.

Set whenever:
  - POST /api/connect  is called (user changes token/expiry)
  - POST /api/process  is called (keeps session fresh each poll)

Credentials are also persisted to the SQLite metadata table via
database.persist_session() so that a backend restart during market hours
can immediately resume fetching without waiting for the user to reconnect.
"""

import threading

_lock = threading.Lock()
_state: dict = {
    "token":       None,   # Upstox Bearer token (may be None if using .env)
    "expiry_date": None,   # Options expiry date string "YYYY-MM-DD"
}


def set_session(token: str | None, expiry_date: str | None) -> None:
    """Update the active session. Safe to call from any thread.
    Also persists credentials to DB so they survive a backend restart.
    """
    with _lock:
        _state["token"]       = token or None
        _state["expiry_date"] = expiry_date or None

    # Persist to DB outside the lock (DB has its own thread safety via WAL mode)
    try:
        from database import persist_session
        persist_session(token, expiry_date)
    except Exception:
        pass  # DB not yet available at very first startup — ignore


def get_session() -> dict:
    """Return a copy of the current session. Safe to call from any thread."""
    with _lock:
        return _state.copy()


def session_ready() -> bool:
    """True if we have enough info to make an Upstox API call."""
    with _lock:
        return bool(_state.get("expiry_date"))


def restore_session_from_db() -> bool:
    """
    Load persisted credentials from the DB into the in-memory state.
    Called once at startup (main.py) so the scheduler can resume immediately
    if the backend crashed and restarted during market hours.

    Returns True if a valid session was restored.
    """
    try:
        from database import load_persisted_session
        saved = load_persisted_session()
        if saved.get("expiry_date"):
            with _lock:
                _state["token"]       = saved["token"]
                _state["expiry_date"] = saved["expiry_date"]
            return True
    except Exception:
        pass
    return False
