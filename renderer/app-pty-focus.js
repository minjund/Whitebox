"use strict";

window.WhiteboxAppFactories = window.WhiteboxAppFactories || {};

window.WhiteboxAppFactories.createPtyFocusMode = function createPtyFocusMode(context = {}) {
  const {
    $, esc, state, providerInfo, providerStyle, connectedGraphSessions,
    controlRoomAgentGoal, controlRoomSummary, inferredExecutionSummary,
    executionActivityStatus, subagentWorkLabel, latestWorkCopy,
    controlRoomStatus, sessionStatusLabel, timeAgo,
    subagentConversationHtml, executionActivityDetailHtml,
    rememberDialogTrigger = () => {}, restoreDialogTrigger = () => false,
    discardDialogTrigger = () => false, setDialogOpenState = () => {},
    toast = () => {}, announce = () => {}, loadSessionDetail = async () => null,
    renderDrawer = () => {},
    copyText = async value => navigator.clipboard.writeText(value),
    reportRecoverableError = () => {},
  } = context;
  const t = (key, params) => window.WhiteboxI18n.t(key, params);

  let returnState = null;
  let detailState = null;
  let eventsBound = false;
  let lastFlowHtml = "";
  let lastDetailHtml = "";
  let flowRenderRevision = 0;
  let detailRenderRevision = 0;

  const snapshotSessions = () => state.snapshot?.sessions || [];
  const snapshotSession = id => snapshotSessions().find(session => String(session.id || "") === String(id || "")) || null;
  const focusSurface = () => $("#ptyFocusSurface");
  const focusShell = () => $("#ptyFocusTerminalShell");
  const detailModal = () => $("#ptyFocusChildModal");

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

  function setDetailTriggerExpanded(next, expanded) {
    const flow = $("#ptyFocusFlow");
    if (!flow || !next) return;
    const attribute = next.kind === "child" ? "data-pty-focus-child" : "data-pty-focus-execution";
    const value = String(next.kind === "child" ? next.sessionId : next.executionId || "");
    [...flow.querySelectorAll(`[${attribute}]`)]
      .filter(node => String(node.getAttribute(attribute) || "") === value
        && (next.kind === "child"
          || String(node.getAttribute("data-pty-focus-execution-owner") || "") === String(next.ownerId || "")))
      .forEach(node => node.setAttribute("aria-expanded", expanded ? "true" : "false"));
  }

  function replaceDetailBody(body, html) {
    if (!body || (lastDetailHtml === html && body.hasChildNodes())) return false;
    const scrollTop = body.scrollTop;
    const descriptor = focusedControlDescriptor(body, [
      "data-prompt-toggle", "data-close-expanded-reader", "data-load-earlier-turns",
      "data-scroll-latest", "data-open-subagent-chat", "data-copy-text",
    ]);
    const disclosureStates = new Map([...body.querySelectorAll("details[data-disclosure-key]")]
      .map(node => [node.dataset.disclosureKey, node.open]));
    const revision = ++detailRenderRevision;
    body.innerHTML = html;
    lastDetailHtml = html;
    const activeAfterReplace = document.activeElement;
    [...body.querySelectorAll("details[data-disclosure-key]")].forEach(node => {
      if (disclosureStates.has(node.dataset.disclosureKey)) node.open = disclosureStates.get(node.dataset.disclosureKey);
    });
    body.scrollTop = scrollTop;
    const appliedScrollTop = body.scrollTop;
    requestAnimationFrame(() => {
      if (revision !== detailRenderRevision || !body.isConnected || body.scrollTop !== appliedScrollTop) return;
      body.scrollTop = scrollTop;
    });
    restoreFocusedControl(body, descriptor, () => revision === detailRenderRevision, activeAfterReplace);
    return true;
  }

  function newerSession(snapshot, detail) {
    if (!detail) return snapshot;
    if (!snapshot) return detail;
    const snapshotTime = Date.parse(snapshot.updatedAt || 0);
    const detailTime = Date.parse(detail.updatedAt || 0);
    return Number.isFinite(snapshotTime) && (!Number.isFinite(detailTime) || snapshotTime > detailTime)
      ? snapshot
      : detail;
  }

  function sameDetail(left, right) {
    if (!left || !right || left.kind !== right.kind) return false;
    return left.kind === "child"
      ? String(left.sessionId || "") === String(right.sessionId || "")
      : String(left.ownerId || "") === String(right.ownerId || "")
        && String(left.executionId || "") === String(right.executionId || "");
  }

  function executionLivenessRank(activity) {
    const status = String(activity?.status || "").toLowerCase();
    if (["completed", "failed", "cancelled"].includes(status)) return 3;
    if (status === "unverified") return 2;
    if (status === "running") return 1;
    return 0;
  }

  function newerExecutionLiveness(snapshotActivity, detailActivity) {
    if (!detailActivity) return snapshotActivity;
    if (!snapshotActivity) return detailActivity;
    const snapshotTime = Date.parse(snapshotActivity.updatedAt || 0);
    const detailTime = Date.parse(detailActivity.updatedAt || 0);
    if (Number.isFinite(snapshotTime) && Number.isFinite(detailTime) && snapshotTime !== detailTime) {
      return snapshotTime > detailTime ? snapshotActivity : detailActivity;
    }
    if (Number.isFinite(snapshotTime) !== Number.isFinite(detailTime)) {
      return Number.isFinite(snapshotTime) ? snapshotActivity : detailActivity;
    }
    const snapshotRank = executionLivenessRank(snapshotActivity);
    const detailRank = executionLivenessRank(detailActivity);
    return snapshotRank >= detailRank ? snapshotActivity : detailActivity;
  }

  function mergedExecutionActivity(snapshotActivity, detailActivity) {
    if (!snapshotActivity || !detailActivity) return detailActivity || snapshotActivity || null;
    const activity = { ...detailActivity };
    const liveness = newerExecutionLiveness(snapshotActivity, detailActivity);
    for (const key of ["status", "statusDetail", "exitCode", "completedAt", "updatedAt"]) {
      if (Object.prototype.hasOwnProperty.call(liveness, key)) activity[key] = liveness[key];
    }
    return activity;
  }

  function refreshOpenDetail(next = detailState) {
    if (!next || !isPtyFocusDetailOpen() || !sameDetail(detailState, next)) return Promise.resolve(null);
    const refreshId = next.kind === "child" ? next.sessionId : next.ownerId;
    if (!refreshId) return Promise.resolve(null);
    const snapshot = snapshotSession(refreshId);
    const detail = state.details.get(refreshId);
    const snapshotVersion = String(snapshot?.updatedAt || "");
    const detailVersion = String(detail?.updatedAt || "");
    const version = snapshotVersion || `open:${refreshId}`;
    const snapshotTime = Date.parse(snapshotVersion || 0);
    const detailTime = Date.parse(detailVersion || 0);
    const detailIsCurrent = snapshotVersion && detailVersion
      && (snapshotVersion === detailVersion
        || (Number.isFinite(snapshotTime) && Number.isFinite(detailTime) && detailTime >= snapshotTime));
    if (detailIsCurrent) {
      next.refreshVersion = version;
      return Promise.resolve(detail);
    }
    // A newer snapshot can arrive while drawer-data is running its single
    // bounded follow-up for the previous version. In that case the shared
    // promise resolves with the previous detail, so the same snapshot version
    // must be allowed to start a fresh read on the next render instead of
    // becoming a permanent sticky gate.
    if (next.refreshVersion === version && next.refreshPromise) return next.refreshPromise;
    next.refreshVersion = version;
    const task = Promise.resolve(loadSessionDetail(refreshId, true, snapshotVersion))
      .then(result => {
        if (sameDetail(detailState, next)) renderPtyFocusDetail();
        return result;
      })
      .catch(error => {
        reportRecoverableError(next.kind === "child" ? "pty-focus-child-detail" : "pty-focus-execution-detail", error);
        return null;
      })
      .finally(() => {
        if (next.refreshPromise === task) next.refreshPromise = null;
      });
    next.refreshPromise = task;
    return task;
  }

  function canOpenPtyFocus(session) {
    if (!session || session.parentId || session.sourcePluginId) return false;
    if (String(session.status || "").toLowerCase() === "completed"
      && window.WhiteboxRendererUtils.canForkCodexDesktopSession?.(session) === true) return true;
    if (String(session.provider || "").toLowerCase() === "codex"
      && String(session.clientKind || "").toLowerCase() === "codex-desktop") return false;
    return window.WhiteboxRendererUtils.isWritableDirectSession?.(session) === true
      && session.controlCapabilities?.pty === true
      && session.presentation?.conversationSurface !== "transcript";
  }

  function isPtyFocusActive() {
    const surface = focusSurface();
    return Boolean(state.ptyFocusSessionId && surface && !surface.classList.contains("hidden"));
  }

  function isPtyFocusDetailOpen() {
    const modal = detailModal();
    return Boolean(modal && !modal.classList.contains("hidden"));
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

  function rootNodeHtml(root) {
    const provider = providerInfo(root.provider);
    const goal = controlRoomAgentGoal(root, 54);
    const current = controlRoomSummary(latestWorkCopy(root) || root.statusDetail || root.title, 64);
    return `<div class="pty-focus-node pty-focus-root-node" style="${providerStyle(root.provider)}">
      <span class="pty-focus-node-mark">${esc(provider.mark)}</span>
      <span class="pty-focus-node-copy"><small>${esc(t("pty_focus.responsible_node"))}</small><b title="${esc(goal.full)}">${esc(goal.text)}</b><em title="${esc(current.full)}">${esc(current.text)}</em></span>
      <span class="pty-focus-node-state">PTY</span>
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
      aria-haspopup="dialog" aria-controls="ptyFocusChildModal" aria-expanded="false"
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
      style="${providerStyle(owner.provider)}" aria-haspopup="dialog" aria-controls="ptyFocusChildModal" aria-expanded="false"
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

  function flowHtml(root) {
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
    return `<section class="pty-focus-flow-lane"><header><b>${esc(t("pty_focus.responsible"))}</b><span>1</span></header><div class="pty-focus-flow-list">${rootNodeHtml(root)}</div></section>
      <span class="pty-focus-flow-arrow" aria-hidden="true">→</span>
      ${laneHtml(t("pty_focus.in_progress"), active, "pty_focus.no_running")}
      <span class="pty-focus-flow-arrow" aria-hidden="true">→</span>
      ${laneHtml(t("pty_focus.completed"), completed, "pty_focus.no_completed")}`;
  }

  function setBackgroundInactive(inactive) {
    const surface = focusSurface();
    const appChildren = [...($("#appShell")?.children || [])].filter(node => node !== surface);
    const externalOverlays = [
      $("#mobileToolsMenu"), $("#drawerBackdrop"), $("#detailDrawer"),
      ...document.querySelectorAll("body > .modal-backdrop:not(#ptyFocusChildModal)"),
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
      const closedDrawer = node.id === "detailDrawer" && !node.classList.contains("open");
      const hiddenDialog = (node.id === "mobileToolsMenu" || node.classList.contains("modal-backdrop"))
        && node.classList.contains("hidden");
      if (closedDrawer || hiddenDialog) {
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

  function renderPtyFocusDetail() {
    if (!detailState || !isPtyFocusDetailOpen()) return;
    const title = $("#ptyFocusChildTitle");
    const body = $("#ptyFocusChildBody");
    if (!title || !body) return;
    if (detailState.kind === "child") {
      const session = newerSession(snapshotSession(detailState.sessionId), state.details.get(detailState.sessionId));
      if (!session) {
        title.textContent = t("pty_focus.detail_unavailable");
        replaceDetailBody(body, `<div class="empty-state"><h3>${esc(t("pty_focus.detail_unavailable"))}</h3></div>`);
        return;
      }
      title.textContent = session.agentName || session.taskName || session.title || t("pty_focus.detail_title");
      replaceDetailBody(body, subagentConversationHtml(session));
      return;
    }
    const snapshotOwner = snapshotSession(detailState.ownerId);
    const detailOwner = state.details.get(detailState.ownerId);
    const owner = newerSession(snapshotOwner, detailOwner);
    const snapshotActivity = snapshotOwner?.executions?.find(item => String(item.id || "") === detailState.executionId) || null;
    const detailActivity = detailOwner?.executions?.find(item => String(item.id || "") === detailState.executionId) || null;
    const activity = mergedExecutionActivity(snapshotActivity, detailActivity);
    const purpose = activity ? inferredExecutionSummary(activity) : null;
    title.textContent = purpose?.text || t("pty_focus.detail_unavailable");
    replaceDetailBody(body, executionActivityDetailHtml(owner || {}, activity));
  }

  function renderPtyFocus() {
    if (!state.ptyFocusSessionId) return;
    const surface = focusSurface();
    if (!surface || surface.classList.contains("hidden")) return;
    const root = snapshotSession(state.ptyFocusSessionId);
    if (!canOpenPtyFocus(root)) {
      closePtyFocus({ restore: true, reason: "missing" });
      toast(t("pty_focus.session_unavailable"));
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
    $("#ptyFocusTitle").textContent = `${provider.label} · ${goal.text}`;
    $("#ptyFocusSummary").textContent = current.text;
    $("#ptyFocusTerminalTitle").textContent = `${provider.label} · PTY`;
    const rootStatus = $("#ptyFocusRootStatus");
    rootStatus.className = `pty-focus-root-status ${["running", "starting"].includes(presentedStatus) ? "is-live" : presentedStatus === "waiting" ? "is-waiting" : "is-complete"}`;
    rootStatus.querySelector("b").textContent = status;
    rootStatus.querySelector("small").textContent = timeAgo(root.updatedAt);
    const shell = focusShell();
    shell.dataset.inlineAgentTerminal = root.id;
    shell.setAttribute("style", providerStyle(root.provider));
    shell.setAttribute("aria-label", t("pty_focus.terminal_for", { provider: provider.label }));
    const flow = $("#ptyFocusFlow");
    const nextFlowHtml = flowHtml(root);
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
    if (detailState && isPtyFocusDetailOpen()) setDetailTriggerExpanded(detailState, true);
    renderPtyFocusDetail();
    void refreshOpenDetail();
  }

  async function openPtyFocusDetail(next, trigger = null) {
    if (!isPtyFocusActive() || !next) return false;
    if (isPtyFocusDetailOpen()) closePtyFocusDetail({ restoreFocus: false });
    detailState = { ...next, trigger: trigger instanceof HTMLElement ? trigger : null };
    lastDetailHtml = "";
    rememberDialogTrigger("ptyFocusChildModal", { refresh: true });
    if (trigger instanceof HTMLElement) trigger.setAttribute("aria-expanded", "true");
    setDetailTriggerExpanded(detailState, true);
    const modal = detailModal();
    modal.classList.remove("hidden");
    setDialogOpenState(modal, true);
    renderPtyFocusDetail();
    requestAnimationFrame(() => $("#ptyFocusChildCloseBtn")?.focus({ preventScroll: true }));
    await refreshOpenDetail(detailState);
    return true;
  }

  function closePtyFocusDetail(options = {}) {
    const modal = detailModal();
    if (!modal || modal.classList.contains("hidden")) return false;
    if (detailState?.trigger?.isConnected) detailState.trigger.setAttribute("aria-expanded", "false");
    setDetailTriggerExpanded(detailState, false);
    setDialogOpenState(modal, false);
    modal.classList.add("hidden");
    $("#ptyFocusChildBody").replaceChildren();
    detailRenderRevision += 1;
    lastDetailHtml = "";
    detailState = null;
    if (options.restoreFocus === false) discardDialogTrigger("ptyFocusChildModal");
    else restoreDialogTrigger("ptyFocusChildModal");
    if (isPtyFocusActive()) requestAnimationFrame(() => window.WhiteboxTerminal?.focusEmbedded?.());
    return true;
  }

  function openPtyFocus(sessionId, options = {}) {
    const id = String(sessionId || "");
    const session = snapshotSession(id);
    if (!canOpenPtyFocus(session)) {
      toast(t("pty_focus.root_only"));
      return false;
    }
    if (state.ptyFocusSessionId) {
      if (state.ptyFocusSessionId === id) window.WhiteboxTerminal?.focusEmbedded?.();
      else toast(t("pty_focus.return_before_switch"));
      return state.ptyFocusSessionId === id;
    }
    const controller = window.WhiteboxInlineTerminal;
    if (!controller?.enterFocus || !controller?.sync) {
      toast(t("pty_focus.terminal_unavailable"));
      return false;
    }
    returnState = captureReturnState(options.trigger);
    flowRenderRevision += 1;
    detailRenderRevision += 1;
    lastFlowHtml = "";
    lastDetailHtml = "";
    rememberDialogTrigger("ptyFocusSurface", { refresh: true });
    const entered = controller.enterFocus(id, { focus: options.focus !== false });
    if (entered === false) {
      discardDialogTrigger("ptyFocusSurface");
      returnState = null;
      toast(t("pty_focus.terminal_unavailable"));
      return false;
    }
    const surface = focusSurface();
    surface.classList.remove("hidden");
    surface.removeAttribute("inert");
    surface.setAttribute("aria-hidden", "false");
    if (options.trigger instanceof HTMLElement) options.trigger.setAttribute("aria-expanded", "true");
    document.body.classList.add("pty-focus-open");
    setBackgroundInactive(true);
    renderPtyFocus();
    requestAnimationFrame(() => {
      Promise.resolve(controller.sync({ force: true })).catch(error => {
        reportRecoverableError("pty-focus-terminal-sync", error);
        toast(window.WhiteboxI18n.errorText(error, "agent.open_terminal_failed"));
      });
    });
    announce(t("pty_focus.opened", { title: session.title || providerInfo(session.provider).label }));
    return true;
  }

  function closePtyFocus(options = {}) {
    const active = Boolean(state.ptyFocusSessionId || isPtyFocusActive());
    if (!active) return false;
    const activeSessionId = String(state.ptyFocusSessionId || "");
    if (isPtyFocusDetailOpen()) closePtyFocusDetail({ restoreFocus: false });
    const saved = returnState;
    window.WhiteboxInlineTerminal?.closeFocus?.({ unmount: options.unmount !== false });
    state.ptyFocusSessionId = null;
    const surface = focusSurface();
    surface.classList.add("hidden");
    surface.setAttribute("inert", "");
    surface.setAttribute("aria-hidden", "true");
    delete surface.dataset.ptyFocusSession;
    flowRenderRevision += 1;
    detailRenderRevision += 1;
    lastFlowHtml = "";
    lastDetailHtml = "";
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
        openPtyFocusDetail({ kind: "child", sessionId: child.dataset.ptyFocusChild }, child);
        return;
      }
      const execution = event.target.closest("[data-pty-focus-execution]");
      if (execution) {
        event.stopPropagation();
        openPtyFocusDetail({
          kind: "execution",
          ownerId: execution.dataset.ptyFocusExecutionOwner,
          executionId: execution.dataset.ptyFocusExecution,
        }, execution);
      }
    });
    detailModal()?.addEventListener("click", async event => {
      if (event.target === detailModal() || event.target.closest("#ptyFocusChildCloseBtn")) {
        closePtyFocusDetail();
        return;
      }
      const nestedChild = event.target.closest("[data-open-subagent-chat]");
      if (nestedChild) {
        const nestedId = nestedChild.dataset.openSubagentChat;
        if (detailState?.trigger?.isConnected) detailState.trigger.setAttribute("aria-expanded", "false");
        setDetailTriggerExpanded(detailState, false);
        detailState = { kind: "child", sessionId: nestedId, trigger: null };
        lastDetailHtml = "";
        renderPtyFocusDetail();
        await refreshOpenDetail(detailState);
        requestAnimationFrame(() => $("#ptyFocusChildCloseBtn")?.focus({ preventScroll: true }));
        return;
      }
      const copy = event.target.closest("[data-copy-text]");
      if (copy) {
        const copied = await copyText(copy.dataset.copyText || "");
        toast(copied === false ? t("quality.copy_failed") : t("quality.copy_success"));
        return;
      }
      const promptToggle = event.target.closest("[data-prompt-toggle], [data-close-expanded-reader]");
      if (promptToggle) {
        const prompt = promptToggle.closest("[data-user-prompt]");
        const promptKey = promptToggle.dataset.promptToggle || prompt?.dataset.userPrompt || "";
        if (!promptKey) return;
        const expanded = promptToggle.hasAttribute("data-close-expanded-reader")
          || promptToggle.getAttribute("aria-expanded") === "true";
        if (expanded) state.expandedConversationPrompts.delete(promptKey);
        else {
          state.expandedConversationPrompts.clear();
          state.expandedConversationPrompts.add(promptKey);
        }
        renderPtyFocusDetail();
        requestAnimationFrame(() => {
          const nextPrompt = $("#ptyFocusChildBody")?.querySelector(`[data-user-prompt="${CSS.escape(promptKey)}"]`);
          if (!expanded) nextPrompt?.scrollIntoView({ block: "start", behavior: "auto" });
          nextPrompt?.querySelector(`[data-prompt-toggle="${CSS.escape(promptKey)}"]`)?.focus({ preventScroll: true });
        });
        return;
      }
      if (event.target.closest("[data-scroll-latest]")) {
        const body = $("#ptyFocusChildBody");
        body?.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
        return;
      }
      const earlierTurns = event.target.closest("[data-load-earlier-turns]");
      if (earlierTurns) {
        const body = $("#ptyFocusChildBody");
        const previousHeight = body?.scrollHeight || 0;
        const previousTop = body?.scrollTop || 0;
        const sessionId = earlierTurns.dataset.loadEarlierTurns;
        const nextLimit = Number(earlierTurns.dataset.nextTurnLimit || 0);
        if (sessionId && nextLimit > 0) state.conversationTurnLimits.set(sessionId, nextLimit);
        renderPtyFocusDetail();
        requestAnimationFrame(() => {
          if (!body) return;
          body.scrollTop = previousTop + Math.max(0, body.scrollHeight - previousHeight);
          body.querySelector("[data-load-earlier-turns]")?.focus({ preventScroll: true });
        });
      }
    });
  }

  return {
    canOpenPtyFocus,
    isPtyFocusActive,
    isPtyFocusDetailOpen,
    openPtyFocus,
    closePtyFocus,
    openPtyFocusDetail,
    closePtyFocusDetail,
    renderPtyFocus,
    renderPtyFocusDetail,
    bindPtyFocusEvents,
  };
};
