'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const { posixProcessRows, providerFromPosixProcess, utilityProcess } = require('./processMonitor');
const { TerminalReviewCompletion } = require('./terminalReviewCompletion');
const { detectPendingPrompt } = require('../renderer/terminal-prompt');
const executeFile = promisify(execFile);

// Presentation only: these observations never authorize input or declare a task
// successfully completed. Silence and the shell's existence are not work signals.
function providerActivity({ text = '', native = {} } = {}) {
  const lines = String(text).trimEnd().split('\n');
  const tail = lines.slice(-20);
  const screen = tail.join('\n');
  if (detectPendingPrompt(screen)
    || /(?:would you like to|do you want to|allow this|waiting for (?:approval|permission)|press (?:enter|return) to (?:continue|confirm))/iu.test(screen)
      && tail.some(line => /^\s*[❯›]?\s*\d+[.)]\s*(?:Yes|No|Allow|Deny|Proceed)\b/iu.test(line))) return 'waiting';
  let busy = -1, finished = -1, prompt = -1;
  for (let index = 0; index < tail.length; index++) {
    const line = tail[index];
    if (/^\s*[❯›]/u.test(line)) prompt = index;
    if (/^\s*(?:[─━-]+\s*(?:Worked|Working time|Completed|Finished)\b|Worked for \d|[✻✽✶✢✳✺✼*]\s+.+\b(?:for\s+\d|done\s+\d))/iu.test(line)) finished = index;
    if (/^\s*(?:[•●✻✽✶✢✳✺✼*]\s+.*(?:esc to (?:interrupt|cancel)|ctrl\+c to interrupt|waiting for \d+ background agents? to finish)|[◯○]\s+\S)/iu.test(line)) busy = index;
  }
  if (native.available && (native.inputWaiting || ['completed', 'interrupted'].includes(native.state)) && busy <= prompt) return 'idle';
  if (busy > finished) return 'working';
  if (native.available) {
    if (native.state === 'working' && native.requestId) return 'working';
    if (['completed', 'interrupted'].includes(native.state)) return 'idle';
  }
  // A draft is also input waiting. inputReady() intentionally rejects drafts
  // for automatic delivery, so it is not an activity classifier.
  if (prompt >= 0) return 'idle';
  return 'unknown';
}

function processTable(output, now = Date.now()) {
  const rows = [];
  for (const line of String(output).split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/u);
    if (!match) continue;
    const parsed = posixProcessRows(`${match[1]} ${match[2]} ${match[6]} ${match[7]} ${match[8]}`, now)[0];
    if (parsed) rows.push({ ...parsed, pgid: Number(match[3]), foreground: Number(match[4]), stat: match[5] });
  }
  const byPid = new Map(rows.map(row => [row.pid, row]));
  for (const row of rows) {
    row.ancestorPids = [];
    const seen = new Set([row.pid]);
    let parent = row.parentPid;
    while (parent > 0 && !seen.has(parent) && row.ancestorPids.length < 64) {
      row.ancestorPids.push(parent); seen.add(parent); parent = byPid.get(parent)?.parentPid;
    }
    row.provider = providerFromPosixProcess(row);
  }
  return rows;
}

class TerminalActivity {
  constructor({ completion = new TerminalReviewCompletion(), execute = executeFile, platform = process.platform, now = Date.now } = {}) {
    Object.assign(this, { completion, execute, platform, now });
  }
  async observe(members, frames, fallbackSnapshot = {}) {
    let rows = [], available = false;
    const age = this.now() - Date.parse(fallbackSnapshot.generatedAt);
    if (fallbackSnapshot.available && Array.isArray(fallbackSnapshot.activityRows) && age >= 0 && age < 2000) {
      rows = fallbackSnapshot.activityRows; available = rows.length > 0;
    } else if (['darwin', 'linux'].includes(this.platform)) {
      try {
        const { stdout } = await this.execute('ps', ['-ww', '-axo', 'pid=,ppid=,pgid=,tpgid=,stat=,etime=,comm=,args='], { timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
        rows = processTable(stdout, this.now()); available = rows.length > 0;
      } catch { /* Failed probes remain unknown rather than claiming idle/work. */ }
    }
    const result = new Map();
    await Promise.all(members.map(async member => {
      const frame = frames.get(member.id);
      const shell = rows.find(row => row.pid === member.pid);
      const inSession = row => row.pid === member.pid || row.ancestorPids?.includes(member.pid);
      const providers = (available ? rows.filter(row => ['claude', 'codex'].includes(row.provider) && !utilityProcess(row)) : fallbackSnapshot.processes || []).filter(inSession);
      const roots = providers.filter(row => !providers.some(other => row.ancestorPids?.includes(other.pid)));
      const child = roots.length === 1 ? roots[0] : null;
      let state = 'unknown', completed = false, requestId = '', providerPid = 0;
      if (child && (!frame || frame.creationId === member.creationId && this.now() - frame.at < 5000)) {
        const native = await this.completion.observe(child);
        if (native.available && native.requestId) { requestId = native.requestId; providerPid = child.pid; }
        // Unopened restored panels have no renderer buffer. Exact native
        // process/turn evidence still describes their activity independently.
        state = frame ? providerActivity({ text: frame.readinessText ?? frame.text, native })
          : !native.available ? 'unknown'
            : native.inputWaiting || ['completed', 'interrupted'].includes(native.state) ? 'idle'
              : native.state === 'working' && native.requestId ? 'working' : 'unknown';
        completed = state === 'idle' && native.available === true && native.state === 'completed';
      } else if (available && shell && !providers.length) {
        // An idle shell owns its foreground process group. An external command
        // owns a different group until it exits, even if it produces no output.
        const foreground = rows.filter(row => row.pgid === shell.foreground && inSession(row));
        if (shell.foreground > 0 && shell.foreground !== shell.pgid && foreground.length) {
          state = foreground.some(row => !/^[TZ]/u.test(row.stat)) ? 'working' : 'idle';
        } else if (shell.foreground === shell.pgid) {
          state = /^R/u.test(shell.stat) ? 'working' : 'idle';
        }
      }
      result.set(member.id, { state, completed, ...(requestId ? { requestId, providerPid } : {}), creationId: member.creationId, pid: member.pid });
    }));
    return result;
  }
}

module.exports = { TerminalActivity, providerActivity, processTable };
