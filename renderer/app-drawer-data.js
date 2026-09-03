"use strict";

window.WhiteboxAppFactories = window.WhiteboxAppFactories || {};

window.WhiteboxAppFactories.createDrawerData = function createDrawerData(context = {}) {
  const t = (key, params) => window.WhiteboxI18n.t(key, params);
  const { reportRecoverableError, state } = context;
  const detailRequests = new Map();
  let detailRequestGeneration = 0;

  function observedSnapshotVersion(id, explicitVersion = "") {
    const requested = String(explicitVersion || "").trim();
    if (requested) return requested;
    const card = (state.snapshot?.sessions || []).find(session => session.id === id);
    return String(card?.updatedAt || "").trim();
  }

  function openDrawerDependsOnDetail(id) {
    if (state.selectedId === id) return true;
    if (!["subagent", "execution"].includes(state.drawerMode)) return false;
    const selected = (state.snapshot?.sessions || []).find(session => session.id === state.selectedId)
      || state.details.get(state.selectedId);
    return selected?.parentId === id;
  }

  async function loadSessionDetail(id, force = false, snapshotVersion = "", followup = false) {
    if (!force && state.details.has(id)) return state.details.get(id);
    const observedVersion = observedSnapshotVersion(id, snapshotVersion);
    // A live snapshot can advance again while the previous detail request is
    // still running. Share that request instead of stacking more full-history
    // reads for the same session.
    if (detailRequests.has(id)) {
      const active = detailRequests.get(id);
      // Keep only one in-flight read plus the newest queued snapshot. If the
      // snapshot advances during a corrective read, queue one more correction
      // so the drawer cannot settle permanently one generation behind.
      if (force && (!observedVersion
        || !active.snapshotVersion
        || observedVersion !== active.snapshotVersion)) {
        active.refreshQueued = true;
        if (observedVersion) active.queuedSnapshotVersion = observedVersion;
      }
      return active.promise;
    }
    const hadCachedDetail = state.details.has(id);
    const generation = ++detailRequestGeneration;
    state.detailErrors.delete(id);
    state.detailLoadingIds.add(id);
    context.renderDrawer();
    const promise = (async () => {
      try {
        const detail = await window.whitebox.sessionDetail(id);
        const active = detailRequests.get(id);
        // If a newer snapshot arrived during this read, do not briefly replace
        // the live preview/cache with the now-known stale response. The queued
        // follow-up below owns the next committed full-history value.
        if (active?.generation === generation && !active.refreshQueued && detail) {
          state.details.set(id, detail);
          // PTY focus details do not own the drawer selection, so the drawer's
          // selectedId-based rerender below cannot refresh their open modal.
          // Notify that surface only after a full-history value actually
          // commits (including the bounded queued follow-up).
          context.renderPtyFocusDetail?.();
        }
        return detail;
      } catch (error) {
        const active = detailRequests.get(id);
        if (active?.generation === generation && !active.refreshQueued)
          state.detailErrors.set(id, window.WhiteboxI18n.errorText(error, "drawer.history_failed"));
        return null;
      } finally {
        const active = detailRequests.get(id);
        if (active?.generation === generation) {
          const refreshQueued = Boolean(active.refreshQueued);
          const queuedSnapshotVersion = active.queuedSnapshotVersion || "";
          detailRequests.delete(id);
          state.detailLoadingIds.delete(id);
          if (openDrawerDependsOnDetail(id)) {
            if (!hadCachedDetail) state.drawerForceLatest = state.drawerTab === "chat";
            context.renderDrawer();
          }
          // A newer lightweight snapshot may have arrived while this full
          // history request was in flight. Run exactly one follow-up read for
          // that burst after releasing the shared promise; any still newer
          // snapshot will queue one more read on the new request.
          if (refreshQueued) {
            Promise.resolve()
              .then(() => loadSessionDetail(id, true, queuedSnapshotVersion, true))
              .catch(error => reportRecoverableError("session-detail-follow-up", error));
          }
        }
      }
    })();
    detailRequests.set(id, {
      generation,
      promise,
      refreshQueued: false,
      snapshotVersion: observedVersion,
      queuedSnapshotVersion: "",
      followup: Boolean(followup),
    });
    return promise;
  }

  async function loadSubagentParentDetail(child, force = false, snapshotVersion = "") {
    if (!child?.parentId) return null;
    if (!force && state.details.has(child.parentId)) return state.details.get(child.parentId);
    return loadSessionDetail(child.parentId, force, snapshotVersion);
  }

  return { loadSessionDetail, loadSubagentParentDetail };
};
