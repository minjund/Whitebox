'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Claude Code keeps settings, sessions/<pid>.json and projects/ logs under
// CLAUDE_CONFIG_DIR (default ~/.claude). Wrappers such as claude-ubion run it
// with a sibling ~/.claude-<name> folder, so one Whitebox process must look in
// every such folder. A folder counts only once Claude has written into it.
const CLAUDE_FILES = ['sessions', 'projects', 'settings.json', '.claude.json'];

function claudeHomes({ home = os.homedir(), env = process.env } = {}) {
  const homes = [];
  const add = dir => { const resolved = path.resolve(dir); if (!homes.includes(resolved)) homes.push(resolved); };
  const configured = typeof env?.CLAUDE_CONFIG_DIR === 'string' ? env.CLAUDE_CONFIG_DIR.trim() : '';
  if (configured) add(configured);
  add(path.join(home, '.claude'));
  let names = [];
  try { names = fs.readdirSync(home); } catch { /* An unreadable home only has the defaults. */ }
  for (const name of names.filter(item => /^\.claude-[A-Za-z0-9._-]+$/u.test(item)).sort()) {
    const dir = path.join(home, name);
    try {
      if (fs.statSync(dir).isDirectory() && CLAUDE_FILES.some(item => fs.existsSync(path.join(dir, item)))) add(dir);
    } catch { /* A vanished or unreadable folder is skipped. */ }
  }
  return homes;
}

// Folder discovery is a directory read; bound it for per-poll callers.
function cachedClaudeHomes(options = {}, ttlMs = 10_000) {
  let value = null, at = 0;
  return () => {
    const now = Date.now();
    if (!value || now - at > ttlMs) { value = claudeHomes(options); at = now; }
    return value;
  };
}

module.exports = { claudeHomes, cachedClaudeHomes };
