# Update compatibility audit: 1.7.6

This record pins the immutable inputs used for the 1.7.6 updater review. It is
not a substitute for the exact-SHA packaged Windows Actions gate or the live
post-publication channel check.

## Published LoadToAgent cohorts

Repository: `minjund/Whitebox`. Every installer below was downloaded from the
named public release, checked against the GitHub asset API, extracted, and
matched to the version in its packaged `app.asar`. Version 1.6.15 has no tag or
release and therefore is not an installed cohort.

| Tag | Official installer | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| v1.6.3 | `LoadToAgent-Setup-1.6.3.exe` | 92,488,826 | `e38c38698335c2eec4aef8c6da6f1629470addaff1b881fe961172644c86db0f` |
| v1.6.4 | `LoadToAgent-Setup-1.6.4.exe` | 92,488,530 | `5455eab47a5a6596e7b7fef54e0f9e4ad86787ee92c4db18a6ac6fff61daa3dd` |
| v1.6.5 | `LoadToAgent-Setup-1.6.5.exe` | 92,499,267 | `208e1759fbbbcd671aaca63caca325c301ae0f400287b1953e6e1bf03cc85a73` |
| v1.6.6 | `LoadToAgent-Setup-1.6.6.exe` | 92,509,373 | `37b069e7f38c59661c1d7aa9be42b5355f340e2657d8661405f89699838fb515` |
| v1.6.7 | `LoadToAgent-Setup-1.6.7.exe` | 92,510,912 | `2624070bc566332bf52ac742137ad0665ec8660d2daea8444d791a311957727f` |
| v1.6.8 | `LoadToAgent-Setup-1.6.8.exe` | 92,516,194 | `1ea0d646fb21170b3073efb8ae1ec559c5ed0b204d2a49eb71ca8ff9ec537807` |
| v1.6.9 | `LoadToAgent-Setup-1.6.9.exe` | 92,527,075 | `6eae9d195d0026cd7a682b1d3c45a2a7bc2dbe7a4d2b3100bb9fdc0acd33fecc` |
| v1.6.10 | `LoadToAgent-Setup-1.6.10.exe` | 92,530,465 | `df5a5e2d1f3ef19886b96e124e6ebf7bf26a16089ef04b62164b65d5552fea66` |
| v1.6.11 | `LoadToAgent-Setup-1.6.11.exe` | 92,533,169 | `bc21a3f5b16c6ca4df761f8bb0018556ecbd09a1e1e6bffeeb5f9c6e35f9080a` |
| v1.6.12 | `LoadToAgent-Setup-1.6.12.exe` | 92,571,941 | `33cbd805a84e258db869da7c87d07b6a89c48f17c045081fe1ac771e61993463` |
| v1.6.13 | `LoadToAgent-Setup-1.6.13.exe` | 92,572,463 | `4fab2f421e9e66b91749da0ca8dc2f9c06b6b0ce58034f79885f5a78c603324b` |
| v1.6.14 | `LoadToAgent-Setup-1.6.14.exe` | 92,580,518 | `d008877063e1e64627854f4366e80734a33fe4a41c63125d036f280d5cad390b` |
| v1.6.16 | `LoadToAgent-Setup-1.6.16.exe` | 92,580,832 | `765e3db3c1a88e4ddc25c87878596957654a23953393dc2f6701b3f3e8e80ea7` |
| v1.6.17 | `LoadToAgent-Setup-1.6.17.exe` | 92,594,060 | `9ab4190855bd5165597bfa0d4463ede00211ba9d73cfbfe49130d0dfc1daefa5` |
| v1.6.18 | `LoadToAgent-Setup-1.6.18.exe` | 92,603,443 | `1e7bd997d56ff851b027a81fc45c6d0d3b966f670ec3ab30957cda2b429d4098` |
| v1.6.19 | `LoadToAgent-Setup-1.6.19.exe` | 83,877,156 | `bf49962d681b03a92e3493d7ac9a41272f56422fd5eaa6712c72454ce30df908` |
| v1.6.20 | `LoadToAgent-Setup-1.6.20.exe` | 83,880,686 | `5b4eee4788ed8aeee47204f3874038183068e4c609f2a332e7daf790f1e7eedb` |
| v1.6.21 | `LoadToAgent-Setup-1.6.21.exe` | 83,885,247 | `89de96489c0cb06e7ff9da87aa6438d247201b54f446eb44cff43e4c3a9867d9` |
| v1.6.22 | `LoadToAgent-Setup-1.6.22.exe` | 83,962,791 | `9cd18c051e23f2f80a3b7e810604a64d18fbe778b8c3cbb3ee34af503d138451` |

