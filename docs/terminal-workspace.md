# Terminal workspace panels

The terminal workspace groups live terminals into panels. Each project has its
own panels; **독립 패널** holds panels outside a project. The sidebar shows each
terminal's identity and work state through dots: green while work is in progress,
yellow when waiting for input, approval, stopped, or unconfirmed. Tooltips and
accessible labels describe the exact state without visible status text. Claude
and Codex use process-owned native turn records and the current terminal screen;
an open shell alone never turns green. POSIX shell commands use the terminal's
foreground process group, so a quiet `sleep` remains working until it ends.
Activity refreshes independently of automatic review and makes no model calls.
The sidebar adds a small layers/count badge beside the existing state dot only
when background work is observed. It never adds a row or replaces the foreground
state. Clicking opens that terminal's command/helper-agent list without selecting
it or sending input. Escape, close and outside clicks dismiss the popover; ended
jobs remove the badge. Counts above 99 use `99+` with the exact count in the label.

AI background work reuses the monitor worker's parsed `executions` and helper
agent lifecycles, joined only to the native log already verified for the exact
live Claude/Codex child. The worker snapshot must be less than 15 seconds old;
ambiguous, unverified, finished or pre-launch work is excluded. No cwd/title or
newest-log matching is used, and no extra model call or transcript scan is added.
POSIX shells also show live background process groups, counting a pipeline once
and excluding foreground, unrelated, stopped and zombie processes. Unsupported
or unavailable observations show no speculative badge. Popup metadata excludes
raw commands, output and prompts. Background counters are not persisted.

Validation: `node scripts/terminal-background-test.js` uses real Claude/Codex
parsers and exact native-log adapters. The workspace E2E launches a real POSIX
background job and checks lifecycle, unchanged row/dot/input selection, both
themes at a 176px sidebar, safe titles, and popup keyboard/outside dismissal.
Missing/stale observations stay yellow; silence never implies completion.
Unknown shell activity on platforms without a foreground process probe also
stays yellow. State dots appear on terminals only. Panels with terminals have a
disclosure arrow. Selecting another
panel or project leaves opened panel lists expanded. Each disclosure arrow
toggles only its own list without changing the selected terminal; the saved
layout retains explicit collapse choices.

Creating a panel displays a temporary panel and connection progress immediately,
before host creation or terminal mounting finishes. Duplicate creation is disabled
while that request is pending. Failed creation removes the placeholder; a failed
mount retains the real session with a reconnect button. Placeholders are never
persisted. The actual terminal mounts in its visible layout.

Create/close latency: replay JSON/UTF-8 encodings are reused while output is
unchanged. UTF-8 cache buffers are capped by the existing store budget (64 MiB
by default), invalidated by output changes, and released for removed sessions.
The store remains the same JSON schema with byte-identical encoding; every
creation/delivery/termination transaction still performs its required atomic
write and checks failure. No shutdown acknowledgement or timeout is relaxed.
Metadata-only identity checks after mount, close, trash and purge no longer
transfer terminal replay. A confirmed trash operation releases the UI before
its unrelated review-pause reply completes; mount still validates identity and
reads the replay through the existing bounded queue.

An isolated benchmark against the installed 2.0.15 core used one 83-session,
56,865,053-byte history copy and fake PTYs to separate persistence from OS shell
startup/exit. Three warm runs measured create at 887–945ms before versus 67–75ms
after; close at 432–444ms before versus 32–366ms after (median 37ms). Required
write counts stayed four and two, and initial store SHA-256 matched exactly.
These are storage-path timings, not an installed-app end-to-end latency promise.
`artifacts/terminal-latency-benchmark.json` records the samples. Regression tests
cover exact JSON bytes, Unicode and size budgets, cache invalidation, memory
bounds, write failure/retry and old-schema restoration. The workspace E2E checks
one mount replay, metadata-only termination checks and a held review-pause reply.

