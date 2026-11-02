'use strict';

// Fresh paired real-model runs through the application's AgentRunner. No edits
// to the user's app/profile/logs, no tools, no user-session resume.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { AgentRunner } = require('../src/agentRunner');
const { reviewPrompt, parseReview } = require('../src/terminalReview');
const { repairPrompt } = require('../src/terminalReviewDecision');
const { TerminalReviewCompletion, applyClaudeRow } = require('../src/terminalReviewCompletion');
const { assistantUpdates, reviewContext } = require('../src/terminalReviewContext');
const { toolEvidence } = require('../src/terminalReviewTools');
const { verifiedRecords } = require('./lib/terminal-review-hybrid');
const { selectRefined } = require('./lib/terminal-review-hybrid-refined');
const { indexCase, sourceFor, renderRecords } = require('./terminal-review-hybrid-benchmark');
const root = path.resolve(process.argv[2] || 'artifacts/terminal-review-first-pass-20261102');
const previousRoot = path.resolve('artifacts/terminal-review-hybrid-refined-20261102');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const save = (name, data) => fs.writeFileSync(path.join(root, name), JSON.stringify(data, null, 2) + '\n');
const arms = ['before', 'after'];
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function beforePrompt(source, request) {
  const saved = read('before-template.json'); assert.equal(sha(saved.text), saved.sha256);
  return saved.text.replace(JSON.stringify('__WHITEBOX_REQUEST_58D2__'), () => JSON.stringify(request)).replace('__WHITEBOX_SOURCE_58D2__', () => source);
}
async function corpus() {
  if (fs.existsSync(path.join(root, 'corpus.json'))) return read('corpus.json');
  const previous = JSON.parse(fs.readFileSync(path.join(previousRoot, 'corpus.json')));
  const file = path.join(os.homedir(), '.claude/projects/-Users-ubion-Desktop-ubion-project-ai-learning-analytics-backend/6b18ad9a-966c-4366-8429-89d73d78c820.jsonl');
  const requestId = '295f1204-f9fd-456a-b0dc-57c30b5739cc', sessionId = '6b18ad9a-966c-4366-8429-89d73d78c820';
  const state = {}; let snapshot;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let row; try { row = JSON.parse(line); } catch { continue; }
    applyClaudeRow(state, row, sessionId);
    if (state.requestId === requestId) snapshot = structuredClone(state);
    else if (snapshot) break;
  }
  assert(snapshot?.answer && snapshot.request.includes('잠금 전'));
  const completion = new TerminalReviewCompletion(); await completion.logState(file, 'claude', sessionId);
  const records = await verifiedRecords(completion.evidence, file, requestId);
  const actual = { id: 'observed-format-error', title: '실제 오류가 기록됐던 잠금 전 영수증 조회 설명 요청', origin: 'second real frozen request, exact native request ID; failed review output unavailable',
    requestId, request: snapshot.request, text: `USER:\n${snapshot.request}\nASSISTANT (completed answer):\n${snapshot.answer}`,
    records, tools: toolEvidence(snapshot), updates: assistantUpdates(snapshot), context: reviewContext(snapshot), facts: [],
    rubric: ['이 요청의 설명과 근거를 연결하고 다른 요청과 섞지 않음', '설명 요청을 수정 지시로 확대하지 않음', 'JSON 수신/해석 실패와 작업 내용의 실패를 구분'], model: 'claude-opus-5-5' };
  const data = { createdAt: new Date().toISOString(), repeats: 3, provider: 'claude', defaultModel: 'claude-sonnet-5-5',
    previousCorpusSha256: sha(JSON.stringify(previous)), cases: [...previous.cases, actual],
    protocol: 'Both arms use identical refined evidence and unchanged strict validator/2-call ceiling. Before prompt is frozen at 1832675; after improves first-response consistency and removes duplicate follow-ups. 9 original Sonnet cases + one real error-input Opus case, 3 repeats each, alternating order, all generated fresh through one shared application AgentRunner. Transport fix shared by both arms; old transport reproduced separately. No retry suppression, validator relaxation, uncertain-fact deletion or output rewriting.' };
  save('corpus.json', data);
  save('rubric.json', { frozenAt: new Date().toISOString(), primary: ['first-pass valid decision rate', 'format retries and optional evidence retrieval separately', 'final invalid/error rate', 'per-analysis mean/median/p90/max inclusive of retries', 'input/output tokens inclusive of cache and retries'],
    nonRegression: ['same original 16 tool reference spans and unchanged selector', 'no fix instructions in checking-only/diagnosis cases', 'explicit conditional repair retained', 'latest no-edit restriction retained', 'material unknowns not deleted merely to obtain finish'],
    scopeOnlyCases: ['hidden-failure','numeric-conflict','latest-report-only','observed-format-error'],
    manualReview: 'Inspect raw first and final action, caution, unverified, alternatives and nextStep. Automatic structural validity is not semantic accuracy. The Map control has incomplete call linkage; preserve explicit uncertainty/attribution rather than score a definitive design answer.' });
  save('observed-error.json', { recordedAt: new Date().toISOString(), messageObservedEarlier: '분석 응답의 형식을 읽지 못했습니다. 다시 검토를 눌러 주세요.', requestId, sessionId,
    sourceFile: file, failedResponseAvailable: false, failedModelRecorded: false, extraModelBasis: 'Recent successful reviews in this terminal reported claude-opus-5-5; failed model was not retained. The extra case is explicitly tested on Opus, without attributing the historic failure to that model.',
    attribution: 'Existing profile entry changed after inspection; use the pinned original conversation input. Cannot determine the historic malformed response cause from this input alone.' });
  return data;
}

