'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const { StringDecoder } = require('string_decoder');
const { findExecutable } = require('../agentRunner');
const { ASIDE_MANIFEST, OMO_MANIFEST, OPENCODE_MANIFEST } = require('./bundled');
const { cleanText, normalizedCapabilities } = require('./contracts');
const { isSourcePluginEnabled } = require('./settingsStore');

const DELETE_TOKEN_TTL_MS = 30_000;
const MAX_PROMPT_LENGTH = 120_000;
const MAX_CHILD_OUTPUT = 2 * 1024 * 1024;

function requestId(value) {
  const id = cleanText(value, 160);
  return id || crypto.randomUUID();
}

function safePrompt(value) {
  const prompt = String(value || '').replace(/\u0000/g, '').trim();
  if (!prompt) throw new Error('작업 내용을 입력하세요.');
  if (prompt.length > MAX_PROMPT_LENGTH) throw new Error('작업 내용이 너무 깁니다.');
  return prompt;
}

function safeCwd(value) {
  const cwd = path.resolve(String(value || process.cwd()));
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('작업 폴더를 찾을 수 없습니다.');
  return cwd;
}

function execFilePromise(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { ...options, windowsHide: true, maxBuffer: MAX_CHILD_OUTPUT }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout: cleanText(stdout, 4000), stderr: cleanText(stderr, 2000) });
    });
  });
}

function emptySourceStatus(manifest, reason, platform = process.platform) {
  return {
    id: manifest.id,
    name: manifest.name,
    source: manifest.source,
    platform,
    platformSupported: manifest.platforms.includes(platform),
    enabled: true,
    installed: false,
    connected: false,
    available: false,
    state: 'unavailable',
    reason,
    capabilities: normalizedCapabilities({}, {}),
    controlUnavailableReasons: {},
  };
}

class SourcePluginControlHost extends EventEmitter {
  constructor(options = {}) {
    super();
    this.platform = options.platform || process.platform;
    this.home = options.home || process.env.USERPROFILE || process.env.HOME || process.cwd();
    this.settingsStore = options.settingsStore || null;
    this.spawn = options.spawn || spawn;
    this.execFile = options.execFile || execFilePromise;
    this.findExecutable = options.findExecutable || findExecutable;
    this.now = options.now || (() => Date.now());
    this.statuses = new Map();
    this.deleteTokens = new Map();
    this.requests = new Map();
    this.children = new Map();
    this.externalSnapshots = {};
    this.aside = null;
    this.disposed = false;
    this.refreshPromise = null;
    this.statuses.set(OPENCODE_MANIFEST.id, emptySourceStatus(OPENCODE_MANIFEST, 'OpenCode CLI를 확인하는 중입니다.', this.platform));
    this.statuses.set(ASIDE_MANIFEST.id, emptySourceStatus(ASIDE_MANIFEST, this.platform === 'darwin'
      ? 'Aside CLI를 확인하는 중입니다.'
      : 'Aside Browser는 현재 macOS 15 이상에서만 사용할 수 있습니다.', this.platform));
  }

  settings() {
    return this.settingsStore ? this.settingsStore.snapshot() : { version: 1, asideHistoryFolders: [] };
  }

  pluginEnabled(pluginId) {
    // Tests and embedders without a settings store retain their legacy
    // always-on behavior. The desktop app always provides the v2 opt-in store.
    return !this.settingsStore || isSourcePluginEnabled(this.settings(), pluginId);
  }

  assertPluginEnabled(pluginId) {
    if (!this.pluginEnabled(pluginId)) {
      throw new Error('설정에서 비활성화된 source plugin은 사용할 수 없습니다.');
    }
  }

  managedChildren(pluginId) {
    const id = String(pluginId || '');
    return [...this.children.values()].filter(record => record.pluginId === id);
  }

  assertPluginCanDisable(pluginId) {
    if (this.managedChildren(pluginId).length) {
      throw new Error('Whitebox에서 실행한 작업이 남아 있습니다. 작업을 먼저 중지한 뒤 source plugin을 비활성화하세요.');
    }
  }

