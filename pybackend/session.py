"""
session.py – Global in-process session state.

Stores the active Upstox token + expiry_date so the background scheduler
can fetch data independently of any HTTP request.

Set whenever:
  - POST /api/connect  is called (user changes token/expiry)
  - POST /api/process  is called (keeps session fresh each poll)
"""

import threading

_lock = threading.Lock()
_state: dict = {
    "token":       None,   # Upstox Bearer token (may be None if using .env)
    "expiry_date": None,   # Options expiry date string "YYYY-MM-DD"
}


def set_session(token: str | None, expiry_date: str | None) -> None:
    """Update the active session. Safe to call from any thread."""
    with _lock:
        _state["token"]       = token or None
        _state["expiry_date"] = expiry_date or None


def get_session() -> dict:
    """Return a copy of the current session. Safe to call from any thread."""
    with _lock:
        return _state.copy()


def session_ready() -> bool:
    """True if we have enough info to make an Upstox API call."""
    with _lock:
        return bool(_state.get("expiry_date"))
