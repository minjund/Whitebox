'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { AgentRunner } = require('../src/agentRunner');
const { preflightAutomaticUpdate } = require('../src/updateInstaller');

(async () => {
  const runner = Object.create(AgentRunner.prototype);
  Object.assign(runner, { active:new Map(), disposing:false, disposePromise:null, disposeResult:null });
  runner.prepareForUpdate([]);
  const disposal = runner.dispose();
  assert.equal(runner.resumeAfterUpdateFailure(),false,'In-flight disposal must remain blocked');
  await disposal;
  assert.equal(runner.resumeAfterUpdateFailure(),true);
  runner.prepareForUpdate([]);
  await runner.dispose();
  runner.disposeResult.errors.push({error:'unconfirmed termination'});
  assert.equal(runner.resumeAfterUpdateFailure(),false,'Unconfirmed cleanup must remain blocked');
  runner.disposeResult.errors.length=0;
  assert.equal(runner.resumeAfterUpdateFailure(),true);

  // Execute the production main-process lifecycle with only OS boundaries
  // replaced: a first host failure must not start a helper or poison retry.
  const main=fs.readFileSync(require.resolve('../main.js'),'utf8');
  for(const platform of ['win32','darwin']) {
    let hostCalls=0,helpers=0,quits=0;
    const events=[];
    class Host { async shutdownForUpdate(){if(++hostCalls===1)throw Error('host shutdown failure');} async recoverAfterUpdateFailure(){} }
    const manager={state:{status:'downloaded',downloadedPath:'fixture',asset:{},latestVersion:'1.8.4'},
      async download(){return this.getState();},getState(){return {...this.state};},setState(patch){Object.assign(this.state,patch);}};
    const lifecycle={fs:{mkdirSync(){},appendFileSync(_file,line){events.push(JSON.parse(line));}},
      userFile:x=>x,crypto:require('node:crypto'),process:{platform,pid:123},updateManager:manager,
      updateInstallPlan:async()=>({installType:'desktop',installMode:'automatic',appPath:'fixture'}),
      shell:{},ALLOW_UNSIGNED_WINDOWS_UPDATES:true,ALLOW_UNSIGNED_MAC_UPDATES:true,
      canInstallSilently:()=>true,verifyDownloadedInstaller:async()=>{},preflightAutomaticUpdate:async()=>{},
      updateWorkloadImpact:async()=>({agentRuns:[],terminalSessions:[]}),confirmActiveTerminalUpdate:async()=>true,
      runner,TerminalHostClient:Host,terminalManager:new Host(),requireAgentRunnerUpdateShutdown:x=>x,
      launchDownloadedUpdate:async()=>{helpers++;return {mode:'automatic'};},reportRecoverableError(){},
      updateInstallPromise:null,setImmediate:fn=>fn(),app:{quit(){quits++;}},isQuitting:false};
    vm.createContext(lifecycle);
    vm.runInContext(main.slice(main.indexOf('function recordUpdateInstallEvent('),main.indexOf('async function setupAttentionRuntime()')),lifecycle);
    await assert.rejects(lifecycle.installDownloadedUpdate(),/host shutdown failure/);
    assert.equal(helpers,0);assert.equal(quits,0);assert.match(manager.state.error,/host shutdown failure/);
    await lifecycle.installDownloadedUpdate();
    assert.equal(helpers,1);assert.equal(quits,1);assert.equal(manager.state.error,'');
    const success=events.filter(e=>e.attemptId===events.at(-1).attemptId).map(e=>e.stage);
    assert(success.indexOf('workload-stopped')<success.indexOf('helper-ready'));
    assert(runner.resumeAfterUpdateFailure());
  }

  for (const scenario of ['cleanup-fails', 'verification-fails', 'old-host', 'external-host', 'active-terminal', 'active-direct']) {
    const events = [];
    let helpers = 0, quits = 0, prompts = 0, forceCalls = 0;
    class Host {
      constructor() { this.capabilities = scenario === 'old-host' ? {} : { forceStopForUpdate: 1 }; }
      async shutdownForUpdate(_sessions, _timeout, options) {
        if (!options?.force) throw new Error('terminal cleanup failed');
        forceCalls += 1;
        if (scenario === 'force-fails') throw new Error('process exit remains unconfirmed');
      }
      async recoverAfterUpdateFailure() {}
      dispose(options) { assert.equal(options.preserveHost, true); assert.equal(this.updateShutdown, true); }
    }
    const manager = { state: { status: 'downloaded', downloadedPath: 'fixture', asset: {}, latestVersion: '1.8.13' },
      async download() { return this.getState(); }, getState() { return { ...this.state }; },
      setState(patch) { Object.assign(this.state, patch); } };
    const lifecycle = { fs: { mkdirSync() {}, appendFileSync(_file, line) { events.push(JSON.parse(line)); } },
      userFile: x => x, crypto: require('node:crypto'), process: { platform: 'win32', pid: 123 }, updateManager: manager,
      updateInstallPlan: async () => ({ installType: 'desktop', installMode: 'automatic', appPath: 'fixture' }),
      shell: {}, ALLOW_UNSIGNED_WINDOWS_UPDATES: true, ALLOW_UNSIGNED_MAC_UPDATES: true,
      canInstallSilently: () => true,
      verifyDownloadedInstaller: async () => { if (scenario === 'verification-fails') throw new Error('digest mismatch'); },
      preflightAutomaticUpdate: async () => {},
      updateWorkloadImpact: async () => ({ agentRuns: scenario === 'active-direct' ? [{ runId: 'live-run' }] : [], terminalSessions: scenario === 'active-terminal' ? [{ id: 'live', status: 'running' }] : [], externalHost: scenario === 'external-host' }),
      externalTerminalHost: async () => true, confirmActiveTerminalUpdate: async () => true,
      confirmForceTerminalUpdate: async () => { prompts += 1; return scenario !== 'cancel'; },
      runner: null, TerminalHostClient: Host, terminalManager: new Host(),
      launchDownloadedUpdate: async () => { helpers += 1; return { mode: 'automatic' }; }, reportRecoverableError() {},
      updateInstallPromise: null, setImmediate: fn => fn(), app: { quit() { quits += 1; } }, isQuitting: false };
    vm.createContext(lifecycle);
    vm.runInContext(main.slice(main.indexOf('function recordUpdateInstallEvent('), main.indexOf('async function setupAttentionRuntime()')), lifecycle);
    if (scenario === 'external-host') await lifecycle.installDownloadedUpdate();
    else await assert.rejects(lifecycle.installDownloadedUpdate(), /cleanup failed|digest mismatch|설치를 보류/);
    assert.equal(helpers, scenario === 'external-host' ? 1 : 0, scenario);
    assert.equal(quits, helpers, scenario);
    assert.equal(prompts, 0, 'Updates must never offer to force-stop work');
    assert.equal(forceCalls, 0, 'Updates must never force-stop work');
    assert(!events.some(event => event.stage === 'workload-force-confirmed'));

  }

  // Current workspace install-click deduplication, errors and retry are exercised
  // through the actual renderer in terminal-workspace-check.js.

  await assert.rejects(preflightAutomaticUpdate({platform:'darwin',installType:'desktop',
    installerPath:'/tmp/updates/Whitebox-1.8.4-arm64.dmg',downloadsDir:'/tmp/updates',
    appPath:'/Applications/Whitebox.app/Contents/MacOS/Whitebox',access:async()=>{throw Error('EACCES');}}),/쓰기 권한/);
  console.log('PASS update retry, in-flight and failed cleanup guards, macOS write preflight');
})().catch(error=>{console.error(error);process.exitCode=1;});