  disabledStatus(manifest, reason = '설정에서 활성화하면 이 플러그인의 로컬 작업 기록을 불러옵니다.') {
    return {
      ...emptySourceStatus(manifest, reason, this.platform),
      enabled: false,
      state: manifest.platforms.includes(this.platform) ? 'disabled' : 'unavailable',
    };
  }

  listSources() {
    return [...this.statuses.values()].map(status => {
      const { executable: _privateExecutable, ...publicStatus } = status;
      const managedSessionIds = [OPENCODE_MANIFEST.id, OMO_MANIFEST.id].includes(status.id)
        ? [...new Set(this.managedChildren(status.id)
          .filter(record => record.externalId)
          .map(record => record.externalId))]
        : [];
      return ({
        ...publicStatus,
        capabilities: { ...(status.capabilities || {}) },
        controlUnavailableReasons: { ...(status.controlUnavailableReasons || {}) },
        managedSessionIds,
      });
    });
  }

  monitorState() {
    return { statuses: this.listSources(), snapshots: { ...this.externalSnapshots } };
  }

  async initialize() {
    await this.refresh();
    return this.listSources();
  }

  async refresh(options = {}) {
    if (this.disposed) return this.listSources();
    if (this.refreshPromise) {
      if (options.force !== true) return this.refreshPromise;
      try {
        await this.refreshPromise;
      } catch (_supersededRefreshError) {
        // A forced refresh represents newer persisted activation state. Apply
        // it even when the superseded probe or connector cleanup failed.
      }
      if (this.disposed) return this.listSources();
    }
    this.refreshPromise = this.refreshNow().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async refreshNow() {
    const openCodeEnabled = this.pluginEnabled(OPENCODE_MANIFEST.id);
    const opencode = openCodeEnabled ? this.findExecutable('opencode') : '';
    this.statuses.set(OPENCODE_MANIFEST.id, !openCodeEnabled
      ? this.disabledStatus(OPENCODE_MANIFEST)
      : opencode ? {
        id: OPENCODE_MANIFEST.id,
        name: OPENCODE_MANIFEST.name,
        source: OPENCODE_MANIFEST.source,
        platform: this.platform,
        platformSupported: true,
        enabled: true,
        installed: true,
        connected: true,
        available: true,
        state: 'ready',
        reason: '',
        executable: opencode,
        capabilities: normalizedCapabilities({
          start: true, sendInstruction: false, stop: false, archive: false, delete: false, live: true,
          readConversation: true, readSteps: true, readTabs: false, readArtifacts: true,
        }),
        controlUnavailableReasons: {
          sendInstruction: '가져온 OpenCode 기록은 읽기 전용입니다. 새 작업은 실행 화면에서 시작하세요.',
          stop: 'Whitebox에서 시작한 OpenCode 프로세스만 실행 중에 중지할 수 있습니다.',
          archive: 'OpenCode CLI는 세션 보관 명령을 제공하지 않습니다.',
          delete: '가져온 OpenCode 기록은 Whitebox에서 삭제하지 않습니다.',
        },
      } : {
        ...emptySourceStatus(OPENCODE_MANIFEST, 'OpenCode CLI를 찾을 수 없습니다.', this.platform),
        enabled: true,
        installed: false,
      });
    if (!openCodeEnabled) delete this.externalSnapshots[OPENCODE_MANIFEST.id];

    const asideEnabled = this.pluginEnabled(ASIDE_MANIFEST.id);
    if (!asideEnabled) {
      const previousAside = this.aside;
      this.aside = null;
      this.statuses.set(ASIDE_MANIFEST.id, this.disabledStatus(ASIDE_MANIFEST, this.platform === 'darwin'
        ? undefined
        : 'Aside Browser는 현재 macOS 15 이상에서만 사용할 수 있습니다.'));
      delete this.externalSnapshots[ASIDE_MANIFEST.id];
      this.deleteTokens.clear();
      this.emit('changed', this.monitorState());
      if (previousAside && typeof previousAside.dispose === 'function') {
        try {
          await previousAside.dispose();
        } catch (error) {
          // Activation is authoritative. Cleanup failure must not restore a
          // disabled connector's controls or its previously imported rows.
          this.emit('cleanup-error', error);
        }
      }
      return this.listSources();
    }

    if (this.platform !== 'darwin') {
      this.statuses.set(ASIDE_MANIFEST.id, {
        ...emptySourceStatus(ASIDE_MANIFEST, 'Aside Browser는 현재 macOS 15 이상에서만 사용할 수 있습니다.', this.platform),
        enabled: true,
        platformSupported: false,
      });
      this.externalSnapshots[ASIDE_MANIFEST.id] = { sessions: [], status: this.statuses.get(ASIDE_MANIFEST.id) };
      this.emit('changed', this.monitorState());
      return this.listSources();
    }

    const asideExecutable = this.findExecutable('aside');
    if (!asideExecutable) {
      this.statuses.set(ASIDE_MANIFEST.id, emptySourceStatus(ASIDE_MANIFEST, 'Aside CLI를 찾을 수 없습니다. Aside Developer settings에서 CLI 경로를 확인하세요.', this.platform));
      this.externalSnapshots[ASIDE_MANIFEST.id] = { sessions: [], status: this.statuses.get(ASIDE_MANIFEST.id) };
      this.emit('changed', this.monitorState());
      return this.listSources();
    }

    try {
      if (!this.aside) this.aside = await this.createAsideController(asideExecutable);
      const probe = typeof this.aside.probe === 'function' ? await this.aside.probe() : {};
      if (probe.platformSupported === false) {
        const status = {
          ...emptySourceStatus(ASIDE_MANIFEST, cleanText(probe.reason || 'Aside Browser는 macOS 15 이상이 필요합니다.', 500), this.platform),
          installed: true,
          state: 'unavailable',
        };
        this.statuses.set(ASIDE_MANIFEST.id, status);
        this.externalSnapshots[ASIDE_MANIFEST.id] = { sessions: [], status };
        this.emit('changed', this.monitorState());
        return this.listSources();
      }
      const discovered = probe.capabilities || this.aside.capabilities || {};
      const capabilities = normalizedCapabilities({
        start: true,
        sendInstruction: true,
        stop: Boolean(discovered.stop),
        archive: Boolean(discovered.archive),
        delete: Boolean(discovered.delete),
        live: Boolean(discovered.live || discovered.list),
        readConversation: Boolean(discovered.detail || discovered.readConversation),
        readSteps: Boolean(discovered.detail || discovered.readSteps),
        readTabs: Boolean(discovered.detail || discovered.readTabs),
        readArtifacts: Boolean(discovered.detail || discovered.readArtifacts),
      });
      const unavailable = {};
      if (!capabilities.stop) unavailable.stop = 'Aside MCP가 stop/cancel 도구를 제공하지 않았습니다.';
      if (!capabilities.archive) unavailable.archive = 'Aside MCP가 archive 도구를 제공하지 않았습니다.';
      if (!capabilities.delete) unavailable.delete = 'Aside MCP가 delete/remove 도구를 제공하지 않았습니다.';
      const status = {
        id: ASIDE_MANIFEST.id, name: ASIDE_MANIFEST.name, source: ASIDE_MANIFEST.source,
        platform: this.platform, platformSupported: true, enabled: true,
        installed: true, connected: Boolean(probe.available), available: true,
        state: probe.available && discovered.list ? 'ready' : 'degraded',
        reason: !probe.available
          ? cleanText(probe.reason || 'Aside MCP에 연결할 수 없어 CLI 시작과 이어가기만 사용할 수 있습니다.', 500)
          : discovered.list ? '' : 'Aside MCP에 기존 작업 목록 도구가 없어 새로 시작한 작업만 추적합니다.',
        executable: asideExecutable, capabilities, controlUnavailableReasons: unavailable,
        discoveredTools: Array.isArray(probe.tools) ? probe.tools.map(tool => cleanText(tool.name, 120)) : [],
      };
      this.statuses.set(ASIDE_MANIFEST.id, status);
      let sessions = [];
      if (typeof this.aside.scan === 'function' && discovered.list) {
        const result = await this.aside.scan();
        sessions = Array.isArray(result) ? result : result?.sessions || [];
      }
      this.externalSnapshots[ASIDE_MANIFEST.id] = { sessions, status };
    } catch (error) {
      const status = {
        ...emptySourceStatus(ASIDE_MANIFEST, `Aside MCP 연결 실패: ${cleanText(error && error.message || error, 500)}`, this.platform),
        installed: true,
        available: true,
        connected: false,
        state: 'degraded',
        executable: asideExecutable,
        capabilities: normalizedCapabilities({
          start: true, sendInstruction: true, live: false,
          readConversation: false, readSteps: false, readTabs: false, readArtifacts: false,
        }),
        controlUnavailableReasons: {
          stop: 'Aside MCP가 연결되지 않아 기존 작업을 중지할 수 없습니다.',
          archive: 'Aside MCP가 연결되지 않아 작업을 보관할 수 없습니다.',
          delete: 'Aside MCP가 연결되지 않아 작업을 삭제할 수 없습니다.',
        },
      };
      this.statuses.set(ASIDE_MANIFEST.id, status);
      this.externalSnapshots[ASIDE_MANIFEST.id] = { sessions: [], status };
    }
    this.emit('changed', this.monitorState());
    return this.listSources();
  }

  async createAsideController(executable) {
    const adapter = require('./bundled/aside');
    const context = { command: executable, executable, platform: this.platform, home: this.home, settings: this.settings() };
    if (typeof adapter.createAsideController === 'function') return adapter.createAsideController(context);
    if (typeof adapter.AsideController === 'function') return new adapter.AsideController(context);
    if (typeof adapter.AsideMcpConnector === 'function') return new adapter.AsideMcpConnector(context);
    throw new Error('Aside MCP adapter를 불러오지 못했습니다.');
  }

  rememberRequest(id, promise) {
    this.requests.set(id, promise);
    if (this.requests.size > 500) this.requests.delete(this.requests.keys().next().value);
    return promise;
  }

  start(pluginId, raw = {}, options = {}) {
    if (this.disposed) return Promise.resolve({ ok: false, error: '프로그램이 종료 중입니다.' });
    const id = requestId(raw.requestId);
    if (cleanText(raw.externalId, 500) && options.allowExistingSession !== true) {
      return Promise.resolve({
        ok: false,
        accepted: false,
        requestId: id,
        error: '가져온 source 기록은 새 작업 시작 API로 재개할 수 없습니다.',
      });
    }
    try {
      this.assertPluginEnabled(String(pluginId || ''));
    } catch (error) {
      return Promise.resolve({
        ok: false,
        accepted: false,
        requestId: id,
        error: cleanText(error && error.message || error, 1000),
      });
    }
    if (this.requests.has(id)) return this.requests.get(id);
    const action = Promise.resolve().then(async () => {
      const status = this.statuses.get(String(pluginId || ''));
      if (!status || !status.available || !status.capabilities?.start) throw new Error(status?.reason || '선택한 출처에서 새 작업을 시작할 수 없습니다.');
      const input = { ...raw, prompt: safePrompt(raw.prompt), cwd: safeCwd(raw.cwd), requestId: id };
      if ([OPENCODE_MANIFEST.id, OMO_MANIFEST.id].includes(pluginId)) {
        return this.startCliProcess({ pluginId, executable: status.executable, input, args: this.openCodeArgs(input) });
      }
      if (pluginId === ASIDE_MANIFEST.id) {
        if (this.aside && typeof this.aside.start === 'function') return this.aside.start(input);
        return this.startCliProcess({ pluginId, executable: status.executable, input, args: [input.prompt] });
      }
      throw new Error('알 수 없는 source plugin입니다.');
    }).then(result => ({ ok: true, accepted: true, requestId: id, ...result }), error => ({ ok: false, accepted: false, requestId: id, error: cleanText(error && error.message || error, 1000) }));
    return this.rememberRequest(id, action);
  }

  openCodeArgs(input) {
    const args = ['run', '--format', 'json', '--dir', input.cwd];
    if (input.externalId) args.push('--session', input.externalId);
    if (input.model) args.push('--model', cleanText(input.model, 160));
    if (input.agent) args.push('--agent', cleanText(input.agent, 160));
    args.push(input.prompt);
    return args;
  }

  omoArgs(input) {
    return this.openCodeArgs(input);
  }

  startCliProcess({ pluginId, executable, input, args }) {
    const child = this.spawn(executable, args, {
      cwd: input.cwd,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      detached: this.platform !== 'win32', windowsHide: true, shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const record = {
      id: input.requestId, pluginId, child, externalId: input.externalId || '', outputBytes: 0,
      stdoutDecoder: new StringDecoder('utf8'), stderrDecoder: new StringDecoder('utf8'), stdoutBuffer: '', stopping: false,
    };
    this.children.set(record.id, record);
    const consumeStdout = (chunk) => {
      if (record.outputBytes >= MAX_CHILD_OUTPUT) return;
      record.outputBytes += chunk.length;
      record.stdoutBuffer += record.stdoutDecoder.write(chunk);
      const lines = record.stdoutBuffer.split(/\r?\n/);
      record.stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          const externalId = event.sessionID || event.sessionId || event.session_id || event.session?.id;
          if (externalId) {
            const nextExternalId = cleanText(externalId, 500);
            if (nextExternalId && nextExternalId !== record.externalId) {
              record.externalId = nextExternalId;
              this.emit('changed', this.monitorState());
            }
          }
        } catch {}
      }
    };
    child.stdout?.on('data', consumeStdout);
    // stderr is deliberately not parsed or returned. It can contain prompts,
    // paths, or account context and is not an authoritative session-ID source.
    child.stderr?.on('data', chunk => { record.outputBytes = Math.min(MAX_CHILD_OUTPUT, record.outputBytes + chunk.length); });
    child.once('error', () => { this.children.delete(record.id); this.emit('changed', this.monitorState()); });
    child.once('exit', () => { this.children.delete(record.id); this.emit('changed', this.monitorState()); });
    this.emit('changed', this.monitorState());
    return { pid: child.pid, processId: record.id, externalId: record.externalId };
  }

  async control(session, action, raw = {}) {
    if (!session || !session.sourcePluginId || !session.externalId) throw new Error('조작할 source session을 찾을 수 없습니다.');
    this.assertPluginEnabled(session.sourcePluginId);
    const status = this.statuses.get(session.sourcePluginId);
    const capability = action === 'send' ? 'sendInstruction' : action;
    if (!['send', 'stop', 'archive', 'delete'].includes(action)) throw new Error('지원하지 않는 source session 조작입니다.');
    const sessionCapabilities = session.sourceControlCapabilities || session.controlCapabilities || {};
    if (session.sourcePluginId === ASIDE_MANIFEST.id) {
      if (session.readOnly === true || session.controlAuthority !== 'official-session-id') {
        throw new Error('사용자가 선택한 Aside 폴더 기록은 읽기 전용입니다. 공식 Aside 세션 ID만 조작할 수 있습니다.');
      }
    }
    const managedStop = action === 'stop' && this.managedChild(session);
    if (!sessionCapabilities[capability] && !managedStop) {
      throw new Error(session.controlUnavailableReasons?.[capability] || '이 source session에는 해당 조작 권한이 없습니다.');
    }
    if (!status?.capabilities?.[capability] && !managedStop) {
      throw new Error(status?.controlUnavailableReasons?.[capability] || `${action} 기능을 사용할 수 없습니다.`);
    }
    if (action === 'delete') this.consumeDeleteToken(session, raw.deleteToken);
    if (action === 'send') {
      const prompt = safePrompt(raw.prompt || raw.input);
      const id = requestId(raw.requestId);
      if (this.requests.has(id)) return this.requests.get(id);
      const promise = [OPENCODE_MANIFEST.id, OMO_MANIFEST.id].includes(session.sourcePluginId)
        ? this.start(
          session.sourcePluginId,
          { ...raw, prompt, cwd: session.cwd, externalId: session.externalId, requestId: id },
          { allowExistingSession: true },
        )
        : this.controlAside(session, 'sendInstruction', { ...raw, prompt, requestId: id });
      return this.rememberRequest(id, Promise.resolve(promise));
    }
    if (action === 'stop') {
      const child = this.managedChild(session);
      if (child) return this.stopChild(child);
    }
    if ([OPENCODE_MANIFEST.id, OMO_MANIFEST.id].includes(session.sourcePluginId)) {
      if (action === 'delete') {
        await this.execFile(status.executable, ['session', 'delete', session.externalId], { cwd: session.cwd || this.home });
        this.emit('changed', this.monitorState());
        return { ok: true, accepted: true };
      }
      throw new Error('OpenCode CLI가 이 조작을 제공하지 않습니다.');
    }
    return this.controlAside(session, action, raw);
  }

  async controlAside(session, action, raw) {
    if (!this.aside || typeof this.aside.control !== 'function') throw new Error('Aside MCP 조작 도구가 연결되지 않았습니다.');
    const result = await this.aside.control({ externalId: session.externalId, sessionId: session.externalId, action, ...raw });
    await this.refresh();
    return result;
  }

  managedChild(session) {
    return this.managedChildren(session.sourcePluginId)
      .find(item => item.externalId && item.externalId === session.externalId) || null;
  }

  stopChild(record) {
    if (record.stopping) return { ok: true, accepted: true };
    record.stopping = true;
    if (this.platform === 'win32') {
      execFile('taskkill', ['/PID', String(record.child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      try { process.kill(-record.child.pid, 'SIGTERM'); } catch { record.child.kill('SIGTERM'); }
    }
    return { ok: true, accepted: true };
  }

  prepareDelete(session) {
    if (!session || !session.id || !session.sourcePluginId || !session.externalId) throw new Error('삭제할 source session을 찾을 수 없습니다.');
    this.assertPluginEnabled(session.sourcePluginId);
    const status = this.statuses.get(session.sourcePluginId);
    if (session.sourcePluginId === ASIDE_MANIFEST.id
      && (session.readOnly === true || session.controlAuthority !== 'official-session-id' || !(session.sourceControlCapabilities || session.controlCapabilities || {}).delete)) {
      throw new Error('읽기 전용 Aside 기록은 삭제할 수 없습니다. 공식 Aside 세션의 delete 도구가 확인되어야 합니다.');
    }
    if (!(session.sourceControlCapabilities || session.controlCapabilities || {}).delete) {
      throw new Error(session.controlUnavailableReasons?.delete || '이 source session은 삭제할 수 없습니다.');
    }
    if (!status?.capabilities?.delete) throw new Error(status?.controlUnavailableReasons?.delete || '이 출처는 삭제를 지원하지 않습니다.');
    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = this.now() + DELETE_TOKEN_TTL_MS;
    this.deleteTokens.set(token, {
      sessionId: session.id,
      externalId: session.externalId,
      revision: String(session.sourcePlugin?.revision || session.updatedAt || ''),
      expiresAt,
    });
    return { token, expiresAt, title: cleanText(session.title, 180), sourceLabel: cleanText(session.sourceLabel, 80) };
  }

  consumeDeleteToken(session, tokenValue) {
    const token = String(tokenValue || '');
    const record = this.deleteTokens.get(token);
    this.deleteTokens.delete(token);
    if (!record || record.expiresAt < this.now()) throw new Error('삭제 확인이 만료되었습니다. 다시 확인해 주세요.');
    if (record.sessionId !== session.id || record.externalId !== session.externalId) throw new Error('삭제 확인 대상이 현재 작업과 다릅니다.');
    if (record.revision !== String(session.sourcePlugin?.revision || session.updatedAt || '')) throw new Error('작업이 변경되어 삭제 확인을 다시 받아야 합니다.');
    return true;
  }

  async detail(session) {
    if (session?.sourcePluginId) this.assertPluginEnabled(session.sourcePluginId);
    if (session?.sourcePluginId !== ASIDE_MANIFEST.id || !this.aside || typeof this.aside.detail !== 'function') return null;
    return this.aside.detail(session.externalId);
  }

  async dispose() {
    this.disposed = true;
    for (const record of this.children.values()) this.stopChild(record);
    this.children.clear();
    this.deleteTokens.clear();
    if (this.aside && typeof this.aside.dispose === 'function') await this.aside.dispose();
    this.aside = null;
  }
}

module.exports = {
  DELETE_TOKEN_TTL_MS,
  MAX_CHILD_OUTPUT,
  MAX_PROMPT_LENGTH,
  SourcePluginControlHost,
  emptySourceStatus,
  safeCwd,
  safePrompt,
};
