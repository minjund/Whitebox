'use strict';

// What the AI is doing right now, derived from the provider's own session log
// without any model call: the running tool, or the AI's latest progress line.
// Command arguments may hold credentials, so a shell command contributes only
// its kind (test, build, git subcommand) or its program name.

// Details are kept for the whole turn, so they own their characters instead
// of slicing (and pinning) a large tool input.
const own = value => value ? Buffer.from(value, 'utf16le').toString('utf16le') : '';
const clip = (value, limit) => {
  const text = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
  return own(text.length > limit ? `${text.slice(0, limit - 1)}…` : text);
};
const basename = value => own(String(value || '').split(/[\\/]/u).filter(Boolean).pop()?.slice(0, 60) || '');
const parse = input => { if (typeof input !== 'string') return input || {}; try { return JSON.parse(input); } catch { return {}; } };

function shellActivity(command) {
  const text = String(command || '').trim();
  const first = text.replace(/^(?:(?:sudo|env|time|cd\s+\S+\s*&&|set\s+-[a-z]+\s*(?:;|&&)|[A-Z_][A-Z0-9_]*=\S*)\s+)+/u, '');
  if (/(?:^|[\s;&|(])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:jest|vitest|pytest|mocha|rspec|playwright\s+test|phpunit|ctest)\b|\b(?:go|cargo|dotnet|swift)\s+test\b|\b(?:gradlew?|mvnw?)\b[^|;&]*\btest\b|scripts\/[\w./-]*test[\w.-]*\.(?:js|mjs|ts|sh|py)\b/iu.test(text)) return { kind: 'test' };
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|compile)\b|\b(?:tsc|webpack|esbuild|rollup)\b|\bvite\s+build\b|\b(?:gradlew?|mvnw?)\b[^|;&]*\b(?:build|assemble|compile|package)\b|\b(?:cargo|go|dotnet|swift)\s+build\b|\bmake\b/iu.test(text)) return { kind: 'build' };
  if (/\b(?:npm|pnpm|bun)\s+(?:i|install|ci|add)\b|\byarn(?:\s+(?:install|add))?\s*$|\b(?:pip3?|brew|cargo)\s+(?:install|add)\b/iu.test(text)) return { kind: 'install' };
  const git = first.match(/^git\s+(?:-C\s+\S+\s+)?([a-z][a-z-]{1,20})\b/u);
  if (git) return { kind: 'git', detail: git[1] };
  if (/^(?:rg|grep|find|ls|cat|head|tail|sed\s+-n|wc|tree|fd)\b/u.test(first)) return { kind: 'read' };
  const program = basename(first.split(/\s+/u)[0]);
  return { kind: 'command', detail: /^[\w.+-]{1,40}$/u.test(program) ? program : '' };
}

