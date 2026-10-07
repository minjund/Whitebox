# AI terminal groups

Open **AI 터미널 그룹** on a task, then **참여 AI 관리 → AI 추가**. Each added
AI runs in a real Whitebox-managed tmux session. Existing managed tmux AI
terminals can also join. Direct PTYs and external tmux panes are not accepted.
The sidebar shows one `group title session-count` entry; member conversations
are kept inside the group instead of repeated as independent session rows.
Terminal panes show live input, output and scrollback. Drag a Cl/Cx/Ge/Gk tab
onto another pane's edge to split, or its center to join as tabs. The pane's
**⋯** menu offers the same moves and starting a new AI to the right or below.
Drag a divider (or use its arrow keys) to resize; enlarge a session with **⤢**.
Split ratios and selected tabs are saved per group in the local renderer profile.
The **AI 연결** strip lists peers and explains the shared mailbox.
The pane menu also swaps positions, starts a new AI tab, and confirms terminal
closure. The toolbar offers a session picker and full-layout restoration.
Right-click a tab for its menu; Cmd+D / Cmd+Shift+D start a right/below split,
and Ctrl+Tab or Cmd+Option+arrow switches between sessions.
Both sidebar search and the AI/search filters include group names, peer provider
names/abbreviations and linked conversation titles. Matching groups appear as
one workspace card rather than disappearing with their individual members.
Provider conversation attachments have a separate budget from group workspaces;
a group supports 32 sessions with a 96-record host backstop. **AI 참여** shows
all host connections, including background conversations, so capacity is visible. Layout changes
reuse the existing terminals and do not start extra AI tasks.

**그룹에서 제외** terminates that member's tmux runtime and removes its terminal
record and pane. Re-adding starts a new AI session. Deleting a group removes all
members. Failure to confirm termination retains the failed member for retry;
other members and unrelated terminals are preserved. Provider conversation
history files are not erased. Closing the group screen only hides the screen. Empty groups stay selectable;
the empty screen offers **빈 그룹 삭제** directly. Confirming it removes the
group and its saved layout, clears the group filter and refreshes the sidebar.

Groups are saved in `terminal-groups.json` in the Whitebox profile. Each member
uses the terminal host's durable creation identity, including after reopening.
tmux must be available locally, or inside the selected WSL distribution on
Windows. A direct-terminal fallback is not accepted as a successful group add.

Managed and connected cmux terminals share Ghostty workspace font, colors,
cursor behavior, a single 34px tab/control row and 6px terminal inset. Each input
has an accessible label containing the exact group and panel identity.

AI communication uses a private per-group mailbox. The group injects commands
for listing peers, sending a message, and reading the member's inbox into new
AI terminals. Messages are received when the AI runs `inbox`; this does not
interrupt a busy AI or automatically start another model turn. Existing AI
terminals receive these instructions when joining. No conversation composer or
message log is added to the UI. Removing a member revokes its mailbox access;
deleting the group removes the mailbox. The member environment requires Node.js. Startup instructions are passed in the
provider's real launch arguments, preserving multiline prompts. The app checks
the live host's managed-startup capability. Older hosts receive a single-line
reference to a private per-member startup document; `startup` reads the original
text with exact group/panel validation. Existing AI processes keep running; Claude and Codex
also receive persistent system/developer instructions. `self` and `members`
include the exact group/panel IDs. Peer lookup must use that group's roster;
same-directory or same-provider sessions in another group are never recipients.
New PTYs discard inherited cmux and Codex routing IDs, including stale values
in a reused tmux server. Existing running AI sessions retain their context;
use **패널 배치 → 그룹 소통 안내 보내기** to send the scoped instructions to that
exact member once, without restarting it or interrupting other panels.

Validation:

Create and join groups from **새 AI 작업 시작 → 작업 폴더 → 세션 배치**.
The sidebar follows each session/group's working directory beneath its
registered project. It shows live sessions and explicitly filed sessions;
inactive conversation history stays in the history view.
Virtual folders remain available for manual organization.

