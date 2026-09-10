'use strict';

const { launchSpec } = require('./terminalManager');
const SYSTEM_PROMPT = 'Whitebox internal comprehension questionnaire. Transform only the supplied completed answer into the requested JSON. Never use tools or perform the original task.';

function utf8PipeSpec(spec) {
  const fileIndex = spec.args.indexOf('-File');
  if (!/(?:powershell|pwsh)(?:\.exe)?$/iu.test(spec.file) || fileIndex < 0) return spec;
  const literal = value => `'${String(value).replace(/'/gu, "''")}'`;
  // PowerShell npm shims otherwise decode redirected UTF-8 stdin using the
  // Windows console code page, corrupting Korean before it reaches the AI.
  const script = '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); '
    + '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); '
    + '$OutputEncoding = [Console]::OutputEncoding; & '
    + spec.args.slice(fileIndex + 1).map(literal).join(' ') + '; exit $LASTEXITCODE';
  return { ...spec, args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
}

// These requests only transform the supplied answer. They never resume the
// user's conversation or need repository access, tools, hooks, or session files.
function questionnaireCommand(provider, cwd, model = '', platform = process.platform) {
  let args;
  if (provider === 'codex') {
    args = ['exec', '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules',
      '--skip-git-repo-check', '--sandbox', 'read-only', '-C', cwd,
      '-c', 'features.shell_tool=false', '-c', 'features.hooks=false',
      '-c', 'agents.enabled=false', '-c', 'apps._default.enabled=false',
      '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0',
      '-c', `developer_instructions=${JSON.stringify(SYSTEM_PROMPT)}`];
    if (model) args.push('--model', model);
    args.push('-');
  } else if (provider === 'claude') {
    args = ['-p', '--output-format', 'stream-json', '--verbose',
      '--no-session-persistence', '--safe-mode', '--tools', '',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--system-prompt', SYSTEM_PROMPT];
    if (model) args.push('--model', model);
  } else {
    throw new Error('이 AI는 아직 백그라운드 질문지 생성을 지원하지 않습니다.');
  }
  const spec = utf8PipeSpec(launchSpec({ type: 'agent', provider, cwd, args, sessionBackend: 'direct' }, platform));
  return { command: spec.file, args: spec.args };
}

module.exports = { questionnaireCommand, utf8PipeSpec };
