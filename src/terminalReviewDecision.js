'use strict';

// Original implementation. Design references are recorded in
// docs/analysis-decision-design.md; no upstream code or prompts are vendored.
const limits = { simple: 220, standard: 450, complex: 600 };
const text = value => typeof value === 'string' ? value.trim() : '';

const decisionInstructions = `Add a decision object to the task:
"decision":{"complexity":"simple|standard|complex","conclusion":"current result and what can be decided now","reasons":[{"text":"reason supporting the judgment","evidenceQuote":"exact CURRENT evidence substring"}],"caution":"decision-changing uncertainty or empty","action":{"kind":"finish|verify|choose|continue","text":"one recommended next action","why":"why this action is useful now","request":"ready-to-send follow-up request, or empty for finish"},"alternatives":[{"option":"real alternative","tradeoff":"benefit and cost","when":"condition that makes this preferable"}]}.
First establish the observed result and limits, then the decision that is actually needed, then the smallest useful action. Separate facts, reported claims and advice. Reasons need 1-3 exact CURRENT evidence quotes; quotes show provenance, not independent proof. Do not invent choices or ask questions answerable from the supplied evidence. Compare at most 3 real alternatives ONLY for an actual unresolved choice, otherwise use []. Explain what would change the recommendation. Missing evidence calls for a targeted check, never a confident completion claim. If relevant unverified requirements or omitted evidence could change the decision, put that limitation in caution, not only in details. Do not finish interrupted or in-progress work. Finish is valid when no further action is needed; its request must be empty. Other actions require a concrete request that stays within the user's goal. A recommendation is not authorization to execute it.
Keep the first-screen text (conclusion + reasons.text + caution + action.text + action.why) within 220 characters for simple, 450 for standard, 600 for complex tasks, in the requested language. These are maxima, not quotas. Use fewer words when possible. Put technical detail in understanding/verification and alternatives; do not repeat the same explanation across fields. Keep conclusion <=180, each reason <=120, caution <=160, each action text/why <=120, request <=1000; each alternative field <=100. Choose simple for a small edit or explanation, standard for ordinary work, complex only for interacting tradeoffs. Before returning, check evidence, decisive omissions, duplication, clarity and length. Return only the final JSON, no private reasoning.`;

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
  if (source.includes('[omitted:') && !caution) issues.push('missing evidence omission caution');
  if (!Array.isArray(value.reasons) || value.reasons.length < 1 || value.reasons.length > 3) issues.push('1-3 reasons');
  const reasons = (Array.isArray(value.reasons) ? value.reasons : []).slice(0, 3).map(item => {
    const reason = field(item?.text, 'reason text', 120);
    const evidenceQuote = field(item?.evidenceQuote, 'reason evidence quote', 1000);
    if (!evidenceQuote || !source.includes(evidenceQuote)) issues.push('reason not in CURRENT evidence');
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
