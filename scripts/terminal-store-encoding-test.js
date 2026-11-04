'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TerminalReplayEncoding, encodedStore } = require('../src/terminalReplayEncoding');
const { TerminalManager, normalizeLaunchOptions } = require('../src/terminalManager');

module.exports = function storeEncodingChecks() {
  const samples = ['', '한글😀\n"quoted"\\path\r\t\0', '\ud800 broken \udfff', 'text "replay":""', '\u2028\u2029'];
  const sessions = samples.map(() => ({})), cache = new TerminalReplayEncoding(2048);
  const records = samples.map((replay, index) => {
    cache.full(sessions[index], replay, value => value);
    return { id: 'r' + index, options: { replay: '', nested: '"replay":""' }, omitted: undefined, replay, after: { text: '끝' } };
  });
  for (const provenance of [[], [{ id: 'provenance', text: '이전😀\n기록' }]]) {
    const payload = { version: 2, sessions: records, ...(provenance.length ? { comprehensionProvenance: provenance } : {}) };
    assert(encodedStore(records, sessions, provenance, 2, cache).equals(Buffer.from(JSON.stringify(payload))), 'exact existing JSON bytes, field order and escaping');
  }
  const original = cache.encode(sessions[1], samples[1]);
  cache.full(sessions[1], samples[1], () => { throw Error('unchanged replay was rescanned'); });
  assert.equal(cache.encode(sessions[1], samples[1]), original);
  cache.full(sessions[1], '새 출력', value => value);
  assert.notEqual(cache.encode(sessions[1], '새 출력'), original);
  for (let i = 0; i < 20; i++) cache.full({}, 'x'.repeat(1000) + i, value => value);
  assert(cache.bytes <= 2048, 'strict cache memory bound');
  cache.prune([]); assert.equal(cache.bytes, 0); assert.equal(cache.records.size, 0);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-store-encoding-'));
  try {
    for (const budget of [4096, 8192]) {
      const file = path.join(directory, `store-${budget}.json`);
      let rejectNextWrite = false, writes = 0;
      const fileSystem = { ...fs, writeFileSync(...args) {
        writes++;
        if (rejectNextWrite) { rejectNextWrite = false; throw Object.assign(new Error('fixture write failure'), { code: 'EIO' }); }
        return fs.writeFileSync(...args);
      } };
      const manager = new TerminalManager({ maxStoreBytes: budget, fileSystem });
      manager.storeFile = file;
      const now = new Date().toISOString();
      for (let index = 0; index < 3; index++) {
        const id = 'terminal:encoding:' + index;
        manager.sessions.set(id, { id, options: normalizeLaunchOptions({ type: 'shell', cwd: directory }),
          status: 'stopped', pid: null, createdAt: now, updatedAt: now, cols: 80, rows: 24,
          replay: `${index} 한글😀\n"quoted"\\x`.repeat(800), replayPendingChunks: [], replayPendingChars: 0 });
      }
      const save = () => {
        assert(manager.persistNow());
        const bytes = fs.readFileSync(file); assert(bytes.length <= budget);
        const data = JSON.parse(bytes);
        for (const row of data.sessions) {
          assert(manager.sessions.get(row.id).replay.endsWith(row.replay), 'exact output suffix');
          assert(!/^[\udc00-\udfff]/u.test(row.replay), 'no split surrogate pair');
        }
        return data;
      };
      save(); const saved = fs.readFileSync(file);
      save(); assert(fs.readFileSync(file).equals(saved), 'stable bounded store bytes');
      const changed = manager.sessions.get('terminal:encoding:0');
      changed.replayPendingChunks.push('새 출력😀'); changed.replayPendingChars = 6;
      assert(save().sessions[0].replay.endsWith('새 출력😀'), 'pending output invalidates encoding');
      changed.title = 'metadata ' + 'x'.repeat(50); save();
      const beforeFailure = fs.readFileSync(file);
      rejectNextWrite = true; changed.title = '수정된 제목';
      assert.equal(manager.persistNow(), false);
      assert(fs.readFileSync(file).equals(beforeFailure), 'write failure preserves durable state');
      const previousWrites = writes;
      assert.equal(save().sessions[0].title, '수정된 제목');
      assert.equal(writes, previousWrites + 1, 'cache hit never skips a failed transaction retry');
      manager.sessions.delete('terminal:encoding:1');
      assert.equal(save().sessions.length, 2);
      assert.equal(manager.replayEncoding.records.size, 2, 'closed session cache released');
      const restored = new TerminalManager({ storeFile: file, maxStoreBytes: budget });
      assert.equal(restored.get(changed.id, true).replay, JSON.parse(fs.readFileSync(file)).sessions.find(row => row.id === changed.id).replay, 'existing schema restores without starting a shell');
    }
    console.log('PASS terminal store encoding: byte parity, Unicode/budget/cache invalidation, memory bounds, atomic failure/retry, deletion and restart');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
};
if (require.main === module) module.exports();
