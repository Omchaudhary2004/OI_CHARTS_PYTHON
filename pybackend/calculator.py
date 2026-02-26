"""
calculator.py – Option chain analytics formulas for the Upstox API format.

Upstox data structure per strike:
  data[i].call_options.market_data  →  { ltp, volume, oi, prev_oi, ... }
  data[i].put_options.market_data   →  { ltp, volume, oi, prev_oi, ... }

IMPORTANT: Upstox OI and Volume are already in number of CONTRACTS.
           DO NOT multiply by lot size.

Formulas:
  ce_oi_change  = call_options.market_data.oi  - call_options.market_data.prev_oi
  pe_oi_change  = put_options.market_data.oi   - put_options.market_data.prev_oi

  Total CE OI Value        = Σ (ce_oi  × ce_ltp)   across all strikes
  Total PE OI Value        = Σ (pe_oi  × pe_ltp)   across all strikes
  Total CE OI Change Value = Σ (ce_oi_change × ce_ltp)
  Total PE OI Change Value = Σ (pe_oi_change × pe_ltp)
  Total CE Trade Value     = Σ (ce_volume × ce_ltp)
  Total PE Trade Value     = Σ (pe_volume × pe_ltp)
  Diff OI Value            = Total CE OI Value − Total PE OI Value
  Ratio OI Value           = Total CE OI Value ÷ Total PE OI Value
  Diff Trade Value         = Total CE Trade Value − Total PE Trade Value
"""

from typing import Any


