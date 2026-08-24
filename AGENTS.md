# Whitebox agent instructions

## Review agents

When the task is a review or audit, lead with actionable findings and cite the
affected file and line. Do not edit files unless the user also asked for a
change. State which checks were actually run; an unexecuted check is not
evidence that the behavior works.

## Updater and release review gate

Apply this gate when a change touches update discovery, release-asset naming or
selection, download verification, installer launch, process shutdown, helper
readiness, relaunch, packaging, versioning, or release workflows. Relevant
paths include `src/update*.js`, update wiring in `main.js`/`preload.js`,
`package*.json`, `build/`, updater integration scripts, and release workflows.

Installed clients and published tags are immutable inputs. Never infer an old
client's behavior from the current source tree. Before approving an
updater-sensitive change, the reviewer must:

1. Build a compatibility matrix from the exact supported installed versions to
   the proposed release. Include every frozen cohort and identify which
   packaged updater implementation each cohort actually contains.
2. Use official published installers pinned by repository, tag, exact filename,
   byte size, and SHA-256. Extract and exercise the updater from the installed
   `app.asar`; a source-only mock or a freshly built old tag is insufficient.
3. Test asset selection against the complete release asset set. Verify the
   trusted URL, exact version and architecture, uploaded state, size, digest,
   canonical automatic installer, compatibility alias, and decoy rejection.
4. Exercise the whole old-client path: release discovery, verified download,
   installer opening, parent shutdown, helper/bootstrap acknowledgement,
   installed EXE and packaged `app.asar` version, renderer-ready signal,
   relaunch, and cleanup. Success and failure markers must be attributed to the
   same fresh run and occur exactly as expected.
5. Exercise the updater packaged in the candidate too. Reinstall the same
   candidate through its automatic path so the new helper handshake and
   relaunch code run; reaching the candidate through an old updater does not
   test the candidate updater.
6. Run the race-sensitive packaged Windows test three times on the exact
   40-character candidate SHA: from the pinned official v1.7.3 and v1.7.4
   frozen installers, then from the pinned official fixed v1.7.5 installer.
   Use fresh install, download, log, ready-signal, and profile directories for
   every attempt. Run all three again in the tag release workflow before
   publishing.
7. After publication, verify the unauthenticated live `latest` API, public asset
   `HEAD` responses, names, sizes and digests, draft/prerelease state, and the
   legacy-to-current selection model. Canonical and manual aliases must contain
   identical verified bytes.

Known compatibility cohorts currently include:

- LoadToAgent 1.6.3-1.6.22 -> immutable 1.6.23 bridge -> current Whitebox.
- Whitebox 1.7.3 and 1.7.4 -> manual installer alias that bypasses their frozen
  shared ready-file race.
- Whitebox 1.7.5 and newer -> canonical automatic installer handshake.

If cohorts are claimed to share updater behavior, prove that from their
official packaged `app.asar` files and record the comparison. Do not rely only
on a tag-to-tag source diff.

The review must remain fail-closed. Missing official artifacts, unavailable
Windows E2E, an untested supported cohort, a timeout, an ambiguous process
identity, or missing cleanup evidence is a release blocker, not a conditional
approval. A historical exception is allowed only when it is narrowly encoded
for an immutable client and all documented success, version, relaunch, and
cleanup invariants still pass. Never make a timeout or generic fallback count
as success.

An approval must include the reviewed commit SHA, compatibility matrix, exact
commands or Actions run URLs, both packaged Windows E2E results, and live-channel
result when a release was published. Unit tests, a successful build, or a clean
install of only the target version cannot by themselves justify approval.

The always-created `Updater compatibility gate` check is the stable merge
gate. A non-sensitive diff may make its heavy Windows job an explicit N/A, but
the final check itself must exist and pass. Updater-sensitive changes require
the v1.7.3, v1.7.4, and v1.7.5 packaged attempts; a skipped, cancelled, or
missing heavy job is a blocker. Repository rules must require this exact check
on `main`.
