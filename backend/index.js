const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// --- Logging Setup ---
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

let currentLogFile = null;

function getLogFilePath() {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(logsDir, `data-gathering-${today}.log`);
}

function initializeLogFile() {
  const logPath = getLogFilePath();
  if (currentLogFile !== logPath) {
    currentLogFile = logPath;
    // Check if it's a new day and clear old logs
    const oldLogs = fs.readdirSync(logsDir).filter(f => f.startsWith('data-gathering-'));
    oldLogs.forEach(file => {
      const filePath = path.join(logsDir, file);
      const fileName = path.basename(filePath);
      const fileDate = fileName.replace('data-gathering-', '').replace('.log', '');
      const today = new Date().toISOString().slice(0, 10);
      if (fileDate !== today) {
        try {
          fs.unlinkSync(filePath);
          logToConsole(`[LOG CLEANUP] Deleted old log: ${file}`);
        } catch (e) {
          logToConsole(`[LOG CLEANUP] Failed to delete ${file}: ${e.message}`);
        }
      }
    });
  }
  return currentLogFile;
}

function logToFile(message) {
  const logPath = initializeLogFile();
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(logPath, logMessage, 'utf8');
  } catch (e) {
    console.error('[LOGGING ERROR]', e.message);
  }
}

function logToConsole(message) {
  console.log(message);
}

function logDataPoint(details) {
  const message = `[DATA POINT] ${JSON.stringify(details)}`;
  logToFile(message);
  logToConsole(message);
}

function logError(context, error) {
  const message = `[ERROR] [${context}] ${error.message || error}`;
  logToFile(message);
  console.error(message);
}

// --- SQLite setup ---
const dbPath = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logError('Database connection', err);
  } else {
    logToConsole('Database connected successfully');
    logToFile('[STARTUP] Database connected successfully');
  }
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

db.serialize(() => {
  // Metadata table to track current URL and date
  db.run(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating metadata table:', err);
    } else {
      console.log('✓ Metadata table ready');
      
      // Initialize metadata if empty
      db.run(`INSERT OR IGNORE INTO metadata (key, value) VALUES ('current_url', '')`, (err) => {
        if (err) console.error('Error initializing current_url:', err);
      });
      db.run(`INSERT OR IGNORE INTO metadata (key, value) VALUES ('current_date', '')`, (err) => {
        if (err) console.error('Error initializing current_date:', err);
      });
    }
  });

  // Main indicators table – expanded with all required indicators
  db.run(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      date TEXT NOT NULL,
      underlying REAL NOT NULL DEFAULT 0,
      total_ce_oi_value REAL NOT NULL DEFAULT 0,
      total_pe_oi_value REAL NOT NULL DEFAULT 0,
      total_ce_oi_change_value REAL NOT NULL DEFAULT 0,
      total_pe_oi_change_value REAL NOT NULL DEFAULT 0,
      total_ce_trade_value REAL NOT NULL DEFAULT 0,
      total_pe_trade_value REAL NOT NULL DEFAULT 0,
      diff_oi_value REAL NOT NULL DEFAULT 0,
      ratio_oi_value REAL NOT NULL DEFAULT 0,
      diff_trade_value REAL NOT NULL DEFAULT 0,
      test_value REAL NOT NULL DEFAULT 0,
      ce_oi REAL NOT NULL DEFAULT 0,
      pe_oi REAL NOT NULL DEFAULT 0,
      ce_chg_oi REAL NOT NULL DEFAULT 0,
      pe_chg_oi REAL NOT NULL DEFAULT 0,
      ce_vol REAL NOT NULL DEFAULT 0,
      pe_vol REAL NOT NULL DEFAULT 0,
      nifty_price REAL NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating snapshots table:', err);
    } else {
      console.log('✓ Snapshots table ready');
      
      // Add new columns to existing tables (migration)
      const newColumns = [
        { name: 'total_ce_oi_change_value', type: 'REAL DEFAULT 0' },
        { name: 'total_pe_oi_change_value', type: 'REAL DEFAULT 0' },
        { name: 'total_ce_trade_value', type: 'REAL DEFAULT 0' },
        { name: 'total_pe_trade_value', type: 'REAL DEFAULT 0' },
        { name: 'ratio_oi_value', type: 'REAL DEFAULT 0' },
        { name: 'diff_trade_value', type: 'REAL DEFAULT 0' },
        { name: 'test_value', type: 'REAL DEFAULT 0' },
      ];
      
      for (const col of newColumns) {
        db.run(`ALTER TABLE snapshots ADD COLUMN ${col.name} ${col.type}`, (err) => {
          if (err && err.message.includes('duplicate')) {
            // Column already exists, skip
          } else if (err) {
            console.error(`Error adding column ${col.name}:`, err.message);
          } else {
            console.log(`✓ Added column ${col.name} to snapshots`);
          }
        });
      }
    }
  });

  // Custom user-defined indicators
  db.run(`
    CREATE TABLE IF NOT EXISTS custom_indicators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      formula TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `, (err) => {
    if (err) {
      console.error('Error creating custom_indicators table:', err);
    } else {
      console.log('✓ Custom indicators table ready');
    }
  });
});

