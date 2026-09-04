'use strict';

const { normalizeSourceSession, normalizedCapabilities, validateManifest } = require('./contracts');
const { bundledSourceDefinitions } = require('./bundled');
const { isSourcePluginEnabled } = require('./settingsStore');
const {
  MAX_CONTRACT_PROMPT_FINGERPRINTS,
  comprehensionPromptFingerprint,
  hasComprehensionContract,
  normalizedComprehensionContractPromptFingerprints,
  promoteComprehensionCandidate,
  stageComprehensionCandidate,
  stripComprehensionContract,
} = require('../comprehensionPacket');

const SCAN_TIMEOUT_MS = 12_000;

function normalizedOwnerships(status, pluginId) {
  const records = Array.isArray(status?.comprehensionOwnerships) ? status.comprehensionOwnerships : [];
  const seen = new Set();
  return records.slice(-500).map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const externalId = String(value.externalId || '').trim();
    const promptFingerprint = String(value.promptFingerprint || '').trim().toLowerCase();
    const requestId = String(value.requestId || '').trim();
    const boundAt = String(value.boundAt || '').trim();
    if (String(value.pluginId || '') !== pluginId
      || !externalId
      || externalId.length > 500
      || /[\u0000-\u001f\u007f]/u.test(externalId)
      || !/^[a-f0-9]{64}$/u.test(promptFingerprint)
      || !requestId
      || requestId.length > 160
      || !Number.isFinite(Date.parse(boundAt))) return null;
    const key = `${externalId}\u0000${promptFingerprint}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return { pluginId, externalId, promptFingerprint, requestId, boundAt };
  }).filter(Boolean);
}

function latestMessageIndex(messages, role) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) return index;
  }
  return -1;
}

function replaceFinalResponseCopies(session, response, body) {
  if (typeof response !== 'string' || typeof body !== 'string' || response === body) return;
  session.result = body;
  if (session.outcome && typeof session.outcome === 'object') {
    session.outcome = { ...session.outcome, summary: body };
  }
  if (Array.isArray(session.outcomes)) {
    session.outcomes = session.outcomes.map(outcome => (
      outcome && outcome.text === response ? { ...outcome, text: body } : outcome
    ));
  }
}

function stageSourceComprehension(session) {
  const messages = Array.isArray(session?.messages)
    ? session.messages.map(message => message && typeof message === 'object' ? { ...message } : message)
    : [];
  const contractUserIndexes = [];
  const contractPromptFingerprints = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== 'user' || !hasComprehensionContract(message.text)) continue;
    contractUserIndexes.push(index);
    const fingerprint = comprehensionPromptFingerprint(String(message.text || ''));
    if (!contractPromptFingerprints.includes(fingerprint)
      && contractPromptFingerprints.length < MAX_CONTRACT_PROMPT_FINGERPRINTS) {
      contractPromptFingerprints.push(fingerprint);
    }
  }
  const contractObserved = contractUserIndexes.length > 0;
  const next = {
    ...session,
    messages,
    comprehensionContractObserved: contractObserved,
    comprehensionContractPromptFingerprints: normalizedComprehensionContractPromptFingerprints(
      contractPromptFingerprints,
    ),
    comprehensionContractInjected: false,
  };
  delete next.comprehension;
  delete next.comprehensionCandidate;
  delete next.comprehensionOrigin;

  let visiblePrompt = '';
  for (const index of contractUserIndexes) {
    const text = String(messages[index]?.text || '');
    const visible = stripComprehensionContract(text);
    if (!visiblePrompt) visiblePrompt = visible;
    messages[index] = { ...messages[index], text: visible };
  }
  if (/^<whitebox-comprehension-contract\b/iu.test(String(next.title || ''))) {
    next.title = visiblePrompt.replace(/\s+/gu, ' ').slice(0, 240) || 'Whitebox source task';
  }

  const assistantIndex = latestMessageIndex(messages, 'assistant');
  const response = assistantIndex >= 0
    ? String(messages[assistantIndex]?.text || '')
    : String(next.result || '');
  const staged = stageComprehensionCandidate(next, response, {
    contractObserved: true,
    stageCandidate: true,
  });
  next.comprehension = staged.comprehension;
  if (staged.candidate) next.comprehensionCandidate = staged.candidate;
  if (assistantIndex >= 0) messages[assistantIndex] = { ...messages[assistantIndex], text: staged.body };
  replaceFinalResponseCopies(next, response, staged.body);
  return { session: next, contractObserved, contractPromptFingerprints };
}

function applySourceComprehension(session, ownership = null) {
  let staged = stageSourceComprehension(session);
  if (!ownership) return staged.session;

  // A visible contract is useful corroboration and must match exactly. Source
  // scans are allowed to contain only a recent message window, however, so an
  // absent contract is not negative evidence for an exact persisted binding.
  if (staged.contractObserved && staged.contractPromptFingerprints.some(
    fingerprint => fingerprint !== ownership.promptFingerprint,
  )) return staged.session;

  const projected = staged.session;
  if (projected.comprehensionCandidate) {
    promoteComprehensionCandidate(projected, 'whitebox-source-plugin-binding');
  } else {
    projected.comprehensionContractInjected = true;
    projected.comprehensionOrigin = {
      contractInjected: true,
      authority: 'whitebox-source-plugin-binding',
    };
  }
  return projected;
}

function withTimeout(value, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    Promise.resolve(value),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 시간이 초과되었습니다.`)), timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

