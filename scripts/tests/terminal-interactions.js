'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createElement(documentRef = () => null, queryFallback = true) {
  const classes = new Set();
  const changes = [];
  const children = [];
  const listeners = new Map();
  const element = {
    dataset: {},
    disabled: false,
    value: '',
    textContent: '',
    innerHTML: '',
    placeholder: '',
    isConnected: true,
    querySelector(selector) {
      const className = String(selector || '').startsWith('.') ? String(selector).slice(1) : '';
      for (const child of children) {
        if (className && child.classList?.contains(className)) return child;
        const nested = child.querySelector?.(selector);
        if (nested) return nested;
      }
      return queryFallback ? createElement(documentRef, true) : null;
    },
    appendChild(child) {
      if (child.parentElement && Array.isArray(child.parentElement.children)) {
        const previousIndex = child.parentElement.children.indexOf(child);
        if (previousIndex >= 0) child.parentElement.children.splice(previousIndex, 1);
      }
      child.parentElement = this;
      child.isConnected = this.isConnected;
      children.push(child);
      return child;
    },
    contains(candidate) {
      for (let current = candidate; current; current = current.parentElement) {
        if (current === this) return true;
      }
      return false;
    },
    remove() {
      if (this.parentElement && Array.isArray(this.parentElement.children)) {
        const index = this.parentElement.children.indexOf(this);
        if (index >= 0) this.parentElement.children.splice(index, 1);
      }
      this.parentElement = null;
      this.isConnected = false;
    },
    addEventListener(type, callback, options = {}) {
      const key = String(type || '');
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push({
        callback,
        capture: options === true || Boolean(options?.capture),
      });
    },
    removeEventListener(type, callback, options = {}) {
      const key = String(type || '');
      const capture = options === true || Boolean(options?.capture);
      const registered = listeners.get(key) || [];
      const index = registered.findIndex(listener => listener.callback === callback && listener.capture === capture);
      if (index >= 0) registered.splice(index, 1);
    },
    dispatchEvent(event) {
      if (!event || !event.type) throw new TypeError('Fixture event requires a type.');
      if (!event.target) event.target = this;
      const path = [];
      for (let current = this; current; current = current.parentElement) path.push(current);
      const invoke = (current, capture) => {
        event.currentTarget = current;
        for (const listener of [...(current.__listeners.get(String(event.type)) || [])]) {
          if (listener.capture !== capture) continue;
          listener.callback.call(current, event);
          if (event.__immediatePropagationStopped) break;
        }
      };
      for (const current of [...path].reverse()) {
        invoke(current, true);
        if (event.__propagationStopped) break;
      }
      if (!event.__propagationStopped) {
        invoke(this, false);
        if (event.bubbles !== false) {
          for (const current of path.slice(1)) {
            if (event.__propagationStopped) break;
            invoke(current, false);
          }
        }
      }
      event.currentTarget = null;
      return !event.defaultPrevented;
    },
    setAttribute() {},
    toggleAttribute() {},
    removeAttribute() {},
    focus() {
      const document = documentRef();
      if (document) document.activeElement = this;
    },
  };
  element.children = children;
  element.__listeners = listeners;
  const record = (type, tokens) => {
    changes.push({ type, tokens: [...tokens] });
    if (type === 'add' && tokens.includes('hidden')) {
      const document = documentRef();
      if (document?.activeElement && element.contains(document.activeElement)) document.activeElement = document.body;
    }
  };
  element.classList = {
    changes,
    add(...tokens) {
      const added = tokens.filter(token => !classes.has(token));
      tokens.forEach(token => classes.add(token));
      if (added.length) record('add', added);
    },
    remove(...tokens) {
      const removed = tokens.filter(token => classes.delete(token));
      if (removed.length) record('remove', removed);
    },
    toggle(token, force) {
      const enabled = force === undefined ? !classes.has(token) : Boolean(force);
      if (enabled) this.add(token);
      else this.remove(token);
      return enabled;
    },
    contains(token) { return classes.has(token); },
  };
  Object.defineProperty(element, 'className', {
    get() { return [...classes].join(' '); },
    set(value) {
      const next = String(value || '').split(/\s+/).filter(Boolean);
      classes.clear();
      next.forEach(token => classes.add(token));
      changes.push({ type: 'set', tokens: next });
    },
  });
  return element;
}

