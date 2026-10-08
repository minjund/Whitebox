'use strict';
const assert = require('assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { CmuxClient, entriesFromTree, groupsFromEntries, surfaceProcessIds, sessionIdsFromProcesses, renderGridFrame, boundSessionId, currentCodexSessions } = require('../src/cmuxClient');
const uuid = number => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;
(async () => {
  const tree = { windows: [{ id: uuid(1), workspaces: [{ id: uuid(2), cwd: '/project/spring-ai-modular', panes: [{ surfaces: [
    { id: uuid(3), type: 'terminal', title: 'Claude' }, { id: uuid(4), type: 'browser' }, { id: '--flag', type: 'terminal' },
  ] }] }] }] };
  const entries = entriesFromTree(tree);
  const target = entries[0].cmuxTarget;
  const binding = { window_id: target.window, workspace_id: target.workspace, surface_id: target.surface, resume_binding: { kind: 'claude', checkpoint_id: uuid(10) } };
  assert.equal(boundSessionId(binding, target), `claude:${uuid(10)}`, 'updated provider binding follows a cleared/resumed conversation');
  assert.equal(boundSessionId({ ...binding, surface_id: uuid(99) }, target), '', 'a different surface cannot establish membership');
  assert.equal(boundSessionId({ ...binding, cleared: true }, target), '');
  const frame = renderGridFrame({ columns: 80, rows: 24, styles: [{ id: 1, bold: true, foreground: '#abcdef' }], row_spans: [{ row: 2, column: 3, style_id: 1, text: 'hello\x1b' }], cursor: { row: 4, column: 5, visible: true } });
  assert.equal(frame.columns, 80);
  assert.match(frame.ansi, /38;2;171;205;239/);
  assert.ok(frame.ansi.includes('\x1b[3;4H'));
  assert.ok(frame.ansi.includes('\x1b[5;6H'));
  assert.equal(frame.ansi.includes('hello\x1b\x1b'), false, 'cell text cannot inject terminal controls');
  assert.equal(renderGridFrame({ columns: 100000, rows: 1, row_spans: [] }), null);
  const opened = `p101\nn/home/test/.codex/sessions/2026/10/07/rollout-test-${uuid(8)}.jsonl\nn/home/test/.codex/sessions/2026/10/07/rollout-test-${uuid(9)}.jsonl`;
  const current = await currentCodexSessions(opened, async file => ({ type: 'session_meta', payload: { id: file.includes(uuid(8)) ? uuid(8) : uuid(9), source: file.includes(uuid(8)) ? 'cli' : { subagent: { thread_spawn: { parent_thread_id: uuid(8) } } } } }));
  assert.deepEqual([...current.get(101)], [`codex:${uuid(8)}`], 'only the open root CLI transcript identifies the visible session');
  const inheritedTui = await currentCodexSessions(opened, async file => ({ type: 'session_meta', payload: { id: file.includes(uuid(8)) ? uuid(8) : uuid(9), originator: 'codex-tui', source: file.includes(uuid(8)) ? 'vscode' : { subagent: { thread_spawn: { parent_thread_id: uuid(8) } } } } }));
  assert.deepEqual([...inheritedTui.get(101)], [`codex:${uuid(8)}`], 'TUI with inherited IDE source still binds exactly, excluding its subagent');
  assert.deepEqual(frame.cursor, { row: 4, column: 5, visible: true });
  const themed = renderGridFrame({ columns: 20, rows: 2, styles: [
    { id: 0, foreground: '#ffffff', foreground_source: 'default', background: '#1e1e1e', background_source: 'default' },
    { id: 1, foreground: '#abcdef', foreground_source: 'rgb', background: '#123456', background_source: 'rgb' },
  ], row_spans: [{ row: 0, column: 0, style_id: 0, text: 'default' }, { row: 1, column: 0, style_id: 1, text: 'highlight' }] });
  assert.ok(!themed.ansi.includes('48;2;30;30;30'), 'native default backgrounds must not become per-character blocks');
  assert.ok(!themed.ansi.includes('38;2;255;255;255'), 'default foreground follows the local theme');
  assert.ok(themed.ansi.includes('48;2;18;52;86') && themed.ansi.includes('38;2;171;205;239'), 'intentional highlights and semantic colors are retained');
  const handlers = new Map(); let trustedChecks = 0;
  require('../src/ipc/registerTerminalIpc').registerTerminalIpc({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    requireTrustedSender: () => { trustedChecks += 1; },
    manager: () => null,
  });
  assert.deepEqual(await handlers.get('cmux:list')({}), { installed: false, enabled: false, entries: [], groups: [] });
  for (const operation of ['read', 'frame', 'focus', 'input', 'arrange']) assert.throws(() => handlers.get(`cmux:${operation}`)({}, entries[0].id, 'x'), /플러그인/);
  assert.equal(trustedChecks, 6, 'disabled plugin operations still validate the IPC sender');
  const identities = sessionIdsFromProcesses(`p101\nn/home/test/.codex/sessions/2026/10/07/rollout-2026-10-07T12-00-00-${uuid(8)}.jsonl\np102\nn/tmp/${uuid(9)}.jsonl`, `103 /usr/bin/claude --session-id ${uuid(9)} --settings /tmp/settings`);
  assert.deepEqual([...identities.get(101)], [`codex:${uuid(8)}`]);
  assert.deepEqual([...identities.get(103)], [`claude:${uuid(9)}`]);
  assert.equal(identities.has(102), false, 'arbitrary JSONL files do not establish conversation membership');
  tree.windows[0].workspaces[0].panes[0].surfaces[0].processes = [{ pid: 101, children: [{ pid: 102 }] }];
  assert.deepEqual(surfaceProcessIds(tree).get(`${uuid(1)}:${uuid(2)}:${uuid(3)}`), [101, 102]);
  assert.equal(entries.length, 1); assert.equal(entries[0].cwd, '/project/spring-ai-modular');
  const groups = groupsFromEntries([
    ...entries,
    { ...entries[0], id: 'cmux:second', cwd: '/project/taw-poc', cmuxTarget: { ...entries[0].cmuxTarget, surface: uuid(5) } },
    { ...entries[0], id: 'cmux:other', cmuxTarget: { ...entries[0].cmuxTarget, workspace: uuid(6) } },
  ]);
  assert.equal(groups.length, 2, '작업 경로가 아니라 실제 cmux workspace ID로 묶습니다.');
  assert.equal(groups[0].members.length, 2, '다른 worktree의 터미널도 같은 cmux 작업이면 함께 표시합니다.');
  assert.equal(groups[1].members.length, 1, '같은 경로라도 다른 cmux 작업은 합치지 않습니다.');
  // The process list can put Gradle workers before the terminal shell.
  const processTree = JSON.parse(JSON.stringify(tree));
  processTree.windows[0].workspaces[0].cwd = '/home/test/.gradle/workers';
  processTree.windows[0].workspaces[0].panes[0].surfaces[0].top_level_pids = [102, 101];
  processTree.windows[0].workspaces[0].panes[0].surfaces[0].processes = [{ pid: 101, children: [{ pid: 102 }] }];
  const directoryClient = new CmuxClient({ platform: 'darwin', exists: () => true, execute: async (file, args) => {
    if (args.includes('tree') || args.includes('top')) return { stdout: JSON.stringify(processTree) };
    if (file === '/usr/sbin/lsof') return { stdout: 'p102\nfcwd\nn/home/test/.gradle/workers\np101\nfcwd\nn/project/spring-ai-modular\n' };
    if (file === '/bin/ps') return { stdout: '102 /usr/bin/java GradleWorkerMain\n101 /bin/zsh -l\n' };
    if (args.includes('resume') && processTree.useBinding) return { stdout: JSON.stringify({ ...binding, resume_binding: { ...binding.resume_binding, cwd: '/project/bound-session' } }) };
    return { stdout: '{}' };
  } });
  let directoryInventory = await directoryClient.list();
  assert.equal(directoryInventory.entries[0].cwd, '/project/spring-ai-modular', 'build-worker directory cannot replace the terminal shell project');
  assert.equal(directoryInventory.groups[0].cwd, '/project/spring-ai-modular', 'group project follows the anchor terminal rather than a focused worker');
  assert.equal((await directoryClient.layoutInventory()).groups[0].cwd, '/project/spring-ai-modular', 'layout refresh keeps the resolved project');
  processTree.windows[0].workspaces[0].panes[0].surfaces[0].cwd = '/project/explicit-surface';
  directoryInventory = await directoryClient.list();
  assert.equal(directoryInventory.entries[0].cwd, '/project/explicit-surface', 'exact surface metadata takes priority over process inference');
  delete processTree.windows[0].workspaces[0].panes[0].surfaces[0].cwd;
  processTree.windows[0].workspaces[0].cwd = '/project/workspace';
  processTree.windows[0].workspaces[0].panes[0].surfaces[0].top_level_pids = [102];
  processTree.windows[0].workspaces[0].panes[0].surfaces[0].processes = [{ pid: 102, children: [{ pid: 101 }] }];
  assert.equal((await directoryClient.list()).entries[0].cwd, '/project/workspace', 'a nested shell cannot masquerade as the terminal root');
  processTree.useBinding = true;
  assert.equal((await directoryClient.list()).entries[0].cwd, '/project/bound-session', 'exact active provider binding supplies its project');
  const calls = [];
  const client = new CmuxClient({ platform: 'darwin', exists: () => true, execute: async (_file, args) => { calls.push(args); return { stdout: args.includes('tree') ? JSON.stringify(tree) : 'terminal output' }; } });
  assert.equal((await client.list()).entries.length, 1);
  assert.equal(await client.read(entries[0].id), 'terminal output');
  assert.deepEqual(await client.frame(entries[0].id), { text: 'terminal output' }, 'older cmux versions retain text support');
  await client.input(entries[0].id, 'hello\\world\r');
  assert.equal(calls.at(-1).at(-1), 'hello\\\\world\\r');
  await assert.rejects(() => client.input(entries[0].id, ''), /입력/);
  await assert.rejects(() => client.arrange(entries[0].id, { action: 'move', targetId: 'unknown' }), /위치/);
  await client.focus(entries[0].id);
  assert.equal(calls.at(-1)[0], 'focus-panel');
  await assert.rejects(() => client.read('--bad'), /다시 선택/);
  client.execute = async () => ({ stdout: JSON.stringify({ surface_id: uuid(99), workspace_id: uuid(2), render_grid: {} }) });
  await assert.rejects(() => client.frame(entries[0].id), /대상/);
  client.execute = async () => { throw { stderr: 'Access denied' }; };
  assert.match((await client.list()).error, /Access denied/);
  assert.equal(client.entries.length, 0, 'access failure must revoke stale targets');
  // Freeze a full identity scan across a native edit. The mutation response
  // must contain the new tree without waiting for that scan or losing IDs.
  let releaseScan, scanStarted;
  const started = new Promise(resolve => { scanStarted = resolve; });
  const raceTree = JSON.parse(JSON.stringify(tree));
  const race = new CmuxClient({ platform: 'darwin', exists: () => true, execute: async (_file, args) => {
    if (args.includes('tree')) return { stdout: JSON.stringify(raceTree) };
    if (args.includes('list-workspaces')) { scanStarted(); return new Promise(resolve => { releaseScan = () => resolve({ stdout: '{"workspaces":[]}' }); }); }
    if (args[0] === 'resize-pane') raceTree.windows[0].workspaces[0].layout = { direction: 'horizontal', split: .7, children: [] };
    return { stdout: '{}' };
  } });
  race.entries = entriesFromTree(raceTree);
  race.entries[0].currentSessionId = 'claude:exact';
  const stale = race.list(); await started;
  const edited = await race.arrange(race.entries[0].id, { action: 'resize', direction: 'right', amount: 5 });
  assert.equal(edited.inventory.groups[0].layout.split, .7);
  assert.equal(edited.inventory.entries[0].currentSessionId, 'claude:exact');
  releaseScan(); await stale;
  assert.equal(race.entries[0].layout.split, .7, 'older identity scan cannot restore pre-edit layout');
  assert.equal(race.entries[0].currentSessionId, 'claude:exact');
  const context = { window: { WhiteboxI18n: { t: key => key } }, Set, Map };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/sidebar-tree.js'), 'utf8'), context);
  const state = {}, esc = value => value;
  const html = context.window.WhiteboxSidebarTree.render(state, '/project', [
    { id: 'group:one', title: 'AI 그룹', cwd: '/project/spring-ai-modular', terminalGroupId: 'one' },
    { id: 'root', title: 'root session', cwd: '/project' },
    { id: 'nested', title: 'nested session', cwd: '/project/spring-ai-modular/src' },
  ], (item, level) => `<button data-id="${item.id}" aria-level="${level}">${item.title}</button>`, esc, 'test');
  assert.match(html, /data-path-tree-toggle="\/project\/spring-ai-modular"/);
  assert.match(html, /data-id="group:one" aria-level="3"/);
  assert.match(html, /data-id="nested" aria-level="4"/);
  assert.match(html, /data-id="root" aria-level="2"/);
  console.log('✓ cmux 창/터미널 분류·실제 대상 명령·접근 차단·경로별 폴더와 세션 혼합');
})().catch(error => { console.error(error); process.exitCode = 1; });
