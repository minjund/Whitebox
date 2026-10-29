'use strict';

// Shared PTY views and exact-identity attention requests for the terminal workspace.
(() => {
  const { $, reportRecoverableError } = window.WhiteboxRendererUtils;
  const t = (key, params) => window.WhiteboxI18n.t(key, params);
  const TERMINAL_SMOOTH_SCROLL_MS = 100;
  const xtermTheme = () => window.WhiteboxTerminalEngine.workspaceTheme();
  const state = {
    sessions: [], terminals: new Map(), terminalFontSize: 15,
    terminalSessionRevision: 0, terminalListRequestGeneration: 0,
    initialized: false, eventsBound: false, initPromise: null,
    pendingPrompts: new Map(), promptDismissals: new Map(), promptReplayCache: new Map(),
    promptNotificationsPrimed: false, promptRefreshInFlight: false,
    promptRefreshQueued: false, promptLastRefreshAt: 0,
    platform: { id: 'win32' },
  };
  const { fitEntry, ensureSessionTerminal, refreshSessions, readTerminalSession } = window.WhiteboxTerminalWorkbench({
    $, state, notice, xtermOptions, errorMessage,
  });

  function notice(message) {
    const text = String(message || '').trim();
    if (text) window.WhiteboxA11y?.announce?.(text);
  }

  function errorMessage(error) {
    return window.WhiteboxI18n.errorText(error, 'terminal.error.unknown');
  }

  function xtermOptions(readOnly = false) {
    const reduceMotion = document.documentElement?.dataset?.motion === 'reduced';
    return {
      ...window.WhiteboxTerminalEngine.workspaceOptions(state.terminalFontSize),
      allowProposedApi: false,
      cursorBlink: !readOnly,
      disableStdin: readOnly,
      convertEol: readOnly,
      smoothScrollDuration: reduceMotion ? 0 : TERMINAL_SMOOTH_SCROLL_MS,
      theme: xtermTheme(),
    };
  }

  function syncXtermTheme() {
    for (const entry of state.terminals.values()) {
      entry.terminal.options.theme = xtermTheme();
    }
  }

  function pendingPromptForSession(sessionOrId) {
    const id = typeof sessionOrId === 'object' ? sessionOrId?.id : sessionOrId;
    return state.pendingPrompts.get(String(id || '')) || null;
  }

  function promptMapSignature(prompts) {
    return JSON.stringify([...prompts.entries()].map(([sessionId, prompt]) => [
      sessionId,
      prompt.fingerprint,
      prompt.target?.id,
    ]).sort((left, right) => left[0].localeCompare(right[0])));
  }

  function serializedPendingPrompts(prompts = state.pendingPrompts) {
    return [...prompts.entries()].map(([sessionId, prompt]) => ({
      sessionId: String(sessionId || ''),
      provider: String(prompt?.provider || ''),
      fingerprint: String(prompt?.fingerprint || ''),
      kind: String(prompt?.kind || ''),
      creationId: prompt?.creationId,
      pid: prompt?.pid,
      title: String(prompt?.title || ''),
      question: String(prompt?.question || ''),
      detail: String(prompt?.detail || ''),
      target: {
        id: String(prompt?.target?.id || ''),
        kind: String(prompt?.target?.kind || ''),
        terminalId: String(prompt?.target?.terminalId || ''),
        distro: String(prompt?.target?.distro || ''),
        paneNativeId: String(prompt?.target?.paneNativeId || ''),
        label: String(prompt?.target?.label || ''),
      },
      choices: (prompt?.choices || []).map(choice => ({
        id: String(choice?.id || ''),
        label: String(choice?.label || ''),
        key: String(choice?.key || ''),
        tone: String(choice?.tone || ''),
        requiresText: choice?.requiresText === true,
      })),
    }));
  }

  function syncPendingPromptsToMain(prompts = state.pendingPrompts) {
    if (!window.whitebox?.syncAttentionPrompts) return Promise.resolve({ ok: false });
    return Promise.resolve(window.whitebox.syncAttentionPrompts(serializedPendingPrompts(prompts)))
      .catch(error => {
        reportRecoverableError('terminal-prompt-sync', error);
        return { ok: false };
      });
  }

  async function scanPendingPrompts() {
    const detector = window.WhiteboxTerminalPrompts?.detectPendingPrompt;
    if (typeof detector !== 'function') {
      return { prompts: new Map(), observedTargets: new Map(), failedTargets: new Set() };
    }
    const mappings = [];
    // Providers run inside ordinary workspace shells; no dashboard projection.
    for (const session of state.sessions) {
      if (!['shell', 'powershell', 'cmd'].includes(session.type) || session.status !== 'running'
        || session.transient || !session.creationId?.startsWith('workspace:')) continue;
      mappings.push({
        agent: { id: session.id, provider: 'codex' },
        target: { id: session.id, kind: 'terminal', terminalId: session.id },
      });
    }
    const detected = await Promise.all(mappings.map(async ({ agent, target }) => {
      try {
        const session = state.sessions.find(item => item.id === target.terminalId);
        const cached = state.promptReplayCache.get(target.terminalId);
        let live;
        if (cached?.creationId === session?.creationId && cached?.pid === session?.pid) {
          live = cached;
        } else {
          live = await readTerminalSession(target.terminalId);
          if (live) state.promptReplayCache.set(target.terminalId, { ...live, replay: String(live.replay || '').slice(-24000) });
        }
        const prompt = live?.status === 'running' ? detector(live.replay) : null;
        if (!prompt) return { targetId: target.id, sessionId: agent.id, prompt: null, failed: false };
        return {
          targetId: target.id,
          sessionId: agent.id,
          failed: false,
          prompt: {
            ...prompt,
            provider: agent.provider,
            creationId: live.creationId,
            pid: live.pid,
            target: {
              id: target.id,
              kind: target.kind,
              terminalId: target.terminalId || '',
              distro: target.distro || '',
              paneNativeId: target.paneNativeId || '',
              label: target.label || '',
            },
          },
        };
      } catch (error) {
        reportRecoverableError(`terminal-prompt-scan:${target.id}`, error);
        return { targetId: target.id, sessionId: agent.id, prompt: null, failed: true };
      }
    }));
    const prompts = new Map();
    const observedTargets = new Map();
    const failedTargets = new Set();
    for (const item of detected) {
      if (item.failed) {
        failedTargets.add(item.targetId);
        continue;
      }
      observedTargets.set(item.targetId, item.prompt?.fingerprint || '');
      if (!item.prompt) continue;
      if (state.promptDismissals.get(item.prompt.target.id) !== item.prompt.fingerprint) {
        prompts.set(item.sessionId, item.prompt);
      }
    }
    return { prompts, observedTargets, failedTargets };
  }

  function schedulePendingPromptRefresh(force = false) {
    if (!state.initialized || !window.WhiteboxWorkspace) return;
    const elapsed = Date.now() - state.promptLastRefreshAt;
    if (!force && elapsed < 2_500) return;
    if (state.promptRefreshInFlight) {
      state.promptRefreshQueued = true;
      return;
    }
    state.promptRefreshInFlight = true;
    state.promptLastRefreshAt = Date.now();
    const previousSignature = promptMapSignature(state.pendingPrompts);
    const previousPrompts = state.pendingPrompts;
    scanPendingPrompts().then(result => {
      const prompts = result.prompts;
      for (const [sessionId, prompt] of previousPrompts) {
        if (result.failedTargets.has(prompt.target?.id)
          && state.promptDismissals.get(prompt.target?.id) !== prompt.fingerprint) {
          prompts.set(sessionId, prompt);
        }
      }
      window.WhiteboxTerminalPrompts?.reconcilePromptDismissals?.(
        state.promptDismissals,
        result.observedTargets,
      );
      for (const [sessionId, prompt] of prompts) {
        if (state.promptDismissals.get(prompt.target?.id) === prompt.fingerprint) prompts.delete(sessionId);
      }
      state.pendingPrompts = prompts;
      void syncPendingPromptsToMain(prompts);
      if (state.promptNotificationsPrimed) {
        for (const [sessionId, prompt] of prompts) {
          const previous = previousPrompts.get(sessionId);
          if (previous?.fingerprint === prompt.fingerprint && previous?.target?.id === prompt.target?.id) continue;
          window.whitebox.notifyAttentionPrompt?.({
            sessionId,
            fingerprint: `${prompt.target?.id || ''}:${prompt.fingerprint || ''}`,
            kind: prompt.kind,
            title: prompt.title || prompt.question || '',
          }).catch(error => reportRecoverableError('terminal-prompt-notification', error));
        }
      } else {
        state.promptNotificationsPrimed = true;
      }
      if (promptMapSignature(prompts) !== previousSignature) {
        window.dispatchEvent(new CustomEvent('whitebox:terminal-prompts-changed'));
      }
    }).catch(error => {
      reportRecoverableError('terminal-prompt-refresh', error);
    }).finally(() => {
      state.promptRefreshInFlight = false;
      if (state.promptRefreshQueued) {
        state.promptRefreshQueued = false;
        state.promptLastRefreshAt = 0;
        schedulePendingPromptRefresh();
      }
    });
  }

  function resolveAttentionPrompt(payload = {}) {
    const result = window.WhiteboxTerminalPrompts?.applyPromptResolution?.(
      state.pendingPrompts,
      state.promptDismissals,
      payload,
    ) || { ok: false, changed: false, requiresText: false };
    if (result.changed) {
      window.dispatchEvent(new CustomEvent('whitebox:terminal-prompts-changed'));
    }
    return result;
  }

  function bindEvents() {
    window.WhiteboxTerminalEvents({
      state,
      fitEntry,
      refreshSessions,
      notice,
      schedulePendingPromptRefresh,
    });
  }

  function scrollTerminalToLine(id, line) {
    const entry = state.terminals.get(String(id || ''));
    if (!entry) return false;
    entry.userScrollRevision += 1;
    entry.terminal.scrollToLine(Math.max(0, Math.floor(Number(line) || 0)));
    return true;
  }

  function init() {
    if (state.initPromise) return state.initPromise;
    state.initPromise = (async () => {
      if (!window.whitebox) return;
      if (!state.eventsBound) {
        bindEvents();
        state.eventsBound = true;
      }
      const [bootstrap] = await Promise.all([window.WhiteboxRendererUtils.bootstrap(), refreshSessions()]);
      state.platform = bootstrap.platform || state.platform;
      state.initialized = true;
      schedulePendingPromptRefresh(true);
      // Output can arrive during the prompt scan throttle.
      setInterval(() => schedulePendingPromptRefresh(), 2_500);
    })().catch(error => {
      state.initialized = false;
      state.initPromise = null;
      throw error;
    });
    return state.initPromise;
  }

  window.WhiteboxTerminal = {
    mountGroupTerminal: async (id, mount, options = {}) => {
      await init();
      const session = await readTerminalSession(id);
      if (!session) throw new Error('터미널 세션을 찾을 수 없습니다.');
      state.promptReplayCache.set(id, { ...session, replay: String(session.replay || '').slice(-24000) });
      if (options.requireSessionIdentity && (session.status !== 'running'
        || session.creationId !== options.requireSessionIdentity.creationId
        || session.pid !== options.requireSessionIdentity.pid)) {
        throw new Error('The original terminal session is no longer running.');
      }
      if (session.status === 'detached') await window.whitebox.terminalReconnect(id);
      const entry = await ensureSessionTerminal(session);
      if (!mount.isConnected) return () => {};
      entry.host.dataset.groupTerminal = 'true';
      const workspaceOptions = window.WhiteboxTerminalEngine.workspaceOptions(options.fontSize || 15);
      if (options.fontFamily) workspaceOptions.fontFamily = options.fontFamily;
      const previous = Object.fromEntries(Object.keys(workspaceOptions).map(key => [key, entry.terminal.options[key]]));
      Object.assign(entry.terminal.options, workspaceOptions);
      entry.terminal.textarea.setAttribute('aria-label', options.inputLabel || `${session.title} 터미널 입력`);
      const syncCursor = () => {
        if (entry.terminal.disposed || !entry.terminal.renderer) return;
        const focused = document.hasFocus() && document.activeElement === entry.terminal.textarea;
        mount.closest('[data-group-member]')?.classList.toggle('is-input-active', focused);
        options.onInputFocus?.(focused);
        if (entry.terminal.renderer.cursorVisible !== focused) {
          entry.terminal.renderer.cursorVisible = focused;
          entry.terminal.refresh();
        }
      };
      const focusTerminal = event => window.WhiteboxTerminalEngine.focusFromPointer(event, entry.terminal);
      mount.addEventListener('pointerdown', focusTerminal);
      document.addEventListener('focusin', syncCursor);
      document.addEventListener('focusout', syncCursor);
      window.addEventListener('focus', syncCursor);
      window.addEventListener('blur', syncCursor);
      const cursorRender = entry.terminal.onRender(syncCursor);
      const inputObserver = entry.terminal.onData(data => options.onUserInput?.(data));
      mount.appendChild(entry.host);
      entry.host.classList.remove('hidden');
      let fitTimer;
      const scheduleFit = () => {
        clearTimeout(fitTimer);
        fitTimer = setTimeout(() => { if (!entry.terminal.disposed && mount.isConnected) fitEntry(entry, id); }, 80);
      };
      const observer = new ResizeObserver(scheduleFit);
      observer.observe(mount);
      scheduleFit();
      syncCursor();
      const dispose = () => {
        clearTimeout(fitTimer);
        observer.disconnect();
        cursorRender.dispose();
        inputObserver.dispose();
        mount.removeEventListener('pointerdown', focusTerminal);
        document.removeEventListener('focusin', syncCursor);
        document.removeEventListener('focusout', syncCursor);
        window.removeEventListener('focus', syncCursor);
        window.removeEventListener('blur', syncCursor);
        if (!entry.terminal.disposed) {
          Object.assign(entry.terminal.options, previous);
          if (entry.terminal.renderer) entry.terminal.renderer.cursorVisible = true;
        }
        if (entry.host.parentElement !== mount) return;
        delete entry.host.dataset.groupTerminal;
        entry.host.classList.add('hidden');
        $('#terminalRuntimeMount')?.appendChild(entry.host);
      };
      dispose.setFontSize = size => { entry.terminal.options.fontSize = size; scheduleFit(); syncCursor(); };
      dispose.setFontFamily = family => { entry.terminal.options.fontFamily = family; scheduleFit(); syncCursor(); };
      return dispose;
    },
    pendingPromptForSession,
    resolveAttentionPrompt,
    refreshPendingPrompts: () => schedulePendingPromptRefresh(true),
    scrollTerminalToLine,
    readTerminal: id => {
      const entry = state.terminals.get(id);
      if (!entry || entry.terminal.disposed || entry.outputHydrating) return '';
      if (entry.terminal.readTextSnapshot) return entry.terminal.readTextSnapshot(window.WhiteboxTerminalReviewTurns?.readinessText).text;
      const buffer = entry.terminal.buffer.active;
      const lines = [];
      for (let row = Math.max(0, buffer.length - 400); row < buffer.length; row += 1) {
        lines.push(buffer.getLine(row)?.translateToString(true) || '');
      }
      return lines.join('\n').slice(-24000);
    },
    readTerminalSnapshot: id => {
      const entry = state.terminals.get(id);
      const buffer = !entry?.outputHydrating && !entry?.terminal?.disposed && entry?.terminal?.buffer?.active;
      const snapshot = buffer && entry.terminal.readTextSnapshot?.(window.WhiteboxTerminalReviewTurns?.readinessText);
      return { inputDraft: entry?.terminal?.textarea?.value || '', text: snapshot ? snapshot.text : window.WhiteboxTerminal.readTerminal(id), readinessText: snapshot ? snapshot.readinessText : buffer ? window.WhiteboxTerminalReviewTurns?.readinessText(buffer) : '', bracketedPaste: Boolean(buffer && entry.terminal.wasmTerm?.hasBracketedPaste()), outputSequence: entry?.outputHydrating ? null : entry?.outputSequence };
    },
    focusTerminal: id => state.terminals.get(id)?.terminal.focus(),
  };
  window.WhiteboxTerminal.mountTerminal = window.WhiteboxTerminal.mountGroupTerminal;
  window.addEventListener('whitebox:theme-changed', syncXtermTheme);
  init().catch(error => notice(t('terminal.error.initialization_failed', { message: errorMessage(error) }), 'error'));
})();
