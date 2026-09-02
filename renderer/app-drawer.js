"use strict";

window.WhiteboxAppFactories = window.WhiteboxAppFactories || {};

// Kept as a small compatibility router while older cards and notifications
// are migrated away from the removed conversation drawer. Every task-open
// gesture now resolves to the owning root PTY focus surface.
window.WhiteboxAppFactories.createDrawer = function createDrawer(context = {}) {
  const {
    state,
    markGuideStep = () => {},
    snapshotSession = () => null,
    acknowledgeSessionNotices = () => 0,
    resultReviewPtyTarget = () => null,
    selectView = () => {},
    signalManualTerminalSelection = () => {},
    toast = () => {},
  } = context;
  const t = (key, params) => window.WhiteboxI18n.t(key, params);
  let openGeneration = 0;
  window.addEventListener?.("whitebox:terminal-manual-selection", () => {
    openGeneration += 1;
  });

  function ownerRoot(value) {
    let session = typeof value === "object" && value
      ? value
      : snapshotSession(value) || state.details?.get?.(value);
    const visited = new Set();
    while (session?.parentId && !visited.has(session.id)) {
      visited.add(session.id);
      session = snapshotSession(session.parentId) || state.details?.get?.(session.parentId);
    }
    return session || null;
  }

  async function openOwnerPty(id, options = {}) {
    if (options.attentionActivation !== true) signalManualTerminalSelection();
    const generation = ++openGeneration;
    const isCurrent = () => generation === openGeneration;
    const selected = snapshotSession(id) || state.details?.get?.(id);
    const root = ownerRoot(selected || id);
    let exactTarget = options.targetId || options.terminalId
      ? { id: options.targetId || options.terminalId, terminalId: options.terminalId || options.targetId }
      : resultReviewPtyTarget(root);
    markGuideStep("detail");
    state.selectedId = selected?.id || String(id || "");

    // A task card is an explicit request to enter its PTY. If the provider
    // session has no live app-owned terminal yet, create that exact terminal
    // first (Codex Desktop uses its safe fork path), then mount only the
    // returned identity. Automatic attention activation never creates a
    // competing writer here.
    if (root && !exactTarget && options.attentionActivation !== true && window.WhiteboxTerminal) {
      const canFork = window.WhiteboxRendererUtils?.canForkCodexDesktopSession?.(root) === true;
      const launch = canFork
        ? window.WhiteboxTerminal.forkForAgent
        : window.WhiteboxTerminal.resumeForAgent;
      if (typeof launch === "function") {
        try {
          const created = await launch.call(window.WhiteboxTerminal, root, "", false, { focus: false });
          if (!isCurrent()) return false;
          const createdId = String(created?.terminalId || created?.id || "");
          if (createdId) exactTarget = { id: createdId, terminalId: createdId };
        } catch (error) {
          window.WhiteboxRendererUtils?.reportRecoverableError?.("pty-focus-create", error);
        }
      }
    }

    const targetId = String(options.targetId || exactTarget?.id || exactTarget?.terminalId || "");
    const terminalId = String(options.terminalId || exactTarget?.terminalId || exactTarget?.id || "");

    if (root && targetId && terminalId && context.canOpenPtyFocus?.(root)) {
      try {
        const outcome = await context.openPtyFocusVerified?.(root.id, {
          trigger: options.trigger || null,
          focus: options.focus !== false,
          targetId,
          terminalId,
          attentionActivation: options.attentionActivation === true,
          manualSelectionSignaled: options.attentionActivation !== true,
          isCurrent,
        });
        if (!isCurrent()) return false;
        if (outcome?.reason === "cancelled") return false;
        if (outcome?.opened === true) {
          const acknowledged = options.acknowledge === false ? 0 : acknowledgeSessionNotices(selected || id);
          if (acknowledged > 0) context.renderWorkspaces?.();
          return true;
        }
      } catch (error) {
        window.WhiteboxRendererUtils?.reportRecoverableError?.("pty-focus-route", error);
      }
    }
    if (!isCurrent() || context.isPtyFocusActive?.()) return false;
    // Imported/read-only work has no app-owned PTY. Keep it in work status;
    // there is intentionally no transcript or replacement detail surface.
    if (options.keepView !== true) selectView(selected?.status === "completed" ? "active" : "waiting");
    toast(t("pty_focus.terminal_unavailable"));
    return false;
  }

  function openDrawer(id, options = {}) {
    return openOwnerPty(id, options);
  }

  function openSubagentConversation(id, options = {}) {
    return openOwnerPty(id, options);
  }

  function openExecutionActivity(ownerId, _executionId, options = {}) {
    return openOwnerPty(ownerId, options);
  }

  return {
    openDrawer,
    openSubagentConversation,
    openExecutionActivity,
    closeDrawer: () => false,
    backToAgentFlow: () => false,
    renderDrawer: () => {},
  };
};
