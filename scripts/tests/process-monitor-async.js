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
      worker.postMessage = () => setTimeout(() => { worker.emit('message', expected); worker.emit('exit', 0); }, 40);
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
  test('repeated process snapshots reuse one long-lived scan worker until disposed', async () => {
    let workers = 0, requests = 0, terminated = 0, unrefs = 0;
    const monitor = new ProcessMonitor({ scanTtlMs: 0, workerFactory: (_file, options) => {
      workers++; assert.equal(options.workerData.persistent, true);
      const worker = new EventEmitter();
      worker.unref = () => { unrefs++; };
      worker.postMessage = message => {
        assert.equal(message.type, 'scan'); requests++;
        setImmediate(() => worker.emit('message', { available: true, processes: [{ pid: requests }] }));
      };
      worker.terminate = () => { terminated++; return Promise.resolve(0); };
      return worker;
    } });
    for (let index = 1; index <= 5; index++) assert.equal((await monitor.scanAsync(true)).processes[0].pid, index);
    assert.equal(workers, 1, 'no new Worker per scan');
    assert.equal(requests, 5); assert.equal(unrefs, 1);
    monitor.dispose();
    assert.equal(terminated, 1);
    await monitor.scanAsync(true);
    assert.equal(workers, 2, 'a disposed worker is replaced on the next scan');
    monitor.dispose();
  });
  test('a stalled scan worker is retired and its late answer is ignored', async () => {
    const created = [];
    const monitor = new ProcessMonitor({ scanTtlMs: 0, workerFactory: () => {
      const worker = new EventEmitter();
      worker.postMessage = () => {};
      worker.terminate = () => { worker.terminated = true; return Promise.resolve(1); };
      created.push(worker); return worker;
    } });
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (run, delay, ...args) => realSetTimeout(run, delay === 20000 ? 1 : delay, ...args);
    let result;
    try { result = await monitor.scanAsync(true); } finally { global.setTimeout = realSetTimeout; }
    assert.equal(result.available, false); assert.match(result.error, /timed out/);
    assert.equal(created[0].terminated, true);
    created[0].emit('message', { available: true, processes: [{ pid: 9 }] });
    const next = monitor.scanAsync(true);
    assert.equal(created.length, 2);
    created[1].emit('message', { available: true, processes: [{ pid: 10 }] });
    assert.equal((await next).processes[0].pid, 10);
  });
  test('a failed process worker never returns its previous successful process evidence', async () => {
    let fail = false;
    const monitor = new ProcessMonitor({ workerFactory: () => {
      const worker = new EventEmitter();
      worker.postMessage = () => queueMicrotask(() => fail ? worker.emit('error', new Error('worker failed')) : worker.emit('message', { available: true, processes: [{ pid: 123 }] }));
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
      const worker = new EventEmitter(); worker.postMessage = () => queueMicrotask(() => worker.emit('exit', 0)); return worker;
    } });
    assert.equal((await monitor.scanAsync()).available, false);
  });
}
module.exports = { registerProcessMonitorAsyncTests };
