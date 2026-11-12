# Performance validation: 2.0.33

Baseline: v2.0.32 (`834bde5`). macOS arm64, Electron from `node_modules`.
These are workload measurements, not a claim about total system load.

## Where the time went with many AI terminals

A live Whitebox with 17 Claude terminals showed renderer 62%, main 37% and
GPU 24% of a core. Profiling a test instance (12 terminals, 6 streaming like a
working AI, 6 idle) split it as follows:

- **Main process**: its JavaScript thread was 82% idle. The cost was the
  session monitor worker (`src/monitorWorker.js`), which re-scans provider
  transcripts. With an empty `HOME` the main process fell to about 11%.
- **Monitor worker** (real history, 211 sessions): 80% busy. Per scan it
  re-enriched every session (artifact regex, outcome), rebuilt every card,
  re-parsed the last 4 MB of each changed transcript, and probed tmux through
  a login shell. File events re-scanned 0.5 s after each scan ended, so with
  several live sessions the worker hardly rested.
- **Renderer**: terminal drawing for visible panes, plus 400-row screen text
  extraction for every streaming pane on the 1 s sync and again on the 2.5 s
  review.

## Changes

| Change | Where |
| --- | --- |
| Artifact and latest-activity results cached per parsed transcript array; callers receive copies | `src/sessionIntelligence.js` |
| Published cards reused when the session's fingerprint row, titles, source arrays and minute are unchanged | `src/monitorWorker.js` |
| A changed transcript whose last parse took ≥ 25 ms is re-parsed at most every 3 s; shrunk or replaced files at once | `src/agentMonitor.js` |
| File-triggered scans at most every 1.5 s after the previous scan (was 0.5 s) | `src/monitorWorker.js` |
| tmux probe every 30 s while no tmux session exists (5 s otherwise, explicit TTLs honored) | `src/tmuxMonitor.js` |
| The review reuses screen text read by the sync within the last 400 ms | `renderer/terminal-workspace.js` |

## Results

Monitor worker alone against a fixed copy of 165 recent transcripts, with N
transcripts appended to every 500 ms. CPU after a 15 s warm-up, 30 s window:

| Live transcripts | v2.0.32 | 2.0.33 |
| --- | ---: | ---: |
| 6 (two runs) | 53%, 51% | 23%, 22% |
| 17 | 45% | 36% |

Renderer, 6 streaming + 6 idle terminals: the review pass fell from 2.6–4.9%
to about 1.5% of renderer time. Drawing is unchanged.

## Known remaining cost

With many large live transcripts the monitor still re-parses up to 4 MB per
changed file every 3 s. Parsing only the appended bytes would remove most of
it; that is the next step.
