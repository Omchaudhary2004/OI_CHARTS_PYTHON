"""
database.py – SQLite helpers.

All DB access goes through this module so route handlers stay clean.
Tables:
    metadata          – key/value store (current_url, current_date)
    snapshots         – one row per fetch cycle with all indicators
    custom_indicators – user-defined formulas
"""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from config import DB_PATH
from logger import log_error, log_data_point, log_to_file

# ── Connection factory ────────────────────────────────────────────────────────

def get_connection() -> sqlite3.Connection:
    """Open a DB connection with row_factory so rows behave like dicts.

    WAL mode:     allows concurrent reads + one writer without SQLITE_BUSY.
    busy_timeout: up to 5 s of spin-wait before raising OperationalError,
                  so scheduler + HTTP threads never silently drop a write.
    """
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")    # Write-Ahead Logging — no reader/writer conflicts
    conn.execute("PRAGMA busy_timeout=5000")   # 5 000 ms spin before SQLITE_BUSY
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA synchronous=NORMAL")  # safe with WAL, faster than FULL
    return conn


@contextmanager
def db_cursor():
    """Context manager: opens a connection, yields cursor, commits & closes."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        yield cur
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise
    finally:
        conn.close()


# ── Schema initialisation ─────────────────────────────────────────────────────

def init_db():
    """Create all tables and run any pending migrations."""
    with db_cursor() as cur:
        # Metadata table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS metadata (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        cur.execute("INSERT OR IGNORE INTO metadata (key, value) VALUES ('current_url',  '')")
        cur.execute("INSERT OR IGNORE INTO metadata (key, value) VALUES ('current_date', '')")
        # Persist session so credentials survive a backend restart during market hours
        cur.execute("INSERT OR IGNORE INTO metadata (key, value) VALUES ('session_token',       '')")
        cur.execute("INSERT OR IGNORE INTO metadata (key, value) VALUES ('session_expiry_date', '')")

        # Snapshots table – all indicator columns
        cur.execute("""
            CREATE TABLE IF NOT EXISTS snapshots (
                id                       INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp                TEXT NOT NULL,
                date                     TEXT NOT NULL,
                underlying               REAL NOT NULL DEFAULT 0,
                total_ce_oi_value        REAL NOT NULL DEFAULT 0,
                total_pe_oi_value        REAL NOT NULL DEFAULT 0,
                total_ce_oi_value_2      REAL NOT NULL DEFAULT 0,
                total_pe_oi_value_2      REAL NOT NULL DEFAULT 0,
                total_ce_oi_change_value REAL NOT NULL DEFAULT 0,
                total_pe_oi_change_value REAL NOT NULL DEFAULT 0,
                total_ce_trade_value     REAL NOT NULL DEFAULT 0,
                total_pe_trade_value     REAL NOT NULL DEFAULT 0,
                diff_oi_value            REAL NOT NULL DEFAULT 0,
                ratio_oi_value           REAL NOT NULL DEFAULT 0,
                diff_oi_value_2          REAL NOT NULL DEFAULT 0,
                ratio_oi_value_2         REAL NOT NULL DEFAULT 0,
                diff_trade_value         REAL NOT NULL DEFAULT 0,
                test_value               REAL NOT NULL DEFAULT 0,
                ce_oi                    REAL NOT NULL DEFAULT 0,
                pe_oi                    REAL NOT NULL DEFAULT 0,
                ce_chg_oi                REAL NOT NULL DEFAULT 0,
                pe_chg_oi                REAL NOT NULL DEFAULT 0,
                ce_vol                   REAL NOT NULL DEFAULT 0,
                pe_vol                   REAL NOT NULL DEFAULT 0,
                nifty_price              REAL NOT NULL DEFAULT 0,
                -- Nifty Futures raw market data
                fut_ltp                  REAL NOT NULL DEFAULT 0,
                fut_atp                  REAL NOT NULL DEFAULT 0,
                fut_oi                   REAL NOT NULL DEFAULT 0,
                fut_volume               REAL NOT NULL DEFAULT 0,
                fut_total_buy_qty        REAL NOT NULL DEFAULT 0,
                fut_total_sell_qty       REAL NOT NULL DEFAULT 0,
                -- Nifty Futures derived indicators
                fut_oi_value_ltp         REAL NOT NULL DEFAULT 0,
                fut_oi_value_atp         REAL NOT NULL DEFAULT 0,
                fut_trade_val_ltp        REAL NOT NULL DEFAULT 0,
                fut_trade_val_atp        REAL NOT NULL DEFAULT 0,
                raw_json                 TEXT NOT NULL
            )
        """)

        # Graceful migration for existing DB
        for col in [
            "total_ce_oi_value_2", "total_pe_oi_value_2", "diff_oi_value_2", "ratio_oi_value_2",
            # Nifty Futures columns added later
            "fut_ltp", "fut_atp", "fut_oi", "fut_volume",
            "fut_total_buy_qty", "fut_total_sell_qty",
            "fut_oi_value_ltp", "fut_oi_value_atp",
            "fut_trade_val_ltp", "fut_trade_val_atp",
        ]:
            try:
                cur.execute(f"ALTER TABLE snapshots ADD COLUMN {col} REAL NOT NULL DEFAULT 0")
            except Exception:
                pass

        # Custom indicators table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS custom_indicators (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL UNIQUE,
                formula    TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

    print("✓ Database initialised")
    log_to_file("[STARTUP] Database initialised")


# ── Date & URL helpers ────────────────────────────────────────────────────────

# FIX: use IST date (UTC+5:30) instead of UTC — prevents DB clearing mid-session at 5:30 AM IST
from datetime import timedelta
_IST = timedelta(hours=5, minutes=30)


def _today_ist() -> str:
    return (datetime.now(timezone.utc) + _IST).strftime("%Y-%m-%d")


def check_and_clear_old_data() -> bool:
    """If the most-recent snapshot date ≠ today IST, delete all snapshots. Returns True if cleared."""
    today = _today_ist()  # FIX: IST date, not UTC
    with db_cursor() as cur:
        cur.execute("SELECT DISTINCT date FROM snapshots ORDER BY date DESC LIMIT 1")
        row = cur.fetchone()
        if row and row["date"] != today:
            cur.execute("DELETE FROM snapshots")
            log_to_file(f"[DATE CHECK] Date changed. Cleared old snapshots (was {row['date']})")
            return True
    return False


# ── Session persistence helpers ───────────────────────────────────────────────

def persist_session(token: str | None, expiry_date: str | None) -> None:
    """
    Write token + expiry_date into the metadata table so they survive a backend
    restart during market hours.  Called by session.set_session() automatically.
    Token is stored as-is (plaintext); the DB file should be kept private.
    """
    with db_cursor() as cur:
        cur.execute("UPDATE metadata SET value = ? WHERE key = 'session_token'",
                    (token or "",))
        cur.execute("UPDATE metadata SET value = ? WHERE key = 'session_expiry_date'",
                    (expiry_date or "",))


def load_persisted_session() -> dict:
    """
    Read token + expiry_date from the metadata table.
    Returns {"token": ..., "expiry_date": ...} with None values if not set.
    Called once at startup by main.py so the scheduler can resume immediately.
    """
    with db_cursor() as cur:
        cur.execute("SELECT key, value FROM metadata WHERE key IN ('session_token', 'session_expiry_date')")
        rows = {r["key"]: r["value"] for r in cur.fetchall()}
    return {
        "token":       rows.get("session_token")       or None,
        "expiry_date": rows.get("session_expiry_date") or None,
    }




def check_and_clear_for_url_change(new_url: str) -> bool:
    """If stored URL ≠ new_url, delete all snapshots and update URL. Returns True if cleared."""
    with db_cursor() as cur:
        cur.execute("SELECT value FROM metadata WHERE key = 'current_url'")
        row = cur.fetchone()
        current_url = row["value"] if row else ""

        if current_url and current_url != new_url:
            cur.execute("DELETE FROM snapshots")
            log_to_file(f"[URL CHECK] URL changed. Cleared snapshots.")
            cur.execute("UPDATE metadata SET value = ? WHERE key = 'current_url'", (new_url,))
            return True
        else:
            cur.execute("UPDATE metadata SET value = ? WHERE key = 'current_url'", (new_url,))
            return False


# ── Snapshot CRUD ─────────────────────────────────────────────────────────────

def save_snapshot(ind: dict, raw: dict) -> dict:
    """Insert a new snapshot row and return {id, timestamp, date}.

    Deduplication uses a MINUTE-BUCKET key (YYYY-MM-DDTHH:MM) rather than
    the exact UTC second.  This means:

    - If the scheduler fires at :01 instead of :00, it still de-dupes against
      a :00 row saved by the frontend for the same minute → no duplicate.
    - If the frontend polls at :30 and the scheduler fires at :00 of the same
      minute, only one row is kept → no gap, no duplicate.

    The stored `timestamp` still records the actual HH:MM:SS for the chart
    time axis — only the dedup *check* uses the minute prefix.
    """
    check_and_clear_old_data()

    now           = datetime.now(timezone.utc)
    ts_str        = now.strftime("%Y-%m-%dT%H:%M:%SZ")   # full precision stored
    minute_bucket = now.strftime("%Y-%m-%dT%H:%M")        # prefix used for dedup
    date_str      = now.strftime("%Y-%m-%d")

    with db_cursor() as cur:
        # De-duplicate on the minute bucket — covers jobs that fire a few seconds
        # late or frontend polls that arrive before/after the scheduler tick.
        cur.execute(
            "SELECT id, timestamp, date FROM snapshots WHERE timestamp LIKE ?",
            (minute_bucket + "%",)
        )
        existing = cur.fetchone()
        if existing:
            log_to_file(
                f"[DEDUP] Snapshot for minute {minute_bucket} already exists "
                f"(stored ts={existing['timestamp']}) — skipping insert"
            )
            return {
                "id": existing["id"],
                "timestamp": existing["timestamp"],
                "date": existing["date"],
                "already_existed": True,
            }

        cur.execute("""
            INSERT INTO snapshots (
                timestamp, date, underlying,
                total_ce_oi_value, total_pe_oi_value,
                total_ce_oi_value_2, total_pe_oi_value_2,
                total_ce_oi_change_value, total_pe_oi_change_value,
                total_ce_trade_value, total_pe_trade_value,
                diff_oi_value, ratio_oi_value,
                diff_oi_value_2, ratio_oi_value_2, diff_trade_value, test_value,
                ce_oi, pe_oi, ce_chg_oi, pe_chg_oi,
                ce_vol, pe_vol, nifty_price,
                fut_ltp, fut_atp, fut_oi, fut_volume,
                fut_total_buy_qty, fut_total_sell_qty,
                fut_oi_value_ltp, fut_oi_value_atp,
                fut_trade_val_ltp, fut_trade_val_atp,
                raw_json
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            ts_str, date_str, ind["underlying"],
            ind["total_ce_oi_value"], ind["total_pe_oi_value"],
            ind["total_ce_oi_value_2"], ind["total_pe_oi_value_2"],
            ind["total_ce_oi_change_value"], ind["total_pe_oi_change_value"],
            ind["total_ce_trade_value"], ind["total_pe_trade_value"],
            ind["diff_oi_value"], ind["ratio_oi_value"],
            ind["diff_oi_value_2"], ind["ratio_oi_value_2"], ind["diff_trade_value"],
            ind["test_value"],
            ind["ce_oi"], ind["pe_oi"], ind["ce_chg_oi"], ind["pe_chg_oi"],
            ind["ce_vol"], ind["pe_vol"], ind["nifty_price"],
            ind.get("fut_ltp", 0),            ind.get("fut_atp", 0),
            ind.get("fut_oi", 0),             ind.get("fut_volume", 0),
            ind.get("fut_total_buy_qty", 0),  ind.get("fut_total_sell_qty", 0),
            ind.get("fut_oi_value_ltp", 0),   ind.get("fut_oi_value_atp", 0),
            ind.get("fut_trade_val_ltp", 0),  ind.get("fut_trade_val_atp", 0),
            json.dumps(raw),
        ))
        row_id = cur.lastrowid

    log_data_point({
        "id": row_id, "timestamp": ts_str, "date": date_str,
        "underlying": ind["underlying"],
        "ce_oi": ind["ce_oi"], "pe_oi": ind["pe_oi"],
        "total_ce_oi_value": ind["total_ce_oi_value"],
        "total_pe_oi_value": ind["total_pe_oi_value"],
    })

    return {"id": row_id, "timestamp": ts_str, "date": date_str, "already_existed": False}


