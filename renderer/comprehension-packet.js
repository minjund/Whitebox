"use strict";

// Read legacy contract envelopes in retained PTY replay. The dashboard's quiz UI
// is retired; current request understanding and review live in the workspace.
(function expose(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WhiteboxComprehensionPacket = api;
})(typeof window !== 'undefined' ? window : globalThis, function legacyPacketCodec(root) {
const SCHEMA_VERSION = 1;

const CONTRACT_OPEN = '<whitebox-comprehension-contract version="3">';

const LEGACY_CONTRACT_OPEN = '<whitebox-comprehension-contract version="1">';

const CONTRACT_CLOSE = "</whitebox-comprehension-contract>";

const ENVELOPE_OPEN = '<whitebox-comprehension-packet version="1">';

const ENVELOPE_CLOSE = "</whitebox-comprehension-packet>";

const STORAGE_PREFIX = "whitebox:comprehension:v1";

const FALLBACK_MESSAGES = Object.freeze({prompt_empty: "작업 내용을 입력하세요."});

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

const LEGACY_CONTRACT_BODY = `You are the main agent for a Whitebox-owned task. If and only if this main task completes successfully, create its comprehension packet in this same final response. Do not call another AI, start another turn, or delegate packet or variant-question generation. Subagents must not emit packets; use their work only as evidence in the main packet.

Write the normal user-visible final answer first. Then append exactly one ${ENVELOPE_OPEN}...${ENVELOPE_CLOSE} block as the final non-whitespace content. Put raw JSON in the block, without a Markdown fence or HTML.

The JSON must use schemaVersion 1 and exactly these fields:
{"schemaVersion":1,"id":"...","title":"...","summary":"...","difficulty":1,"difficultyReason":"...","evidence":[{"id":"...","label":"...","detail":"..."}],"questions":[{"id":"...","kind":"...","topics":["change","decision","constraint-risk"],"prompt":"...","options":[{"id":"...","label":"..."}],"answerId":"...","explanation":"...","evidenceIds":["..."],"variant":{"prompt":"...","options":[{"id":"...","label":"..."}],"answerId":"...","explanation":"..."}}]}

Choose difficulty 1-5 and 1-5 questions from task difficulty, comprehension difficulty, and misunderstanding risk. Across the questions, cover all three topics: change, decision, and constraint-risk. Each question and its pre-generated variant must be multiple choice with 2-6 choices, one valid answerId, an explanation, and real evidence references. Every defined id in the packet must be unique. All text must be plain text with no HTML or executable URL. If a trustworthy packet cannot be produced, omit the packet block; never invent a recovery call.`;

const LEGACY_CONTRACT_BLOCK = `${LEGACY_CONTRACT_OPEN}\n${LEGACY_CONTRACT_BODY}\n${CONTRACT_CLOSE}`;

const V2_CONTRACT_BODY = `You are the main agent for a Whitebox-owned task. If and only if this main task completes successfully, create its comprehension packet in this same final response. Do not call another AI, start another turn, or delegate packet or variant-question generation. Subagents must not emit packets; use them only as evidence in the main packet.

Write the normal user-visible final answer first. Then append exactly one ${ENVELOPE_OPEN}...${ENVELOPE_CLOSE} block as the final non-whitespace content. Put raw JSON in the block, without a Markdown fence or HTML.

The JSON must use schemaVersion 1 and exactly these fields:
{"schemaVersion":1,"id":"...","title":"...","summary":"...","difficulty":1,"difficultyReason":"...","evidence":[{"id":"e1","label":"...","detail":"..."}],"questions":[{"id":"q1","kind":"...","topics":["change","decision","constraint-risk"],"prompt":"...","options":[{"id":"a","label":"..."},{"id":"b","label":"..."}],"answerId":"a","explanation":"...","evidenceIds":["e1"],"variant":{"prompt":"...","options":[{"id":"a","label":"..."},{"id":"b","label":"..."}],"answerId":"a","explanation":"..."}}]}

Choose difficulty 1-5 and 1-5 questions from task difficulty, comprehension difficulty, and misunderstanding risk. Across the questions, cover all three topics: change, decision, and constraint-risk. Each question must be multiple choice with 2-6 choices, one valid answerId, an explanation, and real evidence references. A grounded variant question is optional; when included it must use the same multiple-choice shape with 2-6 choices, one valid answerId, and an explanation. Omit variant when it adds little value or cannot be grounded. Every defined id in the packet must be unique. All text must be plain text with no HTML or executable URL. If a trustworthy packet cannot be produced, omit the packet block; never invent a recovery call.

The summary is the user's open-book reading material, displayed beside the questions instead of the evidence list. Summarize the actual user-visible answer: its result or conclusion, the reasons for key decisions, and relevant limits, verification results, or remaining work. Divide it into a few short, relevant sections separated by blank lines. Each section must use exactly this plain-text shape: a concise subheading on its own line prefixed with "### ", one or two short body sentences, then a final hint line prefixed with "힌트: " (or the equivalent word for hint in the user's language). The hint must point to the fact or reasoning in that section that helps with one or more questions, without giving away the answer. Keep the whole summary within 6000 characters and self-contained so every question and any included variant can be answered or reasoned through from it without opening source files or evidence records. Do not merely list evidence labels, repeat the user's request, invent results, or reveal option IDs or an answer key. Keep evidence references in the packet for traceability.`;

const V2_CONTRACT_BLOCK = `<whitebox-comprehension-contract version="2">\n${V2_CONTRACT_BODY}\n${CONTRACT_CLOSE}`;

const CONTRACT_BODY = `You are the main agent for a Whitebox-owned task. If and only if this main task completes successfully, create its comprehension packet in this same final response. Do not call another AI, start another turn, or delegate packet or variant-question generation. Subagents must not emit packets; use them only as evidence in the main packet.

Write the normal user-visible final answer first. Then append exactly one ${ENVELOPE_OPEN}...${ENVELOPE_CLOSE} block as the final non-whitespace content. Put raw JSON in the block, without a Markdown fence or HTML.

The JSON must use schemaVersion 1 and exactly these fields:
{"schemaVersion":1,"id":"...","title":"...","summary":"...","difficulty":1,"difficultyReason":"...","sections":[{"id":"s1","title":"...","body":"...","questionIds":["q1"]}],"evidence":[{"id":"e1","label":"...","detail":"..."}],"questions":[{"id":"q1","kind":"...","topics":["change","decision","constraint-risk"],"prompt":"...","options":[{"id":"a","label":"..."},{"id":"b","label":"..."},{"id":"c","label":"..."}],"answerId":"a","explanation":"...","evidenceIds":["e1"],"variant":{"prompt":"...","options":[{"id":"a","label":"..."},{"id":"b","label":"..."},{"id":"c","label":"..."}],"answerId":"a","explanation":"..."}}]}

Select only the most important concepts, actual behavior changes, decision reasons, and meaningful constraints. Omit long introductions, generic background, file-by-file walkthroughs, repeated facts, and filler. Use the user's language and choose difficulty 1-5 (default 3 when unspecified and the material supports it).

The sections array is the learning material. Each section has exactly id, title, body, and questionIds. Give each a short descriptive title that does not reveal the answer. The app displays each title on the left with its body hidden behind a hint toggle, and only its referenced questions on the right. Each question ID must appear in exactly one section; every section must reference at least one question. Every question and optional variant must be answerable from its own section body. Teach the relevant concept without option IDs or an answer key. Do not assume that merely adjacent paragraphs correspond to questions. Keep summary to a one-sentence overview; do not duplicate all section bodies there.

Scale content with difficulty: levels 1-2 use 2-3 sections, 1 question per section, and 1-2 short body sentences; level 3 uses 3-5 sections, 1-2 questions per section, and 2-4 body sentences; levels 4-5 use 5-7 sections, 2 questions per section, and 4-6 body sentences. Use fewer sections or questions when the source has fewer distinct concepts, even just one. Never invent or repeat content to meet a count. Maximum 7 sections and 14 questions. Harder questions require application, interacting conditions, exceptions, or cause-and-effect reasoning; add necessary context, not verbosity or obscure vocabulary. Keep each section body within 1600 characters and all section bodies together within 6000 characters.

Each question has 3-4 distinct, plausible choices with exactly one correct answer and a concise explanation (at most two sentences). Match option length, specificity, and tone so these do not reveal the answer; vary correct-answer position. Cover change, decision, and constraint-risk across the quiz. A grounded variant is optional; omit it unless it adds useful practice. Packet, section, evidence, and question IDs must be unique ASCII identifiers. Option IDs need only be unique within their list. Reference defined evidence IDs for traceability. All text is plain text without HTML or executable URLs. Never invent work, decisions, evidence, checks, risks, or results.

If a trustworthy packet cannot be produced, omit the packet block; never invent a recovery call.`;

const CONTRACT_BLOCK = `${CONTRACT_OPEN}\n${CONTRACT_BODY}\n${CONTRACT_CLOSE}`;

function stripContract(value) {
    const prompt = typeof value === "string" ? value : String(value == null ? "" : value);
    for (const contract of [CONTRACT_BLOCK, V2_CONTRACT_BLOCK, LEGACY_CONTRACT_BLOCK]) {
      const prefix = `${contract}\n\n`;
      if (prompt.startsWith(prefix)) return prompt.slice(prefix.length);
      if (prompt === contract) return "";
    }
    return prompt;
  }

function hasContract(value) {
    const prompt = typeof value === "string" ? value : String(value == null ? "" : value);
    return [CONTRACT_BLOCK, V2_CONTRACT_BLOCK, LEGACY_CONTRACT_BLOCK].some(contract => (
      prompt === contract || prompt.startsWith(`${contract}\n\n`)
    ));
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
      || packet.questions.length > (packet.sections === undefined ? 5 : 14)) return false;

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
        || !question.evidenceIds.every(id => isText(id) && evidenceIds.has(id))) return false;
      if (question.variant !== undefined && (!isRecord(question.variant)
        || !isText(question.variant.prompt)
        || !isText(question.variant.explanation)
        || !optionListIsRenderable(question.variant.options, question.variant.answerId))) return false;
      questionIds.add(question.id);
    }
    if (packet.sections !== undefined) {
      if (!Array.isArray(packet.sections) || !packet.sections.length || packet.sections.length > 7) return false;
      const sectionIds = new Set([packet.id, ...evidenceIds, ...questionIds]);
      const assigned = new Set();
      let bodyLength = 0;
      for (const section of packet.sections) {
        if (!isRecord(section) || !isText(section.id) || sectionIds.has(section.id)
          || !isText(section.title) || section.title.length > 180
          || !isText(section.body) || section.body.length > 1600
          || !Array.isArray(section.questionIds) || !section.questionIds.length) return false;
        sectionIds.add(section.id);
        bodyLength += section.body.length;
        for (const id of section.questionIds) {
          if (!questionIds.has(id) || assigned.has(id)) return false;
          assigned.add(id);
        }
      }
      if (bodyLength > 6000 || assigned.size !== questionIds.size) return false;
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
  return Object.freeze({SCHEMA_VERSION,
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
progressStorageKey});
});