All 19 packaged updaters selected the same live bridge asset and classified it
as an automatic Windows desktop installer:

- Repository/tag: `minjund/LodeToAgent`, `v1.6.23`
- Asset: `LoadToAgent-Setup-1.6.23.exe`
- Bytes: 94,506,459
- SHA-256: `29e90370acd3a6f00d3da4a82a79045cf235e716dcccbbf34b2d2b4db9f4e112`
- Release state: public, stable, immutable, exactly one asset
- Packaged bridge `app.asar` SHA-256:
  `0e0df77e4e3baf804e34c37942860b92c11d03c27b931fdd7122583aefffd8ab`

The complete packaged updater files are not byte-identical across all 19
versions. Their exact-byte implementation groups are:

- 1.6.3/1.6.4
- 1.6.5
- 1.6.6/1.6.7
- 1.6.8
- 1.6.9
- 1.6.10/1.6.11
- 1.6.12/1.6.13
- 1.6.14
- 1.6.16
- 1.6.17/1.6.18
- 1.6.19
- 1.6.20/1.6.21
- 1.6.22

The behavior that governs this compatibility path is byte-identical in all 19
official packages. The normalized projection hashes and unique counts were:

| Projection | SHA-256 | Unique values |
| --- | --- | ---: |
| Release channel (raw) | `4109253f7b63d1a4db71fe68c9808550c820b594830b186903d95e17deb845f4` | 1/19 |
| Release channel (LF) | `3fc68716d5dc9b5a502542869541d6f4ee2c5d164a26ca32e8981ac92fbbd64b` | 1/19 |
| Trusted URL function (LF) | `3deaeb918dc88a85dd1912adbaae2f1e04a9c2ab6cd57b48762ef4ad995f3247` | 1/19 |
| Asset selector (LF) | `aa0e5f75a053ced34fd4dc2289b229a3772a662e905110092216c6b7dc8cb9bc` | 1/19 |
| Automatic installer-name function (LF) | `746638f77f7f72d73ff9629851148210be448a7ec5724614eafa8d12f9579edb` | 1/19 |

## Official bridge behavior against 1.7.6

The updater and installer modules were executed from the official packaged
1.6.23 `app.asar`, not from current source. Against the complete seven-asset
1.7.6 contract it selects `Whitebox-Manual-Setup-1.7.6-x64.exe`, classifies it
as manual, and opens it without entering the automatic helper. The canonical
`Whitebox-Setup-1.7.6.exe` is independently recognized as automatic. macOS
arm64/x64 select their exact DMGs; Windows arm64/ia32 and Linux select nothing.

Audit commands used on the preserved official artifacts:

```powershell
$repoRoot = (Resolve-Path '..').Path
$auditRoot = 'D:\codex-temp\legacy-cohort-audit-20260824'
node "$auditRoot\audit-official-legacy-installers.js" $repoRoot $auditRoot
node "$auditRoot\audit-packaged-updater-contract.js" $repoRoot $auditRoot 1.7.6
gh release verify v1.6.23 --repo minjund/LodeToAgent
```

The two audit scripts had SHA-256 values
`8cacf13bcd75fe78e7e294d14431838665abdc1c5d836802dda7cd4021ccf6a7`
and `bb4985355d3f82d61b82b89ddb6d6cced6161e83327b1e1d7885de2654b21faf`
respectively. The official artifacts and extracted packages were preserved at
`D:\codex-temp\legacy-cohort-audit-20260824` for review.

## Official Whitebox 1.7.5 and 1.7.6 packaged-updater comparison

This comparison used the exact public Windows installers and the updater files
extracted from their packaged `app.asar` files. No tag checkout or rebuilt old
source was used.

The implementations are **not byte-identical**. They do share the same
canonical automatic Windows install protocol when the release has the complete,
valid asset contract: both select `Whitebox-Setup-<version>.exe`, classify it as
automatic, run byte-identical bootstrap/helper programs, use the same authenticated
ready-signal protocol, and execute the same main-process shutdown/install flow.
Version 1.7.6 additionally rejects ambiguous or malformed asset metadata and
pins an update relaunch to the validated Whitebox profile. Therefore 1.7.5 is
the representative floor of the fixed automatic cohort and must still be
exercised directly by packaged Windows E2E; a 1.7.6 result is not a substitute
for 1.7.5 when reviewing asset-validation or relaunch-profile hardening.

### Pinned public inputs

Repository: `minjund/Whitebox`. Both releases were public and stable
(`draft: false`, `prerelease: false`) when read from the release API. GitHub's
release `immutable` field was `false`, so the audit pins the tag, asset ID,
exact filename, URL, byte count, API digest, and locally calculated digest
rather than assuming GitHub release immutability is enabled. `gh release
verify` reported no attestations for either tag and was not treated as artifact
verification.

