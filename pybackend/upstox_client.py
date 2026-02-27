"""
upstox_client.py – Fetches the option chain and Nifty futures quote from the Upstox v2 API.

The access token is read from config.UPSTOX_ACCESS_TOKEN (set it in .env).
The caller can override the token per-request by passing token= keyword arg.

Raises RetryableError (subclass of Exception) for HTTP 429/503 so that
fetch_with_retry in main.py can honour the Retry-After header.
"""

import gzip
import json
import os
import requests
from datetime import datetime
from config import UPSTOX_ACCESS_TOKEN
from logger import log_error, log_to_file

# Path to Upstox BOD master file — drop NSE.json.gz inside the put_here/ folder
_BOD_FILE = os.path.join(os.path.dirname(__file__), "..", "put_here", "NSE.json.gz")


def get_current_nifty_future() -> dict:
    """
    Read the BOD (Beginning-of-Day) instrument master file and return
    the nearest-expiry Nifty Futures contract.

    Returns a dict with:
        instrument_key, trading_symbol, expiry (datetime), lot_size

    Raises
    ------
    FileNotFoundError  if NSE_FO.json.gz is not present in the backend dir
    Exception          if no active NIFTY futures are found
    """
    if not os.path.exists(_BOD_FILE):
        raise FileNotFoundError(
            f"BOD file not found: {_BOD_FILE}\n"
            "Download it from: https://assets.upstox.com/market-quote/instruments/exchange/NSE_FO.json.gz"
        )

    with gzip.open(_BOD_FILE, "rt", encoding="utf-8") as f:
        instruments = json.load(f)

    now_ms = datetime.now().timestamp() * 1000  # expiry is in milliseconds

    nifty_futures = [
        inst for inst in instruments
        if (
            inst.get("segment") == "NSE_FO"
            and inst.get("instrument_type") == "FUT"
            and inst.get("underlying_type") == "INDEX"
            and inst.get("underlying_symbol") in ("NIFTY", "NIFTY50")
            and inst.get("expiry", 0) > now_ms
        )
    ]

    if not nifty_futures:
        raise Exception("No active NIFTY futures found in BOD file")

    nifty_futures.sort(key=lambda x: x["expiry"])
    c = nifty_futures[0]
    return {
        "instrument_key": c["instrument_key"],
        "trading_symbol": c["trading_symbol"],
        "expiry":         datetime.fromtimestamp(c["expiry"] / 1000),
        "lot_size":       c.get("lot_size", 75),
    }


class RetryableError(Exception):
    """
    Raised for transient HTTP errors (429, 503) so the caller can detect
    them and sleep for the right amount before retrying.

    Attributes
    ----------
    retry_after : int   seconds to wait before next attempt (default 10)
    """
    def __init__(self, message: str, retry_after: int = 10):
        super().__init__(message)
        self.retry_after = retry_after


def fetch_option_chain(
    instrument_key: str,
    expiry_date: str,
    token: str = None,
) -> dict:
    """
    Fetch live option chain data from Upstox.

    Parameters
    ----------
    instrument_key : str   e.g. 'NSE_INDEX|Nifty 50'
    expiry_date    : str   e.g. '2025-03-27'
    token          : str   Bearer token. Falls back to config.UPSTOX_ACCESS_TOKEN

    Returns
    -------
    dict  – the full JSON response body

    Raises
    ------
    RetryableError   for HTTP 429 / 503  (caller should retry after .retry_after s)
    requests.HTTPError  for other 4xx/5xx
    ValueError       if Upstox returns status != 'success'
    """
    access_token = token or UPSTOX_ACCESS_TOKEN
    if not access_token:
        raise ValueError(
            "Upstox access token is not set. "
            "Either set UPSTOX_TOKEN in your .env file or pass token= to this function."
        )

    url = "https://api.upstox.com/v2/option/chain"
    params  = {"instrument_key": instrument_key, "expiry_date": expiry_date}
    headers = {
        "Content-Type":  "application/json",
        "Accept":        "application/json",
        "Authorization": f"Bearer {access_token}",
    }

    log_to_file(f"[UPSTOX FETCH] instrument={instrument_key} expiry={expiry_date}")

    resp = requests.get(url, params=params, headers=headers, timeout=20)  # raised from 15→20 s

    # Handle rate-limit / temporary unavailability before raise_for_status
    if resp.status_code in (429, 503):
        retry_after = int(resp.headers.get("Retry-After", 10))
        msg = f"HTTP {resp.status_code} from Upstox — retry after {retry_after}s"
        log_to_file(f"[UPSTOX FETCH] {msg}")
        raise RetryableError(msg, retry_after=retry_after)

    resp.raise_for_status()
    data = resp.json()

    status = data.get("status")
    log_to_file(f"[UPSTOX FETCH] status={status} rows={len(data.get('data', []))}")

    if status != "success":
        raise ValueError(f"Upstox API returned non-success status: {status}")

    return data


