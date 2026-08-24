'use strict';

const {
  OmoOpenCodeMonitor,
  attachOpenCodeHierarchy,
  openCodeDbPath,
  openCodeDbPaths,
} = require('../omo');
const { OPENCODE_MANIFEST, OPENCODE_PLUGIN_ID } = require('./manifest');

function replaceOmoLabel(value, fallback) {
  const text = String(value || '');
  if (!text) return fallback || text;
  return text
    .replace(/^OMO · OpenCode$/, 'OpenCode')
    .replace(/^OMO (?=하위 작업)/, 'OpenCode ')
    .replace(/\bOMO (?=프로세스)/g, 'OpenCode ');
}

/**
 * The shared OpenCode parser predates this direct adapter and therefore emits
 * OMO provenance by default. Rebrand every identity-bearing field while
 * preserving the parsed conversation, timestamps, hierarchy, and controls.
 */
function asOpenCodeSession(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const collaboration = raw.collaboration && typeof raw.collaboration === 'object'
    ? {
      ...raw.collaboration,
      spawns: Array.isArray(raw.collaboration.spawns)
        ? raw.collaboration.spawns.map(spawn => ({
          ...spawn,
          taskName: replaceOmoLabel(spawn.taskName, 'OpenCode 하위 작업'),
        }))
        : [],
      communications: Array.isArray(raw.collaboration.communications)
        ? raw.collaboration.communications.map(message => ({
          ...message,
          label: replaceOmoLabel(message.label, 'OpenCode 하위 작업 배정'),
          from: message.from === 'OMO' ? 'OpenCode' : message.from,
          taskName: replaceOmoLabel(message.taskName, 'OpenCode 하위 작업'),
        }))
        : [],
    }
    : raw.collaboration;
  const controls = raw.controlUnavailableReasons && typeof raw.controlUnavailableReasons === 'object'
    ? Object.fromEntries(Object.entries(raw.controlUnavailableReasons).map(([key, value]) => [
      key,
      replaceOmoLabel(value),
    ]))
    : raw.controlUnavailableReasons;
  const executions = Array.isArray(raw.executions)
    ? raw.executions.map(execution => ({
      ...execution,
      source: execution.source === 'omo-opencode-tool' ? 'opencode-tool' : execution.source,
    }))
    : raw.executions;
  const artifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts.map(artifact => ({
      ...artifact,
      source: artifact.source === 'omo-opencode-tool' ? 'opencode-tool' : artifact.source,
    }))
    : raw.artifacts;
  const historyCapabilities = {
    ...(raw.sourceControlCapabilities || raw.controlCapabilities || {}),
    respond: false,
    sendInstruction: false,
    continue: false,
    approve: false,
    deny: false,
    stop: false,
    archive: false,
    delete: false,
  };

  return {
    ...raw,
    source: 'opencode',
    sourceLabel: OPENCODE_MANIFEST.label,
    sourcePluginId: OPENCODE_PLUGIN_ID,
    sourcePlugin: {
      ...(raw.sourcePlugin || {}),
      id: OPENCODE_PLUGIN_ID,
      version: String(OPENCODE_MANIFEST.version),
      label: OPENCODE_MANIFEST.label,
      mark: OPENCODE_MANIFEST.mark,
      accent: OPENCODE_MANIFEST.accent,
      trust: OPENCODE_MANIFEST.trust,
    },
    orchestrator: OPENCODE_MANIFEST.orchestrator,
    clientKind: OPENCODE_MANIFEST.clientKind,
    readOnly: true,
    importMode: 'local-history',
    controlAuthority: 'read-only-import',
    presentation: { ...OPENCODE_MANIFEST.presentation },
    provenance: {
      ...(raw.provenance || {}),
      source: {
        id: OPENCODE_MANIFEST.source.id,
        label: OPENCODE_MANIFEST.source.label,
        pluginId: OPENCODE_PLUGIN_ID,
        trust: OPENCODE_MANIFEST.trust,
      },
      orchestrator: { id: 'opencode', label: 'OpenCode' },
      client: { id: 'opencode', label: 'OpenCode' },
    },
    executions,
    artifacts,
    outcome: raw.outcome && typeof raw.outcome === 'object'
      ? { ...raw.outcome, artifacts }
      : raw.outcome,
    collaboration,
    sourceControlCapabilities: historyCapabilities,
    controlCapabilities: historyCapabilities,
    controlUnavailableReasons: {
      ...(controls || {}),
      sendInstruction: '가져온 OpenCode 기록은 읽기 전용입니다.',
      delete: '가져온 OpenCode 기록은 Whitebox에서 삭제하지 않습니다.',
    },
  };
}