class SourcePluginMonitorHost {
  constructor(options = {}) {
    this.home = options.home;
    this.platform = options.platform || process.platform;
    this.settings = options.settings || {};
    // Hosts created by older tests or embedders without an activation schema
    // retain their previous behavior. Production always receives the v2 store
    // snapshot and therefore fails closed until a plugin is explicitly enabled.
    this.hasActivationSettings = Array.isArray(this.settings.enabledPluginIds);
    this.definitions = options.definitions || bundledSourceDefinitions(options);
    this.monitors = new Map();
    this.statuses = new Map();
    this.sessions = new Map();
    this.external = new Map();
    this.runtimeStatuses = new Map();
    this.comprehensionOwnerships = new Map();
    this.initialize();
  }

  pluginEnabled(pluginId) {
    return !this.hasActivationSettings || isSourcePluginEnabled(this.settings, pluginId);
  }

  runtimeDisabled(pluginId) {
    return this.runtimeStatuses.get(String(pluginId || ''))?.enabled === false;
  }

  initialize() {
    const ids = new Set();
    for (const definition of this.definitions) {
      const manifest = validateManifest(definition.manifest);
      if (ids.has(manifest.id)) throw new Error(`중복 source plugin ID: ${manifest.id}`);
      ids.add(manifest.id);
      const platformSupported = manifest.platforms.includes(this.platform);
      if (!this.pluginEnabled(manifest.id)) {
        this.statuses.set(manifest.id, {
          id: manifest.id,
          source: manifest.source,
          name: manifest.name,
          enabled: false,
          available: false,
          platformSupported,
          state: platformSupported ? 'disabled' : 'unavailable',
          reason: platformSupported
            ? '설정에서 활성화하면 이 플러그인의 로컬 작업 기록을 불러옵니다.'
            : manifest.id === 'builtin.aside'
              ? 'Aside Browser는 현재 macOS 15 이상에서만 사용할 수 있습니다.'
              : '현재 운영체제에서 지원하지 않습니다.',
          capabilities: normalizedCapabilities({}, {}),
        });
        continue;
      }
      if (!platformSupported) {
        this.statuses.set(manifest.id, {
          id: manifest.id, source: manifest.source, name: manifest.name, enabled: true, available: false,
          platformSupported: false, state: 'unavailable',
          reason: manifest.id === 'builtin.aside' ? 'Aside Browser는 현재 macOS 15 이상에서만 사용할 수 있습니다.' : '현재 운영체제에서 지원하지 않습니다.',
          capabilities: normalizedCapabilities({}, {}),
        });
        continue;
      }
      try {
        const monitor = definition.createMonitor({
          home: this.home,
          platform: this.platform,
          settings: this.settings,
          historyFolders: this.settings.asideHistoryFolders || [],
          manifest,
        });
        if (monitor) this.monitors.set(manifest.id, { manifest, monitor });
        this.statuses.set(manifest.id, {
          id: manifest.id, source: manifest.source, name: manifest.name, enabled: true,
          platformSupported: true, available: Boolean(monitor),
          state: monitor ? 'ready' : 'degraded', reason: monitor ? '' : '읽을 수 있는 기록원이 없습니다.',
          capabilities: normalizedCapabilities({
            ...manifest.capabilities.control,
            live: manifest.capabilities.live,
            readConversation: manifest.capabilities.history.list,
            readSteps: manifest.capabilities.history.detail,
            readTabs: manifest.id === 'builtin.aside' && manifest.capabilities.history.detail,
            readArtifacts: manifest.capabilities.history.detail,
          }),
        });
      } catch (error) {
        this.statuses.set(manifest.id, {
          id: manifest.id, source: manifest.source, name: manifest.name, enabled: true,
          platformSupported: true, available: false, state: 'failed',
          reason: String(error && error.message || error), capabilities: normalizedCapabilities({}, {}),
        });
      }
    }
  }

