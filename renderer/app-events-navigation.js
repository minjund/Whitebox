"use strict";

window.WhiteboxAppFactories = window.WhiteboxAppFactories || {};

window.WhiteboxAppFactories.createNavigationEventBindings = function createNavigationEventBindings(context = {}) {
  const t = (key, params) => window.WhiteboxI18n.t(key, params);
  const {
    $, state, motionPreference, saveGuideState, selectView, selectViewFromUser = selectView, renderUpdateSettings,
    filteredSessions, renderSessions, openRunModal, openDrawer, toast, performUiAction,
  } = context;

  function bindNavigationAndUpdateEvents() {
    $(".view-nav").addEventListener("click", (event) => {
      const button = event.target.closest(".nav-item");
      if (!button || !button.dataset.view) return;
      selectViewFromUser(button.dataset.view);
    });
    $("#sidebarSettingsBtn")?.addEventListener("click", () => {
      selectViewFromUser("settings");
    });
    $("#backToProjectsBtn")?.addEventListener("click", () => {
      selectViewFromUser("all", { focusMain: true });
    });
    $(".view-nav").addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      const buttons = Array.from(document.querySelectorAll(".view-nav .nav-item[data-view]"))
        .filter((button) => !button.hidden && button.getClientRects().length > 0 && getComputedStyle(button).visibility !== "hidden");
      const current = Math.max(0, buttons.indexOf(event.target.closest(".nav-item[data-view]")));
      const next = event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
      event.preventDefault();
      buttons[next]?.focus();
    });
    $("#updateNoticeBtn").addEventListener("click", () => {
      selectViewFromUser("settings");
    });
    $("#guideBtn").addEventListener("click", () => {
      state.guideExpanded = !state.guideExpanded || state.view !== "all";
      saveGuideState();
      if (state.view !== "all") selectViewFromUser("all");
      else renderSessions("guide");
      if (state.guideExpanded) {
        setTimeout(
          () => $("#beginnerGuide").scrollIntoView({ behavior: motionPreference.matches ? "auto" : "smooth", block: "start" }),
          0,
        );
      }
    });
    $("#dismissGuideBtn").addEventListener("click", () => {
      state.guideExpanded = false;
      saveGuideState();
      renderSessions("guide");
      $("#mainContent").focus({ preventScroll: true });
    });
    $("#beginnerGuide").addEventListener("click", (event) => {
      const action = event.target.closest("[data-guide-action]")?.dataset.guideAction;
      if (!action) return;
      if (action === "create") return openRunModal();
      if (action === "active" || action === "waiting") return selectViewFromUser(action, { focusMain: true });
      if (action === "detail") {
        const first = filteredSessions()[0] || ((state.snapshot && state.snapshot.sessions) || [])[0];
        if (first) openDrawer(first.id);
        else {
          toast(t("guide.no_task_to_open"));
          openRunModal();
        }
      }
    });
    $("#checkUpdateBtn").addEventListener("click", async () => {
      state.update = { ...(state.update || {}), status: "checking", error: "" };
      renderUpdateSettings();
      const update = await performUiAction(() => window.whitebox.checkForUpdate(), "ui.could_not_check_for_updates", $("#checkUpdateBtn"));
      if (update) state.update = update;
      else state.update = { ...(state.update || {}), status: "error" };
      renderUpdateSettings();
    });
    $("#installUpdateBtn").addEventListener("click", async () => {
      state.update = { ...(state.update || {}), status: "downloading", error: "" };
      renderUpdateSettings();
      const update = await performUiAction(() => window.whitebox.installDownloadedUpdate(), "ui.could_not_prepare_the_update_file", $("#installUpdateBtn"));
      if (update) state.update = update;
      else if (state.update && state.update.asset) state.update.status = "available";
      renderUpdateSettings();
      if (state.update && state.update.installMode === "manual") toast(t("ui.open_installer"));
    });
    $("#openReleaseBtn").addEventListener("click", async () => {
      await performUiAction(() => window.whitebox.openUpdateRelease(), "ui.could_not_open_the_github_release_page", $("#openReleaseBtn"));
    });
  }

  return { bindNavigationAndUpdateEvents };
};