| Version | Release and annotated tag | Official canonical installer | Asset ID | Bytes | SHA-256 |
| --- | --- | --- | ---: | ---: | --- |
| 1.7.5 | release `375504076`, name/tag `v1.7.5`, published `2026-08-24T07:04:38Z`; tag object `a8cb8af4b349581d254584c48a6142d9a48eed20`; commit `0edcfe67a2a4554a4f00a486addb9a3cf1f91c57` | [`Whitebox-Setup-1.7.5.exe`](https://github.com/minjund/Whitebox/releases/download/v1.7.5/Whitebox-Setup-1.7.5.exe) | 527221706 | 85,297,926 | `3455b7c9aa9e7c520774995694dbcdb71678a0280a0fde2040693a00d38f2e68` |
| 1.7.6 | release `375907364`, name/tag `v1.7.6`, published `2026-08-24T18:44:05Z`; tag object `7dfb6e2c3641957f8c987e87380cfd582bf2e92f`; commit `40d8acf4704b49a11afb97ebb90d6ef7bc5e3e9f` | [`Whitebox-Setup-1.7.6.exe`](https://github.com/minjund/Whitebox/releases/download/v1.7.6/Whitebox-Setup-1.7.6.exe) | 528008725 | 85,321,320 | `0fda64f5cf6e051c70e417b39489797125720d84b31e8422c3d168faa3d7f341` |

Each API asset had `state: uploaded`; its API digest and local `Get-FileHash`
result matched the table. An unauthenticated public `HEAD` followed the GitHub
redirect and ended at HTTP 200 with the exact `Content-Disposition` filename
and `Content-Length` shown above for both installers.

### Extraction chain and packaged versions

7-Zip read both files as `NSIS-3 Unicode` containers. The installer payload
`$PLUGINSDIR\app-64.7z` was extracted first, followed by
`resources\app.asar`. The whole-ASAR extraction command encountered dangling
`node-pty` entries marked `unpacked`; that failed attempt was not counted as
evidence. The eight updater and wiring files below were then extracted
individually with `@electron/asar` 4.3.0, and every selected file matched the
same packed file produced before the unrelated `unpacked` failure.

| Version | `app-64.7z` bytes / SHA-256 | `app.asar` bytes / SHA-256 | Packaged version |
| --- | --- | --- | --- |
| 1.7.5 | 84,413,211 / `dc7a2d0e8c0bee371dacbfc4db270621c9c2c79178ca85033674e4c96593b1a1` | 6,059,577 / `8ac15c1145882d21358ac6068707380019dce890b27c6b77c54ec86b01005d9e` | `1.7.5` |
| 1.7.6 | 84,436,523 / `08a6495152ea8a731eba4bd87de3899355f009e6a283bf4c42e8cf6b1d42d94f` | 6,217,425 / `07743b7d5d60f379d8e08e852c781196bf8fab5c0d770abfec21dc02c47d8886` | `1.7.6` |

The packaged `resources/app-update.yml` was byte-identical at 88 bytes with
SHA-256 `473dd6590474971b76d643c2c30d1fac1cddf73f5b0d58fb62ab7766c62ae53a`
and named the `minjund/Whitebox` GitHub provider and
`whitebox-ai-updater` cache directory.

### Exact packaged-file hashes

These are raw-file SHA-256 values from the selected `app.asar` extraction.

| Packaged path | 1.7.5 bytes / SHA-256 | 1.7.6 bytes / SHA-256 |
| --- | --- | --- |
| `src/updateManager.js` | 28,266 / `21e9d7a44143b8a7932c7385dcf750d7083291780cccb3dfebff53e64db2c390` | 27,732 / `15c4859b7d8194b1b3b4e78f656989b810aa009086c7ba0fe77720260f9c35f7` |
| `src/updateInstaller.js` | 50,338 / `8462c923691f29813fd86b832b1306db9d52ca49135a11dcb6822ef05dd782de` | 50,400 / `9717f07f67afaa755fa929308022b552c23120ca4db49a0c07cb2f0c250be74b` |
| `src/updateRelaunch.js` | 2,815 / `41cedbc7de11bfadaf0d3d082269c79fa517c63ba2f0884bb7e518e36a2eb75f` | 6,603 / `a20a65a495e1c9f63b8427c795cf32e12e904988866a74e3471238ca24baaf49` |
| `src/macUpdateHelper.js` | 22,300 / `99f9bb3aac05ce8c54084eb91049b6dfab4853e225fa19c5ccd7df81a457d219` | 22,300 / `99f9bb3aac05ce8c54084eb91049b6dfab4853e225fa19c5ccd7df81a457d219` |
| `src/ipc/registerAppIpc.js` | 1,640 / `3f7e3dab57e44d0b5cbd9e63ec856b2576564a1e63f6950b78239136bf2c6b51` | 1,640 / `3f7e3dab57e44d0b5cbd9e63ec856b2576564a1e63f6950b78239136bf2c6b51` |
| `main.js` | 99,394 / `736f07ad9a962620d43cead012847211f5e0a37c95e29d89f3153d460dd16d2a` | 103,643 / `4817adbba6fbe8042fb6368bff51dfef9caa790f63da480f2ad7da36a01779f4` |
| `preload.js` | 8,147 / `ba35f153571175877309a534f3f4419e72e19dfc2dbf97c551089d91374f6b06` | 8,259 / `8e339e81743663ee1214f85164af6ad77181a17d0ac117c9d7cac9f67815eebb` |
| `package.json` | 1,357 / `a6efc96d3c0a642cec8ac421fc604df7741b6e9abdc9fa5d16ce73a3136c6ca9` | 1,357 / `48322c35d62cc69f15e1e2615d8986c3c26292954f6e896bd0f6896e8f28df33` |

### Executed packaged behavior

The two extracted `src/updateManager.js` modules were required directly and
given the complete seven-asset public 1.7.6 release response. The resulting
selection matrix was:

| Input | Packaged 1.7.5 | Packaged 1.7.6 |
| --- | --- | --- |
| Windows x64, all seven assets | `Whitebox-Setup-1.7.6.exe` | `Whitebox-Setup-1.7.6.exe` |
| macOS arm64, all seven assets | `Whitebox-1.7.6-arm64.dmg` | `Whitebox-1.7.6-arm64.dmg` |
| macOS x64, all seven assets | `Whitebox-1.7.6-x64.dmg` | `Whitebox-1.7.6-x64.dmg` |
| Windows arm64 / ia32; Linux x64 | no asset | no asset |
| Manual alias only | no asset | no asset |
| Portable asset only | portable EXE | no asset |
| Complete set plus trusted same-version `Whitebox-Setup-1.7.6-x64.exe` decoy | decoy | canonical Setup |
| Canonical name at a trusted but wrong tag URL only | canonical name | no asset |
| Canonical metadata with size zero only | canonical name | no asset |

The last three cases are synthetic negative controls, not live release assets.
They prove that 1.7.6 replaced the 1.7.5 scoring selector with exact canonical
name, URL, uploaded-state, positive-size, maximum-size, and SHA-256 checks.
This is a real behavior difference. It does not change the cohort path for a
complete valid release, but it forbids claiming the two selectors are
equivalent under malformed or adversarial metadata.

Both packaged installers classified the canonical Setup name as `win32`
automatic and the manual alias as non-automatic. The following executable
projections were byte-identical across both packages:

| Projection | Bytes | SHA-256 |
| --- | ---: | --- |
| Exported Windows bootstrap string | 5,545 | `dd12fbdb5c0e1636abfb952bec226f4174741f24cfa2add6455c6f71b0ceea90` |
| Exported Windows helper string | 11,590 | `4aac130e02bb18ecbb1a33710dcd29f808d90c3fe4155e4208e2fd7c006b482d` |
| 14 exported install/classification/verification/process functions, LF-normalized and name-delimited | 16,353 | `43c9d4253ca66c6a9e06bb488a02fd197a46d456f34d575bc8e6b150841a00ec` |
| Main update state, shutdown, launch, failure recovery, and install-promise flow | 7,011 | `adcbeaa317c3f2474ded5625928fdaf3b8531f0ca991f3c5bd7ed248c1d5eaf0` |
| Preload update IPC bridge | 503 | `6f0028a3131e84d826753df1bf7560872dc8eb9cfc2e50ed9b30063e9beffee1` |

The 14-function projection covered `automaticInstallPlatform`,
`canInstallSilently`, `findInstalledDesktopApp`, `isWithinDirectory`,
`macAppBundlePath`, `readDesktopAppVersion`, `resolveInstalledDesktopApp`,
`strictWindowsProcessExists`, `terminateWindowsUpdateProcesses`,
`waitForProcessSpawn`, `waitForUpdateBootstrapExit`,
`waitForUpdateHelperReady`, `verifyDownloadedInstaller`, and
`windowsPowerShell`.

The common relaunch request and ready-signal functions were also identical:

- `readUpdateRelaunchRequest` LF-normalized SHA-256:
  `3f493c710d0f4b1e223f2e0ba89cd9df17555160155a8a02fd39e35010d806c1`
- `signalRendererReady` LF-normalized SHA-256:
  `fee4c24ddb3eced2b243542102c944f8a48b01e14bdd0ed6743357fcec3cec59`
- Both exported `WHITEBOX_UPDATE_READY_PATH`, `WHITEBOX_UPDATE_READY_TOKEN`,
  `LOADTOAGENT_UPDATE_READY_PATH`, and `LOADTOAGENT_UPDATE_READY_TOKEN`.

The whole `updateInstaller.js` files differ by one line: 1.7.6 explicitly
passes a copy of `process.env` plus an optional test/environment overlay to the
bootstrap spawn. The packaged main process does not supply that overlay, so the
production spawn environment remains equivalent to Node's inherited default.
The LF-normalized `launchDownloadedUpdate` function hashes were
`c5801a413ca2756f5bc129f55826ba2f6dcba125ad42e5731241b7729893e557`
and `97c4673604966b0a2d3e1ac4765a02e446378424fdbd4781095ef4abafb55928`
respectively.

Version 1.7.6 adds `applyWindowsUpdateRelaunchProfile` and calls it from
`main.js` before brand profile selection. That code validates the authenticated
ready request, absolute APPDATA path, real non-symlink directories, and the
resulting Whitebox `userData` containment. This is relaunch hardening, while the
token parsing and renderer-ready acknowledgement protocol remains the identical
protocol hashed above. `preload.js` differs only by an unrelated source-plugin
method, and its update bridge is identical. `src/ipc/registerAppIpc.js` is
entirely byte-identical.

### Commands and retained evidence

The audit root was resolved and verified as
`D:\codex-temp\whitebox-packaged-updater-proof-20260825` before creating
version-specific children. Material commands were:

```powershell
$auditRoot = 'D:\codex-temp\whitebox-packaged-updater-proof-20260825'
$sevenZip = (Resolve-Path 'node_modules\electron-winstaller\vendor\7z.exe').Path
gh api repos/minjund/Whitebox/releases/tags/v1.7.5
gh api repos/minjund/Whitebox/releases/tags/v1.7.6
gh api repos/minjund/Whitebox/git/ref/tags/v1.7.5
gh api repos/minjund/Whitebox/git/ref/tags/v1.7.6
gh api repos/minjund/Whitebox/git/tags/a8cb8af4b349581d254584c48a6142d9a48eed20
gh api repos/minjund/Whitebox/git/tags/7dfb6e2c3641957f8c987e87380cfd582bf2e92f
gh release verify v1.7.5 --repo minjund/Whitebox
gh release verify v1.7.6 --repo minjund/Whitebox
gh release download v1.7.5 --repo minjund/Whitebox --pattern 'Whitebox-Setup-1.7.5.exe' --dir "$auditRoot\v1.7.5"
gh release download v1.7.6 --repo minjund/Whitebox --pattern 'Whitebox-Setup-1.7.6.exe' --dir "$auditRoot\v1.7.6"
Get-FileHash -Algorithm SHA256 -LiteralPath <installer-or-extracted-file>
curl.exe -sS -L -I <canonical-public-asset-url>
& $sevenZip x -y "-o<installer-extracted>" -- <installer> '$PLUGINSDIR\app-64.7z'
& $sevenZip x -y "-o<app-extracted>" -- <app-64.7z>
npx --yes @electron/asar --version
npx --yes @electron/asar extract-file <app.asar> <packaged-path>
git -c core.autocrlf=false diff --no-index --unified=6 -- <1.7.5-file> <1.7.6-file>
gh api repos/minjund/Whitebox/releases/tags/v1.7.6 | node -e $packagedBehaviorHarness <1.7.5-asar-root> <1.7.6-asar-root>
node -e $projectionHashHarness <1.7.5-asar-root> <1.7.6-asar-root>
```

The behavior harness required each packaged module from its extracted ASAR,
used the live seven-asset JSON without rewriting it for the positive matrix,
then added only the three explicitly named negative controls. The projection
harness used SHA-256 over UTF-8 strings, normalized CRLF to LF for function and
source projections, and delimited each exported function by name and NUL bytes.
Installers, archives, ASAR files, and selected extracted files remain under the
verified audit root for independent review. A final fail-closed rerun reported
`ARTIFACT_ASSERTIONS=PASS count=6` for both installers, both `app-64.7z`
payloads, and both `app.asar` files, plus
`PACKAGED_BEHAVIOR_ASSERTIONS=PASS versions=1.7.5,1.7.6 assets=7
negative_controls=3`.
