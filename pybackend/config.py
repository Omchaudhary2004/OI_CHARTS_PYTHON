"""
config.py – Central configuration for the Python backend.
Edit this file to change the access token, port, or other settings.
"""

import os
from dotenv import load_dotenv

load_dotenv()  # Load variables from .env file if it exists

# ── Server ────────────────────────────────────────────────────────────────────
PORT = int(os.getenv("PORT", 4000))

# ── Upstox Auth ───────────────────────────────────────────────────────────────
# Set your Upstox access token here OR put it in a .env file as UPSTOX_TOKEN=xxx
UPSTOX_ACCESS_TOKEN = os.getenv("UPSTOX_TOKEN", "")  # Replace "your_token_here"

# ── Database ──────────────────────────────────────────────────────────────────
import pathlib
BASE_DIR = pathlib.Path(__file__).parent
DB_PATH = BASE_DIR / "data.db"
LOGS_DIR = BASE_DIR / "logs"

# ── Polling ───────────────────────────────────────────────────────────────────
POLL_INTERVAL_SECONDS = 60    # Front-end polls every 60 s

# ── Upstox API ────────────────────────────────────────────────────────────────
UPSTOX_OPTION_CHAIN_URL = "https://api.upstox.com/v2/option/chain"
DEFAULT_INSTRUMENT_KEY  = "NSE_INDEX|Nifty 50"