Each canvas terminal shows its connected AI conversation's cumulative tokens to
the right of its title. Claude and Codex counters come from the exact process's
native conversation log, independently of automatic review and without a model
call. They exclude review/analysis tokens and account-wide quotas. Resuming an
existing conversation includes its recorded history; this is not a per-turn
counter. The tooltip gives exact total, input, output and cache counts. Repeated
Claude response blocks are deduplicated; Codex cumulative snapshots replace the
previous snapshot. Cached tokens are included in input once.

Large totals use K/M notation. `—` means the native counter cannot be confirmed
(including unsupported providers/platforms); only an explicit counter reports
zero. A bounded or incomplete Claude log shows `≥` as a lower bound. Counts
survive reload and stopped-record restoration, clear on a new provider process
or conversation, and are removed when the terminal is closed or purged. Narrow
panes keep title and tokens on the first row and actions below.

Token validation: `node scripts/terminal-token-usage-test.js`,
`node scripts/terminal-activity-test.js` and the Electron workspace check cover
native counter ownership, duplicate/cache accounting, separate pane totals,
unknown/zero/partial state, reload, and 220px dark/light header geometry. The UI
check uses scripted activity counters; it never invokes a paid AI provider.

- **⌘/Ctrl T** and the terminal **+** add a terminal to the current panel.
- The sidebar **새 패널** (and the project/independent section `+`) starts a
  separate panel with one terminal. Each panel heading has its own `+` that adds
  a terminal to that exact panel, even when another panel is selected.
- **새 패널** starts a separate panel. **⌘/Ctrl D** and
  **⌘/Ctrl Shift D** split right and down.
- Drag a terminal from the sidebar or its terminal header onto a panel in the
  sidebar or top bar to join it. Drop onto the left, right, top, or bottom of a
  visible terminal to choose the split position. The highlighted region shows
  the destination.
- Drop onto **새 패널 · 여기로 끌어 분리** to move the terminal out into a
  separate panel. A project's drop target can also receive terminals from
  another project. Moving does not change the shell's working directory.
- The trash button beside each sidebar terminal moves it directly to the trash.
  The terminal header's **패널 분리 · 화면 배치** button offers placement controls
  without dragging. Its **X** closes the terminal directly without archiving.

## Viewing several panels together

Drag a terminal or a whole panel card onto a visible terminal to show them
alongside each other. Panels from different projects and independent panels can
share the screen while keeping their existing terminal identities and logical
membership. Click a terminal to type there and view its review. The saved canvas
survives reloads. Use the terminal's **이 터미널만 보기** button to return to one
terminal; separate show-together buttons are no longer displayed.

Switching projects or panels, hiding a terminal, and rearranging splits keep the
same host PTY, renderer buffer, and terminal DOM node. An empty source panel is
removed automatically. Layout and selection are saved for renderer reloads.
Moving to trash first confirms session termination, including foreground programs, before removing the panel. A failed stop leaves the panel visible. Stopped output and review records remain and can be restored read-only; restoration never restarts the previous program or creates a replacement shell. Stopped sessions no longer consume the 32-session active limit. Permanent deletion removes retained records.

Restoring shows immediate progress and disables duplicate actions until the
operation settles. Identity/status is checked without transferring replay; the
terminal mount validates identity again and reads the replay once, with priority
over queued background reads while retaining the two-read concurrency limit.
Restoration does not wait for collaboration or AI review. Mount failure retains
the archive and enables retry without leaving a blank pane. Legacy archive
metadata can restore a confirmed stopped session with the same creation identity;
its old PID is retained only as review provenance.
The trash has an **휴지통 전체 삭제** action: it confirms the current item count before permanently
deleting all trashed sessions. It never targets panel members outside the trash.
If any deletion fails, that item stays in the trash and the result shows the
success/failure counts. The action is disabled when the trash is empty.

