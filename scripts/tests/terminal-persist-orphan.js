'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TerminalManager } = require('../../src/terminalManager');
const { startProfileOrphanWatch } = require('../../src/terminalHostDaemon');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function fakePtyModule() {
  let pid = 61000;
  const handles = [];
  return {
    handles,
    spawn() {
      const handle = { pid: ++pid, dataListeners: [], exitListeners: [], __whiteboxExited: false,
        onData(fn) { this.dataListeners.push(fn); return { dispose() {} }; },
        onExit(fn) { this.exitListeners.push(fn); return { dispose() {} }; },
        emit(text) { for (const fn of [...this.dataListeners]) fn(text); },
        write() {}, resize() {} };
      handles.push(handle);
      return handle;
    },
  };
}

function countingFileSystem() {
  const writes = [];
  return { writes, fileSystem: { ...fs, writeFileSync(file, ...args) {
    writes.push(file);
    return fs.writeFileSync(file, ...args);
  } } };
}

function storedSession(file, id) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).sessions.find(item => item.id === id);
}

function registerTerminalPersistOrphanTests({ test, temp, root }) {
  test('스트리밍 출력만 바뀌면 저장을 길게 모으고, 메타데이터·종료·호스트 종료는 즉시 최신 출력까지 저장한다', async () => {
    const directory = fs.mkdtempSync(path.join(temp, 'persist-coalesce-'));
    const storeFile = path.join(directory, 'terminal-sessions.json');
    const pty = fakePtyModule();
    const { writes, fileSystem } = countingFileSystem();
    const manager = new TerminalManager({ platform: 'win32', storeFile, fileSystem, ptyModule: pty,
      persistDelayMs: 20, replayPersistDelayMs: 400,
      killTree: handle => { handle.__whiteboxExited = true; for (const fn of [...handle.exitListeners]) fn({ exitCode: 0 }); } });
    try {
      const terminal = manager.create({ type: 'cmd', cwd: root, creationId: 'workspace:persist-coalesce' });
      const handle = pty.handles.at(-1);
      writes.length = 0;
      // A full-screen TUI redraw stream: many chunks across several former
      // 1-second persistence windows must not rewrite the store each time.
      for (let index = 0; index < 25; index += 1) {
        handle.emit(`frame-${index}\r\n`);
        await pause(10);
      }
      assert.equal(writes.length, 0, 'replay-only output is not persisted at the metadata cadence');
      await pause(450);
      assert.equal(writes.length, 1, 'one coalesced replay checkpoint');
      assert.match(storedSession(storeFile, terminal.id).replay, /frame-24/);

      // A metadata change pulls a pending replay checkpoint forward.
      writes.length = 0;
      handle.emit('after-checkpoint\r\n');
      manager.resize(terminal.id, 120, 40);
      await pause(80);
      assert.equal(writes.length, 1, 'metadata change persists on the short deadline');
      const resized = storedSession(storeFile, terminal.id);
      assert.match(resized.replay, /after-checkpoint/, 'the metadata write carries the latest replay');
      await pause(450);
      assert.equal(writes.length, 1, 'the earlier replay deadline was absorbed, not repeated');

      // Host shutdown flushes unsaved replay synchronously with its state.
      handle.emit('before-shutdown\r\n');
      writes.length = 0;
      await manager.dispose({ preserveSessions: true });
      assert(writes.length >= 1, 'host shutdown writes the store');
      assert.match(storedSession(storeFile, terminal.id).replay, /before-shutdown/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('메타데이터 변경 전이(중지)는 타이머 없이 동기 저장된다', async () => {
    const directory = fs.mkdtempSync(path.join(temp, 'persist-sync-'));
    const storeFile = path.join(directory, 'terminal-sessions.json');
    const pty = fakePtyModule();
    const manager = new TerminalManager({ platform: 'win32', storeFile, ptyModule: pty,
      persistDelayMs: 60_000, replayPersistDelayMs: 60_000,
      killTree: handle => { handle.__whiteboxExited = true; for (const fn of [...handle.exitListeners]) fn({ exitCode: 0 }); } });
    try {
      const terminal = manager.create({ type: 'cmd', cwd: root, creationId: 'workspace:persist-sync' });
      assert.equal(storedSession(storeFile, terminal.id).status, 'running', 'creation is durable immediately');
      pty.handles.at(-1).emit('last words\r\n');
      const stopped = await manager.stop(terminal.id);
      assert.equal(stopped.status, 'stopped');
      const saved = storedSession(storeFile, terminal.id);
      assert.equal(saved.status, 'stopped', 'stop is durable without waiting for a timer');
      assert.match(saved.replay, /last words/);
    } finally {
      await manager.dispose({ preserveSessions: true });
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('끝난 명령창의 출력 기록은 메모리와 저장 파일 모두에서 더 짧게 줄인다', async () => {
    const directory = fs.mkdtempSync(path.join(temp, 'persist-settled-'));
    const storeFile = path.join(directory, 'terminal-sessions.json');
    const pty = fakePtyModule();
    const manager = new TerminalManager({ platform: 'win32', storeFile, ptyModule: pty,
      killTree: handle => { handle.__whiteboxExited = true; for (const fn of [...handle.exitListeners]) fn({ exitCode: 0 }); } });
    try {
      const running = manager.create({ type: 'cmd', cwd: root, creationId: 'workspace:settled-running' });
      const stopped = manager.create({ type: 'cmd', cwd: root, creationId: 'workspace:settled-stopped' });
      const big = `${'x'.repeat(1024 * 1024)}TAIL-MARKER`;
      pty.handles[0].emit(big);
      pty.handles[1].emit(big);
      await manager.stop(stopped.id);
      assert(manager.persistNow());
      const runningReplay = manager.get(running.id, true).replay;
      const stoppedReplay = manager.get(stopped.id, true).replay;
      assert.equal(runningReplay.length, big.length, 'a running session keeps its full scrollback');
      assert(stoppedReplay.length <= 256 * 1024, 'a stopped session keeps a bounded scrollback in memory');
      assert(stoppedReplay.endsWith('TAIL-MARKER'));
      const saved = storedSession(storeFile, stopped.id).replay;
      assert(saved.length <= 256 * 1024 && saved.endsWith('TAIL-MARKER'), 'and in the store');
    } finally {
      await manager.dispose({ preserveSessions: true });
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('프로필 폴더가 사라지고 연결된 앱이 없으면 호스트는 스스로 종료하고, 살아 있는 프로필은 건드리지 않는다', async () => {
    const profile = fs.mkdtempSync(path.join(temp, 'orphan-profile-'));
    let tick = null;
    let cleared = false;
    let clients = 0;
    let idleChecks = 0;
    let orphaned = 0;
    const watch = startProfileOrphanWatch({
      profileDirectory: profile,
      host: { connectedClientCount: () => clients, scheduleShutdownIfIdle: () => { idleChecks += 1; } },
      onOrphaned: () => { orphaned += 1; },
      intervalMs: 60_000,
      setIntervalFn: fn => { tick = fn; return { unref() {} }; },
      clearIntervalFn: () => { cleared = true; },
    });
    tick();
    assert.equal(orphaned, 0, 'existing profile is never orphaned');
    assert.equal(idleChecks, 1, 'periodic idle-shutdown backstop');
    fs.rmSync(profile, { recursive: true, force: true });
    clients = 1;
    tick(); tick(); tick();
    assert.equal(orphaned, 0, 'a connected app keeps the host even without its profile');
    clients = 0;
    tick();
    assert.equal(orphaned, 0, 'one miss is not enough');
    fs.mkdirSync(profile);
    tick();
    fs.rmSync(profile, { recursive: true, force: true });
    tick();
    assert.equal(orphaned, 0, 'a reappearing profile resets the confirmation');
    tick();
    assert.equal(orphaned, 1);
    assert.equal(cleared, true, 'the watch stops itself');
    tick();
    assert.equal(orphaned, 1, 'orphan shutdown runs once');
    watch.stop();

    // The daemon's orphan path: terminate PTYs without recreating the profile.
    const deleted = fs.mkdtempSync(path.join(temp, 'orphan-store-'));
    const pty = fakePtyModule();
    const killed = [];
    const manager = new TerminalManager({ platform: 'win32', storeFile: path.join(deleted, 'terminal-sessions.json'), ptyModule: pty,
      killTree: handle => { killed.push(handle.pid); handle.__whiteboxExited = true; for (const fn of [...handle.exitListeners]) fn({ exitCode: 0 }); } });
    manager.create({ type: 'cmd', cwd: root, creationId: 'workspace:orphan-store' });
    fs.rmSync(deleted, { recursive: true, force: true });
    manager.storeFile = '';
    await manager.dispose({ preserveSessions: true });
    assert.deepEqual(killed, [pty.handles[0].pid], 'live PTY of the orphaned host is terminated');
    assert.equal(fs.existsSync(deleted), false, 'deleted profile is not recreated');
  });
}

module.exports = { registerTerminalPersistOrphanTests };