function liveTransport() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-first-pass-'));
  let capture = null;
  const runner = new AgentRunner({ runsDir: path.join(temporary, 'runs'), questionnaireTimeoutMs: 150000,
    spawn: (...args) => {
      const child = spawn(...args), current = capture;
      child.stdout.on('data', bytes => { current.stdout += bytes.toString('utf8'); });
      child.stderr.on('data', bytes => { current.stderr += bytes.toString('utf8'); });
      child.on('close', (code, signal) => { current.code = code; current.signal = signal; });
      return child;
    } });
  return { runner,
    async generate(prompt, model) {
      assert(runner.canGenerateTerminalReview(), 'Previous review process must actually finish before the next starts');
      const current = { stdout: '', stderr: '' }; capture = current;
      const started = performance.now();
      try {
        const answer = await runner.generateTerminalReview({ provider: 'claude', prompt, model });
        const events = current.stdout.split('\n').flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}});
        const final = events.findLast(event=>event.type==='result');
        const tools = events.flatMap(event=>event.message?.content||[]).filter(block=>block.type==='tool_use').length;
        const actualModel = events.find(event=>event.type==='system'&&event.subtype==='init')?.model || answer.model;
        assert.equal(tools,0); assert.equal(current.code,0); assert(!final?.is_error); assert.equal(actualModel,model);
        assert.equal(answer.text,final.result,'Application must receive exactly the explicit CLI final result');
        return { text:answer.text,usage:answer.usage,actualModel,tools,code:current.code,signal:current.signal,durationMs:performance.now()-started,
          timings:answer.timings,rawUsage:final.usage,transportFinalSha256:sha(final.result),deliveredSha256:sha(answer.text),
          assistantFrames:events.filter(event=>event.type==='assistant').length,stderr:current.stderr.slice(-1200),runnerActiveAfter:runner.listActive().length };
      } catch(error) {
        error.benchmarkTransport = { code:current.code,signal:current.signal,stdout:current.stdout,stderr:current.stderr,durationMs:performance.now()-started };
        throw error;
      }
    },
    async close() { await runner.dispose(); fs.rmSync(temporary,{recursive:true,force:true}); }
  };
}
function sumUsage(calls) {
  if (calls.some(call=>!call.usage)) return null;
  return { input:calls.reduce((n,c)=>n+c.usage.input,0),output:calls.reduce((n,c)=>n+c.usage.output,0),cachedInput:calls.reduce((n,c)=>n+c.usage.cachedInput,0) };
}
async function main() {
  fs.mkdirSync(root,{recursive:true}); const data=await corpus();
  const previousPrepared=JSON.parse(fs.readFileSync(path.join(previousRoot,'prepared.json')));
  const prepared=[];
  for(const item of data.cases) {
    const {index,file}=await indexCase(item,root), started=performance.now();
    const selection=selectRefined(await verifiedRecords(index,file,item.requestId),item.request,{budget:8000,searchContext:item.text});
    const selectionMs=performance.now()-started;
    let source;
    const previous=previousPrepared.find(p=>p.id===item.id&&p.variant==='refined');
    if(previous) {
      assert.deepEqual(selection.recovered,previous.selection.recovered,'Evidence selector changed'); source=previous.source;
      assert.equal(sha(beforePrompt(source,item.request)),previous.promptSha256,'Before prompt changed');
    } else source=sourceFor(item,selection.recovered,{records:index.manifest(file,item.requestId).records.map(({id,role,critical})=>({id,role,critical})),linkedPriorRecords:[],omitted:0,omittedFromInput:selection.omittedFromInput,skippedBytes:0});
    for(const variant of arms) {
      const prompt=variant==='before'?beforePrompt(source,item.request):reviewPrompt(source,'ko',item.request,'completed');
      prepared.push({id:item.id,variant,source,prompt,promptSha256:sha(prompt),selection,selectionMs,model:item.model||data.defaultModel,
        facts:item.facts.map(f=>({...f,retained:selection.recovered.some(span=>span.text.includes(f.quote))}))});
    }
  }
  const manifest={createdAt:new Date().toISOString(),corpusSha256:sha(JSON.stringify(data)),rubricSha256:sha(fs.readFileSync(path.join(root,'rubric.json'))),repeats:data.repeats,
    cli:execFileSync('claude',['--version'],{encoding:'utf8'}).trim(),protocol:data.protocol,
    inputs:prepared.map(({id,variant,promptSha256,model})=>({id,variant,promptSha256,model})),
    hashes:Object.fromEntries(['src/terminalReview.js','src/terminalReviewDecision.js','src/agentRunner.js','src/questionnaireCommand.js','src/terminalReviewEvidence.js','src/terminalReviewCompletion.js',
      'scripts/lib/terminal-review-hybrid.js','scripts/lib/terminal-review-hybrid-refined.js','scripts/terminal-review-hybrid-benchmark.js','scripts/terminal-review-first-pass-benchmark.js'].map(file=>[file,sha(fs.readFileSync(file))]))};
  if(fs.existsSync(path.join(root,'manifest.json'))) {const saved=read('manifest.json');for(const key of ['corpusSha256','rubricSha256','inputs','hashes','repeats'])assert.deepEqual(saved[key],manifest[key],`Cannot reuse changed ${key}`)}else save('manifest.json',manifest);
  if(!process.argv.includes('--render-only'))save('prepared.json',prepared);
  if(process.argv.includes('--prepare-only'))return;
  if(!process.argv.includes('--render-only')) {
    const live=liveTransport();
    try {for(const [caseIndex,item]of data.cases.entries()){
      const {index,file}=await indexCase(item,root);
      for(let repeat=1;repeat<=data.repeats;repeat++) for(const variant of (caseIndex+repeat)%2?arms:[...arms].reverse()) {
        const name=`${item.id}-${repeat}-${variant}.json`,input=prepared.find(p=>p.id===item.id&&p.variant===variant);
        if(fs.existsSync(path.join(root,name))){const saved=read(name);assert.equal(saved.promptSha256,input.promptSha256);continue}
        const started=performance.now(),calls=[];let source=input.source,parsed,firstParsed,repairIssues=[],retrieved=[];
        try {
          calls.push(await live.generate(input.prompt,input.model));
          parsed=parseReview(calls[0].text,source,'ko',item.request,'completed');firstParsed=parsed;
          let draft;try{draft=JSON.parse(calls[0].text.replace(/^```(?:json)?\s*/u,'').replace(/\s*```$/u,''))}catch{}
          const included=new Set(input.selection.recovered.map(r=>r.id)),allowed=new Set(index.manifest(file,item.requestId).records.map(r=>r.id));
          const ids=Array.isArray(draft?.evidenceRequests)?draft.evidenceRequests.filter(id=>allowed.has(id)&&!included.has(id)).slice(0,4):[];
          if(ids.length){
            retrieved=await index.retrieve(file,item.requestId,ids);source+=`\nADDITIONAL SCOPED RECORDS:\n${renderRecords(retrieved)}`;
            const prompt=variant==='before'?beforePrompt(source,item.request):reviewPrompt(source,'ko',item.request,'completed');
            calls.push(await live.generate(prompt,input.model));parsed=parseReview(calls.at(-1).text,source,'ko',item.request,'completed');
          }else if(parsed.tasks[0]?.decisionIssues.length){
            repairIssues=parsed.tasks[0].decisionIssues;calls.push(await live.generate(repairPrompt(input.prompt,repairIssues),input.model));
            parsed=parseReview(calls.at(-1).text,source,'ko',item.request,'completed');
          }
          save(name,{id:item.id,variant,repeat,model:input.model,promptSha256:input.promptSha256,calls,firstParsed,parsed,repairIssues,retrieved,usage:sumUsage(calls),durationMs:performance.now()-started+input.selectionMs});
          console.log(JSON.stringify({id:item.id,variant,repeat,model:input.model,calls:calls.length,firstValid:Boolean(firstParsed.tasks[0]?.decision),finalValid:Boolean(parsed.tasks[0]?.decision),issues:parsed.tasks[0]?.decisionIssues,ms:Math.round(performance.now()-started)}));
        }catch(error){
          save(name,{id:item.id,variant,repeat,model:input.model,promptSha256:input.promptSha256,calls,firstParsed,parsed,error:error.message,transport:error.benchmarkTransport,usage:sumUsage(calls),durationMs:performance.now()-started+input.selectionMs});
          console.log(JSON.stringify({id:item.id,variant,repeat,error:error.message}));
          if(!live.runner.canGenerateTerminalReview())throw error;
        }
      }
    }}finally{await live.close()}
  }
  render(data,read('prepared.json'));
}