Validation: `node scripts/check-source.js` and
`./node_modules/.bin/electron scripts/terminal-workspace-check.js`. The workspace
check uses real shell PTYs, native Chromium drag initiation, directional moves,
cross-project placement, background output, process identity checks, and reload
restoration. It also checks delayed creation/mount feedback, failure rollback,
reconnect without duplicate shells, disclosure arrows, sidebar trash and real shell
exit state. Its review responses are fixtures rather than live model calls.

## Panel control

Panel membership is registered automatically when terminals are added or moved.
There is no collaboration button, setup dialog, or opt-in setting. It never sends setup prompts, adds
agent hooks, modifies model configuration, or starts a replacement agent. Dragging
a terminal changes its current membership without restarting its PTY.

Like cmux, control uses a CLI and a local socket. Whitebox's commands are:

```sh
whitebox identify
whitebox list-panels --json
whitebox close-terminal <terminal-id> --json
whitebox send --surface <terminal-id> "hello"
whitebox send-key --surface <terminal-id> enter
whitebox read-screen --surface <terminal-id> --lines 100
whitebox ask codex "ㅎㅇ"
whitebox wait <returned-job-id> 60
```

`send` pastes text; a trailing newline submits it atomically. `send-key enter`
submits only a matching, unchanged paste made by the same source. AI targets must
be idle with no existing draft or approval prompt. `ask` submits one request and
`wait` returns only its matched completion; reading a screen alone does not prove
completion. An uncertain delivery is never automatically retried.

New shells receive `WHITEBOX_SURFACE_ID`, `WHITEBOX_PANEL_DIRECTORY`, and the
Whitebox CLI on PATH. Older shells resolve their identity from the CLI process's
actual parent ancestry. No working-directory or conversation-peer inference is
used. External automation can select an explicit `--source <terminal-id>`.
Every command resolves the source's **current** panel on the server; other panels
are not valid targets. Provider names resolve only when unique in the panel.

The socket discovery record is `terminal-collaboration/control.json` in the app
profile. It and the Unix socket are private to the local user. Each newline JSON
request supplies the record's token, `id`, `method`, and `params`; responses have
`ok`, `result`, or `error`. Supported methods are `system.identify`, `surface.list`,
`surface.create`, `surface.close`, `surface.read_text`, `surface.send_text`, `surface.send_key`, `surface.ask`, and
`job.read`. This follows cmux's control model; it is not full cmux API compatibility.

`close-terminal` and MCP `whitebox_close_terminal` stop the selected terminal and
remove its pane and saved layout without putting it in trash. Use an exact ID
from `list-panels`, which also lists stopped and orphaned panes. Source authority
still requires a live terminal in the same panel. Self-close and cross-panel
close are rejected. A failed or unconfirmed host removal leaves the pane visible.
The terminal header X uses this direct-close behavior too; the explicit sidebar
trash icon remains available for archiving. Separate “show together” buttons are
removed; drag terminals or panel cards to arrange multiple panels on screen.

The CLI does not teach an already running model new commands silently. Ask it to
use `whitebox list-panels` for a panel task, as with any terminal CLI. No instruction
turn is inserted automatically. Existing models can use the CLI without restart.

`node scripts/terminal-collaboration-test.js` exercises real socket requests and
CLI dispatch with fixture provider sessions: scoped routing, response matching,
draft protection, membership moves, restart, uncertain delivery, and zero setup
writes. It does not itself call live model accounts.

### Verified locally on 2026-10-22

- `node scripts/terminal-collaboration-test.js`: passed.
- `./node_modules/.bin/electron scripts/terminal-workspace-check.js`: passed,
  including real PTY/host/socket CLI send/read, identity environment, native
  Chromium drag, hidden output, and reload persistence.
