'use strict';

/** Own xterm views, terminal/tmux selection, capture, and management actions. */
window.WhiteboxTerminalWorkbench = function createModule(context) {
  const t = (key, params) => window.WhiteboxI18n.t(key, params);
  const RAW_INPUT_BATCH_CHARS = 128 * 1024;
  const MAX_RAW_INPUT_QUEUE_CHARS = 512 * 1024;
  const MAX_PENDING_REMOTE_WHEEL_EVENTS = 32;
  const REMOTE_WHEEL_FRAME_SETTLE_MS = 34;
  const {
    $, state, notice, currentSession, currentTmux, xtermOptions,
    guarded, errorMessage, tmuxRows, updateSnapshot,
  } = context;
  const rawInputBarriers = new Map();
  const scheduledRawInputEntries = new Set();
  const enqueueMicrotask = typeof window.queueMicrotask === 'function'
    ? callback => window.queueMicrotask(callback)
    : callback => Promise.resolve().then(callback);

  function documentIsHidden() {
    return document.hidden === true || document.visibilityState === 'hidden';
  }

  function flushHiddenRawInputPumps() {
    if (!documentIsHidden()) return;
    for (const entry of [...scheduledRawInputEntries]) {
      if (typeof entry.inputPumpFlush === 'function') enqueueMicrotask(entry.inputPumpFlush);
    }
  }

  document.addEventListener?.('visibilitychange', flushHiddenRawInputPumps);

  function nextRawInputDeliveryId(entry) {
    entry.inputSequence += 1;
    const random = window.crypto?.randomUUID?.().replace(/-/g, '')
      || `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    return `delivery:raw:${Date.now().toString(36)}:${entry.inputSequence.toString(36)}:${random}`;
  }

  function takeRawInputBatch(entry) {
    let batch = '';
    while (entry.inputQueue.length) {
      const chunk = entry.inputQueue[0];
      // xterm emits bracketed paste and other control sequences as one data
      // event. Never cut an event in half: dropping a trailing paste terminator
      // can leave the remote TTY in paste mode and corrupt all later typing.
      if (batch && batch.length + chunk.length > RAW_INPUT_BATCH_CHARS) break;
      if (chunk.length > RAW_INPUT_BATCH_CHARS) break;
      batch += chunk;
      entry.inputQueue.shift();
      entry.inputQueueChars = Math.max(0, entry.inputQueueChars - chunk.length);
    }
    return batch;
  }

  function clearRawInputQueue(entry) {
    entry.inputQueue = [];
    entry.inputQueueChars = 0;
  }

  function closeRawInputEntry(entry) {
    if (!entry) return;
    entry.inputClosed = true;
    entry.inputPumpHalted = true;
    clearRawInputQueue(entry);
    entry.inputPumpScheduleGeneration += 1;
    entry.inputPumpScheduled = false;
    entry.inputPumpFlush = null;
    scheduledRawInputEntries.delete(entry);
    if (entry.inputPumpFrame) {
      window.cancelAnimationFrame?.(entry.inputPumpFrame);
      entry.inputPumpFrame = 0;
    }
    if (entry.inputPumpTimer) {
      clearTimeout(entry.inputPumpTimer);
      entry.inputPumpTimer = 0;
    }
  }

  async function pumpRawInput(entry, key) {
    while (!entry.inputClosed && entry.inputQueue.length) {
      const batch = takeRawInputBatch(entry);
      if (!batch) break;
      const deliveryId = nextRawInputDeliveryId(entry);
      let failed = false;
      try {
        const result = await window.whitebox.terminalWrite(key, batch, { deliveryId });
        if (result?.deliveryState === 'unknown') {
          notice(t('terminal.error.input_failed'), 'warning');
          failed = true;
        }
      } catch (error) {
        notice(errorMessage(error), error?.deliveryState === 'unknown' ? 'warning' : 'error');
        failed = true;
      }
      if (failed) {
        // The current bytes may already be in the PTY. Sending a queued suffix
        // automatically could submit half a command or finish an uncertain
        // paste. Drop the suffix and require the user's next explicit input.
        clearRawInputQueue(entry);
        entry.inputPumpHalted = true;
        break;
      }
    }
    if (!entry.inputQueue.length) entry.inputOverflowNotified = false;
  }

  function scheduleRawInputPump(entry, key) {
    if (entry.inputPump || entry.inputPumpScheduled) return;
    const generation = ++entry.inputPumpScheduleGeneration;
    entry.inputPumpScheduled = true;
    scheduledRawInputEntries.add(entry);
    const flush = () => {
      if (!entry.inputPumpScheduled || generation !== entry.inputPumpScheduleGeneration) return;
      entry.inputPumpScheduled = false;
      entry.inputPumpFlush = null;
      scheduledRawInputEntries.delete(entry);
      if (entry.inputPumpFrame) window.cancelAnimationFrame?.(entry.inputPumpFrame);
      entry.inputPumpFrame = 0;
      if (entry.inputPumpTimer) clearTimeout(entry.inputPumpTimer);
      entry.inputPumpTimer = 0;
      if (entry.inputPump || entry.inputClosed) return;
      const previous = rawInputBarriers.get(key) || Promise.resolve();
      const task = previous.catch(() => {}).then(() => pumpRawInput(entry, key)).finally(() => {
        if (entry.inputPump === task) entry.inputPump = null;
        if (rawInputBarriers.get(key) === task) rawInputBarriers.delete(key);
        if (!entry.inputClosed && !entry.inputPumpHalted && entry.inputQueue.length) scheduleRawInputPump(entry, key);
      });
      rawInputBarriers.set(key, task);
      entry.inputPump = task;
      entry.writeQueue = task;
    };
    entry.inputPumpFlush = flush;
    if (documentIsHidden()) {
      enqueueMicrotask(flush);
      return;
    }
    // Visible xterms still coalesce the short burst of onData fragments in one
    // paint. The bounded task fallback prevents a stalled paint from holding
    // input, while visibilitychange switches to a microtask before background
    // animation-frame throttling can strand the final keystroke.
    entry.inputPumpFrame = requestAnimationFrame(flush);
    entry.inputPumpTimer = setTimeout(() => enqueueMicrotask(flush), 32);
  }

  function enqueueRawInput(entry, key, value) {
    const data = String(value || '');
    if (!data || entry.inputClosed) return false;
    if (entry.inputPumpHalted) entry.inputPumpHalted = false;
    const available = Math.max(0, MAX_RAW_INPUT_QUEUE_CHARS - entry.inputQueueChars);
    if (data.length > RAW_INPUT_BATCH_CHARS || data.length > available) {
      // An onData event is one logical xterm input operation. All-or-nothing
      // admission keeps surrogate pairs and bracketed-paste delimiters intact.
      if (!entry.inputOverflowNotified) {
        entry.inputOverflowNotified = true;
        notice(t('terminal.error.input_failed'), 'error');
      }
      return false;
    }
    entry.inputQueue.push(data);
    entry.inputQueueChars += data.length;
    scheduleRawInputPump(entry, key);
    return true;
  }

  function createXtermHost(key, readOnly = false, session = null) {
    if (!window.Terminal || !window.FitAddon || !window.FitAddon.FitAddon) throw new Error(t('terminal.error.screen_unavailable'));
    const host = document.createElement('div');
    host.className = 'terminal-screen hidden';
    host.dataset.terminalScreen = key;
    const stagingMount = $('#terminalRuntimeMount');
    if (!stagingMount) throw new Error(t('terminal.error.screen_unavailable'));
    stagingMount.appendChild(host);
    const fixedGrid = session?.fixedGrid ? {
      cols: Number(session.cols) || 120,
      rows: Number(session.rows) || 32,
    } : null;
    const inputDisabled = readOnly;
    const terminal = new window.Terminal({
      ...xtermOptions(inputDisabled),
      ...(fixedGrid || {}),
    });
    const fit = new window.FitAddon.FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    if (!readOnly && typeof terminal.attachCustomKeyEventHandler === 'function') {
      terminal.attachCustomKeyEventHandler(event => {
        // In screen-reader mode xterm intentionally leaves browser keyboard
        // defaults enabled. Shift+Tab still emits the terminal backtab
        // sequence, but Chromium also moves focus out of the PTY and the app's
        // dialog focus trap can consume the key. Cancel only that browser
        // behavior while returning true so xterm still sends ESC [ Z.
        if (event.type === 'keydown'
          && event.key === 'Tab'
          && event.shiftKey
          && !event.altKey
          && !event.ctrlKey
          && !event.metaKey) {
          event.preventDefault();
          event.stopPropagation();
        }
        return true;
      });
    }
    const entry = {
      terminal, fit, host, readOnly, inputDisabled, fixedGrid, userScrollRevision: 0, outputWritePending: 0,
      outputRestoreGeneration: 0, wheelLineRemainder: 0,
      writeQueue: Promise.resolve(), pendingResize: null, resizePromise: null,
      inputQueue: [], inputQueueChars: 0, inputPump: null, inputPumpFrame: 0, inputPumpTimer: 0,
      inputPumpScheduled: false, inputPumpScheduleGeneration: 0, inputPumpFlush: null,
      inputSequence: 0, inputOverflowNotified: false, inputPumpHalted: false, inputClosed: false,
      outputHydrating: !readOnly,
      outputSequence: null,
      outputHydrationBuffer: [],
    };
    entry.acceptOutput = payload => {
      const data = String(payload?.data || '');
      const sequenceValue = payload?.outputSequence;
      const parsedSequence = sequenceValue == null || sequenceValue === '' ? Number.NaN : Number(sequenceValue);
      const outputSequence = Number.isSafeInteger(parsedSequence) && parsedSequence >= 0
        ? parsedSequence
        : null;
      if (entry.outputHydrating) {
        entry.outputHydrationBuffer.push({ data, outputSequence, arrival: entry.outputHydrationBuffer.length });
        return null;
      }
      if (outputSequence != null) {
        if (entry.outputSequence != null && outputSequence <= entry.outputSequence) return null;
        entry.outputSequence = outputSequence;
      }
      return data;
    };
    const syncScrollState = viewportY => {
      const normalizedViewport = Number(viewportY) || 0;
      const baseY = Number(terminal.buffer.active.baseY) || 0;
      // A remote capture replaces the entire xterm buffer. Do not publish the
      // transient reset/write coordinates as a completed viewport: observers
      // could otherwise pair the previous capture revision with baseY=0.
      if (readOnly && state.remoteCaptureApplying) return;
      host.dataset.viewportY = String(normalizedViewport);
      host.dataset.baseY = String(baseY);
      // Xterm may consume wheel events before they bubble to the host. Its
      // scroll event is the reliable source for mouse, keyboard and scrollbar
      // viewport changes.
      if (readOnly && !state.remoteCaptureApplying) {
        state.remoteViewportAnchor = normalizedViewport;
        state.remoteViewportAtBottom = normalizedViewport >= baseY;
      }
    };
    terminal.onScroll(syncScrollState);
    syncScrollState(0);
    if (readOnly) {
      host.addEventListener('wheel', event => {
        state.remoteUserScrollRevision = Number(state.remoteUserScrollRevision || 0) + 1;
        const smoothDuration = Math.max(0, Number(terminal.options?.smoothScrollDuration) || 0);
        state.remoteWheelIdleUntil = Date.now() + smoothDuration + REMOTE_WHEEL_FRAME_SETTLE_MS;
        if (!state.remoteCaptureApplying) return;
        // reset/write temporarily leaves the replacement buffer without usable
        // scrollback. Hold wheel input and replay it against the completed xterm
        // instead of letting the event disappear against baseY=0.
        event.preventDefault();
        event.stopPropagation();
        const queue = Array.isArray(state.remotePendingWheelEvents)
          ? state.remotePendingWheelEvents
          : (state.remotePendingWheelEvents = []);
        if (queue.length >= MAX_PENDING_REMOTE_WHEEL_EVENTS) queue.shift();
        queue.push({
          deltaX: Number(event.deltaX) || 0,
          deltaY: Number(event.deltaY) || 0,
          deltaZ: Number(event.deltaZ) || 0,
          deltaMode: Number(event.deltaMode) || 0,
          ctrlKey: Boolean(event.ctrlKey),
          shiftKey: Boolean(event.shiftKey),
          altKey: Boolean(event.altKey),
          metaKey: Boolean(event.metaKey),
        });
      }, { capture: true, passive: false });
    } else {
      const rememberUserScroll = () => { entry.userScrollRevision += 1; };
      host.addEventListener('wheel', event => {
        const deltaY = Number(event.deltaY) || 0;
        const activeBuffer = terminal.buffer.active;
        if (!deltaY || Number(activeBuffer.baseY || 0) <= 0) return;
        const lineDelta = event.deltaMode === 1
          ? deltaY
          : event.deltaMode === 2
            ? deltaY * Math.max(1, terminal.rows - 1)
            : deltaY / Math.max(16, (state.terminalFontSize || 15) * 1.25);
        entry.wheelLineRemainder += lineDelta;
        const lines = Math.trunc(entry.wheelLineRemainder);
        event.preventDefault();
        event.stopPropagation();
        if (!lines) return;
        entry.wheelLineRemainder -= lines;
        terminal.scrollLines(lines);
        rememberUserScroll();
      }, { capture: true, passive: false });
      // Record scrollbar/touch and keyboard scroll intent before xterm moves
      // the viewport, so an already queued fit cannot pull the user to tail.
      host.addEventListener('pointerdown', rememberUserScroll, true);
      host.addEventListener('keydown', event => {
        if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) rememberUserScroll();
      }, true);
      if (!inputDisabled) {
        terminal.onData(data => {
          if (state.selectedId !== key && state.embeddedTerminalId !== key) return;
          enqueueRawInput(entry, key, data);
        });
      }
      terminal.onResize(size => {
        entry.pendingResize = { cols: size.cols, rows: size.rows };
        if (entry.resizePromise) return;
        entry.resizePromise = (async () => {
          while (entry.pendingResize) {
            const pending = entry.pendingResize;
            entry.pendingResize = null;
            await window.whitebox.terminalResize(key, pending.cols, pending.rows);
          }
        })().catch(error => {
          window.WhiteboxRendererUtils.reportRecoverableError('terminal-resize', error);
        }).finally(() => { entry.resizePromise = null; });
      });
    }
    return entry;
  }

  function scrollImmediately(terminal, action) {
    const options = terminal?.options;
    if (!options) {
      action();
      return;
    }
    const smoothScrollDuration = options.smoothScrollDuration;
    try {
      // Public xterm viewport methods honor smoothScrollDuration. A later
      // capture or resize can cancel that animation and retain the pre-scroll
      // ydisp, so automatic restoration must finish synchronously while
      // ordinary user scrolling stays smooth.
      options.smoothScrollDuration = 0;
      action();
    } finally {
      options.smoothScrollDuration = smoothScrollDuration;
    }
  }

  function scrollToBottomImmediately(terminal) {
    scrollImmediately(terminal, () => terminal.scrollToBottom());
  }

  function fitEntry(entry, _sessionId = '') {
    if (!entry || entry.host.classList.contains('hidden')) return;
    const activeBuffer = entry.terminal.buffer?.active;
    const userScrollRevision = entry.userScrollRevision;
    // A hidden xterm is hydrated at its default grid before it is mounted in
    // the smaller inline viewport. Preserve the pre-fit follow intent: another
    // queued fit can otherwise grow baseY before this frame and make the old
    // bottom look like a user-selected scrollback anchor.
    const shouldFollow = Boolean(activeBuffer)
      && Number(activeBuffer.viewportY || 0) >= Number(activeBuffer.baseY || 0);
    requestAnimationFrame(() => {
      try {
        if (entry.host.classList.contains('hidden')) return;
        const currentBuffer = entry.terminal.buffer?.active;
        const stillAtBottom = Boolean(currentBuffer)
          && Number(currentBuffer.viewportY || 0) >= Number(currentBuffer.baseY || 0);
        if (entry.fixedGrid) {
          entry.host.dataset.fixedGrid = 'true';
          entry.terminal.resize(entry.fixedGrid.cols, entry.fixedGrid.rows);
        } else entry.fit.fit();
        if (shouldFollow && stillAtBottom && entry.userScrollRevision === userScrollRevision) {
          // A pending output write may still hold the pre-fit viewport anchor.
          // Invalidate that restore before moving to the resized buffer tail.
          entry.outputRestoreGeneration += 1;
          scrollToBottomImmediately(entry.terminal);
        }
      } catch (error) {
        window.WhiteboxRendererUtils.reportRecoverableError('terminal-fit', error);
      }
    });
  }

  async function writeTerminalReplay(terminal, replay) {
    const text = String(replay || '');
    const chunkChars = 32 * 1024;
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(text.length, offset + chunkChars);
      const lastCode = text.charCodeAt(end - 1);
      const nextCode = text.charCodeAt(end);
      if (end < text.length && lastCode >= 0xd800 && lastCode <= 0xdbff
        && nextCode >= 0xdc00 && nextCode <= 0xdfff) end -= 1;
      const chunk = text.slice(offset, end);
      await new Promise(resolve => terminal.write(chunk, resolve));
      offset = end;
    }
  }

  async function ensureSessionTerminal(session) {
    let entry = state.terminals.get(session.id);
    const inputDisabled = false;
    if (entry && entry.inputDisabled !== inputDisabled) {
      closeRawInputEntry(entry);
      entry.terminal.dispose();
      entry.host.remove();
      state.terminals.delete(session.id);
      entry = null;
    }
    if (!entry) {
      entry = createXtermHost(session.id, false, session);
      state.terminals.set(session.id, entry);
      entry.ready = (async () => {
        const detail = await window.whitebox.terminalGet(session.id);
        const sequenceValue = detail?.outputSequence;
        const parsedSequence = sequenceValue == null || sequenceValue === '' ? Number.NaN : Number(sequenceValue);
        entry.outputSequence = Number.isSafeInteger(parsedSequence) && parsedSequence >= 0
          ? parsedSequence
          : null;
        // A retained full-screen TUI replay can be multiple MiB of ANSI redraw
        // traffic. Parse it in bounded xterm writes so opening an old task does
        // not monopolize the renderer and delay fresh AI output.
        if (detail && detail.replay) await writeTerminalReplay(entry.terminal, detail.replay);
        const buffered = entry.outputHydrationBuffer.splice(0).sort((left, right) => (
          left.outputSequence != null && right.outputSequence != null
            ? left.outputSequence - right.outputSequence || left.arrival - right.arrival
            : left.arrival - right.arrival
        ));
        entry.outputHydrating = false;
        for (const payload of buffered) {
          const data = entry.acceptOutput(payload);
          if (data) entry.terminal.write(data);
        }
        return entry;
      })().catch(error => {
        // Every caller awaiting this entry must observe the same initialization
        // failure. Remove it only when it is still the entry registered for the
        // session, so no caller can mistake an unverified blank xterm for a PTY.
        if (state.terminals.get(session.id) === entry) state.terminals.delete(session.id);
        closeRawInputEntry(entry);
        entry.terminal.dispose();
        entry.host.remove();
        throw error;
      });
    }
    return entry.ready ? await entry.ready : entry;
  }

  function ensureRemoteTerminal() {
    if (!state.remoteTerminal) state.remoteTerminal = createXtermHost('__tmux_remote__', true);
    return state.remoteTerminal;
  }

  function hideScreens() {
    for (const entry of state.terminals.values()) entry.host.classList.add('hidden');
    if (state.remoteTerminal) state.remoteTerminal.host.classList.add('hidden');
  }

  function linkedAgentSession(session) {
    if (!session) return null;
    if (state.boundTargetId === session.id && state.boundAgent) return state.boundAgent;
    const agents = Array.isArray(state.snapshot?.sessions) ? state.snapshot.sessions : [];
    const bridgeId = String(session.bridgeId || '');
    const bridged = bridgeId ? agents.find(item => item.id === bridgeId) : null;
    if (bridged) return bridged;
    const terminalPid = Number(session.pid || 0);
    return agents.find(agent => (Array.isArray(agent.runtimePresence) ? agent.runtimePresence : []).some(item => (
      item.terminalId === session.id
      || (terminalPid > 0 && Number(item.pid || 0) === terminalPid)
      || (terminalPid > 0 && Number(item.parentPid || 0) === terminalPid)
    ))) || null;
  }

  function isAiTerminalSession(session) {
    return Boolean(session && (session.type === 'agent' || linkedAgentSession(session)));
  }

  async function showSelection(options = {}) {
    const generation = state.captureGeneration;
    const expectedMode = state.mode;
    const expectedSessionId = state.selectedId;
    const expectedTmuxId = state.selectedTmux?.pane?.id || state.selectedTmux?.pane?.nativeId || '';
    const selectionIsCurrent = () => (!options.isCurrent || options.isCurrent())
      && generation === state.captureGeneration
      && expectedMode === state.mode
      && expectedSessionId === state.selectedId
      && expectedTmuxId === (state.selectedTmux?.pane?.id || state.selectedTmux?.pane?.nativeId || '');
    if (!selectionIsCurrent()) return false;
    const session = currentSession();
    const remote = currentTmux();
    const visibleEntry = session
      ? state.terminals.get(session.id)
      : remote ? state.remoteTerminal : null;
    // State snapshots for the currently selected PTY are frequent. Hiding the
    // already-mounted xterm before awaiting its resolved ready promise causes a
    // visible flash and can interrupt focus/IME. Keep only that exact selection
    // visible; genuine selection changes still hide the previous screen while
    // the new one is prepared.
    const keepVisible = Boolean(visibleEntry && !visibleEntry.host.classList.contains('hidden'));
    if (!keepVisible) hideScreens();
    if (session) {
      const entry = await ensureSessionTerminal(session);
      if (!selectionIsCurrent()) return false;
      for (const [id, other] of state.terminals) {
        if (id !== session.id) other.host.classList.add('hidden');
      }
      if (state.remoteTerminal) state.remoteTerminal.host.classList.add('hidden');
      entry.host.classList.remove('hidden');
      if (!keepVisible || entry !== visibleEntry) fitEntry(entry, session.id);
      stopCapture();
    } else if (remote) {
      if (!selectionIsCurrent()) return false;
      const entry = ensureRemoteTerminal();
      for (const other of state.terminals.values()) other.host.classList.add('hidden');
      entry.host.classList.remove('hidden');
      if (!keepVisible || entry !== visibleEntry) fitEntry(entry);
      startCapture();
    } else {
      if (!selectionIsCurrent()) return false;
      hideScreens();
      stopCapture();
    }
    if (!selectionIsCurrent()) return false;
    return true;
  }

  async function selectSession(id, interactionMode = '', options = {}) {
    if (options.isCurrent && !options.isCurrent()) return false;
    if (options.attentionActivation !== true && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('whitebox:terminal-manual-selection'));
    }
    const generation = ++state.captureGeneration;
    state.selectedId = id;
    const selectedSession = state.sessions.find(item => item.id === id);
    state.interactionMode = interactionMode || (isAiTerminalSession(selectedSession) ? 'question' : 'computer');
    state.selectedTmux = null;
    if (await showSelection(options) === false) return false;
    if (options.isCurrent && !options.isCurrent()) return false;
    if (!state.active || state.captureGeneration !== generation || state.selectedId !== id || state.mode !== 'general') return false;
    if (options.focus !== false) state.terminals.get(id)?.terminal?.focus();
    return true;
  }

  async function selectTmux(distroName, paneId, interactionMode = '') {
    if (typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('whitebox:terminal-manual-selection'));
    }
    const row = tmuxRows().find(item => item.distro.name === distroName && item.pane.nativeId === paneId);
    if (!row) return notice(t('terminal.error.selected_split_missing'), 'error');
    clearRemoteWheelState();
    const generation = ++state.captureGeneration;
    if (interactionMode) state.interactionMode = interactionMode;
    state.selectedId = null;
    state.selectedTmux = row;
    state.remoteCapture = '';
    state.remoteViewportAnchor = null;
    state.remoteViewportAtBottom = false;
    if (state.remoteTerminal) state.remoteTerminal.terminal.clear();
    await showSelection();
    if (!state.active || state.captureGeneration !== generation || state.selectedId || state.mode !== 'tmux'
      || state.selectedTmux?.distro?.name !== distroName || state.selectedTmux?.pane?.nativeId !== paneId) return;
    state.remoteTerminal?.terminal?.focus();
  }

  async function selectTmuxById(paneId) {
    const row = tmuxRows().find(item => item.pane.id === paneId || item.pane.nativeId === paneId);
    if (!row) return notice(t('terminal.error.selected_tmux_missing'), 'error');
    state.mode = 'tmux';
    return selectTmux(row.distro.name, row.pane.nativeId, 'computer');
  }

  async function refreshSessions(payload = null) {
    if (!Number.isSafeInteger(state.terminalSessionRevision)) state.terminalSessionRevision = 0;
    if (!Number.isSafeInteger(state.terminalListRequestGeneration)) state.terminalListRequestGeneration = 0;
    const payloadSessions = payload && Array.isArray(payload.sessions) ? payload.sessions : null;
    const requestGeneration = payloadSessions ? 0 : ++state.terminalListRequestGeneration;
    const revision = state.terminalSessionRevision;
    const nextSessions = payloadSessions || await window.whitebox.terminalList();
    // IPC state events are authoritative. A list request started before one of
    // those events (or before a newer list request) must not restore stale rows.
    if (!payloadSessions && (revision !== state.terminalSessionRevision
      || requestGeneration !== state.terminalListRequestGeneration)) return false;
    state.sessions = Array.isArray(nextSessions) ? nextSessions : [];
    state.terminalSessionRevision += 1;
    const activeIds = new Set(state.sessions.map(session => session.id));
    for (const session of state.sessions) {
      const entry = state.terminals.get(session.id);
      if (!entry || !session.fixedGrid) continue;
      entry.fixedGrid = { cols: Number(session.cols) || 120, rows: Number(session.rows) || 32 };
      fitEntry(entry, session.id);
    }
    const rehydratedIds = new Set(payload?.change === 'reconnected' ? activeIds : []);
    const reconnectEntries = payload?.change === 'reconnected'
      ? [...state.terminals].filter(([id]) => activeIds.has(id))
      : [];
    if (typeof CustomEvent === 'function') {
      for (const [id, entry] of reconnectEntries) {
        window.dispatchEvent(new CustomEvent('whitebox:terminal-reconnect-owner', {
          detail: {
            terminalId: id,
            mountId: String(entry.host.parentElement?.id || ''),
          },
        }));
      }
    }
    const reconnectFocus = reconnectEntries
      .find(([, entry]) => entry.host.contains(document.activeElement)) || null;
    const reconnectFocusId = String(reconnectFocus?.[0] || '');
    const reconnectFocusOrigin = reconnectFocus?.[1]?.host?.contains(document.activeElement)
      ? document.activeElement
      : null;
    if (reconnectFocusId && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('whitebox:terminal-reconnect-focus', {
        detail: { terminalId: reconnectFocusId },
      }));
    }
    for (const [id, entry] of state.terminals) {
      if (activeIds.has(id) && !rehydratedIds.has(id)) continue;
      closeRawInputEntry(entry);
      entry.terminal.dispose();
      entry.host.remove();
      state.terminals.delete(id);
      if (!rehydratedIds.has(id)) state.commandDrafts.delete(id);
    }
    if (state.selectedId && !state.sessions.some(item => item.id === state.selectedId)) state.selectedId = null;
    if (state.active) await showSelection();
    if (reconnectFocusId && state.active && state.selectedId === reconnectFocusId) {
      const entry = state.terminals.get(reconnectFocusId);
      const active = document.activeElement;
      const focusStayedPassive = !active
        || active === document.body
        || active === document.documentElement
        || active === reconnectFocusOrigin
        || active.isConnected === false;
      const documentFocused = typeof document.hasFocus !== 'function' || document.hasFocus();
      const documentVisible = !document.visibilityState || document.visibilityState === 'visible';
      if (entry && focusStayedPassive && documentFocused && documentVisible) entry.terminal.focus();
    }
    if (typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('whitebox:terminal-inventory-changed'));
    }
    return true;
  }

  function clearRemoteWheelState() {
    if (state.remoteCaptureRetryTimer) clearTimeout(state.remoteCaptureRetryTimer);
    state.remoteCaptureRetryTimer = null;
    state.remoteWheelIdleUntil = 0;
    state.remotePendingWheelEvents = [];
  }

  function scheduleRemoteCaptureRetry(delayMs) {
    if (state.remoteCaptureRetryTimer) clearTimeout(state.remoteCaptureRetryTimer);
    state.remoteCaptureRetryTimer = setTimeout(() => {
      state.remoteCaptureRetryTimer = null;
      captureRemote();
    }, Math.max(1, Math.ceil(Number(delayMs) || 0)));
  }

  function replayRemoteWheelEvents(entry, events) {
    if (!entry || !events.length || typeof window.WheelEvent !== 'function') return;
    // Replay from the surface a physical pointer wheel targets. The event then
    // bubbles through Xterm's overlaid scrollable element into its smooth-wheel
    // handler by the same route as real input.
    const target = entry.host.querySelector?.('.xterm-screen')
      || entry.host.querySelector?.('.xterm-scrollable-element')
      || entry.host.querySelector?.('.xterm');
    if (!target) return;
    for (const event of events) {
      target.dispatchEvent(new window.WheelEvent('wheel', {
        ...event,
        bubbles: true,
        cancelable: true,
      }));
    }
  }

  async function captureRemote() {
    if (state.captureInFlight) return;
    const remote = currentTmux();
    if (!remote || !state.active || state.selectedId) return;
    const captureKey = `${remote.distro.name}:${remote.pane.nativeId}`;
    const captureGeneration = state.captureGeneration;
    let appliedEntry = null;
    state.captureInFlight = true;
    try {
      const result = await guarded(() => window.whitebox.tmuxCapture({ distro: remote.distro.name, target: remote.pane.nativeId, lines: 1_500 }));
      const current = currentTmux();
      if (!state.active || captureGeneration !== state.captureGeneration || state.selectedId
        || !current || `${current.distro.name}:${current.pane.nativeId}` !== captureKey) return;
      if (!result || typeof result.output !== 'string' || result.output === state.remoteCapture) return;
      const wheelSettleRemaining = Number(state.remoteWheelIdleUntil || 0) - Date.now();
      if (wheelSettleRemaining > 0) {
        // Discard this now-stale capture. Applying it would reset xterm in the
        // middle of its smooth wheel animation and cut off the user's target.
        scheduleRemoteCaptureRetry(wheelSettleRemaining);
        return;
      }
      if (state.remoteCaptureRetryTimer) clearTimeout(state.remoteCaptureRetryTimer);
      state.remoteCaptureRetryTimer = null;
      const firstCapture = !state.remoteCapture;
      state.remoteCapture = result.output;
      const entry = ensureRemoteTerminal();
      appliedEntry = entry;
      const buffer = entry.terminal.buffer.active;
      const previousViewport = state.remoteViewportAnchor == null
        ? Number(buffer && buffer.viewportY || 0)
        : state.remoteViewportAnchor;
      const wasAtBottom = state.remoteViewportAnchor == null
        ? Boolean(buffer && buffer.viewportY >= buffer.baseY)
        : state.remoteViewportAtBottom;
      state.remoteCaptureApplying = true;
      entry.terminal.reset();
      await new Promise(resolve => entry.terminal.write(result.output.replace(/\n/g, '\r\n'), resolve));
      const selected = currentTmux();
      if (!state.active || captureGeneration !== state.captureGeneration || !selected || `${selected.distro.name}:${selected.pane.nativeId}` !== captureKey) {
        entry.terminal.reset();
        state.remoteCapture = '';
        setTimeout(captureRemote, 0);
        return;
      }
      await new Promise(resolve => requestAnimationFrame(() => {
        try {
          const latest = currentTmux();
          if (captureGeneration !== state.captureGeneration || !latest || `${latest.distro.name}:${latest.pane.nativeId}` !== captureKey) return;
          if (firstCapture) scrollImmediately(entry.terminal, () => entry.terminal.scrollToTop());
          else if (state.remoteViewportAnchor == null ? wasAtBottom : state.remoteViewportAtBottom) {
            scrollToBottomImmediately(entry.terminal);
          } else {
            const viewportAnchor = state.remoteViewportAnchor == null ? previousViewport : state.remoteViewportAnchor;
            scrollImmediately(entry.terminal, () => entry.terminal.scrollToLine(viewportAnchor));
          }
          const restoredBuffer = entry.terminal.buffer.active;
          state.remoteViewportAnchor = Number(restoredBuffer.viewportY) || 0;
          state.remoteViewportAtBottom = !firstCapture && state.remoteViewportAnchor >= Number(restoredBuffer.baseY || 0);
          entry.host.dataset.viewportY = String(state.remoteViewportAnchor);
          entry.host.dataset.baseY = String(Number(restoredBuffer.baseY) || 0);
          state.captureRevision += 1;
          entry.host.dataset.captureRevision = String(state.captureRevision);
        } catch (error) {
          window.WhiteboxRendererUtils.reportRecoverableError('tmux-capture-render', error);
        } finally {
          resolve();
        }
      }));
    } finally {
      state.remoteCaptureApplying = false;
      state.captureInFlight = false;
      const pendingWheelEvents = Array.isArray(state.remotePendingWheelEvents)
        ? state.remotePendingWheelEvents.splice(0)
        : [];
      const selected = currentTmux();
      if (appliedEntry && pendingWheelEvents.length
        && state.active && captureGeneration === state.captureGeneration && !state.selectedId
        && selected && `${selected.distro.name}:${selected.pane.nativeId}` === captureKey) {
        replayRemoteWheelEvents(appliedEntry, pendingWheelEvents);
      }
    }
  }

  function startCapture() {
    if (state.captureTimer) clearInterval(state.captureTimer);
    state.captureTimer = null;
    captureRemote();
    state.captureTimer = setInterval(captureRemote, 1_000);
  }

  function stopCapture() {
    if (state.captureTimer) clearInterval(state.captureTimer);
    state.captureTimer = null;
    clearRemoteWheelState();
  }

  async function refreshSnapshot() {
    const snapshot = await guarded(() => window.whitebox.snapshot(), t('terminal.tmux.refreshed'), 'tmux-refresh');
    if (snapshot) updateSnapshot(snapshot, state.workspaces);
  }

  return {
    fitEntry,
    ensureSessionTerminal,
    selectSession,
    selectTmux,
    selectTmuxById,
    refreshSessions,
    captureRemote,
    startCapture,
    stopCapture,
    refreshSnapshot,
  };
};