def get_latest_snapshot() -> dict | None:
    """FIX: Return the most recent snapshot row as a dict, or None if empty.
    Used by POST /api/process to return cached data without re-fetching Upstox
    when the scheduler already saved the current minute's data.
    """
    with db_cursor() as cur:
        cur.execute(
            f"SELECT {_INDICATOR_COLS} FROM snapshots ORDER BY timestamp DESC LIMIT 1"
        )
        row = cur.fetchone()
        return dict(row) if row else None


# ── Queries ───────────────────────────────────────────────────────────────────

_INDICATOR_COLS = """
    id, timestamp, date, underlying,
    total_ce_oi_value, total_pe_oi_value,
    total_ce_oi_value_2, total_pe_oi_value_2,
    total_ce_oi_change_value, total_pe_oi_change_value,
    total_ce_trade_value, total_pe_trade_value,
    diff_oi_value, ratio_oi_value, diff_oi_value_2, ratio_oi_value_2,
    diff_trade_value, test_value,
    ce_oi, pe_oi, ce_chg_oi, pe_chg_oi,
    ce_vol, pe_vol, nifty_price,
    fut_ltp, fut_atp, fut_oi, fut_volume,
    fut_total_buy_qty, fut_total_sell_qty,
    fut_oi_value_ltp, fut_oi_value_atp,
    fut_trade_val_ltp, fut_trade_val_atp
"""


