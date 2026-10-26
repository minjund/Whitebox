'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { exactProcess } = require('./terminalReview');
const { completedTurn, completionStamp, inputReady } = require('./terminalReviewTurns');
const { ProcessMonitor } = require('./processMonitor');
const { TerminalReviewCompletion } = require('./terminalReviewCompletion');
const safeId = value => /^[a-zA-Z0-9:._-]{1,200}$/u.test(value || '');

// Local CLI requests are scoped to the explicit renderer workspace roster.
// No cwd guessing, global terminal discovery, shell input, or screen clicking.
class TerminalCollaboration {
  constructor({ manager, directory, monitor = new ProcessMonitor(), completion = new TerminalReviewCompletion(), activity = null, now = Date.now, enableControl = true }) {
    Object.assign(this, { manager, directory, monitor, completion, now });
    this.activity = activity || new (require('./terminalActivity').TerminalActivity)({ completion, now });
    this.control = enableControl ? new (require('./terminalPanelControl').TerminalPanelControl)(this) : null;
    this.groups = new Map(); this.frames = new Map(); this.jobs = new Map(); this.connected = new Map(); this.queue = Promise.resolve(); this.restoredConnections = [];
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.helper = path.join(directory, 'panel-agent.cjs');
    fs.copyFileSync(path.join(__dirname, '../bin/panel-agent.js'), this.helper);
    for (const name of fs.readdirSync(directory).filter(name => /^[a-zA-Z0-9_-]+\.access\.json$/u.test(name))) {
      try { const record = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')); if (safeId(record.id) && record.providerPid && record.token) this.restoredConnections.push(record); } catch { /* Invalid connections stay disconnected. */ }
    }
    // Restart never replays an uncertain delivery.
    for (const name of fs.readdirSync(directory).filter(name => /^[a-f0-9-]{36}\.job\.json$/u.test(name))) {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
        if (!safeId(job.id)) continue;
        if (!['completed', 'failed', 'interrupted'].includes(job.state)) Object.assign(job, { state: 'interrupted', error: '앱이 다시 시작되어 전달 상태를 재확인해야 합니다. 자동으로 재전송하지 않았습니다.' });
        this.jobs.set(job.id, job); this.save(job);
      } catch { /* Malformed local records are never executed. */ }
    }
  }
  file(id, suffix) { if (!safeId(id)) throw new Error('잘못된 연결 ID입니다.'); return path.join(this.directory, `${suffix === 'access' ? Buffer.from(id).toString('base64url') : id}.${suffix}.json`); }
  write(file, value) { const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(tmp, file); }
  save(job) { this.write(this.file(job.id, 'job'), job); }
  serialize(action) { const next = this.queue.then(action); this.queue = next.catch(() => {}); return next; }
  sync(payload) { return this.serialize(() => this.update(payload)); }
  async update({ groups = [], frames = [] } = {}) {
    // Polling membership uses the host's event-fed metadata cache. Repeated
    // remote get calls queue behind shell launches on the host connection.
    const manager = this.manager();
    const inventory = typeof manager.list === 'function' ? await manager.list() : null;
    const liveById = inventory ? new Map(inventory.map(item => [item.id, item])) : null;
    this.groups = new Map();
    for (const group of groups.slice(0, 100)) {
      if (!safeId(group.id) || !path.isAbsolute(group.cwd || '')) continue;
      const members = [];
      for (const member of (group.members || []).slice(0, 64)) {
        const live = liveById ? liveById.get(member.id) : await manager.get(member.id, false);
        if (live && live.creationId === member.creationId && live.pid === member.pid && live.status === 'running') members.push({ id: live.id, creationId: live.creationId, pid: live.pid, title: String(member.title || live.title).slice(0, 120) });
      }
      this.groups.set(group.id, { id: group.id, name: String(group.name || '').slice(0, 120), cwd: group.cwd, members });
    }
    for (const frame of frames.slice(0, 256)) if (safeId(frame.id) && typeof frame.text === 'string') this.frames.set(frame.id, { ...frame, text: frame.text.slice(-24000), at: this.now() });
    const activity = await this.activity.observe([...this.groups.values()].flatMap(group => group.members), this.frames, this.monitor.scan());
    for (const record of this.restoredConnections.splice(0)) {
      const member = [...this.groups.values()].flatMap(group => group.members).find(item => item.id === record.id && item.creationId === record.creationId && item.pid === record.pid);
      const child = member && exactProcess({ ...member, status: 'running' }, this.monitor.scan());
      if (child?.pid === record.providerPid) this.connected.set(record.id, record);
    }
    for (const group of this.groups.values()) for (const member of group.members) {
      const child = exactProcess({ ...member, status: 'running' }, this.monitor.scan()), frame = this.frames.get(member.id);
      member.provider = child?.provider || '';
      member.providerPid = child?.pid || null;
      member.ready = Boolean(child && frame && !frame.inputDraft && inputReady(frame.readinessText ?? frame.text, child.provider));
      member.activity = activity.get(member.id);
    }
    for (const [id, connection] of this.connected) {
      const group = [...this.groups.values()].find(group => group.members.some(member => member.id === id));
      const member = group?.members.find(item => item.id === id && item.creationId === connection.creationId);
      if (!member || member.pid !== connection.pid || member.providerPid !== connection.providerPid) { this.connected.delete(id); fs.rmSync(this.file(id, 'access'), { force: true }); continue; }
      if (connection.groupId !== group.id) { connection.groupId = group.id; connection.token = randomUUID(); }
      this.writeAccess(id, connection, group);
    }
    // Membership is an app-owned binding, never an AI instruction or hook.
    for (const group of this.groups.values()) for (const member of group.members) {
      if (!this.connected.has(member.id)) await this.connectNow(group.id, member.id);
    }
    this.updatedAt = this.now();
    await this.control?.start();
    await this.poll();
    const visible = new Set([...this.groups.values()].flatMap(group => group.members.map(member => member.id)));
    return { jobs: [...this.jobs.values()].filter(job => visible.has(job.sourceId) || visible.has(job.targetId)).slice(-80), connected: [...this.connected.keys()], panels: [...this.groups.values()].map(group => ({ id: group.id, name: group.name, members: group.members.map(member => ({ ...member, connected: this.connected.has(member.id), connectionError: '' })) })) };
  }
  writeAccess(id, connection, group) {
    this.write(this.file(id, 'access'), { ...connection, id, helper: this.helper, scope: 'whitebox-panel', groupName: group.name, members: group.members, updatedAt: this.now() });
  }
  member(groupId, id) {
    const group = this.groups.get(groupId), member = group?.members.find(item => item.id === id);
    if (!member) throw new Error('같은 패널의 실행 중인 터미널만 연결할 수 있습니다.');
    return { group, member };
  }
  async target(groupId, id) {
    const { member } = this.member(groupId, id);
    const live = await this.manager().get(id, false);
    if (!live || live.creationId !== member.creationId || live.pid !== member.pid || live.status !== 'running') throw new Error('터미널 실행 세션이 바뀌었습니다.');
    const child = exactProcess(live, this.monitor.scan());
    if (!child) throw new Error('이 터미널에서 Claude 또는 Codex를 먼저 실행해 주세요.');
    const frame = this.frames.get(id);
    if (!frame || frame.creationId !== member.creationId || this.now() - frame.at > 10000 || frame.outputSequence !== live.outputSequence) throw new Error('터미널의 최신 입력 상태를 확인한 후 다시 시도해 주세요.');
    return { member, live, child, frame };
  }
  async send(groupId, id, message, deliveryId, expected = null, submit = true) {
    const target = await this.target(groupId, id);
    if (expected?.targetCreationId && (expected.targetCreationId !== target.live.creationId || expected.targetProviderPid !== target.child.pid || expected.targetProvider !== target.child.provider)) throw new Error('목록 조회 이후 상대 AI 세션이 바뀌었습니다. list를 다시 조회해 주세요.');
    if (target.frame.inputDraft || !inputReady(target.frame.readinessText ?? target.frame.text, target.child.provider)) throw new Error('상대가 작업 중이거나 입력 중인 글이 있습니다. 입력창이 비어 있고 답변이 끝났을 때 다시 요청해 주세요.');
    const native = await this.completion.observe(target.child);
    if (native.available && native.state === 'working') throw new Error('상대 AI가 아직 작업 중입니다.');
    const live = await this.manager().get(id, false);
    if (!live || live.creationId !== target.member.creationId || live.pid !== target.member.pid
      || exactProcess(live, this.monitor.scan())?.pid !== target.child.pid) throw new Error('터미널 실행 세션이 바뀌었습니다.');
    if (!this.manager().rawWriteDeliverySupported?.()) throw new Error('현재 터미널 호스트는 안전한 협업 전달을 지원하지 않습니다.');
    // One guarded write prevents an intervening draft between paste and Enter.
    await this.manager().write(id, `\x1b[200~${message}\x1b[201~${submit ? '\r' : ''}`, { deliveryId, expectedOutputSequence: target.frame.outputSequence });
    return { baseline: native.requestId || '', stamp: completionStamp(target.frame.text, target.child.provider), provider: target.child.provider, providerPid: target.child.pid, creationId: target.member.creationId, pid: target.member.pid };
  }
  connect(groupId, sourceId) { return this.serialize(() => this.connectNow(groupId, sourceId)); }
  async connectNow(groupId, sourceId) {
    const { member } = this.member(groupId, sourceId);
    const connection = this.connected.get(sourceId) || { groupId, creationId: member.creationId, pid: member.pid, providerPid: member.providerPid, token: randomUUID(), connectedAt: this.now(), state: 'connected' };
    this.connected.set(sourceId, connection);
    this.writeAccess(sourceId, connection, this.groups.get(groupId));
    return { ok: true };
  }
  async poll() {
    for (const name of fs.readdirSync(this.directory).filter(name => /^[a-f0-9-]{36}\.request\.json$/u.test(name) && !this.jobs.has(name.slice(0, 36))).slice(0, 100)) {
      const file = path.join(this.directory, name);
      if (fs.statSync(file).size > 24000) continue;
      let request; try { request = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      if (name !== `${request.id}.request.json` || this.jobs.has(request.id)) continue;
      const job = { id: request.id, sourceId: request.sourceId, targetId: request.targetId, groupId: request.groupId, request: String(request.message || '').trim(), state: 'queued', createdAt: this.now() };
      this.jobs.set(job.id, job); this.save(job);
      try {
        const connection = this.connected.get(request.sourceId);
        if (!connection || connection.token !== request.token || connection.groupId !== request.groupId) throw new Error('협업 연결이 만료됐습니다. 앱에서 다시 연결해 주세요.');
        const { group } = this.member(request.groupId, request.sourceId);
        if (request.operation === 'new') {
          if (!['claude', 'codex'].includes(request.provider)) throw new Error('지원하지 않는 AI입니다.');
          const terminal = await this.manager().create({ type: process.platform === 'win32' ? 'powershell' : 'shell', cwd: group.cwd, creationId: `workspace:collaboration:${job.id}`, cols: 100, rows: 30 });
          job.terminal = terminal; job.targetId = terminal.id;
          this.save(job);
          await this.manager().command(terminal.id, request.provider, { deliveryId: `collaboration-launch:${job.id}` });
          Object.assign(job, { state: 'completed', answer: `새 터미널 ${terminal.id}을 열었습니다. list에서 준비 상태를 확인한 다음 ask 하세요.` });
        } else {
          if (request.operation !== 'ask' || !job.request || job.request.length > 8000 || /[\x00-\x08\x0b-\x1f\x7f]/u.test(job.request)) throw new Error('올바른 작업 요청을 입력해 주세요.');
          if (job.targetId === job.sourceId) throw new Error('자기 터미널로 전달할 수 없습니다.');
          if ([...this.jobs.values()].some(item => item.id !== job.id && item.targetId === job.targetId && ['sending', 'running'].includes(item.state))) throw new Error('상대에게 전달한 작업이 아직 진행 중입니다.');
          Object.assign(job, { state: 'sending', sentAt: this.now() }); this.save(job);
          Object.assign(job, await this.send(job.groupId, job.targetId, job.request, `collaboration:${job.id}`, request), { state: 'running' });
        }
      } catch (error) { Object.assign(job, { state: error.deliveryState === 'unknown' ? 'interrupted' : 'failed', error: String(error.message || error) }); }
      this.save(job);
    }
    for (const job of this.jobs.values()) if (job.state === 'running') {
      try {
        if (this.now() - job.sentAt > 15 * 60 * 1000) throw new Error('15분 안에 완료를 확인하지 못했습니다. 상대 터미널을 확인하세요. 자동 재전송하지 않습니다.');
        const target = await this.target(job.groupId, job.targetId);
        if (target.child.pid !== job.providerPid || target.live.creationId !== job.creationId) throw new Error('상대의 AI 세션이 바뀌었습니다.');
        const native = await this.completion.observe(target.child);
        const evidence = native.available
          ? native.state === 'completed' && native.requestId !== job.baseline && native.requestAt >= job.sentAt && String(native.request).trim() === job.request ? native.evidence : ''
          : completedTurn(target.frame.text, job.request, job.provider, job.stamp, { exactRequest: true });
        if (evidence) Object.assign(job, { state: 'completed', answer: evidence, finishedAt: this.now() });
        else if (this.now() - job.sentAt > 15 * 60 * 1000) Object.assign(job, { state: 'interrupted', error: '15분 안에 완료를 확인하지 못했습니다. 상대 터미널을 확인하세요. 자동 재전송하지 않습니다.' });
      } catch (error) {
        // A stale frame is transient, a missing member or replaced process isn't.
        if (!String(error.message).includes('최신 입력 상태')) Object.assign(job, { state: 'interrupted', error: error.message });
      }
      this.save(job);
    }
  }
}
module.exports = { TerminalCollaboration };
