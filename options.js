const CONFIG_KEY = 'doTrashConfig';
const CONFIG_VERSION = 1;
const DEFAULT_FLOATING_SIZE = 38;
const DEFAULT_CONFIG = {
  schemaVersion: CONFIG_VERSION,
  enabled: true,
  ui: {
    floatingSize: DEFAULT_FLOATING_SIZE
  },
  rules: {
    keywords: [],
    categories: [],
    tags: [],
    authors: []
  }
};

const RULE_TYPES = ['keywords', 'categories', 'tags', 'authors'];
const message = document.getElementById('message');
const importText = document.getElementById('import-text');

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
      floatingSize: normalizeFloatingSize(ui.floatingSize)
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
  bindEvents();
  render();
}

async function loadConfig() {
  const result = await chrome.storage.local.get([CONFIG_KEY]);
  config = normalizeConfig(result[CONFIG_KEY]);
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

function bindEvents() {
  document.querySelectorAll('[data-add]').forEach((button) => {
    button.addEventListener('click', () => addRule(button.dataset.add));
  });

  document.querySelectorAll('[data-input]').forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') addRule(input.dataset.input);
    });
  });

  document.getElementById('export-config').addEventListener('click', exportConfig);
  document.getElementById('import-config').addEventListener('click', importConfig);
  document.getElementById('clear-import').addEventListener('click', () => {
    importText.value = '';
    setMessage('导入区已清空');
  });
  document.getElementById('reset-config').addEventListener('click', resetConfig);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[CONFIG_KEY]) return;
    config = normalizeConfig(changes[CONFIG_KEY].newValue);
    render();
  });
}

function listFor(type) {
  if (RULE_TYPES.includes(type)) return config.rules[type];
  return [];
}

function render() {
  RULE_TYPES.forEach((type) => {
    const list = listFor(type);
    const listElement = document.querySelector(`[data-list="${type}"]`);
    const countElement = document.querySelector(`[data-count="${type}"]`);

    countElement.textContent = `${list.length} 条`;
    listElement.replaceChildren();

    if (!list.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '暂无规则';
      listElement.appendChild(empty);
      return;
    }

    list.forEach((rule, index) => {
      listElement.appendChild(createRuleItem(type, rule, index));
    });
  });
}

function createRuleItem(type, rule, index) {
  const item = document.createElement('li');

  const switchLabel = document.createElement('label');
  switchLabel.className = 'switch';
  switchLabel.title = rule.enabled === false ? '启用规则' : '停用规则';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = rule.enabled !== false;
  checkbox.addEventListener('change', () => toggleRule(type, index, checkbox.checked));

  const slider = document.createElement('span');
  slider.className = 'slider';
  switchLabel.append(checkbox, slider);

  const value = document.createElement('span');
  value.className = rule.enabled === false ? 'rule-value disabled' : 'rule-value';
  value.textContent = rule.value;

  const remove = document.createElement('button');
  remove.className = 'icon danger';
  remove.type = 'button';
  remove.title = '删除规则';
  remove.setAttribute('aria-label', '删除规则');
  remove.appendChild(createIcon('M3 6h18M8 6V4h8v2M7 6l1 15h8l1-15M10 11v6M14 11v6'));
  remove.addEventListener('click', () => removeRule(type, index));

  item.append(switchLabel, value, remove);
  return item;
}

function createIcon(pathData) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('d', pathData);
  svg.appendChild(path);
  return svg;
}

async function addRule(type) {
  const input = document.querySelector(`[data-input="${type}"]`);
  const value = normalizeText(input.value);
  if (!value) {
    setMessage('请输入规则内容');
    return;
  }

  const list = listFor(type);
  const existing = new Set(list.map((rule) => normalizeKey(rule.value)));
  if (!existing.has(normalizeKey(value))) {
    list.push({ value, enabled: true });
  }

  input.value = '';
  await saveConfig('规则已保存');
}

async function toggleRule(type, index, enabled) {
  const list = listFor(type);
  if (!list[index]) return;
  list[index].enabled = enabled;
  await saveConfig('规则已更新');
}

async function removeRule(type, index) {
  const list = listFor(type);
  list.splice(index, 1);
  await saveConfig('规则已删除');
}

async function saveConfig(text) {
  config = normalizeConfig(config);
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
  render();
  setMessage(text);
}

function exportConfig() {
  importText.value = JSON.stringify(normalizeConfig(config), null, 2);
  importText.focus();
  importText.select();
  setMessage('配置已生成到导入区');
}

async function importConfig() {
  let parsed;
  try {
    parsed = JSON.parse(importText.value);
  } catch (error) {
    setMessage('JSON 格式无效');
    return;
  }

  config = normalizeConfig(parsed);
  await saveConfig('配置已导入');
}

async function resetConfig() {
  const confirmed = window.confirm('确认重置为默认配置?');
  if (!confirmed) return;

  config = clone(DEFAULT_CONFIG);
  await saveConfig('已重置默认配置');
}

function setMessage(text) {
  message.textContent = text;
  window.clearTimeout(setMessage.timer);
  setMessage.timer = window.setTimeout(() => {
    message.textContent = '';
  }, 2200);
}
