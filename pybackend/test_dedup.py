"""
test_dedup.py – Unit test: minute-bucket dedup in save_snapshot.

Run:
    cd "d:\\Nifty option chain\\AI\\pybackend"
    python test_dedup.py

Expected output:
    [PASS] Only 1 row for the same minute — duplicate correctly blocked.
    [PASS] Two different minutes → 2 rows saved.
    All tests passed.
"""

import json
import sqlite3
import sys
from datetime import datetime, timezone, timedelta

# ── Inline minimal versions of DB helpers ─────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    date      TEXT NOT NULL,
    underlying            REAL NOT NULL DEFAULT 0,
    total_ce_oi_value     REAL NOT NULL DEFAULT 0,
    total_pe_oi_value     REAL NOT NULL DEFAULT 0,
    total_ce_oi_value_2   REAL NOT NULL DEFAULT 0,
    total_pe_oi_value_2   REAL NOT NULL DEFAULT 0,
    total_ce_oi_change_value REAL NOT NULL DEFAULT 0,
    total_pe_oi_change_value REAL NOT NULL DEFAULT 0,
    total_ce_trade_value  REAL NOT NULL DEFAULT 0,
    total_pe_trade_value  REAL NOT NULL DEFAULT 0,
    diff_oi_value         REAL NOT NULL DEFAULT 0,
    ratio_oi_value        REAL NOT NULL DEFAULT 0,
    diff_oi_value_2       REAL NOT NULL DEFAULT 0,
    ratio_oi_value_2      REAL NOT NULL DEFAULT 0,
    diff_trade_value      REAL NOT NULL DEFAULT 0,
    test_value            REAL NOT NULL DEFAULT 0,
    ce_oi   REAL NOT NULL DEFAULT 0,
    pe_oi   REAL NOT NULL DEFAULT 0,
    ce_chg_oi REAL NOT NULL DEFAULT 0,
    pe_chg_oi REAL NOT NULL DEFAULT 0,
    ce_vol  REAL NOT NULL DEFAULT 0,
    pe_vol  REAL NOT NULL DEFAULT 0,
    nifty_price REAL NOT NULL DEFAULT 0,
    raw_json TEXT NOT NULL
)
"""

def _get_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute(SCHEMA)
    conn.commit()
    return conn


_ZERO_IND = {
    "underlying": 0, "nifty_price": 0,
    "total_ce_oi_value": 0, "total_pe_oi_value": 0,
    "total_ce_oi_value_2": 0, "total_pe_oi_value_2": 0,
    "total_ce_oi_change_value": 0, "total_pe_oi_change_value": 0,
    "total_ce_trade_value": 0, "total_pe_trade_value": 0,
    "diff_oi_value": 0, "ratio_oi_value": 0,
    "diff_oi_value_2": 0, "ratio_oi_value_2": 0,
    "diff_trade_value": 0, "test_value": 0,
    "ce_oi": 0, "pe_oi": 0, "ce_chg_oi": 0, "pe_chg_oi": 0,
    "ce_vol": 0, "pe_vol": 0,
}


def _insert(conn, ts_str: str, ind: dict = None):
    """Insert a snapshot using minute-bucket dedup. Returns (row_id, already_existed)."""
    ind = ind or _ZERO_IND
    minute_bucket = ts_str[:16]  # "YYYY-MM-DDTHH:MM"
    date_str = ts_str[:10]

    cur = conn.cursor()
    cur.execute(
        "SELECT id, timestamp FROM snapshots WHERE timestamp LIKE ?",
        (minute_bucket + "%",)
    )
    existing = cur.fetchone()
    if existing:
        conn.commit()
        return existing["id"], True

    cur.execute("""
        INSERT INTO snapshots (
            timestamp, date, underlying,
            total_ce_oi_value, total_pe_oi_value,
            total_ce_oi_value_2, total_pe_oi_value_2,
            total_ce_oi_change_value, total_pe_oi_change_value,
            total_ce_trade_value, total_pe_trade_value,
            diff_oi_value, ratio_oi_value,
            diff_oi_value_2, ratio_oi_value_2, diff_trade_value, test_value,
            ce_oi, pe_oi, ce_chg_oi, pe_chg_oi, ce_vol, pe_vol, nifty_price,
            raw_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
        json.dumps({}),
    ))
    conn.commit()
    return cur.lastrowid, False


def test_same_minute_dedup():
    """Scheduler fires at :00, frontend polls at :30 — only 1 row must exist."""
    conn = _get_conn()
    _insert(conn, "2026-02-27T04:15:00Z")   # scheduler
    _, existed = _insert(conn, "2026-02-27T04:15:30Z")  # frontend poll

    rows = conn.execute("SELECT COUNT(*) AS n FROM snapshots").fetchone()["n"]
    assert rows == 1, f"Expected 1 row, got {rows}"
    assert existed, "Second insert should have been blocked as duplicate"
    print("[PASS] Only 1 row for the same minute — duplicate correctly blocked.")
    conn.close()


def test_different_minutes_stored():
    """Two different minutes must each produce their own row."""
    conn = _get_conn()
    _, e1 = _insert(conn, "2026-02-27T04:15:00Z")
    _, e2 = _insert(conn, "2026-02-27T04:16:00Z")

    rows = conn.execute("SELECT COUNT(*) AS n FROM snapshots").fetchone()["n"]
    assert rows == 2, f"Expected 2 rows, got {rows}"
    assert not e1 and not e2, "Both different-minute inserts should succeed"
    print("[PASS] Two different minutes → 2 rows saved.")
    conn.close()


def test_late_scheduler_dedup():
    """Frontend saved at :00, scheduler fires late at :01 — still only 1 row."""
    conn = _get_conn()
    _insert(conn, "2026-02-27T04:20:00Z")   # frontend
    _, existed = _insert(conn, "2026-02-27T04:20:01Z")  # scheduler fires 1 s late

    rows = conn.execute("SELECT COUNT(*) AS n FROM snapshots").fetchone()["n"]
    assert rows == 1, f"Expected 1 row, got {rows}"
    assert existed, "Late scheduler should be blocked by minute-bucket dedup"
    print("[PASS] Scheduler firing 1 s late still blocked by minute-bucket dedup.")
    conn.close()


if __name__ == "__main__":
    test_same_minute_dedup()
    test_different_minutes_stored()
    test_late_scheduler_dedup()
    print("\nAll tests passed. ✓")
