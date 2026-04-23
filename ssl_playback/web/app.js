// ── Constants ──────────────────────────────────────────────────
const SPEED_LIMIT = 6.5;

// Field geometry — updated dynamically from Vision geometry packets
let fieldGeo = {
  field_len: 12.04, field_wid: 9.02,
  goal_wid: 1.8, goal_depth: 0.18,
  defense_len: 1.8, defense_wid: 3.6,
  center_radius: 0.5,
};

const EVENT_COLORS = {
  POSSIBLE_GOAL: '#E040FB',
  GOAL: '#00C853',
  INVALID_GOAL: '#FF6D00',
  BOT_KICKED_BALL_TOO_FAST: '#FF1744',
  BALL_LEFT_FIELD_GOAL_LINE: '#2979FF',
  BALL_LEFT_FIELD_TOUCH_LINE: '#2979FF',
  PENALTY_KICK_FAILED: '#FF9100',
  NO_PROGRESS_IN_GAME: '#9E9E9E',
  PLACEMENT_SUCCEEDED: '#69F0AE',
  PLACEMENT_FAILED: '#FF5252',
};

function eventColor(kind) {
  return EVENT_COLORS[kind] ?? '#90A4AE';
}

function shortKind(kind) {
  const map = {
    POSSIBLE_GOAL: 'POSS_GOAL',
    GOAL: 'GOAL',
    INVALID_GOAL: 'INV_GOAL',
    BOT_KICKED_BALL_TOO_FAST: 'TOO_FAST',
    BALL_LEFT_FIELD_GOAL_LINE: 'OUT_GL',
    BALL_LEFT_FIELD_TOUCH_LINE: 'OUT_TL',
    PLACEMENT_SUCCEEDED: 'PLACE_OK',
    PLACEMENT_FAILED: 'PLACE_NG',
    NO_PROGRESS_IN_GAME: 'NO_PROG',
  };
  return map[kind] ?? kind.slice(0, 8);
}

// ── State ──────────────────────────────────────────────────────
const state = {
  ws: null,
  frozen: false,
  armed: true,
  windowS: 5,
  data: null,       // current snapshot data
  chart: null,
  chartEvents: [],
  chartPanned: false,  // user manually panned/zoomed → suppress auto-scale
};

// ── DOM ────────────────────────────────────────────────────────
const fieldCanvas = document.getElementById('field-canvas');
const ctx = fieldCanvas.getContext('2d');
const fieldPanel = document.getElementById('field-panel');
const uplotContainer = document.getElementById('uplot-container');
const statusChip = document.getElementById('status-chip');
const freezeBanner = document.getElementById('freeze-banner');
const windowRange = document.getElementById('window-range');
const windowLabel = document.getElementById('window-label');
const btnFreeze = document.getElementById('btn-freeze');
const btnResume = document.getElementById('btn-resume');
const btnRearm = document.getElementById('btn-rearm');

// ── Field Canvas ───────────────────────────────────────────────
function resizeFieldCanvas() {
  const panelH = fieldPanel.clientHeight - 24;
  const panelW = fieldPanel.clientWidth - 24;
  const ratio = fieldGeo.field_len / fieldGeo.field_wid;
  let w, h;
  if (panelW / panelH >= ratio) {
    h = Math.floor(panelH);
    w = Math.floor(h * ratio);
  } else {
    w = Math.floor(panelW);
    h = Math.floor(w / ratio);
  }
  fieldCanvas.width = w;
  fieldCanvas.height = h;
}

function fieldScale() {
  return {
    sx: fieldCanvas.width / fieldGeo.field_len,
    sy: fieldCanvas.height / fieldGeo.field_wid,
    cx: fieldCanvas.width / 2,
    cy: fieldCanvas.height / 2,
  };
}

function toCanvas(x, y, { sx, sy, cx, cy }) {
  return [cx + x * sx, cy - y * sy];
}

