(function () {
  'use strict';

  const CONFIG_KEY = 'doTrashConfig';
  const STATS_KEY = 'doTrashStats';
  const POSITION_KEY = 'doTrashPosition';
  const CONFIG_VERSION = 1;
  const DEFAULT_POSITION = { top: 86, right: 18 };
  const DEFAULT_FLOATING_SIZE = 38;
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

  const SELECTORS = {
    topicRows: [
      'tr.topic-list-item',
      '[data-topic-id].topic-list-item',
      '.topic-list-item',
      '.fps-result',
      '.search-results .search-result',
      '.search-results [data-topic-id]'
    ],
    title: [
      'a.title',
      '.main-link a.title',
      '.title.raw-link',
      '.topic-list-data.main-link a',
      'a.search-link',
      '.fps-topic a[href^="/t/"]',
      '.search-result-topic a[href^="/t/"]',
      'a[href^="/t/"]'
    ],
    category: [
      '.category-name',
      '.badge-category__name',
      '.badge-category',
      '[class*="category"]'
    ],
    tags: [
      '.discourse-tag',
      '.list-tags a',
      '.topic-list-tags a',
      'a[href^="/tag/"]'
    ],
    authors: [
      '.posters a',
      '.posters img',
      'a[data-user-card]',
      '[data-user-card]',
      '.creator a',
      '.author a',
      '.username'
    ]
  };

  let config = clone(DEFAULT_CONFIG);
  let trashedPosts = [];
  let restoredTopicKeys = new Set();
  let lastScannedCount = 0;
  let scanTimer = 0;
  let observer = null;
  let dragState = null;
  let suppressToggleClick = false;
  let isDisposed = false;
  let ui = {};

  init();

  function init() {
    if (!hasExtensionContext()) return;
    loadConfig().then(() => {
      if (isDisposed) return;
      syncFloatingUi();
      scanNow();
      startObserver();
      bindStorageChanges();
    }).catch(handleAsyncError);
  }

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
    const incomingRules = incoming.rules && typeof incoming.rules === 'object' ? incoming.rules : {};
    const incomingUi = incoming.ui && typeof incoming.ui === 'object' ? incoming.ui : {};

    return {
      schemaVersion: CONFIG_VERSION,
      enabled: incoming.enabled === false ? false : true,
      ui: {
        floatingSize: normalizeFloatingSize(incomingUi.floatingSize),
        showFloating: incomingUi.showFloating === false ? false : true
      },
      rules: {
        keywords: normalizeRuleList(incomingRules.keywords),
        categories: normalizeRuleList(incomingRules.categories),
        tags: normalizeRuleList(incomingRules.tags),
        authors: normalizeRuleList(incomingRules.authors)
      }
    };
  }

  function normalizeFloatingSize(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_FLOATING_SIZE;
    return Math.min(Math.max(Math.round(number), 34), 56);
  }

  function hasExtensionContext() {
    return globalThis.doTrashCompat && globalThis.doTrashCompat.hasExtensionContext();
  }

  function isInvalidContextError(error) {
    const message = String(error && (error.message || error));
    return message.includes('Extension context invalidated') || message.includes('context invalidated');
  }

  function disposeInvalidContext() {
    if (isDisposed) return;
    isDisposed = true;
    window.clearTimeout(scanTimer);
    if (observer) observer.disconnect();
    document.removeEventListener('pointermove', moveDrag, true);
    document.removeEventListener('pointerup', endDrag, true);
    document.removeEventListener('pointercancel', endDrag, true);
    const root = ui.root || document.getElementById('do-trash-root');
    if (root) root.remove();
    const style = document.getElementById('do-trash-style');
    if (style) style.remove();
    observer = null;
    dragState = null;
    ui = {};
  }

  function handleAsyncError(error) {
    if (isInvalidContextError(error) || !hasExtensionContext()) {
      disposeInvalidContext();
      return;
    }
    throw error;
  }

  function storageGet(keys) {
    if (isDisposed || !hasExtensionContext()) {
      disposeInvalidContext();
      return Promise.resolve({});
    }
    try {
      return globalThis.doTrashCompat.storageGet(keys).catch((error) => {
        handleAsyncError(error);
        return {};
      });
    } catch (error) {
      handleAsyncError(error);
      return Promise.resolve({});
    }
  }

  function storageSet(value) {
    if (isDisposed || !hasExtensionContext()) {
      disposeInvalidContext();
      return Promise.resolve();
    }
    try {
      return globalThis.doTrashCompat.storageSet(value).catch(handleAsyncError);
    } catch (error) {
      handleAsyncError(error);
      return Promise.resolve();
    }
  }

  function loadConfig() {
    return storageGet([CONFIG_KEY]).then((result) => {
      if (isDisposed) return null;
      config = normalizeConfig(result[CONFIG_KEY]);
      return storageSet({ [CONFIG_KEY]: config });
    });
  }

  function bindStorageChanges() {
    if (isDisposed || !hasExtensionContext()) {
      disposeInvalidContext();
      return;
    }
    try {
      globalThis.doTrashCompat.storageOnChanged((changes, areaName) => {
        if (isDisposed) return;
        if (areaName !== 'local' || !changes[CONFIG_KEY]) return;
        config = normalizeConfig(changes[CONFIG_KEY].newValue);
        syncFloatingUi();
        restoredTopicKeys = new Set();
        rescanAll();
      });
    } catch (error) {
      handleAsyncError(error);
    }
  }

  function applyUiConfig() {
    if (isDisposed || !ui.root) return;
    const size = normalizeFloatingSize(config.ui && config.ui.floatingSize);
    ui.root.style.setProperty('--dt-floating-size', `${size}px`);
    ui.root.style.setProperty('--dt-floating-radius', `${Math.max(10, Math.round(size * 0.3))}px`);
    ui.root.style.setProperty('--dt-count-size', `${Math.min(22, Math.max(16, Math.round(size * 0.42)))}px`);
    ui.root.style.setProperty('--dt-count-font-size', `${Math.min(12, Math.max(10, Math.round(size * 0.24)))}px`);
    ui.root.style.setProperty('--dt-count-offset', `${Math.min(6, Math.max(3, Math.round(size * 0.1)))}px`);
    const rect = ui.root.getBoundingClientRect();
    applyPosition({ left: rect.left, top: rect.top });
    if (ui.panel && ui.panel.classList.contains('is-open')) positionPanel();
  }

  function shouldShowFloatingUi() {
    return config.ui && config.ui.showFloating !== false;
  }

  function syncFloatingUi() {
    if (isDisposed) return;
    if (!shouldShowFloatingUi()) {
      removeFloatingUi();
      return;
    }
    injectStyles();
    ensurePanel();
    if (ui.root) ui.root.hidden = false;
    applyUiConfig();
    renderTrash();
    loadPosition();
  }

  function removeFloatingUi() {
    const root = ui.root || document.getElementById('do-trash-root');
    if (!root) return;
    root.hidden = true;
    const panel = root.querySelector('#do-trash-panel');
    const toggle = root.querySelector('#do-trash-toggle');
    if (panel) panel.classList.remove('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function injectStyles() {
    if (isDisposed || !hasExtensionContext()) {
      disposeInvalidContext();
      return;
    }
    if (document.getElementById('do-trash-style')) return;

    const style = document.createElement('style');
    style.id = 'do-trash-style';
    style.textContent = `
      #do-trash-root {
        --dt-ink: #1c1c1e;
        --dt-ink-soft: #4b4b50;
        --dt-paper: #ffffff;
        --dt-paper-soft: #f8f8f5;
        --dt-panel: #f8f8f5;
        --dt-line: #deded8;
        --dt-line-soft: #ecece7;
        --dt-accent: #ffb003;
        --dt-accent-strong: #b87500;
        --dt-danger: #d14d41;
        --dt-success: #2f7d4f;
        --dt-shadow: rgba(28, 28, 30, 0.2);
        --dt-floating-size: 38px;
        --dt-floating-radius: 13px;
        --dt-count-size: 18px;
        --dt-count-font-size: 10px;
        --dt-count-offset: 4px;
        position: fixed;
        top: 86px;
        right: 18px;
        z-index: 2147483647;
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
        touch-action: none;
      }

      #do-trash-toggle {
        -webkit-user-select: none;
        position: relative;
        width: var(--dt-floating-size);
        height: var(--dt-floating-size);
        border: 0;
        border-radius: var(--dt-floating-radius);
        background: transparent;
        color: var(--dt-paper);
        cursor: grab;
        display: grid;
        place-items: center;
        padding: 0;
        user-select: none;
      }

      #do-trash-toggle:active {
        cursor: grabbing;
      }

      #do-trash-root.is-dragging #do-trash-toggle {
        cursor: grabbing;
      }

      #do-trash-root.is-snapping {
        transition: left 0.18s ease, top 0.18s ease;
      }

      .do-trash-toggle-mark {
        width: var(--dt-floating-size);
        height: var(--dt-floating-size);
        border-radius: var(--dt-floating-radius);
        display: block;
        filter: drop-shadow(0 14px 24px var(--dt-shadow));
        transition: transform 0.16s ease, filter 0.16s ease;
      }

      #do-trash-toggle:hover .do-trash-toggle-mark {
        filter: drop-shadow(0 18px 30px rgba(28, 28, 30, 0.28));
        transform: translateY(-1px);
      }

      #do-trash-toggle:active .do-trash-toggle-mark {
        transform: translateY(0);
      }

      #do-trash-count {
        position: absolute;
        min-width: var(--dt-count-size);
        height: var(--dt-count-size);
        top: calc(var(--dt-count-offset) * -1);
        left: auto;
        right: calc(var(--dt-count-offset) * -1);
        padding: 0 max(5px, calc(var(--dt-count-size) * 0.28));
        border-radius: 999px;
        border: 1px solid rgba(255, 176, 3, 0.72);
        background: #fff7df;
        color: var(--dt-accent-strong);
        font-size: var(--dt-count-font-size);
        line-height: calc(var(--dt-count-size) - 2px);
        font-weight: 800;
        box-sizing: border-box;
        box-shadow: 0 4px 12px rgba(197, 127, 0, 0.2);
        text-align: center;
      }

      #do-trash-root.is-docked-left #do-trash-count {
        left: auto;
        right: calc(var(--dt-count-offset) * -1);
      }

      #do-trash-root.is-docked-right #do-trash-count {
        left: calc(var(--dt-count-offset) * -1);
        right: auto;
      }

      #do-trash-panel {
        position: fixed;
        top: 152px;
        right: 18px;
        width: min(430px, calc(100vw - 28px));
        max-height: min(620px, calc(100vh - 132px));
        border: 1px solid var(--dt-line);
        border-radius: 10px;
        background: var(--dt-paper);
        box-shadow: 0 22px 56px rgba(28, 28, 30, 0.24);
        display: none;
        overflow: hidden;
      }

      #do-trash-panel.is-open {
        display: flex;
        flex-direction: column;
      }

      .do-trash-header {
        padding: 14px 14px 13px;
        border-bottom: 1px solid var(--dt-line-soft);
        background:
          linear-gradient(90deg, rgba(255, 176, 3, 0.16), rgba(255, 176, 3, 0)),
          var(--dt-panel);
        color: var(--dt-ink);
      }

      .do-trash-header-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .do-trash-brand {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }

      .do-trash-panel-mark {
        width: 38px;
        height: 38px;
        border-radius: 12px;
        display: block;
        flex: 0 0 auto;
      }

      .do-trash-title {
        margin: 0;
        color: var(--dt-ink);
        font-size: 15px;
        line-height: 20px;
        font-weight: 780;
        letter-spacing: 0;
      }

      .do-trash-subtitle {
        display: block;
        margin-top: 2px;
        color: var(--dt-ink-soft);
        font-size: 12px;
        line-height: 16px;
        font-weight: 500;
      }

      .do-trash-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
      }

      .do-trash-icon-btn {
        position: relative;
        width: 30px;
        height: 30px;
        border: 1px solid var(--dt-line);
        border-radius: 7px;
        background: var(--dt-paper);
        color: var(--dt-ink);
        cursor: pointer;
        display: grid;
        place-items: center;
        transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
      }

      .do-trash-icon-btn:hover {
        border-color: var(--dt-accent);
        background: rgba(255, 176, 3, 0.12);
        color: var(--dt-ink);
      }

      .do-trash-icon-btn svg {
        width: 15px;
        height: 15px;
      }

      .do-trash-icon-btn[data-tooltip]::after {
        content: attr(data-tooltip);
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        z-index: 1;
        min-width: max-content;
        padding: 5px 8px;
        border: 1px solid rgba(255, 176, 3, 0.32);
        border-radius: 6px;
        background: #1c1c1e;
        color: #f0f0f0;
        font-size: 12px;
        line-height: 16px;
        font-weight: 650;
        box-shadow: 0 8px 20px rgba(28, 28, 30, 0.22);
        opacity: 0;
        pointer-events: none;
        transform: translateY(-3px);
        transition: opacity 0.14s ease, transform 0.14s ease;
      }

      .do-trash-icon-btn[data-tooltip]:hover::after,
      .do-trash-icon-btn[data-tooltip]:focus-visible::after {
        opacity: 1;
        transform: translateY(0);
      }

      #do-trash-list {
        flex: 1 1 auto;
        min-height: 0;
        margin: 0;
        padding: 8px;
        list-style: none;
        overflow: auto;
        overscroll-behavior: contain;
        background: var(--dt-paper);
      }

      .do-trash-item {
        position: relative;
        padding: 11px;
        border: 1px solid var(--dt-line-soft);
        border-radius: 8px;
        background: var(--dt-paper);
        transition: background 0.14s ease, border-color 0.14s ease;
      }

      .do-trash-item::before {
        content: "";
        position: absolute;
        left: 0;
        top: 10px;
        bottom: 10px;
        width: 3px;
        border-radius: 0 999px 999px 0;
        background: var(--dt-accent);
      }

      .do-trash-item + .do-trash-item {
        margin-top: 8px;
      }

      .do-trash-item:hover {
        border-color: var(--dt-line);
        background: #fbfaf5;
      }

      .do-trash-item-main {
        min-width: 0;
      }

      .do-trash-link {
        color: var(--dt-ink);
        font-size: 13px;
        line-height: 18px;
        font-weight: 680;
        text-decoration: none;
        display: block;
        overflow-wrap: anywhere;
      }

      .do-trash-link:hover {
        color: var(--dt-accent-strong);
        text-decoration: none;
      }

      .do-trash-meta-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 8px;
      }

      .do-trash-meta {
        display: inline-flex;
        align-items: center;
        max-width: 100%;
        padding: 3px 8px;
        border: 1px solid rgba(255, 176, 3, 0.24);
        border-radius: 999px;
        background: rgba(255, 176, 3, 0.13);
        color: var(--dt-accent-strong);
        font-size: 12px;
        line-height: 16px;
        font-weight: 680;
        white-space: nowrap;
      }

      .do-trash-row-actions {
        display: flex;
        gap: 6px;
        flex: 0 0 auto;
      }

      .do-trash-text-btn {
        height: 28px;
        border: 1px solid var(--dt-line-soft);
        border-radius: 7px;
        padding: 0 8px;
        background: var(--dt-paper);
        color: var(--dt-ink-soft);
        cursor: pointer;
        font-size: 12px;
        line-height: 16px;
        font-weight: 650;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
      }

      .do-trash-text-btn:hover {
        border-color: var(--dt-accent);
        background: rgba(255, 176, 3, 0.1);
        color: var(--dt-ink);
        text-decoration: none;
      }

      .do-trash-text-btn.is-primary {
        color: var(--dt-success);
      }

      .do-trash-text-btn.is-danger {
        color: var(--dt-danger);
      }

      .do-trash-text-btn svg {
        width: 13px;
        height: 13px;
      }

      .do-trash-empty {
        padding: 34px 18px 36px;
        color: var(--dt-ink-soft);
        text-align: center;
        font-size: 13px;
        line-height: 20px;
      }

      .do-trash-empty-icon {
        width: 42px;
        height: 42px;
        margin: 0 auto 9px;
        border: 1px solid var(--dt-line);
        border-radius: 12px;
        color: var(--dt-accent-strong);
        background: rgba(255, 176, 3, 0.12);
        display: grid;
        place-items: center;
      }

      .do-trash-empty-icon svg {
        width: 20px;
        height: 20px;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function ensurePanel() {
    if (isDisposed || !hasExtensionContext()) {
      disposeInvalidContext();
      return;
    }
    let root = document.getElementById('do-trash-root');
    if (root) {
      collectUi(root);
      return;
    }

    root = document.createElement('section');
    root.id = 'do-trash-root';
    root.setAttribute('aria-label', 'do-trash 垃圾桶');

    const toggle = document.createElement('button');
    toggle.id = 'do-trash-toggle';
    toggle.type = 'button';
    toggle.title = '打开 do-trash 垃圾桶';
    toggle.setAttribute('aria-label', '打开 do-trash 垃圾桶');
    toggle.setAttribute('aria-expanded', 'false');
    const toggleMark = createAssetImage('assets/floating-icon.png', 'do-trash-toggle-mark', '');
    if (isDisposed || !toggleMark) return;
    toggle.appendChild(toggleMark);

    const count = document.createElement('span');
    count.id = 'do-trash-count';
    count.textContent = '0';
    toggle.appendChild(count);

    const panel = document.createElement('aside');
    panel.id = 'do-trash-panel';

    const header = document.createElement('div');
    header.className = 'do-trash-header';

    const headerMain = document.createElement('div');
    headerMain.className = 'do-trash-header-main';

    const brand = document.createElement('div');
    brand.className = 'do-trash-brand';
    const panelMark = createAssetImage('assets/floating-icon.png', 'do-trash-panel-mark', '');
    if (isDisposed || !panelMark) return;
    brand.appendChild(panelMark);

    const titleWrap = document.createElement('div');

    const title = document.createElement('h2');
    title.className = 'do-trash-title';
    title.textContent = '当前页垃圾桶';

    const subtitle = document.createElement('span');
    subtitle.className = 'do-trash-subtitle';
    subtitle.textContent = '处理本页已隐藏帖子';

    titleWrap.append(title, subtitle);
    brand.appendChild(titleWrap);

    const actions = document.createElement('div');
    actions.className = 'do-trash-actions';

    const restoreAll = createPanelIconButton('恢复当前页全部帖子', '恢复全部', iconUndo());
    const close = createPanelIconButton('关闭垃圾桶', '关闭面板', iconClose());

    try {
      actions.append(restoreAll, close);
      headerMain.append(brand, actions);
      header.appendChild(headerMain);
    } catch (error) {
      handleAsyncError(error);
      return;
    }

    const list = document.createElement('ul');
    list.id = 'do-trash-list';

    panel.append(header, list);
    root.append(toggle, panel);
    document.body.appendChild(root);

    collectUi(root);

    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      if (suppressToggleClick) {
        suppressToggleClick = false;
        return;
      }
      const isOpen = panel.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) positionPanel();
    });

    toggle.addEventListener('pointerdown', startDrag);

    panel.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    close.addEventListener('click', () => {
      panel.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    });

    restoreAll.addEventListener('click', () => {
      restoreAllCurrent();
    });

    document.addEventListener('click', () => {
      panel.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    });

    window.addEventListener('resize', () => {
      const rect = root.getBoundingClientRect();
      applyPosition({ left: rect.left, top: rect.top });
      if (panel.classList.contains('is-open')) positionPanel();
    });
  }

  function collectUi(root) {
    ui = {
      root,
      toggle: root.querySelector('#do-trash-toggle'),
      panel: root.querySelector('#do-trash-panel'),
      count: root.querySelector('#do-trash-count'),
      list: root.querySelector('#do-trash-list'),
      panelTitle: root.querySelector('.do-trash-title'),
      panelSubtitle: root.querySelector('.do-trash-subtitle')
    };
  }

  function loadPosition() {
    storageGet([POSITION_KEY]).then((result) => {
      if (isDisposed) return;
      const position = normalizePosition(result[POSITION_KEY]);
      applyPosition(position);
    });
  }

  function normalizePosition(value) {
    if (!value || !Number.isFinite(value.left) || !Number.isFinite(value.top)) return null;
    return {
      left: value.left,
      top: value.top
    };
  }

  function applyPosition(position) {
    if (!ui.root) return;
    const rootRect = ui.root.getBoundingClientRect();
    const size = normalizeFloatingSize(config.ui && config.ui.floatingSize);
    const width = rootRect.width || size;
    const height = rootRect.height || size;
    const fallbackLeft = window.innerWidth - DEFAULT_POSITION.right - width;
    const fallbackTop = DEFAULT_POSITION.top;
    const next = snapPosition(position || { left: fallbackLeft, top: fallbackTop }, width, height);
    ui.root.style.left = `${next.left}px`;
    ui.root.style.top = `${next.top}px`;
    ui.root.style.right = 'auto';
    updateDockState(next.left, width);
  }

  function updateDockState(left, width = normalizeFloatingSize(config.ui && config.ui.floatingSize)) {
    if (!ui.root) return;
    const isDockedRight = left + width / 2 >= window.innerWidth / 2;
    ui.root.classList.toggle('is-docked-right', isDockedRight);
    ui.root.classList.toggle('is-docked-left', !isDockedRight);
  }

  function clampPosition(position, width = normalizeFloatingSize(config.ui && config.ui.floatingSize), height = normalizeFloatingSize(config.ui && config.ui.floatingSize)) {
    const margin = 10;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    return {
      left: Math.min(Math.max(position.left, margin), maxLeft),
      top: Math.min(Math.max(position.top, margin), maxTop)
    };
  }

  function snapPosition(position, width = normalizeFloatingSize(config.ui && config.ui.floatingSize), height = normalizeFloatingSize(config.ui && config.ui.floatingSize)) {
    const margin = 10;
    const clamped = clampPosition(position, width, height);
    const centerX = clamped.left + width / 2;
    return {
      left: centerX < window.innerWidth / 2 ? margin : window.innerWidth - width - margin,
      top: clamped.top
    };
  }

  function startDrag(event) {
    if (event.button !== 0 || !ui.root) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = ui.root.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false
    };
    try {
      ui.toggle.setPointerCapture(event.pointerId);
    } catch (error) {
      // Some pages can interrupt pointer capture; document-level listeners keep dragging reliable.
    }
    ui.root.classList.add('is-dragging');
    document.addEventListener('pointermove', moveDrag, true);
    document.addEventListener('pointerup', endDrag, true);
    document.addEventListener('pointercancel', endDrag, true);
  }

  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) < 4) return;

    dragState.moved = true;
    suppressToggleClick = true;
    if (ui.panel) ui.panel.classList.remove('is-open');
    if (ui.toggle) ui.toggle.setAttribute('aria-expanded', 'false');

    const next = clampPosition({
      left: dragState.left + dx,
      top: dragState.top + dy
    });
    ui.root.style.left = `${next.left}px`;
    ui.root.style.top = `${next.top}px`;
    ui.root.style.right = 'auto';
    updateDockState(next.left);
  }

  function endDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const moved = dragState.moved;
    dragState = null;
    ui.root.classList.remove('is-dragging');
    try {
      ui.toggle.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Pointer capture may not exist if the page interrupted the gesture.
    }
    document.removeEventListener('pointermove', moveDrag, true);
    document.removeEventListener('pointerup', endDrag, true);
    document.removeEventListener('pointercancel', endDrag, true);

    if (!moved) return;
    const rect = ui.root.getBoundingClientRect();
    const size = normalizeFloatingSize(config.ui && config.ui.floatingSize);
    const next = snapPosition({ left: rect.left, top: rect.top }, rect.width || size, rect.height || size);
    ui.root.classList.add('is-snapping');
    ui.root.style.left = `${next.left}px`;
    ui.root.style.top = `${next.top}px`;
    ui.root.style.right = 'auto';
    updateDockState(next.left, rect.width || size);
    window.setTimeout(() => {
      if (ui.root) ui.root.classList.remove('is-snapping');
    }, 220);
    storageSet({
      [POSITION_KEY]: {
        left: Math.round(next.left),
        top: Math.round(next.top)
      }
    });
  }

  function positionPanel() {
    if (!ui.panel || !ui.toggle) return;
    const toggleRect = ui.toggle.getBoundingClientRect();
    const margin = 14;
    const panelWidth = Math.min(430, window.innerWidth - margin * 2);
    ui.panel.style.width = `${panelWidth}px`;

    const availableHeight = window.innerHeight - margin * 2;
    const maxPanelHeight = Math.min(620, Math.max(180, availableHeight));
    ui.panel.style.maxHeight = `${maxPanelHeight}px`;
    const panelRect = ui.panel.getBoundingClientRect();
    const panelHeight = Math.min(panelRect.height || maxPanelHeight, maxPanelHeight);

    const opensRight = toggleRect.left < window.innerWidth / 2;
    const preferredLeft = opensRight ? toggleRect.right + 12 : toggleRect.left - panelWidth - 12;
    const left = Math.min(Math.max(preferredLeft, margin), window.innerWidth - panelWidth - margin);
    const preferredTop = toggleRect.top + toggleRect.height / 2 - panelHeight / 2;
    const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin);
    const top = Math.min(Math.max(preferredTop, margin), maxTop);

    ui.panel.style.left = `${left}px`;
    ui.panel.style.top = `${top}px`;
    ui.panel.style.right = 'auto';
  }

  function createAssetImage(path, className, alt) {
    if (!hasExtensionContext()) {
      disposeInvalidContext();
      return null;
    }
    const image = document.createElement('img');
    image.className = className;
    try {
      image.src = globalThis.doTrashCompat.getURL(path);
    } catch (error) {
      handleAsyncError(error);
      return null;
    }
    image.alt = alt;
    image.decoding = 'async';
    image.draggable = false;
    return image;
  }

  function createPanelIconButton(label, tooltip, icon) {
    const button = document.createElement('button');
    button.className = 'do-trash-icon-btn';
    button.type = 'button';
    button.title = label;
    button.setAttribute('data-tooltip', tooltip);
    button.setAttribute('aria-label', label);
    button.appendChild(icon);
    return button;
  }

  function iconUndo() {
    return createIcon('M9 14H4v-5m0 0a8 8 0 1 1 2.34 5.66M4 9l4-4');
  }

  function iconClose() {
    return createIcon('M6 6l12 12M18 6L6 18');
  }

  function iconShield() {
    return createIcon('M12 3l7 3v5c0 5-3.3 8-7 10-3.7-2-7-5-7-10V6l7-3zM9.5 12l1.8 1.8L15 10');
  }

  function iconRestore() {
    return createIcon('M9 14H5v-4m0 0a7 7 0 1 1 2.05 4.95M5 10l3-3');
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

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
      const shouldScan = mutations.some((mutation) => {
        if (mutation.target && ui.root && ui.root.contains(mutation.target)) return false;
        return mutation.addedNodes.length || mutation.removedNodes.length;
      });
      if (shouldScan) scheduleScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function scheduleScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scanNow, 160);
  }

  function rescanAll() {
    restoreAllCurrent(false, false);
    trashedPosts = [];
    scanNow();
  }

  function scanNow() {
    const topics = getTopicRows();
    const nextPosts = [];
    lastScannedCount = topics.length;

    if (!config.enabled) {
      restoreAllCurrent(false);
      writeStats(0, lastScannedCount);
      renderTrash();
      return;
    }

    topics.forEach((row) => {
      const topic = extractTopic(row);
      if (!topic) return;

      if (restoredTopicKeys.has(topic.key)) {
        showRow(row);
        return;
      }

      const reason = getMatchReason(topic);
      if (!reason) {
        showRow(row);
        return;
      }

      row.dataset.doTrashHidden = 'true';
      row.style.display = 'none';
      nextPosts.push({ ...topic, reason, element: row });
    });

    trashedPosts = mergeTrashed(nextPosts);
    writeStats(trashedPosts.length, lastScannedCount);
    renderTrash();
  }

  function getTopicRows() {
    const rows = new Set();
    SELECTORS.topicRows.forEach((selector) => {
      document.querySelectorAll(selector).forEach((row) => rows.add(row));
    });
    return Array.from(rows).filter((row) => {
      return row instanceof HTMLElement && (!ui.root || !ui.root.contains(row));
    });
  }

  function firstMatch(root, selectors) {
    for (const selector of selectors) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  function allMatches(root, selectors) {
    const results = [];
    selectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach((node) => results.push(node));
    });
    return results;
  }

  function extractTopic(row) {
    const titleElement = firstMatch(row, SELECTORS.title);
    const title = normalizeText(titleElement && titleElement.textContent);
    if (!title) return null;

    const rawHref = titleElement.getAttribute('href') || '';
    const url = rawHref ? new URL(rawHref, location.origin).href : location.href;
    const topicId = normalizeText(row.getAttribute('data-topic-id')) || extractTopicId(url);
    const category = normalizeText(firstMatch(row, SELECTORS.category)?.textContent);
    const tags = uniqueTexts(allMatches(row, SELECTORS.tags).map((node) => node.textContent));
    const authors = uniqueTexts(allMatches(row, SELECTORS.authors).map((node) => {
      return node.getAttribute('data-user-card') || node.getAttribute('title') || node.getAttribute('alt') || node.textContent;
    }));

    return {
      key: topicId || url || title,
      topicId,
      title,
      url,
      category,
      tags,
      authors
    };
  }

  function extractTopicId(url) {
    const match = String(url).match(/\/t\/[^/]+\/(\d+)/);
    return match ? match[1] : '';
  }

  function uniqueTexts(values) {
    const seen = new Set();
    const result = [];
    values.forEach((value) => {
      const text = normalizeText(value);
      const key = normalizeKey(text);
      if (!text || seen.has(key)) return;
      seen.add(key);
      result.push(text);
    });
    return result;
  }

  function enabledValues(type) {
    return (config.rules[type] || [])
      .filter((rule) => rule && rule.enabled !== false && normalizeText(rule.value))
      .map((rule) => rule.value);
  }

  function getMatchReason(topic) {
    const titleKey = normalizeKey(topic.title);
    const categoryKey = normalizeKey(topic.category);
    const tagKeys = topic.tags.map(normalizeKey);
    const authorKeys = topic.authors.map(normalizeKey);

    for (const value of enabledValues('keywords')) {
      if (titleKey.includes(normalizeKey(value))) return `关键词: ${value}`;
    }

    for (const value of enabledValues('categories')) {
      if (categoryKey && categoryKey.includes(normalizeKey(value))) return `类别: ${value}`;
    }

    for (const value of enabledValues('tags')) {
      const key = normalizeKey(value);
      if (tagKeys.some((tag) => tag.includes(key))) return `标签: ${value}`;
    }

    for (const value of enabledValues('authors')) {
      const key = normalizeKey(value);
      if (authorKeys.some((author) => author.includes(key))) return `作者: ${value}`;
    }

    return '';
  }

  function mergeTrashed(nextPosts) {
    const byKey = new Map();
    trashedPosts.forEach((post) => {
      if (post.element && document.contains(post.element) && post.element.dataset.doTrashHidden === 'true') {
        byKey.set(post.key, post);
      }
    });
    nextPosts.forEach((post) => byKey.set(post.key, post));
    return Array.from(byKey.values());
  }

  function renderTrash() {
    if (!ui.count || !ui.list) return;

    ui.count.textContent = String(trashedPosts.length);
    renderPanelHeader();
    ui.list.replaceChildren();

    if (!trashedPosts.length) {
      const empty = document.createElement('li');
      empty.className = 'do-trash-empty';
      const icon = document.createElement('div');
      icon.className = 'do-trash-empty-icon';
      icon.appendChild(iconShield());
      const text = document.createElement('div');
      text.textContent = '当前页面很干净';
      empty.append(icon, text);
      ui.list.appendChild(empty);
      return;
    }

    trashedPosts.forEach((post) => {
      const item = document.createElement('li');
      item.className = 'do-trash-item';

      const main = document.createElement('div');
      main.className = 'do-trash-item-main';

      const link = document.createElement('a');
      link.className = 'do-trash-link';
      link.href = post.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = post.title;
      link.title = post.title;

      const meta = document.createElement('div');
      meta.className = 'do-trash-meta';
      meta.textContent = post.reason;

      const metaRow = document.createElement('div');
      metaRow.className = 'do-trash-meta-row';

      const actions = document.createElement('div');
      actions.className = 'do-trash-row-actions';

      const restore = document.createElement('button');
      restore.className = 'do-trash-text-btn';
      restore.classList.add('is-primary');
      restore.type = 'button';
      restore.append(iconRestore(), document.createTextNode('还原'));
      restore.addEventListener('click', () => restorePost(post));

      actions.appendChild(restore);
      metaRow.append(meta, actions);
      main.append(link, metaRow);
      item.appendChild(main);
      ui.list.appendChild(item);
    });
  }

  function renderPanelHeader() {
    if (ui.panelTitle) ui.panelTitle.textContent = trashedPosts.length ? `当前页垃圾桶 (${trashedPosts.length})` : '当前页垃圾桶';
    if (ui.panelSubtitle) {
      ui.panelSubtitle.textContent = trashedPosts.length
        ? '还原当前页隐藏帖子'
        : '当前页面没有隐藏帖子';
    }
  }

  function restorePost(post) {
    restoredTopicKeys.add(post.key);
    showRow(post.element);
    trashedPosts = trashedPosts.filter((item) => item.key !== post.key);
    writeStats(trashedPosts.length, getTopicRows().length);
    renderTrash();
  }

  function restoreAllCurrent(updateStats = true, rememberRestored = true) {
    trashedPosts.forEach((post) => {
      if (rememberRestored) restoredTopicKeys.add(post.key);
      showRow(post.element);
    });
    trashedPosts = [];
    if (updateStats) writeStats(0, getTopicRows().length);
    renderTrash();
  }

  function showRow(row) {
    if (!row) return;
    const hiddenByDoTrash = row.dataset.doTrashHidden === 'true';
    delete row.dataset.doTrashHidden;
    if (hiddenByDoTrash && row.style.display === 'none') row.style.display = '';
  }

  function writeStats(trashedCount, scannedCount) {
    storageSet({
      [STATS_KEY]: {
        trashedCount,
        scannedCount,
        updatedAt: Date.now(),
        url: location.href
      }
    });
  }
})();
