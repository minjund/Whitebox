'use strict';

const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const MAX_PACKET_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CONTRACT_PROMPT_FINGERPRINTS = 32;
const MAX_EVIDENCE = 20;
const MAX_OPTIONS = 6;
const TOPICS = Object.freeze(['change', 'decision', 'constraint-risk']);
const TOPIC_SET = new Set(TOPICS);
const PACKET_STATUSES = new Set(['ready', 'missing', 'invalid', 'unsupported']);

const CONTRACT_OPEN = `<whitebox-comprehension-contract version="${SCHEMA_VERSION}">`;
const CONTRACT_CLOSE = '</whitebox-comprehension-contract>';
const PACKET_OPEN = `<whitebox-comprehension-packet version="${SCHEMA_VERSION}">`;
const PACKET_CLOSE = '</whitebox-comprehension-packet>';

const COMPREHENSION_CONTRACT = `${CONTRACT_OPEN}
You are the main agent for a Whitebox-owned task. If and only if this main task completes successfully, create its comprehension packet in this same final response. Do not call another AI, start another turn, or delegate packet or variant-question generation. Subagents must not emit packets; use their work only as evidence in the main packet.

Write the normal user-visible final answer first. Then append exactly one ${PACKET_OPEN}...${PACKET_CLOSE} block as the final non-whitespace content. Put raw JSON in the block, without a Markdown fence or HTML.

The JSON must use schemaVersion 1 and exactly these fields:
{"schemaVersion":1,"id":"...","title":"...","summary":"...","difficulty":1,"difficultyReason":"...","evidence":[{"id":"...","label":"...","detail":"..."}],"questions":[{"id":"...","kind":"...","topics":["change","decision","constraint-risk"],"prompt":"...","options":[{"id":"...","label":"..."}],"answerId":"...","explanation":"...","evidenceIds":["..."],"variant":{"prompt":"...","options":[{"id":"...","label":"..."}],"answerId":"...","explanation":"..."}}]}

Choose difficulty 1-5 and 1-5 questions from task difficulty, comprehension difficulty, and misunderstanding risk. Across the questions, cover all three topics: change, decision, and constraint-risk. Each question and its pre-generated variant must be multiple choice with 2-6 choices, one valid answerId, an explanation, and real evidence references. Every defined id in the packet must be unique. All text must be plain text with no HTML or executable URL. If a trustworthy packet cannot be produced, omit the packet block; never invent a recovery call.
${CONTRACT_CLOSE}`;

// Keep the version-1 contract byte-stable: persisted launch fingerprints and
// historical transcript stripping depend on it. Clarify turn scope only in
// the private provider instruction channel.
const COMPREHENSION_INSTRUCTIONS = `${COMPREHENSION_CONTRACT}

Apply the comprehension contract to each successfully answered user turn, including questions, explanations, analysis, and reviews; no code change or project completion is required. A complete answer to the current question counts as success even when you offer optional next steps. Use the user's language. For informational answers, cover what the user learned, the reasoning behind it, and its limits or risks. Ground the questions in the answer and observed evidence; do not invent changes or facts. Before finishing a successful answer, check that its final content includes the valid packet specified above. Keep these instructions out of the visible answer. Incomplete, failed, or clarification-only turns must not emit a packet.`;