function drawField() {
  const { sx, sy, cx, cy } = fieldScale();
  const w = fieldCanvas.width;
  const h = fieldCanvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#2D5A27';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(1, sx * 0.05);

  const r = (m) => m * sx;
  const { field_len, field_wid, goal_wid, goal_depth, defense_len, defense_wid, center_radius } = fieldGeo;

  function rect(x1, y1, x2, y2) {
    const [ax, ay] = toCanvas(x1, y1, { sx, sy, cx, cy });
    const [bx, by] = toCanvas(x2, y2, { sx, sy, cx, cy });
    ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
  }

  // Field boundary
  rect(-field_len / 2, -field_wid / 2, field_len / 2, field_wid / 2);

  // Center line
  ctx.beginPath();
  const [lx, ly] = toCanvas(0, -field_wid / 2, { sx, sy, cx, cy });
  const [rx, ry] = toCanvas(0, field_wid / 2, { sx, sy, cx, cy });
  ctx.moveTo(lx, ly);
  ctx.lineTo(rx, ry);
  ctx.stroke();

  // Center circle
  ctx.beginPath();
  ctx.arc(cx, cy, r(center_radius), 0, Math.PI * 2);
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, r(0.05)), 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();

  // Defense areas and goals
  for (const side of [-1, 1]) {
    const goalX = side * field_len / 2;
    rect(goalX, -defense_wid / 2, goalX - side * defense_len, defense_wid / 2);

    ctx.strokeStyle = side === 1 ? '#4FC3F7' : '#EF9A9A';
    rect(goalX, -goal_wid / 2, goalX + side * goal_depth, goal_wid / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  }
}

