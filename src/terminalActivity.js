'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const { posixProcessRows, providerFromPosixProcess, utilityProcess } = require('./processMonitor');
const { TerminalReviewCompletion } = require('./terminalReviewCompletion');
const { conversationBackground, shellBackground } = require('./terminalBackground');
const { detectPendingPrompt } = require('../renderer/terminal-prompt');
const { isStartupRequest } = require('./terminalReviewTurns');
const { shellActivity } = require('./terminalProgress');
const executeFile = promisify(execFile);

// Presentation only: these observations never authorize input or declare a task
// successfully completed. Silence and the shell's existence are not work signals.
// Gemini CLI's input row is " > " ("* " in YOLO mode); Grok Build's "❯ " can sit
// inside its boxed composer ("│ ❯ │"). Claude and Codex use "❯"/"›".
const PROMPT_ROW = { gemini: /^ ?[>*!] /u, grok: /^\s*(?:│\s?)?[❯›]/u };
// Approval dialogs: Gemini "Allow execution of [Shell]?" / "Apply this change?"
// with "● 1. Allow once"; Grok "Allow command?" with "Yes, proceed".
// Gemini draws the dialog inside its bordered tool box ("│ … │").
const DIALOG_TITLE = /(?:^|\n)\s*(?:│\s*)?(?:allow [^\n?│]{1,80}\?|apply this change\?|do you want to proceed\?)[ \t]*(?:│[ \t]*)?(?=\n|$)/iu;
function providerActivity({ text = '', native = {}, provider = '' } = {}) {
  const lines = String(text).trimEnd().split('\n');
  const tail = lines.slice(-20);
  const screen = tail.join('\n');
  const promptRow = PROMPT_ROW[provider] || /^\s*[❯›]/u;
  const trustChoice = tail.findLastIndex(line => /^\s*[❯›>]?\s*[1-3][.)]\s*\S/u.test(line) && isStartupRequest(line));
  if (trustChoice >= 0 && !tail.slice(trustChoice + 1).some(line => /^\s*[❯›]/u.test(line))) return 'waiting';
  if (detectPendingPrompt(screen)
    || /(?:would you like to|do you want to|allow this|waiting for (?:approval|permission)|press (?:enter|return) to (?:continue|confirm))/iu.test(screen)
      && tail.some(line => /^\s*[❯›●]?\s*\d+[.)]\s*(?:Yes|No|Allow|Deny|Proceed)\b/iu.test(line))
    || DIALOG_TITLE.test(screen) && tail.some(line => /^\s*(?:│\s*)?(?:[❯›●>]\s*)?(?:\d+[.)]\s*)?(?:Yes, proceed|Allow once)\b/iu.test(line))
    // Grok Build's open question to the user ("◆ Waiting on answers for …").
    || tail.slice(-6).some(line => /^\s*\S?\s*Waiting on answers for\b/u.test(line))) return 'waiting';
  let busy = -1, finished = -1, prompt = -1;
  for (let index = 0; index < tail.length; index++) {
    const line = tail[index];
    if (promptRow.test(line)) prompt = index;
    if (/^\s*(?:[─━-]+\s*(?:Worked|Working time|Completed|Finished)\b|Worked for \d|Turn (?:completed|cancelled|failed|blocked)\b|[✻✽✶✢✳✺✼*]\s+.+\b(?:for\s+\d|done\s+\d))/iu.test(line)) finished = index;
    // Gemini and Grok draw a braille spinner row while a turn runs; Grok's
    // "◎ waiting · send a message to interrupt" is a turn parked mid-run. Its
    // idle "◎ 2 commands still running" cue follows a finished turn instead.
    if (/^\s*(?:[•●✻✽✶✢✳✺✼*]\s+.*(?:esc to (?:interrupt|cancel)|ctrl\+c to interrupt|waiting for \d+ background agents? to finish)|[◯○](?![^\n]*still running\s*$)\s+\S|[\u2801-\u28ff]\s+\S|[○◎◉]\s+waiting\b)/iu.test(line)) busy = index;
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

// Waits the session log does not show yet, read from the provider's own live
// status line: Claude compacting its context, or an automatic retry after an
// API error. Only a spinner/status line near the bottom counts, so the same
// words quoted in an answer never become a state.
// Grok Build's running row names the step itself: "⠧ Run npm test 0.2s",
// "Search <query>", "Fetch <url>", "Thinking…", "Responding…", "Compacting…",
// then the turn timer after a wide gap. A tool title other than a shell
// command keeps only its kind and file name.
function grokStep(label) {
  const text = String(label).split(/\s{2,}/u)[0].replace(/\s+\d+(?:\.\d+)?(?:ms|[smh])(?:\d+(?:\.\d+)?[smh])*\s*$/u, '').trim();
  const name = value => String(value || '').trim().split(/\s+/u)[0].split(/[\\/]/u).filter(Boolean).pop()?.slice(0, 60) || '';
  if (/^Thinking…$/u.test(text)) return { kind: 'thinking', phase: 'screen' };
  if (/^Responding…$/u.test(text)) return { kind: 'respond', phase: 'screen' };
  if (/^Compacting…$/u.test(text)) return { kind: 'compact', phase: 'screen' };
  const retry = text.match(/\bretry(?:ing)?\b.*?\b(\d{1,2})\/(\d{1,2})\b/iu);
  if (retry) return { kind: 'retry', detail: `${retry[1]}/${retry[2]}`, phase: 'screen' };
  const search = text.match(/^Search (.+)$/u);
  if (search) return { kind: 'web', detail: search[1].replace(/\s+/gu, ' ').slice(0, 50), phase: 'screen' };
  const fetch = text.match(/^Fetch (\S+)/u);
  if (fetch) { try { return { kind: 'web', detail: new URL(fetch[1]).hostname.slice(0, 60), phase: 'screen' }; } catch { return { kind: 'web', phase: 'screen' }; } }
  const run = text.match(/^Run (.+)$/u);
  if (!run) return null;
  const tool = run[1].match(/^(Read|View|Edit|Write|Create|Update|Grep|Glob|Search|Find|List)\b\s*(.*)$/u);
  if (tool) {
    const kind = /^(?:Read|View)$/u.test(tool[1]) ? 'read' : /^(?:Edit|Write|Create|Update)$/u.test(tool[1]) ? 'edit' : 'search';
    const detail = kind === 'search' ? '' : name(tool[2]);
    return { kind, ...(detail ? { detail } : {}), phase: 'screen' };
  }
  return { ...shellActivity(run[1].replace(/…$/u, '')), phase: 'screen' };
}

// What an approval dialog on screen is for, when the dialog says so.
function screenWaiting(text, provider) {
  const tail = String(text || '').trimEnd().split('\n').slice(-20).join('\n');
  if (provider === 'grok' && /^\s*\S?\s*Waiting on answers for\b/mu.test(tail)) return { kind: 'ask', phase: 'screen' };
  if (!['gemini', 'grok'].includes(provider)) return null;
  if (/^\s*(?:│\s*)?Apply this change\?/mu.test(tail)) return { kind: 'edit', phase: 'screen' };
  if (/^\s*(?:│\s*)?Allow execution of MCP tool\b/mu.test(tail)) return { kind: 'mcp', phase: 'screen' };
  if (/^\s*(?:│\s*)?(?:Allow execution of\b|Allow command\?)/mu.test(tail)) return { kind: 'command', phase: 'screen' };
  return null;
}

function screenProgress(text, provider = '') {
  const tail = String(text || '').trimEnd().split('\n').slice(-12);
  for (let index = tail.length - 1; index >= 0; index--) {
    const line = tail[index];
    // Gemini's row ("⠋ Thinking... (esc to cancel, 12s)") shows a phrase that
    // can be a tip or a joke rather than the current step, so it adds nothing.
    const row = provider === 'grok' && line.match(/^\s*[\u2801-\u28ff] (.+)$/u);
    if (row) return grokStep(row[1]);
    if (/^\s*[·✢✳✶✻✽✺✼*]\s+Compacting conversation\b/u.test(line)) return { kind: 'compact', phase: 'screen' };
    const retry = line.match(/\bRetrying in\b.{0,40}?\battempt (\d{1,2})\/(\d{1,2})\b/u)
      || line.match(/^\s*(?:[⚠■•]\s*)?(?:stream error|Reconnecting)\b.{0,160}?\b(?:retrying )?(\d{1,2})\/(\d{1,2})\b/iu);
    if (retry) return { kind: 'retry', detail: `${retry[1]}/${retry[2]}`, phase: 'screen' };
  }
  return null;
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
  constructor({ completion = new TerminalReviewCompletion(), execute = executeFile, platform = process.platform, now = Date.now, backgroundSnapshot = () => null } = {}) {
    Object.assign(this, { completion, execute, platform, now, backgroundSnapshot });
    // When each AI was first seen working, for the elapsed-time line when its
    // log does not say when the request started (Gemini, Grok, or no log).
    this.workSince = new Map();
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
    const backgroundSnapshot = this.backgroundSnapshot();
    const workSince = new Map();
    await Promise.all(members.map(async member => {
      const frame = frames.get(member.id);
      const shell = rows.find(row => row.pid === member.pid);
      const inSession = row => row.pid === member.pid || row.ancestorPids?.includes(member.pid);
      const providers = (available ? rows.filter(row => ['claude', 'codex', 'gemini', 'grok'].includes(row.provider) && !utilityProcess(row)) : fallbackSnapshot.processes || []).filter(inSession);
      const roots = providers.filter(row => !providers.some(other => row.ancestorPids?.includes(other.pid)));
      const child = roots.length === 1 ? roots[0] : null;
      let state = 'unknown', completed = false, requestId = '', providerPid = child?.pid || 0;
      let usage = null, conversationId = '', usageStatus = roots.length === 0 ? 'none' : 'unavailable';
      const native = child ? await this.completion.observe(child) : {};
      const background = child ? conversationBackground(native, child, backgroundSnapshot, this.now(), available ? rows : [])
        : available && !providers.length ? shellBackground(rows, shell) : [];
      if (native.available && native.usage) { usage = native.usage; conversationId = native.conversationId || ''; usageStatus = 'observed'; }
      if (child && (!frame || frame.creationId === member.creationId && this.now() - frame.at < 5000)) {
        if (native.available && native.requestId) { requestId = native.requestId; providerPid = child.pid; }
        // Unopened restored panels have no renderer buffer. Exact native
        // process/turn evidence still describes their activity independently.
        state = frame ? providerActivity({ text: frame.readinessText ?? frame.text, native, provider: child.provider })
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
      // Live, model-free description of the current step for working AIs (and
      // the step an approval prompt is holding).
      const live = ['working', 'waiting'].includes(state);
      const screen = !child || !frame ? null : state === 'working' ? screenProgress(frame.readinessText ?? frame.text, child.provider)
        : state === 'waiting' ? screenWaiting(frame.readinessText ?? frame.text, child.provider) : null;
      const progress = live ? screen || (native.available && native.progress ? native.progress : null) : null;
      const sinceKey = `${member.id}:${member.creationId}:${child?.pid || 0}`;
      if (live && child) workSince.set(sinceKey, this.workSince.get(sinceKey) ?? this.now());
      // Without the request's own start, the line says only how long this
      // work has been observed: no step or file counts are claimed.
      const turn = !live ? null : native.available && native.turn ? native.turn
        : workSince.has(sinceKey) ? { since: workSince.get(sinceKey), steps: 0, files: 0, observed: true } : null;
      // The AI's own turn has ended while work it started still runs, so it
      // is waiting on that work rather than on the user.
      const backgroundWait = Boolean(child && background.length && native.available && state !== 'waiting'
        && (native.inputWaiting || ['completed', 'interrupted'].includes(native.state)));
      const model = native.available && typeof native.model === 'string' ? native.model : '';
      const effort = native.available && typeof native.effort === 'string' ? native.effort : '';
      result.set(member.id, { state, completed, ...(requestId ? { requestId } : {}), ...(progress ? { progress } : {}), ...(turn ? { turn } : {}),
        ...(backgroundWait ? { backgroundWait } : {}), providerPid,
        provider: child?.provider || '', usage, conversationId, usageStatus, ...(model ? { model } : {}), ...(effort ? { effort } : {}),
        background: { count: background.length, items: background.slice(0, 32) }, creationId: member.creationId, pid: member.pid });
    }));
    this.workSince = workSince;
    return result;
  }
}

module.exports = { TerminalActivity, providerActivity, processTable, screenProgress, screenWaiting };
