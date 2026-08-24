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
release becomes public only after those gates succeed. The draft must contain
exactly the expected platform artifacts; every downloaded draft asset must be
byte-identical to its verified build artifact, and the canonical Windows Setup
and frozen-client manual alias must be byte-identical before npm publication.

## Updater compatibility review contract

This section is normative for release reviewers and review agents. Apply it to
changes in update discovery, asset selection, download verification, installer
launch, process/helper readiness, relaunch, packaging/version metadata, or
release workflows.

Published clients must be reviewed as immutable binaries. Build a matrix of all
supported installed cohorts and the proposed target. The current known cohorts
are published LoadToAgent 1.6.3-1.6.14 and 1.6.16-1.6.22 through the immutable
1.6.23 bridge, frozen Whitebox 1.7.3/1.7.4 through the manual installer alias,
and fixed Whitebox 1.7.5+ through the canonical automatic installer. Version
1.6.15 was never published and therefore is not an installed cohort. If two
versions are treated as equivalent, compare the updater files extracted from
each official packaged `app.asar` byte for byte and retain that evidence.

The `Windows Frozen-Client Update Compatibility` workflow creates the stable
`Updater compatibility gate` check on every pull request and push to `main`.
It classifies the complete event diff before any path filtering. A non-sensitive
diff records an explicit N/A success; a sensitive diff builds the exact event
SHA, downloads the pinned official v1.7.3, v1.7.4, and v1.7.5 installers,
verifies each filename, size and SHA-256, and runs the packaged scenario once
from every cohort with fresh state. It also verifies and executes the official
v1.6.3 installer and immutable official v1.6.23 bridge as the representative
full legacy path; all 19 published LoadToAgent packages were separately proven
to contain byte-identical channel, trust, selector, and automatic-name logic.
For an otherwise unmatched release change, dispatch it manually with the
complete 40-character candidate SHA. Repository rules must require the stable
final check, and all four packaged attempts must run again in the tag release
workflow before a draft can be published.

The packaged scenario must prove all parts of the contract:

1. Each official frozen client selects the verified compatibility alias without
   entering its racy automatic bootstrap. CI stubs the OS installer-open call
   to prove the packaged updater chose that exact alias, closes the old client,
   then silently invokes the same verified bytes and checks the installed EXE
   and `app.asar` version.
2. The updater extracted from official fixed v1.7.5 selects canonical Setup and
   completes the authenticated automatic helper/bootstrap path to the candidate.
3. The updater extracted from the installed candidate selects canonical Setup,
   acknowledges its bootstrap before shutdown, reinstalls the same candidate,
   and restores a renderer-ready window exactly once. The helper must remove
   its helper, bootstrap, PID-sidecar, and ready-signal files; the harness must
   prove no tracked process remains and remove its isolated download, log, and
   profile state.
4. The immutable v1.6.3 launcher starts the installed v1.6.23 bridge without a
   profile argument, so Chromium resolves that one relaunch through the native
   Windows roaming `Whitebox` directory. This historical exception is valid
   only on a disposable GitHub-hosted runner after `Whitebox`, `loadtoagent`,
   and `LoadToAgent` are all proven absent. The harness must re-pin both
   official installers, create the exact `Whitebox` child with a fresh
   `.whitebox-integration-owner-<48 lowercase hex>` marker, require an exact
   canonical `--user-data-dir` reference plus non-marker app data, and then
   prove the installed process tree and every profile-referencing process have
   exited before deleting that owned child. The native roaming root and any
   unowned profile must never be deleted, and all three candidate paths must be
   absent at the end of the same run.
5. The immutable v1.6.3 ready-file race can force-terminate its helper after a
   verified successful bridge installation and thereby bypass that helper's
   final self-delete. Only for that exact official first hop, the harness may
   unlink the owned `first-hop-downloads/install-update.ps1` after proving the
   installed EXE and `app.asar` are v1.6.23, helper and bootstrap process
   references are zero, the frozen bootstrap-race log is exact and stable, the
   path is a real non-link direct child of the fresh attempt, and its size and
   SHA-256 match `BOM + official packaged v1.6.3 helper source`. All tracked
   artifacts must then be absent before the authenticated fallback relaunch.
   A timeout, mismatched file, unowned path, or any other fallback must remain
   a release failure.

Do not approve on a source-only simulation, a target-only clean install, or an
allowed timeout. Missing official artifacts, an untested supported cohort,
ambiguous process cleanup, a missing/skipped stable merge check, or any
failed/retried packaged attempt blocks the release. Any exception for an
immutable historical client must name the exact accepted marker and still
require installer success, installed-version, relaunch, and cleanup evidence
from the same fresh run.

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
