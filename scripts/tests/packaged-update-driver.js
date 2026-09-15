'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { waitForPackagedRenderer } = require('../packaged-update-button');
const { probeWindowsProcessIds, waitForOwnedProcessIdsExit } = require('../windows-process-exit-check');

function registerPackagedUpdateDriverTests({ test }) {
  test('owned process cleanup requires two consecutive observed absences after termination', async () => {
    const observations = [[908], [], [908], [], []];
    let probes = 0;
    await waitForOwnedProcessIdsExit([908], {
      pollMs: 1,
      probe: async pids => {
        assert.deepEqual(pids, [908]);
        probes += 1;
        return observations.shift();
      },
    });
    assert.equal(probes, 5, 'A disappearing/reappearing PID must reset absence evidence');
    const failure = new Error('CIM unavailable');
    await assert.rejects(waitForOwnedProcessIdsExit([908], { probe: () => { throw failure; } }), error => error === failure);
    await assert.rejects(waitForOwnedProcessIdsExit([908], { timeoutMs: 5, pollMs: 1, probe: () => [908] }), /Timed out/);
    await assert.rejects(waitForOwnedProcessIdsExit([908], { probe: () => [909] }), /unrequested PID/);
    await assert.rejects(waitForOwnedProcessIdsExit([908], { probe: () => ['908'] }), /integer PIDs/);
  });

  test('Windows exit probes reject failed, malformed, duplicate, and unrelated PID evidence', () => {
    const probe = result => probeWindowsProcessIds([908], { spawn: (command, args, options) => {
      assert.equal(command, 'powershell.exe');
      assert(args.at(-1).includes("-Filter 'ProcessId = 908' -ErrorAction Stop"));
      assert.equal(options.windowsHide, true);
      return result;
    } });
    assert.deepEqual(probe({ status: 0, stdout: '[908]' }), [908]);
    assert.deepEqual(probe({ status: 0, stdout: '[]' }), []);
    assert.throws(() => probe({ status: 1, stdout: '[]', stderr: 'CIM denied' }), /CIM denied/);
    const failure = new Error('Process query timed out');
    assert.throws(() => probe({ error: failure, status: null, stdout: '[]' }), error => error === failure);
    for (const stdout of ['', '{}', 'null', '["908"]', '[908,908]', '[909]']) {
      assert.throws(() => probe({ status: 0, stdout }), undefined, stdout);
    }
    assert.throws(() => probeWindowsProcessIds([0]), /integer PIDs/);
  });

  test('both Windows drivers await owned PID exit before strict path verification and propagate cleanup failures', async () => {
    for (const filename of ['windows-v173-update-integration.js', 'windows-legacy-update-bridge-integration.js']) {
      const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
      const start = source.indexOf('async function stopProcessesUnderDirectory(');
      assert(start >= 0, filename);
      const definition = source.slice(start, source.indexOf('\nfunction perUserUninstallRegistryEntries', start));
      let scan = 0;
      let exited = false;
      const events = [];
      const context = {
        runningProcessesUnderDirectory() {
          events.push('scan');
          if (++scan === 1) return [{ pid: 908, executablePath: 'installed/Whitebox.exe' }];
          if (!exited) throw new Error('Executable path was unavailable for guarded PID 908');
          return [];
        },
        stopProcessTree(pid) { assert.equal(pid, 908); events.push('stop'); },
        async waitForOwnedProcessIdsExit(pids) {
          assert.deepEqual(Array.from(pids), [908]);
          events.push('wait');
          await Promise.resolve();
          exited = true;
        },
      };
      const stop = vm.runInNewContext(`(${definition})`, context);
      await stop('installed', 'Installed-path');
      assert.deepEqual(events, ['scan', 'stop', 'wait', 'scan'], filename);

      const failed = new Error('Owned PID did not exit');
      scan = 0;
      context.waitForOwnedProcessIdsExit = async () => { throw failed; };
      await assert.rejects(stop('installed', 'Installed-path'), error => error === failed);
      assert.equal(scan, 1, 'A failed exit check must never advance to a clean path scan');

      scan = 0;
      const ambiguous = new Error('Executable path was unavailable for guarded PID 909');
      context.waitForOwnedProcessIdsExit = async () => {};
      context.runningProcessesUnderDirectory = () => {
        if (++scan === 1) return [{ pid: 908, executablePath: 'installed/Whitebox.exe' }];
        throw ambiguous;
      };
      await assert.rejects(stop('installed', 'Installed-path'), error => error === ambiguous);
    }
  });

  test('packaged renderer readiness uses synchronous reads and never accepts debugger failure or timeout', async () => {
    let probes = 0;
    let expressionUnderTest;
    await waitForPackagedRenderer({ evaluate: async (expression, options) => {
      expressionUnderTest = expression;
      assert.equal(options.awaitPromise, false, 'The bootstrap context must not retain an Inspector awaitPromise');
      assert.match(expression, /^Boolean\(typeof process !== 'undefined'/);
      return ++probes === 3;
    } }, { pollMs: 1 });
    assert.equal(probes, 3);
    for (const context of [{}, { process: {} }, { process: { mainModule: {
      loaded: false, require() { throw new Error('Electron lazy exports are still initializing'); },
    } } }]) {
      assert.equal(vm.runInNewContext(expressionUnderTest, context), false);
    }
    const windows = [];
    const readyContext = { process: { mainModule: { loaded: true, require(name) {
      assert.equal(name, 'electron');
      return { BrowserWindow: { getAllWindows: () => windows } };
    } } } };
    assert.equal(vm.runInNewContext(expressionUnderTest, readyContext), false);
    windows.push({ webContents: { getURL: () => 'file:///app/splash.html' } });
    assert.equal(vm.runInNewContext(expressionUnderTest, readyContext), false);
    windows.push({ webContents: { getURL: () => 'file:///app/renderer/index.html' } });
    assert.equal(vm.runInNewContext(expressionUnderTest, readyContext), true);
    const failure = new Error('Promise was collected');
    let failedProbes = 0;
    await assert.rejects(waitForPackagedRenderer({ evaluate: async () => {
      failedProbes += 1;
      throw failure;
    } }, { pollMs: 1 }), error => error === failure);
    assert.equal(failedProbes, 1, 'A failed debugger evaluation is not retried or counted as readiness');
    await assert.rejects(waitForPackagedRenderer({ evaluate: async () => false }, { timeoutMs: 0, pollMs: 1 }), /Packaged renderer did not open/);
  });
}

module.exports = { registerPackagedUpdateDriverTests };
