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
    toast = () => {}, announce = () => {},
    openSubagentConversation = () => {}, openExecutionActivity = () => {},
    closeDrawer = () => {}, renderDrawer = () => {},
    loadSessionDetail = async () => null,
    messageContentHtml = message => `<div class="chat-content plain">${esc(message?.text || "")}</div>`,
    reportRecoverableError = () => {},
  } = context;
  const t = (key, params) => window.WhiteboxI18n.t(key, params);

  let returnState = null;
  let eventsBound = false;
  let activeFocusMode = "";
  let lastFlowHtml = "";
  let lastTranscriptHtml = "";
  let flowRenderRevision = 0;

  const snapshotSessions = () => {
    const sessions = new Map();
    for (const session of state.rawSnapshot?.sessions || []) sessions.set(String(session.id || ""), session);
    for (const session of state.snapshot?.sessions || []) sessions.set(String(session.id || ""), session);
    return [...sessions.values()];
  };
  const snapshotSession = id => snapshotSessions().find(session => String(session.id || "") === String(id || "")) || null;
  const focusSurface = () => $("#ptyFocusSurface");
  const focusShell = () => $("#ptyFocusTerminalShell");

  function focusedControlDescriptor(container, attributes) {
    const active = document.activeElement;
    if (!container || !active || !container.contains(active)) return null;
    for (const attribute of attributes) {
      const owner = active.closest?.(`[${attribute}]`);
      if (!owner || !container.contains(owner)) continue;
      const value = owner.getAttribute(attribute) || "";
      const matches = [...container.querySelectorAll(`[${attribute}]`)]
        .filter(node => (node.getAttribute(attribute) || "") === value);
      return { attribute, value, index: Math.max(0, matches.indexOf(owner)) };
    }
    return null;
  }

  function restoreFocusedControl(container, descriptor, revisionIsCurrent = () => true, activeAfterReplace = null) {
    if (!container || !descriptor) return;
    requestAnimationFrame(() => {
      if (!container.isConnected || !revisionIsCurrent()) return;
      if (activeAfterReplace && document.activeElement !== activeAfterReplace) return;
      const matches = [...container.querySelectorAll(`[${descriptor.attribute}]`)]
        .filter(node => (node.getAttribute(descriptor.attribute) || "") === descriptor.value);
      (matches[descriptor.index] || matches[0])?.focus?.({ preventScroll: true });
    });
  }

  function canOpenPtyFocus(session) {
    return window.WhiteboxRendererUtils.canOpenResponsibleFocus?.(session) === true;
  }

  const hasWritablePty = session => window.WhiteboxRendererUtils.canUseWritablePtySurface?.(session) === true;

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

  const isOngoingSubagent = session => Boolean(session && ["starting", "running", "paused", "waiting"].includes(session.status));
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
    const messages = (session?.messages || [])
      .filter(message => message && (message.role === "user" || message.role === "assistant"))
      .slice(-120);
    const note = `<p class="pty-focus-transcript-note">${esc(t("pty_focus.readonly_help"))}</p>`;
    if (!messages.length) return `${note}<div class="pty-focus-transcript-empty">${esc(t("pty_focus.no_transcript"))}</div>`;
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
    return `${note}<div class="pty-focus-transcript-list">${rows}</div>`;
  }

  function setBackgroundInactive(inactive) {
    const surface = focusSurface();
    const appChildren = [...($("#appShell")?.children || [])].filter(node => node !== surface);
    const externalOverlays = [
      $("#mobileToolsMenu"),
      ...document.querySelectorAll("body > .modal-backdrop"),
    ];
    const targets = [...new Set([...appChildren, ...externalOverlays].filter(Boolean))];
    if (inactive) {
      if (returnState) {
        returnState.background = targets.map(node => ({
          node,
          inert: node.hasAttribute("inert"),
          ariaHidden: node.getAttribute("aria-hidden"),
        }));
      }
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
      const hiddenDialog = (node.id === "mobileToolsMenu" || node.classList.contains("modal-backdrop"))
        && node.classList.contains("hidden");
      if (hiddenDialog) {
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
      main,
      sidebar,
      mainTop: main?.scrollTop || 0,
      mainLeft: main?.scrollLeft || 0,
      sidebarTop: sidebar?.scrollTop || 0,
      sidebarLeft: sidebar?.scrollLeft || 0,
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
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
  }

  function renderPtyFocus() {
    if (!state.ptyFocusSessionId) return;
    const surface = focusSurface();
    if (!surface || surface.classList.contains("hidden")) return;
    const root = snapshotSession(state.ptyFocusSessionId);
    if (!canOpenPtyFocus(root)) {
      closePtyFocus({ restore: true, reason: root ? "ineligible-root" : "missing-session" });
      toast(t("pty_focus.session_unavailable"));
      return;
    }
    const focusMode = activeFocusMode === "pty" ? "pty" : "transcript";
    const writablePty = focusMode === "pty";
    if (writablePty && !hasWritablePty(root)) {
      closePtyFocus({ restore: true, reason: "missing" });
      toast(t("pty_focus.terminal_unavailable"));
      return;
    }
    const provider = providerInfo(root.provider);
    const goal = controlRoomAgentGoal(root, 90);
    const current = controlRoomSummary(latestWorkCopy(root) || root.statusDetail || root.title, 120);
    const presentedStatus = controlRoomStatus(root);
    const status = sessionStatusLabel(root, presentedStatus);
    surface.setAttribute("style", providerStyle(root.provider));
    surface.dataset.ptyFocusSession = root.id;
    $("#ptyFocusProviderMark").textContent = provider.mark;
    $("#ptyFocusTerminalMark").textContent = provider.mark;
    const headingEyebrow = surface.querySelector(".pty-focus-heading > p");
    if (headingEyebrow) headingEyebrow.textContent = t(writablePty ? "pty_focus.eyebrow" : "pty_focus.readonly_eyebrow");
    $("#ptyFocusTitle").textContent = writablePty ? `${provider.label} · ${goal.text}` : `${provider.label} · ${t("pty_focus.readonly_title")}`;
    $("#ptyFocusSummary").textContent = current.text;
    $("#ptyFocusTerminalTitle").textContent = writablePty ? `${provider.label} · PTY` : `${provider.label} · ${t("pty_focus.readonly_title")}`;
    const terminalHelp = $("#ptyFocusTerminalTitle")?.nextElementSibling;
    if (terminalHelp) terminalHelp.textContent = t(writablePty ? "pty_focus.terminal_help" : "pty_focus.readonly_help");
    const rootStatus = $("#ptyFocusRootStatus");
    rootStatus.className = `pty-focus-root-status ${["running", "starting"].includes(presentedStatus) ? "is-live" : presentedStatus === "waiting" ? "is-waiting" : "is-complete"}`;
    rootStatus.querySelector("b").textContent = status;
    rootStatus.querySelector("small").textContent = timeAgo(root.updatedAt);
    const shell = focusShell();
    shell.dataset.focusContent = focusMode;
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
      const transcriptSession = detail ? { ...root, ...detail, status: root.status, updatedAt: root.updatedAt } : root;
      const nextTranscriptHtml = transcriptHtml(transcriptSession);
      if (lastTranscriptHtml !== nextTranscriptHtml || !transcript.hasChildNodes()) {
        const pinnedToEnd = window.WhiteboxRendererUtils.isScrolledToEnd?.(transcript, 12) !== false;
        const previousTop = transcript.scrollTop;
        transcript.innerHTML = nextTranscriptHtml;
        lastTranscriptHtml = nextTranscriptHtml;
        transcript.scrollTop = pinnedToEnd ? transcript.scrollHeight : previousTop;
      }
    }
    const flow = $("#ptyFocusFlow");
    const nextFlowHtml = flowHtml(root, writablePty);
    if (lastFlowHtml !== nextFlowHtml || !flow.hasChildNodes()) {
      const descriptor = focusedControlDescriptor(flow, ["data-pty-focus-child", "data-pty-focus-execution"]);
      const laneScroll = [...flow.querySelectorAll(".pty-focus-flow-list")]
        .map(node => ({ left: node.scrollLeft, top: node.scrollTop }));
      const revision = ++flowRenderRevision;
      flow.innerHTML = nextFlowHtml;
      lastFlowHtml = nextFlowHtml;
      const activeAfterReplace = document.activeElement;
      [...flow.querySelectorAll(".pty-focus-flow-list")].forEach((node, index) => {
        const saved = laneScroll[index];
        if (!saved) return;
        node.scrollLeft = saved.left;
        node.scrollTop = saved.top;
      });
      restoreFocusedControl(flow, descriptor, () => revision === flowRenderRevision, activeAfterReplace);
    }
  }

  function openPtyFocus(sessionId, options = {}) {
    const id = String(sessionId || "");
    const session = snapshotSession(id);
    if (!canOpenPtyFocus(session)) {
      toast(t(session && !session.parentId ? "pty_focus.terminal_unavailable" : "pty_focus.root_only"));
      return false;
    }
    if (state.ptyFocusSessionId) {
      if (state.ptyFocusSessionId === id) {
        if (activeFocusMode === "pty") window.WhiteboxTerminal?.focusEmbedded?.();
        else $("#ptyFocusBackBtn")?.focus({ preventScroll: true });
      }
      else toast(t("pty_focus.return_before_switch"));
      return state.ptyFocusSessionId === id;
    }
    // A context drawer can remain open beside the control room. It must not
    // carry over above the full-screen focus surface; child details opened
    // from inside focus will deliberately create their own modal drawer.
    if ($("#detailDrawer")?.classList.contains("open")) closeDrawer(false);
    const writablePty = hasWritablePty(session);
    const controller = window.WhiteboxInlineTerminal;
    if (writablePty && (!controller?.enterFocus || !controller?.sync)) {
      toast(t("pty_focus.terminal_unavailable"));
      return false;
    }
    returnState = captureReturnState(options.trigger);
    flowRenderRevision += 1;
    lastFlowHtml = "";
    lastTranscriptHtml = "";
    rememberDialogTrigger("ptyFocusSurface", { refresh: true });
    activeFocusMode = writablePty ? "pty" : "transcript";
    const entered = writablePty ? controller.enterFocus(id, { focus: options.focus !== false }) : true;
    if (!writablePty) state.ptyFocusSessionId = id;
    if (entered === false) {
      discardDialogTrigger("ptyFocusSurface");
      returnState = null;
      activeFocusMode = "";
      toast(t("pty_focus.terminal_unavailable"));
      return false;
    }
    const surface = focusSurface();
    surface.dataset.ptyFocusMode = activeFocusMode;
    surface.classList.remove("hidden");
    surface.removeAttribute("inert");
    surface.setAttribute("aria-hidden", "false");
    if (options.trigger instanceof HTMLElement) options.trigger.setAttribute("aria-expanded", "true");
    document.body.classList.add("pty-focus-open");
    setBackgroundInactive(true);
    renderPtyFocus();
    // Writable focus delegates the caret to the terminal controller. Focusing
    // Back here would count as a newer user focus action and cancel xterm's
    // guarded focus request while the PTY is still mounting.
    if (options.focus !== false && !writablePty) {
      requestAnimationFrame(() => $("#ptyFocusBackBtn")?.focus({ preventScroll: true }));
    }
    if (writablePty) {
      requestAnimationFrame(() => {
        Promise.resolve(controller.sync({ force: true })).catch(error => {
          reportRecoverableError("pty-focus-terminal-sync", error);
          toast(window.WhiteboxI18n.errorText(error, "agent.open_terminal_failed"));
        });
      });
    } else {
      Promise.resolve(loadSessionDetail(id)).then(() => renderPtyFocus()).catch(error => {
        reportRecoverableError("responsible-focus-detail", error);
      });
    }
    announce(t(writablePty ? "pty_focus.opened" : "pty_focus.opened_readonly", {
      title: session.title || providerInfo(session.provider).label,
    }));
    return true;
  }

  function closePtyFocus(options = {}) {
    const active = Boolean(state.ptyFocusSessionId || isPtyFocusActive());
    if (!active) return false;
    const activeSessionId = String(state.ptyFocusSessionId || "");
    const saved = returnState;
    const surface = focusSurface();
    const writablePty = activeFocusMode === "pty";
    if (writablePty) window.WhiteboxInlineTerminal?.closeFocus?.({ unmount: options.unmount !== false });
    state.ptyFocusSessionId = null;
    surface.classList.add("hidden");
    surface.setAttribute("inert", "");
    surface.setAttribute("aria-hidden", "true");
    delete surface.dataset.ptyFocusSession;
    delete surface.dataset.ptyFocusMode;
    activeFocusMode = "";
    flowRenderRevision += 1;
    lastFlowHtml = "";
    lastTranscriptHtml = "";
    focusShell().dataset.inlineAgentTerminal = "";
    if (saved?.trigger?.isConnected) saved.trigger.setAttribute("aria-expanded", "false");
    if (activeSessionId) {
      document.querySelectorAll(`[data-pty-focus-trigger="${CSS.escape(activeSessionId)}"]`)
        .forEach(trigger => trigger.setAttribute("aria-expanded", "false"));
    }
    setBackgroundInactive(false);
    document.body.classList.remove("pty-focus-open");
    if (options.restore !== false) restoreControlRoomPosition(saved);
    if (options.restore === false) discardDialogTrigger("ptyFocusSurface");
    else if (!restoreDialogTrigger("ptyFocusSurface") && saved?.trigger?.isConnected) saved.trigger.focus({ preventScroll: true });
    returnState = null;
    if (saved?.inlineSessionId && state.inlineTerminalSessionId === saved.inlineSessionId) {
      requestAnimationFrame(() => window.WhiteboxInlineTerminal?.sync?.({ force: true }));
    }
    if ($("#detailDrawer")?.classList.contains("open")) requestAnimationFrame(() => renderDrawer());
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
        openSubagentConversation(child.dataset.ptyFocusChild, { presentation: "modal" });
        return;
      }
      const execution = event.target.closest("[data-pty-focus-execution]");
      if (execution) {
        event.stopPropagation();
        openExecutionActivity(
          execution.dataset.ptyFocusExecutionOwner,
          execution.dataset.ptyFocusExecution,
        );
      }
    });
  }

  return {
    canOpenPtyFocus,
    isPtyFocusActive,
    openPtyFocus,
    closePtyFocus,
    renderPtyFocus,
    renderPtyFocusDetail: renderPtyFocus,
    bindPtyFocusEvents,
  };
};
