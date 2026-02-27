"""
upstox_client.py – Fetches the option chain from the Upstox v2 API.

The access token is read from config.UPSTOX_ACCESS_TOKEN (set it in .env).
The caller can override the token per-request by passing token= keyword arg.

Raises RetryableError (subclass of Exception) for HTTP 429/503 so that
fetch_with_retry in main.py can honour the Retry-After header.
"""

import requests
from config import UPSTOX_ACCESS_TOKEN
from logger import log_error, log_to_file


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
