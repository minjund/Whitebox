'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { TerminalManager, killPtyTree } = require('../../src/terminalManager');
const { TerminalGroups } = require('../../src/terminalGroups');

function registerPtyRecoveryTests({ test, root }) {
  test('종료 ack를 보존한 POSIX PTY는 신호 없이 그룹 부재를 재확인하고 살아 있는 그룹은 차단한다', async () => {
    const calls = [];
    let present = true;
    const handle = { pid: 88001, __whiteboxExited: false, listeners: [],
      onExit(fn) { this.listeners.push(fn); return { dispose() {} }; },
      onData() {}, emitExit() { this.__whiteboxExited = true; for (const fn of [...this.listeners]) fn({ exitCode: 0 }); } };
    const manager = new TerminalManager({ platform: 'darwin', ptyModule: { spawn: () => handle },
      killTree: (pty, pid, _timeout, options) => killPtyTree(pty, pid, 30, { ...options, platform: 'darwin',
        killProcess(target, signal) {
          calls.push([target, signal]);
          if (signal !== 0) handle.emitExit();
          if (signal === 0 && !present) { const error = new Error('absent'); error.code = 'ESRCH'; throw error; }
        } }) });
    // The fake PTY exercises POSIX termination, not installed-shell discovery.
    // A cmd launch spec is portable because spawn is fully injected here.
    const terminal = manager.create({ type: 'cmd', cwd: root });
    await assert.rejects(manager.stop(terminal.id), { code: 'PTY_TREE_EXIT_UNCONFIRMED' });
    assert.equal(manager.get(terminal.id).terminationUncertain, true);
    calls.length = 0;
    await assert.rejects(manager.forceStopForUpdate(terminal.id), { code: 'PTY_TREE_EXIT_UNCONFIRMED' });
    assert(calls.length > 0);
    assert(calls.every(([pid, signal]) => pid === -88001 && signal === 0));
    assert.equal(manager.get(terminal.id).terminationUncertain, true);
    present = false; calls.length = 0;
    await manager.stop(terminal.id);
    assert.deepEqual(calls, [[-88001, 0]]);
    assert.equal(manager.get(terminal.id).status, 'stopped');
    assert.equal(manager.get(terminal.id).terminationUncertain, false);
    await manager.close(terminal.id);
    // Neither persisted PIDs nor changed generations may authorize rechecking.
    const second = manager.create({ type: 'cmd', cwd: root });
    handle.__whiteboxExited = true;
    const internal = manager.sessions.get(second.id);
    internal.terminationUncertain = true;
    internal.updateTerminationContext = { session: internal, handle, pid: 88001, generation: internal.generation - 1 };
    calls.length = 0;
    assert.throws(() => manager.stop(second.id));
    assert.equal(calls.length, 0);
    delete internal.updateTerminationContext;
    assert.throws(() => manager.stop(second.id));
    assert.equal(calls.length, 0);
  });

  test('비동기 업데이트 종료 재검사에서도 과거 호스트 기록의 소유권 범위를 유지한다', async () => {
    const manager = new TerminalManager({ platform: 'darwin' });
    const stale = { id: 'old', terminationUncertain: true, options: {}, status: 'stopping' };
    const owned = { id: 'owned', createdInCurrentHost: true, process: {}, options: {}, status: 'running' };
    manager.sessions.set('old', stale); manager.sessions.set('owned', owned);
    let transitions = 0;
    manager.transition = async id => { assert.equal(id, 'owned'); transitions += 1; await Promise.resolve(); owned.process = null; };
    await manager.dispose({ preserveSessions: true, updateOnly: true });
    assert.equal(transitions, 1);
    assert.equal(manager.sessions.get('old'), stale);
    assert.equal(stale.terminationUncertain, true);
    await assert.rejects(manager.dispose({ preserveSessions: true }), /종료/);
  });

  test('참여 PTY가 없는 저장 그룹은 호스트 복구 실패와 무관하게 조회된다', async () => {
    let calls = 0;
    const groups = new TerminalGroups({ manager: () => ({ listFresh: async () => { calls += 1; throw new Error('host recovery blocked'); } }) });
    assert.deepEqual(await groups.list(), []);
    const group = await groups.create({ cwd: root, name: 'empty' });
    assert.deepEqual(await groups.list(), [group]);
    assert.equal(calls, 0);
    groups.groups[0].members.push({ creationId: 'member', terminalId: 'terminal' });
    await assert.rejects(groups.list(), /host recovery blocked/);
    assert.equal(calls, 1);
  });

  test('관리형 PTY 목록 실패에도 cmux 목록은 표시되며 반대쪽 실패도 독립적으로 처리된다', async () => {
    const source = fs.readFileSync(require.resolve('../../renderer/sidebar-terminals.js'), 'utf8');
    const refresh = source.slice(source.indexOf('  function refresh() {'), source.indexOf('  async function read('));
    for (const failed of ['managed', 'cmux']) {
      let inventory, updates = 0;
      const notice = { hidden: true, append() {} };
      const context = { refreshing: null, busy: false, resizing: null, inventoryEpoch: 0, notice,
        document: { createElement: () => ({}) }, window: { WhiteboxTerminalGroups: { updateInventory() { updates += 1; } } },
        api: { terminalGroups: async () => { if (failed === 'managed') throw new Error('managed blocked'); return [{ id: 'g', name: 'group', members: [], cwd: root }]; },
          cmuxList: async () => { if (failed === 'cmux') throw new Error('cmux blocked'); return { groups: [{ id: 'cmux:g' }], entries: [] }; } },
        applyInventory: async (cmux, managed) => { inventory = { cmux, managed }; } };
      vm.createContext(context); vm.runInContext(refresh, context); await context.refresh();
      if (failed === 'managed') { assert.equal(inventory.cmux.groups[0].id, 'cmux:g'); assert.equal(inventory.managed, undefined); assert.equal(updates, 0); assert.equal(notice.hidden, false); }
      else { assert.equal(inventory.managed[0].id, 'group:g'); assert.equal(inventory.cmux.groups.length, 0); assert.match(inventory.cmux.error, /cmux blocked/); assert.equal(updates, 1); }
    }
  });
}
module.exports = { registerPtyRecoveryTests };
