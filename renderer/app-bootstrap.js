"use strict";

(() => {
  const factories = window.WhiteboxAppFactories || {};
  const t = (key, params) => window.WhiteboxI18n.t(key, params);
  const app = {};
  const install = (name) => {
    if (typeof factories[name] !== "function") throw new Error(t("bootstrap.module_missing", { name }));
    const additions = factories[name](app) || {};
    const duplicate = Object.keys(additions).find(key => Object.prototype.hasOwnProperty.call(app, key));
    if (duplicate) throw new Error(`Renderer module "${name}" attempted to replace "${duplicate}".`);
    Object.assign(app, additions);
  };

  [
    "createCore",
    "createProviderVisibility",
    "createDashboard",
    "createGraphModel",
    "createGraphView",
    "createGraphLayout",
    "createGraphOrchestration",
    "createAgentActions",
    "createManagement",
    "createSessionRenderer",
    "createPtyFocusMode",
    "createDrawer",
    "createRunModal",
    "createQualityEnhancements",
    "createNavigationEventBindings",
    "createSessionEventBindings",
    "createFilterEventBindings",
    "createDialogEventBindings",
    "createEventBindings",
  ].forEach(install);
  window.WhiteboxApp = app;

  const { $, esc, state, loadGuideState, loadQualityState = () => {}, saveDashboardPreferences = () => {}, loadProviderVisibility, projectVisibleSnapshot, visibleSnapshot, isProviderVisible, bindEvents, render, timeOnly, renderUpdateSettings, syncViewChrome, selectView, canOpenPtyFocus, isPtyFocusActive, ownerRootSession, openPtyFocusVerified, closePtyFocus, syncPendingPtyFocus = () => false, toast, refreshProviderUsage = async () => null } = app;

  let initializationError = "";
  const setConnectedAt = (value) => {
    const connectionTitle = $("#appConnectionState")?.querySelector("b");
    if (connectionTitle) {
      connectionTitle.removeAttribute("data-i18n");
      const connectedCount = (state.providers || []).filter((provider) => (
        !state.hiddenProviders.has(provider.id) && state.availability?.[provider.id]
      )).length;
      connectionTitle.textContent = t("ui.app_connected", { count: connectedCount });
    }
    const lastSync = $("#lastSync");
    if (lastSync) {
      lastSync.removeAttribute("data-i18n");
      lastSync.textContent = t("ui.connection_checked");
      lastSync.hidden = true;
    }
  };
  const showInitializationError = (message) => {
    initializationError = String(message || t("ui.connection_failed"));
    const connectionTitle = $("#appConnectionState")?.querySelector("b");
    if (connectionTitle) connectionTitle.textContent = t("ui.connection_failed");
    $("#lastSync").hidden = false;
    $("#lastSync").textContent = t("ui.connection_failed");
    $("#appConnectionState")?.classList.add("connection-error");
    $("#appErrorMessage").textContent = initializationError;
    $("#appErrorBanner").classList.remove("hidden");
  };
  $("#appRetryBtn")?.addEventListener("click", () => window.location.reload());
  $("#appErrorCopyBtn")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(initializationError);
      toast(t("quality.copy_success"));
    } catch (error) {
      window.WhiteboxRendererUtils.reportRecoverableError("initialization-error-copy", error);
      toast(t("quality.copy_failed"));
    }
  });

  async function init() {
    loadQualityState();
    state.workspace = "all";
    state.workspaceSource = "all";
    loadGuideState();
    if (!window.whitebox) {
      $("#emptyState").classList.remove("hidden");
      $("#emptyState p").textContent = t("bootstrap.open_in_app");
      showInitializationError(t("bootstrap.open_in_app"));
      return;
    }
    // Subscribe before the bootstrap IPC. The main process can finish its
    // startup update check while bootstrap is still in flight; subscribing
    // afterwards would leave the UI stuck on the older `checking` snapshot.
    let latestUpdateState = null;
    let updateRenderingReady = false;
    if (window.whitebox.onUpdateState) {
      window.whitebox.onUpdateState((update) => {
        latestUpdateState = update;
        state.update = update;
        if (updateRenderingReady) renderUpdateSettings();
      });
    }
    const bootstrap = await window.WhiteboxRendererUtils.bootstrap();
    if (window.whitebox.setLocale) await window.whitebox.setLocale(window.WhiteboxI18n?.getLocale() || "en");
    state.providers = bootstrap.providers || [];
    state.providerMap = new Map(state.providers.map((provider) => [provider.id, provider]));
    loadProviderVisibility(bootstrap.providerVisibility);
    state.availability = bootstrap.availability || {};
    state.sourcePlugins = bootstrap.sourcePlugins || [];
    state.sourcePluginSettings = bootstrap.sourcePluginSettings || state.sourcePluginSettings;
    state.workspaces = bootstrap.workspaces || [];
    state.rawSnapshot = bootstrap.snapshot;
    state.snapshot = projectVisibleSnapshot(bootstrap.snapshot);
    state.activeRuns = bootstrap.activeRuns || [];
    state.platform = bootstrap.platform || state.platform;
    state.versions = bootstrap.versions || {};
    state.update = latestUpdateState || bootstrap.update || { status: "idle", currentVersion: state.versions.app || "" };
    // A failed or non-PTY activation falls back to the existing work-status
    // queue. It must not guess another terminal just to show context.
    let passiveFocusGeneration = 0;
    const showAttentionSession = (session = null) => {
      if (isPtyFocusActive?.()) return false;
      const root = ownerRootSession?.(session);
      if (root && String(state.ptyFocusSessionId || "") === String(root.id || "")) {
        closePtyFocus?.({ restore: false, suppressManualSelection: true });
      }
      selectView("waiting");
      return true;
    };
    const attentionActivation = window.WhiteboxAttentionActivation?.createAttentionActivationController({
      getSessions: () => state.snapshot?.sessions || [],
      isProviderVisible,
      canOpenPty: session => canOpenPtyFocus?.(ownerRootSession?.(session)) === true,
      acknowledge: result => window.whitebox.ackAttentionActivation?.(result),
      showSession: showAttentionSession,
      openPty: async (session, activation, operation) => {
        try {
          if (!operation?.isCurrent?.()) return { opened: false, retryable: true };
          const outcome = await openPtyFocusVerified?.(session.id, {
            targetId: activation.targetId,
            terminalId: activation.terminalId,
            focus: true,
            attentionActivation: true,
            isCurrent: operation.isCurrent,
          }) || { opened: false, retryable: true };
          if (!operation.isCurrent()) return { opened: false, retryable: true };
          if (outcome.opened) document.querySelector(".main-stage")?.scrollTo({ top: 0, behavior: "auto" });
          return outcome;
        } catch (error) {
          if (!["DELIVERY_REJECTED", "ATTENTION_ACTIVATION_CANCELLED"].includes(error?.code)) {
            window.WhiteboxRendererUtils.reportRecoverableError("attention-activation-open-pty", error);
          }
          return { opened: false, retryable: true };
        }
      },
      onError: (scope, error) => window.WhiteboxRendererUtils.reportRecoverableError(scope, error),
    });
    const handleAttentionRequested = async (payload) => {
      if (payload?.activationId && attentionActivation) {
        attentionActivation.handle(payload);
        return;
      }
      const sessionId = String(payload && payload.sessionId || '');
      const event = payload?.event === 'completed' ? 'completed' : payload?.event === 'terminal' ? 'terminal' : 'attention';
      const session = (state.snapshot && state.snapshot.sessions || []).find(item => item.id === sessionId);
      if (session && !isProviderVisible(session.provider)) return;
      if (!session) {
        selectView(event === 'completed' ? 'active' : 'waiting');
        toast(t("bootstrap.opened_attention_list"));
        return;
      }
      const generation = ++passiveFocusGeneration;
      const isCurrent = () => generation === passiveFocusGeneration;
      try {
        // Old/native notifications do not carry a delivery token or a target
        // identity. They may reuse the sole existing PTY, but must never guess
        // among terminals or create/fork a new one as a side effect of opening.
        const outcome = await openPtyFocusVerified?.(session.id, {
          focus: true,
          attentionActivation: true,
          isCurrent,
        });
        if (outcome?.opened) return;
      } catch (error) {
        window.WhiteboxRendererUtils.reportRecoverableError("legacy-attention-open-pty", error);
      }
      if (!isCurrent() || isPtyFocusActive?.()) return;
      showAttentionSession(session);
      if (event === 'completed') selectView('active');
      toast(t("agent.open_terminal_failed"));
    };
    const handleTerminalPromptResolved = async (payload) => {
      const generation = ++passiveFocusGeneration;
      const isCurrent = () => generation === passiveFocusGeneration;
      const resolution = window.WhiteboxTerminal?.resolveAttentionPrompt?.(payload);
      if (!resolution?.ok || !resolution.requiresText) return;
      const session = (state.snapshot?.sessions || []).find(item => item.id === resolution.sessionId);
      if (!session || session.parentId || !isProviderVisible(session.provider)) return;
      const outcome = await openPtyFocusVerified?.(session.id, {
        targetId: resolution.targetId,
        terminalId: resolution.terminalId,
        focus: true,
        attentionActivation: true,
        isCurrent,
      });
      if (!isCurrent()) return;
      if (!outcome?.opened && !isPtyFocusActive?.()) {
        showAttentionSession();
        toast(t("agent.open_terminal_failed"));
      }
    };
    if (window.whitebox.onAttentionRequested) window.whitebox.onAttentionRequested(handleAttentionRequested);
    if (window.whitebox.onTerminalPromptResolved) window.whitebox.onTerminalPromptResolved(handleTerminalPromptResolved);
    if (window.whitebox.onMonitorError) window.whitebox.onMonitorError((message) => {
      const detail = String(message || t("ui.connection_failed"));
      showInitializationError(detail);
      toast(detail);
    });
    bindEvents();
    render();
    syncPendingPtyFocus();
    updateRenderingReady = true;
    if (latestUpdateState) {
      state.update = latestUpdateState;
      renderUpdateSettings();
    }
    refreshProviderUsage().catch(error => {
      window.WhiteboxRendererUtils.reportRecoverableError("provider-usage-refresh", error);
    });
    saveDashboardPreferences();
    $("#appConnectionState")?.classList.remove("connection-error");
    $("#appErrorBanner").classList.add("hidden");
    app.initialized = true;
    setConnectedAt(state.snapshot && state.snapshot.generatedAt);
    let snapshotRenderFrame = 0;
    let terminalInventoryRenderFrame = 0;
    let latestSnapshot = null;
    window.whitebox.onSnapshot((snapshot) => {
      state.rawSnapshot = snapshot;
      state.snapshot = projectVisibleSnapshot(snapshot);
      attentionActivation?.retry();
      if (Array.isArray(snapshot.sourcePlugins)) state.sourcePlugins = snapshot.sourcePlugins;
      if (window.WhiteboxTerminal) window.WhiteboxTerminal.updateSnapshot(visibleSnapshot(), state.workspaces);
      setConnectedAt(snapshot.generatedAt);
      latestSnapshot = snapshot;
      if (snapshotRenderFrame) return;
      snapshotRenderFrame = requestAnimationFrame(() => {
        snapshotRenderFrame = 0;
        const renderedSnapshot = latestSnapshot;
        syncPendingPtyFocus();
        render();
        saveDashboardPreferences();
        syncPendingPtyFocus();
      });
    });
    window.addEventListener("whitebox:terminal-inventory-changed", () => {
      attentionActivation?.retry();
      if (!state.snapshot || terminalInventoryRenderFrame) return;
      terminalInventoryRenderFrame = requestAnimationFrame(() => {
        terminalInventoryRenderFrame = 0;
        syncPendingPtyFocus();
        render("terminal-inventory");
        syncPendingPtyFocus();
      });
    });
    window.addEventListener("whitebox:terminal-manual-selection", () => {
      passiveFocusGeneration += 1;
      attentionActivation?.userNavigated();
    });
    if (window.whitebox.rendererReady) await window.whitebox.rendererReady();
  }

  app.init = init;

  window.addEventListener("whitebox:locale-changed", (event) => {
    if (window.whitebox?.setLocale) {
      Promise.resolve(window.whitebox.setLocale(event.detail.locale)).catch((error) => {
        window.WhiteboxRendererUtils.reportRecoverableError("locale-persistence", error);
      });
    }
    if (!state.snapshot) {
      syncViewChrome();
      return;
    }
    render("locale");
    setConnectedAt(state.snapshot.generatedAt);
  });

  window.addEventListener("whitebox:terminal-prompts-changed", () => {
    if (!state.snapshot || state.view === "terminal" || state.view === "tmux") return;
    render("terminal-prompt");
  });

  init().catch((error) => {
    console.error(error);
    const message = t("bootstrap.initialization_failed", { message: window.WhiteboxI18n.errorText(error, "ui.connection_failed") });
    showInitializationError(message);
    toast(message);
  });
})();
