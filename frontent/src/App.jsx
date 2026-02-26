// 

import { useCallback, useEffect, useRef, useState } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';
import './App.css';

const BACKEND_BASE = 'http://localhost:4000';
const POLL_INTERVAL_MS = 60_000;
const LS_TOKEN_KEY = 'oc_api_token';
const LS_EXPIRY_KEY = 'oc_api_expiry';
const LOT_SIZE = 65;
const TIME_GAP_THRESHOLD = 120; // 2 minutes in seconds

const BUILTIN_INDICATORS = [
  { value: 'nifty_price', label: '0. Underlying', color: '#333333' },
  { value: 'total_ce_oi_value', label: '1. Total CE OI Value', color: '#2196f3' },
  { value: 'total_pe_oi_value', label: '2. Total PE OI Value', color: '#f44336' },
  { value: 'total_ce_oi_value_2', label: '1A. Total CE OI Value 2', color: '#1976d2' },
  { value: 'total_pe_oi_value_2', label: '2A. Total PE OI Value 2', color: '#d32f2f' },
  { value: 'total_ce_oi_change_value', label: '3. Total CE OI Change Value', color: '#42a5f5' },
  { value: 'total_pe_oi_change_value', label: '4. Total PE OI Change Value', color: '#ef9a9a' },
  { value: 'total_ce_trade_value', label: '5. Total CE Trade Value', color: '#0288d1' },
  { value: 'total_pe_trade_value', label: '6. Total PE Trade Value', color: '#d32f2f' },
  { value: 'diff_oi_value', label: '9. Diff OI Value', color: '#000000' },
  { value: 'ratio_oi_value', label: '10. Ratio OI Value', color: '#ff9800' },
  { value: 'diff_oi_value_2', label: '9A. Diff OI Value 2', color: '#424242' },
  { value: 'ratio_oi_value_2', label: '10A. Ratio OI Value 2', color: '#fb8c00' },
  { value: 'diff_trade_value', label: '11. Diff Trade Value', color: '#9c27b0' },
  { value: 'test_value', label: '12. Test', color: '#4caf50' },
];

const VARIABLES = [
  { name: 'nifty_price', desc: 'Underlying / Nifty spot value' },
  { name: 'total_ce_oi_value', desc: 'Total CE OI Value (OI × 65 × LTP)' },
  { name: 'total_pe_oi_value', desc: 'Total PE OI Value (OI × 65 × LTP)' },
  { name: 'total_ce_oi_value_2', desc: 'Total CE OI Value 2 (Vol>0, OI × 65 × LTP)' },
  { name: 'total_pe_oi_value_2', desc: 'Total PE OI Value 2 (Vol>0, OI × 65 × LTP)' },
  { name: 'total_ce_oi_change_value', desc: 'Total CE OI Change Value (ChangeOI × 65 × LTP)' },
  { name: 'total_pe_oi_change_value', desc: 'Total PE OI Change Value (ChangeOI × 65 × LTP)' },
  { name: 'total_ce_trade_value', desc: 'Total CE Trade Value (Volume × 65 × LTP)' },
  { name: 'total_pe_trade_value', desc: 'Total PE Trade Value (Volume × 65 × LTP)' },
  { name: 'diff_oi_value', desc: 'Diff OI Value (CE − PE)' },
  { name: 'ratio_oi_value', desc: 'Ratio OI Value (CE ÷ PE)' },
  { name: 'diff_oi_value_2', desc: 'Diff OI Value 2 (CE2 − PE2)' },
  { name: 'ratio_oi_value_2', desc: 'Ratio OI Value 2 (CE2 ÷ PE2)' },
  { name: 'diff_trade_value', desc: 'Diff Trade Value (CE Trade − PE Trade)' },
  { name: 'test_value', desc: 'Test (Custom formula)' },
];

// Suppress unused variable warning for LOT_SIZE (kept for future use)
void LOT_SIZE;

