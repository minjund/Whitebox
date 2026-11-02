# 2.0.12 packaged updater validation

The supported Windows source list now includes official 2.0.11. Its immutable
installer is `minjund/Whitebox`, tag `v2.0.11`, file
`Whitebox-Setup-2.0.11.exe`, 95,385,533 bytes, SHA-256
`b077c05bc34e0a17053400c99049c6e1709632e01b28cfeae194f4efd4549a4f`.
Fresh extraction yields `resources/app.asar` SHA-256
`4f34656236bf9f79ecf7887c7454d18090275f288a7d1cf35fe53aa97a5f7633`.

The initial PR run [41412671031, cohort-1](https://github.com/minjund/Whitebox/actions/runs/41412671031/job/125171019064)
failed after helper acknowledgement: closing the source window did not exit the
parent within 30 seconds. This is a failed attempt, not compatibility evidence.

Inspection of that official packaged `main.js` confirms that window close hides
the window while startup terminal sessions remain active. Capture mode uses an
in-process terminal manager, which cannot be prepared through the authenticated
terminal-host fixture. The existing explicit source list through 2.0.10 omitted
2.0.11. Extend that same low-level idle-parent fixture to the pinned official
2.0.11 source, and assert its packaged tray/terminal-manager policy before use.
The fixture uses the production host, closes only identified workspace startup
shells within the fresh isolated roots, waits for each actual shell exit, and
asserts no active sessions remain before the unchanged graceful-close deadline.

This preparation does not approve a release. All packaged source and candidate
self-reinstall assertions, live-PTY update-button preservation, helper readiness,
installed versions, renderer readiness, relaunch and cleanup checks remain
required. The complete fresh PR, final-main and tag runs must pass; no prior
partial successes or timeouts are accepted as success.
