const CONFIG_KEY = 'doTrashConfig';
const STATS_KEY = 'doTrashStats';
const CONFIG_VERSION = 1;
const DEFAULT_FLOATING_SIZE = 38;
const HOST_PERMISSION = { origins: ['https://linux.do/*'] };
const DEFAULT_CONFIG = {
  schemaVersion: CONFIG_VERSION,
  enabled: true,
  ui: {
    floatingSize: DEFAULT_FLOATING_SIZE,
    showFloating: true
  },
  rules: {
    keywords: [],
    categories: [],
    tags: [],
    authors: []
  }
};

const enabledInput = document.getElementById('enabled');
const keywordInput = document.getElementById('keyword');
const addKeywordButton = document.getElementById('add-keyword');
const openOptionsButton = document.getElementById('open-options');
const showFloatingInput = document.getElementById('show-floating');
const floatingSizeToggle = document.getElementById('floating-size-toggle');
const floatingSizePanel = document.getElementById('floating-size-panel');
const floatingSizeValue = document.getElementById('floating-size-value');
const floatingSizePreview = document.getElementById('floating-size-preview');
const decreaseFloatingSizeButton = document.getElementById('decrease-floating-size');
const increaseFloatingSizeButton = document.getElementById('increase-floating-size');
const resetFloatingSizeButton = document.getElementById('reset-floating-size');
const trashedCount = document.getElementById('trashed-count');
const scannedCount = document.getElementById('scanned-count');
const message = document.getElementById('message');
const statusText = document.getElementById('status-text');
const permissionSetting = document.getElementById('permission-setting');
const grantPermissionButton = document.getElementById('grant-permission');

let config = clone(DEFAULT_CONFIG);

document.addEventListener('DOMContentLoaded', init);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLocaleLowerCase();
}

function normalizeRuleList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const normalized = [];

  list.forEach((item) => {
    const rawValue = typeof item === 'string' ? item : item && item.value;
    const value = normalizeText(rawValue);
    const key = normalizeKey(value);
    if (!value || seen.has(key)) return;
    seen.add(key);
    normalized.push({
      value,
      enabled: typeof item === 'object' && item !== null && item.enabled === false ? false : true
    });
  });

  return normalized;
}

function normalizeConfig(value) {
  const incoming = value && typeof value === 'object' ? value : {};
  const rules = incoming.rules && typeof incoming.rules === 'object' ? incoming.rules : {};
  const ui = incoming.ui && typeof incoming.ui === 'object' ? incoming.ui : {};

  return {
    schemaVersion: CONFIG_VERSION,
    enabled: incoming.enabled === false ? false : true,
    ui: {
      floatingSize: normalizeFloatingSize(ui.floatingSize),
      showFloating: ui.showFloating === false ? false : true
    },
    rules: {
      keywords: normalizeRuleList(rules.keywords),
      categories: normalizeRuleList(rules.categories),
      tags: normalizeRuleList(rules.tags),
      authors: normalizeRuleList(rules.authors)
    }
  };
}

function normalizeFloatingSize(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_FLOATING_SIZE;
  return Math.min(Math.max(Math.round(number), 34), 56);
}

async function init() {
  await loadConfig();
  await loadStats();
  await renderHostPermission();
  bindEvents();
}

async function loadConfig() {
  const result = await globalThis.doTrashCompat.storageGet([CONFIG_KEY]);
  config = normalizeConfig(result[CONFIG_KEY]);
  await globalThis.doTrashCompat.storageSet({ [CONFIG_KEY]: config });
  enabledInput.checked = config.enabled;
  showFloatingInput.checked = config.ui.showFloating;
  renderStatus();
  renderFloatingSettings();
}

async function loadStats() {
  const result = await globalThis.doTrashCompat.storageGet([STATS_KEY]);
  const stats = result[STATS_KEY] || {};
  trashedCount.textContent = String(Number.isFinite(stats.trashedCount) ? stats.trashedCount : 0);
  scannedCount.textContent = String(Number.isFinite(stats.scannedCount) ? stats.scannedCount : 0);
}

