const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");
const html = source("renderer/index.html");
const drawer = source("renderer/app-drawer.js");
const drawerEvents = source("renderer/app-events-dialogs.js");
const focus = source("renderer/app-pty-focus.js");
const styles = source("renderer/styles-pty-focus.css");
const drawerStyles = source("renderer/styles-detail-drawer.css");
const ptyStyles = source("renderer/styles-pty-focus.css");
const messages = source("renderer/i18n-messages.js");
const core = source("renderer/app.js");
const agentActions = source("renderer/app-agent-actions.js");

for (const restoredId of ["detailDrawer", "drawerBackdrop", "drawerContent", "drawerComposer"]) {
  assert.equal(
    html.includes(`id="${restoredId}"`),
    true,
    `${restoredId} right-side detail surface is required.`,
  );
}

for (const removedId of ["ptyFocusChildModal", "ptyFocusChildBody", "automationOverview", "tmuxSection", "tmuxCreateModal"]) {
  assert.equal(
    html.includes(`id="${removedId}"`),
    false,
    `${removedId} conversation/popup surface must stay removed.`,
  );
}

assert.ok(html.includes('id="ptyFocusSurface"'), "PTY focus surface is required.");
assert.ok(html.includes('id="ptyFocusTerminalViewport"'), "PTY focus must own the real terminal viewport.");
assert.match(drawer, /context\.openPtyFocusVerified\?\.\(root\.id,/u,
  "Root task-open calls must route to the owning root PTY focus surface.");
assert.match(drawer, /function openSubagentConversation\(id, options = \{\}\)[\s\S]*openDrawerSurface\("modal"\)[\s\S]*renderDrawer\(\)/u,
  "Subagent rows must open the restored right-side detail drawer.");
assert.match(drawer, /function openExecutionActivity\(ownerId, executionId\)[\s\S]*openDrawerSurface\("modal"\)[\s\S]*renderDrawer\(\)/u,
  "Execution rows must open the restored right-side detail drawer.");
assert.match(focus, /function openPtyFocusForTerminal\(terminalId, options = \{\}\)/u,
  "Newly-created terminals need an exact-identity PTY focus entrypoint.");
assert.match(focus, /function syncPendingPtyFocus\(\)/u,
  "A provisional task must retry PTY focus after monitor snapshots arrive.");
assert.match(focus, /data-pty-focus-child=[\s\S]*aria-controls="detailDrawer"[\s\S]*data-pty-focus-execution=/u,
  "PTY focus child and execution rows must target the shared detail drawer.");
for (const key of ["pty_focus.open_child", "pty_focus.open_execution"]) {
  assert.match(messages, new RegExp(`"${key.replace(".", "\\.")}": \\{[^\\n]*"ko":[^\\n]*"en":[^\\n]*"zh-CN":`, "u"),
    `${key} must include every supported locale.`);
}
assert.match(core, /function currentDialog\(\)[\s\S]*detailDrawer[\s\S]*dataset\.presentation === "modal"/u,
  "A context drawer must not be treated as a modal focus trap.");
assert.match(core, /function selectView\(view, options = \{\}\)[\s\S]*view !== state\.view[\s\S]*detailDrawer[\s\S]*dataset\.presentation !== "modal"[\s\S]*closeDrawer\?\.\(false\)/u,
  "Changing views must close a non-modal context drawer.");
assert.match(drawer, /async function openOwnerPty\(id, options = \{\}\)[\s\S]*detailDrawer[\s\S]*closeDrawer\(false\)[\s\S]*openPtyFocusVerified/u,
  "Opening a root PTY must close any body-level context drawer first.");
assert.match(drawerEvents, /data-source-session-action[\s\S]*controlSourceSession/u,
  "Source-session controls in the restored drawer must have a delegated click handler.");
assert.match(drawerEvents, /data-source-message-input[\s\S]*sourceMessageDrafts[\s\S]*data-source-message-form[\s\S]*sendSourceMessage/u,
  "The restored drawer source composer must preserve and submit its draft.");
for (const [attribute, handler] of [
  ["data-agent-bridge-copy", "copyBridgeCommand"],
  ["data-agent-terminal-open", "openAgentTerminal"],
  ["data-attention-quick", "quickRespond"],
  ["data-managed-run-action", "controlManagedRun"],
  ["data-reassign-session", "prepareReassignment"],
  ["data-session-reset", "resetAgentSession"],
  ["data-resume-agent", "resumeAgentTerminal"],
  ["data-conversation-interrupt", "interruptConversation"],
  ["data-terminal-interrupt", "interruptAgentTerminal"],
  ["data-stop-run", "controlManagedRun"],
]) {
  assert.match(drawerEvents, new RegExp(`${attribute}[\\s\\S]*${handler}`, "u"),
    `${attribute} must invoke ${handler} from the restored drawer.`);
}
assert.match(drawerEvents, /conversationSlashStates[\s\S]*data-conversation-slash-command[\s\S]*handleConversationSlashKeydown/u,
  "The restored drawer command composer must retain slash-menu mouse and keyboard behavior.");
assert.match(drawerEvents, /addEventListener\("input"[\s\S]*data-agent-command-draft[\s\S]*agentCommandDrafts[\s\S]*addEventListener\("change"[\s\S]*data-agent-command-target/u,
  "The restored drawer agent composer must retain draft and target state.");
assert.match(drawerEvents, /addEventListener\("keydown"[\s\S]*WhiteboxImeSubmit\?\.handleKeydown[\s\S]*addEventListener\("compositionend"[\s\S]*handleCompositionEnd[\s\S]*addEventListener\("submit"[\s\S]*dispatchAgentCommand/u,
  "The restored drawer agent composer must preserve IME-safe keyboard and submit bindings.");
const drawerReviewHandler = drawerEvents.slice(
  drawerEvents.indexOf("const completeDrawerResultReview = async"),
  drawerEvents.indexOf('$("#closeDrawerBtn")'),
);
const drawerReceiptIndex = drawerReviewHandler.indexOf("const expectedTargets = resultReviewTargets");
const drawerOpenIndex = drawerReviewHandler.indexOf("await openPtyFocusVerified");
const drawerMarkIndex = drawerReviewHandler.indexOf("markResultReviewComplete(sessionId, { expectedTargets })");
assert.ok(drawerReceiptIndex >= 0 && drawerOpenIndex > drawerReceiptIndex && drawerMarkIndex > drawerOpenIndex,
  "Drawer result review must capture receipts, open the exact PTY, and only then acknowledge them.");
assert.match(drawerReviewHandler, /targetId: terminalId,[\s\S]*terminalId,[\s\S]*if \(opened\)[\s\S]*markResultReviewComplete\(sessionId, \{ expectedTargets \}\)/u,
  "Drawer result review must preserve exact terminal identity and reject stale result receipts.");
assert.match(drawerEvents, /drawerResizeHandle[\s\S]*pointerdown[\s\S]*pointermove[\s\S]*pointerup[\s\S]*keydown/u,
  "Context drawer resizing must support pointer and keyboard input.");
assert.match(drawerStyles, /conversation-context-open[\s\S]*--conversation-panel-width/u,
  "Context drawer width changes must resize the work area and drawer.");
assert.match(drawerStyles, /\.drawer-backdrop \{[\s\S]*z-index: 20;[\s\S]*\.detail-drawer \{[\s\S]*z-index: 21;/u,
  "The ordinary drawer must remain below run and quick-palette modals.");
assert.match(ptyStyles, /body\.pty-focus-open > #drawerBackdrop \{ z-index: 70; \}[\s\S]*body\.pty-focus-open > #detailDrawer \{ z-index: 71; \}/u,
  "Only a drawer opened over PTY focus should use the elevated stacking layer.");
assert.match(agentActions, /async function resetAgentSession\(sessionId\)[\s\S]*resetForAgent[\s\S]*closeDrawer\?\.\(false\)[\s\S]*openPtyFocusForTerminal\?\.\(terminalId,[\s\S]*creationId:/u,
  "Session reset must close the drawer and open the newly created exact terminal.");
assert.doesNotMatch(focus, /ptyFocusChildModal|subagentConversationHtml/u,
  "PTY focus must delegate to the shared drawer instead of recreating a child modal.");
assert.match(focus, /function openResponsibleFocus\(sessionId, options = \{\}\)[\s\S]*refreshTranscriptDetail\(root\)/u,
  "A responsible node without a writable PTY must load its transcript in the focus surface.");
assert.match(styles, /\.pty-focus-surface/u, "PTY focus layout styles are required.");
assert.doesNotMatch(styles, /\.pty-focus-child-modal/u,
  "Removed child conversation popup styles must not return.");

console.log("PTY focus and right detail drawer layout tests passed");
