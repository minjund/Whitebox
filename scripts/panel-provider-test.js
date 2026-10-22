'use strict';
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { EventEmitter } = require('events');
const { install, workspaceOptions, providerArgs, resolveProvider, main } = require('../bin/panel-provider');
const { dispatch } = require('../bin/panel-mcp');
const { spawn } = require('child_process');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-provider-'));
  try {
    const managed = path.join(root, 'managed'), original = path.join(root, 'original');
    fs.mkdirSync(original);
    for (const provider of ['claude','codex']) fs.writeFileSync(path.join(original,provider), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    assert.equal(install({ directory: managed, platform: 'linux' }).length, 2);
    const env = { PATH: managed + path.delimiter + original, WHITEBOX_PANEL_BRIDGE_ACTIVE: '' };
    assert.equal(resolveProvider('codex', env, managed), path.join(original,'codex'));
    const options = workspaceOptions({ type: 'shell', creationId: 'workspace:test' }, managed, 'linux');
    assert.match(options.initialCommand, /export PATH=/);
    assert.equal(workspaceOptions({ type: 'shell', initialCommand: 'custom', creationId: 'workspace:test' }, managed).initialCommand, 'custom');
    assert.equal(workspaceOptions({ type: 'shell', creationId: 'outside' }, managed).initialCommand, undefined);
    if (fs.existsSync('/bin/zsh')) {
    const shell = require('child_process').spawnSync('/bin/zsh', ['-lic', options.initialCommand + '; command -v claude; command -v codex'], { encoding: 'utf8', env: { ...process.env, TERM: 'xterm' } });
    assert.equal(shell.status, 0); assert.ok(shell.stdout.includes(path.join(managed,'claude')) && shell.stdout.includes(path.join(managed,'codex')), 'login shell path reordering cannot hide the adapters');
    }
    const server = { command: '/runtime/node', args: ['/app/panel-mcp.js'], env: { ELECTRON_RUN_AS_NODE: '1', WHITEBOX_SURFACE_ID: 'terminal:test' } };
    const claude = providerArgs('claude', ['--model','sonnet','hello'],server);
    assert.deepEqual(claude.slice(0,3), ['--model','sonnet','hello']);
    assert.equal(JSON.parse(claude.at(-1)).mcpServers.whitebox_panel.command, '/runtime/node');
    const custom = providerArgs('claude',['--mcp-config','custom.json','--model','sonnet'],server);
    assert.equal(custom.filter(a=>a==='--mcp-config').length,1); assert.ok(custom.includes('custom.json'));
    assert.equal(providerArgs('claude',['--','hello'],server).at(-2),'--');
    const codex = providerArgs('codex',['resume','--last'],server);
    assert.ok(codex.includes('mcp_servers.whitebox_panel.command="/runtime/node"'));
    assert.deepEqual(codex.slice(-2),['resume','--last']);
    for (const args of [['--help'],['-p','hello'],['exec','hello'],['mcp','list'],['app-server']]) assert.deepEqual(providerArgs('codex',args,server),args);
    let launched;
    const mockSpawn=(file,args,options)=>{launched={file,args,options};return Object.assign(new EventEmitter(),{kill:()=>{}})};
    await main('claude',['hello'],{env,directory:managed,spawn:mockSpawn,control:async()=>({surface_id:'terminal:test'})});
    assert.ok(launched.args.includes('--mcp-config')); assert.equal(launched.options.env.ELECTRON_RUN_AS_NODE,undefined);
    await main('claude',['hello'],{env,directory:managed,spawn:mockSpawn,control:async()=>{throw Error('outside')}});
    assert.deepEqual(launched.args,['hello'],'outside Whitebox is unchanged');
    let called;
    const run=async args=>{called=args;return {state:'running',id:'job'}};
    const list=await dispatch('tools/list'); assert.equal(list.tools.length,4); assert.match(list.tools[0].description,/same panel/);
    await dispatch('tools/call',{name:'whitebox_ask',arguments:{target:'codex',message:'--source other ㅎㅇ'}},run);
    assert.deepEqual(called,['ask','--surface','codex','--','--source other ㅎㅇ']);
    const bad=await dispatch('tools/call',{name:'whitebox_wait',arguments:{jobId:'--source'}},run); assert.equal(bad.isError,true);
    const failed=await dispatch('tools/call',{name:'whitebox_list_terminals'},async()=>{throw Error('outside panel')}); assert.equal(failed.isError,true);
    const child=spawn(process.execPath,[path.resolve(__dirname,'../bin/panel-mcp.js')],{stdio:['pipe','pipe','pipe']});
    let output='';child.stdout.on('data',data=>output+=data);
    child.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}})+'\n'+JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');
    await new Promise((resolve,reject)=>{child.once('exit',code=>code===0?resolve():reject(Error('server failed'))); child.once('error',reject)});
    const frames=output.trim().split('\n').map(JSON.parse); assert.equal(frames.length,2); assert.equal(frames[1].result.tools.length,4);
    fs.writeFileSync(path.join(managed,'claude'),'custom launcher'); assert.throws(()=>install({directory:managed,platform:'linux'}),/unmanaged/);
    console.log('PASS provider discovery: launch-scoped MCP, custom config preservation, passthrough, original executable resolution, scoped tool arguments and real stdio handshake');
  } finally {fs.rmSync(root,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