function createWorkbench(root, options = {}) {
  const source = fs.readFileSync(path.join(root, 'renderer', 'terminal-workbench.js'), 'utf8');
  let fixtureDocument = null;
  const createFixtureElement = () => createElement(() => fixtureDocument, true);
  const createDomElement = () => createElement(() => fixtureDocument, false);
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, createFixtureElement());
    return elements.get(selector);
  };
  const terminalCalls = [];
  const rawWrites = [];
  const terminalInstances = [];
  const notices = [];
  const documentListeners = new Map();
  const session = options.session || null;
  const remote = options.remote || null;
  class FixtureWheelEvent {
    constructor(type, init = {}) {
      this.type = String(type || '');
      this.bubbles = Boolean(init.bubbles);
      this.cancelable = Boolean(init.cancelable);
      this.deltaX = Number(init.deltaX) || 0;
      this.deltaY = Number(init.deltaY) || 0;
      this.deltaZ = Number(init.deltaZ) || 0;
      this.deltaMode = Number(init.deltaMode) || 0;
      this.ctrlKey = Boolean(init.ctrlKey);
      this.shiftKey = Boolean(init.shiftKey);
      this.altKey = Boolean(init.altKey);
      this.metaKey = Boolean(init.metaKey);
      this.defaultPrevented = false;
      this.__propagationStopped = false;
      this.__immediatePropagationStopped = false;
    }
    preventDefault() {
      if (this.cancelable) this.defaultPrevented = true;
    }
    stopPropagation() {
      this.__propagationStopped = true;
    }
    stopImmediatePropagation() {
      this.__immediatePropagationStopped = true;
      this.__propagationStopped = true;
    }
  }
  fixtureDocument = {
    body: createFixtureElement(),
    activeElement: null,
    hidden: options.visibilityState === 'hidden',
    visibilityState: options.visibilityState || 'visible',
    createElement: createDomElement,
    querySelector: element,
    querySelectorAll: () => [],
    getElementById: id => element(`#${id}`),
    addEventListener(type, callback) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(callback);
    },
    dispatchEvent(event) {
      for (const callback of documentListeners.get(String(event?.type || '')) || []) callback(event);
      return true;
    },
  };
  fixtureDocument.activeElement = fixtureDocument.body;
  const sandbox = {
    document: fixtureDocument,
    requestAnimationFrame: options.requestAnimationFrame || (callback => callback()),
    cancelAnimationFrame: options.cancelAnimationFrame || (() => {}),
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout,
    window: {
      cancelAnimationFrame: options.cancelAnimationFrame || (() => {}),
      WhiteboxI18n: { t: key => key },
      WheelEvent: FixtureWheelEvent,
      Terminal: class FixtureTerminal {
        constructor() {
          this.writes = [];
          this.wheelEvents = [];
          this.buffer = { active: { viewportY: 0, baseY: 0 } };
          this.options = { smoothScrollDuration: 100 };
          terminalInstances.push(this);
        }
        loadAddon() {}
        open(host) {
          this.xtermElement = createDomElement();
          this.xtermElement.className = 'xterm';
          this.scrollableElement = createDomElement();
          this.scrollableElement.className = 'xterm-scrollable-element';
          this.screenElement = createDomElement();
          this.screenElement.className = 'xterm-screen';
          this.helperTextarea = createDomElement();
          this.helperTextarea.className = 'xterm-helper-textarea';
          host.appendChild(this.xtermElement);
          this.xtermElement.appendChild(this.scrollableElement);
          this.scrollableElement.appendChild(this.screenElement);
          this.screenElement.appendChild(this.helperTextarea);
          this.scrollableElement.addEventListener('wheel', event => {
            this.wheelEvents.push(event);
            const direction = Math.sign(Number(event.deltaY) || 0);
            if (!direction || event.defaultPrevented) return;
            this.scrollLines(direction * 3);
            event.preventDefault();
          }, { passive: false });
        }
        onScroll(callback) { this.scrollHandler = callback; }
        onData(callback) { this.dataHandler = callback; }
        onResize() {}
        attachCustomKeyEventHandler(callback) { this.keyEventHandler = callback; }
        focus() { this.helperTextarea?.focus(); }
        write(data, callback) {
          this.writes.push(String(data));
          if (Number.isFinite(options.remoteWriteBaseY)) {
            this.buffer.active.baseY = Number(options.remoteWriteBaseY);
            this.buffer.active.viewportY = Number(options.remoteWriteBaseY);
            this.scrollHandler?.(this.buffer.active.viewportY);
          }
          callback?.();
        }
        clear() {}
        reset() {
          this.resetCalls = Number(this.resetCalls || 0) + 1;
          this.buffer.active.viewportY = 0;
          this.buffer.active.baseY = 0;
          this.scrollHandler?.(0);
        }
        scrollLines(lines) {
          const active = this.buffer.active;
          active.viewportY = Math.max(0, Math.min(Number(active.baseY) || 0, Number(active.viewportY || 0) + Number(lines || 0)));
          this.scrollHandler?.(active.viewportY);
        }
        scrollToTop() {
          this.scrollToTopCalls = Number(this.scrollToTopCalls || 0) + 1;
          this.scrollToTopDurations = [
            ...(this.scrollToTopDurations || []),
            this.options.smoothScrollDuration,
          ];
          if (this.options.smoothScrollDuration === 0) {
            this.buffer.active.viewportY = 0;
            this.scrollHandler?.(0);
          }
        }
        scrollToLine(line) {
          this.scrollToLineCalls = [...(this.scrollToLineCalls || []), Number(line)];
          this.scrollToLineDurations = [
            ...(this.scrollToLineDurations || []),
            this.options.smoothScrollDuration,
          ];
          if (this.options.smoothScrollDuration === 0) {
            this.buffer.active.viewportY = Number(line);
            this.scrollHandler?.(this.buffer.active.viewportY);
          }
        }
        scrollToBottom() {
          this.scrollToBottomCalls = Number(this.scrollToBottomCalls || 0) + 1;
          this.scrollToBottomDurations = [
            ...(this.scrollToBottomDurations || []),
            this.options.smoothScrollDuration,
          ];
          this.buffer.active.viewportY = this.buffer.active.baseY;
          this.scrollHandler?.(this.buffer.active.viewportY);
        }
        dispose() {}
      },
      FitAddon: { FitAddon: class FixtureFitAddon { fit() {} } },
      whitebox: {
        terminalList: options.terminalList || (async () => []),
        terminalGet: options.terminalGet || (async () => ({ replay: '', outputSequence: 0 })),
        terminalWrite: async (id, data, deliveryOptions) => {
          rawWrites.push([id, data, deliveryOptions]);
          if (options.terminalWrite) return options.terminalWrite(id, data, deliveryOptions, rawWrites.length);
          return { ok: true, deliveryState: 'accepted' };
        },
        terminalCommand: async (id, text, deliveryOptions) => {
          terminalCalls.push([id, text, deliveryOptions]);
          return options.terminalCommandResult || { ok: true };
        },
        tmuxCapture: options.tmuxCapture || (async () => null),
      },
    },
  };
  vm.runInNewContext(source, sandbox, { filename: 'terminal-workbench.js' });
  const state = {
    sessions: session ? [session] : [],
    selectedId: session?.id || null,
    selectedTmux: remote,
    snapshot: null,
    mode: remote ? 'tmux' : 'general',
    interactionMode: options.interactionMode || 'computer',
    commandSending: false,
    commandDrafts: new Map(),
    commandDeliveries: new Map(),
    terminals: new Map(),
    remoteTerminal: options.createRemoteTerminal ? null : {
      host: createFixtureElement(),
      terminal: { clear() {}, reset() {} },
      fit: { fit() {} },
      readOnly: true,
    },
    remoteCapture: '',
    remoteViewportAnchor: null,
    remoteViewportAtBottom: false,
    remoteWheelIdleUntil: 0,
    remotePendingWheelEvents: [],
    remoteCaptureRetryTimer: null,
    remoteUserScrollRevision: 0,
    remoteCaptureApplying: false,
    captureInFlight: false,
    captureGeneration: 0,
    captureRevision: 0,
    terminalSessionRevision: 0,
    terminalListRequestGeneration: 0,
    sessionOrder: [],
    sessionRenderKey: '',
    active: options.active === true,
    platform: { label: 'Test computer' },
  };
  const workbench = sandbox.window.WhiteboxTerminalWorkbench({
    $: element,
    state,
    notice: (message, tone) => notices.push([message, tone]),
    setConnectionState() {},
    currentSession: () => session,
    currentTmux: () => remote,
    saveCurrentDraft() {},
    restoreCurrentDraft() {},
    renderHistoryPanel() {},
    terminalTypeMark: () => '›_',
    terminalTypeLabel: () => 'shell',
    providerLabel: provider => provider || 'AI',
    xtermOptions: () => ({}),
    preferredWorkspace: () => '',
    firstDistro: () => null,
    guarded: async action => action(),
    esc: value => String(value ?? ''),
    errorMessage: error => String(error),
    modeSessions: () => state.sessions,
    STATUS_LABELS: {},
    visibleBoundAgent: () => options.boundAgent || null,
    moveWorkbench() {},
    syncComposer() {},
    tmuxRows: () => options.tmuxRows || [],
    updateSnapshot() {},
  });
  return {
    state,
    workbench,
    terminalCalls,
    rawWrites,
    terminalInstances,
    notices,
    elements,
    document: fixtureDocument,
    WheelEvent: FixtureWheelEvent,
  };
}