// Helper: Check if date changed and wipe old data
function checkAndClearOldData() {
  return new Promise((resolve, reject) => {
    const today = new Date().toISOString().slice(0, 10); // Get today's date (YYYY-MM-DD)

    // First, get the most recent date in the database
    db.get(
      'SELECT DISTINCT date FROM snapshots ORDER BY date DESC LIMIT 1',
      (err, row) => {
        if (err) {
          logError('checkAndClearOldData', err);
          return reject(err);
        }

        // If no data exists or date is different, clear all old data
        if (!row || row.date !== today) {
          const oldDate = row?.date || 'none';
          logToFile(`[DATE CHECK] Date changed from ${oldDate} to ${today}. Clearing old data...`);
          logToConsole(`[checkAndClearOldData] Date changed from ${oldDate} to ${today}. Clearing old data...`);
          
          db.run('DELETE FROM snapshots', function (err) {
            if (err) {
              logError('checkAndClearOldData-delete', err);
              return reject(err);
            }
            logToFile(`[DATE CHECK] Deleted ${this.changes} old snapshot records`);
            resolve(true); // true means data was cleared
          });
        } else {
          resolve(false); // false means data is still fresh
        }
      }
    );
  });
}

// Helper: Check if URL changed and wipe snapshots if needed
function checkAndClearForUrlChange(newUrl) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT value FROM metadata WHERE key = ?',
      ['current_url'],
      (err, row) => {
        if (err) {
          logError('checkAndClearForUrlChange', err);
          return reject(err);
        }

        const currentUrl = row?.value || '';

        // If URL changed, clear all snapshots but keep indicators
        if (currentUrl && currentUrl !== newUrl) {
          logToFile(`[URL CHECK] URL changed. Clearing all snapshots...`);
          logToFile(`[URL CHECK] Old: ${currentUrl.slice(0, 50)}... | New: ${newUrl.slice(0, 50)}...`);
          
          db.run('DELETE FROM snapshots', function (err) {
            if (err) {
              logError('checkAndClearForUrlChange-delete', err);
              return reject(err);
            }
            logToFile(`[URL CHECK] Deleted ${this.changes} snapshot records due to URL change`);
            
            // Update metadata with new URL
            db.run(
              'UPDATE metadata SET value = ? WHERE key = ?',
              [newUrl, 'current_url'],
              (err) => {
                if (err) {
                  logError('checkAndClearForUrlChange-update', err);
                  return reject(err);
                }
                resolve(true); // true means data was cleared
              }
            );
          });
        } else {
          // URL is same, just update metadata and don't clear
          db.run(
            'UPDATE metadata SET value = ? WHERE key = ?',
            [newUrl, 'current_url'],
            (err) => {
              if (err) {
                logError('checkAndClearForUrlChange-update', err);
                return reject(err);
              }
              resolve(false); // false means data was not cleared
            }
          );
        }
      }
    );
  });
}

// Helper: wipe data when date changes
function ensureFreshDay(currentDate) {
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM snapshots WHERE date <> ?',
      [currentDate],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

// Helper: flexible HTTP/HTTPS GET (avoids extra deps)
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    try {
      const isHttps = url.startsWith('https://');
      const mod = isHttps ? https : http;
      const req = mod.get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            Accept: 'application/json,text/plain,*/*',
          },
        },
        (res) => {
          // Follow redirect
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            logToFile(`[REDIRECT] Following redirect to: ${res.headers.location}`);
            return fetchJson(res.headers.location).then(resolve).catch(reject);
          }
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              const error = `HTTP ${res.statusCode}: ${data.slice(0, 200)}`;
              logError('fetchJson', error);
              return reject(new Error(`Status code ${res.statusCode}: ${data.slice(0, 200)}`));
            }
            try {
              resolve(JSON.parse(data));
              logToFile(`[FETCH SUCCESS] Got valid JSON response from API`);
            } catch (e) {
              logError('fetchJson-JSON.parse', e);
              reject(new Error('Invalid JSON response'));
            }
          });
        }
      );
      req.on('error', (err) => {
        logError('fetchJson-request', err);
        reject(err);
      });
      req.setTimeout(10000, () => { 
        req.destroy(); 
        logError('fetchJson', 'Request timeout (10s)');
        reject(new Error('Request timeout')); 
      });
    } catch (e) {
      logError('fetchJson-exception', e);
      reject(e);
    }
  });
}

