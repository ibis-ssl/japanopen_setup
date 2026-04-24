const state = {
  tabs: [],
  services: [],
  settings: null,
  outputs: [],
  visionQuality: null,
  visionQualityError: '',
  logService: 'all',
  logTail: 200,
  logsAutoRefresh: true,
  logsContent: '',
  logsError: '',
  logsGeneratedAt: '',
  logsLoading: false,
  activeTab: 'game-controller',
};

let visionQualityTimer = null;
let logsTimer = null;

const tabRail = document.getElementById('tab-rail');
const panelStack = document.getElementById('panel-stack');
const topbarTitle = document.getElementById('topbar-panel-title');
const topbarActions = document.getElementById('topbar-actions');
const metricRunning = document.getElementById('metric-running');
const metricTotal = document.getElementById('metric-total');
const serviceError = document.getElementById('service-error');

const statusLabels = {
  'not-created': 'Not created',
  running: 'Running',
  exited: 'Exited',
  restarting: 'Restarting',
  created: 'Created',
  dead: 'Dead',
  removing: 'Removing',
  paused: 'Paused',
  unknown: 'Unknown',
};

function getVisibleTabs() {
  return state.tabs.filter((t) => t.id !== 'overview');
}

function getTabFromHash() {
  return window.location.hash.replace(/^#/, '') || 'game-controller';
}

function updateTopbar() {
  const tabId = state.activeTab;
  if (tabId === 'logs') {
    topbarTitle.textContent = 'Logs';
    topbarActions.innerHTML = '<span class="status-pill">Docker Compose</span>';
    return;
  }
  if (tabId === 'settings') {
    const audioref = state.services.find((s) => s.id === 'audioref');
    topbarTitle.textContent = 'Settings';
    topbarActions.innerHTML = `
      <span class="status-pill" data-state="${audioref?.state ?? 'unknown'}">
        ${audioref ? `AudioRef: ${formatState(audioref.state)}` : 'AudioRef: Unknown'}
      </span>
    `;
    return;
  }
  if (tabId === 'vision-quality') {
    const playback = playbackService();
    const directLink = playback?.url
      ? `<a class="ghost-link" href="${playback.url}" target="_blank" rel="noreferrer">Open Playback</a>`
      : '';
    topbarTitle.textContent = 'Vision QC';
    topbarActions.innerHTML = `
      <span class="status-pill" data-state="${playback?.state ?? 'unknown'}">
        ${playback ? `Playback: ${formatState(playback.state)}` : 'Playback: Unknown'}
      </span>
      ${directLink}
    `;
    return;
  }
  const service = serviceByTab(tabId);
  if (!service) {
    topbarTitle.textContent = '';
    topbarActions.innerHTML = '';
    return;
  }
  topbarTitle.textContent = service.label;
  topbarActions.innerHTML = `
    <span class="status-pill" data-state="${service.state}">${formatState(service.state)}</span>
    <a class="ghost-link" href="${service.url}" target="_blank" rel="noreferrer">Open directly</a>
  `;
}

function setActiveTab(tabId) {
  const validTabIds = new Set(getVisibleTabs().map((tab) => tab.id));
  const safeTabId = validTabIds.has(tabId) ? tabId : 'game-controller';

  state.activeTab = safeTabId;
  if (window.location.hash !== `#${safeTabId}`) {
    window.history.replaceState(null, '', `#${safeTabId}`);
  }
  for (const button of tabRail.querySelectorAll('.tab-button')) {
    button.classList.toggle('is-active', button.dataset.tabId === safeTabId);
  }
  for (const panel of panelStack.querySelectorAll('.panel')) {
    panel.classList.toggle('is-active', panel.dataset.panelId === safeTabId);
  }
  updateTopbar();
  updateVisionQualityPolling();
  updateLogsPolling();
}

function serviceByTab(tabId) {
  return state.services.find((service) => service.tabId === tabId) ?? null;
}

function playbackService() {
  return state.services.find((service) => service.id === 'ssl-playback') ?? null;
}

function serviceLabelForTab(tabId) {
  if (tabId === 'logs') {
    return '';
  }
  if (tabId === 'settings') {
    return state.services.find((service) => service.id === 'audioref')?.state ?? '';
  }
  if (tabId === 'vision-quality') {
    return playbackService()?.state ?? '';
  }
  return serviceByTab(tabId)?.state ?? '';
}

function formatState(stateValue) {
  return statusLabels[stateValue] ?? stateValue;
}

function isServiceRunning(service) {
  return service?.state === 'running';
}

function createTabButton(tab) {
  const template = document.getElementById('tab-button-template');
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.tabId = tab.id;
  node.innerHTML = `
    <span class="tab-button__name">${tab.label}</span>
    <span class="tab-button__state" data-role="state"></span>
  `;
  node.addEventListener('click', () => setActiveTab(tab.id));
  return node;
}

function renderTabRail() {
  if (!tabRail.children.length) {
    for (const tab of getVisibleTabs()) {
      tabRail.appendChild(createTabButton(tab));
    }
  }

  for (const button of tabRail.querySelectorAll('.tab-button')) {
    const tabId = button.dataset.tabId;
    const stateText = serviceLabelForTab(tabId);
    const slot = button.querySelector('[data-role="state"]');
    slot.textContent = stateText ? formatState(stateText) : '';
  }
}

function createEmbedPanel(tab) {
  const service = serviceByTab(tab.id);
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.dataset.panelId = tab.id;
  panel.dataset.serviceId = service.id;
  const running = isServiceRunning(service);
  panel.innerHTML = `
    <div class="embed-shell" data-role="embed-shell" data-running="${String(running)}">
      <iframe title="${service.label}" src="${service.url ?? ''}" loading="lazy"></iframe>
      <div class="embed-state" data-role="embed-state"${running ? ' hidden' : ''}>
        <strong data-role="state-title"></strong>
        <p data-role="state-copy"></p>
      </div>
    </div>
  `;
  return panel;
}

function createSettingsPanel() {
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.dataset.panelId = 'settings';
  panel.innerHTML = `
    <div class="panel__body">
      <section class="settings-card">
        <h3>AudioRef Output</h3>
        <p>現在値は <code>compose.yaml</code> の <code>audioref</code> service から読み取っています。変更はホスト側で編集してから AudioRef を再作成してください。</p>
        <div class="form-grid">
          <div>
            <label class="field-label" for="output-pcm">Detected PCM Outputs</label>
            <select class="select-input" id="output-pcm" name="outputPcm"></select>
            <div class="field-help" id="output-help"></div>
          </div>
        </div>
        <div class="form-actions">
          <button class="ghost-button" type="button" id="reload-button">Reload Status</button>
        </div>
        <div class="flash" id="settings-flash" hidden></div>
      </section>
    </div>
  `;

  panel.querySelector('#reload-button').addEventListener('click', () => refreshAll({ flash: true }));
  return panel;
}

function createVisionQualityPanel() {
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.dataset.panelId = 'vision-quality';
  panel.innerHTML = `
    <div class="panel__body vision-qc">
      <section class="qc-summary-grid" aria-label="Vision packet quality summary">
        <div class="qc-metric">
          <span>Max timestamp skew</span>
          <strong data-qc-summary="skew">-</strong>
        </div>
        <div class="qc-metric">
          <span>Active sources</span>
          <strong data-qc-summary="sources">0</strong>
        </div>
        <div class="qc-metric">
          <span>Active streams</span>
          <strong data-qc-summary="streams">0</strong>
        </div>
        <div class="qc-metric">
          <span>Packets</span>
          <strong data-qc-summary="packets">0</strong>
        </div>
      </section>

      <section class="qc-table-shell">
        <table class="qc-table">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Source IP</th>
              <th scope="col">Camera</th>
              <th scope="col">Frame</th>
              <th scope="col">t_capture</th>
              <th scope="col">t_sent</th>
              <th scope="col">Send period</th>
              <th scope="col">Rx period</th>
              <th scope="col">Age</th>
              <th scope="col">Packets</th>
            </tr>
          </thead>
          <tbody id="vision-quality-rows"></tbody>
        </table>
        <div class="qc-empty" id="vision-quality-empty">No Vision packets received.</div>
      </section>

      <div class="flash" id="vision-quality-flash" hidden></div>
    </div>
  `;
  return panel;
}

function createLogsPanel() {
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.dataset.panelId = 'logs';
  panel.innerHTML = `
    <div class="panel__body logs-panel">
      <section class="logs-toolbar" aria-label="Log controls">
        <div class="logs-field">
          <label class="field-label" for="logs-service">Service</label>
          <select class="select-input logs-select" id="logs-service"></select>
        </div>
        <div class="logs-field logs-field--compact">
          <label class="field-label" for="logs-tail">Tail</label>
          <select class="select-input logs-select" id="logs-tail">
            <option value="50">50 lines</option>
            <option value="100">100 lines</option>
            <option value="200">200 lines</option>
            <option value="500">500 lines</option>
            <option value="1000">1000 lines</option>
          </select>
        </div>
        <label class="logs-toggle">
          <input type="checkbox" id="logs-auto-refresh" checked>
          <span>Auto-refresh</span>
        </label>
        <button class="ghost-button" type="button" id="logs-refresh">Refresh</button>
        <button class="ghost-button" type="button" id="logs-copy">Copy</button>
      </section>

      <div class="logs-meta" id="logs-meta"></div>
      <div class="logs-output-shell">
        <pre class="logs-output" id="logs-output" aria-live="polite"></pre>
        <div class="logs-empty" id="logs-empty" hidden>No logs returned.</div>
      </div>
      <div class="flash" id="logs-flash" hidden></div>
    </div>
  `;

  panel.querySelector('#logs-service').addEventListener('change', (event) => {
    state.logService = event.target.value;
    refreshLogs();
  });
  panel.querySelector('#logs-tail').addEventListener('change', (event) => {
    state.logTail = Number(event.target.value);
    refreshLogs();
  });
  panel.querySelector('#logs-auto-refresh').addEventListener('change', (event) => {
    state.logsAutoRefresh = event.target.checked;
    updateLogsPolling();
  });
  panel.querySelector('#logs-refresh').addEventListener('click', () => refreshLogs());
  panel.querySelector('#logs-copy').addEventListener('click', () => copyLogs());

  return panel;
}

function renderPanels() {
  if (panelStack.children.length) {
    return;
  }

  for (const tab of getVisibleTabs()) {
    if (tab.id === 'logs') {
      panelStack.appendChild(createLogsPanel());
      continue;
    }
    if (tab.id === 'settings') {
      panelStack.appendChild(createSettingsPanel());
      continue;
    }
    if (tab.id === 'vision-quality') {
      panelStack.appendChild(createVisionQualityPanel());
      continue;
    }
    panelStack.appendChild(createEmbedPanel(tab));
  }
}

function updateEmbedPanels() {
  for (const panel of panelStack.querySelectorAll('[data-service-id]')) {
    const service = state.services.find((item) => item.id === panel.dataset.serviceId);
    if (!service) {
      continue;
    }

    const running = isServiceRunning(service);

    const shell = panel.querySelector('[data-role="embed-shell"]');
    shell.dataset.running = String(running);

    const embedState = panel.querySelector('[data-role="embed-state"]');
    embedState.hidden = running;
    if (!running) {
      embedState.querySelector('[data-role="state-title"]').textContent =
        `Service is ${formatState(service.state).toLowerCase()}.`;
      embedState.querySelector('[data-role="state-copy"]').textContent =
        service.statusText || 'まだコンテナが作成されていません。';
    }
  }
}

function ensureCustomOutputOption(select, value) {
  const hasOption = Array.from(select.options).some((option) => option.value === value);
  if (!hasOption && value) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = `${value} (compose value)`;
    select.appendChild(option);
  }
}

