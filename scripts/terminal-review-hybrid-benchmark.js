'use strict';

// Opt-in real-model experiment; never changes production routing or user logs.
// node scripts/terminal-review-hybrid-benchmark.js [directory] [--prepare-only]
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const { ReviewEvidenceIndex } = require('../src/terminalReviewEvidence');
const { TerminalReviewCompletion } = require('../src/terminalReviewCompletion');
const { bounded } = require('../src/terminalReviewBudget');
const { compactTools } = require('../src/terminalReviewTools');
const { compactContext, compactUpdates } = require('../src/terminalReviewContext');
const { reviewPrompt, parseReview } = require('../src/terminalReview');
const { repairPrompt } = require('../src/terminalReviewDecision');
const { verifiedRecords, selectHybrid } = require('./lib/terminal-review-hybrid');
const { generate } = require('./terminal-review-decision-evaluation');
const directory = path.resolve(process.argv[2] || 'artifacts/terminal-review-hybrid-20261102');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const save = (name, data) => fs.writeFileSync(path.join(directory, name), JSON.stringify(data, null, 2) + '\n');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

async function prepareCorpus() {
  fs.mkdirSync(directory, { recursive: true });
  const existing = path.join(directory, 'corpus.json');
  if (fs.existsSync(existing)) return read('corpus.json');
  const profile = path.join(os.homedir(), 'Library/Application Support/Whitebox/terminal-reviews.json');
  const reviews = JSON.parse(fs.readFileSync(profile, 'utf8'));
  const task = reviews.entries['terminal:mvu7t9a7:f61f7369'].result.tasks.find(item => item.summary === 'takenCodes의 Set 타입 필요 여부 확인');
  assert(task);
  const sourceFile = path.join(os.homedir(), '.claude/projects/-Users-ubion-Desktop-ubion-project-ai-learning-analytics-backend/b95e6591-b8d1-4c17-a413-f45e87f026af.jsonl');
  const requestId = '39e29352-fe5b-458e-9144-a91aed49e04a';
  const completion = new TerminalReviewCompletion();
  await completion.logState(sourceFile, 'claude', 'b95e6591-b8d1-4c17-a413-f45e87f026af');
  const records = await verifiedRecords(completion.evidence, sourceFile, requestId);
  const real = { id: 'taken-codes', title: '실제 takenCodes 세션', origin: 'real frozen request, public records only; no later turns', requestId,
    request: task.request, text: task.reviewEvidence, tools: task.toolEvidence, updates: task.assistantUpdates, context: task.reviewContext, records,
    facts: [
      { id: 'local-empty', quote: 'takenCodes.isEmpty()', description: '현재 호출부는 비었는지만 확인' },
      { id: 'union', quote: 'taken.addAll(storedCourses)', description: '공유 사용처는 집합 합치기 수행' },
      { id: 'boolean-api', quote: 'boolean codeTaken(String codeKey, String exceptRoomId)', description: '단일 여부 조회 API 존재' }
    ], rubric: ['호출부의 빈 값 검사와 공유 집합 사용의 필요를 구분', '변수 선언 변경과 조회/계약 변경을 구분', '설명 요청을 수정 지시로 바꾸지 않음'] };
  for (const fact of real.facts) assert(records.some(record => record.text.includes(fact.quote)), `Missing reference: ${fact.quote}`);
  const simple = (id, title, request, answer, toolTexts, facts, rubric) => ({ id, title, origin: 'synthetic controlled fixture', requestId: id, request,
    text: `USER:\n${request}\nASSISTANT (completed answer):\n${answer}`, context: {}, updates: {},
    tools: { source: 'session', items: toolTexts.map(text => ({ name: 'Read', status: 'returned', excerpt: bounded(text, 400) })) },
    records: [{ role: 'user', text: request }, ...toolTexts.map(text => ({ role: 'tool', text })), { role: 'assistant', text: answer }]
      .map((record, index) => ({ ...record, id: `r${index}`, requestId: id })), facts, rubric });
  const count = simple('count-api', '짧은 설계 질문', '건수만 표시하는 화면인데 결과 전체를 목록으로 받아야 해? 설명만 해줘.',
    '화면은 개수만 필요하지만 CSV는 행 전체가 필요합니다. List를 Collection으로 바꾸어도 전체 행 조회는 같습니다. 별도 count 조회를 화면에 연결할 수 있습니다. 코드는 수정하지 않았고 성능은 측정하지 않았습니다.',
    ['badgeController: searchService.findRows(filter).size(); CSV export: findRows(filter) and writes each row. findRows returns List<Row>. No count endpoint exists.'],
    [{ id: 'count', quote: 'findRows(filter).size()', description: '화면은 전체 행 조회 뒤 개수만 사용' }, { id: 'csv', quote: 'writes each row', description: 'CSV에는 행 필요' }],
    ['목록 선언 변경은 조회량을 줄이지 않는다고 설명', 'count 조회와 CSV 목록 유지의 범위를 구분']);
  const copy = simple('copy', '짧은 문구 수정', '저장 버튼의 문구만 저장하기로 바꿔줘. 동작은 그대로 둬.',
    '버튼 문구를 저장하기로 바꿨습니다. 클릭 동작은 수정하지 않았고 실행 검사는 하지 않았습니다.',
    ['button label changed from 저장 to 저장하기; onClick unchanged.'],
    [{ id: 'click', quote: 'onClick unchanged', description: '클릭 동작 유지' }], ['단순 변경 완료를 설명', '불필요한 설계 선택이나 실행 검사 요구를 만들지 않음']);
  const noise = Array.from({ length: 95 }, (_, i) => `Read cache entry ${String(i).padStart(3, '0')}: layout styles, padding, foreground palette and render names were inspected. No runtime measurements are recorded in this entry.\n`).join('');
  const noisy = { ...structuredClone(real), id: 'taken-codes-noisy', title: 'takenCodes + 반복 읽기 로그', origin: 'synthetic stress variant of real session; not another real observation', requestId: 'taken-codes-noisy' };
  noisy.records = [{ role: 'user', text: real.request }, ...Array.from({ length: 4 }, () => ({ role: 'tool', text: noise })),
    ...records.filter(record => record.role === 'tool'), { role: 'assistant', text: records.filter(record => record.role === 'assistant').at(-1).text }]
    .map((record, index) => ({ ...record, id: `r${index}`, requestId: noisy.requestId }));
  // Keywords make these routine logs eligible in the current critical-first
  // selector. Important facts occur once in the middle, away from head/tail.
  const hidden = simple('hidden-failure', '긴 로그 중간의 단일 실패', '배치 취소 기능을 검증해서 완료 여부만 알려줘. 파일은 삭제하지 마.',
    '배치 취소 기능 검증을 완료했고 모든 검사는 통과했습니다. 파일은 삭제하지 않았습니다.',
    Array.from({ length: 5 }, (_, i) => `test report ${i}:\n${noise}${i === 2 ? '\nFAIL cancellation: worker continues after abort; Exit code: 1\n' : '\nRoutine component checks passed.\n'}${noise}`),
    [{ id: 'failure', quote: 'FAIL cancellation: worker continues after abort; Exit code: 1', description: '취소 후 작업 지속, 실제 실패' }],
    ['AI의 전체 통과 주장과 tool 실패를 구분', '검증 완료로 승인하지 않음', '삭제 금지를 유지']);
  const threshold = simple('numeric-conflict', '수치 기준과 상충하는 측정', '캐시 변경 후 응답 시간이 최대 120 ms인지 확인해줘. 개선됐다는 말만으로 완료하지 마.',
    '캐시 적용 후 평균 84 ms를 기록해 기준을 만족했습니다. 응답 시간 개선 작업은 완료했습니다.',
    [`test benchmark run-id=before: mean=190 ms; p95=230 ms.\n${noise}`, `${noise}\nbenchmark run-id=after: mean=84 ms; p95=168 ms. The requirement applies to p95, not the mean.\n${noise}`, 'test smoke: PASS; cache read and cache write routes return expected payloads.'],
    [{ id: 'p95', quote: 'p95=168 ms', description: '변경 후 p95는 기준 120 ms 초과' }, { id: 'category', quote: 'requirement applies to p95, not the mean', description: '평균과 p95 혼동 방지' }],
    ['평균 84 ms와 p95 168 ms를 구분', '120 ms 기준 미충족 판단', '개선됨과 완료됨을 구분']);
  const cases = [real, count, copy, noisy, hidden, threshold];
  const corpus = { createdAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    provider: 'claude', model: 'claude-sonnet-5-5', repeats: 2, recoveryBudget: 8000,
    protocol: 'Same current improved reviewPrompt/model/request/answer/tool-metadata/context. Only recovered evidence selection differs. Current arm executes production ReviewEvidenceIndex.prepare. Hybrid verifies all scoped public records locally (2MiB/256-record cap), then mandatory/BM25/MMR blocks. Existing production 4-ID/8k optional retrieval, at most 2 model calls including repair. No Jev routing or live renderer; selection timing includes local recovery. No embedding API. Source logs read-only. Corpus and rubric frozen before model calls.',
    cases };
  save('corpus.json', corpus);
  return corpus;
}

