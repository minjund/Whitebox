# Update workload scope in 1.8.13

Updating an installed Whitebox now checks the terminal host's executable and
launch script against that installation. On Windows, the packaged native helper
reads the exact process through WMI, and the client authenticates the host between
two process-identity samples. A changed, incomplete, or unavailable identity
blocks the attempt. The probe does not depend on PowerShell.

An external development host is kept running. Whitebox disconnects its own
client, blocks further client requests during installation, and does not send
the external host a shutdown command, including during normal app quit.
Paths are canonicalized to account for directory aliases. A development Electron
loading the installed app's script is still treated as belonging to that install.

Within the installation's own host, update shutdown considers current runtime
handles, current-host launches, and retained termination contexts. A restored
record without current-host ownership can continue protecting against duplicate
agent resumes without blocking an application update. Such records are retained;
they are not marked successfully terminated, and their saved PIDs are not killed.
Managed tmux connections are detached while their independent tasks continue.

If owned terminal cleanup fails, a native dialog offers cancellation or an
explicit force-stop retry. Cancellation is the default. A force retry uses the
retained process handle and generation, waits for any in-flight transition,
and verifies termination before opening the installer. Ambiguous identities,
an exited root with an unconfirmed tree, verification failures, and timeouts
cannot be converted into successful shutdown.

## Compatibility matrix for the release gate

| Official installed input | Path to 1.8.13 | Packaged implementation evidence |
| --- | --- | --- |
| LoadToAgent 1.6.3–1.6.14, 1.6.16–1.6.22 | Immutable official 1.6.23 bridge, then Whitebox | The 19 official package comparisons and pins in `UPDATE-COMPATIBILITY-AUDIT-2026-08-24.md`; v1.6.15 was never published |
| Whitebox 1.7.3 | Manual compatibility alias | Official pinned app.asar exercised by frozen-client E2E |
| Whitebox 1.7.4 | Manual compatibility alias | Official pinned app.asar exercised separately by frozen-client E2E |
| Whitebox 1.7.5 | Canonical automatic installer | Official pinned app.asar exercised separately by frozen-client E2E |
| Whitebox 1.7.6, 1.7.8, 1.7.9, 1.7.11–1.7.16, 1.8.1–1.8.12 | Canonical automatic installer | Each official installer in `cohortList()` is individually pinned and exercised; no equivalence is assumed from source tags |
| Candidate 1.8.13 | Reinstall itself automatically | Candidate app.asar handshake plus actual packaged button: cancel, retry, force-stop a real owned PTY, install, relaunch, cleanup |

The gate now exercises all 24 published official Whitebox installers from 1.7.3
through 1.8.12. Versions 1.7.7, 1.7.10, and 1.8.0 have no public release installer.
No installed implementation is inferred from a freshly built old source tag.
The 1.8.12 `previousFixed` attestation pins `Whitebox-Setup-1.8.12.exe`,
85,355,105 bytes, SHA-256
`1f7a96730e597c63871db5e28025b67cbddca0d798932380ed983c044bd41a86`.

## Verification

Local checks cover ownership classification, identity changes, restored records,
retained uncertainty, default cancellation, force failure, installer verification,
external-host preservation, actual Windows PTY exit, and the packaged native helper.
The frozen-client Actions gate and tag workflow must execute their full pinned
matrix, candidate self-reinstallation, and official legacy bridge path. This
document is not approval before those checks finish. Final SHAs, run URLs, and
public-channel verification are recorded with the release review.

Existing installed clients do not acquire the new update behavior until replaced.
An already blocked client may require the published installer once.

The Windows process fields come from Microsoft's
[Win32_Process definition](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process).