function renderSettings() {
  const panel = panelStack.querySelector('[data-panel-id="settings"]');
  if (!panel || !state.settings) {
    return;
  }

  const select = panel.querySelector('#output-pcm');
  const help = panel.querySelector('#output-help');
  const reloadButton = panel.querySelector('#reload-button');
  const preservedValue = select.value;

  select.innerHTML = '';
  for (const output of state.outputs) {
    const option = document.createElement('option');
    option.value = output.value;
    option.textContent = output.label;
    select.appendChild(option);
  }

  const currentValue = state.settings.audioref.outputPcm;
  ensureCustomOutputOption(select, currentValue);
  select.value = currentValue || preservedValue || 'default';
  help.textContent = `Current compose value: ${currentValue}`;

  reloadButton.disabled = false;
}

function formatNumber(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '-';
  }
  return numeric.toFixed(digits);
}

function formatMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '-';
  }
  if (numeric >= 1000) {
    return `${(numeric / 1000).toFixed(2)} s`;
  }
  if (numeric >= 100) {
    return `${numeric.toFixed(0)} ms`;
  }
  if (numeric >= 10) {
    return `${numeric.toFixed(1)} ms`;
  }
  return `${numeric.toFixed(2)} ms`;
}

function formatTimestamp(value) {
  return formatNumber(value, 6);
}

