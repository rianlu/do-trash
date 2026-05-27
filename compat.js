(function (global) {
  'use strict';

  const runtime = resolveRuntime();
  const api = runtime && runtime.api;

  function resolveRuntime() {
    if (typeof browser !== 'undefined' && browser.runtime && browser.storage) {
      return { api: browser, mode: 'promise' };
    }
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.storage) {
      return { api: chrome, mode: 'callback' };
    }
    return null;
  }

  function runtimeError() {
    const error = api && api.runtime && api.runtime.lastError;
    return error ? new Error(error.message || String(error)) : null;
  }

  function callAsync(target, method, args = []) {
    if (!target || typeof target[method] !== 'function') return Promise.resolve(undefined);

    if (runtime && runtime.mode === 'promise') {
      try {
        return Promise.resolve(target[method].apply(target, args));
      } catch (error) {
        return Promise.reject(error);
      }
    }

    return new Promise((resolve, reject) => {
      try {
        target[method].apply(target, args.concat((result) => {
          const error = runtimeError();
          if (error) {
            reject(error);
            return;
          }
          resolve(result);
        }));
      } catch (error) {
        reject(error);
      }
    });
  }

  function hasExtensionContext() {
    try {
      return Boolean(api && api.runtime && api.runtime.id);
    } catch (error) {
      return false;
    }
  }

  function storageGet(keys) {
    return callAsync(api && api.storage && api.storage.local, 'get', [keys]);
  }

  function storageSet(value) {
    return callAsync(api && api.storage && api.storage.local, 'set', [value]);
  }

  function storageOnChanged(listener) {
    if (!api || !api.storage || !api.storage.onChanged) return;
    api.storage.onChanged.addListener(listener);
  }

  function getURL(path) {
    if (!api || !api.runtime || typeof api.runtime.getURL !== 'function') return path;
    return api.runtime.getURL(path);
  }

  function permissionsContains(permissions) {
    return callAsync(api && api.permissions, 'contains', [permissions]);
  }

  function permissionsRequest(permissions) {
    return callAsync(api && api.permissions, 'request', [permissions]);
  }

  function openOptionsPage() {
    return callAsync(api && api.runtime, 'openOptionsPage');
  }

  global.doTrashCompat = {
    getURL,
    hasExtensionContext,
    openOptionsPage,
    permissionsContains,
    permissionsRequest,
    storageGet,
    storageOnChanged,
    storageSet
  };
})(globalThis);
