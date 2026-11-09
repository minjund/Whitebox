'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Slash commands the Summary composer can offer for a provider. Built-in
// commands are a static list; custom commands, skills and plugin skills are
// read from the same files the CLI reads. Only names and descriptions leave
// this module: command bodies are never exposed.
const BUILTIN = {
  claude: [
    ['add-dir', '작업 디렉터리 추가'], ['agents', '에이전트 관리'], ['bug', '버그 보고'], ['clear', '대화 초기화'],
    ['compact', '대화 압축'], ['config', '설정'], ['context', '컨텍스트 사용량'], ['cost', '비용 보기'],
    ['doctor', '설치 상태 점검'], ['exit', '종료'], ['export', '대화 내보내기'], ['fast', '빠른 모드 전환'],
    ['help', '도움말'], ['hooks', '훅 설정'], ['init', 'CLAUDE.md 생성'], ['login', '로그인'], ['logout', '로그아웃'],
    ['mcp', 'MCP 서버 관리'], ['memory', '메모리 편집'], ['model', '모델 선택'], ['permissions', '권한 설정'],
    ['plugin', '플러그인 관리'], ['pr-comments', 'PR 코멘트 보기'], ['release-notes', '릴리스 노트'],
    ['resume', '이전 대화 이어가기'], ['review', '코드 리뷰'], ['rewind', '이전 상태로 되돌리기'], ['skills', '스킬 목록'],
    ['status', '상태 보기'], ['statusline', '상태줄 설정'], ['terminal-setup', '터미널 설정'], ['theme', '테마'],
    ['usage', '사용량 보기'], ['vim', 'Vim 모드 전환'],
  ],
  codex: [
    ['approvals', '승인 정책 선택'], ['clear', '대화 초기화'], ['compact', '대화 압축'], ['diff', '변경 사항 보기'],
    ['feedback', '피드백 보내기'], ['init', 'AGENTS.md 생성'], ['logout', '로그아웃'], ['mcp', 'MCP 서버 보기'],
    ['mention', '파일 언급'], ['model', '모델 선택'], ['new', '새 대화'], ['permissions', '권한 설정'],
    ['quit', '종료'], ['resume', '이전 대화 이어가기'], ['review', '코드 리뷰'], ['status', '상태 보기'], ['undo', '마지막 변경 되돌리기'],
  ],
};

const LIMIT = 400;
const NAME = /^[A-Za-z0-9][\w.-]*$/u;

function frontmatterDescription(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(4096);
      const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const head = buffer.toString('utf8', 0, length);
      if (!head.startsWith('---')) return '';
      const end = head.indexOf('\n---', 3);
      const block = end > 0 ? head.slice(3, end) : head.slice(3);
      const match = block.match(/^\s*description:\s*(.+)$/mu);
      return match ? match[1].trim().replace(/^["']|["']$/gu, '').slice(0, 160) : '';
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

function safeReaddir(directory) {
  try { return fs.readdirSync(directory, { withFileTypes: true }); } catch { return []; }
}

// `commands/<name>.md` and `commands/<group>/<name>.md` (namespaced `group:name`).
function commandFiles(directory, prefix = '', depth = 0, output = []) {
  for (const entry of safeReaddir(directory)) {
    if (!NAME.test(entry.name.replace(/\.md$/u, ''))) continue;
    if (entry.isDirectory() && depth < 2) commandFiles(path.join(directory, entry.name), `${prefix}${entry.name}:`, depth + 1, output);
    else if (entry.isFile() && entry.name.endsWith('.md')) output.push({ name: `${prefix}${entry.name.slice(0, -3)}`, file: path.join(directory, entry.name) });
  }
  return output;
}

function skillDirectories(directory) {
  return safeReaddir(directory).filter(entry => entry.isDirectory() && NAME.test(entry.name))
    .map(entry => ({ name: entry.name, file: path.join(directory, entry.name, 'SKILL.md') })).filter(item => fs.existsSync(item.file));
}

function claudePlugins(home) {
  const file = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Object.entries(data.plugins || {}).flatMap(([key, installs]) => {
      const plugin = String(key).split('@')[0];
      const install = (Array.isArray(installs) ? installs : [installs]).find(item => item && typeof item.installPath === 'string');
      return plugin && NAME.test(plugin) && install ? [{ plugin, root: install.installPath }] : [];
    });
  } catch { return []; }
}

function listSlashCommands({ provider, cwd = '', home = os.homedir() } = {}) {
  const builtin = BUILTIN[provider];
  if (!builtin) return [];
  const commands = new Map();
  const add = (name, description, source) => {
    if (!name || commands.has(name) || commands.size >= LIMIT) return;
    commands.set(name, { name, description: String(description || ''), source });
  };
  for (const [name, description] of builtin) add(name, description, 'builtin');
  const roots = [];
  if (provider === 'claude') {
    for (const [root, source] of [[path.join(home, '.claude'), 'user'], ...(cwd ? [[path.join(cwd, '.claude'), 'project']] : [])]) {
      roots.push({ commands: path.join(root, 'commands'), skills: path.join(root, 'skills'), prefix: '', source });
    }
    for (const { plugin, root } of claudePlugins(home)) {
      roots.push({ commands: path.join(root, 'commands'), skills: path.join(root, 'skills'), prefix: `${plugin}:`, source: 'plugin' });
    }
  } else if (provider === 'codex') {
    roots.push({ commands: path.join(home, '.codex', 'prompts'), skills: '', prefix: '', source: 'user' });
  }
  for (const root of roots) {
    for (const item of commandFiles(root.commands)) add(`${root.prefix}${item.name}`, frontmatterDescription(item.file), root.source);
    if (root.skills) for (const item of skillDirectories(root.skills)) add(`${root.prefix}${item.name}`, frontmatterDescription(item.file), root.source === 'plugin' ? 'plugin' : 'skill');
  }
  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { listSlashCommands, BUILTIN };
