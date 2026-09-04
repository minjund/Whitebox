"use strict";

window.WhiteboxAppFactories = window.WhiteboxAppFactories || {};

window.WhiteboxAppFactories.createPtyFocusMode = function createPtyFocusMode(context = {}) {
  const {
    $, esc, state, providerInfo, providerStyle, connectedGraphSessions,
    controlRoomAgentGoal, controlRoomSummary, inferredExecutionSummary,
    executionActivityStatus, subagentWorkLabel, latestWorkCopy,
    controlRoomStatus, sessionStatusLabel, timeAgo,
    rememberDialogTrigger = () => {}, restoreDialogTrigger = () => false,
    discardDialogTrigger = () => false,
    loadSessionDetail = async () => null,
    messageContentHtml = message => `<div class="chat-content plain">${esc(message?.text || "")}</div>`,
    toast = () => {}, announce = () => {}, reportRecoverableError = () => {},
  } = context;
  const t = (key, params) => window.WhiteboxI18n.t(key, params);

  let returnState = null;
  let focusIdentity = null;
  let pendingFocus = null;
  let focusSyncPromise = Promise.resolve({ ok: false, reason: "not-open" });
  let focusOpenGeneration = 0;
  let eventsBound = false;
  let activeFocusMode = "";
  let lastFlowHtml = "";
  let lastTranscriptHtml = "";
  const requestedTranscriptVersions = new Map();

  const snapshotSessions = () => {
    const sessions = new Map();
    for (const session of state.rawSnapshot?.sessions || []) sessions.set(String(session.id || ""), session);
    for (const session of state.snapshot?.sessions || []) sessions.set(String(session.id || ""), session);
    return [...sessions.values()];
  };
  const snapshotSession = id => snapshotSessions()
    .find(session => String(session.id || "") === String(id || "")) || null;
  const focusSurface = () => $("#ptyFocusSurface");
  const focusShell = () => $("#ptyFocusTerminalShell");

  function runtimeTerminalIdentity(session) {
    const provisional = window.WhiteboxRendererUtils?.appOwnedBridgeTerminalIdentity?.(session);
    if (provisional) return { ...provisional };
    const provider = String(session?.provider || "").trim().toLowerCase();
    const identities = (Array.isArray(session?.runtimePresence) ? session.runtimePresence : [])
      .filter(item => String(item?.kind || "").trim().toLowerCase() === "bridge")
      .map(item => ({
        terminalId: String(item?.terminalId || "").trim(),
        creationId: String(item?.creationId || "").trim(),
        provider: String(item?.provider || provider).trim().toLowerCase(),
      }))
      .filter(item => item.terminalId && item.provider === provider);
    const unique = [...new Map(identities.map(item => [`${item.terminalId}\u0000${item.creationId}`, item])).values()];
    return unique.length === 1 ? unique[0] : null;
  }

  function sessionForTerminal(terminalId, creationId = "") {
    const id = String(terminalId || "").trim();
    const creation = String(creationId || "").trim();
    if (!id) return null;
    const candidates = snapshotSessions().filter(session => {
      if (session.parentId) return false;
      const identity = runtimeTerminalIdentity(session);
      return identity?.terminalId === id && (!creation || identity.creationId === creation);
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  function ownerRootSession(value) {
    let session = typeof value === "object" && value ? value : snapshotSession(value);
    const visited = new Set();
    while (session?.parentId && !visited.has(session.id)) {
      visited.add(session.id);
      session = snapshotSession(session.parentId);
    }
    return session || null;
  }

  function canOpenPtyFocus(session) {
    if (!session || session.parentId || session.sourcePluginId) return false;
    if (window.WhiteboxRendererUtils?.appOwnedBridgeTerminalIdentity?.(session)) return true;
    if (String(session.status || "").toLowerCase() === "completed"
      && window.WhiteboxRendererUtils.canForkCodexDesktopSession?.(session) === true) return true;
    if (String(session.provider || "").toLowerCase() === "codex"
      && String(session.clientKind || "").toLowerCase() === "codex-desktop") {
      try {
        return Boolean(window.WhiteboxTerminal?.forkTargetForAgent?.(session));
      } catch (error) {
        reportRecoverableError("pty-focus-fork-target", error);
        return false;
      }
    }
    return window.WhiteboxRendererUtils.isWritableDirectSession?.(session) === true
      && session.controlCapabilities?.pty === true
      && session.presentation?.conversationSurface !== "transcript";
  }

  function canOpenResponsibleFocus(session) {
    return window.WhiteboxRendererUtils.canOpenResponsibleFocus?.(session) === true;
  }

  function isPtyFocusActive() {
    const surface = focusSurface();
    return Boolean(state.ptyFocusSessionId && surface && !surface.classList.contains("hidden"));
  }

  function descendants(root, model) {
    const found = [];
    const queue = [...(root.childIds || [])];
    const visited = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const child = model.byId.get(id);
      if (!child) continue;
      found.push(child);
      queue.push(...(child.childIds || []));
    }
    return found.sort((left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0));
  }

  const isOngoingSubagent = session => Boolean(session
    && ["starting", "running", "paused", "waiting"].includes(session.status));
  const unitTime = unit => unit.kind === "child"
    ? unit.child.updatedAt || unit.child.completedAt || ""
    : unit.activity.updatedAt || unit.activity.startedAt || "";
  const sortUnits = units => units.sort((left, right) => Date.parse(unitTime(right) || 0) - Date.parse(unitTime(left) || 0));

  function rootNodeHtml(root, writablePty) {
    const provider = providerInfo(root.provider);
    const goal = controlRoomAgentGoal(root, 54);
    const current = controlRoomSummary(latestWorkCopy(root) || root.statusDetail || root.title, 64);
    return `<div class="pty-focus-node pty-focus-root-node" style="${providerStyle(root.provider)}">
      <span class="pty-focus-node-mark">${esc(provider.mark)}</span>
      <span class="pty-focus-node-copy"><small>${esc(t(writablePty ? "pty_focus.responsible_node" : "pty_focus.responsible_node_readonly"))}</small><b title="${esc(goal.full)}">${esc(goal.text)}</b><em title="${esc(current.full)}">${esc(current.text)}</em></span>
      <span class="pty-focus-node-state">${writablePty ? "PTY" : esc(t("pty_focus.readonly_short"))}</span>
    </div>`;
  }

  function childNodeHtml(child) {
    const provider = providerInfo(child.provider);
    const title = controlRoomAgentGoal(child, 48);
    const current = controlRoomSummary(latestWorkCopy(child) || child.statusDetail || child.title, 58);
    const ongoing = isOngoingSubagent(child);
    const waiting = child.status === "waiting" || child.status === "paused";
    return `<button type="button" class="pty-focus-node ${ongoing ? "is-running" : "is-complete"} ${waiting ? "is-waiting" : ""}"
      data-pty-focus-child="${esc(child.id)}" style="${providerStyle(child.provider)}"
      aria-haspopup="dialog" aria-controls="detailDrawer"
      aria-label="${esc(t("pty_focus.open_child", { title: title.text }))}">
      <span class="pty-focus-node-mark">${esc(provider.mark)}</span>
      <span class="pty-focus-node-copy"><small>${esc(t("pty_focus.readonly_node"))}</small><b title="${esc(title.full)}">${esc(title.text)}</b><em title="${esc(current.full)}">${esc(current.text)}</em></span>
      <span class="pty-focus-node-state">${esc(subagentWorkLabel(child))}</span>
    </button>`;
  }

  function executionNodeHtml(owner, activity) {
    const purpose = inferredExecutionSummary(activity);
    const command = controlRoomSummary(activity.command || activity.description || activity.label || purpose.full, 58);
    const running = activity.status === "running";
    return `<button type="button" class="pty-focus-node ${running ? "is-running" : "is-complete"}"
      data-pty-focus-execution-owner="${esc(owner.id)}" data-pty-focus-execution="${esc(activity.id)}"
      style="${providerStyle(owner.provider)}" aria-haspopup="dialog" aria-controls="detailDrawer"
      aria-label="${esc(t("pty_focus.open_execution", { title: purpose.text }))}">
      <span class="pty-focus-node-mark">${activity.kind === "shell" ? "›_" : "◌"}</span>
      <span class="pty-focus-node-copy"><small>${esc(t("pty_focus.readonly_execution"))}</small><b title="${esc(purpose.full)}">${esc(purpose.text)}</b><em title="${esc(command.full)}">${esc(command.text)}</em></span>
      <span class="pty-focus-node-state">${esc(executionActivityStatus(activity))}</span>
    </button>`;
  }

  function laneHtml(label, units, emptyKey) {
    const rows = units.map(unit => unit.kind === "child"
      ? childNodeHtml(unit.child)
      : executionNodeHtml(unit.owner, unit.activity)).join("");
    return `<section class="pty-focus-flow-lane"><header><b>${esc(label)}</b><span>${units.length}</span></header>
      <div class="pty-focus-flow-list">${rows || `<div class="pty-focus-flow-empty">${esc(t(emptyKey))}</div>`}</div>
    </section>`;
  }

  function flowHtml(root, writablePty) {
    const model = connectedGraphSessions(snapshotSessions(), root.id);
    const childSessions = descendants(root, model);
    const actors = [root, ...childSessions];
    const childUnits = childSessions.map(child => ({ kind: "child", child }));
    const executionUnits = actors.flatMap(owner => (owner.executions || []).map(activity => ({ kind: "execution", owner, activity })));
    const active = sortUnits([
      ...childUnits.filter(unit => isOngoingSubagent(unit.child)),
      ...executionUnits.filter(unit => unit.activity.status === "running"),
    ]);
    const completed = sortUnits([
      ...childUnits.filter(unit => !isOngoingSubagent(unit.child)),
      ...executionUnits.filter(unit => unit.activity.status !== "running"),
    ]);
    return `<section class="pty-focus-flow-lane"><header><b>${esc(t("pty_focus.responsible"))}</b><span>1</span></header><div class="pty-focus-flow-list">${rootNodeHtml(root, writablePty)}</div></section>
      <span class="pty-focus-flow-arrow" aria-hidden="true">→</span>
      ${laneHtml(t("pty_focus.in_progress"), active, "pty_focus.no_running")}
      <span class="pty-focus-flow-arrow" aria-hidden="true">→</span>
      ${laneHtml(t("pty_focus.completed"), completed, "pty_focus.no_completed")}`;
  }

  function transcriptHtml(session) {
    const allMessages = (session?.messages || [])
      .filter(message => message && (message.role === "user" || message.role === "assistant"));
    const messages = allMessages.slice(-120);
    const note = `<p class="pty-focus-transcript-note">${esc(t("pty_focus.readonly_help"))}</p>`;
    const omitted = allMessages.length > messages.length
      ? `<p class="pty-focus-transcript-omitted">${esc(t("drawer.messages_omitted", { count: allMessages.length - messages.length }))}</p>`
      : "";
    if (!messages.length) return `${note}${omitted}<div class="pty-focus-transcript-empty">${esc(t("pty_focus.no_transcript"))}</div>`;
    const provider = providerInfo(session.provider);
    const rows = messages.map(message => {
      const assistant = message.role === "assistant";
      const label = assistant ? provider.label : t("drawer.user");
      const avatar = assistant ? provider.mark : t("drawer.me_mark");
      const timestamp = message.timestamp ? timeAgo(message.timestamp) : "";
      return `<article class="pty-focus-transcript-message ${assistant ? "assistant" : "user"}" data-message-id="${esc(message.id || "")}">
        <span class="pty-focus-transcript-avatar" aria-hidden="true">${esc(avatar)}</span>
        <div class="pty-focus-transcript-bubble"><header><b>${esc(label)}</b>${timestamp ? `<time title="${esc(message.timestamp)}">${esc(timestamp)}</time>` : ""}</header>${messageContentHtml(message, session.id)}</div>
      </article>`;
    }).join("");
    return `${note}${omitted}<div class="pty-focus-transcript-list">${rows}</div>`;
  }

  function mergedTranscriptMessages(detail, live) {
    const merged = [];
    const indexes = new Map();
    const keyFor = (message, index, source) => {
      const id = String(message?.id || "").trim();
      if (id) return `id:${id}`;
      const timestamp = String(message?.timestamp || "").trim();
      const role = String(message?.role || "").trim();
      const text = String(message?.text || "");
      return timestamp || text ? `content:${role}\u0000${timestamp}\u0000${text}` : `${source}:${index}`;
    };
    const add = (message, index, source) => {
      if (!message) return;
      const key = keyFor(message, index, source);
      if (indexes.has(key)) {
        const existing = indexes.get(key);
        const previous = merged[existing];
        const previousText = String(previous?.text || "");
        const liveText = String(message?.text || "");
        merged[existing] = {
          ...previous,
          ...message,
          text: previousText.length > liveText.length ? previousText : liveText,
        };
        return;
      }
      indexes.set(key, merged.length);
      merged.push(message);
    };
    (detail || []).forEach((message, index) => add(message, index, "detail"));
    (live || []).forEach((message, index) => add(message, index, "live"));
    return merged;
  }

  function refreshTranscriptDetail(root) {
    if (!root?.id || activeFocusMode !== "transcript") return Promise.resolve(null);
    const id = String(root.id);
    const snapshotVersion = String(root.updatedAt || "").trim();
    const detail = state.details?.get?.(id);
    if (detail && snapshotVersion && String(detail.updatedAt || "").trim() === snapshotVersion) {
      requestedTranscriptVersions.delete(id);
      return Promise.resolve(detail);
    }
    const requestVersion = snapshotVersion || "__unversioned__";
    if (requestedTranscriptVersions.get(id) === requestVersion) return Promise.resolve(detail || null);
    requestedTranscriptVersions.set(id, requestVersion);
    return Promise.resolve(loadSessionDetail(id, true, snapshotVersion))
      .then(result => {
        if (!result && requestedTranscriptVersions.get(id) === requestVersion) {
          requestedTranscriptVersions.delete(id);
        }
        return result;
      })
      .catch(error => {
        if (requestedTranscriptVersions.get(id) === requestVersion) requestedTranscriptVersions.delete(id);
        reportRecoverableError("responsible-focus-detail", error);
        return null;
      });
  }

  function setBackgroundInactive(inactive) {
    const surface = focusSurface();
    const appChildren = [...($("#appShell")?.children || [])].filter(node => node !== surface);
    const overlays = [...document.querySelectorAll("body > .modal-backdrop")];
    const targets = [...new Set([...appChildren, ...overlays].filter(Boolean))];
    if (inactive) {
      if (returnState) returnState.background = targets.map(node => ({ node, inert: node.hasAttribute("inert"), ariaHidden: node.getAttribute("aria-hidden") }));
      targets.forEach(node => {
        node.setAttribute("inert", "");
        node.setAttribute("aria-hidden", "true");
      });
      return;
    }
    (returnState?.background || []).forEach(({ node, inert, ariaHidden }) => {
      if (inert) node.setAttribute("inert", "");
      else node.removeAttribute("inert");
      if (ariaHidden == null) node.removeAttribute("aria-hidden");
      else node.setAttribute("aria-hidden", ariaHidden);
      if (node.classList.contains("modal-backdrop") && node.classList.contains("hidden")) {
        node.setAttribute("inert", "");
        node.setAttribute("aria-hidden", "true");
      }
    });
  }

  function captureReturnState(trigger) {
    const main = $("#mainContent");
    const sidebar = document.querySelector(".sidebar");
    return {
      trigger: trigger instanceof HTMLElement ? trigger : null,
      main, sidebar,
      mainTop: main?.scrollTop || 0, mainLeft: main?.scrollLeft || 0,
      sidebarTop: sidebar?.scrollTop || 0, sidebarLeft: sidebar?.scrollLeft || 0,
      inlineSessionId: state.inlineTerminalSessionId,
      background: [],
    };
  }

  function restoreControlRoomPosition(saved) {
    if (!saved) return;
    const restore = () => {
      if (saved.main?.isConnected) saved.main.scrollTo({ top: saved.mainTop, left: saved.mainLeft, behavior: "auto" });
      if (saved.sidebar?.isConnected) saved.sidebar.scrollTo({ top: saved.sidebarTop, left: saved.sidebarLeft, behavior: "auto" });
    };
    restore();
    requestAnimationFrame(() => requestAnimationFrame(restore));
  }

  function migrateFocusedSession(next) {
    const previousId = String(state.ptyFocusSessionId || "");
    if (!next || next.id === previousId) return next;
    const controller = window.WhiteboxInlineTerminal;
    const preserveTerminalFocus = Boolean(focusShell()?.contains(document.activeElement));
    controller?.closeFocus?.({ unmount: true });
    state.ptyFocusSessionId = null;
    if (controller?.enterFocus?.(next.id, { focus: preserveTerminalFocus }) === false) return null;
    focusShell().dataset.inlineAgentTerminal = next.id;
    document.querySelectorAll(`[data-pty-focus-trigger="${CSS.escape(previousId)}"]`).forEach(trigger => trigger.setAttribute("aria-expanded", "false"));
    focusIdentity = runtimeTerminalIdentity(next) || focusIdentity;
    requestAnimationFrame(() => Promise.resolve(controller?.sync?.({ force: true }))
      .then(result => {
        if (preserveTerminalFocus && result?.ok === true) window.WhiteboxTerminal?.focusEmbedded?.();
      })
      .catch(error => reportRecoverableError("pty-focus-session-migration", error)));
    return next;
  }

  function focusedRoot() {
    const current = snapshotSession(state.ptyFocusSessionId);
    if (activeFocusMode === "transcript") {
      return canOpenResponsibleFocus(current) ? current : null;
    }
    if (canOpenPtyFocus(current)) return current;
    if (!focusIdentity) return null;
    const replacement = sessionForTerminal(focusIdentity.terminalId, focusIdentity.creationId);
    return canOpenPtyFocus(replacement) ? migrateFocusedSession(replacement) : null;
  }

  function renderPtyFocus() {
    if (!state.ptyFocusSessionId || !isPtyFocusActive()) return;
    const root = focusedRoot();
    if (!root) {
      closePtyFocus({ restore: true, reason: "missing", suppressManualSelection: true });
      toast(t("pty_focus.session_unavailable"));
      return;
    }
    const surface = focusSurface();
    const provider = providerInfo(root.provider);
    const goal = controlRoomAgentGoal(root, 90);
    const current = controlRoomSummary(latestWorkCopy(root) || root.statusDetail || root.title, 120);
    const presentedStatus = controlRoomStatus(root);
    const writablePty = activeFocusMode !== "transcript";
    surface.setAttribute("style", providerStyle(root.provider));
    surface.dataset.ptyFocusSession = root.id;
    surface.dataset.ptyFocusMode = writablePty ? "pty" : "transcript";
    $("#ptyFocusProviderMark").textContent = provider.mark;
    $("#ptyFocusTerminalMark").textContent = provider.mark;
    $("#ptyFocusEyebrow").textContent = t(writablePty ? "pty_focus.eyebrow" : "pty_focus.readonly_eyebrow");
    $("#ptyFocusTitle").textContent = writablePty
      ? `${provider.label} · ${goal.text}`
      : `${provider.label} · ${t("pty_focus.readonly_title")}`;
    $("#ptyFocusSummary").textContent = current.text;
    $("#ptyFocusTerminalTitle").textContent = writablePty
      ? `${provider.label} · PTY`
      : `${provider.label} · ${t("pty_focus.readonly_title")}`;
    $("#ptyFocusTerminalHelp").textContent = t(writablePty ? "pty_focus.terminal_help" : "pty_focus.readonly_help");
    const rootStatus = $("#ptyFocusRootStatus");
    rootStatus.className = `pty-focus-root-status ${["running", "starting"].includes(presentedStatus) ? "is-live" : presentedStatus === "waiting" ? "is-waiting" : "is-complete"}`;
    rootStatus.querySelector("b").textContent = sessionStatusLabel(root, presentedStatus);
    rootStatus.querySelector("small").textContent = timeAgo(root.updatedAt);
    const shell = focusShell();
    shell.dataset.focusContent = writablePty ? "pty" : "transcript";
    shell.dataset.inlineAgentTerminal = writablePty ? root.id : "";
    shell.setAttribute("style", providerStyle(root.provider));
    shell.setAttribute("aria-label", writablePty
      ? t("pty_focus.terminal_for", { provider: provider.label })
      : t("pty_focus.transcript_viewport"));
    const terminalViewport = $("#ptyFocusTerminalViewport");
    const transcript = $("#ptyFocusTranscriptContent");
    terminalViewport?.classList.toggle("hidden", !writablePty);
    transcript?.classList.toggle("hidden", writablePty);
    if (!writablePty && transcript) {
      const detail = state.details?.get?.(root.id);
      const transcriptSession = detail
        ? {
            ...detail,
            ...root,
            messages: mergedTranscriptMessages(detail.messages, root.messages),
          }
        : root;
      const nextTranscriptHtml = transcriptHtml(transcriptSession);
      if (nextTranscriptHtml !== lastTranscriptHtml || !transcript.hasChildNodes()) {
        const pinnedToEnd = window.WhiteboxRendererUtils.isScrolledToEnd?.(transcript, 12) !== false;
        const previousTop = transcript.scrollTop;
        transcript.innerHTML = nextTranscriptHtml;
        lastTranscriptHtml = nextTranscriptHtml;
        transcript.scrollTop = pinnedToEnd ? transcript.scrollHeight : previousTop;
      }
    }
    const flow = $("#ptyFocusFlow");
    const html = flowHtml(root, writablePty);
    if (html !== lastFlowHtml || !flow.hasChildNodes()) {
      flow.innerHTML = html;
      lastFlowHtml = html;
    }
  }

  function queueFocusSync(controller, sessionId, options = {}) {
    const expectedSessionId = String(sessionId || "");
    const targetId = String(options.targetId || "").trim();
    focusSyncPromise = new Promise(resolve => requestAnimationFrame(() => {
      if (String(state.ptyFocusSessionId || "") !== expectedSessionId) {
        resolve({ ok: false, reason: "cancelled" });
        return;
      }
      Promise.resolve(controller.sync({
        force: true,
        targetId,
        requireTargetId: options.requireTargetId === true,
      })).then(resolve, error => {
        reportRecoverableError("pty-focus-terminal-sync", error);
        resolve({ ok: false, reason: "error", error });
      });
    }));
    return focusSyncPromise;
  }

  function openPtyFocus(sessionId, options = {}) {
    // A direct user/attention choice supersedes any earlier create request
    // that is still waiting for its bridge projection. Otherwise a later
    // snapshot could steal focus back to the stale pending terminal.
    pendingFocus = null;
    const root = ownerRootSession(sessionId);
    if (!canOpenPtyFocus(root)) {
      toast(t(canOpenResponsibleFocus(root) ? "pty_focus.terminal_unavailable" : "pty_focus.root_only"));
      return false;
    }
    if (options.attentionActivation !== true
      && options.manualSelectionSignaled !== true
      && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("whitebox:terminal-manual-selection"));
    }
    const id = String(root.id || "");
    if (state.ptyFocusSessionId === id && isPtyFocusActive() && activeFocusMode === "pty") {
      if (options.attentionActivation !== true) focusOpenGeneration += 1;
      if (options.targetId) {
        if (String(state.ptyFocusTargetId || "") !== String(options.targetId || "")) focusOpenGeneration += 1;
        state.ptyFocusTargetId = String(options.targetId || "").trim();
        queueFocusSync(window.WhiteboxInlineTerminal, id, {
          targetId: options.targetId,
          requireTargetId: options.requireTargetId,
        });
      }
      window.WhiteboxTerminal?.focusEmbedded?.();
      return true;
    }
    if (state.ptyFocusSessionId) closePtyFocus({ restore: false, clearPending: false, suppressManualSelection: true });
    const controller = window.WhiteboxInlineTerminal;
    if (!controller?.enterFocus || !controller?.sync) {
      toast(t("pty_focus.terminal_unavailable"));
      return false;
    }
    if ($("#detailDrawer")?.classList.contains("open")) context.closeDrawer?.(false);
    returnState = captureReturnState(options.trigger);
    lastFlowHtml = "";
    lastTranscriptHtml = "";
    rememberDialogTrigger("ptyFocusSurface", { refresh: true });
    activeFocusMode = "pty";
    if (controller.enterFocus(id, { focus: options.focus !== false }) === false) {
      discardDialogTrigger("ptyFocusSurface");
      returnState = null;
      activeFocusMode = "";
      toast(t("pty_focus.terminal_unavailable"));
      return false;
    }
    focusIdentity = options.identity || runtimeTerminalIdentity(root);
    focusOpenGeneration += 1;
    state.ptyFocusTargetId = String(options.targetId || focusIdentity?.terminalId || "").trim();
    const surface = focusSurface();
    surface.dataset.ptyFocusMode = "pty";
    surface.classList.remove("hidden");
    surface.removeAttribute("inert");
    surface.setAttribute("aria-hidden", "false");
    if (options.trigger instanceof HTMLElement) options.trigger.setAttribute("aria-expanded", "true");
    document.body.classList.add("pty-focus-open");
    setBackgroundInactive(true);
    renderPtyFocus();
    queueFocusSync(controller, id, {
      targetId: options.targetId,
      requireTargetId: options.requireTargetId,
    });
    announce(t("pty_focus.opened", { title: root.title || providerInfo(root.provider).label }));
    return true;
  }

  function openResponsibleFocus(sessionId, options = {}) {
    pendingFocus = null;
    const root = ownerRootSession(sessionId);
    if (!canOpenResponsibleFocus(root)) {
      toast(t("pty_focus.root_only"));
      return false;
    }
    if (options.attentionActivation !== true
      && options.manualSelectionSignaled !== true
      && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("whitebox:terminal-manual-selection"));
    }
    const id = String(root.id || "");
    if (state.ptyFocusSessionId === id && isPtyFocusActive() && activeFocusMode === "transcript") {
      if (options.attentionActivation !== true) focusOpenGeneration += 1;
      if (options.focus !== false) $("#ptyFocusBackBtn")?.focus({ preventScroll: true });
      return true;
    }
    if (state.ptyFocusSessionId) {
      closePtyFocus({ restore: false, clearPending: false, suppressManualSelection: true });
    }
    if ($("#detailDrawer")?.classList.contains("open")) context.closeDrawer?.(false);
    returnState = captureReturnState(options.trigger);
    lastFlowHtml = "";
    lastTranscriptHtml = "";
    rememberDialogTrigger("ptyFocusSurface", { refresh: true });
    activeFocusMode = "transcript";
    focusIdentity = null;
    focusOpenGeneration += 1;
    focusSyncPromise = Promise.resolve({ ok: false, reason: "read-only-focus" });
    state.ptyFocusSessionId = id;
    state.ptyFocusTargetId = "";
    const surface = focusSurface();
    surface.dataset.ptyFocusMode = "transcript";
    surface.classList.remove("hidden");
    surface.removeAttribute("inert");
    surface.setAttribute("aria-hidden", "false");
    if (options.trigger instanceof HTMLElement) options.trigger.setAttribute("aria-expanded", "true");
    document.body.classList.add("pty-focus-open");
    setBackgroundInactive(true);
    renderPtyFocus();
    if (options.focus !== false) {
      requestAnimationFrame(() => {
        if (state.ptyFocusSessionId === id && activeFocusMode === "transcript") {
          $("#ptyFocusBackBtn")?.focus({ preventScroll: true });
        }
      });
    }
    refreshTranscriptDetail(root).then(() => {
      if (state.ptyFocusSessionId === id && activeFocusMode === "transcript") renderPtyFocus();
    });
    announce(t("pty_focus.opened_readonly", { title: root.title || providerInfo(root.provider).label }));
    return true;
  }

  async function openPtyFocusVerified(sessionId, options = {}) {
    const root = ownerRootSession(sessionId);
    const terminal = window.WhiteboxTerminal;
    const expectedTerminalId = String(options.terminalId || options.targetId || "").trim();
    const expectedTargetId = String(options.targetId || expectedTerminalId).trim();
    if (!canOpenPtyFocus(root) || !terminal?.agentTargets || !terminal?.embeddedState) {
      return { opened: false, retryable: true, reason: "not-ready" };
    }
    if (expectedTerminalId && expectedTargetId && expectedTerminalId !== expectedTargetId) {
      return { opened: false, retryable: true, reason: "identity-mismatch" };
    }
    if (options.isCurrent && !options.isCurrent()) {
      return { opened: false, retryable: true, reason: "cancelled" };
    }
    let targets;
    try {
      // A Codex Desktop root owns its transcript writer, so agentTargets()
      // intentionally never exposes that conversation as a writable target.
      // Its user-created `codex fork` PTY is held under a separate, signed
      // source association and must be verified through that exact path.
      const forkTarget = terminal.forkTargetForAgent?.(root) || null;
      targets = (forkTarget ? [forkTarget] : terminal.agentTargets(root))
        .filter(target => target?.kind === "terminal");
    } catch (error) {
      reportRecoverableError("pty-focus-targets", error);
      return { opened: false, retryable: true, reason: "target-error" };
    }
    const requested = expectedTargetId
      ? targets.find(target => String(target.terminalId || target.id || "") === expectedTargetId)
      : (targets.length === 1 ? targets[0] : null);
    if (!requested) {
      return {
        opened: false,
        retryable: true,
        reason: expectedTargetId ? "target-expired" : "ambiguous-target",
      };
    }
    const targetId = String(requested.terminalId || requested.id || "");
    const alreadyFocusedExact = isPtyFocusActive()
      && String(state.ptyFocusSessionId || "") === String(root.id || "")
      && String(state.ptyFocusTargetId || "") === targetId;
    let operationFocusGeneration = 0;
    const closeOperationFocus = () => {
      if (!alreadyFocusedExact
        && focusOpenGeneration === operationFocusGeneration
        && String(state.ptyFocusSessionId || "") === String(root.id || "")
        && String(state.ptyFocusTargetId || "") === targetId) {
        closePtyFocus({ restore: false, suppressManualSelection: true });
      }
    };
    if (!openPtyFocus(root.id, {
      focus: options.focus !== false,
      targetId,
      requireTargetId: true,
      attentionActivation: options.attentionActivation === true,
      manualSelectionSignaled: options.manualSelectionSignaled === true,
      trigger: options.trigger || null,
    })) return { opened: false, retryable: true, reason: "open-rejected" };
    operationFocusGeneration = focusOpenGeneration;
    const syncResult = await focusSyncPromise;
    if (options.isCurrent && !options.isCurrent()) {
      closeOperationFocus();
      return { opened: false, retryable: true, reason: "cancelled" };
    }
    const mounted = terminal.embeddedState();
    const mountedTargetId = String(syncResult?.target?.terminalId || syncResult?.target?.id || "");
    const activeRoot = focusedRoot();
    const verified = syncResult?.ok === true
      && mounted.connected === true
      && String(mounted.agentSessionId || "") === String(activeRoot?.id || "")
      && String(mounted.terminalId || "") === targetId
      && mountedTargetId === targetId;
    if (verified) return { opened: true, retryable: false, target: syncResult.target };
    closeOperationFocus();
    return { opened: false, retryable: true, reason: syncResult?.reason || "mount-unverified" };
  }

  function tryPendingPtyFocus() {
    if (!pendingFocus) return false;
    if (Date.now() > pendingFocus.expiresAt) {
      pendingFocus = null;
      toast(t("pty_focus.session_unavailable"));
      return false;
    }
    const session = sessionForTerminal(pendingFocus.terminalId, pendingFocus.creationId);
    if (!canOpenPtyFocus(session)) return false;
    const request = pendingFocus;
    pendingFocus = null;
    return openPtyFocus(session.id, {
      ...request.options,
      targetId: request.terminalId,
      requireTargetId: true,
      identity: { terminalId: request.terminalId, creationId: request.creationId, provider: String(session.provider || "").toLowerCase() },
    });
  }

  function openPtyFocusForTerminal(terminalId, options = {}) {
    const id = String(terminalId || "").trim();
    if (!id) return false;
    if (options.attentionActivation !== true && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("whitebox:terminal-manual-selection"));
    }
    pendingFocus = {
      terminalId: id,
      creationId: String(options.creationId || "").trim(),
      expiresAt: Date.now() + Math.max(5_000, Number(options.timeoutMs || 30_000)),
      options: {
        focus: options.focus !== false,
        trigger: options.trigger || null,
        attentionActivation: options.attentionActivation === true,
        manualSelectionSignaled: options.attentionActivation !== true,
      },
    };
    return tryPendingPtyFocus();
  }

  function syncPendingPtyFocus() {
    if (isPtyFocusActive()) {
      const root = focusedRoot();
      if (root) {
        renderPtyFocus();
        if (activeFocusMode === "transcript") refreshTranscriptDetail(root);
      }
    }
    return tryPendingPtyFocus();
  }

  function closePtyFocus(options = {}) {
    if (!state.ptyFocusSessionId && !isPtyFocusActive()) return false;
    if (options.suppressManualSelection !== true && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("whitebox:terminal-manual-selection"));
    }
    focusOpenGeneration += 1;
    const activeSessionId = String(state.ptyFocusSessionId || "");
    const saved = returnState;
    if (activeFocusMode === "pty") {
      window.WhiteboxInlineTerminal?.closeFocus?.({ unmount: options.unmount !== false });
    }
    state.ptyFocusSessionId = null;
    state.ptyFocusTargetId = "";
    const surface = focusSurface();
    surface.classList.add("hidden");
    surface.setAttribute("inert", "");
    surface.setAttribute("aria-hidden", "true");
    delete surface.dataset.ptyFocusSession;
    delete surface.dataset.ptyFocusMode;
    activeFocusMode = "";
    lastFlowHtml = "";
    lastTranscriptHtml = "";
    requestedTranscriptVersions.delete(activeSessionId);
    focusShell().dataset.inlineAgentTerminal = "";
    focusShell().dataset.focusContent = "";
    $("#ptyFocusTerminalViewport")?.classList.remove("hidden");
    $("#ptyFocusTranscriptContent")?.classList.add("hidden");
    if (saved?.trigger?.isConnected) saved.trigger.setAttribute("aria-expanded", "false");
    if (activeSessionId) document.querySelectorAll(`[data-pty-focus-trigger="${CSS.escape(activeSessionId)}"]`).forEach(trigger => trigger.setAttribute("aria-expanded", "false"));
    setBackgroundInactive(false);
    document.body.classList.remove("pty-focus-open");
    if (options.restore !== false) restoreControlRoomPosition(saved);
    if (options.restore === false) discardDialogTrigger("ptyFocusSurface");
    else if (!restoreDialogTrigger("ptyFocusSurface") && saved?.trigger?.isConnected) saved.trigger.focus({ preventScroll: true });
    returnState = null;
    focusIdentity = null;
    if (options.clearPending !== false) pendingFocus = null;
    if (saved?.inlineSessionId && state.inlineTerminalSessionId === saved.inlineSessionId) requestAnimationFrame(() => window.WhiteboxInlineTerminal?.sync?.({ force: true }));
    if (options.reason !== "missing") announce(t("pty_focus.closed"));
    return true;
  }

  function bindPtyFocusEvents() {
    if (eventsBound) return;
    eventsBound = true;
    $("#ptyFocusBackBtn")?.addEventListener("click", () => closePtyFocus());
    focusSurface()?.addEventListener("click", event => {
      const child = event.target.closest("[data-pty-focus-child]");
      if (child) {
        event.stopPropagation();
        context.openSubagentConversation?.(child.dataset.ptyFocusChild, { presentation: "modal" });
        return;
      }
      const execution = event.target.closest("[data-pty-focus-execution]");
      if (execution) {
        event.stopPropagation();
        context.openExecutionActivity?.(
          execution.dataset.ptyFocusExecutionOwner,
          execution.dataset.ptyFocusExecution,
          { presentation: "modal" },
        );
      }
    });
    window.addEventListener("whitebox:terminal-manual-selection", () => {
      pendingFocus = null;
    });
  }

  return {
    canOpenPtyFocus,
    canOpenResponsibleFocus,
    isPtyFocusActive,
    ownerRootSession,
    openResponsibleFocus,
    openPtyFocus,
    openPtyFocusVerified,
    openPtyFocusForTerminal,
    syncPendingPtyFocus,
    closePtyFocus,
    renderPtyFocus,
    renderPtyFocusDetail: renderPtyFocus,
    bindPtyFocusEvents,
  };
};
