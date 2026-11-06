# Whitebox 2.0.22 compatibility review

Status: candidate preparation; not approved for publication until exact-SHA packaged checks pass.

Summary delivery/state and local 2048 change in this candidate. Shared rankings are deferred. Updater product code is unchanged; version metadata and the official installed-source matrix advance to 2.0.22.

Every listed source must exercise its official packaged app.asar updater. Each attempt includes discovery/complete asset selection, verified download, installed version, helper acknowledgement, renderer-ready relaunch, candidate self-reinstallation and owned-process/artifact cleanup. Missing, skipped or timed-out attempts block publication.

## Windows installed sources → 2.0.22

65 official Whitebox sources plus the official legacy bridge path. Frozen 1.7.3/1.7.4 use the manual alias, 1.7.5+ use canonical automatic Setup; early manual cohorts remain covered.

| Installed version | Path | Exact official installer | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| 1.7.3 | manual | [Whitebox-Setup-1.7.3.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.3/Whitebox-Setup-1.7.3.exe) | 85295741 | `6b14caec7baeca5d6048c32121b9d7361f2bd56828aa6228f2322bf32da6f574` |
| 1.7.4 | manual | [Whitebox-Setup-1.7.4.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.4/Whitebox-Setup-1.7.4.exe) | 85296425 | `4d940cf16425436922a37746417b419c7671c47642c0f24b8c79197af99c2135` |
| 1.7.5 | automatic | [Whitebox-Setup-1.7.5.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.5/Whitebox-Setup-1.7.5.exe) | 85297926 | `3455b7c9aa9e7c520774995694dbcdb71678a0280a0fde2040693a00d38f2e68` |
| 1.7.0 | manual | [Whitebox-Setup-1.7.0.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.0/Whitebox-Setup-1.7.0.exe) | 85126771 | `169d5ae5a01ab3baa07700086d9527b1916c23fc0c6640a78e9b4612cc917c13` |
| 1.7.1 | manual | [Whitebox-Setup-1.7.1.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.1/Whitebox-Setup-1.7.1.exe) | 85126828 | `b60464bd04ad77f93e79b3fbe073c17ca0a102021dc87f9845587476ea53c6b3` |
| 1.7.2 | manual | [Whitebox-Setup-1.7.2.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.2/Whitebox-Setup-1.7.2.exe) | 85126852 | `e932e606e590e31f0e91f68ebe49b26d4a7fcdc3681c92192d32da6e10f9d227` |
| 2.0.20 | automatic | [Whitebox-Setup-2.0.20.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.20/Whitebox-Setup-2.0.20.exe) | 95467639 | `56f5d8f1a9199e756aeda096acce357d2df4d069ba958c293f2d2bb91a37df31` |
| 2.0.19 | automatic | [Whitebox-Setup-2.0.19.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.19/Whitebox-Setup-2.0.19.exe) | 95421720 | `e4f04efab4c99ed12ad41d7856125a74314e340fc64b34be69f5ad855db00fa8` |
| 2.0.18 | automatic | [Whitebox-Setup-2.0.18.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.18/Whitebox-Setup-2.0.18.exe) | 95411152 | `7335f783f14510ba95b5fc0c570cf27a5bbeb7001fc42aa11961fa4a2c631b59` |
| 2.0.17 | automatic | [Whitebox-Setup-2.0.17.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.17/Whitebox-Setup-2.0.17.exe) | 95443613 | `af429887b07828a829a02661e03bb19595a569f10419900085b9d221b9506b4c` |
| 2.0.16 | automatic | [Whitebox-Setup-2.0.16.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.16/Whitebox-Setup-2.0.16.exe) | 95450488 | `c42f35359e7b744eb03b6af7009f16ca81c86cbc34aabf999288fd024a3321b4` |
| 2.0.15 | automatic | [Whitebox-Setup-2.0.15.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.15/Whitebox-Setup-2.0.15.exe) | 95403299 | `90948fc801cf3d0afc5b9458631665f805c943e11d621369252e58c45df73165` |
| 2.0.14 | automatic | [Whitebox-Setup-2.0.14.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.14/Whitebox-Setup-2.0.14.exe) | 95403670 | `8cc7654d6256f87b52b011817ff7eb77bd5af273a075b2771f8672a7893066f9` |
| 2.0.13 | automatic | [Whitebox-Setup-2.0.13.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.13/Whitebox-Setup-2.0.13.exe) | 95394827 | `cf3bd1cfcd29879d5e3bbcb510341e3b15dc86ba45039682f6c5d22637be69c1` |
| 2.0.12 | automatic | [Whitebox-Setup-2.0.12.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.12/Whitebox-Setup-2.0.12.exe) | 95401887 | `2c8ca13978ec94f4e35ab09694280556321a396e665cd0ca39378351d02e1249` |
| 2.0.11 | automatic | [Whitebox-Setup-2.0.11.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.11/Whitebox-Setup-2.0.11.exe) | 95385533 | `b077c05bc34e0a17053400c99049c6e1709632e01b28cfeae194f4efd4549a4f` |
| 2.0.10 | automatic | [Whitebox-Setup-2.0.10.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.10/Whitebox-Setup-2.0.10.exe) | 95387706 | `aa963b367a03be44e19ceeca9f98c225a9781d6d7f21efabd83251f97edabd4a` |
| 2.0.9 | automatic | [Whitebox-Setup-2.0.9.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.9/Whitebox-Setup-2.0.9.exe) | 95414888 | `024ba94403c566102a042fa3771f885ed62f2cae1980b74cb8b0ad201b61247d` |
| 2.0.8 | automatic | [Whitebox-Setup-2.0.8.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.8/Whitebox-Setup-2.0.8.exe) | 95420301 | `fd2c6642c4bb3d32b8afb58f81e4fc3919fbacafc624fb595624b1307887fd97` |
| 2.0.7 | automatic | [Whitebox-Setup-2.0.7.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.7/Whitebox-Setup-2.0.7.exe) | 95751081 | `985c7a9cc874a70112b24593f557861eeba113f05f20be35687177ebd37c4d42` |
| 2.0.6 | automatic | [Whitebox-Setup-2.0.6.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.6/Whitebox-Setup-2.0.6.exe) | 95743060 | `8bd9302953f48d8d8bb585df13493e2c43ed6ba93b032db30168f2f94c1e8a95` |
| 2.0.5 | automatic | [Whitebox-Setup-2.0.5.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.5/Whitebox-Setup-2.0.5.exe) | 95695095 | `01c947758ca0cca5f1720685b7aca565ef916502ff185a839e37cb9cf7dab3e2` |
| 2.0.4 | automatic | [Whitebox-Setup-2.0.4.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.4/Whitebox-Setup-2.0.4.exe) | 95657467 | `aa296e5ee28d0bbdfa44568c464964c83a6dd59dccdae9725f9a00614ac4d5d8` |
| 2.0.3 | automatic | [Whitebox-Setup-2.0.3.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.3/Whitebox-Setup-2.0.3.exe) | 95668333 | `1cc9393140660eec30c8868f7e878f68e073f5f9d56af63e08daa3f23d21cbb1` |
| 2.0.1 | automatic | [Whitebox-Setup-2.0.1.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.1/Whitebox-Setup-2.0.1.exe) | 95469345 | `e7623907bede47f76550de2eb6a3347bb07f2c2ee3e875db89f905b84f9ce4eb` |
| 1.8.32 | automatic | [Whitebox-Setup-1.8.32.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.32/Whitebox-Setup-1.8.32.exe) | 95389352 | `bdfb2ba055807854eb55da998674deeeb2421c9877079b21e96e0a75389e01c8` |
| 1.8.31 | automatic | [Whitebox-Setup-1.8.31.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.31/Whitebox-Setup-1.8.31.exe) | 95424942 | `b579d7a82b3c94f5a985b4adb4c2ce93c619c28c40bc9c93a1a02faac9cefc31` |
| 1.8.30 | automatic | [Whitebox-Setup-1.8.30.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.30/Whitebox-Setup-1.8.30.exe) | 95409618 | `46639eb2d2bc9c5593b77cd1f3a5cd5cd1411ae17eec60b911037a25af459e82` |
| 1.8.28 | automatic | [Whitebox-Setup-1.8.28.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.28/Whitebox-Setup-1.8.28.exe) | 95397289 | `7fc94cd9a60db6481873d49435dcd2801bdeca7a1ff78568e1fbb855cad46442` |
| 1.8.27 | automatic | [Whitebox-Setup-1.8.27.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.27/Whitebox-Setup-1.8.27.exe) | 95353762 | `f2c6c5fdfeee7f395137f055597982e2dd8f9c4f813902da770a4edee6f5478a` |
| 1.8.25 | automatic | [Whitebox-Setup-1.8.25.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.25/Whitebox-Setup-1.8.25.exe) | 95355956 | `57d47a488352d1058397549f860fe496af9a8f311b1db8d9a1aa1aafaa64510c` |
| 1.8.24 | automatic | [Whitebox-Setup-1.8.24.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.24/Whitebox-Setup-1.8.24.exe) | 95320703 | `4e3a56eb25c5fb8002fb067b2d371094606552ebc82db01ccf4b7e622c3efa06` |
| 1.8.20 | automatic | [Whitebox-Setup-1.8.20.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.20/Whitebox-Setup-1.8.20.exe) | 95366645 | `35baa58fe1399f1954d8f88ac6a4877dfa2675d1e5c96ed751add8b9bb510b5a` |
| 1.8.21 | automatic | [Whitebox-Setup-1.8.21.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.21/Whitebox-Setup-1.8.21.exe) | 95377747 | `36213f39f66d18d10384fd070c1befdbb0b56259e88ebd1f9ce6d749a8d5bbf5` |
| 1.8.22 | automatic | [Whitebox-Setup-1.8.22.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.22/Whitebox-Setup-1.8.22.exe) | 95319223 | `f9e74a59f59e423168c01db3719e1063b4e77a7afdf6f308263880d3d630c110` |
| 1.8.23 | automatic | [Whitebox-Setup-1.8.23.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.23/Whitebox-Setup-1.8.23.exe) | 95322488 | `8c612ba145e5df06cf15d2d6b9b415c6f8333d08efc7b7ab8156a195d3091d4d` |
| 1.7.6 | automatic | [Whitebox-Setup-1.7.6.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.6/Whitebox-Setup-1.7.6.exe) | 85321320 | `0fda64f5cf6e051c70e417b39489797125720d84b31e8422c3d168faa3d7f341` |
| 1.7.8 | automatic | [Whitebox-Setup-1.7.8.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.8/Whitebox-Setup-1.7.8.exe) | 85325513 | `ff3d775449c6a670e0a3cc9f28f9af0e2dfdf371f500cdaa5d5daff03d7f5311` |
| 1.7.9 | automatic | [Whitebox-Setup-1.7.9.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.9/Whitebox-Setup-1.7.9.exe) | 85325656 | `ff68ea266100f683354f9020b9560b51ebf001efc520fa1a997d00b44a43ac81` |
| 1.7.11 | automatic | [Whitebox-Setup-1.7.11.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.11/Whitebox-Setup-1.7.11.exe) | 85327244 | `f126797cdcae732d99225b3df7613bafa983b9dbc870d0068f368d8f7ac73178` |
| 1.7.12 | automatic | [Whitebox-Setup-1.7.12.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.12/Whitebox-Setup-1.7.12.exe) | 85335488 | `07610ac268a0932d70eaeb44a61a775daed9482b7409d53aa46dc6200200e75d` |
| 1.7.13 | automatic | [Whitebox-Setup-1.7.13.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.13/Whitebox-Setup-1.7.13.exe) | 85244079 | `5e731d5b7434634f421ca32f40a36101b469d06286ecded690eba5afe5fe18bd` |
| 1.7.14 | automatic | [Whitebox-Setup-1.7.14.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.14/Whitebox-Setup-1.7.14.exe) | 85246819 | `aaa2cb066fcefccf9fff36ff3757b04b3df2df4be8b2a430c5f69c28d7d0a187` |
| 1.7.15 | automatic | [Whitebox-Setup-1.7.15.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.15/Whitebox-Setup-1.7.15.exe) | 85266395 | `f2ae2cecd39b1bd324735f92dde348d1f6fd8e6ddf1616d1054b514d0a0d583f` |
| 1.7.16 | automatic | [Whitebox-Setup-1.7.16.exe](https://github.com/minjund/Whitebox/releases/download/v1.7.16/Whitebox-Setup-1.7.16.exe) | 85268679 | `896e2e950a492234dc463865f087ae9ab4184ce20558bfdf7a92e934bf009e04` |
| 1.8.2 | automatic | [Whitebox-Setup-1.8.2.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.2/Whitebox-Setup-1.8.2.exe) | 85298702 | `de9389e3e11a00e8d9ac8d4c31935b097c75b1cf8c4f285073177d67330291ae` |
| 1.8.3 | automatic | [Whitebox-Setup-1.8.3.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.3/Whitebox-Setup-1.8.3.exe) | 85299286 | `8ff9f8895183f45fdc76d14e1413ea741a9b938645920f2629743c42d1931347` |
| 1.8.4 | automatic | [Whitebox-Setup-1.8.4.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.4/Whitebox-Setup-1.8.4.exe) | 85300893 | `79a922dc265aaeab7a5d7d30cd763d0446eba6f162eae703e2c714b05b12955d` |
| 1.8.5 | automatic | [Whitebox-Setup-1.8.5.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.5/Whitebox-Setup-1.8.5.exe) | 85301431 | `7b769ba143c4d70eb312a88b8994f963737cda49ff621b0070ea3231eb1666c2` |
| 1.8.1 | automatic | [Whitebox-Setup-1.8.1.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.1/Whitebox-Setup-1.8.1.exe) | 85298672 | `d62511bc82dfdab4b4b851cc0c180f4ac0d04aa2baef0f82145e246c1aa2dd91` |
| 1.8.6 | automatic | [Whitebox-Setup-1.8.6.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.6/Whitebox-Setup-1.8.6.exe) | 85301256 | `401254235581031ffdc14e3bcbc7d8bb315c9300a3e9ccd575e9ffb15a4e443a` |
| 1.8.7 | automatic | [Whitebox-Setup-1.8.7.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.7/Whitebox-Setup-1.8.7.exe) | 85302264 | `1a0d8ddf8ee4f373e5620ffa416cc697ae034c8e38090502034984462b861047` |
| 1.8.8 | automatic | [Whitebox-Setup-1.8.8.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.8/Whitebox-Setup-1.8.8.exe) | 85303444 | `25d9406df0a3c27ce1f5846fcb9965b42f73727caf109b4be11b50b2af39810a` |
| 1.8.9 | automatic | [Whitebox-Setup-1.8.9.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.9/Whitebox-Setup-1.8.9.exe) | 85321051 | `8b95949603129c66431ac11c4e1ba9a2fb559b56ca3b8e616fa00dff96b0eb0e` |
| 1.8.10 | automatic | [Whitebox-Setup-1.8.10.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.10/Whitebox-Setup-1.8.10.exe) | 85320539 | `88d145fc4a1a6217f798bd0359751b4bba7d0e9615fe4e49e0bff845478114e3` |
| 1.8.11 | automatic | [Whitebox-Setup-1.8.11.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.11/Whitebox-Setup-1.8.11.exe) | 85400839 | `f6a46fe7b7293f78b86864a3a5a81e37cfc9dcf79d1a559968214edfdabe79e5` |
| 1.8.12 | automatic | [Whitebox-Setup-1.8.12.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.12/Whitebox-Setup-1.8.12.exe) | 85355105 | `1f7a96730e597c63871db5e28025b67cbddca0d798932380ed983c044bd41a86` |
| 1.8.13 | automatic | [Whitebox-Setup-1.8.13.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.13/Whitebox-Setup-1.8.13.exe) | 85362357 | `3504fb78d0d5ef5d278ef027b1a51d464289b923e08dd1fbaf3ba827b8b31482` |
| 1.8.14 | automatic | [Whitebox-Setup-1.8.14.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.14/Whitebox-Setup-1.8.14.exe) | 85367761 | `3b364b5274d85a3d80f41183970ef997f5322d70af60f8aac7d2c1a5bed421f0` |
| 1.8.15 | automatic | [Whitebox-Setup-1.8.15.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.15/Whitebox-Setup-1.8.15.exe) | 84924462 | `99d978b2b68f3873ec384efb20c0f8c2abb9c030c70ce9f3a0a012aa3c9091ad` |
| 1.8.17 | automatic | [Whitebox-Setup-1.8.17.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.17/Whitebox-Setup-1.8.17.exe) | 85132115 | `17426dfb12f92796d676fe9e94eed06b049ebb67c70104378cc10d731c3c8f69` |
| 1.8.16 | automatic | [Whitebox-Setup-1.8.16.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.16/Whitebox-Setup-1.8.16.exe) | 84684379 | `2876e462f1816b68c3fd045b9ab8ee5c13e97c922db4ae3cad18c9476707b921` |
| 1.8.18 | automatic | [Whitebox-Setup-1.8.18.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.18/Whitebox-Setup-1.8.18.exe) | 95328726 | `1e012b0397e90477c86c2c946dd4aac4cb4c9e71e8e8910acd6a6877287cbc2a` |
| 1.8.19 | automatic | [Whitebox-Setup-1.8.19.exe](https://github.com/minjund/Whitebox/releases/download/v1.8.19/Whitebox-Setup-1.8.19.exe) | 95367957 | `74e7845e1d8432e577a1ecb2e631c5328a7024eb2d1c813cbeeb5e05ef84791a` |
| 2.0.21 | automatic | [Whitebox-Setup-2.0.21.exe](https://github.com/minjund/Whitebox/releases/download/v2.0.21/Whitebox-Setup-2.0.21.exe) | 95437694 | `1d229a94d3412d9d35281687699b87c279dfcd25fa20b42a2bfb2c2539c01f5c` |

## Immutable legacy cohorts → official 1.6.23 bridge → 2.0.22

The existing [official packaged audit](UPDATE-COMPATIBILITY-AUDIT-2026-08-24.md) records every source installer below, its extracted version and the byte comparisons of release channel, trust, selector and automatic-name projections. Full updater files are not assumed identical; that audit records their implementation groups and projection hashes. 1.6.15 was never published. This immutable evidence supports the representative fresh 1.6.3 → 1.6.23 → 2.0.22 Windows E2E; the new candidate still requires its own fresh end-to-end and self-reinstall proof.

| Installed version | Official installer | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| 1.6.3 | [LoadToAgent-Setup-1.6.3.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.3/LoadToAgent-Setup-1.6.3.exe) | 92488826 | `e38c38698335c2eec4aef8c6da6f1629470addaff1b881fe961172644c86db0f` |
| 1.6.4 | [LoadToAgent-Setup-1.6.4.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.4/LoadToAgent-Setup-1.6.4.exe) | 92488530 | `5455eab47a5a6596e7b7fef54e0f9e4ad86787ee92c4db18a6ac6fff61daa3dd` |
| 1.6.5 | [LoadToAgent-Setup-1.6.5.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.5/LoadToAgent-Setup-1.6.5.exe) | 92499267 | `208e1759fbbbcd671aaca63caca325c301ae0f400287b1953e6e1bf03cc85a73` |
| 1.6.6 | [LoadToAgent-Setup-1.6.6.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.6/LoadToAgent-Setup-1.6.6.exe) | 92509373 | `37b069e7f38c59661c1d7aa9be42b5355f340e2657d8661405f89699838fb515` |
| 1.6.7 | [LoadToAgent-Setup-1.6.7.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.7/LoadToAgent-Setup-1.6.7.exe) | 92510912 | `2624070bc566332bf52ac742137ad0665ec8660d2daea8444d791a311957727f` |
| 1.6.8 | [LoadToAgent-Setup-1.6.8.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.8/LoadToAgent-Setup-1.6.8.exe) | 92516194 | `1ea0d646fb21170b3073efb8ae1ec559c5ed0b204d2a49eb71ca8ff9ec537807` |
| 1.6.9 | [LoadToAgent-Setup-1.6.9.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.9/LoadToAgent-Setup-1.6.9.exe) | 92527075 | `6eae9d195d0026cd7a682b1d3c45a2a7bc2dbe7a4d2b3100bb9fdc0acd33fecc` |
| 1.6.10 | [LoadToAgent-Setup-1.6.10.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.10/LoadToAgent-Setup-1.6.10.exe) | 92530465 | `df5a5e2d1f3ef19886b96e124e6ebf7bf26a16089ef04b62164b65d5552fea66` |
| 1.6.11 | [LoadToAgent-Setup-1.6.11.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.11/LoadToAgent-Setup-1.6.11.exe) | 92533169 | `bc21a3f5b16c6ca4df761f8bb0018556ecbd09a1e1e6bffeeb5f9c6e35f9080a` |
| 1.6.12 | [LoadToAgent-Setup-1.6.12.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.12/LoadToAgent-Setup-1.6.12.exe) | 92571941 | `33cbd805a84e258db869da7c87d07b6a89c48f17c045081fe1ac771e61993463` |
| 1.6.13 | [LoadToAgent-Setup-1.6.13.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.13/LoadToAgent-Setup-1.6.13.exe) | 92572463 | `4fab2f421e9e66b91749da0ca8dc2f9c06b6b0ce58034f79885f5a78c603324b` |
| 1.6.14 | [LoadToAgent-Setup-1.6.14.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.14/LoadToAgent-Setup-1.6.14.exe) | 92580518 | `d008877063e1e64627854f4366e80734a33fe4a41c63125d036f280d5cad390b` |
| 1.6.16 | [LoadToAgent-Setup-1.6.16.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.16/LoadToAgent-Setup-1.6.16.exe) | 92580832 | `765e3db3c1a88e4ddc25c87878596957654a23953393dc2f6701b3f3e8e80ea7` |
| 1.6.17 | [LoadToAgent-Setup-1.6.17.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.17/LoadToAgent-Setup-1.6.17.exe) | 92594060 | `9ab4190855bd5165597bfa0d4463ede00211ba9d73cfbfe49130d0dfc1daefa5` |
| 1.6.18 | [LoadToAgent-Setup-1.6.18.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.18/LoadToAgent-Setup-1.6.18.exe) | 92603443 | `1e7bd997d56ff851b027a81fc45c6d0d3b966f670ec3ab30957cda2b429d4098` |
| 1.6.19 | [LoadToAgent-Setup-1.6.19.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.19/LoadToAgent-Setup-1.6.19.exe) | 83877156 | `bf49962d681b03a92e3493d7ac9a41272f56422fd5eaa6712c72454ce30df908` |
| 1.6.20 | [LoadToAgent-Setup-1.6.20.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.20/LoadToAgent-Setup-1.6.20.exe) | 83880686 | `5b4eee4788ed8aeee47204f3874038183068e4c609f2a332e7daf790f1e7eedb` |
| 1.6.21 | [LoadToAgent-Setup-1.6.21.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.21/LoadToAgent-Setup-1.6.21.exe) | 83885247 | `89de96489c0cb06e7ff9da87aa6438d247201b54f446eb44cff43e4c3a9867d9` |
| 1.6.22 | [LoadToAgent-Setup-1.6.22.exe](https://github.com/minjund/Whitebox/releases/download/v1.6.22/LoadToAgent-Setup-1.6.22.exe) | 83962791 | `9cd18c051e23f2f80a3b7e810604a64d18fbe778b8c3cbb3ee34af503d138451` |

Bridge: [minjund/LodeToAgent v1.6.23 / LoadToAgent-Setup-1.6.23.exe](https://github.com/minjund/LodeToAgent/releases/download/v1.6.23/LoadToAgent-Setup-1.6.23.exe), 94506459 bytes, SHA-256 `29e90370acd3a6f00d3da4a82a79045cf235e716dcccbbf34b2d2b4db9f4e112`. Existing narrowly authenticated first-hop historical exceptions remain unchanged; no new timeout or cleanup exception is introduced.

## Official macOS inputs → 2.0.22

The existing packaged-button scenario runs each row on its matching architecture with the official DMG, real renderer/update action, preserved profile and candidate updater. The candidate also undergoes independent cold-profile startup checks.

| Installed version | Architecture | Official DMG | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| 1.7.3 | arm64 | [Whitebox-1.7.3-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v1.7.3/Whitebox-1.7.3-arm64.dmg) | 118203096 | `4de9ff62f526326d718bbd9de9b5ef296cf6236573c0910b85f40f6739a131ed` |
| 2.0.19 | arm64 | [Whitebox-2.0.19-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.19/Whitebox-2.0.19-arm64.dmg) | 122596527 | `b58e3978dd33f607c1924c30fc10b88875aca75054e34b5ef60a783cdf97931e` |
| 2.0.18 | arm64 | [Whitebox-2.0.18-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.18/Whitebox-2.0.18-arm64.dmg) | 122603446 | `5d5ec127123caaa7ba212544029a56cb29d346e61754791f0590141b574e9b6a` |
| 2.0.17 | arm64 | [Whitebox-2.0.17-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.17/Whitebox-2.0.17-arm64.dmg) | 122605949 | `c758e33e2345311b7ba76f1e48c6b55179f06d77b70921aace2c30e59285ab4c` |
| 2.0.16 | arm64 | [Whitebox-2.0.16-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.16/Whitebox-2.0.16-arm64.dmg) | 122616179 | `ae02595dd476d6ddf86b55c3e563814a5be227b7f4b2e47b579fb4ff132fde14` |
| 2.0.15 | arm64 | [Whitebox-2.0.15-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.15/Whitebox-2.0.15-arm64.dmg) | 122563261 | `d8e8446fa9346432103c70535d9aba5d05adf977ae98d4b378045b354da63a2f` |
| 2.0.14 | arm64 | [Whitebox-2.0.14-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.14/Whitebox-2.0.14-arm64.dmg) | 122566886 | `6509744c48bc0cd230234b439251eacbe9c772f4c49e0ba902b89b6f105e8e90` |
| 2.0.1 | arm64 | [Whitebox-2.0.1-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.1/Whitebox-2.0.1-arm64.dmg) | 122073307 | `cf6a1ac27b4567e0dd652b0f99ea81cc9a0cfda7ab25cba8b20500f588b3a71a` |
| 2.0.13 | arm64 | [Whitebox-2.0.13-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.13/Whitebox-2.0.13-arm64.dmg) | 122568317 | `744a7103abf86b2d254967feca1c72fc2aa981703fce90c88982333fca433ab4` |
| 2.0.12 | arm64 | [Whitebox-2.0.12-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.12/Whitebox-2.0.12-arm64.dmg) | 122565597 | `e52dea2455e99757b62bc9a4e0fea98dcb7a0b6fa6f040b61eb6e699d8bbedf7` |
| 2.0.11 | arm64 | [Whitebox-2.0.11-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.11/Whitebox-2.0.11-arm64.dmg) | 122544983 | `7799cac987f52cd54f2970b9d989466e1e2f4f42f33a11f636a2579907bae32b` |
| 2.0.10 | arm64 | [Whitebox-2.0.10-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.10/Whitebox-2.0.10-arm64.dmg) | 122544083 | `3a3baa8edad13b10aeb5204b66732755bba2e17b4c62917d0d15a161938d07d6` |
| 2.0.9 | arm64 | [Whitebox-2.0.9-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.9/Whitebox-2.0.9-arm64.dmg) | 122548760 | `5f04fd54616411df1dba4b49bef95face9d9d9b440ec4d22b1cd3c99c2df8d2e` |
| 2.0.8 | arm64 | [Whitebox-2.0.8-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.8/Whitebox-2.0.8-arm64.dmg) | 122545533 | `c142dc0302f85def3fb3c2f2351f50b68b5ce40870308ec815fb6eaa5fd1aa0d` |
| 2.0.7 | arm64 | [Whitebox-2.0.7-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.7/Whitebox-2.0.7-arm64.dmg) | 123048036 | `651d3a48e68e46f5042c63b90bca48ad6f5ed366ac38bf5f078bedaeca528a23` |
| 2.0.6 | arm64 | [Whitebox-2.0.6-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.6/Whitebox-2.0.6-arm64.dmg) | 123048115 | `fb80b9f74746d22bb2076092d0c469187c78cb2aceca42659acc595711887e72` |
| 1.8.6 | arm64 | [Whitebox-1.8.6-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v1.8.6/Whitebox-1.8.6-arm64.dmg) | 118205927 | `5b15aad4f70ebac77a403fcb93adbc457cee4922e1c5cbaf04c1e5320191af14` |
| 1.8.4 | arm64 | [Whitebox-1.8.4-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v1.8.4/Whitebox-1.8.4-arm64.dmg) | 118201325 | `d783426277328002a470a6d51fc0442036cad978b775e47f953ab0775f58c681` |
| 1.8.5 | arm64 | [Whitebox-1.8.5-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v1.8.5/Whitebox-1.8.5-arm64.dmg) | 118205664 | `550fe7b1e4dc77f5449bea1ee2dceb9b8d570a8472137403064a9cab646477e6` |
| 1.7.3 | x64 | [Whitebox-1.7.3-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v1.7.3/Whitebox-1.7.3-x64.dmg) | 119993464 | `0cfbfa66d4ea202a0929b5f7eda1b72c2568d245df30ee5c5d15f642dc99e768` |
| 2.0.19 | x64 | [Whitebox-2.0.19-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.19/Whitebox-2.0.19-x64.dmg) | 126386973 | `a1e8a4ec54ca3dcd1bae34e4766bf7b47363053e816eb7d61a1f731304a58a88` |
| 2.0.18 | x64 | [Whitebox-2.0.18-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.18/Whitebox-2.0.18-x64.dmg) | 126386087 | `f1c0a15c514497095b6fef75671d9ec05e5b0a48af58f41cb1b423023bea3349` |
| 2.0.17 | x64 | [Whitebox-2.0.17-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.17/Whitebox-2.0.17-x64.dmg) | 126385421 | `200b9dd59149975e8cf216883a67307601c55dd66e2a0c250c0241b7b1f42d77` |
| 2.0.16 | x64 | [Whitebox-2.0.16-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.16/Whitebox-2.0.16-x64.dmg) | 126371993 | `6a591076c77356080b5941dd235711ac32567fe5430a8cc98aaffd6315872a9d` |
| 2.0.15 | x64 | [Whitebox-2.0.15-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.15/Whitebox-2.0.15-x64.dmg) | 126341382 | `01290d5b41afe60fc7d71068533a5b70e7804fa77e29df1f764fc072239f432d` |
| 2.0.14 | x64 | [Whitebox-2.0.14-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.14/Whitebox-2.0.14-x64.dmg) | 126334984 | `e422379e3746d5a4222674918f7386406cbe9cab69dda24fc428fa63281365d2` |
| 2.0.1 | x64 | [Whitebox-2.0.1-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.1/Whitebox-2.0.1-x64.dmg) | 126313538 | `5db2442584d1e17f65cb5ec406d0db3a059e3cd727528e28413f0faf6829fa5b` |
| 2.0.13 | x64 | [Whitebox-2.0.13-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.13/Whitebox-2.0.13-x64.dmg) | 126332706 | `87785b88374096b3a408758477c927a3123555637934e0ec80db86dce28bfcc1` |
| 2.0.12 | x64 | [Whitebox-2.0.12-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.12/Whitebox-2.0.12-x64.dmg) | 126331391 | `0342ef2a5789f9c09eaf38db004d50e31fe3500295c674aa77344c816b3fae09` |
| 2.0.11 | x64 | [Whitebox-2.0.11-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.11/Whitebox-2.0.11-x64.dmg) | 126325497 | `75dc17e5d158e4fcbf7fb103402c6ae27a6bf09cbf574af3ac3fbb3a983c8af7` |
| 2.0.10 | x64 | [Whitebox-2.0.10-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.10/Whitebox-2.0.10-x64.dmg) | 126325940 | `2748e55ecd15a80bdbabf8d4ac693c3c94f82f12a06fdeb3115e58e71ad72ee7` |
| 2.0.9 | x64 | [Whitebox-2.0.9-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.9/Whitebox-2.0.9-x64.dmg) | 126321901 | `331b02f6507d537d6d79aedf09d6d1296c3196d9f6e32f4a548025dfc17ca9de` |
| 2.0.8 | x64 | [Whitebox-2.0.8-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.8/Whitebox-2.0.8-x64.dmg) | 126322500 | `4c09fa6780a4e379ae83ab987579e800ca9e54d0f127952552f3de154838232d` |
| 2.0.7 | x64 | [Whitebox-2.0.7-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.7/Whitebox-2.0.7-x64.dmg) | 126840377 | `49bbe771509b644865920dd2ec6e2fafa80b302690e3d70610795925bf5c93a0` |
| 2.0.6 | x64 | [Whitebox-2.0.6-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.6/Whitebox-2.0.6-x64.dmg) | 126843864 | `2e089fa8e7497f516abb0640125d0fb652c91d107faa0275f5c4e7bfbe5f24bd` |
| 1.8.6 | x64 | [Whitebox-1.8.6-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v1.8.6/Whitebox-1.8.6-x64.dmg) | 120000980 | `026eeae970882d576c88a6e2039bedda0eca0c5589b7ee6021d8d413f4472e2a` |
| 1.8.4 | x64 | [Whitebox-1.8.4-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v1.8.4/Whitebox-1.8.4-x64.dmg) | 120000089 | `62aac017fecde3798c0f616392e2484a876ad3193a763edc60fe159f87954f40` |
| 1.8.5 | x64 | [Whitebox-1.8.5-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v1.8.5/Whitebox-1.8.5-x64.dmg) | 120000598 | `378accbd45e2e477e1e2ea605ac8798e478a1d918da7154a5598d7c991d08139` |
| 2.0.20 | arm64 | [Whitebox-2.0.20-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.20/Whitebox-2.0.20-arm64.dmg) | 122626252 | `bb8d4e97a5de2a9f9f4ab3925c5544c2946b24ba46eb256726053fea246cf5fe` |
| 2.0.20 | x64 | [Whitebox-2.0.20-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.20/Whitebox-2.0.20-x64.dmg) | 126396310 | `e0566bb179b3ebe18b03745556193818270746f9315fa1c48e57f0b445cad679` |

| 2.0.21 | arm64 | [Whitebox-2.0.21-arm64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.21/Whitebox-2.0.21-arm64.dmg) | 122625571 | `c4f8b3503493c3d996c542f4fb3935e60ba809f106fc174efcd4c941bac2aeb9` |
| 2.0.21 | x64 | [Whitebox-2.0.21-x64.dmg](https://github.com/minjund/Whitebox/releases/download/v2.0.21/Whitebox-2.0.21-x64.dmg) | 126398665 | `3553b35a6c4f0ea7ba9e916c978ad802743c63420d230665c162a09f266b5dda` |

## Required evidence

Retain exact 40-character candidate/main SHA, PR/main compatibility and desktop Actions URLs, all source attempts including 1.7.3/1.7.4/1.7.5 and 1.6.3 → immutable 1.6.23 → candidate, and candidate self-reinstall results. The required stable main check is `Updater compatibility gate`.

Tag only the tested main commit as `v2.0.22`. Release must repeat the complete packaged matrix, both macOS architectures, seven-asset byte validation and identical Windows aliases. Afterwards verify unauthenticated latest JSON, asset HEAD state/name/size/digest, downloaded alias identity and the legacy/current selector.
