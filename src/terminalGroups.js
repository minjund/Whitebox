'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { GroupMailbox } = require('./groupMailbox');

// Groups own managed terminals. Removing membership retires the actual runtime;
// metadata must never report success before the host acknowledges retirement.
class TerminalGroups {
  constructor({ manager, storeFile, isProviderVisible = () => true, fileSystem = fs }) {
    this.manager = manager;
    this.storeFile = storeFile;
    this.fs = fileSystem;
    this.isProviderVisible = isProviderVisible;
    this.groups = [];
    this.queue = Promise.resolve();
    this.mailbox = new GroupMailbox(storeFile);
    if (storeFile && this.fs.existsSync(storeFile)) {
      const saved = JSON.parse(this.fs.readFileSync(storeFile, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.groups) || saved.groups.some(group => (
        !group || !/^[a-f0-9-]{36}$/.test(group.id) || typeof group.name !== 'string' || typeof group.cwd !== 'string'
        || !Array.isArray(group.members) || group.members.some(member => !member || typeof member.creationId !== 'string' || !/^[A-Za-z0-9:._-]{1,240}$/.test(member.creationId))
      ))) throw new Error('AI 그룹 저장 파일을 읽을 수 없습니다.');
      this.groups = saved.groups;
    }
    for (const group of this.groups) this.mailbox.sync(group);
  }

  mutate(action) {
    const operation = this.queue.then(action);
    this.queue = operation.catch(() => {});
    return operation;
  }

  host() {
    const host = this.manager();
    if (!host) throw new Error('터미널이 아직 준비되지 않았습니다.');
    return host;
  }

