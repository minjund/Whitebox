"use strict";

(() => {
  const local = {
    generation: 0,
    targetIds: new Map(),
    targetSignatures: new Map(),
    autoFailures: new Map(),
    pendingMount: null,
    pendingResume: null,
    pendingReconnect: null,
    focusSessionId: "",
    focusRequestToken: 0,
    focusRequestRevision: 0,
    focusOrigin: null,
    userFocusRevision: 0,
    reconnectOwnerTerminalId: "",
    embeddedOwnerGeneration: 0,
    foreignEmbeddedOwner: null,
    forkCreationGestures: new Map(),
  };
  const t = (key, params) => window.WhiteboxI18n.t(key, params);
  const report = (scope, error) => window.WhiteboxRendererUtils?.reportRecoverableError?.(scope, error);

  function app() {
    return window.WhiteboxApp;
  }

  function sessionById(sessionId) {
    const instance = app();
    const id = String(sessionId || "");
    if (!id) return null;
    return instance?.snapshotSession?.(id)
      || instance?.state?.details?.get?.(id)
      || (instance?.state?.snapshot?.sessions || []).find(session => session.id === id)
      || null;
  }

  function activeSessionId(instance = app()) {
    return String(instance?.state?.ptyFocusSessionId
      || instance?.state?.inlineTerminalSessionId
      || "");
  }

  function selectedSession() {
    return sessionById(activeSessionId());
  }

  function isMainSession(session) {
    return Boolean(session && !session.parentId);
  }

  function isFocusEligibleSession(session) {
    if (!isMainSession(session) || session.sourcePluginId) return false;
    if (String(session.status || "").toLowerCase() === "completed"
      && window.WhiteboxRendererUtils.canForkCodexDesktopSession?.(session) === true) return true;
    if (String(session.provider || "").toLowerCase() === "codex"
      && String(session.clientKind || "").toLowerCase() === "codex-desktop") return false;
    return window.WhiteboxRendererUtils.isWritableDirectSession?.(session) === true
      && session.controlCapabilities?.pty === true
      && session.presentation?.conversationSurface !== "transcript";
  }

  function isVisibleFocusSurface(surface) {
    if (!surface || surface.isConnected === false) return false;
    for (let node = surface; node; node = node.parentElement) {
      if (node.hidden
        || node.classList?.contains?.("hidden")
        || node.getAttribute?.("aria-hidden") === "true"
        || node.style?.display === "none"
        || node.style?.visibility === "hidden") return false;
    }
    const view = surface.ownerDocument?.defaultView || window;
    const style = view.getComputedStyle?.(surface);
    return !style || (style.display !== "none" && style.visibility !== "hidden");
  }

  function focusShell(instance = app()) {
    const sessionId = String(instance?.state?.ptyFocusSessionId || "");
    if (!sessionId) return null;
    const surface = document.querySelector("#ptyFocusSurface");
    if (!isVisibleFocusSurface(surface)) return null;
    const root = surface.querySelector?.("[data-inline-agent-terminal]") || null;
    return root?.dataset?.inlineAgentTerminal === sessionId ? root : null;
  }

  function shell() {
    const instance = app();
    if (instance?.state?.ptyFocusSessionId) return focusShell(instance);
    return document.querySelector("#agentInlineTerminal[data-inline-agent-terminal]")
      || document.querySelector("[data-inline-agent-terminal]");
  }

  function terminalViewport(root = shell()) {
    return root?.querySelector?.("[data-agent-terminal-viewport]")
      || root?.querySelector?.("#agentInlineTerminalViewport")
      || null;
  }

  function isCurrentSurface(sessionId, root, instance = app()) {
    const id = String(sessionId || "");
    return Boolean(id
      && root
      && activeSessionId(instance) === id
      && shell() === root
      && root.dataset.inlineAgentTerminal === id);
  }

  function isFocusSurface(root, instance = app()) {
    return Boolean(root && focusShell(instance) === root);
  }

  function ownsViewportMount(viewport, mountId) {
    const id = String(mountId || "");
    return Boolean(viewport && id && String(viewport.id || "") === id);
  }

  function mountedTerminalHost(viewport, terminalId) {
    const id = String(terminalId || "");
    if (!viewport || !id) return null;
    return [...viewport.children].find(child => (
      String(child?.dataset?.terminalScreen || "") === id
      && child.parentElement === viewport
    )) || null;
  }

  function clearForeignEmbeddedOwner(sessionId = "") {
    if (sessionId && local.foreignEmbeddedOwner?.sessionId !== sessionId) return;
    local.embeddedOwnerGeneration += 1;
    local.foreignEmbeddedOwner = null;
  }

  function cancelInlineClaim(sessionId) {
    local.generation += 1;
    local.pendingMount = null;
    if (local.focusSessionId === sessionId) {
      local.focusSessionId = "";
      local.focusOrigin = null;
    }
  }

  function connectionSignature(session, terminal = window.WhiteboxTerminal) {
    return terminal?.agentConnectionSignature?.(session)
      || JSON.stringify([
        session?.id,
        session?.externalId,
        session?.provider,
        session?.environment?.kind,
        session?.environment?.distro,
      ].map(value => String(value || "").trim()));
  }

  function requestTerminalFocus(sessionId) {
    local.focusSessionId = String(sessionId || "");
    local.focusRequestToken += 1;
    local.focusRequestRevision = local.userFocusRevision;
    local.focusOrigin = document.activeElement;
    return local.focusRequestToken;
  }

  function focusWhenReady(sessionId) {
    if (local.focusSessionId !== sessionId) return;
    const revision = local.focusRequestRevision;
    const origin = local.focusOrigin;
    local.focusSessionId = "";
    local.focusOrigin = null;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      const root = shell();
      const embedded = window.WhiteboxTerminal?.embeddedState?.() || {};
      const viewport = terminalViewport(root);
      const ownsEmbeddedHost = root?.dataset.inlineAgentTerminal === sessionId
        && embedded.agentSessionId === sessionId
        && Boolean(mountedTerminalHost(viewport, embedded.terminalId));
      const documentFocused = typeof document.hasFocus !== "function" || document.hasFocus();
      const documentVisible = !document.visibilityState || document.visibilityState === "visible";
      const focusStayedPassive = !active
        || active === document.body
        || active === document.documentElement
        || active === origin;
      if (local.userFocusRevision === revision
        && focusStayedPassive
        && documentFocused
        && documentVisible
        && ownsEmbeddedHost
        && activeSessionId() === sessionId) {
        window.WhiteboxTerminal?.focusEmbedded?.();
      }
    });
  }

  function setStatus(root, key, meta = "", tone = "connecting") {
    if (!root) return;
    root.dataset.connection = tone;
    const label = root.querySelector("[data-inline-terminal-status]");
    const detail = root.querySelector("[data-inline-terminal-meta]");
    if (label) label.textContent = t(key);
    if (detail) detail.textContent = String(meta || "");
  }

  function setEmpty(
    root,
    visible,
    titleKey = "drawer.terminal_connecting",
    helpKey = "drawer.terminal_connecting_help",
    resumable = false,
    launchAction = "resume",
  ) {
    const empty = root?.querySelector("[data-inline-terminal-empty]");
    if (!empty) return;
    empty.classList.toggle("hidden", !visible);
    const title = empty.querySelector("b");
    const help = empty.querySelector("small");
    const resume = empty.querySelector("[data-inline-terminal-resume]");
    if (title) title.textContent = t(titleKey);
    if (help) help.textContent = t(helpKey);
    resume?.classList.toggle("hidden", !resumable);
    if (resume) {
      resume.disabled = !resumable;
      if (resume.dataset) resume.dataset.terminalLaunchAction = launchAction;
      resume.textContent = t(launchAction === "fork" ? "drawer.terminal_fork_action" : "drawer.terminal_resume_action");
    }
  }

  function launchSupport(terminal, session) {
    const fork = terminal?.forkSupport?.(session);
    if (fork?.supported) return { ...fork, action: "fork" };
    return { ...(terminal?.resumeSupport?.(session) || { supported: false, reason: "" }), action: "resume" };
  }

  async function sync(options = {}) {
    const instance = app();
    const session = selectedSession();
    const terminal = window.WhiteboxTerminal;
    if (!instance?.state || !session || !terminal?.mountForAgent) return { ok: false, reason: "not-ready" };
    if (!isMainSession(session)) return { ok: false, reason: "not-main-session" };
    if (!isFocusEligibleSession(session)) {
      if (String(instance.state.ptyFocusSessionId || "") === String(session.id || "")) {
        if (typeof instance.closePtyFocus === "function") {
          instance.closePtyFocus({ restore: true, reason: "missing" });
        } else closeFocus();
      } else if (String(instance.state.inlineTerminalSessionId || "") === String(session.id || "")) {
        close();
      } else if (terminal.embeddedState?.().agentSessionId === session.id) {
        terminal.unmountEmbedded?.();
      }
      return { ok: false, reason: "not-eligible" };
    }
    const root = shell();
    if (!root) return { ok: false, reason: "not-ready" };
    if (root.dataset.inlineAgentTerminal !== session.id) return { ok: false, reason: "stale-shell" };
    const viewport = terminalViewport(root);
    if (!viewport) return { ok: false, reason: "missing-viewport" };

    const signature = connectionSignature(session, terminal);
    const pendingResume = local.pendingResume;
    if (pendingResume?.sessionId === session.id
      && pendingResume.signature === signature
      && options.resumeOwner !== pendingResume) {
      // Focus can move from the inline card to the full PTY surface while an
      // explicit provider resume is still opening the terminal. Join that
      // user-owned operation; starting createIfMissing here would enter the
      // terminal-agent ensure path and resume the same provider a second time.
      // The resume owner performs its final sync against the then-current
      // surface, so the joined result is already mounted in the right place.
      return pendingResume.promise;
    }
    const explicitOpenGesture = local.forkCreationGestures.get(session.id) === signature;
    const forkCreationGesture = explicitOpenGesture
      && launchSupport(terminal, session).action === "fork";
    // Consume the gesture before any early return. If a live target is already
    // mounted, this open action has been satisfied and must not remain armed
    // until a later passive sync after that PTY exits.
    local.forkCreationGestures.delete(session.id);
    const rememberedTargetId = String(local.targetIds.get(session.id) || "");
    const embedded = terminal.embeddedState?.() || {};
    const mountedHost = mountedTerminalHost(viewport, embedded.terminalId);
    const foreignOwner = local.foreignEmbeddedOwner;
    const foreignOwnerMatches = foreignOwner
      && foreignOwner.generation === local.embeddedOwnerGeneration
      && foreignOwner.mountId === "drawerTerminalViewport"
      && foreignOwner.sessionId === session.id
      && foreignOwner.signature === signature
      && foreignOwner.terminalId === String(embedded.terminalId || rememberedTargetId || "");
    if (foreignOwnerMatches) {
      cancelInlineClaim(session.id);
      return { ok: false, reason: "owned-elsewhere" };
    }
    if (embedded.connected
      && embedded.agentSessionId === session.id
      && embedded.terminalId
      && !mountedHost
      && !(explicitOpenGesture && isFocusSurface(root, instance))) {
      // The terminal module has one embedded host shared by the inline panel
      // and drawer. A passive snapshot or reconnect must never pull a host
      // back after the drawer has taken ownership of it.
      cancelInlineClaim(session.id);
      return { ok: false, reason: "owned-elsewhere" };
    }
    const verifiedEmbeddedTarget = (terminal.agentTargets?.(session) || []).find(item => (
      item?.kind === "terminal"
      && String(item.terminalId || item.id || "") === embedded.terminalId
    )) || null;
    const rememberedConnectionMatches = rememberedTargetId === embedded.terminalId
      && local.targetSignatures.get(session.id) === signature;
    if (embedded.connected
      && embedded.agentSessionId === session.id
      && mountedHost
      && (verifiedEmbeddedTarget || rememberedConnectionMatches)) {
      const target = verifiedEmbeddedTarget || { id: embedded.terminalId, terminalId: embedded.terminalId };
      local.targetIds.set(session.id, embedded.terminalId);
      local.targetSignatures.set(session.id, signature);
      local.autoFailures.delete(session.id);
      setEmpty(root, false);
      setStatus(root, "drawer.terminal_connected", target.label || "", "connected");
      focusWhenReady(session.id);
      return { ok: true, reused: true, target };
    }

    const pendingMount = local.pendingMount;
    const matchingPendingMount = pendingMount?.sessionId === session.id
      && pendingMount.viewport === viewport
      && pendingMount.signature === signature;
    // A user PTY gesture must promote an in-flight passive mount. Reusing the
    // passive promise here would consume the one-shot gesture without ever
    // granting fork creation authority.
    if (matchingPendingMount && (pendingMount.forkCreationGesture === true
      || (!forkCreationGesture && options.force !== true))) {
      return pendingMount.promise;
    }
    if (options.force) {
      local.autoFailures.delete(session.id);
      local.pendingMount = null;
    }

    const generation = ++local.generation;
    let cachedAutoFailure = local.autoFailures.get(session.id) === signature;
    const mountableTargetAppeared = (terminal.agentTargets?.(session) || []).some(target => target?.kind === "terminal");
    if (cachedAutoFailure && mountableTargetAppeared) {
      local.autoFailures.delete(session.id);
      cachedAutoFailure = false;
    }
    if (!options.force && cachedAutoFailure && !mountableTargetAppeared) {
      const support = launchSupport(terminal, session);
      const resumable = Boolean(support?.supported);
      const forking = resumable && support.action === "fork";
      setEmpty(
        root,
        true,
        forking ? "drawer.terminal_fork_available" : resumable ? "drawer.terminal_resume_available" : "drawer.terminal_unavailable",
        forking ? "drawer.terminal_fork_available_help" : resumable ? "drawer.terminal_resume_available_help" : "drawer.terminal_unavailable_help",
        resumable,
        support.action,
      );
      setStatus(
        root,
        forking ? "drawer.terminal_fork_available" : resumable ? "drawer.terminal_resume_available" : "drawer.terminal_unavailable",
        support?.reason || "",
        "unavailable",
      );
      local.focusSessionId = "";
      return { ok: false, reason: "cached-failure", resumable };
    }
    const createIfMissing = !session.parentId && !cachedAutoFailure;
    setEmpty(root, true);
    setStatus(root, "drawer.terminal_connecting");
    const task = (async () => {
      try {
        const result = await terminal.mountForAgent(session, {
          mount: viewport,
          targetId: rememberedTargetId,
          createIfMissing,
          forkIfOriginOwned: true,
          forkCreationGesture,
        });
        if (generation !== local.generation || !isCurrentSurface(session.id, root, instance)) {
          return { ok: false, reason: "cancelled" };
        }
        const currentSession = selectedSession();
        if (!currentSession || connectionSignature(currentSession, terminal) !== signature) {
          const active = terminal.embeddedState?.() || {};
          const resultTargetId = String(result?.target?.terminalId || result?.target?.id || "");
          if (resultTargetId
            && String(active.terminalId || "") === resultTargetId
            && active.agentSessionId === session.id) {
            terminal.unmountEmbedded?.();
          }
          local.targetIds.delete(session.id);
          local.targetSignatures.delete(session.id);
          local.autoFailures.delete(session.id);
          setTimeout(() => {
            if (activeSessionId() === session.id) sync({ force: true });
          }, 0);
          return { ok: false, reason: "stale-identity" };
        }
        if (!result?.ok) {
          if (!["cancelled", "pending"].includes(result?.reason)) {
            local.autoFailures.set(session.id, signature);
          }
          const support = result?.reason === "no-target" ? launchSupport(terminal, session) : null;
          const resumable = Boolean(support?.supported);
          const forking = resumable && support.action === "fork";
          setEmpty(
            root,
            true,
            forking ? "drawer.terminal_fork_available" : resumable ? "drawer.terminal_resume_available" : "drawer.terminal_unavailable",
            forking ? "drawer.terminal_fork_available_help" : resumable ? "drawer.terminal_resume_available_help" : "drawer.terminal_unavailable_help",
            resumable,
            support?.action || "resume",
          );
          setStatus(
            root,
            forking ? "drawer.terminal_fork_available" : resumable ? "drawer.terminal_resume_available" : "drawer.terminal_unavailable",
            "",
            "unavailable",
          );
          local.focusSessionId = "";
          return result || { ok: false, reason: "unavailable" };
        }
        const targetId = String(result.target?.terminalId || result.target?.id || "");
        if (targetId) {
          local.targetIds.set(session.id, targetId);
          local.targetSignatures.set(session.id, signature);
        }
        local.autoFailures.delete(session.id);
        setEmpty(root, false);
        setStatus(root, "drawer.terminal_connected", result.target?.label || result.terminal?.title || "", "connected");
        focusWhenReady(session.id);
        return result;
      } catch (error) {
        if (generation !== local.generation) return { ok: false, reason: "cancelled" };
        local.autoFailures.set(session.id, signature);
        local.focusSessionId = "";
        setEmpty(root, true, "drawer.terminal_unavailable", "drawer.terminal_unavailable_help");
        setStatus(root, "drawer.terminal_unavailable", window.WhiteboxI18n.errorText(error, "drawer.terminal_unavailable"), "error");
        report("inline-agent-terminal-mount", error);
        return { ok: false, reason: "error", error };
      } finally {
        if (local.pendingMount?.promise === task) local.pendingMount = null;
      }
    })();
    local.pendingMount = { sessionId: session.id, viewport, signature, forkCreationGesture, promise: task };
    return task;
  }

  function close(options = {}) {
    const instance = app();
    const sessionId = String(instance?.state?.inlineTerminalSessionId || "");
    if (!instance?.state || !sessionId) return false;
    const activeFocusSessionId = String(instance.state.ptyFocusSessionId || "");
    if (!activeFocusSessionId) {
      releasePendingSurfaceControls();
      local.generation += 1;
      local.pendingMount = null;
      local.focusSessionId = "";
      local.focusOrigin = null;
    }
    if (activeFocusSessionId !== sessionId) local.forkCreationGestures.delete(sessionId);
    instance.state.inlineTerminalSessionId = null;
    const embedded = window.WhiteboxTerminal?.embeddedState?.();
    if (!activeFocusSessionId
      && (!embedded?.agentSessionId || embedded.agentSessionId === sessionId)) {
      window.WhiteboxTerminal?.unmountEmbedded?.();
    }
    if (options.render !== false) instance.renderSessions?.("focus");
    return true;
  }

  function markPendingButton(record, button) {
    if (!record || !button) return;
    record.buttons.add(button);
    button.setAttribute("aria-busy", "true");
    button.disabled = true;
  }

  function releasePendingButtons(record) {
    for (const button of record?.buttons || []) {
      button.removeAttribute?.("aria-busy");
      button.disabled = false;
    }
    record?.buttons?.clear?.();
  }

  function releasePendingSurfaceControls() {
    releasePendingButtons(local.pendingResume);
    releasePendingButtons(local.pendingReconnect);
  }

  function activeIdentityMatches(sessionId, signature, terminal = window.WhiteboxTerminal) {
    const current = selectedSession();
    return Boolean(current
      && activeSessionId() === String(sessionId || "")
      && String(current.id || "") === String(sessionId || "")
      && isFocusEligibleSession(current)
      && connectionSignature(current, terminal) === signature);
  }

  function enterFocus(sessionId, options = {}) {
    const instance = app();
    const id = String(sessionId || "");
    if (!instance?.state || !id) return false;
    const session = sessionById(id);
    if (!isFocusEligibleSession(session)) return false;

    const previousSessionId = String(instance.state.ptyFocusSessionId || "");
    if (previousSessionId && previousSessionId !== id) closeFocus();
    releasePendingSurfaceControls();
    local.generation += 1;
    local.pendingMount = null;
    clearForeignEmbeddedOwner(id);
    local.autoFailures.delete(id);
    if (options.focus !== false) requestTerminalFocus(id);
    else {
      local.focusSessionId = "";
      local.focusOrigin = null;
    }
    // This token is consumed by the first sync against the visible focus
    // surface. Passive state restoration never grants provider fork creation.
    local.forkCreationGestures.set(id, connectionSignature(session));
    instance.state.ptyFocusSessionId = id;
    return true;
  }

  function closeFocus(options = {}) {
    const instance = app();
    const sessionId = String(instance?.state?.ptyFocusSessionId || "");
    if (!instance?.state || !sessionId) return false;
    releasePendingSurfaceControls();
    local.generation += 1;
    local.pendingMount = null;
    if (local.focusSessionId === sessionId) {
      local.focusSessionId = "";
      local.focusOrigin = null;
    }
    local.forkCreationGestures.delete(sessionId);
    instance.state.ptyFocusSessionId = null;
    if (options.unmount !== false) {
      // Focus owns both the visible host and any async mount still targeting
      // its viewport. Always advance the shared mount generation so a delayed
      // completion cannot strand xterm inside the now-hidden focus surface.
      window.WhiteboxTerminal?.unmountEmbedded?.();
    }
    return true;
  }

  function toggle(sessionId, options = {}) {
    const instance = app();
    const id = String(sessionId || "");
    if (!instance?.state || !id) return;
    const session = sessionById(id);
    if (!isFocusEligibleSession(session)) {
      if (instance.state.inlineTerminalSessionId === id) close();
      return;
    }
    if (instance.state.inlineTerminalSessionId === id) {
      close();
      return;
    }
    close({ render: false });
    if (options.focus !== false) instance.state.graphFocusId = id;
    clearForeignEmbeddedOwner(id);
    local.autoFailures.delete(id);
    // `options.focus` controls whether the graph itself changes focus. The
    // user's PTY click should still place the caret in xterm after either the
    // overview or focused layout finishes mounting.
    requestTerminalFocus(id);
    local.forkCreationGestures.set(id, connectionSignature(session));
    instance.state.inlineTerminalSessionId = id;
    instance.renderSessions?.("focus");
  }

  async function resume() {
    const instance = app();
    const session = selectedSession();
    const root = shell();
    const button = root?.querySelector("[data-inline-terminal-resume]");
    if (!session || !button || !isFocusEligibleSession(session)) return;
    const sessionId = String(session.id || "");
    const signature = connectionSignature(session);
    const support = launchSupport(window.WhiteboxTerminal, session);
    const forking = support.action === "fork";
    if (!support.supported) return;
    const existing = local.pendingResume;
    if (existing?.sessionId === sessionId && existing.signature === signature && existing.action === support.action) {
      markPendingButton(existing, button);
      setEmpty(root, true,
        forking ? "drawer.terminal_forking" : "drawer.terminal_resuming",
        forking ? "drawer.terminal_forking_help" : "drawer.terminal_resuming_help");
      setStatus(root, forking ? "drawer.terminal_forking" : "drawer.terminal_resuming");
      return existing.promise;
    }
    if (button.getAttribute("aria-busy") === "true") return;
    let focusRequestToken = 0;
    const clearOwnFocusIntent = () => {
      if (local.focusSessionId !== sessionId || local.focusRequestToken !== focusRequestToken) return;
      local.focusSessionId = "";
      local.focusOrigin = null;
    };
    const record = { sessionId, signature, action: support.action, buttons: new Set(), promise: null };
    markPendingButton(record, button);
    setEmpty(
      root,
      true,
      forking ? "drawer.terminal_forking" : "drawer.terminal_resuming",
      forking ? "drawer.terminal_forking_help" : "drawer.terminal_resuming_help",
    );
    setStatus(root, forking ? "drawer.terminal_forking" : "drawer.terminal_resuming");
    // Capture the user's resume gesture before the provider can spend seconds
    // reopening its history. Later interaction changes userFocusRevision and
    // must not be erased when this await eventually resolves.
    focusRequestToken = requestTerminalFocus(sessionId);
    const task = (async () => {
      try {
        const resumed = forking
          ? await window.WhiteboxTerminal.forkForAgent(session, "", false, { focus: false })
          : await window.WhiteboxTerminal.resumeForAgent(session, "", false, { focus: false });
        const targetId = String(resumed?.terminalId || resumed?.id || "");
        if (!targetId) throw new Error(t(forking
          ? "terminal.agent.fork_terminal_failed"
          : "terminal.agent.resume_terminal_failed"));
        if (!activeIdentityMatches(sessionId, signature)) {
          clearOwnFocusIntent();
          return;
        }
        clearForeignEmbeddedOwner(sessionId);
        local.targetIds.set(sessionId, targetId);
        local.targetSignatures.set(sessionId, signature);
        local.autoFailures.delete(sessionId);
        return await sync({ force: true, resumeOwner: record });
      } catch (error) {
        if (!activeIdentityMatches(sessionId, signature)) {
          clearOwnFocusIntent();
          return;
        }
        clearOwnFocusIntent();
        const currentRoot = shell();
        if (currentRoot) {
          setEmpty(
            currentRoot,
            true,
            forking ? "drawer.terminal_fork_failed" : "drawer.terminal_resume_failed",
            forking ? "drawer.terminal_fork_failed_help" : "drawer.terminal_resume_failed_help",
            true,
            support.action,
          );
          setStatus(
            currentRoot,
            forking ? "drawer.terminal_fork_failed" : "drawer.terminal_resume_failed",
            window.WhiteboxI18n.errorText(error, forking ? "drawer.terminal_fork_failed" : "drawer.terminal_resume_failed"),
            "error",
          );
        }
        report(forking ? "inline-agent-terminal-fork" : "inline-agent-terminal-resume", error);
      } finally {
        if (local.pendingResume === record) local.pendingResume = null;
        releasePendingButtons(record);
      }
    })();
    record.promise = task;
    local.pendingResume = record;
    return task;
  }

  async function reconnect(button) {
    const instance = app();
    const session = selectedSession();
    const root = shell();
    const terminal = window.WhiteboxTerminal;
    const embedded = terminal?.embeddedState?.() || {};
    const terminalId = String(embedded.agentSessionId === session?.id
      ? embedded.terminalId
      : local.targetIds.get(session?.id) || '');
    if (!session || !root || !button || !isFocusEligibleSession(session)) return;
    const sessionId = String(session.id || "");
    const signature = connectionSignature(session, terminal);
    if (!terminalId || !terminal?.restartForAgent) {
      // No app-owned PTY exists to restart. Keep creation behind the explicit
      // resume action so refresh cannot start a competing provider writer.
      local.autoFailures.set(sessionId, signature);
      const support = terminal?.resumeSupport?.(session);
      const resumable = Boolean(support?.supported);
      setEmpty(
        root,
        true,
        resumable ? "drawer.terminal_resume_available" : "drawer.terminal_unavailable",
        resumable ? "drawer.terminal_resume_available_help" : "drawer.terminal_unavailable_help",
        resumable,
      );
      setStatus(root, resumable ? "drawer.terminal_resume_available" : "drawer.terminal_unavailable", support?.reason || "", "unavailable");
      return;
    }
    if (local.pendingReconnect?.sessionId === sessionId
      && local.pendingReconnect.terminalId === terminalId
      && local.pendingReconnect.signature === signature) {
      markPendingButton(local.pendingReconnect, button);
      setEmpty(root, true);
      setStatus(root, "drawer.terminal_connecting");
      return local.pendingReconnect.promise;
    }
    if (button.getAttribute("aria-busy") === "true") return;
    const record = { sessionId, terminalId, signature, buttons: new Set(), promise: null };
    markPendingButton(record, button);
    clearForeignEmbeddedOwner(sessionId);
    local.autoFailures.delete(sessionId);
    requestTerminalFocus(sessionId);
    setEmpty(root, true);
    setStatus(root, "drawer.terminal_connecting");
    const task = (async () => {
      try {
        const restarted = await terminal.restartForAgent(session, { terminalId });
        if (!restarted?.ok) throw new Error(t("agent.reconnect_failed"));
        if (!activeIdentityMatches(sessionId, signature, terminal)) return;
        local.targetIds.set(sessionId, terminalId);
        local.targetSignatures.set(sessionId, signature);
        terminal.unmountEmbedded?.();
        await sync({ force: true });
      } catch (error) {
        if (!activeIdentityMatches(sessionId, signature, terminal)) return;
        local.autoFailures.set(sessionId, signature);
        local.focusSessionId = "";
        local.focusOrigin = null;
        const currentRoot = shell();
        if (currentRoot) {
          setEmpty(currentRoot, true, "drawer.terminal_unavailable", "drawer.terminal_unavailable_help");
          setStatus(currentRoot, "drawer.terminal_unavailable", window.WhiteboxI18n.errorText(error, "drawer.terminal_unavailable"), "error");
        }
        report("inline-agent-terminal-reconnect", error);
      } finally {
        if (local.pendingReconnect === record) local.pendingReconnect = null;
        releasePendingButtons(record);
      }
    })();
    record.promise = task;
    local.pendingReconnect = record;
    return task;
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-inline-terminal-close]")) {
      event.stopPropagation();
      close();
      return;
    }
    if (event.target.closest("[data-inline-terminal-reconnect]")) {
      event.stopPropagation();
      reconnect(event.target.closest("[data-inline-terminal-reconnect]"));
      return;
    }
    if (event.target.closest("[data-inline-terminal-resume]")) {
      event.stopPropagation();
      resume();
    }
  });

  // A provider resume can take long enough for the user to move elsewhere.
  // Only the original expand/reconnect gesture may grant delayed xterm focus;
  // any later pointer, keyboard or external focus action cancels that intent.
  document.addEventListener("pointerdown", () => { local.userFocusRevision += 1; }, true);
  document.addEventListener("keydown", () => { local.userFocusRevision += 1; }, true);
  document.addEventListener("focusin", (event) => {
    if (event.target === document.body
      || event.target === document.documentElement
      || event.target?.isConnected === false
      || event.target === local.focusOrigin) return;
    if (!event.target?.closest?.("[data-inline-agent-terminal]")) local.userFocusRevision += 1;
  }, true);
  window.addEventListener("blur", () => {
    queueMicrotask(() => {
      // Chromium can emit a synthetic window blur while the focused xterm
      // helper textarea is detached, even though the app keeps document
      // focus. Only a real window departure cancels delayed PTY focus.
      const documentFocused = typeof document.hasFocus !== "function" || document.hasFocus();
      if (documentFocused) return;
      local.userFocusRevision += 1;
    });
  }, true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") local.userFocusRevision += 1;
  }, true);

  window.addEventListener("whitebox:terminal-reconnect-focus", (event) => {
    const terminalId = String(event.detail?.terminalId || "");
    const session = selectedSession();
    const root = shell();
    const embedded = window.WhiteboxTerminal?.embeddedState?.() || {};
    const viewport = terminalViewport(root);
    const host = mountedTerminalHost(viewport, terminalId);
    if (!terminalId
      || !session
      || !root
      || root.dataset.inlineAgentTerminal !== session.id
      || embedded.agentSessionId !== session.id
      || String(embedded.terminalId || "") !== terminalId
      || !host) return;
    requestTerminalFocus(session.id);
  });

  window.addEventListener("whitebox:terminal-reconnect-owner", (event) => {
    const terminalId = String(event.detail?.terminalId || "");
    const session = selectedSession();
    const root = shell();
    const embedded = window.WhiteboxTerminal?.embeddedState?.() || {};
    const viewport = terminalViewport(root);
    const host = mountedTerminalHost(viewport, terminalId);
    if (terminalId
      && event.detail?.mountId === "drawerTerminalViewport"
      && session
      && root?.dataset.inlineAgentTerminal === session.id
      && embedded.agentSessionId === session.id
      && String(embedded.terminalId || "") === terminalId) {
      const generation = ++local.embeddedOwnerGeneration;
      local.foreignEmbeddedOwner = {
        generation,
        mountId: "drawerTerminalViewport",
        sessionId: session.id,
        signature: connectionSignature(session),
        terminalId,
      };
      cancelInlineClaim(session.id);
      return;
    }
    if (!terminalId
      || !ownsViewportMount(viewport, event.detail?.mountId)
      || !session
      || root?.dataset.inlineAgentTerminal !== session.id
      || embedded.agentSessionId !== session.id
      || String(embedded.terminalId || "") !== terminalId
      || !host) return;
    clearForeignEmbeddedOwner(session.id);
    local.reconnectOwnerTerminalId = terminalId;
  });

  window.addEventListener("whitebox:terminal-command-delivery", (event) => {
    const root = shell();
    if (!root || event.detail?.sessionId !== root.dataset.inlineAgentTerminal) return;
    if (event.detail.deliveryState === "rejected") {
      setStatus(root, "drawer.terminal_delivery_failed", t("drawer.terminal_delivery_failed_help"), "error");
    } else if (event.detail.deliveryState === "unknown") {
      setStatus(root, "drawer.terminal_delivery_uncertain", event.detail.target?.label || "", "unavailable");
    }
  });

  window.whitebox?.onTerminalState?.((payload) => {
    if (payload?.change !== "reconnected") return;
    const session = selectedSession();
    const root = shell();
    if (!session || !root || root.dataset.inlineAgentTerminal !== session.id) return;
    const targetId = String(local.targetIds.get(session.id)
      || window.WhiteboxTerminal?.embeddedState?.().terminalId
      || "");
    const reconnectOwnerTerminalId = local.reconnectOwnerTerminalId;
    local.reconnectOwnerTerminalId = "";
    if (!targetId || !payload.sessions?.some(item => String(item?.id || "") === targetId)) return;
    if (reconnectOwnerTerminalId !== targetId) return;
    local.autoFailures.delete(session.id);
    setEmpty(root, true);
    setStatus(root, "drawer.terminal_connecting");
    setTimeout(() => sync({ force: true }), 0);
  });

  window.WhiteboxInlineTerminal = { toggle, close, enterFocus, closeFocus, sync };
})();
