'use strict';

// Re-run all controls fresh. Old prompts are frozen before scope changes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { bounded } = require('../src/terminalReviewBudget');
const { reviewPrompt, parseReview } = require('../src/terminalReview');
const { repairPrompt } = require('../src/terminalReviewDecision');
const { verifiedRecords, selectHybrid } = require('./lib/terminal-review-hybrid');
const { selectRefined } = require('./lib/terminal-review-hybrid-refined');
const { indexCase, sourceFor, renderRecords, usage } = require('./terminal-review-hybrid-benchmark');
const { generate } = require('./terminal-review-decision-evaluation');
const directory = path.resolve(process.argv[2] || 'artifacts/terminal-review-hybrid-refined-20261102');
const original = path.resolve('artifacts/terminal-review-hybrid-20261102');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const save = (name, data) => fs.writeFileSync(path.join(directory, name), JSON.stringify(data, null, 2) + '\n');
const variants = ['current', 'hybrid', 'refined'];
const labels = { current: '현재 방식', hybrid: '첫 비교안', refined: '보완안' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function oldPrompt(source, request) {
  const snapshot = read('old-prompt-template.json');
  assert.equal(sha(snapshot.text), snapshot.sha256);
  return snapshot.text.replace(JSON.stringify('__WHITEBOX_REQUEST_5BB3__'), () => JSON.stringify(request)).replace('__WHITEBOX_SOURCE_5BB3__', () => source);
}
function makeCorpus() {
  if (fs.existsSync(path.join(directory, 'corpus.json'))) return read('corpus.json');
  const previous = JSON.parse(fs.readFileSync(path.join(original, 'corpus.json')));
  const synthetic = (id, request, answer, toolTexts, facts, scope) => ({ id, title: id, origin: 'new synthetic control, frozen before live calls', requestId: id,
    request, text: `USER:\n${request}\nASSISTANT (completed answer):\n${answer}`, context: {}, updates: {},
    tools: { source: 'session', items: toolTexts.map(text => ({ name: 'Read', status: 'returned', excerpt: bounded(text, 400) })) },
    records: [{ role: 'user', text: request }, ...toolTexts.map(text => ({ role: 'tool', text })), { role: 'assistant', text: answer }]
      .map((item, i) => ({ ...item, id: `r${i}`, requestId: id })), facts: facts.map(([id, quote]) => ({ id, quote })), rubric: [scope] });
  const allowed = synthetic('conditional-repair', '취소 검사를 실행하고 실패하면 원인을 고쳐줘. 파일은 삭제하지 마.',
    '취소 검사는 실패했습니다. 중단 뒤 worker가 계속 실행됩니다. 원인은 아직 고치지 못했습니다.',
    ['FAIL cancellation: worker continues after abort; Exit code: 1. No code changes made.'],
    [['failure', 'FAIL cancellation']], '실패 시 수정이 명시적으로 허용됨. 원인 수정과 재검증을 후속으로 유지해야 함.');
  const narrowed = synthetic('latest-report-only', '아직 수정하지 말고 취소 검사가 왜 실패하는지만 확인해서 알려줘.',
    '중단 경로에서 stopWorker()를 호출하지 않아 작업자가 계속 실행됩니다. 원인은 확인했고 코드는 수정하지 않았습니다.',
    ['Read cancellationHandler: abort() sets cancelled=true but does not call stopWorker().', 'FAIL cancellation: worker continues after abort; Exit code: 1. No code changes made.'],
    [['cause', 'does not call stopWorker()']], '이전 수정 요청보다 최신 수정 금지가 우선. 원인 보고로 완료하고 수정 지시를 생성하지 않아야 함.');
  narrowed.context = { items: [{ requestId: 'earlier-fix', request: '취소가 안 되는 오류를 고쳐줘.', answer: '원인을 찾아 수정하겠습니다.' }], conditions: [] };
  const noise = 'Read unrelated theme metadata: spacing, palette, layout and typography. No runtime measurement.\n'.repeat(65);
  const code = `public boolean localCheck(Map<String, Integer> pendingCounts) {\n    return pendingCounts.isEmpty();\n}\n\npublic static Map<String, Integer> pendingCounts(Map<String, Integer> left, Map<String, Integer> right) {\n    Map<String, Integer> counts = new HashMap<>(left);\n    right.forEach((key, value) -> counts.merge(key, value, Integer::sum));\n    return counts;\n}\n`;
  const unrelated = synthetic('renamed-map-coverage', 'Map<String, Integer> pendingCounts = registry.pendingCounts(ids); 여기서 Map이 꼭 필요해? 설명만 해줘.',
    '현재 호출부는 비었는지만 확인하지만, 공유 집계 함수는 같은 키의 수를 더합니다. 변수 타입 선언만 바꾸어도 집계 동작은 바뀌지 않습니다. 코드는 수정하지 않았습니다.',
    [noise + code + noise], [['local', 'pendingCounts.isEmpty()'], ['shared', 'counts.merge(key, value, Integer::sum)']],
    '다른 이름·타입에서도 호출부 연산과 공유 함수의 합산 구현을 함께 보존. 설명 요청을 수정으로 확대하지 않음.');
  const corpus = { ...previous, createdAt: new Date().toISOString(), parentCorpusSha256: sha(JSON.stringify(previous)), cases: [...previous.cases, allowed, narrowed, unrelated],
    protocol: '9 cases x 3 arms x 2 fresh runs. Original six cases unchanged. Current and v1 use frozen old prompt; refined changes selector coverage and scope prompt together. Same provider/model, raw corpus, envelope, 8k recovery budget and bounded 2-call policy. This is a combined-change comparison, not isolated attribution of prompt versus selector. No Jev or installed UI. Do not count hidden/truncated decisions as corrected content.' };
  save('corpus.json', corpus);
  save('rubric.json', { frozenAt: new Date().toISOString(), primary: ['Original 12 reference spans retained in recovered tool input, not just assistant claims',
    'Specific cancellation failure and after p95 threshold excess retained in final analysis',
    'Checking-only final action/nextStep does not instruct implementation or require a fix/retest before the check can be reported complete',
    'Conditional repair authorization remains actionable', 'Latest no-edit restriction overrides earlier fix request',
    'Renamed Map example retains local isEmpty and shared merge implementations'],
    scopeOnlyCases: ['hidden-failure', 'numeric-conflict', 'latest-report-only'],
    mutationReview: 'Manually inspect all action.text/why/request, nextStep, alternatives and unverified fields. Check raw first draft as well as final, including whether a repair hides a defect. Report ambiguous/invalid outputs separately; regex screening is a review aid only.' });
  return corpus;
}

async function main() {
  fs.mkdirSync(directory, { recursive: true });
  const corpus = makeCorpus(), prepared = [];
  for (const item of corpus.cases) {
    const { index, file } = await indexCase(item, directory);
    const records = index.manifest(file, item.requestId).records.map(({ id, role, critical }) => ({ id, role, critical }));
    for (const variant of variants) {
      const started = performance.now();
      const selection = variant === 'current' ? await index.prepare(file, item.requestId)
        : (variant === 'hybrid' ? selectHybrid : selectRefined)(await verifiedRecords(index, file, item.requestId), item.request, { budget: 8000, searchContext: item.text });
      const selectionMs = performance.now() - started;
      const source = sourceFor(item, selection.recovered, { records, linkedPriorRecords: [], omitted: 0, omittedFromInput: selection.omittedFromInput, skippedBytes: 0 });
      const prompt = variant === 'refined' ? reviewPrompt(source, 'ko', item.request, 'completed') : oldPrompt(source, item.request);
      prepared.push({ id: item.id, variant, selection, selectionMs, source, prompt, promptSha256: sha(prompt),
        facts: item.facts.map(fact => ({ ...fact, retained: selection.recovered.some(span => span.text?.includes(fact.quote)) })) });
    }
  }
  const manifest = { createdAt: new Date().toISOString(), provider: corpus.provider, model: corpus.model, repeats: corpus.repeats,
    corpusSha256: sha(JSON.stringify(corpus)), rubricSha256: sha(fs.readFileSync(path.join(directory, 'rubric.json'))),
    cli: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(), protocol: corpus.protocol,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    inputs: prepared.map(({ id, variant, promptSha256 }) => ({ id, variant, promptSha256 })),
    hashes: Object.fromEntries(['scripts/lib/terminal-review-hybrid.js', 'scripts/lib/terminal-review-hybrid-refined.js', 'src/terminalReview.js',
      'src/terminalReviewDecision.js', 'scripts/terminal-review-hybrid-refinement-benchmark.js', 'scripts/terminal-review-decision-evaluation.js'].map(file => [file, sha(fs.readFileSync(file))])) };
  if (fs.existsSync(path.join(directory, 'manifest.json'))) {
    const previous = read('manifest.json');
    for (const key of ['corpusSha256', 'rubricSha256', 'inputs', 'hashes', 'model', 'provider']) assert.deepEqual(previous[key], manifest[key], `Cannot resume changed ${key}`);
  } else save('manifest.json', manifest);
  if (!process.argv.includes('--render-only')) save('prepared.json', prepared);
  if (process.argv.includes('--prepare-only')) return;
  if (!process.argv.includes('--render-only')) for (const [caseIndex, item] of corpus.cases.entries()) {
    const { index, file } = await indexCase(item, directory);
    for (let repeat = 1; repeat <= corpus.repeats; repeat++) {
      const offset = (caseIndex + repeat - 1) % variants.length;
      const order = [...variants.slice(offset), ...variants.slice(0, offset)];
      if (repeat % 2 === 0) order.reverse();
      for (const variant of order) {
        const name = `${item.id}-${repeat}-${variant}.json`, input = prepared.find(p => p.id === item.id && p.variant === variant);
        if (fs.existsSync(path.join(directory, name))) { const previous = read(name); assert.equal(previous.promptSha256, input.promptSha256); assert(!previous.error, 'Preserve failed attempt before retrying'); continue; }
        const started = performance.now(), calls = []; let source = input.source, prompt = input.prompt, retrieved = [], repairIssues = [];
        try {
          calls.push(await generate(prompt, corpus.provider, corpus.model));
          let draft; try { draft = JSON.parse(calls[0].text.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')); } catch {}
          let parsed = parseReview(calls[0].text, source, 'ko', item.request, 'completed');
          const firstParsed = parsed;
          const allowed = new Set(index.manifest(file, item.requestId).records.map(record => record.id));
          const included = new Set(input.selection.recovered.map(record => record.id));
          const ids = Array.isArray(draft?.evidenceRequests) ? draft.evidenceRequests.filter(id => allowed.has(id) && !included.has(id)).slice(0, 4) : [];
          if (ids.length) {
            retrieved = await index.retrieve(file, item.requestId, ids);
            source += `\nADDITIONAL SCOPED RECORDS:\n${renderRecords(retrieved)}`;
            prompt = variant === 'refined' ? reviewPrompt(source, 'ko', item.request, 'completed') : oldPrompt(source, item.request);
            calls.push(await generate(prompt, corpus.provider, corpus.model));
            parsed = parseReview(calls.at(-1).text, source, 'ko', item.request, 'completed');
          } else if (parsed.tasks[0]?.decisionIssues.length) {
            repairIssues = parsed.tasks[0].decisionIssues;
            calls.push(await generate(repairPrompt(prompt, repairIssues), corpus.provider, corpus.model));
            parsed = parseReview(calls.at(-1).text, source, 'ko', item.request, 'completed');
          }
          assert(calls.every(call => call.actualModel === corpus.model && call.toolCalls === 0));
          const result = { id: item.id, repeat, variant, promptSha256: input.promptSha256, firstParsed, parsed, calls, retrieved, repairIssues,
            usage: usage(calls), durationMs: performance.now() - started + input.selectionMs };
          save(name, result);
          console.log(JSON.stringify({ id: item.id, repeat, variant, calls: calls.length, input: result.usage?.input, ms: Math.round(result.durationMs),
            issues: parsed.tasks[0]?.decisionIssues, action: parsed.tasks[0]?.decision?.action.kind }));
        } catch (error) { save(name, { id: item.id, repeat, variant, promptSha256: input.promptSha256, calls, error: error.message, durationMs: performance.now() - started }); throw error; }
      }
    }
  }
  render(corpus, read('prepared.json'));
}

function render(corpus, prepared) {
  const results = corpus.cases.flatMap(item => Array.from({ length: corpus.repeats }, (_, i) => variants.map(variant => read(`${item.id}-${i + 1}-${variant}.json`))).flat());
  const totals = (variant, originalOnly = false) => {
    const ids = new Set(corpus.cases.slice(0, originalOnly ? 6 : undefined).map(item => item.id));
    const set = results.filter(result => result.variant === variant && ids.has(result.id)), inputs = prepared.filter(input => input.variant === variant && ids.has(input.id));
    return { generations: set.length, calls: set.reduce((n, r) => n + r.calls.length, 0),
      inputTokens: set.every(r => r.usage) ? set.reduce((n, r) => n + r.usage.input, 0) : null,
      outputTokens: set.every(r => r.usage) ? set.reduce((n, r) => n + r.usage.output, 0) : null,
      durationMs: set.reduce((n, r) => n + r.durationMs, 0), validDecisions: set.filter(r => r.parsed?.tasks[0]?.decision).length,
      retainedFacts: inputs.reduce((n, i) => n + i.facts.filter(f => f.retained).length, 0), totalFacts: inputs.reduce((n, i) => n + i.facts.length, 0),
      budgetOverflows: inputs.filter(input => input.selection.budgetOverflow > 0).length, coverageMisses: inputs.reduce((n, i) => n + (i.selection.coverage || []).filter(c => !c.retained).length, 0) };
  };
  const summary = { originalSix: Object.fromEntries(variants.map(v => [v, totals(v, true)])), allNine: Object.fromEntries(variants.map(v => [v, totals(v)])),
    cases: corpus.cases.map(item => ({ id: item.id, inputs: prepared.filter(p => p.id === item.id).map(({ variant, selection, selectionMs, facts }) => ({ variant, selectionMs, chars: selection.readChars, overflow: selection.budgetOverflow || 0, facts })),
      results: results.filter(r => r.id === item.id).map(({ repeat, variant, usage, durationMs, repairIssues, parsed, calls }) => ({ repeat, variant, usage, durationMs, repairIssues, valid: Boolean(parsed?.tasks[0]?.decision), calls: calls.length })) })) };
  save('summary.json', summary);
  let body = `<h1>근거 누락·검증 범위 보완 벤치마크</h1><p>${esc(corpus.model)} · 기존 6사례 유지 + 새 통제 사례 3개 · 3방식 × 각 2회 = 최종 분석 54개</p><p>현재/첫 비교안은 이전 프롬프트를 고정하고 보완안은 근거 보호와 요청 범위 프롬프트를 함께 바꿨습니다. 모든 응답을 이번에 새로 생성했습니다. 설치 앱 전체 E2E나 두 변경의 개별 효과를 분리한 실험은 아닙니다.</p>`;
  const table = (title, values) => `<h2>${title}</h2><table><tr><th>실측</th>${variants.map(v => `<th>${labels[v]}</th>`).join('')}</tr>${[['retainedFacts','지정 원문 구간 보존'],['inputTokens','모든 호출 입력 토큰(캐시 포함)'],['durationMs','누적 시간(ms)'],['calls','실제 호출'],['validDecisions','최종 형식 통과'],['budgetOverflows','보호 구간 8천 자 초과']].map(([key,label]) => `<tr><td>${label}</td>${variants.map(v => `<td>${values[v][key]}</td>`).join('')}</tr>`).join('')}</table>`;
  body += table('기존 6개 사례만 비교', summary.originalSix) + table('새 통제 사례를 포함한 9개', summary.allNine);
  body += '<p>토큰에는 캐시 생성·읽기와 형식 재시도를 모두 합산했습니다. 시간은 로컬 복원·선별과 모델 호출/재시도 합계입니다. 교차 순서 실행이지만 캐시·네트워크 편차를 제거한 속도 보장은 아닙니다. 원문 보존율은 의미 정확도가 아닙니다. 코드 구조 보호는 휴리스틱으로, 인식하지 못한 중요 사실까지 보장하지 않습니다.</p>';
  if (fs.existsSync(path.join(directory, 'assessment.json'))) {
    const a = read('assessment.json');
    body += `<h2>내용 검토</h2><p>${esc(a.conclusion)}</p><table><tr><th>기준</th>${variants.map(v=>`<th>${labels[v]}</th>`).join('')}</tr>${a.metrics.map(row=>`<tr><td>${esc(row.item)}</td>${variants.map(v=>`<td>${esc(row[v])}</td>`).join('')}</tr>`).join('')}</table><p>${esc(a.limitations)}</p>`;
  }
  for (const item of corpus.cases) {
    body += `<section><h2>${esc(item.id)}</h2><p>${esc(item.origin)}</p><p>${esc(item.request)}</p><details><summary>고정 기준과 원문 보존</summary><pre>${esc(JSON.stringify({rubric:item.rubric,inputs:summary.cases.find(c=>c.id===item.id).inputs},null,2))}</pre></details>`;
    for (let repeat = 1; repeat <= corpus.repeats; repeat++) {
      body += `<h3>반복 ${repeat}</h3><div class="grid">`;
      for (const variant of variants) {
        const r = results.find(r=>r.id===item.id&&r.repeat===repeat&&r.variant===variant), t = r.parsed?.tasks[0], d = t?.decision;
        body += `<article><b>${labels[variant]}</b><h3>${esc(d?.conclusion||t?.actual)}</h3><ul>${(d?.reasons||[]).map(v=>`<li>${esc(v.text)}</li>`).join('')}</ul><p>${esc(d?.caution)}</p><p>${esc(d?.action?.kind)} · ${esc(d?.action?.text)}</p><p>${esc(d?.action?.request)}</p>${(d?.alternatives||[]).map(a=>`<p><b>${esc(a.option)}</b>: ${esc(a.tradeoff)}<br>${esc(a.when)}</p>`).join('')}<small>입력 ${r.usage?.input} · ${(r.durationMs/1000).toFixed(1)}초 · ${r.calls.length}호출</small><details><summary>첫 초안·최종 분석·사용량</summary><pre>${esc(JSON.stringify(r,null,2))}</pre></details></article>`;
      }
      body += '</div>';
    }
    body += '</section>';
  }
  fs.writeFileSync(path.join(directory,'report.html'),`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whitebox 보완안 벤치마크</title><style>body{max-width:1500px;margin:32px auto;padding:0 24px;background:#f5f7f5;color:#24352c;font:15px/1.75 system-ui}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}article{padding:20px;background:white;border:1px solid #d7ded6;border-radius:12px}section{margin:40px 0}h3{line-height:1.5}table{border-collapse:collapse;width:100%;background:white}th,td{padding:10px 14px;border:1px solid #d7ded6;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}summary{cursor:pointer}@media(max-width:1000px){.grid{grid-template-columns:1fr}}</style>${body}</html>`);
}

if (require.main === module) main().catch(error=>{console.error(error);process.exitCode=1});
module.exports = { oldPrompt };
