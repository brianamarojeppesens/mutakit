# Performance history

Recorded per release from `test/bench/`. A regression over 10% blocks a release
(§20.3). Numbers are medians of repeated runs; a mean over five runs on a
machine that is also running a browser is mostly a measure of what else the
machine was doing.

**Environment.** Chrome 141, Linux x64, 2026-08-06. Absolute values are only
comparable within a row and within an environment — the thing being tracked is
the *shape* of the change from one release to the next.

## 0.9.0 — first full measurement

| Scenario | Budget (§20.1) | Measured | Headroom |
|---|---|---|---|
| Cold init, 100-node tree | ≤ 16 ms | **5.6 ms** | 2.9× |
| Split drag, 200 nodes | ≤ 4 ms/frame | **2.9 ms** | 1.4× |
| 100 HUD elements, animating | ≤ 8 ms/frame | **3.3 ms** | 2.4× |
| Modal open and close | — | **0.5 ms** | — |
| 1000-row list, build and arrange | — | **43.3 ms** | — |
| Idle frame, 500 nodes | 0 writes | **0 writes** | — |

### What the numbers say

**The idle row is the important one.** Five hundred nodes, two consecutive
frames, zero property writes. That is §20.1's "steady-state idle CPU: 0%"
turned into something a test can fail, and it is the direct consequence of two
design decisions: the style compiler diffs before writing, and the frame loop
unschedules itself when nothing is dirty.

**The split drag has the least headroom**, at 1.4×, and that is expected: it is
the only scenario where JavaScript runs per pointer move. It is also the
scenario most likely to regress if `neighbor` ever loses its CSS path, which is
why the path-equivalence test exists.

**The 1000-row list has no budget** because §20.1 sets none, and it should not
have one yet: at a thousand rows the honest answer is virtualization
(`virtualized`, §9), not a faster arrange.

## Method

```bash
npm run serve      # then open http://localhost:8080/test/bench/
```

Each scenario reports a number and a verdict. A benchmark whose result cannot
fail is a demo.