function addCell(row, text, className = '') {
  const cell = document.createElement('td');
  if (className) {
    cell.className = className;
  }
  cell.textContent = text;
  row.appendChild(cell);
}

function renderVisionQuality() {
  const panel = panelStack.querySelector('[data-panel-id="vision-quality"]');
  if (!panel) {
    return;
  }

  const summary = state.visionQuality?.summary ?? {};
  panel.querySelector('[data-qc-summary="skew"]').textContent = formatMs(summary.maxCaptureSkewMs);
  panel.querySelector('[data-qc-summary="sources"]').textContent = formatNumber(summary.activeSources);
  panel.querySelector('[data-qc-summary="streams"]').textContent =
    `${formatNumber(summary.activeStreams)} / ${formatNumber(summary.totalStreams)}`;
  panel.querySelector('[data-qc-summary="packets"]').textContent = formatNumber(summary.receivedPackets);

  const flash = panel.querySelector('#vision-quality-flash');
  if (state.visionQualityError) {
    flash.hidden = false;
    flash.dataset.tone = 'error';
    flash.textContent = state.visionQualityError;
  } else {
    flash.hidden = true;
    flash.textContent = '';
  }

  const body = panel.querySelector('#vision-quality-rows');
  const empty = panel.querySelector('#vision-quality-empty');
  body.innerHTML = '';
  const rows = state.visionQuality?.rows ?? [];
  empty.hidden = rows.length > 0 || Boolean(state.visionQualityError);

  for (const item of rows) {
    const row = document.createElement('tr');
    row.dataset.active = String(Boolean(item.active));

    const statusCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'qc-badge';
    badge.dataset.active = String(Boolean(item.active));
    badge.textContent = item.active ? 'Active' : 'Stale';
    statusCell.appendChild(badge);
    row.appendChild(statusCell);

    addCell(row, item.sourceIp ?? '-', 'mono-cell');
    addCell(row, formatNumber(item.cameraId));
    addCell(row, formatNumber(item.frameNumber));
    addCell(row, formatTimestamp(item.captureTimestamp), 'mono-cell');
    addCell(row, formatTimestamp(item.sentTimestamp), 'mono-cell');
    addCell(row, formatMs(item.sentPeriodMs), 'numeric-cell');
    addCell(row, formatMs(item.receivePeriodMs), 'numeric-cell');
    addCell(row, formatMs(item.ageMs), 'numeric-cell');
    addCell(row, formatNumber(item.packetCount), 'numeric-cell');
    body.appendChild(row);
  }
}