On macOS, cmux's local CLI discovers all open windows and terminal surfaces.
The sidebar lists one entry per actual cmux window/workspace identity. Selecting
it shows all of that workspace's terminal surfaces together, even when their
working directories belong to different Git worktrees. Workspaces sharing a
directory remain separate.

cmux is an opt-in built-in connection in **설정 → 플러그인 → cmux**, disabled
for new and existing profiles until explicitly connected. The IPC boundary also
checks this setting before every inventory, read, input and layout operation.
Disconnecting releases Whitebox views and hides the cmux groups and their
conversations, including descendant sessions. Exact conversation membership is
retained across restarts; normal process ancestry also identifies new cmux
sessions while disconnected. The original cmux terminals keep running.

Questionnaires use the orchestrator conversation (the explicitly named
orchestrator surface, otherwise the first surface in the workspace). Worker
conversations do not generate separate group questionnaires. Existing automatic
questionnaire preferences and completion checks still apply. The group selection
shows the orchestrator's questionnaire inbox, and the multi-terminal toolbar can
open its latest available questionnaire.

The control room shows one workspace card with **cmux 자세히 보기**. The detail
view renders the original workspace split tree, ratios, pane tabs and colored
terminal grid/cursor through cmux's socket API. Input targets the same existing
surface. It is a connected Whitebox view, not a transplanted AppKit window.
All visible panes accept direct keyboard input and paste when clicked; the active
pane is marked with an input badge and border. Metadata refreshes preserve the
mounted input and layout changes wait until IME composition commits. Input stays
ordered per surface without waiting for screen reads from other panes. Output
uses polling of the original screen, not a newly launched or duplicated session.

Older cmux builds without terminal.replay fall back to text snapshots. The native
window remains available through **cmux 창 열기**.

Tab dragging to pane edges moves and splits a surface; dropping in the center
joins it as a tab. The pane menu also provides moving, swapping, new horizontal
or vertical splits and closing a terminal. Closing requires an explicit second
click and terminates the real cmux surface. Divider dragging/arrow keys call the
native resize command. Divider dragging previews the local ratio once per
animation frame, pauses frame polling during the gesture, and commits one native
resize on release. Confirmed ratios update existing panels without detaching
terminal inputs. Escape/cancellation and failed commits restore the native ratio.
Native layout changes are re-read every four seconds;
terminal frames refresh every 700 ms while detail is visible. Reopening or
rearranging retains the existing surface IDs and does not start new AI tasks.

cmux must allow socket control in its Automation settings. Duplicate sidebar
and control-room sessions are matched
by local PID or exact conversation IDs from files open in cmux processes (and
Claude's explicit session argument); directory/title matches never hide a
conversation. Empty path folders consequently disappear. Actual workspaces
remain grouped by window/workspace UUID, independent of the selected terminal.

An isolated real cmux shell workspace verified input, split, swap, resize,
join-as-tab, split-off and surface close. Its workspace was then removed and its
absence verified; existing user workspaces were preserved.

```sh
node scripts/group-capacity-check.js
node scripts/group-layout-check.js
node scripts/terminal-groups-check.js
node scripts/cmux-sidebar-check.js
# Explicitly creates and cleans up an isolated local cmux shell workspace:
node scripts/cmux-live-integration.js --run
node_modules/.bin/electron scripts/terminal-groups-integration.js
node_modules/.bin/electron scripts/terminal-groups-ui-check.js
node_modules/.bin/electron scripts/project-sidebar-readability-check.js
node scripts/regression-test.js
npm run check:source
```

The real tmux integration runs isolated shell fixtures as AI stand-ins. It
verifies runtime lifecycle and terminal transport, without invoking paid AI
providers. Windows/WSL has not been exercised by the macOS validation.
