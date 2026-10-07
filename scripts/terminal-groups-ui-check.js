'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { TerminalManager } = require('../src/terminalManager');
const { ManagedTmuxRuntime } = require('../src/managedTmuxRuntime');
const { registerTerminalIpc } = require('../src/ipc/registerTerminalIpc');
function quizTask(id, title) {
  return { id, title, provider: 'codex', cwd: 'D:\\fixture', workspace: '화면 개선', depth: 0,
    status: 'completed', completionObserved: true, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messages: [{ id: `${id}-request`, role: 'user', text: '버튼을 파란색으로 바꿔줘' }],
    comprehensionOrigin: { authority: 'background-questionnaire-v1', generation: 'a'.repeat(64) },
    comprehension: { status: 'ready', schemaVersion: 1, packet: {
      schemaVersion: 1, id: 'packet-1', title, summary: '버튼을 파란색으로 변경했습니다. 기존 테마와 통일하기 위해 선택했습니다. 색 대비 검사는 아직 하지 않았습니다.',
      difficulty: 1, difficultyReason: '간단한 색상 변경입니다.', evidence: [{ id: 'e1', label: '완료 답변', detail: '버튼을 파란색으로 변경했습니다.' }],
      questions: [{ id: 'q1', kind: 'comprehension', topics: ['change', 'decision', 'constraint-risk'], prompt: '아직 남아 있는 검증은 무엇인가요?',
        options: [{ id: 'a', label: '색 대비 검사' }, { id: 'b', label: '파란색 적용' }], answerId: 'a', explanation: '색 대비 검사는 아직 진행하지 않았습니다.', evidenceIds: ['e1'],
        variant: { prompt: '완료된 것은 무엇인가요?', options: [{ id: 'a', label: '파란색 적용' }, { id: 'b', label: '색 대비 검사' }], answerId: 'a', explanation: '버튼 색상은 변경했습니다.' } }],
    } },
  };
}