function bindEvents() {
  enabledInput.addEventListener('change', async () => {
    config.enabled = enabledInput.checked;
    await saveConfig('状态已更新');
  });

  showFloatingInput.addEventListener('change', async () => {
    if (!config.ui) config.ui = {};
    config.ui.showFloating = showFloatingInput.checked;
    await saveConfig(showFloatingInput.checked ? '悬浮垃圾桶已显示' : '悬浮垃圾桶已隐藏');
  });

  grantPermissionButton.addEventListener('click', requestHostPermission);

  addKeywordButton.addEventListener('click', addKeyword);
  keywordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addKeyword();
  });

  floatingSizeToggle.addEventListener('click', toggleFloatingSizePanel);
  decreaseFloatingSizeButton.addEventListener('click', () => adjustFloatingSize(-2));
  increaseFloatingSizeButton.addEventListener('click', () => adjustFloatingSize(2));
  resetFloatingSizeButton.addEventListener('click', resetFloatingSize);

  openOptionsButton.addEventListener('click', () => {
    globalThis.doTrashCompat.openOptionsPage();
  });

  globalThis.doTrashCompat.storageOnChanged((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[STATS_KEY]) loadStats();
    if (changes[CONFIG_KEY]) {
      config = normalizeConfig(changes[CONFIG_KEY].newValue);
      enabledInput.checked = config.enabled;
      showFloatingInput.checked = config.ui.showFloating;
      renderStatus();
      renderFloatingSettings();
    }
  });
}

async function renderHostPermission() {
  const granted = await hasHostPermission();
  permissionSetting.hidden = granted;
}

async function hasHostPermission() {
  if (!globalThis.doTrashCompat.permissionsContains) return true;
  try {
    return await globalThis.doTrashCompat.permissionsContains(HOST_PERMISSION);
  } catch (error) {
    return true;
  }
}

async function requestHostPermission() {
  const granted = await globalThis.doTrashCompat.permissionsRequest(HOST_PERMISSION);
  permissionSetting.hidden = granted;
  setMessage(granted ? '已授权, 请刷新 LINUX.DO 页面' : '未完成站点授权', granted ? 'success' : 'warning');
}

async function addKeyword() {
  const value = normalizeText(keywordInput.value);
  if (!value) {
    setMessage('请输入关键词', 'warning');
    return;
  }

  const existing = new Set(config.rules.keywords.map((rule) => normalizeKey(rule.value)));
  if (!existing.has(normalizeKey(value))) {
    config.rules.keywords.push({ value, enabled: true });
  }

  keywordInput.value = '';
  await saveConfig('关键词已添加');
}

async function saveConfig(text) {
  config = normalizeConfig(config);
  await globalThis.doTrashCompat.storageSet({ [CONFIG_KEY]: config });
  renderStatus();
  renderFloatingSettings();
  setMessage(text);
}

function renderStatus() {
  statusText.textContent = config.enabled ? '运行中' : '已暂停';
}

function renderFloatingSettings() {
  const showFloating = config.ui && config.ui.showFloating !== false;
  const size = normalizeFloatingSize(config.ui && config.ui.floatingSize);
  const text = `${size} px`;
  showFloatingInput.checked = showFloating;
  floatingSizeToggle.disabled = !showFloating;
  decreaseFloatingSizeButton.disabled = !showFloating;
  increaseFloatingSizeButton.disabled = !showFloating;
  resetFloatingSizeButton.disabled = !showFloating;
  floatingSizeValue.textContent = text;
  floatingSizePreview.textContent = text;

  if (!showFloating && floatingSizePanel.classList.contains('is-open')) {
    floatingSizePanel.classList.remove('is-open');
    floatingSizeToggle.setAttribute('aria-expanded', 'false');
  }
}

function toggleFloatingSizePanel() {
  if (config.ui && config.ui.showFloating === false) return;
  const isOpen = floatingSizePanel.classList.toggle('is-open');
  floatingSizeToggle.setAttribute('aria-expanded', String(isOpen));
}

async function adjustFloatingSize(delta) {
  if (!config.ui) config.ui = {};
  if (config.ui.showFloating === false) return;
  const nextSize = normalizeFloatingSize(config.ui.floatingSize + delta);
  if (nextSize === config.ui.floatingSize) return;
  config.ui.floatingSize = nextSize;
  await saveConfig('悬浮图标大小已更新');
}

async function resetFloatingSize() {
  if (!config.ui) config.ui = {};
  if (config.ui.showFloating === false) return;
  if (config.ui.floatingSize === DEFAULT_FLOATING_SIZE) return;
  config.ui.floatingSize = DEFAULT_FLOATING_SIZE;
  await saveConfig('悬浮图标大小已重置');
}

function setMessage(text, tone = 'success') {
  message.textContent = text;
  message.dataset.tone = tone;
  message.classList.toggle('is-visible', Boolean(text));
  window.clearTimeout(setMessage.timer);
  setMessage.timer = window.setTimeout(() => {
    message.textContent = '';
    message.classList.remove('is-visible');
  }, 1800);
}
