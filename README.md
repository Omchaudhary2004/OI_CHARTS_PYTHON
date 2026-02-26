# Nifty Option Chain Analyzer

A real-time visualization tool for analyzing NIFTY option chain data with 12 advanced technical indicators. Monitor call-put dynamics, volume flows, and market sentiment through interactive charts.

## 🎯 Features

- **Real-time Data**: Auto-updates every 60 seconds from NSE API
- **12 Built-in Indicators**: Pre-calculated formulas for quick analysis
- **Custom Indicators**: Create your own formulas using base variables
- **Dual Chart View**: Compare two indicators side-by-side with synchronized zoom
- **CSV Export**: Download all data for Excel analysis
- **Database Storage**: Persistent data with automatic cleanup for new trading days

---

## 📊 Indicators

All indicators are calculated with **Lot Size = 65** (Standard for NIFTY options).

### Core Indicators

| # | Name | Formula | Interpretation |
|---|------|---------|---|
| 0 | **Underlying** | Direct NIFTY spot price | Current market level |
| 1 | **Total CE OI Value** | Σ(CE OI × 65 × LastPrice) | Call option value at all strikes |
| 2 | **Total PE OI Value** | Σ(PE OI × 65 × LastPrice) | Put option value at all strikes |
| 3 | **Total CE OI Change** | Σ(CE ΔOI × 65 × LastPrice) | Fresh call OI buildup/unwinding |
| 4 | **Total PE OI Change** | Σ(PE ΔOI × 65 × LastPrice) | Fresh put OI buildup/unwinding |
| 5 | **Total CE Trade Value** | Σ(CE Volume × 65 × LastPrice) | Call side trading activity |
| 6 | **Total PE Trade Value** | Σ(PE Volume × 65 × LastPrice) | Put side trading activity |
| 9 | **Diff OI Value** | CE OI Value - PE OI Value | **> 0: Bullish, < 0: Bearish** |
| 10 | **Ratio OI Value** | CE OI Value ÷ PE OI Value | **> 1.0: Bullish, < 1.0: Bearish** |
| 11 | **Diff Trade Value** | CE Trade Value - PE Trade Value | Volume-weighted market bias |
| 12 | **Test** | User-defined formula | Custom combinations of above |

### Formula Details

Each indicator aggregates data **across all strike prices** for the current expiry:

```
Total CE OI Value = Σ for each strike: (openInterest × 65) × lastPrice
Total PE OI Value = Σ for each strike: (openInterest × 65) × lastPrice

Total CE OI Change = Σ for each strike: (changeinOpenInterest × 65) × lastPrice
Total PE OI Change = Σ for each strike: (changeinOpenInterest × 65) × lastPrice

Total CE Trade Value = Σ for each strike: (totalTradedVolume × 65) × lastPrice
Total PE Trade Value = Σ for each strike: (totalTradedVolume × 65) × lastPrice

Diff OI Value = Total CE OI Value - Total PE OI Value
Ratio OI Value = Total CE OI Value / Total PE OI Value (handle division by zero)
Diff Trade Value = Total CE Trade Value - Total PE Trade Value
```

---

## 🚀 Quick Start

### Requirements
- Node.js 18+ and npm
- SQLite3 (included with most systems)
- NSE Option Chain API URL

### Installation

```bash
# Clone repository
git clone <repo-url>
cd nifty-option-chain

# Install dependencies
cd backend && npm install
cd ../frontent && npm install
```

### Running

**Terminal 1 - Backend (Port 4000)**
```bash
cd backend
node index.js
# Output: ✓ Snapshots table ready
#         ✓ Custom indicators table ready
#         Server running on port 4000
```

**Terminal 2 - Frontend (Port 5173)**
```bash
cd frontent
npm run dev
# Opens http://localhost:5173
```

### First Use

1. Open browser to `http://localhost:5173`
2. Paste NSE option chain API URL (looks like: `https://www.nseindia.com/api/option-chain-v3?...`)
3. Click **Connect** → Auto-polls every 60 seconds
4. Select indicators in **Pane 1** and **Pane 2** dropdowns
5. Use 🔍+/− to zoom, **Reset** to fit data

---

## 📈 How to Use

### View Indicators

1. **Pane 1**: Select primary indicator (bottom chart)
2. **Pane 2**: Select secondary indicator (top chart, optional)
3. Both charts stay **synchronized** when zooming/panning

### Create Custom Indicator

1. Click **+ Add** button
2. Enter **name** (e.g., "CE-PE Momentum")
3. Enter **formula** using available variables:
   - `nifty_price`, `total_ce_oi_value`, `total_pe_oi_value`
   - `total_ce_oi_change_value`, `total_pe_oi_change_value`
   - `total_ce_trade_value`, `total_pe_trade_value`
   - `diff_oi_value`, `ratio_oi_value`, `diff_trade_value`
4. Click **Save**

### Example Formulas

```javascript
// Convert Diff to millions (easier to read)
diff_oi_value / 1000000

// Pe Bias (what % of total OI is in PE)
total_pe_oi_value / (total_ce_oi_value + total_pe_oi_value)

// OI Momentum (change relative to current OI)
(total_ce_oi_change_value + total_pe_oi_change_value) / (total_ce_oi_value + total_pe_oi_value)

// CE Dominance Score
(total_ce_oi_value - total_pe_oi_value) / (total_ce_oi_value + total_pe_oi_value)
```

### Export Data

1. Click **Export CSV** (when data is available)
2. File downloads as `indicators-YYYY-MM-DD.csv`
3. Open in Excel/Sheets for further analysis

---

## 🏗️ Architecture

### Backend Stack
- **Express.js** - REST API server
- **SQLite3** - Persistent data storage
- **Node.js** - Runtime