async function indexCase(item, root = directory) {
  const file = path.join(root, `${item.id}-public-records.jsonl`);
  const rows = item.records.map((record, index) => ({ type: record.role === 'assistant' ? 'assistant' : 'user', sessionId: 'benchmark', uuid: `fixture-${index}`,
    message: { content: record.role === 'tool' ? [{ type: 'tool_result', content: record.text }] : record.text } }));
  const content = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  if (fs.existsSync(file)) assert.equal(fs.readFileSync(file, 'utf8'), content, 'Frozen fixture changed');
  else fs.writeFileSync(file, content);
  const index = new ReviewEvidenceIndex(), stat = await fsp.stat(file);
  let offset = 0;
  for (const row of rows) {
    const bytes = Buffer.from(JSON.stringify(row));
    index.add(file, stat, 'claude', 'benchmark', item.requestId, row, offset, bytes);
    offset += bytes.length + 1;
  }
  return { index, file };
}

function renderRecords(records) {
  return records.map(item => `[${item.id} · ${item.role || 'record'} · ${item.requestId} · ${item.status}${item.start === undefined ? '' : ` · chars ${item.start}-${item.end}`} ]\n${item.text || ''}`).join('\n');
}
function sourceFor(item, selected, manifest) {
  return `CURRENT REQUEST EVIDENCE:\n${bounded(item.text, 12000)}\nINTERMEDIATE REPORTS:\n${compactUpdates(item.updates)}\nTOOL RECORDS:\n${compactTools(item.tools)}\nRECOVERED CURRENT RECORDS (roles identify reported claims vs tool results):\n${renderRecords(selected)}\nLINKED PRIOR VERIFICATIONS (not current execution):\n\nPRIOR CONTEXT:\n${compactContext(item.context)}\nEVIDENCE COVERAGE:\n${JSON.stringify(manifest)}`;
}
function usage(calls) {
  const fields = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'];
  if (calls.some(call => !call.usage || fields.some(field => !Number.isSafeInteger(call.usage[field])))) return null;
  return { input: calls.reduce((n, call) => n + call.usage.input_tokens + call.usage.cache_creation_input_tokens + call.usage.cache_read_input_tokens, 0),
    cacheRead: calls.reduce((n, call) => n + call.usage.cache_read_input_tokens, 0), output: calls.reduce((n, call) => n + call.usage.output_tokens, 0) };
}