function renderLogsPanel() {
  const panel = panelStack.querySelector('[data-panel-id="logs"]');
  if (!panel) {
    return;
  }

  const serviceSelect = panel.querySelector('#logs-service');
  const tailSelect = panel.querySelector('#logs-tail');
  const autoRefresh = panel.querySelector('#logs-auto-refresh');
  const refreshButton = panel.querySelector('#logs-refresh');
  const copyButton = panel.querySelector('#logs-copy');
  const meta = panel.querySelector('#logs-meta');
  const output = panel.querySelector('#logs-output');
  const empty = panel.querySelector('#logs-empty');
  const flash = panel.querySelector('#logs-flash');

  const currentService = state.logService;
  serviceSelect.innerHTML = '';
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All services';
  serviceSelect.appendChild(allOption);
  for (const service of state.services) {
    const option = document.createElement('option');
    option.value = service.id;
    option.textContent = `${service.label} (${service.id})`;
    serviceSelect.appendChild(option);
  }
  const serviceValues = new Set(Array.from(serviceSelect.options).map((option) => option.value));
  state.logService = serviceValues.has(currentService) ? currentService : 'all';
  serviceSelect.value = state.logService;

  tailSelect.value = String(state.logTail);
  autoRefresh.checked = state.logsAutoRefresh;
  refreshButton.disabled = state.logsLoading;
  copyButton.disabled = !state.logsContent;

  output.textContent = state.logsContent;
  empty.hidden = Boolean(state.logsContent || state.logsError || state.logsLoading);

  if (state.logsLoading) {
    meta.textContent = 'Loading logs...';
  } else if (state.logsGeneratedAt) {
    const generatedAt = new Date(state.logsGeneratedAt);
    const generatedLabel = Number.isNaN(generatedAt.getTime())
      ? state.logsGeneratedAt
      : generatedAt.toLocaleString();
    meta.textContent = `Showing ${state.logTail} lines for ${state.logService} - updated ${generatedLabel}`;
  } else {
    meta.textContent = `Showing ${state.logTail} lines for ${state.logService}`;
  }

  if (state.logsError) {
    flash.hidden = false;
    flash.dataset.tone = 'error';
    flash.textContent = state.logsError;
  } else {
    flash.hidden = true;
    flash.textContent = '';
  }
}

