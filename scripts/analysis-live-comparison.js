'use strict';
// Opt-in paired live benchmark. Twelve paid calls by default; synthetic records only.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { AgentRunner } = require('../src/agentRunner');
const { TerminalReviewCompletion } = require('../src/terminalReviewCompletion');
const { toolEvidence } = require('../src/terminalReviewTools');
const root = path.resolve(__dirname, '..');
const BASELINE_REF = 'v2.0.4';
const baselineModules = new Map();
function baseline(name) {
  const filename = path.join(root, 'src', `${name}.js`);
  if (baselineModules.has(filename)) return baselineModules.get(filename).exports;
  const mod = new Module(filename, module); baselineModules.set(filename, mod);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = request => request.startsWith('./') ? baseline(request.slice(2)) : require(request);
  mod._compile(execFileSync('git', ['show', `${BASELINE_REF}:src/${name}.js`], { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }), filename);
  return mod.exports;
}
async function run() {
  if (!process.argv.includes('--run')) throw new Error('Use --run for twelve paid Codex calls on synthetic records (two cases, three pairs each).');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whitebox-analysis-live-'));
  const runner = new AgentRunner({ runsDir: path.join(dir, 'runs'), questionnaireTimeoutMs: 180000 });
  const oldRunner = new (baseline('agentRunner').AgentRunner)({ runsDir: path.join(dir, 'old-runs'), questionnaireTimeoutMs: 180000 });
  const model = process.env.WHITEBOX_BENCHMARK_MODEL || 'gpt-6.1-sol';
  const out = path.join(root, 'artifacts/analysis-speed-2.0.5-verified.json');
  const report = { synthetic: true, mode: 'production-service-including-validation-and-repair', startedAt: new Date().toISOString(), baselineRef: BASELINE_REF, baselineCommit: execFileSync('git', ['rev-parse', `${BASELINE_REF}^{commit}`], { cwd: root, encoding: 'utf8' }).trim(), candidateFiles: Object.fromEntries(['agentRunner', 'questionnaireCommand', 'terminalReview', 'terminalReviewCompletion', 'terminalReviewEvidence', 'terminalReviewContext', 'terminalReviewDecision'].map(name => [name, createHash('sha256').update(require('node:fs').readFileSync(path.join(root, 'src', `${name}.js`))).digest('hex')])), candidateBase: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), cli: execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim(), requestedModel: model, reasoning: 'same model default in both variants; user config ignored', interSampleSpacingMs: 60000, calls: [], sampleLimit: 'Two synthetic cases, three balanced pairs each. No population latency, Jev API speed or universal quality inference.' };
  if (process.argv.includes('--resume')) {
    const previous = JSON.parse(await fs.readFile(out, 'utf8'));
    if (previous.baselineCommit !== report.baselineCommit || previous.requestedModel !== model
      || JSON.stringify(previous.candidateFiles) !== JSON.stringify(report.candidateFiles)) throw new Error('Cannot resume a benchmark after product/model changes');
    report.startedAt = previous.startedAt; report.calls = previous.calls;
    report.resumedAt = new Date().toISOString();
  }
  // Load immutable modules before the measured preparation interval.
  const OldReader = baseline('terminalReviewCompletion').TerminalReviewCompletion;
  baseline('terminalReview');
  let lastFinishedAt = 0;
  try {
    const cx = (type, payload) => JSON.stringify({ type, timestamp: '2026-10-26T01:00:00Z', payload });
    const message = (role, text, channel) => cx('response_item', { type: 'message', role, channel, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] });
    const cases = [
      { id: 'package-cleanup', request: '패키지 정리 결과를 판단하고 추가 삭제나 검증 보완이 필요한지 설명해줘.', answer: '전체 패키지는 20개 중 보드 기반이 12개였습니다. 샘플 4개를 삭제하고 poc를 lesson에 합쳐 15개가 됐습니다. 실제 기능이 사용하는 module-ai는 유지했고 전체 테스트는 통과했습니다.', tool: '질문 문장의 로그 노출 검사는 제거했고 대체하지 않았다. 1 failed 뒤 복구하여 20 passed.', expected: 'Explain why passing tests no longer cover log exposure and why 12 board-based versus 15 remaining is not sufficient evidence for further deletion.' },
      { id: 'deletion-candidates', request: 'ai-usage와 reports API, static 화면의 삭제 후보를 판단하고 다음 요청을 제안해줘. 요구사항 근거와 사용처, 삭제 안전성을 구분해줘.', answer: '요구사항 근거가 없어 삭제해도 됩니다. 다른 코드나 화면에서 사용하는지 확인하고 삭제는 하지 마세요.', tool: '현재 reports API의 호출 경로와 static 화면 링크는 미확인이다. ai-usage는 이전 확인 이후 코드 변경 없음.', expected: 'Reuse the prior src/renderer ai-usage usage check, distinguish uncovered reports/static scope, and correct the unsupported global deletion claim.' },
    ];
    for (let round = 0; round < 3; round++) for (const [caseIndex, item] of cases.entries()) {
      const file = path.join(dir, `${item.id}.jsonl`);
      const rows = [cx('event_msg', { type: 'task_started', turn_id: 'prior' }), message('user', 'ai-usage의 src와 renderer 사용처를 확인해줘. 삭제하지 마.'),
        cx('response_item', { type: 'function_call', call_id: 'prior-check', name: 'exec_command', arguments: '{}' }),
        cx('response_item', { type: 'function_call_output', call_id: 'prior-check', output: 'rg ai-usage src renderer: 사용처 없음. 조회 범위 src/renderer. 코드 변경 없음. Exit code: 0' }),
        cx('event_msg', { type: 'task_complete', turn_id: 'prior', last_agent_message: '확인을 마쳤습니다. 지금은 삭제하지 않았습니다.' }),
        cx('event_msg', { type: 'task_started', turn_id: 'current' }), message('user', item.request),
        cx('response_item', { type: 'function_call', call_id: 'current-result', name: 'exec_command', arguments: '{}' }),
        cx('response_item', { type: 'function_call_output', call_id: 'current-result', output: 'routine output '.repeat(1400) + item.tool + 'routine output '.repeat(1400) }),
        cx('event_msg', { type: 'task_complete', turn_id: 'current', last_agent_message: item.answer })];
      await fs.writeFile(file, rows.join('\n') + '\n');
      const oldReader = new OldReader();
      const newReader = new TerminalReviewCompletion();
      for (const variant of (round + caseIndex) % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
        if (report.calls.some(call => call.case === item.id && call.round === round + 1 && call.variant === variant)) continue;
        const cooldown = lastFinishedAt + 60000 - Date.now();
        if (cooldown > 0) await new Promise(resolve => setTimeout(resolve, cooldown));
        const prepareStart = performance.now();
        const reader = variant === 'baseline' ? oldReader : newReader;
        const state = await reader.logState(file, 'codex');
        const measuredRunner = variant === 'baseline' ? oldRunner : runner;
        const runs = [];
        const wrapped = {
          on: measuredRunner.on.bind(measuredRunner),
          canGenerateTerminalReview: () => measuredRunner.active.size === 0,
          generateTerminalReview: async options => {
            const startedAt = Date.now();
            const record = { inputChars: options.prompt.length, promptSha256: createHash('sha256').update(options.prompt).digest('hex'), startedAt };
            runs.push(record);
            try {
              const result = await measuredRunner.generateTerminalReview(options);
              Object.assign(record, { receivedAt: Date.now(), timings: result.timings, usage: result.usage, model: result.model, raw: result.text });
              return result;
            } catch (error) { Object.assign(record, { receivedAt: Date.now(), error: error.message }); throw error; }
          },
        };
        const session = { id: 'synthetic-owned-terminal', creationId: 'benchmark', pid: 1, status: 'running' };
        const Service = variant === 'baseline' ? baseline('terminalReview').TerminalReview : require('../src/terminalReview').TerminalReview;
        const service = new Service({ manager: () => ({ get: () => session }), runner: wrapped, completion: reader });
        const chunk = { taskId: `${item.id}-${round + 1}`, request: item.request,
          text: `USER:\n${item.request}\n\nASSISTANT (completed answer):\n${state.answer}`,
          tools: toolEvidence(state), updates: { items: state.updates }, context: { items: state.context, conditions: state.conditions || [], omitted: state.contextOmitted || 0, conditionsOmitted: state.conditionsOmitted || 0 }, source: state.source,
          lifecycle: 'completed', observedAt: Date.now(), submittedAt: Date.now(), queuedAt: Date.now() };
        const entry = { key: JSON.stringify([session.id, session.creationId, session.pid, undefined]), pending: [chunk],
          revision: 0, state: 'collecting', latest: { [chunk.taskId]: chunk }, seen: {}, locale: 'ko', provider: 'codex' };
        service.entries.set(session.id, entry);
        const preparedMs = performance.now() - prepareStart, modelStart = performance.now();
        console.log(`START round=${round + 1} ${item.id} ${variant}`);
        service.startReview(session.id, entry, chunk, session, { provider: 'codex', models: { codex: model } });
        const deadline = Date.now() + 390000;
        while (service.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
        if (service.busy) throw new Error('Production review did not settle after its two-call limit');
        const result = entry.result?.tasks?.find(task => task.taskId === chunk.taskId);
        report.calls.push({ case: item.id, round: round + 1, variant, requestedModel: model, expected: item.expected,
          preparedMs, reviewMs: performance.now() - modelStart, modelMs: runs.reduce((sum, call) => sum + call.receivedAt - call.startedAt, 0),
          callCount: runs.length, runs, result: result || null, error: entry.failed ? entry.message : null,
          usage: result?.analysisUsage ?? null, deferred: Boolean(entry.retryAt && entry.pending.length), retryAt: entry.retryAt || null });
        lastFinishedAt = Date.now();
        if (service.retryTimer) clearTimeout(service.retryTimer);
        console.log(`DONE ${item.id} ${variant} reviewMs=${Math.round(performance.now() - modelStart)} calls=${runs.length} ${entry.failed ? entry.message : `tokens=${result?.analysisUsage?.total ?? 'unknown'}`}`);
        const closeDeadline = Date.now() + 10000;
        while ((runner.active.size || oldRunner.active.size) && Date.now() < closeDeadline) await new Promise(resolve => setTimeout(resolve, 25));
        if (runner.active.size || oldRunner.active.size) throw new Error('Timed-out process could not be closed; benchmark stopped');
        if (entry.retryAt && entry.pending.length) {
          report.stoppedForCapacityUntil = entry.retryAt;
          await fs.mkdir(path.dirname(out), { recursive: true });
          await fs.writeFile(out, JSON.stringify(report, null, 2));
          throw new Error(`Provider capacity backoff until ${new Date(entry.retryAt).toISOString()}; benchmark stopped without further requests`);
        }
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, JSON.stringify(report, null, 2));
      }
    }
  } finally {
    await runner.dispose(); await oldRunner.dispose();
    report.finishedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, JSON.stringify(report, null, 2));
    await fs.rm(dir, { recursive: true, force: true });
  }
  console.log(`REPORT ${out}`);
}
module.exports = { baseline };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
