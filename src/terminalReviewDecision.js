'use strict';

// Original implementation. Design references are recorded in
// docs/analysis-decision-design.md; no upstream code or prompts are vendored.
const limits = { simple: 220, standard: 450, complex: 600 };
const text = value => typeof value === 'string' ? value.trim() : '';

const decisionInstructions = `Inside each task, include decision:{"complexity":"simple|standard|complex","conclusion":"what can be decided now","reasons":[{"text":"why this changes the choice","evidenceQuote":"exact record substring"}],"caution":"material uncertainty or empty","action":{"kind":"finish|verify|choose|continue","text":"one useful next action","why":"decision it unlocks","request":"concrete follow-up or empty for finish"},"alternatives":[]}.
Derive meaning by connecting facts, not restating the work list. Use 1-3 reasons backed by current records or explicitly linked prior checks. Never cite omission markers or reference headers as facts. Finish only completed work with no unverified requirements; finish request is empty. Other actions require a concrete request within the user's goal. Recommendations do not authorize execution. Choose requires 2-3 real alternatives {option,tradeoff,when}; otherwise alternatives is [].
No repetition across fields. Limits are maxima, not quotas: conclusion 180 chars; reason text 120; caution 160; action text/why 120 each; action request 1000; each alternative field 100; quotes 1000. Total conclusion + reason texts + caution + action text/why <=220 simple, 450 standard, 600 complex. Use less for simple work. If unknown requirements change the decision, state that in caution. Keep facts and model inference distinct.`;

function assessDecision(value, { source, supported, unverified = [], lifecycle = 'completed' }) {
  if (value === undefined) return { decision: null, issues: [] }; // Cached/legacy response.
  const issues = [];
  const field = (value, label, max, required = true) => {
    const result = text(value);
    if ((required && !result) || result.length > max || typeof value !== 'string') issues.push(label);
    return result;
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { decision: null, issues: ['decision object'] };
  const complexity = value.complexity;
  if (!Object.hasOwn(limits, complexity)) issues.push('complexity');
  const conclusion = field(value.conclusion, 'conclusion', 180);
  const caution = field(value.caution, 'caution', 160, false);
  if (unverified.length && !caution) issues.push('missing decision-changing uncertainty');
  // Truncation alone does not establish a decision-changing missing fact.
  // Material unknowns are validated through the explicit unverified records.
  if (!Array.isArray(value.reasons) || value.reasons.length < 1 || value.reasons.length > 3) issues.push('1-3 reasons');
  const reasons = (Array.isArray(value.reasons) ? value.reasons : []).slice(0, 3).map(item => {
    const reason = field(item?.text, 'reason text', 120);
    const evidenceQuote = field(item?.evidenceQuote, 'reason evidence quote', 1000);
    if (!evidenceQuote || !source.includes(evidenceQuote)) issues.push('reason not in CURRENT evidence');
    if (/^\[omitted[: ]/iu.test(evidenceQuote) || /^\[e\d+ ·/u.test(evidenceQuote)) issues.push('metadata is not a factual reason');
    return { text: reason, evidenceQuote };
  });
  const kind = value.action?.kind;
  if (!['finish', 'verify', 'choose', 'continue'].includes(kind)) issues.push('action kind');
  if (kind === 'finish' && (lifecycle !== 'completed' || unverified.length)) issues.push('premature finish');
  const action = { kind, text: field(value.action?.text, 'action text', 120), why: field(value.action?.why, 'action why', 120),
    request: field(value.action?.request, 'action request', 1000, kind !== 'finish') };
  if (kind === 'finish' && action.request) issues.push('finish has follow-up');
  if (!Array.isArray(value.alternatives) || value.alternatives.length > 3) issues.push('0-3 alternatives');
  const alternatives = (Array.isArray(value.alternatives) ? value.alternatives : []).slice(0, 3).map(item => ({
    option: field(item?.option, 'alternative option', 100), tradeoff: field(item?.tradeoff, 'alternative tradeoff', 100), when: field(item?.when, 'alternative condition', 100),
  }));
  if (kind === 'choose' && alternatives.length < 2) issues.push('choice needs alternatives');
  if (kind !== 'choose' && alternatives.length) issues.push('unnecessary alternatives');
  const parts = [conclusion, ...reasons.map(item => item.text), caution, action.text, action.why].filter(Boolean);
  if (parts.join('').length > (limits[complexity] || 600)) issues.push('first-screen length');
  const normalized = parts.map(part => part.replace(/[\s\p{P}]/gu, '').toLowerCase());
  if (new Set(normalized).size !== normalized.length) issues.push('repeated explanation');
  if (!supported) issues.push('unsupported request/result');
  return { decision: issues.length ? null : { complexity, conclusion, reasons, caution, action, alternatives }, issues: [...new Set(issues)] };
}

function repairPrompt(prompt, issues) {
  // Do not feed an invalid draft back as instructions or as new evidence.
  return `${prompt}\nQUALITY REPAIR: The previous response failed these mechanical checks: ${issues.join(', ')}. Generate a complete replacement from the original evidence. Include a valid decision object. Preserve uncertainty and exact quotations. Do not remove a material limitation to meet the length budget; shorten lower-priority explanation instead.`;
}

function combinedUsage(first, second) {
  if (!first || !second) return null; // Unknown usage must not become zero.
  const result = {};
  for (const key of ['input', 'output', 'cachedInput', 'cacheWrite', 'total']) {
    if (![first[key], second[key]].every(value => Number.isSafeInteger(value) && value >= 0)) return null;
    result[key] = first[key] + second[key];
  }
  return result;
}

module.exports = { decisionInstructions, assessDecision, repairPrompt, combinedUsage };
