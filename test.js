import requests
import gzip
import json
    from datetime import datetime

ACCESS_TOKEN = "eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI3M0IyRlMiLCJqdGkiOiI2OWExOTFkN2U4MjI4MzM3NTVjY2IzZjAiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6dHJ1ZSwiaWF0IjoxNzcyMTk2MzExLCJpc3MiOiJ1ZGFwaS1nYXRld2F5LXNlcnZpY2UiLCJleHAiOjE3NzIyMjk2MDB9.zcr-GeaXAlD61GxfWpnyaIHY-oFFPORzzFoUJwpkQqU"

# Step 1: Download NSE_FO Instruments
url = "https://assets.upstox.com/market-quote/instruments/exchange/NSE_FO.json.gz"
response = requests.get(url)

# Unzip
data = gzip.decompress(response.content)
instruments = json.loads(data)

# Step 2: Filter NIFTY Monthly Futures
nifty_futures = []

for inst in instruments:
    if (
        inst["segment"] == "NSE_FO"
        and inst["instrument_type"] == "FUTIDX"
        and inst["underlying_symbol"] == "NIFTY"
        and inst["weekly"] == False
    ):
nifty_futures.append(inst)

# Step 3: Sort by Expiry(nearest first)
nifty_futures.sort(key = lambda x: x["expiry"])

current_nifty_future = nifty_futures[0]

instrument_key = current_nifty_future["instrument_key"]

print("Selected Contract:", current_nifty_future["trading_symbol"])
print("Instrument Key:", instrument_key)

# Step 4: Fetch Live Quote
quote_url = f"https://api.upstox.com/v2/market-quote/quotes?instrument_key={instrument_key}"

headers = {
    "Accept": "application/json",
    "Authorization": f"Bearer {ACCESS_TOKEN}"
}

quote_response = requests.get(quote_url, headers = headers)

print(quote_response.json())