// Core calculation logic – returns built-in indicators + raw aggregate fields
function calculateIndicators(records) {
  const LOT_SIZE = 65;

  if (!records || !Array.isArray(records.data)) {
    throw new Error('Invalid records structure: missing data array');
  }

  let totalCEOIValue = 0, totalPEOIValue = 0;
  let totalCEOIChangeValue = 0, totalPEOIChangeValue = 0;
  let totalCETradeValue = 0, totalPETradeValue = 0;
  let totalCeOI = 0, totalPeOI = 0;
  let totalCeChgOI = 0, totalPeChgOI = 0;
  let totalCeVol = 0, totalPeVol = 0;
  let underlying = records.underlyingValue || 0;

  for (const row of records.data) {
    if (row.CE) {
      const ce = row.CE;
      const oi = typeof ce.openInterest === 'number' ? ce.openInterest : 0;
      const ltp = typeof ce.lastPrice === 'number' ? ce.lastPrice : 0;
      const chgOI = typeof ce.changeinOpenInterest === 'number' ? ce.changeinOpenInterest : 0;
      const vol = typeof ce.totalTradedVolume === 'number' ? ce.totalTradedVolume : 0;

      totalCeOI += oi;
      totalCeChgOI += chgOI;
      totalCeVol += vol;
      
      // Total CE OI Value = (OI × LOT_SIZE) × LastPrice
      totalCEOIValue += (oi * LOT_SIZE) * ltp;
      
      // Total CE OI Change Value = (ChangeInOpenInterest × LOT_SIZE) × LastPrice
      totalCEOIChangeValue += (chgOI * LOT_SIZE) * ltp;
      
      // Total CE Trade Value = (TotalTradedVolume × LOT_SIZE) × LastPrice
      totalCETradeValue += (vol * LOT_SIZE) * ltp;

      if (!underlying && ce.underlyingValue) underlying = ce.underlyingValue;
    }

    if (row.PE) {
      const pe = row.PE;
      const oi = typeof pe.openInterest === 'number' ? pe.openInterest : 0;
      const ltp = typeof pe.lastPrice === 'number' ? pe.lastPrice : 0;
      const chgOI = typeof pe.changeinOpenInterest === 'number' ? pe.changeinOpenInterest : 0;
      const vol = typeof pe.totalTradedVolume === 'number' ? pe.totalTradedVolume : 0;

      totalPeOI += oi;
      totalPeChgOI += chgOI;
      totalPeVol += vol;
      
      // Total PE OI Value = (OI × LOT_SIZE) × LastPrice
      totalPEOIValue += (oi * LOT_SIZE) * ltp;
      
      // Total PE OI Change Value = (ChangeInOpenInterest × LOT_SIZE) × LastPrice
      totalPEOIChangeValue += (chgOI * LOT_SIZE) * ltp;
      
      // Total PE Trade Value = (TotalTradedVolume × LOT_SIZE) × LastPrice
      totalPETradeValue += (vol * LOT_SIZE) * ltp;

      if (!underlying && pe.underlyingValue) underlying = pe.underlyingValue;
    }
  }

  // Calculate derived indicators
  const diffOIValue = totalCEOIValue - totalPEOIValue;
  const ratioOIValue = totalPEOIValue !== 0 ? totalCEOIValue / totalPEOIValue : 0;
  const diffTradeValue = totalCETradeValue - totalPETradeValue;

  return {
    underlying: underlying || 0,
    total_ce_oi_value: totalCEOIValue,
    total_pe_oi_value: totalPEOIValue,
    total_ce_oi_change_value: totalCEOIChangeValue,
    total_pe_oi_change_value: totalPEOIChangeValue,
    total_ce_trade_value: totalCETradeValue,
    total_pe_trade_value: totalPETradeValue,
    diff_oi_value: diffOIValue,
    ratio_oi_value: ratioOIValue,
    diff_trade_value: diffTradeValue,
    test_value: 0, // User input field, defaults to 0
    ce_oi: totalCeOI,
    pe_oi: totalPeOI,
    ce_chg_oi: totalCeChgOI,
    pe_chg_oi: totalPeChgOI,
    ce_vol: totalCeVol,
    pe_vol: totalPeVol,
    nifty_price: underlying || 0,
  };
}