const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-group-ui-'));
process.env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].join(path.delimiter);
app.setPath('userData', directory);
app.disableHardwareAcceleration();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const runtime = new ManagedTmuxRuntime();
  const socket = `wb-group-ui-${process.pid}`;
  const manager = new TerminalManager({ storeFile: path.join(directory, 'sessions.json'), managedTmuxRuntime: runtime,
    agentProviders: Object.fromEntries(['claude', 'codex'].map(id => [id, { command: '/bin/sh', args: ['-i'], label: id }])) });
  const host = { list: () => manager.list(), get: (...args) => manager.get(...args), retire: id => manager.retire(id),
    create: options => manager.create({ ...options, initialCommand: '', tmuxSocket: socket }), write: (...args) => manager.write(...args),
    resize: (...args) => manager.resize(...args), reconnect: id => manager.reconnect(id) };
  let win;
  registerTerminalIpc({ ipcMain, requireTrustedSender: event => { assert.equal(event.sender.id, win.webContents.id); },
    isCmuxEnabled: () => true,
    manager: () => host, groupStoreFile: path.join(directory, 'groups.json'), listWslDistros: () => [] });
  win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: {
    preload: path.join(__dirname, 'interaction-fixture-preload.js'), contextIsolation: true, sandbox: false,
    additionalArguments: ['--whitebox-terminal-groups-live'], backgroundThrottling: false,
  } });
  manager.on('data', payload => { if (!win.isDestroyed()) win.webContents.send('terminals:data', payload); });
  manager.on('state', payload => { if (!win.isDestroyed()) win.webContents.send('terminals:state', payload); });
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
  const run = async source => { try { return await win.webContents.executeJavaScript(source); } catch (error) { console.error('Renderer check:', source); throw error; } };
  const until = async (source, description) => {
    for (let i = 0; i < 150; i += 1) { if (await run(source)) return; await wait(80); }
    throw new Error(`UI timeout: ${description}`);
  };
  try {
    await win.loadFile(path.join(root, 'renderer/index.html'));
    await until('Boolean(window.WhiteboxApp?.initialized)', 'bootstrap');
    await run("window.WhiteboxI18n.setLocale('ko')");
    await run("(()=>{const a=window.WhiteboxApp;const s=a.state.snapshot.sessions.find(item=>!item.parentId);a.state.workspace=s.cwd;a.renderWorkspaces();a.renderSessions();})()");
    await run("(()=>{const Base=WhiteboxTerminalEngine.Terminal;window.nativeGroupTerminals=[];WhiteboxTerminalEngine.Terminal=class extends Base{constructor(options){super(options);nativeGroupTerminals.push(this);}};})()");
    const ownerId = await run("window.WhiteboxApp.state.snapshot.sessions.find(item=>!item.parentId).id");
    const group = await run(`whitebox.terminalGroupCreate({cwd:${JSON.stringify(directory)},ownerId:${JSON.stringify(ownerId)},name:'사이드바 팀'})`);
    await run(`whitebox.terminalGroupAdd(${JSON.stringify(group.id)},{provider:'claude'})`);
    await run("window.dispatchEvent(new CustomEvent('whitebox-terminal-inventory-changed'))");
    await until(`Boolean(document.querySelector('[data-terminal-group-id="${group.id}"]'))`, 'group sidebar entry');
    await run(`document.querySelector('[data-terminal-group-id="${group.id}"]').click()`);
    await until("Boolean(document.querySelector('#terminalGroupPanel:not(.hidden) [data-group-manage]'))", 'group open');
    await until("document.querySelectorAll('#terminalGroupPanel .terminal-screen').length===1 && !document.querySelector('#terminalGroupPanel').hasAttribute('aria-busy')", 'first terminal');
    await run("document.querySelector('#terminalGroupPanel [data-group-manage]').click();document.querySelector('#terminalGroupPanel [name=provider]').value='codex';document.querySelector('#terminalGroupPanel .terminal-group-add').requestSubmit()");
    await until("document.querySelectorAll('#terminalGroupPanel .terminal-screen').length===2 && !document.querySelector('#terminalGroupPanel').hasAttribute('aria-busy')", 'second terminal');
    const before = manager.list();
    assert.equal(before.length, 2);
    for (const terminal of before) {
      for (let attempt=0; attempt<100 && !runtime.existsStrict(terminal); attempt++) await wait(50);
      assert.equal(runtime.execute(terminal, ['show-options', '-v', '-t', terminal.managedTmuxSession, 'status']).trim(), 'off', 'managed terminal has no nested tmux status bar');
    }
    assert.equal(await run("document.querySelector('#terminalGroupPanel').parentElement.id"), 'mainContent');
    assert.equal(await run("document.querySelector('[data-group-font-size]').textContent"), '15');
    assert.equal(await run("nativeGroupTerminals.every(t=>t.options.cursorBlink===false && t.options.fontSize===15)"), true);
    await run("document.querySelector('[data-group-font=\"1\"]').click()");
    assert.equal(await run("nativeGroupTerminals.every(t=>t.options.fontSize===16)"), true);
    await run("document.querySelector('[data-group-font=\"-1\"]').click();document.querySelector('[data-group-columns]').value='1';document.querySelector('[data-group-columns]').dispatchEvent(new Event('change',{bubbles:true}))");
    assert.equal(await run("document.querySelector('.terminal-group-grid').style.getPropertyValue('--group-columns')"), '1');
    await run("document.querySelector('[data-group-columns]').value='2';document.querySelector('[data-group-columns]').dispatchEvent(new Event('change',{bubbles:true}))");
    const nativeTasks = before.map((terminal,i)=>({...quizTask(`native-group-status-${i}`,`자체 AI ${i+1}`),provider:terminal.provider,cwd:directory,status:i?'completed':'running',completionObserved:Boolean(i),comprehension:null,runtimePresence:[{kind:'bridge',terminalId:terminal.id}]}));
    await run(`interactionTest.addSession(${JSON.stringify(nativeTasks[0])});interactionTest.addSession(${JSON.stringify(nativeTasks[1])});interactionTest.emitSnapshot()`);
    await until("[...document.querySelectorAll('[data-group-session-status]')].map(n=>n.dataset.status).join(',')==='running,completed'", 'native group shows each actual AI status');
    await run("document.querySelector('#terminalGroupPanel textarea').focus();window.nativeInput=document.activeElement;interactionTest.updateSession('native-group-status-1',{attention:{category:'required',source:'execution-approval'}});interactionTest.emitSnapshot()");
    await until("[...document.querySelectorAll('[data-group-session-status]')][1].dataset.status==='waiting'", 'native worker approval status');
    assert.equal(await run("document.activeElement===window.nativeInput && !nativeGroupTerminals[1].renderer.cursorVisible"), true, 'status updates retain input and keep other cursors hidden');

    await run("document.querySelector('#terminalGroupPanel [data-group-expand]').click()");
    assert.equal(await run("document.querySelectorAll('#terminalGroupPanel .terminal-group-pane:not([hidden])').length"), 1);
    await run("document.querySelector('#terminalGroupPanel [data-group-expand]').click()");
    const textarea = await run("Boolean(document.querySelector('#terminalGroupPanel textarea'))");
    assert.equal(textarea, true, 'actual terminal input must be mounted');
    await run("document.querySelector('#terminalGroupPanel textarea').focus()");
    for (const character of "printf 'GROUP_UI_INPUT_OK\\n'") win.webContents.sendInputEvent({ type: 'char', keyCode: character });
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    for (let i = 0; i < 100 && !manager.get(before[0].id, true).replay.includes('GROUP_UI_INPUT_OK'); i += 1) await wait(80);
    assert.match(manager.get(before[0].id, true).replay, /GROUP_UI_INPUT_OK/);
    const output = path.join(root, 'artifacts/terminal-groups'); fs.mkdirSync(output, { recursive: true });
    await run("document.querySelector('#terminalGroupPanel').scrollIntoView({block:'start'})");
    await wait(200);
    assert.equal(await run("[...document.querySelectorAll('#terminalGroupPanel .terminal-screen')].every(node=>{const b=node.getBoundingClientRect(),p=node.parentElement.getBoundingClientRect();return b.left>=p.left&&b.right<=p.right&&b.top>=p.top&&b.bottom<=p.bottom})"), true, 'terminals must stay inside their own pane');
    await until("nativeGroupTerminals.every(t=>Math.abs(t.renderer.getCanvas().getBoundingClientRect().width - t.renderer.getMetrics().width*t.cols)<2 && t.renderer.getCanvas().getBoundingClientRect().width <= t.element.clientWidth+1)", 'native grid retains readable cell widths after layout and font changes');
    fs.writeFileSync(path.join(output, 'groups-dark.png'), (await win.webContents.capturePage()).toPNG());
    await run("window.WhiteboxTheme.setTheme('light')"); await wait(150);
    fs.writeFileSync(path.join(output, 'groups-light.png'), (await win.webContents.capturePage()).toPNG());
    await run("window.WhiteboxTheme.setTheme('dark')");
    for (const width of [1024, 736]) {
      win.setContentSize(width, 1000); await wait(100);
      assert.equal(await run("(()=>{const p=document.querySelector('#terminalGroupPanel');return p.scrollWidth<=p.clientWidth+1})()"), true, 'group controls must fit at ' + width);
    }
    win.setContentSize(1440, 1000);
    await win.reload();
    await until('Boolean(window.WhiteboxApp?.initialized)', 'reload');
    await run("(()=>{const a=window.WhiteboxApp;const s=a.state.snapshot.sessions.find(item=>!item.parentId);a.state.workspace=s.cwd;a.renderWorkspaces();a.renderSessions();})()");
    await run("window.dispatchEvent(new CustomEvent('whitebox-terminal-inventory-changed'))");
    await until(`Boolean(document.querySelector('[data-terminal-group-id="${group.id}"]'))`, 'group sidebar entry');
    await run(`document.querySelector('[data-terminal-group-id="${group.id}"]').click()`);
    await until("document.querySelectorAll('#terminalGroupPanel .terminal-screen').length===2 && !document.querySelector('#terminalGroupPanel').hasAttribute('aria-busy')", 'restore group');
    assert.equal(manager.list().length, 2, 'reopening group must reuse the same two tmux sessions');
    await run("document.querySelector('#terminalGroupPanel [data-group-remove]').click()");
    await until("document.querySelectorAll('#terminalGroupPanel .terminal-group-pane').length===1 && !document.querySelector('#terminalGroupPanel').hasAttribute('aria-busy')", 'remove destroys pane');
    assert.equal(manager.get(before[0].id), null);
    assert.equal(runtime.existsStrict({ ...before[0], managedTmuxSession: before[0].managedTmuxSession }), false);
    assert.equal(manager.list().length, 1);
    await run("document.querySelector('#terminalGroupPanel [data-group-manage]').click();document.querySelector('#terminalGroupPanel [data-group-delete]').click()");
    await until("document.querySelector('#terminalGroupPanel').classList.contains('hidden')", 'delete hides group');
    assert.equal(manager.list().length, 0);
    assert.deepEqual(await run('whitebox.terminalGroups()'), []);
    await run(`(()=>{const a=window.WhiteboxApp;a.state.workspace=${JSON.stringify(directory)};a.state.workspaces.push({path:${JSON.stringify(directory)},name:'테스트 프로젝트'});a.renderWorkspaces();a.openRunModal();document.querySelector('#runPrompt').value='새 그룹 작업';document.querySelector('#runGroupMode').value='new';document.querySelector('#runGroupName').value='새 작업 그룹';document.querySelector('#runForm').requestSubmit();})()`);
    await until("document.querySelectorAll('#terminalGroupPanel .terminal-screen').length===1 && document.querySelector('#runModal').classList.contains('hidden')", 'new task creates actual tmux group');
    assert.equal(manager.list().length, 1);
    assert.equal((await run('whitebox.terminalGroups()'))[0].name, '새 작업 그룹');
    await run("document.querySelector('#terminalGroupPanel [data-group-manage]').click();document.querySelector('#terminalGroupPanel [data-group-delete]').click()");
    await until("document.querySelector('#terminalGroupPanel').classList.contains('hidden')", 'new task group cleanup');
    await run("window.WhiteboxApp.state.sourcePluginSettings={version:3,enabledPluginIds:['builtin.cmux','builtin.codex-desktop','builtin.claude-desktop']}");
    await run("(()=>{const Base=window.WhiteboxTerminalEngine.Terminal;window.cmuxTestTerminals=[];window.WhiteboxTerminalEngine.Terminal=class extends Base { constructor(options){super(options);this.testResizeCount=0;window.cmuxTestTerminals.push(this);} resize(...args){this.testResizeCount++;return super.resize(...args);} };})()");
    const cmuxGroup = { id: 'cmux-workspace:fixture', title: 'TAW', cwd: directory, cmuxWorkspace: true, provider: 'cmux', status: 'running', members: [
      { id: 'cmux:claude', paneId: 'pane-a', selected: true, title: 'Claude', cwd: `${directory}/spring-ai-modular` },
      { id: 'cmux:codex', paneId: 'pane-b', selected: true, title: 'Codex', cwd: `${directory}/taw-poc` },
    ] };
    cmuxGroup.layout = { direction: 'horizontal', split: .65, children: [{ pane: { id: 'pane-a' } }, { pane: { id: 'pane-b' } }] };
    const represented = await run("(()=>{const a=window.WhiteboxApp;const s=a.state.snapshot.sessions.find(item=>!item.parentId);s.cwd=" + JSON.stringify(directory + '/taw-poc') + ";s.runtimePresence=[];s.status='running';a.state.sidebarTree.assignments.push({sessionId:s.id,projectKey:" + JSON.stringify(directory) + ",folderId:'unused'});a.renderWorkspaces();return s.id})()");
    cmuxGroup.members[1].sessionIds = [represented];
    const emptyGroup = await run(`whitebox.terminalGroupCreate({name:'빈 그룹',cwd:${JSON.stringify(directory)},ownerId:'test-empty'})`);
    await run(`interactionTest.setCmuxInventory({installed:true,error:'',entries:${JSON.stringify(cmuxGroup.members)},groups:[${JSON.stringify(cmuxGroup)}]});window.dispatchEvent(new CustomEvent('whitebox-terminal-inventory-changed'))`);
    await until("document.querySelectorAll('[data-cmux-workspace]').length===1", 'one cmux workspace entry');
    assert.equal(await run(`Boolean(document.querySelector('[data-terminal-group-id="${emptyGroup.id}"]'))`), false, 'empty managed groups do not clutter the sidebar');
    assert.equal(await run(`document.querySelector('[data-workspace="${directory}"]').dataset.liveSessionCount`), '1', 'one cmux group counts once rather than once per represented conversation');
    assert.equal(await run(`Boolean(document.querySelector('[data-sidebar-session-id="${represented}"]'))`), false, 'cmux conversation must not also appear as a standalone session, even without runtime PID');
    assert.equal(await run("[...document.querySelectorAll('[data-path-tree-toggle]')].some(node=>node.dataset.pathTreeToggle.endsWith('/taw-poc'))"), false, 'cmux worktrees must not become separate folders');
    assert.equal(await run("(()=>{const row=document.querySelector('[data-cmux-workspace]'),title=row.querySelector('b').getBoundingClientRect(),count=row.querySelector('small').getBoundingClientRect();return Math.abs((title.top+title.bottom)/2-(count.top+count.bottom)/2)<2 && count.right<=row.getBoundingClientRect().right})()"), true, 'cmux title and terminal count stay on the same line');
    await run("document.querySelector('[data-cmux-workspace]').click()");
    assert.equal(await run("window.WhiteboxApp.graphFilteredSessions().length"), 0, 'selecting cmux excludes every unrelated ordinary session from the actual graph');
    assert.equal(await run("window.WhiteboxApp.filteredSessions().length"), 0, 'selecting cmux also excludes ordinary session history');
    assert.equal(await run("document.querySelector('#projectTaskProjectName').textContent"), 'TAW', 'selected group owns the toolbar title');
    assert.equal(await run("document.querySelector('.cmux-detail').classList.contains('hidden')"), true, 'overview must not open terminals automatically');
    await until("Boolean(document.querySelector('[data-cmux-detail]'))", 'overview detail button');
    await run("document.querySelector('[data-cmux-detail]').click()");
    await until("document.querySelectorAll('[data-cmux-member] .terminal-screen').length===2", 'detail mounts both terminal screens');
    await until("[...document.querySelectorAll('[data-cmux-member]')].every(n=>n.dataset.fontSize==='15')", 'readable fixed terminal size');
    assert.equal(await run("[...document.querySelectorAll('.cmux-terminal canvas')].every(n=>n.getBoundingClientRect().width>=600)"), true, '80-column grids retain readable pixels instead of shrinking to the pane');
    await run("document.querySelector('[data-cmux-font=\"1\"]').click()");
    assert.equal(await run("[...document.querySelectorAll('[data-cmux-member]')].every(n=>n.dataset.fontSize==='16')"), true);
    await run("document.querySelector('[data-cmux-font=\"-1\"]').click()");
    assert.equal(await run("document.querySelector('.cmux-split').style.getPropertyValue('--cmux-ratio')"), '65%', 'same split proportion as cmux');
    await run(`(()=>{window.permissionTerminal=document.querySelector('.cmux-terminal textarea');window.permissionWorkspace=window.WhiteboxApp.state.workspace;interactionTest.triggerAttention({activationId:'permission-no-steal',deliveryToken:'fixture-token',sessionId:${JSON.stringify(ownerId)},provider:'codex',source:'hook'});})()`);
    await until("interactionTest.getCalls().some(call=>call.name==='ackAttentionActivation' && call.args[0].status==='notified')", 'permission is acknowledged without terminal navigation');
    assert.equal(await run("window.permissionTerminal===document.querySelector('.cmux-terminal textarea') && !document.querySelector('.cmux-detail').classList.contains('hidden') && window.permissionWorkspace===window.WhiteboxApp.state.workspace"), true, 'permission must preserve the mounted cmux terminal and selected project');
    await run("document.querySelector('.cmux-divider').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))");
    await until("interactionTest.getCalls().some(call=>call.name==='cmuxArrange' && call.args[1].action==='resize')", 'resize reaches cmux API');
    const clickTerminal = async id => {
      const point = await run(`(()=>{const r=document.querySelector('[data-cmux-member="${id}"] canvas').getBoundingClientRect();return {x:Math.round(r.left+20),y:Math.round(r.top+20)}})()`);
      win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
      await until(`document.activeElement===document.querySelector('[data-cmux-member="${id}"] textarea')`, 'click focuses exact terminal input');
    };
    await clickTerminal('cmux:claude');
    win.webContents.sendInputEvent({ type: 'char', keyCode: 'x' });
    await until("interactionTest.getCalls().some(call=>call.name==='cmuxInput' && call.args[1]==='x')", 'terminal input reaches same cmux surface');
    await clickTerminal('cmux:codex');
    assert.equal(await run("cmuxTestTerminals.every(t=>t.options.cursorBlink===false && t.options.cursorStyle==='bar')"), true, 'cmux panes never blink together or draw block cursors');
    assert.equal(await run("cmuxTestTerminals.filter(t=>t.wasmTerm.getCursor().visible).length<=1 && !cmuxTestTerminals[0].wasmTerm.getCursor().visible"), true, 'inactive panel cursor is hidden after focus moves');
    const resizeCounts = await run("cmuxTestTerminals.map(t=>t.testResizeCount)");
    await run(`interactionTest.setCmuxFrame(${JSON.stringify({columns:80,rows:24,ansi:'\x1b[2J\x1b[HFRESH OUTPUT\x1b[?25h',cursor:{row:0,column:12,visible:true}})})`);
    await until("cmuxTestTerminals.every(t=>t.buffer.active.getLine(0).translateToString(true).includes('FRESH OUTPUT'))", 'changed frame painted in every panel');
    assert.deepEqual(await run("cmuxTestTerminals.map(t=>t.testResizeCount)"), resizeCounts, 'new output with the same dimensions does not clear canvases through resize');
    assert.equal(await run("!cmuxTestTerminals[0].wasmTerm.getCursor().visible && cmuxTestTerminals[1].wasmTerm.getCursor().visible===document.hasFocus()"), true, 'native cursor-show frames cannot reactivate unfocused cursors');
    await run("interactionTest.setCmuxFrame(null)");

    win.webContents.sendInputEvent({ type: 'char', keyCode: 'y' });
    await until("interactionTest.getCalls().some(call=>call.name==='cmuxInput' && call.args[0]==='cmux:codex' && call.args[1]==='y')", 'second visible pane receives its own input');
    assert.equal(await run("[...document.querySelectorAll('.cmux-pane')].filter(node=>node.getClientRects().length).length"), 2, 'typing keeps all terminal panes visible');
    cmuxGroup.members[0].title = 'Claude · working';
    await run(`interactionTest.setCmuxInventory({installed:true,error:'',entries:${JSON.stringify(cmuxGroup.members)},groups:[${JSON.stringify(cmuxGroup)}]});window.dispatchEvent(new CustomEvent('whitebox-terminal-inventory-changed'))`);
    await until("document.querySelector('.cmux-tab-title').textContent==='Claude · working'", 'inventory title refresh');
    assert.equal(await run("document.activeElement===document.querySelector('[data-cmux-member=\"cmux:codex\"] textarea')"), true, 'inventory refresh must preserve the input target');
    win.webContents.sendInputEvent({ type: 'char', keyCode: 'z' });
    await until("interactionTest.getCalls().some(call=>call.name==='cmuxInput' && call.args[0]==='cmux:codex' && call.args[1]==='z')", 'input still reaches the clicked pane after refresh');
    assert.equal(await run("document.querySelector('.cmux-pane.is-input-active').dataset.cmuxPane"), 'pane-b', 'input badge follows exact clicked pane');
    await run(`(()=>{const data=new DataTransfer();data.setData('text/plain','한글 붙여넣기');document.activeElement.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()`);
    await until("interactionTest.getCalls().some(call=>call.name==='cmuxInput' && call.args[0]==='cmux:codex' && call.args[1].includes('한글 붙여넣기'))", 'Korean paste reaches only the clicked pane');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await until("interactionTest.getCalls().some(call=>call.name==='cmuxInput' && call.args[0]==='cmux:codex' && call.args[1]==='\\r')", 'Enter submits to same surface');
    await run("document.activeElement.dispatchEvent(new CompositionEvent('compositionstart',{data:'ㅎ',bubbles:true}))");
    cmuxGroup.layout.split = .6;
    await run(`interactionTest.setCmuxInventory({installed:true,error:'',entries:${JSON.stringify(cmuxGroup.members)},groups:[${JSON.stringify(cmuxGroup)}]});window.dispatchEvent(new CustomEvent('whitebox-terminal-inventory-changed'))`);
    await until("window.WhiteboxApp.state.sidebarTerminalEntries.find(entry=>entry.cmuxWorkspace)?.layout.split===.6", 'layout refresh arrives during IME composition');
    await until("[...document.querySelectorAll('[data-cmux-member]')].every(n=>n.dataset.fontSize==='15')", 'readable fixed terminal size');
    assert.equal(await run("[...document.querySelectorAll('.cmux-terminal canvas')].every(n=>n.getBoundingClientRect().width>=600)"), true, '80-column grids retain readable pixels instead of shrinking to the pane');
    await run("document.querySelector('[data-cmux-font=\"1\"]').click()");
    assert.equal(await run("[...document.querySelectorAll('[data-cmux-member]')].every(n=>n.dataset.fontSize==='16')"), true);
    await run("document.querySelector('[data-cmux-font=\"-1\"]').click()");
    assert.equal(await run("document.querySelector('.cmux-split').style.getPropertyValue('--cmux-ratio')"), '65%', 'layout waits until composition commits');
    assert.equal(await run("document.activeElement===document.querySelector('[data-cmux-member=\"cmux:codex\"] textarea')"), true);
    await run("document.activeElement.dispatchEvent(new CompositionEvent('compositionend',{data:'한',bubbles:true}))");
    await until("document.querySelector('.cmux-split').style.getPropertyValue('--cmux-ratio')==='60%'", 'deferred layout applied after composition');
    assert.equal(await run("document.activeElement===document.querySelector('[data-cmux-member=\"cmux:codex\"] textarea')"), true, 'layout changes preserve the input focus');
    fs.writeFileSync(path.join(output, 'cmux-detail.png'), (await win.webContents.capturePage()).toPNG());
    const arrangeCount = await run("interactionTest.getCalls().filter(call=>call.name==='cmuxArrange').length");
    await run("document.querySelector('[data-cmux-expand]').click()");
    assert.equal(await run("[...document.querySelectorAll('.cmux-pane')].filter(node=>node.getClientRects().length).length"), 1, 'focus view shows just one pane');
    assert.equal(await run("window.permissionTerminal===document.querySelector('.cmux-terminal textarea')"), true, 'expanding reuses the mounted terminal');
    await run("document.querySelector('[data-cmux-restore]').click()");
    assert.equal(await run("[...document.querySelectorAll('.cmux-pane')].filter(node=>node.getClientRects().length).length"), 2, 'restoring keeps the synchronized layout');
    assert.equal(await run("interactionTest.getCalls().filter(call=>call.name==='cmuxArrange').length"), arrangeCount, 'local expansion does not change the native layout');
    const headerPoint = await run("(()=>{const r=document.querySelector('.cmux-pane-head').getBoundingClientRect();return {x:Math.round(r.left+30),y:Math.round(r.top+r.height/2)}})()");
    win.webContents.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...headerPoint});
    win.webContents.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,...headerPoint});
    await until("Boolean(document.querySelector('.cmux-arrange-menu:popover-open'))", 'native right mouse click opens menu');
    await run("document.querySelector('[data-cmux-dismiss]').click()");
    assert.equal(await run("document.querySelectorAll('.cmux-pane-menu').length"), 0, 'ellipsis buttons removed');
    await run("document.querySelector('.cmux-pane-head').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:420,clientY:220}))");
    assert.equal(await run("document.querySelector('.cmux-arrange-menu').matches(':popover-open')"), true, 'controls escape small pane clipping');
    await run("document.querySelector('[data-cmux-dismiss]').click();document.querySelector('[data-cmux-tab]').dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}))");
    assert.equal(await run("document.querySelector('.cmux-arrange-menu').matches(':popover-open')"), true, 'keyboard context menu opens the same controls');
    await run("document.querySelector('[data-cmux-dismiss]').click();window.WhiteboxTheme.setTheme('light')");
    await wait(150);
    fs.writeFileSync(path.join(output, 'cmux-detail-light.png'), (await win.webContents.capturePage()).toPNG());
    win.setContentSize(736, 900); await wait(150);
    assert.equal(await run("(()=>{const p=document.querySelector('.cmux-detail'),b=p.getBoundingClientRect();return p.scrollWidth<=p.clientWidth+1 && b.bottom<=innerHeight+1})()"), true, 'integrated workspace fits a narrow app window');
    fs.writeFileSync(path.join(output, 'cmux-detail-narrow.png'), (await win.webContents.capturePage()).toPNG());
    win.setContentSize(1440, 1000); await run("window.WhiteboxTheme.setTheme('dark')");
    // A delayed pre-drop poll must neither delay nor overwrite the fresh layout.
    await until("!document.querySelector('.cmux-detail').hasAttribute('aria-busy')", 'previous arrangement settled');
    await run("interactionTest.configure({delays:{cmuxList:1400}});window.dispatchEvent(new CustomEvent('whitebox-terminal-inventory-changed'))");
    await wait(80);
    cmuxGroup.layout.split = .55;
    await run(`interactionTest.setCmuxInventory({installed:true,error:'',entries:${JSON.stringify(cmuxGroup.members)},groups:[${JSON.stringify(cmuxGroup)}]})`);
    const dropStarted = Date.now();
    await run("(()=>{const nodes=[...document.querySelectorAll('.cmux-pane')],node=nodes[1],r=node.getBoundingClientRect(),data=new DataTransfer();data.setData('application/x-whitebox-cmux','cmux:claude');window.beforeDropInput=document.querySelector('[data-cmux-member=\"cmux:codex\"] textarea');node.dispatchEvent(new DragEvent('dragover',{dataTransfer:data,clientX:r.right-5,clientY:r.top+r.height/2,bubbles:true,cancelable:true}));})()");
    assert.equal(await run("document.querySelector('[data-drop-direction]').dataset.dropDirection"), 'right');
    await run("(()=>{const node=document.querySelector('[data-drop-direction]'),r=node.getBoundingClientRect(),data=new DataTransfer();data.setData('application/x-whitebox-cmux','cmux:claude');node.dispatchEvent(new DragEvent('drop',{dataTransfer:data,clientX:r.right-5,clientY:r.top+r.height/2,bubbles:true,cancelable:true}));})()");
    await until("document.querySelector('.cmux-split').style.getPropertyValue('--cmux-ratio').startsWith('55')", 'drop response paints before slow poll');
    assert.ok(Date.now()-dropStarted < 1000, 'layout cannot wait for 1.4 second inventory');
    assert.equal(await run("window.beforeDropInput===document.querySelector('[data-cmux-member=\"cmux:codex\"] textarea')"), true, 'drag reuses terminal input');
    assert.equal(await run("interactionTest.getCalls().filter(c=>c.name==='cmuxArrange').at(-1).args[1].direction"), 'right');
    await run("interactionTest.clearControls()");
    await wait(1550);
    assert.ok((await run("document.querySelector('.cmux-split').style.getPropertyValue('--cmux-ratio')")).startsWith('55'), 'stale pre-drop poll cannot revert native layout');
    // Use real Chromium pointer capture: the preview must move before release,
    // even while the native command is delayed. Test both divider orientations.
    for (const direction of ['horizontal', 'vertical']) {
      cmuxGroup.layout.direction = direction; cmuxGroup.layout.split = .55;
      await run(`interactionTest.setCmuxInventory({installed:true,error:'',entries:${JSON.stringify(cmuxGroup.members)},groups:[${JSON.stringify(cmuxGroup)}]});window.dispatchEvent(new CustomEvent('whitebox-terminal-inventory-changed'))`);
      await until(`Boolean(document.querySelector('.cmux-split.${direction}')) && !document.querySelector('.cmux-detail').hasAttribute('aria-busy')`, 'divider orientation ready');
      await wait(100);
      const before = await run("(()=>{window.resizeTestPane=document.querySelector('.cmux-pane');window.resizeTestDivider=document.querySelector('.cmux-divider');window.resizeTestInput=document.querySelector('[data-cmux-member=\"cmux:codex\"] textarea');return {calls:interactionTest.getCalls().filter(c=>c.name==='cmuxArrange').length,sizes:cmuxTestTerminals.map(t=>t.testResizeCount)};})()");
      const point = await run("(()=>{const r=document.querySelector('.cmux-divider').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()");
      win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
      await until(`document.querySelector('.cmux-detail').classList.contains('is-resizing-${direction}')`, 'pointer captures divider');
      const previewStarted = Date.now();
      for (let i = 1; i <= 10; i++) win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + (direction === 'horizontal' ? i * 6 : 0), y: point.y + (direction === 'vertical' ? i * 6 : 0), button: 'left' });
      await until("parseFloat(document.querySelector('.cmux-split').style.getPropertyValue('--cmux-ratio'))>57", 'divider preview follows pointer before release');
      assert(Date.now() - previewStarted < 400, 'pointer preview cannot wait for a native inventory poll');
      const preview = await run("document.querySelector('.cmux-split').style.getPropertyValue('--cmux-ratio')");
      await wait(800); // Cross a native frame poll while the pointer remains held.
      assert.equal(await run("document.querySelector('.cmux-split').style.getPropertyValue('--cmux-ratio')"), preview);
      assert.equal(await run("interactionTest.getCalls().filter(c=>c.name==='cmuxArrange').length"), before.calls, 'no native resize commands during drag');
      assert.deepEqual(await run("cmuxTestTerminals.map(t=>t.testResizeCount)"), before.sizes, 'drag must not reflow terminal canvases');
      cmuxGroup.layout.split = .7;
      await run(`interactionTest.configure({delays:{cmuxArrange:700}});interactionTest.setCmuxInventory({installed:true,error:'',entries:${JSON.stringify(cmuxGroup.members)},groups:[${JSON.stringify(cmuxGroup)}]})`);
      win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x + (direction === 'horizontal' ? 60 : 0), y: point.y + (direction === 'vertical' ? 60 : 0), button: 'left', clickCount: 1 });
      await until(`interactionTest.getCalls().filter(c=>c.name==='cmuxArrange').length===${before.calls + 1}`, 'release commits native resize');
      assert.equal(await run("document.querySelector('.cmux-split').style.getPropertyValue('--cmux-ratio')"), preview, 'preview stays visible during native round trip');
      await until("!document.querySelector('.cmux-detail').hasAttribute('aria-busy') && document.querySelector('.cmux-split').style.getPropertyValue('--cmux-ratio')==='70%'", 'native ratio confirmed');
      assert.equal(await run("interactionTest.getCalls().filter(c=>c.name==='cmuxArrange').length"), before.calls + 1, 'one native command per gesture');
      assert.equal(await run("interactionTest.getCalls().filter(c=>c.name==='cmuxArrange').at(-1).args[1].amount"), 60, 'resize sends point distance, not an estimated character count');
      assert.equal(await run("resizeTestPane===document.querySelector('.cmux-pane') && resizeTestDivider===document.querySelector('.cmux-divider') && resizeTestInput===document.querySelector('[data-cmux-member=\"cmux:codex\"] textarea')"), true, 'ratio changes retain entire pane and focused input DOM');
      await run("interactionTest.clearControls()");
      // Cancellation restores the confirmed ratio without changing cmux.
      const cancelPoint = await run("(()=>{const r=document.querySelector('.cmux-divider').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()");
      win.webContents.sendInputEvent({ type: 'mouseDown', ...cancelPoint, button: 'left', clickCount: 1 });
      await until(`document.querySelector('.cmux-detail').classList.contains('is-resizing-${direction}')`, 'cancel gesture starts');
      win.webContents.sendInputEvent({ type: 'mouseMove', x: cancelPoint.x - 30, y: cancelPoint.y - 30, button: 'left' });
      await run("document.querySelector('.cmux-divider').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      win.webContents.sendInputEvent({ type: 'mouseUp', x: cancelPoint.x - 30, y: cancelPoint.y - 30, button: 'left', clickCount: 1 });
      assert.equal(await run("document.querySelector('.cmux-split').style.getPropertyValue('--cmux-ratio')"), '70%');
      assert.equal(await run("interactionTest.getCalls().filter(c=>c.name==='cmuxArrange').length"), before.calls + 1, 'cancelled drag never resizes cmux');
    }
    await run("interactionTest.configure({failures:{cmuxArrange:1},delays:{cmuxArrange:200}})");
    const failedPoint = await run("(()=>{const r=document.querySelector('.cmux-divider').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()");
    win.webContents.sendInputEvent({ type: 'mouseDown', ...failedPoint, button: 'left', clickCount: 1 });
    await until("document.querySelector('.cmux-detail').classList.contains('is-resizing-vertical')", 'failed resize gesture starts');
    win.webContents.sendInputEvent({ type: 'mouseMove', x: failedPoint.x, y: failedPoint.y - 40, button: 'left' });
    await until("parseFloat(document.querySelector('.cmux-split').style.getPropertyValue('--cmux-ratio'))<70", 'failed resize has local preview');
    win.webContents.sendInputEvent({ type: 'mouseUp', x: failedPoint.x, y: failedPoint.y - 40, button: 'left', clickCount: 1 });
    await until("!document.querySelector('.cmux-detail').hasAttribute('aria-busy') && document.querySelector('.cmux-detail-status').textContent.includes('fixture failure')", 'failed resize reported');
    assert.equal(await run("document.querySelector('.cmux-split').style.getPropertyValue('--cmux-ratio')"), '70%', 'failure restores native layout even if inventory is unchanged');
    await run("interactionTest.clearControls()");
    console.log('✓ cmux 경계선: 가로·세로 즉시 미리보기·1회 동기화·입력창 보존·취소·실패 복원');
    cmuxGroup.members.pop();
    await run(`interactionTest.setCmuxInventory({installed:true,error:'',entries:${JSON.stringify(cmuxGroup.members)},groups:[${JSON.stringify(cmuxGroup)}]});window.dispatchEvent(new CustomEvent('whitebox-terminal-inventory-changed'))`);
    await until("document.querySelectorAll('[data-cmux-member]').length===1", 'removed cmux member disappears');
    await run("document.querySelector('[data-cmux-back]').click()");
    assert.equal(await run("document.querySelectorAll('[data-cmux-member]').length"), 0, 'return to overview releases terminal views');
    assert.equal(await run("!document.body.classList.contains('cmux-detail-open') && document.querySelector('[data-cmux-detail]')===document.activeElement"), true, 'back restores the overview and keyboard focus');
    await run(`(()=>{const a=window.WhiteboxApp,s=a.state.snapshot.sessions.find(item=>item.id===${JSON.stringify(ownerId)});a.state.snapshot.sessions.push({...s,id:'codex:folder-filter-test',externalId:'folder-filter-test',updatedAt:new Date().toISOString(),title:'다른 폴더의 독립 작업',cwd:${JSON.stringify(directory + '/other')},originCwd:${JSON.stringify(directory + '/other')},workspace:${JSON.stringify(directory + '/other')},workspaceRoots:[],runtimePresence:[],parentId:null});a.state.sidebarTree.assignments.push({projectKey:${JSON.stringify(directory)},sessionId:'codex:folder-filter-test',folderId:''});a.renderWorkspaces();a.renderSessions();})()`);
    await run(`document.querySelector('[data-path-tree-toggle="${directory}/other" i] b').click()`);
    await until("document.querySelectorAll('.cmux-overview-card').length===0", 'another folder excludes cmux');
    assert.equal(await run("document.querySelector('#projectTaskProjectName').textContent"), 'other');
    assert.equal(await run("window.WhiteboxSidebarTree.matchesFilter(window.WhiteboxApp.state,window.WhiteboxApp.state.snapshot.sessions.find(s=>s.id==='codex:folder-filter-test'))"), true);
    assert.equal(await run(`window.WhiteboxSidebarTree.matchesFilter(window.WhiteboxApp.state,{id:'cmux-workspace:fixture',cwd:${JSON.stringify(directory)}})`), false);
    await run(`document.querySelector('[data-workspace="${directory}"]').click()`);
    await until("document.querySelectorAll('.cmux-overview-card').length===1", 'parent project restores cmux');
    await run(`whitebox.terminalGroupCreate({cwd:${JSON.stringify(directory)},ownerId:'codex:folder-filter-test',name:'예전 빈 그룹'})`);
    await run("document.querySelector('[data-sidebar-session-id=\"codex:folder-filter-test\"]').click()");
    assert.equal(await run("document.querySelector('#terminalGroupPanel').classList.contains('hidden')"), true, 'ordinary sessions never open an empty group');
    assert.equal(await run("window.WhiteboxApp.state.sidebarFolderFilter.entryId"), 'codex:folder-filter-test', 'ordinary selection retains the exact session identity');
    assert.equal(await run("window.WhiteboxCmux.groupsForWorkspace().length"), 0, 'ordinary selection excludes cmux even within the same parent project');
    assert.equal(await run("window.WhiteboxApp.filteredSessions().every(s=>s.id==='codex:folder-filter-test' || s.parentId==='codex:folder-filter-test')"), true, 'ordinary selection excludes sibling sessions');
    await run("window.WhiteboxApp.closePtyFocus({restoreFocus:false})");
    const otherCmuxGroup = { ...cmuxGroup, id: 'cmux-workspace:other', title: '두 번째 작업 공간', members: [{ id: 'cmux:other', paneId: 'pane-c', title: 'Other', cwd: directory, selected: true }] };
    const inventory = { installed: true, error: '', entries: [...cmuxGroup.members, ...otherCmuxGroup.members], groups: [cmuxGroup, otherCmuxGroup] };
    await run(`interactionTest.setCmuxInventory(${JSON.stringify(inventory)});window.dispatchEvent(new CustomEvent('whitebox-terminal-inventory-changed'))`);
    await until("document.querySelectorAll('[data-cmux-workspace]').length===2", 'two cmux groups under the same project');
    for (const selected of [cmuxGroup, otherCmuxGroup, cmuxGroup]) {
      await run(`document.querySelector('[data-cmux-workspace="${selected.id}"]').click()`);
      assert.deepEqual(await run("[...document.querySelectorAll('.cmux-overview-card strong')].map(node=>node.textContent)"), [selected.title], 'only the clicked cmux group appears');
      assert.equal(await run("window.WhiteboxApp.graphFilteredSessions().length"), 0, 'cmux selection excludes the Whitebox-like sibling task');
      await run("window.dispatchEvent(new CustomEvent('whitebox-terminal-inventory-changed'))");
      await wait(100);
      assert.equal(await run("document.querySelectorAll('.cmux-overview-card').length"), 1, 'inventory refresh preserves exact selection');
    }
    await run(`document.querySelector('[data-path-tree-toggle="${directory}/other" i] b').click()`);
    assert.equal(await run("window.WhiteboxCmux.groupsForWorkspace().length"), 0, 'folder selection replaces exact cmux selection');
    await run(`document.querySelector('[data-workspace="${directory}"]').click()`);
    assert.equal(await run("window.WhiteboxCmux.groupsForWorkspace().length"), 2, 'parent selection restores both cmux groups');
    cmuxGroup.members[0].currentSessionId = 'cmux-leader-quiz';
    cmuxGroup.members[0].sessionIds = ['cmux-leader-quiz', 'cmux-previous-quiz'];
    cmuxGroup.members.push({ id: 'cmux:codex', paneId: 'pane-b', selected: true, title: 'Codex', cwd: directory, currentSessionId: 'cmux-worker-quiz' });
    await run(`interactionTest.setCmuxInventory({installed:true,error:'',entries:${JSON.stringify([...cmuxGroup.members,...otherCmuxGroup.members])},groups:${JSON.stringify([cmuxGroup,otherCmuxGroup])}});window.dispatchEvent(new CustomEvent('whitebox-terminal-inventory-changed'))`);
    await until("window.WhiteboxApp.state.sidebarTerminalEntries.some(g=>g.members?.some(m=>m.currentSessionId==='cmux-leader-quiz'))", 'live current conversation binding');
    const leaderQuiz = { ...quizTask('cmux-leader-quiz', '오케스트레이터 작업 질문지'), cwd: directory,
      cmux: { workspaceId: cmuxGroup.id, role: 'orchestrator', title: cmuxGroup.title, cwd: directory } };
    const workerQuiz = { ...quizTask('cmux-worker-quiz', '작업자 질문지'), cwd: directory,
      cmux: { workspaceId: cmuxGroup.id, role: 'worker', title: cmuxGroup.title, cwd: directory } };
    const unrelatedCmuxNeighbor = { ...quizTask('unrelated-cmux-neighbor', '일반 작업'), cwd: directory, status: 'running', completionObserved: false, comprehension: null };
    await run(`interactionTest.addSession(${JSON.stringify(unrelatedCmuxNeighbor)});interactionTest.addSession(${JSON.stringify(leaderQuiz)});interactionTest.addSession(${JSON.stringify(workerQuiz)});interactionTest.emitSnapshot()`);
    const oldQuiz = { ...leaderQuiz, id: 'cmux-previous-quiz', comprehension: { ...leaderQuiz.comprehension, packet: { ...leaderQuiz.comprehension.packet, title: '이전 대화의 무관한 질문지' } } };
    await run(`interactionTest.addSession(${JSON.stringify(oldQuiz)});interactionTest.emitSnapshot()`);
    await until("window.WhiteboxApp.state.snapshot.sessions.some(s=>s.id==='cmux-leader-quiz')", 'cmux questionnaire snapshot');
    await run(`document.querySelector('[data-cmux-workspace="${cmuxGroup.id}"]').click()`);
    await until("document.querySelectorAll('[data-questionnaire-open]').length===1", 'selected group shows only orchestrator questionnaire');
    assert.ok(await run("document.querySelector('[data-questionnaire-open]').textContent.includes('오케스트레이터 작업 질문지')"));
    await run("document.querySelector('[data-cmux-detail]').click()");
    await until("!document.querySelector('[data-cmux-questionnaire]').hidden", 'questionnaire available inside multi-terminal view');
    await run("document.querySelector('[data-cmux-questionnaire]').click()");
    assert.equal(await run("window.WhiteboxApp.comprehensionPacketController.getSessionId()"), leaderQuiz.id);
    assert.equal(await run("window.WhiteboxApp.comprehensionPacketController.isOpen()"), true);
    await run("document.querySelector('#comprehensionPacketClose').click()");
    assert.equal(await run("[...document.querySelectorAll('[data-cmux-session-status]')].every(n=>n.dataset.status==='completed')"), true, 'each title shows the matching completed session status');
    await run("interactionTest.updateSession('cmux-leader-quiz',{status:'running',completionObserved:false,comprehension:null,comprehensionOrigin:null});interactionTest.emitSnapshot()");
    await until("document.querySelector('[data-cmux-session-status=\"cmux:claude\"]').dataset.status==='running'", 'status follows only its own session');
    assert.equal(await run("document.querySelector('[data-cmux-session-status=\"cmux:codex\"]').dataset.status"), 'completed');
    await run("interactionTest.updateSession('cmux-worker-quiz',{attention:{category:'required',source:'execution-approval'}});interactionTest.emitSnapshot()");
    await until("document.querySelector('[data-cmux-session-status=\"cmux:codex\"]').dataset.status==='waiting'", 'permission takes priority over a completed snapshot');
    assert.equal(await run("document.querySelector('[data-cmux-session-status=\"cmux:claude\"]').dataset.status"), 'running', 'worker approval cannot change the leader status');

    assert.equal(await run("document.querySelectorAll('[data-questionnaire-open]').length"), 0, 'new prompt removes both old-turn and old-conversation quizzes');
    assert.equal(await run("document.querySelector('[data-cmux-questionnaire]').disabled"), true, 'running leader shows completion-wait state');
    const nextQuiz = { ...leaderQuiz, comprehensionOrigin: { ...leaderQuiz.comprehensionOrigin, generation: 'b'.repeat(64) }, comprehension: { ...leaderQuiz.comprehension, packet: { ...leaderQuiz.comprehension.packet, title: '현재 완료 작업 질문지' } } };
    await run(`interactionTest.updateSession('cmux-leader-quiz',${JSON.stringify(nextQuiz)});interactionTest.emitSnapshot()`);
    await until("document.querySelectorAll('[data-questionnaire-open]').length===1 && document.querySelector('[data-questionnaire-open]').textContent.includes('현재 완료 작업 질문지')", 'only the current completed turn is offered');

    await run("interactionTest.updateSession('cmux-leader-quiz',{comprehension:{status:'failed',failureReason:'invalid-response'}});interactionTest.emitSnapshot()");
    await until("document.querySelector('[data-cmux-questionnaire]').textContent==='AI 질문지 다시 만들기'", 'failed leader offers explicit retry');
    await run("document.querySelector('[data-cmux-questionnaire]').click()");
    await until("interactionTest.getCalls().some(c=>c.name==='retryQuestionnaire'&&c.args[0]==='cmux-leader-quiz')", 'retry targets exact active orchestrator');
    await until("document.querySelector('[data-cmux-questionnaire]').disabled && document.querySelector('[data-cmux-questionnaire]').textContent.includes('생성 중')", 'pending retry is visible');
    await run("(()=>{const a=window.WhiteboxApp;a.state.sourcePluginSettings.enabledPluginIds=a.state.sourcePluginSettings.enabledPluginIds.filter(id=>id!=='builtin.cmux');window.dispatchEvent(new CustomEvent('whitebox-terminal-inventory-changed'));a.state.snapshot=a.projectVisibleSnapshot(a.state.rawSnapshot);a.render();})()");
    assert.equal(await run("document.querySelectorAll('[data-cmux-workspace], .cmux-overview-card, [data-cmux-member]').length"), 0, 'disable immediately removes groups, cards and mounted terminals');
    assert.equal(await run("document.body.classList.contains('cmux-detail-open')"), false);
    assert.equal(await run("window.WhiteboxApp.state.snapshot.sessions.some(s=>s.cmux)"), false, 'cmux conversations cannot return as ordinary Whitebox sessions');
    assert.equal(await run("window.WhiteboxApp.state.snapshot.sessions.some(s=>s.id==='unrelated-cmux-neighbor')"), true, 'unrelated same-project Whitebox session survives');
    await wait(100);
    assert.equal(await run("document.querySelectorAll('[data-cmux-workspace],.cmux-overview-card').length"), 0, 'stale inventory cannot resurrect disabled integration');
    await run("(()=>{const a=window.WhiteboxApp;a.state.sourcePluginSettings.enabledPluginIds.push('builtin.cmux');a.state.snapshot=a.projectVisibleSnapshot(a.state.rawSnapshot);window.dispatchEvent(new CustomEvent('whitebox-terminal-inventory-changed'));a.render();})()");
    await until("document.querySelectorAll('[data-cmux-workspace]').length===2", 'reenable restores native group inventory');
    console.log('✓ cmux 플러그인 끄기·재연결·오케스트레이터 설문지 필터·터미널 화면에서 설문지 열기');
    console.log('✓ 실제 Whitebox 렌더러 + IPC + tmux: 그룹 열기·AI 2개 추가·확대/복원·키보드 입력·제외 시 화면/런타임 삭제·전체 삭제');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    win.destroy(); await manager.dispose();
    try { runtime.execute({ tmuxSocket: socket }, ['kill-server']); } catch (_) { /* Test server already empty. */ }
    fs.rmSync(directory, { recursive: true, force: true }); app.exit(process.exitCode || 0);
  }
});
