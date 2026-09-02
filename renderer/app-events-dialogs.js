"use strict";

window.WhiteboxAppFactories = window.WhiteboxAppFactories || {};

window.WhiteboxAppFactories.createDialogEventBindings = function createDialogEventBindings(context = {}) {
  const t = (key, params) => window.WhiteboxI18n.t(key, params);
  const {
    $, $$, state, providerInfo, visibleProviders = () => state.providers, renderProviderRail, providerPickerHtml, syncRunComposer, openRunModal, closeRunModal, toast, performUiAction,
    handleRun, trapDialogFocus, currentDialog, selectView, selectViewFromUser = selectView, saveRunDraft = () => {}, safeBackdrop = null,
    closePtyFocus = () => false,
    isPtyFocusActive = () => false,
  } = context;

  function bindRunComposerEvents() {
    const bindSourcePicker = () => {
      const picker = $("#runSourcePicker");
      if (!picker || picker.dataset.bound === "true") return;
      picker.dataset.bound = "true";
      picker.addEventListener("click", (event) => {
        const button = event.target.closest("[data-run-source]");
        if (!button || button.disabled) return;
        state.runSource = button.dataset.runSource;
        picker.innerHTML = context.sourcePickerHtml?.() || "";
        syncRunComposer();
        saveRunDraft();
      });
      picker.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        const options = [...picker.querySelectorAll("[data-run-source]:not(:disabled)")];
        const current = Math.max(0, options.indexOf(event.target.closest("[data-run-source]")));
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
          : (current + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + options.length) % options.length;
        event.preventDefault();
        options[next]?.click();
        options[next]?.focus();
      });
    };
    $("#newRunBtn").addEventListener("click", openRunModal);
    $$("[data-open-run]").forEach((button) => button.addEventListener("click", openRunModal));
    $("#closeRunModalBtn").addEventListener("click", () => closeRunModal());
    $("#cancelRunBtn").addEventListener("click", () => closeRunModal());
    context.ensureRunSourcePicker?.();
    bindSourcePicker();
    $("#runSourceHelp")?.addEventListener("click", async (event) => {
      const recheck = event.target.closest("[data-source-recheck]");
      if (recheck) {
        const sources = await performUiAction(() => window.whitebox.refreshSources(), "출처 연결을 다시 확인하지 못했습니다.", recheck);
        if (sources) state.sourcePlugins = sources;
        context.ensureRunSourcePicker?.();
        bindSourcePicker();
        syncRunComposer();
        return;
      }
      const pickFolder = event.target.closest("[data-aside-history-pick]");
      if (pickFolder) {
        const result = await performUiAction(() => window.whitebox.pickAsideHistoryFolder(), "Aside 작업 폴더를 연결하지 못했습니다.", pickFolder);
        if (result?.settings) state.sourcePluginSettings = result.settings;
        syncRunComposer();
        return;
      }
      const removeFolder = event.target.closest("[data-aside-history-remove]");
      if (removeFolder) {
        const folder = removeFolder.dataset.asideHistoryRemove;
        const result = await performUiAction(() => window.whitebox.removeAsideHistoryFolder(folder), "Aside 작업 폴더 연결을 해제하지 못했습니다.", removeFolder);
        if (result?.settings) state.sourcePluginSettings = result.settings;
        syncRunComposer();
      }
    });
    if (safeBackdrop) safeBackdrop($("#runModal"), () => closeRunModal());
    else $("#runModal").addEventListener("click", (event) => {
      if (event.target === $("#runModal")) closeRunModal();
    });
    $("#runProviderPicker").addEventListener("click", (event) => {
      const button = event.target.closest("[data-run-provider]");
      if (!button || button.disabled) return;
      state.runProvider = button.dataset.runProvider;
      $("#runProviderPicker").innerHTML = providerPickerHtml();
      syncRunComposer();
      saveRunDraft();
    });
    $("#runProviderPicker").addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      const options = $$("#runProviderPicker [data-run-provider]:not(:disabled)");
      const current = Math.max(0, options.indexOf(event.target.closest("[data-run-provider]")));
      const next = event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (current + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + options.length) % options.length;
      event.preventDefault();
      options[next]?.click();
      requestAnimationFrame(() => $("#runProviderPicker").querySelector(`[data-run-provider="${CSS.escape(state.runProvider)}"]`)?.focus());
    });
    $("#runProviderHelp").addEventListener("click", async (event) => {
      const docs = event.target.closest("[data-provider-docs]");
      if (docs) {
        const provider = providerInfo(docs.dataset.providerDocs);
        if (provider.docs)
          await performUiAction(async () => {
            const result = await window.whitebox.openExternal(provider.docs);
            if (!result || result.ok === false) throw new Error(t("run.docs_open_failed"));
          }, t("run.docs_open_failed"), docs);
        return;
      }
      const recheck = event.target.closest("[data-provider-recheck]");
      if (recheck) {
        const nextAvailability = await performUiAction(() => window.whitebox.probeProviders(), t("run.cli_check_failed"), recheck);
        if (!nextAvailability) return;
        state.availability = nextAvailability;
        const installed = visibleProviders().find((provider) => state.availability[provider.id]);
        if (installed) state.runProvider = installed.id;
        $("#runProviderPicker").innerHTML = providerPickerHtml();
        renderProviderRail();
        syncRunComposer();
        toast(installed ? t("run.cli_ready", { provider: installed.label }) : t("run.cli_not_found"));
      }
    });
    $("#runPrompt").addEventListener("input", syncRunComposer);
    $(".run-prompt-examples").addEventListener("click", (event) => {
      const example = event.target.closest("[data-run-prompt-key]");
      if (!example) return;
      const input = $("#runPrompt");
      const text = t(example.dataset.runPromptKey);
      if (!input.value.trim()) input.value = text;
      else input.setRangeText(`${input.selectionStart ? "\n\n" : ""}${text}`, input.selectionStart, input.selectionEnd, "end");
      syncRunComposer();
      saveRunDraft();
      input.focus();
    });
    $("#runWorkspaceSuggestions").addEventListener("click", (event) => {
      if ($("#runCwd").readOnly) return;
      const workspace = event.target.closest("[data-run-workspace]");
      if (!workspace) return;
      $("#runCwd").value = workspace.dataset.runWorkspace;
      syncRunComposer();
      saveRunDraft();
    });
    $("#runWorkspaceSuggestions").addEventListener("keydown", (event) => {
      if ($("#runCwd").readOnly) return;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const options = $$("#runWorkspaceSuggestions [data-run-workspace]");
      const current = Math.max(0, options.indexOf(event.target.closest("[data-run-workspace]")));
      const next = event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
      event.preventDefault();
      options[next]?.focus();
    });
    $("#runCwd").addEventListener("input", syncRunComposer);
    $("#allowWrites").addEventListener("change", syncRunComposer);
    $("#runClaudePermissionMode")?.addEventListener("change", () => {
      syncRunComposer();
      saveRunDraft();
    });
    $("#pickRunCwdBtn").addEventListener("click", async () => {
      if ($("#runCwd").readOnly) return;
      const folder = await performUiAction(() => window.whitebox.pickWorkspace(), t("workspace.pick_failed"), $("#pickRunCwdBtn"));
      if (folder) {
        $("#runCwd").value = folder;
        syncRunComposer();
        saveRunDraft();
      }
    });
    $("#runForm").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        $("#runForm").requestSubmit();
      }
    });
    $("#runForm").addEventListener("submit", handleRun);
    $("#runForm").addEventListener("invalid", (event) => {
      event.target.setAttribute("aria-invalid", "true");
      if (!$("#runForm").dataset.invalidFocusQueued) {
        $("#runForm").dataset.invalidFocusQueued = "true";
        queueMicrotask(() => {
          delete $("#runForm").dataset.invalidFocusQueued;
          $("#runForm").querySelector(":invalid")?.focus({ preventScroll: true });
        });
      }
    }, true);
    $("#runForm").addEventListener("input", (event) => {
      if (event.target.matches("input, textarea, select") && event.target.checkValidity()) event.target.removeAttribute("aria-invalid");
      $("#runError").classList.add("hidden");
      $("#runError").textContent = "";
    });
  }

  function bindGlobalEvents() {
    document.addEventListener("keydown", (event) => {
      trapDialogFocus(event);
      const editable = event.target instanceof HTMLElement && Boolean(event.target.closest("input, textarea, select, [contenteditable='true']"));
      const dialogOpen = Boolean(currentDialog?.() || isPtyFocusActive());
      const viewShortcuts = ["all", "active", "waiting", null, null, null, "settings"];
      const shortcutView = viewShortcuts[Number(event.key) - 1];
      if (!editable && !dialogOpen && shortcutView && (event.metaKey || event.ctrlKey) && /^[1-7]$/.test(event.key)) {
        event.preventDefault();
        selectViewFromUser(shortcutView, { focusMain: true });
        return;
      }
      if (!editable && !dialogOpen && event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        if (state.view !== "active") selectViewFromUser("active");
        $("#searchInput").focus();
        return;
      }
      if (!editable && !dialogOpen && event.key.toLowerCase() === "n" && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        if ($("#runModal").classList.contains("hidden")) openRunModal();
        return;
      }
      if (event.key !== "Escape") return;
      if (!$("#runModal").classList.contains("hidden")) closeRunModal();
      else if (isPtyFocusActive()) closePtyFocus();
    });
  }

  function bindDialogAndGlobalEvents() {
    bindRunComposerEvents();
    bindGlobalEvents();
  }

  return { bindDialogAndGlobalEvents };
};
