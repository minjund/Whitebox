# 1.8.9 integration inventory

Integration base: `d60c7e5` (`origin/main`, 2026-09-08).

All 15 registered worktrees were inspected. Only the current working directory
and the historical 1.7.7 worktree had uncommitted changes. Both were committed
and pushed before integration. The eight other detached heads already reachable
from main require no content merge.

| Source | Integration treatment |
| --- | --- |
| `codex/sidebar-history-1.8.8`, `3c062cb` | Current attention popup, monitor, layout, and Korean IME changes merged in full. |
| `codex/integrate-focus-cohort-1.8.9`, `835b50c` | Patch-equivalent to main (`git cherry`); retain current cohort metadata. |
| `codex/integrate-release-1.7.13`, `f0242ed` | Patch-equivalent to main; retain current version and cohort metadata. |
| `codex/integrate-actual-pty-1.8.9`, `bf50891` | Patch-equivalent historical 1.6.13 release; retain current release metadata. |
| `codex/integrate-pty-focus-1.8.9`, `5bbed31` | Entire file tree equals `00330cc`, already an ancestor of main. Retain the later PTY implementation. |
| `codex/integrate-release-1.7.15`, `0207be2` | Patch-equivalent to main; retain subsequent right-drawer and PTY changes. |
| `codex/integrate-tmux-interaction-1.8.9`, `f6324d5` | Underlying `1b5ca22` tmux fix is present as `43d1f03`. Retain newer tests and port its uncommitted real screen-click check to `ptyFocusTerminalViewport`. The retired drawer fixture setup is superseded by `prepareProject`. |

The integration uses merge commits so each saved branch and detached source
head remains reachable. No historical branch or worktree is deleted.

## Required updater checks

The version bump requires the existing `Updater compatibility gate` before
main integration. Installer names, URLs, sizes, and SHA-256 pins are in
`scripts/update-compatibility-cohorts.json` and
`scripts/check-update-compatibility-cohorts.js`; the legacy pins are in the
compatibility workflow. The unauthenticated public latest API was checked
against the official 1.8.8 installer before updating `previousFixed`.

| Installed source | Candidate route |
| --- | --- |
| Official 1.7.3, 1.7.4 | Verified manual alias, frozen-race compatibility path |
| Official 1.7.5 | Canonical automatic installer |
| Official 1.8.1, 1.8.4, 1.8.5, 1.8.6, 1.8.7, 1.8.8 | Canonical automatic installer |
| Official LoadToAgent 1.6.3 | Immutable official 1.6.23 bridge, then candidate |
| Candidate | Automatic self-reinstall, helper readiness, relaunch and cleanup |

This inventory is not an updater approval or a test result. Use the PR's
exact-SHA packaged Windows workflow logs for execution evidence. A missing or
failed required check blocks main integration. Publishing a release additionally
requires the tag workflow and post-publication live-channel checks.
