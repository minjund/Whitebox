# Release 1.8.32 verification

This release hides generated .specflow, .git, and .cache work paths and sessions from the sidebar and its status counts. Ordinary project folders, .github work, session history, and source data remain available. It also includes the pending nested-folder selection, deletion, keyboard, layout, and refresh-focus fixes.

## Installed-client compatibility matrix

Each row is a separate official packaged updater input. The exact repository, tag, filename, size and SHA-256 below pin the downloaded installer. Packaged Windows verification must extract and exercise each installed app.asar, including the candidate self-reinstallation path. Source-only results are not approval.

| Official installed version | Path to 1.8.32 | Official filename | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| 1.7.3 | Manual alias | [Whitebox-Setup-1.7.3.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.3/Whitebox-Setup-1.7.3.exe) | 85295741 | 6b14caec7baeca5d6048c32121b9d7361f2bd56828aa6228f2322bf32da6f574 |
| 1.7.4 | Manual alias | [Whitebox-Setup-1.7.4.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.4/Whitebox-Setup-1.7.4.exe) | 85296425 | 4d940cf16425436922a37746417b419c7671c47642c0f24b8c79197af99c2135 |
| 1.7.5 | Canonical automatic installer | [Whitebox-Setup-1.7.5.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.5/Whitebox-Setup-1.7.5.exe) | 85297926 | 3455b7c9aa9e7c520774995694dbcdb71678a0280a0fde2040693a00d38f2e68 |
| 1.7.0 | Manual alias | [Whitebox-Setup-1.7.0.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.0/Whitebox-Setup-1.7.0.exe) | 85126771 | 169d5ae5a01ab3baa07700086d9527b1916c23fc0c6640a78e9b4612cc917c13 |
| 1.7.1 | Manual alias | [Whitebox-Setup-1.7.1.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.1/Whitebox-Setup-1.7.1.exe) | 85126828 | b60464bd04ad77f93e79b3fbe073c17ca0a102021dc87f9845587476ea53c6b3 |
| 1.7.2 | Manual alias | [Whitebox-Setup-1.7.2.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.2/Whitebox-Setup-1.7.2.exe) | 85126852 | e932e606e590e31f0e91f68ebe49b26d4a7fcdc3681c92192d32da6e10f9d227 |
| 1.8.30 | Canonical automatic installer | [Whitebox-Setup-1.8.30.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.30/Whitebox-Setup-1.8.30.exe) | 95409618 | 46639eb2d2bc9c5593b77cd1f3a5cd5cd1411ae17eec60b911037a25af459e82 |
| 1.8.28 | Canonical automatic installer | [Whitebox-Setup-1.8.28.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.28/Whitebox-Setup-1.8.28.exe) | 95397289 | 7fc94cd9a60db6481873d49435dcd2801bdeca7a1ff78568e1fbb855cad46442 |
| 1.8.27 | Canonical automatic installer | [Whitebox-Setup-1.8.27.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.27/Whitebox-Setup-1.8.27.exe) | 95353762 | f2c6c5fdfeee7f395137f055597982e2dd8f9c4f813902da770a4edee6f5478a |
| 1.8.25 | Canonical automatic installer | [Whitebox-Setup-1.8.25.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.25/Whitebox-Setup-1.8.25.exe) | 95355956 | 57d47a488352d1058397549f860fe496af9a8f311b1db8d9a1aa1aafaa64510c |
| 1.8.24 | Canonical automatic installer | [Whitebox-Setup-1.8.24.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.24/Whitebox-Setup-1.8.24.exe) | 95320703 | 4e3a56eb25c5fb8002fb067b2d371094606552ebc82db01ccf4b7e622c3efa06 |
| 1.8.20 | Canonical automatic installer | [Whitebox-Setup-1.8.20.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.20/Whitebox-Setup-1.8.20.exe) | 95366645 | 35baa58fe1399f1954d8f88ac6a4877dfa2675d1e5c96ed751add8b9bb510b5a |
| 1.8.21 | Canonical automatic installer | [Whitebox-Setup-1.8.21.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.21/Whitebox-Setup-1.8.21.exe) | 95377747 | 36213f39f66d18d10384fd070c1befdbb0b56259e88ebd1f9ce6d749a8d5bbf5 |
| 1.8.22 | Canonical automatic installer | [Whitebox-Setup-1.8.22.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.22/Whitebox-Setup-1.8.22.exe) | 95319223 | f9e74a59f59e423168c01db3719e1063b4e77a7afdf6f308263880d3d630c110 |
| 1.8.23 | Canonical automatic installer | [Whitebox-Setup-1.8.23.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.23/Whitebox-Setup-1.8.23.exe) | 95322488 | 8c612ba145e5df06cf15d2d6b9b415c6f8333d08efc7b7ab8156a195d3091d4d |
| 1.7.6 | Canonical automatic installer | [Whitebox-Setup-1.7.6.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.6/Whitebox-Setup-1.7.6.exe) | 85321320 | 0fda64f5cf6e051c70e417b39489797125720d84b31e8422c3d168faa3d7f341 |
| 1.7.8 | Canonical automatic installer | [Whitebox-Setup-1.7.8.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.8/Whitebox-Setup-1.7.8.exe) | 85325513 | ff3d775449c6a670e0a3cc9f28f9af0e2dfdf371f500cdaa5d5daff03d7f5311 |
| 1.7.9 | Canonical automatic installer | [Whitebox-Setup-1.7.9.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.9/Whitebox-Setup-1.7.9.exe) | 85325656 | ff68ea266100f683354f9020b9560b51ebf001efc520fa1a997d00b44a43ac81 |
| 1.7.11 | Canonical automatic installer | [Whitebox-Setup-1.7.11.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.11/Whitebox-Setup-1.7.11.exe) | 85327244 | f126797cdcae732d99225b3df7613bafa983b9dbc870d0068f368d8f7ac73178 |
| 1.7.12 | Canonical automatic installer | [Whitebox-Setup-1.7.12.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.12/Whitebox-Setup-1.7.12.exe) | 85335488 | 07610ac268a0932d70eaeb44a61a775daed9482b7409d53aa46dc6200200e75d |
| 1.7.13 | Canonical automatic installer | [Whitebox-Setup-1.7.13.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.13/Whitebox-Setup-1.7.13.exe) | 85244079 | 5e731d5b7434634f421ca32f40a36101b469d06286ecded690eba5afe5fe18bd |
| 1.7.14 | Canonical automatic installer | [Whitebox-Setup-1.7.14.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.14/Whitebox-Setup-1.7.14.exe) | 85246819 | aaa2cb066fcefccf9fff36ff3757b04b3df2df4be8b2a430c5f69c28d7d0a187 |
| 1.7.15 | Canonical automatic installer | [Whitebox-Setup-1.7.15.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.15/Whitebox-Setup-1.7.15.exe) | 85266395 | f2ae2cecd39b1bd324735f92dde348d1f6fd8e6ddf1616d1054b514d0a0d583f |
| 1.7.16 | Canonical automatic installer | [Whitebox-Setup-1.7.16.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.16/Whitebox-Setup-1.7.16.exe) | 85268679 | 896e2e950a492234dc463865f087ae9ab4184ce20558bfdf7a92e934bf009e04 |
| 1.8.2 | Canonical automatic installer | [Whitebox-Setup-1.8.2.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.2/Whitebox-Setup-1.8.2.exe) | 85298702 | de9389e3e11a00e8d9ac8d4c31935b097c75b1cf8c4f285073177d67330291ae |
| 1.8.3 | Canonical automatic installer | [Whitebox-Setup-1.8.3.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.3/Whitebox-Setup-1.8.3.exe) | 85299286 | 8ff9f8895183f45fdc76d14e1413ea741a9b938645920f2629743c42d1931347 |
| 1.8.4 | Canonical automatic installer | [Whitebox-Setup-1.8.4.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.4/Whitebox-Setup-1.8.4.exe) | 85300893 | 79a922dc265aaeab7a5d7d30cd763d0446eba6f162eae703e2c714b05b12955d |
| 1.8.5 | Canonical automatic installer | [Whitebox-Setup-1.8.5.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.5/Whitebox-Setup-1.8.5.exe) | 85301431 | 7b769ba143c4d70eb312a88b8994f963737cda49ff621b0070ea3231eb1666c2 |
| 1.8.1 | Canonical automatic installer | [Whitebox-Setup-1.8.1.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.1/Whitebox-Setup-1.8.1.exe) | 85298672 | d62511bc82dfdab4b4b851cc0c180f4ac0d04aa2baef0f82145e246c1aa2dd91 |
| 1.8.6 | Canonical automatic installer | [Whitebox-Setup-1.8.6.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.6/Whitebox-Setup-1.8.6.exe) | 85301256 | 401254235581031ffdc14e3bcbc7d8bb315c9300a3e9ccd575e9ffb15a4e443a |
| 1.8.7 | Canonical automatic installer | [Whitebox-Setup-1.8.7.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.7/Whitebox-Setup-1.8.7.exe) | 85302264 | 1a0d8ddf8ee4f373e5620ffa416cc697ae034c8e38090502034984462b861047 |
| 1.8.8 | Canonical automatic installer | [Whitebox-Setup-1.8.8.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.8/Whitebox-Setup-1.8.8.exe) | 85303444 | 25d9406df0a3c27ce1f5846fcb9965b42f73727caf109b4be11b50b2af39810a |
| 1.8.9 | Canonical automatic installer | [Whitebox-Setup-1.8.9.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.9/Whitebox-Setup-1.8.9.exe) | 85321051 | 8b95949603129c66431ac11c4e1ba9a2fb559b56ca3b8e616fa00dff96b0eb0e |
| 1.8.10 | Canonical automatic installer | [Whitebox-Setup-1.8.10.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.10/Whitebox-Setup-1.8.10.exe) | 85320539 | 88d145fc4a1a6217f798bd0359751b4bba7d0e9615fe4e49e0bff845478114e3 |
| 1.8.11 | Canonical automatic installer | [Whitebox-Setup-1.8.11.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.11/Whitebox-Setup-1.8.11.exe) | 85400839 | f6a46fe7b7293f78b86864a3a5a81e37cfc9dcf79d1a559968214edfdabe79e5 |
| 1.8.12 | Canonical automatic installer | [Whitebox-Setup-1.8.12.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.12/Whitebox-Setup-1.8.12.exe) | 85355105 | 1f7a96730e597c63871db5e28025b67cbddca0d798932380ed983c044bd41a86 |
| 1.8.13 | Canonical automatic installer | [Whitebox-Setup-1.8.13.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.13/Whitebox-Setup-1.8.13.exe) | 85362357 | 3504fb78d0d5ef5d278ef027b1a51d464289b923e08dd1fbaf3ba827b8b31482 |
| 1.8.14 | Canonical automatic installer | [Whitebox-Setup-1.8.14.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.14/Whitebox-Setup-1.8.14.exe) | 85367761 | 3b364b5274d85a3d80f41183970ef997f5322d70af60f8aac7d2c1a5bed421f0 |
| 1.8.15 | Canonical automatic installer | [Whitebox-Setup-1.8.15.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.15/Whitebox-Setup-1.8.15.exe) | 84924462 | 99d978b2b68f3873ec384efb20c0f8c2abb9c030c70ce9f3a0a012aa3c9091ad |
| 1.8.17 | Canonical automatic installer | [Whitebox-Setup-1.8.17.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.17/Whitebox-Setup-1.8.17.exe) | 85132115 | 17426dfb12f92796d676fe9e94eed06b049ebb67c70104378cc10d731c3c8f69 |
| 1.8.16 | Canonical automatic installer | [Whitebox-Setup-1.8.16.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.16/Whitebox-Setup-1.8.16.exe) | 84684379 | 2876e462f1816b68c3fd045b9ab8ee5c13e97c922db4ae3cad18c9476707b921 |
| 1.8.18 | Canonical automatic installer | [Whitebox-Setup-1.8.18.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.18/Whitebox-Setup-1.8.18.exe) | 95328726 | 1e012b0397e90477c86c2c946dd4aac4cb4c9e71e8e8910acd6a6877287cbc2a |
| 1.8.19 | Canonical automatic installer | [Whitebox-Setup-1.8.19.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.19/Whitebox-Setup-1.8.19.exe) | 95367957 | 74e7845e1d8432e577a1ecb2e631c5328a7024eb2d1c813cbeeb5e05ef84791a |
| 1.8.31 | Canonical automatic installer | [Whitebox-Setup-1.8.31.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.31/Whitebox-Setup-1.8.31.exe) | 95424942 | b579d7a82b3c94f5a985b4adb4c2ce93c619c28c40bc9c93a1a02faac9cefc31 |

