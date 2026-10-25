# Release 2.0.3 verification

Status: pending. This is a verification plan, not release approval.

This release adds concise decision briefs, cited reasons, material cautions,
one next action, optional alternatives, bounded repair and readable 15px text.
ASD-STE100 clarity principles remain localized. No Laya runtime is included.
See [the analysis design](analysis-decision-design.md) for behavior and limits.

## Installed-client compatibility matrix

Every row pins an individual official installer. Its installed app.asar updater
must be exercised against the 2.0.3 candidate; no updater equivalence is inferred
from current sources. There are 46 Whitebox source cohorts. Each source path
also exercises the updater packaged in 2.0.3 through automatic self-reinstall,
renderer readiness, authenticated relaunch and strict cleanup.

| Official source | Path to 2.0.3 | Repository / tag / exact filename | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| 1.7.3 | Manual alias | [minjund/Whitebox / v1.7.3 / Whitebox-Setup-1.7.3.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.3/Whitebox-Setup-1.7.3.exe) | 85295741 | 6b14caec7baeca5d6048c32121b9d7361f2bd56828aa6228f2322bf32da6f574 |
| 1.7.4 | Manual alias | [minjund/Whitebox / v1.7.4 / Whitebox-Setup-1.7.4.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.4/Whitebox-Setup-1.7.4.exe) | 85296425 | 4d940cf16425436922a37746417b419c7671c47642c0f24b8c79197af99c2135 |
| 1.7.5 | Canonical automatic installer | [minjund/Whitebox / v1.7.5 / Whitebox-Setup-1.7.5.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.5/Whitebox-Setup-1.7.5.exe) | 85297926 | 3455b7c9aa9e7c520774995694dbcdb71678a0280a0fde2040693a00d38f2e68 |
| 1.7.0 | Manual alias | [minjund/Whitebox / v1.7.0 / Whitebox-Setup-1.7.0.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.0/Whitebox-Setup-1.7.0.exe) | 85126771 | 169d5ae5a01ab3baa07700086d9527b1916c23fc0c6640a78e9b4612cc917c13 |
| 1.7.1 | Manual alias | [minjund/Whitebox / v1.7.1 / Whitebox-Setup-1.7.1.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.1/Whitebox-Setup-1.7.1.exe) | 85126828 | b60464bd04ad77f93e79b3fbe073c17ca0a102021dc87f9845587476ea53c6b3 |
| 1.7.2 | Manual alias | [minjund/Whitebox / v1.7.2 / Whitebox-Setup-1.7.2.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.2/Whitebox-Setup-1.7.2.exe) | 85126852 | e932e606e590e31f0e91f68ebe49b26d4a7fcdc3681c92192d32da6e10f9d227 |
| 1.8.32 | Canonical automatic installer | [minjund/Whitebox / v1.8.32 / Whitebox-Setup-1.8.32.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.32/Whitebox-Setup-1.8.32.exe) | 95389352 | bdfb2ba055807854eb55da998674deeeb2421c9877079b21e96e0a75389e01c8 |
| 1.8.31 | Canonical automatic installer | [minjund/Whitebox / v1.8.31 / Whitebox-Setup-1.8.31.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.31/Whitebox-Setup-1.8.31.exe) | 95424942 | b579d7a82b3c94f5a985b4adb4c2ce93c619c28c40bc9c93a1a02faac9cefc31 |
| 1.8.30 | Canonical automatic installer | [minjund/Whitebox / v1.8.30 / Whitebox-Setup-1.8.30.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.30/Whitebox-Setup-1.8.30.exe) | 95409618 | 46639eb2d2bc9c5593b77cd1f3a5cd5cd1411ae17eec60b911037a25af459e82 |
| 1.8.28 | Canonical automatic installer | [minjund/Whitebox / v1.8.28 / Whitebox-Setup-1.8.28.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.28/Whitebox-Setup-1.8.28.exe) | 95397289 | 7fc94cd9a60db6481873d49435dcd2801bdeca7a1ff78568e1fbb855cad46442 |
| 1.8.27 | Canonical automatic installer | [minjund/Whitebox / v1.8.27 / Whitebox-Setup-1.8.27.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.27/Whitebox-Setup-1.8.27.exe) | 95353762 | f2c6c5fdfeee7f395137f055597982e2dd8f9c4f813902da770a4edee6f5478a |
| 1.8.25 | Canonical automatic installer | [minjund/Whitebox / v1.8.25 / Whitebox-Setup-1.8.25.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.25/Whitebox-Setup-1.8.25.exe) | 95355956 | 57d47a488352d1058397549f860fe496af9a8f311b1db8d9a1aa1aafaa64510c |
| 1.8.24 | Canonical automatic installer | [minjund/Whitebox / v1.8.24 / Whitebox-Setup-1.8.24.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.24/Whitebox-Setup-1.8.24.exe) | 95320703 | 4e3a56eb25c5fb8002fb067b2d371094606552ebc82db01ccf4b7e622c3efa06 |
| 1.8.20 | Canonical automatic installer | [minjund/Whitebox / v1.8.20 / Whitebox-Setup-1.8.20.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.20/Whitebox-Setup-1.8.20.exe) | 95366645 | 35baa58fe1399f1954d8f88ac6a4877dfa2675d1e5c96ed751add8b9bb510b5a |
| 1.8.21 | Canonical automatic installer | [minjund/Whitebox / v1.8.21 / Whitebox-Setup-1.8.21.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.21/Whitebox-Setup-1.8.21.exe) | 95377747 | 36213f39f66d18d10384fd070c1befdbb0b56259e88ebd1f9ce6d749a8d5bbf5 |
| 1.8.22 | Canonical automatic installer | [minjund/Whitebox / v1.8.22 / Whitebox-Setup-1.8.22.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.22/Whitebox-Setup-1.8.22.exe) | 95319223 | f9e74a59f59e423168c01db3719e1063b4e77a7afdf6f308263880d3d630c110 |
| 1.8.23 | Canonical automatic installer | [minjund/Whitebox / v1.8.23 / Whitebox-Setup-1.8.23.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.23/Whitebox-Setup-1.8.23.exe) | 95322488 | 8c612ba145e5df06cf15d2d6b9b415c6f8333d08efc7b7ab8156a195d3091d4d |
| 1.7.6 | Canonical automatic installer | [minjund/Whitebox / v1.7.6 / Whitebox-Setup-1.7.6.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.6/Whitebox-Setup-1.7.6.exe) | 85321320 | 0fda64f5cf6e051c70e417b39489797125720d84b31e8422c3d168faa3d7f341 |
| 1.7.8 | Canonical automatic installer | [minjund/Whitebox / v1.7.8 / Whitebox-Setup-1.7.8.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.8/Whitebox-Setup-1.7.8.exe) | 85325513 | ff3d775449c6a670e0a3cc9f28f9af0e2dfdf371f500cdaa5d5daff03d7f5311 |
| 1.7.9 | Canonical automatic installer | [minjund/Whitebox / v1.7.9 / Whitebox-Setup-1.7.9.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.9/Whitebox-Setup-1.7.9.exe) | 85325656 | ff68ea266100f683354f9020b9560b51ebf001efc520fa1a997d00b44a43ac81 |
| 1.7.11 | Canonical automatic installer | [minjund/Whitebox / v1.7.11 / Whitebox-Setup-1.7.11.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.11/Whitebox-Setup-1.7.11.exe) | 85327244 | f126797cdcae732d99225b3df7613bafa983b9dbc870d0068f368d8f7ac73178 |
| 1.7.12 | Canonical automatic installer | [minjund/Whitebox / v1.7.12 / Whitebox-Setup-1.7.12.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.12/Whitebox-Setup-1.7.12.exe) | 85335488 | 07610ac268a0932d70eaeb44a61a775daed9482b7409d53aa46dc6200200e75d |
| 1.7.13 | Canonical automatic installer | [minjund/Whitebox / v1.7.13 / Whitebox-Setup-1.7.13.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.13/Whitebox-Setup-1.7.13.exe) | 85244079 | 5e731d5b7434634f421ca32f40a36101b469d06286ecded690eba5afe5fe18bd |
| 1.7.14 | Canonical automatic installer | [minjund/Whitebox / v1.7.14 / Whitebox-Setup-1.7.14.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.14/Whitebox-Setup-1.7.14.exe) | 85246819 | aaa2cb066fcefccf9fff36ff3757b04b3df2df4be8b2a430c5f69c28d7d0a187 |
| 1.7.15 | Canonical automatic installer | [minjund/Whitebox / v1.7.15 / Whitebox-Setup-1.7.15.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.15/Whitebox-Setup-1.7.15.exe) | 85266395 | f2ae2cecd39b1bd324735f92dde348d1f6fd8e6ddf1616d1054b514d0a0d583f |
| 1.7.16 | Canonical automatic installer | [minjund/Whitebox / v1.7.16 / Whitebox-Setup-1.7.16.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.16/Whitebox-Setup-1.7.16.exe) | 85268679 | 896e2e950a492234dc463865f087ae9ab4184ce20558bfdf7a92e934bf009e04 |
| 1.8.2 | Canonical automatic installer | [minjund/Whitebox / v1.8.2 / Whitebox-Setup-1.8.2.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.2/Whitebox-Setup-1.8.2.exe) | 85298702 | de9389e3e11a00e8d9ac8d4c31935b097c75b1cf8c4f285073177d67330291ae |
| 1.8.3 | Canonical automatic installer | [minjund/Whitebox / v1.8.3 / Whitebox-Setup-1.8.3.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.3/Whitebox-Setup-1.8.3.exe) | 85299286 | 8ff9f8895183f45fdc76d14e1413ea741a9b938645920f2629743c42d1931347 |
| 1.8.4 | Canonical automatic installer | [minjund/Whitebox / v1.8.4 / Whitebox-Setup-1.8.4.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.4/Whitebox-Setup-1.8.4.exe) | 85300893 | 79a922dc265aaeab7a5d7d30cd763d0446eba6f162eae703e2c714b05b12955d |
| 1.8.5 | Canonical automatic installer | [minjund/Whitebox / v1.8.5 / Whitebox-Setup-1.8.5.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.5/Whitebox-Setup-1.8.5.exe) | 85301431 | 7b769ba143c4d70eb312a88b8994f963737cda49ff621b0070ea3231eb1666c2 |
| 1.8.1 | Canonical automatic installer | [minjund/Whitebox / v1.8.1 / Whitebox-Setup-1.8.1.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.1/Whitebox-Setup-1.8.1.exe) | 85298672 | d62511bc82dfdab4b4b851cc0c180f4ac0d04aa2baef0f82145e246c1aa2dd91 |
| 1.8.6 | Canonical automatic installer | [minjund/Whitebox / v1.8.6 / Whitebox-Setup-1.8.6.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.6/Whitebox-Setup-1.8.6.exe) | 85301256 | 401254235581031ffdc14e3bcbc7d8bb315c9300a3e9ccd575e9ffb15a4e443a |
| 1.8.7 | Canonical automatic installer | [minjund/Whitebox / v1.8.7 / Whitebox-Setup-1.8.7.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.7/Whitebox-Setup-1.8.7.exe) | 85302264 | 1a0d8ddf8ee4f373e5620ffa416cc697ae034c8e38090502034984462b861047 |
| 1.8.8 | Canonical automatic installer | [minjund/Whitebox / v1.8.8 / Whitebox-Setup-1.8.8.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.8/Whitebox-Setup-1.8.8.exe) | 85303444 | 25d9406df0a3c27ce1f5846fcb9965b42f73727caf109b4be11b50b2af39810a |
| 1.8.9 | Canonical automatic installer | [minjund/Whitebox / v1.8.9 / Whitebox-Setup-1.8.9.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.9/Whitebox-Setup-1.8.9.exe) | 85321051 | 8b95949603129c66431ac11c4e1ba9a2fb559b56ca3b8e616fa00dff96b0eb0e |
| 1.8.10 | Canonical automatic installer | [minjund/Whitebox / v1.8.10 / Whitebox-Setup-1.8.10.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.10/Whitebox-Setup-1.8.10.exe) | 85320539 | 88d145fc4a1a6217f798bd0359751b4bba7d0e9615fe4e49e0bff845478114e3 |
| 1.8.11 | Canonical automatic installer | [minjund/Whitebox / v1.8.11 / Whitebox-Setup-1.8.11.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.11/Whitebox-Setup-1.8.11.exe) | 85400839 | f6a46fe7b7293f78b86864a3a5a81e37cfc9dcf79d1a559968214edfdabe79e5 |
| 1.8.12 | Canonical automatic installer | [minjund/Whitebox / v1.8.12 / Whitebox-Setup-1.8.12.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.12/Whitebox-Setup-1.8.12.exe) | 85355105 | 1f7a96730e597c63871db5e28025b67cbddca0d798932380ed983c044bd41a86 |
| 1.8.13 | Canonical automatic installer | [minjund/Whitebox / v1.8.13 / Whitebox-Setup-1.8.13.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.13/Whitebox-Setup-1.8.13.exe) | 85362357 | 3504fb78d0d5ef5d278ef027b1a51d464289b923e08dd1fbaf3ba827b8b31482 |
| 1.8.14 | Canonical automatic installer | [minjund/Whitebox / v1.8.14 / Whitebox-Setup-1.8.14.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.14/Whitebox-Setup-1.8.14.exe) | 85367761 | 3b364b5274d85a3d80f41183970ef997f5322d70af60f8aac7d2c1a5bed421f0 |
| 1.8.15 | Canonical automatic installer | [minjund/Whitebox / v1.8.15 / Whitebox-Setup-1.8.15.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.15/Whitebox-Setup-1.8.15.exe) | 84924462 | 99d978b2b68f3873ec384efb20c0f8c2abb9c030c70ce9f3a0a012aa3c9091ad |
| 1.8.17 | Canonical automatic installer | [minjund/Whitebox / v1.8.17 / Whitebox-Setup-1.8.17.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.17/Whitebox-Setup-1.8.17.exe) | 85132115 | 17426dfb12f92796d676fe9e94eed06b049ebb67c70104378cc10d731c3c8f69 |
| 1.8.16 | Canonical automatic installer | [minjund/Whitebox / v1.8.16 / Whitebox-Setup-1.8.16.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.16/Whitebox-Setup-1.8.16.exe) | 84684379 | 2876e462f1816b68c3fd045b9ab8ee5c13e97c922db4ae3cad18c9476707b921 |
| 1.8.18 | Canonical automatic installer | [minjund/Whitebox / v1.8.18 / Whitebox-Setup-1.8.18.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.18/Whitebox-Setup-1.8.18.exe) | 95328726 | 1e012b0397e90477c86c2c946dd4aac4cb4c9e71e8e8910acd6a6877287cbc2a |
| 1.8.19 | Canonical automatic installer | [minjund/Whitebox / v1.8.19 / Whitebox-Setup-1.8.19.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.19/Whitebox-Setup-1.8.19.exe) | 95367957 | 74e7845e1d8432e577a1ecb2e631c5328a7024eb2d1c813cbeeb5e05ef84791a |
| 2.0.1 | Canonical automatic installer | [minjund/Whitebox / v2.0.1 / Whitebox-Setup-2.0.1.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.1/Whitebox-Setup-2.0.1.exe) | 95469345 | e7623907bede47f76550de2eb6a3347bb07f2c2ee3e875db89f905b84f9ce4eb |

