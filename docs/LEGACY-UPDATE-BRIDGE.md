# Legacy update bridge

Published Whitebox versions 1.6.3-1.6.14 and 1.6.16-1.6.22 only trust release
assets whose URL is under `minjund/LodeToAgent`. Version 1.6.15 was never
published. GitHub repository redirects return canonical `minjund/Whitebox`
asset URLs, so those installed binaries cannot download a current release
directly.

The recovery channel is intentionally two-step:

1. `minjund/LodeToAgent` serves `v1.6.23` with only
   `LoadToAgent-Setup-1.6.23.exe`.
2. The bridge keeps the old app ID, product name, executable name, NSIS GUID,
   and artifact name, so the frozen 1.6.3 installer can replace and relaunch it.
3. The bridge contains the current updater, which trusts the Whitebox channel
   and immediately offers the latest Whitebox release.

Build and verify the immutable Windows bridge with:

```powershell
npm run dist:win:legacy-bridge
$env:WHITEBOX_ALLOW_UNSIGNED = 'true'
npm run test:artifacts:win:legacy-bridge
```

The manual bridge workflow installs the immutable historical v1.6.3 installer
and a pinned current Whitebox installer (both verified against their SHA-256
digests). It executes the updater helper extracted from the installed v1.6.3
package, requires the bridge's legacy relaunch handshake, then executes the
helper extracted from the installed bridge and requires the current Whitebox
relaunch handshake before exposing the bridge artifact for download.

The frozen v1.6.3 bootstrap and app process both watch and remove the same
helper-ready file. If the bootstrap acknowledges first, the integration
requires the official helper's exact eight-line raw success log: `helperStarted`,
`exitCode=0`, the exact v1.6.23 `candidate` and `relaunchPath`, followed by the
attempt-one `relaunchStarted`, `windowRestored`, `rendererReady`, and
`relaunchReady` records bound to one authenticated PID and a positive window
handle. The official v1.6.3 source has no `allAppProcessesStopped=true` marker;
that omission is accepted only for this fully pinned path after the parent and
installer exit, v1.6.23 EXE and `app.asar` stabilize, the native profile is
proven, and all helper/bootstrap/ready artifacts self-delete.

If the app wins the ready-file race, the bootstrap can terminate the helper at
any complete boundary of the eight official helper lines. The only timeout
grammar is an exact non-empty prefix followed by the literal 10-second
`bootstrapError`; the only natural-exit race grammar is all eight lines followed
by the exact code-zero bootstrap error. BOM, CRLF, order, parent PID, path,
version, relaunch PID, and window handle are exact. Every nonzero, duplicate,
retry, recovery, stopping, or otherwise extra line remains fatal.

`Start-Process` occurs between the logged `relaunchPath` and `relaunchStarted`,
so a four-line prefix does not prove that no app was launched. The integration
allows reopening only after no installed process, final or temporary signal
exists and the owned native profile is still marker-only. At the four-line gap,
all four absence conditions must remain stable for at least five seconds;
otherwise the same-run compact renderer JSON is required to authenticate the
main PID, exact executable, process ancestry, creation time, exact captured
helper direct parent, positive live window equal to any helper-recorded handle,
and native profile. Partial logged
relaunches require that JSON; a complete `relaunchReady` trace may have already
self-deleted it, but its exact 48-hex token and direct-child path remain
mandatory. Exact owned helper or authenticated renderer residue is removed
one file at a time, while bootstrap, ready, and temporary files must already be
absent and stay absent. Missing identity, signal, cleanup, or stable package
evidence is fatal; the 10-second timeout is never success by itself. A verified
fallback may require the user to start LoadToAgent once more, but never to
download or run an installer manually.

Run that workflow only from the fully reviewed commit, passing its complete
40-character commit SHA as `source_sha`. Keep the Actions run summary with the
artifact: it records both that source commit and the exact installer SHA-256.

Create the public `minjund/LodeToAgent` compatibility repository, then enable
GitHub release immutability in that repository **before creating v1.6.23**.
Create a protected `legacy-update-bridge` Actions Environment with required
reviewers. Store the scoped `LEGACY_RELEASE_TOKEN` as an Environment secret,
not a repository-level secret; it needs repository-administration read access
and release-content write access only in the compatibility repository. Run the
bridge workflow with the audited `source_sha` and `publish_bridge: true`.

The build job passes both installer hops without access to the release token.
A fresh, Environment-approved runner downloads that exact Actions artifact,
rechecks its digest without executing repository code, creates a draft from the
same EXE, compares GitHub's asset digest, publishes it, and requires
`immutable: true`. A third token-free job then exercises the public two-hop
channel. The workflow refuses to replace an existing `v1.6.23`. Keep that
repository and release available permanently, and never publish a newer stable
release there.

Do not add Whitebox installers, portable files, checksums, or any other release
assets: the frozen old selector must see exactly one unambiguous desktop asset.
After publication, confirm GitHub's immutable release attestation:

```powershell
gh release verify v1.6.23 --repo minjund/LodeToAgent
```

After publishing, verify both hops against the live GitHub APIs:

```powershell
npm run check:update:legacy
```

The weekly `Legacy Update Channel Canary` repeats that unauthenticated API and
asset check so deleting, privatizing, or superseding the compatibility release
cannot go unnoticed until the next Whitebox release.

Creating the compatibility repository removes GitHub's old-name redirect.
Its README must point source users to `minjund/Whitebox`; the compatibility
repository exists only to keep already-installed desktop clients recoverable.
