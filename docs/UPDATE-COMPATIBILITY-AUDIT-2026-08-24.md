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
