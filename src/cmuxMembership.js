'use strict';

const fs = require('fs');
const path = require('path');
const { reportRecoverableError } = require('./diagnostics');

// Retain exact conversation identities when the integration is disabled. A
// shared directory is never evidence of membership, and PIDs are never saved.
class CmuxMembership {
  constructor(file) {
    this.file = file;
    this.records = new Map();
    this.groups = [];
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [id, value] of saved.records || []) {
        if (typeof id === 'string' && value?.workspaceId && ['orchestrator', 'worker', 'unknown'].includes(value.role)) this.records.set(id, value);
      }
    } catch (_) { /* No previously connected cmux conversations. */ }
  }
  update(groups, sessions = []) {
    this.groups = groups;
    const before = JSON.stringify([...this.records]);
    // Process ancestry is available from the normal monitor even while the
    // socket integration is off. This also hides newly started cmux sessions.
    for (const session of sessions) {
      if (!this.records.has(session.id) && session.environment?.kind !== 'wsl'
        && session.runtimePresence?.some(runtime => runtime.kind !== 'wsl' && runtime.terminalHost === 'cmux')) {
        this.records.set(session.id, { workspaceId: 'cmux:unlinked', surfaceId: '', role: 'unknown', title: '', cwd: session.cwd || '' });
      }
    }
    for (const group of groups) {
      const leader = group.members.find(member => /오케스트|orchestrat/i.test(member.title)) || group.members[0];
      for (const member of group.members) {
        const ids = new Set(member.sessionIds || []);
        for (const session of sessions) {
          if (session.environment?.kind !== 'wsl' && (session.runtimePresence || []).some(runtime => runtime.kind !== 'wsl' && member.processIds?.includes(Number(runtime.pid)))) ids.add(session.id);
        }
        for (const id of ids) this.records.set(id, { workspaceId: group.id, surfaceId: member.id,
          role: member === leader ? 'orchestrator' : 'worker', title: group.title, cwd: group.cwd });
      }
    }
    while (this.records.size > 5000) this.records.delete(this.records.keys().next().value);
    if (this.file && before !== JSON.stringify([...this.records])) {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, records: [...this.records] }), { mode: 0o600 });
        fs.renameSync(`${this.file}.tmp`, this.file);
      } catch (error) { reportRecoverableError('cmux-membership-save', error); }
    }
  }
  project(session) {
    const membership = session.environment?.kind !== 'wsl' && this.records.get(session.id);
    const active = Boolean(membership && this.groups.some(group => group.id === membership.workspaceId && group.members.some(member => member.id === membership.surfaceId && member.currentSessionId === session.id)));
    return membership ? { ...session, cmux: { ...membership, active } } : session;
  }
}

module.exports = { CmuxMembership };
