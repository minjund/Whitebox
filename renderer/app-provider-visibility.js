"use strict";

window.WhiteboxAppFactories = window.WhiteboxAppFactories || {};

window.WhiteboxAppFactories.createProviderVisibility = function createProviderVisibility(context = {}) {
  const { state, reportRecoverableError } = context;
  const STORAGE_KEY = "whitebox:provider-visibility:v1";
  const USAGE_KEYS = ["input", "cachedInput", "cacheWrite", "output", "reasoning", "total"];

  function loadProviderVisibility(preference = null) {
    try {
      const saved = preference && typeof preference === "object"
        ? preference
        : JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const known = new Set(state.providers.map((provider) => provider.id));
      state.hiddenProviders = new Set((saved.hidden || []).filter((id) => known.has(id)));
    } catch (error) {
      reportRecoverableError("provider-visibility-load", error);
      state.hiddenProviders = new Set();
    }
  }

  function saveProviderVisibility() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ hidden: [...state.hiddenProviders] }));
    } catch (error) {
      reportRecoverableError("provider-visibility-save", error);
    }
  }

  function isProviderVisible(providerId) {
    return !state.hiddenProviders.has(String(providerId || ""));
  }

  function visibleProviders() {
    return state.providers.filter((provider) => isProviderVisible(provider.id));
  }

  function isSourcePluginVisible(pluginId) {
    const rawId = String(pluginId || "");
    const id = rawId === "builtin.omo" ? "builtin.opencode" : rawId;
    return !id || (state.sourcePluginSettings?.enabledPluginIds || []).includes(id);
  }

  function desktopSourcePluginId(session) {
    if (!session || session.sourcePluginId) return "";
    const kind = String(session.clientKind || "").toLowerCase();
    if (kind === "claude-desktop") return "builtin.claude-desktop";
    if (kind === "codex-desktop") return "builtin.codex-desktop";
    return "";
  }

  function isDesktopSessionVisible(session) {
    const id = desktopSourcePluginId(session);
    if (!id) return true;
    // Desktop history is visible by default; hide only on an explicit opt-out
    // recorded in the loaded settings.
    const ids = state.sourcePluginSettings?.enabledPluginIds;
    return !Array.isArray(ids) || ids.includes(id);
  }

  function visibleSessions() {
    return (state.snapshot?.sessions || []).filter((session) => (
      isSourcePluginVisible(session.sourcePluginId)
      && (session.sourcePluginId || isProviderVisible(session.provider))
      && isDesktopSessionVisible(session)
    ));
  }

  function visibleTmux(tmux = (state.rawSnapshot || state.snapshot)?.tmux) {
    if (!tmux) return tmux;
    const projected = {
      ...tmux,
      distros: (tmux.distros || []).map((distro) => ({
        ...distro,
        sessions: (distro.sessions || []).map((tmuxSession) => ({
          ...tmuxSession,
          windows: (tmuxSession.windows || []).map((window) => ({
            ...window,
            panes: (window.panes || []).filter((pane) => (!pane.dead || !pane.agent) && (!pane.agent || isProviderVisible(pane.agent.provider))),
          })).filter((window) => window.panes.length),
        })).filter((tmuxSession) => tmuxSession.windows.length),
      })).filter((distro) => distro.sessions.length),
    };
    const panes = projected.distros.flatMap((distro) =>
      distro.sessions.flatMap((session) => session.windows.flatMap((window) => window.panes)));
    projected.summary = {
      distros: projected.distros.length,
      sessions: projected.distros.reduce((sum, distro) => sum + distro.sessions.length, 0),
      windows: projected.distros.reduce((sum, distro) =>
        sum + distro.sessions.reduce((count, session) => count + session.windows.length, 0), 0),
      panes: panes.length,
      aiPanes: panes.filter((pane) => pane.agent && !pane.dead).length,
      linked: panes.filter((pane) => pane.agent?.linkedSessionId && !pane.dead).length,
    };
    return projected;
  }

  function projectVisibleSnapshot(snapshot = state.rawSnapshot || state.snapshot) {
    if (!snapshot) return snapshot;
    const sessions = (snapshot.sessions || []).filter((session) => (
      isSourcePluginVisible(session.sourcePluginId)
      && (session.sourcePluginId || isProviderVisible(session.provider))
      && isDesktopSessionVisible(session)
    ));
    const usage = Object.fromEntries(USAGE_KEYS.map((key) => [
      key,
      sessions.reduce((sum, session) => sum + Number(session.usage?.[key] || 0), 0),
    ]));
    const activeSession = session => session.status === "running" || session.status === "starting";
    const providers = (snapshot.summary?.providers || []).filter((provider) => isProviderVisible(provider.id)).map((provider) => {
      const own = sessions.filter((session) => session.provider === provider.id);
      return {
        ...provider,
        sessions: own.length,
        active: own.filter(activeSession).length,
        waiting: own.filter((session) => session.status === "waiting").length,
        subagents: own.filter((session) => session.parentId).length,
        usage: Object.fromEntries(USAGE_KEYS.map((key) => [
          key,
          own.reduce((sum, session) => sum + Number(session.usage?.[key] || 0), 0),
        ])),
      };
    });
    return {
      ...snapshot,
      sessions,
      tmux: visibleTmux(snapshot.tmux),
      summary: {
        ...(snapshot.summary || {}),
        providers,
        totals: {
          sessions: sessions.length,
          active: sessions.filter(activeSession).length,
          waiting: sessions.filter((session) => session.status === "waiting").length,
          subagents: sessions.filter((session) => session.parentId).length,
          usage,
        },
      },
    };
  }

  function setProviderVisible(providerId, visible) {
    const id = String(providerId || "");
    if (!state.providers.some((provider) => provider.id === id)) return;
    if (visible) state.hiddenProviders.delete(id);
    else state.hiddenProviders.add(id);
    state.providerFilters.delete(id);
    if (!isProviderVisible(state.runProvider)) {
      state.runProvider = visibleProviders().find((provider) => state.availability[provider.id])?.id
        || visibleProviders()[0]?.id
        || "";
    }
    saveProviderVisibility();
    if (state.rawSnapshot) state.snapshot = projectVisibleSnapshot(state.rawSnapshot);
  }

  return {
    PROVIDER_VISIBILITY_STORAGE_KEY: STORAGE_KEY,
    loadProviderVisibility,
    saveProviderVisibility,
    isProviderVisible,
    isSourcePluginVisible,
    desktopSourcePluginId,
    isDesktopSessionVisible,
    visibleProviders,
    visibleSessions,
    visibleTmux,
    projectVisibleSnapshot,
    visibleSnapshot: () => projectVisibleSnapshot(),
    setProviderVisible,
  };
};