def get_indicators_for_date(date_str: str = None) -> list[dict]:
    if not date_str:
        date_str = _today_ist()  # FIX: IST date
    with db_cursor() as cur:
        cur.execute(
            f"SELECT {_INDICATOR_COLS} FROM snapshots WHERE date = ? ORDER BY timestamp ASC",
            (date_str,)
        )
        return [dict(r) for r in cur.fetchall()]


def get_all_history() -> list[dict]:
    with db_cursor() as cur:
        cur.execute(f"""
            SELECT timestamp, nifty_price,
                   total_ce_oi_value, total_pe_oi_value,
                   total_ce_oi_value_2, total_pe_oi_value_2,
                   total_ce_oi_change_value, total_pe_oi_change_value,
                   total_ce_trade_value, total_pe_trade_value,
                   diff_oi_value, ratio_oi_value, diff_oi_value_2, ratio_oi_value_2,
                   diff_trade_value, test_value,
                   ce_oi, pe_oi, ce_chg_oi, pe_chg_oi, ce_vol, pe_vol,
                   fut_ltp, fut_atp, fut_oi, fut_volume,
                   fut_total_buy_qty, fut_total_sell_qty,
                   fut_oi_value_ltp, fut_oi_value_atp,
                   fut_trade_val_ltp, fut_trade_val_atp
            FROM snapshots ORDER BY timestamp ASC
        """)
        return [dict(r) for r in cur.fetchall()]


