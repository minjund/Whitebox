'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { TerminalCollaboration } = require('../src/terminalCollaboration');
const { main: cli } = require('../bin/panel-agent');
const { main: control, request: rpc } = require('../bin/panel-control');
const { completedTurn, completionStamp, inputReady } = require('../src/terminalReviewTurns');
(async () => {
 await require('./terminal-panel-close-test')();
 require('./panel-control-directory-test')();
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-collaboration-'));
 const controls = [];
 try {
  let now = Date.now(), native = { available: false }, writes = [];
  const sessions = ['source', 'target', 'outside'].map((name, i) => ({ id: `terminal:${name}`, creationId: `epoch-${name}`, pid: 100+i, status: 'running', outputSequence: 1, title: 'codex' }));
  const manager = { get: async id => sessions.find(s => s.id === id), rawWriteDeliverySupported: () => true, write: async (id,data,options) => { writes.push({ id,data,options }); }, create: async options => { const s = { id: 'terminal:new', creationId: options.creationId, pid: 104, status: 'running', outputSequence: 1 }; sessions.push(s); return s; }, command: async (id,command) => writes.push({id,command}) };
  const monitor = { scan: () => ({ available: true, processes: sessions.map(s => ({ pid: s.pid+1000, ancestorPids: [s.pid], provider: 'codex' })) }) };
  const options = { enableControl: false, directory, manager: () => manager, monitor, completion: { observe: async () => native }, now: () => now };
  const c = new TerminalCollaboration(options);
  const payload = () => ({ groups: [{ id: 'group', cwd: directory, members: sessions.slice(0,2) }], frames: sessions.map(s => ({ id: s.id, creationId: s.creationId, outputSequence: s.outputSequence, text: '› Ask Codex to do anything\n  GPT-6 high · test\n  ← for agents · ? for shortcuts', inputDraft: '' })) });
  await c.sync(payload());
  await c.connect('group', 'terminal:source');
  assert.equal(writes.length,0, 'connecting never writes to the AI');
  assert.deepEqual((await cli(['terminal:source','list'],directory)).terminals.map(s => s.id), ['terminal:target']);
  const ask = async (message='ㅎㅇ') => cli(['terminal:source','ask','terminal:target',message],directory);
  let job = await ask(); await c.sync(payload());
  assert.equal(c.jobs.get(job.id).state,'running');
  assert.equal(writes.length,1);
  assert.equal(writes[0].data,'\x1b[200~ㅎㅇ\x1b[201~\r');
  assert.equal(writes[0].options.expectedOutputSequence,1);
  await c.sync(payload()); assert.equal(writes.length,1,'no replay on repeated polling');
  let second = await ask(); await c.sync(payload()); assert.equal(c.jobs.get(second.id).state,'failed','busy target cannot accept another job');
  let p = payload(); p.frames[1].text = '› ㅎㅇ\n• 안녕하세요!\n  Worked for 2s • 3:40 PM\n› Ask Codex to do anything\n  GPT-6 high · test';
  await c.sync(p); assert.equal(c.jobs.get(job.id).state,'completed');
  assert.match((await cli(['terminal:source','wait',job.id,'0'],directory)).answer,/안녕하세요/u);
  p=payload(); p.frames[1].inputDraft='사용자 작성 중'; await c.sync(p);
  job=await ask(); await c.sync(p); assert.equal(c.jobs.get(job.id).state,'failed'); assert.equal(writes.length,1,'IME textarea draft blocks delivery');
  p=payload(); p.frames[1].text='› existing draft'; await c.sync(p); job=await ask(); await c.sync(p); assert.equal(c.jobs.get(job.id).state,'failed');
  p=payload(); await c.sync(p); native={available:true,state:'working'}; job=await ask(); await c.sync(p); assert.equal(c.jobs.get(job.id).state,'failed');
  const forceFromAgent = { id:randomUUID(), operation:'ask', sourceId:'terminal:source', groupId:'group',
    token:c.connected.get('terminal:source').token, targetId:'terminal:target', message:'agent cannot force delivery', sendNow:true };
  fs.writeFileSync(path.join(directory,`${forceFromAgent.id}.request.json`),JSON.stringify(forceFromAgent)); await c.sync(p);
  assert.equal(c.jobs.get(forceFromAgent.id).state,'failed','agent request fields cannot opt into the user-only send-anyway action');
  assert.equal(writes.length,1,'forged immediate delivery never reaches the PTY');
  native={available:false}; await c.sync(p);
  const forged={id:randomUUID(),operation:'ask',sourceId:'terminal:source',groupId:'group',token:c.connected.get('terminal:source').token,targetId:'terminal:outside',message:'no'};
  fs.writeFileSync(path.join(directory,`${forged.id}.request.json`),JSON.stringify(forged)); await c.sync(p); assert.equal(c.jobs.get(forged.id).state,'failed');
  native={available:true,state:'completed',requestId:'old',requestAt:now-1,request:'old',evidence:'old'};
  job=await ask(); await c.sync(p); assert.equal(c.jobs.get(job.id).state,'running');
  native={available:true,state:'completed',requestId:'other',requestAt:now+1,request:'다른 요청',evidence:'wrong'}; await c.sync(p); assert.equal(c.jobs.get(job.id).state,'running','unrelated native answer is not returned');
  native={...native,request:'ㅎㅇ',evidence:'USER: ㅎㅇ\nASSISTANT: 안녕하세요'}; await c.sync(p); assert.equal(c.jobs.get(job.id).state,'completed');
  native={available:false}; job=await ask(); await c.sync(p);
  p.frames[1].text='› ㅎㅇ\n• 답\nWorked for 2s • 3:40 PM\n› 다른 요청\n• 다른 답\nWorked for 3s • 3:41 PM\n› Ask Codex to do anything';
  await c.sync(p); assert.equal(c.jobs.get(job.id).state,'running','later screen turn cannot be attributed');
  now+=16*60*1000; await c.sync({groups:payload().groups,frames:[]}); assert.equal(c.jobs.get(job.id).state,'interrupted','stale screen cannot wait forever');
  // Real ask cohort (2026-11-10, one Claude target): epic steps ran 30-60 minutes,
  // each was cut at 15 minutes, and the next ask then failed with
  // "상대 AI가 아직 작업 중입니다." A target that keeps working keeps its job.
  {
    const working = payload(); working.frames[1].text = '› 에픽 3단계 구현\n• Working (41m 3s • esc to interrupt)';
    native = { available: true, state: 'completed', inputWaiting: true, requestId: 'prior', requestAt: now - 60_000, request: 'prior', completedAt: now - 30_000, evidence: 'prior' };
    await c.sync(payload()); const long = await ask('에픽 3단계 구현'); await c.sync(payload());
    assert.equal(c.jobs.get(long.id).state, 'running');
    for (let minute = 1; minute <= 60; minute += 1) {
      now += 60_000;
      native = { available: true, state: 'working', inputWaiting: false, requestId: 'long', requestAt: c.jobs.get(long.id).sentAt + 100, request: '에픽 3단계 구현' };
      await c.sync(working);
    }
    assert.equal(c.jobs.get(long.id).state, 'running', 'a target still working after 60 minutes keeps its job');
    const blocked = await ask('다음 단계'); await c.sync(working);
    assert.equal(c.jobs.get(blocked.id).error, '상대에게 전달한 작업이 아직 진행 중입니다.', 'a later ask names the running job, not a timeout');
    now += 60_000; native = { ...native, state: 'completed', inputWaiting: true, completedAt: now, evidence: 'USER: 에픽 3단계 구현\nASSISTANT: 3단계 완료' };
    await c.sync(payload());
    assert.equal(c.jobs.get(long.id).state, 'completed', 'the long turn completes with its own answer');
    assert.match((await cli(['terminal:source', 'wait', long.id, '0'], directory)).answer, /3단계 완료/u);
    // Without any sign of work the job still ends: 15 minutes after the last one.
    const silent = await ask('조용한 요청'); await c.sync(payload());
    native = { available: false };
    now += 14 * 60 * 1000; await c.sync({ groups: payload().groups, frames: [] });
    assert.equal(c.jobs.get(silent.id).state, 'running');
    now += 2 * 60 * 1000; await c.sync({ groups: payload().groups, frames: [] });
    assert.match(c.jobs.get(silent.id).error, /15분 동안 상대 AI의 작업 신호/u, 'no work signal for 15 minutes ends the job');
  }
  await c.sync(payload()); job=await ask(); await c.sync(payload());
  const restart=new TerminalCollaboration(options); assert.equal(restart.jobs.get(job.id).state,'interrupted');
  const count=writes.length; await restart.sync(payload()); assert.equal(writes.length,count,'restart does not replay');
  assert.ok(restart.connected.has('terminal:source'),'same live AI connection survives restart');
  const disconnected = new TerminalCollaboration(options); sessions[0].creationId='replacement'; await disconnected.sync(payload());
  assert.equal(disconnected.connected.get('terminal:source').creationId, 'replacement', 'replacement source receives a fresh app binding'); sessions[0].creationId='epoch-source';
  await c.sync(payload()); c.jobs.get(job.id).state='interrupted';
  const created=await cli(['terminal:source','new','codex'],directory); await c.sync(payload());
  assert.equal(c.jobs.get(created.id).terminal.id,'terminal:new');
  assert.equal(c.jobs.get(created.id).state,'starting','launch waits for renderer adoption');
  const adopted = payload(); adopted.groups[0].members.push(sessions.find(s=>s.id==='terminal:new'));
  await c.sync(adopted); assert.equal(writes.at(-1).command,'codex');
  assert.equal(c.jobs.get(created.id).state,'completed');
  assert.equal(inputReady('› ㅎㅇ','codex'),false);
  for (const [provider, finish, prompt] of [['codex', 'Worked for 2s • 3:42 PM', '› Ask Codex to do anything'], ['claude', '✻ Baked for 2s', '❯ ']]) {
    const completed = `› first\n• Working (esc to interrupt)\n• answer\n${finish}\n${prompt}`;
    assert.equal(inputReady(completed, provider), true, 'historical busy text before an explicit finish cannot block automatic queued delivery');
    assert.equal(inputReady(completed + '\n• Working (esc to interrupt)', provider), false, 'new work after the completed turn still blocks automatic delivery');
    assert.equal(inputReady(completed.replace(prompt, '› real draft'), provider), false, 'an actual draft still blocks automatic delivery');
    assert.equal(inputReady(`› first\n• Working (esc to interrupt)\n${prompt}`, provider), false, 'an empty prompt without an explicit finish cannot clear a busy indicator');
    assert(completedTurn(completed, 'first', provider, completionStamp('› first', provider), { exactRequest: true }), 'old busy text does not hide the verified completed reply');
    assert.equal(completedTurn(completed.replace('• answer\n', ''), 'first', provider, completionStamp('› first', provider), { exactRequest: true }), '', 'a former spinner alone is not answer evidence');
  }
  const before=completionStamp('› ㅎㅇ','codex');
  assert.equal(completedTurn('› 다른말\n• 답\nWorked for 2s • 3:42 PM\n› ', 'ㅎㅇ','codex',before,{exactRequest:true}),'');
  // App-owned membership uses actual providers and never injects model instructions.
  const autoDirectory = path.join(directory, 'automatic');
  let autoWrites = [], autoNative = { available: false }, uncertain = false, swapped = false;
  const autoSessions = ['claude', 'codex', 'outside'].map((provider, i) => ({ id: `terminal:auto-${provider}`, creationId: `auto-${i}`, pid: 300+i, status: 'running', outputSequence: 1, title: 'claude' }));
  const autoManager = { get: async id => autoSessions.find(item => item.id === id), rawWriteDeliverySupported: () => true,
    write: async (id, data) => { autoWrites.push({ id, data }); if (uncertain) throw Object.assign(new Error('ack lost'), { deliveryState: 'unknown' }); } };
  const autoMonitor = { scan: () => ({ available: true, processes: autoSessions.map((session, i) => ({ pid: session.pid + 1000 + (swapped && i === 1 ? 100 : 0), ancestorPids: [session.pid], provider: i === 1 && !swapped ? 'codex' : 'claude' })) }) };
  const autoOptions = { directory: autoDirectory, manager: () => autoManager, monitor: autoMonitor, completion: { observe: async () => autoNative } };
  const automatic = new TerminalCollaboration(autoOptions); controls.push(automatic.control);
  const autoPayload = () => ({ autoConnect: true, groups: [{ id: 'panel-a', cwd: directory, members: autoSessions.slice(0, 2) }, { id: 'panel-b', cwd: directory, members: autoSessions.slice(2) }], frames: autoSessions.map(session => ({ id: session.id, creationId: session.creationId, outputSequence: session.outputSequence, text: '› ', inputDraft: '' })) });
  let initial = autoPayload(); initial.frames[0].inputDraft = '사용자 입력';
  await automatic.sync(initial);
  assert.equal(autoWrites.some(item => item.id === autoSessions[0].id), false, 'automatic setup never interrupts a draft');
  await automatic.sync(autoPayload());
  assert.equal(autoWrites.length, 0, 'membership must not send any AI turns');
  await automatic.sync(autoPayload()); assert.equal(autoWrites.length, 0, 'polling never injects setup');
  const roster = await cli([autoSessions[0].id, 'list'], autoDirectory);
  assert.equal(roster.scope, 'whitebox-panel');
  assert.deepEqual(roster.terminals.map(member => [member.id, member.provider]), [[autoSessions[1].id, 'codex']], 'a misleading Claude title never hides the actual Codex process');
  await assert.rejects(cli([autoSessions[0].id, 'ask', autoSessions[2].id, 'wrong panel'], autoDirectory));
  const greeting = await cli([autoSessions[0].id, 'ask', 'codex', 'ㅎㅇ'], autoDirectory);
  await automatic.sync(autoPayload());
  assert.equal(autoWrites.at(-1).id, autoSessions[1].id);
  assert.equal(autoWrites.at(-1).data, '\x1b[200~ㅎㅇ\x1b[201~\r');
  const answered = autoPayload(); answered.frames[1].text = '› ㅎㅇ\n• ㅎㅇ! 반가워요.\nWorked for 2s • 3:40 PM\n› ';
  await automatic.sync(answered);
  assert.equal((await cli([autoSessions[0].id, 'wait', greeting.id, '0'], autoDirectory)).state, 'completed');
  assert.match((await cli([autoSessions[0].id, 'wait', greeting.id, '0'], autoDirectory)).answer, /반가워요/u);
  // Resolving by provider is bound to the process that appeared in list.
  const changed = await cli([autoSessions[0].id, 'ask', 'codex', 'stale'], autoDirectory);
  swapped = true; await automatic.sync({ ...autoPayload(), autoConnect: false });
  assert.equal(automatic.jobs.get(changed.id).state, 'failed', 'a replacement Claude must not receive a request meant for Codex');
  swapped = false; await automatic.sync(autoPayload());
  // A drag into a different panel refreshes the source roster, without another AI turn.
  const moved = autoPayload(); moved.groups[0].members = [autoSessions[1]]; moved.groups[1].members = [autoSessions[0], autoSessions[2]];
  const beforeMove = autoWrites.length;
  await automatic.sync(moved);
  assert.equal(autoWrites.length, beforeMove);
  const movedRoster = await cli([autoSessions[0].id, 'list'], autoDirectory);
  assert.equal(movedRoster.groupId, 'panel-b');
  assert.deepEqual(movedRoster.terminals.map(member => member.id), [autoSessions[2].id]);
  const resumed = new TerminalCollaboration({ ...autoOptions, enableControl: false }); await resumed.sync(moved);
  assert.equal(autoWrites.length, beforeMove, 'renderer/host restoration does not resend successful instructions');
  const busyDirectory = path.join(directory, 'busy');
  autoNative = { available: true, state: 'working' };
  const busyAuto = new TerminalCollaboration({ ...autoOptions, directory: busyDirectory, enableControl: false });
  await busyAuto.sync(autoPayload()); assert.equal(autoWrites.length, beforeMove, 'native working state blocks even an empty-looking prompt');
  // Real socket + CLI: automatic source scope, live roster, reads and atomic send.
  autoNative = { available: false };
  await automatic.sync(autoPayload());
  const socketOptions = { directory: autoDirectory };
  const args = command => [command, '--source', autoSessions[0].id, '--json'];
  const identified = await rpc('system.identify', { ancestorPids: [autoSessions[0].pid] }, socketOptions);
  assert.equal(identified.surface_id, autoSessions[0].id);
  const socketRoster = await control(args('list-panels'), socketOptions);
  assert.deepEqual(socketRoster.surfaces.map(item => item.id), autoSessions.slice(0, 2).map(item => item.id));
  await assert.rejects(control([...args('read-screen'), '--surface', autoSessions[2].id], socketOptions), /exact surface/);
  const screen = await control([...args('read-screen'), '--surface', autoSessions[1].id], socketOptions);
  assert.equal(screen.text, '› ');
  const socketJob = await control([...args('send'), '--surface', autoSessions[1].id, 'ㅎㅇ\n'], socketOptions);
  assert.equal(socketJob.state, 'running');
  assert.equal(autoWrites.at(-1).data, '\x1b[200~ㅎㅇ\x1b[201~\r');
  await automatic.sync(answered);
  assert.equal((await control([...args('wait'), socketJob.id, '0'], socketOptions)).state, 'completed');
  // cmux-style two-step paste/Enter. A multi-line paste is shown collapsed by
  // the CLI, so the screen never equals the sent text; Enter must still go out.
  await automatic.sync(autoPayload());
  await control([...args('send'), '--surface', autoSessions[1].id, 'line one\nline two'], socketOptions);
  assert.equal(autoWrites.at(-1).data, '\x1b[200~line one\nline two\x1b[201~');
  const collapsed = autoPayload(); collapsed.frames[1].text = '› [Pasted text #1 +1 lines]';
  await automatic.sync(collapsed);
  await control([...args('send-key'), '--surface', autoSessions[1].id, 'enter'], socketOptions);
  assert.equal(autoWrites.at(-1).data, '\r');
  uncertain = true; await automatic.sync(autoPayload());
  await assert.rejects(control([...args('ask'), 'codex', 'uncertain'], socketOptions), /ack lost/);
  assert.equal([...automatic.jobs.values()].at(-1).state, 'interrupted'); const attempts = autoWrites.length;
  await automatic.sync(autoPayload()); assert.equal(autoWrites.length, attempts, 'unknown delivery never retries');
  await assert.rejects(rpc('surface.list', { ancestorPids: [999999] }, socketOptions), /inside a panel/);
  const beforeSocketMove = autoWrites.length;
  await automatic.sync(moved);
  assert.equal((await control(args('list-panels'), socketOptions)).workspace_id, 'panel-b');
  assert.equal(autoWrites.length, beforeSocketMove, 'moving a panel performs no terminal write');
  // A plain shell's actual VT mode controls paste encoding. Older Bash and
  // cmd must receive no bracketed-paste delimiters or executable extra lines.
  uncertain = false;
  const shell = new TerminalCollaboration({ ...autoOptions, directory: path.join(directory, 'plain-shell'), monitor: { scan: () => ({ available: true, processes: [] }) } });
  controls.push(shell.control);
  const shellPayload = bracketedPaste => ({ groups: [{ id: 'shell-panel', cwd: directory, members: autoSessions.slice(0, 1) }], frames: [{ ...autoSessions[0], text: '$ ', inputDraft: '', bracketedPaste }] });
  const shellOptions = { directory: shell.directory };
  await shell.sync(shellPayload(false));
  await control([...args('send'), '--', 'echo plain\n'], shellOptions);
  assert.equal(autoWrites.at(-1).data, 'echo plain\r');
  const beforeRejectedPaste = autoWrites.length;
  for (const text of ['echo first\necho second\n', 'echo\tcompletion\n']) {
    await assert.rejects(control([...args('send'), '--', text], shellOptions), /requires bracketed paste/);
  }
  assert.equal(autoWrites.length, beforeRejectedPaste, 'unsupported paste never writes partial text');
  await shell.sync(shellPayload(true));
  await control([...args('send'), '--', 'echo first\necho second\n'], shellOptions);
  assert.equal(autoWrites.at(-1).data, '\x1b[200~echo first\necho second\x1b[201~\r');
  await shell.sync(shellPayload(false));
  await control([...args('send'), '--', 'echo pending'], shellOptions);
  assert.equal(autoWrites.at(-1).data, 'echo pending');
  const pendingShell = shellPayload(false); pendingShell.frames[0].text = '$ echo pending';
  await shell.sync(pendingShell);
  await control([...args('send-key'), 'enter'], shellOptions);
  assert.equal(autoWrites.at(-1).data, '\r');
  // Multi-line shell paste renders with continuation prompts; Enter still submits.
  await shell.sync(shellPayload(true));
  await control([...args('send'), '--', 'echo first\necho second'], shellOptions);
  assert.equal(autoWrites.at(-1).data, '\x1b[200~echo first\necho second\x1b[201~');
  const multiShell = shellPayload(true); multiShell.frames[0].text = '$ echo first\n> echo second';
  await shell.sync(multiShell);
  await control([...args('send-key'), 'enter'], shellOptions);
  assert.equal(autoWrites.at(-1).data, '\r');
  // Batch creation through the public socket, with exact adoption/launch order.
  let creationClock = Date.now(), launchUnknown = false;
  const peers = [{ id:'terminal:creator',creationId:'creator',pid:501,status:'running',outputSequence:1 }], launches=[];
  const creatorDirectory=path.join(directory,'creation');
  const creationManager={get:async id=>peers.find(p=>p.id===id),command:async(id,command)=>{
    assert.ok(creator.groups.get('creation-panel').members.some(p=>p.id===id),'provider starts after panel membership is published');
    launches.push({id,command}); if(launchUnknown) throw Object.assign(Error('launch acknowledgement lost'),{deliveryState:'unknown'});
  }};
  const creator=new TerminalCollaboration({directory:creatorDirectory,manager:()=>creationManager,now:()=>creationClock,
    monitor:{scan:()=>({available:true,processes:[]})},completion:{observe:async()=>({available:false})},
    createTerminal:async options=>{const peer={id:`terminal:created-${peers.length}`,creationId:options.creationId,pid:501+peers.length,status:'running',outputSequence:1};peers.push(peer);return peer;}});
  controls.push(creator.control);
  const creationPayload=(adopt=true)=>({groups:[{id:'creation-panel',cwd:directory,members:adopt?peers:peers.slice(0,1)}],frames:[]});
  await creator.sync(creationPayload());
  const creationOptions={directory:creatorDirectory};
  const batch=await control(['new-terminal','codex','--count','3','--source','terminal:creator','--json'],creationOptions);
  assert.equal(batch.jobs.length,3); assert.ok(batch.jobs.every(job=>job.state==='starting'));
  assert.equal(launches.length,0,'never launches an undiscoverable provider');
  await creator.sync(creationPayload()); assert.equal(launches.length,3);
  await creator.sync(creationPayload()); assert.equal(launches.length,3,'polling does not launch again');
  const complete=await control(['wait',batch.jobs[0].id,'0','--source','terminal:creator'],creationOptions);
  assert.equal(complete.state,'completed'); assert.equal(complete.terminal.id,batch.jobs[0].terminal.id);
  assert.equal((await control(['list-panels','--source','terminal:creator'],creationOptions)).surfaces.length,4);
  for(const count of ['0','9','1.5','no']) await assert.rejects(control(['new-terminal','codex','--count',count,'--source','terminal:creator'],creationOptions),/count/);
  await assert.rejects(control(['new-terminal','rm -rf','--source','terminal:creator'],creationOptions),/Usage/);
  await assert.rejects(control(['new-terminal','codex','--source','terminal:outside'],creationOptions),/inside a panel/);
  const late=await control(['new-terminal','codex','--source','terminal:creator'],creationOptions);
  creationClock+=31000; await creator.sync(creationPayload(false));
  assert.equal(creator.jobs.get(late.jobs[0].id).state,'failed','adoption timeout cannot count as launch success');
  await creator.sync(creationPayload()); assert.equal(launches.length,3,'late adoption never replays timed-out launch');
  launchUnknown=true;
  const uncertainCreation=await control(['new-terminal','claude','--source','terminal:creator'],creationOptions);
  await creator.sync(creationPayload());
  assert.equal(creator.jobs.get(uncertainCreation.jobs[0].id).state,'interrupted');
  await creator.sync(creationPayload()); assert.equal(launches.length,4,'lost launch acknowledgement never replays');
  console.log('PASS new-terminal batch: same-panel creation, adoption before launch, wait IDs, validation, timeout and uncertain delivery without replay');
  console.log('Panel control: real socket/CLI, source ancestry, same-panel routing, paste/Enter including multi-line submit, moves, no instruction injection passed');
  console.log('Terminal collaboration: scoped delivery, drafts, busy targets, exact replies, deduplication, timeout, restart and creation passed');
 } finally { await Promise.all(controls.map(control => control.close())); fs.rmSync(directory,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
