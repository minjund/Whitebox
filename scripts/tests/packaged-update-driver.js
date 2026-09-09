'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { waitForPackagedRenderer } = require('../packaged-update-button');

function registerPackagedUpdateDriverTests({ test }) {
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
