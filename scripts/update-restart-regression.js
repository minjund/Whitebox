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

  let calls=0, resolveInstall;
  const nodes=new Map();
  const $=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{addEventListener(type,action){this[type]=action;}});
    return nodes.get(selector);
  };
  const state={update:{status:'available',asset:{},error:''}};
  const context={window:{WhiteboxAppFactories:{},WhiteboxI18n:{t:x=>x,errorText:e=>e.message},whitebox:{
    installDownloadedUpdate:()=>{calls++;return new Promise((resolve,reject)=>{resolveInstall={resolve,reject};});}
  }}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../renderer/app-events-navigation.js'),'utf8'),context);
  context.window.WhiteboxAppFactories.createNavigationEventBindings({$,state,renderUpdateSettings(){},toast(){}}).bindNavigationAndUpdateEvents();
  const first=$('#installUpdateBtn').click();
  await $('#installUpdateBtn').click(); assert.equal(calls,1,'Duplicate clicks must not mutate the in-flight attempt');
  resolveInstall.reject(new Error('persistent failure')); await first;
  assert.equal(state.update.error,'persistent failure');assert.equal(state.updateInstallPending,false);
  const retry=$('#installUpdateBtn').click(); assert.equal(state.update.error,'');
  resolveInstall.resolve({status:'downloaded',installMode:'manual',error:''}); await retry;
  assert.equal(calls,2);

  await assert.rejects(preflightAutomaticUpdate({platform:'darwin',installType:'desktop',
    installerPath:'/tmp/updates/Whitebox-1.8.4-arm64.dmg',downloadsDir:'/tmp/updates',
    appPath:'/Applications/Whitebox.app/Contents/MacOS/Whitebox',access:async()=>{throw Error('EACCES');}}),/쓰기 권한/);
  console.log('PASS update retry, in-flight and failed cleanup guards, duplicate clicks, persistent errors, macOS write preflight');
})().catch(error=>{console.error(error);process.exitCode=1;});
