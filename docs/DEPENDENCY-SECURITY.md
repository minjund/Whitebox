# Dependency security

`npm audit --omit=dev --audit-level=high` is the CI and release workflow gate:
it covers the packages that ship inside the app. Development-only packages
(the packaging toolchain) are not part of the gate since 2.0.36, when
GHSA-fc5q-39xc-vjpf (picomatch ReDoS, every version up to 4.0.7, no patched
release) reached electron-builder 26 through app-builder-lib, node-gyp and
tinyglobby. picomatch runs only at build time on this repository's own file
patterns. Review the full `npm audit` output when the lockfile or packaging
toolchain changes, and restore the full audit gate once a patched picomatch
is available. Electron is pinned to the supported
44.x line (the 2.0.3 lockfile resolves Electron 44.9.3). The 2.0.3 candidate also
updates undici to 7.30.1 / 6.29.1 and fast-uri to 3.1.9 within existing dependency
ranges. Recheck the full audit in candidate CI and the tag release workflow.

Risk is constrained by lockfile-only CI installs, pinned GitHub Actions,
controlled package inputs, isolated build runners, SHA-256-verified internal
artifacts, signed/notarized production artifacts, post-build checks, CodeQL,
and Dependabot. Dependency audit results should be rechecked whenever the
lockfile or packaging toolchain changes.
