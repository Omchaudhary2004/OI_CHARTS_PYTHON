# Nifty Option Chain Indicators Guide

## All Indicators with Formulas

### 0. Underlying (nifty_price)
- **Description**: Nifty spot value
- **Calculation**: Direct value from NSE API — no calculation needed
- **Unit**: Nifty Points
- **Example**: 25424.65

---

### 1. Total CE OI Value (total_ce_oi_value)
- **Description**: Total Open Interest value for all CE (Call) strikes
- **Formula**: 
  ```
  For each CE strike: (OpenInterest × 65) × LastPrice
  Then sum all strikes
  ```
- **Calculation in code**:
  ```javascript
  totalCEOIValue += (ce.openInterest * 65) * ce.lastPrice
  ```
- **Unit**: Rupees (value in thousands)

---

### 2. Total PE OI Value (total_pe_oi_value)
- **Description**: Total Open Interest value for all PE (Put) strikes
- **Formula**: 
  ```
  For each PE strike: (OpenInterest × 65) × LastPrice
  Then sum all strikes
  ```
- **Unit**: Rupees (value in thousands)

---

### 3. Total CE OI Change Value (total_ce_oi_change_value)
- **Description**: Change in OI value for all CE strikes
- **Formula**: 
  ```
  For each CE strike: (ChangeInOpenInterest × 65) × LastPrice
  Then sum all strikes
  ```
- **Unit**: Rupees (value in thousands)

---

### 4. Total PE OI Change Value (total_pe_oi_change_value)
- **Description**: Change in OI value for all PE strikes
- **Formula**: 
  ```
  For each PE strike: (ChangeInOpenInterest × 65) × LastPrice
  Then sum all strikes
  ```
- **Unit**: Rupees (value in thousands)

---

### 5. Total CE Trade Value (total_ce_trade_value)
- **Description**: Total Traded Volume value for all CE strikes
- **Formula**: 
  ```
  For each CE strike: (TotalTradedVolume × 65) × LastPrice
  Then sum all strikes
  ```
- **Unit**: Rupees (value in thousands)

---

### 6. Total PE Trade Value (total_pe_trade_value)
- **Description**: Total Traded Volume value for all PE strikes
- **Formula**: 
  ```
  For each PE strike: (TotalTradedVolume × 65) × LastPrice
  Then sum all strikes
  ```
- **Unit**: Rupees (value in thousands)

---

### 9. Diff OI Value (diff_oi_value)
- **Description**: Difference between CE and PE OI values
- **Formula**: 
  ```
  Total CE OI Value − Total PE OI Value
  ```
- **Unit**: Rupees (value in thousands)
- **Interpretation**: 
  - **Positive**: More CE activity than PE (Bullish bias)
  - **Negative**: More PE activity than CE (Bearish bias)
  - **Zero**: Balanced market

---

### 10. Ratio OI Value (ratio_oi_value)
- **Description**: Ratio of CE OI Value to PE OI Value
- **Formula**: 
  ```
  Total CE OI Value ÷ Total PE OI Value
  ```
- **Unit**: Ratio (dimensionless)
- **Interpretation**:
  - **> 1**: More CE activity (Bullish)
  - **= 1**: Balanced
  - **< 1**: More PE activity (Bearish)
  - **Example**: Ratio 1.5 = CE is 50% stronger than PE

---

### 11. Diff Trade Value (diff_trade_value)
- **Description**: Difference between CE and PE Trade values
- **Formula**: 
  ```
  Total CE Trade Value − Total PE Trade Value
  ```
- **Unit**: Rupees (value in thousands)

---

### 12. Test (test_value)
- **Description**: User-defined custom indicator field
- **Formula**: User input
- **Usage**: Users can add custom formulas using addition, subtraction, multiplication, or division of above indicators
- **Example Formulas**:
  - `diff_oi_value / 1000000` — Convert to millions
  - `total_ce_oi_value - total_pe_oi_value` — Manual diff calculation
  - `ratio_oi_value * 100` — Convert ratio to percentage

---

## Key Metrics

| Metric | Field Name | LOT_SIZE |
|--------|-----------|----------|
| Lot Size for Nifty Options | LOT_SIZE | 65 |

---

## Data Source Format

The app receives data from NSE API with this structure:

```json
{
  "records": {
    "timestamp": "24-Feb-2026 15:30:00",
    "underlyingValue": 25424.65,
    "data": [
      {
        "strikePrice": 23100,
        "expiryDates": "24-Feb-2026",
        "CE": {
          "openInterest": 24,
          "changeinOpenInterest": 18,
          "totalTradedVolume": 179,
          "lastPrice": 2303.65,
          "underlyingValue": 25424.65
        },
        "PE": {
          "openInterest": 47266,
          "changeinOpenInterest": -77647,
          "totalTradedVolume": 341601,
          "lastPrice": 0.05,
          "underlyingValue": 25424.65
        }
      }
    ]
  }
}
```

---

## How Calculations Work

1. **Raw Data**: For each strike in the option chain, we have CE and PE data
2. **Aggregation**: Sum all values across all strikes (multiplication by lot size happens per strike)
3. **Storage**: Results stored in SQLite database with timestamp
4. **Visualization**: Charts display these indicators over time
5. **Export**: Data can be exported to CSV with all indicators

---

## Notes

- All monetary values are in **Rupees**
- Lot size for Nifty options is **65**
- Data is collected every **60 seconds** (configurable)
- Timestamps are stored in UTC and converted to IST for display
- Empty values default to **0**