Published LoadToAgent 1.6.3–1.6.14 and 1.6.16–1.6.22 use the immutable official 1.6.23 bridge before 1.8.32. Version 1.6.15 was never published. All 19 installer pins and the comparisons of their official packaged implementations are recorded in [the immutable legacy audit](UPDATE-COMPATIBILITY-AUDIT-2026-08-24.md). The complete official 1.6.3 → official 1.6.23 → candidate path must run separately with fresh state.

## Required verification

- Run source checks, npm regression and accuracy tests, package checks, and the sidebar tree and nested-project Electron regression checks.
- Require the exact candidate SHA to pass the stable Updater compatibility gate, including separate packaged Windows attempts from official 1.7.3, 1.7.4, 1.7.5, every other pinned cohort above, and the official legacy bridge.
- Reinstall candidate 1.8.32 through its own packaged automatic updater; verify bootstrap acknowledgement, parent shutdown, installed EXE and app.asar version, one renderer-ready relaunch, and helper/process/profile cleanup.
- Repeat packaged attempts in the tag Release workflow before publishing. Verify the complete release asset set, decoy rejection, and identical canonical/manual installer bytes.
- After publication, run EXPECTED_CURRENT_TAG=v1.8.32 npm run check:update:legacy and verify public latest, HEAD responses, names, sizes, SHA-256 digests, and draft/prerelease state.

This is the planned verification matrix, not an approval. Final reviewed SHA, Actions URLs, per-cohort results, and public-channel evidence belong in the completed release record.

## Additional official-package inspection

On 2026-10-20, the official 1.7.0, 1.7.1, and 1.7.2 installers above were downloaded and verified against their API byte sizes and SHA-256 digests. Each NSIS app-64.7z payload was extracted, the app.asar package version matched its tag, and its own updateManager selected Whitebox-Manual-Setup-1.8.32-x64.exe from the complete seven-asset release fixture. These three packages contain byte-identical updateManager.js and updateInstaller.js files:

| Packaged file | SHA-256 (all three versions) |
| --- | --- |
| src/updateManager.js | 68fa1ecef0dbf9b5d7736511f5160acc940d704ea8120d5f935403ecf91d7317 |
| src/updateInstaller.js | 7aae441fcd2c21ee566974a39c68f5ed959fd0cc54c40dbd28c32164c46d57fe |

All three are now separately pinned manual-path Windows E2E inputs; this static packaged inspection does not replace their full installed-client runs.
