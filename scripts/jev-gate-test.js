'use strict';
const assert = require('node:assert/strict');
const { TerminalReview } = require('../src/terminalReview');
const { normalizeReviewSettings } = require('../src/terminalReviewSettings');
const { pickShape } = require('../src/jevAnalysis');

module.exports = async function jevGateChecks({ jev, session }) {
  const wait = async check => { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw Error('Gate fixture timeout'); };
  const evidence = 'Verified output matches the requested change; all 12 checks passed.';
  const request = 'Implement the requested change and verify it.';
  const reply = { model: 'fixture-reviewer', usage: { input: 30, output: 10, total: 40 }, text: JSON.stringify({ tasks: [{ requestQuote: request, evidenceQuote: evidence,
    actual: 'The requested change was implemented and checked.', alignment: 'aligned', verification: evidence,
    decision: { complexity: 'simple', conclusion: 'The recorded checks support accepting this change.',
      reasons: [{ text: 'The relevant checks passed.', evidenceQuote: evidence }], caution: '',
      action: { kind: 'finish', text: 'Accept the change.', why: 'The requested behavior was verified.', request: '' }, alternatives: [] } }] }) };
  let gateCalls = 0, gateInput;
  const transport = jev.fetchImpl;
  const scenario = async ({ probability = .9, unavailable = false, malformed = false, enabled = true, legacy = false, provider = 'codex', force = false, invalidCitation = false, waiting = false, rateLimited = false, work = false, shapes = {} } = {}) => {
    const order = [], calls = [];
    jev.fetchImpl = async (url, options) => {
      order.push('jev'); gateCalls++; gateInput = JSON.parse(options.body);
      if (unavailable) throw Error('fixture offline');
      return { ok: true, text: async () => JSON.stringify({ model: 'jev-routing-only-sentinel',
        answers: malformed ? {} : { needsAnalysis: { type: 'noul', noul: probability }, ...Object.fromEntries(Object.entries(shapes).map(([name, noul]) => [`shape_${name}`, { type: 'noul', noul }])) }, usage: { input_tokens: 120, output_tokens: 10 } }) };
    };
    let capacity = !waiting, clock = 1000;
    const service = new TerminalReview({ jev, now: () => clock, manager: () => ({ get: id => ({ ...session, id }) }), completion: {},
      runner: { canGenerateTerminalReview: () => capacity, generateTerminalReview: async options => {
        order.push('llm'); calls.push(options);
        if (rateLimited && calls.length === 1) throw Object.assign(new Error('fixture capacity'), { code: 'REVIEW_RATE_LIMITED', retryAfterMs: 1000 });
        if (!invalidCitation) return reply;
        const invalid = JSON.parse(reply.text); invalid.tasks[0].decision.reasons[0].evidenceQuote = 'UNSUPPORTED_JEV_ROUTING_RESULT';
        return { ...reply, text: JSON.stringify(invalid) };
      } } });
    // Jev screens only long replies without work; a work claim always goes to the reviewer.
    const answer = work ? 'Implemented the requested change.' : 'The request asks how the output is verified against the change. '.repeat(12);
    const chunk = { taskId: 'gate', request, text: 'ASSISTANT: ' + answer + '\nTOOL: '+evidence,
      lifecycle: 'completed', submittedAt: 1, observedAt: 1, queuedAt: 1 };
    const entry = { key: JSON.stringify(['gate', session.creationId, session.pid, session.createdAt]), provider: 'codex', pending: [chunk], revision: 0, state: 'collecting', latest: {}, seen: {}, locale: 'en' };
    service.entries.set('gate', entry);
    service.scheduling.set('gate', { session: { ...session, id: 'gate' }, force,
      analysis: legacy ? { provider: 'jev' } : { provider, jevEnabled: enabled, models: { [provider]: 'chosen-model' } } });
    service.drain();
    if (waiting) { assert.deepEqual(order, [], 'wait for the shared generation slot before a paid gate call'); capacity = true; service.drain(); }
    await wait(() => !service.busy);
    if (rateLimited) { clock += 2000; service.drain(); await wait(() => !service.busy); clearTimeout(service.retryTimer); }
    assert.equal(entry.state, 'ready', entry.message);
    const task = entry.result.tasks[0];
    assert.equal(task.typedAnalysis, undefined, 'Jev probabilities are never published as a final judgment');
    for (const call of calls) {
      assert.match(call.prompt, /Verified output matches/);
      assert.doesNotMatch(call.prompt, /jev-routing-only-sentinel|needsAnalysis|"probability"/, 'the reviewer receives original records, not routing scores');
      assert.equal(call.provider, provider);
      if (!legacy) assert.equal(call.model, 'chosen-model');
    }
    return { task, calls, order };
  };
  try {
    for (const probability of [.9, .7, .5, .300001]) {
      const { task, calls, order } = await scenario({ probability });
      assert.deepEqual(order, ['jev', 'llm']); assert.equal(calls.length, 1);
      assert.equal(task.analysisProvider, 'codex'); assert.equal(task.analysisModel, 'fixture-reviewer');
      assert.equal(task.decision.reasons[0].evidenceQuote, evidence);
      assert.equal(task.analysisGate.usage.total, 130); assert.equal(task.analysisUsage.total, 40, 'LLM and Jev billing remain separate');
      assert.equal(task.analysisMetrics.calls, 1); assert.equal(task.analysisMetrics.gateCalls, 1);
    }
    assert.deepEqual(Object.keys(gateInput.questions), ['needsAnalysis', 'shape_draft', 'shape_change', 'shape_answer', 'shape_review', 'shape_decision']);
    // One clear shape is fixed for the reviewer; a draft is summarized even when no interpretation is needed.
    const drafted = await scenario({ probability: .1, shapes: { draft: .9, change: .1, answer: .2, review: 0, decision: .1 } });
    assert.deepEqual(drafted.order, ['jev', 'llm'], 'a draft is summarized, not passed through');
    assert.match(drafted.calls[0].prompt, /FIXED SHAPE: draft/);
    assert.doesNotMatch(drafted.calls[0].prompt, /shape_draft|0\.9/, 'the reviewer gets the shape, never the scores');
    const unclear = await scenario({ probability: .9, shapes: { draft: .8, answer: .75 } });
    assert.doesNotMatch(unclear.calls[0].prompt, /FIXED SHAPE: /, 'two likely shapes leave the choice to the reviewer');
    assert.equal(pickShape({ shape_review: { type: 'noul', noul: .7 }, shape_change: { type: 'noul', noul: .3 } }).shape, 'review');
    assert.equal(pickShape({ shape_review: { type: 'noul', noul: .7 }, shape_change: { type: 'noul', noul: .31 } }).shape, '');
    assert.equal(pickShape({}).shape, '');
    assert.match(gateInput.state.evidence, /all 12 checks passed/);
    for (const probability of [0, .3]) {
      const { task, calls, order } = await scenario({ probability });
      assert.deepEqual(order, ['jev']); assert.equal(calls.length, 0);
      assert.equal(task.recordOnly, true); assert.equal(task.analysisDepth, 'screened');
      assert.equal(task.alignment, 'not-reviewed'); assert.equal(task.decision, undefined, 'skipping analysis never claims completion');
      assert.equal(task.passThrough, true, 'a screened reply is shown as written'); assert.match(task.actual, /^The request asks how the output is verified/);
      assert.equal(task.analysisGate.usage.total, 130);
      assert.equal(task.analysisUsage.total, 0); assert.equal(task.analysisMetrics.calls, 0);
    }
    for (const extra of [{ unavailable: true }, { malformed: true }]) {
      const { task, order } = await scenario(extra); assert.deepEqual(order, ['jev', 'llm']);
      assert.equal(task.analysisGate.outcome, 'unavailable'); assert.equal(task.analysisGate.usage, null);
      assert(task.decision, 'a broken gate still permits record-grounded review');
    }
    assert.deepEqual((await scenario({ enabled: false })).order, ['llm']);
    assert.deepEqual((await scenario({ work: true, probability: .1 })).order, ['llm'], 'a work turn is always summarized; Jev is not asked');
    assert.deepEqual((await scenario({ force: true, probability: .1 })).order, ['llm'], 'explicit review requires LLM interpretation');
    await scenario({ legacy: true }); await scenario({ provider: 'claude' }); await scenario({ waiting: true });
    const invalid = await scenario({ invalidCitation: true });
    assert.equal(invalid.task.decision, null, 'Jev approval of analysis cannot bypass LLM evidence checks');
    assert.equal(invalid.calls.length, 2, 'the evidence repair budget still belongs to LLM calls');
    assert.equal(invalid.task.analysisMetrics.gateCalls, 1);
    const retried = await scenario({ rateLimited: true });
    assert.deepEqual(retried.order, ['jev', 'llm', 'llm'], 'reuse the same scoped gate decision after LLM capacity retry');
    assert.equal(retried.task.analysisMetrics.gateCalls, 0);
    assert.equal(retried.task.analysisMetrics.deferredAttempts[0].gateCalls, 1);
    assert.equal(retried.task.analysisGate.usage.total, 130);
    assert.equal(retried.task.analysisUsage, null, 'do not hide unknown usage from the failed LLM attempt');
    assert.equal(normalizeReviewSettings({ provider: 'jev' }).provider, 'auto');
    assert.equal(normalizeReviewSettings({ provider: 'jev' }).jevEnabled, true);
    assert.equal(normalizeReviewSettings({ provider: 'claude', jevEnabled: false }).jevEnabled, false);
    console.log(`PASS Jev screening → original-evidence LLM judgment; skip/uncertainty/outage/manual review, citations, models and separate usage (${gateCalls} fixture gate calls)`);
    return gateCalls;
  } finally { jev.fetchImpl = transport; }
};
