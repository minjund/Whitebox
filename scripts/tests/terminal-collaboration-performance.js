'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TerminalCollaboration } = require('../../src/terminalCollaboration');
function registerTerminalCollaborationPerformanceTests({ test, temp }) {
  function fixture(name) {
    const directory = path.join(temp, name);
    let now = Date.now(), live = [], writes = 0;
    const service = new TerminalCollaboration({ directory, manager: () => ({ list: () => live }),
      monitor: { scan: () => ({ available: true, processes: [] }) }, activity: { observe: async () => new Map() }, enableControl: false, now: () => now });
    const write = service.writeAccessFile.bind(service);
    service.writeAccessFile = (...args) => { writes++; return write(...args); };
    const update = frames => service.sync({ groups: live.length ? [{ id: 'group', cwd: directory, members: live }] : [], frames });
    return { service, directory, update, setLive: value => { live = value; }, advance: ms => { now += ms; }, writes: () => writes, now: () => now };
  }
  test('closed or replaced terminals release cached screens and stale frames cannot re-enter the roster', async () => {
    const f = fixture('frame-retention');
    for (let i = 0; i < 100; i++) {
      const member = { id: `terminal:${i}`, creationId: `epoch:${i}`, pid: 10000 + i, status: 'running' };
      f.setLive([member]);
      await f.update([{ ...member, text: 'x'.repeat(24000) }]);
      assert.equal(f.service.frames.size, 1);
    }
    const replacement = { id: 'terminal:99', creationId: 'replacement', pid: 20000, status: 'running' };
    f.setLive([replacement]);
    await f.update([{ ...replacement, creationId: 'epoch:99', text: 'stale' }, { id: 'foreign', text: 'foreign' }]);
    assert.equal(f.service.frames.size, 0);
    f.setLive([]); await f.update([]);
    assert.equal(f.service.connected.size, 0); assert.equal(f.service.accessSnapshots.size, 0);
    assert.equal(fs.readdirSync(f.directory).filter(name => name.endsWith('.access.json')).length, 0);
  });
  test('unchanged rosters skip writes while heartbeat, roster changes and externally replaced access files refresh immediately', async () => {
    const f = fixture('roster-heartbeat');
    const members = Array.from({ length: 32 }, (_, i) => ({ id: `terminal:${i}`, creationId: `epoch:${i}`, pid: 10000 + i, status: 'running' }));
    f.setLive(members); await f.update([]);
    assert.equal(f.writes(), 32);
    for (let i = 0; i < 4; i++) { f.advance(1000); await f.update([]); }
    assert.equal(f.writes(), 32, 'idle polls must not rewrite unchanged files');
    f.advance(1000); await f.update([]);
    assert.equal(f.writes(), 64, '5s heartbeat preserves the CLI 30s expiry guard');
    const file = f.service.file(members[0].id, 'access');
    assert.equal(JSON.parse(fs.readFileSync(file)).updatedAt, f.now());
    fs.writeFileSync(file, JSON.stringify({ token: 'foreign' }));
    await f.update([]); assert.equal(f.writes(), 65);
    assert.equal(JSON.parse(fs.readFileSync(file)).token, f.service.connected.get(members[0].id).token);
    f.setLive(members.slice(0, 31)); await f.update([]);
    assert.equal(f.writes(), 96, 'changed membership publishes to every remaining member without waiting for a heartbeat');
    assert.equal(fs.existsSync(f.service.file(members[31].id, 'access')), false);
  });
}
module.exports = { registerTerminalCollaborationPerformanceTests };