// Current Codex runs its tools from one short script (`exec`), e.g.
// `text(await tools.exec_command({cmd:"npm test"}))` or several calls inside
// Promise.all. Describe the most telling call it makes; the script's own code
// and every other argument stay out of the label.
const literal = text => {
  const source = String(text || '').trimStart();
  const quoted = source.match(/^(?:"(?:[^"\\\n]|\\.){0,4000}"|'(?:[^'\\\n]|\\.){0,4000}'|`(?:[^`\\]|\\.){0,4000}`)/u)?.[0] || '';
  if (!quoted) return '';
  if (quoted[0] === '`') return quoted.slice(1, -1);
  try { return JSON.parse(quoted[0] === '"' ? quoted : `"${quoted.slice(1, -1).replace(/\\'/gu, "'").replace(/(^|[^\\])"/gu, '$1\\"')}"`); } catch { return ''; }
};
const CODE_MODE_RANK = ['apply_patch', 'exec_command', 'web__run', 'view_image', 'write_stdin'];
function codeModeActivity(source) {
  const script = String(source || '').slice(0, 200000);
  const calls = [...script.matchAll(/\btools\.([A-Za-z_]\w*)\s*\(/gu)].slice(0, 64);
  if (!calls.length) return { kind: 'tool' };
  const rank = name => { const index = CODE_MODE_RANK.indexOf(name); return index < 0 ? CODE_MODE_RANK.length : index; };
  const call = [...calls].sort((a, b) => rank(a[1]) - rank(b[1]) || a.index - b.index)[0];
  const name = call[1], args = script.slice(call.index + call[0].length, call.index + call[0].length + 8000);
  if (name === 'apply_patch') {
    // The patch is a string literal, so its line breaks are often `\n` escapes.
    const files = [...script.matchAll(/\*\*\* (?:Update|Add|Delete) File: ((?:[^\n"'`\\]|\\(?!n))+)/gu)].map(match => basename(match[1].trim())).filter(Boolean);
    const unique = [...new Set(files)].slice(0, 50);
    return { kind: 'edit', detail: unique[0] || '', ...(unique.length > 1 ? { files: unique } : {}) };
  }
  if (name === 'exec_command') {
    const command = literal(args.match(/["']?cmd["']?\s*:\s*([\s\S]*)/u)?.[1] || '');
    return command ? shellActivity(command) : { kind: 'command', detail: '' };
  }
  if (name === 'write_stdin') return /["']?chars["']?\s*:\s*(?:"(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)+')/u.test(args) ? { kind: 'command', detail: '' } : { kind: 'wait' };
  if (name === 'view_image') return { kind: 'read' };
  if (name === 'web__run') return { kind: 'web' };
  return toolActivity(name, {});
}

function toolActivity(name, input) {
  const tool = String(name || '');
  if (tool === 'exec' && typeof input === 'string' && !/^\s*\{/u.test(input)) return codeModeActivity(input);
  const value = parse(input);
  if (/^(?:Bash|exec_command|shell_command|shell|local_shell)$/iu.test(tool)) {
    const command = typeof value.command === 'string' ? value.command : Array.isArray(value.command) ? value.command.join(' ') : value.cmd;
    return shellActivity(command);
  }
  if (/^(?:Write|Edit|MultiEdit|NotebookEdit|apply_patch)$/iu.test(tool)) {
    const patchFile = typeof value === 'string' ? '' : String(value.input || value.patch || '').match(/\*\*\* (?:Update|Add) File: (.+)/u)?.[1];
    return { kind: 'edit', detail: basename(value.file_path || value.path || value.notebook_path || patchFile) };
  }
  if (/^(?:Read|read_file|view_image|view)$/iu.test(tool)) return { kind: 'read', detail: basename(value.file_path || value.path) };
  // A search pattern or file glob is what the AI is looking for, not a secret.
  if (/^(?:Grep|Glob|LS|grep_files|list_dir|file_search)$/iu.test(tool)) {
    const detail = clip(value.pattern || value.query || '', 40);
    return detail ? { kind: 'search', detail } : { kind: 'search' };
  }
  if (/^(?:WebSearch|web_search)$/iu.test(tool) && (value.query || value.action?.query)) return { kind: 'web', detail: clip(value.query || value.action.query, 50) };
  if (/^(?:WebFetch|WebSearch|web_search|fetch)$/iu.test(tool)) {
    try { return { kind: 'web', detail: own(new URL(value.url || value.action?.url).hostname.slice(0, 60)) }; } catch { return { kind: 'web' }; }
  }
  // A helper AI is named by its short task description, never its prompt.
  if (/^(?:Task|Agent|spawn_agent)$/u.test(tool)) {
    const detail = clip(value.description || value.task_name || value.subagent_type || value.agent_type || '', 40);
    return { kind: 'agent', ...(detail ? { detail } : {}) };
  }
  // The AI is blocked on work it started earlier (background command or agent).
  if (/^(?:TaskOutput|BashOutput|AgentOutputTool|wait_agent)$/u.test(tool) && value.block !== false) return { kind: 'wait' };
  // Codex: waiting on its own still-running script cell, or pausing on purpose.
  if (/^(?:wait|sleep)$/u.test(tool)) return { kind: 'wait' };
  // Codex: a message or follow-up to a helper AI it started, named by its task.
  if (/^(?:send_message|followup_task|list_agents)$/u.test(tool)) {
    const detail = clip(typeof value.target === 'string' ? value.target : '', 40);
    return { kind: 'agent', ...(detail ? { detail } : {}) };
  }
  // Codex app control: the script's own short title, never its code.
  if (tool === 'js') return { kind: 'tool', ...(clip(value.title, 40) ? { detail: clip(value.title, 40) } : {}) };
  if (/^write_stdin$/u.test(tool) && !value.chars) return { kind: 'wait' };
  if (/^Monitor$/u.test(tool)) return { kind: 'monitor', ...(clip(value.description, 40) ? { detail: clip(value.description, 40) } : {}) };
  if (/^(?:TodoWrite|update_plan)$/u.test(tool)) return { kind: 'plan' };
  if (/^(?:AskUserQuestion|request_user_input|request_user_input_async)$/u.test(tool)) return { kind: 'ask' };
  if (/^Skill$/u.test(tool)) return { kind: 'skill', detail: own(String(value.skill || '').slice(0, 40)) };
  const mcp = tool.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.*)$/u);
  if (mcp) {
    const server = mcp[1].replace(/^(?:plugin_|claude_ai_)/u, '').slice(0, 40), action = mcp[2].slice(0, 40);
    return { kind: 'mcp', detail: own(action ? `${server} › ${action}` : server) };
  }
  return { kind: 'tool', detail: own(tool.slice(0, 40)) };
}

// The first sentence of the AI's own latest progress line, bounded.
function progressNote(text) {
  const line = String(text || '').split('\n').map(item => item.replace(/^[\s#>*•-]+|[*`]+/gu, '').trim()).find(Boolean) || '';
  const sentence = line.match(/^.+?(?:[.!?。！？](?=\s|$)|$)/u)?.[0] || line;
  return sentence.length > 90 ? `${sentence.slice(0, 89)}…` : sentence;
}

// Lightweight per-request counts for the status line: how many tool calls the
// AI made and how many distinct files it edited. Copied on write and keyed by
// the request, so a new request starts from zero without extra resets.
function recordStep(state, activity) {
  if (!state?.requestId) return;
  const prior = state.turnSteps?.requestId === state.requestId ? state.turnSteps : { requestId: state.requestId, steps: 0, files: [] };
  // One patch can touch several files.
  const edited = activity?.kind === 'edit' ? Array.isArray(activity.files) ? activity.files : [activity.detail] : [];
  let files = prior.files;
  for (const file of edited) if (file && !files.includes(file) && files.length < 200) files = [...files, file];
  state.turnSteps = { requestId: state.requestId, steps: prior.steps + 1, files };
}
function turnStats(state) {
  if (!state?.requestId || !Number.isFinite(state.requestAt)) return null;
  const steps = state.turnSteps?.requestId === state.requestId ? state.turnSteps : { steps: 0, files: [] };
  return { since: state.requestAt, steps: steps.steps, files: steps.files.length };
}

// Claude records waits it cannot control in its own log: an automatic retry
// after an API error, and a pause until a usage limit resets. Both clear when
// the next request goes out or the AI writes anything newer.
function observeNotice(state, row) {
  if (row.type === 'api-request' || row.subtype === 'compact_boundary'
    || row.subtype === 'informational' && /^Usage limit reset\b/u.test(String(row.content || ''))) { if (state?.notice) state.notice = null; return; }
  if (!state?.requestId || state.complete) return;
  let notice = null;
  if (row.subtype === 'api_error' && Number.isFinite(row.retryAttempt) && row.retryAttempt > 0) {
    notice = { kind: 'retry', detail: Number.isFinite(row.maxRetries) && row.maxRetries > 0 ? `${row.retryAttempt}/${row.maxRetries}` : String(row.retryAttempt) };
  } else if (row.subtype === 'informational' && /^Usage limit reached\b/u.test(String(row.content || ''))) {
    const when = String(row.content).match(/continuing automatically (?:at )?([^·]{1,24}?)\s*(?:·|$)/u)?.[1] || '';
    notice = { kind: 'limit', ...(when ? { detail: clip(when, 24) } : {}) };
  }
  if (!notice) return;
  state.seq = (state.seq || 0) + 1;
  state.notice = { ...notice, requestId: state.requestId, seq: state.seq };
}

// Most recent event wins: a running tool, the AI's latest line, or the step
// after a tool finished (the AI is reading the result).
function currentProgress(state) {
  if (!state?.requestId || state.complete || state.aborted) return null;
  const tools = Array.isArray(state.tools) ? state.tools : [];
  const running = tools.filter(item => item.status === 'called').sort((a, b) => (b.seq || 0) - (a.seq || 0))[0];
  const latestTool = [...tools].sort((a, b) => (b.seq || 0) - (a.seq || 0))[0];
  const answerSeq = state.answerSeq || 0;
  const notice = state.notice?.requestId === state.requestId ? state.notice : null;
  if (notice && notice.seq > Math.max(answerSeq, latestTool?.seq || 0)) return { kind: notice.kind, ...(notice.detail ? { detail: notice.detail } : {}), phase: 'notice' };
  if (running && (running.seq || 0) > answerSeq) {
    const progress = { ...(running.activity || { kind: 'tool' }), phase: 'running' };
    // Several helper AIs started together run at the same time.
    const agents = progress.kind === 'agent' ? tools.filter(item => item.status === 'called' && item.activity?.kind === 'agent').length : 0;
    return agents > 1 ? { ...progress, count: agents } : progress;
  }
  if (state.answer && answerSeq >= (latestTool?.seq || 0)) {
    const note = progressNote(state.answer);
    if (note) return { kind: 'note', detail: note, phase: 'note' };
  }
  if (latestTool) return { ...(latestTool.activity || { kind: 'tool' }), phase: 'after' };
  return { kind: 'thinking', phase: 'thinking' };
}

module.exports = { toolActivity, shellActivity, currentProgress, progressNote, recordStep, turnStats, observeNotice };
