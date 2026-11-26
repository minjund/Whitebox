'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TerminalManager } = require('../src/terminalManager');
const WhiteboxWorkspaceLayout = require('../renderer/terminal-workspace-layout');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-workspace-check-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  let win;
  const manager = new TerminalManager({ storeFile: path.join(profile, 'terminals.json') });
  const activityReader = new (require('../src/terminalActivity').TerminalActivity)();
  const chatFixture = process.argv.includes('--chat-only') ? require('./tests/terminal-chat-mode').createFixture({ manager, profile, root }) : null;
  const errors = [];
  const captured = new Map();
  const adapterDirectory = path.join(profile, 'panel-bin');
  const providerAdapter = require('../bin/panel-provider');
  providerAdapter.install({ directory: adapterDirectory });
  let livePanelControl, suppressedRemovalId = '';
  let heldReplayId = '', releaseHeldReplay;
  const terminalGetReads = [];
  const startupPidRace = { enabled:process.argv.includes('--startup-reconnect-only'), id:'', live:null, stale:null, delivered:false, hold:true, preReadyReads:0 };
  let heldPauseReviewId = '', releaseHeldPauseReview;
  let analysisOptions, lastSubmission, clipboardText, collaborationPayload, lastDetail;
  let staleCollaborationFrameOnce = null, staleCollaborationFramesServed = 0;
  const lastFullFrames = new Map();
  const resolveFrameMarkers = payload => !Array.isArray(payload?.frames) ? payload : { ...payload, frames: payload.frames.map(frame => {
    if (typeof frame?.text === 'string') { lastFullFrames.set(frame.id, frame); return frame; }
    const previous = lastFullFrames.get(frame?.id);
    assert(frame?.unchanged === true && previous?.creationId === frame.creationId && previous.outputSequence === frame.outputSequence,
      'a frame without text must be an unchanged marker for the last full frame');
    return previous;
  }) };
  let completedActivityId = '';
  const { TerminalCompletionTracker } = require('../src/terminalCompletionBadge');
  const completionTracker = new TerminalCompletionTracker();
  const activityOverrides = new Map();
  let holdCollaborationReply = false, releaseCollaborationReply;
  let jevConfigured = false, jevConfigureCalls = 0, jevConfigureFailure = '';
  let jevSavedKey = '', jevRevealCalls = 0, jevRevealDeferred = false;
  let reviewRetryAt = null;
  let forcedReviewCalls = 0;
  const manualReviewCalls = [];
  let manualReviewDeferred = false, releaseManualReview;
  let requestSummary = '';
  let gateFixture = null, legacyTyped = false;
  let contentFixture = null;
  let recordOnly = false, deferred = false, reviewSchema = 3, lifecycle = 'completed', unverified = [], startedAt = null;
  let toolEvidence = { source: 'session', items: Array.from({ length: 3 }, () => ({ name: 'WebFetch', status: 'returned', target: 'https://arxiv.org/html/2610.28380v1', excerpt: 'Received 395.7KB (200 OK)' })), omitted: 0 };
  let reviewState, retainedReviewFailure = false, suppressReview = false, rejectRestoreIdentity = false, missingSessionId = '', rejectedCloseId = '', rejectedStopId = '', stopCalls = 0, collaborationFailure = '';
  const otherProject = path.join(profile, 'other-project');
  fs.mkdirSync(otherProject);
  let workspaces = [{ name: 'Whitebox test', path: profile }, { name: 'Other project', path: otherProject }];
  let analysisStamp = 'first', analysisRevision = 1, accountUsageCalls = 0;
  let reportedUsage = { input: 1200, output: 200, cachedInput: 900, cacheWrite: 0, total: 1400 };
  const initialAvailableUpdate = { status: 'available', currentVersion: '2.0.0', latestVersion: '2.0.1', installMode: 'automatic', asset: { name: 'fixture-installer' }, notes: '<script>release notes stay text</script>', checkedAt: '2026-10-22T08:00:00Z' };
  let bootstrapUpdate = { status: 'checking', currentVersion: '2.0.0' }, bootstrapPush = initialAvailableUpdate;
  let updateCheckCalls = 0, updateInstallCalls = 0, releasePageCalls = 0, updateCheckFailure = '', finishUpdateInstall;
  let updateCheckResponse = { status: 'current', currentVersion: '2.0.0', latestVersion: '2.0.0' };
  let delayCreation = false, releaseCreation, rejectCreation = false;
  // A whole-run backstop only: every step has its own bounded wait. The full
  // run takes about 70s on a macOS Intel runner and up to 1.5x that on a slow
  // one, so a 90s backstop failed healthy runs.
  const deadline = setTimeout(() => { console.error('Workspace E2E timed out'); app.exit(1); }, 300000);
  try {
    ipcMain.handle('app:bootstrap', event => { if (bootstrapPush) event.sender.send('app:update-state', bootstrapPush); return ({ update: bootstrapUpdate, versions: { app: '2.0.0' }, platform: { id: process.platform, localShell: process.platform === 'win32' ? 'powershell' : 'shell' }, workspaces, terminalWorkspace: { defaultCwd: profile } }); });
    ipcMain.handle('app:update-check', event => { updateCheckCalls++; if (updateCheckFailure) throw new Error(updateCheckFailure); event.sender.send('app:update-state', updateCheckResponse); return updateCheckResponse; });
    ipcMain.handle('app:update-install', () => { updateInstallCalls++; return new Promise(resolve => { finishUpdateInstall = resolve; }); });
    ipcMain.handle('app:update-open-release', () => { releasePageCalls++; return { ok: true }; });
    ipcMain.handle('workspaces:remove', (_event, folder) => { workspaces = workspaces.filter(item => item.path !== folder); return workspaces; });
    for (const name of ['app:set-locale', 'app:set-theme-appearance', 'app:sync-attention-prompts']) ipcMain.handle(name, () => ({ ok: true }));
    if (chatFixture) ipcMain.handle('app:notify-attention-prompt', () => ({ ok: true }));
    ipcMain.handle('terminals:conversation', (_event, payload) => chatFixture ? chatFixture.conversation(payload) : { available: false, reason: 'log' });
    let initialInventoryReads = 0, rendererReadyCalls = 0, inventoryUnavailable = false;
    ipcMain.handle('app:renderer-ready', () => {
      assert(initialInventoryReads >= 3, 'renderer readiness must follow recovery of the initial host connection');
      rendererReadyCalls += 1;
      return { ok: true };
    });
    ipcMain.handle('terminals:completion-read', (_event, payload) => completionTracker.read(payload));
    ipcMain.handle('terminals:collaboration', async (_event, rawPayload) => {
      if (chatFixture) return chatFixture.collaboration(rawPayload);
      if (collaborationFailure) throw new Error(collaborationFailure);
      // The renderer sends an `unchanged` marker instead of repeating screen
      // text. Main keeps the last full frame; model that retention here.
      const payload = resolveFrameMarkers(rawPayload);
      collaborationPayload = payload;
      if (livePanelControl) return livePanelControl.sync(rawPayload);
      if (payload.operation === 'sync' && staleCollaborationFrameOnce
        && payload.frames.some(frame => frame.id === staleCollaborationFrameOnce.id)) {
        collaborationPayload = { ...payload, frames: payload.frames.map(frame => frame.id === staleCollaborationFrameOnce.id ? staleCollaborationFrameOnce : frame) };
        staleCollaborationFrameOnce = null;
        staleCollaborationFramesServed++;
      }
      if (payload.operation === 'connect') return { ok: true };
      const frames = new Map((payload.frames || []).map(frame => [frame.id, { ...frame, at: Date.now() }]));
      const activity = await activityReader.observe((payload.groups || []).flatMap(group => group.members), frames);
      if (completedActivityId && activity.has(completedActivityId)) activity.set(completedActivityId, { ...activity.get(completedActivityId), state: 'idle', completed: true });
      for (const [id, value] of activityOverrides) if (activity.has(id)) activity.set(id, { ...activity.get(id), ...value });
      const result = completionTracker.update({ jobs: [], connected: [], panels: (payload.groups || []).map(group => ({ ...group, members: group.members.map(member => ({ ...member, activity: activity.get(member.id) })) })) }, payload.groups);
      if (holdCollaborationReply) { holdCollaborationReply = false; await new Promise(resolve => { releaseCollaborationReply = resolve; }); }
      return result;
    });
    ipcMain.handle('terminals:jev-status', () => ({ configured: jevConfigured }));
    ipcMain.handle('terminals:jev-configure', (_event, payload) => { jevConfigureCalls++; if (jevConfigureFailure) throw new Error(jevConfigureFailure); jevSavedKey = payload.remove ? '' : payload.apiKey; jevConfigured = Boolean(jevSavedKey); return { configured: jevConfigured }; });
    ipcMain.handle('terminals:jev-reveal', async () => { jevRevealCalls++; if(jevRevealDeferred) await new Promise(resolve=>setTimeout(resolve,250)); return {apiKey:jevSavedKey}; });
    ipcMain.handle('terminals:review-models', () => ({ codex: [{id:'fixture-model',label:'Fixture model'}], claude: [{id:'sonnet',label:'Sonnet'}] }));
    ipcMain.handle('terminals:slash-commands', (_event, payload) => require('../src/slashCommandCatalog').listSlashCommands({ provider: payload?.provider, home: profile }));
    ipcMain.handle('providers:usage', () => { accountUsageCalls++; return ({ providers: {codex:{available:true,updatedAt:new Date().toISOString(),weekly:{label:'주간 한도',usedPercent:12.3}},claude:{available:false}} }); });
    ipcMain.handle('clipboard:write', (_event, text) => { clipboardText = text; return { ok: true }; });
    ipcMain.handle('wsl:list-distros', () => []);
    ipcMain.handle('agents:snapshot', () => ({ sessions: [] }));
    ipcMain.handle('terminals:list', () => {
      initialInventoryReads += 1;
      if (initialInventoryReads <= 2 || inventoryUnavailable) throw new Error('fixture: packaged terminal host is still starting');
      return manager.list();
    });
    for (const op of ['get', 'create', 'write', 'resize', 'close', 'reconnect']) ipcMain.handle(`terminals:${op}`, (_event, ...args) => manager[op](...args));
    ipcMain.removeHandler('terminals:create');
    ipcMain.handle('terminals:create', async (_event, options) => {
      if (delayCreation) await new Promise(resolve => { releaseCreation = resolve; });
      if (rejectCreation) throw new Error('fixture creation failure');
      const created = await providerAdapter.createWorkspaceTerminal(manager, options, adapterDirectory);
      if (!startupPidRace.enabled || startupPidRace.id) return created;
      startupPidRace.id = created.id;
      const until = Date.now() + 10000;
      while (!(manager.get(created.id, false)?.pid > 0)) {
        if (Date.now() >= until) throw new Error('Startup PID fixture requires a real live PTY');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      startupPidRace.live = manager.get(created.id, false);
      startupPidRace.stale = { ...startupPidRace.live, pid:null, outputSequence:0,
        updatedAt:new Date(Date.parse(startupPidRace.live.updatedAt) - 1).toISOString() };
      return startupPidRace.stale;
    });
    ipcMain.handle('terminals:stop', (_event, id) => { stopCalls++; if (id === rejectedStopId) throw new Error('fixture stop failure'); return manager.stop(id); });
    ipcMain.removeHandler('terminals:close');
    ipcMain.handle('terminals:close', (_event, id) => { if (id === rejectedCloseId) throw new Error('fixture close failure'); return manager.close(id); });
    ipcMain.removeHandler('terminals:get');
    ipcMain.handle('terminals:get', async (_event, id, includeReplay = true) => {
      const full = includeReplay !== false;
      terminalGetReads.push({ id, full });
      const session = manager.get(id, full);
      // main.js forwards terminal state only after app:renderer-ready, so the
      // PID published while the startup pane mounts never reaches the
      // renderer. Pre-ready metadata reads see only the pending snapshot.
      if (startupPidRace.enabled && id === startupPidRace.id && !full && !rendererReadyCalls) {
        startupPidRace.preReadyReads += 1;
        return startupPidRace.stale;
      }
      if (startupPidRace.enabled && id === startupPidRace.id && !full && !startupPidRace.delivered) {
        startupPidRace.delivered = true;
        win.webContents.send('terminals:state', { change:'pid-fixture-ready', session:startupPidRace.live, sessions:[startupPidRace.live] });
        await win.webContents.executeJavaScript(`new Promise((resolve,reject) => {
          const until=performance.now()+3000;
          const poll=() => window.__startupPidFixtureReady ? resolve(true) : performance.now()>until ? reject(Error('PID state fixture event was not delivered')) : setTimeout(poll,0);
          poll();
        })`, true);
        return startupPidRace.stale;
      }
      if (id === heldReplayId && full) await new Promise(resolve => { releaseHeldReplay = resolve; });
      if (id === missingSessionId) return null;
      return rejectRestoreIdentity && session ? { ...session, creationId: 'different-identity' } : session;
    });
    ipcMain.handle('terminals:review', async (_event, payload) => {
      if (chatFixture) return chatFixture.review(payload);
      if (payload.historyContent) return { entries: [] };
      // The app no longer asks for forced analyses; a capture of the selected terminal is marked foreground.
      if(payload.force || payload.foreground)forcedReviewCalls++;
      if (payload.reanalyze) {
        manualReviewCalls.push({ id: payload.id, creationId: payload.creationId, enabled: payload.enabled });
        if (manualReviewDeferred) await new Promise(resolve => { releaseManualReview = resolve; });
        analysisRevision++;
      }
      if (payload.enabled === false) {
        if (payload.id === heldPauseReviewId) await new Promise(resolve => { releaseHeldPauseReview = resolve; });
        return { state: 'paused', provider: 'claude' };
      }
      analysisOptions = payload.analysis;
      if (payload.detail) lastDetail = payload.detail;
      if (payload.submission) lastSubmission = payload.submission;
      captured.set(payload.id, payload.text);
      const observedText = payload.text.replace(/\s+/g, '');
      const marker = observedText.includes('ONE_ONLY') ? 'ONE_ONLY' : observedText.includes('TWO_ONLY') ? 'TWO_ONLY' : observedText.includes('TRASH_KEPT') ? 'TRASH_KEPT' : '';
      return { failure: retainedReviewFailure ? { taskId: `${marker}:${analysisStamp}`, retainedAnalysisId: `${marker}:${analysisStamp}:${analysisRevision}`, retainedLifecycle: 'in-progress', kind: 'updated-evidence' } : null, startedAt, retryAt:reviewRetryAt, preview: startedAt ? { request: marker, lifecycle: 'in-progress', facts: ['AI의 현재 보고: 결과 표시를 수정했습니다.'] } : null, currentTaskId: reviewState ? 'new-pending-task' : `${marker}:${analysisStamp}`, elapsedSeconds: 17, state: reviewState || (marker ? 'ready' : 'shell'), provider: 'claude', providerPid: manager.get(payload.id)?.pid + 1, result: marker && !suppressReview ? { observedAt: '2026-10-21T12:00:00Z', usage: reportedUsage, analysisProvider: payload.analysis?.provider === 'claude' ? 'claude' : 'codex', analysisModel: payload.analysis?.models?.codex || '', tasks: [{ taskId: `${marker}:${analysisStamp}`, analysisId: `${marker}:${analysisStamp}:${analysisRevision}`, analysisUsage: reportedUsage, analysisGate: gateFixture, ...(legacyTyped ? { typedAnalysis: { findings: [{ text: 'JEV_OLD_CONCLUSION_SENTINEL' }], probabilities: { fulfilled: .987654321 } } } : {}), recordOnly, deferred, summary: requestSummary && marker === 'ONE_ONLY' ? `${requestSummary} ${marker}` : marker, reviewSchema, lifecycle, unverified, content: contentFixture, why: '요청한 결과를 이해할 수 있도록 변경했습니다.', toolEvidence, analysisProvider: recordOnly ? 'local' : 'codex', reviewEvidence: marker, request: deferred ? 'DEFERRED_USER_MESSAGE' : marker, requestQuote: marker, actual: `${marker} 출력`, evidenceQuote: marker, alignment: 'unknown', explanation: '테스트용 검토 데이터', understanding: '실제 PTY 출력 격리 확인', verification: '터미널 출력 관찰', remaining: '화면에서 확인 필요', impact: '다른 화면의 영향 미확인', nextStep: '방금 수정한 문구가 화면에 보이는지 확인해줘.' }] } : null };
    });
    win = new BrowserWindow({ width: 1450, height: 900, show: false, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.setContentSize(1450, 900);
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    manager.on('data', payload => { if (!win.isDestroyed()) win.webContents.send('terminals:data', payload); });
    manager.on('state', payload => { if (startupPidRace.enabled && startupPidRace.hold && payload.session?.id === startupPidRace.id) return; if (!win.isDestroyed() && !(payload.change === 'removed' && payload.session?.id === suppressedRemovalId)) win.webContents.send('terminals:state', payload); });
    if (startupPidRace.enabled) win.webContents.on('dom-ready', () => {
      win.webContents.executeJavaScript(`window.whitebox.onTerminalState(value => {
        if(value.change==='pid-fixture-ready') window.__startupPidFixtureReady=true;
        if(value.change==='pid-fixture-stale') window.__startupPidFixtureStale=true;
      }); true`).catch(error => errors.push(String(error)));
    });
    const evaluate = async expression => {
      try { return await win.webContents.executeJavaScript(expression, true); }
      catch (error) { throw new Error(`${expression}: ${error.message}; console=${JSON.stringify(errors)}`); }
    };
    // Transport fixture data as CDP values instead of interpolating it into code.
    const evaluateData = async (fn, ...args) => {
      const debuggerClient = win.webContents.debugger;
      const attachedHere = !debuggerClient.isAttached();
      if (attachedHere) debuggerClient.attach('1.3');
      let objectId;
      try {
        const context = await debuggerClient.sendCommand('Runtime.evaluate', { expression: 'globalThis' });
        objectId = context.result.objectId;
        const result = await debuggerClient.sendCommand('Runtime.callFunctionOn', {
          objectId, functionDeclaration: fn.toString(), arguments: args.map(value => ({ value })),
          returnByValue: true, awaitPromise: true, userGesture: true,
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
        return result.result.value;
      } finally {
        if (objectId) await debuggerClient.sendCommand('Runtime.releaseObject', { objectId });
        if (attachedHere) debuggerClient.detach();
      }
    };
    const forceCapture = async () => {
      // Await the selected terminal refresh reaching this fixture, including a
      // refresh queued behind an in-flight observation, before asserting its UI.
      for (let attempt = 0; attempt < 150; attempt++) {
        const before = forcedReviewCalls;
        await evaluate('WhiteboxWorkspace.captureReviews(true)');
        if (forcedReviewCalls > before) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Forced review never reached the fixture');
    };
    const waitFor = async (expression, label) => {
      for (let attempt = 0; attempt < 150; attempt += 1) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`${label}: ${JSON.stringify(errors)}`);
    };
    // Understand · Review is gone: at every width the canvas takes the space
    // next to the sidebar and only the sidebar keeps a settings entry.
    const checkResponsiveReview = async () => {
    assert.equal(await evaluate('document.querySelectorAll(".wb-top-actions [data-action=settings]").length'), 0, 'topbar has no duplicate settings icon');
    assert.equal(await evaluate('document.querySelectorAll(".wb-sidebar-bottom [data-action=settings]").length'), 1, 'sidebar settings entry remains available');
    for (const width of [1000, 640, 360]) {
      win.setContentSize(width, 720);
      await waitFor(`innerWidth === ${width}`, 'responsive viewport');
      const geometry = await evaluate(`(() => { const main = document.querySelector('.wb-main').getBoundingClientRect();
        return { review: Boolean(document.querySelector('#wbReview, #wbReviewToggle')), right: Math.round(main.right), width: innerWidth }; })()`);
      assert(!geometry.review && Math.abs(geometry.right - geometry.width) <= 1, JSON.stringify({ width, geometry }));
    }
    win.setContentSize(1450, 900);
    console.log('PASS responsive workspace without Understand · Review: the canvas reaches the right edge at 360/640/1000px and one sidebar settings entry');
    };
    await win.loadFile(path.join(root, 'renderer/index.html'));
    await waitFor('Boolean(window.WhiteboxWorkspace)', 'workspace bootstrap');
    if (process.argv.includes('--startup-ready-only')) {
      await require('./tests/workspace-startup-ready')({ evaluate, waitFor, win, manager, readyCalls: () => rendererReadyCalls,
        holdReplay: id => { heldReplayId = id; }, releaseReplay: () => { heldReplayId = ''; releaseHeldReplay?.(); } });
      clearTimeout(deadline); await manager.dispose(); win.destroy(); app.exit(0); return;
    }
    if (process.argv.includes('--project-reorder-only')) {
      await require('./tests/workspace-project-reorder')({ evaluate, waitFor, win, manager });
      clearTimeout(deadline); await manager.dispose(); win.destroy(); app.exit(0); return;
    }
    if (process.argv.includes('--startup-reconnect-only')) {
      await require('./tests/workspace-startup-reconnect')({ evaluate, waitFor, win, manager, pidRace:startupPidRace, unavailable: value => { inventoryUnavailable = value; }, counters: () => ({ ready: rendererReadyCalls, reads: initialInventoryReads }) });
      clearTimeout(deadline); await manager.dispose(); win.destroy(); app.exit(0); return;
    }
    if (process.argv.includes('--chat-only')) {
      await require('./tests/terminal-chat-mode').run({ evaluate, waitFor, manager, win, fixture: chatFixture });
      clearTimeout(deadline); await manager.dispose(); win.destroy(); app.exit(0); return;
    }
    if (process.argv.includes('--groups-only')) {
      await require('./tests/workspace-groups')({ evaluate, waitFor, win, manager });
      clearTimeout(deadline); await manager.dispose(); win.destroy(); app.exit(0); return;
    }
    if (process.argv.includes('--hide-only')) {
      await require('./tests/terminal-hide-view')({ evaluate, waitFor, win, manager, profile });
      clearTimeout(deadline); await manager.dispose(); win.destroy(); app.exit(0); return;
    }
    if (process.argv.includes('--responsive-only')) {
      await checkResponsiveReview();
      clearTimeout(deadline); await manager.dispose(); win.destroy(); app.exit(0); return;
    }
    await evaluate("WhiteboxI18n.setLocale('ko')");
    await win.reload();
    await waitFor('Boolean(window.WhiteboxWorkspace)', 'Korean locale bootstrap');
    assert.equal(await evaluate('document.querySelector(".wb-toolbar, .wb-panel-toolbar, .wb-panel-surface")'), null, 'middle toolbar rows and outer frame are removed');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".wb-main")).padding'), '0px', 'terminal area uses its original full-width layout');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#wbCanvas")).padding'), '0px', 'terminal splits have no added outer padding');
    assert.equal(await evaluate('WhiteboxTerminalEngine.workspaceOptions(14).lineHeight'), 1.28, 'original terminal line spacing');
    assert.equal(await evaluate('document.querySelector("#wbReview, #wbReviewToggle, #wbReviewTabs")'), null, 'Understand · Review is gone');
    assert.equal(await evaluate('document.querySelector("#wbNewTerminal, .wb-work-heading, .wb-panel-heading-row, .wb-panel-color")'), null, 'approved workspace has no introduction, central create button or color-only tabs');
    const searchSelection = await evaluate('WhiteboxWorkspace.getState().selectedSpace');
    await evaluate('document.querySelector("#wbProjectSearch").value = "Other project"; document.querySelector("#wbProjectSearch").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('document.querySelectorAll("#wbSpaces .wb-project").length'), 1);
    assert.equal(await evaluate('WhiteboxWorkspace.getState().selectedSpace'), searchSelection, 'search filters navigation without changing active work');
    await evaluate('document.querySelector("#wbProjectSearch").value = ""; document.querySelector("#wbProjectSearch").dispatchEvent(new Event("input"))');
    collaborationFailure = 'fixture synchronization timeout';
    await waitFor('!document.querySelector("#wbError").hidden && document.querySelector("#wbError").dataset.scope === "collaboration"', 'transient synchronization error appears');
    collaborationFailure = '';
    await waitFor('document.querySelector("#wbError").hidden', 'successful subsequent sync removes its stale error');
    assert.ok(errors.some(message => message.includes('fixture synchronization timeout')), 'the intentionally injected outage is logged');
    for (let index = errors.length - 1; index >= 0; index--) {
      if (errors[index].includes('fixture synchronization timeout')) errors.splice(index, 1);
    }
    assert.equal(await evaluate('document.querySelector("#wbUpdateBadge").hidden'), false, 'startup update event wins over stale bootstrap checking state');
    assert.equal(await evaluate('document.querySelector("#wbUpdateBadge").textContent'), '업데이트 있음');
    assert.equal(updateInstallCalls, 0, 'background notification never starts installation');
    assert.equal(updateCheckCalls, 0, 'renderer does not duplicate the existing periodic checks');
    await evaluate('document.querySelector("#wbUpdateBadge").click()');
    assert.equal(await evaluate('document.querySelector("#wbSettings").open'), true, 'update badge opens settings');
    assert.equal(await evaluate('document.querySelector("#wbSettings").scrollTop'), 0, 'badge reveals version information below the sticky settings header');
    assert.match(await evaluate('document.querySelector("#wbUpdateStatus").textContent'), /2\.0\.1/u);
    assert.equal(await evaluate('document.querySelector("#wbUpdateNotes pre").textContent'), initialAvailableUpdate.notes, 'release notes remain escaped text');
    assert.equal(await evaluate('document.querySelector("#wbUpdateNotes script")'), null);
    if (process.env.WHITEBOX_UPDATE_SCREENSHOT) fs.writeFileSync(process.env.WHITEBOX_UPDATE_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    await evaluate('document.querySelector("[data-action=update-install]").click(); document.querySelector("[data-action=update-install]").click()');
    await waitFor('document.querySelector("[data-action=update-install]").disabled', 'installation disables duplicate clicks');
    assert.equal(updateInstallCalls, 1);
    const downloadedUpdate = { ...initialAvailableUpdate, status: 'downloaded', installCanceled: true };
    finishUpdateInstall(downloadedUpdate);
    await waitFor('!document.querySelector("[data-action=update-install]").disabled', 'canceled installation restores controls');
    assert.match(await evaluate('document.querySelector("#wbUpdateStatus").textContent'), /설치 준비 완료/u);
    win.webContents.send('app:update-state', { ...initialAvailableUpdate, status: 'downloading', progress: 42 });
    await waitFor('document.querySelector("#wbUpdateProgress").value === 42', 'download progress events are visible');
    assert.equal(await evaluate('document.querySelector("[data-action=update-check]").disabled'), true);
    win.webContents.send('app:update-state', { ...initialAvailableUpdate, asset: null, error: 'No verified installer' });
    await waitFor('document.querySelector("#wbUpdateError").textContent.includes("No verified installer")', 'installer availability errors are visible');
    assert.equal(await evaluate('document.querySelector("[data-action=update-install]").hidden'), true, 'no install action without a verified installer');
    assert.equal(await evaluate('document.querySelector("#wbUpdateBadge").hidden'), false, 'release notification remains without an installer');
    await evaluate('document.querySelector("[data-action=update-release]").click()');
    assert.equal(releasePageCalls, 1);
    await evaluate('document.querySelector("[data-action=update-check]").click()');
    await waitFor('document.querySelector("#wbUpdateStatus").textContent === "최신 버전입니다."', 'manual check current result');
    assert.equal(await evaluate('document.querySelector("#wbUpdateBadge").hidden'), true, 'successful current result removes the update badge');
    updateCheckFailure = 'fixture offline';
    await evaluate('document.querySelector("[data-action=update-check]").click()');
    await waitFor('document.querySelector("#wbUpdateError").textContent.includes("fixture offline")', 'manual check rejection is visible');
    assert.doesNotMatch(await evaluate('document.querySelector("#wbUpdateStatus").textContent'), /최신 버전입니다/u, 'failed check must not claim freshness');
    updateCheckFailure = '';
    win.webContents.send('app:update-state', { ...initialAvailableUpdate, currentVersionKnown: false, currentVersion: '', blocked: true });
    await waitFor('document.querySelector("#wbUpdateInstalledVersion").textContent.includes("확인 불가")', 'unknown installed version shown explicitly');
    assert.equal(await evaluate('document.querySelector("[data-action=update-install]").hidden'), true, 'blocked updater has no install action');
    assert.equal(updateInstallCalls, 1, 'state changes never install automatically');
    bootstrapPush = null; bootstrapUpdate = updateCheckResponse;
    await evaluate('document.querySelector("#wbSettings").close()');
    await win.reload();
    await waitFor('Boolean(window.WhiteboxWorkspace)', 'update state restores from bootstrap after reload');
    assert.equal(await evaluate('document.querySelector("#wbUpdateBadge").hidden'), true);
    assert.equal(await evaluate('document.querySelector("#wbUpdateError").hidden'), true);
    console.log('PASS workspace update UI: startup race, background badge, settings navigation, manual checks/errors, progress, single install action/cancel, absent/blocked installer and reload; installer IPC uses a fixture');
    const settingsShots = path.join(root, 'artifacts/settings'); fs.mkdirSync(settingsShots, { recursive: true });
    await evaluate('document.querySelector("[data-action=settings]").click()');
    assert.equal(await evaluate('document.querySelectorAll("#wbSettings .wb-settings-nav [data-settings-section]").length'), 5, 'general, terminal, connections, remote and shortcuts');
    assert.equal(await evaluate('document.querySelector("[data-settings-page=general]").hidden'), false);
    const settingsActions = await evaluate('Object.fromEntries(["wbSettingsClose","wbSettingsDone"].map(id=>{const button=document.querySelector("#"+id+" button"),r=button.getBoundingClientRect();return [id,{width:r.width,height:r.height}]}))');
    assert(settingsActions.wbSettingsClose.width>=44 && settingsActions.wbSettingsClose.height>=40,'close target has adequate space');
    assert(settingsActions.wbSettingsDone.width>=88 && settingsActions.wbSettingsDone.height>=40,'Done has comfortable horizontal padding');

    await new Promise(resolve => setTimeout(resolve, 600));
    fs.writeFileSync(path.join(settingsShots, 'general-dark.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate('document.querySelector("[data-settings-section=terminal]").click(); document.querySelector("[data-action=settings-font-larger]").click()');
    assert.equal(await evaluate('document.querySelector("#wbFont").value'), '15');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#wbFontPreview")).fontSize'), '15px');
    await evaluate('document.querySelector("#wbFontFamily").value="monospace"; document.querySelector("#wbFontFamily").dispatchEvent(new Event("change",{bubbles:true}))');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#wbFontPreview")).fontFamily'), 'monospace');
    await evaluate('new Promise(resolve => setTimeout(resolve, 150))'); // the saved state is written just after the action (save())
    assert.equal(await evaluate('JSON.parse(localStorage.getItem("whitebox:workspace:v2")).fontFamily'), 'monospace');
    fs.writeFileSync(path.join(settingsShots, 'terminal-dark.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate('document.querySelector("#wbSettingsClose button").click()');
    assert.equal(await evaluate('document.querySelector("#wbSettings").open'), false, 'affectUI close preserves native dialog submission');
    await evaluate('document.querySelector("[data-action=settings]").click(); WhiteboxTheme.setTheme("system")');
    assert.equal(await evaluate('WhiteboxTheme.getPreference()'), 'system');
    win.webContents.debugger.attach('1.3');
    for (const appearance of ['light', 'dark']) {
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: appearance }] });
      await waitFor(`WhiteboxTheme.getTheme() === '${appearance}'`, 'system appearance follows OS changes');
      assert.equal(await evaluate('WhiteboxTheme.getPreference()'), 'system');
    }
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); win.webContents.debugger.detach();
    await evaluate('document.querySelector("#wbSettingsDone button").click()');
    await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)', 'settings restore after reload');
    assert.equal(await evaluate('WhiteboxTheme.getPreference()'), 'system');
    assert.equal(await evaluate('document.querySelector("#wbFontFamily").value'), 'monospace');
    assert.equal(await evaluate('document.querySelector("#wbFont").value'), '15');
    await evaluate('WhiteboxTheme.setTheme("dark"); document.querySelector("[data-action=settings]").click()');
    for (const width of [780, 360]) {
      win.setContentSize(width, 720);
      for (const section of ['general', 'terminal', 'connections', 'remote', 'shortcuts']) {
        await evaluate(`document.querySelector('[data-settings-section=${section}]').click()`);
        const bounds = await evaluate('(() => { const r=document.querySelector("#wbSettings").getBoundingClientRect(), content=document.querySelector("#wbSettingsContent"); return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,scroll:content.scrollWidth,client:content.clientWidth}; })()');
        assert(bounds.left>=0 && bounds.right<=bounds.width && bounds.bottom<=bounds.height && bounds.scroll<=bounds.client+1, JSON.stringify({section,bounds}));
      }
      fs.writeFileSync(path.join(settingsShots, `settings-${width}.png`), (await win.webContents.capturePage()).toPNG());
    }
    win.setContentSize(1450,900);
    await evaluate('document.querySelector("#wbSettingsDone button").click()');
    await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)', 'restore layout after settings size checks');
    console.log('PASS redesigned settings: native close, five categories, font persistence, system appearance changes, 780/360px layouts');
    const suggestionProbe = await evaluate(`(async () => {
      const host = document.createElement('div'); document.body.append(host);
      const probe = new WhiteboxTerminalEngine.Terminal({ cols: 60, rows: 12 }); probe.open(host);
      const frame = dim => '\\x1b[2J\\x1b[H❯ ' + (dim ? '\\x1b[2m' : '') + '2번으로 codex exec 돌려줘\\x1b[0m\\r\\n' + '─'.repeat(55) + '\\r\\n  [Opus 5.5 medium]\\r\\n  project git:(main*)\\r\\n  Codex 패널 테스트 | Cost $0.1\\r\\n  ✓ ListAgents ×1\\r\\n  ⏵⏵ auto mode on\\x1b[1;3H';
      const decode = text => text.replace(/\\\\x1b/g, String.fromCharCode(27)).replace(/\\\\r/g, '\\r').replace(/\\\\n/g, '\\n');
      await new Promise(resolve => probe.write(decode(frame(true)), resolve));
      const ghost = WhiteboxTerminalReviewTurns.readinessText(probe.buffer.active);
      const ghostReady = WhiteboxTerminalReviewTurns.inputReady(ghost, 'claude');
      await new Promise(resolve => probe.write(decode(frame(false)), resolve));
      const draft = WhiteboxTerminalReviewTurns.readinessText(probe.buffer.active);
      const draftReady = WhiteboxTerminalReviewTurns.inputReady(draft, 'claude');
      probe.dispose(); host.remove(); return { ghostReady, draftReady, ghost, draft };
    })()`);
    assert.equal(suggestionProbe.ghostReady, true, JSON.stringify(suggestionProbe));
    assert.equal(suggestionProbe.draftReady, false, 'real text remains a draft even with cursor at the start');
    assert.equal(manager.list().length, 1, 'opens a plain shell with no provider wizard');
    const first = manager.list()[0];
    // Projects are affectUI Avatar rounded squares with their initial; terminals show the AI as a letter chip.
    const avatars = await evaluate('[...document.querySelectorAll(".wb-ws-avatar")].map(node => ({ text: node.textContent, width: node.getBoundingClientRect().width, radius: getComputedStyle(node).borderTopLeftRadius }))');
    assert.equal(avatars.length, 2, 'each project shows an avatar');
    assert(avatars.every(item => item.text.length === 1 && Math.round(item.width) === 18 && item.radius === '4.5px'), JSON.stringify(avatars));
    assert.equal(await evaluate('document.querySelectorAll("#wbSpaces .wb-provider-chip[data-provider=shell] svg").length'), 1, 'a shell terminal shows the >_ chip');
    assert.equal(await evaluate('Math.round(document.querySelector("#wbSpaces .wb-instance").getBoundingClientRect().height)'), 28, 'tree rows are 28px (affectUI Tree View)');
    await evaluate('document.querySelectorAll("[data-space]")[1].click()');
    assert.equal(await evaluate('document.querySelectorAll("#wbInstances [data-instance]").length'), 0, 'project terminals never appear as independent instances');
    await evaluate('document.querySelectorAll("[data-space]")[0].click()');
    assert.equal(first.type, process.platform === 'win32' ? 'powershell' : 'shell');
    if (process.platform !== 'win32') {
      await manager.command(first.id, 'command -v claude; command -v codex');
      await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(first.id)}).replace(/\\s+/g, '').includes(${JSON.stringify(path.join(adapterDirectory, 'codex'))})`, 'provider adapters remain first after user login shell startup');
      const activitySelector = `[data-instance="${first.id}"] .wb-terminal-state`;
      await waitFor(`document.querySelector('${activitySelector}').dataset.state === 'idle'`, 'idle shell is yellow even while its process remains running');
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('${activitySelector} i')).backgroundColor`), 'rgb(223, 184, 79)');
      // Keep quiet foreground work alive until the assertions explicitly finish.
      // A fixed sleep races slow CI inspection and cannot cover both motion modes.
      const silentWork = path.join(profile, 'silent-work.cjs');
      fs.writeFileSync(silentWork, "process.stdin.setRawMode(true);process.stdin.resume();process.stdin.once('data',()=>{process.stdin.setRawMode(false);process.exit(0)});");
      await manager.command(first.id, "node '" + silentWork.replace(/'/g, "'\\''") + "'");
      await waitFor(`document.querySelector('${activitySelector}').dataset.state === 'working'`, 'silent foreground work shows a spinner');
      win.webContents.debugger.attach('1.3');
      try {
        for (const motion of ['no-preference', 'reduce']) {
          await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] });
          const appearance = await evaluate(`(() => {const status=document.querySelector('${activitySelector}'),style=getComputedStyle(status.querySelector('i'));return {state:status.dataset.state,animation:style.animationName,ring:style.borderTopWidth};})()`);
          assert.equal(appearance.state, 'working');
          assert.equal(appearance.animation, motion === 'reduce' ? 'none' : 'wb-terminal-working');
          assert(parseFloat(appearance.ring) > 0, 'reduced motion retains the working ring at every device scale');
        }
      } finally {
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
        win.webContents.debugger.detach();
        await manager.write(first.id, 'x');
      }
      assert.equal(await evaluate(`document.querySelector('${activitySelector}').textContent`), '', 'dot has no visible status copy');
      await waitFor(`document.querySelector('${activitySelector}').dataset.state === 'idle'`, 'finished command returns to yellow input waiting');
      assert.equal(manager.get(first.id).pid, first.pid, 'working/idle transition never restarts the shell');
      completedActivityId = first.id;
      await waitFor(`document.querySelector('${activitySelector}').dataset.state === 'completed'`, 'confirmed AI completion becomes green');
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('${activitySelector} i')).backgroundColor`), 'rgb(117, 201, 149)');
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('${activitySelector} i')).animationName`), 'none');
      assert.equal(await evaluate(`document.querySelector('${activitySelector}').getAttribute('aria-label')`), '확인 완료');
      assert.equal(await evaluate(`document.querySelector('.wb-pane-state').dataset.state`), 'completed');
      await evaluate("document.documentElement.dataset.theme = 'light'");
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('${activitySelector} i')).backgroundColor`), 'rgb(40, 116, 93)');
      await evaluate("document.documentElement.dataset.theme = 'dark'");
      completedActivityId = '';
      await waitFor(`document.querySelector('${activitySelector}').dataset.state === 'idle'`, 'bare idle shell never claims an AI answer');
      console.log('PASS activity: real silent work spinner, confirmed AI answer green in both themes/sidebar/pane, bare idle shell yellow, same PID');
    }
    await evaluate('document.querySelector("[data-add-panel-terminal]").click()');
    await waitFor('WhiteboxWorkspace.getState().sessions.length === 2 && !WhiteboxWorkspace.getState().busy', 'panel plus adds a terminal');
    const second = manager.list().find(item => item.id !== first.id);
    assert.equal(terminalGetReads.filter(item=>item.id===second.id&&!item.full).length,1,'post-mount PID reconciliation requests metadata only');
    // The independent pending-prompt scanner may initialize its own bounded
    // snapshot before the mount starts; it is not the reconciliation IPC.
    const initialFullReads = terminalGetReads.filter(item=>item.id===second.id&&item.full).length;
    assert(initialFullReads >= 1 && initialFullReads <= 2, 'one mount snapshot plus at most one initial prompt-scan snapshot');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'), 2);
    const tokenSelector = id => `[data-terminal-id="${id}"] .wb-pane-tokens`;
    const usageForPane = (provider, providerPid, conversationId, input, output, cachedInput = 0, partial = false) => ({
      provider, providerPid, conversationId, usageStatus: 'observed',
      usage: { input, output, cachedInput, cacheWrite: 0, total: input + output, partial, observedAt: '2026-11-04T01:00:00Z' },
    });
    activityOverrides.set(first.id, usageForPane('claude', first.pid + 100000, 'terminal-tokens-first', 12000, 345, 8000));
    activityOverrides.set(second.id, usageForPane('codex', second.pid + 100000, 'terminal-tokens-second', 2100, 300, 1700));
    await evaluate('WhiteboxWorkspace.captureReviews(true)');
    await waitFor(`document.querySelector('${tokenSelector(first.id)}').textContent === '12.3K 토큰' && document.querySelector('${tokenSelector(second.id)}').textContent === '2,400 토큰'`, 'separate conversation tokens update with automatic analysis disabled');
    assert.match(await evaluate(`document.querySelector('${tokenSelector(first.id)}').title`), /12,345.*12,000.*345/u);
    assert.match(await evaluate(`document.querySelector('${tokenSelector(first.id)}').title`), /8,000/u);
    await evaluate('new Promise(resolve => setTimeout(resolve, 150))'); // the saved state is written just after the action (save())
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('whitebox:workspace:v2')).terminalUsageHistory.find(r=>r.id==='${first.id}').usage.total`), 12345, 'native terminal counters persist independently of review tokens');
    for (const theme of ['dark', 'light']) {
      await evaluate(`document.documentElement.dataset.theme='${theme}';document.querySelector('[data-terminal-id="${first.id}"]').style.maxWidth='220px'`);
      await evaluate('new Promise(resolve=>setTimeout(resolve,150))');
      const geometry = await evaluate(`(() => {const badge=document.querySelector('${tokenSelector(first.id)}'),title=badge.previousElementSibling,r=badge.getBoundingClientRect(),header=badge.closest('header'),h=header.getBoundingClientRect(),text=document.createRange();text.selectNodeContents(badge);return {inside:r.left>=h.left&&r.right<=h.right,afterTitle:r.left>=title.getBoundingClientRect().right-1,oneLine:text.getClientRects().length===1,badgeWidth:r.width,textWidth:text.getBoundingClientRect().width,controls:[...header.querySelectorAll('button')].filter(b=>!b.hidden).every(b=>{const r=b.getBoundingClientRect();return r.top>=h.top&&r.bottom<=h.bottom&&r.left>=h.left&&r.right<=h.right})};})()`);
      assert(geometry.inside && geometry.afterTitle && geometry.oneLine && geometry.badgeWidth + 0.02 >= geometry.textWidth && geometry.controls, 'tokens and every action remain readable in a 220px pane: '+JSON.stringify(geometry));
    }
    await evaluate(`document.documentElement.dataset.theme='dark';document.querySelector('[data-terminal-id="${first.id}"]').style.removeProperty('max-width')`);
    await evaluate('new Promise(resolve=>setTimeout(resolve,150))');
    fs.writeFileSync(path.join(root, 'artifacts/terminal-tokens-header.png'), (await win.webContents.capturePage()).toPNG());
    await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)', 'reload pane token metrics');
    await waitFor(`document.querySelector('${tokenSelector(first.id)}').textContent==='12.3K 토큰'`, 'same terminal usage survives reload');
    activityOverrides.set(first.id, { provider: 'claude', providerPid: first.pid + 200000, usageStatus: 'unavailable', usage: null });
    await evaluate('WhiteboxWorkspace.captureReviews(true)');
    await waitFor(`document.querySelector('${tokenSelector(first.id)}').textContent==='— 토큰'`, 'new provider identity cannot inherit earlier conversation usage');
    assert.equal(await evaluate(`document.querySelector('${tokenSelector(second.id)}').textContent`), '2,400 토큰');
    activityOverrides.set(first.id, usageForPane('claude', first.pid + 200000, 'terminal-tokens-new', 0, 0));
    await evaluate('WhiteboxWorkspace.captureReviews(true)');
    await waitFor(`document.querySelector('${tokenSelector(first.id)}').textContent==='0 토큰'`, 'reported zero differs from missing counters');
    activityOverrides.set(first.id, usageForPane('claude', first.pid + 200000, 'terminal-tokens-new', 1000, 100, 0, true));
    await evaluate('WhiteboxWorkspace.captureReviews(true)');
    await waitFor(`document.querySelector('${tokenSelector(first.id)}').textContent==='≥1,100 토큰'`, 'partial history is labeled as a lower bound');
    for (const session of [first, second]) activityOverrides.set(session.id, { usageStatus: 'unavailable', usage: null, providerPid: session.pid + 300000 });
    await evaluate('WhiteboxWorkspace.captureReviews(true)'); activityOverrides.clear();
    console.log('PASS per-terminal header tokens: distinct conversations, tooltip breakdown, 220px dark/light geometry, persistence and ownership/zero/partial handling');
    if (process.platform !== 'win32') {
      // Keep the fixture independent of personal login-shell prompt themes.
      // Long cwd prompts redraw multiple rows during rapid pane resizing.
      for (const session of [first, second]) {
        await manager.command(session.id, "PS1='WB> '; RPS1=''; printf '\\033[2J\\033[H'");
        await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(session.id)}).trim().endsWith('WB>')`, 'deterministic fixture shell prompt');
      }
    }
    const backgroundSelector = `[data-background-terminal="${first.id}"]`;
    const backgroundRows = await evaluate(`[...document.querySelectorAll('#wbSpaces .wb-instance-row')].map(row=>row.getBoundingClientRect().height)`);
    const backgroundActiveId = await evaluate('WhiteboxWorkspace.getState().activeId');
    if (process.platform !== 'win32') {
      const jobFile = path.join(profile, 'badge-job.cjs'), jobPidFile = path.join(profile, 'badge-job.pid');
      fs.writeFileSync(jobFile, `require('fs').writeFileSync(${JSON.stringify(jobPidFile)},String(process.pid));setInterval(()=>{},1000);`);
      await manager.command(first.id, "node '" + jobFile.replace(/'/g,"'\\''") + "' &");
      for (let attempt=0; !fs.existsSync(jobPidFile) && attempt<100; attempt++) await new Promise(resolve=>setTimeout(resolve,20));
      assert(fs.existsSync(jobPidFile));
      const jobPid = Number(fs.readFileSync(jobPidFile, 'utf8'));
      try {
        await waitFor(`document.querySelector('${backgroundSelector}')?.textContent.trim()==='1'`, 'real background shell group appears in its own sidebar badge');
        assert.equal(await evaluate(`document.querySelector('[data-instance="${first.id}"] .wb-terminal-state').dataset.state`), 'idle', 'quiet background command does not change the main input-waiting dot');
        assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-instance="${first.id}"] .wb-terminal-state i')).visibility`), 'hidden', 'sidebar hides the dot of a terminal that needs no attention');
        await evaluate(`document.querySelector('${backgroundSelector}').click()`);
        assert.match(await evaluate('document.querySelector("#wbBackgroundJobs").textContent'), /node/u);
        assert.equal(await evaluate('WhiteboxWorkspace.getState().activeId'), backgroundActiveId, 'background details never switch the terminal receiving input');
      } finally { process.kill(jobPid, 'SIGTERM'); }
      await waitFor(`!document.querySelector('${backgroundSelector}')&&document.querySelector('#wbBackgroundPopover').hidden`, 'exited background process removes badge and closes its details');
    }
    const observedBackground = { count: 2, items: [
      { id:'test-command',kind:'command',label:'회귀 테스트 실행',state:'running',startedAt:new Date(Date.now()-134000).toISOString() },
      { id:'test-agent',kind:'agent',label:'버튼 동작 확인',state:'waiting',startedAt:new Date(Date.now()-46000).toISOString() },
    ] };
    activityOverrides.set(first.id, { background: observedBackground });
    await evaluate('WhiteboxWorkspace.captureReviews(true)');
    await waitFor(`document.querySelector('${backgroundSelector}')?.textContent.trim()==='2'`, 'two native background tasks render as one small badge');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('#wbSpaces .wb-instance-row')].map(row=>row.getBoundingClientRect().height)`), backgroundRows, 'badge does not add a row or change sidebar density');
    await evaluate(`document.querySelector('${backgroundSelector}').click()`);
    for (const theme of ['dark','light']) for (const width of [230,176]) {
      await evaluate(`document.documentElement.dataset.theme='${theme}';document.querySelector('#terminalWorkspace').style.gridTemplateColumns='${width}px minmax(0,1fr) 332px'`);
      await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
      const geometry = await evaluate(`(() => {const b=document.querySelector('${backgroundSelector}'),r=b.getBoundingClientRect(),row=b.closest('.wb-instance-row'),title=row.querySelector('strong'),dot=row.querySelector('.wb-terminal-state').getBoundingClientRect(),trash=row.querySelector('.wb-trash-instance').getBoundingClientRect(),p=document.querySelector('#wbBackgroundPopover').getBoundingClientRect();return {badgeFits:r.left>=row.getBoundingClientRect().left&&r.right<=dot.left,notTrash:r.right<trash.left,readable:title.clientWidth-parseFloat(getComputedStyle(title).paddingRight)>8,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-background-terminal]')===b,popupFits:p.left>=0&&p.right<=innerWidth&&p.top>=0&&p.bottom<=innerHeight};})()`);
      assert(Object.values(geometry).every(Boolean), 'quiet badge and popover fit narrow sidebar in '+theme+': '+JSON.stringify(geometry));
    }
    assert.equal(await evaluate('document.querySelectorAll("#wbBackgroundJobs li").length'), 2);
    assert.match(await evaluate('document.querySelector("#wbBackgroundJobs").textContent'), /회귀 테스트 실행.*버튼 동작 확인.*입력 대기/su);
    assert.equal(await evaluate('WhiteboxWorkspace.getState().activeId'), backgroundActiveId);
    await evaluate(`document.documentElement.dataset.theme='dark';document.querySelector('#terminalWorkspace').style.removeProperty('grid-template-columns')`);
    await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
    fs.writeFileSync(path.join(root,'artifacts/terminal-background-badge.png'),(await win.webContents.capturePage()).toPNG());
    // Press Escape and read the result in the same task: a periodic sidebar
    // refresh between two evaluations replaces the badge node and made this
    // check fail on slow runners without any change in the Escape handling.
    const escaped = await evaluate(`(() => {const popover=document.querySelector('#wbBackgroundPopover'),open=!popover.hidden;popover.querySelector('button').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return {open,closed:popover.hidden,focused:document.activeElement===document.querySelector('${backgroundSelector}'),active:document.activeElement?.outerHTML.slice(0,120)}})()`);
    assert.equal(escaped.open&&escaped.closed&&escaped.focused,true,'Escape closes and restores badge focus: '+JSON.stringify(escaped));
    await evaluate(`document.querySelector('${backgroundSelector}').click();document.querySelector('#wbCanvas').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
    assert.equal(await evaluate('document.querySelector("#wbBackgroundPopover").hidden'),true,'outside click closes task details');
    activityOverrides.set(first.id, { background: { ...observedBackground, count:120 } });
    await evaluate('WhiteboxWorkspace.captureReviews(true)');
    await waitFor(`document.querySelector('${backgroundSelector}')?.textContent.trim()==='99+'`, 'large counts stay compact');
    await evaluate(`document.querySelector('#terminalWorkspace').style.gridTemplateColumns='176px minmax(0,1fr) 332px'`);
    await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
    const manyBackgroundGeometry = await evaluate(`(() => {const b=document.querySelector('${backgroundSelector}'),r=b.getBoundingClientRect(),text=b.querySelector('span').getBoundingClientRect(),dot=b.closest('.wb-instance-row').querySelector('.wb-terminal-state').getBoundingClientRect();return {left:r.left,right:r.right,textLeft:text.left,textRight:text.right,dotLeft:dot.left,width:r.width,font:getComputedStyle(b).fontSize};})()`);
    assert(manyBackgroundGeometry.textLeft >= manyBackgroundGeometry.left && manyBackgroundGeometry.textRight <= manyBackgroundGeometry.right && manyBackgroundGeometry.right <= manyBackgroundGeometry.dotLeft, '99+ and its icon do not overlap the existing state dot in a narrow sidebar: '+JSON.stringify(manyBackgroundGeometry));
    await evaluate(`document.querySelector('#terminalWorkspace').style.removeProperty('grid-template-columns')`);
    activityOverrides.set(first.id, { background: { count:1,items:[{...observedBackground.items[0],label:'<img src=x onerror="window.backgroundInjected=true">'}] } });
    await evaluate('WhiteboxWorkspace.captureReviews(true)');
    await evaluate(`document.querySelector('${backgroundSelector}').click()`);
    assert.equal(await evaluate('document.querySelectorAll("#wbBackgroundJobs img").length'),0,'job titles are text, never executable markup');
    activityOverrides.set(first.id, { background: { count:0,items:[] } });
    await evaluate('WhiteboxWorkspace.captureReviews(true)');
    await waitFor(`!document.querySelector('${backgroundSelector}')&&document.querySelector('#wbBackgroundPopover').hidden`, 'completed tasks leave no badge');
    activityOverrides.delete(first.id);
    console.log('PASS background badges: real POSIX job lifecycle, exact terminal, unchanged dots/row height/active input, two jobs, dark/light 176px geometry, popover/Escape/outside close and safe titles');
    const scanScheduling = await evaluate(`(async () => {
      await WhiteboxWorkspace.captureReviews(true);
      const read = WhiteboxTerminal.readTerminalSnapshot;
      const firstId = ${JSON.stringify(first.id)}, secondId = ${JSON.stringify(second.id)};
      let probe = null, observed = null;
      WhiteboxTerminal.readTerminalSnapshot = (id, ...args) => {
        if (!observed && id === firstId) {
          const current = { taskRan: false };
          probe = current;
          setTimeout(() => { current.taskRan = true; }, 0);
          const until = performance.now() + 12;
          while (performance.now() < until) {} // model a cold WASM buffer read
        } else if (!observed && probe && id === secondId) {
          observed = { calls: 2, yielded: probe.taskRan };
        }
        return read(id, ...args);
      };
      try {
        // Calibrate the observer: a partial scan must not count, and two
        // synchronous reads must fail the yield check before testing production.
        WhiteboxTerminal.readTerminalSnapshot(secondId);
        const ignoredPartial = observed === null;
        WhiteboxTerminal.readTerminalSnapshot(firstId);
        WhiteboxTerminal.readTerminalSnapshot(secondId);
        const rejectedNoYield = observed?.yielded === false;
        probe = null; observed = null;
        await new Promise(resolve => setTimeout(resolve, 0));
        // A forced review may join a scan that started before instrumentation.
        // Wait for one complete first/second buffer pair, then stop even if it
        // failed to yield. Never combine reads or timers from different scans.
        for (let attempt = 0; attempt < 150 && !observed; attempt++) {
          await WhiteboxWorkspace.captureReviews(true);
          if (!observed) await new Promise(resolve => setTimeout(resolve, 100));
        }
        return { ...(observed || { calls: 0, yielded: false }), ignoredPartial, rejectedNoYield };
      }
      finally { WhiteboxTerminal.readTerminalSnapshot = read; }
    })()`);
    assert(scanScheduling.ignoredPartial && scanScheduling.rejectedNoYield, 'scan observer must reject partial and non-yielding calibration cases');
    assert(scanScheduling.calls >= 2, 'scheduling check requires multiple terminal buffers');
    assert(scanScheduling.yielded, 'background scans blocked the input task queue across terminals');

    const command = marker => process.platform === 'win32' ? `Write-Output '${marker} 한글 입력 확인'\r` : `printf '%s\\n' '${marker} 한글 입력 확인'\r`;
    await manager.write(first.id, command('ONE_ONLY'));
    await manager.write(second.id, command('TWO_ONLY'));
    await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(first.id)}).includes('ONE_ONLY 한글 입력 확인')`, 'first shell Unicode output');
    await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(second.id)}).includes('TWO_ONLY 한글 입력 확인')`, 'second shell Unicode output');
    assert.equal(await evaluate(`WhiteboxTerminal.readTerminal(${JSON.stringify(first.id)}).includes('TWO_ONLY')`), false);
    assert.equal(await evaluate('document.querySelector(".wb-panel-heading")'), null, 'panels have no visible names or title rows');
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".wb-panel-group")).every(group => group.contains(group.querySelector("[data-add-panel-terminal]")))'), true, 'terminal-add is inside each panel box');
    assert.equal(await evaluate('document.querySelector(".wb-panel-heading small")'), null, 'panel headings do not repeat terminal counts or state');
    assert.equal(await evaluate('document.querySelectorAll("#wbTabs [data-pane-tab]").length'), 2, 'tabs select terminals within the current panel');
    await evaluate(`document.querySelector('[data-pane-tab="${first.id}"]').click(); WhiteboxWorkspace.captureReviews(true)`);
    assert.equal(await evaluate('WhiteboxWorkspace.getState().activeId'), first.id);
    assert.equal(await evaluate('document.querySelector(".wb-pane-number")'), null, 'sidebar omits redundant terminal numbering');
    assert.doesNotMatch(await evaluate('document.querySelector("#wbTabs").textContent'), /터미널 \d+/u);
    // Each terminal is named by its own recorded request (isolated per PTY).
    await waitFor(`(document.querySelector('[data-instance="${first.id}"] strong')?.textContent || '').includes('ONE_ONLY')`, 'first terminal named by its own request');
    await evaluate('WhiteboxWorkspace.captureReviews()');
    await waitFor(`(document.querySelector('[data-instance="${second.id}"] strong')?.textContent || '').includes('TWO_ONLY')`, 'second terminal named by its own request');
    assert.doesNotMatch(await evaluate(`document.querySelector('[data-instance="${first.id}"] strong').textContent`), /TWO_ONLY/u);
    assert.equal(analysisOptions?.recordOnly, true, 'the app only records requests and never asks for a model analysis');

    // Move actual live PTYs through the same DOM drag/drop handlers as the UI.
    const identityBeforeMoves = manager.list().map(({ id, pid, creationId }) => ({ id, pid, creationId }));
    const originalPanel = await evaluate('WhiteboxWorkspace.getState().spaces[0].activeTab');
    const originalOwner = await evaluate('WhiteboxWorkspace.getState().spaces[0].id');
    const otherOwner = await evaluate('WhiteboxWorkspace.getState().spaces[1].id');
    await evaluate(`window.originalTerminalNode = document.querySelector('[data-terminal-id="${second.id}"]')`);
    const drag = async (id, selector, x = .8, y = .5) => evaluate(`(() => {
      const source = document.querySelector('[data-instance="${id}"]');
      const target = document.querySelector(${JSON.stringify(selector)});
      const transfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      const rect = target.getBoundingClientRect();
      const event = type => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + rect.width * ${x}, clientY: rect.top + rect.height * ${y} });
      const accepted = !target.dispatchEvent(event('dragover'));
      target.dispatchEvent(event('drop'));
      source.dispatchEvent(event('dragend'));
      return accepted;
    })()`);
    // Ordinary mouse clicks still select terminals; Escape cancels only a drag.
    win.webContents.debugger.attach('1.3');
    try {
      const mouse = params => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', params);
      for (const id of [second.id, first.id]) {
        const point = await evaluate(`(() => {const r=document.querySelector('[data-instance="${id}"]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
        await mouse({type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
        await mouse({type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
        assert.equal(await evaluate('WhiteboxWorkspace.getState().activeId'), id, 'real click selects its terminal without starting a drag');
        assert.deepEqual(await evaluate('[...document.querySelectorAll("#wbCanvas .wb-pane")].map(node => node.dataset.terminalId)'), [id], 'a sidebar terminal opens alone');
      }
      // The split is a group; the group brings it back.
      await evaluate('document.querySelector("#wbGroups [data-group-open]").click()');
      await waitFor('document.querySelectorAll("#wbCanvas .wb-pane").length === 2', 'the group brings the split back');
      const before = await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces.map(o=>({id:o.id,view:o.viewLayout,active:o.activeSurface})))');
      const point = await evaluate(`(() => {const r=document.querySelector('[data-terminal-id="${first.id}"]>header').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      await mouse({type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
      await mouse({type:'mouseMoved',x:point.x+12,y:point.y+12,button:'left',buttons:1});
      await evaluate(`(() => {window.dragEscapeLeaks=[];window.dragEscapeInput=document.querySelector('[data-terminal-id="${first.id}"] textarea');for(const type of ['keydown','keyup'])dragEscapeInput.addEventListener(type,event=>{if(event.key==='Escape')dragEscapeLeaks.push(type);},true);dragEscapeInput.focus();})()`);
      assert.equal(await evaluate('document.activeElement===dragEscapeInput && document.querySelector("#terminalWorkspace").classList.contains("is-dragging-terminal")'),true,'cancel is checked while the real terminal input owns keyboard focus');
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      assert.deepEqual(await evaluate('dragEscapeLeaks'),[],'drag cancellation never sends Escape down/up to the terminal input');
      await mouse({type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
      assert.equal(await evaluate('document.querySelector("#terminalWorkspace").classList.contains("is-dragging-terminal")'), false);
      assert.equal(await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces.map(o=>({id:o.id,view:o.viewLayout,active:o.activeSurface})))'),before,'Escape keeps layout and selection unchanged');
    } finally { win.webContents.debugger.detach(); }
    // Use real mouse input, including a polling interval between press and move.
    // HTML5-only synthesized drag events miss both source replacement and the
    // native desktop drag service that prevented real cross-panel placement.
    const nativeDrag = async (id, selector, sourceSelector = `[data-instance="${id}"]`, hold = false) => {
      win.webContents.debugger.attach('1.3');
      const send = (method, params) => win.webContents.debugger.sendCommand(method, params);
      try {
        const points = await evaluate(`(() => {
          const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); const border=selector.startsWith('[data-drag-panel='); return { x: r.left + (border ? 2 : r.width / 2), y: r.top + (border ? 2 : r.height / 2) }; };
          window.prePressDragSource = document.querySelector(${JSON.stringify(sourceSelector)});
          window.heldDragSource = null;
          document.addEventListener('pointerdown', event => {
            window.heldDragSource = event.target.closest('[data-drag-terminal], [data-drag-panel]');
          }, {capture:true,once:true});
          return { source: rect(${JSON.stringify(sourceSelector)}), target: rect(${JSON.stringify(selector)}) };
        })()`);
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.source });
        if (hold) {
          // Calibrate the observer against a replacement before the press.
          // It must watch the actual pointerdown target, not this stale lookup.
          await evaluate('prePressDragSource.replaceWith(prePressDragSource.cloneNode(true))');
          assert.equal(await evaluate('prePressDragSource.isConnected'),false);
        }
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.source, button: 'left', buttons: 1, clickCount: 1 });
        if (hold) {
          assert.equal(await evaluate('heldDragSource?.dataset.dragTerminal'),id,'the observer captures the actual pressed terminal');
          activityOverrides.set(id, { state: 'working', completed: false, requestId: 'drag-held-poll', providerPid: manager.get(id).pid + 100000 });
          await new Promise(resolve => setTimeout(resolve, 1200));
          assert.equal(await evaluate('heldDragSource.isConnected'), true, 'polling preserves the pressed source before movement');
          activityOverrides.delete(id);
        }
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.source.x + 12, y: points.source.y + 12, button: 'left', buttons: 1 });
        assert.equal(await evaluate('document.querySelector("#terminalWorkspace").classList.contains("is-dragging-terminal")'), true, 'mouse movement starts a workspace drag');
        for (const narrow of [false, true]) {
          await evaluate(`document.querySelector('#terminalWorkspace').style.${narrow ? "setProperty('--wb-sidebar-width','176px')" : "removeProperty('--wb-sidebar-width')"}`);
          const dropLabels = await evaluate(`Array.from(document.querySelectorAll('.wb-new-panel-drop'), button => {
            const label = button.querySelector('span'), text = document.createRange(); text.selectNodeContents(label);
            const boxes = [...text.getClientRects()]; return { lines: boxes.length, fits: label.clientWidth >= text.getBoundingClientRect().width, writingMode: getComputedStyle(button).writingMode, width: button.getBoundingClientRect().width };
          })`);
          assert(dropLabels.every(label => label.lines === 1 && label.fits && label.writingMode === 'horizontal-tb' && label.width > 90), 'panel-add labels stay horizontal in normal/narrow sidebars during a real drag');
          if (hold && process.env.WHITEBOX_PANEL_DROP_SCREENSHOT_DIR) {
            fs.mkdirSync(process.env.WHITEBOX_PANEL_DROP_SCREENSHOT_DIR,{recursive:true});
            fs.writeFileSync(path.join(process.env.WHITEBOX_PANEL_DROP_SCREENSHOT_DIR,`drag-${narrow?'narrow':'normal'}.png`),(await win.webContents.capturePage()).toPNG());
          }
        }
        await evaluate("document.querySelector('#terminalWorkspace').style.removeProperty('--wb-sidebar-width')");
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.target, button: 'left', buttons: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.target, button: 'left', buttons: 0, clickCount: 1 });
      } finally {
        win.webContents.debugger.detach();
      }
    };
    await nativeDrag(second.id, `[data-drop-owner="${originalOwner}"]`, undefined, true);
    assert.equal(await evaluate('WhiteboxWorkspace.getState().spaces[0].tabs.length'), 2, 'dragging out creates an independent panel');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'), 2, 'separate panels stay together on the split canvas');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .is-separate-panel").length'), 2);
    assert.equal(await evaluate('Array.from(document.querySelectorAll("#wbCanvas .wb-pane-panel")).every(node => node.hidden && !node.textContent)'), true, 'panel identity uses color without repeated labels');
    assert.equal(await evaluate('new Set(Array.from(document.querySelectorAll("#wbCanvas .wb-pane"), node => getComputedStyle(node).getPropertyValue("--wb-panel-color"))).size'), 2, 'different panels have different border colors');
    // affectUI Tree View look with tree lines: a grey line from the project to each panel, and a
    // line in the panel's colour from the panel to each terminal, ending in a rounded corner.
    const checkProjectTree = async () => {
      const panels = await evaluate(`Array.from(document.querySelectorAll('#wbSpaces .wb-project-terminals:not([hidden]) > .wb-panel-group')).filter(group => group.querySelector('.wb-instance')).map(group => {
        const project = group.closest('.wb-project').getBoundingClientRect(), box = group.getBoundingClientRect();
        const probe = document.createElement('span'); probe.style.color = 'var(--wb-panel-color)'; group.append(probe); const colour = getComputedStyle(probe).color; probe.remove();
        const rowNodes = [...group.querySelectorAll('.wb-panel-members .wb-instance-row')], rows = rowNodes.map(row => row.querySelector('.wb-instance').getBoundingClientRect());
        const line = (node, pseudo) => { const style = getComputedStyle(node, pseudo); return { shown: style.display !== 'none' && style.content === '""', left: parseFloat(style.left), height: parseFloat(style.height),
          vertical: style.borderLeftWidth, across: style.borderTopWidth, under: style.borderBottomWidth, colour: style.borderLeftColor, acrossColour: style.borderTopColor, radius: parseFloat(style.borderBottomLeftRadius), input: style.pointerEvents }; };
        const down = rowNodes.map(row => line(row, '::before')), ticks = rowNodes.map(row => line(row, '::after'));
        const project1 = line(group, '::before'), tick1 = line(group, '::after'), last = ticks.at(-1);
        return {
          rowsLines: down.every(item => item.shown && item.vertical === '1px' && item.colour === colour && item.input === 'none' && item.height > 0),
          rowsTicks: ticks.slice(0, -1).every(item => item.shown && item.across === '1px' && item.acrossColour === colour && item.input === 'none'),
          elbow: last.shown && last.vertical === '1px' && last.under === '1px' && last.radius > 0,
          lineBeforeRows: down.every((item, index) => box.left + item.left > project.left && box.left + item.left + 1 < rows[index].left),
          projectLine: project1.shown && project1.vertical === '1px' && project1.colour !== colour && project1.input === 'none' && tick1.shown && box.left + project1.left >= project.left,
          oldBarGone: getComputedStyle(group.querySelector('.wb-panel-members'), '::before').display === 'none',
          rowsIndented: rows.every(rect => rect.left > project.left + 16), border: getComputedStyle(group).borderTopWidth, head: Boolean(group.querySelector(".wb-panel-head .wb-panel-add")) };
      })`);
      assert(panels.length > 0, 'project tree must contain panels');
      for (const panel of panels) assert(panel.rowsLines && panel.rowsTicks && panel.elbow && panel.lineBeforeRows && panel.projectLine && panel.oldBarGone && panel.rowsIndented && panel.border === '0px' && panel.head, JSON.stringify(panel));
    };
    for (const theme of ['light', 'dark']) {
      await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await checkProjectTree();
    }
    fs.writeFileSync(process.env.WHITEBOX_TREE_SCREENSHOT || path.join(os.tmpdir(), 'whitebox-project-tree.png'), (await win.webContents.capturePage()).toPNG());
    console.log('PASS project panel tree branches in light/dark themes preserve drag/drop and panel controls');
    assert.equal(await evaluate('document.querySelectorAll(".wb-layout-controls").length'), 0, 'obsolete orientation controls removed');
    assert.equal(await evaluate('document.querySelectorAll("[data-pin-panel], [data-action=pin-arranged]").length'), 0, 'together-view buttons are removed; drag placement remains available');
    await evaluate(`document.querySelector('#wbCanvas [data-solo-terminal="${second.id}"]').click()`);
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'), 1, 'one click returns to a single terminal');
    assert.equal(await evaluate(`originalTerminalNode === document.querySelector('#wbCanvas [data-terminal-id="${second.id}"]')`), true, 'solo reuses the same live terminal node');
    assert.deepEqual(manager.list().map(({ id, pid, creationId }) => ({ id, pid, creationId })), identityBeforeMoves, 'solo keeps all PTYs alive');
    await win.reload();
    await waitFor('Boolean(window.WhiteboxWorkspace)', 'reload single terminal');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'), 1, 'single-terminal view persists');
    fs.writeFileSync(path.join(os.tmpdir(), 'whitebox-solo-terminal.png'), (await win.webContents.capturePage()).toPNG());
    for (const id of [first.id, second.id]) activityOverrides.set(id, { state: 'working', completed: false, requestId: 'badge-turn', providerPid: manager.get(id).pid + 100000 });
    await waitFor(`document.querySelector('[data-instance="${first.id}"] .wb-terminal-state').dataset.state === 'working'`, 'native AI work is observed');
    for (const id of [first.id, second.id]) activityOverrides.set(id, { state: 'idle', completed: true, requestId: 'badge-turn', providerPid: manager.get(id).pid + 100000 });
    for (let attempt = 0; completionTracker.count !== 2 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(completionTracker.count, 2, 'two completed AI terminals produce badge 2');
    const completionDot = (id, part = 'sidebar') => part === 'sidebar'
      ? `[data-instance="${id}"] .wb-terminal-state` : `#wbCanvas [data-terminal-id="${id}"] .wb-pane-state`;
    const assertCompletionDot = async (id, expected, part = 'sidebar') => {
      const selector = completionDot(id, part);
      await waitFor(`document.querySelector(${JSON.stringify(selector)})?.dataset.state === ${JSON.stringify(expected)}`, `${part} completion state ${expected}`);
      const result = await evaluateData(target => {
        const dot = document.querySelector(target), mark = getComputedStyle(dot.querySelector('i'));
        return { label: dot.getAttribute('aria-label'), visibility: mark.visibility, color: mark.backgroundColor, animation: mark.animationName };
      }, selector);
      assert.equal(result.label, expected === 'needs-review' ? '확인 필요' : '확인 완료');
      const light = await evaluate("document.documentElement.dataset.theme === 'light'");
      assert.equal(result.color, expected === 'needs-review'
        ? light ? 'rgb(167, 125, 18)' : 'rgb(223, 184, 79)'
        : light ? 'rgb(40, 116, 93)' : 'rgb(117, 201, 149)');
      assert.equal(result.animation, 'none', 'review status is a dot, not a working spinner');
      assert.equal(result.visibility, part === 'sidebar' && expected !== 'needs-review' ? 'hidden' : 'visible', 'the sidebar marks only unconfirmed answers');
    };
    for (const theme of ['dark', 'light']) {
      await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await assertCompletionDot(first.id, 'needs-review');
      await assertCompletionDot(second.id, 'needs-review');
      await assertCompletionDot(second.id, 'needs-review', 'pane');
    }
    await evaluate("document.documentElement.dataset.theme = 'dark'");
    // "확인할 답" counts the terminals with an answer to check and opens them one by one, alone.
    await waitFor(`document.querySelector('#wbInboxCount').textContent === '2' && !document.querySelector('#wbReviewInbox').classList.contains('is-empty')`, 'the inbox counts both answers to check');
    holdCollaborationReply = true;
    for (let attempt = 0; !releaseCollaborationReply && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(typeof releaseCollaborationReply, 'function', 'hold an unread observation already in flight');
    await evaluate(`document.querySelector('[data-instance="${second.id}"]').click()`);
    for (let attempt = 0; completionTracker.count !== 1 && attempt < 30; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(completionTracker.count, 1, 'selecting a completed terminal acknowledges only that answer');
    await assertCompletionDot(second.id, 'completed');
    await assertCompletionDot(second.id, 'completed', 'pane');
    await assertCompletionDot(first.id, 'needs-review');
    await evaluate(`(() => {window.reviewDotStates=[];window.reviewDotObserver=new MutationObserver(()=>{const dot=document.querySelector('${completionDot(second.id)}');if(dot)reviewDotStates.push(dot.dataset.state);});reviewDotObserver.observe(document.querySelector('#wbInstances'),{subtree:true,childList:true,attributes:true});})()`);
    releaseCollaborationReply(); releaseCollaborationReply = null;
    await evaluate('new Promise(resolve => setTimeout(resolve, 1300))');
    await assertCompletionDot(second.id, 'completed');
    const replayStates = await evaluate('reviewDotObserver.disconnect();reviewDotStates');
    assert(!replayStates.includes('needs-review'), 'a late unread snapshot cannot turn an acknowledged answer yellow again');
    await evaluate(`document.querySelector('[data-instance="${first.id}"]').click()`);
    for (let attempt = 0; completionTracker.count !== 0 && attempt < 30; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(completionTracker.count, 0, 'all read completions clear the badge');
    await assertCompletionDot(first.id, 'completed');
    await evaluate("document.documentElement.dataset.theme = 'light'");
    await assertCompletionDot(first.id, 'completed');
    await evaluate("document.documentElement.dataset.theme = 'dark'");
    activityOverrides.set(first.id, { state: 'working', completed: false, requestId: 'next-badge-turn', providerPid: manager.get(first.id).pid + 100000 });
    await waitFor(`document.querySelector('${completionDot(first.id)}').dataset.state === 'working'`, 'a new AI turn keeps its working spinner');
    activityOverrides.set(first.id, { state: 'idle', completed: true, requestId: 'next-badge-turn', providerPid: manager.get(first.id).pid + 100000 });
    await assertCompletionDot(first.id, 'needs-review');
    assert.equal(completionTracker.count, 1, 'new answer requires review again');
    await evaluate(`document.querySelector('[data-instance="${first.id}"]').click()`);
    await assertCompletionDot(first.id, 'completed');
    assert.equal(completionTracker.count, 0);
    activityOverrides.clear();
    console.log('PASS completed answers need yellow review dots; explicit review turns them green and the next answer becomes yellow again, in both themes/sidebar/pane');
    console.log('PASS single-terminal view persists with the same PTYs; completed AI badge 2 → 1 → 0 through explicit selection');
    await drag(second.id, `#wbCanvas [data-terminal-id="${first.id}"]`);
    await evaluate(`window.originalTerminalNode = document.querySelector('[data-terminal-id="${second.id}"]')`);
    const splitView = await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces[0].viewLayout)');
    await evaluate(`document.querySelector('[data-drop-panel="${originalPanel}"] [data-instance]').click()`);
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'), 1, 'a sidebar terminal opens alone');
    await evaluate('document.querySelector("#wbGroups .wb-group-row.active, #wbGroups .wb-group-row") && [...document.querySelectorAll("#wbGroups [data-group-open]")].find(button => button.closest(".wb-group-row").querySelector("small").textContent.includes("2")).click()');
    assert.equal(await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces[0].viewLayout)'), splitView, 'the group brings the displayed split back');
    assert.equal(await evaluate(`originalTerminalNode === document.querySelector('[data-terminal-id="${second.id}"]')`), true, 'moving reuses terminal DOM and buffer');
    const separatedPanels = await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces[0].tabs.map(panel => ({id:panel.id, layout:panel.layout})))');
    await win.reload();
    await waitFor('Boolean(window.WhiteboxWorkspace)', 'reload separate panels');
    assert.equal(await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces[0].viewLayout)'), splitView, 'separate-panel screen positions survive reload');
    assert.equal(await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces[0].tabs.map(panel => ({id:panel.id, layout:panel.layout})))'), separatedPanels, 'reload preserves separate membership');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .is-separate-panel").length'), 2);
    fs.writeFileSync(path.join(os.tmpdir(), 'whitebox-separated-panels.png'), (await win.webContents.capturePage()).toPNG());
    await waitFor(`document.querySelector('[data-instance="${first.id}"]').title.includes(${JSON.stringify(process.platform === 'win32' ? '작업 상태 확인 중' : '입력 대기')})`, 'platform activity state settles after separate-panel reload');
    // Background progress comes from an actual delayed command, with no visible terminal.
    await evaluate('document.querySelectorAll("[data-space]")[1].click()');
    await manager.write(first.id, process.platform === 'win32' ? "Start-Sleep -Milliseconds 300; Write-Output ('HIDDEN_' + 'PROGRESS')\r" : "sleep 0.3; printf 'HIDDEN_%s\\n' 'PROGRESS'\r");
    await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(first.id)}).split('\\n').join('').includes('HIDDEN_PROGRESS')`, 'hidden PTY continues producing output');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'), 0);
    await evaluate(`document.querySelector('[data-instance="${first.id}"]').click()`);
    assert.equal(await evaluate(`Boolean(document.querySelector('#wbCanvas [data-terminal-id="${first.id}"]'))`),true,'sidebar selection opens its panel from an empty project');
    assert.equal(await drag(second.id, `[data-drop-panel="${originalPanel}"]`), true);
    assert.equal(await evaluate('WhiteboxWorkspace.getState().spaces[0].tabs.length'), 2, 'placement does not merge panel membership');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'), 2);
    await drag(second.id, `#wbCanvas [data-terminal-id="${first.id}"]`, .5, .1);
    assert.equal(await evaluate('WhiteboxWorkspace.getState().spaces[0].viewLayout.axis'), 'column', 'a terminal dropped on the top edge is stacked, not put beside its target');
    assert.equal(await evaluate('WhiteboxWorkspace.getState().spaces[0].viewLayout.first.id'), second.id, 'top edge places it above the target without changing membership');
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#wbCanvas .wb-pane-project'), node => node.hidden ? null : node.textContent)`), [null, null], 'terminals of one project on screen do not repeat the project name');
    assert.equal(await evaluate(`Boolean(document.querySelector('#wbBreadcrumbPanel:not([hidden])')) && document.querySelector('#wbBreadcrumbPanel').style.getPropertyValue('--wb-panel-color') === document.querySelector('#wbCanvas .wb-pane[data-terminal-id="' + WhiteboxWorkspace.getState().activeId + '"]')?.style.getPropertyValue('--wb-panel-color')`), true, 'top path shows the selected terminal panel colour');
    // Drop onto another project, then return the same session to its original panel.
    await drag(second.id, `[data-drop-owner="${otherOwner}"]`);
    assert.equal(await evaluate('WhiteboxWorkspace.getState().selectedSpace'), otherOwner);
    const membershipBeforePin = await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces.map(owner=>({id:owner.id,tabs:owner.tabs.map(panel=>({id:panel.id,layout:panel.layout}))})))');
    await drag(first.id, `#wbCanvas [data-terminal-id="${second.id}"]`);
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'),2,'explicit together-view preserves cross-project panel display');
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#wbCanvas .wb-pane[data-terminal-id]'), node => node.querySelector('.wb-pane-project').hidden ? null : node.querySelector('.wb-pane-project').textContent).sort()`), await evaluate(`Array.from(document.querySelectorAll('#wbCanvas .wb-pane[data-terminal-id]'), node => { const id = node.dataset.terminalId; const owner = WhiteboxWorkspace.getState().spaces.find(item => item.tabs.some(panel => JSON.stringify(panel.layout).includes(id))); return owner ? owner.name : 'none'; }).sort()`), 'terminals from different projects on one screen name their project');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .is-separate-panel").length'),2);
    assert.equal(await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces.map(owner=>({id:owner.id,tabs:owner.tabs.map(panel=>({id:panel.id,layout:panel.layout}))})))'),membershipBeforePin,'together-view retains logical panel membership');
    const otherPanel = await evaluate('WhiteboxWorkspace.getState().spaces[1].activeTab');
    await evaluate(`window.pinnedTerminalNode = document.querySelector('[data-terminal-id="${first.id}"]'); WhiteboxWorkspace.selectPane(${JSON.stringify(first.id)},true)`);
    assert.equal(await evaluate('WhiteboxWorkspace.getState().selectedSpace'),originalOwner,'focus follows the terminal project');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'),2,'focus retains both projects on screen');
    await forceCapture();
    assert.equal(await evaluate(`pinnedTerminalNode === document.querySelector('#wbCanvas [data-terminal-id="${first.id}"]')`),true,'cross-project focus preserves the terminal DOM');
    await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)','reload pinned projects');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'),2,'cross-project shared view survives reload');
    assert.deepEqual(manager.list().map(({id,pid,creationId})=>({id,pid,creationId})),identityBeforeMoves,'shared focus and reload retain every PTY');
    assert.equal(await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces.map(owner=>({id:owner.id,tabs:owner.tabs.map(panel=>({id:panel.id,layout:panel.layout}))})))'),membershipBeforePin,'shared focus and reload preserve memberships');
    await evaluate(`document.querySelector('[data-solo-terminal="${first.id}"]').click()`);
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'),1,'explicit unpin returns to this project panel');
    await drag(second.id, `[data-drop-panel="${originalPanel}"]`);
    await evaluate(`document.querySelector('[data-arrange-instance="${second.id}"]').click(); document.querySelector('#wbMoveTarget').value='${originalPanel}'; document.querySelector('[data-action="join-panel"]').click()`);
    assert.equal(await evaluate('WhiteboxWorkspace.getState().spaces[0].tabs.length'), 1, 'explicit join alone merges logical panels');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .is-separate-panel").length'), 0, 'same-panel splits have no color border');
    const beforeSelfDrop = await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces)');
    assert.equal(await drag(second.id, `#wbCanvas [data-terminal-id="${second.id}"]`), false);
    assert.equal(await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces)'), beforeSelfDrop, 'self-drop leaves layout intact');
    // Keyboard-accessible move control uses the same placement operation.
    await evaluate(`document.querySelector('[data-arrange-instance="${second.id}"]').click(); document.querySelector('#wbMoveTarget').value='owner:${originalOwner}'; document.querySelector('[data-action="move-terminal"]').click()`);
    assert.equal(await evaluate('WhiteboxWorkspace.getState().spaces[0].tabs.length'), 2);
    await drag(second.id, `[data-drop-panel="${originalPanel}"]`);
    await evaluate(`document.querySelector('[data-arrange-instance="${second.id}"]').click(); document.querySelector('#wbMoveTarget').value='${originalPanel}'; document.querySelector('[data-action="join-panel"]').click()`);
    assert.deepEqual(manager.list().map(({ id, pid, creationId }) => ({ id, pid, creationId })), identityBeforeMoves, 'moves never create, restart, or kill a PTY');
    assert.equal(await evaluate(`WhiteboxTerminal.readTerminal(${JSON.stringify(first.id)}).includes('HIDDEN_PROGRESS')`), true);
    assert.equal(await evaluate(`WhiteboxTerminal.readTerminal(${JSON.stringify(second.id)}).includes('TWO_ONLY')`), true);
    console.log('PASS panel hierarchy, detach/join, directional and cross-project drag, keyboard move, same PTY identity/buffer, hidden background output');
    await forceCapture();
    await evaluate(`WhiteboxWorkspace.selectPane(${JSON.stringify(first.id)}, true); WhiteboxWorkspace.captureReviews(true)`);
    await forceCapture();
    assert.ok(captured.get(first.id).includes('ONE_ONLY'));
    assert.ok(!captured.get(first.id).includes('TWO_ONLY'));
    const originalSecondName = await evaluate(`document.querySelector('[data-instance="${second.id}"] strong').textContent`);
    requestSummary = '팀 티켓 스킬 플러그인 세팅';
    await forceCapture();
    assert.match(await evaluate(`document.querySelector('[data-instance="${first.id}"] strong').textContent`), /^팀 티켓 스킬 플러그인 세팅 ONE_ONLY/u, 'analysis title immediately names its terminal');
    assert.match(await evaluate(`document.querySelector('[data-terminal-id="${first.id}"] .wb-pane-title').textContent`), /^팀 티켓 스킬 플러그인 세팅 ONE_ONLY/u);
    assert.equal(await evaluate(`document.querySelector('[data-instance="${second.id}"] strong').textContent`), originalSecondName, 'another terminal keeps its own name');
    if (process.env.WHITEBOX_DESIGN_SCREENSHOT_DIR) {
      const screenshots = process.env.WHITEBOX_DESIGN_SCREENSHOT_DIR;
      fs.mkdirSync(screenshots, { recursive: true });
      const identities = manager.list().map(({ id, pid, creationId }) => ({ id, pid, creationId }));
      for (const theme of ['dark', 'light']) {
        await evaluate(`WhiteboxTheme.setTheme(${JSON.stringify(theme)})`);
        assert.equal(await evaluate('WhiteboxTerminalEngine.workspaceTheme().background'), '#0c0c0c', 'terminal remains neutral black in both shell themes');
        const tabBackground = theme === 'dark' ? 'rgb(8, 8, 8)' : 'rgb(250, 251, 249)';
        await waitFor(`getComputedStyle(document.querySelector('.wb-main')).backgroundColor === ${JSON.stringify(tabBackground)}`, 'theme transitions settle before screenshot');
        fs.writeFileSync(path.join(screenshots, `desktop-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      }
      await evaluate('WhiteboxTheme.setTheme("dark")');
      win.setContentSize(1024, 800);
      await waitFor('innerWidth === 1024', 'design screenshot at laptop width');
      assert.equal(await evaluate('document.querySelector(".wb-main").getBoundingClientRect().right >= innerWidth - 1'), true);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      fs.writeFileSync(path.join(screenshots, 'laptop-dark.png'), (await win.webContents.capturePage()).toPNG());
      win.setContentSize(1450, 900);
      await waitFor('innerWidth === 1450', 'restore desktop after visual checks');
      assert.deepEqual(manager.list().map(({ id, pid, creationId }) => ({ id, pid, creationId })), identities, 'theme and window changes keep the live PTYs');
    }

    assert.equal(accountUsageCalls, 0, 'review never fetches terminal/account-wide usage');
    const continuationSummary = '## This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n<system-reminder> <tools-used-before-summary>Bash, Skill, ToolSearch, mcp__claude_ai_Notion__notion-create-pages';
    await evaluate('new Promise(resolve => setTimeout(resolve, 150))'); // the saved state is written just after the action (save())
    const beforeContinuation = await evaluate(`JSON.parse(localStorage.getItem('whitebox:workspace:v2')).reviewHistory.find(r=>r.id==='${first.id}')`);
    const bogusTask = { taskId: 'compaction-internal', request: continuationSummary, actual: 'INTERNAL_COMPACTION_SENTINEL', lifecycle: 'in-progress', recordOnly: true, submittedAt: Date.now() };
    win.webContents.send('terminals:review-state', { id: first.id, value: {
      state: 'awaiting-answer', provider: beforeContinuation.provider, providerPid: beforeContinuation.providerPid,
      currentTaskId: bogusTask.taskId, preview: { request: continuationSummary },
      result: { ...beforeContinuation.result, observedAt: '2026-11-04T04:00:00Z', tasks: [...beforeContinuation.result.tasks, bogusTask] },
    } });
    await waitFor(`JSON.parse(localStorage.getItem('whitebox:workspace:v2')).reviewHistory.find(r=>r.id==='${first.id}').result.observedAt==='2026-11-04T04:00:00Z'`, 'continuation event reached renderer history');
    await waitFor(`!(document.querySelector('[data-instance="${first.id}"] strong')?.textContent || '').includes('continued from')`, 'internal continuation never names the terminal');
    assert.match(await evaluate(`(document.querySelector('[data-instance="${first.id}"] strong')?.textContent || '')`), /ONE_ONLY/u, 'the actual previous request keeps naming the terminal during continuation');
    assert.equal(await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('whitebox:workspace:v2')).reviewHistory).includes('tools-used-before-summary')`), false, 'internal summaries are not retained in new renderer history or digests');
    await evaluate('new Promise(resolve => setTimeout(resolve, 150))'); // let the app's own save (save()) land before the fixture rewrites it
    await evaluateData((id, task) => { const key='whitebox:workspace:v2', data=JSON.parse(localStorage.getItem(key)), record=data.reviewHistory.find(r=>r.id===id); record.result.tasks.push(task); record.digest=JSON.stringify(record.result); localStorage.setItem(key,JSON.stringify(data)); }, first.id, bogusTask);
    await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)', 'legacy summary history migration');
    assert.doesNotMatch(await evaluate(`(document.querySelector('[data-instance="${first.id}"] strong')?.textContent || '')`), /continued from|tools-used-before-summary|INTERNAL_COMPACTION_SENTINEL/u);
    assert.equal(await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('whitebox:workspace:v2')).reviewHistory).includes('tools-used-before-summary')`), false, 'reload removes older internal-summary cards and digests');
    await forceCapture();
    console.log('PASS continuation: no internal summary names a terminal, real task retained, new history and legacy reload cache sanitized');
    requestSummary = '다음 요청 제목';
    analysisStamp = 'second';
    reportedUsage = { input: 2400, output: 400, cachedInput: 0, cacheWrite: 0, total: 2800 };
    await forceCapture();
    assert.match(await evaluate(`document.querySelector('[data-instance="${first.id}"] strong').textContent`), /^다음 요청 제목 ONE_ONLY/u, 'next analyzed request updates the terminal name');
    assert.equal(await evaluate('document.querySelectorAll("#wbInstances [data-instance]").length'), 0);
    assert.equal(await evaluate('document.querySelectorAll("#wbSpaces [data-instance]").length'), 2, 'project terminals are nested below their project');
    await evaluate(`document.querySelector('[data-instance="${second.id}"]').click()`);
    assert.equal(await evaluate('WhiteboxWorkspace.getState().activeId'), second.id);
    await evaluate(`document.querySelector('[data-instance="${first.id}"]').click()`);
    // A sidebar terminal opens alone, so the panel's split comes back through its group first.
    await evaluate('document.querySelector("#wbGroups [data-group-open]")?.click()');
    const panesBeforeAdd = await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length');
    assert.equal(panesBeforeAdd, 2, 'the group shows the panel split');
    await evaluate("document.querySelector('[data-add-panel-terminal]').click()");
    await waitFor('!WhiteboxWorkspace.getState().busy && document.querySelectorAll("#wbCanvas .wb-pane").length === 3 && document.querySelectorAll("#wbCanvas canvas").length === 3', 'default new terminal joins current panel and finishes connecting');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'), 3);
    const geometry = await evaluate(`Array.from(document.querySelectorAll('#wbCanvas .wb-terminal-mount')).map(node => { const r = node.getBoundingClientRect(); const c = node.querySelector('canvas')?.getBoundingClientRect(); return {width:r.width,height:r.height,canvasWidth:c?.width,canvasHeight:c?.height}; })`);
    assert.ok(geometry.every(item => item.width > 100 && item.height > 100 && item.canvasWidth > 100 && item.canvasHeight > 80), JSON.stringify(geometry));
    const initialPids = manager.list().map(item => item.pid).sort();
    await evaluate('document.querySelector("#wbCanvas .is-selected [data-expand-terminal]").click()');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'), 1);
    await waitFor(`document.querySelector('#wbCanvas canvas').getBoundingClientRect().width > 1300`, 'expanded terminal fits full available width');
    assert.deepEqual(manager.list().map(item => item.pid).sort(), initialPids);
    await evaluate('document.querySelector("#wbCanvas .is-selected [data-expand-terminal]").click()');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'), 3);
    win.setContentSize(1000, 800);
    await waitFor('document.querySelector(".wb-main").getBoundingClientRect().width >= 450', 'narrow window keeps the sidebar and canvas visible');
    assert.equal(await evaluate('document.querySelector(".wb-main").getBoundingClientRect().right >= innerWidth - 1'), true, 'the canvas reaches the right edge');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'no horizontal page overflow');
    const checkFittedPanes = async () => {
      await waitFor(`(async () => {
        const probeHost = document.createElement('div'); document.body.append(probeHost);
        const probe = WhiteboxTerminalEngine.createView(probeHost, {...WhiteboxTerminalEngine.workspaceOptions(Number(document.querySelector('#wbFont').value)), fontFamily:document.querySelector('#wbFontFamily').value});
        const metrics = probe.terminal.renderer.getMetrics(); probe.terminal.dispose(); probeHost.remove();
        for (const pane of document.querySelectorAll('#wbCanvas .wb-pane')) {
          const element = pane.querySelector('.ghostty-terminal'), canvas = pane.querySelector('canvas');
          if (!element || !canvas) return false;
          const session = await whitebox.terminalGet(pane.dataset.terminalId);
          const cols = Math.max(2, Math.floor((element.clientWidth - 15) / metrics.width));
          const rows = Math.max(1, Math.floor(element.clientHeight / metrics.height));
          if (session.cols !== cols || session.rows !== rows) { window.fitDiagnostic = {id:pane.dataset.terminalId,actual:[session.cols,session.rows],expected:[cols,rows],element:[element.clientWidth,element.clientHeight],metrics}; return false; }
          const rect = canvas.getBoundingClientRect();
          if (Math.abs(rect.width - cols * metrics.width) > 1 || Math.abs(rect.height - rows * metrics.height) > 1) { window.fitDiagnostic = {id:pane.dataset.terminalId,canvas:[rect.width,rect.height],expected:[cols*metrics.width,rows*metrics.height],metrics}; return false; }
        }
        return true;
      })()`, 'each visible canvas and real PTY agree with the final container grid').catch(async error => { throw new Error(error.message + ': ' + JSON.stringify(await evaluate('window.fitDiagnostic'))); });
    };
    await checkFittedPanes();
    // Reproduce a narrow navigation column like the reported screenshot.
    await evaluate("document.querySelector('#terminalWorkspace').style.setProperty('--wb-sidebar-width', '176px')");
    const sidebarGeometry = await evaluate(`(() => {
      const group = document.querySelector('.wb-panel-group').getBoundingClientRect();
      const plus = document.querySelector('.wb-panel-group .wb-panel-add').getBoundingClientRect();
      const name = document.querySelector('.wb-instance-copy strong').getBoundingClientRect();
      const label=document.querySelector('.wb-panel-group .wb-panel-add>span'), text=document.createRange();text.selectNodeContents(label);
      return { nameWidth:name.width, inside:plus.left>=group.left&&plus.right<=group.right&&plus.bottom<=group.bottom, plusWidth:plus.width, plusHeight:plus.height, labelFits:label.clientWidth>=text.getBoundingClientRect().width, labelLines:text.getClientRects().length };
    })()`);
    // The add action is a quiet 22px tree action (affectUI), not a full-width box.
    assert.ok(sidebarGeometry.nameWidth >= 40 && sidebarGeometry.inside && sidebarGeometry.plusWidth >= 56 && sidebarGeometry.plusHeight >= 22 && sidebarGeometry.labelFits && sidebarGeometry.labelLines === 1, JSON.stringify(sidebarGeometry));
    await checkProjectTree();
    await evaluate("document.querySelector('#terminalWorkspace').style.removeProperty('--wb-sidebar-width')");
    for (const width of [780, 640, 1000]) {
      win.setContentSize(width, 700);
      await waitFor(`innerWidth === ${width}`, 'window size updated');
      await checkFittedPanes();
    }
    await evaluate(`for (let i = 0; i < 5; i++) document.querySelector('.wb-divider').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}))`);
    await checkFittedPanes();
    assert.deepEqual(manager.list().map(item => item.pid).sort(), initialPids, 'resizing keeps the same running shells');
    console.log('PASS 176px sidebar text/actions, 640/780/1000px layouts, rapid split resize and matching canvas/PTY rows and columns');
    win.setContentSize(1450, 900);
    await waitFor('document.querySelector(".wb-main").getBoundingClientRect().width > 850', 'desktop layout restored');
    await checkFittedPanes();
    await evaluate(`document.querySelector('[data-instance="${first.id}"]').click()`);
    await forceCapture();
    const screenshot = process.env.WHITEBOX_WORKSPACE_SCREENSHOT || path.join(os.tmpdir(), 'whitebox-v2-workspace.png');
    fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
    console.log(`SCREENSHOT ${screenshot}`);
    const oldPids = manager.list().map(item => item.pid).sort();
    await win.loadFile(path.join(root, 'renderer/index.html'));
    await waitFor('Boolean(window.WhiteboxWorkspace)', 'restore after reload');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'), 1, 'the terminal opened alone from the sidebar is restored alone');
    assert.equal(await evaluate('document.querySelectorAll("#wbGroups .wb-group-row").length') >= 1, true, 'its split stays in the group list');
    assert.deepEqual(manager.list().map(item => item.pid).sort(), oldPids, 'reload reattaches without spawning duplicate shells');
    assert.match(await evaluate(`document.querySelector('[data-instance="${first.id}"] strong').textContent`), /^다음 요청 제목 ONE_ONLY/u, 'terminal name survives renderer reload');
    await evaluate('document.querySelector("[data-new-panel]").click()');
    await waitFor('WhiteboxWorkspace.getState().spaces[0].tabs.length === 2 && !WhiteboxWorkspace.getState().busy', 'new panel');
    assert.equal(manager.list().length, 4);
    const last = await evaluate('WhiteboxWorkspace.getState().activeId');
    const lastPid = manager.get(last).pid;
    activityOverrides.set(last, usageForPane('claude', lastPid + 100000, 'terminal-tokens-archive', 3000, 456, 2400));
    await manager.write(last, command('TRASH_KEPT'));
    await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(last)}).includes('TRASH_KEPT')`, 'trash output fixture');
    await forceCapture();
    await waitFor(`(document.querySelector('[data-instance="${last}"] strong')?.textContent || '').includes('TRASH_KEPT')`, 'the recorded request names the terminal before trash');
    await waitFor(`document.querySelector('${tokenSelector(last)}').textContent==='3,456 토큰'`, 'archive fixture retains its own native usage independently of analysis tokens');
    const trashChild = path.join(profile, 'trash-child.cjs'), trashChildPidFile = path.join(profile, 'trash-child.pid');
    fs.writeFileSync(trashChild, `require('fs').writeFileSync(${JSON.stringify(trashChildPidFile)},String(process.pid));setInterval(()=>{},1000);`);
    await manager.command(last, "node '" + trashChild.replace(/'/g, process.platform === 'win32' ? "''" : "'\\''") + "'");
    for (let attempt=0; !fs.existsSync(trashChildPidFile) && attempt<100; attempt++) await new Promise(resolve=>setTimeout(resolve,100));
    assert(fs.existsSync(trashChildPidFile), 'start a real foreground child before trashing');
    const trashChildPid = Number(fs.readFileSync(trashChildPidFile, 'utf8'));
    assert.doesNotThrow(()=>process.kill(trashChildPid,0));

    missingSessionId = last;
    await evaluate(`WhiteboxWorkspace.trashInstance(${JSON.stringify(last)})`);
    await waitFor('!WhiteboxWorkspace.getState().busy && document.querySelector("#wbError").textContent.includes("세션 종료를 확인하지 못해")', 'missing host identity cannot establish termination');
    assert.equal(await evaluate('WhiteboxWorkspace.getState().trash.length'), 0);
    assert.equal(manager.get(last).pid, lastPid);
    missingSessionId = '';
    await evaluate('document.querySelector("[data-action=dismiss-error]").click()');
    for (let index=errors.length-1; index>=0; index--) if(errors[index].includes('세션 종료를 확인하지 못해')) errors.splice(index,1);
    rejectedStopId = last;
    await evaluate(`WhiteboxWorkspace.trashInstance(${JSON.stringify(last)});WhiteboxWorkspace.trashInstance(${JSON.stringify(last)})`);
    await waitFor('!WhiteboxWorkspace.getState().busy && document.querySelector("#wbError").textContent.includes("fixture stop failure")', 'failed stop remains visible');
    assert.equal(await evaluate('WhiteboxWorkspace.getState().trash.length'), 0, 'failed termination never pretends to move to trash');
    assert.equal(manager.get(last).pid, lastPid);
    assert.equal(manager.get(last).status, 'running');
    assert.equal(await evaluate(`Boolean(document.querySelector('#wbSpaces [data-instance="${last}"]'))`), true);
    rejectedStopId = '';
    await evaluate('document.querySelector("[data-action=dismiss-error]").click()');
    for (let index=errors.length-1; index>=0; index--) if(errors[index].includes('fixture stop failure')) errors.splice(index,1);
    const stopsBeforeTrash = stopCalls;
    terminalGetReads.length = 0; heldPauseReviewId = last;
    await evaluate(`WhiteboxWorkspace.trashInstance(${JSON.stringify(last)});WhiteboxWorkspace.trashInstance(${JSON.stringify(last)})`);
    await waitFor('WhiteboxWorkspace.getState().trash.length === 1', 'move to trash');
    await waitFor('!WhiteboxWorkspace.getState().busy','trash UI settles without waiting for a review-pause reply');
    for(let attempt=0;!releaseHeldPauseReview&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
    assert(releaseHeldPauseReview,'background review pause has reached the deliberately held IPC');
    assert.equal(terminalGetReads.filter(item=>item.id===last&&item.full).length,0,'termination identity checks do not transfer old terminal output');
    heldPauseReviewId='';releaseHeldPauseReview();releaseHeldPauseReview=null;
    assert.equal(stopCalls, stopsBeforeTrash + 1, 'double click terminates only once');
    assert.equal(manager.get(last).pid, null);
    assert.equal(manager.get(last).status, 'stopped');
    activityOverrides.delete(last);
    assert.equal(manager.sessions.get(last).process, null, 'trash releases the actual PTY');
    assert.equal(manager.list().filter(session=>!['exited','stopped','failed'].includes(session.status)).length, 3, 'trash frees a running-session slot');
    if (process.platform !== 'win32') assert.throws(() => process.kill(lastPid, 0), {code:'ESRCH'}, 'original shell no longer exists');
    assert.throws(()=>process.kill(trashChildPid,0), {code:'ESRCH'}, 'the foreground program also exits');
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-instance="${last}"]'))`), false);
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-terminal-screen="${last}"]'))`), false, 'trash frees the emulator and canvas, not only the pane');
    captured.delete(last);
    await evaluate('WhiteboxWorkspace.captureReviews()');
    assert.equal(captured.has(last), false, 'trashed terminals do not start model analysis');
    suppressReview = true;
    await win.loadFile(path.join(root, 'renderer/index.html'));
    await waitFor('Boolean(window.WhiteboxWorkspace)', 'reload with trash');
    assert.equal(await evaluate('WhiteboxWorkspace.getState().trash.length'), 1);
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-instance="${last}"]'))`), false, 'trash survives restart without reappearing');
    await evaluate('document.querySelector("[data-action=trash]").click()');
    await waitFor('document.querySelector("#wbTrashList").textContent.includes("Claude")', 'trash identifies the archived AI');
    assert.ok((await evaluate('document.querySelector("#wbTrashList").textContent')).includes(last.slice(-5)));
    assert.ok(await evaluate('document.querySelector("#wbTrashList details[data-trash-content]") !== null'), 'archived responses can be read without restoring or restarting a terminal');
    assert.match(await evaluate('document.querySelector("#wbTrashList").textContent'), /TRASH_KEPT/u);

    rejectRestoreIdentity = true;
    await evaluate(`document.querySelector('[data-restore-instance="${last}"]').click()`);
    await waitFor('!WhiteboxWorkspace.getState().busy && document.querySelector("#wbTrashNotice").textContent.length > 0', 'reject changed host identity');
    assert.equal(manager.list().length, 4, 'failed restore never creates a replacement shell');
    assert.equal(await evaluate('WhiteboxWorkspace.getState().trash.length'), 1, 'failed restore preserves review and trash metadata');
    rejectRestoreIdentity = false;
    await evaluate('window.originalRestoreMount = WhiteboxTerminal.mountTerminal; WhiteboxTerminal.mountTerminal = async () => { throw new Error("fixture restore mount failure"); }; void 0');
    await evaluate(`document.querySelector('[data-restore-instance="${last}"]').click()`);
    await waitFor(`!WhiteboxWorkspace.getState().busy && document.querySelector('#wbTrashNotice').textContent.includes('fixture restore mount failure') && !document.querySelector('[data-restore-instance="${last}"]').disabled`, 'failed mount retains archive and enables retry');
    assert.equal(await evaluate('WhiteboxWorkspace.getState().trash.length'), 1);
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-terminal-id="${last}"]'))`), false, 'failed restore never leaves a blank pane');
    await evaluate('WhiteboxTerminal.mountTerminal = window.originalRestoreMount; delete window.originalRestoreMount');
    heldReplayId = last; terminalGetReads.length = 0;
    await evaluate(`document.querySelector('[data-restore-instance="${last}"]').click();document.querySelector('[data-restore-instance="${last}"]').click()`);
    await waitFor(`document.querySelector('[data-restore-instance="${last}"]').disabled && document.querySelector('[data-restore-instance="${last}"]').getAttribute('aria-busy') === 'true' && document.querySelector('[data-restore-instance="${last}"]').textContent.includes('복원 중')`, 'slow replay has immediate visible progress and duplicate suppression');
    for (let attempt=0; attempt<100 && !releaseHeldReplay; attempt++) await new Promise(resolve=>setTimeout(resolve,10));
    assert(releaseHeldReplay, 'the one full replay read reaches the host');
    assert.deepEqual(terminalGetReads.filter(item=>item.id===last).map(item=>item.full), [false, true], 'metadata check does not duplicate the large replay transfer');
    holdCollaborationReply = true; releaseCollaborationReply = null;
    releaseHeldReplay(); heldReplayId = ''; releaseHeldReplay = null;
    await waitFor(`WhiteboxWorkspace.getState().activeId === ${JSON.stringify(last)} && !document.querySelector('#wbTrash').open && !WhiteboxWorkspace.getState().busy`, 'restore project terminal');
    for (let attempt=0; attempt<100 && !releaseCollaborationReply; attempt++) await new Promise(resolve=>setTimeout(resolve,10));
    assert(releaseCollaborationReply, 'background collaboration is held while restored UI is already interactive');
    assert.equal(await evaluate('WhiteboxWorkspace.getState().busy'), false, 'restore never waits behind unrelated review/collaboration work');
    releaseCollaborationReply(); releaseCollaborationReply = null;
    assert.equal(terminalGetReads.filter(item=>item.id===last && item.full).length, 1, 'one click transfers the replay once');
    assert.equal(manager.get(last).pid, null);
    assert.equal(manager.get(last).status, 'stopped');
    assert.equal(await evaluate(`document.querySelector('${tokenSelector(last)}').textContent`), '3,456 토큰', 'terminal native usage survives stop, trash, reload and read-only restore');
    assert.match(await evaluate(`(document.querySelector('[data-instance="${last}"] strong')?.textContent || '')`), /TRASH_KEPT/u, 'the recorded request survives trash and renderer restart');
    await evaluate('WhiteboxWorkspace.captureReviews()');
    assert.match(await evaluate(`(document.querySelector('[data-instance="${last}"] strong')?.textContent || '')`), /TRASH_KEPT/u, 'empty backend poll cannot erase the restored record');
    suppressReview = false;
    await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(last)}).includes('TRASH_KEPT')`, 'restore keeps the stopped output');
    assert.equal(await evaluate(`Boolean(document.querySelector('#wbSpaces [data-instance="${last}"]'))`), true, 'restored terminal belongs to original project');
    assert.equal(await evaluate(`document.querySelector('[data-terminal-id="${last}"] textarea').readOnly`), true, 'restored output is read only');
    assert.equal(manager.get(last).pid, null, 'restoring records never restarts a program');
    await evaluate(`WhiteboxWorkspace.trashInstance(${JSON.stringify(last)})`);
    await waitFor('WhiteboxWorkspace.getState().trash.length === 1', 'trash restored terminal');
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-terminal-screen="${last}"]'))`), false, 'trashing a restored record frees its emulator again');
    await evaluateData((id, pid) => { const item=WhiteboxWorkspace.getState().trash.find(item=>item.id===id); delete item.sessionStopped; item.pid=pid; item.review={...item.review,pid}; }, last, lastPid);
    await evaluate('document.querySelector("[data-action=trash]").click()');
    assert.equal(await evaluate(`document.querySelector('[data-restore-instance="${last}"]').disabled`), false, 'legacy archive flags cannot hide a confirmed stopped record');
    await evaluate(`document.querySelector('[data-restore-instance="${last}"]').click()`);
    await waitFor(`WhiteboxWorkspace.getState().activeId === ${JSON.stringify(last)} && !document.querySelector('#wbTrash').open && !WhiteboxWorkspace.getState().busy`, 'restore legacy archive as read-only');
    await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(last)}).includes('TRASH_KEPT')`, 'restore without reload rebuilds the released view from replay');
    assert.equal(manager.get(last).pid, null);
    assert.equal(await evaluate(`document.querySelector('${tokenSelector(last)}').textContent`), '3,456 토큰', 'legacy stopped identity preserves the original conversation counters');
    await evaluate(`WhiteboxWorkspace.trashInstance(${JSON.stringify(last)})`);
    await waitFor('WhiteboxWorkspace.getState().trash.length === 1', 'archive legacy-restored record');
    await evaluate('document.querySelector("[data-action=trash]").click()');
    console.log('PASS responsive trash restore: visible progress, one replay read, duplicate suppression, blocked-background independence, failed-mount retry and legacy stopped archives');
    await evaluate(`document.querySelector('[data-purge-instance="${last}"]').click()`);
    await waitFor('document.querySelector("#wbClose").open', 'permanent delete confirmation');
    await evaluate('window.purgeBeforeCancel = document.querySelector("[data-purge-instance]"); document.querySelector("#wbClose button[value=cancel]").click()');
    await waitFor('!window.purgeBeforeCancel.isConnected', 'cancel purge settled');
    assert.equal(manager.get(last).pid, null);
    assert.equal(manager.get(last).status, 'stopped');
    await evaluate(`document.querySelector('[data-purge-instance="${last}"]').click()`);
    await waitFor('document.querySelector("#wbClose").open', 'purge confirmation again');
    await evaluate('document.querySelector("#wbClose button[value=close]").click()');
    await waitFor('WhiteboxWorkspace.getState().trash.length === 0', 'permanent deletion');
    assert.equal(manager.list().some(item => item.id === last), false);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('whitebox:workspace:v2')).terminalUsageHistory.some(r=>r.id==='${last}')`), false, 'permanent deletion also removes retained token counters');
    await evaluate('document.querySelector("[data-action=trash-close]").click()');
    await evaluate('document.querySelector("[data-action=new-independent]").click()');
    await waitFor('WhiteboxWorkspace.getState().standalone.tabs.length === 1 && !WhiteboxWorkspace.getState().busy', 'independent instance creation');
    const independent = await evaluate('WhiteboxWorkspace.getState().activeId');
    const independentPid = manager.get(independent).pid;
    assert.equal(await evaluate('document.querySelectorAll("#wbInstances [data-instance]").length'), 1);
    assert.equal(await evaluate('document.querySelectorAll("#wbSpaces [data-instance]").length'), 3);
    await evaluate(`WhiteboxWorkspace.trashInstance(${JSON.stringify(independent)})`);
    await waitFor('WhiteboxWorkspace.getState().trash.length === 1', 'independent instance trash');
    await evaluate('document.querySelector("[data-action=trash]").click()');
    await evaluate(`document.querySelector('[data-restore-instance="${independent}"]').click()`);
    await waitFor(`WhiteboxWorkspace.getState().activeId === ${JSON.stringify(independent)} && !document.querySelector('#wbTrash').open && !WhiteboxWorkspace.getState().busy`, 'restore independent instance');
    assert.equal(manager.get(independent).pid, null);
    assert.equal(manager.get(independent).status, 'stopped');
    assert.equal(await evaluate('document.querySelectorAll("#wbInstances [data-instance]").length'), 1);
    assert.equal(await evaluate('document.querySelectorAll("#wbSpaces [data-instance]").length'), 3);
    await evaluate('document.querySelector("[data-remove-project]").click()');
    await waitFor('document.querySelector("#wbRemoveProject").open', 'project deletion confirmation');
    await evaluate('window.beforeCancelProjectButton = document.querySelector("[data-remove-project]")');
    await evaluate('document.querySelector("#wbRemoveProject button[value=cancel]").click()');
    await waitFor('!document.querySelector("#wbRemoveProject").open', 'cancel project removal');
    await waitFor('!WhiteboxWorkspace.getState().busy', 'cancel handler finishes rendering');
    assert.equal(manager.list().length, 4, 'cancel preserves live terminals');
    await evaluate('document.querySelector("[data-remove-project]").click()');
    await waitFor('document.querySelector("#wbRemoveProject").open', 'project deletion confirmation again');
    await evaluate('document.querySelector("#wbRemoveProject button[value=remove]").click()');
    await waitFor('WhiteboxWorkspace.getState().spaces.length === 1', 'project removed');
    assert.equal(await evaluate('WhiteboxWorkspace.getState().spaces[0].name'), 'Other project', 'other project remains');
    await evaluate('document.querySelector("[data-remove-project]").click()');
    await waitFor('document.querySelector("#wbRemoveProject").open', 'empty project deletion');
    await evaluate('document.querySelector("#wbRemoveProject button[value=remove]").click()');
    await waitFor('WhiteboxWorkspace.getState().spaces.length === 0', 'last project removed');
    assert.equal(manager.list().length, 1, 'only project terminals close; independent instance remains');
    assert.equal(manager.get(independent).pid, null);
    assert.equal(manager.get(independent).status, 'stopped');
    assert.equal(fs.existsSync(profile), true, 'actual project folder preserved');
    await win.loadFile(path.join(root, 'renderer/index.html'));
    await waitFor('Boolean(window.WhiteboxWorkspace)', 'restore empty workspace');
    assert.equal(await evaluate('WhiteboxWorkspace.getState().spaces.length'), 0, 'deleted project stays removed on restart');
    assert.equal(manager.list().length, 1, 'independent session survives project deletion and reload');
    assert.equal(await evaluate('document.querySelectorAll("#wbInstances [data-instance]").length'), 1);
    assert.equal(await evaluate('document.querySelectorAll("#wbSpaces [data-instance]").length'), 0);
    await evaluate(`WhiteboxWorkspace.trashInstance(${JSON.stringify(independent)})`);
    await waitFor('WhiteboxWorkspace.getState().trash.length === 1', 'trash before host loss');
    await manager.close(independent);
    await win.loadFile(path.join(root, 'renderer/index.html'));
    await waitFor('Boolean(window.WhiteboxWorkspace)', 'reload after session loss');
    assert.equal(await evaluate('WhiteboxWorkspace.getState().trash.length'), 1, 'metadata survives a missing host session');
    await evaluate('document.querySelector("[data-action=trash]").click()');
    assert.match(await evaluate('document.querySelector("#wbTrashList").textContent'), /원래 실행 세션/u);
    assert.equal(await evaluate(`document.querySelector('[data-restore-instance="${independent}"]').disabled`), true);
    await evaluate(`document.querySelector('[data-restore-instance="${independent}"]').click()`);
    assert.equal(manager.list().length, 0, 'unavailable original session must never become a blank shell');
    assert.equal(await evaluate('WhiteboxWorkspace.getState().trash.length'), 1, 'unavailable session retains its archived data');
    await evaluate('document.querySelector("[data-action=trash-close]").click(); WhiteboxWorkspace.createTerminal()');
    assert.equal(manager.list().length, 1, 'a new shell requires a separate explicit action');
    assert.deepEqual(errors, [], 'no renderer errors');
    if (process.platform !== 'win32') {
      const inputId = manager.list()[0].id;
      await manager.write(inputId, "printf '\\n› TURN_BOUNDARY_FIXTURE'; read wb_fixture_input\r");
      await waitFor(`WhiteboxTerminalReviewTurns.submittedPrompt(WhiteboxTerminal.readTerminal(${JSON.stringify(inputId)})) === 'TURN_BOUNDARY_FIXTURE'`, 'submitted request fixture');
      reviewState = 'watching';
      await forceCapture();
      await evaluate(`WhiteboxTerminal.focusTerminal(${JSON.stringify(inputId)})`);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      for (let attempt = 0; attempt < 40 && !lastSubmission; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(lastSubmission?.request, 'TURN_BOUNDARY_FIXTURE', 'real terminal Enter sends a turn boundary to review');
      assert.ok(Number.isFinite(lastSubmission.at), 'submission records its time before terminal output arrives');
    }
    const localePids = manager.list().map(item => item.pid).sort();
    for (const [locale, label] of [['en', 'Settings · Shortcuts'], ['zh-CN', '设置 · 快捷键'], ['ko', '설정 · 단축키']]) {
      await evaluate(`document.querySelector('#wbLanguage').value=${JSON.stringify(locale)}; document.querySelector('#wbLanguage').dispatchEvent(new Event('change'))`);
      await new Promise(resolve => setTimeout(resolve, 500));
      await waitFor(`Boolean(window.WhiteboxWorkspace) && document.querySelector('[data-action=settings]').textContent.includes(${JSON.stringify(label)})`, 'language switch');
      assert.equal(await evaluate(`WhiteboxWorkspaceI18n.msg(['내 요청 ', ''], '사용자 원문')`), ({en:'Your request 사용자 원문','zh-CN':'您的请求 사용자 원문',ko:'내 요청 사용자 원문'})[locale], 'interpolated user content is never translated');
      assert.deepEqual(manager.list().map(item => item.pid).sort(), localePids, 'language change preserves live terminal processes');
      await forceCapture();
      assert.equal(analysisOptions.locale, locale);
    }
    assert.equal(await evaluate('document.querySelectorAll(".wb-sidebar-separator").length'), 1);
    assert.equal(await evaluate('document.querySelector(".wb-sidebar-separator").getBoundingClientRect().height'), 1);
    assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".wb-sidebar-separator")).backgroundColor'), 'rgba(0, 0, 0, 0)');
    assert.equal(await evaluate(`WhiteboxWorkspaceI18n.msg(['내 요청 ', ''], '사용자 원문')`), '내 요청 사용자 원문');
    await forceCapture();
    assert.equal(await evaluate('document.querySelector("[data-action=collaboration], #wbCollaboration") === null'), true, 'same-panel collaboration has no setup button or dialog');
    assert.equal(collaborationPayload.operation, 'sync');
    assert.ok(collaborationPayload.groups.length > 0);
    assert.equal(collaborationPayload.autoConnect, undefined, 'membership sync has no prompt injection option');
    const panelRosters = await evaluate('(() => { const state = WhiteboxWorkspace.getState(); return [...state.spaces, state.standalone].flatMap(owner => owner.tabs.map(panel => ({id:panel.id, members:WhiteboxWorkspaceLayout.ids(panel.layout)}))); })()');
    assert.deepEqual(collaborationPayload.groups.map(group => ({ id: group.id, members: group.members.map(member => member.id) })), panelRosters, 'only members of the same panel share a collaboration roster');
    assert.ok(collaborationPayload.frames.every(frame => typeof frame.text === 'string'));
    assert.equal(await evaluate('document.querySelector("[data-action=collaboration-connect]") === null'), true, 'no guide injection action');
    const beforeAdd = await evaluate('(() => { const s = WhiteboxWorkspace.getState(); const owner = [...s.spaces, s.standalone].find(o => o.id === s.selectedSpace); return { ownerId:owner.id, panelId:owner.activeTab, panels:owner.tabs.length, members:WhiteboxWorkspaceLayout.ids(owner.tabs.find(t => t.id === owner.activeTab).layout).length, sessions:s.sessions.length }; })()');
    const retained = manager.list().map(({id,pid,creationId}) => ({id,pid,creationId}));
    delayCreation = true;
    await evaluate(`(() => {
      const mount = WhiteboxTerminal.mountTerminal;
      WhiteboxTerminal.mountTerminal = async (...args) => {
        const dispose = await mount(...args);
        await new Promise(resolve => { window.releaseWorkspaceMount = () => { WhiteboxTerminal.mountTerminal = mount; resolve(); }; });
        return dispose;
      };
    })()`);
    await evaluate(`document.querySelector('[data-new-panel="${beforeAdd.ownerId}"]').click()`);
    assert.equal(await evaluate('document.querySelector("#wbCanvas .wb-creating")?.textContent.includes("패널 생성 중")'), true, 'new panel appears before host creation completes');
    assert.equal(await evaluate('Boolean(document.querySelector(".wb-panel-group[aria-busy=true]"))'), true, 'sidebar immediately exposes creation state');
    assert.equal(manager.list().length, beforeAdd.sessions, 'placeholder does not spawn an extra shell');
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('whitebox:workspace:v2')).spaces.concat([JSON.parse(localStorage.getItem('whitebox:workspace:v2')).standalone]).some(owner => owner.tabs.some(panel => panel.pending))`), false, 'pending panels are never persisted');
    assert.equal(await evaluate(`document.querySelector('[data-new-panel="${beforeAdd.ownerId}"]').disabled`), true, 'repeat creation is disabled');
    for (let attempt = 0; !releaseCreation && attempt < 50; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(releaseCreation);
    delayCreation = false; releaseCreation();
    await waitFor('Boolean(window.releaseWorkspaceMount)', 'real terminal mount held before readiness');
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'), 1, 'new panel switches to its only terminal while mounting');
    assert.equal(await evaluate('document.querySelector("#wbCanvas .is-selected .wb-pane-state").getAttribute("aria-label")'), '시작 중…');
    assert.equal(await evaluate('Boolean(document.querySelector("#wbCanvas .wb-pane-loading"))'), true, 'connection progress stays visible');
    await evaluate('releaseWorkspaceMount(); delete window.releaseWorkspaceMount');
    await waitFor(`!WhiteboxWorkspace.getState().busy && WhiteboxWorkspace.getState().sessions.length === ${beforeAdd.sessions + 1}`, 'sidebar new panel');
    const addedPanel = await evaluate('(() => { const s = WhiteboxWorkspace.getState(); return [...s.spaces, s.standalone].find(o => o.id === s.selectedSpace).activeTab; })()');
    assert.notEqual(addedPanel, beforeAdd.panelId);
    await evaluate(`document.querySelector('[data-add-panel-terminal="${beforeAdd.panelId}"]').click()`);
    await waitFor(`!WhiteboxWorkspace.getState().busy && WhiteboxWorkspace.getState().sessions.length === ${beforeAdd.sessions + 2}`, 'plus in non-selected panel');
    const afterAdd = await evaluate(`(() => { const s = WhiteboxWorkspace.getState(); const o = [...s.spaces, s.standalone].find(o => o.id === ${JSON.stringify(beforeAdd.ownerId)}); return { panels:o.tabs.length, selected:o.activeTab, members:WhiteboxWorkspaceLayout.ids(o.tabs.find(t=>t.id===${JSON.stringify(beforeAdd.panelId)}).layout).length, separate:WhiteboxWorkspaceLayout.ids(o.tabs.find(t=>t.id===${JSON.stringify(addedPanel)}).layout).length }; })()`);
    assert.deepEqual(afterAdd, {panels:beforeAdd.panels+1, selected:beforeAdd.panelId, members:beforeAdd.members+1, separate:1});
    assert.deepEqual(manager.list().filter(s=>retained.some(r=>r.id===s.id)).map(({id,pid,creationId})=>({id,pid,creationId})), retained);
    assert.equal(await evaluate(`document.querySelector('#wbMembers-${addedPanel}').hidden`), false, 'other panel remains available in its sidebar box');
    assert.equal(await evaluate('document.querySelector(".wb-panel-status, .wb-panel-heading")'), null, 'panels have no repeated states or name rows');
    await evaluate(`document.querySelector('[data-drop-panel="${addedPanel}"] [data-instance]').click()`);
    assert.equal(await evaluate('document.querySelectorAll("#wbCanvas .wb-pane").length'), 1, 'new panel stays a single screen after switching back');
    assert.equal(await evaluate(`document.querySelector('#wbMembers-${beforeAdd.panelId}').hidden`), false, 'switching panels leaves other sidebar boxes visible');
    const singlePanelId = await evaluate('WhiteboxWorkspace.getState().activeId');
    const singleColor = await evaluate('getComputedStyle(document.querySelector("#wbCanvas .wb-pane")).borderTopColor');
    const priorPanelColor = await evaluate(`getComputedStyle(document.querySelector('[data-drop-panel="${beforeAdd.panelId}"]')).getPropertyValue('--wb-panel-color')`);
    assert.notEqual(singleColor, priorPanelColor);
    const originalRoster = await evaluate(`WhiteboxWorkspaceLayout.ids(WhiteboxWorkspace.getState().spaces.concat([WhiteboxWorkspace.getState().standalone]).flatMap(owner=>owner.tabs).find(panel=>panel.id==='${beforeAdd.panelId}').layout)`);
    await evaluate(`document.querySelector('[data-add-panel-terminal="${addedPanel}"]').click()`);
    await waitFor('!WhiteboxWorkspace.getState().busy && document.querySelectorAll("#wbCanvas .wb-pane").length===2', 'terminal-add splits the selected panel only');
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('#wbCanvas .wb-pane')).every(pane=>pane.dataset.panelId==='${addedPanel}')`), true);
    assert.equal(await evaluate(`WhiteboxWorkspaceLayout.ids(WhiteboxWorkspace.getState().spaces.concat([WhiteboxWorkspace.getState().standalone]).flatMap(owner=>owner.tabs).find(panel=>panel.id==='${beforeAdd.panelId}').layout).every((id,index)=>id===${JSON.stringify(originalRoster)}[index])`), true);
    await evaluate(`document.querySelector('[data-instance="${singlePanelId}"]').click()`);
    await waitFor(`document.querySelector("#wbCanvas .is-selected .wb-pane-state").getAttribute("aria-label") === ${JSON.stringify(process.platform === 'win32' ? '작업 상태 확인 중' : '입력 대기')}`, 'connected shell activity is observed without assuming work');
    // Intentional mixed-panel placement must still work after fresh-panel isolation.
    await evaluate('WhiteboxWorkspace.createTerminal(null)');
    await waitFor('!WhiteboxWorkspace.getState().busy', 'third independent panel ready');
    const thirdPanel = await evaluate('(() => {const s=WhiteboxWorkspace.getState();return [...s.spaces,s.standalone].find(o=>o.id===s.selectedSpace).activeTab;})()');
    await evaluate(`document.querySelector('[data-instance="${singlePanelId}"]').click(); document.querySelector('[data-solo-terminal="${singlePanelId}"]').click()`);
    const rosterBeforeArrange = await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces.concat([WhiteboxWorkspace.getState().standalone]).flatMap(o=>o.tabs).map(p=>({id:p.id,members:WhiteboxWorkspaceLayout.ids(p.layout)})))');
    const foreignId = originalRoster[0];
    // ConPTY can publish a session before assigning its native PID. Establish
    // real positive PIDs before comparing process identity across UI actions.
    // Force one pending observation to exercise readiness on fast hosts too.
    const panelIdentities = manager.list().map(({id,creationId})=>({id,creationId}));
    let livePtyBeforeDrag;
    for (let attempt = 0; attempt < 150; attempt++) {
      const observed = manager.list().map(({id,pid,creationId})=>({id,pid,creationId}));
      assert.deepEqual(observed.map(({id,creationId})=>({id,creationId})), panelIdentities, 'waiting for PID must not replace a terminal');
      if (attempt === 0) observed[observed.length - 1].pid = null;
      if (observed.every(item => Number.isSafeInteger(item.pid) && item.pid > 0)) { livePtyBeforeDrag = observed; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(livePtyBeforeDrag, 'all test PTYs must report real native PIDs before drag');
    await nativeDrag(foreignId, `#wbCanvas [data-terminal-id="${singlePanelId}"] .wb-terminal-mount`);
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('#wbCanvas .wb-pane')).some(node=>node.dataset.terminalId==='${foreignId}')`), 'native drag shows a hidden terminal from another panel on the active canvas');
    assert.equal(await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces.concat([WhiteboxWorkspace.getState().standalone]).flatMap(o=>o.tabs).map(p=>({id:p.id,members:WhiteboxWorkspaceLayout.ids(p.layout)})))'),rosterBeforeArrange,'native canvas drop preserves panel membership');
    assert.deepEqual(manager.list().map(({id,pid,creationId})=>({id,pid,creationId})),livePtyBeforeDrag,'native canvas drop preserves every PTY');
    await nativeDrag(foreignId, `#wbCanvas [data-terminal-id="${singlePanelId}"] .wb-pane-title`, `[data-drag-panel="${beforeAdd.panelId}"]`);
    assert.equal(await evaluate(`${JSON.stringify(originalRoster)}.every(id=>Boolean(document.querySelector('#wbCanvas [data-terminal-id="'+id+'"]')))`), true, 'dragging a panel card displays every member of that panel');
    await nativeDrag(foreignId, '#wbCanvas .wb-divider', `[data-drag-panel="${beforeAdd.panelId}"]`);
    const gapPlacement = await evaluate('(() => {const s=WhiteboxWorkspace.getState();return [...s.spaces,s.standalone].find(o=>o.id===s.selectedSpace).viewLayout;})()');
    assert.equal(WhiteboxWorkspaceLayout.ids(gapPlacement)[0],singlePanelId,'whole-panel gap drop arranges against another panel, never one of its own members');
    assert.equal(JSON.stringify(gapPlacement),JSON.stringify(WhiteboxWorkspaceLayout.grid(gapPlacement)),'whole-panel drop keeps the aligned grid');
    const thirdTerminalId = await evaluate(`WhiteboxWorkspaceLayout.ids([...WhiteboxWorkspace.getState().spaces,WhiteboxWorkspace.getState().standalone].flatMap(o=>o.tabs).find(p=>p.id==='${thirdPanel}').layout)[0]`);
    await nativeDrag(thirdTerminalId, `#wbCanvas [data-terminal-id="${singlePanelId}"]`, `[data-drag-panel="${thirdPanel}"]`);
    const togetherState = await evaluate('(() => {const s=WhiteboxWorkspace.getState();return {visible:[...document.querySelectorAll("#wbCanvas .wb-pane")].map(n=>({id:n.dataset.terminalId,panel:n.dataset.panelId})), panels:[...s.spaces,s.standalone].flatMap(o=>o.tabs).map(p=>({id:p.id,ids:WhiteboxWorkspaceLayout.ids(p.layout)})), pins:s.pinnedPanels, selected:s.selectedSpace};})()');
    assert(new Set(togetherState.visible.map(n=>n.panel)).size>=3, 'whole-panel drag adds a third panel without replacing the current view: '+JSON.stringify({thirdPanel,...togetherState}));
    assert.equal(await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces.concat([WhiteboxWorkspace.getState().standalone]).flatMap(o=>o.tabs).map(p=>({id:p.id,members:WhiteboxWorkspaceLayout.ids(p.layout)})))'),rosterBeforeArrange,'panel dragging and together-view preserve all memberships');
    assert.deepEqual(manager.list().map(({id,pid,creationId})=>({id,pid,creationId})),livePtyBeforeDrag,'three-panel display preserves every PTY');
    if (process.env.WHITEBOX_PANEL_DRAG_SCREENSHOT) fs.writeFileSync(process.env.WHITEBOX_PANEL_DRAG_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelector('[data-solo-terminal="${singlePanelId}"]').click()`);
    await nativeDrag(foreignId, `#wbCanvas [data-terminal-id="${singlePanelId}"]`, `[data-drag-panel="${beforeAdd.panelId}"]`);
    console.log('PASS real pointer drag across panels/projects, complete-panel display, three-panel together-view and horizontal panel-add labels at 176px');
    // A foreign visible target may still remember its old single-panel view.
    // Moving beside it must preserve the rest of the current shared canvas.
    await evaluate('new Promise(resolve => setTimeout(resolve, 150))'); // let the app's own save (save()) land before the fixture rewrites it
    const crossProject = await evaluate(`(() => {
      const key='whitebox:workspace:v2', saved=JSON.parse(localStorage.getItem(key));
      sessionStorage.setItem('fixture:before-cross-project-drag',localStorage.getItem(key));
      const panels=[...saved.spaces,saved.standalone].flatMap(o=>o.tabs), a=panels.find(p=>WhiteboxWorkspaceLayout.ids(p.layout).length>1), b=panels.find(p=>p!==a);
      const aIds=WhiteboxWorkspaceLayout.ids(a.layout), bId=WhiteboxWorkspaceLayout.ids(b.layout)[0], cwd=saved.spaces[0]?.cwd||saved.standalone.cwd;
      const visible=[...aIds,bId], shared=WhiteboxWorkspaceLayout.reconcile(a.layout,[{id:bId}],new Set(visible));
      saved.spaces=[{id:'fixture-cross-a',name:'Cross project A',cwd,tabs:[{...a,activePane:aIds[0],viewLayout:shared}],activeTab:a.id,activeSurface:aIds[0],viewLayout:shared},{id:'fixture-cross-b',name:'Cross project B',cwd,tabs:[{...b,activePane:bId,viewLayout:{id:bId}}],activeTab:b.id,activeSurface:bId,viewLayout:{id:bId}}];
      const rest=panels.filter(p=>p!==a&&p!==b);saved.standalone={...saved.standalone,tabs:rest,activeTab:rest[0]?.id||'',activeSurface:WhiteboxWorkspaceLayout.ids(rest[0]?.layout)[0]||'',viewLayout:rest[0]?.layout||null};
      saved.selectedSpace='fixture-cross-a';saved.pinnedPanels=[];localStorage.setItem(key,JSON.stringify(saved));
      return {moving:aIds[1],target:bId,targetPanel:b.id,visible};
    })()`);
    await win.reload();await waitFor('Boolean(window.WhiteboxWorkspace)','cross-project shared-canvas fixture');
    await nativeDrag(crossProject.moving, `#wbCanvas [data-terminal-id="${crossProject.target}"] .wb-terminal-mount`);
    assert.deepEqual((await evaluate('Array.from(document.querySelectorAll("#wbCanvas .wb-pane"),n=>n.dataset.terminalId)')).sort(),crossProject.visible.sort(),'a foreign target keeps every existing shared-canvas terminal');
    await nativeDrag(crossProject.moving, `[data-drop-panel="${crossProject.targetPanel}"]`);
    assert.deepEqual((await evaluate('Array.from(document.querySelectorAll("#wbCanvas .wb-pane"),n=>n.dataset.terminalId)')).sort(),crossProject.visible.sort(),'a visible foreign sidebar panel also keeps the shared canvas');
    assert.deepEqual(manager.list().map(({id,pid,creationId})=>({id,pid,creationId})),livePtyBeforeDrag,'cross-project target placement retains every native PTY');
    await evaluate('new Promise(resolve => setTimeout(resolve, 150))'); // let the app's own save (save()) land before the fixture rewrites it
    await evaluate(`(() => {const saved=sessionStorage.getItem('fixture:before-cross-project-drag');if(!saved)throw Error('Missing fixture snapshot');localStorage.setItem('whitebox:workspace:v2',saved);sessionStorage.removeItem('fixture:before-cross-project-drag');})()`);
    await win.reload();await waitFor('Boolean(window.WhiteboxWorkspace)','original panel fixture restored');
    console.log('PASS dragging onto a foreign-project pane preserves the complete shared canvas');
    // Desktop drags can blur the window, and terminal renderers own drop events.
    await evaluate(`(() => {
      const source=document.querySelector('[data-instance="${singlePanelId}"]'), target=document.querySelector('[data-terminal-id="${foreignId}"] .wb-terminal-mount');
      const transfer=new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));
      window.dispatchEvent(new Event('blur'));
      const stop=event=>event.stopImmediatePropagation(); target.addEventListener('drop',stop,{once:true});
      const rect=target.getBoundingClientRect();
      const options={bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.left+rect.width*.2,clientY:rect.top+rect.height*.5};
      target.dispatchEvent(new DragEvent('dragover',options)); target.dispatchEvent(new DragEvent('drop',options));
      source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));
    })()`);
    assert.equal(await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces.concat([WhiteboxWorkspace.getState().standalone]).flatMap(o=>o.tabs).map(p=>({id:p.id,members:WhiteboxWorkspaceLayout.ids(p.layout)})))'),rosterBeforeArrange,'blur and nested terminal handlers do not swallow cross-panel placement');


    await evaluate(`document.querySelector('[data-arrange-instance="${singlePanelId}"]').click();document.querySelector('#wbMoveTarget').value='${beforeAdd.panelId}';document.querySelector('[data-action="move-terminal"]').click()`);
    assert.ok(await evaluate('new Set(Array.from(document.querySelectorAll("#wbCanvas .wb-pane"),node=>node.dataset.panelId)).size>1'), 'explicit arrange still shows different panels together');
    assert.equal(await evaluate('JSON.stringify(WhiteboxWorkspace.getState().spaces.concat([WhiteboxWorkspace.getState().standalone]).flatMap(o=>o.tabs).map(p=>({id:p.id,members:WhiteboxWorkspaceLayout.ids(p.layout)})))'), rosterBeforeArrange, 'screen placement never changes collaboration membership');
    const beforePanelReload = manager.list().map(({id,pid,creationId})=>({id,pid,creationId}));
    assert.deepEqual(beforePanelReload, livePtyBeforeDrag, 'all UI actions retain the original native PTYs before reload');
    // The person can recolour a panel from its sidebar swatch; the reload below must keep it.
    const recoloured = await evaluate('document.querySelector("#wbCanvas .wb-pane[data-panel-id]").dataset.panelId');
    await evaluate(`document.querySelector('[data-panel-color="${recoloured}"]').click()`);
    assert.equal(await evaluate('Boolean(document.querySelector(".wb-color-picker:not([hidden]) [data-pick-color]"))'), true, 'the panel swatch opens the colour picker');
    await evaluate('(() => { const input = document.querySelector(".wb-color-picker [data-pick-custom]"); input.value = "#3366cc"; input.dispatchEvent(new Event("change", { bubbles: true })); })()');
    assert.equal(await evaluate('document.querySelector(".wb-color-picker").hidden'), true, 'choosing a colour closes the picker');
    assert.equal(await evaluate(`WhiteboxWorkspace.getState().spaces.concat([WhiteboxWorkspace.getState().standalone]).flatMap(owner => owner.tabs).find(panel => panel.id === ${JSON.stringify(recoloured)}).color`), '#3366cc', 'the chosen colour is stored on the panel');
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('#wbCanvas .wb-pane[data-panel-id="${recoloured}"]')).every(node => node.style.getPropertyValue('--wb-panel-color') === '#3366cc') && document.querySelector('[data-drop-panel="${recoloured}"]').style.getPropertyValue('--wb-panel-color') === '#3366cc'`), true, 'terminal headers and the sidebar box take the chosen colour');
    const visibleBeforePanelReload = await evaluate('Array.from(document.querySelectorAll("#wbCanvas .wb-pane"),node=>({id:node.dataset.terminalId,color:node.style.getPropertyValue("--wb-panel-color")}))');
    const ratioBeforePanelReload = await evaluate('(() => {const divider=document.querySelector("#wbCanvas .wb-divider");divider.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));return divider.getAttribute("aria-valuenow")})()');
    await win.reload();await waitFor('Boolean(window.WhiteboxWorkspace)','per-panel arrangement restored');
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("#wbCanvas .wb-pane"),node=>({id:node.dataset.terminalId,color:node.style.getPropertyValue("--wb-panel-color")}))'),visibleBeforePanelReload,'intentional shared view and assigned colors survive reload');
    assert.equal(await evaluate('document.querySelector("#wbCanvas .wb-divider").getAttribute("aria-valuenow")'),ratioBeforePanelReload,'explicit split ratio survives polling and reload');
    assert.deepEqual(manager.list().map(({id,pid,creationId})=>({id,pid,creationId})),beforePanelReload,'navigation and reload retain all PTYs');
    await evaluate('WhiteboxTheme.setTheme("dark")');
    const neutralSurfaces = await evaluate('Array.from(document.querySelectorAll(".wb-main,.wb-sidebar,.wb-review,#wbCanvas .wb-pane,.wb-terminal-mount"),node=>getComputedStyle(node).backgroundColor)');
    for(const color of neutralSurfaces){const components=color.match(/[\d.]+/g).map(Number);assert.ok(components[0]===components[1]&&components[1]===components[2],color)}
    // Terminal headers are the one tinted surface: each carries its panel colour so panels stay apart on a mixed screen.
    const headerTints = await evaluate('Array.from(document.querySelectorAll("#wbCanvas .wb-pane[data-panel-id]"),node=>({panel:node.dataset.panelId,color:getComputedStyle(node.querySelector(":scope>header")).backgroundColor}))');
    for(const {color} of headerTints){const components=color.match(/[\d.]+/g).map(Number).slice(0,3);assert.ok(!(components[0]===components[1]&&components[1]===components[2]),`header tinted by its panel colour: ${color}`)}
    assert.equal(new Set(headerTints.map(item=>item.color)).size,new Set(headerTints.map(item=>item.panel)).size,'different panels give different header colours');
    assert.equal(await evaluate('WhiteboxTerminalEngine.workspaceTheme().background'),'#0c0c0c');
    console.log('PASS explicit cross-panel arrangement after isolated creation, logical roster/PTY/color retention, split-ratio reload, neutral dark surfaces, panel-coloured headers and a chosen panel colour kept across reload');
    const beforeFailure = manager.list().length;
    rejectCreation = true;
    await evaluate(`document.querySelector('[data-new-panel="${beforeAdd.ownerId}"]').click()`);
    await waitFor('!WhiteboxWorkspace.getState().busy', 'failed creation clears pending state');
    rejectCreation = false;
    assert.equal(manager.list().length, beforeFailure, 'failed creation leaves no extra shell');
    assert.equal(await evaluate('document.querySelector(".wb-panel-group[aria-busy=true], #wbCanvas .wb-creating")'), null, 'failed creation removes placeholders');
    assert.equal(await evaluate('document.querySelector("#wbError").textContent.includes("fixture creation failure")'), true, 'creation failure is actionable');
    await evaluate('WhiteboxWorkspace.captureReviews()');
    assert.equal(await evaluate('document.querySelector("#wbError").hidden'), false, 'background sync success does not hide a creation error');
    await evaluate('document.querySelector("#wbError [data-action=dismiss-error]").click()');
    assert.equal(await evaluate('document.querySelector("#wbError").hidden'), true);
    assert.equal(await evaluate('WhiteboxWorkspace.getState().spaces.concat([WhiteboxWorkspace.getState().standalone]).some(owner => owner.tabs.some(panel => panel.pending))'), false);
    const beforeMountFailure = manager.list().length;
    await evaluate(`(() => {
      window.originalWorkspaceMount = WhiteboxTerminal.mountTerminal;
      WhiteboxTerminal.mountTerminal = async () => { throw new Error("Error invoking remote method 'terminals:get': Error: 명령창 연결이 닫혔습니다."); };
      document.querySelector('[data-new-panel="${beforeAdd.ownerId}"]').click();
    })()`);
    await waitFor('!WhiteboxWorkspace.getState().busy && Boolean(document.querySelector("#wbCanvas [data-retry-terminal]"))', 'failed mount retains a retry control');
    const failedMountId = await evaluate('WhiteboxWorkspace.getState().activeId');
    await waitFor(`WhiteboxWorkspace.getState().sessions.some(session => session.id === ${JSON.stringify(failedMountId)} && Number.isSafeInteger(session.pid) && session.pid > 0)`, 'failed mount observes asynchronously published shell PID');
    const failedMountPid = manager.get(failedMountId).pid;
    assert.equal(manager.list().length, beforeMountFailure + 1, 'failed mount preserves its one actual session');
    assert.equal(await evaluate('document.querySelector("#wbCanvas .is-selected .wb-pane-state").getAttribute("aria-label")'), '연결 확인 필요');
    assert.equal(await evaluate('document.querySelector("#wbError").textContent'), '명령창 연결이 닫혔습니다.', 'show the useful error without Electron transport boilerplate');
    await evaluate('WhiteboxTerminal.mountTerminal = window.originalWorkspaceMount; delete window.originalWorkspaceMount; document.querySelector("#wbCanvas [data-retry-terminal]").click()');
    await waitFor('!document.querySelector("#wbCanvas .wb-pane-loading") && Boolean(document.querySelector("#wbCanvas canvas"))', 'mount retry reconnects the original terminal');
    assert.equal(await evaluate('document.querySelector("#wbError").hidden'), true, 'successful reconnect clears its stale error');
    assert.equal(manager.get(failedMountId).pid, failedMountPid);
    assert.equal(manager.list().length, beforeMountFailure + 1, 'retry never duplicates the shell');
    console.log('PASS sidebar new-panel separation and per-panel plus target, including a non-selected panel');
    console.log('PASS immediate panel creation feedback, duplicate prevention, failure rollback, anonymous sidebar boxes, selected-panel views and terminal state badges');
    // Exercise the public socket against a real shell through the real host.
    const { TerminalHostServer, TerminalHostClient } = require('../src/terminalHost');
    const { TerminalCollaboration } = require('../src/terminalCollaboration');
    const { main: panelCommand } = require('../bin/panel-control');
    const discoveryFile = path.join(profile, 'panel-test-host.json');
    const host = new TerminalHostServer({ manager, discoveryFile });
    const client = new TerminalHostClient({ discoveryFile });
    let control;
    try {
      await host.start(); await client.connect();
      control = new TerminalCollaboration({ manager: () => client, directory: path.join(profile, 'terminal-collaboration'), monitor: { scan: () => ({ available: true, processes: [] }) },
        onTerminalClosed: terminal => win.webContents.send('terminals:state', { change: 'removed', session: terminal, sessions: manager.list() }) });
      await forceCapture();
      await control.sync(collaborationPayload);
      const id = await evaluate('WhiteboxWorkspace.getState().activeId');
      await waitFor(` /[>%$#]\\s*$/.test(WhiteboxTerminal.readTerminal(${JSON.stringify(id)}).trimEnd())`, 'new shell startup prompt before socket input');
      await forceCapture(); await control.sync(collaborationPayload);
      const before = await client.get(id, false);
      const marker = 'PANEL_ENV=' + id;
      const oldFrame = { ...collaborationPayload.frames.find(frame => frame.id === id) };
      assert.equal(oldFrame.creationId, before.creationId);
      assert(!oldFrame.text.replace(/\s+/g, '').includes(marker));
      const opts = { directory: control.directory };
      const commandText = process.platform === 'win32' ? 'Write-Output "PANEL_ENV=$env:WHITEBOX_SURFACE_ID"' : 'printf "PANEL_ENV=%s\\n" "$WHITEBOX_SURFACE_ID"';
      // Shell startup/resize output can invalidate a captured frame. Only this
      // explicit pre-write rejection is safe to retry; unknown delivery, lost
      // acknowledgement, identity errors and accepted sends are never replayed.
      let submitted = false, rejectedFrame;
      for (let attempt = 0; attempt < 150 && !submitted; attempt++) {
        await forceCapture();
        await control.sync(collaborationPayload);
        try {
          await panelCommand(['send', '--source', id, '--surface', id, '--', commandText + '\n'], opts);
          submitted = true;
        } catch (error) {
          if (error.message !== 'Terminal state changed; retry after the next frame.') throw error;
          rejectedFrame = error;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      if (!submitted) throw rejectedFrame;
      await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(id)}).replace(/\\s+/g, '').includes(${JSON.stringify('PANEL_ENV=' + id)})`, 'real panel socket command and terminal env across wrapped rows');
      // A forced review can join an older in-flight collaboration capture.
      // Reproduce that stale observation once, then require the actual output
      // in a newer same-process frame. Only observations repeat; the accepted
      // command is never sent again and the existing fixture deadline stays.
      const servedBefore = staleCollaborationFramesServed;
      staleCollaborationFrameOnce = oldFrame;
      collaborationPayload = { ...collaborationPayload, frames: collaborationPayload.frames.map(frame => frame.id === id ? oldFrame : frame) };
      let observedPayload;
      for (let attempt = 0; attempt < 150; attempt++) {
        await forceCapture();
        const payload = collaborationPayload;
        const frame = payload.frames.find(frame => frame.id === id && frame.creationId === before.creationId);
        if (frame?.text.replace(/\s+/g, '').includes(marker)) { observedPayload = payload; break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(staleCollaborationFramesServed, servedBefore + 1, 'the stale in-flight observation was exercised');
      assert(observedPayload, 'a fresh collaboration frame must contain the real command output');
      await control.sync(observedPayload);
      const screen = await panelCommand(['read-screen', '--source', id, '--surface', id, '--json'], opts);
      assert.ok(screen.text.replace(/\s+/g, '').includes(marker));
      const after = await client.get(id, false);
      assert.equal(after.pid, before.pid); assert.equal(after.creationId, before.creationId);
      console.log('PASS real PTY → host socket → panel socket → CLI send/read, automatic surface env, unchanged process identity');
      if (process.platform !== 'win32') {
        const fixtureBin=path.join(profile,'provider-fixture'); fs.mkdirSync(fixtureBin);
        const fixture=path.join(root,'scripts/fixtures/panel-creation-provider.cjs');
        const quote=value=>"'"+value.replace(/'/g,"'\"'\"'")+"'";
        fs.writeFileSync(path.join(fixtureBin,'codex'),`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(process.execPath)} ${quote(fixture)} "$@"\n`,{mode:0o755});
        const newIds=[];
        control.createTerminal=async options=>{
          const session=await providerAdapter.createWorkspaceTerminal(client,options,adapterDirectory);
          newIds.push(session.id);
          await client.command(session.id,` export PATH=${quote(adapterDirectory)}:${quote(fixtureBin)}:"$PATH"; export WHITEBOX_PANEL_DIRECTORY=${quote(control.directory)}`);
          return session;
        };
        control.monitor={scan:()=>({available:true,processes:newIds.map(id=>manager.get(id)).filter(s=>s?.pid).map(s=>({pid:s.pid+1000,ancestorPids:[s.pid],provider:'codex'}))})};
        control.completion={observe:async()=>({available:false})};
        livePanelControl=control;
        const originalIds=manager.list().map(({id,pid,creationId})=>({id,pid,creationId}));
        const batch=await panelCommand(['new-terminal','codex','--count','3','--source',id,'--json'],opts);
        assert.equal(batch.jobs.length,3);
        await waitFor('WhiteboxWorkspace.getState().sessions.length === '+(originalIds.length+3),'CLI-created PTYs adopted by renderer');
        for(const job of batch.jobs) {
          await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(job.terminal.id)}).replace(/\\s+/g,'').includes('PANEL_TOOLS_READY')`,'new provider receives its Whitebox MCP configuration');
          const done=await panelCommand(['wait',job.id,'0','--source',id],opts); assert.equal(done.state,'completed');
        }
        assert.deepEqual(manager.list().filter(session=>originalIds.some(old=>old.id===session.id)).map(({id,pid,creationId})=>({id,pid,creationId})),originalIds,'creation never restarts existing PTYs');
        const sourceGroup=control.groups.get(batch.workspace_id);
        assert.ok(newIds.every(id=>sourceGroup.members.some(member=>member.id===id)),'all new providers belong to the requesting panel');
        // Deliver the greeting through the public CLI and read matched replies.
        const greeted=[];
        for(const target of newIds) {
          await evaluate(`WhiteboxWorkspace.selectPane('${target}'); if(!document.querySelector('#terminalWorkspace').classList.contains('terminal-expanded')) document.querySelector('[data-expand-terminal="${target}"]').click()`);
          await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(target)}).replace(/\\s+/g,'').includes('AskCodextodoanything')`,'provider input prompt');
          await evaluate('WhiteboxWorkspace.captureReviews(true)');
          let stableSequence=null, stableSince=Date.now(), ready=false;
          for(let attempt=0;attempt<100;attempt++) {
            const frame=control.frames.get(target), live=manager.get(target);
            if(frame?.outputSequence!==stableSequence) { stableSequence=frame?.outputSequence; stableSince=Date.now(); }
            ready=frame?.outputSequence===live.outputSequence && Date.now()-stableSince>300
              && require('../src/terminalReviewTurns').inputReady(frame.readinessText,'codex') && !frame.inputDraft;
            if(ready) break;
            await new Promise(resolve=>setTimeout(resolve,100));
          }
          assert.ok(ready,`provider has a current idle frame after resize: ${JSON.stringify(control.frames.get(target))}`);
          const greeting=await panelCommand(['ask','--source',id,'--surface',target,'--','ㅎㅇ'],opts); greeted.push(greeting.id);
          await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(target)}).includes('반가워요')`,'expanded fixture answer');
          await evaluate('WhiteboxWorkspace.captureReviews(true)');
        }
        for(const jobId of greeted) {
          await waitFor(`WhiteboxTerminal.readTerminal(${JSON.stringify(control.jobs.get(jobId).targetId)}).replace(/\\s+/g,'').includes('반가워요')`,'fixture greeting answer');
          await evaluate('WhiteboxWorkspace.captureReviews(true)');
          const result=await panelCommand(['wait',jobId,'0','--source',id],opts);
          assert.equal(result.state,'completed'); assert.match(result.answer,/반가워요/u);
        }
        console.log('PASS CLI new-terminal --count 3 → real PTYs → renderer adoption → provider adapter/MCP discovery → same-panel greeting/three matched replies (fixture providers)');
        const trashBeforeClose = await evaluate('WhiteboxWorkspace.getState().trash.length');
        const assertPaneGone = async target => {
          await waitFor(`!WhiteboxWorkspace.getState().sessions.some(s=>s.id===${JSON.stringify(target)}) && !document.querySelector('[data-terminal-id="${target}"]')`, 'closed terminal removed from renderer and canvas');
          assert.equal(await client.get(target, false), null, 'host removal acknowledged');
          assert.equal(await evaluate('WhiteboxWorkspace.getState().trash.length'), trashBeforeClose, 'direct close does not archive the terminal');
          assert.equal(await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('whitebox:workspace:v2'))).includes(${JSON.stringify(target)})`), false, 'closed pane is removed from saved layout and review records');
        };
        const [xTarget, cliTarget, stoppedTarget] = newIds;
        await evaluate(`WhiteboxWorkspace.selectPane(${JSON.stringify(xTarget)},true)`);
        rejectedStopId = xTarget;
        await evaluate(`document.querySelector('.wb-instance-row [data-trash-terminal="${xTarget}"]').click()`);
        await waitFor('!WhiteboxWorkspace.getState().busy && document.querySelector("#wbError").textContent.includes("fixture stop failure")', 'failed sidebar trash retains its pane');
        assert(manager.get(xTarget));
        assert.equal(await evaluate(`Boolean(document.querySelector('[data-terminal-id="${xTarget}"]'))`), true);
        assert.equal(await evaluate('WhiteboxWorkspace.getState().trash.length'), trashBeforeClose);
        rejectedStopId = '';
        await evaluate('document.querySelector("[data-action=dismiss-error]").click()');
        await evaluate(`document.querySelector('.wb-instance-row [data-trash-terminal="${xTarget}"]').click()`);
        await waitFor(`!WhiteboxWorkspace.getState().busy && WhiteboxWorkspace.getState().trash.some(i=>i.id===${JSON.stringify(xTarget)}) && !document.querySelector('[data-terminal-id="${xTarget}"]')`, 'sidebar trash icon archives the terminal');
        assert.equal(manager.get(xTarget)?.status, 'stopped', 'the archived session is stopped, not removed');
        await evaluate('document.querySelector("[data-action=trash]").click()'); // the trash list is built when the trash opens
        await evaluate(`document.querySelector('#wbTrash [data-purge-instance="${xTarget}"]').click()`);
        await waitFor('document.querySelector("#wbClose").open', 'purge asks for confirmation');
        await evaluate('document.querySelector("#wbClose").close("close")');
        await assertPaneGone(xTarget);
        await waitFor('!WhiteboxWorkspace.getState().busy', 'trash purge completed');
        await evaluate('WhiteboxWorkspace.captureReviews(true)'); await control.sync(collaborationPayload);
        assert.equal((await panelCommand(['close-terminal', cliTarget, '--source', id, '--json'], opts)).closed, true);
        await assertPaneGone(cliTarget);
        await client.stop(stoppedTarget);
        await waitFor(`WhiteboxWorkspace.getState().sessions.find(s=>s.id===${JSON.stringify(stoppedTarget)})?.status === 'stopped'`, 'stopped pane remains available to close');
        await evaluate('WhiteboxWorkspace.captureReviews(true)'); await control.sync(collaborationPayload);
        const stoppedRoster = await panelCommand(['list-panels', '--source', id, '--json'], opts);
        assert.equal(stoppedRoster.surfaces.find(s=>s.id===stoppedTarget).status, 'stopped');
        await panelCommand(['close-terminal', stoppedTarget, '--source', id], opts); await assertPaneGone(stoppedTarget);
        const beforeGhostIds = new Set(manager.list().map(s=>s.id));
        await evaluateData(workspaceId => { const s=WhiteboxWorkspace.getState(), owner=[...s.spaces,s.standalone].find(o=>o.tabs.some(p=>p.id===workspaceId)); return WhiteboxWorkspace.createTerminal('row',owner,workspaceId); }, batch.workspace_id);
        const ghost = manager.list().find(s=>!beforeGhostIds.has(s.id)); assert(ghost);
        let ghostRoster;
        for (let attempt=0; attempt<100; attempt++) {
          await evaluate('WhiteboxWorkspace.captureReviews(true)');
          if (collaborationPayload.groups.some(g=>g.id===batch.workspace_id && g.members.some(s=>s.id===ghost.id))) { ghostRoster=collaborationPayload; break; }
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        assert(ghostRoster, 'orphan fixture must first belong to the actual requesting panel');
        suppressedRemovalId = ghost.id;
        await client.close(ghost.id);
        assert.equal(await evaluate(`Boolean(document.querySelector('[data-terminal-id="${ghost.id}"]'))`), true, 'reproduce a pane whose host record is already gone');
        suppressedRemovalId = '';
        await control.sync(ghostRoster);
        assert.equal((await panelCommand(['list-panels', '--source', id], opts)).surfaces.find(s=>s.id===ghost.id).status, 'removed');
        await panelCommand(['close-terminal', ghost.id, '--source', id], opts); await assertPaneGone(ghost.id);
        // An old removal event must not erase a different creation identity.
        win.webContents.send('terminals:state', { change: 'removed', session: { id, creationId: 'different-epoch' }, sessions: [] });
        await evaluate('new Promise(resolve=>setTimeout(resolve,50))');
        assert.equal(await evaluate(`WhiteboxWorkspace.getState().sessions.some(s=>s.id===${JSON.stringify(id)})`), true);
        assert.deepEqual(manager.list().filter(s=>originalIds.some(old=>old.id===s.id)).map(({id,pid,creationId})=>({id,pid,creationId})), originalIds, 'close does not restart or terminate any other terminal');
        await win.reload(); await waitFor('Boolean(window.WhiteboxWorkspace)', 'reload after direct close');
        for (const target of [...newIds, ghost.id]) {
          assert.equal(await evaluate(`WhiteboxWorkspace.getState().sessions.some(s=>s.id===${JSON.stringify(target)})`), false, 'closed panes stay closed after reload');
        }
        console.log('PASS real pane X, sidebar X and CLI close: live/stopped/orphan PTYs, removal events, no trash, saved layout/reload, failure retention and unrelated-terminal identity');
      }

    } finally { livePanelControl=null; await control?.control.close(); client.dispose({ preserveHost: true }); host.dispose(); }
    // Bulk deletion must never touch a live terminal outside the trash.
    const batchIds = manager.list().slice(-2).map(item => item.id);
    const survivor = manager.list().find(item => !batchIds.includes(item.id));
    for (const id of batchIds) {
      await evaluate(`WhiteboxWorkspace.trashInstance(${JSON.stringify(id)})`);
      await waitFor(`!WhiteboxWorkspace.getState().busy && WhiteboxWorkspace.getState().trash.some(item => item.id === ${JSON.stringify(id)})`, 'prepare bulk trash');
    }
    await evaluate('document.querySelector("[data-action=trash]").click()');
    const trashBefore = await evaluate('WhiteboxWorkspace.getState().trash.length');
    const confirmEmpty = async () => {
      await evaluate('document.querySelector("[data-action=trash-empty]").click()');
      await waitFor('document.querySelector("#wbEmptyTrash").open', 'empty-trash confirmation');
      await evaluate('document.querySelector("#wbEmptyTrash button[value=empty]").click()');
      await waitFor('!WhiteboxWorkspace.getState().busy', 'empty-trash settled');
    };
    await evaluate('document.querySelector("[data-action=trash-empty]").click()');
    await waitFor('document.querySelector("#wbEmptyTrash").open', 'bulk cancel confirmation');
    assert.ok((await evaluate('document.querySelector("#wbEmptyTrashDescription").textContent')).includes(String(trashBefore)));
    await evaluate('document.querySelector("#wbEmptyTrash button[value=cancel]").click()');
    await waitFor('!WhiteboxWorkspace.getState().busy', 'bulk cancel');
    assert.equal(await evaluate('WhiteboxWorkspace.getState().trash.length'), trashBefore);
    assert.ok(batchIds.every(id => manager.get(id)), 'cancel never closes a session');
    rejectRestoreIdentity = true;
    await confirmEmpty();
    assert.ok(batchIds.every(id => manager.get(id)), 'replacement identity must not be terminated');
    assert.equal(await evaluate('WhiteboxWorkspace.getState().trash.length'), 2, 'orphan metadata removed; changed identities retained');
    rejectRestoreIdentity = false; rejectedCloseId = batchIds[0];
    await confirmEmpty();
    assert.equal(await evaluate('WhiteboxWorkspace.getState().trash.length'), 1, 'partial failure preserves only failed item');
    assert.ok(manager.get(batchIds[0])); assert.equal(manager.get(batchIds[1]), null);
    assert.match(await evaluate('document.querySelector("#wbTrashNotice").textContent'), /1개 삭제.*1개는 삭제하지 못해/u);
    rejectedCloseId = '';
    await confirmEmpty();
    assert.equal(await evaluate('WhiteboxWorkspace.getState().trash.length'), 0);
    assert.equal(await evaluate('document.querySelector("[data-action=trash-empty]").disabled'), true);
    assert.equal(manager.get(survivor.id).pid, survivor.pid, 'outside-trash terminal remains running');
    await evaluate(`document.querySelector('#wbTrash').close(); document.querySelector('[data-instance="${survivor.id}"]').click()`);
    await manager.write(survivor.id, 'exit\r');
    await waitFor(`document.querySelector('[data-terminal-id="${survivor.id}"] .wb-pane-state').getAttribute('aria-label') === '종료됨'`, 'real shell exit updates the pane state');
    assert.equal(await evaluate(`document.querySelector('[data-instance="${survivor.id}"] .wb-terminal-state').getAttribute('aria-label')`), '종료됨', 'sidebar reflects the same real exit');
    assert.match(await evaluate('document.querySelector("#wbTerminalStatus .wb-terminal-state").getAttribute("aria-label")'), /종료됨/u);
    console.log('PASS delayed mount visibility, failed mount retry without duplicate PTYs, and live exit state in pane/sidebar/footer');
    console.log('PASS empty-trash confirmation/cancel, missing sessions, changed identity protection, partial failure/retry and empty state');
    console.log('PASS button-free automatic panel membership, scoped roster/frames without prompt injection');
    console.log('PASS trash stops the real PTY, frees active capacity, preserves read-only output/review records, and handles failed termination without hiding the live terminal');
    console.log('PASS locale switching and session persistence; trash/restore/stopped output persistence/purge, independent and project ownership, SVG icons, deletion/cancel/reload, token usage, responsive widths and expansion; real PTY workspace: shell creation, Unicode, nested splits, per-terminal review focus/evidence, reload persistence, tabs and exact close');
    await win.loadURL('about:blank');
    const readyBeforeFailure = rendererReadyCalls;
    const readsBeforeFailure = initialInventoryReads;
    inventoryUnavailable = true;
    await win.loadFile(path.join(root, 'renderer/index.html'));
    await waitFor(`!document.querySelector('#wbError').hidden && document.querySelector('#wbError').textContent.includes('fixture: packaged terminal host is still starting')`, 'persistent inventory failure stays visible');
    assert(initialInventoryReads - readsBeforeFailure >= 3, 'persistent failure must survive the startup retry budget');
    const settledReads = initialInventoryReads;
    await new Promise(resolve => setTimeout(resolve, 750));
    assert.equal(initialInventoryReads, settledReads, 'startup retries must stop after the visible persistent error');
    assert.equal(rendererReadyCalls, readyBeforeFailure, 'permanent host failure must never count as renderer readiness');
    inventoryUnavailable = false;
    await win.loadFile(path.join(root, 'renderer/index.html'));
    await waitFor('!!window.WhiteboxWorkspace', 'workspace recovers after the host becomes available');
    assert(rendererReadyCalls > readyBeforeFailure);
    console.log('PASS startup inventory recovery, bounded permanent-failure retries, and no false renderer-ready signal');
    clearTimeout(deadline);
    await manager.dispose();
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (chatFixture) {
      console.error('Chat jobs:', [...chatFixture.controller.jobs.values()]);
      console.error('Chat UI:', await win.webContents.executeJavaScript(`JSON.stringify(Array.from(document.querySelectorAll('.wb-chat'), node => ({ hidden: node.hidden, log: node.querySelector('.wb-chat-log')?.textContent.slice(-600), notice: node.querySelector('.wb-chat-notice')?.textContent })))`).catch(error => String(error)));
    }

    console.error('Fixture host outputs:', manager.list().map(session => ({ id: session.id, replay: manager.get(session.id, true)?.replay })));
    console.error('Fixture terminal outputs:', await win.webContents.executeJavaScript('JSON.stringify(window.WhiteboxWorkspace?.getState().sessions.map(session => ({id:session.id, text:WhiteboxTerminal.readTerminal(session.id)})) || [])').catch(error => error.message));
    fs.writeFileSync(path.join(os.tmpdir(), 'whitebox-workspace-failure.png'), (await win.webContents.capturePage()).toPNG());
    clearTimeout(deadline);
    await manager.dispose();
    win?.destroy();
    app.exit(1);
  }
});
