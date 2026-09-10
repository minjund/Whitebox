"use strict";

(function exposeComprehensionPacket(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.WhiteboxComprehensionPacket = api;
    root.WhiteboxComprehension = Object.freeze({
      ...(root.WhiteboxComprehension || {}),
      injectPrompt: api.injectContract,
      stripPromptContract: api.stripContract,
      hasPromptContract: api.hasContract,
      createComprehensionPacket: api.createComprehensionPacket,
    });
    root.WhiteboxAppFactories = root.WhiteboxAppFactories || {};
    root.WhiteboxAppFactories.createComprehensionPacketMode = function createComprehensionPacketMode(context = {}) {
      const controller = api.createComprehensionPacket({ ...context, autoObserve: true });
      return {
        comprehensionPacketController: controller,
        syncComprehensionPacket: controller.syncFromSurface,
        openComprehensionPacket: controller.open,
        closeComprehensionPacket: controller.close,
      };
    };
  }
})(typeof window !== "undefined" ? window : globalThis, function createComprehensionPacketApi(root) {
  const SCHEMA_VERSION = 1;
  const CONTRACT_OPEN = '<whitebox-comprehension-contract version="1">';
  const CONTRACT_CLOSE = "</whitebox-comprehension-contract>";
  const ENVELOPE_OPEN = '<whitebox-comprehension-packet version="1">';
  const ENVELOPE_CLOSE = "</whitebox-comprehension-packet>";
  const STORAGE_PREFIX = "whitebox:comprehension:v1";
  let instanceSequence = 0;

  const FALLBACK_MESSAGES = Object.freeze({
    prompt_empty: "작업 내용을 입력하세요.",
    reserved_marker: "작업 내용에 예약된 이해 패킷 태그가 포함되어 있습니다.",
    issue_button: "문제 오류",
    issue_aria: "문제 오류로 제외: {prompt}",
    wrong_kind: "오답 · {kind}",
    topic_change: "변경",
    topic_decision: "결정",
    topic_constraint_risk: "제약·위험",
    evidence_chip: "근거 · {label}",
    required_initial: "이 문항의 답을 선택하세요.",
    required_variant: "변형 문제의 답을 선택하세요.",
    variant_correct: "정답입니다. 같은 원리를 다른 상황에도 적용했습니다.",
    correct_answer: "정답 · {answer}",
    debt_resolved_score_unchanged: "이해 부채를 해소했습니다. 오답 점수는 그대로 유지됩니다.",
    understood_button: "해설을 읽었고 이해했음",
    status_retry: "재확인",
    status_confirmed: "확인됨",
    status_explanation_reviewed: "해설 확인",
    explanation_title: "정답을 판단하는 핵심",
    variant_title: "변형 문제 · {prompt}",
    retry_button: "재확인",
    initial_eyebrow: "이해 확인",
    initial_title: "요약을 읽고 {count}문항을 풀어보세요",
    no_questions_title: "평가할 문항이 없습니다.",
    no_questions_initial: "모든 문항이 문제 오류로 제외되어 점수와 이해 부채에 반영되지 않습니다.",
    review_eyebrow: "내 풀이 기록",
    review_title: "답안을 확인하고 오답을 다시 풀어보세요",
    completed_title: "풀었던 문제와 답을 확인하세요",
    answer_label: "내 답",
    correct_label: "정답",
    status_correct: "정답",
    status_variant_correct: "변형 문제 정답",
    status_excluded: "문제 오류 · 평가 제외",
    history_label: "풀었던 문제 목록",
    summary_hint: "AI가 답한 핵심 내용입니다. 이 요약을 참고해 문제를 풀어보세요.",
    no_questions_review: "문제 오류로 제외된 문항은 점수 분모와 이해 부채에 포함되지 않습니다.",
    all_understood_title: "모든 문제를 이해했습니다.",
    explanation_reviewed_title: "해설 확인을 마쳤습니다.",
    all_understood_detail: "이 노드의 이해 부채가 해소되었습니다.",
    debt_only_detail: "오답 점수는 유지되고 이해 부채만 해소되었습니다.",
    not_submitted: "아직 제출하지 않음",
    no_questions_score: "평가 문항 없음 · 0/0",
    question_count: "{count}문항",
    retries_remaining: "재확인 {count}개 남음",
    incorrect_count: "오답 {count}문항",
    final_score: "최종 {score}/{total}",
    comprehension_complete: "이해 확인 완료",
    explanation_complete: "해설 확인 완료",
    review_complete: "확인 완료",
    badge_complete: "이해 확인 · {score}/{total}",
    badge_debt: "이해 부채 · 미확인",
    generating: "질문지 만드는 중",
    generation_failed: "질문지를 만들지 못했습니다",
    generation_retry: "다시 만들기",
    badge_open_aria: "{status}. 이해 패킷 열기",
    missing_initial: "{count}개 문항에 답해주세요.",
    all_correct: "모든 문제를 맞혔습니다.",
    wrong_only: "답안을 저장했습니다. 틀린 문제는 해설을 읽고 다시 풀어보세요.",
    variant_correct_notice: "정답입니다. 변형 문제 결과를 최종 점수에 반영했습니다.",
    variant_wrong_notice: "정답과 해설을 확인한 뒤 이해했음을 표시해주세요.",
    understood_notice: "이해 부채를 해소했습니다. 오답 점수는 변경되지 않습니다.",
    issue_notice: "원문과 변형 문제를 점수 분모와 이해 부채에서 제외했습니다.",
    closed: "이해 패킷을 닫았습니다.",
    closed_debt: "이해 부채가 이 노드에만 남았습니다.",
    badge_open: "패킷 열기",
    header_eyebrow: "이해 패킷 · 완료 즉시 생성됨",
    header_title: "다음 작업을 맡기기 전에 확인하세요",
    difficulty_aria: "난이도 {difficulty}",
    difficulty_label: "난이도 ",
    close_aria: "이해 패킷 닫기",
    briefing_eyebrow: "AI 답변 요약 · 오픈북",
    evidence_label: "실제 근거",
    evidence_mark: "근거",
    submit_answers: "답안 제출",
  });

  function interpolateMessage(template, params = {}) {
    return String(template).replace(/\{([a-zA-Z][\w]*)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
    ));
  }

  function translate(key, params) {
    const messageKey = `comprehension.${key}`;
    try {
      const translated = root?.WhiteboxI18n?.t?.(messageKey, params);
      if (typeof translated === "string" && translated !== messageKey) return translated;
    } catch {}
    return interpolateMessage(FALLBACK_MESSAGES[key] || messageKey, params);
  }

  const CONTRACT_BODY = `You are the main agent for a Whitebox-owned task. If and only if this main task completes successfully, create its comprehension packet in this same final response. Do not call another AI, start another turn, or delegate packet or variant-question generation. Subagents must not emit packets; use their work only as evidence in the main packet.

Write the normal user-visible final answer first. Then append exactly one ${ENVELOPE_OPEN}...${ENVELOPE_CLOSE} block as the final non-whitespace content. Put raw JSON in the block, without a Markdown fence or HTML.

The JSON must use schemaVersion 1 and exactly these fields:
{"schemaVersion":1,"id":"...","title":"...","summary":"...","difficulty":1,"difficultyReason":"...","evidence":[{"id":"...","label":"...","detail":"..."}],"questions":[{"id":"...","kind":"...","topics":["change","decision","constraint-risk"],"prompt":"...","options":[{"id":"...","label":"..."}],"answerId":"...","explanation":"...","evidenceIds":["..."],"variant":{"prompt":"...","options":[{"id":"...","label":"..."}],"answerId":"...","explanation":"..."}}]}

Choose difficulty 1-5 and 1-5 questions from task difficulty, comprehension difficulty, and misunderstanding risk. Across the questions, cover all three topics: change, decision, and constraint-risk. Each question and its pre-generated variant must be multiple choice with 2-6 choices, one valid answerId, an explanation, and real evidence references. Every defined id in the packet must be unique. All text must be plain text with no HTML or executable URL. If a trustworthy packet cannot be produced, omit the packet block; never invent a recovery call.`;
  const CONTRACT_BLOCK = `${CONTRACT_OPEN}\n${CONTRACT_BODY}\n${CONTRACT_CLOSE}`;

  function stripContract(value) {
    const prompt = typeof value === "string" ? value : String(value == null ? "" : value);
    const prefix = `${CONTRACT_BLOCK}\n\n`;
    if (prompt.startsWith(prefix)) return prompt.slice(prefix.length);
    return prompt === CONTRACT_BLOCK ? "" : prompt;
  }

  function hasContract(value) {
    const prompt = typeof value === "string" ? value : String(value == null ? "" : value);
    return prompt === CONTRACT_BLOCK || prompt.startsWith(`${CONTRACT_BLOCK}\n\n`);
  }

  function injectContract(value) {
    const prompt = typeof value === "string" ? value : String(value == null ? "" : value);
    if (!prompt.trim()) {
      const error = new Error(translate("prompt_empty"));
      error.code = "COMPREHENSION_PROMPT_EMPTY";
      throw error;
    }
    if (hasContract(prompt)) return prompt;
    // Tag examples are user content. Only the exact contract prefix above is
    // app framing; preserve every byte of the question after that prefix.
    return `${CONTRACT_BLOCK}\n\n${prompt}`;
  }

  function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function isText(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function optionListIsRenderable(options, answerId) {
    if (!Array.isArray(options) || options.length < 2 || options.length > 6) return false;
    const ids = new Set();
    const labels = new Set();
    for (const option of options) {
      if (!isRecord(option) || !isText(option.id) || !isText(option.label)) return false;
      if (ids.has(option.id) || labels.has(option.label)) return false;
      ids.add(option.id);
      labels.add(option.label);
    }
    return isText(answerId) && ids.has(answerId);
  }

  function isRenderablePacket(packet) {
    if (!isRecord(packet)
      || packet.schemaVersion !== SCHEMA_VERSION
      || !isText(packet.id)
      || !isText(packet.title)
      || !isText(packet.summary)
      || !Number.isInteger(packet.difficulty)
      || packet.difficulty < 1
      || packet.difficulty > 5
      || !isText(packet.difficultyReason)
      || !Array.isArray(packet.evidence)
      || !Array.isArray(packet.questions)
      || packet.questions.length < 1
      || packet.questions.length > 5) return false;

    const evidenceIds = new Set();
    for (const evidence of packet.evidence) {
      if (!isRecord(evidence) || !isText(evidence.id) || !isText(evidence.label) || !isText(evidence.detail)) return false;
      if (evidenceIds.has(evidence.id)) return false;
      evidenceIds.add(evidence.id);
    }

    const questionIds = new Set();
    for (const question of packet.questions) {
      if (!isRecord(question)
        || !isText(question.id)
        || questionIds.has(question.id)
        || !isText(question.kind)
        || !Array.isArray(question.topics)
        || question.topics.length < 1
        || !question.topics.every(isText)
        || !isText(question.prompt)
        || !isText(question.explanation)
        || !optionListIsRenderable(question.options, question.answerId)
        || !Array.isArray(question.evidenceIds)
        || !question.evidenceIds.every(id => isText(id) && evidenceIds.has(id))
        || !isRecord(question.variant)
        || !isText(question.variant.prompt)
        || !isText(question.variant.explanation)
        || !optionListIsRenderable(question.variant.options, question.variant.answerId)) return false;
      questionIds.add(question.id);
    }
    return true;
  }

  function isEligibleSession(session) {
    return Boolean(isRecord(session)
      && isText(String(session.id || ""))
      && session.status === "completed"
      && !session.parentId
      && Number(session.depth || 0) === 0
      && session.completionObserved === true
      && (session.comprehensionContractInjected === true || hasBackgroundOrigin(session))
      && isRecord(session.comprehension)
      && session.comprehension.status === "ready"
      && session.comprehension.schemaVersion === SCHEMA_VERSION
      && isRenderablePacket(session.comprehension.packet));
  }

  function hasBackgroundOrigin(session) {
    return session?.comprehensionOrigin?.authority === "background-questionnaire-v1"
      && /^[a-f0-9]{64}$/u.test(session.comprehensionOrigin.generation || "");
  }

  function canonicalPacketJson(value, seen = new Set()) {
    if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
    if (Array.isArray(value)) {
      if (seen.has(value)) throw new TypeError("cyclic comprehension packet");
      seen.add(value);
      const result = `[${value.map(item => canonicalPacketJson(item, seen)).join(",")}]`;
      seen.delete(value);
      return result;
    }
    if (isRecord(value)) {
      if (seen.has(value)) throw new TypeError("cyclic comprehension packet");
      seen.add(value);
      const fields = Object.keys(value)
        .sort()
        .filter(key => value[key] !== undefined)
        .map(key => `${JSON.stringify(key)}:${canonicalPacketJson(value[key], seen)}`);
      seen.delete(value);
      return `{${fields.join(",")}}`;
    }
    return "null";
  }

  function packetContentFingerprint(packet) {
    let serialized = "";
    try {
      serialized = canonicalPacketJson(packet);
    } catch {
      return "";
    }
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < serialized.length; index += 1) {
      const code = serialized.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193) >>> 0;
      second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
      second = ((second << 13) | (second >>> 19)) >>> 0;
    }
    return `${serialized.length.toString(36)}-${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
  }

  function completionGenerationIdentity(session) {
    if (!isRecord(session)) return "";
    const value = session.comprehensionGenerationId
      || session.completionId
      || session.lastCompletedTurnId
      || session.completedAt
      || session.endedAt
      || "";
    return String(value).trim().slice(0, 240);
  }

  function progressStorageKey(sessionOrId, packetOrId, prefix = STORAGE_PREFIX) {
    const sessionId = isRecord(sessionOrId) ? sessionOrId.id : sessionOrId;
    const packetId = isRecord(packetOrId) ? packetOrId.id : packetOrId;
    const contentFingerprint = isRecord(packetOrId) ? packetContentFingerprint(packetOrId) : "";
    const completionGeneration = isRecord(sessionOrId) ? completionGenerationIdentity(sessionOrId) : "";
    const identityParts = [String(packetId || "")];
    if (contentFingerprint) identityParts.push(contentFingerprint);
    if (completionGeneration) identityParts.push(completionGeneration);
    const identity = identityParts.join(":");
    return `${prefix}:${encodeURIComponent(String(sessionId || ""))}:${encodeURIComponent(identity)}`;
  }

  function createComprehensionPacket(context = {}) {
    const doc = context.document || root?.document || null;
    const localeEventTarget = context.localeEventTarget || doc?.defaultView || root || null;
    const instanceId = `whitebox-comprehension-${++instanceSequence}`;
    const memoryProgress = new Map();
    const timers = new Set();
    let currentSession = null;
    let currentPacket = null;
    let currentPacketFingerprint = "";
    let currentCompletionGeneration = "";
    let currentSurface = null;
    let currentStorageKey = "";
    let progress = null;
    let badge = null;
    let badgeText = null;
    let badgeButton = null;
    let overlay = null;
    let dialog = null;
    let closeButton = null;
    let quizPanel = null;
    let questionList = null;
    let modeEyebrow = null;
    let modeTitle = null;
    let questionCount = null;
    let scoreNode = null;
    let noticeNode = null;
    let submitButton = null;
    let previousFocus = null;
    let backgroundState = [];
    let openState = false;
    let destroyed = false;
    let noticeTimer = null;
    let surfaceObserver = null;
    let observerSyncQueued = false;
    const questionNodes = new Map();

    let storage = context.storage || null;
    if (!storage) {
      try { storage = root?.localStorage || null; } catch { storage = null; }
    }

    function report(scope, error) {
      try { context.reportError?.(scope, error); } catch {}
    }

    function resolveSurface() {
      if (!doc) return null;
      try {
        const supplied = typeof context.getSurface === "function" ? context.getSurface() : context.surface;
        if (supplied) return supplied;
      } catch (error) {
        report("comprehension-packet-surface", error);
      }
      return doc.querySelector(context.surfaceSelector || "#ptyFocusSurface");
    }

    function sessionFromContext(sessionId) {
      const id = String(sessionId || "");
      if (!id) return null;
      try {
        const direct = context.getSession?.(id);
        if (direct) return direct;
      } catch (error) {
        report("comprehension-packet-session", error);
      }
      try {
        const supplied = context.getSessions?.();
        if (Array.isArray(supplied)) {
          const match = supplied.find(session => String(session?.id || "") === id);
          if (match) return match;
        }
      } catch (error) {
        report("comprehension-packet-sessions", error);
      }
      const snapshots = [
        ...(context.state?.rawSnapshot?.sessions || []),
        ...(context.state?.snapshot?.sessions || []),
      ];
      for (let index = snapshots.length - 1; index >= 0; index -= 1) {
        if (String(snapshots[index]?.id || "") === id) return snapshots[index];
      }
      if (String(context.session?.id || "") === id) return context.session;
      return null;
    }

    function surfaceIsOpen(surface) {
      return Boolean(surface
        && surface.isConnected
        && !surface.classList.contains("hidden")
        && surface.getAttribute("aria-hidden") !== "true"
        && !surface.hasAttribute("inert")
        && surface.style.display !== "none"
        && String(surface.dataset.ptyFocusSession || ""));
    }

    function syncFromSurface() {
      if (destroyed) return false;
      const surface = resolveSurface();
      if (!surface || !surfaceIsOpen(surface)) {
        if (currentSession) unmount();
        return false;
      }
      const session = sessionFromContext(surface.dataset.ptyFocusSession);
      if (!session) {
        if (currentSession) unmount();
        return false;
      }
      return mount(session, { autoPresent: true });
    }

    function queueSurfaceSync() {
      if (observerSyncQueued || destroyed) return;
      observerSyncQueued = true;
      Promise.resolve().then(() => {
        observerSyncQueued = false;
        syncFromSurface();
      });
    }

    function startObserving() {
      if (destroyed || !doc || surfaceObserver) return Boolean(surfaceObserver);
      const surface = resolveSurface();
      const Observer = context.MutationObserver || root?.MutationObserver;
      if (!surface || typeof Observer !== "function") return false;
      surfaceObserver = new Observer(() => queueSurfaceSync());
      surfaceObserver.observe(surface, {
        attributes: true,
        attributeFilter: ["class", "aria-hidden", "data-pty-focus-session", "style"],
        subtree: false,
      });
      queueSurfaceSync();
      return true;
    }

    function stopObserving() {
      surfaceObserver?.disconnect();
      surfaceObserver = null;
      observerSyncQueued = false;
    }

    function createElement(tag, className, attributes = {}) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      for (const [name, value] of Object.entries(attributes)) {
        if (value == null) continue;
        if (name === "text") node.textContent = String(value);
        else if (name === "hidden") node.hidden = Boolean(value);
        else node.setAttribute(name, String(value));
      }
      return node;
    }

    function append(parent, ...children) {
      for (const child of children) {
        if (child == null) continue;
        parent.append(child);
      }
      return parent;
    }

    function storageRead(key) {
      if (memoryProgress.has(key)) return memoryProgress.get(key);
      if (!storage?.getItem) return null;
      try {
        const serialized = storage.getItem(key);
        return serialized ? JSON.parse(serialized) : null;
      } catch (error) {
        report("comprehension-packet-progress-read", error);
        return null;
      }
    }

    function serializableProgress() {
      if (!progress || !currentSession || !currentPacket) return null;
      return {
        schemaVersion: SCHEMA_VERSION,
        sessionId: String(currentSession.id),
        packetId: currentPacket.id,
        packetFingerprint: currentPacketFingerprint,
        completionGeneration: currentCompletionGeneration,
        autoPresented: progress.autoPresented,
        submitted: progress.submitted,
        answers: Object.fromEntries(progress.answers),
        variantAnswers: Object.fromEntries(progress.variantAnswers),
        variantSubmitted: [...progress.variantSubmitted],
        outcomes: Object.fromEntries(progress.outcomes),
        understood: [...progress.understood],
        resolved: [...progress.resolved],
        excluded: [...progress.excluded],
        score: `${correctCount()}/${activeQuestions().length}`,
        updatedAt: progress.updatedAt || null,
      };
    }

    function persistProgress() {
      if (!progress || !currentStorageKey) return;
      progress.updatedAt = new Date().toISOString();
      const snapshot = serializableProgress();
      memoryProgress.set(currentStorageKey, snapshot);
      if (storage?.setItem) {
        try { storage.setItem(currentStorageKey, JSON.stringify(snapshot)); }
        catch (error) { report("comprehension-packet-progress-write", error); }
      }
      const callback = context.onProgressChange || context.persistProgress;
      if (typeof callback === "function") {
        try {
          const result = callback({
            sessionId: String(currentSession.id),
            packetId: currentPacket.id,
            progress: snapshot,
          });
          if (result && typeof result.catch === "function") {
            result.catch(error => report("comprehension-packet-progress-callback", error));
          }
        } catch (error) {
          report("comprehension-packet-progress-callback", error);
        }
      }
    }

    function optionIds(options) {
      return new Set(options.map(option => option.id));
    }

    function freshProgress() {
      return {
        autoPresented: false,
        submitted: false,
        answers: new Map(),
        variantAnswers: new Map(),
        variantSubmitted: new Set(),
        outcomes: new Map(),
        understood: new Set(),
        resolved: new Set(),
        excluded: new Set(),
        updatedAt: null,
      };
    }

    function normalizeProgress(raw) {
      const next = freshProgress();
      if (!isRecord(raw)
        || raw.schemaVersion !== SCHEMA_VERSION
        || String(raw.sessionId || "") !== String(currentSession.id)
        || raw.packetId !== currentPacket.id
        || raw.packetFingerprint !== currentPacketFingerprint
        || raw.completionGeneration !== currentCompletionGeneration) return next;

      next.autoPresented = raw.autoPresented === true;
      next.updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : null;
      const questionById = new Map(currentPacket.questions.map(question => [question.id, question]));
      for (const id of Array.isArray(raw.excluded) ? raw.excluded : []) {
        if (questionById.has(id)) next.excluded.add(id);
      }
      for (const question of currentPacket.questions) {
        if (next.excluded.has(question.id)) continue;
        const answer = isRecord(raw.answers) ? raw.answers[question.id] : null;
        if (optionIds(question.options).has(answer)) next.answers.set(question.id, answer);
        const variantAnswer = isRecord(raw.variantAnswers) ? raw.variantAnswers[question.id] : null;
        if (optionIds(question.variant.options).has(variantAnswer)) next.variantAnswers.set(question.id, variantAnswer);
      }

      const active = currentPacket.questions.filter(question => !next.excluded.has(question.id));
      next.submitted = raw.submitted === true && active.every(question => next.answers.has(question.id));
      if (!next.submitted) {
        next.variantAnswers.clear();
        return next;
      }

      const submittedVariants = new Set(Array.isArray(raw.variantSubmitted) ? raw.variantSubmitted : []);
      const understood = new Set(Array.isArray(raw.understood) ? raw.understood : []);
      for (const question of active) {
        if (next.answers.get(question.id) === question.answerId) {
          next.outcomes.set(question.id, "correct");
          next.resolved.add(question.id);
          continue;
        }
        if (!submittedVariants.has(question.id) || !next.variantAnswers.has(question.id)) {
          next.outcomes.set(question.id, "wrong");
          continue;
        }
        next.variantSubmitted.add(question.id);
        if (next.variantAnswers.get(question.id) === question.variant.answerId) {
          next.outcomes.set(question.id, "variant-correct");
          next.resolved.add(question.id);
        } else {
          next.outcomes.set(question.id, "final-wrong");
          if (understood.has(question.id)) {
            next.understood.add(question.id);
            next.resolved.add(question.id);
          }
        }
      }
      return next;
    }

    function activeQuestions() {
      return currentPacket.questions.filter(question => !progress.excluded.has(question.id));
    }

    function correctCount() {
      return activeQuestions().filter(question => {
        const outcome = progress.outcomes.get(question.id);
        return outcome === "correct" || outcome === "variant-correct";
      }).length;
    }

    function unresolvedQuestions() {
      return activeQuestions().filter(question => !progress.resolved.has(question.id));
    }

    function isComplete() {
      const active = activeQuestions();
      return active.length === 0 || (progress.submitted && active.every(question => progress.resolved.has(question.id)));
    }

    function showNotice(message, tone = "info") {
      if (noticeNode) {
        noticeNode.textContent = message;
        noticeNode.dataset.tone = tone;
      }
      try { context.toast?.(message); } catch (error) { report("comprehension-packet-toast", error); }
      try { context.announce?.(message); } catch (error) { report("comprehension-packet-announce", error); }
      if (noticeTimer) {
        clearTimeout(noticeTimer);
        timers.delete(noticeTimer);
      }
      noticeTimer = setTimeout(() => {
        timers.delete(noticeTimer);
        noticeTimer = null;
        if (noticeNode) noticeNode.textContent = "";
      }, 4_000);
      timers.add(noticeTimer);
    }

    function evidenceForQuestion(question) {
      const ids = new Set(question.evidenceIds);
      return currentPacket.evidence.filter(evidence => ids.has(evidence.id));
    }

    function questionIndex(question) {
      return currentPacket.questions.indexOf(question);
    }

    function topicLabel(topic) {
      const key = {
        change: "topic_change",
        decision: "topic_decision",
        "constraint-risk": "topic_constraint_risk",
      }[topic];
      return key ? translate(key) : topic;
    }

    function makeIssueButton(question) {
      const button = createElement("button", "comprehension-packet-issue", {
        type: "button",
        text: translate("issue_button"),
        "data-comprehension-issue": question.id,
        "aria-label": translate("issue_aria", { prompt: question.prompt }),
      });
      return button;
    }

    function makeQuestionMeta(question, index, wrong = false) {
      const meta = createElement("div", "comprehension-packet-question-meta");
      const number = createElement("strong", "", { text: index + 1 });
      const kind = createElement("span", "", {
        text: wrong ? translate("wrong_kind", { kind: question.kind }) : question.kind,
      });
      const topics = createElement("small", "", { text: question.topics.map(topicLabel).join(" · ") });
      append(meta, number, kind, topics, makeIssueButton(question));
      return meta;
    }

    function makeChoices(question, variant = false, disabled = false, semantics = {}) {
      const choices = createElement("div", "comprehension-packet-choices", {
        role: "radiogroup",
        "aria-labelledby": semantics.labelId,
        "aria-describedby": semantics.errorId,
        "aria-errormessage": semantics.errorId,
        "aria-required": disabled ? null : "true",
        "aria-invalid": "false",
      });
      const selected = variant ? progress.variantAnswers.get(question.id) : progress.answers.get(question.id);
      const options = variant ? question.variant.options : question.options;
      const stableIndex = questionIndex(question);
      const groupName = `${instanceId}-${variant ? "variant" : "initial"}-${stableIndex}`;
      for (const option of options) {
        const label = createElement("label", "comprehension-packet-choice");
        const input = createElement("input", "", {
          type: "radio",
          name: groupName,
          value: option.id,
          required: disabled ? null : "",
          "data-comprehension-answer-kind": variant ? "variant" : "initial",
          "data-comprehension-question-id": question.id,
          "data-comprehension-option-id": option.id,
        });
        input.checked = selected === option.id;
        input.disabled = disabled;
        const copy = createElement("span", "", { text: option.label });
        append(label, input, copy);
        choices.append(label);
      }
      return choices;
    }

    function makeValidationError(id, message) {
      return createElement("p", "comprehension-packet-field-error", {
        id,
        role: "alert",
        text: message,
        hidden: true,
      });
    }

    function setAnswerGroupInvalid(container, invalid) {
      if (!container) return;
      container.classList.toggle("is-unanswered", invalid);
      container.setAttribute("aria-invalid", String(invalid));
      const group = container.matches?.("[role='radiogroup']")
        ? container
        : container.querySelector?.("[role='radiogroup']");
      group?.setAttribute("aria-invalid", String(invalid));
      const errorId = group?.getAttribute("aria-errormessage")
        || container.getAttribute("aria-errormessage");
      const error = errorId ? doc.getElementById(errorId) : null;
      if (error) error.hidden = !invalid;
    }

    function makeEvidenceChips(question) {
      const list = createElement("div", "comprehension-packet-evidence-chips");
      for (const evidence of evidenceForQuestion(question)) {
        const chip = createElement("span", "comprehension-packet-evidence-chip", {
          text: translate("evidence_chip", { label: evidence.label }),
          title: evidence.detail,
        });
        list.append(chip);
      }
      return list;
    }

    function makeInitialCard(question, index) {
      const legendId = `${instanceId}-initial-title-${index}`;
      const errorId = `${instanceId}-initial-error-${index}`;
      const card = createElement("fieldset", "comprehension-packet-question-card", {
        "data-comprehension-question": question.id,
        "aria-required": "true",
        "aria-invalid": "false",
        "aria-describedby": errorId,
        "aria-errormessage": errorId,
      });
      const legend = createElement("legend", "comprehension-packet-sr-only", { text: question.prompt });
      append(card,
        legend,
        makeQuestionMeta(question, index),
        createElement("p", "comprehension-packet-original-prompt", { id: legendId, text: question.prompt }),
        makeChoices(question, false, false, { labelId: legendId, errorId }),
        makeValidationError(errorId, translate("required_initial")));
      questionNodes.set(question.id, card);
      return card;
    }

    function correctOptionLabel(question) {
      return question.variant.options.find(option => option.id === question.variant.answerId)?.label || question.variant.answerId;
    }

    function makeAnswerSummary(question, variant = false) {
      const source = variant ? question.variant : question;
      const selected = (variant ? progress.variantAnswers : progress.answers).get(question.id);
      const answers = createElement("dl", "comprehension-packet-answer-summary");
      for (const [key, id] of [["answer_label", selected], ["correct_label", source.answerId]]) {
        const row = createElement("div", "");
        append(row,
          createElement("dt", "", { text: translate(key) }),
          createElement("dd", "", { text: source.options.find(option => option.id === id)?.label || "—" }));
        answers.append(row);
      }
      return answers;
    }

    function makeVariantResult(question) {
      const outcome = progress.outcomes.get(question.id);
      const result = createElement("div", "comprehension-packet-variant-result", {
        role: "status",
        "aria-live": "polite",
      });
      if (outcome === "variant-correct") {
        result.dataset.tone = "success";
        result.textContent = translate("variant_correct");
        return result;
      }
      if (outcome !== "final-wrong") {
        result.hidden = true;
        return result;
      }

      result.dataset.tone = progress.understood.has(question.id) ? "acknowledged" : "wrong";
      const answer = createElement("b", "", {
        text: translate("correct_answer", { answer: correctOptionLabel(question) }),
      });
      const explanation = createElement("p", "", { text: question.variant.explanation });
      append(result, answer, explanation);
      if (progress.understood.has(question.id)) {
        result.append(createElement("p", "comprehension-packet-understood-copy", {
          text: translate("debt_resolved_score_unchanged"),
        }));
      } else {
        result.append(createElement("button", "comprehension-packet-quiet", {
          type: "button",
          text: translate("understood_button"),
          "data-comprehension-understood": question.id,
        }));
      }
      return result;
    }

    function makeReviewCard(question, index) {
      const outcome = progress.outcomes.get(question.id);
      const initiallyCorrect = outcome === "correct";
      const variantWasSubmitted = progress.variantSubmitted.has(question.id);
      const resolved = progress.resolved.has(question.id);
      const card = createElement("article", `comprehension-packet-question-card ${initiallyCorrect ? "comprehension-packet-result-card" : "comprehension-packet-remediation-card"}`, {
        "data-comprehension-question": question.id,
        tabindex: "-1",
      });
      if (resolved) card.classList.add("is-resolved");
      const acknowledged = outcome === "final-wrong" && progress.understood.has(question.id);
      if (acknowledged) card.classList.add("is-acknowledged");
      card.dataset.comprehensionStatus = reviewStatus(question);
      const meta = makeQuestionMeta(question, index, !initiallyCorrect);
      const status = createElement("span", "comprehension-packet-result-status", { text: card.dataset.comprehensionStatus });
      const originalPrompt = createElement("p", "comprehension-packet-original-prompt", { text: question.prompt });
      const remediation = createElement("section", "comprehension-packet-remediation");
      const explanationTitle = createElement("h3", "", { text: translate("explanation_title") });
      const explanation = createElement("p", "", { text: question.explanation });
      append(card, meta, status, originalPrompt, makeAnswerSummary(question));
      append(remediation, explanationTitle, explanation, makeEvidenceChips(question));
      if (initiallyCorrect) {
        card.append(remediation);
        questionNodes.set(question.id, card);
        return card;
      }
      const variantTitleId = `${instanceId}-variant-title-${index}`;
      const variantErrorId = `${instanceId}-variant-error-${index}`;
      const variantBox = createElement("div", "comprehension-packet-variant-box", {
        "data-comprehension-variant-form": question.id,
        role: "group",
        "aria-labelledby": variantTitleId,
        "aria-describedby": variantErrorId,
        "aria-errormessage": variantErrorId,
        "aria-required": variantWasSubmitted ? null : "true",
        "aria-invalid": "false",
      });
      const variantTitle = createElement("b", "", {
        id: variantTitleId,
        text: translate("variant_title", { prompt: question.variant.prompt }),
      });
      const variantChoices = variantWasSubmitted ? makeAnswerSummary(question, true) : makeChoices(question, true, false, {
        labelId: variantTitleId,
        errorId: variantErrorId,
      });
      append(variantBox,
        variantTitle,
        variantChoices,
        makeValidationError(variantErrorId, translate("required_variant")));
      if (!variantWasSubmitted) {
        const actions = createElement("div", "comprehension-packet-variant-actions");
        actions.append(createElement("button", "comprehension-packet-primary", {
          type: "button",
          text: translate("retry_button"),
          "data-comprehension-variant-submit": question.id,
        }));
        variantBox.append(actions);
      }
      if (variantWasSubmitted && outcome === "variant-correct") {
        variantBox.append(createElement("p", "comprehension-packet-variant-explanation", { text: question.variant.explanation }));
      }
      append(remediation, variantBox, makeVariantResult(question));
      card.append(remediation);
      questionNodes.set(question.id, card);
      return card;
    }

    function makeEmptyState(title, detail, resolved = true) {
      const empty = createElement("div", "comprehension-packet-empty-state");
      if (resolved) empty.classList.add("is-resolved");
      append(empty,
        createElement("strong", "", { text: title }),
        createElement("p", "", { text: detail }));
      return empty;
    }

    function reviewStatus(question) {
      if (progress.excluded.has(question.id)) return translate("status_excluded");
      const outcome = progress.outcomes.get(question.id);
      return translate(outcome === "correct" ? "status_correct"
        : outcome === "variant-correct" ? "status_variant_correct"
          : progress.understood.has(question.id) ? "status_explanation_reviewed" : "status_retry");
    }

    function makeHistoryOverview() {
      const overview = createElement("nav", "comprehension-packet-history", {
        "aria-label": translate("history_label"),
      });
      currentPacket.questions.forEach((question, index) => {
        const button = createElement("button", "comprehension-packet-history-item", {
          type: "button",
          "data-comprehension-review-target": question.id,
        });
        append(button,
          createElement("span", "comprehension-packet-history-prompt", { text: `${index + 1}. ${question.prompt}` }),
          createElement("span", "comprehension-packet-history-status", { text: reviewStatus(question) }));
        overview.append(button);
      });
      return overview;
    }

    function renderInitial() {
      questionNodes.clear();
      modeEyebrow.textContent = translate("initial_eyebrow");
      const active = activeQuestions();
      modeTitle.textContent = translate("initial_title", { count: active.length });
      questionList.className = "comprehension-packet-question-list";
      questionList.replaceChildren();
      active.forEach(question => questionList.append(makeInitialCard(question, questionIndex(question))));
      if (!active.length) {
        questionList.append(makeEmptyState(
          translate("no_questions_title"),
          translate("no_questions_initial")));
      }
      submitButton.hidden = false;
      submitButton.disabled = active.length === 0;
      updateSummary();
    }

    function renderReview(options = {}) {
      questionNodes.clear();
      modeEyebrow.textContent = translate("review_eyebrow");
      modeTitle.textContent = translate("review_title");
      questionList.className = "comprehension-packet-question-list is-remediation";
      questionList.replaceChildren();
      const active = activeQuestions();
      questionList.append(makeHistoryOverview());
      for (const question of currentPacket.questions) {
        if (progress.excluded.has(question.id)) {
          const excluded = createElement("article", "comprehension-packet-question-card is-excluded", {
            "data-comprehension-excluded-question": question.id,
            tabindex: "-1",
          });
          append(excluded,
            createElement("span", "comprehension-packet-result-status", { text: translate("status_excluded") }),
            createElement("p", "comprehension-packet-original-prompt", { text: `${questionIndex(question) + 1}. ${question.prompt}` }));
          questionList.append(excluded);
          questionNodes.set(question.id, excluded);
        } else {
          questionList.append(makeReviewCard(question, questionIndex(question)));
        }
      }
      if (!active.length) {
        questionList.prepend(makeEmptyState(
          translate("no_questions_title"),
          translate("no_questions_review")));
      }
      submitButton.hidden = true;
      updateSummary();
      if (options.focusReview) {
        const target = questionList.querySelector(".comprehension-packet-remediation-card") || questionList;
        requestFrame(() => target.focus?.({ preventScroll: true }));
      }
    }

    function setScoreText(leading, trailing) {
      scoreNode.replaceChildren();
      if (leading) scoreNode.append(createElement("b", "", { text: leading }));
      if (trailing) scoreNode.append(doc.createTextNode(`${leading ? " · " : ""}${trailing}`));
    }

    function updateSummary() {
      if (!progress || !currentPacket) return;
      const active = activeQuestions();
      const denominator = active.length;
      const score = correctCount();
      const remaining = unresolvedQuestions().length;
      if (!progress.submitted) {
        setScoreText("", denominator ? translate("not_submitted") : translate("no_questions_score"));
        questionCount.textContent = translate("question_count", { count: denominator });
      } else if (remaining) {
        setScoreText(`${score}/${denominator}`, translate("retries_remaining", { count: remaining }));
        questionCount.textContent = translate("incorrect_count", { count: remaining });
      } else {
        setScoreText(
          translate("final_score", { score, total: denominator }),
          score === denominator ? translate("comprehension_complete") : translate("explanation_complete"),
        );
        questionCount.textContent = translate("review_complete");
      }
      const resolved = isComplete();
      if (progress.submitted) {
        modeEyebrow.textContent = translate("review_eyebrow");
        modeTitle.textContent = translate(resolved ? "completed_title" : "review_title");
        for (const button of questionList.querySelectorAll("[data-comprehension-review-target]")) {
          const question = findQuestion(button.dataset.comprehensionReviewTarget);
          if (question) button.querySelector(".comprehension-packet-history-status").textContent = reviewStatus(question);
        }
      }
      badge.classList.toggle("is-resolved", resolved);
      badgeText.textContent = resolved
        ? translate("badge_complete", { score, total: denominator })
        : translate("badge_debt");
      badgeButton.setAttribute("aria-label", translate("badge_open_aria", { status: badgeText.textContent }));
    }

    function handleInitialSubmit(event) {
      event.preventDefault();
      if (progress.submitted) return;
      const missing = activeQuestions().filter(question => !progress.answers.has(question.id));
      for (const question of activeQuestions()) {
        setAnswerGroupInvalid(questionNodes.get(question.id), missing.includes(question));
      }
      if (missing.length) {
        showNotice(translate("missing_initial", { count: missing.length }), "warning");
        questionNodes.get(missing[0].id)?.querySelector("input")?.focus();
        return;
      }
      progress.submitted = true;
      progress.outcomes.clear();
      progress.resolved.clear();
      for (const question of activeQuestions()) {
        if (progress.answers.get(question.id) === question.answerId) {
          progress.outcomes.set(question.id, "correct");
          progress.resolved.add(question.id);
        } else {
          progress.outcomes.set(question.id, "wrong");
        }
      }
      persistProgress();
      const allCorrect = isComplete();
      renderReview({ focusReview: true });
      showNotice(allCorrect
        ? translate("all_correct")
        : translate("wrong_only"), allCorrect ? "success" : "info");
    }

    function findQuestion(id) {
      return currentPacket.questions.find(question => question.id === id) || null;
    }

    function replaceReviewCard(question) {
      const oldCard = questionNodes.get(question.id);
      if (!oldCard?.isConnected) return;
      const replacement = makeReviewCard(question, questionIndex(question));
      oldCard.replaceWith(replacement);
    }

    function focusTransitionTarget(questionId = "", selector = "") {
      requestFrame(() => {
        const preferredCard = questionId ? questionNodes.get(questionId) : null;
        const preferred = selector ? preferredCard?.querySelector(selector) : preferredCard;
        const fallback = questionList.querySelector(
          "[data-comprehension-variant-submit], [data-comprehension-understood], "
          + "[data-comprehension-answer-kind], .comprehension-packet-remediation-card",
        ) || questionList;
        const target = preferred?.isConnected ? preferred : fallback;
        target?.focus?.({ preventScroll: true });
      });
    }

    function handleVariantSubmit(questionId) {
      const question = findQuestion(questionId);
      if (!question || progress.excluded.has(question.id) || progress.resolved.has(question.id)) return;
      const card = questionNodes.get(question.id);
      const variantBox = card?.querySelector("[data-comprehension-variant-form]");
      setAnswerGroupInvalid(variantBox, false);
      if (!progress.variantAnswers.has(question.id)) {
        setAnswerGroupInvalid(variantBox, true);
        showNotice(translate("required_variant"), "warning");
        variantBox?.querySelector("input")?.focus();
        return;
      }
      progress.variantSubmitted.add(question.id);
      if (progress.variantAnswers.get(question.id) === question.variant.answerId) {
        progress.outcomes.set(question.id, "variant-correct");
        progress.resolved.add(question.id);
      } else {
        progress.outcomes.set(question.id, "final-wrong");
        progress.resolved.delete(question.id);
      }
      persistProgress();
      replaceReviewCard(question);
      updateSummary();
      if (progress.outcomes.get(question.id) === "variant-correct") {
        focusTransitionTarget(question.id);
        showNotice(translate("variant_correct_notice"), "success");
      } else {
        focusTransitionTarget(question.id, "[data-comprehension-understood]");
        showNotice(translate("variant_wrong_notice"), "warning");
      }
    }

    function handleUnderstood(questionId) {
      const question = findQuestion(questionId);
      if (!question || progress.outcomes.get(question.id) !== "final-wrong") return;
      progress.understood.add(question.id);
      progress.resolved.add(question.id);
      persistProgress();
      replaceReviewCard(question);
      updateSummary();
      focusTransitionTarget(question.id);
      showNotice(translate("understood_notice"), "success");
    }

    function handleIssue(questionId) {
      const question = findQuestion(questionId);
      if (!question || progress.excluded.has(question.id)) return;
      progress.excluded.add(question.id);
      progress.answers.delete(question.id);
      progress.variantAnswers.delete(question.id);
      progress.variantSubmitted.delete(question.id);
      progress.outcomes.delete(question.id);
      progress.understood.delete(question.id);
      progress.resolved.delete(question.id);
      persistProgress();
      if (progress.submitted) renderReview();
      else renderInitial();
      focusTransitionTarget();
      showNotice(translate("issue_notice"), "info");
    }

    function onOverlayChange(event) {
      const input = event.target.closest?.("[data-comprehension-answer-kind]");
      if (!input || !overlay.contains(input) || input.disabled) return;
      const question = findQuestion(input.dataset.comprehensionQuestionId);
      const optionId = input.dataset.comprehensionOptionId;
      if (!question) return;
      if (input.dataset.comprehensionAnswerKind === "variant") {
        if (!optionIds(question.variant.options).has(optionId)) return;
        progress.variantAnswers.set(question.id, optionId);
        setAnswerGroupInvalid(input.closest("[data-comprehension-variant-form]"), false);
      } else {
        if (!optionIds(question.options).has(optionId)) return;
        progress.answers.set(question.id, optionId);
        setAnswerGroupInvalid(questionNodes.get(question.id), false);
      }
      persistProgress();
    }

    function onOverlayClick(event) {
      const history = event.target.closest?.("[data-comprehension-review-target]");
      if (history && overlay.contains(history)) {
        const card = questionNodes.get(history.dataset.comprehensionReviewTarget);
        card?.scrollIntoView({ block: "start" });
        card?.focus({ preventScroll: true });
        return;
      }
      const close = event.target.closest?.("[data-comprehension-close]");
      if (close && overlay.contains(close)) {
        closePacket();
        return;
      }
      const issue = event.target.closest?.("[data-comprehension-issue]");
      if (issue && overlay.contains(issue)) {
        handleIssue(issue.dataset.comprehensionIssue);
        return;
      }
      const variant = event.target.closest?.("[data-comprehension-variant-submit]");
      if (variant && overlay.contains(variant)) {
        handleVariantSubmit(variant.dataset.comprehensionVariantSubmit);
        return;
      }
      const understood = event.target.closest?.("[data-comprehension-understood]");
      if (understood && overlay.contains(understood)) {
        handleUnderstood(understood.dataset.comprehensionUnderstood);
        return;
      }
      const evidence = event.target.closest?.("[data-comprehension-evidence]");
      if (evidence && overlay.contains(evidence) && typeof context.onEvidence === "function") {
        const item = currentPacket.evidence.find(entry => entry.id === evidence.dataset.comprehensionEvidence);
        if (item) {
          try { context.onEvidence({ session: currentSession, packet: currentPacket, evidence: item }); }
          catch (error) { report("comprehension-packet-evidence", error); }
        }
      }
    }

    function isFocusable(node) {
      return Boolean(node
        && !node.disabled
        && !node.hidden
        && !node.closest?.("[hidden]")
        && node.getAttribute?.("aria-hidden") !== "true"
        && node.getAttribute?.("tabindex") !== "-1");
    }

    function focusableNodes() {
      if (!dialog) return [];
      return [...dialog.querySelectorAll([
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled]):not([type=hidden])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","))].filter(isFocusable);
    }

    function onDocumentKeydown(event) {
      if (!openState || !dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        closePacket({ reason: "escape" });
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableNodes();
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = doc.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    function requestFrame(callback) {
      if (typeof root?.requestAnimationFrame === "function") root.requestAnimationFrame(callback);
      else callback();
    }

    function ptyScrollTargets() {
      if (!currentSurface) return [];
      const targets = new Set();
      try {
        const supplied = context.getPtyScrollTargets?.(currentSurface);
        if (supplied && Symbol.iterator in Object(supplied)) {
          for (const target of supplied) if (target && !overlay?.contains(target)) targets.add(target);
        }
      } catch (error) {
        report("comprehension-packet-scroll-targets", error);
      }
      for (const selector of [
        "#ptyFocusTerminalViewport",
        "#ptyFocusTranscriptContent",
        "[data-agent-terminal-viewport]",
        ".xterm-viewport",
      ]) {
        for (const target of currentSurface.querySelectorAll(selector)) {
          if (!overlay?.contains(target)) targets.add(target);
        }
      }
      return [...targets];
    }

    function capturePtyScroll() {
      return ptyScrollTargets().map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
    }

    function restorePtyScroll(snapshot) {
      const restore = () => {
        for (const item of snapshot || []) {
          if (!item.node?.isConnected) continue;
          item.node.scrollTop = item.top;
          item.node.scrollLeft = item.left;
        }
      };
      restore();
      requestFrame(restore);
    }

    function makeBackgroundInactive(inactive) {
      if (!currentSurface) return;
      if (inactive) {
        backgroundState = [...currentSurface.children]
          .filter(node => node !== overlay && node !== badge)
          .map(node => ({
            node,
            inert: node.hasAttribute("inert"),
            ariaHidden: node.getAttribute("aria-hidden"),
          }));
        for (const item of backgroundState) {
          item.node.setAttribute("inert", "");
          item.node.setAttribute("aria-hidden", "true");
        }
        return;
      }
      for (const item of backgroundState) {
        if (!item.node?.isConnected) continue;
        if (item.inert) item.node.setAttribute("inert", "");
        else item.node.removeAttribute("inert");
        if (item.ariaHidden == null) item.node.removeAttribute("aria-hidden");
        else item.node.setAttribute("aria-hidden", item.ariaHidden);
      }
      backgroundState = [];
    }

    function surfaceIsVisible() {
      return Boolean(currentSurface
        && currentSurface.isConnected
        && !currentSurface.classList.contains("hidden")
        && currentSurface.getAttribute("aria-hidden") !== "true"
        && !currentSurface.hasAttribute("inert"));
    }

    function openPacket(options = {}) {
      if (!overlay || !progress || !surfaceIsVisible()) return false;
      if (openState) {
        closeButton?.focus({ preventScroll: true });
        return true;
      }
      const scroll = capturePtyScroll();
      previousFocus = options.trigger?.isConnected
        ? options.trigger
        : (doc.activeElement && doc.activeElement.isConnected ? doc.activeElement : null);
      openState = true;
      progress.autoPresented = true;
      persistProgress();
      makeBackgroundInactive(true);
      currentSurface.classList.add("comprehension-packet-open");
      overlay.hidden = false;
      overlay.removeAttribute("inert");
      overlay.setAttribute("aria-hidden", "false");
      badge.hidden = true;
      restorePtyScroll(scroll);
      if (options.focus !== false) requestFrame(() => closeButton?.focus({ preventScroll: true }));
      try { context.onOpen?.({ session: currentSession, packet: currentPacket, auto: options.auto === true }); }
      catch (error) { report("comprehension-packet-open", error); }
      return true;
    }

    function closePacket(options = {}) {
      if (!overlay || !progress) return false;
      if (!openState) {
        overlay.hidden = true;
        overlay.setAttribute("inert", "");
        overlay.setAttribute("aria-hidden", "true");
        badge.hidden = false;
        updateSummary();
        return false;
      }
      const scroll = capturePtyScroll();
      openState = false;
      overlay.hidden = true;
      overlay.setAttribute("inert", "");
      overlay.setAttribute("aria-hidden", "true");
      badge.hidden = false;
      currentSurface?.classList.remove("comprehension-packet-open");
      makeBackgroundInactive(false);
      updateSummary();
      const focusTarget = previousFocus;
      previousFocus = null;
      if (options.restoreFocus !== false) {
        requestFrame(() => {
          const focusTargetUsable = Boolean(focusTarget?.isConnected
            && typeof focusTarget.focus === "function"
            && currentSurface?.contains(focusTarget)
            && !focusTarget.closest?.("[inert], [hidden], [aria-hidden='true']"));
          if (focusTargetUsable) {
            focusTarget.focus({ preventScroll: true });
          } else {
            try {
              if (typeof context.restorePtyFocus === "function") context.restorePtyFocus();
              else root?.WhiteboxTerminal?.focusEmbedded?.();
            } catch (error) {
              report("comprehension-packet-focus-restore", error);
            }
          }
          restorePtyScroll(scroll);
        });
      } else {
        restorePtyScroll(scroll);
      }
      const message = isComplete()
        ? translate("closed")
        : translate("closed_debt");
      if (options.announce !== false) showNotice(message, isComplete() ? "success" : "info");
      try { context.onClose?.({ session: currentSession, packet: currentPacket, reason: options.reason || "close" }); }
      catch (error) { report("comprehension-packet-close", error); }
      return true;
    }

    function buildMountedDom() {
      const suffix = instanceId.replace(/[^a-z0-9-]/gi, "");
      const titleId = `${suffix}-title`;
      const summaryId = `${suffix}-summary`;
      badge = createElement("div", "comprehension-packet-badge", {
        id: "comprehensionPacketBadge",
        role: "status",
        "data-whitebox-comprehension-badge": "",
      });
      const badgeDot = createElement("i", "", { "aria-hidden": "true" });
      badgeText = createElement("span", "", { text: translate("badge_debt") });
      badgeButton = createElement("button", "comprehension-packet-badge-button", {
        type: "button",
        text: translate("badge_open"),
      });
      badgeButton.addEventListener("click", () => openPacket({ auto: false, trigger: badgeButton }));
      append(badge, badgeDot, badgeText, badgeButton);

      overlay = createElement("div", "comprehension-packet-overlay", {
        id: "comprehensionPacketOverlay",
        "data-whitebox-comprehension-root": "",
        "aria-hidden": "true",
        inert: "",
        hidden: true,
      });
      dialog = createElement("section", "comprehension-packet-dialog", {
        id: "comprehensionPacketDialog",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": titleId,
        "aria-describedby": summaryId,
        tabindex: "-1",
      });

      const header = createElement("header", "comprehension-packet-header");
      const heading = createElement("div", "comprehension-packet-heading");
      append(heading,
        createElement("small", "", { text: translate("header_eyebrow") }),
        createElement("h1", "", { id: titleId, text: translate("header_title") }));
      const difficulty = createElement("span", "comprehension-packet-difficulty", {
        "aria-label": translate("difficulty_aria", { difficulty: currentPacket.difficulty }),
      });
      append(difficulty,
        createElement("span", "comprehension-packet-difficulty-label", { text: translate("difficulty_label") }),
        createElement("strong", "", { text: currentPacket.difficulty }));
      closeButton = createElement("button", "comprehension-packet-close", {
        id: "comprehensionPacketClose",
        type: "button",
        text: "×",
        "data-comprehension-close": "",
        "aria-label": translate("close_aria"),
      });
      append(header, heading, difficulty, closeButton);

      const body = createElement("div", "comprehension-packet-body");
      const briefing = createElement("section", "comprehension-packet-briefing", {
        "aria-labelledby": `${suffix}-briefing-title`,
      });
      append(briefing,
        createElement("p", "comprehension-packet-section-label", { text: translate("briefing_eyebrow") }),
        createElement("h2", "", { id: `${suffix}-briefing-title`, text: currentPacket.title }),
        createElement("p", "comprehension-packet-summary-hint", { id: summaryId, text: translate("summary_hint") }));
      const summary = createElement("div", "comprehension-packet-summary");
      for (const paragraph of currentPacket.summary.trim().split(/\n\s*\n/u)) {
        summary.append(createElement("p", "", { text: paragraph }));
      }
      briefing.append(summary);

      const quizForm = createElement("form", "comprehension-packet-quiz", {
        id: `${suffix}-form`,
        novalidate: "",
      });
      quizPanel = quizForm;
      const quizHeading = createElement("div", "comprehension-packet-quiz-heading");
      const quizCopy = createElement("div");
      modeEyebrow = createElement("p", "comprehension-packet-section-label", { text: translate("initial_eyebrow") });
      modeTitle = createElement("h2", "", {
        text: translate("initial_title", { count: activeQuestions().length }),
      });
      append(quizCopy, modeEyebrow, modeTitle);
      questionCount = createElement("span", "comprehension-packet-question-count", { text: "" });
      append(quizHeading, quizCopy, questionCount);
      questionList = createElement("div", "comprehension-packet-question-list", {
        id: "comprehensionPacketQuestionList",
        tabindex: "-1",
      });
      append(quizForm, quizHeading, questionList);
      quizForm.addEventListener("submit", handleInitialSubmit);
      append(body, briefing, quizForm);

      const footer = createElement("footer", "comprehension-packet-actions");
      scoreNode = createElement("span", "comprehension-packet-score", {
        id: "comprehensionPacketScore",
        "aria-live": "polite",
        "aria-atomic": "true",
      });
      noticeNode = createElement("span", "comprehension-packet-notice", {
        role: "status",
        "aria-live": "polite",
        "aria-atomic": "true",
      });
      const spacer = createElement("span", "comprehension-packet-action-spacer", { "aria-hidden": "true" });
      submitButton = createElement("button", "comprehension-packet-primary", {
        id: "comprehensionPacketSubmit",
        type: "submit",
        form: quizForm.id,
        text: translate("submit_answers"),
      });
      append(footer, scoreNode, noticeNode, spacer, submitButton);
      append(dialog, header, body, footer);
      overlay.append(dialog);
      overlay.addEventListener("click", onOverlayClick);
      overlay.addEventListener("change", onOverlayChange);
      currentSurface.append(badge, overlay);
    }

    function updateLocalizedStaticCopy() {
      if (!overlay || !currentPacket) return;
      badgeButton.textContent = translate("badge_open");
      const heading = overlay.querySelector(".comprehension-packet-heading");
      const headingEyebrow = heading?.querySelector("small");
      const headingTitle = heading?.querySelector("h1");
      if (headingEyebrow) headingEyebrow.textContent = translate("header_eyebrow");
      if (headingTitle) headingTitle.textContent = translate("header_title");
      const difficulty = overlay.querySelector(".comprehension-packet-difficulty");
      difficulty?.setAttribute("aria-label", translate("difficulty_aria", {
        difficulty: currentPacket.difficulty,
      }));
      const difficultyLabel = difficulty?.querySelector(".comprehension-packet-difficulty-label");
      if (difficultyLabel) difficultyLabel.textContent = translate("difficulty_label");
      closeButton?.setAttribute("aria-label", translate("close_aria"));
      const briefingLabels = overlay.querySelectorAll(
        ".comprehension-packet-briefing > .comprehension-packet-section-label",
      );
      if (briefingLabels[0]) briefingLabels[0].textContent = translate("briefing_eyebrow");
      const summaryHint = overlay.querySelector(".comprehension-packet-summary-hint");
      if (summaryHint) summaryHint.textContent = translate("summary_hint");
      submitButton.textContent = translate("submit_answers");
    }

    function describeDynamicFocus(node) {
      if (!node || !questionList?.contains(node)) return null;
      const card = node.closest?.("[data-comprehension-question]");
      const questionId = card?.dataset.comprehensionQuestion || "";
      if (!questionId) return null;
      const answer = node.closest?.("[data-comprehension-answer-kind]");
      if (answer) {
        return {
          type: "answer",
          questionId,
          answerKind: answer.dataset.comprehensionAnswerKind,
          optionId: answer.dataset.comprehensionOptionId,
        };
      }
      if (node.closest?.("[data-comprehension-issue]")) return { type: "issue", questionId };
      if (node.closest?.("[data-comprehension-variant-submit]")) return { type: "variant-submit", questionId };
      if (node.closest?.("[data-comprehension-understood]")) return { type: "understood", questionId };
      if (node === card) return { type: "card", questionId };
      return null;
    }

    function resolveDynamicFocus(descriptor) {
      if (!descriptor) return null;
      const card = questionNodes.get(descriptor.questionId);
      if (!card?.isConnected) return null;
      if (descriptor.type === "answer") {
        return [...card.querySelectorAll("[data-comprehension-answer-kind]")].find(node => (
          node.dataset.comprehensionAnswerKind === descriptor.answerKind
          && node.dataset.comprehensionOptionId === descriptor.optionId
        )) || null;
      }
      if (descriptor.type === "issue") return card.querySelector("[data-comprehension-issue]");
      if (descriptor.type === "variant-submit") return card.querySelector("[data-comprehension-variant-submit]");
      if (descriptor.type === "understood") return card.querySelector("[data-comprehension-understood]");
      return descriptor.type === "card" ? card : null;
    }

    function onLocaleChanged() {
      if (currentSession && !currentPacket) { mount(currentSession); return; }
      if (destroyed || !currentPacket || !overlay) return;
      const focusDescriptor = describeDynamicFocus(doc.activeElement);
      const scrollSnapshot = [overlay, dialog, quizPanel, questionList]
        .filter(Boolean)
        .map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
      const ptyScroll = capturePtyScroll();
      updateLocalizedStaticCopy();
      if (progress.submitted) renderReview();
      else renderInitial();
      if (noticeNode) noticeNode.textContent = "";
      const restoreUiState = () => {
        for (const item of scrollSnapshot) {
          if (!item.node?.isConnected) continue;
          item.node.scrollTop = item.top;
          item.node.scrollLeft = item.left;
        }
        resolveDynamicFocus(focusDescriptor)?.focus?.({ preventScroll: true });
      };
      restoreUiState();
      requestFrame(restoreUiState);
      restorePtyScroll(ptyScroll);
    }

    function clearMountedDom() {
      if (openState) closePacket({ restoreFocus: false, announce: false, reason: "unmount" });
      else makeBackgroundInactive(false);
      overlay?.removeEventListener("click", onOverlayClick);
      overlay?.removeEventListener("change", onOverlayChange);
      badge?.remove();
      overlay?.remove();
      currentSurface?.classList.remove("comprehension-packet-open");
      if (currentSurface?.dataset.comprehensionPacketSession) {
        delete currentSurface.dataset.comprehensionPacketSession;
      }
      badge = null;
      badgeText = null;
      badgeButton = null;
      overlay = null;
      dialog = null;
      closeButton = null;
      quizPanel = null;
      questionList = null;
      modeEyebrow = null;
      modeTitle = null;
      questionCount = null;
      scoreNode = null;
      noticeNode = null;
      submitButton = null;
      previousFocus = null;
      questionNodes.clear();
      openState = false;
    }

    function unmount(options = {}) {
      if (openState) closePacket({
        restoreFocus: options.restoreFocus === true,
        announce: false,
        reason: "unmount",
      });
      clearMountedDom();
      currentSession = null;
      currentPacket = null;
      currentPacketFingerprint = "";
      currentCompletionGeneration = "";
      currentSurface = null;
      currentStorageKey = "";
      progress = null;
      return true;
    }

    function presentIfNeeded() {
      if (!progress || progress.autoPresented || !surfaceIsVisible()) return false;
      return openPacket({ auto: true });
    }

    function mount(session = context.session, options = {}) {
      const generationStatus = session?.comprehension?.status;
      if (!destroyed && doc && hasBackgroundOrigin(session) && session.status === "completed"
        && session.completionObserved === true && !session.parentId && !Number(session.depth || 0)
        && ["queued", "generating", "failed"].includes(generationStatus)) {
        const surface = resolveSurface();
        if (!surface) return false;
        const statusKey = generationStatus === "failed" ? "generation_failed" : "generating";
        if (currentSession?.id === session.id && currentSurface === surface && !currentPacket && badge
          && badge.dataset.generationStatus === generationStatus) {
          badgeText.textContent = translate(statusKey);
          if (badgeButton) badgeButton.textContent = translate("generation_retry");
          return true;
        }
        unmount();
        currentSession = session;
        currentSurface = surface;
        badge = createElement("div", "comprehension-packet-badge", {
          id: "comprehensionPacketBadge", role: "status", "data-whitebox-comprehension-badge": "",
          "data-generation-status": generationStatus,
        });
        badgeText = createElement("span", "", { text: translate(statusKey) });
        append(badge, createElement("i", "", { "aria-hidden": "true" }), badgeText);
        if (generationStatus === "failed") {
          badgeButton = createElement("button", "comprehension-packet-badge-button", {
            type: "button", text: translate("generation_retry"),
          });
          badgeButton.addEventListener("click", async () => {
            const button = badgeButton;
            button.disabled = true;
            try {
              const retry = context.retryQuestionnaire || root?.whitebox?.retryQuestionnaire;
              await retry?.(session.id);
            } catch (error) { report("comprehension-retry", error); }
            finally { if (button.isConnected) button.disabled = false; }
          });
          badge.append(badgeButton);
        }
        surface.append(badge);
        return true;
      }
      if (destroyed || !doc || !isEligibleSession(session)) {
        if (currentSession) unmount();
        return false;
      }
      const surface = resolveSurface();
      if (!surface) return false;
      const packet = session.comprehension.packet;
      const packetFingerprint = packetContentFingerprint(packet);
      const completionGeneration = completionGenerationIdentity(session);
      if (!packetFingerprint) {
        if (currentSession) unmount();
        return false;
      }
      const samePacket = currentSession
        && String(currentSession.id) === String(session.id)
        && currentPacket?.id === packet.id
        && currentPacketFingerprint === packetFingerprint
        && currentCompletionGeneration === completionGeneration
        && currentSurface === surface;
      currentSession = session;
      if (samePacket) {
        updateSummary();
        if (options.forceOpen) return openPacket({ auto: false });
        if (options.autoPresent !== false) presentIfNeeded();
        return true;
      }

      if (currentSurface) unmount();
      currentSession = session;
      currentPacket = packet;
      currentPacketFingerprint = packetFingerprint;
      currentCompletionGeneration = completionGeneration;
      currentSurface = surface;
      currentStorageKey = progressStorageKey(session, packet, context.storagePrefix || STORAGE_PREFIX);
      progress = normalizeProgress(storageRead(currentStorageKey));
      buildMountedDom();
      currentSurface.dataset.comprehensionPacketSession = String(session.id);
      if (progress.submitted) renderReview();
      else renderInitial();
      if (options.forceOpen) openPacket({ auto: false });
      else if (options.autoPresent !== false) presentIfNeeded();
      else closePacket({ announce: false, restoreFocus: false });
      return true;
    }

    function destroy() {
      if (destroyed) return;
      stopObserving();
      unmount();
      destroyed = true;
      doc?.removeEventListener("keydown", onDocumentKeydown, true);
      localeEventTarget?.removeEventListener?.("whitebox:locale-changed", onLocaleChanged);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    }

    doc?.addEventListener("keydown", onDocumentKeydown, true);
    localeEventTarget?.addEventListener?.("whitebox:locale-changed", onLocaleChanged);
    if (context.autoObserve !== false) startObserving();

    return {
      mount,
      sync: mount,
      syncFromSurface,
      startObserving,
      stopObserving,
      presentIfNeeded,
      open: openPacket,
      close: closePacket,
      unmount,
      destroy,
      isOpen: () => openState,
      getProgress: () => serializableProgress(),
      getSessionId: () => currentSession ? String(currentSession.id) : "",
    };
  }

  return Object.freeze({
    SCHEMA_VERSION,
    CONTRACT_OPEN,
    CONTRACT_CLOSE,
    COMPREHENSION_CONTRACT: CONTRACT_BLOCK,
    PACKET_OPEN: ENVELOPE_OPEN,
    PACKET_CLOSE: ENVELOPE_CLOSE,
    ENVELOPE_OPEN,
    ENVELOPE_CLOSE,
    CONTRACT_BLOCK,
    injectPrompt: injectContract,
    injectContract,
    stripContract,
    hasContract,
    isRenderablePacket,
    isEligibleSession,
    packetContentFingerprint,
    completionGenerationIdentity,
    progressStorageKey,
    createComprehensionPacket,
  });
});
