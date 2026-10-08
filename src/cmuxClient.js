'use strict';

const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);
const handle = item => String(item?.id || item?.ref || '');
const cwd = item => String(item?.current_directory || item?.working_directory || item?.cwd || item?.resume_binding?.cwd || '');

function entriesFromTree(tree) {
  const result = [];
  for (const window of tree.windows || []) for (const workspace of window.workspaces || []) {
    for (const pane of workspace.panes || []) for (const surface of pane.surfaces || []) {
      if (surface.type !== 'terminal') continue;
      const target = { window: handle(window), workspace: handle(workspace), surface: handle(surface) };
      if (Object.values(target).some(value => !/^(?:[a-f\d-]{36}|(?:window|workspace|surface):\d+)$/i.test(value))) continue;
      result.push({ id: `cmux:${target.surface}`, title: surface.title || surface.name || workspace.title || workspace.name || 'cmux 터미널',
        cwd: cwd(surface) || cwd(workspace), surfaceCwd: cwd(surface), paneId: handle(pane), selected: surface.selected_in_pane !== false,
        layout: workspace.layout || null, workspaceCwd: cwd(workspace), workspaceTitle: workspace.title || workspace.name || 'cmux 작업', provider: 'cmux', status: 'running', cmuxTarget: target });
    }
  }
  return result;
}

function groupsFromEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const target = entry.cmuxTarget;
    const id = `cmux-workspace:${target.window}:${target.workspace}`;
    if (!groups.has(id)) groups.set(id, { id, title: entry.workspaceTitle, cwd: entry.workspaceCwd || entry.cwd,
      layout: entry.layout, provider: 'cmux', status: 'running', cmuxWorkspace: true, members: [] });
    groups.get(id).members.push(entry);
  }
  return [...groups.values()].map(group => {
    const first = group.members[0];
    // cmux's automatic workspace title/directory follow the focused tab.
    // Keep the group's anchor on its first terminal as focus changes.
    if (group.members.some(member => member.title === group.title)) group.title = first.title;
    if (first.cwd) group.cwd = first.cwd;
    return group;
  });
}

function processDirectories(files) {
  const result = new Map(); let pid, isCwd = false;
  for (const line of files.split('\n')) {
    if (/^p\d+$/.test(line)) { pid = Number(line.slice(1)); isCwd = false; }
    if (line.startsWith('f')) isCwd = line === 'fcwd';
    if (pid && isCwd && line.startsWith('n/')) result.set(pid, line.slice(1));
  }
  return result;
}

function renderGridFrame(grid) {
  const columns = Number(grid?.columns), rows = Number(grid?.rows);
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 || columns > 1000 || rows > 1000 || !Array.isArray(grid.row_spans)) return null;
  const rgb = value => /^#[a-f\d]{6}$/i.test(value || '') ? [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16)).join(';') : '';
  const styles = new Map((grid.styles || []).map(style => [style.id, style]));
  let ansi = '\x1b[?25l\x1b[0m\x1b[2J\x1b[H';
  for (const span of grid.row_spans) {
    if (!Number.isInteger(span.row) || !Number.isInteger(span.column) || span.row < 0 || span.row >= rows || span.column < 0 || span.column >= columns) continue;
    const style = styles.get(span.style_id) || {}, codes = ['0'];
    for (const [key, code] of [['bold', 1], ['faint', 2], ['italic', 3], ['underline', 4], ['inverse', 7], ['strikethrough', 9]]) if (style[key]) codes.push(String(code));
    // Default colors belong to Whitebox's terminal theme. Baking cmux's
    // resolved defaults into each span creates grey/white blocks on the canvas.
    const foreground = style.foreground_source === 'default' ? '' : rgb(style.foreground);
    const background = style.background_source === 'default' ? '' : rgb(style.background);
    if (foreground) codes.push(`38;2;${foreground}`);
    if (background) codes.push(`48;2;${background}`);
    ansi += `\x1b[${span.row + 1};${span.column + 1}H\x1b[${codes.join(';')}m${String(span.text || '').replace(/[\x00-\x1f\x7f]/g, '')}`;
  }
  const cursor = grid.cursor || {};
  ansi += '\x1b[0m';
  if (Number.isInteger(cursor.row) && Number.isInteger(cursor.column)) ansi += `\x1b[${Math.max(1, Math.min(rows, cursor.row + 1))};${Math.max(1, Math.min(columns, cursor.column + 1))}H`;
  ansi += cursor.visible ? '\x1b[?25h' : '\x1b[?25l';
  // Preserve input modes that affect arrows/paste, without enabling native
  // mouse reports until Whitebox also knows the source terminal coordinates.
  for (const code of [1, 2004]) ansi += `\x1b[?${code}${grid.modes?.some(mode => !mode.ansi && mode.code === code && mode.on) ? 'h' : 'l'}`;
  return { ansi, columns, rows, cursor: { row: Math.max(0, Math.min(rows - 1, Number(cursor.row) || 0)), column: Math.max(0, Math.min(columns - 1, Number(cursor.column) || 0)), visible: Boolean(cursor.visible) } };
}

