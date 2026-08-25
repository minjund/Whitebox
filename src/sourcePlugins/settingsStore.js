'use strict';

const fs = require('fs');
const path = require('path');
const { restrictPathPermissions } = require('../dataRetention');

const SOURCE_PLUGIN_SETTINGS_VERSION = 3;
// Desktop toggles gate sessions the core monitor already reads (clientKind
// claude-desktop / codex-desktop); they have no monitor plugin of their own.
const DESKTOP_SOURCE_PLUGIN_IDS = Object.freeze(['builtin.claude-desktop', 'builtin.codex-desktop']);
const SUPPORTED_SOURCE_PLUGIN_IDS = Object.freeze(['builtin.opencode', 'builtin.aside', ...DESKTOP_SOURCE_PLUGIN_IDS]);
const DEFAULT_SETTINGS = Object.freeze({
  version: SOURCE_PLUGIN_SETTINGS_VERSION,
  enabledPluginIds: DESKTOP_SOURCE_PLUGIN_IDS,
  asideHistoryFolders: Object.freeze([]),
});

function desktopSourcePluginId(clientKind) {
  const kind = String(clientKind || '').toLowerCase();
  if (kind === 'claude-desktop') return 'builtin.claude-desktop';
  if (kind === 'codex-desktop') return 'builtin.codex-desktop';
  return '';
}

function normalizedEnabledPluginIds(value) {
  const supported = new Set(SUPPORTED_SOURCE_PLUGIN_IDS);
  const configured = Array.isArray(value && value.enabledPluginIds)
    ? value.enabledPluginIds
    : Object.entries(value && value.enabledPlugins || {})
      .filter(([, enabled]) => enabled === true)
      .map(([id]) => id);
  const ids = new Set(configured
    .map(item => String(item || '').trim())
    .filter(id => supported.has(id)));
  // Desktop app history was always visible before these toggles existed, so a
  // settings file that predates them (or is missing) means "keep showing" —
  // only a v3+ file that omits a desktop id records a deliberate opt-out.
  const version = Number(value && value.version);
  if (!Number.isFinite(version) || version < 3) {
    for (const id of DESKTOP_SOURCE_PLUGIN_IDS) ids.add(id);
  }
  return [...ids];
}

function normalizeSettings(value) {
  const folders = Array.isArray(value && value.asideHistoryFolders)
    ? value.asideHistoryFolders.map(item => String(item || '').trim()).filter(Boolean).map(item => path.resolve(item))
    : [];
  return {
    version: SOURCE_PLUGIN_SETTINGS_VERSION,
    enabledPluginIds: normalizedEnabledPluginIds(value),
    asideHistoryFolders: [...new Set(folders)].slice(0, 20),
  };
}

function isSourcePluginEnabled(settings, pluginId) {
  return normalizedEnabledPluginIds(settings).includes(String(pluginId || ''));
}

class SourcePluginSettingsStore {
  constructor(file) {
    this.file = file;
    this.value = normalizeSettings(DEFAULT_SETTINGS);
    this.load();
  }

  load() {
    try {
      this.value = normalizeSettings(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      this.value = normalizeSettings(DEFAULT_SETTINGS);
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      ...this.value,
      enabledPluginIds: [...this.value.enabledPluginIds],
      asideHistoryFolders: [...this.value.asideHistoryFolders],
    };
  }

  save(next) {
    const nextValue = normalizeSettings(next);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(nextValue, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.renameSync(temporary, this.file);
    } catch (_renameUnavailable) {
      // Windows can reject replacing an existing destination. Keep the update
      // recoverable without ever writing a partial JSON document in place.
      try {
        fs.copyFileSync(temporary, this.file);
      } finally {
        try { fs.unlinkSync(temporary); } catch {}
      }
    }
    restrictPathPermissions(this.file);
    this.value = nextValue;
    return this.snapshot();
  }

  addAsideHistoryFolder(folder) {
    const value = String(folder || '').trim();
    if (!value) throw new Error('Aside 작업 폴더를 선택하세요.');
    const resolved = path.resolve(value);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error('Aside 작업 폴더를 찾을 수 없습니다.');
    return this.save({ ...this.value, asideHistoryFolders: [...this.value.asideHistoryFolders, resolved] });
  }

  removeAsideHistoryFolder(folder) {
    const value = String(folder || '').trim();
    if (!value) return this.snapshot();
    const resolved = path.resolve(value);
    return this.save({ ...this.value, asideHistoryFolders: this.value.asideHistoryFolders.filter(item => item !== resolved) });
  }

  setPluginEnabled(pluginId, enabled) {
    const id = String(pluginId || '').trim();
    if (!SUPPORTED_SOURCE_PLUGIN_IDS.includes(id)) throw new Error('지원하지 않는 source plugin입니다.');
    const next = new Set(this.value.enabledPluginIds);
    if (enabled === true) next.add(id);
    else next.delete(id);
    return this.save({ ...this.value, enabledPluginIds: [...next] });
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  DESKTOP_SOURCE_PLUGIN_IDS,
  SOURCE_PLUGIN_SETTINGS_VERSION,
  SUPPORTED_SOURCE_PLUGIN_IDS,
  SourcePluginSettingsStore,
  desktopSourcePluginId,
  isSourcePluginEnabled,
  normalizeSettings,
  normalizedEnabledPluginIds,
};