  setRuntimeStatuses(statuses = []) {
    this.runtimeStatuses.clear();
    for (const status of Array.isArray(statuses) ? statuses : []) {
      if (!status || !status.id) continue;
      const pluginId = String(status.id);
      this.runtimeStatuses.set(pluginId, { ...status });
    }
  }

  comprehensionOwnership(pluginId, externalId) {
    const id = String(externalId || '');
    return (this.comprehensionOwnerships.get(String(pluginId || '')) || [])
      .find(record => record.externalId === id) || null;
  }

  normalizeSession(raw, manifest) {
    const normalized = normalizeSourceSession(raw, manifest, { platform: this.platform });
    if (!normalized) return null;
    const ownership = this.comprehensionOwnership(manifest.id, normalized.externalId);
    return applySourceComprehension(normalized, ownership);
  }

  setExternalSnapshot(pluginId, payload = {}) {
    const id = String(pluginId || '');
    const definition = this.definitions.find(item => item.manifest.id === id);
    if (!definition) return false;
    if (!this.pluginEnabled(id) || this.runtimeDisabled(id)) {
      this.external.delete(id);
      this.comprehensionOwnerships.delete(id);
      return false;
    }
    this.comprehensionOwnerships.set(id, normalizedOwnerships(payload, id));
    this.external.set(id, {
      sessions: Array.isArray(payload.sessions) ? payload.sessions : [],
      status: payload.status || null,
    });
    return true;
  }

  watchRoots() {
    const roots = [];
    for (const [pluginId, { monitor }] of this.monitors.entries()) {
      if (this.runtimeDisabled(pluginId)) continue;
      try {
        if (typeof monitor.watchRoots === 'function') roots.push(...(monitor.watchRoots() || []));
      } catch {}
    }
    return [...new Set(roots.filter(Boolean))];
  }

