'use strict';

const assert = require('node:assert/strict');
const { TerminalActivity, providerActivity } = require('../src/terminalActivity');

(async () => {
  const completed = { available: true, state: 'completed', requestId: 'one' };
  const working = { available: true, state: 'working', requestId: 'two' };
  for (const provider of ['claude', 'codex']) {
    const prompt = provider === 'claude' ? '❯ ' : '› ';
    assert.equal(providerActivity({ text: prompt }), 'idle');
    assert.equal(providerActivity({ text: prompt + 'unsubmitted draft' }), 'idle', 'typing does not start work');
    assert.equal(providerActivity({ text: prompt, native: working }), 'working', 'native work survives silence or a visible prompt');
    assert.equal(providerActivity({ text: prompt, native: completed }), 'idle');
    assert.equal(providerActivity({ text: 'answer\n' + prompt, native: { ...completed, state: 'interrupted' } }), 'idle');
  }
  assert.equal(providerActivity({ text: '• Working (20s • esc to interrupt)\n› ' }), 'working');
  assert.equal(providerActivity({ text: '• Working (20s • esc to interrupt)\nWorked for 21s • 9:42 AM\n› draft' }), 'idle', 'old busy text cannot survive a finished turn');
  assert.equal(providerActivity({ text: '• Working (20s • esc to interrupt)\n› ', native: completed }), 'idle', 'exact native completion overrides old busy lines');
  assert.equal(providerActivity({ text: '• Working (20s • esc to interrupt)\n❯ ', native: { available: true, state: 'unconfirmed', inputWaiting: true } }), 'idle', 'native input waiting is distinct from successful task completion');
  assert.equal(providerActivity({ text: '❯ \n◯ general-purpose  Reading tests  9m 42s', native: completed }), 'working', 'active background agent still counts as work');
  assert.equal(providerActivity({ text: 'Would you like to make the following edits?\n› 1. Yes, proceed (y)\n  2. No (esc)', native: working }), 'waiting');
  assert.equal(providerActivity({ text: 'unrecognized interface' }), 'unknown');
  // Snapshot includes quiet work, job-control stops, provider wrappers, and
  // an unrelated process that must never affect this terminal's dot.
  let table = '100 1 100 100 Ss 00:10 /bin/zsh /bin/zsh\n999 1 999 999 R 00:10 /bin/yes /bin/yes';
  let native = working;
  const reader = new TerminalActivity({ platform: 'darwin', execute: async () => ({ stdout: table }), completion: { observe: async () => native }, now: () => 10000 });
  const member = { id: 'shell', creationId: 'epoch', pid: 100 };
  const frames = new Map([['shell', { creationId: 'epoch', at: 10000, text: '❯ ' }]]);
  const state = async () => (await reader.observe([member], frames)).get('shell').state;
  assert.equal(await state(), 'idle', 'live shell and unrelated CPU work are not terminal work');
  table = '100 1 100 101 Ss 00:10 /bin/zsh /bin/zsh\n101 100 101 101 S+ 00:05 /bin/sleep sleep 60';
  assert.equal(await state(), 'working', 'silent foreground command remains working');
  table = table.replace('S+', 'T+'); assert.equal(await state(), 'idle', 'job-control stop is yellow');
  table = '100 1 100 101 Ss 00:10 /bin/zsh /bin/zsh\n101 100 101 101 S+ 00:05 /usr/bin/claude claude';
  assert.equal(await state(), 'working');
  native = completed; assert.equal(await state(), 'idle', 'provider PID stays alive after its turn finishes');
  assert.equal((await reader.observe([member],frames)).get('shell').completed,true,'only a confirmed answer becomes a green completion dot');
  native={...completed,state:'interrupted'};assert.equal((await reader.observe([member],frames)).get('shell').completed,false,'interruption never claims answer completion');
  native=completed;
  assert.equal((await reader.observe([member], new Map())).get('shell').completed, true, 'unopened panels use exact native completion without allocating a terminal view');
  native = { ...completed, state: 'working', requestId: 'next-request', inputWaiting: false };
  assert.equal((await reader.observe([member], new Map())).get('shell').state, 'working');
  native = completed;
  frames.get('shell').creationId = 'replacement'; assert.equal(await state(), 'unknown', 'stale screen identity is rejected');
  frames.get('shell').creationId = 'epoch'; frames.get('shell').at = 0;
  assert.equal(await state(), 'unknown', 'stale screens cannot claim work or readiness');
  const failed = new TerminalActivity({ execute: async () => { throw new Error('probe unavailable'); } });
  assert.equal((await failed.observe([member], new Map())).get('shell').state, 'unknown');
  console.log('PASS terminal activity: provider work/idle/drafts/approval/background, quiet commands, stopped jobs, identity, stale screens and probe failures');
})().catch(error => { console.error(error); process.exitCode = 1; });