async function run() {
  const corpus = await prepareCorpus();
  const prepared = [];
  for (const item of corpus.cases) {
    const { index, file } = await indexCase(item);
    const manifest = index.manifest(file, item.requestId).records.map(({ id, role, critical }) => ({ id, role, critical }));
    for (const variant of ['current', 'hybrid']) {
      const start = performance.now();
      const selection = variant === 'current' ? await index.prepare(file, item.requestId)
        : selectHybrid(await verifiedRecords(index, file, item.requestId), item.request, { budget: corpus.recoveryBudget, searchContext: item.text });
      const selectionMs = performance.now() - start;
      const source = sourceFor(item, selection.recovered, { records: manifest, linkedPriorRecords: [], omitted: 0, omittedFromInput: selection.omittedFromInput, skippedBytes: 0 });
      const prompt = reviewPrompt(source, 'ko', item.request, 'completed');
      const input = { id: item.id, variant, source, prompt, promptSha256: hash(prompt), selection, selectionMs,
        retainedFacts: item.facts.map(fact => ({ ...fact, retained: selection.recovered.some(record => record.text?.includes(fact.quote)), presentInPrompt: source.includes(fact.quote) })) };
      prepared.push(input);
    }
  }
  const manifest = { createdAt: new Date().toISOString(), corpusSha256: hash(JSON.stringify(corpus)), provider: corpus.provider, model: corpus.model,
    cli: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(), protocol: corpus.protocol, repeats: corpus.repeats,
    inputs: prepared.map(({ id, variant, promptSha256 }) => ({ id, variant, promptSha256 })),
    implementationSha256: hash(fs.readFileSync(__filename)), selectorSha256: hash(fs.readFileSync(path.join(__dirname, 'lib/terminal-review-hybrid.js'))),
    promptSourceSha256: hash(fs.readFileSync(path.join(__dirname, '../src/terminalReview.js'))) };
  if (fs.existsSync(path.join(directory, 'manifest.json'))) {
    const frozen = read('manifest.json');
    for (const key of ['corpusSha256', 'inputs', 'selectorSha256', 'promptSourceSha256', 'model']) assert.deepEqual(frozen[key], manifest[key], `Resume integrity: ${key}`);
  } else save('manifest.json', manifest);
  save('prepared.json', prepared);
  if (process.argv.includes('--prepare-only')) return;
  if (!process.argv.includes('--render-only')) for (const item of corpus.cases) {
    const { index, file } = await indexCase(item);
    for (let repeat = 1; repeat <= corpus.repeats; repeat++) for (const variant of repeat % 2 ? ['current', 'hybrid'] : ['hybrid', 'current']) {
      const name = `${item.id}-${repeat}-${variant}.json`;
      const input = prepared.find(value => value.id === item.id && value.variant === variant);
      if (fs.existsSync(path.join(directory, name))) { assert.equal(read(name).promptSha256, input.promptSha256); continue; }
      const started = performance.now(), calls = [];
      let source = input.source, prompt = input.prompt, retrieved = [];
      try {
        calls.push(await generate(prompt, corpus.provider, corpus.model));
        let raw;
        try { raw = JSON.parse(calls[0].text.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')); } catch { /* parseReview handles it below */ }
        const included = new Set(input.selection.recovered.map(record => record.id));
        const allowed = new Set(index.manifest(file, item.requestId).records.map(record => record.id));
        const ids = Array.isArray(raw?.evidenceRequests) ? raw.evidenceRequests.filter(id => allowed.has(id) && !included.has(id)).slice(0, 4) : [];
        let parsed = parseReview(calls[0].text, source, 'ko', item.request, 'completed');
        if (ids.length) {
          retrieved = await index.retrieve(file, item.requestId, ids);
          source += `\nADDITIONAL SCOPED RECORDS:\n${renderRecords(retrieved)}`;
          prompt = reviewPrompt(source, 'ko', item.request, 'completed');
          calls.push(await generate(prompt, corpus.provider, corpus.model));
          parsed = parseReview(calls.at(-1).text, source, 'ko', item.request, 'completed');
        } else if (parsed.tasks[0]?.decisionIssues.length) {
          calls.push(await generate(repairPrompt(prompt, parsed.tasks[0].decisionIssues), corpus.provider, corpus.model));
          parsed = parseReview(calls.at(-1).text, source, 'ko', item.request, 'completed');
        }
        const result = { id: item.id, repeat, variant, promptSha256: input.promptSha256, calls, parsed, retrieved,
          usage: usage(calls), durationMs: performance.now() - started + input.selectionMs };
        save(name, result);
        console.log(JSON.stringify({ id: item.id, repeat, variant, calls: calls.length, inputTokens: result.usage?.input,
          durationMs: Math.round(result.durationMs), issues: parsed.tasks[0]?.decisionIssues, action: parsed.tasks[0]?.decision?.action.kind }));
      } catch (error) {
        save(name, { id: item.id, repeat, variant, promptSha256: input.promptSha256, calls, error: error.message, durationMs: performance.now() - started });
        throw error;
      }
    }
  }
  render(corpus, prepared);
}

function render(corpus, prepared) {
  const results = corpus.cases.flatMap(item => Array.from({ length: corpus.repeats }, (_, i) => ['current', 'hybrid'].map(variant => read(`${item.id}-${i + 1}-${variant}.json`))).flat());
  const totals = variant => {
    const set = results.filter(item => item.variant === variant);
    const inputs = prepared.filter(item => item.variant === variant);
    const sum = (items, fn) => items.reduce((n, item) => n + fn(item), 0);
    return { generations: set.length, calls: sum(set, item => item.calls.length), errors: set.filter(item => item.error).length,
      validDecisions: set.filter(item => item.parsed?.tasks[0]?.decision).length,
      inputTokens: set.every(item => item.usage) ? sum(set, item => item.usage.input) : null,
      outputTokens: set.every(item => item.usage) ? sum(set, item => item.usage.output) : null,
      durationMs: sum(set, item => item.durationMs), initialRecoveredChars: sum(inputs, item => item.selection.readChars),
      retainedFacts: sum(inputs, item => item.retainedFacts.filter(fact => fact.retained).length), totalFacts: sum(inputs, item => item.retainedFacts.length),
      budgetOverflows: inputs.filter(item => item.selection.budgetOverflow > 0).length,
      models: [...new Set(set.flatMap(item => item.calls.map(call => call.actualModel)))], toolCalls: sum(set, item => sum(item.calls, call => call.toolCalls)) };
  };
  const summary = { current: totals('current'), hybrid: totals('hybrid'), cases: corpus.cases.map(item => ({ id: item.id, origin: item.origin,
    inputs: prepared.filter(input => input.id === item.id).map(input => ({ variant: input.variant, selectionMs: input.selectionMs,
      recoveredChars: input.selection.readChars, promptChars: input.prompt.length, facts: input.retainedFacts })),
    results: results.filter(result => result.id === item.id).map(({ id, repeat, variant, usage, durationMs, calls, parsed, error }) => ({ repeat, variant, usage, durationMs, calls: calls.length, error, issues: parsed?.tasks[0]?.decisionIssues })) })) };
  save('summary.json', summary);
  const brief = task => task ? `<h3>${esc(task.decision?.conclusion || task.actual)}</h3><ul>${(task.decision?.reasons || []).map(item => `<li>${esc(item.text)}</li>`).join('')}</ul><p>${esc(task.decision?.caution)}</p><p>${esc(task.decision?.action.text)} ${esc(task.decision?.action.why)}</p>${(task.decision?.alternatives || []).map(item => `<p><b>${esc(item.option)}</b>: ${esc(item.tradeoff)}<br>${esc(item.when)}</p>`).join('')}` : '';
  let body = `<h1>화이트박스 근거 선택 방식 벤치마크</h1><p>동일한 개선 분석 프롬프트 · ${esc(corpus.model)} · 사례 6개 × 방식 2개 × 각 2회</p><p>실제 세션 1개, 짧은 통제 사례 2개, 합성 스트레스 사례 3개. 알고리즘만 분리해서 비교합니다. 설치된 2.0.11의 근거 선택 모듈은 현재 소스와 바이트가 같습니다. 분석 프롬프트는 직전 개선 버전을 양쪽에 동일하게 사용했으므로 설치 앱 전체의 직접 속도 비교는 아닙니다.</p><p>현재: 중요 단어 우선 원문 4개·8천 자 복원. 비교안: 같은 요청의 공개 기록 전체를 기기에서 읽어 실패·조건 보존 + BM25 검색 + MMR로 구간 선택. 요청·최종 답변·도구 메타데이터·이전 맥락은 양쪽 동일합니다. 원문은 별도 보존합니다.</p>`;
  body += '<table><tr><th>실측 항목</th><th>현재 방식</th><th>비교안</th></tr>';
  for (const [key, title] of [['inputTokens', '모든 호출 입력 토큰(캐시 포함)'], ['outputTokens', '출력 토큰'], ['calls', '실제 모델 호출'], ['durationMs', '누적 처리 시간(ms)'], ['validDecisions', '형식 검증을 통과한 분석'], ['retainedFacts', '복원 입력에 보존된 지정 핵심 근거'], ['budgetOverflows', '필수 구간 예산 초과']]) body += `<tr><td>${title}</td><td>${summary.current[key]}</td><td>${summary.hybrid[key]}</td></tr>`;
  body += '</table><p>입력 토큰은 input + cache creation + cache read의 합계입니다. 비용과 같지 않습니다. 처리 시간은 선택+모델+추가 복원/형식 재시도이며 교차 순서로 실행했으나 네트워크·캐시 편차를 통제한 속도 보장은 아닙니다. 형식 통과는 내용 정답을 보장하지 않습니다. 핵심 근거 기준은 모델 실행 전에 고정했습니다.</p>';
  if (fs.existsSync(path.join(directory, 'assessment.json'))) {
    const assessment = read('assessment.json');
    body += `<h2>내용 검토</h2><p>${esc(assessment.conclusion)}</p><table><tr><th>사례</th><th>현재</th><th>비교안</th><th>판단 근거</th></tr>${assessment.cases.map(row => `<tr><td>${esc(row.id)}</td><td>${esc(row.current)}</td><td>${esc(row.hybrid)}</td><td>${esc(row.reason)}</td></tr>`).join('')}</table><p>${esc(assessment.limitations)}</p>`;
  }
  for (const item of corpus.cases) {
    body += `<section><h2>${esc(item.title)}</h2><p>${esc(item.origin)}</p><p>${esc(item.request)}</p><details><summary>실행 전에 정한 내용 기준과 원문 근거 보존</summary><pre>${esc(JSON.stringify({ rubric: item.rubric, inputs: summary.cases.find(row => row.id === item.id).inputs }, null, 2))}</pre></details>`;
    for (let repeat = 1; repeat <= corpus.repeats; repeat++) {
      body += `<h3>반복 ${repeat}</h3><div class="pair">`;
      for (const variant of ['current', 'hybrid']) {
        const result = results.find(row => row.id === item.id && row.repeat === repeat && row.variant === variant);
        body += `<article><b>${variant === 'current' ? '현재 방식' : 'BM25 + MMR 비교안'}</b>${brief(result.parsed?.tasks[0])}<p>입력 ${result.usage?.input ?? '?'} 토큰 · ${(result.durationMs / 1000).toFixed(1)}초 · ${result.calls.length}호출</p><details><summary>전체 분석 JSON / 실제 호출 기록</summary><pre>${esc(JSON.stringify(result, null, 2))}</pre></details></article>`;
      }
      body += '</div>';
    }
    body += '</section>';
  }
  fs.writeFileSync(path.join(directory, 'report.html'), `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whitebox 근거 선택 벤치마크</title><style>body{max-width:1240px;margin:32px auto;padding:0 24px;background:#f5f7f5;color:#24352c;font:15px/1.75 system-ui}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}article{padding:22px;background:white;border:1px solid #d7ded6;border-radius:12px}section{margin:40px 0}h3{line-height:1.5}table{border-collapse:collapse;width:100%;background:white}th,td{padding:10px 14px;border:1px solid #d7ded6;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}summary{cursor:pointer}@media(max-width:760px){.pair{grid-template-columns:1fr}}</style>${body}</html>`);
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { usage, indexCase, sourceFor, renderRecords };
