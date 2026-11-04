'use strict';

// Original implementation. Design references are recorded in
// docs/analysis-decision-design.md; no upstream code or prompts are vendored.
const limits = { simple: 220, standard: 450, complex: 600 };
const text = value => typeof value === 'string' ? value.trim() : '';

const decisionInstructions = `Inside each task, include decision:{"complexity":"simple|standard|complex","conclusion":"answer the substantive question or state what can be decided now","reasons":[{"text":"causal reason that changes the choice","evidenceQuote":"exact record substring"}],"caution":"decision-changing uncertainty or empty","action":{"kind":"finish|verify|choose|continue","text":"conditional recommendation or useful next action","why":"benefit or decision it unlocks","request":"concrete follow-up or empty for finish"},"alternatives":[]}.
Explain necessity through this caller's actual operations, separately from shared consumers. A return type or another caller alone is not a justification: connect operations/constraints to benefits, costs and consequences. Distinguish declaration-only edits from behavior, shared API and downstream contracts; widening a local type does not remove queries, allocation or dependencies.
Preserve 2-3 supported alternatives {option,tradeoff,when} when scopes or tradeoffs differ, even for completed explanations. Simple edits need no invented options. Use standard complexity for multiple scopes/tradeoffs; simple means one unambiguous result, not few code lines.
REQUEST SCOPE: Use user authorization and linked context; latest restrictions override earlier ones. Explaining/checking/reporting does not authorize repair. A completed check finding FAIL or an exceeded limit can finish with that negative result: action=finish, request="". Do not require a fix/retest as unverified work unless requested. Missing checking evidence may justify verify with observation or an existing check only. continue or any instruction to modify code/settings/data requires an implementation request; 'check and fix failures' permits conditional repair. Assistant plans and discovered defects grant no permission. Check action, nextStep, alternatives and unverified for unrequested fixing, optimization, deletion or deployment; remove such instructions.
Use 1-3 causal reasons with exact current/linked quotes, never headers or omission markers. Separate tools, assistant claims and inference. Attribute report-based explanations; a shortened excerpt alone needs no recheck. Finish means the requested deliverable is complete, not every test passed or the design is optimal. Recommendations grant no execution permission.
Before emitting JSON, settle required missing facts, then action and complexity. Known failures are facts, not unknowns. Nonempty unverified REQUIRES nonempty caution summarizing the blocker AND verify or user-authorized continue; never finish. Do not erase uncertainty to obtain finish. Finish requires completed work and no missing required evidence: leave action.text/why/request empty. Other actions require text/why/request; choose needs 2-3 alternatives. Keep nextStep="": the application derives it from decision.action.request. Do not duplicate that request elsewhere.
Max chars: conclusion 180; reason 120; caution 160; action text/why 120 each, request 1000; each alternative field 100; quotes 1000. Total conclusion + reason texts + caution + action text/why <=220 simple, 450 standard, 600 complex. Use standard for unresolved blockers or multi-step work; simple is one unambiguous result. Aim below the total limit with room for required caution/action, never cut their meaning. Before output check quotes, field limits, total length and these dependencies. Shorten repetition/background, not causal evidence, scope or uncertainty.`

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
  const action = { kind, text: field(value.action?.text, 'action text', 120, kind !== 'finish'), why: field(value.action?.why, 'action why', 120, kind !== 'finish'),
    request: field(value.action?.request, 'action request', 1000, kind !== 'finish') };
  if (kind === 'finish' && action.request) issues.push('finish has follow-up');
  if (!Array.isArray(value.alternatives) || value.alternatives.length > 3) issues.push('0-3 alternatives');
  const alternatives = (Array.isArray(value.alternatives) ? value.alternatives : []).slice(0, 3).map(item => ({
    option: field(item?.option, 'alternative option', 100), tradeoff: field(item?.tradeoff, 'alternative tradeoff', 100), when: field(item?.when, 'alternative condition', 100),
  }));
  if (kind === 'choose' && alternatives.length < 2) issues.push('choice needs alternatives');
  const parts = [conclusion, ...reasons.map(item => item.text), caution, action.text, action.why].filter(Boolean);
  if (parts.join('').length > (limits[complexity] || 600)) issues.push('first-screen length');
  const normalized = parts.map(part => part.replace(/[\s\p{P}]/gu, '').toLowerCase());
  if (new Set(normalized).size !== normalized.length) issues.push('repeated explanation');
  if (!supported) issues.push('unsupported request/result');
  return { decision: issues.length ? null : { complexity, conclusion, reasons, caution, action, alternatives }, issues: [...new Set(issues)] };
}

function repairPrompt(prompt, issues) {
  // Do not feed an invalid draft back as instructions or as new evidence.
  return `${prompt}\nQUALITY REPAIR: The previous response failed these mechanical checks: ${issues.join(', ')}. Generate a complete replacement from the original evidence. Return one complete JSON object with a tasks array containing exactly one task for the current REQUEST, including all of its requirements. Include a valid decision object. Preserve uncertainty and exact quotations. Do not remove a material limitation to meet the length budget; shorten lower-priority explanation instead.`;
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
