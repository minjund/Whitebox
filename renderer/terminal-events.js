'use strict';

/** Bind only terminal-host lifecycle events used by the dedicated PTY focus surface. */
window.WhiteboxTerminalEvents = function bindTerminalEvents(context) {
  const t = (key, params) => window.WhiteboxI18n.t(key, params);
  const {
    state,
    currentSession,
    fitEntry,
    refreshSessions,
    notice,
    schedulePendingPromptRefresh = () => {},
  } = context;

  const writeTerminalOutput = (entry, data) => {
    if (!entry || !data) return;
    const buffer = entry.terminal.buffer.active;
    if (entry.outputWritePending === 0) {
      entry.outputRestoreGeneration += 1;
      entry.outputViewportAnchor = Number(buffer.viewportY) || 0;
      entry.outputShouldFollow = entry.outputViewportAnchor >= Number(buffer.baseY || 0);
      entry.outputUserScrollRevision = entry.userScrollRevision;
    }
    entry.outputWritePending += 1;
    entry.terminal.write(data, () => {
      entry.outputWritePending = Math.max(0, entry.outputWritePending - 1);
      if (entry.outputWritePending > 0) return;
      // Xterm's DOM renderer can occasionally retain the parsed buffer without
      // painting the final rows after a short PTY burst. Refresh only after the
      // burst drains so the visible screen cannot lag behind accepted output.
      if (entry.host.isConnected && typeof entry.terminal.refresh === 'function') {
        entry.terminal.refresh(0, Math.max(0, Number(entry.terminal.rows || 1) - 1));
      }
      const restoreGeneration = entry.outputRestoreGeneration;
      const restoreViewport = () => {
        if (
          entry.outputShouldFollow
          || entry.outputWritePending > 0
          || restoreGeneration !== entry.outputRestoreGeneration
          || entry.outputUserScrollRevision !== entry.userScrollRevision
        ) return;
        const latestBaseY = Number(entry.terminal.buffer.active.baseY) || 0;
        entry.terminal.scrollToLine(Math.min(entry.outputViewportAnchor, latestBaseY));
      };
      restoreViewport();
      requestAnimationFrame(() => requestAnimationFrame(restoreViewport));
    });
  };

  window.addEventListener('resize', () => {
    const entry = currentSession() ? state.terminals.get(state.selectedId) : state.remoteTerminal;
    fitEntry(entry, state.selectedId || '');
  });
  window.whitebox.onTerminalData(payload => {
    const entry = state.terminals.get(payload && payload.id);
    const data = entry?.acceptOutput ? entry.acceptOutput(payload) : payload && payload.data;
    writeTerminalOutput(entry, data);
    schedulePendingPromptRefresh();
  });
  window.whitebox.onTerminalState(payload => {
    refreshSessions(payload);
    schedulePendingPromptRefresh(true);
  });
  window.whitebox.onTerminalError(payload => notice(payload && payload.message || t('terminal.error.input_failed'), 'error'));
  window.whitebox.onTerminalConnection?.(payload => {
    const tone = payload?.state === 'failed' ? 'error' : payload?.state === 'connected' ? 'success' : 'info';
    notice(payload?.message || t('terminal.error.input_failed'), tone);
  });
};
