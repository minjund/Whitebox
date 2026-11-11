'use strict';

// Summary mode for every AI CLI the app recognizes. Codex steps come from a
// trimmed codex-cli 0.160.1 rollout (current "phase" replies and the `exec`
// tool script). Gemini CLI and Grok Build have no process-owned log here, so
// their fixtures are screens built from each CLI's own source strings:
//   Gemini (google-gemini/gemini-cli): input row " > " + "  Type your message
//   or @path/to/file", request echo "> …", reply rows "✦ …", running row
//   "⠋ Thinking... (esc to cancel, 12s)", dialog "Allow execution of [npm]?"
//   with "● 1. Allow once"; no turn footer.
//   Grok (xai-org/grok-build): composer "│ ❯ │", turn footer "Worked for 1m24s",
//   running row "⠧ Run <command> 2.1s … 1m20s", "◆ Waiting on answers for …",
//   permission "Allow command?" with "Yes, proceed".
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { TerminalCollaboration } = require('../../src/terminalCollaboration');
const { TerminalActivity, providerActivity, screenProgress, screenWaiting } = require('../../src/terminalActivity');
const { inputReady, completedTurn, completionStamp, currentTurnEvidence, submittedPrompt } = require('../../src/terminalReviewTurns');
const { applyCodexRow, TerminalReviewCompletion } = require('../../src/terminalReviewCompletion');
const { currentProgress, turnStats, toolActivity } = require('../../src/terminalProgress');
const { exactProcess } = require('../../src/terminalReview');

const REQUEST = '로그인 오류를 고쳐 주세요';
const GEMINI_RULE = '─'.repeat(48);
const geminiInput = (draft = '  Type your message or @path/to/file') => `${GEMINI_RULE}\n > ${draft}\n${GEMINI_RULE}\n~/project (main*)        no sandbox        gemini-2.5-pro (97% context left)`;
const GEMINI_HISTORY = '> 이전 질문\n\n✦ 이전 답변입니다.\n';
const GEMINI_WORKING = `${GEMINI_HISTORY}\n> ${REQUEST}\n\n✦ 인증 코드를 먼저 확인하겠습니다.\n\n╭──────────────────────────────╮\n│ ✓  ReadFile src/auth.js      │\n╰──────────────────────────────╯\n⠋ Thinking... (esc to cancel, 12s)\n\n${geminiInput()}`;
const GEMINI_DONE = `${GEMINI_HISTORY}\n> ${REQUEST}\n\n✦ 인증 코드를 먼저 확인하겠습니다.\n\n╭──────────────────────────────╮\n│ ✓  ReadFile src/auth.js      │\n╰──────────────────────────────╯\n\n✦ 로그인 오류를 고쳤습니다. 만료 시간 비교가 반대였습니다.\n\n${geminiInput()}`;
const GEMINI_APPROVAL = `${GEMINI_HISTORY}\n> ${REQUEST}\n\n╭──────────────────────────────────╮\n│ ?  Shell npm test                │\n│                                  │\n│ Allow execution of [npm]?        │\n│                                  │\n│ ● 1. Allow once                  │\n│   2. Allow for this session      │\n│   3. No, suggest changes (esc)   │\n╰──────────────────────────────────╯\n⠏ \n`;
const box = (inner = '') => `╭${'─'.repeat(50)}╮\n│ ❯ ${inner.padEnd(47)}│\n╰${'─'.repeat(50)}╯\n Enter send · Ctrl+P palette`;
const GROK_HISTORY = '❯ 이전 질문\n\n  이전 답변입니다.\n\nWorked for 4s\n';
const GROK_WORKING = row => `${GROK_HISTORY}\n❯ ${REQUEST}\n\n  인증 코드를 먼저 확인하겠습니다.\n\n${row}\n${box()}`;
const GROK_DONE = `${GROK_HISTORY}\n❯ ${REQUEST}\n\n  인증 코드를 먼저 확인하겠습니다.\n  로그인 오류를 고쳤습니다. 만료 시간 비교가 반대였습니다.\n\nWorked for 1m24s\n${box()}`;
const GROK_RUN = '⠧ Run npm test -- --grep auth 2.1s                    1m20s ⇣12k [stop]';

