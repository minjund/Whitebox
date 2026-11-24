'use strict';
// whitebox phone / whitebox connect: every panel over the real panel control
// socket, writes reach the terminal host like a keyboard, and the phone screen
// fits a narrow SSH terminal.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { TerminalCollaboration } = require('../src/terminalCollaboration');
const { request } = require('../bin/panel-control');
const remote = require('../bin/remote');

const wait = async (check, label) => {
  for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail(`timed out: ${label}`);
};

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-remote-'));
  const one = { id: 'terminal:one', creationId: 'one', pid: 201, status: 'running', outputSequence: 3, title: 'Terminal 1' };
  const two = { id: 'terminal:two', creationId: 'two', pid: 202, status: 'running', outputSequence: 5, title: 'Terminal 2' };
  const gone = { id: 'terminal:gone', creationId: 'gone', pid: null, status: 'stopped', title: 'Old' };
  const live = new Map([one, two, gone].map(item => [item.id, { ...item }]));
  const writes = [];
  let now = Date.now();
  const c = new TerminalCollaboration({ directory, now: () => now, monitor: { scan: () => ({ available: true, processes: [] }) },
    manager: () => ({ list: () => [...live.values()], get: id => live.get(id), rawWriteDeliverySupported: () => true,
      write: async (id, data, options) => { writes.push({ id, data, options }); return { ok: true }; } }) });
  // Like a real screen: the rows below the cursor are blank.
  const screenOne = ['$ npm test', ...Array.from({ length: 60 }, (_, i) => `line ${i + 1}`), '한글이 들어간 아주 긴 줄입니다 한글이 들어간 아주 긴 줄입니다 끝', '$ ', ...Array(30).fill('')].join('\n');
  const payload = () => ({
    groups: [{ id: 'panel-a', name: '패널 1', cwd: directory, members: [one, gone] }, { id: 'panel-b', name: '패널 2', cwd: directory, members: [two] }],
    frames: [{ id: one.id, creationId: one.creationId, outputSequence: 3, text: screenOne, bracketedPaste: false },
      { id: two.id, creationId: two.creationId, outputSequence: 5, text: 'two$ ', bracketedPaste: true }],
  });
  const call = (method, params) => request(method, params, { directory });
  try {
    await c.sync(payload());

    // Every panel, without a source terminal.
    const list = await call('remote.list', {});
    assert.deepEqual(list.panels.map(panel => panel.name), ['패널 1', '패널 2']);
    assert.deepEqual(list.panels[0].terminals.map(item => [item.id, item.running]), [[one.id, true], [gone.id, false]]);
    console.log('PASS remote: lists the terminals of every panel without a source terminal');

    const screen = await call('remote.read', { surface_id: two.id, lines: 10 });
    assert.equal(screen.text, 'two$'); assert.equal(screen.panel, '패널 2'); assert.equal(screen.current, true);
    assert.equal((await call('remote.read', { surface_id: one.id, lines: 2 })).text, '한글이 들어간 아주 긴 줄입니다 한글이 들어간 아주 긴 줄입니다 끝\n$', 'the last written lines, not the blank rows below the cursor');
    await assert.rejects(call('remote.read', { surface_id: gone.id }), /running terminal/);
    console.log('PASS remote: reads a terminal screen in another panel');

    await call('remote.send', { surface_id: one.id, text: 'ls -la', submit: true });
    await call('remote.send', { surface_id: two.id, text: 'echo a\necho b', submit: true });
    await call('remote.send', { surface_id: two.id, text: 'draft', submit: false });
    await call('remote.key', { surface_id: two.id, key: 'esc' });
    await call('remote.key', { surface_id: two.id, key: '1' });
    assert.deepEqual(writes.map(item => [item.id, item.data]), [
      [one.id, 'ls -la\r'], [two.id, '\x1b[200~echo a\necho b\x1b[201~\r'], [two.id, '\x1b[200~draft\x1b[201~'], [two.id, '\x1b'], [two.id, '1']]);
    assert(writes.every(item => /^remote:[0-9a-f-]{36}$/u.test(item.options.deliveryId)));
    await assert.rejects(call('remote.send', { surface_id: one.id, text: 'a\nb' }), /one line/);
    await assert.rejects(call('remote.send', { surface_id: one.id, text: 'bad\x1b[31m' }), /Invalid terminal text/);
    await assert.rejects(call('remote.key', { surface_id: one.id, key: 'f13' }), /Unknown key/);
    live.get(one.id).pid = 999;
    await assert.rejects(call('remote.send', { surface_id: one.id, text: 'x' }), /session changed/);
    live.get(one.id).pid = one.pid;
    assert.equal(writes.length, 5, 'a rejected request writes nothing');
    console.log('PASS remote: text, paste and keys reach the terminal like a keyboard; bad input writes nothing');

    // JSON-RPC over stdio, as `ssh mac whitebox connect` carries it.
    const input = new PassThrough(), output = new PassThrough(); let out = '';
    output.on('data', chunk => { out += chunk; });
    const session = remote.connect({ input, output, call, version: '9.9.9' });
    input.write('{"jsonrpc":"2.0","id":1,"method":"hello"}\n');
    input.write('{"jsonrpc":"2.0","id":2,"method":"terminal.list","params":{}}\n');
    input.write('{"jsonrpc":"2.0","id":3,"method":"terminal.read","params":{"surface_id":"terminal:two"}}\n');
    input.write('{"jsonrpc":"2.0","id":4,"method":"terminal.kill"}\n');
    input.write('not json\n');
    input.write('{"jsonrpc":"2.0","id":5,"method":"terminal.read","params":{"surface_id":"nope"}}\n');
    input.end(); await session;
    const frames = out.trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(frames.map(frame => frame.id), [1, 2, 3, 4, null, 5]);
    assert.equal(frames[0].result.protocol, remote.PROTOCOL); assert.equal(frames[0].result.version, '9.9.9');
    assert.equal(frames[1].result.panels.length, 2); assert.equal(frames[2].result.text, 'two$');
    assert.equal(frames[3].error.code, -32601); assert.equal(frames[4].error.code, -32700); assert.equal(frames[5].error.code, -32000);
    console.log('PASS remote: whitebox connect answers JSON-RPC 2.0 lines in order');

    assert.throws(() => remote.refuseInsideWhitebox({ WHITEBOX_SURFACE_ID: 'terminal:one' }), /밖/);
    remote.refuseInsideWhitebox({});
    console.log('PASS remote: refuses to run inside a Whitebox terminal');

    assert.deepEqual(remote.parseLine(''), { key: 'enter' });
    assert.deepEqual(remote.parseLine(':1'), { key: '1' });
    assert.deepEqual(remote.parseLine(':c'), { key: 'ctrl-c' });
    assert.deepEqual(remote.parseLine('/clear'), { text: '/clear', submit: true });
    assert.deepEqual(remote.parseLine('::x'), { text: ':x', submit: true });
    assert.deepEqual(remote.parseLine(':k y'), { text: 'y', submit: false });
    assert.deepEqual(remote.wrap('가나다라', 5), ['가나', '다라']);
    assert.deepEqual(remote.wrap('abcdef', 4), ['abcd', 'ef']);

    // The phone screen: a 40-column SSH terminal.
    writes.length = 0;
    const keys = new PassThrough(), tty = Object.assign(new PassThrough(), { columns: 40, rows: 16 }); let shown = '';
    tty.on('data', chunk => { shown += chunk; });
    const last = () => shown.slice(shown.lastIndexOf('\x1b[2J') + 4);
    const app = remote.phone({ input: keys, output: tty, call, refreshMs: 20 });
    await wait(() => last().includes('패널 2'), 'list');
    assert.match(last(), / 1 · 상태 모름 · Terminal 1/u); assert.match(last(), / 2 · 상태 모름 · Terminal 2/u);
    assert(!last().includes('Old'), 'stopped terminals are not listed');
    keys.write('1\n');
    await wait(() => last().includes('line 60'), 'terminal screen');
    const rows = last().split('\n').filter(Boolean);
    assert(rows.length <= 16, `fits 16 rows: ${rows.length}`);
    for (const row of rows) assert(remote.wrap(row.replace(/^> /u, ''), 40).length === 1, `fits 40 columns: ${row}`);
    keys.write('hello\n'); await wait(() => writes.length === 1, 'send');
    keys.write(':esc\n'); await wait(() => writes.length === 2, 'esc');
    keys.write('\n'); await wait(() => writes.length === 3, 'enter');
    assert.deepEqual(writes.map(item => item.data), ['hello\r', '\x1b', '\r']);
    keys.write(':b\n'); await wait(() => last().includes('번호: 열기'), 'back to list');
    keys.write('q\n'); await app;
    console.log('PASS remote: the phone screen lists, opens, types and goes back within 40 columns');
  } finally {
    await c.control?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
