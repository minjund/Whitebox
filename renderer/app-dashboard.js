"use strict";

window.WhiteboxAppFactories = window.WhiteboxAppFactories || {};

window.WhiteboxAppFactories.createDashboard = function createDashboard(context = {}) {
  const t = (key, params) => window.WhiteboxI18n.t(key, params);
  const {
    $,
    esc,
    uiLocale,
    PROJECTLESS_WORKSPACE,
    state,
    compact,
    readablePreview = value => ({ full: String(value || "").trim(), text: String(value || "").trim() }),
    providerStyle,
    visibleProviders = () => state.providers,
    visibleSessions = () => ((state.snapshot && state.snapshot.sessions) || []),
    isProviderVisible = () => true,
    isRuntimeLoopSession = () => false,
    isControlRoomSession = session => session?.status === "running" || session?.status === "starting",
    controlRoomStatus = session => session?.status,
    resultReviewTargets = () => [],
    preserveFocusDuringRender = callback => callback(),
  } = context;

  function displaySessions() {
    return visibleSessions().filter((session) => (
      typeof context.isRecentSession !== "function" || context.isRecentSession(session)
    ));
  }

  function isPastRecord(session) {
    return Boolean(session && !["running", "starting"].includes(session.status));
  }

  const canForkCodexDesktopSession = session => window.WhiteboxRendererUtils?.canForkCodexDesktopSession?.(session) === true;
  const isDirectWritablePty = session => window.WhiteboxRendererUtils?.isWritableDirectSession?.(session) === true
    && session?.controlCapabilities?.pty === true
    && session?.presentation?.conversationSurface !== "transcript";
  const hasWritablePtySurface = session => !session?.parentId && (
    (String(session.status || "").toLowerCase() === "completed" && canForkCodexDesktopSession(session))
    || isDirectWritablePty(session)
    || Boolean(window.WhiteboxRendererUtils?.appOwnedBridgeTerminalIdentity?.(session))
  );

  function latestSessionSort(sessions = []) {
    return [...sessions].sort((left, right) =>
      Date.parse(right.updatedAt || right.startedAt || 0) - Date.parse(left.updatedAt || left.startedAt || 0)
      || String(right.id || "").localeCompare(String(left.id || "")));
  }

  function shortText(value, maxCharacters = 54) {
    return readablePreview(value || t("studio.session.untitled"), maxCharacters).text || t("studio.session.untitled");
  }

  function projectInitial(value) {
    const characters = Array.from(String(value || "").trim());
    const initial = characters.find((character) => /[\p{L}\p{N}]/u.test(character))
      || characters[0]
      || "•";
    return initial.toLocaleUpperCase(uiLocale());
  }

  function syncUpdateNavigationStatus() {
    const update = state.update || {};
    const available = ["available", "downloading", "downloaded"].includes(update.status);
    const latest = update.latestVersion || "—";
    const updateLabel = t("update.available_version", { version: latest });
    const settingsNav = $("#sidebarSettingsBtn");
    if (settingsNav) {
      const settingsLabel = available ? `${t("app.nav.settings")} · ${updateLabel}` : t("app.nav.settings");
      settingsNav.setAttribute("aria-label", settingsLabel);
      settingsNav.setAttribute("title", settingsLabel);
    }
  }

  function renderProviderRail() {
    $("#providerRail").innerHTML = visibleProviders()
      .map((provider) => {
        const available = !!state.availability[provider.id];
        const connectionStatus = available ? window.WhiteboxI18n.t("ui.cli_found") : window.WhiteboxI18n.t("ui.setup_required");
        return `<div class="provider-rail-item ${available ? "connected" : ""}" style="${providerStyle(provider.id)}" title="${esc(provider.label)}" role="img" aria-label="${esc(`${provider.label}: ${connectionStatus}`)}">
        <span class="provider-mini-mark">${esc(provider.mark)}</span><strong>${esc(provider.label)}</strong>
        <small>${esc(connectionStatus)}</small>
        <span class="connection-dot" aria-hidden="true"></span>
      </div>`;
      })
      .join("");
  }

  function isProjectlessSession(session) {
    const cwd = session && (session.originCwd || session.cwd);
    if (!cwd) return true;
    if (typeof session.projectless === "boolean") return session.projectless;
    const normalized = String(cwd).replace(/\\/g, "/").replace(/\/+$/, "");
    return session.provider === "codex" && session.clientKind === "codex-desktop" && /(?:^|\/)Documents\/Codex\/\d{4}-\d{2}-\d{2}\/new-chat$/i.test(normalized);
  }

  function sessionOriginPath(session) {
    return String(session && (session.originCwd || session.cwd) || "").trim();
  }

  function normalizedProjectPath(value) {
    let normalized = String(value ?? "").trim().replace(/\\/g, "/");
    if (!normalized) return "";
    const posixRoot = /^\/+$/u.test(normalized);
    normalized = normalized.replace(/^\/\/\?\/([a-z]:\/)/i, "$1");
    const wslWindowsMount = normalized.match(/^\/mnt\/([a-z])(?:\/(.*))?$/i);
    if (wslWindowsMount) normalized = `${wslWindowsMount[1]}:/${wslWindowsMount[2] || ""}`;
    normalized = normalized.replace(/\/+$/, "");
    return (normalized || (posixRoot ? "/" : "")).toLocaleLowerCase();
  }

  function projectContainsPath(projectPath, candidatePath) {
    const project = normalizedProjectPath(projectPath);
    const candidate = normalizedProjectPath(candidatePath);
    if (!project || !candidate) return false;
    if (candidate === project) return true;
    return project === "/" ? candidate.startsWith("/") : candidate.startsWith(`${project}/`);
  }

  function projectName(projectPath) {
    const normalized = String(projectPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
    return normalized.split("/").filter(Boolean).pop() || t("workspace.unknown");
  }

  function sessionProjectSource(session) {
    const sourceId = String(session?.sourcePluginId || "");
    if (sourceId) return sourceId === "builtin.omo" ? "builtin.opencode" : sourceId;
    // Desktop-app conversations are read by the core monitor without a
    // sourcePluginId; group them under their desktop toggle instead of Whitebox.
    const kind = String(session?.clientKind || "").toLowerCase();
    if (kind === "claude-desktop") return "builtin.claude-desktop";
    if (kind === "codex-desktop") return "builtin.codex-desktop";
    return "direct";
  }

  function sidebarProjectKey(projectPath) {
    return projectPath === PROJECTLESS_WORKSPACE ? PROJECTLESS_WORKSPACE : normalizedProjectPath(projectPath);
  }

  function sidebarSourceKey(projectPath, sourceId) {
    return `${sidebarProjectKey(projectPath)}::${String(sourceId || "direct")}`;
  }

  function sourcePluginLabel(sourceId) {
    if (!sourceId || sourceId === "direct") return "Whitebox";
    if (sourceId === "builtin.claude-desktop") return "Claude Desktop";
    if (sourceId === "builtin.codex-desktop") return "Codex Desktop";
    const source = (state.sourcePlugins || []).find((item) => item.id === sourceId);
    if (source?.source?.label) return source.source.label;
    return sourceId === "builtin.opencode" ? "OpenCode" : sourceId === "builtin.aside" ? "Aside Browser" : sourceId;
  }

  function observedProjects(sessions = displaySessions().filter((session) => !session.parentId)) {
    const projects = new Map();
    const saved = state.workspaces.map((item, index) => ({ ...item, key: normalizedProjectPath(item.path), order: index }));
    saved.forEach((item) => projects.set(item.key, {
      path: item.path,
      name: item.name || projectName(item.path),
      saved: true,
      order: item.order,
      count: 0,
      liveCount: 0,
    }));
    sessions.filter((session) => !session.parentId && !isProjectlessSession(session)).forEach((session) => {
      const originPath = sessionOriginPath(session);
      if (!originPath) return;
      const owner = saved
        .filter((item) => projectContainsPath(item.path, originPath))
        .sort((a, b) => b.key.length - a.key.length)[0];
      const path = owner ? owner.path : originPath;
      const key = normalizedProjectPath(path);
      const dismissed = !owner && [...(state.dismissedProjects || [])]
        .some((dismissedPath) => key === dismissedPath || key.startsWith(`${dismissedPath}/`));
      if (dismissed) return;
      const project = projects.get(key) || {
        path,
        name: projectName(path),
        saved: false,
        order: Number.MAX_SAFE_INTEGER,
        count: 0,
        liveCount: 0,
      };
      project.count += 1;
      if (isControlRoomSession(session)) project.liveCount += 1;
      project.lastActivityAt = !project.lastActivityAt || Date.parse(session.updatedAt || 0) > Date.parse(project.lastActivityAt || 0)
        ? session.updatedAt
        : project.lastActivityAt;
      projects.set(key, project);
    });
    const items = [...projects.values()];
    const duplicateNames = new Map();
    items.forEach((item) => duplicateNames.set(item.name.toLocaleLowerCase(), (duplicateNames.get(item.name.toLocaleLowerCase()) || 0) + 1));
    items.forEach((item) => {
      if (duplicateNames.get(item.name.toLocaleLowerCase()) < 2) return;
      const parts = String(item.path).replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
      item.name = parts.slice(-2).join("/") || item.name;
    });
    return items.sort((a, b) => Number(b.count || 0) - Number(a.count || 0)
      || Number(a.order ?? Number.MAX_SAFE_INTEGER) - Number(b.order ?? Number.MAX_SAFE_INTEGER)
      || String(a.name).localeCompare(String(b.name), uiLocale()));
  }

  function sessionWorkspaceLabel(session) {
    if (isProjectlessSession(session)) return t("ui.no_project");
    const originPath = sessionOriginPath(session);
    const owner = state.workspaces
      .filter((item) => projectContainsPath(item.path, originPath))
      .sort((a, b) => normalizedProjectPath(b.path).length - normalizedProjectPath(a.path).length)[0];
    return owner?.name || (session && session.workspace) || projectName(originPath);
  }

  function controlRoomProject(session) {
    if (isProjectlessSession(session)) return { key: PROJECTLESS_WORKSPACE, path: PROJECTLESS_WORKSPACE, label: t("control.other_projects") };
    const originPath = sessionOriginPath(session);
    const owner = state.workspaces
      .filter((item) => projectContainsPath(item.path, originPath))
      .sort((a, b) => normalizedProjectPath(b.path).length - normalizedProjectPath(a.path).length)[0];
    const path = owner?.path || originPath;
    return {
      key: normalizedProjectPath(path) || String(session?.workspace || session?.id || "unknown").toLocaleLowerCase(),
      path,
      label: owner?.name || (session && session.workspace) || projectName(originPath) || t("control.other_projects"),
    };
  }

  function workspaceRootSession(session) {
    const sessions = state.snapshot?.sessions || [];
    let current = session;
    const visited = new Set();
    while (current?.parentId && !visited.has(String(current.id || ""))) {
      visited.add(String(current.id || ""));
      const parent = sessions.find((item) => String(item.id || "") === String(current.parentId));
      if (!parent) break;
      current = parent;
    }
    return current || session;
  }

  function matchesWorkspaceFilter(session) {
    if (state.workspace === "all") return true;
    const workspaceOwner = workspaceRootSession(session);
    const requestedSource = String(state.workspaceSource || "all");
    if (requestedSource !== "all" && sessionProjectSource(workspaceOwner) !== requestedSource) return false;
    if (state.workspace === PROJECTLESS_WORKSPACE) return isProjectlessSession(workspaceOwner);
    return !isProjectlessSession(workspaceOwner)
      && projectContainsPath(state.workspace, sessionOriginPath(workspaceOwner));
  }

  function unlinkedLiveTmuxSessions() {
    const displayedSessionIds = new Set(displaySessions().map((session) => String(session.id || "")));
    const allSessionsById = new Map((state.snapshot?.sessions || []).map((session) => [String(session.id || ""), session]));
    const sessions = [];
    for (const distro of state.snapshot?.tmux?.distros || []) {
      for (const tmuxSession of distro.sessions || []) {
        for (const window of tmuxSession.windows || []) {
          for (const pane of window.panes || []) {
            if (!pane.agent || pane.dead || !pane.cwd || !isProviderVisible(pane.agent.provider)) continue;
            const linkedSessionId = String(pane.agent.linkedSessionId || "");
            const linkedSession = linkedSessionId ? allSessionsById.get(linkedSessionId) : null;
            if (linkedSessionId && displayedSessionIds.has(linkedSessionId)) continue;
            // A tmux process can remain alive for days after its linked AI task
            // becomes idle. Do not promote that stale shell back into the Home
            // project count merely because the old conversation aged out of the
            // recent-session list. A still-running linked task remains eligible.
            if (linkedSession && !isControlRoomSession(linkedSession)) continue;
            sessions.push({
              id: `tmux:${pane.id}`,
              provider: pane.agent.provider,
              status: "running",
              originCwd: pane.cwd,
              cwd: pane.cwd,
              workspace: tmuxSession.name,
              title: pane.agent.title || tmuxSession.name,
            });
          }
        }
      }
    }
    return sessions;
  }

  function controlRoomRootSessions() {
    const allSessions = visibleSessions();
    const byId = new Map(allSessions.map((session) => [String(session.id || ""), session]));
    const roots = new Map();
    for (const session of displaySessions().filter(isControlRoomSession)) {
      let root = session;
      const seen = new Set();
      while (root?.parentId && !seen.has(String(root.id || ""))) {
        seen.add(String(root.id || ""));
        const parent = byId.get(String(root.parentId || ""));
        if (!parent) break;
        root = parent;
      }
      const projected = isControlRoomSession(root)
        ? root
        : { ...root, status: "running", statusDetail: session.statusDetail || root.statusDetail };
      roots.set(String(root.id || session.id || ""), projected);
    }
    return [...roots.values()];
  }

  function projectNoticeModel() {
    const rootSessions = displaySessions().filter((session) => !session.parentId);
    const allVisibleSessions = visibleSessions();
    const allSessionsById = new Map(allVisibleSessions.map((session) => [String(session.id || ""), session]));
    const rootSessionFor = (session) => {
      let current = session;
      const visited = new Set();
      while (current?.parentId && !visited.has(String(current.id || ""))) {
        visited.add(String(current.id || ""));
        const parent = allSessionsById.get(String(current.parentId || ""));
        if (!parent) break;
        current = parent;
      }
      return current || session;
    };
    const actorsForRoot = (root) => {
      const queue = [root];
      const seen = new Set();
      const actors = [];
      while (queue.length) {
        const session = queue.shift();
        if (!session?.id || seen.has(String(session.id))) continue;
        seen.add(String(session.id));
        actors.push(session);
        queue.push(...(session.childIds || []).map(id => allSessionsById.get(String(id))).filter(Boolean));
      }
      return actors;
    };
    const ownerMatches = (root, projectPath, sourceId = "all") => (
      normalizedProjectPath(controlRoomProject(root).path) === normalizedProjectPath(projectPath)
      && (sourceId === "all" || sessionProjectSource(root) === sourceId)
    );
    const resultEntries = (root) => {
      if (controlRoomStatus(root) !== "completed" || typeof context.resultReviewTargets !== "function") return [];
      return context.resultReviewTargets(root)
        .filter(session => !context.isProjectNoticeSeen?.("result", session))
        .map(session => ({ kind: "result", session }));
    };
    const attentionEntries = (root) => actorsForRoot(root).flatMap((session) => {
      const entries = [];
      const pendingResultReview = typeof context.resultReviewTargets === "function"
        && context.resultReviewTargets(session).length > 0;
      if (!pendingResultReview && (typeof context.needsManagementInbox === "function"
        ? context.needsManagementInbox(session)
        : Boolean(session?.attention?.required || session?.attention?.category === "required"))) {
        if (!context.isProjectNoticeSeen?.("attention", session)) entries.push({ kind: "attention", session });
      }
      const prompt = window.WhiteboxTerminal?.pendingPromptForSession?.(session) || null;
      if (prompt && !context.isProjectNoticeSeen?.("terminal", session, prompt)) entries.push({ kind: "terminal", session, prompt });
      return entries;
    });
    const signalsForProject = (projectPath, sourceId = "all") => rootSessions
      .filter(root => ownerMatches(root, projectPath, sourceId))
      .map(root => ({ root, result: resultEntries(root), attention: attentionEntries(root) }))
      .filter(signal => signal.result.length || signal.attention.length);
    return { rootSessionFor, actorsForRoot, signalsForProject, resultEntries, attentionEntries };
  }

  function projectNoticeSignals(projectPath, sourceId = "all") {
    return projectNoticeModel().signalsForProject(projectPath, sourceId);
  }

  function acknowledgeProjectNotices(projectPath, sourceId = "all") {
    if (!projectPath || projectPath === "all" || projectPath === PROJECTLESS_WORKSPACE) return 0;
    const entries = projectNoticeSignals(projectPath, sourceId).flatMap(signal => [...signal.result, ...signal.attention]);
    return context.markProjectNoticesSeen?.(entries) || 0;
  }

  function acknowledgeSessionNotices(sessionOrId) {
    const sessions = visibleSessions();
    const session = typeof sessionOrId === "object"
      ? sessionOrId
      : sessions.find(item => String(item.id || "") === String(sessionOrId || ""));
    if (!session) return 0;
    const model = projectNoticeModel();
    const root = model.rootSessionFor(session);
    const actors = session.parentId ? [session] : model.actorsForRoot(root);
    const actorIds = new Set(actors.map(actor => String(actor.id || "")));
    const entries = [
      ...model.resultEntries(root).filter(entry => actorIds.has(String(entry.session?.id || ""))),
      ...model.attentionEntries(root).filter(entry => actorIds.has(String(entry.session?.id || ""))),
    ];
    return context.markProjectNoticesSeen?.(entries) || 0;
  }

  function renderWorkspaces() {
    const rootSessions = displaySessions().filter((session) => !session.parentId);
    const liveRootSessions = controlRoomRootSessions();
    const tmuxRootSessions = unlinkedLiveTmuxSessions();
    const allLiveRootSessions = [...liveRootSessions, ...tmuxRootSessions];
    const projects = observedProjects(rootSessions);
    const liveProjects = observedProjects(allLiveRootSessions)
      .filter((project) => Number(project.count || 0) > 0);
    const allVisibleSessions = visibleSessions();
    const allSessionsById = new Map(allVisibleSessions.map((session) => [String(session.id || ""), session]));
    const rootSessionFor = (session) => {
      let current = session;
      const visited = new Set();
      while (current?.parentId && !visited.has(String(current.id || ""))) {
        visited.add(String(current.id || ""));
        const parent = allSessionsById.get(String(current.parentId || ""));
        if (!parent) break;
        current = parent;
      }
      return current || session;
    };
    const uniqueRootSessions = (sessions) => {
      const roots = new Map();
      sessions.forEach((session) => {
        const root = rootSessionFor(session);
        if (root?.id) roots.set(String(root.id), root);
      });
      return [...roots.values()];
    };
    const noticeModel = projectNoticeModel();
    const sourceIds = [
      "direct",
      ...(state.sourcePlugins || [])
        .map((source) => String(source.id || ""))
        .filter((id) => id && (state.sourcePluginSettings?.enabledPluginIds || []).includes(id)),
      ...rootSessions.map(sessionProjectSource).filter((id) => id !== "direct"),
    ].filter((id, index, values) => values.indexOf(id) === index);
    const sidebarGroups = sourceIds.map((sourceId) => {
      const scopedSessions = rootSessions.filter((session) => sessionProjectSource(session) === sourceId);
      const scopedProjects = observedProjects(scopedSessions)
        .filter((project) => Number(project.count || 0) > 0)
        .map((project) => ({ ...project, sourceId }));
      const projectlessCount = scopedSessions.filter(isProjectlessSession).length;
      return { sourceId, label: sourcePluginLabel(sourceId), projects: scopedProjects, projectlessCount };
    }).filter((group) => group.projects.length > 0 || group.projectlessCount > 0);
    const projectlessCount = rootSessions.filter(isProjectlessSession).length;
    const sidebarProjects = sidebarGroups.flatMap((group) => group.projects);
    const liveProjectlessCount = liveRootSessions.filter(isProjectlessSession).length;
    const nonFolderWork = (name) => /관련 작업 모음|컴퓨터 작업 창 묶음|컴퓨터 작업 창 그룹|작업 창 그룹|다시 시작한 작업/.test(String(name || ""));
    const folderLiveProjects = liveProjects.filter((project) => !nonFolderWork(project.name));
    const stateLiveProjects = liveProjects.filter((project) => nonFolderWork(project.name));
    const beginnerWorkLocation = (name) => {
      const value = String(name || "");
      if (/관련 작업 모음|컴퓨터 작업 창 묶음|컴퓨터 작업 창 그룹|작업 창 그룹/.test(value)) return "여러 AI가 함께 처리 중";
      if (/다시 시작한 작업/.test(value)) return "결과 저장 폴더 확인 필요";
      if (/^화면 개선$/.test(value)) return "화면 관련 작업";
      if (/^설정 개선$/.test(value)) return "설정 관련 작업";
      return `${value} 폴더`;
    };
    const projectKindLabel = (item) => nonFolderWork(item.name) ? beginnerWorkLocation(item.name) : `${item.name} 폴더`;
    const liveBreakdown = [
      ...liveProjects.map((item) => `${projectKindLabel(item)} ${Number(item.count || 0)}건`),
      ...(liveProjectlessCount ? [`${t("control.other_projects")} ${liveProjectlessCount}건`] : []),
    ].join(" + ");
    const activeWorkspaceSource = String(state.workspaceSource || "all");
    const aggregateWorkspaceExists = state.workspace === "all"
      || (state.workspace === PROJECTLESS_WORKSPACE && projectlessCount > 0)
      || projects.some((project) => normalizedProjectPath(project.path) === normalizedProjectPath(state.workspace))
      || liveProjects.some((project) => normalizedProjectPath(project.path) === normalizedProjectPath(state.workspace))
      || sidebarProjects.some((project) => normalizedProjectPath(project.path) === normalizedProjectPath(state.workspace));
    const scopedWorkspaceExists = activeWorkspaceSource === "all"
      || (state.workspace === PROJECTLESS_WORKSPACE
        ? Number(sidebarGroups.find((group) => group.sourceId === activeWorkspaceSource)?.projectlessCount || 0) > 0
        : sidebarProjects.some((project) => project.sourceId === activeWorkspaceSource
          && normalizedProjectPath(project.path) === normalizedProjectPath(state.workspace)));
    if (!aggregateWorkspaceExists) {
      state.workspace = "all";
      state.workspaceSource = "all";
    } else if (!scopedWorkspaceExists) {
      state.workspaceSource = "all";
    }
    const projectButton = (item, compactClass = "") => {
      const selected = String(state.workspaceSource || "all") === "all"
        && normalizedProjectPath(state.workspace) === normalizedProjectPath(item.path);
      return `<button type="button" class="workspace-item observed-project ${compactClass} ${Number(item.liveCount || 0) ? "has-live-sessions" : ""} ${selected ? "selected" : ""}"
      data-workspace="${esc(item.path)}" data-project-source="all" title="${esc(item.path)}"
      data-live-session-count="${Number(item.liveCount || 0)}"
      aria-label="${esc(t("project.filter_named", { name: item.name, count: item.count }))}"
      aria-pressed="${selected ? "true" : "false"}">
      <strong>${esc(beginnerWorkLocation(item.name))}</strong><small>${compactClass
        ? `${Number(item.count || 0)}건`
        : esc(nonFolderWork(item.name)
          ? t("control.non_folder_count", { count: Number(item.count || 0) })
          : t("control.folder_count", { count: Number(item.count || 0) }))}</small>
      ${Number(item.liveCount || 0)
        ? `<span class="workspace-live-state" aria-label="진행 중인 작업 ${Number(item.liveCount)}건"><i aria-hidden="true"></i><b>진행 중 ${Number(item.liveCount)}건</b></span>`
        : ""}
      </button>`;
    };
    const mobileHtml =
      `<button type="button" class="workspace-item ${state.workspace === "all" ? "selected" : ""}"
        data-workspace="all" data-project-source="all" aria-pressed="${state.workspace === "all" ? "true" : "false"}">
      <strong>${window.WhiteboxI18n.t("project.all")}</strong><small>${esc(t("control.all_folder_count", { count: rootSessions.length }))}</small>
      </button>` +
      (projectlessCount
        ? `<button type="button" class="workspace-item projectless ${state.workspace === PROJECTLESS_WORKSPACE && state.workspaceSource === "all" ? "selected" : ""}"
          data-workspace="${PROJECTLESS_WORKSPACE}" data-project-source="all"
          title="${esc(window.WhiteboxI18n.t("ui.session_not_linked_to_a_specific_project"))}"
          aria-pressed="${state.workspace === PROJECTLESS_WORKSPACE && state.workspaceSource === "all" ? "true" : "false"}">
        <strong>${window.WhiteboxI18n.t("ui.no_project")}</strong>
        <small>${esc(t("control.folder_count", { count: projectlessCount }))}</small>
        </button>`
        : "") +
      projects.map((item) => item.saved ? `<div class="workspace-row">
        ${projectButton(item)}
        <button type="button" class="workspace-remove" data-remove-workspace="${esc(item.path)}"
          aria-label="${esc(t("workspace.remove_named", { name: item.name }))}"
          title="${esc(window.WhiteboxI18n.t("ui.remove_from_list"))}">×</button>
        </div>` : projectButton(item)).join("") +
      (!projects.length && !projectlessCount ? `<div class="workspace-empty">${window.WhiteboxI18n.t("project.empty")}</div>` : "");
    if (!(state.sidebarCollapsedProjects instanceof Set)) state.sidebarCollapsedProjects = new Set();
    if (!(state.sidebarCollapsedSources instanceof Set)) state.sidebarCollapsedSources = new Set();
    const sidebarSourceOrder = new Map(sourceIds.map((sourceId, index) => [sourceId, index]));
    const DESKTOP_SOURCE_IDS = new Set(["builtin.claude-desktop", "builtin.codex-desktop"]);
    // Desktop apps are standalone programs like Whitebox itself, not plugins.
    const sourceKind = (sourceId) => sourceId === "direct" || DESKTOP_SOURCE_IDS.has(sourceId) ? "program" : "plugin";
    const sourceMark = (sourceId) => ({
      direct: "WB",
      "builtin.opencode": "OC",
      "builtin.claude-desktop": "CL",
      "builtin.codex-desktop": "CX",
    })[sourceId] || "AS";
    const sourceState = (item, sourceId, projectless = false) => {
      const rootMatches = (root) => sessionProjectSource(root) === sourceId
        && (projectless
          ? isProjectlessSession(root)
          : !isProjectlessSession(root)
            && normalizedProjectPath(controlRoomProject(root).path) === normalizedProjectPath(item.path));
      const sessions = latestSessionSort(rootSessions.filter(rootMatches));
      const relatedSessions = allVisibleSessions.filter((session) => rootMatches(rootSessionFor(session)));
      const live = uniqueRootSessions(relatedSessions.filter(isControlRoomSession));
      const notices = noticeModel.signalsForProject(item.path, sourceId);
      const attention = notices.filter(signal => signal.attention.length).map(signal => signal.root);
      const resultReady = notices.filter(signal => signal.result.length).map(signal => signal.root);
      return {
        live,
        attention,
        resultReady,
        sessions,
        priority: attention.length ? "attention" : resultReady.length ? "result-ready" : live.length ? "live" : "idle",
      };
    };
    // Keep saved projects selectable before their first task without
    // manufacturing an empty Whitebox/program row for them.
    const sidebarProjectNodes = new Map(projects.map((item) => [sidebarProjectKey(item.path), {
      key: sidebarProjectKey(item.path),
      path: item.path,
      name: item.name,
      saved: Boolean(item.saved),
      count: 0,
      sources: [],
      live: [],
      attention: [],
      resultReady: [],
    }]));
    const appendSidebarSource = (item, sourceId, projectless = false) => {
      const key = sidebarProjectKey(item.path);
      const current = sidebarProjectNodes.get(key) || {
        key,
        path: item.path,
        name: item.name,
        saved: false,
        count: 0,
        sources: [],
        live: [],
        attention: [],
        resultReady: [],
      };
      const scopedState = sourceState(item, sourceId, projectless);
      if (!scopedState.sessions.length) {
        sidebarProjectNodes.set(key, current);
        return;
      }
      const source = {
        ...item,
        ...scopedState,
        sourceId,
        sourceKey: sidebarSourceKey(item.path, sourceId),
        sourceLabel: sourcePluginLabel(sourceId),
        sourceKind: sourceKind(sourceId),
      };
      if (sourceId === "direct") {
        current.path = item.path;
        current.name = item.name;
      }
      current.saved = current.saved || Boolean(item.saved);
      current.count += Number(item.count || 0);
      current.sources.push(source);
      current.live.push(...scopedState.live);
      current.attention.push(...scopedState.attention);
      current.resultReady.push(...scopedState.resultReady);
      sidebarProjectNodes.set(key, current);
    };
    sidebarGroups.forEach((group) => {
      group.projects.forEach((item) => appendSidebarSource(item, group.sourceId));
      if (Number(group.projectlessCount || 0) > 0) {
        appendSidebarSource({
          path: PROJECTLESS_WORKSPACE,
          name: t("ui.no_project"),
          saved: false,
          count: Number(group.projectlessCount || 0),
        }, group.sourceId, true);
      }
    });
    sidebarProjectNodes.forEach((project) => {
      project.sources.sort((left, right) => Number(sidebarSourceOrder.get(left.sourceId) ?? Number.MAX_SAFE_INTEGER)
        - Number(sidebarSourceOrder.get(right.sourceId) ?? Number.MAX_SAFE_INTEGER));
      project.priority = project.attention.length
        ? "attention"
        : project.resultReady.length ? "result-ready" : project.live.length ? "live" : "idle";
    });
    const sidebarPriorityRank = { attention: 0, "result-ready": 1, live: 2, idle: 3 };
    const sidebarNameCollator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });
    const defaultSidebarProjects = [...sidebarProjectNodes.values()]
      .filter((item) => item.key !== PROJECTLESS_WORKSPACE)
      .sort((left, right) => sidebarPriorityRank[left.priority] - sidebarPriorityRank[right.priority]
        || sidebarNameCollator.compare(String(left.name || ""), String(right.name || ""))
        || sidebarNameCollator.compare(left.key, right.key));
    const sidebarProjectOrder = ensureProjectOrder(defaultSidebarProjects.map((item) => item.key));
    const sidebarProjectRank = new Map(sidebarProjectOrder.map((key, index) => [key, index]));
    const sortedSidebarProjects = defaultSidebarProjects.sort((left, right) =>
      Number(sidebarProjectRank.get(left.key) ?? Number.MAX_SAFE_INTEGER)
      - Number(sidebarProjectRank.get(right.key) ?? Number.MAX_SAFE_INTEGER));
    const projectlessSidebarProject = sidebarProjectNodes.get(PROJECTLESS_WORKSPACE);
    if (projectlessSidebarProject) sortedSidebarProjects.push(projectlessSidebarProject);
    const canReorderSidebarProjects = defaultSidebarProjects.length > 1;
    const SIDEBAR_SESSION_PREVIEW_LIMIT = 3;
    const selectedSidebarProjectKey = state.workspace === PROJECTLESS_WORKSPACE
      ? PROJECTLESS_WORKSPACE
      : normalizedProjectPath(state.workspace);
    const selectedSidebarProject = sortedSidebarProjects.find((item) => item.key === selectedSidebarProjectKey);
    const selectedSidebarSource = selectedSidebarProject
      && !state.sidebarCollapsedProjects.has(selectedSidebarProject.key)
      ? selectedSidebarProject.sources.find((source) => (
        source.sourceId === String(state.workspaceSource || "all")
      ))
      : null;
    const sidebarTabStopProjectKey = selectedSidebarProject?.key || sortedSidebarProjects[0]?.key || "";
    const sidebarTabStopSourceKey = selectedSidebarSource?.sourceKey || "";
    const sidebarSessionItem = (session) => {
      const live = isControlRoomSession(session);
      const attention = Boolean(context.needsManagementInbox?.(session));
      const status = attention
        ? t("studio.sidebar.needs_review")
        : live ? t("project.in_progress") : t("studio.sidebar.waiting");
      const title = shortText(session.title || session.workspace || t("studio.session.untitled"), 48);
      // Clicking a task opens its exact PTY when writable. Transcript-only
      // imports use the restored read-only detail drawer instead.
      const ptyCapable = hasWritablePtySurface(session);
      const interaction = ptyCapable
        ? `data-pty-focus-trigger="${esc(session.id)}" aria-expanded="${state.ptyFocusSessionId === session.id ? "true" : "false"}" aria-controls="ptyFocusSurface"`
        : `data-open-session="${esc(session.id)}"`;
      return `<button type="button" class="project-sidebar-session ${attention ? "attention" : live ? "live" : ""}"
        ${interaction} role="treeitem" aria-level="3" tabindex="-1"
        aria-label="${esc(`${title}. ${status}`)}" title="${esc(title)}">
        <i aria-hidden="true"></i><b>${esc(title)}</b><small>${esc(status)}</small>
      </button>`;
    };
    const sidebarProjectItem = (item, projectIndex) => {
      const projectSelected = state.workspace !== "all" && (item.key === PROJECTLESS_WORKSPACE
        ? state.workspace === PROJECTLESS_WORKSPACE
        : normalizedProjectPath(state.workspace) === item.key);
      const allSourcesSelected = projectSelected && String(state.workspaceSource || "all") === "all";
      const hasSources = item.sources.length > 0;
      const projectExpanded = hasSources && !state.sidebarCollapsedProjects.has(item.key);
      const sourceListId = `projectSidebarSources${projectIndex}`;
      const canReorder = item.key !== PROJECTLESS_WORKSPACE && canReorderSidebarProjects;
      const canRemove = item.saved && item.key !== PROJECTLESS_WORKSPACE;
      const projectKeyboardShortcuts = [canReorder ? "Alt+ArrowUp Alt+ArrowDown" : "", canRemove ? "Delete" : ""]
        .filter(Boolean).join(" ");
      const hasTasks = Number(item.count || 0) > 0;
      const filterLabel = hasTasks
        ? t("project.filter_named", { name: item.name, count: item.count })
        : item.name;
      const accessibleLabel = item.resultReady.length
        ? `${filterLabel}. ${t("studio.sidebar.result_ready_label", { count: item.resultReady.length })}`
        : filterLabel;
      const projectStatus = item.attention.length
        ? t("studio.sidebar.needs_review")
        : item.resultReady.length
          ? t("studio.sidebar.result_ready")
          : item.live.length ? t("project.in_progress") : t("studio.sidebar.waiting");
      const sourceItems = item.sources.map((source, sourceIndex) => {
        const selected = projectSelected && String(state.workspaceSource || "all") === source.sourceId;
        const sourceExpanded = !state.sidebarCollapsedSources.has(source.sourceKey);
        const sessionsId = `projectSidebarSessions${projectIndex}_${sourceIndex}`;
        const kindLabel = t(source.sourceKind === "program" ? "settings.plugins.type_program" : "settings.plugins.type_plugin");
        const sourceStatus = source.attention.length
          ? t("studio.sidebar.needs_review")
          : source.resultReady.length
            ? t("studio.sidebar.result_ready")
            : source.live.length ? t("project.in_progress") : t("studio.sidebar.waiting");
        const sessionPreview = source.sessions.slice(0, SIDEBAR_SESSION_PREVIEW_LIMIT);
        const remainingSessionCount = Math.max(0, source.sessions.length - sessionPreview.length);
        return `<section class="project-sidebar-source ${selected ? "selected" : ""} ${source.attention.length ? "has-attention" : ""} ${source.resultReady.length ? "has-result-ready" : ""}"
          data-sidebar-source-key="${esc(source.sourceKey)}" data-project-scope="${esc(source.sourceKey)}"
          data-source-kind="${source.sourceKind}" role="none">
          <div class="project-sidebar-source-row">
            <button type="button" class="project-sidebar-source-filter ${selected ? "selected" : ""}"
              data-source-workspace="${esc(item.path)}" data-project-source="${esc(source.sourceId)}"
              data-sidebar-project-ref="${esc(item.key)}" data-sidebar-source-ref="${esc(source.sourceKey)}"
              data-live-session-count="${source.live.length}" data-attention-session-count="${source.attention.length}"
              data-result-ready-count="${source.resultReady.length}" data-project-priority="${source.priority}"
              aria-label="${esc(t("studio.sidebar.view_source", { source: source.sourceLabel, project: item.name }))}"
              aria-selected="${selected ? "true" : "false"}" aria-expanded="${sourceExpanded ? "true" : "false"}"
              aria-owns="${sessionsId}" role="treeitem" aria-level="2"
              tabindex="${source.sourceKey === sidebarTabStopSourceKey ? "0" : "-1"}">
              <span class="project-sidebar-source-mark" aria-hidden="true">${sourceMark(source.sourceId)}</span>
              <span class="project-sidebar-source-copy"><strong>${esc(source.sourceLabel)}</strong><small><b>${esc(kindLabel)}</b> · ${esc(t("studio.sidebar.source_tasks_summary", { count: source.sessions.length, status: sourceStatus }))}</small></span>
            </button>
            <button type="button" class="project-sidebar-source-toggle" data-sidebar-source-toggle="${esc(source.sourceKey)}"
              tabindex="-1"
              aria-expanded="${sourceExpanded ? "true" : "false"}" aria-controls="${sessionsId}"
              aria-label="${esc(t(sourceExpanded ? "studio.sidebar.collapse_source" : "studio.sidebar.expand_source", { source: source.sourceLabel }))}">
              <span class="project-sidebar-disclosure" aria-hidden="true">›</span>
            </button>
          </div>
          <div id="${sessionsId}" class="project-sidebar-sessions" role="group"${sourceExpanded ? "" : " hidden"}>
            ${sessionPreview.length
              ? sessionPreview.map(sidebarSessionItem).join("")
              : `<p class="project-sidebar-session-empty">${esc(t("studio.sidebar.no_source_sessions"))}</p>`}
            ${remainingSessionCount
              ? `<p class="project-sidebar-session-more" data-remaining-session-count="${remainingSessionCount}">${esc(t("studio.sidebar.more_source_sessions", { count: remainingSessionCount }))}</p>`
              : ""}
          </div>
        </section>`;
      }).join("");
      return `<section class="project-sidebar-group project-sidebar-project ${projectSelected ? "selected" : ""} ${item.attention.length ? "has-attention" : ""} ${item.resultReady.length ? "has-result-ready" : ""}"
        data-sidebar-project-key="${esc(item.key)}" ${canReorder ? `data-project-sortable="${esc(item.key)}"` : ""} role="none">
        <div class="project-sidebar-row">
          <button type="button" class="workspace-item project-sidebar-item ${allSourcesSelected ? "selected" : ""} ${canReorder ? "can-reorder" : ""}"
            data-workspace="${esc(item.path)}" data-project-source="all" data-sidebar-project-ref="${esc(item.key)}"
            title="${esc(item.path)}"
            data-live-session-count="${item.live.length}"
            data-attention-session-count="${item.attention.length}"
            data-result-ready-count="${item.resultReady.length}"
            data-project-priority="${item.priority}"
            ${canReorder ? 'aria-grabbed="false" aria-describedby="projectReorderHelp"' : ""}
            ${projectKeyboardShortcuts ? `aria-keyshortcuts="${projectKeyboardShortcuts}"` : ""}
            aria-label="${esc(accessibleLabel)}" aria-selected="${allSourcesSelected ? "true" : "false"}"
            ${hasSources ? `aria-expanded="${projectExpanded ? "true" : "false"}" aria-owns="${sourceListId}"` : ""}
            role="treeitem" aria-level="1"
            tabindex="${item.key === sidebarTabStopProjectKey && !sidebarTabStopSourceKey ? "0" : "-1"}">
            ${canReorder ? `<span class="project-sidebar-drag-handle" draggable="${canReorder ? "true" : "false"}" aria-hidden="true" title="${esc(t("project.reorder_hint"))}"></span>` : ""}
            <span class="project-sidebar-icon" aria-hidden="true">${esc(projectInitial(item.name))}</span>
            <span class="project-sidebar-copy"><strong>${esc(item.name)}</strong>${hasTasks ? `<small>${esc(t("studio.sidebar.project_tree_summary", {
              count: Number(item.count || 0),
              sources: item.sources.length,
              status: projectStatus,
            }))}</small>` : ""}</span>
            <span class="project-sidebar-project-state">
              ${item.attention.length
                ? `<span class="project-sidebar-attention" aria-label="${esc(t("studio.sidebar.needs_review"))}"><i aria-hidden="true"></i><b>${item.attention.length}</b></span>`
                : item.resultReady.length
                  ? `<span class="project-sidebar-result-ready" aria-label="${esc(t("studio.sidebar.result_ready_label", { count: item.resultReady.length }))}"><i aria-hidden="true"></i><b>${item.resultReady.length}</b></span>`
                  : item.live.length
                    ? `<span class="project-sidebar-live" aria-label="${esc(t("studio.sidebar.live_label", { count: item.live.length }))}"><i aria-hidden="true"></i></span>`
                    : ""}
            </span>
          </button>
          <span class="project-sidebar-row-actions">
            ${hasSources ? `<button type="button" class="project-sidebar-project-toggle" data-sidebar-project-toggle="${esc(item.key)}"
              tabindex="-1"
              aria-expanded="${projectExpanded ? "true" : "false"}" aria-controls="${sourceListId}"
              aria-label="${esc(t(projectExpanded ? "studio.sidebar.collapse_project" : "studio.sidebar.expand_project", { project: accessibleLabel }))}">
              <span class="project-sidebar-disclosure" aria-hidden="true">›</span>
            </button>` : ""}
            ${canRemove
              ? `<button type="button" class="project-sidebar-remove" data-remove-workspace="${esc(item.path)}"
                tabindex="-1"
                aria-label="${esc(t("workspace.remove_named", { name: item.name }))}"
                title="${esc(t("workspace.remove_named", { name: item.name }))}">×</button>`
              : ""}
          </span>
        </div>
        ${hasSources ? `<div id="${sourceListId}" class="project-sidebar-source-list" role="group"${projectExpanded ? "" : " hidden"}>
          ${sourceItems}
        </div>` : ""}
      </section>`;
    };
    const sidebarHtml = sortedSidebarProjects.map(sidebarProjectItem).join("")
      || `<div class="workspace-empty">${window.WhiteboxI18n.t("project.empty")}</div>`;
    const desktopHtml =
      `<span class="control-room-filter-label">작업 내용별</span>` +
      `<button type="button" class="workspace-item control-room-project-chip ${state.workspace === "all" ? "selected" : ""}"
        data-workspace="all" data-project-source="all" aria-pressed="${state.workspace === "all" ? "true" : "false"}">
      <strong>전체</strong><small>${allLiveRootSessions.length}건</small>
      </button>` +
      folderLiveProjects.map((item) => projectButton(item, "control-room-project-chip")).join("") +
      (liveProjectlessCount
        ? `<button type="button" class="workspace-item projectless control-room-project-chip ${state.workspace === PROJECTLESS_WORKSPACE && state.workspaceSource === "all" ? "selected" : ""}"
          data-workspace="${PROJECTLESS_WORKSPACE}" data-project-source="all" aria-pressed="${state.workspace === PROJECTLESS_WORKSPACE && state.workspaceSource === "all" ? "true" : "false"}">
        <strong>${esc(t("control.other_projects"))}</strong><small>${esc(t("control.folder_count", { count: liveProjectlessCount }))}</small>
        </button>`
        : "") +
      (stateLiveProjects.length
        ? `<span class="control-room-filter-label state">현재 상태별</span>${stateLiveProjects.map((item) => projectButton(item, "control-room-project-chip")).join("")}`
        : "") +
      (!liveProjects.length && !liveProjectlessCount ? `<div class="workspace-empty">${window.WhiteboxI18n.t("project.empty")}</div>` : "");
    const desktopList = $("#workspaceList");
    const mobileList = $("#mobileWorkspaceList");
    const sidebarList = $("#projectSidebarList");
    if (desktopList) {
      desktopList.innerHTML = desktopHtml;
      const updateProjectOverflow = () => {
        const overflowing = desktopList.scrollWidth > desktopList.clientWidth + 2;
        const scrolledEnd = desktopList.scrollLeft + desktopList.clientWidth >= desktopList.scrollWidth - 2;
        desktopList.classList.toggle("is-overflowing", overflowing);
        desktopList.classList.toggle("is-scrolled-end", overflowing && scrolledEnd);
      };
      if (desktopList.dataset.overflowBound !== "true") {
        desktopList.dataset.overflowBound = "true";
        desktopList.addEventListener("scroll", updateProjectOverflow, { passive: true });
        // Mutating layout-related classes directly inside ResizeObserver can
        // trigger Chromium's "undelivered notifications" loop warning.
        desktopList._overflowObserver = new ResizeObserver(() => requestAnimationFrame(updateProjectOverflow));
        desktopList._overflowObserver.observe(desktopList);
      }
      requestAnimationFrame(updateProjectOverflow);
    }
    if (mobileList) mobileList.innerHTML = mobileHtml;
    if (sidebarList) {
      sidebarList.dataset.selectedProject = state.workspace === "all" ? "false" : "true";
      sidebarList.innerHTML = sidebarHtml;
    }
    const historyList = $("#projectHistoryList");
    const historyTitle = $("#projectHistoryTitle");
    const selectedProject = projects.find((project) => normalizedProjectPath(project.path) === normalizedProjectPath(state.workspace));
    const projectContextName = $("#projectContextName");
    const projectContextEyebrow = $("#projectContextEyebrow");
    const projectContextHeading = $("#projectContextHeading");
    const projectSelected = state.workspace !== "all";
    const taskProjectName = $("#projectTaskProjectName");
    const taskProjectPath = $("#projectTaskProjectPath");
    if (taskProjectName) taskProjectName.textContent = selectedProject?.name || projectName(state.workspace);
    if (taskProjectPath) taskProjectPath.textContent = projectSelected && state.workspace !== PROJECTLESS_WORKSPACE ? state.workspace : "";
    document.body.dataset.projectSelected = projectSelected ? "true" : "false";
    context.syncProjectContextNavigation?.();
    if (projectContextName) {
      projectContextName.textContent = state.workspace === "all"
        ? t("studio.sidebar.title")
        : state.workspace === PROJECTLESS_WORKSPACE
          ? t("ui.no_project")
          : selectedProject?.name || projectName(state.workspace);
    }
    if (projectContextEyebrow) {
      projectContextEyebrow.textContent = t(projectSelected ? "studio.context.progress_label" : "studio.context.selected_label");
    }
    if (projectContextHeading) {
      projectContextHeading.textContent = t(projectSelected ? "studio.context.selected_heading" : "studio.context.all_heading");
    }
    if (historyTitle) {
      const scopeLabel = state.workspace === "all"
        ? t("studio.sidebar.title")
        : state.workspace === PROJECTLESS_WORKSPACE
          ? t("ui.no_project")
          : selectedProject?.name || projectName(state.workspace);
      historyTitle.innerHTML = `<span class="project-history-scope">${esc(scopeLabel)}</span><span class="project-history-title-suffix">${esc(t("studio.history.title_suffix"))}</span>`;
    }
    if (historyList) {
      const historySessions = allVisibleSessions
        .filter((session) => !session.parentId)
        .filter(isPastRecord)
        .filter(matchesWorkspaceFilter)
      const latestHistorySessions = latestSessionSort(historySessions).slice(0, 8);
      historyList.innerHTML = latestHistorySessions.length
        ? latestHistorySessions.map((session) => {
          const provider = state.providerMap.get(session.provider);
          const providerLabel = provider?.label || String(session.provider || "AI").toUpperCase();
          const historyInteraction = hasWritablePtySurface(session)
            ? `data-pty-focus-trigger="${esc(session.id)}" aria-expanded="${state.ptyFocusSessionId === session.id ? "true" : "false"}" aria-controls="ptyFocusSurface"`
            : `data-open-session="${esc(session.id)}"`;
          const updatedAt = new Date(session.updatedAt || 0);
          const updatedLabel = Number.isNaN(updatedAt.getTime())
            ? ""
            : updatedAt.toLocaleDateString(uiLocale(), { month: "short", day: "numeric" });
          const title = readablePreview(session.title || t("studio.session.untitled"), 54);
          return `<button type="button" ${historyInteraction} title="${esc(title.full || title.text)}">
            <span><b>${esc(shortText(session.title, 54))}</b><small>${esc([providerLabel, updatedLabel].filter(Boolean).join(" · "))}</small></span><i aria-hidden="true">›</i>
          </button>`;
        }).join("")
        : `<p class="project-history-empty"><span aria-hidden="true">○</span><b>${esc(t("studio.history.empty"))}</b><small>${esc(t("studio.history.empty_detail"))}</small></p>`;
    }
    const projectSelect = $("#controlRoomProjectSelect");
    if (projectSelect) {
      projectSelect.innerHTML = `<option value="all">${esc(t("control.all_projects_filter"))}</option>`
        + liveProjects.map((item) => `<option value="${esc(item.path)}">${esc(beginnerWorkLocation(item.name))}</option>`).join("")
        + (liveProjectlessCount ? `<option value="${PROJECTLESS_WORKSPACE}">${esc(t("control.other_projects"))}</option>` : "");
      projectSelect.value = [...projectSelect.options].some((option) => option.value === state.workspace) ? state.workspace : "all";
    }
    const memoryProjectSelect = $("#memoryWorkspaceFilter");
    if (memoryProjectSelect) {
      memoryProjectSelect.innerHTML = `<option value="all">${esc(t("project.all"))}</option>`
        + projects.map((item) => `<option value="${esc(item.path)}">${esc(item.name)} · ${esc(t("memory.metric_count", { count: Number(item.count || 0) }))}</option>`).join("")
        + (projectlessCount ? `<option value="${PROJECTLESS_WORKSPACE}">${esc(t("ui.no_project"))} · ${esc(t("memory.metric_count", { count: projectlessCount }))}</option>` : "");
      memoryProjectSelect.value = [...memoryProjectSelect.options].some((option) => option.value === state.workspace) ? state.workspace : "all";
    }
    const controlSort = $("#controlRoomSortSelect");
    if (controlSort) controlSort.value = state.controlRoomSort || "recent";
    const controlSearch = $("#controlRoomSearchInput");
    const controlSearchEditing = Boolean(controlSearch && document.activeElement === controlSearch);
    if (controlSearch && !controlSearchEditing && controlSearch.value !== state.search) controlSearch.value = state.search;
    $("#controlRoomSearch")?.classList.add("is-open");
    $("#controlRoomSearchBtn")?.setAttribute("aria-expanded", "true");
    if (controlSearch) {
      const controlSearchActive = Boolean(state.search || (controlSearchEditing && controlSearch.value));
      controlSearch.tabIndex = controlSearchActive ? 0 : -1;
      controlSearch.setAttribute("aria-hidden", controlSearchActive ? "false" : "true");
    }
    const mobileSummary = $("#mobileWorkspaceSummary");
    if (mobileSummary) mobileSummary.textContent = state.workspace === "all"
      ? t("project.all")
      : state.workspace === PROJECTLESS_WORKSPACE
        ? t("ui.no_project")
        : selectedProject?.name || projectName(state.workspace);
  }

  function renderGlobalStats() {
    const sessions = displaySessions().filter(matchesWorkspaceFilter);
    const totals = {
      active: sessions.filter((session) => session.status === "running" || session.status === "starting").length,
      waiting: sessions.filter((session) => context.matchesManagementFilter?.(session, "attention")).length,
      usage: { total: sessions.reduce((sum, session) => sum + Number(session.usage && session.usage.total || 0), 0) },
    };
    const rootCount = sessions.filter((session) => !session.parentId).length;
    const criticalCount = sessions.filter((session) => context.matchesManagementFilter?.(session, "critical")).length;
    const riskCount = sessions.filter((session) => context.matchesManagementFilter?.(session, "warning")).length;
    const items = [
      [window.WhiteboxI18n.t("ui.all_tasks"), rootCount, window.WhiteboxI18n.t("ui.items"), ""],
      [window.WhiteboxI18n.t("ui.ai_working_now"), totals.active || 0, window.WhiteboxI18n.t("ui.items"), "live"],
      [window.WhiteboxI18n.t("management.action_required"), totals.waiting || 0, window.WhiteboxI18n.t("ui.items"), "alert"],
      [window.WhiteboxI18n.t("management.health.critical"), criticalCount, window.WhiteboxI18n.t("ui.items"), "critical"],
      [window.WhiteboxI18n.t("management.risk_total"), riskCount, window.WhiteboxI18n.t("ui.items"), "warning"],
    ];
    $("#globalStats").innerHTML = items
      .map(
        ([label, value, unit, cls], index) => `<div class="global-stat ${cls}" data-motion-key="stat:${index}" data-motion-value="${esc(value)}">
      <span>${label}</span>
      <strong>${esc(value)}</strong>
      <em>${unit}</em>
      </div>`,
      )
      .join("");
    const activeRootCount = sessions.filter((session) => !session.parentId && isControlRoomSession(session)).length
      + (state.workspace === "all" ? unlinkedLiveTmuxSessions().length : 0);
    const memoryRootCount = sessions.filter((session) => (
      !session.parentId && isPastRecord(session)
    )).length;
    const reviewNeededCount = Math.min(
      activeRootCount,
      sessions.filter((session) => (
        context.needsManagementInbox?.(session)
        && !context.matchesManagementFilter?.(session, "optional")
      )).length,
    );
    const processingCount = Math.max(0, activeRootCount - reviewNeededCount);
    const canonicalProviderId = (value) => String(value || "").toLowerCase() === "gpt"
      ? "codex"
      : String(value || "").toLowerCase();
    const tokenTotals = displaySessions().reduce((totalsByProvider, session) => {
        const providerId = canonicalProviderId(session.provider);
        totalsByProvider.set(
          providerId,
          Number(totalsByProvider.get(providerId) || 0) + Math.max(0, Number(session.usage?.total || 0)),
        );
        return totalsByProvider;
      }, new Map());
    const seenTokenProviders = new Set();
    const tokenProviders = visibleProviders().reduce((items, provider) => {
      const providerId = canonicalProviderId(provider.id);
      if (!providerId || seenTokenProviders.has(providerId)) return items;
      seenTokenProviders.add(providerId);
      const usage = state.providerUsage?.providers?.[providerId]
        || state.providerUsage?.providers?.[provider.id]
        || null;
      const primaryWindow = [usage?.shortWindow, usage?.weekly, usage?.modelWindow]
        .find(window => Number.isFinite(Number(window?.usedPercent))
          || Number.isFinite(Number(window?.remainingPercent))) || null;
      const weeklyWindow = Number.isFinite(Number(usage?.weekly?.usedPercent))
        || Number.isFinite(Number(usage?.weekly?.remainingPercent))
        ? usage.weekly
        : null;
      items.push({
        ...provider,
        aggregateId: providerId,
        tokens: Number(tokenTotals.get(providerId) || 0),
        primaryWindow,
        weeklyWindow,
      });
      return items;
    }, []);
    const sessionTokenScope = $("#sessionTokenScope");
    const sessionTokenList = $("#sessionTokenList");
    if (sessionTokenScope) {
      sessionTokenScope.innerHTML = `<span class="session-token-scope-project">${esc(t("studio.tokens.all_scope"))}</span><span class="session-token-scope-summary">${esc(t("studio.tokens.scope_summary", {
        count: tokenProviders.length,
      }))}</span>`;
    }
    if (sessionTokenList) {
      sessionTokenList.innerHTML = tokenProviders.length
        ? tokenProviders.map((provider) => {
          const tokens = provider.tokens;
          const label = provider.label || provider.aggregateId.toUpperCase();
          const mark = provider.mark || label.slice(0, 2).toUpperCase();
          const hasUsage = Number.isFinite(Number(provider.primaryWindow?.usedPercent))
            || Number.isFinite(Number(provider.primaryWindow?.remainingPercent));
          const used = hasUsage
            ? Math.max(0, Math.min(100,
              Number.isFinite(Number(provider.primaryWindow?.usedPercent))
                ? Number(provider.primaryWindow.usedPercent)
                : 100 - Number(provider.primaryWindow.remainingPercent)))
            : null;
          const usageTone = !hasUsage
            ? "usage-unknown"
            : used >= 90
              ? "usage-critical"
              : used >= 70
                ? "usage-warning"
                : "usage-healthy";
          const weeklyUsed = Number.isFinite(Number(provider.weeklyWindow?.usedPercent))
            || Number.isFinite(Number(provider.weeklyWindow?.remainingPercent))
            ? Math.max(0, Math.min(100,
              Number.isFinite(Number(provider.weeklyWindow?.usedPercent))
                ? Number(provider.weeklyWindow.usedPercent)
                : 100 - Number(provider.weeklyWindow.remainingPercent)))
            : null;
          const windowLabel = provider.primaryWindow?.label || t("studio.tokens.limit_unavailable");
          const title = hasUsage
            ? t("studio.tokens.provider_used_title", {
              provider: label,
              label: windowLabel,
              percent: Math.round(used),
            })
            : t("studio.tokens.provider_unavailable_title", { provider: label });
          return `<article class="session-token-item ${usageTone}" data-token-provider="${esc(provider.aggregateId)}" style="${providerStyle(provider.id)}" title="${esc(title)}">
            <span class="session-token-provider">${esc(mark)}</span>
            <span class="session-token-copy">
              <span class="session-token-label"><b>${esc(label)}</b><small>${esc(windowLabel)}</small></span>
              ${hasUsage
                ? `<span class="session-token-meter" role="progressbar" aria-label="${esc(t("studio.tokens.used_meter_label", { provider: label, percent: Math.round(used) }))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${used}"><i style="width:${used.toFixed(2)}%;min-width:${used > 0 ? 2 : 0}px"></i></span>`
                : `<span class="session-token-meter is-unknown" aria-label="${esc(t("studio.tokens.provider_unavailable_title", { provider: label }))}"><i></i></span>`}
              <span class="session-token-detail">${weeklyUsed == null
                ? esc(t("studio.tokens.used_summary", { tokens: compact(tokens) }))
                : esc(t("studio.tokens.weekly_used_summary", { percent: Math.round(weeklyUsed), tokens: compact(tokens) }))}</span>
            </span>
            <strong>${hasUsage ? `${esc(Math.round(used))}%` : "—"}<small>${esc(t(hasUsage ? "studio.tokens.used_unit" : "studio.tokens.unavailable"))}</small></strong>
          </article>`;
        }).join("")
        : `<p class="session-token-empty">${esc(t("studio.tokens.empty"))}</p>`;
    }
    const navAllCount = $("#navAllCount");
    if (navAllCount) navAllCount.textContent = processingCount;
    const liveCountGuide = $("#liveCountGuide");
    if (liveCountGuide) {
      liveCountGuide.textContent = `전체 ${activeRootCount}건: 처리 중 ${processingCount}건 + 확인 대기 ${reviewNeededCount}건`;
    }
    const navActiveCount = $("#navActiveCount");
    if (navActiveCount) navActiveCount.textContent = memoryRootCount;
    const reviewSessionsForNav = sessions.filter((session) => context.needsManagementInbox?.(session));
    const reviewCount = reviewSessionsForNav.length;
    const reviewCompletedCount = reviewSessionsForNav
      .filter((session) => context.matchesManagementFilter?.(session, "optional")).length;
    const actionableReviewCount = Math.max(0, reviewCount - reviewCompletedCount);
    const projectContextMeta = $("#projectContextMeta");
    if (projectContextMeta) {
      projectContextMeta.textContent = state.workspace === "all"
        ? t("studio.context.all_meta", {
          processing: processingCount,
          past: memoryRootCount,
          waiting: actionableReviewCount,
        })
        : t("studio.context.selected_meta", {
          total: activeRootCount,
          processing: processingCount,
          waiting: reviewNeededCount,
        });
    }
    const navCounts = {
      all: activeRootCount,
      active: memoryRootCount,
    };
    document.querySelectorAll(".nav-item[data-view]").forEach((button) => {
      const key = {
        all: "app.nav.home", active: "app.nav.active", settings: "app.nav.settings",
      }[button.dataset.view];
      if (!key) return;
      const label = t(key);
      const count = navCounts[button.dataset.view];
      const unitKey = { all: "tasks", active: "records" }[button.dataset.view];
      const unit = unitKey ? t(`quality.unit.${unitKey}`) : "";
      const accessibleLabel = Number.isFinite(count) ? t("quality.nav_count_detailed", { label, count, unit }) : label;
      button.setAttribute("aria-label", accessibleLabel);
      button.setAttribute("title", accessibleLabel);
    });
    syncUpdateNavigationStatus();
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value || 0));
    if (!bytes) return "0 바이트";
    const units = ["바이트", "킬로바이트", "메가바이트", "기가바이트"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const amount = bytes / 1024 ** index;
    return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
  }

  function installationTypeLabel(value, version = "—", targetInstallType = value, currentVersion = "—") {
    if (["source", "npm"].includes(value) && targetInstallType === "desktop") {
      return window.WhiteboxI18n.t("ui.development_updates_installed_app", { version: currentVersion });
    }
    const labels = {
      desktop: window.WhiteboxI18n.t("ui.desktop_installer", { version }),
      npm: window.WhiteboxI18n.t("ui.global_npm_installation"),
      source: window.WhiteboxI18n.t("ui.local_development_build"),
      portable: window.WhiteboxI18n.t("ui.portable_build"),
    };
    return labels[value] || window.WhiteboxI18n.t("ui.checking_installation_type");
  }

  function updatePresentation(update) {
    const status = (update && update.status) || "idle";
    const hasAsset = Boolean(update && update.asset);
    const labels = {
      idle: [
        "·", window.WhiteboxI18n.t("ui.version_status"),
        window.WhiteboxI18n.t("ui.ready_to_check_for_updates"), window.WhiteboxI18n.t("ui.checks_the_latest_stable_github_release"),
      ],
      checking: [
        "↻", window.WhiteboxI18n.t("ui.checking_latest_version"),
        window.WhiteboxI18n.t("ui.checking_the_latest_version"), window.WhiteboxI18n.t("ui.reading_the_latest_stable_github_release_tag"),
      ],
      current: [
        "✓",
        window.WhiteboxI18n.t("ui.latest_version"),
        window.WhiteboxI18n.t("ui.you_are_up_to_date"),
        window.WhiteboxI18n.t("update.current_version", { version: (update && update.currentVersion) || "—" }),
      ],
      available: [
        "↟",
        window.WhiteboxI18n.t("ui.update_available"),
        window.WhiteboxI18n.t("update.version_available", { version: (update && update.latestVersion) || "—" }),
        hasAsset
          ? window.WhiteboxI18n.t("ui.a_verified_installer_for_this_computer_can_be_downloaded_in")
          : window.WhiteboxI18n.t("ui.the_release_exists_but_a_matching_installer_is_not_available"),
      ],
      downloading: [
        "↓", window.WhiteboxI18n.t("ui.downloading"), window.WhiteboxI18n.t("ui.downloading_the_update_file"),
        window.WhiteboxI18n.t("ui.keep_the_app_open_until_the_download_finishes"),
      ],
      downloaded: [
        "✓", window.WhiteboxI18n.t("ui.ready_to_install"), window.WhiteboxI18n.t("ui.the_update_file_is_ready"),
        update && update.installMode === "automatic"
          ? window.WhiteboxI18n.t("settings.update.auto_install_restart")
          : window.WhiteboxI18n.t("ui.open_the_installer_and_follow_its_instructions_to_finish_updating"),
      ],
      error: [
        "!", window.WhiteboxI18n.t("ui.check_failed"), window.WhiteboxI18n.t("ui.could_not_check_for_updates"),
        window.WhiteboxI18n.t("ui.check_your_internet_connection_and_try_again"),
      ],
      unsupported: [
        "—", window.WhiteboxI18n.t("ui.manual_update"), window.WhiteboxI18n.t("ui.this_operating_system_requires_a_manual_update"),
        window.WhiteboxI18n.t("ui.get_the_latest_file_directly_from_github_releases"),
      ],
    };
    return labels[status] || labels.idle;
  }

  function renderUpdateSettings() {
    const update = state.update || { status: "idle", currentVersion: state.versions.app || "" };
    const [glyph, label, title, text] = updatePresentation(update);
    const available = ["available", "downloading", "downloaded"].includes(update.status);
    const downloading = update.status === "downloading";
    const downloaded = update.status === "downloaded";
    const runningCurrent = state.versions.app || update.currentVersion || "";
    const comparisonCurrent = update.currentVersionKnown === false
      ? window.WhiteboxI18n.t("ui.version_unknown")
      : update.currentVersion || runningCurrent;
    const current = runningCurrent;
    $("#sidebarAppVersion").textContent = current || "—";
    $("#updatePanel").dataset.updateStatus = update.status || "idle";
    $("#currentVersion").textContent = current || "—";
    $("#latestVersion").textContent = update.latestVersion || window.WhiteboxI18n.t("ui.not_checked");
    const compactVersion = $("#updateCompactVersion");
    if (compactVersion) {
      compactVersion.textContent = `현재 ${current || "확인 중"} → 새 버전 ${update.latestVersion || "확인 중"} · 약 3분 · 설치 중에는 이 화면에서 작업 상태를 볼 수 없음`;
    }
    const versionComparison = $("#versionComparisonLabel");
    if (versionComparison) {
      versionComparison.textContent = update.status === "available" || update.status === "downloading" || update.status === "downloaded"
        ? t("update.comparison_available", { current: comparisonCurrent || "—", version: update.latestVersion || "—" })
        : update.status === "current"
          ? t("update.comparison_current", { version: comparisonCurrent || "—" })
          : update.status === "checking"
            ? t("update.comparison_checking")
            : t("update.comparison_unchecked");
    }
    $("#installationType").textContent = installationTypeLabel(
      update.installType,
      update.latestVersion || "—",
      update.targetInstallType,
      comparisonCurrent || "—",
    );
    $("#releasePublishedAt").textContent = update.publishedAt
      ? window.WhiteboxI18n.t("update.published", {
          version: update.latestVersion || "—",
          date: window.WhiteboxRendererUtils.dateTimeFormat(uiLocale(), {
            year: "numeric",
            month: "long",
            day: "numeric",
          }).format(new Date(update.publishedAt)),
        })
      : window.WhiteboxI18n.t("ui.stable_releases_only");
    const runtimeVersions = $("#runtimeVersions");
    if (runtimeVersions) runtimeVersions.textContent = t("ui.technical_info_ready");
    $("#updateStateGlyph").textContent = glyph;
    $("#updateStateLabel").textContent = label;
    $("#updateStateTitle").textContent = title;
    $("#updateStateText").textContent = text;
    $("#checkUpdateBtn").disabled = update.status === "checking" || downloading || update.blocked === true;
    $("#checkUpdateBtn").classList.toggle("hidden", available);
    $("#checkUpdateBtn").textContent =
      update.status === "checking" ? window.WhiteboxI18n.t("ui.checking") : window.WhiteboxI18n.t("settings.update.check");
    const install = $("#installUpdateBtn");
    install.classList.toggle("hidden", !(available && (update.asset || downloaded)));
    install.disabled = downloading;
    const downloadLabel = update.installMode === "automatic"
      ? window.WhiteboxI18n.t("settings.update.download", { version: update.latestVersion || "—" })
      : downloaded
        ? window.WhiteboxI18n.t("ui.open_installer")
        : window.WhiteboxI18n.t("settings.update.download_manual", { version: update.latestVersion || "—" });
    install.textContent = downloading
      ? window.WhiteboxI18n.t("ui.downloading_2")
      : downloadLabel;
    const progress = $("#updateProgress");
    progress.classList.toggle("hidden", !downloading && !downloaded);
    $("#updateProgressLabel").textContent = `${Math.max(0, Math.min(100, Number(update.progress || 0)))}%`;
    $("#updateProgressBar").style.width = `${Math.max(0, Math.min(100, Number(update.progress || 0)))}%`;
    $(".update-progress-track").setAttribute("aria-valuenow", String(Math.max(0, Math.min(100, Number(update.progress || 0)))));
    $("#updateProgressBytes").textContent = downloaded
      ? `${formatBytes(update.totalBytes || update.downloadedBytes)} · ${window.WhiteboxI18n.t("settings.update.file_verified")}`
      : `${formatBytes(update.downloadedBytes)} / ${update.totalBytes ? formatBytes(update.totalBytes) : window.WhiteboxI18n.t("ui.checking_size")}`;
    const error = $("#updateError");
    error.classList.toggle("hidden", !update.error);
    error.textContent = update.error
      ? update.blocked === true && update.currentVersionKnown === false
        ? window.WhiteboxI18n.t("settings.update.installed_version_unavailable")
        : window.WhiteboxI18n.errorText(update.error, "ui.could_not_check_for_updates")
      : "";
    const notes = $("#releaseNotes");
    notes.classList.toggle("hidden", !update.latestVersion);
    $("#releaseNotesText").textContent =
      (update.notes && update.notes.trim()) || window.WhiteboxI18n.t("ui.no_release_notes_were_provided_for_this_release");
    const notice = $("#updateNotice");
    notice.classList.toggle("hidden", !available || state.view !== "all");
    $("#updateNoticeTitle").textContent = window.WhiteboxI18n.t("update.available_version", { version: update.latestVersion || "—" });
    $("#updateNoticeText").textContent = downloaded
      ? window.WhiteboxI18n.t("ui.the_installer_is_ready")
      : window.WhiteboxI18n.t("ui.download_the_update_from_settings");
    $("#navUpdateBadge").classList.toggle("hidden", !available);
    $("#navUpdateBadge").textContent = available
      ? t("update.nav_available", { version: update.latestVersion || "—" })
      : "";
    syncUpdateNavigationStatus();
  }

  let lastProviderOverviewHtml = null;
  let lastProviderVisibilityHtml = null;

  function renderProviderOverview() {
    pruneProviderFilters();
    const summaries = (state.snapshot && state.snapshot.summary && state.snapshot.summary.providers) || state.providers;
    const sessions = displaySessions();
    const visibleSummaries = summaries.filter((provider) => isProviderVisible(provider.id));
    const overviewTabStopId = state.providerFilters.size ? [...state.providerFilters][0] : visibleSummaries[0]?.id;
    const nextProviderOverviewHtml = visibleSummaries
      .map((provider, index) => {
        const rootCount = sessions.filter((session) => session.provider === provider.id && !session.parentId).length;
        const selected = state.providerFilters.has(provider.id);
        const tabStop = provider.id === overviewTabStopId;
        return `<button type="button" class="provider-overview-card ${selected ? "selected" : ""}"
          data-provider-card="${esc(provider.id)}"
          data-motion-key="provider:${esc(provider.id)}"
          data-motion-value="${provider.active || 0}:${rootCount}:${(provider.usage && provider.usage.total) || 0}"
          style="${providerStyle(provider.id)}"
          tabindex="${tabStop ? "0" : "-1"}"
          aria-pressed="${selected ? "true" : "false"}">
      <div class="poc-head">
        <span class="provider-mark">${esc(provider.mark)}</span>
        <div><strong>${esc(provider.label)}</strong><small>${esc(provider.company)}</small></div>
        <span class="poc-head-states">
          <span class="poc-filter-state ${selected ? "visible" : ""}" aria-hidden="true">✓ ${window.WhiteboxI18n.t("filter.applied")}</span>
          <span class="poc-state ${provider.installed ? "online" : ""}">
            ${provider.installed ? window.WhiteboxI18n.t("ui.available") : window.WhiteboxI18n.t("ui.setup_required")}
          </span>
        </span>
      </div>
      <div class="poc-metrics">
        <div><b>${provider.active || 0}</b><span>${window.WhiteboxI18n.t("ui.active_ai")}</span></div>
        <div><b>${rootCount}</b><span>${window.WhiteboxI18n.t("ui.main_tasks")}</span></div>
        <div><b>${compact(provider.usage && provider.usage.total)}</b><span>${window.WhiteboxI18n.t("ui.tokens_used_2")}</span></div>
      </div>
    </button>`;
      })
      .join("");
    if (lastProviderOverviewHtml !== nextProviderOverviewHtml) {
      $("#providerOverview").innerHTML = nextProviderOverviewHtml;
      lastProviderOverviewHtml = nextProviderOverviewHtml;
    }
  }

  function pruneProviderFilters() {
    const valid = new Set(visibleProviders().map((provider) => provider.id));
    for (const id of [...state.providerFilters]) if (!valid.has(id)) state.providerFilters.delete(id);
    if (valid.size > 0 && state.providerFilters.size === valid.size) state.providerFilters.clear();
  }

  function toggleProviderFilter(providerId) {
    pruneProviderFilters();
    if (providerId === "all") state.providerFilters.clear();
    else if (state.providerFilters.has(providerId)) state.providerFilters.delete(providerId);
    else state.providerFilters.add(providerId);
    if (visibleProviders().length > 0 && state.providerFilters.size === visibleProviders().length) state.providerFilters.clear();
  }

  function renderProviderFilter() {
    pruneProviderFilters();
    const allSelected = state.providerFilters.size === 0;
    const tabStopId = allSelected ? "all" : [...state.providerFilters][0];
    const mobileSelectedId = state.providerFilters.size === 1 ? [...state.providerFilters][0] : "all";
    const button = (id, label, mark = "") => {
      const selected = id === "all" ? allSelected : state.providerFilters.has(id);
      return `<button type="button" class="provider-filter-chip ${selected ? "selected" : ""}"
        data-provider-filter="${esc(id)}" tabindex="${id === tabStopId ? "0" : "-1"}" aria-pressed="${selected ? "true" : "false"}">
        <i class="provider-filter-check" aria-hidden="true">✓</i>
        <b>${esc(label)}</b>
      </button>`;
    };
    const mobileOptions = [
      { id: "all", label: window.WhiteboxI18n.t("ui.all_ai") },
      ...visibleProviders().map((provider) => ({ id: provider.id, label: provider.label })),
    ].map(({ id, label }) => `<option value="${esc(id)}" ${id === mobileSelectedId ? "selected" : ""}>${esc(label)}</option>`).join("");
    $("#providerFilter").innerHTML =
      `<span class="provider-filter-label">${esc(window.WhiteboxI18n.t("memory.agent"))}</span>` +
      `<label class="mobile-provider-filter" for="mobileProviderFilterSelect">
        <span>${esc(window.WhiteboxI18n.t("memory.agent"))}</span>
        <select id="mobileProviderFilterSelect" aria-label="${esc(window.WhiteboxI18n.t("ui.ai_provider_filter"))}">${mobileOptions}</select>
      </label>` +
      button("all", window.WhiteboxI18n.t("ui.all_ai")) +
      visibleProviders().map((provider) => button(provider.id, provider.label, provider.mark)).join("");
  }

  function announceProviderFilter() {
    const labels = state.providerFilters.size
      ? visibleProviders().filter((provider) => state.providerFilters.has(provider.id)).map((provider) => provider.label).join(", ")
      : window.WhiteboxI18n.t("ui.all_ai");
    $("#providerFilterStatus").textContent = window.WhiteboxI18n.t("filter.result_summary", {
      providers: labels,
      count: filteredSessions().length,
    });
  }

  function filteredSessions() {
    const allSessions = state.view === "active" ? visibleSessions() : displaySessions();
    let sessions = allSessions.filter((session) => !session.parentId);
    if (state.view === "active") sessions = sessions.filter(isPastRecord);
    if (state.providerFilters.size) sessions = sessions.filter((session) => state.providerFilters.has(session.provider));
    sessions = sessions.filter(matchesWorkspaceFilter);
    const query = state.search.replace(/\s+/g, " ").trim().toLowerCase();
    if (query) {
      sessions = sessions.filter((session) =>
        [session.title, session.model, session.originCwd, session.cwd, session.workspace, session.agentName, ...(session.messages || []).slice(-12).map((item) => item.text)]
          .join(" ")
          .toLowerCase()
          .includes(query),
      );
    }
    if (state.sort === "tokens") sessions.sort((a, b) => Number((b.usage && b.usage.total) || 0) - Number((a.usage && a.usage.total) || 0));
    else if (state.sort === "context") sessions.sort((a, b) => Number((b.context && b.context.percent) || 0) - Number((a.context && a.context.percent) || 0));
    else if (state.view === "active") sessions = latestSessionSort(sessions);
    else sessions = stableSessionSort(sessions);
    return sessions;
  }

  function ensureSessionOrder(sessions = []) {
    if (!Array.isArray(state.sessionOrder)) state.sessionOrder = [];
    const known = new Set(state.sessionOrder);
    for (const session of sessions) {
      const id = String(session?.id || "");
      if (!id || known.has(id)) continue;
      state.sessionOrder.push(id);
      known.add(id);
    }
    return state.sessionOrder;
  }

  function stableSessionSort(sessions = []) {
    const order = ensureSessionOrder(sessions);
    const rank = new Map(order.map((id, index) => [id, index]));
    return [...sessions].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }

  function moveSessionOrder(sourceId, targetId, placeAfter = false) {
    const source = String(sourceId || "");
    const target = String(targetId || "");
    if (!source || !target || source === target) return false;
    const order = ensureSessionOrder(displaySessions());
    const sourceIndex = order.indexOf(source);
    if (sourceIndex < 0 || !order.includes(target)) return false;
    order.splice(sourceIndex, 1);
    const targetIndex = order.indexOf(target);
    order.splice(targetIndex + (placeAfter ? 1 : 0), 0, source);
    state.sessionOrder = order;
    return true;
  }

  function ensureProjectOrder(projectKeys = []) {
    if (!Array.isArray(state.projectOrder)) state.projectOrder = [];
    const known = new Set(state.projectOrder);
    for (const value of projectKeys) {
      const key = String(value || "");
      if (!key || known.has(key)) continue;
      state.projectOrder.push(key);
      known.add(key);
    }
    return state.projectOrder;
  }

  function moveProjectOrder(sourceId, targetId, placeAfter = false) {
    const source = String(sourceId || "");
    const target = String(targetId || "");
    if (!source || !target || source === target) return false;
    const order = ensureProjectOrder([source, target]);
    const sourceIndex = order.indexOf(source);
    if (sourceIndex < 0 || !order.includes(target)) return false;
    order.splice(sourceIndex, 1);
    const targetIndex = order.indexOf(target);
    order.splice(targetIndex + (placeAfter ? 1 : 0), 0, source);
    state.projectOrder = order;
    return true;
  }

  function graphFilteredSessions() {
    let sessions = displaySessions();
    if (state.providerFilters.size) sessions = sessions.filter((session) => state.providerFilters.has(session.provider));
    sessions = sessions.filter(matchesWorkspaceFilter);
    const query = state.search.replace(/\s+/g, " ").trim().toLowerCase();
    if (query)
      sessions = sessions.filter((session) =>
        [session.title, session.model, session.originCwd, session.cwd, session.workspace, session.agentName, session.agentRole, ...(session.messages || []).map((item) => item.text)]
          .join(" ")
          .toLowerCase()
          .includes(query),
      );
    const allById = new Map(visibleSessions().map((session) => [String(session.id || ""), session]));
    const contextual = new Map(sessions.map((session) => [String(session.id || ""), session]));
    const selectedGraphId = String(state.graphFocusId || state.inlineTerminalSessionId || "");
    const selectedGraphSession = allById.get(selectedGraphId);
    if (selectedGraphSession && matchesWorkspaceFilter(selectedGraphSession)) {
      const pending = [selectedGraphSession];
      const selectedFamily = new Set();
      while (pending.length) {
        const current = pending.shift();
        const currentId = String(current?.id || "");
        if (!currentId || selectedFamily.has(currentId)) continue;
        selectedFamily.add(currentId);
        if (!matchesWorkspaceFilter(current)) continue;
        contextual.set(currentId, current);
        if (current.parentId) pending.push(allById.get(String(current.parentId || "")));
        for (const childId of current.childIds || []) pending.push(allById.get(String(childId || "")));
      }
    }
    for (const session of [...contextual.values()].filter(isControlRoomSession)) {
      let current = session;
      const seen = new Set();
      while (current?.parentId && !seen.has(String(current.id || ""))) {
        seen.add(String(current.id || ""));
        const parent = allById.get(String(current.parentId || ""));
        if (!parent || !matchesWorkspaceFilter(parent)) break;
        if (state.providerFilters.size && !state.providerFilters.has(parent.provider)) break;
        contextual.set(String(parent.id || ""), parent);
        current = parent;
      }
    }
    sessions = [...contextual.values()];
    if (state.controlRoomSort === "tokens") return [...sessions].sort((a, b) => Number((b.usage && b.usage.total) || 0) - Number((a.usage && a.usage.total) || 0));
    if (state.controlRoomSort === "context") return [...sessions].sort((a, b) => Number((b.context && b.context.percent) || 0) - Number((a.context && a.context.percent) || 0));
    return [...sessions].sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
  }

  function renderProviderVisibilitySettings() {
    const list = $("#providerVisibilityList");
    if (!list) return;
    const nextVisibilityHtml = state.providers.map((provider) => {
      const visible = isProviderVisible(provider.id);
      const status = window.WhiteboxI18n.t(visible ? "settings.providers.visible" : "settings.providers.hidden");
      return `<label class="provider-visibility-option ${visible ? "enabled" : "disabled"}" style="${providerStyle(provider.id)}">
        <span class="provider-mark" aria-hidden="true">${esc(provider.mark)}</span>
        <span class="provider-visibility-name"><b>${esc(provider.label)}</b></span>
        <input type="checkbox" data-provider-visibility="${esc(provider.id)}" ${visible ? "checked" : ""}
          aria-label="${esc(t(visible ? "settings.providers.hide_action" : "settings.providers.show_action", { provider: provider.label }))}">
        <span class="provider-toggle" aria-hidden="true"><b>${esc(status)}</b><i></i></span>
      </label>`;
    }).join("");
    if (lastProviderVisibilityHtml !== nextVisibilityHtml) {
      list.innerHTML = nextVisibilityHtml;
      lastProviderVisibilityHtml = nextVisibilityHtml;
    }
  }

  function renderSourcePluginSettings() {
    const list = $("#sourcePluginSettingsList");
    if (!list) return;
    const enabledPluginIds = new Set(state.sourcePluginSettings?.enabledPluginIds || []);
    const statuses = new Map((state.sourcePlugins || []).map((source) => [String(source.id || ""), source]));
    const definitions = [
      { id: "builtin.opencode", label: "OpenCode", mark: "OC", color: "#4c8bf5", descriptionKey: "settings.plugins.opencode_description" },
      { id: "builtin.aside", label: "Aside", mark: "A", color: "#b983ff", descriptionKey: "settings.plugins.aside_description" },
      { id: "builtin.claude-desktop", label: "Claude Desktop", mark: "CL", color: "#d97757", descriptionKey: "settings.plugins.claude_desktop_description", clientKind: "claude-desktop" },
      { id: "builtin.codex-desktop", label: "Codex Desktop", mark: "CX", color: "#10a37f", descriptionKey: "settings.plugins.codex_desktop_description", clientKind: "codex-desktop" },
    ];
    const desktopSessionCount = (clientKind) => (state.rawSnapshot?.sessions || state.snapshot?.sessions || [])
      .filter((session) => !session.sourcePluginId && String(session.clientKind || "").toLowerCase() === clientKind).length;
    list.innerHTML = definitions.map((definition) => {
      const source = statuses.get(definition.id) || {};
      const enabled = enabledPluginIds.has(definition.id);
      const platformSupported = source.platformSupported !== false
        && (definition.id !== "builtin.aside" || state.platform.id === "darwin");
      const unavailable = !platformSupported;
      const busy = state.sourcePluginSettingRequests?.has(definition.id);
      const locked = busy || (unavailable && !enabled);
      const sessionCount = definition.clientKind ? desktopSessionCount(definition.clientKind) : Number(source.sessionCount || 0);
      const status = unavailable
        ? t("settings.plugins.unavailable")
        : enabled
          ? t("settings.plugins.enabled", { count: sessionCount })
          : t("settings.plugins.disabled");
      const detail = enabled && source.reason
        ? source.reason
        : t(definition.descriptionKey);
      return `<label class="source-plugin-option ${enabled ? "enabled" : "disabled"} ${unavailable ? "unavailable" : ""}"
        style="--plugin:${definition.color}" data-source-plugin-option="${esc(definition.id)}" ${busy ? 'data-busy="true"' : ""}>
        <span class="source-plugin-mark" aria-hidden="true">${esc(definition.mark)}</span>
        <span class="source-plugin-copy"><b>${esc(source.source?.label || definition.label)}</b><small>${esc(status)}</small><small title="${esc(detail)}">${esc(detail)}</small></span>
        <input type="checkbox" role="switch" data-source-plugin-enabled="${esc(definition.id)}"
          ${enabled ? "checked" : ""} ${locked ? "disabled" : ""}
          aria-label="${esc(t(enabled ? "settings.plugins.disable_action" : "settings.plugins.enable_action", { plugin: definition.label }))}">
        <span class="source-plugin-toggle" aria-hidden="true"><i></i></span>
      </label>`;
    }).join("");
  }

  return {
    renderProviderRail: (...args) => preserveFocusDuringRender(() => renderProviderRail(...args)),
    isProjectlessSession,
    sessionOriginPath,
    observedProjects,
    sessionWorkspaceLabel,
    controlRoomProject,
    matchesWorkspaceFilter,
    unlinkedLiveTmuxSessions,
    controlRoomRootSessions,
    projectNoticeSignals,
    acknowledgeProjectNotices,
    acknowledgeSessionNotices,
    renderWorkspaces: (...args) => preserveFocusDuringRender(() => renderWorkspaces(...args)),
    renderGlobalStats: (...args) => preserveFocusDuringRender(() => renderGlobalStats(...args)),
    formatBytes,
    installationTypeLabel,
    updatePresentation,
    renderUpdateSettings,
    renderProviderOverview: (...args) => preserveFocusDuringRender(() => renderProviderOverview(...args)),
    renderProviderFilter: (...args) => preserveFocusDuringRender(() => renderProviderFilter(...args)),
    toggleProviderFilter,
    announceProviderFilter,
    filteredSessions,
    graphFilteredSessions,
    isPastRecord,
    latestSessionSort,
    stableSessionSort,
    moveSessionOrder,
    ensureProjectOrder,
    moveProjectOrder,
    renderProviderVisibilitySettings: (...args) => preserveFocusDuringRender(() => renderProviderVisibilitySettings(...args)),
    renderSourcePluginSettings: (...args) => preserveFocusDuringRender(() => renderSourcePluginSettings(...args)),
  };
};
