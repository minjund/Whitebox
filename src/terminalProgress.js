'use strict';

// What the AI is doing right now, derived from the provider's own session log
// without any model call: the running tool, or the AI's latest progress line.
// Command arguments may hold credentials, so a shell command contributes only
// its kind (test, build, git subcommand) or its program name.

const basename = value => String(value || '').split(/[\\/]/u).filter(Boolean).pop()?.slice(0, 60) || '';
const parse = input => { if (typeof input !== 'string') return input || {}; try { return JSON.parse(input); } catch { return {}; } };

function shellActivity(command) {
  const text = String(command || '').trim();
  const first = text.replace(/^(?:(?:sudo|env|time|cd\s+\S+\s*&&|[A-Z_][A-Z0-9_]*=\S*)\s+)+/u, '');
  if (/(?:^|[\s;&|(])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:jest|vitest|pytest|mocha|rspec|playwright\s+test|phpunit|ctest)\b|\b(?:go|cargo|dotnet|swift)\s+test\b|\b(?:gradlew?|mvnw?)\b[^|;&]*\btest\b|scripts\/[\w./-]*test[\w.-]*\.(?:js|mjs|ts|sh|py)\b/iu.test(text)) return { kind: 'test' };
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|compile)\b|\b(?:tsc|webpack|esbuild|rollup)\b|\bvite\s+build\b|\b(?:gradlew?|mvnw?)\b[^|;&]*\b(?:build|assemble|compile|package)\b|\b(?:cargo|go|dotnet|swift)\s+build\b|\bmake\b/iu.test(text)) return { kind: 'build' };
  if (/\b(?:npm|pnpm|bun)\s+(?:i|install|ci|add)\b|\byarn(?:\s+(?:install|add))?\s*$|\b(?:pip3?|brew|cargo)\s+(?:install|add)\b/iu.test(text)) return { kind: 'install' };
  const git = first.match(/^git\s+(?:-C\s+\S+\s+)?([a-z][a-z-]{1,20})\b/u);
  if (git) return { kind: 'git', detail: git[1] };
  if (/^(?:rg|grep|find|ls|cat|head|tail|sed\s+-n|wc|tree|fd)\b/u.test(first)) return { kind: 'read' };
  const program = basename(first.split(/\s+/u)[0]);
  return { kind: 'command', detail: /^[\w.+-]{1,40}$/u.test(program) ? program : '' };
}

function toolActivity(name, input) {
  const tool = String(name || '');
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
  if (/^(?:Grep|Glob|LS|grep_files|list_dir|file_search)$/iu.test(tool)) return { kind: 'search' };
  if (/^(?:WebFetch|WebSearch|web_search|fetch)$/iu.test(tool)) {
    try { return { kind: 'web', detail: new URL(value.url || value.action?.url).hostname.slice(0, 60) }; } catch { return { kind: 'web' }; }
  }
  if (/^(?:Task|Agent)$/u.test(tool)) return { kind: 'agent' };
  if (/^(?:TodoWrite|update_plan)$/u.test(tool)) return { kind: 'plan' };
  if (/^(?:AskUserQuestion|request_user_input)$/u.test(tool)) return { kind: 'ask' };
  if (/^Skill$/u.test(tool)) return { kind: 'skill', detail: String(value.skill || '').slice(0, 40) };
  const mcp = tool.match(/^mcp__([^_]+(?:_[^_]+)*?)__/u);
  if (mcp) return { kind: 'mcp', detail: mcp[1].replace(/^(?:plugin_|claude_ai_)/u, '').slice(0, 40) };
  return { kind: 'tool', detail: tool.slice(0, 40) };
}

// The first sentence of the AI's own latest progress line, bounded.
function progressNote(text) {
  const line = String(text || '').split('\n').map(item => item.replace(/^[\s#>*•-]+|[*`]+/gu, '').trim()).find(Boolean) || '';
  const sentence = line.match(/^.+?(?:[.!?。！？](?=\s|$)|$)/u)?.[0] || line;
  return sentence.length > 90 ? `${sentence.slice(0, 89)}…` : sentence;
}

// Most recent event wins: a running tool, the AI's latest line, or the step
// after a tool finished (the AI is reading the result).
function currentProgress(state) {
  if (!state?.requestId || state.complete || state.aborted) return null;
  const tools = Array.isArray(state.tools) ? state.tools : [];
  const running = tools.filter(item => item.status === 'called').sort((a, b) => (b.seq || 0) - (a.seq || 0))[0];
  const latestTool = [...tools].sort((a, b) => (b.seq || 0) - (a.seq || 0))[0];
  const answerSeq = state.answerSeq || 0;
  if (running && (running.seq || 0) > answerSeq) return { ...(running.activity || { kind: 'tool' }), phase: 'running' };
  if (state.answer && answerSeq >= (latestTool?.seq || 0)) {
    const note = progressNote(state.answer);
    if (note) return { kind: 'note', detail: note, phase: 'note' };
  }
  if (latestTool) return { ...(latestTool.activity || { kind: 'tool' }), phase: 'after' };
  return { kind: 'thinking', phase: 'thinking' };
}

module.exports = { toolActivity, shellActivity, currentProgress, progressNote };