function uniqueStrings(values, platform = process.platform) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || '');
    if (!text) continue;
    const key = platform === 'win32' ? text.toLowerCase() : text;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function sessionUpdatedMs(session) {
  const parsed = Date.parse(String(session && (session.updatedAt || session.startedAt) || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function preferredError(errors) {
  return errors.find(error => error && error.code !== 'DB_NOT_FOUND') || errors[0] || null;
}

class OpenCodeHistoryMonitor {
  constructor(options = {}) {
    this.options = { ...options };
    this.platform = options.platform || process.platform;
    this.ownerByExternalId = new Map();
    this.monitorsByPath = new Map();
    this.fixed = Boolean(options.monitor) || (Array.isArray(options.monitors) && options.monitors.length > 0);
    this.monitors = options.monitor
      ? [options.monitor]
      : (Array.isArray(options.monitors) ? options.monitors.filter(Boolean) : []);
    this.monitor = this.monitors[0] || null;
    if (!this.fixed) this._syncMonitors();
  }

  _pathKey(file) {
    const text = String(file || '');
    return this.platform === 'win32' ? text.toLowerCase() : text;
  }

  _createMonitor(dbPath) {
    return new OmoOpenCodeMonitor({
      ...this.options,
      dbPath,
      idPrefix: OPENCODE_PLUGIN_ID,
      // Direct OpenCode owns the complete local history. OMO remains available
      // as a compatibility parser but is not registered beside this adapter.
      omoConfigured: true,
    });
  }

  _syncMonitors() {
    if (this.fixed) return this.monitors;
    const candidates = openCodeDbPaths(this.options);
    const activeKeys = new Set();
    const ordered = [];
    for (const dbPath of candidates) {
      const key = this._pathKey(dbPath);
      activeKeys.add(key);
      let monitor = this.monitorsByPath.get(key);
      if (!monitor) {
        monitor = this._createMonitor(dbPath);
        this.monitorsByPath.set(key, monitor);
      }
      ordered.push(monitor);
    }
    for (const [key, monitor] of this.monitorsByPath) {
      if (activeKeys.has(key)) continue;
      if (typeof monitor.close === 'function') monitor.close();
      this.monitorsByPath.delete(key);
    }
    const activeMonitors = new Set(ordered);
    for (const [externalId, owner] of this.ownerByExternalId) {
      if (!activeMonitors.has(owner)) this.ownerByExternalId.delete(externalId);
    }
    this.monitors = ordered;
    this.monitor = ordered[0] || null;
    return ordered;
  }

  watchRoots() {
    const roots = this._syncMonitors().flatMap(monitor => (
      typeof monitor.watchRoots === 'function' ? monitor.watchRoots() : []
    ));
    return uniqueStrings(roots, this.platform);
  }

  watchFiles() {
    const files = this._syncMonitors().flatMap(monitor => (
      typeof monitor.watchFiles === 'function' ? monitor.watchFiles() : []
    ));
    return uniqueStrings(files, this.platform);
  }

  status() {
    const statuses = this._syncMonitors().map(monitor => (
      typeof monitor.status === 'function' ? monitor.status() : {}
    ));
    if (statuses.length <= 1) return { ...(statuses[0] || {}), id: OPENCODE_PLUGIN_ID };

    const availableStatuses = statuses.filter(status => status && status.available);
    const base = availableStatuses[0] || statuses[0] || {};
    const unavailableReasons = statuses
      .filter(status => status && !status.available && status.reason)
      .map(status => String(status.reason));
    const meaningfulReasons = availableStatuses.length
      ? unavailableReasons.filter(reason => reason !== 'OpenCode local history was not found.')
      : unavailableReasons;
    return {
      ...base,
      id: OPENCODE_PLUGIN_ID,
      available: availableStatuses.length > 0,
      enabled: base.enabled !== false,
      mode: 'read-only',
      reason: uniqueStrings(meaningfulReasons).join(' '),
      databaseCount: availableStatuses.length,
    };
  }

  scan(options = {}) {
    const monitors = this._syncMonitors();
    if (this.fixed && monitors.length === 1) {
      const rows = monitors[0].scan(options);
      return (Array.isArray(rows) ? rows : []).map(asOpenCodeSession);
    }

    const selected = new Map();
    const errors = [];
    let successfulScans = 0;
    for (let rank = 0; rank < monitors.length; rank += 1) {
      const monitor = monitors[rank];
      try {
        const rows = monitor.scan(options);
        successfulScans += 1;
        for (const session of Array.isArray(rows) ? rows : []) {
          const externalId = String(session && session.externalId || '');
          if (!externalId) continue;
          const candidate = { session, monitor, rank, updatedMs: sessionUpdatedMs(session) };
          const current = selected.get(externalId);
          if (!current || candidate.updatedMs > current.updatedMs) selected.set(externalId, candidate);
        }
      } catch (error) {
        errors.push(error);
      }
    }
    if (!successfulScans && errors.length) throw preferredError(errors);

    const entries = [...selected.values()].sort((left, right) => (
      right.updatedMs - left.updatedMs
      || left.rank - right.rank
      || String(left.session.externalId).localeCompare(String(right.session.externalId))
    ));
    this.ownerByExternalId.clear();
    for (const entry of entries) this.ownerByExternalId.set(String(entry.session.externalId), entry.monitor);
    const sessions = attachOpenCodeHierarchy(entries.map(entry => entry.session), OPENCODE_PLUGIN_ID);
    return sessions.map(asOpenCodeSession);
  }

  detail(id) {
    const rawId = String(id || '');
    const prefix = `${OPENCODE_PLUGIN_ID}:`;
    const externalId = rawId.startsWith(prefix) ? rawId.slice(prefix.length) : rawId;
    if (!externalId || externalId.includes('\u0000')) return null;

    const monitors = this._syncMonitors();
    if (this.fixed && monitors.length === 1) return asOpenCodeSession(monitors[0].detail(id));
    const owner = this.ownerByExternalId.get(externalId);
    const ordered = owner ? [owner, ...monitors.filter(monitor => monitor !== owner)] : monitors;
    const errors = [];
    let successfulReads = 0;
    let selected = null;
    for (let rank = 0; rank < ordered.length; rank += 1) {
      const monitor = ordered[rank];
      try {
        const session = monitor.detail(externalId);
        successfulReads += 1;
        if (!session) continue;
        if (monitor === owner) return asOpenCodeSession(session);
        const candidate = { session, monitor, rank, updatedMs: sessionUpdatedMs(session) };
        if (!selected || candidate.updatedMs > selected.updatedMs) selected = candidate;
      } catch (error) {
        errors.push(error);
      }
    }
    if (!selected) {
      if (!successfulReads && errors.length) throw preferredError(errors);
      return null;
    }
    this.ownerByExternalId.set(externalId, selected.monitor);
    return asOpenCodeSession(selected.session);
  }

  close() {
    for (const monitor of new Set(this.monitors)) {
      if (typeof monitor.close === 'function') monitor.close();
    }
    this.monitorsByPath.clear();
    this.ownerByExternalId.clear();
    this.monitors = [];
    this.monitor = null;
  }
}

function createOpenCodeMonitorPlugin(options = {}) {
  const monitor = new OpenCodeHistoryMonitor(options);
  return {
    manifest: OPENCODE_MANIFEST,
    watchRoots: () => monitor.watchRoots(),
    watchFiles: () => monitor.watchFiles(),
    status: () => monitor.status(),
    scan: scanOptions => monitor.scan(scanOptions),
    detail: id => monitor.detail(id),
    close: () => monitor.close(),
    monitor,
  };
}

module.exports = {
  OPENCODE_MANIFEST,
  OPENCODE_PLUGIN_ID,
  OpenCodeHistoryMonitor,
  asOpenCodeSession,
  createOpenCodeMonitorPlugin,
  openCodeDbPath,
  openCodeDbPaths,
};
