"use strict";

window.WhiteboxAppFactories = window.WhiteboxAppFactories || {};

window.WhiteboxAppFactories.createQuestionnaireSettings = function createQuestionnaireSettings(context = {}) {
  const { $, state, setDialogOpenState, rememberDialogTrigger, restoreDialogTrigger, toast, announce } = context;
  const t = (key) => window.WhiteboxI18n.t(key);
  let saving = false;
  let bound = false;
  let focusToken = null;

  function loadQuestionnaireSettings(value) {
    state.questionnaire = {
      configured: value?.configured === true,
      enabled: value?.configured === true && value?.enabled === true,
    };
  }

  function renderQuestionnaireSettings() {
    const input = $("#questionnaireEnabled");
    if (!input) return;
    input.checked = state.questionnaire?.enabled === true;
    input.disabled = saving;
    input.setAttribute("aria-checked", String(input.checked));
    $("#questionnaireStatus").textContent = t(!state.questionnaire?.configured
      ? "questionnaire.unconfigured" : input.checked ? "questionnaire.enabled" : "questionnaire.disabled");
    $("#questionnaireSetupModal").setAttribute("aria-busy", String(saving));
    $("#questionnaireEnableBtn").disabled = saving;
    $("#questionnaireSkipBtn").disabled = saving;
  }

  function showQuestionnaireSetup() {
    const modal = $("#questionnaireSetupModal");
    if (state.questionnaire?.configured || !modal?.classList.contains("hidden")) return;
    focusToken = rememberDialogTrigger(modal.id);
    modal.classList.remove("hidden");
    setDialogOpenState(modal, true);
    $("#questionnaireSetupTitle").focus({ preventScroll: true });
  }

  async function saveQuestionnaireSettings(enabled) {
    if (saving) return;
    saving = true;
    const errorNode = $("#questionnaireSetupError");
    errorNode.textContent = "";
    errorNode.classList.add("hidden");
    renderQuestionnaireSettings();
    try {
      const saved = await window.whitebox.setQuestionnairePreference({ enabled });
      if (saved?.configured !== true || saved.enabled !== enabled) throw new Error("Questionnaire preference was not saved.");
      loadQuestionnaireSettings(saved);
      const modal = $("#questionnaireSetupModal");
      if (!modal.classList.contains("hidden")) {
        modal.classList.add("hidden");
        setDialogOpenState(modal, false);
        restoreDialogTrigger(focusToken);
        focusToken = null;
      }
      const message = t(enabled ? "questionnaire.enabled" : "questionnaire.disabled");
      toast(message);
      announce(message);
    } catch (error) {
      window.WhiteboxRendererUtils.reportRecoverableError("questionnaire-preference-save", error);
      errorNode.textContent = t("questionnaire.save_failed");
      errorNode.classList.remove("hidden");
      toast(t("questionnaire.save_failed"));
      announce(t("questionnaire.save_failed"));
    } finally {
      saving = false;
      renderQuestionnaireSettings();
    }
  }

  function bindQuestionnaireSettings() {
    if (bound) return;
    bound = true;
    renderQuestionnaireSettings();
    $("#questionnaireEnableBtn").addEventListener("click", () => void saveQuestionnaireSettings(true));
    $("#questionnaireSkipBtn").addEventListener("click", () => void saveQuestionnaireSettings(false));
    $("#questionnaireEnabled").addEventListener("change", event => void saveQuestionnaireSettings(event.target.checked));
    document.addEventListener("keydown", event => {
      if ($("#questionnaireSetupModal").classList.contains("hidden") || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        void saveQuestionnaireSettings(false);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  return { loadQuestionnaireSettings, renderQuestionnaireSettings, showQuestionnaireSetup, bindQuestionnaireSettings };
};
