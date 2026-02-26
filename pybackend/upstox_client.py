"""
upstox_client.py – Fetches the option chain from the Upstox v2 API.

The access token is read from config.UPSTOX_ACCESS_TOKEN (set it in .env).
The caller can override the token per-request by passing token= keyword arg.
"""

import requests
from config import UPSTOX_ACCESS_TOKEN
from logger import log_error, log_to_file


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

    resp = requests.get(url, params=params, headers=headers, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    log_to_file(f"[UPSTOX FETCH] status={data.get('status')} rows={len(data.get('data', []))}")
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
    resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()
    return resp.json()