const PACKET_KEYS = Object.freeze([
  'schemaVersion', 'id', 'title', 'summary', 'difficulty', 'difficultyReason', 'evidence', 'questions',
]);
const EVIDENCE_KEYS = Object.freeze(['id', 'label', 'detail']);
const QUESTION_KEYS = Object.freeze([
  'id', 'kind', 'topics', 'prompt', 'options', 'answerId', 'explanation', 'evidenceIds', 'variant',
]);
const OPTION_KEYS = Object.freeze(['id', 'label']);
const VARIANT_KEYS = Object.freeze(['prompt', 'options', 'answerId', 'explanation']);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u;
const HTML_TAG_PATTERN = /<\s*\/?\s*[A-Za-z][^>]*>/u;
const ENCODED_HTML_PATTERN = /&(?:lt|#0*60|#x0*3c);?\s*\/?\s*(?:script|iframe|object|embed|svg|math|style|link|meta|img|video|audio|form|input|button)\b/iu;
const EXECUTABLE_TEXT_PATTERN = /(?:javascript|vbscript)\s*:|data\s*:\s*text\/html|\bon[a-z]{2,}\s*=/iu;
const UNSAFE_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;

function byteLength(value) {
  return Buffer.byteLength(String(value == null ? '' : value), 'utf8');
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function issue(path, code, message) {
  return { path, code, message };
}

function safeText(value, path, limit, issues) {
  if (typeof value !== 'string') {
    issues.push(issue(path, 'TEXT_TYPE', 'must be a string'));
    return '';
  }
  if (!value.trim() || value !== value.trim()) {
    issues.push(issue(path, 'TEXT_EMPTY_OR_PADDED', 'must be non-empty and have no outer whitespace'));
  }
  if (value.length > limit || byteLength(value) > limit * 4) {
    issues.push(issue(path, 'TEXT_TOO_LONG', `must not exceed ${limit} characters`));
  }
  if (UNSAFE_CONTROL_PATTERN.test(value)) {
    issues.push(issue(path, 'UNSAFE_CONTROL', 'contains unsafe control characters'));
  }
  if (HTML_TAG_PATTERN.test(value) || ENCODED_HTML_PATTERN.test(value) || EXECUTABLE_TEXT_PATTERN.test(value)) {
    issues.push(issue(path, 'UNSAFE_HTML', 'contains HTML or executable content'));
  }
  return value;
}

function safeId(value, path, issues, definedIds = null) {
  const id = safeText(value, path, 80, issues);
  if (id && !ID_PATTERN.test(id)) issues.push(issue(path, 'ID_FORMAT', 'has an invalid identifier format'));
  if (id && definedIds) {
    if (definedIds.has(id)) issues.push(issue(path, 'DUPLICATE_ID', `duplicates id ${id}`));
    else definedIds.add(id);
  }
  return id;
}

function validateOptions(value, path, issues, definedIds) {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_OPTIONS) {
    issues.push(issue(path, 'OPTION_COUNT', `must contain 2-${MAX_OPTIONS} options`));
    return new Set();
  }
  const ids = new Set();
  const labels = new Set();
  value.forEach((option, index) => {
    const optionPath = `${path}[${index}]`;
    if (!hasExactKeys(option, OPTION_KEYS)) {
      issues.push(issue(optionPath, 'OPTION_KEYS', 'must contain exactly id and label'));
      return;
    }
    const id = safeId(option.id, `${optionPath}.id`, issues, definedIds);
    if (id) ids.add(id);
    const label = safeText(option.label, `${optionPath}.label`, 500, issues);
    if (label && labels.has(label)) {
      issues.push(issue(`${optionPath}.label`, 'OPTION_LABEL_DUPLICATE', `duplicates option label ${label}`));
    } else if (label) {
      labels.add(label);
    }
  });
  return ids;
}

function validAnswer(answerId, optionIds, path, issues) {
  const value = safeId(answerId, path, issues);
  if (value && !optionIds.has(value)) {
    issues.push(issue(path, 'ANSWER_REFERENCE', 'must reference an option in the same question'));
  }
}

function validateComprehensionPacket(value) {
  const issues = [];
  let serialized = '';
  try {
    serialized = JSON.stringify(value);
  } catch (_error) {
    return { ok: false, issues: [issue('$', 'NOT_SERIALIZABLE', 'must be JSON serializable')] };
  }
  if (!serialized || byteLength(serialized) > MAX_PACKET_BYTES) {
    issues.push(issue('$', 'PACKET_TOO_LARGE', `must not exceed ${MAX_PACKET_BYTES} bytes`));
  }
  if (!hasExactKeys(value, PACKET_KEYS)) {
    issues.push(issue('$', 'PACKET_KEYS', `must contain exactly ${PACKET_KEYS.join(', ')}`));
    return { ok: false, issues };
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    issues.push(issue('$.schemaVersion', 'SCHEMA_VERSION', `must equal ${SCHEMA_VERSION}`));
  }
  const definedIds = new Set();
  safeId(value.id, '$.id', issues, definedIds);
  safeText(value.title, '$.title', 180, issues);
  safeText(value.summary, '$.summary', 6000, issues);
  if (!Number.isInteger(value.difficulty) || value.difficulty < 1 || value.difficulty > 5) {
    issues.push(issue('$.difficulty', 'DIFFICULTY_RANGE', 'must be an integer from 1 to 5'));
  }
  safeText(value.difficultyReason, '$.difficultyReason', 1200, issues);

  const evidenceIds = new Set();
  if (!Array.isArray(value.evidence) || value.evidence.length < 1 || value.evidence.length > MAX_EVIDENCE) {
    issues.push(issue('$.evidence', 'EVIDENCE_COUNT', `must contain 1-${MAX_EVIDENCE} evidence items`));
  } else {
    value.evidence.forEach((evidence, index) => {
      const evidencePath = `$.evidence[${index}]`;
      if (!hasExactKeys(evidence, EVIDENCE_KEYS)) {
        issues.push(issue(evidencePath, 'EVIDENCE_KEYS', 'must contain exactly id, label, and detail'));
        return;
      }
      const id = safeId(evidence.id, `${evidencePath}.id`, issues, definedIds);
      if (id) evidenceIds.add(id);
      safeText(evidence.label, `${evidencePath}.label`, 180, issues);
      safeText(evidence.detail, `${evidencePath}.detail`, 2000, issues);
    });
  }

  const coveredTopics = new Set();
  if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 5) {
    issues.push(issue('$.questions', 'QUESTION_COUNT', 'must contain 1-5 questions'));
  } else {
    value.questions.forEach((question, index) => {
      const questionPath = `$.questions[${index}]`;
      if (!hasExactKeys(question, QUESTION_KEYS)) {
        issues.push(issue(questionPath, 'QUESTION_KEYS', `must contain exactly ${QUESTION_KEYS.join(', ')}`));
        return;
      }
      safeId(question.id, `${questionPath}.id`, issues, definedIds);
      safeText(question.kind, `${questionPath}.kind`, 100, issues);
      safeText(question.prompt, `${questionPath}.prompt`, 1200, issues);
      safeText(question.explanation, `${questionPath}.explanation`, 2400, issues);

      if (!Array.isArray(question.topics) || question.topics.length < 1 || question.topics.length > TOPICS.length) {
        issues.push(issue(`${questionPath}.topics`, 'TOPIC_COUNT', 'must contain 1-3 topics'));
      } else {
        const localTopics = new Set();
        question.topics.forEach((topic, topicIndex) => {
          const topicPath = `${questionPath}.topics[${topicIndex}]`;
          if (!TOPIC_SET.has(topic)) issues.push(issue(topicPath, 'TOPIC_VALUE', `must be one of ${TOPICS.join(', ')}`));
          else if (localTopics.has(topic)) issues.push(issue(topicPath, 'TOPIC_DUPLICATE', `duplicates topic ${topic}`));
          else {
            localTopics.add(topic);
            coveredTopics.add(topic);
          }
        });
      }

      const optionIds = validateOptions(question.options, `${questionPath}.options`, issues, definedIds);
      validAnswer(question.answerId, optionIds, `${questionPath}.answerId`, issues);

      if (!Array.isArray(question.evidenceIds) || question.evidenceIds.length < 1 || question.evidenceIds.length > MAX_EVIDENCE) {
        issues.push(issue(`${questionPath}.evidenceIds`, 'EVIDENCE_REFERENCE_COUNT', `must contain 1-${MAX_EVIDENCE} evidence references`));
      } else {
        const localEvidence = new Set();
        question.evidenceIds.forEach((evidenceId, evidenceIndex) => {
          const evidencePath = `${questionPath}.evidenceIds[${evidenceIndex}]`;
          const id = safeId(evidenceId, evidencePath, issues);
          if (id && localEvidence.has(id)) issues.push(issue(evidencePath, 'EVIDENCE_REFERENCE_DUPLICATE', `duplicates evidence reference ${id}`));
          else if (id) localEvidence.add(id);
          if (id && !evidenceIds.has(id)) issues.push(issue(evidencePath, 'EVIDENCE_REFERENCE', `references unknown evidence ${id}`));
        });
      }

      if (!hasExactKeys(question.variant, VARIANT_KEYS)) {
        issues.push(issue(`${questionPath}.variant`, 'VARIANT_KEYS', `must contain exactly ${VARIANT_KEYS.join(', ')}`));
      } else {
        safeText(question.variant.prompt, `${questionPath}.variant.prompt`, 1200, issues);
        safeText(question.variant.explanation, `${questionPath}.variant.explanation`, 2400, issues);
        const variantOptionIds = validateOptions(question.variant.options, `${questionPath}.variant.options`, issues, definedIds);
        validAnswer(question.variant.answerId, variantOptionIds, `${questionPath}.variant.answerId`, issues);
      }
    });
  }
  for (const topic of TOPICS) {
    if (!coveredTopics.has(topic)) issues.push(issue('$.questions', 'TOPIC_COVERAGE', `must cover topic ${topic}`));
  }
  return issues.length ? { ok: false, issues } : { ok: true, packet: value, issues: [] };
}

