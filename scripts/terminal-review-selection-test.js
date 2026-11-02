'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { TerminalReviewCompletion } = require('../src/terminalReviewCompletion');

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'whitebox-evidence-selection-'));
  try {
    const sessionId = 'selection-session', requestId = 'selection-request';
    const query = 'pendingCounts = registry.pendingCounts(ids); 여기서 Map이 필요해? 설명만 해줘.';
    const code = 'public boolean use(Map<String,Integer> pendingCounts) {\nreturn pendingCounts.isEmpty();\n}\n'
      + 'public static Map<String,Integer> pendingCounts(Map<String,Integer> left, Map<String,Integer> right) {\n'
      + 'Map<String,Integer> counts = new HashMap<>(left);\nright.forEach((key, value) -> counts.merge(key, value, Integer::sum));\nreturn counts;\n}\n';
    const noise = 'Read unrelated theme and spacing values.\n'.repeat(90);
    const rows = text => [
      { type:'user', sessionId, uuid:requestId, timestamp:'2026-11-02T00:00:00Z', message:{role:'user',content:query} },
      { type:'user', sessionId, uuid:'tool', timestamp:'2026-11-02T00:00:01Z', message:{content:[{type:'tool_result',content:text}]} },
      { type:'assistant', sessionId, uuid:'answer', timestamp:'2026-11-02T00:00:02Z', message:{role:'assistant',stop_reason:'end_turn',content:[{type:'thinking',thinking:'PRIVATE_REASONING'},{type:'text',text:'호출부는 비었는지만 보고 공유 함수는 키별 합산을 합니다.'}]} },
      { type:'user', sessionId, uuid:'foreign', timestamp:'2026-11-02T00:00:03Z', message:{role:'user',content:'다른 작업'} },
      { type:'user', sessionId, uuid:'foreign-tool', timestamp:'2026-11-02T00:00:04Z', message:{content:[{type:'tool_result',content:'FAIL FOREIGN_REQUEST'}]} },
    ];
    const prepare = async (name, text) => {
      const file=path.join(directory,name+'.jsonl');await fs.writeFile(file,rows(text).map(r=>JSON.stringify(r)).join('\n')+'\n');
      const reader=new TerminalReviewCompletion();await reader.logState(file,'claude',sessionId);
      const source={file,requestId};
      return {file,reader,source,result:await reader.prepareEvidence(source,{}, {request:query,text:'빈 값 검사와 공유 집계를 설명합니다.'})};
    };
    const normal=await prepare('normal',noise+code+noise+'\nFAIL cancellation; Exit code: 1\nthreshold=120 ms; observed=168 ms');
    assert.equal(normal.result.selection.policy,'protected-bm25-mmr');
    for(const quote of ['pendingCounts.isEmpty()','counts.merge(key, value, Integer::sum)','FAIL cancellation','observed=168 ms'])assert(normal.result.recovered.some(r=>r.text.includes(quote)),quote);
    assert(normal.result.recovered.every(r=>r.requestId===requestId&&r.role==='tool'));
    assert.doesNotMatch(JSON.stringify(normal.result),/PRIVATE_REASONING|FOREIGN_REQUEST/);
    const original=await fs.readFile(normal.file,'utf8');await fs.writeFile(normal.file,original.replace('observed=168 ms','observed=000 ms'));
    const changed=await normal.reader.prepareEvidence(normal.source,{}, {request:query});
    assert.equal(changed.selection.policy,'bounded-fallback');assert.equal(changed.selection.incomplete,true);
    assert(!changed.recovered.some(r=>r.text?.includes('observed=000 ms')),'Changed bytes cannot become verified evidence');
    const huge=await prepare('huge','Read unrelated values. '.repeat(12500));
    assert.equal(huge.result.selection.reason,'ranking-limit');assert(huge.result.readChars<=8000);
    const overflow=await prepare('protected',Array.from({length:1000},(_,i)=>`FAIL test ${i}: condition is unresolved.\n`).join(''));
    assert.equal(overflow.result.selection.reason,'protected-prompt-limit');assert(overflow.result.readChars<=8000);
    const codexFile=path.join(directory,'codex.jsonl');
    await fs.writeFile(codexFile,[
      {type:'event_msg',payload:{type:'task_started',turn_id:'turn'}},
      {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:query}]}},
      {type:'response_item',payload:{type:'function_call_output',call_id:'read',output:code}},
      {type:'response_item',payload:{type:'message',role:'assistant',channel:'analysis',content:[{type:'output_text',text:'PRIVATE_CODEX_REASONING'}]}},
      {type:'event_msg',payload:{type:'task_complete',turn_id:'turn',last_agent_message:'설명 완료'}},
    ].map(r=>JSON.stringify(r)).join('\n')+'\n');
    const reader=new TerminalReviewCompletion();const state=await reader.logState(codexFile,'codex');
    const codex=await reader.prepareEvidence(state.source,{}, {request:query});
    assert.equal(codex.selection.policy,'protected-bm25-mmr');assert(codex.recovered.some(r=>r.text.includes('counts.merge')));
    assert.doesNotMatch(JSON.stringify(codex),/PRIVATE_CODEX_REASONING/);
    console.log('PASS production evidence selection: related implementation/caller operations, failure and numeric evidence, Claude/Codex scope and privacy, tamper rejection, bounded explicit fallback');
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1});
module.exports={main};
