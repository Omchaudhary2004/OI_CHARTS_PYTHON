# Excel Formulas for Nifty Option Chain Indicators

## CSV Export Headers
When you export data from the app, you'll get a CSV file with these columns:

```
timestamp_IST,underlying,nifty_price,total_ce_oi_value,total_pe_oi_value,total_ce_oi_change_value,total_pe_oi_change_value,total_ce_trade_value,total_pe_trade_value,diff_oi_value,ratio_oi_value,diff_trade_value,test_value,ce_oi,pe_oi,ce_chg_oi,pe_chg_oi,ce_vol,pe_vol
```

## Excel Setup Instructions

### Column Headers (Row 1)
Create these column headers:

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P | Q | R | S |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Timestamp | Underlying | Nifty | Total CE OI Val | Total PE OI Val | CE OI Chg Val | PE OI Chg Val | CE Trade Val | PE Trade Val | Diff OI Val | Ratio OI Val | Diff Trade Val | Test | CE OI | PE OI | CE Chg OI | PE Chg OI | CE Vol | PE Vol |

### Sample Data (Row 2 onwards)
After importing CSV, your data will look like:

```
24-02-2026 15:30 IST | 25424.65 | 25424.65 | 51234567890 | 48765432100 | 1234567 | -987654 | 567891234 | 456781234 | 2469135790 | 1.051 | 111110000 | 0 | 2000000 | 1900000 | 18000 | -7700 | 179000 | 341601
```

## If You Want to Calculate Manually in Excel

### Formulas to Create Indicators from Raw Data

If you're working with raw NSE data in Excel, here's how to calculate each indicator:

**Assuming raw data is in columns: Strike, CE_OI, CE_LastPrice, PE_OI, PE_LastPrice, etc.**

#### 1. Total CE OI Value
```excel
=SUMPRODUCT(CE_OI:CE_OI * 65 * CE_LastPrice:CE_LastPrice)
```
Or for specific range:
```excel
=SUM(A2:A100 * 65 * B2:B100)
```

#### 2. Total PE OI Value
```excel
=SUMPRODUCT(PE_OI:PE_OI * 65 * PE_LastPrice:PE_LastPrice)
```

#### 3. Total CE OI Change Value
```excel
=SUMPRODUCT(CE_ChangeOI:CE_ChangeOI * 65 * CE_LastPrice:CE_LastPrice)
```

#### 4. Total PE OI Change Value
```excel
=SUMPRODUCT(PE_ChangeOI:PE_ChangeOI * 65 * PE_LastPrice:PE_LastPrice)
```

#### 5. Total CE Trade Value
```excel
=SUMPRODUCT(CE_Volume:CE_Volume * 65 * CE_LastPrice:CE_LastPrice)
```

#### 6. Total PE Trade Value
```excel
=SUMPRODUCT(PE_Volume:PE_Volume * 65 * PE_LastPrice:PE_LastPrice)
```

#### 9. Diff OI Value
```excel
=D2-E2
```
(Where D2 = Total CE OI Value, E2 = Total PE OI Value)

#### 10. Ratio OI Value
```excel
=D2/E2
```
(Where D2 = Total CE OI Value, E2 = Total PE OI Value, handles division by zero with IFERROR)

Better formula with error handling:
```excel
=IFERROR(D2/E2, 0)
```

#### 11. Diff Trade Value
```excel
=H2-I2
```
(Where H2 = Total CE Trade Value, I2 = Total PE Trade Value)

### Custom Calculations in Column M (Test)

You can add any custom calculation:

**Example 1**: Convert Diff to Millions
```excel
=J2/1000000
```

**Example 2**: Percentage Change in OI
```excel
=(F2-G2)/(ABS(G2)+1)*100
```

**Example 3**: PE Call Ratio
```excel
=IFERROR(D2/(D2+E2), 0)
```
(Shows what % of total value is in CE)

**Example 4**: Momentum
```excel
=(H2-I2)/(ABS(H2)+ABS(I2)+1)
```
(Shows weighted momentum between CE and PE trades)

---

## Chart Examples in Excel

### 1. Two-Series Chart (CE vs PE)
- X-axis: Timestamp
- Y-axis (Left): Total CE OI Value (Column D)
- Y-axis (Right): Total PE OI Value (Column E)
- This shows the battle between calls and puts over time

### 2. Diff OI Value Trend
- X-axis: Timestamp
- Y-axis: Diff OI Value (Column J)
- Shows positive = bullish, negative = bearish

### 3. Ratio OI Value
- X-axis: Timestamp
- Y-axis: Ratio OI Value (Column K)
- Shows 1.0 line for reference (balanced market)
- Above 1.0 = Bullish, Below 1.0 = Bearish

### 4. All Indicators (Stacked Area)
- Can create a dashboard showing all key indicators together

---

## Tips for Excel

1. **Copy-Paste Data**: Export CSV from app → Open in Excel → Save as .xlsx
2. **Use Absolute References**: When copying formulas down, use `$` for fixed row references
3. **Conditional Formatting**: 
   - Highlight Diff OI when positive (green) or negative (red)
   - Highlight Ratio OI when > 1.0 (green) or < 1.0 (red)
4. **Data Validation**: Add drop-down menus to select which strike data to analyze
5. **Pivot Tables**: Summarize data by expiry date or time of day
6. **Macros**: Automate pulling latest CSV and updating formulas daily

---

## Sample Excel Layout

```
Row 1: [Headers as shown above]
Row 2: 24-Feb-2026 15:30 IST | 25424.65 | 25424.65 | [=SUMPRODUCT formula] | ...
Row 3: 24-Feb-2026 15:31 IST | 25425.10 | 25425.10 | [=SUMPRODUCT formula] | ...
Row 4: 24-Feb-2026 15:32 IST | 25424.80 | 25424.80 | [=SUMPRODUCT formula] | ...
...
```

Copy the formula in D2 down to D1000, E2 to E1000, etc.

---

## Automation Tips

### Python Script to Auto-Update Excel
```python
import pandas as pd
from datetime import date

# Read CSV from app
df = pd.read_csv(f'indicators-{date.today()}.csv')

# Load Excel workbook
from openpyxl import load_workbook
wb = load_workbook('my_indicators.xlsx')
ws = wb.active

# Clear old data
for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
    for cell in row:
        cell.value = None

# Write new data
for r_idx, row in enumerate(df.values, 2):
    for c_idx, value in enumerate(row, 1):
        ws.cell(r_idx, c_idx, value)

wb.save('my_indicators.xlsx')
```

---

## Notes

- When importing CSV, ensure timestamp column is formatted as Text or custom format
- Lot size is **65** for all Nifty option calculations
- All monetary values are in **Rupees**
- Use IFERROR() to handle division by zero when PE value is 0
- Charts update automatically if you use structured references or named ranges