  effectiveStatus(manifest) {
    if (!this.pluginEnabled(manifest.id)) return this.statuses.get(manifest.id) || null;
    const local = this.statuses.get(manifest.id) || null;
    const external = this.external.get(manifest.id)?.status || null;
    const runtime = this.runtimeStatuses.get(manifest.id) || null;
    if (runtime?.enabled === false) return runtime;
    if (!external && !runtime) return local;
    const capabilities = normalizedCapabilities({
      ...(local?.capabilities || {}),
      ...(external?.capabilities || {}),
      ...(runtime?.capabilities || {}),
    });

    // Aside's official connector is authoritative; selected folders are an
    // optional read-only fallback and must not degrade a healthy MCP session.
    if (manifest.id === 'builtin.aside') {
      const official = external || runtime;
      const available = Boolean(official?.available || local?.available);
      return {
        ...local,
        ...external,
        ...runtime,
        id: manifest.id,
        available,
        state: official?.available ? (official.state || 'ready')
          : available ? 'degraded' : (official?.state || local?.state || 'unavailable'),
        reason: official?.available ? String(official.reason || '')
          : String(official?.reason || local?.reason || ''),
        capabilities,
      };
    }

    // OpenCode history and CLI control are independent facets. Reporting the
    // source as fully ready when its SQLite history is missing hides the exact
    // reason an enabled plugin produced no projects, so partial readiness is
    // represented explicitly as degraded.
    const parts = [local, external, runtime].filter(Boolean);
    const available = parts.some(status => status.available === true);
    const unavailableParts = parts.filter(status => status.available === false && status.reason);
    const partial = available && unavailableParts.length > 0;
    const reason = [...new Set(unavailableParts.map(status => String(status.reason || '').trim()).filter(Boolean))].join(' ');
    return {
      ...local,
      ...external,
      ...runtime,
      id: manifest.id,
      available,
      state: partial ? 'degraded' : available ? 'ready' : (runtime?.state || external?.state || local?.state || 'unavailable'),
      reason: partial || !available ? (reason || String(runtime?.reason || external?.reason || local?.reason || '')) : '',
      capabilities,
    };
  }

  normalizeRows(rows, manifest) {
    const runtime = this.effectiveStatus(manifest);
    const runtimeControls = runtime && runtime.capabilities ? runtime.capabilities : null;
    return (Array.isArray(rows) ? rows : []).map(raw => {
      const observed = raw.sourceControlCapabilities || raw.controlCapabilities || {};
      const readOnlyImport = raw.readOnly === true || raw.controlAuthority === 'read-only-import';
      const officialAside = manifest.id !== 'builtin.aside' || raw.controlAuthority === 'official-session-id';
      const managedStop = ['builtin.opencode', 'builtin.omo'].includes(manifest.id)
        && Array.isArray(runtime?.managedSessionIds)
        && runtime.managedSessionIds.includes(String(raw.externalId || ''));
      const observedRuntimeIntersection = runtimeControls ? {
        ...observed,
        start: Boolean(runtimeControls.start),
        sendInstruction: Boolean(observed.sendInstruction !== false && runtimeControls.sendInstruction),
        continue: Boolean(observed.continue !== false && (runtimeControls.continue || runtimeControls.sendInstruction)),
        respond: Boolean(observed.respond !== false && (runtimeControls.respond || runtimeControls.sendInstruction)),
        approve: Boolean(observed.approve && runtimeControls.approve),
        deny: Boolean(observed.deny && runtimeControls.deny),
        stop: Boolean((observed.stop && runtimeControls.stop) || (observed.stop && managedStop)),
        resume: Boolean(observed.resume && runtimeControls.resume),
        archive: Boolean(observed.archive && runtimeControls.archive),
        delete: Boolean(observed.delete && runtimeControls.delete),
        live: Boolean(observed.live || runtimeControls.live),
        readConversation: Boolean(observed.readConversation || runtimeControls.readConversation),
        readSteps: Boolean(observed.readSteps || runtimeControls.readSteps),
        readTabs: Boolean(observed.readTabs || runtimeControls.readTabs),
        readArtifacts: Boolean(observed.readArtifacts || runtimeControls.readArtifacts),
        pty: false,
      } : observed;
      const capabilities = readOnlyImport || !officialAside
        ? {
          ...observed,
          start: false, sendInstruction: false, continue: false, respond: false, approve: false, deny: false,
          stop: Boolean(readOnlyImport && managedStop), resume: false, archive: false, delete: false, pty: false,
        }
        : observedRuntimeIntersection;
      return this.normalizeSession({
        ...raw,
        sourceControlCapabilities: capabilities,
        controlUnavailableReasons: readOnlyImport
          ? { ...(raw.controlUnavailableReasons || {}), sendInstruction: '선택 폴더 기록은 읽기 전용입니다.', stop: '선택 폴더 기록은 읽기 전용입니다.', archive: '선택 폴더 기록은 읽기 전용입니다.', delete: '선택 폴더 기록은 읽기 전용입니다.' }
          : runtime?.controlUnavailableReasons || raw.controlUnavailableReasons,
      }, manifest);
    }).filter(Boolean);
  }

