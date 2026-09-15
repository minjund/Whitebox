"use strict";

window.WhiteboxAppFactories = window.WhiteboxAppFactories || {};

window.WhiteboxAppFactories.createQuestionnaireInbox = function createQuestionnaireInbox(context = {}) {
  const { $, esc, state, matchesWorkspaceFilter, currentDialog, comprehensionPacketController: controller } = context;
  const api = window.WhiteboxComprehensionPacket;
  const t = (key, params) => window.WhiteboxI18n.t(key, params);
  const entries = new Map();
  const pending = new Set();
  let initialized = false;
  let queued = false;
  let lastHtml = "";

  function inControlRoom() {
    return state.view === "all" && !context.isPtyFocusActive?.();
  }

  function scheduleSync() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; syncQuestionnaireInbox(); });
  }

  function visibleEntries() {
    const visibleSessions = new Map((state.snapshot?.sessions || []).map(session => [session.id, session]));
    return [...entries].filter(([, entry]) => {
      const current = visibleSessions.get(entry.id);
      return current && matchesWorkspaceFilter(current);
    });
  }

  function openQuestionnaire(key, { auto = false } = {}) {
    const entry = visibleEntries().find(([id]) => id === key)?.[1];
    if (!entry || !inControlRoom() || currentDialog?.()) return false;
    if (!controller.mount(entry, { surface: document.body, autoPresent: false })) return false;
    pending.delete(key);
    if (auto && controller.getProgress()?.autoPresented) {
      controller.unmount();
      return false;
    }
    return controller.open({ auto });
  }

  function syncQuestionnaireInbox() {
    if (!state.snapshot || !controller) return;
    const sessions = state.snapshot.sessions || [];
    const ids = new Set(sessions.map(session => session.id));
    for (const session of sessions) {
      if (!api.isEligibleSession(session)) continue;
      const key = JSON.stringify([session.id,
        session.comprehensionOrigin?.generation || api.completionGenerationIdentity(session),
        api.packetContentFingerprint(session.comprehension.packet)]);
      if (!entries.has(key)) {
        if (initialized) pending.add(key);
        entries.set(key, session);
      }
    }
    initialized = true;
    for (const [key, entry] of entries) {
      if (!ids.has(entry.id)) { entries.delete(key); pending.delete(key); }
    }
    while (entries.size > 200) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
      pending.delete(oldest);
    }
    const visible = visibleEntries();
    const creating = sessions.filter(session => !session.parentId && !Number(session.depth || 0)
      && session.status === "completed" && matchesWorkspaceFilter(session)
      && ["queued", "generating"].includes(session.comprehension?.status)).length;
    const section = $("#questionnaireInbox");
    section.classList.toggle("hidden", !inControlRoom() || (!visible.length && !creating));
    $("#questionnaireInboxCount").textContent = t("questionnaire.inbox_count", { count: visible.length });
    $("#questionnaireInboxStatus").textContent = creating ? t("questionnaire.inbox_creating", { count: creating }) : "";
    const html = visible.slice().reverse().map(([key, session]) => `<button type="button" class="questionnaire-inbox-item" data-questionnaire-open="${esc(key)}">
      <span><b>${esc(session.comprehension.packet.title)}</b><small>${esc(session.workspace || session.title || session.provider)}</small></span>
      <span class="questionnaire-inbox-action">${esc(t("questionnaire.inbox_open", { count: session.comprehension.packet.questions.length }))} ↗</span>
    </button>`).join("");
    if (html !== lastHtml) {
      $("#questionnaireInboxList").innerHTML = html;
      lastHtml = html;
    }

    const ownsPresentation = controller.getSurface() === document.body;
    if (ownsPresentation && (!inControlRoom() || !visible.some(([, entry]) => entry.id === controller.getSessionId()))) {
      controller.unmount();
    }
    if (!inControlRoom() || controller.isOpen() || !context.initialized || currentDialog?.()) return;
    for (const [key] of visible) {
      if (pending.has(key) && openQuestionnaire(key, { auto: true })) break;
    }
  }

  $("#questionnaireInboxList").addEventListener("click", event => {
    const button = event.target.closest("[data-questionnaire-open]");
    if (button) openQuestionnaire(button.dataset.questionnaireOpen);
  });
  window.addEventListener("whitebox:questionnaire-closed", scheduleSync);
  // Retry presentation after another dialog closes or the user returns from PTY.
  const observer = new MutationObserver(scheduleSync);
  observer.observe($("#appShell"), { attributes: true, attributeFilter: ["inert"] });
  observer.observe($("#ptyFocusSurface"), { attributes: true, attributeFilter: ["class", "aria-hidden", "data-pty-focus-session"] });
  window.addEventListener("beforeunload", () => observer.disconnect(), { once: true });

  return { syncQuestionnaireInbox };
};
