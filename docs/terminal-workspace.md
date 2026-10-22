# Terminal workspace panels

The terminal workspace groups live terminals into panels. Each project has its
own panels; **독립 패널** holds panels outside a project. The sidebar shows a
miniature split layout, each terminal's identity, and whether it is visible,
running in the background, or exited.

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
- The **터미널 이동** button beside each terminal offers the same placement
  controls without dragging. It also offers moving the terminal to the trash.

Switching projects or panels, hiding a terminal, and rearranging splits keep the
same host PTY, renderer buffer, and terminal DOM node. An empty source panel is
removed automatically. Layout and selection are saved for renderer reloads.
Explicit permanent deletion still ends the terminal process. The trash has an
**휴지통 전체 삭제** action: it confirms the current item count before permanently
deleting all trashed sessions. It never targets panel members outside the trash.
If any deletion fails, that item stays in the trash and the result shows the
success/failure counts. The action is disabled when the trash is empty.

Validation: `node scripts/check-source.js` and
`./node_modules/.bin/electron scripts/terminal-workspace-check.js`. The workspace
check uses real shell PTYs, native Chromium drag initiation, directional moves,
cross-project placement, background output, process identity checks, and reload
restoration. Its review responses are fixtures rather than live model calls.

## Panel control

Panel membership is registered automatically when terminals are added or moved.
There is no collaboration button, setup dialog, or opt-in setting. It never sends setup prompts, adds
agent hooks, modifies model configuration, or starts a replacement agent. Dragging
a terminal changes its current membership without restarting its PTY.

Like cmux, control uses a CLI and a local socket. Whitebox's commands are:

```sh
whitebox identify
whitebox list-panels --json
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
`surface.read_text`, `surface.send_text`, `surface.send_key`, `surface.ask`, and
`job.read`. This follows cmux's control model; it is not full cmux API compatibility.

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
