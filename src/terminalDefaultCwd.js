'use strict';

// Default working folder for standalone panels and the first workspace.
// Claude Code never persists folder trust for the home directory ("home trust
// is session-only"), so every Claude started in ~ asks to trust it again.
// A dedicated folder under home is trusted once and remembered by both Claude
// (~/.claude.json projects[...]) and Codex (config.toml [projects]).

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_FOLDER_NAME = 'whitebox-workspace';

function defaultTerminalCwd(options = {}) {
  const home = options.home || os.homedir();
  const fileSystem = options.fileSystem || fs;
  const folder = path.join(home, DEFAULT_FOLDER_NAME);
  try {
    fileSystem.mkdirSync(folder, { recursive: true, mode: 0o755 });
    const stat = fileSystem.statSync(folder);
    if (stat.isDirectory()) return folder;
  } catch { /* An unusable folder keeps the previous home default. */ }
  return home;
}

module.exports = { DEFAULT_FOLDER_NAME, defaultTerminalCwd };
