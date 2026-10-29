# Terminal workspace cleanup

The application entry point is `renderer/index.html` with `data-workspace="terminal"`.
The previous bootstrap returned before creating its dashboard, but the HTML,
factory scripts and layered styles were still loaded. These unreachable surfaces
have now been removed instead of remaining hidden behind a workspace guard.

## Removed

- Monitoring dashboard, agent graph, task drawer, old task composer, questionnaire
  inbox/settings and command-palette HTML and factories.
- Old inline-agent mounting/resume/fork frontend, single-selected-terminal UI,
  tmux capture frontend, cmux sidebar and old terminal-group view.
- Dashboard CSS bundle and its layered styles. The workspace now has explicit
  document primitives, terminal-engine CSS and its three current style sheets.
- Unused renderer helpers, dashboard observation translations and packet quiz UI.
- Development screenshots, interaction fixtures and tests targeting those retired
  surfaces. Current README translations describe projects, panels, terminal
  review, settings and paged attention requests.

The old renderer depended on 53 scripts and 41 stylesheet requests (including
imports). The current entry point has 20 scripts and 5 stylesheet requests.
It also no longer builds a hidden second application DOM.

## Retained and why

- PTY host/manager, ordered delivery IDs and backpressure, Unicode hydration,
  output sequence reconciliation, viewport retention, native IME and resize.
- Session/process readers and provider adapters: request-scoped review, native AI
  completion and exact attention targeting depend on these backend components.
- Review providers including Jev, encrypted key storage/reveal, review history,
  panel collaboration and the paged popup.
- Legacy contract **decoding** for retained terminal replay. No quiz surface is
  created by this codec. Backend compatibility and persistence tests remain.
- Profile migration, updater implementation, frozen installers/cohort receipts,
  release configuration and published-client compatibility. These are not dead
  code simply because they support earlier installed versions.

## Validation entry points

- `npm run check:source`
- `npm test`: backend regressions, execution detection, workspace source/asset
  contracts, update lifecycle guards and real ASAR cleanup.
- `npm run test:workspace`: real PTY creation/input/Unicode, panel and cross-project
  layout, identity persistence, resize, settings/Jev state, activity indication,
  review ownership, collaboration and exact popup responses.
- `npm run test:terminal:engine`, `npm run test:terminal:ime`
- `npm run test:attention-popup`
- `npm run test:performance`: monitor/cache workloads and input dispatch with
  sixteen terminal views. This replaces the dashboard benchmark.
- `npm run check:package`

The former dashboard tests were retired with their production targets; shared
backend, input/output safety and terminal lifecycle tests were retained. The
current source contract verifies script/CSS/font resolution, CSP, accessibility,
module order, absence of the second application and valid npm script targets.

For existing CI callers, `test:result-review`, `test:drawer-conversation` and
`test:drawer-actual-pty` now run current request review, terminal-engine and
workspace-to-popup PTY integration tests. No release workflow is removed.

## Activity presentation

Working terminals show a rotating ring in the sidebar and pane header. A confirmed
native AI answer becomes a static green dot. The backend activity state remains
`idle` and has an additional presentation-only `completed` boolean, so this visual
change does not authorize delivery or claim the task itself succeeded. Bare idle
shells, interrupted turns, stale process identities and failed probes cannot
produce a completion dot. Reduced-motion settings disable rotation.

## Replay pressure and stalled transport recovery

Restoration now hydrates visible panes first. Previously opened background panes
remain available, while unopened restored panels allocate a view when selected.
Replay reads are shared per terminal and limited to two concurrent requests; a
verified mount snapshot is reused instead of fetching it twice. Prompt detection
reuses raw replay captured during mounting and appends sequenced output to a
bounded cache. Missing output sequences or lifecycle changes invalidate it.
Raw replay preserves prompt matching across visual line wrapping. Its startup scan waits until the workspace is ready.

A timed-out host request previously left its open socket marked connected. Later
requests could remain stuck on that transport indefinitely. The client now drops
that exact socket and reconnects, without automatically replaying the timed-out
operation. A timeout from an old socket cannot disconnect a replacement. This
change preserves the fail-closed behavior for unconfirmed input and updates.

## Release scope

This is a local source cleanup and feature change, not a release approval. Only
npm test-script wiring changes in `package.json`; version, dependency versions,
packager configuration, installer selection and release workflow stay unchanged.
The official packaged Windows cohort gate and live published-channel checks must
still be completed before any updater-sensitive release is approved.

## Local verification (2026-10-29, macOS)

- Source syntax: 253 JavaScript files passed.
- `npm test`: 416 registered regressions, 7 execution-detection cases, source/asset
  contracts, update lifecycle guards and real ASAR cleanup passed.
- `test:workspace`, terminal engine, IME, attention popup and package-content
  checks passed. The background-shell popup path still validates exact PTY
  ownership, stale output rejection, answered-request removal and settings.
- Latest sixteen-terminal input benchmark: P95 dispatch 0.4 ms; unchanged buffer
  reads and input animation-frame waits were zero. This is fixture performance,
  not a guarantee for every machine or provider.
- The source app was restarted with the original profile. All 25 previously
  observed workspace sessions retained their PID and creation identity. The live
  renderer was ready, loaded 20 scripts with no old app shell, and the final
  startup log had no terminal IPC errors.
- Official packaged Windows updater cohorts and live published-channel checks
  were not run. No release approval or publication is claimed.
