const state = {
  tabs: [],
  services: [],
  settings: null,
  outputs: [],
  activeTab: 'game-controller',
  settingsBusy: false,
};

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
}

function serviceByTab(tabId) {
  return state.services.find((service) => service.tabId === tabId) ?? null;
}

function serviceLabelForTab(tabId) {
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
      <iframe title="${service.label}" src="${service.url}" loading="lazy"></iframe>
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
        <p>一覧はホストの <code>/proc/asound</code> から生成しています。<code>default</code> はホスト既定の出力先を使います。</p>
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

  for (const tab of getVisibleTabs()) {
    if (tab.id === 'settings') {
      panelStack.appendChild(createSettingsPanel());
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
    option.textContent = `${value} (saved value)`;
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
  updateEmbedPanels();
  updateTopbar();
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