function evaluateFormula(formula, point) {
  try {
    const vars = VARIABLES.map(v => v.name);
    const vals = vars.map(v => Number(point[v] ?? 0));
    // eslint-disable-next-line no-new-func
    const fn = new Function(...vars, `"use strict"; return (${formula});`);
    const result = fn(...vals);
    return typeof result === 'number' && isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

function splitDataByGaps(arr) {
  if (!arr.length) return [];
  const segments = [[arr[0]]];
  for (let i = 1; i < arr.length; i++) {
    const timeDiff = Math.abs(arr[i].time - arr[i - 1].time);
    if (timeDiff > TIME_GAP_THRESHOLD || arr[i].time < arr[i - 1].time) {
      segments.push([]);
    }
    segments[segments.length - 1].push(arr[i]);
  }
  return segments.filter(s => s.length > 0);
}

function buildSeriesData(points, key, customFormula = null) {
  const MAX_SAFE = 90071992547409.91;
  const arr = points
    .map(p => {
      const utcDate = new Date(p.timestamp);
      const istDate = new Date(utcDate.getTime() + 5.5 * 60 * 60 * 1000);
      const t = Math.floor(istDate.getTime() / 1000);
      let v = customFormula ? evaluateFormula(customFormula, p) : Number(p[key] ?? 0);
      if (v === null || isNaN(t)) return null;
      if (v > MAX_SAFE || v < -MAX_SAFE) v = Math.max(-MAX_SAFE, Math.min(MAX_SAFE, v));
      return { time: t, value: v };
    })
    .filter(Boolean);

  arr.sort((a, b) => a.time - b.time);

  const dedup = [];
  for (const item of arr) {
    if (!dedup.length || dedup[dedup.length - 1].time !== item.time) dedup.push(item);
    else dedup[dedup.length - 1] = item;
  }
  return dedup;
}

function formatPriceScale(value) {
  const n = Number(value);
  if (Math.abs(n) >= 1_000_000) {
    const m = n / 1_000_000;
    return (Math.abs(m) >= 1000 ? m.toFixed(0) : m.toFixed(1)) + 'M';
  }
  return Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(2);
}

function formatTimestamp(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':');
}

function useDualPaneChart(containerRef, { data1, color1, id1, data2, color2, id2, hasPane2 }) {
  const chartRef = useRef(null);
  const series1Ref = useRef([]);  // array of LineSeries (one per gap-segment)
  const series2Ref = useRef([]);
  const prevId1 = useRef(id1);
  const prevId2 = useRef(id2);

  // Create chart once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const id = requestAnimationFrame(() => {
      if (!el) return;

      const chart = createChart(el, {
        layout: {
          background: { color: '#ffffff' },
          textColor: '#111111',
          panes: {
            separatorColor: '#9ca3af',
            separatorHoverColor: 'rgba(99,102,241,0.45)',
            enableResize: true,
          },
        },
        grid: {
          vertLines: { color: '#f3f4f6' },
          horzLines: { color: '#f3f4f6' },
        },
        timeScale: {
          borderColor: '#e5e7eb',
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 5,
          barSpacing: 12,
        },
        rightPriceScale: { visible: true },
        crosshair: {
          mode: 1,
          vertLine: { color: '#d1d5db', labelBackgroundColor: '#f3f4f6' },
          horzLine: { color: '#d1d5db', labelBackgroundColor: '#f3f4f6' },
        },
        width: el.clientWidth,
        height: el.clientHeight,
      });
      chartRef.current = chart;

      // Resize observer
      const observer = new ResizeObserver(() => {
        if (chartRef.current && el) {
          chartRef.current.applyOptions({ width: el.clientWidth, height: el.clientHeight });
        }
      });
      observer.observe(el);

      return () => observer.disconnect();
    });

    return () => {
      cancelAnimationFrame(id);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        series1Ref.current = [];
        series2Ref.current = [];
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once

  // Update pane 0 series (indicator 1)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const indicatorChanged = prevId1.current !== id1;
    prevId1.current = id1;

    // If indicator changed, remove all old series to completely reset scale
    if (indicatorChanged) {
      series1Ref.current.forEach(s => { try { chart.removeSeries(s); } catch { } });
      series1Ref.current = [];
    }

    const segments = splitDataByGaps(data1);
    const isInitial = series1Ref.current.length === 0;

    segments.forEach((seg, i) => {
      if (series1Ref.current[i]) {
        series1Ref.current[i].applyOptions({ color: color1 });
        series1Ref.current[i].setData(seg);
      } else {
        const s = chart.addSeries(LineSeries, {
          color: color1,
          lineWidth: 2,
          priceLineVisible: false,
        }); // default pane index 0
        s.setData(seg);
        series1Ref.current.push(s);
      }
    });

    while (series1Ref.current.length > segments.length) {
      const s = series1Ref.current.pop();
      try { chart.removeSeries(s); } catch { }
    }

    if (isInitial && data1.length > 0) {
      chart.timeScale().fitContent();
    }
  }, [data1, color1, id1]);

  // Update pane 1 series (indicator 2)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!hasPane2 || !data2.length) {
      series2Ref.current.forEach(s => { try { chart.removeSeries(s); } catch { } });
      series2Ref.current = [];
      prevId2.current = id2;
      return;
    }

    const indicatorChanged = prevId2.current !== id2;
    prevId2.current = id2;

    if (indicatorChanged) {
      series2Ref.current.forEach(s => { try { chart.removeSeries(s); } catch { } });
      series2Ref.current = [];
    }

    const segments = splitDataByGaps(data2);
    const isInitial = series2Ref.current.length === 0;

    segments.forEach((seg, i) => {
      if (series2Ref.current[i]) {
        series2Ref.current[i].applyOptions({ color: color2 });
        series2Ref.current[i].setData(seg);
      } else {
        const s = chart.addSeries(
          LineSeries,
          {
            color: color2,
            lineWidth: 2,
            priceLineVisible: false,
          },
          1, // pane index 1
        );
        s.setData(seg);
        series2Ref.current.push(s);
      }
    });

    while (series2Ref.current.length > segments.length) {
      const s = series2Ref.current.pop();
      try { chart.removeSeries(s); } catch { }
    }

    if (isInitial && data2.length > 0) {
      chart.timeScale().fitContent();
    }
  }, [data2, color2, id2, hasPane2]);

  const handleReset = useCallback(() => {
    if (chartRef.current) chartRef.current.timeScale().fitContent();
  }, []);

  const handleZoom = useCallback((direction) => {
    if (!chartRef.current) return;
    const ts = chartRef.current.timeScale();
    const range = ts.getVisibleRange();
    if (!range) return;
    const { from, to } = range;
    const duration = to - from;
    const center = from + duration / 2;
    const factor = direction === 'in' ? 0.7 : 1 / 0.7;
    const newDuration = duration * factor;
    ts.setVisibleRange({
      from: Math.round(center - newDuration / 2),
      to: Math.round(center + newDuration / 2),
    });
  }, []);

  return { chartRef, handleReset, handleZoom };
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [upstoxToken, setUpstoxToken] = useState(() => localStorage.getItem(LS_TOKEN_KEY) || '');
  const [expiryDate, setExpiryDate] = useState(() => localStorage.getItem(LS_EXPIRY_KEY) || '');
  const [showApiModal, setShowApiModal] = useState(() => !localStorage.getItem(LS_EXPIRY_KEY));
  const [tokenDraft, setTokenDraft] = useState(() => localStorage.getItem(LS_TOKEN_KEY) || '');
  const [expiryDraft, setExpiryDraft] = useState(() => localStorage.getItem(LS_EXPIRY_KEY) || '');

  const [allIndicators, setAllIndicators] = useState(BUILTIN_INDICATORS);
  const [ind1, setInd1] = useState('nifty_price');
  const [ind2, setInd2] = useState('total_ce_oi_value');

  const [points, setPoints] = useState([]);
  const [connected, setConnected] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Not connected');
  const [statusType, setStatusType] = useState('idle');
  const [lastUpdated, setLastUpdated] = useState(new Date().toISOString());

  const [showAddModal, setShowAddModal] = useState(false);
  const [newIndName, setNewIndName] = useState('');
  const [newIndFormula, setNewIndFormula] = useState('');
  const [addError, setAddError] = useState('');

  const pollTimer = useRef(null);
  const containerRef = useRef(null);

  // ── Derive series data ──────────────────────────────────────────────────
  const getSeriesData = useCallback((indValue) => {
    const meta = allIndicators.find(i => i.value === indValue);
    const isCustom = indValue.startsWith('__custom__');
    return buildSeriesData(points, isCustom ? null : indValue, isCustom ? meta?.formula : null);
  }, [points, allIndicators]);

  const ind1Meta = allIndicators.find(i => i.value === ind1);
  const ind2Meta = allIndicators.find(i => i.value === ind2);
  const data1 = getSeriesData(ind1);
  const hasPane2 = ind2 !== 'none';
  const data2 = hasPane2 ? getSeriesData(ind2) : [];

  // ── Single chart hook ───────────────────────────────────────────────────
  const { handleReset, handleZoom } = useDualPaneChart(containerRef, {
    data1,
    color1: ind1Meta?.color || '#2196f3',
    data2,
    color2: ind2Meta?.color || '#9c27b0',
    hasPane2,
  });

  // ── Load custom indicators ──────────────────────────────────────────────
  const loadCustomIndicators = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND_BASE}/api/custom-indicators`);
      const data = await r.json();
      const custom = data.map(ci => ({
        value: `__custom__${ci.id}`,
        label: ci.name,
        formula: ci.formula,
        color: '#9c27b0',
        id: ci.id,
      }));
      setAllIndicators([...BUILTIN_INDICATORS, ...custom]);
    } catch { /* backend not yet reachable */ }
  }, []);

  useEffect(() => { loadCustomIndicators(); }, [loadCustomIndicators]);

  // ── Polling ──────────────────────────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    try {
      const resp = await fetch(`${BACKEND_BASE}/api/history`);
      if (!resp.ok) return [];
      const data = await resp.json();
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }, []);

  const doPoll = useCallback(async (token, expiry) => {
    try {
      const resp = await fetch(`${BACKEND_BASE}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, expiry_date: expiry }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const now = new Date().toISOString();
      const withTime = { ...data, timestamp: now };
      setPoints(prev => {
        if (prev.length && prev[prev.length - 1].timestamp === now) return prev;
        return [...prev, withTime];
      });
      setLastUpdated(now);
      setConnected(true);
      setStatusMsg('Live');
      setStatusType('live');
    } catch (err) {
      setStatusType('error');
      setStatusMsg(`Error: ${err.message}`);
    }
  }, []);

  const startPolling = useCallback(async (token, expiry) => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    setStatusMsg('Loading history...');
    setStatusType('idle');
    const historyData = await fetchHistory();
    setPoints(historyData);
    doPoll(token, expiry);
    pollTimer.current = setInterval(() => doPoll(token, expiry), POLL_INTERVAL_MS);
  }, [doPoll, fetchHistory]);

  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleApiSubmit = (e) => {
    e.preventDefault();
    const tDraft = tokenDraft.trim();
    const eDraft = expiryDraft.trim();
    if (!eDraft) return;

    const notifyUrlChange = async () => {
      try {
        await fetch(`${BACKEND_BASE}/api/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tDraft, expiry_date: eDraft }),
        });
      } catch { /* ignore */ }
    };

    localStorage.setItem(LS_TOKEN_KEY, tDraft);
    localStorage.setItem(LS_EXPIRY_KEY, eDraft);
    setUpstoxToken(tDraft);
    setExpiryDate(eDraft);
    setShowApiModal(false);
    setPoints([]);
    notifyUrlChange().then(() => startPolling(tDraft, eDraft));
  };

  const handleReconnect = () => {
    if (!expiryDate) { setShowApiModal(true); return; }
    startPolling(upstoxToken, expiryDate);
  };
  const handleChangeApi = () => {
    setTokenDraft(upstoxToken);
    setExpiryDraft(expiryDate);
    setShowApiModal(true);
  };

  const handleExport = async () => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      const resp = await fetch(`${BACKEND_BASE}/api/export?date=${date}`);
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `indicators-${date}.csv`,
      });
      document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { setStatusMsg(`Export error: ${err.message}`); }
  };

  const handleAddIndicator = async (e) => {
    e.preventDefault();
    setAddError('');
    const name = newIndName.trim();
    const formula = newIndFormula.trim();
    if (!name || !formula) { setAddError('Name and formula are required'); return; }

    const testPoint = {
      nifty_price: 100, total_ce_oi_value: 1000000, total_pe_oi_value: 1000000,
      total_ce_oi_value_2: 1000000, total_pe_oi_value_2: 1000000,
      total_ce_oi_change_value: 100000, total_pe_oi_change_value: 100000,
      total_ce_trade_value: 500000, total_pe_trade_value: 500000,
      diff_oi_value: 100000, ratio_oi_value: 1,
      diff_oi_value_2: 0, ratio_oi_value_2: 1,
      diff_trade_value: 100000, test_value: 100,
    };
    if (evaluateFormula(formula, testPoint) === null) {
      setAddError('Formula error – check syntax and variable names'); return;
    }

    const testPoint2 = {
      nifty_price: 25424.65, total_ce_oi_value: 10000000000, total_pe_oi_value: 10000000000,
      total_ce_oi_value_2: 10000000000, total_pe_oi_value_2: 10000000000,
      total_ce_oi_change_value: 500000000, total_pe_oi_change_value: 500000000,
      total_ce_trade_value: 5000000000, total_pe_trade_value: 5000000000,
      diff_oi_value: 0, ratio_oi_value: 1,
      diff_oi_value_2: 0, ratio_oi_value_2: 1,
      diff_trade_value: 0, test_value: 0,
    };
    const testResult = evaluateFormula(formula, testPoint2);
    if (testResult !== null && Math.abs(testResult) > 90071992547409.91) {
      setAddError('⚠️ Formula produces values exceeding safe range. Consider dividing by a scale factor.'); return;
    }

    try {
      const r = await fetch(`${BACKEND_BASE}/api/custom-indicators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, formula }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Save failed'); }
      await loadCustomIndicators();
      setShowAddModal(false);
      setNewIndName('');
      setNewIndFormula('');
    } catch (err) { setAddError(err.message); }
  };

  const handleDeleteCustom = async (id) => {
    await fetch(`${BACKEND_BASE}/api/custom-indicators/${id}`, { method: 'DELETE' });
    await loadCustomIndicators();
    if (ind1 === `__custom__${id}`) setInd1('diff_oi_value');
    if (ind2 === `__custom__${id}`) setInd2('none');
  };

  const ind2Options = [{ value: 'none', label: '— None —' }, ...allIndicators];

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* ── API Modal */}
      {showApiModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <span className="modal-icon">📡</span>
              <h2>Connect Data Feed</h2>
            </div>
            <p className="modal-sub">Enter your Upstox details. The app polls every 60 s.</p>
            <form onSubmit={handleApiSubmit}>
              <label className="field-label" style={{ textAlign: "left", display: "block", marginBottom: 4 }}>Upstox Access Token (Optional if in .env)</label>
              <input
                autoFocus className="modal-input" type="password"
                value={tokenDraft} onChange={e => setTokenDraft(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIsIn..."
              />
              <label className="field-label" style={{ textAlign: "left", display: "block", marginBottom: 4, marginTop: 12 }}>Expiry Date (YYYY-MM-DD)</label>
              <input
                className="modal-input" type="text"
                value={expiryDraft} onChange={e => setExpiryDraft(e.target.value)}
                placeholder="2024-03-28" required
              />
              <div className="modal-actions" style={{ marginTop: 20 }}>
                {expiryDate && <button type="button" className="btn btn-ghost" onClick={() => setShowApiModal(false)}>Cancel</button>}
                <button type="submit" className="btn btn-primary">Connect</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Add Indicator Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <div className="modal-header">
              <span className="modal-icon">➕</span>
              <h2>Add Custom Indicator</h2>
            </div>
            <form onSubmit={handleAddIndicator}>
              <label className="field-label">Indicator Name</label>
              <input autoFocus className="modal-input" type="text" value={newIndName}
                onChange={e => setNewIndName(e.target.value)} placeholder="e.g. CE minus PE Volume" />
              <label className="field-label">Formula</label>
              <input className="modal-input font-mono" type="text" value={newIndFormula}
                onChange={e => setNewIndFormula(e.target.value)} placeholder="e.g. total_ce_oi_value - total_pe_oi_value" />
              {addError && <p className="error-msg">{addError}</p>}
              <div className="var-table">
                <div className="var-table-header">Available Variables</div>
                <div className="var-grid">
                  {VARIABLES.map(v => (
                    <div key={v.name} className="var-row">
                      <code>{v.name}</code><span>{v.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
              {allIndicators.filter(i => i.value.startsWith('__custom__')).length > 0 && (
                <div className="saved-list">
                  <div className="var-table-header">Saved Indicators</div>
                  {allIndicators.filter(i => i.value.startsWith('__custom__')).map(ci => (
                    <div key={ci.value} className="saved-row">
                      <span className="saved-name">{ci.label}</span>
                      <code className="saved-formula">{ci.formula}</code>
                      <button type="button" className="btn-delete" onClick={() => handleDeleteCustom(ci.id)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => { setShowAddModal(false); setAddError(''); }}>Close</button>
                <button type="submit" className="btn btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Top Bar */}
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-dot" style={{
            background: statusType === 'live' ? '#22c55e' : statusType === 'error' ? '#ef4444' : '#94a3b8'
          }} />
          <span className="brand-name">OI Chart</span>
          {lastUpdated && (
            <span className="last-update">
              {new Date(new Date(lastUpdated).getTime() + 5.5 * 60 * 60 * 1000)
                .toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>

        <div className="topbar-controls">
          <div className="dropdown-group">
            <span className="dropdown-label">Pane 1</span>
            <select className="ind-select" value={ind1} onChange={e => setInd1(e.target.value)}>
              {allIndicators.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
          <div className="dropdown-group">
            <span className="dropdown-label">Pane 2</span>
            <select className="ind-select" value={ind2} onChange={e => setInd2(e.target.value)}>
              {ind2Options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
          <button className="btn btn-zoom" onClick={() => handleZoom('in')} title="Zoom in">🔍+</button>
          <button className="btn btn-zoom" onClick={() => handleZoom('out')} title="Zoom out">🔍−</button>
          <button className="btn btn-zoom" onClick={handleReset} title="Reset / fit all data">⟲ Reset</button>
          <button className="btn btn-add" onClick={() => setShowAddModal(true)}>+ Add</button>
          <button className="btn btn-export" onClick={handleExport} disabled={points.length === 0}>Export CSV</button>
          <button className="btn btn-connect" onClick={handleReconnect}>{connected ? 'Reconnect' : 'Connect'}</button>
          <button className="btn btn-ghost-sm" onClick={handleChangeApi} title="Change Options">⚙</button>
        </div>

        <div className="topbar-status">
          <span className={`status-pill status-${statusType}`}>{statusMsg}</span>
        </div>
      </header>

      {/* ── Chart Area — single container, native panes inside */}
      <div className="chart-area">
        {/* Floating pane labels */}
        <div className="pane-label pane-label-1" style={{ color: ind1Meta?.color || '#2196f3' }}>
          {ind1Meta?.label || ind1}
        </div>
        {hasPane2 && (
          <div className="pane-label pane-label-2" style={{ color: ind2Meta?.color || '#9c27b0' }}>
            {ind2Meta?.label || ind2}
          </div>
        )}
        <div ref={containerRef} className="chart-canvas" />
      </div>
    </div>
  );
}
