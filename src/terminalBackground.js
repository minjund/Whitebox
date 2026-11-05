'use strict';

const path = require('path');
const short = (value, limit = 100) => String(value || '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit);
const timestamp = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

// Reuse the worker's parsed execution/agent lifecycle. Bind it to the native
// log already proven to belong to this exact live AI process, never to cwd,
// title, newest history, or a screen claim that something is still running.
// A long background command (a watcher, a dev server) writes nothing to the
// conversation log after it starts, so the log alone marks it unverified after
// a few quiet minutes. A live process under the same AI process whose command
// line carries the exact command proves it is still running. Each process
// proves one execution only, so a finished duplicate is never revived.
function liveExecutionProof(rows, child) {
  const used = new Set();
  const live = (rows || []).filter(row => row?.ancestorPids?.includes(child.pid) && !/^[TZ]/u.test(row.stat || '')
    && typeof row.commandLine === 'string');
  return command => {
    const text = String(command || '').trim();
    if (!text) return false;
    const quoted = text.replace(/'/gu, "'\\''");
    const row = live.find(item => !used.has(item.pid) && (item.commandLine.includes(text) || item.commandLine.includes(quoted)));
    if (!row) return false;
    // A pipeline or wrapper shell shares the command; claim its whole group.
    for (const item of live) if (item.pgid === row.pgid) used.add(item.pid);
    used.add(row.pid);
    return true;
  };
}

function conversationBackground(native, child, snapshot, now, rows = []) {
  const age = now - Date.parse(snapshot?.generatedAt);
  if (!native?.available || !native.source?.file || !(age >= 0 && age < 15000)) return [];
  const matches = (snapshot.sessions || []).filter(session => session.provider === child.provider && session.file === native.source.file);
  if (matches.length !== 1) return [];
  const start = Date.parse(child.startedAt);
  if (!Number.isFinite(start)) return [];
  const owned = item => Number.isFinite(Date.parse(item.startedAt)) && Date.parse(item.startedAt) >= start - 2000;
  const jobs = new Map();
  const proven = liveExecutionProof(rows, child);
  const executions = [...(matches[0].executions || [])].reverse();
  for (const item of executions) {
    if (item.mode !== 'background' || !owned(item)) continue;
    if (item.status !== 'running' && !(item.status === 'unverified' && proven(item.command))) continue;
    const id = `execution:${item.backgroundId || item.id}`;
    // Parsers fall back to the raw command as a label. Do not expose command
    // arguments, output or prompts through a compact sidebar observation.
    const commandLabel = short(String(item.command || '').trim().split(/\r?\n/u)[0], 1200);
    const candidate = short(item.label);
    const fromCommand = commandLabel && commandLabel.startsWith(candidate.replace(/…$/u, ''));
    const label = candidate && !fromCommand ? candidate : short(item.runtime || '명령창');
    jobs.set(id, { id, kind: 'command', label: label || '명령창', state: 'running', startedAt: timestamp(item.startedAt) });
  }
  const ordered = [...jobs.entries()].reverse();
  jobs.clear();
  for (const [id, job] of ordered) jobs.set(id, job);
  for (const item of matches[0].collaboration?.spawns || []) {
    if (!['running', 'waiting'].includes(item.status) || !owned(item)) continue;
    const id = `agent:${item.childId || item.agentPath || item.callId}`;
    jobs.set(id, { id, kind: 'agent', label: short(item.taskName || item.agentName || '도움 AI'), state: item.status, startedAt: timestamp(item.startedAt) });
  }
  return [...jobs.values()];
}

// POSIX shell jobs have their own process groups. Group pipelines once and
// exclude both the shell and its current foreground job. Never infer a job
// from a stale screen, a zombie/stopped process, or another terminal's tree.
function shellBackground(rows, shell) {
  if (!shell || !(shell.foreground > 0)) return [];
  const groups = new Map();
  for (const row of rows) {
    if (!row.ancestorPids?.includes(shell.pid) || !(row.pgid > 0) || row.pgid === shell.pgid
      || row.pgid === shell.foreground || /^[TZ]/u.test(row.stat || '')) continue;
    const prior = groups.get(row.pgid);
    if (!prior || row.pid === row.pgid) groups.set(row.pgid, row);
  }
  return [...groups].map(([pgid, row]) => ({ id: `process-group:${pgid}`, kind: 'command',
    label: short(path.basename(row.name || '명령창')), state: 'running', startedAt: timestamp(row.startedAt) }));
}

module.exports = { conversationBackground, shellBackground };
