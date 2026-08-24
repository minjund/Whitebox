## Verification

- [ ] I ran the relevant source, regression, integration, packaging, and security checks.
- [ ] I added or updated regression coverage for the changed behavior.
- [ ] I recorded checks that could not be run; an unexecuted check is not marked as passed.

## Updater/release changes only

- [ ] Not applicable, or I listed every supported installed-client cohort and its target path.
- [ ] I used official published installers pinned by filename, size, and SHA-256 and exercised the updater extracted from packaged `app.asar`.
- [ ] The pinned official v1.7.3, v1.7.4, v1.7.5, and v1.6.3 -> immutable v1.6.23 bridge packaged E2E attempts passed on the exact reviewed SHA, and all four run again in the tag workflow.
- [ ] The always-created `Updater compatibility gate` check exists and passed; a required heavy job was not skipped or cancelled.
- [ ] The old-client path and the candidate's own same-version automatic reinstall/relaunch path both passed with strict cleanup evidence.
- [ ] After publication, the unauthenticated live channel, public asset sizes/digests, `latest` state, and canonical/manual byte equality passed.

Updater-sensitive approval rules and required evidence are defined in `AGENTS.md` and `docs/RELEASING.md`.