  async scan() {
    const collected = [];
    const statuses = [];
    for (const definition of this.definitions) {
      const manifest = definition.manifest;
      if (!this.pluginEnabled(manifest.id) || this.runtimeDisabled(manifest.id)) {
        this.external.delete(manifest.id);
        const disabled = this.runtimeStatuses.get(manifest.id) || this.statuses.get(manifest.id);
        statuses.push({ ...disabled, id: manifest.id, source: manifest.source, name: manifest.name, sessionCount: 0 });
        continue;
      }
      const record = this.monitors.get(manifest.id);
      let localRows = [];
      if (record && typeof record.monitor.scan === 'function') {
        try {
          const result = await withTimeout(record.monitor.scan({ limit: 240 }), SCAN_TIMEOUT_MS, `${manifest.name} 기록 조회`);
          localRows = Array.isArray(result) ? result : result?.sessions || [];
          const adapterStatus = !Array.isArray(result) && result?.status ? result.status : (typeof record.monitor.status === 'function' ? record.monitor.status() : null);
          if (adapterStatus) this.statuses.set(manifest.id, { ...this.statuses.get(manifest.id), ...adapterStatus, id: manifest.id, source: manifest.source, name: manifest.name });
        } catch (error) {
          this.statuses.set(manifest.id, {
            ...this.statuses.get(manifest.id), available: false, state: 'degraded', reason: String(error && error.message || error),
          });
        }
      }
      const externalRows = this.external.get(manifest.id)?.sessions || [];
      const byId = new Map();
      for (const row of this.normalizeRows(localRows, manifest)) byId.set(row.id, row);
      // Official connector data wins over folder fallbacks for the same record.
      for (const row of this.normalizeRows(externalRows, manifest)) byId.set(row.id, row);
      for (const row of byId.values()) collected.push(row);
      const status = this.effectiveStatus(manifest) || this.statuses.get(manifest.id);
      statuses.push({ ...status, id: manifest.id, source: manifest.source, name: manifest.name, sessionCount: byId.size });
    }
    this.sessions = new Map(collected.map(session => [session.id, session]));
    return { sessions: collected, statuses };
  }

  owns(sessionId) {
    return this.sessions.has(String(sessionId || ''));
  }

  async detail(sessionId) {
    const card = this.sessions.get(String(sessionId || ''));
    if (!card) return null;
    const owner = this.monitors.get(card.sourcePluginId);
    const external = (this.external.get(card.sourcePluginId)?.sessions || []).find(row => String(row.externalId || row.id) === card.externalId);
    let raw = external || card;
    if (!external && owner && typeof owner.monitor.detail === 'function') {
      raw = await withTimeout(owner.monitor.detail(card.externalId), SCAN_TIMEOUT_MS, `${owner.manifest.name} 상세 기록 조회`) || card;
    }
    return this.normalizeSession(
      raw,
      owner?.manifest || this.definitions.find(item => item.manifest.id === card.sourcePluginId).manifest,
    );
  }

  async dispose() {
    const tasks = [];
    for (const { monitor } of this.monitors.values()) {
      if (typeof monitor.close === 'function') tasks.push(Promise.resolve().then(() => monitor.close()));
      else if (typeof monitor.dispose === 'function') tasks.push(Promise.resolve().then(() => monitor.dispose()));
    }
    await Promise.allSettled(tasks);
    this.monitors.clear();
    this.sessions.clear();
    this.comprehensionOwnerships.clear();
  }
}

module.exports = { SCAN_TIMEOUT_MS, SourcePluginMonitorHost, applySourceComprehension, withTimeout };
