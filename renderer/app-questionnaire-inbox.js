"use strict";

window.WhiteboxAppFactories = window.WhiteboxAppFactories || {};

window.WhiteboxAppFactories.createQuestionnaireInbox = function createQuestionnaireInbox(context = {}) {
  const { $, esc, state, matchesWorkspaceFilter, currentDialog, comprehensionPacketController: controller } = context;
  const api = window.WhiteboxComprehensionPacket;
  const t = (key, params) => window.WhiteboxI18n.t(key, params);
  const entries = new Map();
  let queued = false;
  let lastHtml = "";
  let presentedKey = null;

  function inControlRoom() {
    return state.view === "all" && !context.isPtyFocusActive?.();
  }

  function scheduleSync() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; syncQuestionnaireInbox(); });
  }

  function matchesQuestionnaire(session) {
    const cmux = window.WhiteboxCmux;
    if (!cmux?.isMember(session)) return matchesWorkspaceFilter(session);
    const group = cmux.questionnaireGroup(session);
    if (!group) return false;
    // Exact group selection filters ordinary cards by group ID. Its quiz is
    // owned by the orchestrator's conversation, not the synthetic group row.
    return matchesWorkspaceFilter({ ...session, id: group.id, cwd: group.cwd, workspace: group.cwd, parentId: null, workspaceRoots: [group.cwd] });
  }

  function visibleEntries() {
    const visibleSessions = new Map((state.snapshot?.sessions || []).map(session => [session.id, session]));
    return [...entries].map(([key, entry]) => [key, { ...entry, cmux: visibleSessions.get(entry.id)?.cmux || entry.cmux }]).filter(([, entry]) => {
      const current = visibleSessions.get(entry.id);
      if (!current || !matchesQuestionnaire(current)) return false;
      if (window.WhiteboxCmux?.isMember(current)) {
        // A retained quiz from an earlier turn must not appear as the current
        // terminal's result after a new prompt or /clear.
        return api.isEligibleSession(current)
          && entry.comprehensionOrigin?.generation === current.comprehensionOrigin?.generation
          && api.packetContentFingerprint(entry.comprehension.packet) === api.packetContentFingerprint(current.comprehension.packet);
      }
      return true;
    });
  }

  function openQuestionnaire(key) {
    const entry = visibleEntries().find(([id]) => id === key)?.[1];
    if (!entry || !inControlRoom() || currentDialog?.()) return false;
    if (!controller.mount(entry, { surface: document.body, autoPresent: false })) return false;
    const opened = controller.open({ auto: false });
    if (opened) presentedKey = key;
    return opened;
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
        entries.set(key, session);
      }
    }
    for (const [key, entry] of entries) {
      if (!ids.has(entry.id)) entries.delete(key);
    }
    while (entries.size > 200) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
    }
    const visible = visibleEntries();
    const creating = sessions.filter(session => !session.parentId && !Number(session.depth || 0)
      && session.status === "completed" && matchesQuestionnaire(session)
      && ["queued", "generating"].includes(session.comprehension?.status)).length;
    const groupId = window.WhiteboxCmux?.currentGroupId();
    const groupEntries = visible.filter(([, session]) => window.WhiteboxCmux?.questionnaireGroup(session)?.id === groupId);
    const detailButton = document.querySelector('[data-cmux-questionnaire]');
    if (detailButton) {
      const leader = sessions.find(session => window.WhiteboxCmux?.questionnaireGroup(session)?.id === groupId);
      const complete = leader?.status === 'completed' && leader.completionObserved === true;
      const phase = leader?.comprehension?.status;
      const generating = complete && ['checking', 'queued', 'generating'].includes(phase);
      detailButton.hidden = !leader;
      detailButton.disabled = !groupEntries.length && (!complete || generating);
      delete detailButton.dataset.retrySession;
      detailButton.title = '현재 오케스트레이터의 완료 답변을 바탕으로 만듭니다.';
      if (groupEntries.length) detailButton.textContent = `AI 질문지 ${groupEntries.length}`;
      else if (generating) detailButton.textContent = 'AI 질문지 생성 중…';
      else if (!complete) { detailButton.textContent = 'AI 질문지 · 완료 대기'; detailButton.title = '오케스트레이터의 완료 보고가 도착하면 생성합니다.'; }
      else {
        detailButton.dataset.retrySession = leader.id;
        detailButton.textContent = phase === 'failed' ? 'AI 질문지 다시 만들기' : phase === 'skipped' ? 'AI 질문지 다시 확인' : 'AI 질문지 만들기';
        if (phase === 'failed') detailButton.title = '질문지 생성에 실패했습니다. 클릭하면 현재 완료 답변으로 다시 시도합니다.';
        if (phase === 'skipped') detailButton.title = '완료 결과가 부족하거나 생성 중 대화가 바뀌어 건너뛰었습니다. 클릭하면 현재 완료 답변을 다시 확인합니다.';
      }
    }
    const section = $("#questionnaireInbox");
    section.classList.toggle("hidden", !inControlRoom() || (!visible.length && !creating));
    $("#questionnaireInboxCount").textContent = t("questionnaire.inbox_count", { count: visible.length });
    $("#questionnaireInboxStatus").textContent = creating ? t("questionnaire.inbox_creating", { count: creating }) : "";
    const html = visible.slice().reverse().map(([key, session]) => `<button type="button" class="questionnaire-inbox-item" data-questionnaire-open="${esc(key)}">
      <span><b>${esc(session.comprehension.packet.title)}</b><small>${esc(window.WhiteboxCmux?.questionnaireGroup(session)?.title ? `${window.WhiteboxCmux.questionnaireGroup(session).title} · 오케스트레이터` : session.workspace || session.title || session.provider)}</small></span>
      <span class="questionnaire-inbox-action">${esc(t("questionnaire.inbox_open", { count: session.comprehension.packet.questions.length }))} ↗</span>
    </button>`).join("");
    if (html !== lastHtml) {
      $("#questionnaireInboxList").innerHTML = html;
      lastHtml = html;
    }

    const ownsPresentation = controller.getSurface() === document.body;
    if (ownsPresentation && (!inControlRoom() || !visible.some(([key, entry]) => entry.id === controller.getSessionId() && key === presentedKey))) {
      controller.unmount();
    }
  }

  $("#questionnaireInboxList").addEventListener("click", event => {
    const button = event.target.closest("[data-questionnaire-open]");
    if (button) openQuestionnaire(button.dataset.questionnaireOpen);
  });
  window.addEventListener("whitebox:questionnaire-closed", scheduleSync);
  // Keep the inbox visibility in sync when dialogs or PTY focus close.
  const observer = new MutationObserver(scheduleSync);
  observer.observe($("#appShell"), { attributes: true, attributeFilter: ["inert"] });
  observer.observe($("#ptyFocusSurface"), { attributes: true, attributeFilter: ["class", "aria-hidden", "data-pty-focus-session"] });
  window.addEventListener("beforeunload", () => observer.disconnect(), { once: true });

  function openLatestCmuxQuestionnaire(groupId) {
    const latest = visibleEntries().filter(([, session]) => window.WhiteboxCmux?.questionnaireGroup(session)?.id === groupId).at(-1);
    return latest ? openQuestionnaire(latest[0]) : false;
  }
  return { syncQuestionnaireInbox, openLatestCmuxQuestionnaire };
};
