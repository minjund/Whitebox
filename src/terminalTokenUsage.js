'use strict';

const { terminalReviewUsage } = require('./terminalReviewUsage');
const count = value => Number.isSafeInteger(value) && value >= 0;
const keys = ['input', 'output', 'cachedInput', 'cacheWrite', 'total'];
// Claude repeats cumulative usage for one API request on consecutive rows, so
// only recent request ids need their last counters. Older ids never recur.
const MAX_TRACKED_CALLS = 512;
function remember(state, id, usage) {
  state.tokenCalls.delete(id); state.tokenCalls.set(id, usage);
  while (state.tokenCalls.size > MAX_TRACKED_CALLS) state.tokenCalls.delete(state.tokenCalls.keys().next().value);
}
function rememberMissing(state, id) {
  state.tokenMissing.add(id);
  if (state.tokenMissing.size > MAX_TRACKED_CALLS) {
    // An evicted unresolved call can no longer be confirmed: stay partial.
    state.tokenMissing.delete(state.tokenMissing.values().next().value);
    state.tokenMissingEvicted = true;
  }
}
const observedAt = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

// Process-bound conversation counters only. No screen estimates, account quota,
// review-model usage or other conversations contribute to a pane's total.
function observeClaudeUsage(state, row, sessionId) {
  if (row.sessionId !== sessionId || row.isSidechain || row.type !== 'assistant' || row.message?.role !== 'assistant') return;
  const id = row.requestId || row.message.id || row.uuid;
  if (typeof id !== 'string' || !id) return;
  state.tokenCalls ||= new Map(); state.tokenMissing ||= new Set();
  const raw = row.message.usage;
  const optionalValid = ['cache_read_input_tokens', 'cache_creation_input_tokens'].every(key => raw?.[key] === undefined || count(raw[key]));
  const usage = optionalValid ? terminalReviewUsage('claude', raw) : null;
  if (!usage || !keys.every(key => count(usage[key]))) {
    if (!state.tokenCalls.has(id)) rememberMissing(state, id);
    return;
  }
  state.tokenMissing.delete(id);
  const previous = state.tokenCalls.get(id);
  if (previous && previous.total > usage.total) return;
  const total = { ...(state.tokenTotal || Object.fromEntries(keys.map(key => [key, 0]))) };
  for (const key of keys) total[key] += usage[key] - (previous?.[key] || 0);
  if (!keys.every(key => count(total[key]))) { state.tokenOverflow = true; return; }
  remember(state, id, usage); state.tokenTotal = total;
  state.tokenObservedAt = observedAt(row.timestamp);
}

function observeCodexUsage(state, row) {
  if (row.type !== 'event_msg' || row.payload?.type !== 'token_count') return;
  const raw = row.payload.info?.total_token_usage;
  const usage = terminalReviewUsage('codex', raw);
  if (!usage || !keys.every(key => count(usage[key])) || usage.cachedInput > usage.input
    || raw.cached_input_tokens !== undefined && !count(raw.cached_input_tokens)
    || raw.total_tokens !== undefined && !count(raw.total_tokens)) { state.codexTokenUsage = null; return; }
  // total_token_usage is a cumulative snapshot. Cache and reasoning counters
  // are subsets of input/output, not additional billable token categories.
  state.codexTokenUsage = { ...usage, total: raw.total_tokens ?? usage.total, partial: false, observedAt: observedAt(row.timestamp) };
}

function tokenUsage(state) {
  if (Object.hasOwn(state, 'codexTokenUsage')) return state.codexTokenUsage;
  if (!state.tokenCalls?.size || state.tokenOverflow) return null;
  return { ...state.tokenTotal, partial: Boolean(state.tokenHistoryPartial || state.tokenMissing?.size || state.tokenMissingEvicted), observedAt: state.tokenObservedAt };
}

module.exports = { observeClaudeUsage, observeCodexUsage, tokenUsage, MAX_TRACKED_CALLS };
