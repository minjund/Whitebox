'use strict';

// Guard the active entry point against accidentally restoring a second UI or
// shipping references to assets retired with the old dashboard.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const renderer = path.join(root, 'renderer');
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
assert.match(html, /data-workspace="terminal"/);
assert.match(html, /id="terminalRuntimeMount" hidden/);
assert.match(html, /id="globalStatus"[^>]*aria-live="polite"/);
assert.match(html, /object-src 'none'; base-uri 'none'; form-action 'none'/);
for (const id of ['appShell', 'detailDrawer', 'ptyFocusSurface', 'questionnaireInbox', 'quickPaletteModal']) {
  assert(!html.includes(`id="${id}"`), `retired ${id} must not be mounted`);
}
const visited = new Set();
function checkAsset(relative, owner) {
  if (/^(?:data:|https?:|#)/.test(relative)) return;
  const file = path.resolve(path.dirname(owner), relative.split(/[?#]/)[0]);
  assert(file.startsWith(`${root}${path.sep}`), `asset escapes the application: ${relative}`);
  assert(fs.statSync(file).isFile(), `asset does not exist: ${relative}`);
  if (visited.has(file)) return;
  visited.add(file);
  if (file.endsWith('.css')) {
    const css = fs.readFileSync(file, 'utf8');
    for (const match of css.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g)) checkAsset(match[1], file);
  }
}
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) checkAsset(match[1], path.join(renderer, 'index.html'));
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
assert(scripts.indexOf('terminal-workbench.js') < scripts.indexOf('terminal.js'));
assert(scripts.indexOf('terminal-workspace-layout.js') < scripts.indexOf('terminal-workspace.js'));
assert(scripts.indexOf('app-attention-popup-settings.js') < scripts.indexOf('terminal-workspace.js'));
for (const file of fs.readdirSync(renderer)) {
  if (/^app(?:-|\.)/.test(file)) assert.equal(file, 'app-attention-popup-settings.js', `unreachable app factory: ${file}`);
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const [name, command] of Object.entries(pkg.scripts)) {
  for (const match of command.matchAll(/\bscripts\/([\w.-]+\.js)\b/g)) {
    assert(fs.existsSync(path.join(root, 'scripts', match[1])), `npm ${name} references a retired script`);
  }
}
console.log(`PASS workspace entry point: ${scripts.length} scripts, ${visited.size} resolved assets, CSP, accessibility, dependency order and npm commands`);