function drawTrajectory(tracker) {
  if (!tracker || tracker.length === 0) return;
  const scale = fieldScale();
  const n = tracker.length;

  for (let i = 1; i < n; i++) {
    const alpha = 0.15 + 0.85 * (i / n);
    const [ax, ay] = toCanvas(tracker[i - 1].x, tracker[i - 1].y, scale);
    const [bx, by] = toCanvas(tracker[i].x, tracker[i].y, scale);
    ctx.strokeStyle = `rgba(255,220,50,${alpha})`;
    ctx.lineWidth = Math.max(1.5, scale.sx * 0.04);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  if (n > 0) {
    const last = tracker[n - 1];
    const [bx, by] = toCanvas(last.x, last.y, scale);
    ctx.beginPath();
    ctx.arc(bx, by, Math.max(4, scale.sx * 0.1), 0, Math.PI * 2);
    ctx.fillStyle = '#FFD600';
    ctx.fill();
  }
}

function drawEventPins(tracker, events) {
  if (!events || events.length === 0 || !tracker || tracker.length === 0) return;
  const scale = fieldScale();

  for (const evt of events) {
    const nearest = findNearestTracker(tracker, evt.dt);
    if (!nearest) continue;
    const [px, py] = toCanvas(nearest.x, nearest.y, scale);
    const col = eventColor(evt.kind);

    ctx.beginPath();
    ctx.arc(px, py, Math.max(6, scale.sx * 0.15), 0, Math.PI * 2);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = col;
    ctx.font = `bold ${Math.max(9, Math.floor(scale.sx * 0.14))}px sans-serif`;
    ctx.fillText(shortKind(evt.kind), px + 6, py - 6);
  }
}

function findNearestTracker(tracker, dt) {
  if (!tracker.length) return null;
  let best = tracker[0];
  let bestDiff = Math.abs(tracker[0].dt - dt);
  for (const s of tracker) {
    const diff = Math.abs(s.dt - dt);
    if (diff < bestDiff) { best = s; bestDiff = diff; }
  }
  return best;
}

function renderField(data) {
  drawField();
  if (!data) return;
  drawTrajectory(data.tracker);
  drawEventPins(data.tracker, data.events);
}

// ── uPlot chart ────────────────────────────────────────────────
function buildEventPlugin(getEvents) {
  return {
    hooks: {
      draw: [
        (u) => {
          const events = getEvents();
          if (!events.length) return;
          const { ctx: uctx, bbox } = u;
          uctx.save();
          for (const evt of events) {
            const xPx = u.valToPos(evt.dt, 'x', true);
            if (xPx < bbox.left || xPx > bbox.left + bbox.width) continue;
            const col = eventColor(evt.kind);
            uctx.strokeStyle = col;
            uctx.lineWidth = 1.5;
            uctx.setLineDash([5, 3]);
            uctx.beginPath();
            uctx.moveTo(xPx, bbox.top);
            uctx.lineTo(xPx, bbox.top + bbox.height);
            uctx.stroke();
            uctx.setLineDash([]);
            uctx.fillStyle = col;
            uctx.font = 'bold 10px sans-serif';
            uctx.save();
            uctx.translate(xPx + 2, bbox.top + 14);
            uctx.fillText(shortKind(evt.kind), 0, 0);
            uctx.restore();
          }
          uctx.restore();
        },
      ],
    },
  };
}

function buildInteractionPlugin() {
  return {
    hooks: {
      init: [(u) => {
        const el = u.over;

        // Mouse wheel: zoom in/out centered on cursor
        el.addEventListener('wheel', (e) => {
          e.preventDefault();
          const { min, max } = u.scales.x;
          const range = max - min;
          const pct = u.cursor.left / u.bbox.width;
          const xAtCursor = min + pct * range;
          const factor = e.deltaY > 0 ? 1.35 : 1 / 1.35;
          const newRange = range * factor;
          state.chartPanned = true;
          u.setScale('x', {
            min: xAtCursor - pct * newRange,
            max: xAtCursor + (1 - pct) * newRange,
          });
        }, { passive: false });

        // Left-drag: pan the time axis
        let dragging = false, startX = 0, startMin = 0, startMax = 0;
        el.addEventListener('mousedown', (e) => {
          dragging = true;
          startX = e.clientX;
          startMin = u.scales.x.min;
          startMax = u.scales.x.max;
        });
        el.addEventListener('mousemove', (e) => {
          if (!dragging) return;
          const range = startMax - startMin;
          const delta = -((e.clientX - startX) / u.bbox.width) * range;
          if (Math.abs(delta) > 0.001) state.chartPanned = true;
          u.setScale('x', { min: startMin + delta, max: startMax + delta });
        });
        const stopDrag = () => { dragging = false; };
        el.addEventListener('mouseup', stopDrag);
        el.addEventListener('mouseleave', stopDrag);

        // Double-click: reset view to full window
        el.addEventListener('dblclick', () => {
          state.chartPanned = false;
          u.setScale('x', { min: -state.windowS, max: 0 });
        });
      }],
    },
  };
}

function buildLimitPlugin() {
  return {
    hooks: {
      draw: [
        (u) => {
          const { ctx: uctx, bbox } = u;
          const yPx = u.valToPos(SPEED_LIMIT, 'y', true);
          if (yPx < bbox.top || yPx > bbox.top + bbox.height) return;
          uctx.save();
          uctx.strokeStyle = 'rgba(220,50,50,0.8)';
          uctx.lineWidth = 1.5;
          uctx.setLineDash([8, 4]);
          uctx.beginPath();
          uctx.moveTo(bbox.left, yPx);
          uctx.lineTo(bbox.left + bbox.width, yPx);
          uctx.stroke();
          uctx.setLineDash([]);
          uctx.fillStyle = 'rgba(220,50,50,0.9)';
          uctx.font = 'bold 11px sans-serif';
          uctx.fillText('6.5 m/s', bbox.left + 4, yPx - 3);
          uctx.restore();
        },
      ],
    },
  };
}

function initChart() {
  uplotContainer.innerHTML = '';
  const w = Math.max(uplotContainer.clientWidth, 200);
  const h = Math.max(uplotContainer.clientHeight, 200);

  const opts = {
    width: w,
    height: h,
    cursor: { show: true, drag: { x: false, y: false } },
    legend: { show: true },
    plugins: [buildInteractionPlugin(), buildEventPlugin(() => state.chartEvents), buildLimitPlugin()],
    axes: [
      {
        label: '時刻 (s)',
        values: (u, vals) => vals.map((v) => v == null ? '' : `${v.toFixed(1)}s`),
      },
      {
        label: 'm/s',
        values: (u, vals) => vals.map((v) => v == null ? '' : v.toFixed(2)),
      },
    ],
    series: [
      {},
      {
        label: 'Tracker vel',
        stroke: '#1976D2',
        width: 2,
        points: { show: true, size: 4, fill: '#1976D2' },
        spanGaps: false,
      },
      {
        label: 'Vision (raw)',
        stroke: '#F57C00',
        width: 1.5,
        dash: [4, 4],
        points: { show: true, size: 4, fill: '#F57C00' },
        spanGaps: false,
      },
    ],
    scales: {
      x: { min: -state.windowS, max: 0 },
      y: { range: [0, Math.max(8, SPEED_LIMIT + 2)] },
    },
  };

  const emptyData = [[], [], []];
  state.chart = new uPlot(opts, emptyData, uplotContainer);
}

function updateChart(data) {
  if (!state.chart || !data) return;

  const windowS = data.window_s ?? state.windowS;
  state.chartEvents = data.events ?? [];

  const tracker = data.tracker ?? [];
  const vision = data.vision ?? [];

  // Build merged time axis; always anchor to [-windowS, 0] so annotations render
  const trackerMap = new Map(tracker.map((s) => [s.dt, s.speed]));
  const visionMap = new Map();
  for (const s of vision) {
    const key = Math.round(s.dt * 100) / 100;  // 10ms bins
    if (!visionMap.has(key) || s.speed > visionMap.get(key)) {
      visionMap.set(key, s.speed);
    }
  }

  const allTs = new Set([-windowS, 0, ...trackerMap.keys(), ...visionMap.keys()]);
  const sortedTs = Array.from(allTs).sort((a, b) => a - b);

  const trackerArr = sortedTs.map((t) => trackerMap.has(t) ? trackerMap.get(t) : null);
  const visionArr  = sortedTs.map((t) => visionMap.has(t)  ? visionMap.get(t)  : null);

  if (!state.chartPanned) {
    state.chart.setScale('x', { min: -windowS, max: 0 });
  }
  state.chart.setData([sortedTs, trackerArr, visionArr]);
}

// ── WebSocket ──────────────────────────────────────────────────
function connect() {
  const wsUrl = `ws://${location.host}/ws`;
  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    setStatus('live');
    state.ws.send(JSON.stringify({ type: 'set_window', seconds: state.windowS }));
  };

  state.ws.onclose = () => {
    setStatus('disconnected');
    setTimeout(connect, 2000);
  };

  state.ws.onerror = () => {
    state.ws.close();
  };

  state.ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.geometry) fieldGeo = msg.geometry;
    if (msg.type === 'live') {
      if (!state.frozen) {
        state.data = msg;
        render();
      }
    } else if (msg.type === 'frozen') {
      state.frozen = true;
      state.armed = false;
      if (msg.snapshot?.geometry) fieldGeo = msg.snapshot.geometry;
      state.data = msg.snapshot;
      const evt = msg.trigger_event;
      freezeBanner.textContent = `■ FROZEN — ${evt?.kind ?? ''} (${evt?.origin?.join(', ') ?? 'GC'})`;
      freezeBanner.hidden = false;
      setStatus('frozen');
      updateButtons();
      render();
    }
  };
}