- `node scripts/terminal-review-test.js`: passed.
- `node scripts/check-source.js`: 302 JavaScript files passed syntax checks.
- Existing Claude terminal `terminal:mviua4jo:17fd7182` used the public CLI to
  list its panel, send `ㅎㅇ` to existing Codex `terminal:mviu5j4n:30736fa5`,
  and wait for the response `ㅎㅇ 😄`. Job
  `a834006a-b5ed-4a01-af50-9daf84cc9a10` completed; the enclosing Claude task
  `7cf08b51-8af7-4c3a-9269-c632ec80be98` completed too. This was a real model
  round trip, explicitly requested as a CLI task, with no setup turn.
- After applying the final app changes, shell PIDs 78247/67401 and provider
  PIDs 78946/77370 were unchanged. The two surfaces still shared panel
  `5a91221a-6991-49ef-83ed-0b6e0859761e`; CLI read-screen returned current output.
  The Codex project has separate pre-existing validation hooks; these were not
  changed by panel control. After the Mac was unlocked, native desktop checks confirmed the sidebar
  hierarchy, both live surfaces, the greeting/reply in both terminals, automatic
  connection status, and removal of the guide-injection button. Switching back
  restored the original working panel while the other panel remained in the
  background. Drag interactions were verified by the Electron test above.

## Automatic understanding and review

Review uses request-scoped conversation records and terminal output. It never
runs a new test or Git/file inspection to verify the work. The first explanation
covers why the work was needed, how it works, and relevant user impact. There is
no separate paid detailed-analysis action. Only missing facts that affect a
requirement's completion appear as outstanding checks.

- A proven mechanical result (for example, a uniquely matched panel delivery
  and reply) is recorded locally with zero analysis tokens. Generic completion
  claims or result counts alone wait for concrete evidence.
- Meaningful intermediate reports and execution results can trigger analysis
  before a long request finishes. Ordinary read traffic and time alone do not.
  Interim explanations never declare the entire request complete. This does
  not depend on BMAD or another development harness.
- `작업 관찰 중`, `분석 대기`, and `분석중` distinguish observation, queued work,
  and an actual model call. There is no separate observed-facts preview. After
  30 seconds an in-flight call shows a delay notice. Model
  completion within 30 seconds is a target, not a guaranteed provider latency.
- Provider conversation/request IDs and actual submissions establish identity.
  Repeated text can be separate requests. A confirmed response to a pending
  question stays with its original request; changed requirements link a new one.
- Interruption preserves the work already recorded. Stopping before any result
  is a local record, not a failed AI task. Late analyses remain attached to the
  original request. Process/terminal changes invalidate in-flight publication.
- Successful evidence digests persist in `terminal-reviews.json` and are not
  billed again on refresh/restart. Failed or interrupted analysis calls require
  an explicit retry unless new evidence arrives. There is no fixed cumulative
  token cap; disabling automatic review stops further calls and publication of
  in-flight results (it does not undo usage already incurred).

Validation for this policy: `node scripts/terminal-review-test.js` covers native
Claude/Codex log ownership, policy decisions, request continuity, long tasks,
interruptions, durable deduplication, late results, and usage. The Electron
workspace check verifies first-analysis content, absence of the paid detail
button, relevant outstanding checks, delay notices without a facts preview, history and actual PTYs.
These analysis tests use model fixtures; live provider latency/quality is not
claimed by them. The existing 556 regression tests also passed locally.

## Provider discovery of panel tools

On macOS/Linux, the app installs pass-through `claude`/`codex` adapters beside
its existing `whitebox` CLI. Inside a live Whitebox terminal, an interactive
provider launch receives an app-owned stdio MCP server exposing panel list,
ask, wait, and read tools. Outside Whitebox, utility commands, nested calls,
and non-interactive executions retain their original arguments. Existing
provider settings, project instructions and authorization settings are not
rewritten. Custom MCP configs are retained. Windows retains its existing CLI
route until a native provider adapter is available.

This addresses a discovery gap: a model's native teammate list does not include
other providers in Whitebox. The MCP descriptions explain which tool to use
for “same panel” requests. The existing scoped socket still checks membership,
process identity, drafts, idle state, and exact reply attribution. No setup
message is submitted to an AI merely by adding or moving a terminal. Existing
running sessions acquire the native tools on a provider launch in a newly created workspace terminal;
they can already use the Whitebox CLI for user-authorized tasks.

