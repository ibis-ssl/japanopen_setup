const state = {
  tabs: [],
  services: [],
  settings: null,
  outputs: [],
  activeTab: 'overview',
  settingsBusy: false,
};

const tabRail = document.getElementById('tab-rail');
const panelStack = document.getElementById('panel-stack');
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

function setActiveTab(tabId) {
  const validTabIds = new Set(state.tabs.map((tab) => tab.id));
  const safeTabId = validTabIds.has(tabId) ? tabId : 'overview';

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
}

function serviceByTab(tabId) {
  return state.services.find((service) => service.tabId === tabId) ?? null;
}

function serviceLabelForTab(tabId) {
  if (tabId === 'overview') {
    return '';
  }
  if (tabId === 'settings') {
    return state.services.find((service) => service.id === 'audioref')?.state ?? '';
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
    for (const tab of state.tabs) {
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

function createOverviewPanel() {
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.dataset.panelId = 'overview';
  panel.innerHTML = `
    <div class="panel__header">
      <div>
        <h2 class="panel__title">Overview</h2>
        <p class="panel__copy">
          Web UI の起動状態、バックグラウンドサービスの状況、直接オープン用リンクを一覧します。
        </p>
      </div>
    </div>
    <div class="overview-grid" id="overview-grid"></div>
  `;
  return panel;
}

function createEmbedPanel(tab) {
  const service = serviceByTab(tab.id);
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.dataset.panelId = tab.id;
  panel.dataset.serviceId = service.id;
  panel.innerHTML = `
    <div class="panel__header">
      <div>
        <h2 class="panel__title">${service.label}</h2>
        <p class="panel__copy">${service.summary}</p>
      </div>
      <div class="pill-row">
        <span class="status-pill" data-role="status-pill"></span>
        <a class="ghost-link" data-role="open-link" href="${service.url}" target="_blank" rel="noreferrer">Open directly</a>
      </div>
    </div>
    <div class="embed-shell" data-role="embed-shell" data-running="${String(isServiceRunning(service))}">
      <div class="embed-shell__overlay">
        <strong data-role="overlay-title"></strong>
        <p data-role="overlay-copy"></p>
      </div>
      <iframe title="${service.label}" src="${service.url}" loading="lazy"></iframe>
    </div>
  `;
  return panel;
}

function createSettingsPanel() {
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.dataset.panelId = 'settings';
  panel.innerHTML = `
    <div class="panel__header">
      <div>
        <h2 class="panel__title">Settings</h2>
        <p class="panel__copy">
          AudioRef の ALSA 出力先を <code>.env</code> に保存し、対象コンテナだけを再作成して反映します。
        </p>
      </div>
      <div class="pill-row">
        <span class="status-pill" data-role="settings-status"></span>
      </div>
    </div>
    <div class="settings-layout">
      <section class="settings-card">
        <h3>AudioRef Output</h3>
        <p>一覧はホストの <code>/proc/asound</code> から生成しています。<code>default</code> は Analog / Speaker 系を優先し、無ければ最初の playback PCM を自動選択します。</p>
        <form id="audioref-form">
          <div class="form-grid">
            <div>
              <label class="field-label" for="output-pcm">PCM Output</label>
              <select class="select-input" id="output-pcm" name="outputPcm"></select>
              <div class="field-help" id="output-help"></div>
            </div>
          </div>
          <div class="form-actions">
            <button class="solid-button" type="submit" id="save-button">Save And Recreate AudioRef</button>
            <button class="ghost-button" type="button" id="reload-button">Reload Status</button>
          </div>
        </form>
        <div class="flash" id="settings-flash" hidden></div>
      </section>
      <aside class="settings-side">
        <h3>Notes</h3>
        <p>SimpleAudio 自体は出力デバイス選択 API を持たないため、コンテナ内の ALSA 既定 PCM を差し替えて制御します。</p>
        <div class="inline-list">
          <div class="inline-item">
            <strong>Save target</strong>
            <code>.env</code> に <code>AUDIOREF_OUTPUT_PCM</code> を保存します。<code>.env</code> が無い場合は <code>.env.example</code> を元に作成します。
          </div>
          <div class="inline-item">
            <strong>Apply path</strong>
            <code>./scripts/ops.sh up --force-recreate audioref</code> 相当で <code>audioref</code> だけを再作成します。
          </div>
        </div>
      </aside>
    </div>
  `;

  panel.querySelector('#audioref-form').addEventListener('submit', handleSettingsSubmit);
  panel.querySelector('#reload-button').addEventListener('click', () => refreshAll({ flash: false }));
  return panel;
}

function renderPanels() {
  if (panelStack.children.length) {
    return;
  }

  for (const tab of state.tabs) {
    if (tab.id === 'overview') {
      panelStack.appendChild(createOverviewPanel());
      continue;
    }
    if (tab.id === 'settings') {
      panelStack.appendChild(createSettingsPanel());
      continue;
    }
    panelStack.appendChild(createEmbedPanel(tab));
  }
}

function renderOverview() {
  const grid = document.getElementById('overview-grid');
  if (!grid) {
    return;
  }

  grid.innerHTML = '';
  for (const service of state.services) {
    const card = document.createElement('article');
    card.className = 'service-card';
    const actionLink = service.url
      ? `<a class="ghost-link" href="${service.url}" target="_blank" rel="noreferrer">Open</a>`
      : '';
    const inlineTab = service.tabId
      ? `<button class="ghost-button" type="button" data-jump-tab="${service.tabId}">View Here</button>`
      : '';

    card.innerHTML = `
      <div class="service-card__header">
        <div>
          <h3>${service.label}</h3>
          <p class="service-card__summary">${service.summary}</p>
        </div>
        <span class="status-pill" data-state="${service.state}">${formatState(service.state)}</span>
      </div>
      <div class="service-card__footer">
        ${actionLink}
        ${inlineTab}
      </div>
    `;

    const jumpButton = card.querySelector('[data-jump-tab]');
    if (jumpButton) {
      jumpButton.addEventListener('click', () => setActiveTab(service.tabId));
    }
    grid.appendChild(card);
  }
}

function updateEmbedPanels() {
  for (const panel of panelStack.querySelectorAll('[data-service-id]')) {
    const service = state.services.find((item) => item.id === panel.dataset.serviceId);
    if (!service) {
      continue;
    }

    const pill = panel.querySelector('[data-role="status-pill"]');
    pill.dataset.state = service.state;
    pill.textContent = formatState(service.state);

    const link = panel.querySelector('[data-role="open-link"]');
    link.href = service.url;

    const shell = panel.querySelector('[data-role="embed-shell"]');
    shell.dataset.running = String(isServiceRunning(service));

    const overlayTitle = panel.querySelector('[data-role="overlay-title"]');
    const overlayCopy = panel.querySelector('[data-role="overlay-copy"]');
    if (isServiceRunning(service)) {
      overlayTitle.textContent = 'Inline view is active.';
      overlayCopy.textContent = '表示されない場合は Open directly を使ってください。埋め込み拒否のある UI もあります。';
    } else {
      overlayTitle.textContent = `Service is ${formatState(service.state).toLowerCase()}.`;
      overlayCopy.textContent = service.statusText || 'まだコンテナが作成されていません。';
    }
  }
}

function ensureCustomOutputOption(select, value) {
  const hasOption = Array.from(select.options).some((option) => option.value === value);
  if (!hasOption && value) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = `${value} (saved value)`;
    select.appendChild(option);
  }
}

function renderSettings() {
  const panel = panelStack.querySelector('[data-panel-id="settings"]');
  if (!panel || !state.settings) {
    return;
  }

  const audioref = state.services.find((service) => service.id === 'audioref');
  const status = panel.querySelector('[data-role="settings-status"]');
  status.dataset.state = audioref?.state ?? 'unknown';
  status.textContent = audioref ? `AudioRef: ${formatState(audioref.state)}` : 'AudioRef: Unknown';

  const select = panel.querySelector('#output-pcm');
  const help = panel.querySelector('#output-help');
  const saveButton = panel.querySelector('#save-button');
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
  help.textContent = `Current saved value: ${currentValue}`;

  saveButton.disabled = state.settingsBusy;
  reloadButton.disabled = state.settingsBusy;
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
  renderOverview();
  updateEmbedPanels();
  renderSettings();
  renderSummary();
  renderError(servicesPayload.summary);

  if (flash) {
    showFlash('状態を更新しました。');
  }
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  const select = document.getElementById('output-pcm');
  const outputPcm = select.value;

  state.settingsBusy = true;
  renderSettings();
  showFlash('AudioRef を再作成しています...', 'success');

  try {
    await fetchJson('/api/settings/audioref', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputPcm }),
    });
    await refreshAll();
    showFlash(`AUDIOREF_OUTPUT_PCM を ${outputPcm} に更新しました。`);
  } catch (error) {
    showFlash(error.message, 'error');
  } finally {
    state.settingsBusy = false;
    renderSettings();
  }
}

window.addEventListener('hashchange', () => {
  const nextTab = window.location.hash.replace(/^#/, '') || 'overview';
  setActiveTab(nextTab);
});

async function bootstrap() {
  try {
    await refreshAll();
    const initialTab = window.location.hash.replace(/^#/, '') || 'overview';
    setActiveTab(initialTab);
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