Canonical Whitebox-Setup-2.0.3.exe and Whitebox-Manual-Setup-2.0.3-x64.exe
must contain identical verified bytes. The public-latest attestation is pinned
to v2.0.1 (95,469,345 bytes; SHA-256
e7623907bede47f76550de2eb6a3347bb07f2c2ee3e875db89f905b84f9ce4eb).
Official v1.8.32 remains a separately exercised source cohort.

## Immutable legacy bridge

Published LoadToAgent 1.6.3–1.6.14 and 1.6.16–1.6.22 use the immutable official
1.6.23 bridge. Version 1.6.15 was never published. The 19 official installer pins
and packaged-updater comparisons remain in [the legacy audit](UPDATE-COMPATIBILITY-AUDIT-2026-08-24.md).
The full bridge path runs separately for this candidate with fresh state:

| Hop | Repository / tag / filename | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Installed source | [minjund/Whitebox / v1.6.3 / LoadToAgent-Setup-1.6.3.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.3/LoadToAgent-Setup-1.6.3.exe) | 92488826 | e38c38698335c2eec4aef8c6da6f1629470addaff1b881fe961172644c86db0f |
| Immutable bridge | [minjund/LodeToAgent / v1.6.23 / LoadToAgent-Setup-1.6.23.exe](https://github.com/minjund/LodeToAgent/releases/download/v1.6.23/LoadToAgent-Setup-1.6.23.exe) | 94506459 | 29e90370acd3a6f00d3da4a82a79045cf235e716dcccbbf34b2d2b4db9f4e112 |

## Required evidence

The latest installed source runs first without dropping any other cohort.
The official 2.0.1 installer above was downloaded and verified before extracting
its app.asar (package version 2.0.1). Its main.js SHA-256 is
2c1ddd10e1172ffff1a9e7c4af68f8a10c4791fd6d9dd6009c03cf8616424bea;
its renderer/terminal-workspace.js SHA-256 is
49bd93e7049f3cdf07d2ca56ba0660db2253d639a3a7fa29143e71e96e7b3387.
The packaged renderer creates a startup shell, and the packaged window-close
handler retains the app in its tray while background work remains. The
low-level idle-parent fixture therefore closes only that authenticated source
workspace's startup shells before requesting graceful window close. This is
the same preparation used for candidate reinstall; host and shell identity,
30-second graceful shutdown, relaunch and cleanup requirements remain strict.
The separate packaged-button scenario continues to preserve a live PTY.

The release record must identify the exact 40-character candidate SHA and Actions
URLs. The Updater compatibility gate must pass on that candidate, including
v1.7.3, v1.7.4, v1.7.5 and the official legacy bridge, with no skipped attempts.
Every supported Whitebox source above must pass, including candidate updater
self-reinstallation. The tag Release must repeat the packaged tests before
publishing. Existing historical race exceptions remain narrowly scoped to
immutable clients; a timeout, ambiguous process or missing cleanup is a failure.

After publication, verify unauthenticated latest, stable release state, all
public asset HEADs, exact names, sizes and SHA-256 digests, canonical/manual byte
identity, and legacy selection. Until these results are recorded, this document
provides no release approval. Main protection must require the exact
Updater compatibility gate check.

Commands: npm run check:update:cohorts; npm run check:source; npm test;
node scripts/terminal-review-test.js; npm run test:accuracy; npm run check:package;
npm run test:update:win:frozen; npm run test:update:win:legacy-bridge;
EXPECTED_CURRENT_TAG=v2.0.3 npm run check:update:legacy.
