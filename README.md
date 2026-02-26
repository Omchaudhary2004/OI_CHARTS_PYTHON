# OI Charts — Project README

## What This App Does

Fetches live NSE Nifty 50 option chain data from Upstox every minute, calculates open-interest indicators, stores them in SQLite, and plots them as real-time charts in the browser.

---

## Project Structure

```
AI/
├── start.bat                  ← One-click launcher (Start / Stop)
├── frontent/                  ← React frontend (Vite, port 5173)
│   └── src/
│       └── App.jsx            ← All frontend logic: polling, charts, UI
└── pybackend/                 ← Python backend (Flask, port 4000)
    ├── main.py                ← App entry point + APScheduler
    ├── session.py             ← Global token/expiry state (shared with scheduler)
    ├── config.py              ← Env vars (PORT, DB_PATH, UPSTOX_TOKEN)
    ├── database.py            ← SQLite helpers (init, save, query, dedup)
    ├── calculator.py          ← Indicator formulas (CE OI, PE OI, Diff, Ratio…)
    ├── upstox_client.py       ← Upstox API HTTP calls
    ├── logger.py              ← File + console logging
    ├── requirements.txt       ← Python dependencies
    └── routes/
        ├── __init__.py        ← Registers all blueprints
        ├── connect.py         ← POST /api/connect
        ├── process.py         ← POST /api/process
        ├── history.py         ← GET  /api/history
        ├── export.py          ← GET  /api/export
        └── custom_indicators.py ← CRUD /api/custom-indicators
```

---

## How to Start

```
Double-click start.bat → press 1
```

This will:
1. Check `.venv` exists (shows setup instructions if not)
2. Kill any orphaned python/node on ports 4000/5173
3. Open `BACKEND` terminal → auto-restarts Python on crash
4. Open `FRONTEND` terminal → `npm install && npm run dev`
5. Open browser at `http://localhost:5173`

---

## Complete Data Flow

```
┌─────────────────────────────────────────────────┐
│                 UPSTOX  API                     │
│  GET /option-chain?instrument=NSE_INDEX|Nifty50 │
└───────────────────┬─────────────────────────────┘
                    │ Bearer token (from user)
                    ▼
┌─────────────────────────────────────────────────┐
│           PYTHON BACKEND  (port 4000)           │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │   APScheduler (BackgroundScheduler)     │   │
│  │   CronTrigger(second=0)                 │   │
│  │   → fires at 9:15:00, 9:16:00, …       │   │
│  │   → reads token from session.py        │   │
│  │   → calls upstox_client.py             │   │
│  │   → calls calculator.py               │   │
│  │   → calls database.save_snapshot()    │   │
│  └────────────────────┬────────────────────┘   │
│                       │                         │
│  ┌────────────────────▼────────────────────┐   │
│  │   SQLite DB  (data.db)                  │   │
│  │   Table: snapshots                      │   │
│  │   1 row per minute, timestamp=YYYY-…Z   │   │
│  │   Columns: timestamp, nifty_price,      │   │
│  │   total_ce_oi_value, total_pe_oi_value, │   │
│  │   diff_oi_value, ratio_oi_value, …      │   │
│  └────────────────────┬────────────────────┘   │
│                       │                         │
│  POST /api/process    │  GET /api/history        │
│  (frontend poll)      │  (on connect/reconnect) │
└───────────────────────┼─────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│           REACT FRONTEND  (port 5173)           │
│                                                 │
│  schedulePoll()  ──→  fires at next :00 second  │
│  │                                              │
│  └─→ POST /api/process                          │
│       ├─ backend checks: scheduler saved yet?   │
│       │   YES → return cached DB row (no Upstox)│
│       │   NO  → fetch Upstox → save → return    │
│       └─→ setPoints([...prev, newPoint])        │
│            → dedup: skip if timestamp matches   │
│                                                 │
│  buildSeriesData(points)                        │
│  → converts flat points[] to lightweight-charts │
│     time/value pairs, splitting on >2min gaps   │
│                                                 │
│  useDualPaneChart()                             │
│  → renders Pane 1 (indicator 1)                 │
│  → renders Pane 2 (indicator 2, optional)       │
│  → crosshair shows live value at cursor         │
└─────────────────────────────────────────────────┘
```

