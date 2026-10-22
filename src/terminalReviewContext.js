'use strict';

const { bounded } = require('./terminalReviewBudget');

// History is evidence from this exact provider log, never a source of new
// instructions. Keep it separate from execution evidence for the current turn.
function archiveRequest(state) {
  if (!state.requestId || !state.request) return;
  state.context = [...(state.context || []), { request: bounded(state.request, 600), answer: bounded(state.answer, 300) }];
  if (state.context.length > 6) {
    state.context.shift();
    state.contextOmitted = (state.contextOmitted || 0) + 1;
  }
}

function recordAnswer(state, answer) {
  if (!answer || answer === state.answer) return;
  if (state.answer) {
    state.updates = [...(state.updates || []), bounded(state.answer, 600)];
    // Preserve early execution reports as well as the most recent updates.
    if (state.updates.length > 16) {
      state.updates.splice(8, 1);
      state.updatesOmitted = (state.updatesOmitted || 0) + 1;
    }
  }
  state.answer = answer;
}

function reviewContext(state) {
  return { items: state.context || [], omitted: state.contextOmitted || 0 };
}
function assistantUpdates(state) {
  return { items: state.updates || [], omitted: state.updatesOmitted || 0 };
}
function compactContext(context) {
  const items = Array.isArray(context?.items) ? context.items : [];
  return JSON.stringify({ scope: 'earlier turns, not current execution', omitted: (context?.omitted || 0) + Math.max(0, items.length - 6),
    items: items.slice(-6).map(item => ({ request: bounded(item.request, 320), answer: bounded(item.answer, 140) })) });
}
function compactUpdates(updates) {
  const items = Array.isArray(updates?.items) ? updates.items : [];
  const selected = items.length <= 8 ? items : [...items.slice(0, 4), ...items.slice(-4)];
  return JSON.stringify({ scope: 'current request assistant reports, not independent verification',
    omitted: (updates?.omitted || 0) + items.length - selected.length, items: selected.map(item => bounded(item, 260)) });
}

module.exports = { archiveRequest, recordAnswer, reviewContext, assistantUpdates, compactContext, compactUpdates };
