'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TerminalGroups } = require('../src/terminalGroups');
const { execFileSync } = require('child_process');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-groups-unit-'));
  const sessions = new Map();
  const stopped = [];
  const commands = [];
  let blocked = false;
  let nextTerminalId = 0;
  const manager = {
    list: () => [...sessions.values()],
    get: id => sessions.get(id) || null,
    create: options => {
      const session = { ...options, id: `terminal:${++nextTerminalId}`, backend: 'managed-tmux', status: 'running' };
      sessions.set(session.id, session);
      return session;
    },
    command: async (id, text, options) => { commands.push({id, text, options}); return {ok:true}; },
    retire: async id => {
      if (blocked) throw new Error('termination not acknowledged');
      stopped.push(id); sessions.delete(id); return { ok: true };
    },
  };
  const storeFile = path.join(directory, 'groups.json');
  try {
    const groups = new TerminalGroups({ manager: () => manager, storeFile });
    const group = await groups.create({ cwd: directory, name: '팀' });
    const [claude, codex] = await Promise.all([
      groups.add(group.id, { provider: 'claude' }), groups.add(group.id, { provider: 'codex' }),
    ]);
    assert.equal((await groups.list())[0].members.length, 2);
    const helper = path.join(`${storeFile}.mailboxes`, group.id, 'group-message.cjs');
    const firstId = groups.mailbox.memberId(claude), secondId = groups.mailbox.memberId(codex);
    const communicate = (sender, operation, ...args) => JSON.parse(execFileSync(process.execPath, [helper, sender, operation, ...args], { encoding: 'utf8' }));
    assert.equal(communicate(firstId, 'send', secondId, '검증 결과를 공유합니다.').ok, true);
    assert.equal(communicate(secondId, 'inbox')[0].text, '검증 결과를 공유합니다.');
    assert.deepEqual(communicate(secondId, 'inbox'), [], 'read messages must not be delivered again');
    await groups.instruct(group.id, codex.creationId);
    assert.equal(commands.at(-1).id, codex.terminalId);
    assert.ok(commands.at(-1).text.includes(codex.creationId));
    assert.ok(!commands.at(-1).text.includes('unrelated-surface'));
    blocked = true;
    await assert.rejects(groups.remove(group.id, claude.creationId), /not acknowledged/);
    assert.equal((await groups.list())[0].members.length, 2, 'failed shutdown must remain visible');
    blocked = false;
    await groups.remove(group.id, claude.creationId);
    assert.equal(sessions.has(claude.terminalId), false);
    assert.equal((await groups.list())[0].members.length, 1);
    assert.throws(() => communicate(firstId, 'members'), /no longer a member/);
    const isolated = await groups.create({ cwd: directory, name: '개발 팀' });
    const foreign = await groups.add(isolated.id, { provider: 'codex' });
    assert.equal(communicate(secondId, 'self').groupId, group.id);
    assert.equal(communicate(secondId, 'self').panelId, codex.creationId);
    assert.equal(communicate(secondId, 'members').selfId, secondId);
    assert.throws(() => communicate(secondId, 'send', groups.mailbox.memberId(foreign), 'wrong panel'), /not a member/);
    assert.equal(fs.existsSync(path.join(`${storeFile}.mailboxes`, isolated.id, groups.mailbox.memberId(foreign))), false, 'same-folder/same-provider recipient in another group gets no message');
    assert.ok(codex.terminal.args.some(arg => arg.includes(codex.creationId) && arg.includes(group.id)), 'provider startup arguments carry exact group and own panel');
    const count = commands.length;
    await assert.rejects(groups.instruct(group.id, foreign.creationId), /찾을 수 없습니다/);
    assert.equal(commands.length, count, 'refresh refuses a panel from a different group');
    await groups.delete(isolated.id);
    const restored = new TerminalGroups({ manager: () => manager, storeFile });
    assert.equal((await restored.list())[0].members[0].terminalId, codex.terminalId);
    await assert.rejects(groups.add(group.id, { terminalId: codex.terminalId }), /이미 그룹/);
    sessions.set('external', { id: 'external', type: 'tmux', backend: 'direct', creationId: 'external' });
    await assert.rejects(groups.add(group.id, { terminalId: 'external' }), /관리하는 tmux/);
    await groups.rename(group.id, '개발 팀');
    await groups.delete(group.id);
    assert.deepEqual(await groups.list(), []);
    assert.equal(fs.existsSync(path.dirname(helper)), false, 'deleted group must remove its message mailbox');
    assert.equal(sessions.has('external'), true, 'unrelated terminals must survive');
    assert.equal(stopped.includes(codex.terminalId), true);
    const missing = await groups.create({ cwd: directory });
    const vanished = await groups.add(missing.id, { provider: 'gemini' });
    sessions.delete(vanished.terminalId);
    await groups.remove(missing.id, vanished.creationId);
    assert.equal((await groups.list())[0].members.length, 0);
    console.log('✓ 그룹 추가 직렬화·저장 복원·실제 제거 호출·실패 보존·중복 방지·외부 터미널 보호·그룹 삭제');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