// Store snapshot in DB – ALWAYS use current server time for accuracy
function saveSnapshot(data) {
  return new Promise((resolve, reject) => {
    const { 
      underlying, 
      total_ce_oi_value, 
      total_pe_oi_value,
      total_ce_oi_change_value,
      total_pe_oi_change_value,
      total_ce_trade_value,
      total_pe_trade_value,
      diff_oi_value, 
      ratio_oi_value,
      diff_trade_value,
      test_value,
      raw,
      ce_oi, pe_oi, ce_chg_oi, pe_chg_oi, ce_vol, pe_vol, nifty_price 
    } = data;

    // ALWAYS use current server time (UTC) – don't trust frontend/API timestamps
    // Get timestamp FIRST before any async operations to prevent "time skipping"
    const captureTime = new Date();
    const dateStr = captureTime.toISOString().slice(0, 10); // YYYY-MM-DD
    const tsStr = captureTime.toISOString(); // Full ISO timestamp with milliseconds

    // Check if date changed and clear old data if needed
    checkAndClearOldData()
      .then(() => {
        db.run(
          `INSERT INTO snapshots (
            timestamp, date, underlying,
            total_ce_oi_value, total_pe_oi_value,
            total_ce_oi_change_value, total_pe_oi_change_value,
            total_ce_trade_value, total_pe_trade_value,
            diff_oi_value, ratio_oi_value, diff_trade_value, test_value,
            ce_oi, pe_oi, ce_chg_oi, pe_chg_oi,
            ce_vol, pe_vol, nifty_price,
            raw_json
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            tsStr, dateStr, underlying,
            total_ce_oi_value, total_pe_oi_value,
            total_ce_oi_change_value, total_pe_oi_change_value,
            total_ce_trade_value, total_pe_trade_value,
            diff_oi_value, ratio_oi_value, diff_trade_value, test_value,
            ce_oi, pe_oi, ce_chg_oi, pe_chg_oi,
            ce_vol, pe_vol, nifty_price,
            JSON.stringify(raw),
          ],
          function (err) {
            if (err) {
              logError('saveSnapshot', err);
              return reject(err);
            }
            
            // Log successful data point
            logDataPoint({
              id: this.lastID,
              timestamp: tsStr,
              date: dateStr,
              underlying: underlying,
              nifty_price: nifty_price,
              ce_oi: ce_oi,
              pe_oi: pe_oi,
              ce_vol: ce_vol,
              pe_vol: pe_vol,
              total_ce_oi_value: total_ce_oi_value,
              total_pe_oi_value: total_pe_oi_value,
            });
            
            resolve({ id: this.lastID, timestamp: tsStr, date: dateStr });
          }
        );
      })
      .catch(err => {
        logError('saveSnapshot-checkAndClear', err);
        reject(err);
      });
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/ping', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// One-shot: fetch from external URL, compute, save, return values
app.post('/api/process', async (req, res) => {
  const requestTime = new Date().toISOString();
  
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      logError('POST /api/process', 'Missing url in body');
      return res.status(400).json({ error: 'Missing url in body' });
    }

    logToFile(`[REQUEST] POST /api/process - URL: ${url.substring(0, 100)}`);

    // Check if URL changed and clear data if needed
    await checkAndClearForUrlChange(url);

    const json = await fetchJson(url);
    const { records } = json;
    if (!records) {
      logError('POST /api/process', 'Response has no records field');
      return res.status(400).json({ error: 'Response has no records field' });
    }

    const ind = calculateIndicators(records);

    const saved = await saveSnapshot({ ...ind, raw: json });

    logToFile(`[SUCCESS] Data processed and saved - ID: ${saved.id}, Timestamp: ${saved.timestamp}`);

    res.json({
      id: saved.id,
      timestamp: saved.timestamp,
      date: saved.date,
      underlying: ind.underlying,
      total_ce_oi_value: ind.total_ce_oi_value,
      total_pe_oi_value: ind.total_pe_oi_value,
      total_ce_oi_change_value: ind.total_ce_oi_change_value,
      total_pe_oi_change_value: ind.total_pe_oi_change_value,
      total_ce_trade_value: ind.total_ce_trade_value,
      total_pe_trade_value: ind.total_pe_trade_value,
      diff_oi_value: ind.diff_oi_value,
      ratio_oi_value: ind.ratio_oi_value,
      diff_trade_value: ind.diff_trade_value,
      test_value: ind.test_value,
      ce_oi: ind.ce_oi,
      pe_oi: ind.pe_oi,
      ce_chg_oi: ind.ce_chg_oi,
      pe_chg_oi: ind.pe_chg_oi,
      ce_vol: ind.ce_vol,
      pe_vol: ind.pe_vol,
      nifty_price: ind.nifty_price,
    });
  } catch (err) {
    logError('POST /api/process', err);
    res.status(500).json({ error: 'Failed to process data', details: err.message });
  }
});

// Get stored indicators for a date (default: today)
app.get('/api/indicators', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const date = (typeof req.query.date === 'string' && req.query.date.length === 10)
    ? req.query.date : today;

  logToFile(`[GET] /api/indicators - date: ${date}`);

  db.all(
    `SELECT id, timestamp, date, underlying,
            total_ce_oi_value, total_pe_oi_value,
            total_ce_oi_change_value, total_pe_oi_change_value,
            total_ce_trade_value, total_pe_trade_value,
            diff_oi_value, ratio_oi_value, diff_trade_value, test_value,
            ce_oi, pe_oi, ce_chg_oi, pe_chg_oi,
            ce_vol, pe_vol, nifty_price
     FROM snapshots WHERE date = ? ORDER BY timestamp ASC`,
    [date],
    (err, rows) => {
      if (err) {
        logError('GET /api/indicators', err);
        return res.status(500).json({ error: 'DB error' });
      }
      logToFile(`[GET] /api/indicators - returned ${rows ? rows.length : 0} records for ${date}`);
      res.json({ date, points: rows || [] });
    }
  );
});

// Get all historical data from database
app.get('/api/history', (req, res) => {
  db.all(
    `SELECT timestamp, nifty_price,
            total_ce_oi_value, total_pe_oi_value,
            total_ce_oi_change_value, total_pe_oi_change_value,
            total_ce_trade_value, total_pe_trade_value,
            diff_oi_value, ratio_oi_value, diff_trade_value, test_value,
            ce_oi, pe_oi, ce_chg_oi, pe_chg_oi, ce_vol, pe_vol
     FROM snapshots ORDER BY timestamp ASC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('DB error in /api/history:', err.message);
        return res.status(500).json({ error: 'DB error' });
      }
      res.json(rows || []);
    }
  );
});

// Export as CSV for a date
app.get('/api/export', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const date = (typeof req.query.date === 'string' && req.query.date.length === 10)
    ? req.query.date : today;

  db.all(
    `SELECT timestamp, underlying, nifty_price,
            total_ce_oi_value, total_pe_oi_value,
            total_ce_oi_change_value, total_pe_oi_change_value,
            total_ce_trade_value, total_pe_trade_value,
            diff_oi_value, ratio_oi_value, diff_trade_value, test_value,
            ce_oi, pe_oi, ce_chg_oi, pe_chg_oi, ce_vol, pe_vol
     FROM snapshots WHERE date = ? ORDER BY timestamp ASC`,
    [date],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });

      const header = 'timestamp_IST,underlying,nifty_price,total_ce_oi_value,total_pe_oi_value,total_ce_oi_change_value,total_pe_oi_change_value,total_ce_trade_value,total_pe_trade_value,diff_oi_value,ratio_oi_value,diff_trade_value,test_value,ce_oi,pe_oi,ce_chg_oi,pe_chg_oi,ce_vol,pe_vol';
      const lines = rows.map(r => {
        // Convert UTC timestamp to IST for export
        const utcDate = new Date(r.timestamp);
        const istDate = new Date(utcDate.getTime() + (5.5 * 60 * 60 * 1000));
        const istTimestamp = istDate.toISOString().slice(0, 19).replace('T', ' ') + ' IST';
        return [istTimestamp, r.underlying, r.nifty_price,
         r.total_ce_oi_value, r.total_pe_oi_value,
         r.total_ce_oi_change_value, r.total_pe_oi_change_value,
         r.total_ce_trade_value, r.total_pe_trade_value,
         r.diff_oi_value, r.ratio_oi_value, r.diff_trade_value, r.test_value,
         r.ce_oi, r.pe_oi, r.ce_chg_oi, r.pe_chg_oi, r.ce_vol, r.pe_vol].join(',')
      });
      const csv = [header, ...lines].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="indicators-${date}.csv"`);
      res.send(csv);
    }
  );
});

// ── Custom Indicators CRUD ────────────────────────────────────────────────────

app.get('/api/custom-indicators', (req, res) => {
  db.all('SELECT id, name, formula, created_at FROM custom_indicators ORDER BY id ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows || []);
  });
});

app.post('/api/custom-indicators', (req, res) => {
  const { name, formula } = req.body || {};
  if (!name || !formula) {
    return res.status(400).json({ error: 'name and formula are required' });
  }
  db.run(
    `INSERT INTO custom_indicators (name, formula) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET formula = excluded.formula`,
    [name.trim(), formula.trim()],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error', details: err.message });
      res.json({ id: this.lastID || null, name: name.trim(), formula: formula.trim() });
    }
  );
});

app.delete('/api/custom-indicators/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  db.run('DELETE FROM custom_indicators WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ deleted: this.changes > 0 });
  });
});

// Endpoint to handle API URL change (called when user changes the feed)
app.post('/api/connect', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      logError('POST /api/connect', 'Missing url in body');
      return res.status(400).json({ error: 'Missing url in body' });
    }

    logToFile(`[CONNECT] Attempting to connect to: ${url.substring(0, 100)}`);

    // Check if URL changed and clear snapshots if needed
    const wasCleared = await checkAndClearForUrlChange(url);
    
    logToFile(`[CONNECT SUCCESS] Connected - Data cleared: ${wasCleared}`);
    
    res.json({
      ok: true,
      message: wasCleared ? 'New data source detected. Cleared previous data.' : 'Data source updated.',
      cleared: wasCleared
    });
  } catch (err) {
    logError('POST /api/connect', err);
    res.status(500).json({ error: 'Failed to update connection', details: err.message });
  }
});

app.get('/', (_req, res) => res.send('Backend is running'));

// Get logs for today or a specific date
app.get('/api/logs', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const date = (typeof req.query.date === 'string' && req.query.date.length === 10)
      ? req.query.date : today;

    const logPath = path.join(logsDir, `data-gathering-${date}.log`);
    
    if (!fs.existsSync(logPath)) {
      return res.json({ date, logs: [], message: 'No logs for this date' });
    }

    const logContent = fs.readFileSync(logPath, 'utf8');
    const lines = logContent.trim().split('\n').filter(l => l);
    
    res.json({ 
      date, 
      logs: lines,
      count: lines.length 
    });
  } catch (err) {
    logError('GET /api/logs', err);
    res.status(500).json({ error: 'Failed to read logs', details: err.message });
  }
});

// Clear logs for a specific date (or today)
app.delete('/api/logs', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const date = (typeof req.query.date === 'string' && req.query.date.length === 10)
      ? req.query.date : today;

    const logPath = path.join(logsDir, `data-gathering-${date}.log`);
    
    if (!fs.existsSync(logPath)) {
      return res.json({ message: 'No logs to delete for this date' });
    }

    fs.unlinkSync(logPath);
    logToFile(`[LOG DELETED] Logs for ${date} have been manually cleared`);
    
    res.json({ ok: true, message: `Logs for ${date} deleted successfully` });
  } catch (err) {
    logError('DELETE /api/logs', err);
    res.status(500).json({ error: 'Failed to delete logs', details: err.message });
  }
});

// app.listen(PORT, () => {
//   console.log(`Backend listening on http://localhost:${PORT}`);
// });



// Add this before app.listen
const EXPIRY_DATE = new Date('2026-03-26'); // Set your expiry date

if (new Date() >= EXPIRY_DATE) {
  logToConsole('Demo expired. Please complete payment to continue.');
  logToFile('[STARTUP] FATAL: Demo expired. Exiting.');
  process.exit(1); // Kills the server before it starts
}

app.listen(PORT, () => {
  const startMsg = `Backend listening on http://localhost:${PORT}`;
  logToConsole(startMsg);
  logToFile(`[STARTUP] ${startMsg}`);
  logToFile(`[STARTUP] Logging initialized for date: ${new Date().toISOString().slice(0, 10)}`);
});