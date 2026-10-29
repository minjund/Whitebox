# Whitebox 2.0.8 release review

## Candidate scope

This release contains terminal input/polling optimizations, worker-based process
observation, bounded replay reads, stale-transport recovery, session-cache cleanup
and throttled asynchronous panel access-file refresh. It also contains the
approved settings/Jev changes, paged attention questions, AI activity indicators,
the responsive analysis toggle and removal of the obsolete dashboard frontend.

The candidate's exact 40-character SHA and successful workflow URLs must be
recorded in the PR/release receipt before approval. Local tests alone do not
approve an updater-sensitive release. No version/tag is reused or force-moved.

## Official installed-client matrix → 2.0.8

Every row is an official packaged input. The Windows workflow verifies the exact
repository/tag/filename, uploaded state, byte size and SHA-256, then extracts and
exercises its installed app.asar. The candidate self-reinstall is also tested.
All 51 listed sources run; frozen sources cannot be displaced by moving latest.

| Installed version | Selected candidate path | Official Windows source | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| 1.7.3 | Compatibility manual alias | [Whitebox-Setup-1.7.3.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.3/Whitebox-Setup-1.7.3.exe) | 85295741 | 6b14caec7baeca5d6048c32121b9d7361f2bd56828aa6228f2322bf32da6f574 |
| 1.7.4 | Compatibility manual alias | [Whitebox-Setup-1.7.4.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.4/Whitebox-Setup-1.7.4.exe) | 85296425 | 4d940cf16425436922a37746417b419c7671c47642c0f24b8c79197af99c2135 |
| 1.7.5 | Canonical automatic installer | [Whitebox-Setup-1.7.5.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.5/Whitebox-Setup-1.7.5.exe) | 85297926 | 3455b7c9aa9e7c520774995694dbcdb71678a0280a0fde2040693a00d38f2e68 |
| 1.7.0 | Compatibility manual alias | [Whitebox-Setup-1.7.0.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.0/Whitebox-Setup-1.7.0.exe) | 85126771 | 169d5ae5a01ab3baa07700086d9527b1916c23fc0c6640a78e9b4612cc917c13 |
| 1.7.1 | Compatibility manual alias | [Whitebox-Setup-1.7.1.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.1/Whitebox-Setup-1.7.1.exe) | 85126828 | b60464bd04ad77f93e79b3fbe073c17ca0a102021dc87f9845587476ea53c6b3 |
| 1.7.2 | Compatibility manual alias | [Whitebox-Setup-1.7.2.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.2/Whitebox-Setup-1.7.2.exe) | 85126852 | e932e606e590e31f0e91f68ebe49b26d4a7fcdc3681c92192d32da6e10f9d227 |
| 2.0.7 | Canonical automatic installer | [Whitebox-Setup-2.0.7.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.7/Whitebox-Setup-2.0.7.exe) | 95751081 | 985c7a9cc874a70112b24593f557861eeba113f05f20be35687177ebd37c4d42 |
| 2.0.6 | Canonical automatic installer | [Whitebox-Setup-2.0.6.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.6/Whitebox-Setup-2.0.6.exe) | 95743060 | 8bd9302953f48d8d8bb585df13493e2c43ed6ba93b032db30168f2f94c1e8a95 |
| 2.0.5 | Canonical automatic installer | [Whitebox-Setup-2.0.5.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.5/Whitebox-Setup-2.0.5.exe) | 95695095 | 01c947758ca0cca5f1720685b7aca565ef916502ff185a839e37cb9cf7dab3e2 |
| 2.0.4 | Canonical automatic installer | [Whitebox-Setup-2.0.4.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.4/Whitebox-Setup-2.0.4.exe) | 95657467 | aa296e5ee28d0bbdfa44568c464964c83a6dd59dccdae9725f9a00614ac4d5d8 |
| 2.0.3 | Canonical automatic installer | [Whitebox-Setup-2.0.3.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.3/Whitebox-Setup-2.0.3.exe) | 95668333 | 1cc9393140660eec30c8868f7e878f68e073f5f9d56af63e08daa3f23d21cbb1 |
| 2.0.1 | Canonical automatic installer | [Whitebox-Setup-2.0.1.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.1/Whitebox-Setup-2.0.1.exe) | 95469345 | e7623907bede47f76550de2eb6a3347bb07f2c2ee3e875db89f905b84f9ce4eb |
| 1.8.32 | Canonical automatic installer | [Whitebox-Setup-1.8.32.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.32/Whitebox-Setup-1.8.32.exe) | 95389352 | bdfb2ba055807854eb55da998674deeeb2421c9877079b21e96e0a75389e01c8 |
| 1.8.31 | Canonical automatic installer | [Whitebox-Setup-1.8.31.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.31/Whitebox-Setup-1.8.31.exe) | 95424942 | b579d7a82b3c94f5a985b4adb4c2ce93c619c28c40bc9c93a1a02faac9cefc31 |
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