function packetError(message, code = 'COMPREHENSION_PACKET_INVALID', issues = []) {
  const error = new Error(message);
  error.code = code;
  error.issues = issues;
  return error;
}

function assertValidComprehensionPacket(value) {
  const result = validateComprehensionPacket(value);
  if (!result.ok) throw packetError('이해 패킷 스키마가 올바르지 않습니다.', 'COMPREHENSION_PACKET_INVALID', result.issues);
  return result.packet;
}

function stripSingleEnvelope(body, start, end) {
  let visibleBody = body.slice(0, start) + body.slice(end);
  if (start > 0 && end === body.length) visibleBody = visibleBody.replace(/(?:\r?\n){1,2}$/u, '');
  return visibleBody;
}

function comprehensionState(status, packet = null) {
  if (!PACKET_STATUSES.has(status)) throw new TypeError(`Unsupported comprehension status: ${status}`);
  return { status, schemaVersion: SCHEMA_VERSION, packet: status === 'ready' ? packet : null };
}

function extractComprehensionPacket(value) {
  const body = typeof value === 'string' ? value : String(value == null ? '' : value);
  if (byteLength(body) > MAX_RESPONSE_BYTES) {
    return {
      body,
      comprehension: comprehensionState('invalid'),
      error: packetError('최종 응답이 이해 패킷 추출 한도를 초과했습니다.', 'COMPREHENSION_RESPONSE_TOO_LARGE'),
    };
  }

  const openPattern = /<whitebox-comprehension-packet\b[^>]*>/giu;
  const closePattern = /<\/whitebox-comprehension-packet\s*>/giu;
  const openingTags = [...body.matchAll(openPattern)];
  const closingTags = [...body.matchAll(closePattern)];
  if (!openingTags.length) return { body, comprehension: comprehensionState('missing'), error: null };
  if (openingTags.length !== 1 || openingTags[0][0] !== PACKET_OPEN) {
    return {
      body,
      comprehension: comprehensionState('invalid'),
      error: packetError('이해 패킷 envelope 시작 태그가 올바르지 않습니다.'),
    };
  }
  if (closingTags.length !== 1 || closingTags[0][0] !== PACKET_CLOSE) {
    return {
      body,
      comprehension: comprehensionState('invalid'),
      error: packetError('이해 패킷 envelope 종료 태그가 없거나 중복되었습니다.'),
    };
  }

  const start = openingTags[0].index;
  const contentStart = start + PACKET_OPEN.length;
  const close = closingTags[0].index;
  if (close < contentStart) {
    return {
      body,
      comprehension: comprehensionState('invalid'),
      error: packetError('이해 패킷 envelope 종료 태그가 없거나 중복되었습니다.'),
    };
  }
  const end = close + PACKET_CLOSE.length;
  const trailingContent = body.slice(end);
  const visibleBody = stripSingleEnvelope(body, start, trailingContent.trim() ? end : body.length);
  if (trailingContent.trim()) {
    return {
      body: visibleBody,
      comprehension: comprehensionState('invalid'),
      error: packetError('이해 패킷 envelope는 최종 응답의 마지막 내용이어야 합니다.'),
    };
  }

  const rawJsonText = body.slice(contentStart, close);
  const jsonText = rawJsonText.trim();
  if (!jsonText || byteLength(rawJsonText) > MAX_PACKET_BYTES) {
    return {
      body: visibleBody,
      comprehension: comprehensionState('invalid'),
      error: packetError('이해 패킷 JSON이 비어 있거나 너무 큽니다.', 'COMPREHENSION_PACKET_TOO_LARGE'),
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (_error) {
    return {
      body: visibleBody,
      comprehension: comprehensionState('invalid'),
      error: packetError('이해 패킷 JSON을 읽을 수 없습니다.'),
    };
  }
  const validation = validateComprehensionPacket(parsed);
  if (!validation.ok) {
    return {
      body: visibleBody,
      comprehension: comprehensionState('invalid'),
      error: packetError('이해 패킷 스키마가 올바르지 않습니다.', 'COMPREHENSION_PACKET_INVALID', validation.issues),
    };
  }
  return { body: visibleBody, comprehension: comprehensionState('ready', validation.packet), error: null };
}

function stripComprehensionContract(value) {
  const prompt = typeof value === 'string' ? value : String(value == null ? '' : value);
  const prefix = `${COMPREHENSION_CONTRACT}\n\n`;
  if (prompt.startsWith(prefix)) return prompt.slice(prefix.length);
  return prompt === COMPREHENSION_CONTRACT ? '' : prompt;
}

function hasComprehensionContract(value) {
  const prompt = typeof value === 'string' ? value : String(value == null ? '' : value);
  return prompt === COMPREHENSION_CONTRACT || prompt.startsWith(`${COMPREHENSION_CONTRACT}\n\n`);
}

function injectComprehensionContract(value) {
  const prompt = typeof value === 'string' ? value : String(value == null ? '' : value);
  if (!prompt.trim()) throw packetError('작업 내용을 입력하세요.', 'COMPREHENSION_PROMPT_EMPTY');
  if (hasComprehensionContract(prompt)) return prompt;
  if (/<\/?whitebox-comprehension-(?:contract|packet)\b/iu.test(prompt)) {
    throw packetError('작업 내용에 예약된 이해 패킷 태그가 포함되어 있습니다.', 'COMPREHENSION_RESERVED_MARKER');
  }
  return `${COMPREHENSION_CONTRACT}\n\n${prompt}`;
}

function comprehensionPromptFingerprint(value) {
  const prompt = typeof value === 'string' ? value : String(value == null ? '' : value);
  return crypto.createHash('sha256').update(prompt, 'utf8').digest('hex');
}

function normalizedComprehensionContractPromptFingerprints(value) {
  if (!Array.isArray(value) || value.length > MAX_CONTRACT_PROMPT_FINGERPRINTS) return [];
  const fingerprints = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !/^[a-f0-9]{64}$/u.test(item) || seen.has(item)) return [];
    seen.add(item);
    fingerprints.push(item);
  }
  return fingerprints;
}

