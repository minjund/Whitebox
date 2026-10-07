'use strict';
const assert = require('assert/strict');
const { TerminalManager } = require('../src/terminalManager');
const { TerminalGroups } = require('../src/terminalGroups');
let nextPid = 900000;
const manager = new TerminalManager({
  platform: 'darwin', killTree() {},
  managedTmuxRuntime: { available: () => true, existsStrict: () => true, stopStrict: () => ({ok:true}) },
  ptyModule: { spawn: () => ({ pid: nextPid++, onData() {}, onExit() {}, write() {}, resize() {}, kill() {} }) },
});
(async () => {
  for (let i=0; i<24; i++) manager.create({type:'agent',provider:'grok',cwd:process.cwd(),bridgeId:`grok:history-${i}`,args:[]});
  const groupService = new TerminalGroups({manager:()=>manager});
  const group = await groupService.create({cwd:process.cwd(),name:'capacity fixture'});
  const member = await groupService.add(group.id,{provider:'grok'});
  assert.equal(member.terminal.backend,'managed-tmux');
  assert.equal(manager.list().length,25);
  for (let i=1; i<32; i++) await groupService.add(group.id,{provider:'grok'});
  await assert.rejects(groupService.add(group.id,{provider:'grok'}),/32개/);
  assert.equal(manager.list().length,56,'old conversation connections survive');
  manager.dispose({preserveSessions:true});
  console.log('✓ 24 prior conversation attachments do not block group creation; group quota is explicit and independent');
})().catch(error=>{console.error(error);process.exitCode=1});
