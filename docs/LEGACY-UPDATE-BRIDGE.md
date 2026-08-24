# Legacy update bridge

Whitebox versions 1.6.3 through 1.6.22 only trust release assets whose URL is
under `minjund/LodeToAgent`. GitHub repository redirects return canonical
`minjund/Whitebox` asset URLs, so those installed binaries cannot download a
current release directly.

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
helper-ready file. If the app wins that race, the bootstrap can time out after
the silent NSIS child has already started. The integration accepts only that
exact historical timeout from the same fresh helper log, requires exactly one
successful installer exit (`exitCode=0`) with no install, version, or relaunch
failure marker, then requires both the installed EXE and packaged `app.asar` to
report 1.6.23 before reopening the updated app. In that case the user may need
to start LoadToAgent once more, but never needs to download or run an installer
manually. Every other first-hop failure remains fatal.

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
