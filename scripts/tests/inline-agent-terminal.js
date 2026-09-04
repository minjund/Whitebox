'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function classList() {
  const values = new Set();
  return {
    add: (...items) => items.forEach(value => values.add(value)),
    contains: value => values.has(value),
    remove: (...items) => items.forEach(value => values.delete(value)),
    toggle(value, force) {
      const enabled = force == null ? !values.has(value) : Boolean(force);
      if (enabled) values.add(value);
      else values.delete(value);
      return enabled;
    },
  };
}

function createInlineHarness(root, options = {}) {
  const session = options.session || {
    id: 'codex:inline-auto-connect',
    externalId: 'inline-auto-connect-history',
    provider: 'codex',
    cwd: 'D:\\fixture',
    parentId: null,
    controlCapabilities: { pty: true },
  };
  const fixtureSessions = options.sessions || [session];
  const mountCalls = [];
  const resumeCalls = [];
  const forkCalls = [];
  const restartCalls = [];
  const focusCalls = [];
  const unmountCalls = [];
  const renderCalls = [];
  const documentListeners = new Map();
  const windowListeners = new Map();
  const terminalStateListeners = [];
  const resumeAttributes = new Map();
  const resume = {
    dataset: {},
    classList: classList(),
    disabled: false,
    getAttribute: name => resumeAttributes.get(name) || null,
    setAttribute(name, value) { resumeAttributes.set(name, String(value)); },
    removeAttribute(name) { resumeAttributes.delete(name); },
    closest(selector) { return selector === '[data-inline-terminal-resume]' ? this : null; },
  };
  const reconnectAttributes = new Map();
  const reconnect = {
    classList: classList(),
    disabled: false,
    getAttribute: name => reconnectAttributes.get(name) || null,
    setAttribute(name, value) { reconnectAttributes.set(name, String(value)); },
    removeAttribute(name) { reconnectAttributes.delete(name); },
    closest(selector) { return selector === '[data-inline-terminal-reconnect]' ? this : null; },
  };
  const empty = {
    classList: classList(),
    querySelector(selector) {
      if (selector === 'b' || selector === 'small') return { textContent: '' };
      if (selector === '[data-inline-terminal-resume]') return resume;
      return null;
    },
  };
  const createViewport = id => ({
    id,
    children: [],
    isConnected: true,
    appendChild(node) {
      const previousParent = node?.parentElement;
      if (previousParent && Array.isArray(previousParent.children)) {
        previousParent.children = previousParent.children.filter(child => child !== node);
      }
      this.children = this.children.filter(child => child !== node);
      this.children.push(node);
      node.parentElement = this;
      return node;
    },
  });
  const viewport = createViewport('agentInlineTerminalViewport');
  const focusViewport = createViewport('ptyFocusTerminalViewport');
  const storageViewport = createViewport('terminalViewport');
  const status = { textContent: '' };
  const meta = { textContent: '' };
  const shell = {
    dataset: { inlineAgentTerminal: session.id },
    querySelector(selector) {
      if (selector === '#agentInlineTerminalViewport') return viewport;
      if (selector === '[data-inline-terminal-empty]') return empty;
      if (selector === '[data-inline-terminal-resume]') return resume;
      if (selector === '[data-inline-terminal-status]') return status;
      if (selector === '[data-inline-terminal-meta]') return meta;
      if (selector === '[data-inline-terminal-reconnect]') return reconnect;
      return null;
    },
  };
  const focusShell = {
    dataset: { inlineAgentTerminal: session.id },
    querySelector(selector) {
      if (selector === '[data-agent-terminal-viewport]' || selector === '#ptyFocusTerminalViewport') return focusViewport;
      if (selector === '[data-inline-terminal-empty]') return empty;
      if (selector === '[data-inline-terminal-resume]') return resume;
      if (selector === '[data-inline-terminal-status]') return status;
      if (selector === '[data-inline-terminal-meta]') return meta;
      if (selector === '[data-inline-terminal-reconnect]') return reconnect;
      return null;
    },
  };
  const focusSurfaceAttributes = new Map([['aria-hidden', 'false']]);
  const focusSurface = {
    dataset: {},
    classList: classList(),
    hidden: false,
    isConnected: true,
    parentElement: null,
    style: {},
    getAttribute: name => focusSurfaceAttributes.get(name) || null,
    querySelector(selector) {
      return selector === '[data-inline-agent-terminal]' ? focusShell : null;
    },
    setAttribute(name, value) { focusSurfaceAttributes.set(name, String(value)); },
    removeAttribute(name) { focusSurfaceAttributes.delete(name); },
  };
  let activeSession = session;
  let activeShell = shell;
  let activeViewport = viewport;
  const app = {
    state: {
      inlineTerminalSessionId: options.initialOpen === false ? null : session.id,
      ptyFocusSessionId: options.initialFocus ? session.id : null,
      graphFocusId: options.graphFocusId || null,
      details: new Map(),
      snapshot: { sessions: [...fixtureSessions] },
    },
    snapshotSession: id => (id === activeSession.id ? activeSession : null)
      || app.state.snapshot.sessions.find(item => item.id === id)
      || null,
    renderSessions(reason) { renderCalls.push(reason); },
  };
  const body = { closest: () => null };
  const documentElement = { closest: () => null };
  const document = {
    activeElement: body,
    body,
    documentElement,
    visibilityState: 'visible',
    hasFocus: () => true,
    querySelector(selector) {
      if (selector === '#ptyFocusSurface') return focusSurface;
      if (selector === '#agentInlineTerminal[data-inline-agent-terminal]') return activeShell;
      if (selector === '[data-inline-agent-terminal]') return activeShell;
      return null;
    },
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
  };
  let embedded = { connected: false, agentSessionId: '', terminalId: '' };
  let terminalMountGeneration = 0;
  let connectedTarget = null;
  const terminalHosts = new Map();
  const terminalHost = terminalId => {
    const id = String(terminalId || '');
    if (!terminalHosts.has(id)) {
      terminalHosts.set(id, { dataset: { terminalScreen: id }, parentElement: null });
    }
    return terminalHosts.get(id);
  };
  const connectResult = (result, mountedSession = activeSession, mount = activeViewport) => {
    if (!result?.ok || !result.target) return;
    connectedTarget = result.target;
    const terminalId = String(result.target.terminalId || result.target.id || '');
    embedded = { connected: true, agentSessionId: mountedSession.id, terminalId };
    mount.appendChild(terminalHost(terminalId));
  };
  const terminal = {
    agentConnectionSignature: mountedSession => options.agentConnectionSignature?.(mountedSession)
      || JSON.stringify([
        mountedSession?.id,
        mountedSession?.externalId,
        mountedSession?.provider,
        mountedSession?.environment?.kind,
        mountedSession?.environment?.distro,
      ]),
    agentTargets: mountedSession => options.agentTargets
      ? options.agentTargets(mountedSession, connectedTarget)
      : connectedTarget ? [connectedTarget] : [],
    embeddedState: () => ({ ...embedded }),
    focusEmbedded: () => {
      focusCalls.push(session.id);
      return true;
    },
    mountForAgent: async (mountedSession, mountOptions) => {
      const mountGeneration = terminalMountGeneration;
      mountCalls.push({ session: mountedSession, options: { ...mountOptions } });
      const result = await options.mountForAgent(mountedSession, mountOptions, mountCalls.length);
      if (options.autoConnectResults !== false && mountGeneration === terminalMountGeneration) {
        connectResult(result, mountedSession, mountOptions.mount);
      }
      return result;
    },
    resumeForAgent: async (...args) => {
      resumeCalls.push(args);
      return options.resumeForAgent(...args, resumeCalls.length);
    },
    forkForAgent: async (...args) => {
      forkCalls.push(args);
      return options.forkForAgent(...args, forkCalls.length);
    },
    restartForAgent: async (...args) => {
      restartCalls.push(args);
      return options.restartForAgent
        ? options.restartForAgent(...args, restartCalls.length)
        : { ok: true, target: connectedTarget };
    },
    resumeSupport: mountedSession => options.resumeSupport
      ? options.resumeSupport(mountedSession)
      : { supported: true, reason: 'resumable in fixture' },
    forkSupport: mountedSession => options.forkSupport
      ? options.forkSupport(mountedSession)
      : { supported: false, reason: 'not forkable in fixture' },
    unmountEmbedded: () => {
      terminalMountGeneration += 1;
      unmountCalls.push(embedded.terminalId);
      const host = terminalHosts.get(embedded.terminalId);
      if (host) storageViewport.appendChild(host);
      embedded = { connected: false, agentSessionId: '', terminalId: '' };
    },
  };
  const window = {
    WhiteboxApp: app,
    WhiteboxTerminal: terminal,
    WhiteboxI18n: {
      t: key => key,
      errorText: (_error, fallback) => fallback,
    },
    WhiteboxRendererUtils: {
      reportRecoverableError() {},
      canForkCodexDesktopSession(candidate) {
        return Boolean(candidate
          && candidate.provider === 'codex'
          && candidate.clientKind === 'codex-desktop'
          && candidate.status === 'completed'
          && !candidate.parentId
          && !candidate.sourcePluginId
          && candidate.sourcePlugin == null
          && candidate.readOnly !== true);
      },
      isWritableDirectSession(candidate) {
        const markers = [candidate?.source, candidate?.clientKind, candidate?.provenance?.source?.id]
          .map(value => String(value || '').toLowerCase());
        return Boolean(candidate
          && !candidate.parentId
          && !candidate.sourcePluginId
          && candidate.sourcePlugin == null
          && !candidate.provenance?.source?.pluginId
          && candidate.readOnly !== true
          && !candidate.controlAuthority
          && !candidate.importMode
          && !markers.some(value => value === 'whitebox-bridge' || /(?:^|[.:/_-])(?:opencode|omo|aside)(?:$|[.:/_-])/.test(value)));
      },
    },
    getComputedStyle: element => ({
      display: element?.style?.display || (element?.classList?.contains?.('hidden') ? 'none' : 'block'),
      visibility: element?.style?.visibility || 'visible',
    }),
    whitebox: {
      onTerminalState(listener) { terminalStateListeners.push(listener); },
    },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
  };
  const sandbox = {
    window,
    document,
    CustomEvent: class CustomEvent {},
    requestAnimationFrame: callback => { callback(); return 1; },
    queueMicrotask: callback => Promise.resolve().then(callback),
    setTimeout,
  };
  const source = fs.readFileSync(path.join(root, 'renderer', 'inline-agent-terminal.js'), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: 'inline-agent-terminal.js' });
  return {
    app,
    document,
    focusCalls,
    focusShell,
    focusSurface,
    focusViewport,
    forkCalls,
    mountCalls,
    reconnectButton: reconnect,
    restartCalls,
    resumeCalls,
    resumeButton: resume,
    renderCalls,
    inlineViewport: viewport,
    storageViewport,
    unmountCalls,
    session,
    dispatchDocument(type, event = {}) {
      for (const listener of documentListeners.get(type) || []) listener(event);
    },
    dispatchWindow(type, event = {}) {
      for (const listener of windowListeners.get(type) || []) listener(event);
    },
    dispatchTerminalState(payload) {
      for (const listener of terminalStateListeners) listener(payload);
    },
    setEmbedded(next, mount = app.state.ptyFocusSessionId ? focusViewport : activeViewport) {
      const previousHost = terminalHosts.get(embedded.terminalId);
      if (previousHost?.parentElement && Array.isArray(previousHost.parentElement.children)) {
        previousHost.parentElement.children = previousHost.parentElement.children.filter(child => child !== previousHost);
        previousHost.parentElement = null;
      }
      embedded = { connected: false, agentSessionId: '', terminalId: '', ...next };
      if (embedded.connected && embedded.terminalId) mount.appendChild(terminalHost(embedded.terminalId));
    },
    setFocusSurfaceVisible(visible) {
      focusSurface.hidden = !visible;
      focusSurface.classList.toggle('hidden', !visible);
      focusSurface.setAttribute('aria-hidden', String(!visible));
    },
    setFocusShellSessionId(sessionId) {
      focusShell.dataset.inlineAgentTerminal = String(sessionId || '');
    },
    embeddedState: () => ({ ...embedded }),
    embeddedHost: terminalId => terminalHosts.get(String(terminalId || embedded.terminalId || '')) || null,
    terminalHostCount: () => terminalHosts.size,
    enterFocus: (...args) => window.WhiteboxInlineTerminal.enterFocus(...args),
    closeFocus: (...args) => window.WhiteboxInlineTerminal.closeFocus(...args),
    setInlineOpen(sessionId) {
      app.state.inlineTerminalSessionId = sessionId == null ? null : String(sessionId);
    },
    switchSession(nextSession) {
      const nextViewport = createViewport('agentInlineTerminalViewport');
      const nextEmpty = {
        classList: classList(),
        querySelector(selector) {
          if (selector === 'b' || selector === 'small') return { textContent: '' };
          if (selector === '[data-inline-terminal-resume]') return null;
          return null;
        },
      };
      activeSession = nextSession;
      activeViewport = nextViewport;
      activeShell = {
        dataset: { inlineAgentTerminal: nextSession.id },
        querySelector(selector) {
          if (selector === '#agentInlineTerminalViewport') return nextViewport;
          if (selector === '[data-inline-terminal-empty]') return nextEmpty;
          if (selector === '[data-inline-terminal-status]' || selector === '[data-inline-terminal-meta]') return { textContent: '' };
          return null;
        },
      };
      app.state.inlineTerminalSessionId = nextSession.id;
      app.state.snapshot.sessions = [nextSession];
      return activeShell;
    },
    sync: (...args) => window.WhiteboxInlineTerminal.sync(...args),
    close: (...args) => window.WhiteboxInlineTerminal.close(...args),
    toggle: (...args) => window.WhiteboxInlineTerminal.toggle(...args),
  };
}

