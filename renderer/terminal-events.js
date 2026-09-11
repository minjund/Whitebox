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

  const writeOutputNow = (entry, data) => {
    if (!entry || !data || entry.inputClosed) return;
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
      if (entry.inputClosed || entry.outputWritePending > 0) return;
      // Xterm's DOM renderer can occasionally retain the parsed buffer without
      // painting the final rows after a short PTY burst. Refresh only after the
      // burst drains so the visible screen cannot lag behind accepted output.
      if (entry.host.isConnected && typeof entry.terminal.refresh === 'function') {
        entry.terminal.refresh(0, Math.max(0, Number(entry.terminal.rows || 1) - 1));
      }
      const restoreGeneration = entry.outputRestoreGeneration;
      const restoreViewport = () => {
        if (
          entry.inputClosed
          || entry.outputShouldFollow
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

  const outputBatches = new WeakMap();
  const writeTerminalOutput = (entry, data) => {
    if (!entry || !data || entry.inputClosed) return;
    if (!entry.coalesceOutput) { writeOutputNow(entry, data); return; }
    // Windows Codex redraws can end DEC 2026 at the drawing cursor. ConPTY's
    // following repaint restores the input cursor about one frame later. Keep
    // adjacent fragments in one xterm write so that interim cursor is not
    // painted. Preserve every byte, including split escape sequences/Unicode.
    let batch = outputBatches.get(entry);
    if (!batch) {
      batch = { chunks: [], chars: 0, tail: '', cursorDeadline: false, idleTimer: null, maxTimer: null };
      const cancel = () => {
        clearTimeout(batch.idleTimer);
        clearTimeout(batch.maxTimer);
        outputBatches.delete(entry);
        entry.cancelOutputWrite = null;
      };
      batch.flush = () => {
        cancel();
        writeOutputNow(entry, batch.chunks.join(''));
      };
      outputBatches.set(entry, batch);
      entry.cancelOutputWrite = cancel;
      // Neither continuous output nor a background window waiting for a paint
      // may strand the tail. The size limit also bounds the queued memory.
      batch.maxTimer = setTimeout(batch.flush, 64);
    }
    batch.chunks.push(data);
    batch.chars += data.length;
    batch.tail = (batch.tail + data).slice(-32);
    clearTimeout(batch.idleTimer);
    if (batch.chars >= 128 * 1024) batch.flush();
    else if (batch.tail.endsWith('\x1b[?25h\x1b[0 q\x1b[?2026l')) {
      // Native Windows Codex's show/reset-style/end-sync handoff can precede
      // ConPTY's cursor restore by >200ms under load. Wait for that following
      // output, with a one-shot deadline if no repaint arrives. Do not extend
      // this deadline repeatedly for a continuous stream of redraws.
      if (!batch.cursorDeadline) {
        batch.cursorDeadline = true;
        clearTimeout(batch.maxTimer);
        batch.maxTimer = setTimeout(batch.flush, 256);
      }
    } else batch.idleTimer = setTimeout(batch.flush, 24);
  };
  // Output released after an authority refresh must use the same viewport-aware
  // writer as live PTY events so reading position and xterm repaint semantics
  // remain unchanged.
  state.writeTerminalOutput = writeTerminalOutput;

  const refreshComprehensionOutput = () => {
    for (const entry of state.terminals.values()) {
      if (!entry || entry.outputHydrating) continue;
      const released = entry.comprehensionOutputFilter?.refresh?.() || '';
      writeTerminalOutput(entry, released);
    }
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
  window.addEventListener('whitebox:comprehension-authority-refresh', refreshComprehensionOutput);
  window.addEventListener('whitebox:terminal-command-delivery', event => {
    const target = event?.detail?.target || {};
    const terminalId = String(target.terminalId || event?.detail?.terminalId || '');
    const entry = terminalId ? state.terminals.get(terminalId) : null;
    if (entry?.comprehensionOutputFilter?.hasPending?.()) {
      writeTerminalOutput(entry, entry.comprehensionOutputFilter.releasePending());
    }
  });
};