/**
 * Retains only a bounded SHA-256 proof of an exact raw injected prompt. The
 * prompt itself must never be copied into private session provenance.
 */
function observeComprehensionContractPrompt(target, value) {
  if (!target || typeof target !== 'object') return false;
  const prompt = typeof value === 'string' ? value : String(value == null ? '' : value);
  // A provider can receive the contract through its private instruction
  // channel. Retain exact user-message proof separately; this is not proof
  // that an external conversation belongs to Whitebox.
  const userProof = normalizedComprehensionContractPromptFingerprints(target.comprehensionUserPromptFingerprints);
  const userFingerprint = comprehensionPromptFingerprint(prompt);
  if (prompt.trim() && !userProof.includes(userFingerprint) && userProof.length < MAX_CONTRACT_PROMPT_FINGERPRINTS) {
    userProof.push(userFingerprint);
  }
  target.comprehensionUserPromptFingerprints = userProof;
  if (!hasComprehensionContract(prompt)) return false;
  target.comprehensionContractObserved = true;
  const current = normalizedComprehensionContractPromptFingerprints(
    target.comprehensionContractPromptFingerprints,
  );
  const fingerprint = comprehensionPromptFingerprint(prompt);
  if (!current.includes(fingerprint) && current.length < MAX_CONTRACT_PROMPT_FINGERPRINTS) {
    current.push(fingerprint);
  }
  target.comprehensionContractPromptFingerprints = current;
  return true;
}

