## Verification

- [ ] I ran the relevant source, regression, integration, packaging, and security checks.
- [ ] I added or updated regression coverage for the changed behavior.
- [ ] I recorded checks that could not be run; an unexecuted check is not marked as passed.

## Updater/release changes only

- [ ] Not applicable, or I listed every supported installed-client cohort and its target path.
- [ ] I used official published installers pinned by filename, size, and SHA-256 and exercised the updater extracted from packaged `app.asar`.
- [ ] Both fresh Windows packaged E2E attempts passed on the exact reviewed SHA, and the final `main` run passed before tagging.
- [ ] The old-client path and the candidate's own same-version automatic reinstall/relaunch path both passed with strict cleanup evidence.
- [ ] After publication, the unauthenticated live channel, public asset sizes/digests, `latest` state, and canonical/manual byte equality passed.

Updater-sensitive approval rules and required evidence are defined in `AGENTS.md` and `docs/RELEASING.md`.
