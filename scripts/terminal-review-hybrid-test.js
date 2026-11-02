'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ReviewEvidenceIndex } = require('../src/terminalReviewEvidence');
const { selectHybrid, verifiedRecords } = require('./lib/terminal-review-hybrid');
const { usage } = require('./terminal-review-hybrid-benchmark');
const record = (id, text, requestId = 'current', role = 'tool') => ({ id, text, requestId, role, status: 'available' });

async function main() {
  const noise = 'Routine layout inspected. '.repeat(120);
  const records = [record('request', '취소 동작 검증. 삭제하지 마.', 'current', 'user'),
    record('t1', `${noise}\nFAIL cancellation: worker still active; Exit code: 1\n${noise}`),
    record('t2', 'test run-id=after: mean=84 ms; p95=168 ms. requirement applies to p95.'),
    record('answer', 'All tests passed.', 'current', 'assistant')];
  const result = selectHybrid(records, '취소 동작 검증', { budget: 2000 });
  assert(result.recovered.some(block => block.text.includes('FAIL cancellation')));
  assert(result.recovered.some(block => block.text.includes('p95=168 ms')));
  for (const span of result.recovered) {
    const original = records.find(record => record.id === span.id);
    assert.equal(original.text.slice(span.start, span.end), span.text, 'Extractive provenance');
    assert.equal(span.role, 'tool'); assert.equal(span.requestId, 'current');
  }
  const overflow = selectHybrid([record('t1', 'FAIL first\n'.repeat(40)), record('t2', 'ERROR second\n'.repeat(40))], '', { budget: 50 });
  assert(overflow.budgetOverflow > 0);
  assert(overflow.recovered.some(block => block.text.includes('FAIL first')));
  assert(overflow.recovered.some(block => block.text.includes('ERROR second')));
  assert.equal(overflow.readChars, overflow.mandatoryChars);
  assert.throws(() => selectHybrid([record('one', 'text'), record('two', 'text', 'other')], ''), /Mixed request scope/);
  const small = selectHybrid([record('t1', 'onClick unchanged. No query-language overlap.')], '동작 유지', { budget: 8000 });
  assert.equal(small.recovered[0].text, 'onClick unchanged. No query-language overlap.');
  const opposite = selectHybrid([record('t1', 'FAIL cancellation run A'), record('t2', 'PASS cancellation run B')], 'cancellation', { budget: 100 });
  assert.equal(opposite.recovered.length, 2, 'Conflicting results must survive');
  assert.equal(usage([{ usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 300, output_tokens: 50 } }]).input, 402);
  assert.equal(usage([{ usage: { input_tokens: 2 } }]), null, 'Missing usage is not zero');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'whitebox-hybrid-test-'));
  try {
    const file = path.join(directory, 'source.jsonl');
    const row = { type: 'user', sessionId: 'session', message: { content: [{ type: 'tool_result', content: 'FAIL original' }, { type: 'thinking', text: 'private reasoning never admitted' }] } };
    const bytes = Buffer.from(JSON.stringify(row));
    await fs.writeFile(file, bytes);
    const index = new ReviewEvidenceIndex();
    index.add(file, await fs.stat(file), 'claude', 'session', 'current', row, 0, bytes);
    const recovered = await verifiedRecords(index, file, 'current');
    assert.equal(recovered[0].text, 'FAIL original');
    assert.deepEqual(await verifiedRecords(index, file, 'another-request'), []);
    await fs.writeFile(file, Buffer.from(JSON.stringify(row).replace('FAIL original', 'PASS modified')));
    await assert.rejects(verifiedRecords(index, file, 'current'), /Record changed/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
  console.log('PASS hybrid prototype: rare failures, numeric conditions, provenance, explicit budget overflow, conflicting results, multilingual short evidence, scoped verified reads, tamper rejection, cache-inclusive usage');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
