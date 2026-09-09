'use strict';
const assert = require('node:assert/strict');
const { waitForPackagedRenderer } = require('../packaged-update-button');

function registerPackagedUpdateDriverTests({ test }) {
  test('packaged renderer readiness uses synchronous reads and never accepts debugger failure or timeout', async () => {
    let probes = 0;
    await waitForPackagedRenderer({ evaluate: async (expression, options) => {
      assert.equal(options.awaitPromise, false, 'The bootstrap context must not retain an Inspector awaitPromise');
      assert.match(expression, /^Boolean\(typeof process !== 'undefined'/);
      return ++probes === 3;
    } }, { pollMs: 1 });
    assert.equal(probes, 3);
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