Published LoadToAgent 1.6.3–1.6.14 and 1.6.16–1.6.22 use the immutable official
1.6.23 bridge, then the current canonical installer. Version 1.6.15 was not
published. Packaged equivalence evidence is retained in
[LEGACY-UPDATE-BRIDGE.md](LEGACY-UPDATE-BRIDGE.md); no equivalence is inferred from
current source. The representative full v1.6.3 → official immutable v1.6.23 →
2.0.8 path runs independently with fresh owned state and strict cleanup checks.

| Legacy hop | Official source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| 1.6.3 | [LoadToAgent-Setup-1.6.3.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.3/LoadToAgent-Setup-1.6.3.exe) | 92488826 | e38c38698335c2eec4aef8c6da6f1629470addaff1b881fe961172644c86db0f |
| Immutable bridge 1.6.23 | [LoadToAgent-Setup-1.6.23.exe](https://github.com/minjund/LodeToAgent/releases/download/v1.6.23/LoadToAgent-Setup-1.6.23.exe) | 94506459 | 29e90370acd3a6f00d3da4a82a79045cf235e716dcccbbf34b2d2b4db9f4e112 |

## macOS packaged sources

The existing official 1.7.3, 1.8.4, 1.8.5, 1.8.6, 2.0.1 and 2.0.6 DMG
checks remain. Add official 2.0.7 on both architectures with these exact pins:

| Official source | Bytes | SHA-256 |
| --- | ---: | --- |
| [Whitebox-2.0.7-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.7/Whitebox-2.0.7-arm64.dmg) | 123048036 | 651d3a48e68e46f5042c63b90bca48ad6f5ed366ac38bf5f078bedaeca528a23 |
| [Whitebox-2.0.7-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.7/Whitebox-2.0.7-x64.dmg) | 126840377 | 49bbe771509b644865920dd2ec6e2fafa80b302690e3d70610795925bf5c93a0 |

The official Windows 2.0.7 idle-parent attempt uses the production authenticated
terminal host, just like the other pinned 2.0 workspace sources. Only fresh
startup shells owned by that fixture are closed. It receives no cold-start reload
exception and no installer, acknowledgement, relaunch or cleanup deadline change.
The separate packaged button path must preserve a live PTY.

## Required release evidence

- PR gate on the exact candidate SHA: Desktop CI and the always-created
  **Updater compatibility gate**, including packaged v1.7.3/v1.7.4 manual,
  official fixed v1.7.5 automatic, candidate automatic self-reinstall and the
  official legacy bridge path. Every other supported matrix row must pass too.
- Repeat packaged attempts in the tag workflow before publication; failures,
  timeouts, missing jobs or missing cleanup remain blockers.
- Verify macOS Intel and ARM64 artifacts and packaged update cohorts.
- Verify the complete seven-asset draft and identical canonical/manual installer
  bytes, then publish only through the verified workflow.
- After publication, verify unauthenticated latest, public HEAD metadata, asset
  names/sizes/digests, non-draft/non-prerelease state and legacy selection.

## Current preparation

The previous-latest attestation is pinned to official v2.0.7. Its canonical
Windows installer was downloaded and locally verified at 95,751,081 bytes with
SHA-256 985c7a9cc874a70112b24593f557861eeba113f05f20be35687177ebd37c4d42.
Both official 2.0.6 and 2.0.7 remain explicit matrix rows. The release automation
provides the authoritative pass/fail evidence; this preparation document is not
an approval.