function surfaceProcessIds(tree, rootsOnly = false) {
  const result = new Map();
  const collect = processes => (processes || []).flatMap(process => [Number(process.pid), ...collect(process.children)]).filter(pid => Number.isInteger(pid) && pid > 0);
  for (const window of tree.windows || []) for (const workspace of window.workspaces || []) {
    for (const pane of workspace.panes || []) for (const surface of pane.surfaces || []) {
      result.set(`${handle(window)}:${handle(workspace)}:${handle(surface)}`, [...new Set([...(surface.top_level_pids || []).map(Number), ...(rootsOnly ? (surface.processes || []).map(process => Number(process.pid)) : collect(surface.processes))])].filter(pid => Number.isInteger(pid) && pid > 0));
    }
  }
  return result;
}

// Only files held open by an observed cmux process establish membership.
// Cwd/title matches would also hide unrelated conversations in the same repo.
function sessionIdsFromProcesses(files, commands) {
  const result = new Map();
  const add = (pid, id) => { if (!result.has(pid)) result.set(pid, new Set()); result.get(pid).add(id); };
  let pid;
  for (const line of files.split('\n')) {
    if (/^p\d+$/.test(line)) pid = Number(line.slice(1));
    if (!pid || !line.startsWith('n')) continue;
    const codex = line.match(/\/\.codex\/sessions\/.*\/rollout-[^/]*-([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\.jsonl$/i);
    const claude = line.match(/\/\.claude\/projects\/[^/]+\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\.jsonl$/i);
    if (codex) add(pid, `codex:${codex[1]}`);
    if (claude) add(pid, `claude:${claude[1]}`);
  }
  for (const line of commands.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+\S*\bclaude\s+.*?--session-id(?:=|\s+)([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})(?:\s|$)/i);
    if (match) add(Number(match[1]), `claude:${match[2]}`);
  }
  return result;
}

async function currentCodexSessions(files, readMetadata = async file => {
  const handle = await fs.promises.open(file, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0]);
  } finally { await handle.close(); }
}) {
  const result = new Map();
  let pid;
  for (const line of files.split('\n')) {
    if (/^p\d+$/.test(line)) pid = Number(line.slice(1));
    if (!pid || !line.startsWith('n')) continue;
    const ids = [...(sessionIdsFromProcesses(`p${pid}\n${line}`, '').get(pid) || [])].filter(id => id.startsWith('codex:'));
    if (!ids.length) continue;
    try {
      const meta = await readMetadata(line.slice(1));
      // A single process holds both the visible CLI and its subagent logs.
      const source = meta.payload?.source;
      const terminalSource = source === 'cli' || (typeof source === 'string' && /^codex-tui$/i.test(String(meta.payload?.originator || '').trim()));
      if (meta.type !== 'session_meta' || !terminalSource || `codex:${meta.payload.id}` !== ids[0]) continue;
      if (!result.has(pid)) result.set(pid, new Set());
      result.get(pid).add(ids[0]);
    } catch (_) { /* An unreadable transcript cannot establish current identity. */ }
  }
  return result;
}

