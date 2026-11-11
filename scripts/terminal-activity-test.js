'use strict';

const assert = require('node:assert/strict');
const { TerminalActivity, providerActivity } = require('../src/terminalActivity');

(async () => {
  const completed = { available: true, state: 'completed', requestId: 'one' };
  const working = { available: true, state: 'working', requestId: 'two' };
  const trust = "› 1. Trust and continue\n  2. Trust all and continue\n  3. Continue without trusting (hooks won't run)";
  assert.equal(providerActivity({ text: trust }), 'waiting', 'startup trust menu needs a terminal response, not AI work');
  assert.equal(providerActivity({ text: trust + '\n› ', native: completed }), 'idle', 'an old trust menu cannot survive the next input prompt');
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
  // Gemini CLI and Grok Build: their own prompt, braille running row, turn
  // footer and approval dialogs (screens built from each CLI's source strings).
  const geminiBox = '────────\n >   Type your message or @path/to/file\n────────\n~/p  no sandbox  gemini-2.5-pro';
  assert.equal(providerActivity({ text: `> fix\n✦ 확인 중입니다.\n⠋ Thinking... (esc to cancel, 4s)\n${geminiBox}`, provider: 'gemini' }), 'working');
  assert.equal(providerActivity({ text: `> fix\n✦ 고쳤습니다.\n${geminiBox}`, provider: 'gemini' }), 'idle', 'Gemini has no footer: no running row and its input row is idle');
  assert.equal(providerActivity({ text: '│ Allow execution of [npm]?   │\n│ ● 1. Allow once              │\n│   2. Allow for this session  │', provider: 'gemini' }), 'waiting');
  const grokBox = '╭──────╮\n│ ❯    │\n╰──────╯';
  assert.equal(providerActivity({ text: `❯ fix\n⠧ Run npm test 2.1s        1m20s\n${grokBox}`, provider: 'grok' }), 'working');
  assert.equal(providerActivity({ text: `❯ fix\n  고쳤습니다.\nWorked for 1m24s\n${grokBox}`, provider: 'grok' }), 'idle');
  assert.equal(providerActivity({ text: `❯ fix\nWorked for 4s\n○ 1 command still running\n${grokBox}`, provider: 'grok' }), 'idle', 'the idle background cue never flickers into work');
  assert.equal(providerActivity({ text: `❯ fix\n◆ Waiting on answers for 배포 방식\n${grokBox}`, provider: 'grok' }), 'waiting');
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
  native = completed;
  const proof = (await reader.observe([member], frames)).get('shell');
  assert.equal(proof.requestId, completed.requestId);
  assert.equal(proof.providerPid, 101, 'badge evidence identifies the exact native AI process');
  assert.equal(await state(), 'idle', 'provider PID stays alive after its turn finishes');
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
  const tokenMembers = [member, { id: 'other', creationId: 'other-epoch', pid: 200 }];
  const tokenReader = new TerminalActivity({ platform: 'win32', completion: { observe: async child => ({
    available: true, conversationId: `conversation-${child.pid}`, state: 'working', requestId: `turn-${child.pid}`,
    usage: { input: child.pid, output: 1, total: child.pid + 1, cachedInput: 0, cacheWrite: 0 },
  }) } });
  const tokenSnapshot = { available: true, processes: [{ provider: 'claude', pid: 101, ancestorPids: [100] }, { provider: 'codex', pid: 201, ancestorPids: [200] }] };
  const tokenStates = await tokenReader.observe(tokenMembers, new Map(), tokenSnapshot);
  assert.equal(tokenStates.get('shell').usage.total, 102); assert.equal(tokenStates.get('other').usage.total, 202);
  assert.equal(tokenStates.get('shell').usageStatus, 'observed');
  assert.equal(tokenStates.get('shell').conversationId, 'conversation-101');
  // The AI's own turn ended while background work it started still runs: a
  // distinct wait, never claimed while the AI itself is still working.
  {
    const now = Date.parse('2026-11-11T01:00:00Z'), iso = at => new Date(at).toISOString();
    const aiTable = '100 1 100 101 Ss 00:10 /bin/zsh /bin/zsh\n101 100 101 101 S+ 00:05 /usr/bin/claude claude';
    let aiNative = { available: true, state: 'completed', requestId: 'one', inputWaiting: true, source: { file: '/log.jsonl' } };
    const snapshot = { generatedAt: iso(now), sessions: [{ id: 's', provider: 'claude', file: '/log.jsonl', collaboration: { spawns: [] },
      executions: [{ id: 'e1', mode: 'background', status: 'running', startedAt: iso(now - 1000), command: 'npm run build', label: '빌드' }] }] };
    const aiReader = new TerminalActivity({ platform: 'darwin', now: () => now, execute: async () => ({ stdout: aiTable }),
      completion: { observe: async () => aiNative }, backgroundSnapshot: () => snapshot });
    const aiFrames = new Map([['shell', { creationId: 'epoch', at: now, text: '❯ ' }]]);
    let observed = (await aiReader.observe([member], aiFrames)).get('shell');
    assert.equal(observed.state, 'idle'); assert.equal(observed.backgroundWait, true, 'turn ended with owned background work pending');
    assert.deepEqual(observed.background.items.map(item => [item.kind, item.label]), [['command', '빌드']]);
    aiNative = { ...aiNative, state: 'working', inputWaiting: false, progress: { kind: 'thinking', phase: 'thinking' }, turn: { since: now - 60000, steps: 3, files: 1 } };
    observed = (await aiReader.observe([member], aiFrames)).get('shell');
    assert.equal(observed.backgroundWait, undefined, 'a working AI is not waiting on its background work');
    assert.deepEqual(observed.turn, { since: now - 60000, steps: 3, files: 1 }, 'per-request counts reach the renderer');
    aiFrames.set('shell', { creationId: 'epoch', at: now, text: '⏺ 정리합니다.\n\n✻ Compacting conversation… (esc to interrupt)\n\n❯ ' });
    assert.deepEqual((await aiReader.observe([member], aiFrames)).get('shell').progress, { kind: 'compact', phase: 'screen' }, 'compaction from the live status line');
    aiFrames.set('shell', { creationId: 'epoch', at: now, text: '✻ Thinking… (esc to interrupt)\n  ⎿  API Error (overloaded) · Retrying in 5 seconds… (attempt 2/10)\n❯ ' });
    assert.deepEqual((await aiReader.observe([member], aiFrames)).get('shell').progress, { kind: 'retry', detail: '2/10', phase: 'screen' }, 'automatic retry from the live status line');
    aiFrames.set('shell', { creationId: 'epoch', at: now, text: '⏺ "Compacting conversation" 문구를 설명합니다.\n✻ Thinking… (esc to interrupt)\n❯ ' });
    assert.equal((await aiReader.observe([member], aiFrames)).get('shell').progress.kind, 'thinking', 'quoted words in an answer are not a state');
    aiNative = { ...aiNative, progress: { kind: 'edit', detail: 'auth.js', phase: 'running' } };
    aiFrames.set('shell', { creationId: 'epoch', at: now, text: 'Do you want to make this edit to auth.js?\n❯ 1. Yes\n  2. No' });
    observed = (await aiReader.observe([member], aiFrames)).get('shell');
    assert.equal(observed.state, 'waiting'); assert.equal(observed.progress.kind, 'edit', 'an approval prompt keeps the step it is holding');
    assert.equal(observed.backgroundWait, undefined, 'an approval prompt is a user wait, not a background wait');
  }
  console.log('PASS terminal activity: provider work/idle/drafts/approval/background, background waits, compaction/retry status lines, quiet commands, stopped jobs, identity, stale screens and probe failures');
})().catch(error => { console.error(error); process.exitCode = 1; });