function loadPreloadApi(root, invoke) {
  const source = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  let exposed = null;
  const ipcRenderer = {
    invoke,
    on() {},
    removeListener() {},
  };
  vm.runInNewContext(source, {
    require: name => {
      if (name === 'electron') {
        return {
          ipcRenderer,
          contextBridge: {
            exposeInMainWorld(name, value) {
              if (name === 'whitebox') exposed = value;
            },
          },
        };
      }
      throw new Error(`unexpected preload dependency: ${name}`);
    },
  }, { filename: 'preload.js' });
  return exposed;
}

function registerTerminalInteractionTests(context) {
  const { test, root } = context;

  function terminalWriteHandler(write) {
    const handlers = new Map();
    const { registerTerminalIpc } = require(path.join(root, 'src', 'ipc', 'registerTerminalIpc'));
    registerTerminalIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      requireTrustedSender() {},
      manager: () => ({ write }),
      listWslDistros: () => [],
    });
    return handlers.get('terminals:write');
  }

  test('늦은 터미널 목록 응답이 더 최신 state 이벤트를 덮어쓰지 않는다', async () => {
    let resolveList;
    const pendingList = new Promise(resolve => { resolveList = resolve; });
    const { state, workbench } = createWorkbench(root, {
      terminalList: () => pendingList,
    });
    const staleRefresh = workbench.refreshSessions();
    await Promise.resolve();
    await workbench.refreshSessions({
      change: 'created',
      sessions: [{ id: 'terminal:new', type: 'agent', status: 'running', title: '새 PTY' }],
    });
    resolveList([{ id: 'terminal:old', type: 'agent', status: 'running', title: '옛 PTY' }]);
    await staleRefresh;

    assert.deepStrictEqual(state.sessions.map(session => session.id), ['terminal:new']);
  });

  test('동일 선택 PTY의 state 갱신은 보이는 xterm과 입력 포커스를 유지한다', async () => {
    let terminalGetCalls = 0;
    const session = { id: 'terminal:stable-refresh', type: 'agent', status: 'running', title: 'Stable PTY' };
    const { state, workbench, terminalInstances, document } = createWorkbench(root, {
      session,
      terminalGet: async () => {
        terminalGetCalls += 1;
        return { replay: 'ready\r\n', outputSequence: 1 };
      },
    });

    const entry = await workbench.ensureSessionTerminal(session);
    entry.host.classList.remove('hidden');
    state.active = true;
    terminalInstances[0].helperTextarea.focus();
    entry.host.classList.changes.length = 0;

    await workbench.refreshSessions({
      change: 'updated',
      sessions: [{ ...session, updatedAt: '2026-08-11T00:00:00.000Z' }],
    });

    assert.strictEqual(state.terminals.get(session.id), entry, '같은 PTY state 갱신이 xterm entry를 교체했습니다.');
    assert.equal(entry.host.classList.contains('hidden'), false, '선택된 PTY가 state 갱신 뒤 숨겨졌습니다.');
    assert.equal(
      entry.host.classList.changes.some(change => change.type === 'add' && change.tokens.includes('hidden')),
      false,
      '동일 선택 state 갱신 중 xterm을 잠시 hidden으로 전환하면 화면 깜빡임과 IME 중단이 발생합니다.',
    );
    assert.strictEqual(document.activeElement, terminalInstances[0].helperTextarea,
      '동일 선택 state 갱신이 xterm 입력 포커스를 잃었습니다.');
    assert.equal(terminalGetCalls, 1, '동일 xterm state 갱신이 replay를 다시 조회했습니다.');
  });

  test('xterm fit은 기존 하단만 새 행 수의 하단으로 맞추고 사용자 스크롤 위치는 유지한다', async () => {
    const frames = [];
    const session = { id: 'terminal:fit-bottom', type: 'agent', status: 'running', title: 'Fit bottom PTY' };
    const { workbench, terminalInstances } = createWorkbench(root, {
      session,
      requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    });
    const entry = await workbench.ensureSessionTerminal(session);
    const terminal = terminalInstances[0];
    entry.host.classList.remove('hidden');
    entry.fit.fit = () => { terminal.buffer.active.baseY = 169; };

    terminal.buffer.active = { viewportY: 163, baseY: 163 };
    entry.outputRestoreGeneration = 7;
    workbench.fitEntry(entry, session.id);
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.equal(terminal.buffer.active.viewportY, 169,
      '행 수가 줄어든 뒤 replay tail이 새 viewport 아래에 남았습니다.');
    assert.equal(terminal.scrollToBottomCalls, 1);
    assert.deepStrictEqual(terminal.scrollToBottomDurations, [0],
      '자동 tail 보정이 xterm smooth-scroll 경합을 남겼습니다.');
    assert.equal(terminal.options.smoothScrollDuration, 100,
      '자동 tail 보정 뒤 일반 사용자 smooth-scroll 설정을 복원하지 않았습니다.');
    assert.equal(entry.outputRestoreGeneration, 8,
      'fit 이전 output anchor가 replay tail을 다시 가리지 않도록 무효화하지 않았습니다.');

    terminal.scrollToBottomCalls = 0;
    terminal.scrollToBottomDurations = [];
    entry.outputRestoreGeneration = 11;
    entry.userScrollRevision = 1;
    terminal.buffer.active = { viewportY: 163, baseY: 163 };
    workbench.fitEntry(entry, session.id);
    // A pointer/keyboard scroll intent arriving after the fit was queued must
    // win even though that request originally observed the buffer at bottom.
    entry.userScrollRevision = 2;
    terminal.buffer.active.viewportY = 120;
    frames.shift()();
    assert.equal(terminal.buffer.active.viewportY, 120,
      '사용자가 위로 스크롤한 viewport를 fit이 강제로 하단으로 이동했습니다.');
    assert.equal(terminal.scrollToBottomCalls, 0);
    assert.deepStrictEqual(terminal.scrollToBottomDurations, []);
    assert.equal(terminal.options.smoothScrollDuration, 100);
    assert.equal(entry.outputRestoreGeneration, 11,
      '사용자 scrollback의 output anchor generation을 fit이 변경했습니다.');
  });

  test('tmux 캡처는 자동 viewport 복원을 동기화하고 사용자 smooth-scroll 설정을 보존한다', async () => {
    const remote = {
      distro: { name: 'FixtureLinux' },
      session: { name: 'workspace' },
      window: { index: 0, name: 'main' },
      pane: { id: 'pane-7', nativeId: '%7', command: 'zsh', cwd: '/workspace', dead: false },
    };
    let captureRevision = 0;
    const { state, workbench, terminalInstances } = createWorkbench(root, {
      remote,
      active: true,
      createRemoteTerminal: true,
      remoteWriteBaseY: 64,
      tmuxCapture: async () => ({ output: `capture-${++captureRevision}\n` }),
    });

    await workbench.captureRemote();
    const terminal = terminalInstances[0];
    assert.equal(terminal.buffer.active.viewportY, 0,
      '첫 tmux 캡처의 smooth-scroll가 끝나기 전에 하단 viewport를 저장했습니다.');
    assert.deepStrictEqual(terminal.scrollToTopDurations, [0],
      '첫 캡처의 자동 top 복원이 비동기 smooth-scroll 경쟁을 남겼습니다.');
    assert.equal(state.remoteViewportAnchor, 0);
    assert.deepStrictEqual(
      [state.remoteTerminal.host.dataset.viewportY, state.remoteTerminal.host.dataset.baseY],
      ['0', '64'],
      '캡처 완료 표식이 reset/write 중간 좌표와 섞였습니다.',
    );

    terminal.buffer.active.viewportY = 17;
    terminal.scrollHandler(17);
    await workbench.captureRemote();
    assert.equal(terminal.buffer.active.viewportY, 17,
      '반복 캡처가 사용자가 선택한 scrollback 위치를 덮어썼습니다.');
    assert.deepStrictEqual(terminal.scrollToLineCalls, [17]);
    assert.deepStrictEqual(terminal.scrollToLineDurations, [0],
      '사용자 viewport 복원이 비동기 smooth-scroll 경쟁을 남겼습니다.');
    assert.deepStrictEqual(
      [state.remoteTerminal.host.dataset.viewportY, state.remoteTerminal.host.dataset.baseY],
      ['17', '64'],
      '반복 캡처 완료 표식이 복원 전 viewport를 노출했습니다.',
    );

    terminal.buffer.active.viewportY = terminal.buffer.active.baseY;
    terminal.scrollHandler(terminal.buffer.active.baseY);
    await workbench.captureRemote();
    assert.equal(terminal.buffer.active.viewportY, terminal.buffer.active.baseY,
      '하단을 보던 tmux 캡처가 새 출력의 하단을 따라가지 못했습니다.');
    assert.deepStrictEqual(terminal.scrollToBottomDurations, [0],
      '자동 tail 복원이 비동기 smooth-scroll 경쟁을 남겼습니다.');
    assert.equal(terminal.options.smoothScrollDuration, 100,
      '자동 viewport 복원 뒤 일반 사용자 smooth-scroll 설정을 복원하지 않았습니다.');
  });

  test('tmux 캡처 적용 중 실제 Xterm wheel 입력은 한 번 큐에 보관한 뒤 같은 이벤트로 재생한다', async () => {
    const remote = {
      distro: { name: 'FixtureLinux' },
      session: { name: 'workspace' },
      window: { index: 0, name: 'main' },
      pane: { id: 'pane-7', nativeId: '%7', command: 'zsh', cwd: '/workspace', dead: false },
    };
    const frames = [];
    let captureNumber = 0;
    const { state, workbench, terminalInstances, WheelEvent } = createWorkbench(root, {
      remote,
      active: true,
      createRemoteTerminal: true,
      remoteWriteBaseY: 64,
      requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
      tmuxCapture: async () => ({ output: `capture-${++captureNumber}\n` }),
    });
    const waitForFrame = async () => {
      for (let attempt = 0; attempt < 10 && !frames.length; attempt += 1) await Promise.resolve();
      assert.equal(frames.length, 1, 'tmux 캡처 viewport 복원 프레임이 예약되지 않았습니다.');
    };

    const firstCapture = workbench.captureRemote();
    await waitForFrame();
    frames.shift()();
    await firstCapture;

    const terminal = terminalInstances[0];
    terminal.buffer.active.viewportY = 17;
    terminal.scrollHandler(17);
    terminal.wheelEvents.length = 0;
    const secondCapture = workbench.captureRemote();
    await waitForFrame();
    assert.equal(state.remoteCaptureApplying, true,
      'wheel 경쟁을 재현하기 전에 tmux reset/write 적용 구간이 끝났습니다.');

    const physicalWheel = new WheelEvent('wheel', {
      deltaX: 4,
      deltaY: -240,
      deltaZ: 2,
      deltaMode: 0,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    terminal.screenElement.dispatchEvent(physicalWheel);
    assert.equal(physicalWheel.defaultPrevented, true,
      'reset/write 중 wheel이 빈 Xterm 버퍼로 전달되었습니다.');
    assert.equal(terminal.wheelEvents.length, 0,
      '캡처 적용 중 wheel을 Xterm smooth-scroll 처리기가 먼저 소비했습니다.');
    assert.equal(state.remotePendingWheelEvents.length, 1,
      '캡처 적용 중 wheel을 정확히 한 번 보관하지 않았습니다.');

    frames.shift()();
    await secondCapture;

    assert.equal(state.remoteCaptureApplying, false);
    assert.equal(state.remotePendingWheelEvents.length, 0,
      '캡처 완료 뒤 재생한 wheel이 큐에 남았습니다.');
    assert.equal(terminal.wheelEvents.length, 1,
      '보관한 wheel이 Xterm에 정확히 한 번 재생되지 않았습니다.');
    const replayedWheel = terminal.wheelEvents[0];
    assert.ok(replayedWheel instanceof WheelEvent, '재생 입력이 실제 WheelEvent 형태가 아닙니다.');
    assert.notStrictEqual(replayedWheel, physicalWheel, '취소된 원본 DOM 이벤트 객체를 다시 사용했습니다.');
    assert.strictEqual(replayedWheel.target, terminal.screenElement,
      '재생 wheel이 실제 포인터 표면인 .xterm-screen에서 시작하지 않았습니다.');
    assert.deepStrictEqual(
      [replayedWheel.deltaX, replayedWheel.deltaY, replayedWheel.deltaZ, replayedWheel.deltaMode],
      [4, -240, 2, 0],
      '재생 wheel의 delta를 원본과 동일하게 보존하지 않았습니다.',
    );
    assert.deepStrictEqual(
      [replayedWheel.ctrlKey, replayedWheel.shiftKey, replayedWheel.altKey, replayedWheel.metaKey],
      [true, true, false, true],
      '재생 wheel의 modifier를 원본과 동일하게 보존하지 않았습니다.',
    );
    assert.equal(terminal.buffer.active.viewportY, 14,
      '재생 wheel이 복원된 scrollback에서 Xterm 스크롤을 이어가지 못했습니다.');
    assert.equal(state.remoteUserScrollRevision, 2,
      '물리 wheel과 재생 wheel이 각각 한 번씩 관찰되지 않았습니다.');
    assert.equal(terminal.options.smoothScrollDuration, 100,
      'wheel 재생이 사용자 smooth-scroll 설정을 변경했습니다.');
  });

  test('tmux smooth wheel 유휴 구간에 도착한 새 캡처는 버퍼를 교체하지 않고 재시도 하나만 예약한다', async () => {
    const remote = {
      distro: { name: 'FixtureLinux' },
      session: { name: 'workspace' },
      window: { index: 0, name: 'main' },
      pane: { id: 'pane-7', nativeId: '%7', command: 'zsh', cwd: '/workspace', dead: false },
    };
    let captureNumber = 0;
    let timerSequence = 0;
    const scheduledTimers = new Map();
    const clearedTimers = [];
    const { state, workbench, terminalInstances, WheelEvent } = createWorkbench(root, {
      remote,
      active: true,
      createRemoteTerminal: true,
      remoteWriteBaseY: 64,
      tmuxCapture: async () => ({ output: `capture-${++captureNumber}\n` }),
      setTimeout: (callback, delay) => {
        const id = ++timerSequence;
        scheduledTimers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: id => {
        clearedTimers.push(id);
        scheduledTimers.delete(id);
      },
    });

    await workbench.captureRemote();
    const terminal = terminalInstances[0];
    terminal.wheelEvents.length = 0;
    const userWheel = new WheelEvent('wheel', {
      deltaY: 120,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
    });
    terminal.screenElement.dispatchEvent(userWheel);
    assert.equal(terminal.wheelEvents.length, 1,
      '유휴 구간을 시작한 실제 wheel이 Xterm 처리기에 도달하지 않았습니다.');
    assert.ok(state.remoteWheelIdleUntil > Date.now(),
      'wheel 뒤 smooth-scroll 완료 유예 시간이 설정되지 않았습니다.');

    const before = {
      capture: state.remoteCapture,
      captureRevision: state.captureRevision,
      resetCalls: terminal.resetCalls,
      writes: terminal.writes.length,
    };
    await workbench.captureRemote();

    assert.equal(captureNumber, 2, '새 tmux 캡처 결과를 실제로 조회하지 않았습니다.');
    assert.equal(state.remoteCapture, before.capture,
      'smooth-scroll 유휴 구간의 결과가 현재 캡처로 확정되었습니다.');
    assert.equal(state.captureRevision, before.captureRevision,
      '버린 캡처가 완료 revision을 올렸습니다.');
    assert.equal(terminal.resetCalls, before.resetCalls,
      'smooth-scroll 유휴 구간에 Xterm 버퍼를 reset했습니다.');
    assert.equal(terminal.writes.length, before.writes,
      'smooth-scroll 유휴 구간에 새 캡처를 Xterm에 썼습니다.');
    assert.equal(scheduledTimers.size, 1,
      'smooth-scroll 완료 뒤 캡처 재시도를 정확히 하나 예약하지 않았습니다.');
    const [[retryTimerId, retryTimer]] = [...scheduledTimers.entries()];
    assert.strictEqual(state.remoteCaptureRetryTimer, retryTimerId);
    assert.ok(retryTimer.delay > 0 && retryTimer.delay <= 134,
      '재시도가 smooth-scroll 및 두 프레임 유예 범위를 벗어났습니다.');

    workbench.stopCapture();
    assert.equal(state.remoteCaptureRetryTimer, null);
    assert.equal(state.remoteWheelIdleUntil, 0);
    assert.equal(state.remotePendingWheelEvents.length, 0);
    assert.deepStrictEqual(clearedTimers, [retryTimerId],
      '캡처 중단 시 예약된 wheel 유휴 재시도를 취소하지 않았습니다.');
    assert.equal(scheduledTimers.size, 0);
  });

  test('host reconnect로 xterm을 교체하면 사용 중이던 PTY 입력 포커스를 조건부 복원한다', async () => {
    const session = { id: 'terminal:reconnect-focus', type: 'agent', status: 'running', title: 'Reconnect focus PTY' };
    const { state, workbench, terminalInstances, document } = createWorkbench(root, { session });
    const oldEntry = await workbench.ensureSessionTerminal(session);
    oldEntry.host.classList.remove('hidden');
    state.active = true;
    terminalInstances[0].helperTextarea.focus();

    await workbench.refreshSessions({ change: 'reconnected', sessions: [{ ...session }] });

    assert.equal(terminalInstances.length, 2, 'reconnect 뒤 xterm entry를 다시 만들지 않았습니다.');
    assert.strictEqual(document.activeElement, terminalInstances[1].helperTextarea,
      'reconnect 직전 사용 중이던 PTY의 입력 포커스를 새 xterm에 복원하지 않았습니다.');
  });

  test('xterm 입력 pump는 한 프레임의 IME 조각을 묶고 deliveryId로 순서대로 전달한다', async () => {
    const frames = [];
    const session = { id: 'terminal:raw-input-pump', type: 'agent', status: 'running', title: 'Input PTY' };
    const { state, workbench, terminalInstances, rawWrites } = createWorkbench(root, {
      session,
      requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    });
    const entry = await workbench.ensureSessionTerminal(session);
    entry.host.classList.remove('hidden');
    state.active = true;

    terminalInstances[0].dataHandler('한');
    terminalInstances[0].dataHandler('글😀');
    terminalInstances[0].dataHandler('\r');
    assert.equal(rawWrites.length, 0, '같은 화면 프레임의 IME 조각마다 IPC를 즉시 만들었습니다.');
    assert.equal(frames.length, 1, '입력 pump animation frame을 중복 예약했습니다.');

    frames.shift()();
    await entry.writeQueue;
    assert.equal(rawWrites.length, 1);
    assert.equal(rawWrites[0][0], session.id);
    assert.equal(rawWrites[0][1], '한글😀\r');
    assert.match(rawWrites[0][2]?.deliveryId || '', /^delivery:raw:/);

    terminalInstances[0].dataHandler('다음');
    assert.equal(frames.length, 1);
    frames.shift()();
    await entry.writeQueue;
    assert.equal(rawWrites.length, 2);
    assert.equal(rawWrites[1][1], '다음');
    assert.match(rawWrites[1][2]?.deliveryId || '', /^delivery:raw:/);
    assert.notEqual(rawWrites[0][2].deliveryId, rawWrites[1][2].deliveryId);
  });

  test('Shift+Tab은 PTY backtab으로 보내면서 브라우저 포커스 이동을 막는다', async () => {
    const frames = [];
    const session = { id: 'terminal:shift-tab', type: 'agent', status: 'running', title: 'Mode switch PTY' };
    const { state, workbench, terminalInstances, rawWrites } = createWorkbench(root, {
      session,
      requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    });
    const entry = await workbench.ensureSessionTerminal(session);
    entry.host.classList.remove('hidden');
    state.active = true;
    const terminal = terminalInstances[0];
    let defaultPrevented = false;
    let propagationStopped = false;
    const accepted = terminal.keyEventHandler({
      type: 'keydown', key: 'Tab', shiftKey: true,
      altKey: false, ctrlKey: false, metaKey: false,
      preventDefault() { defaultPrevented = true; },
      stopPropagation() { propagationStopped = true; },
    });

    assert.equal(accepted, true, 'custom handler가 xterm의 Shift+Tab 처리를 막았습니다.');
    assert.equal(defaultPrevented, true, 'Chromium의 역방향 포커스 이동을 취소하지 않았습니다.');
    assert.equal(propagationStopped, true, '상위 dialog 포커스 트랩까지 Shift+Tab이 전파됐습니다.');

    // xterm 6 converts the accepted Shift+Tab event to the VT backtab
    // sequence before raising onData. Verify the app preserves that sequence.
    terminal.dataHandler('\u001b[Z');
    frames.shift()();
    await entry.writeQueue;
    assert.equal(rawWrites.length, 1);
    assert.equal(rawWrites[0][1], '\u001b[Z');

    // The app normally focuses its separate command composer after selecting
    // an AI. That surface must route the same backtab sequence through the
    // selected PTY's ordered raw-input queue.
    assert.equal(workbench.sendRawInputToCurrentSession('\u001b[Z'), true);
    frames.shift()();
    await entry.writeQueue;
    assert.equal(rawWrites.length, 2);
    assert.equal(rawWrites[1][1], '\u001b[Z');
    assert.match(rawWrites[1][2]?.deliveryId || '', /^delivery:raw:/);

    const eventSource = fs.readFileSync(path.join(root, 'renderer', 'terminal-events.js'), 'utf8');
    const eventSandbox = { window: {} };
    vm.runInNewContext(eventSource, eventSandbox, { filename: 'terminal-events.js' });
    const handleModeCycle = eventSandbox.window.WhiteboxTerminalEventKeys.handleClaudeModeCycle;
    const composerWrites = [];
    let composerDefaultPrevented = 0;
    let composerPropagationStopped = 0;
    let menuClosed = 0;
    const composerEvent = {
      type: 'keydown', key: 'Tab', shiftKey: true,
      altKey: false, ctrlKey: false, metaKey: false,
      preventDefault() { composerDefaultPrevented += 1; },
      stopPropagation() { composerPropagationStopped += 1; },
    };
    assert.equal(handleModeCycle(composerEvent, {
      provider: 'claude',
      isAiSession: true,
      sendRawInput: data => { composerWrites.push(data); return true; },
      closeMenu: () => { menuClosed += 1; },
    }), true);
    assert.deepStrictEqual(composerWrites, ['\u001b[Z']);
    assert.equal(composerDefaultPrevented, 1);
    assert.equal(composerPropagationStopped, 1);
    assert.equal(menuClosed, 1);

    for (const provider of ['codex', 'gemini', 'grok']) {
      assert.equal(handleModeCycle(composerEvent, {
        provider,
        isAiSession: true,
        sendRawInput: data => { composerWrites.push(data); return true; },
      }), false);
    }
    assert.deepStrictEqual(composerWrites, ['\u001b[Z'], '비-Claude PTY에 mode 제어문자를 보내면 안 됩니다.');
    assert.equal(composerDefaultPrevented, 1, '비-Claude 입력창의 역방향 포커스 이동을 막으면 안 됩니다.');
    assert.equal(composerPropagationStopped, 1, '비-Claude Shift+Tab 전파를 막으면 안 됩니다.');
  });

  test('창이 hidden으로 바뀌면 대기 중인 raw 입력을 animation frame 없이 즉시 전달한다', async () => {
    const frames = [];
    const session = { id: 'terminal:raw-input-hidden', type: 'agent', status: 'running', title: 'Hidden input PTY' };
    const { state, workbench, terminalInstances, rawWrites, document } = createWorkbench(root, {
      session,
      requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    });
    const entry = await workbench.ensureSessionTerminal(session);
    entry.host.classList.remove('hidden');
    state.active = true;

    terminalInstances[0].dataHandler('숨기기 직전 입력\r');
    assert.equal(frames.length, 1, '보이는 동안의 짧은 입력 burst batching을 제거했습니다.');
    document.hidden = true;
    document.visibilityState = 'hidden';
    document.dispatchEvent({ type: 'visibilitychange' });
    await Promise.resolve();
    await entry.writeQueue;

    assert.equal(rawWrites.length, 1, 'hidden 전환으로 마지막 PTY 입력이 animation frame에 갇혔습니다.');
    assert.equal(rawWrites[0][1], '숨기기 직전 입력\r');
    assert.equal(frames.length, 1, '검증 중 animation frame callback을 실행하면 hidden 경계를 확인할 수 없습니다.');
  });

  test('terminal write IPC unknown envelope는 preload Error 메타데이터를 보존한다', async () => {
    const write = terminalWriteHandler(() => {
      const error = new Error('응답 유실로 입력 상태를 확인할 수 없습니다.');
      error.code = 'TERMINAL_WRITE_UNCERTAIN';
      error.deliveryId = 'delivery:raw:unknown';
      error.deliveryState = 'unknown';
      throw error;
    });
    const api = loadPreloadApi(root, (channel, ...args) => {
      assert.equal(channel, 'terminals:write');
      return write({}, ...args);
    });

    await assert.rejects(
      api.terminalWrite('terminal:unknown', '입력', { deliveryId: 'delivery:raw:unknown' }),
      error => error.message === '응답 유실로 입력 상태를 확인할 수 없습니다.'
        && error.code === 'TERMINAL_WRITE_UNCERTAIN'
        && error.deliveryId === 'delivery:raw:unknown'
        && error.deliveryState === 'unknown',
    );
  });

  test('terminal write IPC rejected envelope는 preload reject 계약과 성공 결과를 유지한다', async () => {
    const write = terminalWriteHandler((_id, data) => {
      if (data === '성공') return { ok: true, deliveryId: 'delivery:raw:accepted', deliveryState: 'accepted' };
      const error = new Error('PTY에 쓰기 전에 거절했습니다.');
      error.code = 'TERMINAL_WRITE_NOT_SENT';
      error.deliveryId = 'delivery:raw:rejected';
      error.deliveryState = 'rejected';
      throw error;
    });
    const api = loadPreloadApi(root, (_channel, ...args) => write({}, ...args));

    await assert.rejects(
      api.terminalWrite('terminal:rejected', '거절', { deliveryId: 'delivery:raw:rejected' }),
      error => error.message === 'PTY에 쓰기 전에 거절했습니다.'
        && error.code === 'TERMINAL_WRITE_NOT_SENT'
        && error.deliveryId === 'delivery:raw:rejected'
        && error.deliveryState === 'rejected',
    );
    assert.deepStrictEqual(
      await api.terminalWrite('terminal:accepted', '성공', { deliveryId: 'delivery:raw:accepted' }),
      { ok: true, deliveryId: 'delivery:raw:accepted', deliveryState: 'accepted' },
    );
  });

  test('확인 불명 raw 입력 뒤에는 같은 프레임의 suffix를 자동 전송하지 않는다', async () => {
    const frames = [];
    const session = { id: 'terminal:raw-input-unknown', type: 'agent', status: 'running', title: 'Unknown input PTY' };
    const { state, workbench, terminalInstances, rawWrites, notices } = createWorkbench(root, {
      session,
      requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
      terminalWrite: async (_id, _data, _deliveryOptions, callCount) => callCount === 1
        ? { ok: false, deliveryState: 'unknown' }
        : { ok: true, deliveryState: 'accepted' },
    });
    const entry = await workbench.ensureSessionTerminal(session);
    entry.host.classList.remove('hidden');
    state.active = true;

    terminalInstances[0].dataHandler('A'.repeat(128 * 1024));
    terminalInstances[0].dataHandler('SECOND\r');
    frames.shift()();
    await entry.writeQueue;

    assert.equal(rawWrites.length, 1, '확인 불명 head 뒤 queued suffix를 자동 전송했습니다.');
    assert.equal(rawWrites[0][1].length, 128 * 1024);
    assert.equal(notices.some(([, tone]) => tone === 'warning'), true);

    terminalInstances[0].dataHandler('RETRY\r');
    assert.equal(frames.length, 1, '사용자의 다음 명시적 입력으로 pump가 다시 열리지 않았습니다.');
    frames.shift()();
    await entry.writeQueue;
    assert.deepStrictEqual(rawWrites.map(([, data]) => data.length), [128 * 1024, 6]);
    assert.equal(rawWrites[1][1], 'RETRY\r');
  });

  test('reconnect는 이전 xterm tail을 버리고 in-flight 뒤 새 입력 순서를 보장한다', async () => {
    const frames = [];
    let resolveOldHead;
    const oldHeadPending = new Promise(resolve => { resolveOldHead = resolve; });
    const session = { id: 'terminal:raw-input-reconnect', type: 'agent', status: 'running', title: 'Reconnect input PTY' };
    const { state, workbench, terminalInstances, rawWrites } = createWorkbench(root, {
      session,
      requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
      terminalWrite: async (_id, _data, _deliveryOptions, callCount) => callCount === 1
        ? oldHeadPending
        : { ok: true, deliveryState: 'accepted' },
    });
    const oldEntry = await workbench.ensureSessionTerminal(session);
    oldEntry.host.classList.remove('hidden');
    terminalInstances[0].dataHandler('OLD_HEAD');
    frames.shift()();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepStrictEqual(rawWrites.map(([, data]) => data), ['OLD_HEAD']);

    terminalInstances[0].dataHandler('OLD_TAIL');
    await workbench.refreshSessions({ change: 'reconnected', sessions: [{ ...session }] });
    const newEntry = await workbench.ensureSessionTerminal(session);
    terminalInstances[1].dataHandler('NEW_INPUT');
    frames.shift()();
    await Promise.resolve();
    assert.deepStrictEqual(rawWrites.map(([, data]) => data), ['OLD_HEAD'],
      '새 entry 입력이 이전 in-flight write보다 먼저 전달됐습니다.');

    resolveOldHead({ ok: true, deliveryState: 'accepted' });
    await Promise.all([oldEntry.writeQueue, newEntry.writeQueue]);
    assert.deepStrictEqual(rawWrites.map(([, data]) => data), ['OLD_HEAD', 'NEW_INPUT']);
  });

  test('큰 bracketed paste는 종료 제어문자를 자르지 않고 전체 거절한다', async () => {
    const frames = [];
    const session = { id: 'terminal:raw-input-paste-bound', type: 'agent', status: 'running', title: 'Paste bound PTY' };
    const { workbench, terminalInstances, rawWrites, notices } = createWorkbench(root, {
      session,
      requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    });
    await workbench.ensureSessionTerminal(session);
    const oversizedPaste = `\u001b[200~${'가'.repeat(128 * 1024)}\u001b[201~`;

    terminalInstances[0].dataHandler(oversizedPaste);

    assert.equal(frames.length, 0, '부분 paste를 보내는 input frame을 예약했습니다.');
    assert.equal(rawWrites.length, 0, 'bracketed paste의 prefix만 부분 전송했습니다.');
    assert.equal(notices.some(([, tone]) => tone === 'error'), true);
  });

  test('PTY replay hydration 중 도착한 live 출력은 sequence 기준으로 정확히 한 번만 이어 붙인다', async () => {
    let resolveGet;
    const pendingGet = new Promise(resolve => { resolveGet = resolve; });
    const session = { id: 'terminal:hydrate', type: 'agent', status: 'running', title: 'Hydration PTY' };
    const { state, workbench, terminalInstances } = createWorkbench(root, {
      session,
      terminalGet: () => pendingGet,
    });

    const ready = workbench.ensureSessionTerminal(session);
    await Promise.resolve();
    const entry = state.terminals.get(session.id);
    assert.ok(entry, 'terminalGet을 기다리는 동안에도 live event가 찾을 수 있게 entry를 먼저 등록해야 합니다.');
    assert.equal(entry.acceptOutput({ data: 'already-in-replay\r\n', outputSequence: 7 }), null);
    assert.equal(entry.acceptOutput({ data: 'live-once\r\n', outputSequence: 8 }), null);

    resolveGet({ replay: 'history\r\nalready-in-replay\r\n', outputSequence: 7 });
    await ready;

    assert.deepStrictEqual(terminalInstances[0].writes, [
      'history\r\nalready-in-replay\r\n',
      'live-once\r\n',
    ]);
    assert.equal(entry.outputSequence, 8);
    assert.equal(entry.acceptOutput({ data: 'duplicate-live\r\n', outputSequence: 8 }), null);
    assert.equal(entry.acceptOutput({ data: 'next-live\r\n', outputSequence: 9 }), 'next-live\r\n');

    const longReplay = 'x'.repeat((32 * 1024) + 1);
    const longSession = { id: 'terminal:long-replay', type: 'agent', status: 'running', title: 'Long replay PTY' };
    const longHydration = createWorkbench(root, {
      session: longSession,
      terminalGet: async () => ({ replay: longReplay, outputSequence: 1 }),
    });
    await longHydration.workbench.ensureSessionTerminal(longSession);
    assert.deepStrictEqual(
      longHydration.terminalInstances[0].writes.map(value => value.length),
      [32 * 1024, 1],
      'large replay must yield between bounded xterm writes',
    );
  });

  test('취소된 attention 이동은 느린 PTY hydration 뒤 이전 화면을 표시하지 않는다', async () => {
    let resolveGet;
    let current = true;
    const pendingGet = new Promise(resolve => { resolveGet = resolve; });
    const session = { id: 'terminal:attention-stale', type: 'agent', status: 'running', title: 'Stale attention PTY' };
    const { state, workbench } = createWorkbench(root, {
      session,
      terminalGet: () => pendingGet,
    });
    state.active = true;

    const selecting = workbench.selectSession(session.id, 'question', {
      attentionActivation: true,
      focus: false,
      isCurrent: () => current,
    });
    await Promise.resolve();
    const entry = state.terminals.get(session.id);
    assert.ok(entry);
    current = false;
    resolveGet({ replay: 'stale\r\n', outputSequence: 1 });

    assert.equal(await selecting, false);
    assert.equal(entry.host.classList.contains('hidden'), true);
  });

  test('질문 모드는 일반 셸에 질문을 명령으로 보내지 않는다', async () => {
    const session = {
      id: 'terminal:shell',
      type: 'shell',
      status: 'running',
      title: 'Plain shell',
      cwd: '/tmp',
    };
    const { workbench, terminalCalls, notices, elements } = createWorkbench(root, {
      session,
      interactionMode: 'question',
    });

    workbench.renderTarget();
    assert.equal(elements.get('#terminalCommandInput').disabled, true);
    assert.equal(elements.get('#terminalCommandInput').placeholder, 'terminal.agent.no_input_target');

    const sent = await workbench.sendCommand('이 질문에 답해 줘');

    assert.equal(sent, false);
    assert.deepStrictEqual(terminalCalls, []);
    assert.deepStrictEqual(notices, [['terminal.agent.no_input_target', 'error']]);
  });

  test('일반 tmux 선택은 질문 상태를 지우고 agent-bound 선택만 질문 상태를 보존한다', async () => {
    const row = {
      distro: { name: 'FixtureLinux' },
      session: { name: 'workspace' },
      window: { index: 0, name: 'main' },
      pane: { id: 'pane-7', nativeId: '%7', command: 'zsh', cwd: '/workspace', dead: false },
    };
    const ordinary = createWorkbench(root, {
      remote: row,
      tmuxRows: [row],
      interactionMode: 'question',
    });

    await ordinary.workbench.selectTmux('FixtureLinux', '%7', 'computer');
    assert.equal(ordinary.state.interactionMode, 'computer');

    const agentBound = createWorkbench(root, {
      remote: row,
      tmuxRows: [row],
      interactionMode: 'question',
      boundAgent: { id: 'agent:1', provider: 'claude', title: 'Claude task' },
    });
    await agentBound.workbench.selectTmux('FixtureLinux', '%7');
    assert.equal(agentBound.state.interactionMode, 'question');
  });

  test('AI 질문 화면의 확인 불명 응답은 초안을 유지하고 같은 질문을 다시 보내지 않는다', async () => {
    const session = {
      id: 'terminal:agent-unknown',
      type: 'agent',
      provider: 'codex',
      status: 'running',
      title: 'GPT terminal',
      cwd: '/tmp',
    };
    const { workbench, terminalCalls, notices } = createWorkbench(root, {
      session,
      interactionMode: 'question',
      boundAgent: { id: 'codex:unknown', provider: 'codex', title: 'GPT task' },
      terminalCommandResult: { ok: true, deliveryState: 'unknown' },
    });

    const first = await workbench.sendCommand('한 번만 보낼 질문');
    const second = await workbench.sendCommand('한 번만 보낼 질문');

    assert.equal(first, false);
    assert.equal(second, false);
    assert.equal(terminalCalls.length, 1);
    assert.match(terminalCalls[0][2].deliveryId, /^delivery:/);
    assert.deepStrictEqual(notices, [
      ['terminal.agent.delivery_uncertain', 'warning'],
      ['terminal.agent.delivery_uncertain', 'warning'],
    ]);

    const rejected = createWorkbench(root, {
      session: { ...session, id: 'terminal:agent-rejected' },
      interactionMode: 'question',
      boundAgent: { id: 'codex:rejected', provider: 'codex', title: 'GPT task' },
      terminalCommandResult: {
        ok: false,
        error: '질문을 쓰기 전에 안전하게 중단',
        deliveryState: 'rejected',
      },
    });
    const rejectedFirst = await rejected.workbench.sendCommand('초안을 유지하고 재시도할 질문');
    const rejectedSecond = await rejected.workbench.sendCommand('초안을 유지하고 재시도할 질문');
    assert.equal(rejectedFirst, false);
    assert.equal(rejectedSecond, false);
    assert.equal(rejected.terminalCalls.length, 2);
    assert.notEqual(rejected.terminalCalls[0][2].deliveryId, rejected.terminalCalls[1][2].deliveryId);
    assert.deepStrictEqual(rejected.notices, [
      ['agent.delivery_retry_ready', 'warning'],
      ['agent.delivery_retry_ready', 'warning'],
    ]);
  });
}

module.exports = { registerTerminalInteractionTests };