function registerInlineAgentTerminalTests(context) {
  const { test, root } = context;

  test('PTY 집중 모드는 담당 AI만 열고 기존 관제 선택을 바꾸지 않는다', async () => {
    const mainSession = {
      id: 'codex:focus-root-only',
      externalId: 'focus-root-only-history',
      provider: 'codex',
      cwd: 'D:\\fixture',
      parentId: null,
      controlCapabilities: { pty: true },
    };
    const childSession = {
      ...mainSession,
      id: 'codex:focus-child-blocked',
      externalId: 'focus-child-blocked-history',
      parentId: mainSession.id,
    };
    const target = {
      id: 'terminal:focus-root-only',
      terminalId: 'terminal:focus-root-only',
      kind: 'terminal',
    };
    const harness = createInlineHarness(root, {
      session: mainSession,
      sessions: [mainSession, childSession],
      initialOpen: false,
      graphFocusId: 'codex:remembered-graph-focus',
      mountForAgent: async () => ({ ok: true, target }),
    });
    harness.setInlineOpen('codex:remembered-inline');

    assert.equal(harness.enterFocus(childSession.id), false,
      '독립 PTY가 없는 하위 AI가 집중 모드에 진입했습니다.');
    assert.equal(harness.app.state.ptyFocusSessionId, null);
    assert.equal(harness.mountCalls.length, 0);

    for (const invalid of [
      { ...mainSession, id: 'codex:focus-read-only', readOnly: true },
      { ...mainSession, id: 'codex:focus-plugin-object', sourcePlugin: {} },
      { ...mainSession, id: 'codex:focus-provenance', provenance: { source: { pluginId: 'builtin.omo' } } },
      { ...mainSession, id: 'codex:focus-opencode', source: 'opencode' },
    ]) {
      const blocked = createInlineHarness(root, {
        session: invalid,
        initialOpen: false,
        mountForAgent: async () => ({ ok: true, target }),
      });
      assert.equal(blocked.enterFocus(invalid.id), false);
      blocked.toggle(invalid.id, { focus: false });
      assert.equal(blocked.app.state.inlineTerminalSessionId, null);
      assert.equal((await blocked.sync()).reason, 'not-ready');
      assert.equal(blocked.mountCalls.length, 0,
        `읽기 전용 projection이 PTY 경로에 진입했습니다: ${JSON.stringify(invalid)}`);
    }

    assert.equal(harness.enterFocus(mainSession.id), true);
    assert.equal(harness.app.state.ptyFocusSessionId, mainSession.id);
    assert.equal(harness.app.state.inlineTerminalSessionId, 'codex:remembered-inline',
      '집중 모드 진입이 관제 화면의 기존 inline PTY 선택을 덮어썼습니다.');
    assert.equal(harness.app.state.graphFocusId, 'codex:remembered-graph-focus',
      '집중 모드 진입이 관제 화면의 기존 그래프 선택을 덮어썼습니다.');

    const result = await harness.sync();
    assert.equal(result.ok, true);
    assert.equal(harness.mountCalls.length, 1);
    assert.strictEqual(harness.mountCalls[0].options.mount, harness.focusViewport,
      '집중 모드 PTY가 전용 focus viewport가 아닌 관제 inline viewport에 마운트됐습니다.');
    assert.equal(harness.embeddedState().agentSessionId, mainSession.id);
    assert.equal(harness.embeddedState().terminalId, target.terminalId);
    assert.equal(harness.focusCalls.length, 1,
      '사용자가 연 집중 모드 PTY에 입력 포커스를 전달하지 않았습니다.');

    const liveDesktop = {
      ...mainSession,
      id: 'codex:live-desktop-read-only',
      externalId: 'live-desktop-read-only',
      clientKind: 'codex-desktop',
      status: 'running',
    };
    const readOnlyFocus = createInlineHarness(root, {
      session: liveDesktop,
      initialOpen: false,
      initialFocus: true,
      mountForAgent: async () => ({ ok: true, target }),
    });
    readOnlyFocus.focusSurface.dataset.ptyFocusSession = liveDesktop.id;
    readOnlyFocus.focusSurface.dataset.ptyFocusMode = 'transcript';
    readOnlyFocus.setFocusShellSessionId('');
    const readOnlyResult = await readOnlyFocus.sync({ force: true });
    assert.equal(readOnlyResult.reason, 'read-only-focus');
    assert.equal(readOnlyFocus.app.state.ptyFocusSessionId, liveDesktop.id,
      'passive PTY sync가 읽기 전용 담당 노드 집중 화면을 닫았습니다.');
    assert.equal(readOnlyFocus.mountCalls.length, 0);
    assert.equal(readOnlyFocus.unmountCalls.length, 0);
  });

  test('inline에서 PTY 집중 모드로 갔다 돌아와도 같은 terminal host를 재사용한다', async () => {
    const target = {
      id: 'terminal:focus-host-identity',
      terminalId: 'terminal:focus-host-identity',
      kind: 'terminal',
    };
    const harness = createInlineHarness(root, {
      mountForAgent: async () => ({ ok: true, target }),
    });

    const inlineResult = await harness.sync();
    assert.equal(inlineResult.ok, true);
    const originalHost = harness.embeddedHost(target.terminalId);
    assert.ok(originalHost, '관제 inline PTY host를 만들지 못했습니다.');
    assert.strictEqual(originalHost.parentElement, harness.inlineViewport);
    assert.equal(harness.terminalHostCount(), 1);

    const downgradedInline = createInlineHarness(root, {
      mountForAgent: async () => ({
        ok: true,
        target: { id: 'terminal:downgraded-inline', terminalId: 'terminal:downgraded-inline', kind: 'terminal' },
      }),
    });
    assert.equal((await downgradedInline.sync()).ok, true);
    downgradedInline.session.readOnly = true;
    assert.equal((await downgradedInline.sync()).reason, 'not-eligible');
    assert.equal(downgradedInline.app.state.inlineTerminalSessionId, null);
    assert.equal(downgradedInline.embeddedState().connected, false,
      'snapshot에서 읽기 전용으로 바뀐 inline 세션의 기존 writable host를 회수하지 않았습니다.');

    const downgradedFocus = createInlineHarness(root, {
      initialOpen: false,
      mountForAgent: async () => ({
        ok: true,
        target: { id: 'terminal:downgraded-focus', terminalId: 'terminal:downgraded-focus', kind: 'terminal' },
      }),
    });
    assert.equal(downgradedFocus.enterFocus(downgradedFocus.session.id), true);
    assert.equal((await downgradedFocus.sync()).ok, true);
    downgradedFocus.session.provenance = { source: { pluginId: 'builtin.omo' } };
    assert.equal((await downgradedFocus.sync()).reason, 'not-eligible');
    assert.equal(downgradedFocus.app.state.ptyFocusSessionId, null);
    assert.equal(downgradedFocus.embeddedState().connected, false,
      'snapshot에서 외부 projection으로 바뀐 focus 세션의 기존 writable host를 회수하지 않았습니다.');

    let releasePendingFocusMount;
    const pendingFocus = createInlineHarness(root, {
      initialOpen: false,
      mountForAgent: () => new Promise(resolve => { releasePendingFocusMount = resolve; }),
    });
    assert.equal(pendingFocus.enterFocus(pendingFocus.session.id), true);
    const pendingResult = pendingFocus.sync();
    await Promise.resolve();
    assert.equal(pendingFocus.closeFocus(), true);
    assert.equal(pendingFocus.unmountCalls.length, 1,
      '아직 완료되지 않은 focus mount를 복귀 시 shared generation으로 취소하지 않았습니다.');
    releasePendingFocusMount({
      ok: true,
      target: { id: 'terminal:late-focus', terminalId: 'terminal:late-focus', kind: 'terminal' },
    });
    assert.equal((await pendingResult).reason, 'cancelled');
    assert.equal(pendingFocus.embeddedState().connected, false);
    assert.equal(pendingFocus.focusViewport.children.length, 0,
      '늦게 끝난 focus mount가 숨겨진 focus viewport에 xterm host를 남겼습니다.');

    assert.equal(harness.enterFocus(harness.session.id), true);
    const focusResult = await harness.sync();
    assert.equal(focusResult.ok, true);
    assert.equal(harness.embeddedState().terminalId, target.terminalId);
    assert.strictEqual(harness.embeddedHost(target.terminalId), originalHost,
      '집중 모드 진입이 같은 terminal ID의 xterm host를 새로 만들었습니다.');
    assert.strictEqual(originalHost.parentElement, harness.focusViewport,
      '기존 xterm host를 focus viewport로 재부모화하지 않았습니다.');
    assert.equal(harness.inlineViewport.children.includes(originalHost), false,
      '집중 모드 진입 뒤 같은 host가 관제 inline viewport에도 중복으로 남았습니다.');
    assert.equal(harness.unmountCalls.length, 0,
      '집중 모드 진입 중 살아 있는 embedded PTY를 불필요하게 unmount했습니다.');
    assert.equal(harness.terminalHostCount(), 1);

    assert.equal(harness.closeFocus(), true);
    assert.equal(harness.app.state.ptyFocusSessionId, null);
    assert.equal(harness.app.state.inlineTerminalSessionId, harness.session.id,
      '관제로 복귀하면서 진입 전 inline PTY 선택을 잃었습니다.');
    assert.deepStrictEqual(harness.unmountCalls, [target.terminalId]);
    assert.strictEqual(originalHost.parentElement, harness.storageViewport,
      '관제 재렌더 전 host를 terminal 보관 viewport로 안전하게 돌려놓지 않았습니다.');

    const restored = await harness.sync();
    assert.equal(restored.ok, true);
    assert.equal(harness.embeddedState().terminalId, target.terminalId);
    assert.strictEqual(harness.embeddedHost(target.terminalId), originalHost,
      '관제 복귀가 기존 xterm host 대신 새 host를 만들었습니다.');
    assert.strictEqual(originalHost.parentElement, harness.inlineViewport,
      '관제 sync가 기존 host를 원래 inline viewport로 복원하지 않았습니다.');
    assert.equal(harness.terminalHostCount(), 1);
  });

  test('숨겨졌거나 session이 어긋난 PTY 집중 surface는 writable PTY를 마운트하지 않는다', async () => {
    async function blockedFocusSurface(mode) {
      const harness = createInlineHarness(root, {
        initialOpen: false,
        mountForAgent: async () => ({
          ok: true,
          target: { id: 'terminal:unexpected-focus-mount', terminalId: 'terminal:unexpected-focus-mount', kind: 'terminal' },
        }),
      });
      assert.equal(harness.enterFocus(harness.session.id), true);
      if (mode === 'hidden') harness.setFocusSurfaceVisible(false);
      else harness.setFocusShellSessionId('codex:stale-focus-shell');
      const result = await harness.sync();
      return { harness, result };
    }

    const hidden = await blockedFocusSurface('hidden');
    assert.equal(hidden.result.reason, 'not-ready');
    assert.equal(hidden.harness.mountCalls.length, 0,
      '숨겨진 focus surface에 writable PTY를 마운트했습니다.');
    assert.equal(hidden.harness.embeddedState().connected, false);

    const stale = await blockedFocusSurface('stale');
    assert.equal(stale.result.reason, 'not-ready');
    assert.equal(stale.harness.mountCalls.length, 0,
      '다른 session의 stale focus shell에 writable PTY를 마운트했습니다.');
    assert.equal(stale.harness.embeddedState().connected, false);
  });

  test('PTY 집중 viewport가 소유한 reconnect는 같은 focus surface에만 다시 마운트한다', async () => {
    const target = {
      id: 'terminal:focus-reconnect-owner',
      terminalId: 'terminal:focus-reconnect-owner',
      kind: 'terminal',
    };
    const harness = createInlineHarness(root, {
      initialOpen: false,
      mountForAgent: async () => ({ ok: true, target }),
    });
    assert.equal(harness.enterFocus(harness.session.id), true);
    const initial = await harness.sync();
    assert.equal(initial.ok, true);
    const originalHost = harness.embeddedHost(target.terminalId);
    assert.strictEqual(originalHost?.parentElement, harness.focusViewport);
    assert.equal(harness.mountCalls.length, 1);
    assert.equal(harness.focusCalls.length, 1);

    harness.dispatchWindow('whitebox:terminal-reconnect-focus', {
      detail: { terminalId: target.terminalId },
    });
    harness.dispatchWindow('whitebox:terminal-reconnect-owner', {
      detail: { terminalId: target.terminalId, mountId: harness.focusViewport.id },
    });
    harness.setEmbedded({
      connected: false,
      agentSessionId: harness.session.id,
      terminalId: target.terminalId,
    }, harness.focusViewport);
    harness.dispatchTerminalState({
      change: 'reconnected',
      sessions: [{ id: target.terminalId, status: 'running' }],
    });
    await new Promise(resolve => setTimeout(resolve, 10));

    assert.equal(harness.mountCalls.length, 2,
      'focus viewport가 소유하던 reconnect PTY를 정확히 한 번 remount하지 않았습니다.');
    assert.strictEqual(harness.mountCalls[1].options.mount, harness.focusViewport);
    assert.equal(harness.embeddedState().connected, true);
    assert.equal(harness.embeddedState().terminalId, target.terminalId);
    assert.strictEqual(harness.embeddedHost(target.terminalId), originalHost,
      'reconnect 뒤 같은 terminal host identity를 복원하지 않았습니다.');
    assert.strictEqual(originalHost.parentElement, harness.focusViewport);
    assert.equal(harness.focusCalls.length, 2,
      'focused PTY reconnect 뒤 입력 포커스를 복원하지 않았습니다.');
  });

  test('인라인 PTY 자동 연결은 동시 sync를 합치고 force sync는 pending mount를 안전하게 교체한다', async () => {
    const releaseMounts = [];
    const harness = createInlineHarness(root, {
      mountForAgent: () => new Promise(resolve => { releaseMounts.push(resolve); }),
    });

    const first = harness.sync();
    const second = harness.sync();
    await Promise.resolve();
    assert.equal(harness.mountCalls.length, 1, '동시 sync가 mountForAgent를 중복 호출했습니다.');
    assert.equal(harness.mountCalls[0].options.createIfMissing, true);
    assert.equal(harness.mountCalls[0].options.forkIfOriginOwned, true,
      '사용자가 펼친 인라인 PTY가 Desktop-origin fork 허용을 전달하지 않았습니다.');

    const forced = harness.sync({ force: true });
    await Promise.resolve();
    assert.equal(harness.mountCalls.length, 2,
      'pending passive mount 중 force sync가 null pending을 읽거나 기존 promise에 잘못 흡수됐습니다.');
    releaseMounts[0]({ ok: false, reason: 'superseded' });
    releaseMounts[1]({
      ok: true,
      target: { id: 'terminal:inline-auto-connect', terminalId: 'terminal:inline-auto-connect', kind: 'terminal' },
    });
    await Promise.all([first, second, forced]);
    const repeated = await harness.sync();

    assert.equal(repeated.ok, true);
    assert.equal(repeated.reused, true);
    assert.equal(harness.mountCalls.length, 2, '연결된 PTY의 snapshot sync가 새 mount를 시작했습니다.');
  });

  test('인라인 PTY 자동 연결 실패는 같은 펼침에서 반복하지 않고 재펼침에서만 재시도한다', async () => {
    const harness = createInlineHarness(root, {
      mountForAgent: async () => ({ ok: false, reason: 'mount-failed' }),
    });

    await harness.sync();
    await harness.sync();
    assert.equal(harness.mountCalls.length, 1);
    assert.deepStrictEqual(
      harness.mountCalls.map(call => call.options.createIfMissing),
      [true],
      '실패한 같은 펼침의 snapshot sync가 PTY mount 또는 자동 생성을 다시 시도했습니다.',
    );

    assert.equal(harness.close({ render: false }), true);
    harness.toggle(harness.session.id, { focus: false });
    await harness.sync();
    assert.equal(harness.app.state.inlineTerminalSessionId, harness.session.id);
    assert.equal(harness.mountCalls.length, 2);
    assert.equal(harness.mountCalls[1].options.createIfMissing, true,
      '사용자가 PTY를 닫았다 재펼쳤도 자동 연결 실패 캐시가 초기화되지 않았습니다.');
  });

  test('부모가 관리하는 하위 AI는 signed target이 있어도 PTY를 열거나 마운트하지 않는다', async () => {
    let signedTarget = null;
    const harness = createInlineHarness(root, {
      session: {
        id: 'codex:inline-parent-controlled',
        externalId: 'inline-parent-controlled-history',
        provider: 'codex',
        cwd: 'D:\\fixture',
        parentId: 'codex:parent',
      },
      agentTargets: () => signedTarget ? [signedTarget] : [],
      mountForAgent: async (_session, _mountOptions, callCount) => callCount === 1
        ? { ok: false, reason: 'no-target' }
        : { ok: true, target: signedTarget },
    });

    const first = await harness.sync();
    const repeated = await harness.sync();
    assert.equal(first.reason, 'not-main-session');
    assert.equal(repeated.reason, 'not-main-session');
    assert.equal(harness.mountCalls.length, 0,
      '하위 AI의 오래된 인라인 상태가 snapshot sync에서 PTY를 마운트했습니다.');

    signedTarget = {
      id: 'terminal:inline-parent-signed',
      terminalId: 'terminal:inline-parent-signed',
      kind: 'terminal',
    };
    const connected = await harness.sync();
    assert.equal(connected.reason, 'not-main-session');
    assert.equal(harness.mountCalls.length, 0,
      'signed target이 나타난 하위 AI를 메인 담당 AI PTY처럼 마운트했습니다.');

    harness.app.state.inlineTerminalSessionId = null;
    harness.toggle(harness.session.id);
    assert.equal(harness.app.state.inlineTerminalSessionId, null,
      '하위 AI 클릭이 인라인 PTY 상태를 열었습니다.');
  });

  test('인라인 PTY 새로고침은 같은 terminal ID의 provider 프로세스를 한 번만 재시작한다', async () => {
    let releaseRestart;
    const harness = createInlineHarness(root, {
      mountForAgent: async () => ({
        ok: true,
        target: { id: 'terminal:inline-refresh', terminalId: 'terminal:inline-refresh', kind: 'terminal' },
      }),
      restartForAgent: () => new Promise(resolve => { releaseRestart = resolve; }),
    });
    await harness.sync();
    harness.mountCalls.length = 0;

    harness.dispatchDocument('click', { target: harness.reconnectButton, stopPropagation() {} });
    assert.equal(harness.enterFocus(harness.session.id), true,
      'reconnect 진행 중 같은 세션의 focus surface로 전환하지 못했습니다.');
    harness.dispatchDocument('click', { target: harness.reconnectButton, stopPropagation() {} });
    await Promise.resolve();
    assert.equal(harness.restartCalls.length, 1, 'surface 전환 뒤 같은 reconnect가 provider PTY를 두 번 재시작했습니다.');
    assert.equal(harness.restartCalls[0][1].terminalId, 'terminal:inline-refresh');
    assert.equal(harness.resumeCalls.length, 0, '새로고침이 별도 resume 프로세스를 만들었습니다.');

    releaseRestart({
      ok: true,
      target: { id: 'terminal:inline-refresh', terminalId: 'terminal:inline-refresh', kind: 'terminal' },
    });
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(harness.mountCalls.length, 1, '재시작한 PTY를 같은 terminal ID로 다시 마운트하지 않았습니다.');
    assert.equal(harness.mountCalls[0].options.targetId, 'terminal:inline-refresh');
    assert.strictEqual(harness.mountCalls[0].options.mount, harness.focusViewport,
      'inline에서 시작한 reconnect 완료가 현재 focus viewport에 PTY를 마운트하지 않았습니다.');
    assert.equal(harness.reconnectButton.disabled, false,
      'surface 전환 중 reconnect 버튼이 영구 disabled 상태로 남았습니다.');
  });

  test('세션 연결 서명이 바뀌면 연결된 오래된 PTY를 재사용하지 않는다', async () => {
    let inventoryVisible = true;
    const harness = createInlineHarness(root, {
      agentTargets: (_session, target) => inventoryVisible && target ? [target] : [],
      mountForAgent: async (_session, _mountOptions, callCount) => callCount === 1
        ? {
          ok: true,
          target: { id: 'terminal:inline-old-provider', terminalId: 'terminal:inline-old-provider', kind: 'terminal' },
        }
        : { ok: false, reason: 'no-target' },
    });

    const initial = await harness.sync();
    assert.equal(initial.ok, true);
    harness.session.externalId = 'inline-new-provider-history';
    inventoryVisible = false;
    const afterIdentityChange = await harness.sync();

    assert.equal(afterIdentityChange.ok, false);
    assert.equal(afterIdentityChange.reused, undefined);
    assert.equal(harness.mountCalls.length, 2,
      '세션 연결 서명이 바뀌었는데 이전 provider PTY를 fast-path로 재사용했습니다.');
  });

  test('연결을 기다리는 동안 다른 조작이 있으면 완료 후 PTY가 포커스를 빼앗지 않는다', async () => {
    let releaseMount;
    const harness = createInlineHarness(root, {
      initialOpen: false,
      mountForAgent: () => new Promise(resolve => { releaseMount = resolve; }),
    });

    harness.toggle(harness.session.id, { focus: false });
    const pending = harness.sync();
    await Promise.resolve();
    const otherControl = { closest: () => null };
    harness.document.activeElement = otherControl;
    harness.dispatchDocument('pointerdown', { target: otherControl });
    releaseMount({
      ok: true,
      target: { id: 'terminal:inline-delayed', terminalId: 'terminal:inline-delayed', kind: 'terminal' },
    });
    await pending;

    assert.equal(harness.focusCalls.length, 0,
      '사용자가 다른 컨트롤로 이동한 뒤 늦게 연결된 PTY가 포커스를 빼앗았습니다.');
  });

  test('느린 자동 연결 중 세션 서명이 바뀌면 새 서명 mount를 즉시 시작한다', async () => {
    let releaseFirstMount;
    const observedExternalIds = [];
    const harness = createInlineHarness(root, {
      mountForAgent: (mountedSession, _mountOptions, callCount) => {
        observedExternalIds.push(mountedSession.externalId);
        return callCount === 1
          ? new Promise(resolve => { releaseFirstMount = resolve; })
          : Promise.resolve({
            ok: true,
            target: { id: 'terminal:inline-new-provider', terminalId: 'terminal:inline-new-provider', kind: 'terminal' },
          });
      },
    });

    const first = harness.sync();
    await Promise.resolve();
    harness.session.externalId = 'inline-replaced-while-connecting';
    const superseding = harness.sync();
    await Promise.resolve();

    assert.equal(harness.mountCalls.length, 2,
      '새 canonical identity가 이전 mount promise에 합쳐져 lower terminal supersession을 시작하지 못했습니다.');
    assert.deepStrictEqual(observedExternalIds, [
      'inline-auto-connect-history',
      'inline-replaced-while-connecting',
    ]);

    releaseFirstMount({
      ok: true,
      target: { id: 'terminal:inline-old-provider', terminalId: 'terminal:inline-old-provider', kind: 'terminal' },
    });
    const [firstResult, supersedingResult] = await Promise.all([first, superseding]);

    assert.equal(firstResult.reason, 'cancelled');
    assert.equal(supersedingResult.ok, true);
    assert.equal(supersedingResult.target.terminalId, 'terminal:inline-new-provider');
  });

  test('stale identity 정리는 같은 결과 target만 unmount하고 더 새로운 PTY는 보존한다', async () => {
    async function staleCompletion(activeTerminalId) {
      let releaseFirstMount;
      const harness = createInlineHarness(root, {
        autoConnectResults: false,
        mountForAgent: (_session, _mountOptions, callCount) => callCount === 1
          ? new Promise(resolve => { releaseFirstMount = resolve; })
          : Promise.resolve({ ok: false, reason: 'no-target' }),
      });
      const pending = harness.sync();
      await Promise.resolve();
      harness.session.externalId = 'inline-replaced-before-completion';
      harness.setEmbedded({
        connected: true,
        agentSessionId: harness.session.id,
        terminalId: activeTerminalId,
      });
      releaseFirstMount({
        ok: true,
        target: { id: 'terminal:inline-old-provider', terminalId: 'terminal:inline-old-provider', kind: 'terminal' },
      });
      const result = await pending;
      await new Promise(resolve => setTimeout(resolve, 5));
      return { harness, result };
    }

    const newer = await staleCompletion('terminal:inline-new-provider');
    assert.equal(newer.result.reason, 'stale-identity');
    assert.deepStrictEqual(newer.harness.unmountCalls, [],
      '오래된 mount 완료가 같은 session의 더 새로운 embedded PTY를 unmount했습니다.');

    const stale = await staleCompletion('terminal:inline-old-provider');
    assert.equal(stale.result.reason, 'stale-identity');
    assert.deepStrictEqual(stale.harness.unmountCalls, ['terminal:inline-old-provider'],
      'stale mount 결과와 정확히 같은 embedded PTY를 정리하지 않았습니다.');
  });

  test('창 blur·숨김·document focus 상실은 늦은 PTY focus를 취소한다', async () => {
    async function delayedFocus(cancelFocus) {
      let releaseMount;
      const harness = createInlineHarness(root, {
        initialOpen: false,
        mountForAgent: () => new Promise(resolve => { releaseMount = resolve; }),
      });
      harness.toggle(harness.session.id, { focus: false });
      const pending = harness.sync();
      await Promise.resolve();
      await cancelFocus(harness);
      releaseMount({
        ok: true,
        target: { id: 'terminal:inline-delayed', terminalId: 'terminal:inline-delayed', kind: 'terminal' },
      });
      await pending;
      return harness.focusCalls.length;
    }

    assert.equal(await delayedFocus(async harness => {
      harness.document.hasFocus = () => false;
      harness.dispatchWindow('blur');
      await Promise.resolve();
    }), 0,
      '앱 창 blur 뒤 늦게 연결된 PTY가 포커스를 가져갔습니다.');
    assert.equal(await delayedFocus(harness => {
      harness.document.visibilityState = 'hidden';
      harness.dispatchDocument('visibilitychange');
    }), 0, '문서가 숨겨진 뒤 늦게 연결된 PTY가 포커스를 가져갔습니다.');
    assert.equal(await delayedFocus(harness => {
      harness.document.hasFocus = () => false;
    }), 0, 'document.hasFocus()가 false인데 늦게 연결된 PTY가 포커스를 가져갔습니다.');
  });

  test('긴 resume 중 사용자 조작은 완료 뒤 PTY focus를 취소한다', async () => {
    let releaseResume;
    const harness = createInlineHarness(root, {
      resumeForAgent: () => new Promise(resolve => { releaseResume = resolve; }),
      mountForAgent: async () => ({
        ok: true,
        target: { id: 'terminal:inline-resumed', terminalId: 'terminal:inline-resumed', kind: 'terminal' },
      }),
    });

    harness.dispatchDocument('pointerdown', { target: harness.resumeButton });
    harness.dispatchDocument('click', { target: harness.resumeButton, stopPropagation() {} });
    assert.equal(harness.resumeCalls.length, 1);

    const otherControl = { closest: () => null };
    harness.document.activeElement = otherControl;
    harness.dispatchDocument('pointerdown', { target: otherControl });
    releaseResume({ id: 'terminal:inline-resumed', terminalId: 'terminal:inline-resumed' });
    await new Promise(resolve => setTimeout(resolve, 5));

    assert.equal(harness.mountCalls.length, 1, '현재 resume 결과를 inline PTY에 mount하지 않았습니다.');
    assert.equal(harness.focusCalls.length, 0,
      'resume await 중 사용자 조작을 완료 뒤 새 focus intent로 덮어써 PTY가 포커스를 빼앗았습니다.');

    let releaseTransitionResume;
    const transition = createInlineHarness(root, {
      resumeForAgent: () => new Promise(resolve => { releaseTransitionResume = resolve; }),
      mountForAgent: async () => ({
        ok: true,
        target: { id: 'terminal:focus-resumed', terminalId: 'terminal:focus-resumed', kind: 'terminal' },
      }),
    });
    transition.dispatchDocument('click', { target: transition.resumeButton, stopPropagation() {} });
    assert.equal(transition.enterFocus(transition.session.id), true);
    transition.dispatchDocument('click', { target: transition.resumeButton, stopPropagation() {} });
    const focusAutoSync = transition.sync({ force: true });
    await Promise.resolve();
    assert.equal(transition.resumeCalls.length, 1,
      'inline resume 진행 중 focus auto-sync가 같은 provider resume을 중복 시작했습니다.');
    releaseTransitionResume({ id: 'terminal:focus-resumed', terminalId: 'terminal:focus-resumed' });
    await focusAutoSync;
    assert.equal(transition.mountCalls.length, 1);
    assert.strictEqual(transition.mountCalls[0].options.mount, transition.focusViewport,
      'inline resume 완료가 전환된 focus surface 대신 오래된 viewport를 사용했습니다.');
    assert.equal(transition.resumeButton.disabled, false,
      'surface 전환 중 resume 버튼이 영구 disabled 상태로 남았습니다.');
  });

  test('Codex Desktop 인라인 PTY는 원본 resume 대신 기록을 이어받은 새 세션을 연다', async () => {
    let forkAlive = false;
    const harness = createInlineHarness(root, {
      session: {
        id: 'codex:desktop-fork-source',
        externalId: 'desktop-fork-source',
        provider: 'codex',
        clientKind: 'codex-desktop',
        cwd: 'D:\\fixture',
        parentId: null,
        status: 'completed',
      },
      resumeSupport: () => ({ supported: false, originOwned: true }),
      forkSupport: () => ({ supported: true, action: 'fork' }),
      agentTargets: (_session, connectedTarget) => forkAlive && connectedTarget ? [connectedTarget] : [],
      forkForAgent: async () => {
        forkAlive = true;
        return {
          id: 'terminal:inline-desktop-fork',
          terminalId: 'terminal:inline-desktop-fork',
        };
      },
      mountForAgent: async (_session, _mountOptions, mountCount) => {
        if (mountCount === 2) return { ok: false, reason: 'no-target' };
        forkAlive = true;
        const terminalId = mountCount === 1
          ? 'terminal:inline-desktop-fork'
          : 'terminal:inline-desktop-fork-reopened';
        return {
          ok: true,
          target: { id: terminalId, terminalId, kind: 'terminal' },
        };
      },
    });

    harness.dispatchDocument('click', { target: harness.resumeButton, stopPropagation() {} });
    await new Promise(resolve => setTimeout(resolve, 5));

    assert.equal(harness.forkCalls.length, 1, 'Desktop-origin 기록에서 새 Codex fork를 만들지 않았습니다.');
    assert.equal(harness.resumeCalls.length, 0, 'Desktop-origin 기록을 기존 대화 ID로 resume했습니다.');
    assert.equal(harness.forkCalls[0][0].externalId, 'desktop-fork-source');
    assert.equal(harness.forkCalls[0][1], '');
    assert.equal(harness.forkCalls[0][2], false);
    assert.equal(harness.forkCalls[0][3].focus, false);
    assert.equal(harness.mountCalls.length, 1, '새 fork PTY를 인라인 화면에 마운트하지 않았습니다.');
    assert.equal(harness.mountCalls[0].options.forkIfOriginOwned, true);
    assert.equal(harness.mountCalls[0].options.forkCreationGesture, false,
      '명시 fork 버튼 뒤의 force sync가 별도 fork gesture를 다시 발급했습니다.');

    forkAlive = false;
    harness.setEmbedded({ connected: false, agentSessionId: '', terminalId: '' });
    const passiveAfterExit = await harness.sync({ force: true });
    assert.equal(passiveAfterExit.reason, 'no-target');
    assert.equal(harness.forkCalls.length, 1,
      '종료된 fork 뒤 passive inline sync가 forkForAgent를 다시 호출했습니다.');
    assert.equal(harness.mountCalls[1].options.forkCreationGesture, false,
      '종료된 fork 뒤 passive inline sync가 새 fork 권한을 전달했습니다.');

    assert.equal(harness.close({ render: false }), true);
    harness.toggle(harness.session.id, { focus: false });
    const reopened = await harness.sync({ force: true });
    assert.equal(reopened.ok, true);
    assert.equal(harness.mountCalls[2].options.forkCreationGesture, true,
      '사용자가 inline surface를 닫았다 다시 펼친 새 gesture가 fork 권한을 전달하지 않았습니다.');

    let releaseExplicitMount;
    const forceRace = createInlineHarness(root, {
      initialOpen: false,
      session: {
        id: 'codex:desktop-fork-force-race',
        externalId: 'desktop-fork-force-race',
        provider: 'codex',
        clientKind: 'codex-desktop',
        cwd: 'D:\\fixture',
        parentId: null,
        status: 'completed',
      },
      forkSupport: () => ({ supported: true, action: 'fork' }),
      mountForAgent: () => new Promise(resolve => { releaseExplicitMount = resolve; }),
    });
    forceRace.toggle(forceRace.session.id, { focus: false });
    const explicitMount = forceRace.sync();
    await Promise.resolve();
    assert.equal(forceRace.mountCalls.length, 1);
    assert.equal(forceRace.mountCalls[0].options.forkCreationGesture, true);
    const passiveForce = forceRace.sync({ force: true });
    await Promise.resolve();
    assert.equal(forceRace.mountCalls.length, 1,
      '진행 중인 명시적 inline fork mount를 passive force sync가 취소하면 안 됩니다.');
    releaseExplicitMount({
      ok: true,
      target: { id: 'terminal:inline-force-race', terminalId: 'terminal:inline-force-race', kind: 'terminal' },
    });
    const [explicitResult, passiveResult] = await Promise.all([explicitMount, passiveForce]);
    assert.equal(explicitResult.ok, true);
    assert.equal(passiveResult.ok, true);
  });

  test('A resume 완료는 이미 전환한 B inline PTY를 force sync하지 않는다', async () => {
    let releaseResume;
    const harness = createInlineHarness(root, {
      resumeForAgent: () => new Promise(resolve => { releaseResume = resolve; }),
      mountForAgent: async () => ({
        ok: true,
        target: { id: 'terminal:unexpected-b-sync', terminalId: 'terminal:unexpected-b-sync', kind: 'terminal' },
      }),
    });

    harness.dispatchDocument('pointerdown', { target: harness.resumeButton });
    harness.dispatchDocument('click', { target: harness.resumeButton, stopPropagation() {} });
    assert.equal(harness.resumeCalls.length, 1);
    harness.switchSession({
      id: 'codex:inline-session-b',
      externalId: 'inline-session-b-history',
      provider: 'codex',
      cwd: 'D:\\fixture-b',
      parentId: null,
    });

    releaseResume({ id: 'terminal:inline-session-a', terminalId: 'terminal:inline-session-a' });
    await new Promise(resolve => setTimeout(resolve, 5));

    assert.equal(harness.mountCalls.length, 0,
      'A의 늦은 resume 완료가 현재 선택된 B session에 force sync를 실행했습니다.');
    assert.equal(harness.focusCalls.length, 0);

    let releaseOldIdentityResume;
    const sameIdHarness = createInlineHarness(root, {
      resumeForAgent: () => new Promise(resolve => { releaseOldIdentityResume = resolve; }),
      mountForAgent: async () => ({
        ok: true,
        target: { id: 'terminal:inline-new-identity', terminalId: 'terminal:inline-new-identity', kind: 'terminal' },
      }),
    });
    sameIdHarness.dispatchDocument('pointerdown', { target: sameIdHarness.resumeButton });
    sameIdHarness.dispatchDocument('click', { target: sameIdHarness.resumeButton, stopPropagation() {} });
    sameIdHarness.session.externalId = 'inline-new-canonical-identity';
    sameIdHarness.setEmbedded({
      connected: true,
      agentSessionId: sameIdHarness.session.id,
      terminalId: 'terminal:inline-new-identity',
    });
    sameIdHarness.dispatchWindow('whitebox:terminal-reconnect-focus', {
      detail: { terminalId: 'terminal:inline-new-identity' },
    });
    releaseOldIdentityResume({ id: 'terminal:inline-old-identity', terminalId: 'terminal:inline-old-identity' });
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(sameIdHarness.mountCalls.length, 0);

    sameIdHarness.setEmbedded({ connected: false, agentSessionId: '', terminalId: '' });
    await sameIdHarness.sync({ force: true });
    assert.equal(sameIdHarness.focusCalls.length, 1,
      '오래된 same-id resume 완료가 더 새로운 canonical identity의 focus intent를 지웠습니다.');
  });

  test('reconnect focus intent는 현재 embedded PTY에만 적용되고 후속 조작으로 취소된다', async () => {
    async function reconnectFocus(eventTerminalId, blurHasFocus = null) {
      const harness = createInlineHarness(root, {
        mountForAgent: async () => ({
          ok: true,
          target: { id: 'terminal:inline-reconnected', terminalId: 'terminal:inline-reconnected', kind: 'terminal' },
        }),
      });
      harness.setEmbedded({
        connected: true,
        agentSessionId: harness.session.id,
        terminalId: 'terminal:inline-before-reconnect',
      });
      harness.dispatchWindow('whitebox:terminal-reconnect-focus', {
        detail: { terminalId: eventTerminalId },
      });
      harness.setEmbedded({ connected: false, agentSessionId: '', terminalId: '' });
      harness.dispatchDocument('focusin', { target: harness.document.body });
      if (blurHasFocus !== null) {
        harness.document.hasFocus = () => blurHasFocus;
        harness.dispatchWindow('blur');
        await Promise.resolve();
      }
      await harness.sync({ force: true });
      return harness.focusCalls.length;
    }

    assert.equal(await reconnectFocus('terminal:inline-before-reconnect'), 1,
      '현재 focused embedded PTY의 reconnect 뒤 focus가 복원되지 않았습니다.');
    assert.equal(await reconnectFocus('terminal:unrelated'), 0,
      '다른 terminal reconnect 이벤트가 inline PTY focus intent를 만들었습니다.');
    assert.equal(await reconnectFocus('terminal:inline-before-reconnect', true), 1,
      'xterm host detach의 synthetic blur가 reconnect focus intent를 취소했습니다.');
    assert.equal(await reconnectFocus('terminal:inline-before-reconnect', false), 0,
      '실제 창 blur 뒤 reconnect된 PTY가 포커스를 가져갔습니다.');
  });

  test('reconnect remount는 현재 inline 또는 PTY 집중 viewport의 exact 소유권만 따른다', async () => {
    async function reconnectResult({ focus = false, advertisedMountId }) {
      const harness = createInlineHarness(root, {
        initialOpen: !focus,
        mountForAgent: async () => ({
          ok: true,
          target: { id: 'terminal:inline-owner', terminalId: 'terminal:inline-owner', kind: 'terminal' },
        }),
      });
      if (focus) assert.equal(harness.enterFocus(harness.session.id), true);
      const viewport = focus ? harness.focusViewport : harness.inlineViewport;
      harness.setEmbedded({
        connected: true,
        agentSessionId: harness.session.id,
        terminalId: 'terminal:inline-owner',
      }, viewport);
      harness.dispatchWindow('whitebox:terminal-reconnect-focus', {
        detail: { terminalId: 'terminal:inline-owner' },
      });
      harness.dispatchWindow('whitebox:terminal-reconnect-owner', {
        detail: { terminalId: 'terminal:inline-owner', mountId: advertisedMountId },
      });
      harness.setEmbedded({
        connected: false,
        agentSessionId: harness.session.id,
        terminalId: 'terminal:inline-owner',
      }, viewport);
      harness.dispatchTerminalState({
        change: 'reconnected',
        sessions: [{ id: 'terminal:inline-owner', status: 'running' }],
      });
      await new Promise(resolve => setTimeout(resolve, 5));
      return {
        harness,
        focusCount: harness.focusCalls.length,
        mountCount: harness.mountCalls.length,
        viewport,
      };
    }

    const inlineOwner = await reconnectResult({
      advertisedMountId: 'agentInlineTerminalViewport',
    });
    assert.equal(inlineOwner.mountCount, 1,
      'inline viewport가 소유하던 PTY를 host reconnect 뒤 자동 remount하지 않았습니다.');
    assert.strictEqual(inlineOwner.harness.mountCalls[0].options.mount, inlineOwner.viewport);
    assert.equal(inlineOwner.focusCount, 1,
      'inline viewport의 exact reconnect 뒤 입력 focus가 복원되지 않았습니다.');

    const inlineClaimedAsFocus = await reconnectResult({
      advertisedMountId: 'ptyFocusTerminalViewport',
    });
    assert.equal(inlineClaimedAsFocus.mountCount, 0,
      'PTY 집중 viewport id가 현재 inline viewport의 reconnect 소유권을 가로챘습니다.');
    assert.equal(inlineClaimedAsFocus.focusCount, 0,
      '소유권이 일치하지 않는 reconnect가 inline PTY focus를 적용했습니다.');

    const focusClaimedAsInline = await reconnectResult({
      focus: true,
      advertisedMountId: 'agentInlineTerminalViewport',
    });
    assert.equal(focusClaimedAsInline.mountCount, 0,
      'inline viewport id가 현재 PTY 집중 viewport의 reconnect 소유권을 가로챘습니다.');
    assert.equal(focusClaimedAsInline.focusCount, 0,
      '소유권이 일치하지 않는 reconnect가 PTY 집중 mode focus를 적용했습니다.');
  });
}

module.exports = { registerInlineAgentTerminalTests };
