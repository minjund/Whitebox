const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");
const html = source("renderer/index.html");
const drawer = source("renderer/app-drawer.js");
const focus = source("renderer/app-pty-focus.js");
const styles = source("renderer/styles-pty-focus.css");

for (const removedId of [
  "detailDrawer",
  "drawerBackdrop",
  "drawerContent",
  "drawerComposer",
  "ptyFocusChildModal",
  "ptyFocusChildBody",
  "automationOverview",
  "tmuxSection",
  "tmuxCreateModal",
]) {
  assert.equal(
    html.includes(`id="${removedId}"`),
    false,
    `${removedId} conversation/popup surface must stay removed.`,
  );
}

assert.ok(html.includes('id="ptyFocusSurface"'), "PTY focus surface is required.");
assert.ok(html.includes('id="ptyFocusTerminalViewport"'), "PTY focus must own the real terminal viewport.");
assert.match(drawer, /context\.openPtyFocusVerified\?\.\(root\.id,/u,
  "Legacy task-open calls must route to the owning root PTY focus surface.");
assert.doesNotMatch(drawer, /innerHTML|classList\.add\("open"\)|drawerContent/u,
  "The compatibility router must not recreate a conversation drawer.");
assert.match(focus, /function openPtyFocusForTerminal\(terminalId, options = \{\}\)/u,
  "Newly-created terminals need an exact-identity PTY focus entrypoint.");
assert.match(focus, /function syncPendingPtyFocus\(\)/u,
  "A provisional task must retry PTY focus after monitor snapshots arrive.");
assert.doesNotMatch(focus, /ptyFocusChildModal|data-open-subagent-chat|loadSessionDetail/u,
  "PTY focus lanes are status-only and must not open a conversation/detail popup.");
assert.match(styles, /\.pty-focus-surface/u, "PTY focus layout styles are required.");
assert.doesNotMatch(styles, /\.pty-focus-child-modal/u,
  "Removed child conversation popup styles must not return.");

console.log("PTY focus-only layout tests passed");