function comprehensionEligibility(session, options = {}) {
  if (!session || typeof session !== 'object') return { eligible: false, status: 'ineligible', reason: 'missing-session' };
  if (session.parentId || Number(session.depth || 0) > 0) return { eligible: false, status: 'ineligible', reason: 'subagent' };
  const status = String(session.status || '').toLowerCase();
  if (status !== 'completed') return { eligible: false, status: 'ineligible', reason: status || 'not-completed' };
  if (session.completionObserved !== true || session.outcome?.verification === 'unverified') {
    return { eligible: false, status: 'ineligible', reason: 'completion-unverified' };
  }
  const contractInjected = options.contractInjected === true
    || session.comprehensionContractInjected === true
    || session.comprehensionOrigin?.contractInjected === true;
  if (!contractInjected) return { eligible: false, status: 'unsupported', reason: 'external-session' };
  return { eligible: true, status: 'eligible', reason: 'completed-main-owned' };
}

function finalizeComprehension(session, responseText, options = {}) {
  const eligibility = comprehensionEligibility(session, options);
  const body = typeof responseText === 'string' ? responseText : String(responseText == null ? '' : responseText);
  if (!eligibility.eligible) {
    return {
      body,
      comprehension: eligibility.status === 'unsupported' ? comprehensionState('unsupported') : null,
      eligibility,
      error: null,
    };
  }
  const extracted = extractComprehensionPacket(body);
  return { ...extracted, eligibility };
}

