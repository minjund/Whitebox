# 2.0.13 compatibility and release record

Candidate is based on immutable v2.0.12 commit 16e8f384b437714f40d23d6c11f0a8478a62cbdc.
Only terminal creation, drag/drop handling, compact popup presentation, version
metadata and compatibility-test inputs change. Existing 2.0.12 settings, review
logic, process workers, VT paste handling, completion badges, app identity,
profile paths, terminal host protocol and stored layout schema remain intact.

Local tests do not approve a release. Publication requires the exact candidate
SHA to pass the required Updater compatibility gate and all tag release checks.
Run URLs, candidate SHA and post-publication channel results belong in the PR
and release record. No skipped, timed-out or cancelled attempt is a pass.

## Windows: every supported published Whitebox source → 2.0.13

Each row is tested independently from the pinned official installer and its
installed app.asar. No shared-behavior equivalence is inferred from source tags.
The candidate updater also reinstalls the same candidate on each packaged path.
The 2.0.12 row explicitly covers the currently published client.

| Installed version | Packaged implementation/path to 2.0.13 | Official installer | Bytes | SHA-256 |
|---|---|---|---:|---|
| 1.7.3 | official packaged updater → manual alias | [Whitebox-Setup-1.7.3.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.3/Whitebox-Setup-1.7.3.exe) | 85295741 | 6b14caec7baeca5d6048c32121b9d7361f2bd56828aa6228f2322bf32da6f574 |
| 1.7.4 | official packaged updater → manual alias | [Whitebox-Setup-1.7.4.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.4/Whitebox-Setup-1.7.4.exe) | 85296425 | 4d940cf16425436922a37746417b419c7671c47642c0f24b8c79197af99c2135 |
| 1.7.5 | official packaged updater → canonical Setup | [Whitebox-Setup-1.7.5.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.5/Whitebox-Setup-1.7.5.exe) | 85297926 | 3455b7c9aa9e7c520774995694dbcdb71678a0280a0fde2040693a00d38f2e68 |
| 1.7.0 | official packaged updater → manual alias | [Whitebox-Setup-1.7.0.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.0/Whitebox-Setup-1.7.0.exe) | 85126771 | 169d5ae5a01ab3baa07700086d9527b1916c23fc0c6640a78e9b4612cc917c13 |
| 1.7.1 | official packaged updater → manual alias | [Whitebox-Setup-1.7.1.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.1/Whitebox-Setup-1.7.1.exe) | 85126828 | b60464bd04ad77f93e79b3fbe073c17ca0a102021dc87f9845587476ea53c6b3 |
| 1.7.2 | official packaged updater → manual alias | [Whitebox-Setup-1.7.2.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.2/Whitebox-Setup-1.7.2.exe) | 85126852 | e932e606e590e31f0e91f68ebe49b26d4a7fcdc3681c92192d32da6e10f9d227 |
| 2.0.11 | official packaged updater → canonical Setup | [Whitebox-Setup-2.0.11.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.11/Whitebox-Setup-2.0.11.exe) | 95385533 | b077c05bc34e0a17053400c99049c6e1709632e01b28cfeae194f4efd4549a4f |
| 2.0.10 | official packaged updater → canonical Setup | [Whitebox-Setup-2.0.10.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.10/Whitebox-Setup-2.0.10.exe) | 95387706 | aa963b367a03be44e19ceeca9f98c225a9781d6d7f21efabd83251f97edabd4a |
| 2.0.9 | official packaged updater → canonical Setup | [Whitebox-Setup-2.0.9.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.9/Whitebox-Setup-2.0.9.exe) | 95414888 | 024ba94403c566102a042fa3771f885ed62f2cae1980b74cb8b0ad201b61247d |
| 2.0.8 | official packaged updater → canonical Setup | [Whitebox-Setup-2.0.8.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.8/Whitebox-Setup-2.0.8.exe) | 95420301 | fd2c6642c4bb3d32b8afb58f81e4fc3919fbacafc624fb595624b1307887fd97 |
| 2.0.7 | official packaged updater → canonical Setup | [Whitebox-Setup-2.0.7.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.7/Whitebox-Setup-2.0.7.exe) | 95751081 | 985c7a9cc874a70112b24593f557861eeba113f05f20be35687177ebd37c4d42 |
| 2.0.6 | official packaged updater → canonical Setup | [Whitebox-Setup-2.0.6.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.6/Whitebox-Setup-2.0.6.exe) | 95743060 | 8bd9302953f48d8d8bb585df13493e2c43ed6ba93b032db30168f2f94c1e8a95 |
| 2.0.5 | official packaged updater → canonical Setup | [Whitebox-Setup-2.0.5.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.5/Whitebox-Setup-2.0.5.exe) | 95695095 | 01c947758ca0cca5f1720685b7aca565ef916502ff185a839e37cb9cf7dab3e2 |
| 2.0.4 | official packaged updater → canonical Setup | [Whitebox-Setup-2.0.4.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.4/Whitebox-Setup-2.0.4.exe) | 95657467 | aa296e5ee28d0bbdfa44568c464964c83a6dd59dccdae9725f9a00614ac4d5d8 |
| 2.0.3 | official packaged updater → canonical Setup | [Whitebox-Setup-2.0.3.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.3/Whitebox-Setup-2.0.3.exe) | 95668333 | 1cc9393140660eec30c8868f7e878f68e073f5f9d56af63e08daa3f23d21cbb1 |
| 2.0.1 | official packaged updater → canonical Setup | [Whitebox-Setup-2.0.1.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.1/Whitebox-Setup-2.0.1.exe) | 95469345 | e7623907bede47f76550de2eb6a3347bb07f2c2ee3e875db89f905b84f9ce4eb |
| 1.8.32 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.32.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.32/Whitebox-Setup-1.8.32.exe) | 95389352 | bdfb2ba055807854eb55da998674deeeb2421c9877079b21e96e0a75389e01c8 |
| 1.8.31 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.31.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.31/Whitebox-Setup-1.8.31.exe) | 95424942 | b579d7a82b3c94f5a985b4adb4c2ce93c619c28c40bc9c93a1a02faac9cefc31 |
| 1.8.30 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.30.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.30/Whitebox-Setup-1.8.30.exe) | 95409618 | 46639eb2d2bc9c5593b77cd1f3a5cd5cd1411ae17eec60b911037a25af459e82 |
| 1.8.28 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.28.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.28/Whitebox-Setup-1.8.28.exe) | 95397289 | 7fc94cd9a60db6481873d49435dcd2801bdeca7a1ff78568e1fbb855cad46442 |
| 1.8.27 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.27.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.27/Whitebox-Setup-1.8.27.exe) | 95353762 | f2c6c5fdfeee7f395137f055597982e2dd8f9c4f813902da770a4edee6f5478a |
| 1.8.25 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.25.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.25/Whitebox-Setup-1.8.25.exe) | 95355956 | 57d47a488352d1058397549f860fe496af9a8f311b1db8d9a1aa1aafaa64510c |
| 1.8.24 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.24.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.24/Whitebox-Setup-1.8.24.exe) | 95320703 | 4e3a56eb25c5fb8002fb067b2d371094606552ebc82db01ccf4b7e622c3efa06 |
| 1.8.20 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.20.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.20/Whitebox-Setup-1.8.20.exe) | 95366645 | 35baa58fe1399f1954d8f88ac6a4877dfa2675d1e5c96ed751add8b9bb510b5a |
| 1.8.21 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.21.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.21/Whitebox-Setup-1.8.21.exe) | 95377747 | 36213f39f66d18d10384fd070c1befdbb0b56259e88ebd1f9ce6d749a8d5bbf5 |
| 1.8.22 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.22.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.22/Whitebox-Setup-1.8.22.exe) | 95319223 | f9e74a59f59e423168c01db3719e1063b4e77a7afdf6f308263880d3d630c110 |
| 1.8.23 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.23.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.23/Whitebox-Setup-1.8.23.exe) | 95322488 | 8c612ba145e5df06cf15d2d6b9b415c6f8333d08efc7b7ab8156a195d3091d4d |
| 1.7.6 | official packaged updater → canonical Setup | [Whitebox-Setup-1.7.6.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.6/Whitebox-Setup-1.7.6.exe) | 85321320 | 0fda64f5cf6e051c70e417b39489797125720d84b31e8422c3d168faa3d7f341 |
| 1.7.8 | official packaged updater → canonical Setup | [Whitebox-Setup-1.7.8.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.8/Whitebox-Setup-1.7.8.exe) | 85325513 | ff3d775449c6a670e0a3cc9f28f9af0e2dfdf371f500cdaa5d5daff03d7f5311 |
| 1.7.9 | official packaged updater → canonical Setup | [Whitebox-Setup-1.7.9.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.9/Whitebox-Setup-1.7.9.exe) | 85325656 | ff68ea266100f683354f9020b9560b51ebf001efc520fa1a997d00b44a43ac81 |
| 1.7.11 | official packaged updater → canonical Setup | [Whitebox-Setup-1.7.11.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.11/Whitebox-Setup-1.7.11.exe) | 85327244 | f126797cdcae732d99225b3df7613bafa983b9dbc870d0068f368d8f7ac73178 |
| 1.7.12 | official packaged updater → canonical Setup | [Whitebox-Setup-1.7.12.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.12/Whitebox-Setup-1.7.12.exe) | 85335488 | 07610ac268a0932d70eaeb44a61a775daed9482b7409d53aa46dc6200200e75d |
| 1.7.13 | official packaged updater → canonical Setup | [Whitebox-Setup-1.7.13.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.13/Whitebox-Setup-1.7.13.exe) | 85244079 | 5e731d5b7434634f421ca32f40a36101b469d06286ecded690eba5afe5fe18bd |
| 1.7.14 | official packaged updater → canonical Setup | [Whitebox-Setup-1.7.14.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.14/Whitebox-Setup-1.7.14.exe) | 85246819 | aaa2cb066fcefccf9fff36ff3757b04b3df2df4be8b2a430c5f69c28d7d0a187 |
| 1.7.15 | official packaged updater → canonical Setup | [Whitebox-Setup-1.7.15.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.15/Whitebox-Setup-1.7.15.exe) | 85266395 | f2ae2cecd39b1bd324735f92dde348d1f6fd8e6ddf1616d1054b514d0a0d583f |
| 1.7.16 | official packaged updater → canonical Setup | [Whitebox-Setup-1.7.16.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.16/Whitebox-Setup-1.7.16.exe) | 85268679 | 896e2e950a492234dc463865f087ae9ab4184ce20558bfdf7a92e934bf009e04 |
| 1.8.2 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.2.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.2/Whitebox-Setup-1.8.2.exe) | 85298702 | de9389e3e11a00e8d9ac8d4c31935b097c75b1cf8c4f285073177d67330291ae |
| 1.8.3 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.3.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.3/Whitebox-Setup-1.8.3.exe) | 85299286 | 8ff9f8895183f45fdc76d14e1413ea741a9b938645920f2629743c42d1931347 |
| 1.8.4 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.4.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.4/Whitebox-Setup-1.8.4.exe) | 85300893 | 79a922dc265aaeab7a5d7d30cd763d0446eba6f162eae703e2c714b05b12955d |
| 1.8.5 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.5.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.5/Whitebox-Setup-1.8.5.exe) | 85301431 | 7b769ba143c4d70eb312a88b8994f963737cda49ff621b0070ea3231eb1666c2 |
| 1.8.1 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.1.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.1/Whitebox-Setup-1.8.1.exe) | 85298672 | d62511bc82dfdab4b4b851cc0c180f4ac0d04aa2baef0f82145e246c1aa2dd91 |
| 1.8.6 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.6.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.6/Whitebox-Setup-1.8.6.exe) | 85301256 | 401254235581031ffdc14e3bcbc7d8bb315c9300a3e9ccd575e9ffb15a4e443a |
| 1.8.7 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.7.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.7/Whitebox-Setup-1.8.7.exe) | 85302264 | 1a0d8ddf8ee4f373e5620ffa416cc697ae034c8e38090502034984462b861047 |
| 1.8.8 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.8.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.8/Whitebox-Setup-1.8.8.exe) | 85303444 | 25d9406df0a3c27ce1f5846fcb9965b42f73727caf109b4be11b50b2af39810a |
| 1.8.9 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.9.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.9/Whitebox-Setup-1.8.9.exe) | 85321051 | 8b95949603129c66431ac11c4e1ba9a2fb559b56ca3b8e616fa00dff96b0eb0e |
| 1.8.10 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.10.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.10/Whitebox-Setup-1.8.10.exe) | 85320539 | 88d145fc4a1a6217f798bd0359751b4bba7d0e9615fe4e49e0bff845478114e3 |
| 1.8.11 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.11.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.11/Whitebox-Setup-1.8.11.exe) | 85400839 | f6a46fe7b7293f78b86864a3a5a81e37cfc9dcf79d1a559968214edfdabe79e5 |
| 1.8.12 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.12.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.12/Whitebox-Setup-1.8.12.exe) | 85355105 | 1f7a96730e597c63871db5e28025b67cbddca0d798932380ed983c044bd41a86 |
| 1.8.13 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.13.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.13/Whitebox-Setup-1.8.13.exe) | 85362357 | 3504fb78d0d5ef5d278ef027b1a51d464289b923e08dd1fbaf3ba827b8b31482 |
| 1.8.14 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.14.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.14/Whitebox-Setup-1.8.14.exe) | 85367761 | 3b364b5274d85a3d80f41183970ef997f5322d70af60f8aac7d2c1a5bed421f0 |
| 1.8.15 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.15.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.15/Whitebox-Setup-1.8.15.exe) | 84924462 | 99d978b2b68f3873ec384efb20c0f8c2abb9c030c70ce9f3a0a012aa3c9091ad |
| 1.8.17 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.17.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.17/Whitebox-Setup-1.8.17.exe) | 85132115 | 17426dfb12f92796d676fe9e94eed06b049ebb67c70104378cc10d731c3c8f69 |
| 1.8.16 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.16.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.16/Whitebox-Setup-1.8.16.exe) | 84684379 | 2876e462f1816b68c3fd045b9ab8ee5c13e97c922db4ae3cad18c9476707b921 |
| 1.8.18 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.18.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.18/Whitebox-Setup-1.8.18.exe) | 95328726 | 1e012b0397e90477c86c2c946dd4aac4cb4c9e71e8e8910acd6a6877287cbc2a |
| 1.8.19 | official packaged updater → canonical Setup | [Whitebox-Setup-1.8.19.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.19/Whitebox-Setup-1.8.19.exe) | 95367957 | 74e7845e1d8432e577a1ecb2e631c5328a7024eb2d1c813cbeeb5e05ef84791a |
| 2.0.12 | official packaged updater → canonical Setup | [Whitebox-Setup-2.0.12.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.12/Whitebox-Setup-2.0.12.exe) | 95401887 | 2c8ca13978ec94f4e35ab09694280556321a396e665cd0ca39378351d02e1249 |