function renderSummary() {
  const runningCount = state.services.filter((service) => service.state === 'running').length;
  metricRunning.textContent = String(runningCount);
  metricTotal.textContent = String(state.services.length);
}

function renderError(summary) {
  if (summary?.error) {
    serviceError.hidden = false;
    serviceError.textContent = summary.error;
    return;
  }
  serviceError.hidden = true;
  serviceError.textContent = '';
}

function showFlash(message, tone = 'success') {
  const flash = document.getElementById('settings-flash');
  if (!flash) {
    return;
  }
  flash.hidden = false;
  flash.dataset.tone = tone;
  flash.textContent = message;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload?.detail ?? `${response.status} ${response.statusText}`;
    throw new Error(detail);
  }
  return response.json();
}

async function refreshVisionQuality() {
  try {
    state.visionQuality = await fetchJson('/api/vision-quality');
    state.visionQualityError = '';
  } catch (error) {
    state.visionQuality = null;
    state.visionQualityError = error.message;
  }
  renderVisionQuality();
}

async function refreshLogs() {
  if (state.logsLoading) {
    return;
  }

  state.logsLoading = true;
  renderLogsPanel();
  const params = new URLSearchParams({
    service: state.logService,
    tail: String(state.logTail),
  });

  try {
    const payload = await fetchJson(`/api/logs?${params.toString()}`);
    state.logsContent = payload.logs ?? '';
    state.logsGeneratedAt = payload.generatedAt ?? '';
    state.logsError = '';
  } catch (error) {
    state.logsContent = '';
    state.logsGeneratedAt = '';
    state.logsError = error.message;
  } finally {
    state.logsLoading = false;
    renderLogsPanel();
  }
}

async function copyLogs() {
  if (!state.logsContent) {
    return;
  }
  const flash = document.getElementById('logs-flash');
  try {
    await navigator.clipboard.writeText(state.logsContent);
    if (flash) {
      flash.hidden = false;
      flash.dataset.tone = 'success';
      flash.textContent = 'Logs copied.';
    }
  } catch (error) {
    if (flash) {
      flash.hidden = false;
      flash.dataset.tone = 'error';
      flash.textContent = `Copy failed: ${error.message}`;
    }
  }
}

function updateVisionQualityPolling() {
  if (visionQualityTimer !== null) {
    window.clearInterval(visionQualityTimer);
    visionQualityTimer = null;
  }
  if (state.activeTab !== 'vision-quality') {
    return;
  }
  refreshVisionQuality();
  visionQualityTimer = window.setInterval(() => {
    refreshVisionQuality();
  }, 1000);
}

function updateLogsPolling() {
  if (logsTimer !== null) {
    window.clearInterval(logsTimer);
    logsTimer = null;
  }
  if (state.activeTab !== 'logs') {
    return;
  }
  if (!state.logsContent && !state.logsError) {
    refreshLogs();
  }
  if (!state.logsAutoRefresh) {
    return;
  }
  refreshLogs();
  logsTimer = window.setInterval(() => {
    refreshLogs();
  }, 3000);
}

async function refreshAll({ flash = false } = {}) {
  const [servicesPayload, settingsPayload, outputsPayload] = await Promise.all([
    fetchJson('/api/services'),
    fetchJson('/api/settings'),
    fetchJson('/api/audioref/outputs'),
  ]);

  state.tabs = servicesPayload.tabs;
  state.services = servicesPayload.services;
  state.settings = settingsPayload;
  state.outputs = outputsPayload.outputs;

  renderTabRail();
  renderPanels();
  updateEmbedPanels();
  updateTopbar();
  renderSettings();
  renderVisionQuality();
  renderLogsPanel();
  renderSummary();
  renderError(servicesPayload.summary);

  if (flash) {
    showFlash('状態を更新しました。');
  }
}

window.addEventListener('hashchange', () => {
  setActiveTab(getTabFromHash());
});

async function bootstrap() {
  try {
    await refreshAll();
    setActiveTab(getTabFromHash());
    window.setInterval(() => {
      refreshAll().catch((error) => {
        renderError({ error: error.message });
      });
    }, 10000);
  } catch (error) {
    renderError({ error: error.message });
  }
}

bootstrap();
