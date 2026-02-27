import gzip, json
from datetime import datetime

with gzip.open('pybackend/NSE.json.gz', 'rt', encoding='utf-8') as f:
    instruments = json.load(f)

now_ms = datetime.now().timestamp() * 1000
futures = [i for i in instruments
           if i.get('segment') == 'NSE_FO'
           and i.get('instrument_type') == 'FUT'
           and i.get('underlying_type') == 'INDEX'
           and i.get('underlying_symbol') in ('NIFTY', 'NIFTY50')]

print(f"Total NIFTY futures in file: {len(futures)}")
for inst in sorted(futures, key=lambda x: x['expiry']):
    exp = datetime.fromtimestamp(inst['expiry'] / 1000)
    is_upcoming = inst['expiry'] > now_ms
    print(f"  {inst['trading_symbol']:35} expiry={exp}  upcoming={is_upcoming}  key={inst['instrument_key']}")

upcoming = [i for i in futures if i['expiry'] > now_ms]
upcoming.sort(key=lambda x: x['expiry'])
if upcoming:
    print(f"\nBackend picks (nearest upcoming): {upcoming[0]['trading_symbol']} | {upcoming[0]['instrument_key']}")
else:
    print("\nWARNING: No upcoming futures! All expired. Backend will skip futures.")