The shard plan covers 56 exact Whitebox sources and a separate legacy VM.
All cohorts are retained when previousFixed advances from 2.0.11 to 2.0.12.

## Legacy installed cohorts → immutable bridge → 2.0.13

Published LoadToAgent 1.6.3–1.6.14 and 1.6.16–1.6.22 use immutable
[1.6.23 bridge](https://github.com/minjund/LodeToAgent/releases/tag/v1.6.23).
1.6.15 was never published. Official package equivalence for these 19 clients
is recorded in docs/UPDATE-COMPATIBILITY-AUDIT-2026-08-24.md and the existing
legacy audit evidence; it is not inferred from the candidate tree.
The representative full path starts with the official
[LoadToAgent-Setup-1.6.3.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.3/LoadToAgent-Setup-1.6.3.exe),
92488826 bytes, SHA-256 e38c38698335c2eec4aef8c6da6f1629470addaff1b881fe961172644c86db0f.
The bridge installer is 94506459 bytes, SHA-256
29e90370acd3a6f00d3da4a82a79045cf235e716dcccbbf34b2d2b4db9f4e112.
The existing same-run relaunch, readiness, process identity and cleanup grammar
remains mandatory for both hops and the candidate reinstall.

## Official macOS 2.0.12 → 2.0.13 and candidate reinstall

| Architecture | Official installer | Bytes | SHA-256 |
|---|---|---:|---|
| arm64 | [Whitebox-2.0.12-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.12/Whitebox-2.0.12-arm64.dmg) | 122565597 | e52dea2455e99757b62bc9a4e0fea98dcb7a0b6fa6f040b61eb6e699d8bbedf7 |
| x64 | [Whitebox-2.0.12-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.12/Whitebox-2.0.12-x64.dmg) | 126331391 | 0342ef2a5789f9c09eaf38db004d50e31fe3500295c674aa77344c816b3fae09 |

Both architectures retain all earlier Mac cohort attempts. Each attempt uses
fresh isolated application/profile paths and verifies preserved sentinel data,
installed app.asar version, renderer readiness, relaunch and exact cleanup.

## Required final evidence

- Required repository check: Updater compatibility gate on main.
- Exact candidate SHA and complete premerge and tag-release shard receipts.
- Explicit passing 1.7.3, 1.7.4, 1.7.5, legacy bridge and 2.0.12 packaged attempts.
- Both Mac architecture release/check results.
- Unauthenticated live latest API and public asset HEAD size/digest checks.
- Canonical Setup and manual alias verified byte-identical.