function collaborationFixture(provider, screen) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `wb-summary-${provider}-`));
  const session = { id: `terminal:${provider}`, creationId: `${provider}-epoch`, pid: 300, status: 'running', outputSequence: 1, title: provider };
  const state = { now: Date.now(), writes: [], responds: [], screen };
  const manager = { get: async id => (id === session.id ? session : null), rawWriteDeliverySupported: () => true,
    write: async (id, data, options) => { state.writes.push({ id, data, options }); },
    respond: async (id, key, options) => { state.responds.push({ id, key, options }); } };
  const monitor = { scan: () => ({ available: true, processes: [{ pid: 1300, ancestorPids: [300], provider }] }) };
  const collaboration = new TerminalCollaboration({ enableControl: false, directory, manager: () => manager, monitor,
    completion: { observe: async () => ({ available: false }) }, now: () => state.now,
    activity: { observe: async members => new Map(members.map(member => [member.id, { state: providerActivity({ text: state.screen, provider }) }])) } });
  const sync = () => collaboration.sync({ groups: [{ id: 'group', cwd: directory, members: [session] }],
    frames: [{ id: session.id, creationId: session.creationId, outputSequence: session.outputSequence, text: state.screen }] });
  const send = message => collaboration.summarySend({ id: randomUUID(), groupId: 'group', targetId: session.id, message,
    targetCreationId: session.creationId, targetProviderPid: 1300, targetProvider: provider });
  const show = text => { state.screen = text; session.outputSequence++; state.now += 1000; };
  return { state, session, collaboration, sync, send, show, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

const tests = [
  {
    name: 'Codex 0.160 rollout: phase replies, exec tool scripts, steps, files, usage and completion',
    async run() {
      const rows = fs.readFileSync(path.join(__dirname, '../fixtures/codex-rollout-0.160.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const state = {};
      const seen = [];
      for (const row of rows) {
        applyCodexRow(state, row);
        const progress = currentProgress(state);
        if (progress) seen.push(`${progress.kind}${progress.detail ? `:${progress.detail}` : ''}`);
      }
      assert.equal(state.request, REQUEST, 'the AGENTS.md envelope row is not the request');
      assert.deepEqual([...new Set(seen)], ['thinking', 'note:인증 코드를 먼저 확인하겠습니다.', 'read', 'edit:auth.js', 'test', 'wait', 'note:로그인 오류를 고쳤습니다.'],
        'commentary, then each exec script by its most telling call, then the final answer');
      assert.equal(state.complete, true);
      assert.equal(state.answer, '로그인 오류를 고쳤습니다. 만료 시간 비교가 반대였고, 인증 테스트 12개가 통과했습니다.');
      assert.equal(state.updates.length, 1, 'the commentary line is kept as an intermediate report');
      assert.deepEqual({ steps: turnStats(state).steps, files: turnStats(state).files }, { steps: 4, files: 2 }, 'one patch touching two files counts both');
      assert.equal(state.model, 'gpt-6.1-sol'); assert.equal(state.effort, 'high');
      // The same file read the way Summary reads a live process's log.
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-codex-0160-'));
      try {
        const file = path.join(directory, 'rollout.jsonl');
        fs.copyFileSync(path.join(__dirname, '../fixtures/codex-rollout-0.160.jsonl'), file);
        const logged = await new TerminalReviewCompletion({ claudeHomes: () => [] }).logState(file, 'codex');
        assert.equal(logged.complete, true);
        assert.equal(logged.codexTokenUsage.total, 49888, 'token usage from the cumulative token_count row');
        assert.equal(logged.codexTokenUsage.cachedInput, 20992);
      } finally { fs.rmSync(directory, { recursive: true, force: true }); }
      // Script code, other arguments and secrets never reach a label.
      assert.doesNotMatch(JSON.stringify(toolActivity('exec', 'text(await tools.exec_command({cmd:"curl -H \\"Authorization: Bearer sk-SECRET\\" https://x.test"}))')), /SECRET/u);
      assert.deepEqual(toolActivity('exec', 'text(ALL_TOOLS.filter(x => /file/.test(x.name)))'), { kind: 'tool' }, 'a script calling no tool is just a tool step');
      assert.deepEqual(toolActivity('exec', 'await tools.mcp__codex_apps__github_create_pull_request({title:"x"})'), { kind: 'mcp', detail: 'codex_apps › github_create_pull_request' });
      assert.deepEqual(toolActivity('exec', 'text(await tools.write_stdin({session_id:3,chars:""}))'), { kind: 'wait' });
      assert.deepEqual(toolActivity('request_user_input_async', '{}'), { kind: 'ask' });
      assert.deepEqual(toolActivity('followup_task', JSON.stringify({ target: 'fixture_flows', message: 'ENCRYPTED' })), { kind: 'agent', detail: 'fixture_flows' });
      assert.deepEqual(toolActivity('js', JSON.stringify({ code: 'await app.click(1)', title: 'Apidog 열기' })), { kind: 'tool', detail: 'Apidog 열기' });
      assert.deepEqual(toolActivity('exec', 'text(await tools.exec_command({cmd:"set -e; git status --short"}))'), { kind: 'git', detail: 'status' });
      // Older Codex labels the visible reply by channel; hidden reasoning stays hidden.
      const older = { requestId: 'r', requestAt: 0, turnId: 't' };
      applyCodexRow(older, { type: 'response_item', timestamp: '2026-11-05T00:00:01Z', payload: { type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'output_text', text: 'PRIVATE' }] } });
      applyCodexRow(older, { type: 'response_item', timestamp: '2026-11-05T00:00:02Z', payload: { type: 'message', role: 'assistant', channel: 'commentary', content: [{ type: 'output_text', text: '진행 중입니다.' }] } });
      assert.equal(older.answer, '진행 중입니다.');
    },
  },
  {
    name: 'Gemini CLI screen: working, approval, ready, completion and answer capture',
    run() {
      assert.equal(providerActivity({ text: GEMINI_WORKING, provider: 'gemini' }), 'working');
      assert.equal(providerActivity({ text: GEMINI_DONE, provider: 'gemini' }), 'idle');
      assert.equal(providerActivity({ text: GEMINI_APPROVAL, provider: 'gemini' }), 'waiting');
      assert.deepEqual(screenWaiting(GEMINI_APPROVAL, 'gemini'), { kind: 'command', phase: 'screen' }, 'the dialog says it holds a command');
      assert.equal(screenProgress(GEMINI_WORKING, 'gemini'), null, 'Gemini\'s phrase is not claimed as a step');
      assert.equal(inputReady(GEMINI_WORKING, 'gemini'), false);
      assert.equal(inputReady(GEMINI_APPROVAL, 'gemini'), false);
      assert.equal(inputReady(GEMINI_DONE, 'gemini'), true, 'the placeholder is an empty input box');
      assert.equal(inputReady(GEMINI_DONE.replace('  Type your message or @path/to/file', '다음 요청'), 'gemini'), false, 'a draft is not ready');
      assert.equal(inputReady(GEMINI_DONE.replace(`  Type your message or @path/to/file\n`, '첫 줄\n   둘째 줄\n'), 'gemini'), false, 'a wrapped draft is not ready');
      const before = completionStamp(`${GEMINI_HISTORY}\n${geminiInput()}`, 'gemini');
      assert.equal(completedTurn(GEMINI_WORKING, REQUEST, 'gemini', before, { exactRequest: true }), '', 'a running row keeps the turn open');
      const evidence = completedTurn(GEMINI_DONE, REQUEST, 'gemini', before, { exactRequest: true });
      assert.match(evidence, /만료 시간 비교가 반대였습니다/u);
      assert.doesNotMatch(evidence, /이전 답변/u, 'only this turn is captured');
      assert.match(currentTurnEvidence(GEMINI_WORKING, REQUEST, 'gemini'), /인증 코드를 먼저 확인하겠습니다/u);
      const pasted = GEMINI_DONE.replace(`> ${REQUEST}`, '> [Pasted Text: 12 lines]');
      assert.match(completedTurn(pasted, `${REQUEST}\n둘째 줄`, 'gemini', before, { exactRequest: true }), /만료 시간 비교/u, 'a long paste echoed as a chip still completes');
      assert.equal(submittedPrompt(`${GEMINI_DONE.replace('  Type your message or @path/to/file', '다음 요청')}`, 'gemini'), '다음 요청');
      assert.equal(submittedPrompt(GEMINI_DONE, 'gemini'), '', 'pressing Enter on the placeholder submits nothing');
    },
  },
  {
    name: 'Grok Build screen: step labels, questions, permission, ready and completion',
    run() {
      assert.equal(providerActivity({ text: GROK_WORKING(GROK_RUN), provider: 'grok' }), 'working');
      assert.equal(providerActivity({ text: GROK_DONE, provider: 'grok' }), 'idle');
      assert.equal(providerActivity({ text: `${GROK_DONE}\n◎ 2 commands still running`, provider: 'grok' }), 'idle', 'the idle background cue after a finished turn');
      assert.equal(providerActivity({ text: GROK_WORKING('◎ waiting · send a message to interrupt'), provider: 'grok' }), 'working', 'a parked turn is still running');
      const steps = row => screenProgress(GROK_WORKING(row), 'grok');
      assert.deepEqual(steps(GROK_RUN), { kind: 'test', phase: 'screen' }, 'a command keeps only its kind');
      assert.deepEqual(steps('⠧ Run curl -H "Authorization: Bearer sk-SECRET" https://x.test 0.4s     9s'), { kind: 'command', detail: 'curl', phase: 'screen' });
      assert.deepEqual(steps('⠧ Run Read src/auth.rs 0.1s          12s'), { kind: 'read', detail: 'auth.rs', phase: 'screen' });
      assert.deepEqual(steps('⠧ Search electron release notes 0.3s      20s'), { kind: 'web', detail: 'electron release notes', phase: 'screen' });
      assert.deepEqual(steps('⠧ Fetch https://docs.x.ai/build/cli?q=1 0.3s      20s'), { kind: 'web', detail: 'docs.x.ai', phase: 'screen' });
      assert.deepEqual(steps('⠧ Thinking… 3.0s          30s'), { kind: 'thinking', phase: 'screen' });
      assert.deepEqual(steps('⠧ Responding… 1.0s        31s'), { kind: 'respond', phase: 'screen' });
      assert.deepEqual(steps('⠧ Compacting… 4.0s        40s'), { kind: 'compact', phase: 'screen' });
      assert.equal(steps('⠧ Waiting for the build server 2s     50s'), null, 'an unknown label falls back to the neutral line');
      const ask = GROK_WORKING('◆ Waiting on answers for 배포 방식');
      assert.equal(providerActivity({ text: ask, provider: 'grok' }), 'waiting');
      assert.deepEqual(screenWaiting(ask, 'grok'), { kind: 'ask', phase: 'screen' });
      const permission = `${GROK_HISTORY}\n❯ ${REQUEST}\n\n╭────────────────────────────────╮\n│ Allow command?                 │\n│ npm publish                    │\n│ ❯ Yes, proceed                 │\n│   Always allow: npm publish    │\n│   No, reject (type to add feedback) │\n╰────────────────────────────────╯`;
      assert.equal(providerActivity({ text: permission, provider: 'grok' }), 'waiting');
      assert.deepEqual(screenWaiting(permission, 'grok'), { kind: 'command', phase: 'screen' });
      assert.equal(inputReady(GROK_WORKING(GROK_RUN), 'grok'), false);
      assert.equal(inputReady(permission, 'grok'), false);
      assert.equal(inputReady(GROK_DONE, 'grok'), true, 'an empty boxed composer');
      assert.equal(inputReady(GROK_DONE.replace(box(), box('초안')), 'grok'), false, 'a draft is not ready');
      assert.equal(inputReady(GROK_DONE.replace(box(), `${box().split('\n')[0]}\n│ ❯ 첫 줄${' '.repeat(42)}│\n│   둘째 줄${' '.repeat(40)}│\n${box().split('\n').slice(2).join('\n')}`), 'grok'), false, 'a wrapped draft is not ready');
      const before = completionStamp(`${GROK_HISTORY}\n${box()}`, 'grok');
      assert.equal(completedTurn(GROK_WORKING(GROK_RUN), REQUEST, 'grok', before, { exactRequest: true }), '');
      const evidence = completedTurn(GROK_DONE, REQUEST, 'grok', before, { exactRequest: true });
      assert.match(evidence, /만료 시간 비교가 반대였습니다/u);
      assert.doesNotMatch(evidence, /이전 답변/u);
      assert.equal(submittedPrompt(GROK_DONE.replace(box(), box('다음 요청')), 'grok'), '다음 요청');
    },
  },
  {
    name: 'Summary delivery reaches Gemini and Grok only when ready and completes from their screens',
    async run() {
      for (const [provider, working, done] of [['gemini', GEMINI_WORKING, GEMINI_DONE], ['grok', GROK_WORKING(GROK_RUN), GROK_DONE]]) {
        const history = provider === 'gemini' ? `${GEMINI_HISTORY}\n${geminiInput()}` : `${GROK_HISTORY}\n${box()}`;
        const f = collaborationFixture(provider, working);
        try {
          let panel = await f.sync();
          const member = panel.panels[0].members[0];
          assert.equal(member.provider, provider);
          assert.equal(member.ready, false, `${provider}: a working AI is not ready`);
          assert.equal(member.activity.state, 'working');
          assert.equal((await f.send(REQUEST)).deferred, true, `${provider}: the send waits while the AI works`);
          f.show(history); panel = await f.sync();
          assert.equal(panel.panels[0].members[0].ready, true, `${provider}: an idle input box is ready`);
          const sent = await f.send(REQUEST);
          assert.equal(sent.ok, true, `${provider}: delivered`);
          assert.equal(f.state.writes.at(-1).data, `\x1b[200~${REQUEST}\x1b[201~\r`);
          f.show(working); await f.sync();
          assert.equal(f.collaboration.jobs.get(sent.job.id).state, 'running');
          // Stop uses the CLI's own cancel key.
          await f.collaboration.summaryStop({ groupId: 'group', targetId: f.session.id, targetCreationId: f.session.creationId, targetProviderPid: 1300, targetProvider: provider });
          if (provider === 'grok') assert.equal(f.state.writes.at(-1).data, '\x03', 'Grok cancels a turn with Ctrl+C');
          else assert.equal(f.state.responds.at(-1).key, 'Escape', 'Gemini cancels with Escape');
          const second = await f.send(`${REQUEST} 다시`);
          assert.equal(second.deferred, true);
          f.show(done.replaceAll(REQUEST, `${REQUEST} 다시`)); await f.sync();
          const again = await f.send(`${REQUEST} 다시`);
          assert.equal(again.ok, true);
          f.show(working.replaceAll(REQUEST, `${REQUEST} 다시`).replace(provider === 'gemini' ? GEMINI_HISTORY : GROK_HISTORY, `${provider === 'gemini' ? GEMINI_HISTORY : GROK_HISTORY}`)); await f.sync();
          assert.equal(f.collaboration.jobs.get(again.job.id).state, 'running');
          f.show(`${done.replaceAll(REQUEST, `${REQUEST} 다시`)}`.replace(/Worked for 1m24s/u, 'Worked for 1m30s').replace('만료 시간 비교가 반대였습니다.', '다시 확인했습니다.')); await f.sync();
          const finished = f.collaboration.jobs.get(again.job.id);
          assert.equal(finished.state, 'completed', `${provider}: completion recognized from the screen`);
          assert.match(finished.answer, /다시 확인했습니다/u);
        } finally { f.cleanup(); }
      }
    },
  },
  {
    name: 'Live activity binds Gemini and Grok processes and reports observed elapsed time without step counts',
    async run() {
      let now = Date.parse('2026-11-11T01:00:00Z');
      const table = '100 1 100 101 Ss 00:10 /bin/zsh /bin/zsh\n101 100 101 101 S+ 00:05 node node /usr/local/lib/node_modules/@google/gemini-cli/dist/index.js\n'
        + '200 1 200 201 Ss 00:10 /bin/zsh /bin/zsh\n201 200 201 201 S+ 00:05 /usr/local/bin/grok grok';
      const reader = new TerminalActivity({ platform: 'darwin', now: () => now, execute: async () => ({ stdout: table }),
        completion: { observe: async () => ({ available: false }) } });
      const members = [{ id: 'gemini', creationId: 'g', pid: 100 }, { id: 'grok', creationId: 'x', pid: 200 }];
      const frames = new Map([['gemini', { creationId: 'g', at: now, text: GEMINI_WORKING }], ['grok', { creationId: 'x', at: now, text: GROK_WORKING(GROK_RUN) }]]);
      let result = await reader.observe(members, frames);
      assert.equal(result.get('gemini').provider, 'gemini'); assert.equal(result.get('gemini').state, 'working');
      assert.equal(result.get('gemini').progress, undefined, 'no step is invented for Gemini');
      assert.deepEqual(result.get('grok').progress, { kind: 'test', phase: 'screen' });
      assert.equal(result.get('grok').usage, null, 'no token count is claimed without a log');
      now += 5 * 60000;
      for (const frame of frames.values()) frame.at = now;
      result = await reader.observe(members, frames);
      assert.deepEqual(result.get('gemini').turn, { since: now - 5 * 60000, steps: 0, files: 0, observed: true }, 'elapsed time since the work was first seen');
      frames.set('gemini', { creationId: 'g', at: now, text: GEMINI_DONE });
      result = await reader.observe(members, frames);
      assert.equal(result.get('gemini').state, 'idle'); assert.equal(result.get('gemini').turn, undefined);
      frames.set('gemini', { creationId: 'g', at: now, text: GEMINI_WORKING });
      result = await reader.observe(members, frames);
      assert.equal(result.get('gemini').turn.since, now, 'a new request starts its own clock');
      // Terminal review binds the same processes; analysis reads their screens.
      for (const provider of ['gemini', 'grok']) {
        assert.equal(exactProcess({ pid: 300, status: 'running' }, { available: true, processes: [{ pid: 301, ancestorPids: [300], provider }] })?.provider, provider);
      }
    },
  },
];

function registerSummaryProviderTests({ test }) {
  for (const item of tests) test(item.name, item.run);
}

module.exports = { registerSummaryProviderTests, tests };
