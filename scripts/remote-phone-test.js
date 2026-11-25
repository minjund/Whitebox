'use strict';
// whitebox phone / whitebox connect: every panel over the real panel control
// socket, writes reach the terminal host like a keyboard, a live view streams
// the real terminal, and the size follows the last active viewer (herdr).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { TerminalCollaboration } = require('../src/terminalCollaboration');
const { TerminalViewers } = require('../src/terminalViewers');
const { request } = require('../bin/panel-control');
const remote = require('../bin/remote');

const wait = async (check, label) => {
  for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail(`timed out: ${label}`);
};

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-remote-'));
  const one = { id: 'terminal:one', creationId: 'one', pid: 201, status: 'running', outputSequence: 3, title: 'Terminal 1', cols: 120, rows: 40, replay: 'PAST_OUTPUT one\r\n$ ' };
  const two = { id: 'terminal:two', creationId: 'two', pid: 202, status: 'running', outputSequence: 5, title: 'Terminal 2', cols: 120, rows: 40, replay: '\x1b[?1049h\x1b[HTUI \x1b[32mgreen\x1b[0m' };
  const gone = { id: 'terminal:gone', creationId: 'gone', pid: null, status: 'stopped', title: 'Old' };
  const live = new Map([one, two, gone].map(item => [item.id, { ...item }]));
  const writes = [], sizes = [];
  let now = Date.now();
  const manager = { list: () => [...live.values()], get: id => live.get(id) ? { ...live.get(id) } : null, rawWriteDeliverySupported: () => true,
    write: async (id, data, options) => { writes.push({ id, data, options }); return { ok: true }; },
    resize: async (id, cols, rows) => { sizes.push([id, cols, rows]); Object.assign(live.get(id), { cols, rows }); return { ok: true, cols, rows }; } };
  const viewers = new TerminalViewers({ manager: () => manager });
  const changes = []; viewers.on('change', change => changes.push(change));
  // Output from the terminal host, as main.js forwards manager 'data'.
  const emitOutput = (id, data) => { const item = live.get(id); item.outputSequence += 1; item.replay += data; viewers.data({ id, data, outputSequence: item.outputSequence }); };
  const c = new TerminalCollaboration({ directory, now: () => now, monitor: { scan: () => ({ available: true, processes: [] }) }, viewers, manager: () => manager });
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

    assert.deepEqual(remote.wrap('가나다라', 5), ['가나', '다라']);
    assert.deepEqual(remote.wrap('abcdef', 4), ['abcd', 'ef']);

    // herdr's size rule: the most recently active viewer that types sets the size.
    writes.length = 0; sizes.length = 0;
    const sent = [];
    const phoneA = await viewers.attach(one.id, { cols: 40, rows: 16, send: frame => { sent.push(frame); return true; } });
    assert.deepEqual(sizes.at(-1), [one.id, 40, 16], 'attaching takes the size');
    assert.equal(sent[0].type, 'paint'); assert.match(sent[0].data, /PAST_OUTPUT one/u);
    assert.deepEqual(changes.at(-1), { id: one.id, phone: true, watching: 1, cols: 40, rows: 16 });
    await viewers.deskActive(one.id);
    assert.deepEqual(sizes.at(-1), [one.id, 120, 40], 'clicking or typing on the desktop takes it back');
    assert.equal(changes.at(-1).phone, false);
    await viewers.input(phoneA, 'x');
    assert.deepEqual(sizes.at(-1), [one.id, 40, 16], 'typing on the phone takes it again');
    assert.deepEqual(writes.at(-1), { id: one.id, data: 'x', options: undefined });
    const watched = [];
    const observer = await viewers.attach(one.id, { cols: 30, rows: 10, observe: true, send: frame => { watched.push(frame); return true; } });
    assert.deepEqual(sizes.at(-1), [one.id, 40, 16], 'an observer never resizes');
    assert.equal(await viewers.input(observer, 'no'), false, 'an observer never types');
    await viewers.resize(observer, 20, 8);
    assert.deepEqual(sizes.at(-1), [one.id, 40, 16]);
    await viewers.deskResize(one.id, 130, 40);
    assert.deepEqual(sizes.at(-1), [one.id, 130, 40], 'resizing the desktop pane makes it active');
    await viewers.resize(phoneA, 44, 18);
    assert.deepEqual(sizes.at(-1), [one.id, 44, 18], 'resizing the phone makes it active');
    emitOutput(one.id, 'LIVE_A');
    assert.deepEqual([sent.at(-1), watched.at(-1)].map(frame => frame.data), ['LIVE_A', 'LIVE_A']);
    await viewers.detach(phoneA); await viewers.detach(observer);
    assert.deepEqual(sizes.at(-1), [one.id, 130, 40], 'when the phones leave, the desktop size returns');
    assert.deepEqual(changes.at(-1), { id: one.id, phone: false, watching: 0, cols: 130, rows: 40 });
    assert.equal(viewers.watched(one.id), false);
    console.log('PASS remote: the size follows the last active viewer; observers never type or resize (herdr)');

    // A live view over the real control socket: screen first, then output.
    sizes.length = 0; writes.length = 0;
    const view = await remote.attach({ surface_id: two.id, cols: 50, rows: 20 }, { dir: directory });
    const frames2 = []; view.on('frame', frame => frames2.push(frame));
    await wait(() => frames2.length >= 1, 'first paint');
    assert.equal(view.result.panel, '패널 2');
    assert.equal(frames2[0].type, 'paint'); assert.match(frames2[0].data, /TUI \x1b\[32mgreen/u); assert.match(frames2[0].data, /\x1b\[\?1049h/u);
    assert.deepEqual(sizes.at(-1), [two.id, 50, 20]);
    emitOutput(two.id, 'STREAM_1');
    await wait(() => frames2.some(frame => frame.data === 'STREAM_1'), 'live output');
    assert(!frames2.some(frame => frame.type === 'output' && /TUI/u.test(frame.data)), 'output already in the paint is not sent twice');
    view.send({ type: 'input', data: '\x1b[A' }); view.send({ type: 'input', data: '한글\r' });
    await wait(() => writes.length === 2, 'keys');
    assert.deepEqual(writes.map(item => [item.id, item.data]), [[two.id, '\x1b[A'], [two.id, '한글\r']]);
    view.send({ type: 'resize', cols: 60, rows: 22 });
    await wait(() => sizes.at(-1)?.[1] === 60, 'resize');
    view.close();
    await wait(() => sizes.at(-1)?.[1] === 120, 'size back after detach');
    await assert.rejects(remote.attach({ surface_id: gone.id, cols: 40, rows: 10 }, { dir: directory }), /running terminal/);
    console.log('PASS remote: a live view streams the screen and output, sends keys and size, and gives the size back');

    // The same live view over `whitebox connect` JSON-RPC (for a phone app).
    const rpcIn = new PassThrough(), rpcOut = new PassThrough(); let rpcText = '';
    rpcOut.on('data', chunk => { rpcText += chunk; });
    const rpc = remote.connect({ input: rpcIn, output: rpcOut, call, open: params => remote.attach(params, { dir: directory }) });
    const rpcFrames = () => rpcText.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    rpcIn.write('{"jsonrpc":"2.0","id":1,"method":"terminal.attach","params":{"terminal":"terminal:one","cols":30,"rows":12,"observe":true}}\n');
    await wait(() => rpcFrames().some(frame => frame.method === 'terminal.output' && frame.params.paint), 'rpc paint');
    assert.equal(rpcFrames()[0].result.channel, 1);
    assert.deepEqual(sizes.at(-1), [two.id, 120, 40], 'an observing app does not resize');
    emitOutput(one.id, 'RPC_LIVE');
    await wait(() => rpcFrames().some(frame => frame.params?.data === 'RPC_LIVE'), 'rpc output');
    rpcIn.write('{"jsonrpc":"2.0","id":2,"method":"terminal.detach","params":{"channel":1}}\n');
    rpcIn.end(); await rpc;
    assert.equal(rpcFrames().find(frame => frame.id === 2).result.ok, true);
    console.log('PASS remote: whitebox connect attaches, streams and detaches over JSON-RPC');

    // The phone screen: list, open the real terminal live, type, Ctrl+\ back.
    writes.length = 0;
    const keys = new PassThrough(), tty = Object.assign(new PassThrough(), { columns: 40, rows: 16 }); let shown = '';
    tty.on('data', chunk => { shown += chunk; });
    const last = () => shown.slice(shown.lastIndexOf('\x1b[2J') + 4);
    const app = remote.phone({ input: keys, output: tty, call, open: params => remote.attach(params, { dir: directory }), refreshMs: 20 });
    await wait(() => last().includes('패널 2'), 'list');
    assert.match(last(), / 1 · 상태 모름 · Terminal 1/u); assert.match(last(), / 2 · 상태 모름 · Terminal 2/u);
    assert(!last().includes('Old'), 'stopped terminals are not listed');
    for (const row of last().split('\n').filter(Boolean)) assert(remote.wrap(row.replace(/^> /u, ''), 40).length === 1, `fits 40 columns: ${row}`);
    keys.write('1\n');
    await wait(() => shown.includes('PAST_OUTPUT one'), 'live paint');
    assert.deepEqual(sizes.at(-1), [one.id, 40, 16], 'the phone terminal takes its own size');
    emitOutput(one.id, 'PHONE_LIVE');
    await wait(() => shown.includes('PHONE_LIVE'), 'phone output');
    keys.write('ls\r'); keys.write(Buffer.from([0x1b, 0x5b, 0x42]));
    await wait(() => writes.length === 2, 'phone keys');
    assert.deepEqual(writes.map(item => item.data), ['ls\r', '\x1b[B']);
    keys.write(Buffer.from([0x1c]));
    await wait(() => last().includes('번호: 열기'), 'back to list');
    await wait(() => sizes.at(-1)?.[1] === 130, 'desktop size after leaving');
    keys.write('q\n'); await app;
    console.log('PASS remote: the phone screen lists, opens the live terminal, types and goes back with Ctrl+\\');
  } finally {
    await c.control?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
