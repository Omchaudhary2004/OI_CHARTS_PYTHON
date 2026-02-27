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
  const prevHasPane2 = useRef(hasPane2); // track transition true→false for one-shot resize
  // FIX: crosshair value display — track hovered values for both panes
  const [crosshairVals, setCrosshairVals] = useState({ v1: null, v2: null });

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

      // FIX: crosshair subscription — update values shown next to pane labels on hover
      chart.subscribeCrosshairMove(param => {
        let v1 = null, v2 = null;
        if (param.seriesData) {
          for (const s of series1Ref.current) {
            const d = param.seriesData.get(s);
            if (d?.value !== undefined) { v1 = d.value; break; }
          }
          for (const s of series2Ref.current) {
            const d = param.seriesData.get(s);
            if (d?.value !== undefined) { v2 = d.value; break; }
          }
        }
        setCrosshairVals({ v1, v2 });
      });

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

    const segments = splitDataByGaps(data1);

    // CRITICAL: Never remove ALL series from pane 0 at once.
    // In LW Charts v5, emptying a pane causes it to collapse and the remaining
    // panes get renumbered — pane 1 becomes pane 0, so new series added to "index 0"
    // land in the wrong pane and the chart glitches.
    //
    // Strategy: update existing series in-place (color + data), add new ones at
    // the end if segments grew, remove extras from the END only (series[0] always stays).
    segments.forEach((seg, i) => {
      const isLast = i === segments.length - 1;
      if (series1Ref.current[i]) {
        // In-place update handles both regular refresh and indicator change
        series1Ref.current[i].applyOptions({ color: color1, lastValueVisible: isLast });
        series1Ref.current[i].setData(seg);
      } else {
        const s = chart.addSeries(LineSeries, {
          color: color1,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: isLast,
        }, 0); // explicit pane 0
        s.setData(seg);
        series1Ref.current.push(s);
      }
    });

    // Remove excess series from the END only — pane 0 always keeps series[0] alive
    while (series1Ref.current.length > segments.length) {
      const s = series1Ref.current.pop();
      try { chart.removeSeries(s); } catch { }
    }

    // Fit on indicator change or initial load
    if (indicatorChanged && data1.length > 0) {
      chart.timeScale().fitContent();
    } else if (series1Ref.current.length > 0 && series1Ref.current.length === segments.length && segments.length === 1) {
      // First data point ever — fit once
      if (segments[0].length === 1) chart.timeScale().fitContent();
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

      // Only fire the forced resize ONCE — on the exact moment hasPane2 goes
      // from true → false. Re-firing it on every render would reset the chart
      // height and wipe out the user's custom pane-separator position (lines disappear).
      if (prevHasPane2.current) {
        prevHasPane2.current = false;
        const el = containerRef.current;
        if (el) {
          requestAnimationFrame(() => {
            if (chartRef.current && el) {
              chartRef.current.applyOptions({
                width: el.clientWidth,
                height: el.clientHeight,
              });
            }
          });
        }
      }
      return;
    }

    prevHasPane2.current = true;
    const indicatorChanged = prevId2.current !== id2;
    prevId2.current = id2;

    if (indicatorChanged) {
      series2Ref.current.forEach(s => { try { chart.removeSeries(s); } catch { } });
      series2Ref.current = [];
    }

    const segments = splitDataByGaps(data2);
    const isInitial = series2Ref.current.length === 0;

    segments.forEach((seg, i) => {
      const isLast = i === segments.length - 1;
      if (series2Ref.current[i]) {
        series2Ref.current[i].applyOptions({
          color: color2,
          // FIX: only the last segment shows the latest-price highlight
          lastValueVisible: isLast,
        });
        series2Ref.current[i].setData(seg);
      } else {
        const s = chart.addSeries(
          LineSeries,
          {
            color: color2,
            lineWidth: 2,
            priceLineVisible: false,
            // FIX: latest price highlight on last segment only
            lastValueVisible: isLast,
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

  return { chartRef, handleReset, handleZoom, crosshairVals };
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [upstoxToken, setUpstoxToken] = useState(() => localStorage.getItem(LS_TOKEN_KEY) || '');
  const [expiryDate, setExpiryDate] = useState(() => localStorage.getItem(LS_EXPIRY_KEY) || '');
  const [showApiModal, setShowApiModal] = useState(() => !localStorage.getItem(LS_EXPIRY_KEY));
  const [tokenDraft, setTokenDraft] = useState(() => localStorage.getItem(LS_TOKEN_KEY) || '');
  const [expiryDraft, setExpiryDraft] = useState(() => localStorage.getItem(LS_EXPIRY_KEY) || '');
  const [expiryDraftError, setExpiryDraftError] = useState(''); // FIX: date format validation
  // FIX: token expiry warning — show banner if user connected on a previous day
  const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [tokenExpiredWarning, setTokenExpiredWarning] = useState(
    () => !!localStorage.getItem(LS_EXPIRY_KEY) &&
      localStorage.getItem('oi_connect_date') !== todayIST
  );

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

  const pollTimeoutRef = useRef(null);  // FIX: setTimeout ref instead of setInterval
  const isPollingRef = useRef(false);   // FIX: lock prevents double-entry
  const tokenRef = useRef('');
  const expiryRef = useRef('');
  const containerRef = useRef(null);

  const [backendOffline, setBackendOffline] = useState(false);
  const failCountRef = useRef(0);

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
  const { chartRef, handleReset, handleZoom, crosshairVals } = useDualPaneChart(containerRef, {
    data1,
    color1: ind1Meta?.color || '#2196f3',
    id1: ind1,
    data2,
    color2: ind2Meta?.color || '#9c27b0',
    id2: ind2,
    hasPane2,
  });

  // FIX: track pane 1 height so pane 2 label follows the separator
  const [pane1Height, setPane1Height] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      try {
        const panes = chartRef.current?.panes?.();
        if (panes?.[0]) setPane1Height(panes[0].getHeight());
      } catch { }
    }, 150);
    return () => clearInterval(id);
  }, [chartRef]);

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
      // FIX: 20s abort — prevents a slow/hanging backend from blocking all future polls forever
      const resp = await fetch(`${BACKEND_BASE}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, expiry_date: expiry }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setPoints(prev => {
        if (prev.length && prev[prev.length - 1].timestamp === data.timestamp) return prev;
        return [...prev, data];
      });
      setLastUpdated(data.timestamp); // FIX: use backend timestamp, not frontend clock
      setConnected(true);
      setStatusMsg('Live');
      setStatusType('live');
      return true; // FIX: signal success to schedulePoll
    } catch (err) {
      setStatusType('error');
      setStatusMsg(`Error: ${err.message}`);
      return false; // FIX: signal failure so schedulePoll can retry
    }
  }, []);

  const schedulePoll = useCallback(() => {
    if (!isPollingRef.current) return;
    // FIX: align to clock — always fire at the next exact :00 second boundary
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    pollTimeoutRef.current = setTimeout(async () => {
      if (!isPollingRef.current) return;
      const ok = await doPoll(tokenRef.current, expiryRef.current);
      if (!ok && isPollingRef.current) {
        // FIX: retry once after 10s if Upstox returned an error — covers brief API hiccups
        // within the same minute window so no data point is permanently lost
        await new Promise(r => setTimeout(r, 10_000));
        if (isPollingRef.current) await doPoll(tokenRef.current, expiryRef.current);
      }
      schedulePoll(); // next poll at the next :00 boundary
    }, msToNextMinute);
  }, [doPoll]);

  const startPolling = useCallback(async (token, expiry) => {
    // FIX: cancel any running poll before starting a new one
    clearTimeout(pollTimeoutRef.current);
    isPollingRef.current = false;
    await new Promise(r => setTimeout(r, 0)); // flush
    isPollingRef.current = true;
    tokenRef.current = token;
    expiryRef.current = expiry;
    setStatusMsg('Loading history...');
    setStatusType('idle');
    const historyData = await fetchHistory();
    setPoints(historyData);
    // FIX: no immediate doPoll — schedulePoll waits for the next :00 boundary
    schedulePoll();
  }, [fetchHistory, schedulePoll]);

  useEffect(() => () => {
    clearTimeout(pollTimeoutRef.current);
    isPollingRef.current = false;
  }, []);

  // FIX: health check every 30s — show banner + auto-reconnect on recovery
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const r = await fetch(`${BACKEND_BASE}/health`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          if (failCountRef.current >= 2) {
            // FIX: backend just recovered — reload history to fill the gap
            setBackendOffline(false);
            startPolling(tokenRef.current, expiryRef.current);
          }
          failCountRef.current = 0;
        } else {
          throw new Error('not ok');
        }
      } catch {
        failCountRef.current += 1;
        if (failCountRef.current >= 2) setBackendOffline(true);
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [startPolling]);

  // FIX: visibilitychange — when user returns to the tab after browser throttling,
  // immediately poll + realign the schedule to the next :00 boundary
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && isPollingRef.current) {
        // Trigger an immediate catch-up poll, then reschedule to next :00
        doPoll(tokenRef.current, expiryRef.current).then(() => {
          clearTimeout(pollTimeoutRef.current);
          schedulePoll();
        });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [doPoll, schedulePoll]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleApiSubmit = (e) => {
    e.preventDefault();
    const tDraft = tokenDraft.trim();
    const eDraft = expiryDraft.trim();
    // FIX: validate expiry date format YYYY-MM-DD before submitting
    if (!eDraft) { setExpiryDraftError('Expiry date is required'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eDraft)) {
      setExpiryDraftError('Use format YYYY-MM-DD (e.g. 2025-03-27)');
      return;
    }
    setExpiryDraftError('');

    const notifyUrlChange = async () => {
      try {
        await fetch(`${BACKEND_BASE}/api/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tDraft, expiry_date: eDraft }),
        });
      } catch { /* ignore */ }
    };

    // FIX: store today's connect date so expiry warning can compare tomorrow
    const todayStr = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    localStorage.setItem('oi_connect_date', todayStr);
    localStorage.setItem(LS_TOKEN_KEY, tDraft);
    localStorage.setItem(LS_EXPIRY_KEY, eDraft);
    setUpstoxToken(tDraft);
    setExpiryDate(eDraft);
    setTokenExpiredWarning(false);
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

      {backendOffline && (
        <div style={{
          background: '#fee2e2', color: '#991b1b', padding: '8px 16px',
          textAlign: 'center', fontWeight: 600, fontSize: 13
        }}>
          ⚠️ Backend offline — data paused. Auto-reconnecting...
          <button onClick={() => startPolling(tokenRef.current, expiryRef.current)}
            style={{
              marginLeft: 12, padding: '2px 10px', cursor: 'pointer',
              background: '#991b1b', color: '#fff', border: 'none', borderRadius: 4
            }}>
            Retry Now
          </button>
        </div>
      )}

      {/* FIX: token expiry warning — shown if user last connected on a previous day */}
      {tokenExpiredWarning && !showApiModal && (
        <div style={{
          background: '#fef9c3', color: '#854d0e', padding: '8px 16px',
          textAlign: 'center', fontWeight: 600, fontSize: 13,
          borderBottom: '1px solid #fde047',
        }}>
          ⚠️ Upstox token may have expired (connected yesterday). Please reconnect with today's token.
          <button onClick={() => { setTokenDraft(upstoxToken); setExpiryDraft(expiryDate); setShowApiModal(true); }}
            style={{
              marginLeft: 12, padding: '2px 10px', cursor: 'pointer',
              background: '#854d0e', color: '#fff', border: 'none', borderRadius: 4,
            }}>
            Update Token
          </button>
          <button onClick={() => setTokenExpiredWarning(false)}
            style={{
              marginLeft: 8, padding: '2px 8px', cursor: 'pointer',
              background: 'transparent', color: '#854d0e', border: '1px solid #854d0e', borderRadius: 4,
            }}>
            Dismiss
          </button>
        </div>
      )}

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
                value={expiryDraft} onChange={e => { setExpiryDraft(e.target.value); setExpiryDraftError(''); }}
                placeholder="2024-03-28" required
              />
              {/* FIX: show inline error if date format is wrong */}
              {expiryDraftError && (
                <p style={{ color: '#dc2626', fontSize: 12, margin: '4px 0 0', textAlign: 'left' }}>
                  {expiryDraftError}
                </p>
              )}
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
      <div className="chart-area" style={{ position: 'relative' }}>
        {/* FIX: TradingView-style — pane 1 label + live crosshair value at top-left */}
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 10,
          display: 'flex', alignItems: 'center', gap: 6,
          pointerEvents: 'none', userSelect: 'none',
        }}>
          <span style={{ color: ind1Meta?.color || '#2196f3', fontSize: 11, fontWeight: 700 }}>
            {ind1Meta?.label || ind1}
          </span>
          {crosshairVals.v1 !== null && (
            <span style={{ color: ind1Meta?.color || '#2196f3', fontSize: 11, fontWeight: 400, opacity: 0.9 }}>
              {formatPriceScale(crosshairVals.v1)}
            </span>
          )}
        </div>
        {/* FIX: pane 2 label + live crosshair value, positioned below separator */}
        {hasPane2 && pane1Height > 0 && (
          <div style={{
            position: 'absolute', top: pane1Height + 8, left: 8, zIndex: 10,
            display: 'flex', alignItems: 'center', gap: 6,
            pointerEvents: 'none', userSelect: 'none',
          }}>
            <span style={{ color: ind2Meta?.color || '#9c27b0', fontSize: 11, fontWeight: 700 }}>
              {ind2Meta?.label || ind2}
            </span>
            {crosshairVals.v2 !== null && (
              <span style={{ color: ind2Meta?.color || '#9c27b0', fontSize: 11, fontWeight: 400, opacity: 0.9 }}>
                {formatPriceScale(crosshairVals.v2)}
              </span>
            )}
          </div>
        )}
        <div ref={containerRef} className="chart-canvas" />
      </div>
    </div>
  );
}