---

## Minute Polling — How It's Aligned

```
Clock: 09:15:58   User clicks Connect
         ↓
  fetchHistory()  → loads all today's DB rows into chart immediately
         ↓
  schedulePoll()  → calculates ms to next :00
                    = 60,000 - (Date.now() % 60,000)
                    = 60,000 - 58,000 = 2,000ms

Clock: 09:16:00   → poll fires (exactly at :00)
Clock: 09:17:00   → poll fires
Clock: 09:18:00   → poll fires  ...and so on
```

If a poll **fails** (Upstox error):
- Retries once after 10 seconds within same minute window
- Backend itself retries 3× with exponential backoff (1s → 2s → 4s)
- If backend was offline, `GET /api/history` reloads all missed minutes on recovery

If **browser tab is closed**:
- APScheduler in Python **keeps running** — data saved to DB every minute
- When user reopens tab and clicks Connect, `fetchHistory()` fills all missed bars from DB

---

## Indicator Formulas

| Indicator | Formula |
|---|---|
| Nifty Price | Underlying value from Upstox |
| Total CE OI Value | Σ (CE Open Interest × Strike Price) |
| Total PE OI Value | Σ (PE Open Interest × Strike Price) |
| Total CE OI Value 2 | Σ (CE Open Interest × Last Price) |
| Total PE OI Value 2 | Σ (PE Open Interest × Last Price) |
| CE OI Change Value | Σ (CE Change in OI × Strike Price) |
| PE OI Change Value | Σ (PE Change in OI × Strike Price) |
| CE Trade Value | Σ (CE Volume × Last Price) |
| PE Trade Value | Σ (PE Volume × Last Price) |
| Diff OI Value | Total CE OI Value − Total PE OI Value |
| Ratio OI Value | Total CE OI Value ÷ Total PE OI Value |
| Diff OI Value 2 | Total CE OI Value 2 − Total PE OI Value 2 |
| Ratio OI Value 2 | Total CE OI Value 2 ÷ Total PE OI Value 2 |
| Diff Trade Value | CE Trade Value − PE Trade Value |

Custom indicators: user-defined formula using any column name above (e.g. `total_ce_oi_value / total_pe_oi_value * 100`).

---

## API Endpoints

| Method | Endpoint | What it does |
|---|---|---|
| GET | `/health` | Returns `{status: "ok"}` — used by frontend health check |
| POST | `/api/connect` | Updates session (token + expiry), clears DB if source changed |
| POST | `/api/process` | Returns this minute's data (from DB cache or fresh Upstox fetch) |
| GET | `/api/history` | Returns all today's snapshots as JSON array |
| GET | `/api/export` | Returns today's data as CSV download |
| GET + POST + DELETE | `/api/custom-indicators` | CRUD for user-defined indicator formulas |

---

## Error Handling & Resilience

| Problem | How it's handled |
|---|---|
| Backend crash | `start.bat :pyloop` — auto-restarts in 3 seconds |
| Port 4000 occupied | `start.bat` kills PID on port 4000 before starting |
| Upstox API error | `fetch_with_retry()` — 3 retries with 1s/2s/4s backoff |
| Frontend poll fails | `schedulePoll()` retries once after 10s in same minute |
| Browser tab closed | APScheduler saves independently — history loads on return |
| Browser tab throttled | `visibilitychange` listener — immediate catch-up poll on tab focus |
| Backend offline >60s | Health check every 30s — shows banner, reloads history on recovery |
| Token expired | Yellow warning banner next morning comparing localStorage date |
| Wrong date format | Inline validation error in connect modal (rejects non-YYYY-MM-DD) |
| Duplicate data | DB dedup in `save_snapshot()` + frontend timestamp comparison |
| DB wipes at wrong time | IST date used for daily-clear check (not UTC) |

---

## Important Notes

- **Keep the BACKEND terminal open** — APScheduler lives in the Python process. Closing the terminal kills the scheduler.
- **Upstox token expires daily** — get a new token every morning from Upstox developer console.
- **Market hours only** — data is only meaningful during NSE trading hours (9:15 AM – 3:30 PM IST).
- **DB auto-clears daily** — SQLite data is wiped automatically when the IST date changes (after 12:00 AM IST).