def get_snapshots_for_export(date_str: str = None) -> list[dict]:
    if not date_str:
        date_str = _today_ist()  # FIX: IST date
    with db_cursor() as cur:
        cur.execute("""
            SELECT timestamp, underlying, nifty_price,
                   total_ce_oi_value, total_pe_oi_value,
                   total_ce_oi_value_2, total_pe_oi_value_2,
                   total_ce_oi_change_value, total_pe_oi_change_value,
                   total_ce_trade_value, total_pe_trade_value,
                   diff_oi_value, ratio_oi_value, diff_oi_value_2, ratio_oi_value_2,
                   diff_trade_value, test_value,
                   ce_oi, pe_oi, ce_chg_oi, pe_chg_oi, ce_vol, pe_vol,
                   fut_ltp, fut_atp, fut_oi, fut_volume,
                   fut_total_buy_qty, fut_total_sell_qty,
                   fut_oi_value_ltp, fut_oi_value_atp,
                   fut_trade_val_ltp, fut_trade_val_atp
            FROM snapshots WHERE date = ? ORDER BY timestamp ASC
        """, (date_str,))
        return [dict(r) for r in cur.fetchall()]


# ── Custom Indicators CRUD ────────────────────────────────────────────────────

def list_custom_indicators() -> list[dict]:
    with db_cursor() as cur:
        cur.execute("SELECT id, name, formula, created_at FROM custom_indicators ORDER BY id ASC")
        return [dict(r) for r in cur.fetchall()]


def upsert_custom_indicator(name: str, formula: str) -> dict:
    with db_cursor() as cur:
        cur.execute("""
            INSERT INTO custom_indicators (name, formula)
            VALUES (?, ?)
            ON CONFLICT(name) DO UPDATE SET formula = excluded.formula
        """, (name.strip(), formula.strip()))
        cur.execute("SELECT id, name, formula FROM custom_indicators WHERE name = ?", (name.strip(),))
        return dict(cur.fetchone())


def delete_custom_indicator(ind_id: int) -> bool:
    with db_cursor() as cur:
        cur.execute("DELETE FROM custom_indicators WHERE id = ?", (ind_id,))
        return cur.rowcount > 0
