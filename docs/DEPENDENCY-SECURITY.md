# Dependency security

`npm audit --audit-level=high` is the release workflow gate. The current
lockfile also passes the full `npm audit` with zero known production or
development dependency vulnerabilities. Electron is pinned to the supported
44.x line (the 2.0.3 lockfile resolves Electron 44.9.3). The 2.0.3 candidate also
updates undici to 7.30.1 / 6.29.1 and fast-uri to 3.1.9 within existing dependency
ranges. Recheck the full audit in candidate CI and the tag release workflow.

Risk is constrained by lockfile-only CI installs, pinned GitHub Actions,
controlled package inputs, isolated build runners, SHA-256-verified internal
artifacts, signed/notarized production artifacts, post-build checks, CodeQL,
and Dependabot. Dependency audit results should be rechecked whenever the
lockfile or packaging toolchain changes.