def fetch_nifty_future_quote(
    instrument_key: str,
    token: str = None,
) -> dict:
    """
    Fetch a live market quote for a Nifty futures contract using
    the Upstox market-quote endpoint.

    Parameters
    ----------
    instrument_key : str   e.g. 'NSE_FO|57886'
    token          : str   Bearer token (falls back to config)

    Returns a dict with raw fields:
        ltp, atp (average/vwap), oi, volume,
        total_buy_quantity, total_sell_quantity

    Raises
    ------
    RetryableError      for HTTP 429 / 503
    requests.HTTPError  for other 4xx/5xx
    ValueError          if Upstox returns status != 'success'
    """
    access_token = token or UPSTOX_ACCESS_TOKEN
    if not access_token:
        raise ValueError(
            "Upstox access token is not set. "
            "Pass token= or set UPSTOX_TOKEN in your .env file."
        )

    url = "https://api.upstox.com/v2/market-quote/quotes"
    # URL-encode the pipe character in the instrument key
    params  = {"instrument_key": instrument_key}
    headers = {
        "Content-Type":  "application/json",
        "Accept":        "application/json",
        "Authorization": f"Bearer {access_token}",
    }

    log_to_file(f"[FUTURE QUOTE] Fetching quote for {instrument_key}")

    resp = requests.get(url, params=params, headers=headers, timeout=20)

    if resp.status_code in (429, 503):
        retry_after = int(resp.headers.get("Retry-After", 10))
        msg = f"HTTP {resp.status_code} from Upstox (future quote) — retry after {retry_after}s"
        log_to_file(f"[FUTURE QUOTE] {msg}")
        raise RetryableError(msg, retry_after=retry_after)

    resp.raise_for_status()
    data = resp.json()

    if data.get("status") != "success":
        raise ValueError(f"Upstox future-quote API returned: {data.get('status')}")

    # The response data dict is keyed by e.g. "NSE_FO:NIFTY25JANFUT"
    quote_data: dict = data.get("data", {})
    if not quote_data:
        raise ValueError("No data in Upstox future-quote response")

    # Take the first (and only) symbol entry
    symbol_data = next(iter(quote_data.values()))

    ltp    = float(symbol_data.get("last_price", 0) or 0)
    atp    = float(symbol_data.get("average_price", 0) or 0)  # VWAP / ATP
    oi     = float(symbol_data.get("oi", 0) or 0)
    volume = float(symbol_data.get("volume", 0) or 0)
    total_buy_qty  = float(symbol_data.get("total_buy_quantity",  0) or 0)
    total_sell_qty = float(symbol_data.get("total_sell_quantity", 0) or 0)

    log_to_file(
        f"[FUTURE QUOTE] ltp={ltp} atp={atp} oi={oi} vol={volume} "
        f"buy_qty={total_buy_qty} sell_qty={total_sell_qty}"
    )

    return {
        "ltp":            ltp,
        "atp":            atp,
        "oi":             oi,
        "volume":         volume,
        "total_buy_qty":  total_buy_qty,
        "total_sell_qty": total_sell_qty,
    }


def fetch_from_generic_url(url: str, token: str = None) -> dict:
    """
    Generic GET to any URL with optional Bearer auth.
    Used when the frontend passes a raw URL (e.g., a proxy or mock server).
    """
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 OptionChainDashboard/1.0",
    }
    if token or UPSTOX_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {token or UPSTOX_ACCESS_TOKEN}"

    log_to_file(f"[GENERIC FETCH] {url[:100]}")
    resp = requests.get(url, headers=headers, timeout=20)
    resp.raise_for_status()
    return resp.json()