function render(data,prepared) {
  const results=data.cases.flatMap(item=>Array.from({length:data.repeats},(_,i)=>arms.map(v=>read(`${item.id}-${i+1}-${v}.json`))).flat());
  const totals=(arm,model)=>{const set=results.filter(r=>r.variant===arm&&(!model||r.model===model)),t=set.map(r=>r.durationMs).sort((a,b)=>a-b),sum=f=>set.reduce((n,r)=>n+f(r),0);
    return{analyses:set.length,firstValid:set.filter(r=>r.firstParsed?.tasks[0]?.decision).length,finalValid:set.filter(r=>r.parsed?.tasks[0]?.decision).length,
      retries:sum(r=>r.repairIssues?.length?1:0),retrievals:sum(r=>r.retrieved?.length?1:0),calls:sum(r=>r.calls.length),errors:set.filter(r=>r.error).length,
      meanMs:sum(r=>r.durationMs)/set.length,medianMs:t.length%2?t[(t.length-1)/2]:(t[t.length/2-1]+t[t.length/2])/2,p90Ms:t[Math.ceil(t.length*.9)-1],maxMs:t.at(-1),totalMs:sum(r=>r.durationMs),
      inputTokens:set.every(r=>r.usage)?sum(r=>r.usage.input):null,outputTokens:set.every(r=>r.usage)?sum(r=>r.usage.output):null};};
  const summary={sonnet:Object.fromEntries(arms.map(a=>[a,totals(a,data.defaultModel)])),opus:Object.fromEntries(arms.map(a=>[a,totals(a,'claude-opus-5-5')])),
    all:Object.fromEntries(arms.map(a=>[a,totals(a)])),references:prepared.filter(p=>p.variant==='after').flatMap(p=>p.facts),
    cases:data.cases.map(item=>({id:item.id,model:item.model||data.defaultModel,results:results.filter(r=>r.id===item.id).map(r=>({variant:r.variant,repeat:r.repeat,firstValid:Boolean(r.firstParsed?.tasks[0]?.decision),finalValid:Boolean(r.parsed?.tasks[0]?.decision),calls:r.calls.length,repairIssues:r.repairIssues,error:r.error,ms:r.durationMs}))}))};
  save('summary.json',summary);
  let body='<h1>첫 응답 일관성·연속 분석 비교</h1><p>근거 선택·검증 기준·최대 2회 호출은 동일합니다. 첫 응답의 항목 간 조건과 중복 출력을 개선했습니다. 기존 9사례는 Sonnet 5.5, 실제 오류 입력 1사례는 Opus 5.5로 각각 방식별 3회 실행했습니다. 모두 앱의 실제 AgentRunner를 연속 사용했습니다.</p><p>수신 경로 수정은 양쪽에 공통입니다. 수정 전 수신 문제는 별도 재현 시험으로 검증했습니다. 당시 실패한 분석의 원문 응답은 없어 같은 원인이었다고 단정할 수 없습니다. 실제 설치 앱의 UI·클릭 E2E나 Jev는 이 비교에 포함하지 않습니다.</p>';
  for(const [key,title]of [['sonnet','기존 9사례 · Sonnet'],['opus','실제 오류 입력 · Opus'],['all','전체: 서로 다른 모델의 합계는 이 표본에 한정']]){
    body+=`<h2>${title}</h2><table><tr><th>항목</th><th>보완 전</th><th>보완 후</th></tr>`;
    for(const [field,label]of [['analyses','분석 수'],['firstValid','첫 응답 형식 통과'],['retries','형식 재시도'],['finalValid','최종 형식 통과'],['errors','수신/파싱/모델 오류'],['meanMs','건당 평균 ms'],['medianMs','중앙값 ms'],['p90Ms','p90 ms'],['maxMs','최대 ms'],['inputTokens','전체 입력 토큰(캐시·재시도 포함)']])body+=`<tr><td>${label}</td>${arms.map(a=>`<td>${typeof summary[key][a][field]==='number'?Math.round(summary[key][a][field]*100)/100:summary[key][a][field]}</td>`).join('')}</tr>`;
    body+='</table>';
  }
  body+='<p>수정 후 원문 보존은 아래 사례별 기준으로 확인합니다. 형식 통과는 의미 정확도가 아니며, 첫 응답과 최종 응답을 함께 검토합니다. 평균·상위 지연은 재시도와 네트워크/모델 변동을 포함합니다. p90은 관측 표본의 nearest-rank입니다.</p>';
  if(fs.existsSync(path.join(root,'assessment.json'))){const a=read('assessment.json');body+=`<h2>내용·연속 처리 검토</h2><p>${esc(a.conclusion)}</p><pre>${esc(JSON.stringify(a,null,2))}</pre>`;}
  for(const item of data.cases){body+=`<section><h2>${esc(item.id)}</h2><p>${esc(item.origin)}</p><p>${esc(item.request)}</p>`;
    for(let i=1;i<=data.repeats;i++){body+=`<h3>반복 ${i}</h3><div class="pair">`;for(const arm of arms){const r=results.find(r=>r.id===item.id&&r.repeat===i&&r.variant===arm),task=r.parsed?.tasks[0],d=task?.decision;
      body+=`<article><b>${arm==='before'?'보완 전':'첫 응답 보완 후'}</b><h3>${esc(d?.conclusion||task?.actual||r.error)}</h3><ul>${(d?.reasons||[]).map(r=>`<li>${esc(r.text)}</li>`).join('')}</ul><p>${esc(d?.caution)}</p><p>${esc(d?.action?.kind)} ${esc(d?.action?.request)}</p><small>${(r.durationMs/1000).toFixed(2)}초 · ${r.calls.length}호출 · 첫 응답 ${r.firstParsed?.tasks[0]?.decision?'통과':'미통과'}</small><details><summary>원문 응답·사용량·수신 일치·재시도</summary><pre>${esc(JSON.stringify(r,null,2))}</pre></details></article>`;
    }body+='</div>';}body+='</section>';
  }
  fs.writeFileSync(path.join(root,'report.html'),`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whitebox 재시도·연속 분석 벤치마크</title><style>body{max-width:1300px;margin:32px auto;padding:0 24px;background:#f5f7f5;color:#24352c;font:15px/1.7 system-ui}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}article{padding:20px;background:white;border:1px solid #d7ded6;border-radius:10px}table{width:100%;border-collapse:collapse;background:white}td,th{border:1px solid #d7ded6;padding:9px;text-align:left}section{margin-top:36px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}summary{cursor:pointer}@media(max-width:800px){.pair{grid-template-columns:1fr}}</style>${body}</html>`);
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1});
module.exports={liveTransport};