function boundSessionId(payload, target) {
  if (payload?.surface_id !== target.surface || payload?.workspace_id !== target.workspace || payload?.window_id !== target.window) return '';
  if (payload.cleared === true) return '';
  const binding = payload.resume_binding;
  if (!['claude', 'codex', 'gemini', 'grok'].includes(binding?.kind)
    || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(binding.checkpoint_id || '')) return '';
  return `${binding.kind}:${binding.checkpoint_id}`;
}

class CmuxClient {
  constructor({ execute = run, exists = fs.existsSync, platform = process.platform } = {}) {
    this.execute = execute;
    this.binary = platform === 'darwin' && ['/Applications/cmux.app/Contents/Resources/bin/cmux', '/opt/homebrew/bin/cmux', '/usr/local/bin/cmux'].find(exists);
    this.entries = [];
    this.inventoryRevision = 0;
    this.mutations = new Map();
  }
  async call(args) {
    if (!this.binary) throw new Error('cmux가 설치되어 있지 않습니다.');
    const { stdout } = await this.execute(this.binary, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, CMUX_WORKSPACE_ID: '', CMUX_SURFACE_ID: '', CMUX_WINDOW_ID: '' } });
    return stdout;
  }
  async list() {
    if (!this.binary) return { installed: false, entries: [], groups: [] };
    const revision = this.inventoryRevision;
    try {
      const entries = entriesFromTree(JSON.parse(await this.call(['--json', '--id-format', 'uuids', 'tree', '--all'])));
      // system.tree omits directory metadata in current cmux releases.
      // Query workspace.list in each exact window rather than infer its root
      // from one of the worktree terminals.
      await Promise.all([...new Set(entries.map(entry => entry.cmuxTarget.window))].map(async windowId => {
        try {
          const payload = JSON.parse(await this.call(['--json', '--id-format', 'uuids', 'list-workspaces', '--window', windowId]));
          const workspaces = new Map((payload.workspaces || []).map(workspace => [handle(workspace), workspace]));
          for (const entry of entries.filter(item => item.cmuxTarget.window === windowId)) {
            const workspace = workspaces.get(entry.cmuxTarget.workspace);
            entry.workspaceCwd = cwd(workspace) || entry.workspaceCwd;
            entry.cwd = entry.cwd || entry.workspaceCwd;
          }
        } catch (_) { /* Keep the identified group when metadata is unavailable. */ }
      }));
      // Hide duplicate monitor rows only when cmux identifies the exact local
      // process. Sharing a cwd or Git repository never proves membership.
      try {
        const tree = JSON.parse(await this.call(['--json', '--id-format', 'uuids', 'top', '--all', '--processes']));
        const processes = surfaceProcessIds(tree), roots = surfaceProcessIds(tree, true);
        for (const entry of entries) {
          const target = entry.cmuxTarget;
          entry.processIds = processes.get(`${target.window}:${target.workspace}:${target.surface}`) || [];
          entry.rootProcessIds = roots.get(`${target.window}:${target.workspace}:${target.surface}`) || [];
        }
      } catch (_) { /* Older cmux builds may not support process diagnostics. */ }
      const pids = [...new Set(entries.flatMap(entry => entry.processIds || []))];
      if (pids.length) {
        const inspect = async (file, args) => {
          try { return (await this.execute(file, args, { timeout: 5000, maxBuffer: 8 * 1024 * 1024 })).stdout || ''; }
          catch (error) { return error.stdout || ''; }
        };
        const [files, commands] = await Promise.all([
          inspect('/usr/sbin/lsof', ['-a', '-p', pids.join(','), '-Fpnf']),
          inspect('/bin/ps', ['-p', pids.join(','), '-o', 'pid=,args=']),
        ]);
        const ids = sessionIdsFromProcesses(files, commands);
        const openIds = await currentCodexSessions(files);
        const directories = processDirectories(files);
        const shells = new Set(commands.split('\n').flatMap(line => {
          const match = line.match(/^\s*(\d+)\s+(?:\S*\/)?-?(?:zsh|bash|sh|fish|dash|ksh)(?:\s|$)/);
          return match ? [Number(match[1])] : [];
        }));
        for (const entry of entries) {
          entry.sessionIds = [...new Set((entry.processIds || []).flatMap(pid => [...(ids.get(pid) || [])]))];
          const currentIds = [...new Set((entry.processIds || []).flatMap(pid => [...(openIds.get(pid) || [])]))];
          entry.currentSessionId = currentIds.length === 1 ? currentIds[0] : '';
          // Descendants include Gradle workers and other build tools whose
          // cwd is unrelated to the terminal's project. Only a root shell
          // can supply a fallback when the exact surface has no directory.
          entry.processCwd = (entry.rootProcessIds || []).filter(pid => shells.has(pid)).map(pid => directories.get(pid)).find(Boolean) || '';
          entry.cwd = entry.surfaceCwd || entry.processCwd || entry.cwd;
        }
      }
      // Provider hooks update this binding after /clear and resume. A launch
      // argument alone can still point to the conversation before /clear.
      await Promise.all(entries.map(async entry => {
        try {
          const payload = JSON.parse(await this.call(['--json', '--id-format', 'uuids', 'surface', 'resume', 'show', '--window', entry.cmuxTarget.window, '--workspace', entry.cmuxTarget.workspace, '--surface', entry.cmuxTarget.surface]));
          const id = boundSessionId(payload, entry.cmuxTarget);
          // The open root transcript follows Codex /new; resume hooks may lag.
          if (!entry.currentSessionId && payload.surface_id === entry.cmuxTarget.surface && payload.workspace_id === entry.cmuxTarget.workspace && payload.window_id === entry.cmuxTarget.window) entry.currentSessionId = id;
          if (id) entry.sessionIds = [...new Set([...(entry.sessionIds || []), id])];
          if (id && id === entry.currentSessionId && cwd(payload.resume_binding)) {
            entry.cwd = entry.surfaceCwd || cwd(payload.resume_binding);
          }
        } catch (_) { /* Older cmux versions retain exact process/file evidence. */ }
      }));
      if (revision === this.inventoryRevision && !this.mutations.size) this.entries = entries;
      return this.inventory();
    } catch (error) {
      if (revision !== this.inventoryRevision) return this.inventory();
      this.entries = [];
      return { installed: true, entries: [], groups: [], error: String(error.stderr || error.message).trim().slice(0, 700) };
    }
  }
  inventory() { return { installed: Boolean(this.binary), entries: this.entries, groups: groupsFromEntries(this.entries), error: '' }; }
  async layoutInventory() {
    // Layout edits need just the native tree. Keep known identity metadata until
    // the regular process/transcript scan finishes, never wait for it to paint.
    const tree = entriesFromTree(JSON.parse(await this.call(['--json', '--id-format', 'uuids', 'tree', '--all'])));
    this.entries = tree.map(entry => {
      const previous = this.entries.find(item => item.id === entry.id);
      if (!previous) return entry;
      return { ...previous, ...entry, cwd: entry.surfaceCwd || previous.cwd || entry.cwd, workspaceCwd: entry.workspaceCwd || previous.workspaceCwd };
    });
    return this.inventory();
  }
  target(id) {
    const target = this.entries.find(entry => entry.id === id)?.cmuxTarget;
    if (!target) throw new Error('cmux 터미널을 다시 선택하세요.');
    return ['--window', target.window, '--workspace', target.workspace, '--surface', target.surface];
  }
  async read(id) { return this.call(['read-screen', ...this.target(id), '--lines', '160']); }
  async frame(id) {
    const args = this.target(id), target = { window_id: args[1], workspace_id: args[3], surface_id: args[5] };
    try {
      const result = JSON.parse(await this.call(['rpc', 'terminal.replay', JSON.stringify(target)]));
      if (result.surface_id !== target.surface_id || result.workspace_id !== target.workspace_id) throw new Error('cmux 터미널 대상이 변경되었습니다. 다시 선택하세요.');
      const frame = renderGridFrame(result.render_grid);
      if (frame) return frame;
    } catch (error) {
      if (!/method_not_found|Unknown method|Unexpected token/.test(String(error.stderr || error.message))) throw error;
    }
    return { text: await this.read(id) };
  }
  async input(id, data) {
    if (typeof data !== 'string' || !data || data.length > 32768) throw new Error('터미널 입력이 너무 큽니다.');
    const args = this.target(id);
    // CLI send interprets backslash escapes. Escape literal backslashes first.
    await this.call(['send', ...args, data.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')]);
    return { ok: true };
  }
  async arrange(id, options = {}) {
    const args = this.target(id), entry = this.entries.find(item => item.id === id);
    const key = `${entry.cmuxTarget.window}:${entry.cmuxTarget.workspace}`;
    if (this.mutations.has(key)) throw new Error('배치 변경 중입니다. 잠시 후 다시 시도하세요.');
    const direction = options.direction;
    const context = args.slice(0, 4);
    const target = options.targetId && this.entries.find(item => item.id === options.targetId);
    if (target && (target.cmuxTarget.window !== entry.cmuxTarget.window || target.cmuxTarget.workspace !== entry.cmuxTarget.workspace)) throw new Error('같은 cmux 작업 안에서만 이동할 수 있습니다.');
    if (['move', 'swap'].includes(options.action) && (!target || target.id === id)) throw new Error('이동할 터미널 위치를 선택하세요.');
    if (['split', 'move'].includes(options.action) && direction && !['left', 'right', 'up', 'down', 'tab'].includes(direction)) throw new Error('지원하지 않는 분할 방향입니다.');
    const operation = async () => {
      switch (options.action) {
        case 'move':
          await this.call(['move-surface', ...args, '--pane', target.paneId, '--focus', 'false']);
          if (direction && direction !== 'tab') await this.call(['split-off', ...args, direction, '--focus', 'false']);
          break;
        case 'swap':
          if (entry.paneId === target.paneId) throw new Error('서로 다른 패널을 선택하세요.');
          await this.call(['swap-pane', ...context, '--pane', entry.paneId, '--target-pane', target.paneId, '--focus', 'false']); break;
        case 'split':
          if (!['left', 'right', 'up', 'down'].includes(direction)) throw new Error('분할 방향을 선택하세요.');
          await this.call(['new-split', ...args, direction, '--focus', 'false']); break;
        case 'close': await this.call(['close-surface', ...args, '--force']); break;
        case 'select': await this.call(['focus-panel', ...context, '--panel', args[5]]); break;
        case 'resize': {
          const flag = { left: '-L', right: '-R', up: '-U', down: '-D' }[direction];
          if (!flag) throw new Error('크기 변경 방향을 선택하세요.');
          const amount = Math.max(1, Math.min(500, Math.round(Number(options.amount) || 20)));
          await this.call(['resize-pane', ...context, '--pane', entry.paneId, flag, '--amount', String(amount)]); break;
        }
        default: throw new Error('지원하지 않는 cmux 작업입니다.');
      }
      return { ok: true, inventory: await this.layoutInventory() };
    };
    this.inventoryRevision += 1;
    this.mutations.set(key, true);
    try { return await operation(); } finally { this.inventoryRevision += 1; this.mutations.delete(key); }
  }
  async focus(id) {
    const args = this.target(id);
    await this.call(['select-workspace', ...args.slice(0, 4)]);
    await this.call(['focus-window', ...args.slice(0, 2)]);
    await this.call(['focus-panel', ...args.slice(0, 4), '--panel', args[5]]);
    return { ok: true };
  }
}
module.exports = { CmuxClient, entriesFromTree, groupsFromEntries, surfaceProcessIds, sessionIdsFromProcesses, renderGridFrame, boundSessionId, currentCodexSessions };