### Frontend Stack
- **React** - UI framework
- **lightweight-charts** - Professional charting
- **Vite** - Build tool

### Data Flow

```
NSE API
   ↓
/api/process (fetch & calculate)
   ↓
calculateIndicators() (sum across all strikes)
   ↓
SQLite Database (snapshots table)
   ↓
/api/history (retrieve for charts)
   ↓
React Frontend (visualization)
```

---

## 📋 API Endpoints

### GET `/ping`
Health check
```json
{ "ok": true, "time": "2026-02-24T10:30:00.000Z" }
```

### POST `/api/process`
Fetch and calculate indicators
```bash
curl -X POST http://localhost:4000/api/process \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.nseindia.com/api/..."}'
```

### GET `/api/history`
Retrieve all stored indicators
```json
[
  {
    "timestamp": "2026-02-24T05:00:00.000Z",
    "nifty_price": 25424.65,
    "total_ce_oi_value": 512345678,
    "total_pe_oi_value": 487654321,
    ...
  }
]
```

### GET `/api/export?date=2026-02-24`
Download CSV export

### Custom Indicators CRUD
- `GET /api/custom-indicators` - List all
- `POST /api/custom-indicators` - Create
- `DELETE /api/custom-indicators/:id` - Delete

---

## 💾 Database Schema

### `snapshots` Table

| Column | Type | Purpose |
|--------|------|---------|
| timestamp | TEXT | UTC time of snapshot |
| underlying | REAL | NIFTY spot price |
| total_ce_oi_value | REAL | Call OI value |
| total_pe_oi_value | REAL | Put OI value |
| total_ce_oi_change_value | REAL | Call OI change |
| total_pe_oi_change_value | REAL | Put OI change |
| total_ce_trade_value | REAL | Call trade value |
| total_pe_trade_value | REAL | Put trade value |
| diff_oi_value | REAL | CE - PE difference |
| ratio_oi_value | REAL | CE / PE ratio |
| diff_trade_value | REAL | CE trade - PE trade |
| test_value | REAL | User custom field |
| raw_json | TEXT | Complete API response |

### `custom_indicators` Table

| Column | Type |
|--------|------|
| name | TEXT (unique) |
| formula | TEXT |
| created_at | TIMESTAMP |

---

## 🔄 Data Updates

- **Poll Interval**: 60 seconds (configurable in code)
- **Data Retention**: Automatic cleanup when date changes
- **Time Zone**: UTC stored, IST (UTC+5:30) displayed
- **CSV Export**: Timestamps converted to IST

---

## 📊 Trading Signals

### Bullish Setup
- ✅ Diff OI Value **rising** (> 0)
- ✅ Ratio OI Value **> 1.0** and increasing
- ✅ CE OI Change **positive** (fresh longs)
- ✅ CE Trade Value **> PE Trade Value**

### Bearish Setup
- ✅ Diff OI Value **falling** (< 0)
- ✅ Ratio OI Value **< 1.0** and decreasing
- ✅ PE OI Change **positive** (fresh shorts)
- ✅ PE Trade Value **> CE Trade Value**

### Consolidation
- 🔹 Diff OI Value near **zero** for extended period
- 🔹 Ratio OI Value near **1.0**
- 🔹 Both CE & PE building **equally**

---

## 🛠️ Configuration

### Backend (`backend/index.js`)
```javascript
const PORT = process.env.PORT || 4000;
const POLL_INTERVAL_MS = 60_000; // Change to poll more/less frequently
const TIME_GAP_THRESHOLD = 120; // Break charts on gaps > 2 minutes
const LOT_SIZE = 65; // NIFTY standard lot size
```

### Frontend (`frontent/src/App.jsx`)
```javascript
const BACKEND_BASE = 'http://localhost:4000';
const LS_API_URL_KEY = 'oc_api_url'; // LocalStorage key for URL
```

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| "Cannot connect to API" | Ensure NSE URL is correct, check CORS headers |
| "Database locked" | Close other instances, restart backend |
| "Charts not updating" | Check browser console for errors, verify API data |
| "Export CSV empty" | Data exists only after API polls successfully |
| "Custom formula error" | Verify variable names match available list |

---

## 📈 Example Use Cases

### 1. Real-time Sentiment Analysis
Display `Diff OI Value` to see Call vs Put strength throughout the day.

### 2. Volume Confirmation
Compare `Diff OI Value` with `Diff Trade Value` to confirm moves with volume.

### 3. Momentum Trades
Use `Total CE OI Change Value` and `Total PE OI Change Value` for momentum setup confirmation.

### 4. Risk Management
Monitor `Ratio OI Value` for overbought (> 1.5) or oversold (< 0.67) extremes.

### 5. Intraday Scalping
Track `Diff Trade Value` changes for quick whipsaw trades.

---

## 📚 Resources

- **NSE Option Chain API**: https://www.nseindia.com/api/option-chain-v3
- **NIFTY Futures/Options Guide**: https://www.nseindia.com/products/content/derivatives/equities/options.htm

---

## 📝 Notes

- All monetary values are in **Rupees**
- Lot size is **65 shares** per contract for NIFTY
- Data is cleaned automatically at end of trading day
- Custom indicators use JavaScript expression syntax
- Time gaps > 2 minutes break chart lines (visual clarity)

---

## 🤝 Contributing

Feel free to extend with:
- Additional indicator types (Greeks, IV, etc.)
- Multi-leg strategy builders
- Alert notifications
- WebSocket for real-time updates without polling

---

## 📄 License

MIT License - Build and trade freely!

---

## 💬 Support

For issues or feature requests, please document:
- Steps to reproduce
- Expected vs actual behavior
- Browser/OS/Node.js version
- Screenshot of indicators

---

**Made with ❤️ for options traders** 📊

