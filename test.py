import gzip
import json
import requests
from datetime import datetime

# ================= CONFIG =================
BOD_FILE = "NSE.json.gz"
ACCESS_TOKEN = "eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI3M0IyRlMiLCJqdGkiOiI2OWExOTFkN2U4MjI4MzM3NTVjY2IzZjAiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6dHJ1ZSwiaWF0IjoxNzcyMTk2MzExLCJpc3MiOiJ1ZGFwaS1nYXRld2F5LXNlcnZpY2UiLCJleHAiOjE3NzIyMjk2MDB9.zcr-GeaXAlD61GxfWpnyaIHY-oFFPORzzFoUJwpkQqU"
# ==========================================


def get_latest_nifty_future():
    with gzip.open(BOD_FILE, "rt", encoding="utf-8") as f:
        instruments = json.load(f)

    nifty_futures = []

    for inst in instruments:
        if (
            inst.get("segment") == "NSE_FO"
            and inst.get("instrument_type") == "FUT"
            and inst.get("underlying_type") == "INDEX"
            and inst.get("underlying_symbol") in ["NIFTY", "NIFTY50"]
        ):
            nifty_futures.append(inst)

    if not nifty_futures:
        raise Exception("No NIFTY futures found")

    # Sort by expiry (latest expiry last)
    nifty_futures.sort(key=lambda x: x["expiry"])
    return nifty_futures[-1]


def fetch_live_data(instrument_key):
    url = "https://api.upstox.com/v2/market-quote/quotes"

    headers = {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Accept": "application/json"
    }

    params = {
        "instrument_key": instrument_key
    }

    response = requests.get(url, headers=headers, params=params)

    if response.status_code != 200:
        raise Exception(f"API Error: {response.text}")

    return response.json()


def calculate_metrics(live):
    ltp = live["last_price"]
    atp = live["average_price"]
    oi = live["oi"]
    volume = live["volume"]
    total_buy_qty = live["total_buy_quantity"]
    total_sell_qty = live["total_sell_quantity"]

    future_oi_value_ltp = oi * ltp
    future_oi_value_atp = oi * atp
    future_trade_value_ltp = volume * ltp
    future_trade_value_atp = volume * atp

    return {
        "LTP": ltp,
        "ATP": atp,
        "OI": oi,
        "Volume": volume,
        "Total_Bid_Qty": total_buy_qty,
        "Total_Ask_Qty": total_sell_qty,
        "Future_OI_Value_LTP": future_oi_value_ltp,
        "Future_OI_Value_ATP": future_oi_value_atp,
        "Future_Trade_Value_LTP": future_trade_value_ltp,
        "Future_Trade_Value_ATP": future_trade_value_atp,
    }


def to_crore(value):
    return round(value / 1e7, 2)


# ================= RUN =================

contract = get_latest_nifty_future()

print("\n===== SELECTED CONTRACT =====")
print("Trading Symbol:", contract["trading_symbol"])
print("Instrument Key:", contract["instrument_key"])
print("Expiry:", datetime.fromtimestamp(contract["expiry"] / 1000))
print("Lot Size:", contract["lot_size"])

live_response = fetch_live_data(contract["instrument_key"])

symbol_key = list(live_response["data"].keys())[0]
live_data = live_response["data"][symbol_key]

metrics = calculate_metrics(live_data)

print("\n===== LIVE DATA =====")
print("LTP:", metrics["LTP"])
print("ATP (VWAP):", metrics["ATP"])
print("OI:", metrics["OI"])
print("Volume:", metrics["Volume"])
print("Total Bid Qty:", metrics["Total_Bid_Qty"])
print("Total Ask Qty:", metrics["Total_Ask_Qty"])

print("\n===== CALCULATED VALUES =====")
print("Future OI Value (LTP):", to_crore(metrics["Future_OI_Value_LTP"]), "Cr")
print("Future OI Value (ATP):", to_crore(metrics["Future_OI_Value_ATP"]), "Cr")
print("Future Trade Value (LTP):", to_crore(metrics["Future_Trade_Value_LTP"]), "Cr")
print("Future Trade Value (ATP):", to_crore(metrics["Future_Trade_Value_ATP"]), "Cr")