function stageComprehensionCandidate(session, responseText, options = {}) {
  const contractInjected = options.contractInjected === true;
  if (contractInjected) {
    return { ...finalizeComprehension(session, responseText, { contractInjected: true }), candidate: null };
  }

  const external = finalizeComprehension(session, responseText, { contractInjected: false });
  if (options.stageCandidate !== true && options.contractObserved !== true) {
    return { ...external, candidate: null };
  }

  // Provider output is only a parse hint. Keep a validated packet as an
  // untrusted candidate until an authenticated Whitebox terminal bridge
  // proves the exact launch or a persisted conversation binding.
  const staged = finalizeComprehension(session, responseText, { contractInjected: true });
  if (!staged.eligibility.eligible) return { ...external, candidate: null };
  return {
    ...external,
    body: staged.body,
    candidate: staged.comprehension,
    candidateEligibility: staged.eligibility,
    error: staged.error,
  };
}

function promoteComprehensionCandidate(session, authority = 'whitebox-terminal-bridge') {
  if (!session || typeof session !== 'object'
    || !session.comprehensionCandidate) return false;
  session.comprehensionContractInjected = true;
  session.comprehensionOrigin = {
    contractInjected: true,
    authority: String(authority || 'whitebox-terminal-bridge'),
  };
  session.comprehension = session.comprehensionCandidate;
  delete session.comprehensionCandidate;
  return true;
}

module.exports = {
  COMPREHENSION_CONTRACT,
  COMPREHENSION_INSTRUCTIONS,
  CONTRACT_CLOSE,
  CONTRACT_OPEN,
  MAX_PACKET_BYTES,
  MAX_RESPONSE_BYTES,
  MAX_CONTRACT_PROMPT_FINGERPRINTS,
  PACKET_CLOSE,
  PACKET_OPEN,
  SCHEMA_VERSION,
  TOPICS,
  assertValidComprehensionPacket,
  comprehensionEligibility,
  comprehensionPromptFingerprint,
  comprehensionState,
  extractComprehensionPacket,
  finalizeComprehension,
  hasComprehensionContract,
  injectComprehensionContract,
  normalizedComprehensionContractPromptFingerprints,
  observeComprehensionContractPrompt,
  promoteComprehensionCandidate,
  stageComprehensionCandidate,
  stripComprehensionContract,
  validateComprehensionPacket,
};