New workspace shells prepend the adapter path after the normal login startup
files, so user PATH reordering does not hide panel tools. Existing PTYs are not
restarted or silently given commands to change their environment.


## Update notification in the workspace

The sidebar version row shows an “Update available” badge whenever the existing
updater reports a new release. Clicking it opens the update section in Settings,
which displays running/latest versions, the installed target version when it
differs, last check time, release notes, download progress and check errors.
The existing startup check and 15-minute host timer provide the updates; the
renderer does not add network polling or start installation automatically.
Update events are retained before terminal bootstrap begins so an older
bootstrap snapshot cannot hide a completed check.

The check, release-page and install controls call the existing trusted IPC
handlers. Missing or blocked installers cannot be launched from this UI. The
Electron workspace check exercises these controls with fixture IPC responses,
including cancellation and failure; it does not install a published artifact.
Packaged installer compatibility and release approval still require the full
AGENTS.md updater compatibility gate. No release approval is claimed by the
workspace UI tests.


## Opening more AI terminals (2.0.13)

Inside an existing Whitebox terminal:

```sh
whitebox new-terminal codex --count 3 --json
# For every returned jobs[].id:
whitebox wait <creation-job-id> 30
whitebox list-panels --json
# After the new surface reports provider=codex and ready=true:
whitebox ask <exact-surface-id> 'ㅎㅇ'
whitebox wait <reply-job-id> 30
```

`whitebox_new_terminals` exposes the same operation to panel MCP clients.
Count defaults to one, accepts 1–8, and never replaces an existing terminal.
New PTYs inherit the requesting panel's directory. The renderer adopts each
PTY into that panel before its provider starts, so the provider adapter can
identify its surface and attach Whitebox tools. A completed creation job means
the launch command was delivered; use the live roster's provider and readiness
before asking it to work. Failure, timeout and uncertain delivery are reported
explicitly and never retried automatically. Existing providers can use the CLI;
new interactive provider launches discover the additional MCP tool.

Drag terminal headers or sidebar terminal rows onto the left, right, top or
bottom of another terminal, including one in a different panel. This changes
screen placement and preserves collaboration membership. A window blur during
a native drag does not cancel it; workspace drops take precedence over terminal
content handlers. Explicit “join panel” remains the membership-changing action.

Attention dialogs use a 320px width and at most 420px height (also bounded by
small displays). Long command previews scroll independently. Light and dark
surfaces follow the system appearance, with visible keyboard focus and unchanged
approval/question routing. Design references: affectUI's free MIT Clean
[Notification Stack](https://www.affectui.com/components/notification-stack)
and [Button](https://www.affectui.com/r/button-clean.json). No remote UI is loaded.


Korean input after paste (2.0.13): clipboard insertion ends the prior IME
composition before sending pasted bytes and clears its browser-side selection.
The next Korean composition starts from an empty shadow input. Hangul jamo keys
without composition flags stay with the browser IME, while shortcuts continue
to use terminal key handling. Clipboard text itself is preserved.

Context-menu cleanup may be installed after a fast paste has already restored
the textarea. Its later click cleanup can hide that still-focused textarea at
0×0 with a negative z-index: Latin keydown can continue while native Korean IME
has no usable input anchor. The IME addon observes only textarea style changes
and repairs a hidden focused anchor without waiting for PTY output or a paint.
Keydown/beforeinput/composition start also repair synchronously; focus paints
immediately. The native menu's intentional 1px target is preserved until cleanup,
and inactive panes never reclaim focus. `terminal-ime-check.js` reproduces the
delayed cleanup with the real Ghostty menu handler and checks post-paste Korean
commits, keyless recovery, refocus and background ownership. Chromium CDP tests
exercise browser composition; they do not claim physical macOS/Windows IME
keyboard coverage.