  save() {
    if (!this.storeFile) return;
    this.fs.mkdirSync(path.dirname(this.storeFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.storeFile}.tmp`;
    this.fs.writeFileSync(temporary, JSON.stringify({ version: 1, groups: this.groups }), { mode: 0o600 });
    this.fs.renameSync(temporary, this.storeFile);
  }

  required(id) {
    const group = this.groups.find(item => item.id === id);
    if (!group) throw new Error('AI 그룹을 찾을 수 없습니다.');
    return group;
  }

  async terminals() {
    const host = this.host();
    return host.listFresh ? host.listFresh() : host.list();
  }

  async list() {
    await this.queue;
    const terminals = await this.terminals();
    return this.groups.map(group => ({ ...group, members: group.members.map(member => ({
      ...member,
      terminal: terminals.find(item => item.creationId === member.creationId && (!member.terminalId || item.id === member.terminalId)) || null,
    })) }));
  }

  create(options = {}) {
    return this.mutate(() => {
      const cwd = String(options.cwd || '').trim();
      const name = String(options.name || 'AI 그룹').trim().slice(0, 80);
      if (!cwd || !name) throw new Error('프로젝트 폴더와 그룹 이름이 필요합니다.');
      const requestId = String(options.creationId || '');
      const existing = requestId && this.groups.find(item => item.requestId === requestId && item.cwd === cwd);
      if (existing) return { ...existing, members: [...existing.members] };
      const group = { id: randomUUID(), name, cwd, distro: String(options.distro || ''), ownerId: String(options.ownerId || ''), requestId, members: [] };
      this.groups.push(group);
      try { this.save(); } catch (error) { this.groups.pop(); throw error; }
      return { ...group, members: [] };
    });
  }

  add(id, options = {}) {
    return this.mutate(async () => {
      const group = this.required(id);
      const host = this.host();
      if (options.creationId) {
        const existing = group.members.find(member => member.creationId === `group:${options.creationId}`);
        if (existing) return { ...existing, terminal: await host.get(existing.terminalId, false) };
      }
      const provider = String(options.provider || '');
      if (!options.terminalId && (!['claude', 'codex', 'gemini', 'grok'].includes(provider) || !this.isProviderVisible(provider))) {
        throw new Error('실행할 수 없는 AI입니다.');
      }
      if (group.members.length >= 8) throw new Error('한 그룹에는 AI를 8개까지 추가할 수 있습니다.');
      let terminal;
      const creationId = String(options.creationId || randomUUID());
      if (!/^[A-Za-z0-9:._-]{1,200}$/.test(creationId)) throw new Error('유효하지 않은 작업 ID입니다.');
      const member = { creationId: `group:${creationId}`, terminalId: '', provider };
      if (options.terminalId) {
        terminal = await host.get(options.terminalId, false);
        if (!terminal || terminal.type !== 'agent' || terminal.backend !== 'managed-tmux' || !terminal.creationId || !this.isProviderVisible(terminal.provider)) {
          throw new Error('Whitebox에서 관리하는 tmux AI 세션만 참여할 수 있습니다.');
        }
        if (this.groups.some(item => item.members.some(value => value.creationId === terminal.creationId))) throw new Error('이미 그룹에 참여한 AI입니다.');
        member.creationId = terminal.creationId;
        member.terminalId = terminal.id;
        member.provider = terminal.provider;
      }
      // Persist the creation identity first: even a crash after spawn can be
      // recovered by matching the host's durable creationId on the next load.
      group.members.push(member);
      try { this.save(); } catch (error) { group.members.pop(); throw error; }
      try {
        this.mailbox.sync(group);
        if (!terminal) terminal = await host.create({
          type: 'agent', provider, cwd: group.cwd, distro: group.distro,
          sessionBackend: 'managed-tmux', creationId: member.creationId,
          title: `${group.name} · ${provider}`, cols: 100, rows: 30,
          model: String(options.model || ''), allowWrites: options.allowWrites === true,
          permissionMode: String(options.permissionMode || ''),
          initialCommand: [this.mailbox.instructions(group, member), String(options.prompt || '')].filter(Boolean).join('\n\n'),
        });
        else if (typeof host.command === 'function') await host.command(terminal.id, this.mailbox.instructions(group, member));
        if (terminal.backend !== 'managed-tmux') {
          await host.retire(terminal.id);
          throw new Error('tmux를 사용할 수 없습니다. tmux를 설치한 뒤 다시 추가하세요.');
        }
        member.terminalId = terminal.id;
        this.save();
        return { ...member, terminal };
      } catch (error) {
        // A lost create acknowledgement may still have spawned a live session.
        // Keep its durable identity rather than leaking an invisible runtime.
        const live = (await this.terminals()).find(item => item.creationId === member.creationId);
        if (live) member.terminalId = live.id;
        else group.members = group.members.filter(item => item !== member);
        this.save();
        this.mailbox.sync(group);
        throw error;
      }
    });
  }

  rename(id, value) {
    return this.mutate(() => {
      const group = this.required(id);
      const name = String(value || '').trim().slice(0, 80);
      if (!name) throw new Error('그룹 이름을 입력하세요.');
      const before = group.name;
      group.name = name;
      try { this.save(); } catch (error) { group.name = before; throw error; }
      this.mailbox.sync(group);
      return { ok: true };
    });
  }

  async removeMember(group, creationId) {
    const member = group.members.find(item => item.creationId === creationId);
    if (!member) throw new Error('그룹 참여 AI를 찾을 수 없습니다.');
    const terminal = (await this.terminals()).find(item => item.creationId === creationId && (!member.terminalId || item.id === member.terminalId));
    if (terminal) {
      if (terminal.backend !== 'managed-tmux') throw new Error('관리형 tmux 세션의 종료만 지원합니다.');
      await this.host().retire(terminal.id);
      if (await this.host().get(terminal.id, false)) throw new Error('tmux 세션 종료를 아직 확인하지 못했습니다.');
    }
    const before = group.members;
    group.members = before.filter(item => item !== member);
    try { this.save(); } catch (error) { group.members = before; throw error; }
    this.mailbox.sync(group);
    return { ok: true };
  }

  remove(id, creationId) {
    return this.mutate(() => this.removeMember(this.required(id), creationId));
  }

  delete(id) {
    return this.mutate(async () => {
      const group = this.required(id);
      // Save each successful removal. A later failure leaves only the
      // unconfirmed members visible and retryable.
      for (const member of [...group.members]) await this.removeMember(group, member.creationId);
      const before = this.groups;
      this.groups = before.filter(item => item !== group);
      try { this.save(); } catch (error) { this.groups = before; throw error; }
      this.mailbox.delete(group);
      return { ok: true };
    });
  }
}

module.exports = { TerminalGroups };
