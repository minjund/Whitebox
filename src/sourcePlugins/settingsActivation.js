'use strict';

function boundedError(error) {
  return String(error && error.message || error || '알 수 없는 오류').replace(/\u0000/g, '').slice(0, 1000);
}

async function applySourcePluginEnabled(options, pluginId, enabled) {
  const {
    store,
    host,
    restartMonitor,
    reportError = () => {},
  } = options || {};
  if (!store || typeof store.setPluginEnabled !== 'function') throw new Error('source plugin 설정 저장소가 준비되지 않았습니다.');
  if (!host || typeof host.refresh !== 'function') throw new Error('source plugin 제어기가 준비되지 않았습니다.');
  if (typeof restartMonitor !== 'function') throw new Error('source plugin 감시기를 다시 시작할 수 없습니다.');

  // A disabled plugin is removed from the monitor and renderer immediately,
  // so an app-owned child would otherwise lose its only visible stop control.
  // Keep activation unchanged until every managed task has exited.
  if (enabled !== true && typeof host.assertPluginCanDisable === 'function') {
    host.assertPluginCanDisable(pluginId);
  }
  store.setPluginEnabled(pluginId, enabled === true);
  const warnings = [];
  let sources = typeof host.listSources === 'function' ? host.listSources() : [];
  try {
    sources = await host.refresh({ force: true });
  } catch (error) {
    warnings.push(`control refresh: ${boundedError(error)}`);
    reportError('source-plugin-control-refresh', error);
    if (typeof host.listSources === 'function') sources = host.listSources();
  }

  // The persisted opt-in value is authoritative. Even when connector cleanup
  // fails, restart (or stop) the history worker with that value so disabled
  // records cannot remain visible and the renderer never rolls back to stale UI.
  try {
    await restartMonitor();
  } catch (error) {
    warnings.push(`monitor restart: ${boundedError(error)}`);
    reportError('source-plugin-worker-restart', error);
  }

  return {
    ok: true,
    settings: store.snapshot(),
    sources: Array.isArray(sources) ? sources : [],
    warning: warnings.join(' '),
  };
}

module.exports = { applySourcePluginEnabled, boundedError };