def _safe_float(val, default: float = 0.0) -> float:
    """Coerce a value to float; return default on failure."""
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def calculate_indicators(api_response: dict) -> dict:
    """
    Parse a full Upstox option-chain API response and return all indicators.

    Parameters
    ----------
    api_response : dict
        The entire JSON body returned by https://api.upstox.com/v2/option/chain

    Returns
    -------
    dict with keys:
        underlying, nifty_price,
        total_ce_oi_value, total_pe_oi_value,
        total_ce_oi_change_value, total_pe_oi_change_value,
        total_ce_trade_value, total_pe_trade_value,
        diff_oi_value, ratio_oi_value, diff_trade_value,
        test_value,
        ce_oi, pe_oi, ce_chg_oi, pe_chg_oi, ce_vol, pe_vol
    """
    if api_response.get("status") != "success":
        raise ValueError(f"Upstox API returned non-success status: {api_response.get('status')}")

    rows: list[dict] = api_response.get("data", [])
    if not isinstance(rows, list):
        raise ValueError("api_response['data'] is not a list")

    # ── Accumulators ──────────────────────────────────────────────────────────
    total_ce_oi_value        = 0.0
    total_pe_oi_value        = 0.0
    total_ce_oi_value_2      = 0.0
    total_pe_oi_value_2      = 0.0
    total_ce_oi_change_value = 0.0
    total_pe_oi_change_value = 0.0
    total_ce_trade_value     = 0.0
    total_pe_trade_value     = 0.0

    total_ce_oi    = 0.0
    total_pe_oi    = 0.0
    total_ce_chg   = 0.0
    total_pe_chg   = 0.0
    total_ce_vol   = 0.0
    total_pe_vol   = 0.0

    underlying     = 0.0

    for row in rows:
        # Underlying spot price – take from any row (all same)
        spot = _safe_float(row.get("underlying_spot_price", 0))
        if spot and not underlying:
            underlying = spot

        # ── CALL side ─────────────────────────────────────────────────────
        call_md: dict = row.get("call_options", {}).get("market_data", {})
        ce_oi      = _safe_float(call_md.get("oi", 0))
        ce_prev_oi = _safe_float(call_md.get("prev_oi", 0))
        ce_ltp     = _safe_float(call_md.get("ltp", 0))
        ce_vol     = _safe_float(call_md.get("volume", 0))

        # OI change = current OI − previous OI
        ce_oi_change = ce_oi - ce_prev_oi

        # Accumulate
        total_ce_oi   += ce_oi
        total_ce_chg  += ce_oi_change
        total_ce_vol  += ce_vol

        # Total CE OI Value        = Σ (ce_oi × ce_ltp)
        total_ce_oi_value        += ce_oi * ce_ltp
        
        # Total CE OI Value 2      = If " Volume > 0, Sum of CE OI x CE LTP, else 0"
        if ce_vol > 0:
            total_ce_oi_value_2  += ce_oi * ce_ltp

        # Total CE OI Change Value = Σ (ce_oi_change × ce_ltp)
        total_ce_oi_change_value += ce_oi_change * ce_ltp

        # Total CE Trade Value     = Σ (ce_volume × ce_ltp)
        total_ce_trade_value     += ce_vol * ce_ltp

        # ── PUT side ──────────────────────────────────────────────────────
        put_md: dict = row.get("put_options", {}).get("market_data", {})
        pe_oi      = _safe_float(put_md.get("oi", 0))
        pe_prev_oi = _safe_float(put_md.get("prev_oi", 0))
        pe_ltp     = _safe_float(put_md.get("ltp", 0))
        pe_vol     = _safe_float(put_md.get("volume", 0))

        pe_oi_change = pe_oi - pe_prev_oi

        total_pe_oi   += pe_oi
        total_pe_chg  += pe_oi_change
        total_pe_vol  += pe_vol

        # Total PE OI Value        = Σ (pe_oi × pe_ltp)
        total_pe_oi_value        += pe_oi * pe_ltp
        
        # Total PE OI Value 2      = If " Volume > 0, Sum of PE OI x PE LTP, else 0"
        if pe_vol > 0:
            total_pe_oi_value_2  += pe_oi * pe_ltp

        # Total PE OI Change Value = Σ (pe_oi_change × pe_ltp)
        total_pe_oi_change_value += pe_oi_change * pe_ltp

        # Total PE Trade Value     = Σ (pe_volume × pe_ltp)
        total_pe_trade_value     += pe_vol * pe_ltp

    # ── Derived indicators ────────────────────────────────────────────────────
    # Difference OI Value  = Total CE OI Value − Total PE OI Value
    diff_oi_value = total_ce_oi_value - total_pe_oi_value
    
    # Difference OI Value 2
    diff_oi_value_2 = total_ce_oi_value_2 - total_pe_oi_value_2

    # Ratio OI Value = Total CE OI Value ÷ Total PE OI Value
    ratio_oi_value = (
        total_ce_oi_value / total_pe_oi_value
        if total_pe_oi_value != 0 else 0.0
    )
    
    # Ratio OI Value 2
    ratio_oi_value_2 = (
        total_ce_oi_value_2 / total_pe_oi_value_2
        if total_pe_oi_value_2 != 0 else 0.0
    )

    # Difference Trade Value = Total CE Trade Value − Total PE Trade Value
    diff_trade_value = total_ce_trade_value - total_pe_trade_value

    return {
        "underlying":               underlying,
        "nifty_price":              underlying,
        "total_ce_oi_value":        total_ce_oi_value,
        "total_pe_oi_value":        total_pe_oi_value,
        "total_ce_oi_value_2":      total_ce_oi_value_2,
        "total_pe_oi_value_2":      total_pe_oi_value_2,
        "total_ce_oi_change_value": total_ce_oi_change_value,
        "total_pe_oi_change_value": total_pe_oi_change_value,
        "total_ce_trade_value":     total_ce_trade_value,
        "total_pe_trade_value":     total_pe_trade_value,
        "diff_oi_value":            diff_oi_value,
        "ratio_oi_value":           ratio_oi_value,
        "diff_oi_value_2":          diff_oi_value_2,
        "ratio_oi_value_2":         ratio_oi_value_2,
        "diff_trade_value":         diff_trade_value,
        "test_value":               0.0,   # user-defined custom formula slot
        "ce_oi":     total_ce_oi,
        "pe_oi":     total_pe_oi,
        "ce_chg_oi": total_ce_chg,
        "pe_chg_oi": total_pe_chg,
        "ce_vol":    total_ce_vol,
        "pe_vol":    total_pe_vol,
    }
