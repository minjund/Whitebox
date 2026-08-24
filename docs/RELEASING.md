# Releasing

The current `package.json` distribution channel is `internal`, so tag builds
may publish unsigned desktop artifacts for controlled testing. Windows and
macOS in-app updates still require an exact trusted GitHub Release URL,
filename, size, and SHA-256 digest before the internal unsigned exception is
used.

Before changing the channel to production, configure these GitHub Actions
secrets and restore fail-closed credential and post-build signature gates:

- `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD`: Windows code-signing
  certificate and password accepted by electron-builder.
- `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD`: Developer ID Application
  certificate and password.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`: Apple
  notarization credentials.

Set repository variable `PUBLISH_NPM=true` only after npm Trusted Publishing is
configured for this repository and workflow.

The tag must exactly match `package.json`, for example `v1.4.0`. The workflow
performs source checks, regression and accuracy tests, production dependency
audit, and desktop integration tests. Artifacts are first attached to a draft
GitHub release. npm is then published and verified when enabled; the GitHub
release becomes public only after those gates succeed.

## Updater compatibility review contract

This section is normative for release reviewers and review agents. Apply it to
changes in update discovery, asset selection, download verification, installer
launch, process/helper readiness, relaunch, packaging/version metadata, or
release workflows.

Published clients must be reviewed as immutable binaries. Build a matrix of all
supported installed cohorts and the proposed target. The current known cohorts
are LoadToAgent 1.6.3-1.6.22 through the immutable 1.6.23 bridge, frozen
Whitebox 1.7.3/1.7.4 through the manual installer alias, and fixed Whitebox
1.7.5+ through the canonical automatic installer. If two versions are treated
as equivalent, compare the updater files extracted from each official packaged
`app.asar` byte for byte and retain that evidence.

The `Windows v1.7.3 Update Compatibility` workflow automatically runs for
updater-sensitive pull requests and pushes to `main`. It builds the exact event
SHA, downloads the pinned official installer, verifies its filename, size and
SHA-256, and runs the packaged two-hop scenario twice with fresh state. For an
otherwise unmatched release change, dispatch it manually with the complete
40-character candidate SHA. Both attempts must pass on the reviewed candidate,
and the workflow must pass again on the final `main` commit before tagging.

The packaged scenario must prove both halves of the contract:

1. The official frozen client selects and opens the verified compatibility
   alias without entering its racy automatic bootstrap, then installs the
   candidate with the expected version in both the EXE and `app.asar`.
2. The updater extracted from that installed candidate uses the canonical Setup
   asset, acknowledges its bootstrap before shutdown, reinstalls the same
   candidate, restores a renderer-ready window exactly once, and removes its
   helper, bootstrap, PID sidecar, ready, download, and log artifacts.

Do not approve on a source-only simulation, a target-only clean install, or an
allowed timeout. Missing official artifacts, an untested supported cohort,
ambiguous process cleanup, or either failed/retried packaged attempt blocks the
release. Any exception for an immutable historical client must name the exact
accepted marker and still require installer success, installed-version,
relaunch, and cleanup evidence from the same fresh run.

After the release becomes public, run:

```powershell
$env:EXPECTED_CURRENT_TAG = 'vX.Y.Z'
npm run check:update:legacy
```

Also confirm that the release is `latest`, not draft or prerelease, and that the
public canonical Setup and manual alias have the same size and SHA-256 digest.
The release review record must include the exact commit SHA, compatibility
matrix, Actions run URLs, and live-channel output. See `AGENTS.md` for the
review-agent verdict rules.

If a job fails, fix the cause and rerun the same workflow. Do not replace a
version already published to npm or overwrite an existing tag's artifacts.
