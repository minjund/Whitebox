# Performance validation: 1.8.12

Baseline: `cb87fab3c8f96c6923afb3a620a92f0a5d6e609c` (1.8.11 main).
Measurements were taken on the same Windows development machine with Node
22.13.1 and the installed Electron runtime. These are workload measurements,
not a claim about total application CPU or total process memory.

| Workload | Baseline | Candidate |
| --- | ---: | ---: |
| Dashboard refresh, 240 tasks / 24 projects, median after first render | 238.7 ms | 32.3 ms |
| First render of that dashboard workload | 225.7 ms | 135.1 ms |
| Unchanged sidebar child replacement per refresh | 1 | 0 |
| Retained parsed generations after 180 transcript updates | 180 | 1 |
| Additional retained JS heap in that streaming workload, after GC | 39.77 MiB | 0.75 MiB |
| Enrichment of 80 artifact-heavy sessions, median after first round | 303.5 ms | 9.6 ms |

The renderer profile identified repeated project path normalization as its
largest JavaScript cost. It now uses a bounded cache of 1,024 strings. Equal
markup retains sidebar, history, provider and filter nodes, including focus
and scroll state. Plugin switches still rebuild from authoritative state so
failed saves restore browser-mutated checked and disabled properties.

Parser caching now retains the latest generation for each file and view,
validates both mtime and size, and preserves the existing time-sensitive
reparse rules. It retains at most 300 entries, with at most eight full-history
entries. The renderer retains twelve full histories plus any currently
protected selections, parents, active reads, and pending message deliveries.
Eviction does not delete transcripts; opening an evicted conversation reloads
it. Active monitoring and terminal output are not delayed or disabled.

Artifact extraction keeps its original ordering, duplicate handling, verified
flags, and 24-result limit, but stops searching when that limit is satisfied.
Runtime health and attention are still recomputed with the current time.
Unchanged plugin scans avoid a second runtime enrichment pass; changed status,
new sessions, errors, and failed publication retries remain observable.
File events invalidate discovery only for their affected history root.

A read-only profile of the developer's existing 107 sessions found first
discovery around 2.6–2.8 seconds; that disk discovery remains the main cold-start
cost. Enrichment on that mixed real workload dropped from roughly 133–155 ms
to 67–96 ms. No transcript content is included in the measurement output.

## Reproduce and verify

```sh
node --expose-gc scripts/performance-monitor-check.js cb87fab3c8f96c6923afb3a620a92f0a5d6e609c
npm run test:performance
npm test
npm run test:accuracy
npm run test:interaction
npm run test:project-interaction
npm run test:project-selection
npm run test:scroll
npm run test:visual
```

The performance checks write JSON under `artifacts/performance`. The baseline
monitor command loads the two changed modules from that exact Git commit with
unchanged parser dependencies. The baseline renderer measurement was captured
before editing the renderer. For a fresh baseline renderer run, use that Git
checkout and the same workload, without the candidate DOM-retention assertions.

New regression checks cover transcript freshness, full-history eviction and
reload, selected-parent retention, root-scoped discovery, artifact ordering,
time-dependent health, and core/plugin publication. Desktop CI runs the same
performance workloads on Windows and macOS. Timing is reported; correctness
and retention invariants are asserted without flaky wall-clock thresholds.

## Release compatibility

The version bump uses the existing mandatory `Updater compatibility gate`.
The gate executes pinned official 1.7.3 and 1.7.4 packages through the manual
alias, official 1.7.5 through the automatic handshake, and official 1.6.3 through
the immutable official 1.6.23 bridge. Every attempt also reinstalls the candidate
through its own packaged updater and verifies relaunch and cleanup. All four
attempts must run again on the exact release tag SHA before publication.

The immutable legacy installer pins and packaged implementation comparison are
recorded in `UPDATE-COMPATIBILITY-AUDIT-2026-08-24.md`; current and recent pins
are in `scripts/update-compatibility-cohorts.json` and its validator. Final
commit SHAs, Actions URLs, individual packaged results, and unauthenticated
live-channel verification belong in the release review record after those
checks execute. This performance report alone is not release approval.
