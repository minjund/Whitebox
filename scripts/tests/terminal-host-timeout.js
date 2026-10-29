'use strict';
const assert = require('node:assert/strict');
const { TerminalHostClient } = require('../../src/terminalHost');

function registerTerminalHostTimeoutTests({ test }) {
  test('an open but unresponsive host socket is discarded without replaying a timed-out request', async () => {
    const client = new TerminalHostClient({ discoveryFile: '/unused-timeout-fixture', requestTimeoutMs: 10 });
    let sent = 0, destroyed = 0, reconnects = 0;
    const socket = { destroyed: false, write() { sent++; return true; }, destroy() { this.destroyed = true; destroyed++; } };
    client.connected = true; client.socket = socket;
    client.scheduleReconnect = () => { reconnects++; };
    await assert.rejects(client.request('write', 'terminal-id', 'once'), error => error.code === 'TERMINAL_HOST_REQUEST_TIMEOUT');
    assert.equal(sent, 1, 'unknown input must never be automatically replayed');
    assert.equal(destroyed, 1);
    assert.equal(reconnects, 1);
    assert.equal(client.connected, false);
    assert.equal(client.pending.size, 0);
    const replacement = { destroyed: false, write(frame) {
      const request = JSON.parse(frame);
      queueMicrotask(() => client.consume(Buffer.from(JSON.stringify({ type: 'response', requestId: request.requestId, ok: true, result: [] }) + '\n'), replacement));
      return true;
    } };
    client.connect = async () => { client.socket = replacement; client.connected = true; };
    assert.deepEqual(await client.listFresh(), []);
    assert.equal(sent, 1);
  });
  test('a late timeout from an old socket cannot disconnect its replacement', async () => {
    const client = new TerminalHostClient({ discoveryFile: '/unused-timeout-fixture', requestTimeoutMs: 10 });
    const old = { destroyed: false, write() { return true; }, destroy() { throw new Error('old timeout destroyed a socket'); } };
    const replacement = { destroyed: false };
    client.connected = true; client.socket = old;
    const pending = client.request('get', 'terminal-id');
    client.socket = replacement;
    await assert.rejects(pending, error => error.code === 'TERMINAL_HOST_REQUEST_TIMEOUT');
    assert.equal(client.socket, replacement);
    assert.equal(client.connected, true);
  });
}
module.exports = { registerTerminalHostTimeoutTests };