function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(msg));
  }
}

// ── Render ─────────────────────────────────────────────────────
function render() {
  renderField(state.data);
  updateChart(state.data);
}

function setStatus(s) {
  statusChip.dataset.state = s;
  statusChip.textContent = { live: '● Live', frozen: '■ Frozen', disconnected: '○ Disconnected' }[s] ?? s;
}

function updateButtons() {
  btnFreeze.disabled = state.frozen;
  btnResume.disabled = !state.frozen;
  btnRearm.disabled = !state.frozen && state.armed;
}

// ── Controls ───────────────────────────────────────────────────
btnFreeze.addEventListener('click', () => {
  if (state.frozen) return;
  state.frozen = true;
  state.armed = false;
  freezeBanner.textContent = '■ FROZEN — 手動';
  freezeBanner.hidden = false;
  setStatus('frozen');
  updateButtons();
});

btnResume.addEventListener('click', () => {
  state.frozen = false;
  state.armed = true;
  state.chartPanned = false;
  freezeBanner.hidden = true;
  setStatus('live');
  updateButtons();
  send({ type: 'resume' });
});

btnRearm.addEventListener('click', () => {
  state.frozen = false;
  state.armed = true;
  state.chartPanned = false;
  freezeBanner.hidden = true;
  setStatus('live');
  updateButtons();
  send({ type: 'rearm' });
});

windowRange.addEventListener('input', () => {
  const v = parseInt(windowRange.value, 10);
  state.windowS = v;
  state.chartPanned = false;
  windowLabel.textContent = `${v}s`;
  send({ type: 'set_window', seconds: v });
});

// ── Resize ─────────────────────────────────────────────────────
function onResize() {
  resizeFieldCanvas();
  if (!state.chart) {
    const w = uplotContainer.clientWidth;
    const h = uplotContainer.clientHeight;
    if (w > 0 && h > 0) initChart();
  } else {
    const w = Math.max(uplotContainer.clientWidth, 200);
    const h = Math.max(uplotContainer.clientHeight, 200);
    state.chart.setSize({ width: w, height: h });
  }
  render();
}

const ro = new ResizeObserver(onResize);
ro.observe(fieldPanel);
ro.observe(uplotContainer);

// ── Boot ───────────────────────────────────────────────────────
updateButtons();
connect();
requestAnimationFrame(onResize);
