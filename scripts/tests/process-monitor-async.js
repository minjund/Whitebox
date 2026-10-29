'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ProcessMonitor } = require('../../src/processMonitor');
function registerProcessMonitorAsyncTests({ test }) {
  test('process snapshots coalesce in a worker while main-loop timers remain responsive', async () => {
    let workers = 0, ticks = 0;
    const expected = { available: true, processes: [], activityRows: [], generatedAt: new Date().toISOString() };
    const monitor = new ProcessMonitor({ workerFactory: (_file, options) => {
      workers++; assert.equal(options.workerData.whiteboxProcessScan, true);
      const worker = new EventEmitter();
      setTimeout(() => { worker.emit('message', expected); worker.emit('exit', 0); }, 40);
      return worker;
    } });
    const timer = setInterval(() => ticks++, 2);
    const [first, second] = await Promise.all([monitor.scanAsync(), monitor.scanAsync()]);
    clearInterval(timer);
    assert.equal(workers, 1); assert(ticks > 0);
    assert.equal(first, expected); assert.equal(second, expected);
    assert.equal(await monitor.scanAsync(), expected); assert.equal(workers, 1);
    await monitor.scanAsync(true); assert.equal(workers, 2);
  });
  test('a failed process worker never returns its previous successful process evidence', async () => {
    let fail = false;
    const monitor = new ProcessMonitor({ workerFactory: () => {
      const worker = new EventEmitter();
      queueMicrotask(() => fail ? worker.emit('error', new Error('worker failed')) : worker.emit('message', { available: true, processes: [{ pid: 123 }] }));
      return worker;
    } });
    assert.equal((await monitor.scanAsync()).available, true);
    fail = true;
    const result = await monitor.scanAsync(true);
    assert.equal(result.available, false); assert.deepEqual(result.processes, []);
    assert.match(result.error, /worker failed/);
  });
  test('closing a terminal during asynchronous process discovery cannot revive its review', async () => {
    const { TerminalReview } = require('../../src/terminalReview');
    const session = { id: 'terminal:closing', creationId: 'epoch', pid: 100, status: 'running' };
    let release;
    const service = new TerminalReview({ manager: () => ({ get: async () => session, list: () => [session] }),
      monitor: { scanAsync: () => new Promise(resolve => { release = resolve; }) }, runner: {} });
    const task = service.capture({ id: session.id, creationId: session.creationId });
    await new Promise(resolve => setImmediate(resolve));
    assert(release);
    service.forget(session.id);
    release({ available: true, processes: [] });
    assert.equal((await task).state, 'unbound');
    assert.equal(service.entries.has(session.id), false);
  });
  test('a process worker exiting without a result fails closed', async () => {
    const monitor = new ProcessMonitor({ workerFactory: () => {
      const worker = new EventEmitter(); queueMicrotask(() => worker.emit('exit', 0)); return worker;
    } });
    assert.equal((await monitor.scanAsync()).available, false);
  });
}
module.exports = { registerProcessMonitorAsyncTests };
