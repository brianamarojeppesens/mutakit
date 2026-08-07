# Changelog

All notable changes to Mutakit are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

The project has stayed on the 0.2.0 scaffold throughout, so nothing here changes the shipped
API and there is no version bump. PLAN.md is the design source of truth, and its six drafts
are the real unit of change so far; they are recorded under **Design** below. Of those drafts,
only Draft 6 is recorded as having changed code, and those changes appear under Added and
Fixed in the normal way.

*Provenance.* Drafts 1–5 were backfilled from PLAN.md's revision log rather than from commit
history — the project is not under version control — so this section is a reconstruction and
is only as complete as that log. Draft 6 is dated 2026-08-06 from PLAN.md's status line;
drafts 1–5 carry no dates there and none are inferred here. `source/mutakit.js` was modified
after the 0.2.0 scaffold by a change the revision log does not describe; it is not accounted
for below.

### Added

- `tools/test_build.py` — a 31-case probe of `build.py`'s minifier, covering arrow functions,
  optional chaining, logical assignment, private and static class fields, `for await`, numeric
  separators, `BigInt`, and every regex-versus-division ambiguity tested. Written to resolve
  D1 (ES5 vs ES2020) on evidence rather than assertion; it found a real bug in the process.
  *(Draft 6)*
- `test/proto/split-grid.html` — the R1 prototype, testing whether CSS Grid can express the
  `split` clamping cascade. Implements all three resize modes; in `neighbor` and `distribute`
  it writes deliberately **unclamped** values, so any bound that holds is provably the
  browser's doing. *(Draft 6)*

### Changed

- **`split` / `distribute` now specifies a JavaScript fallback** (PLAN.md §7.3). The R1
  prototype was run for the first time (Chrome, 2026-08-06) and showed that
  `minmax(min, 1fr)` enforces a flexible track's *minimum* but not its *maximum*: an `fr`
  maximum is uncapped by construction, and `fr` cannot appear inside `min()`/`clamp()`, so
  there is no single track expression meaning "distribute proportionally, but stop at max".
  A non-dragged pane reached 643.2px against a `max` of 500. `distribute` now takes a JS path
  — CSS's own fr-distribution with the finite growth limits restored — whenever any pane in
  the flexible set declares a finite `max`, `snap`, or `collapsible`. Groups declaring only
  minimums, the common case, keep the pure-CSS path. §7.3 carries the rule normatively,
  including the requirement that the flexible set be fixed at `pointerdown` and that the CSS
  path commit browser-read widths on release.
- **R1 is now empirical rather than analysed** (PLAN.md §27.2). The register entry carries the
  measured results: every `neighbor` bound applied by CSS from deliberately out-of-range input
  (`--w0: 3px` → a 64px track; `--w0: 1015px` → 380px), the neighbour-exhaustion cap resolving
  to its exact arithmetic value, and a container-resize sweep from 1200px to 240px performing
  **zero** JavaScript property writes. Remaining exposure narrows from "the analysis is not yet
  empirical" to engine coverage — Firefox and Safari are still unverified.
- **M1 exit gate restated** (PLAN.md §26). It required `distribute` to apply every min/max via
  CSS, which the finding above makes unsatisfiable; it now asks for minimums only and lists the
  maximum overrun as an expected result the other engines should reproduce, not contradict.
- **M2 scope** gains both `distribute` paths plus a test asserting their equivalence — a group
  with no `max` must produce identical tracks on the CSS and JS paths across a swept drag.
  Step 3 of the JS algorithm is a no-op when every maximum is infinite, so the paths agree by
  construction; the test is what keeps two implementations of one rule from drifting.

### Fixed

- **`build.py` silently deleted code from minified builds.** The minifier's scanner treated a
  template literal as a plain quoted string, so it ended the template at the first backtick of
  a *nested* template. Real string content after that point was scanned as code and collapsed
  as whitespace. Templates are now scanned with a mode stack: a `${…}` substitution is scanned
  as ordinary code and may itself contain further templates, while the template text around it
  stays protected. Regression cases live in `tools/test_build.py`. This shipped in every
  minified build produced before the fix. *(Draft 6)*

Three further defects in `test/proto/split-grid.html`, the R1 prototype harness, found by
running it for the first time. All three predate the run; the first had been concealing the
second.

- **Verdict reported FAIL in every state**, including at rest before any interaction. It
  compared the track sum against `getBoundingClientRect().width` (border box) instead of the
  content box, and the element's own 2 × 0.8px border exceeded the 1.5px tolerance. Now
  measures the content box precisely, and treats the regime below Σ mins + gutters — where CSS
  holds the minimums and overflows the container — as defined behaviour rather than a failure.
- **`distribute` mode could not drag the second gutter.** `--t1` was pinned to
  `minmax(var(--min1), 1fr)` for the whole mode, which makes `--w1` inert. Pane 1 now goes
  flexible only while gutter 0 is being dragged, and the distributed width is committed back
  on release so reverting the track form causes no jump. Fixing this is what exposed the
  missing maximum above.
- **Readouts could lag a drag behind.** Every `pointermove` scheduled a fresh
  `requestAnimationFrame` and none was flushed on release, so a push-mode drag that ran the
  six-operation path displayed `ops: 1`. Updates are now coalesced to one per frame and
  flushed synchronously on `pointerup`.
Alongside those three, verdict failures now name the offending bound (`pane 1 > max1 (500)`)
instead of reporting "a limit was violated", which is what makes the `distribute` ceiling gap
legible on screen rather than merely detectable.

### Design

PLAN.md revisions, newest first. Each draft was a pass for depth or for evidence; the
recurring pattern is that writing something out end to end found gaps that reading it had not.

- **Draft 7** (2026-08-06) — **The toolchain constraint lifted.** Node is on PATH and
  dependencies are permitted, so §2.1's four constraints were rewritten and every section
  resting on them followed. **D5 resolved: yes** — on capability (cross-engine headless
  testing, `tsc`-verified types, tree-shaking, source maps), not size; §20.4's finding that
  the gzipped penalty was only ~1 KB held, so size would have been the wrong reason.
  **D14 resolved: yes**, ungated — npm and the committed-tag CDN path ship together. §22.2
  drops the IIFE-registry module system for plain ESM; §22.3 replaces `build.py` with
  esbuild; §23.3 replaces the hand-written Python CDP driver with Playwright. §2.1 now states
  a **two-budget rule**: build-time dependencies are free, runtime dependencies stay zero by
  default, because §1.1's dependency-free claim describes the shipped artifact and not the
  workshop. R3 (the no-Node tax) retires; **R3′** replaces it, covering supply chain and
  dependency drift, and §21.4 gains the build as an acknowledged attack surface.
  Nothing under `source/`, `build.py`, or `tools/` has changed yet — the migration is
  scheduled into M0, so this entry is design only.
- **Draft 6** (2026-08-06) — Cleared the three highest-value open items. **D1 resolved on
  evidence** (§22.6): the minifier probe above confirmed ES2020 support, so the language
  baseline moves from ES5 to ES2020; the cost is that source is no longer copy-pasteable into
  ancient environments. **D15 resolved** (§7.0): `childProps` plus a reserved `layout` bag on
  the child, and the element-definition field selecting a child algorithm is renamed
  `algorithm` to avoid the collision this created. **R1 analysed, downgraded, then measured**
  (§27.2, §7.3) — see Changed above for what the measurement corrected.
- **Draft 5** — Added **Appendix B**: all three driving scenarios written end to end and
  traced through the spec. Verified §1.5's 40-line claim (26 / 21 / 12) and found three gaps —
  no persistence wrapper or restore-ordering guarantee (§19.1), no declarative slot syntax, and
  no way for a declarative button to invoke an ancestor's command (§18.2). The last two would
  have silently broken serializability, and therefore §19 and §19.3.
- **Draft 4** — Per-module size accounting (§20.5) found the ≤ 20 KB minified core budget both
  unachievable *and* measuring the wrong thing; budgets restated in gzipped transfer size and
  revised (§20.1), resolving D8 on that evidence. Added the risk register (§27.2), with a
  trigger condition and response for each entry rather than a bare list. Deepened gestures into
  a recognizer model with arbitration (§13.3), and motion with its layout-independence
  invariant (§17).
- **Draft 3** — Added **Appendix A**: a complete third-party plugin built against the contract,
  which found four genuine gaps — virtual positioning references (§16.3), unknown units on
  restore (§19.1), undefined `uninstall()` semantics (§8.5), and a missing `ctx.tokenPx`
  (§8.2) — all since fixed. Deepened `dock` (§7.4), `free` (§7.7), and form validation (§11.3)
  from a paragraph each into a specification. Added D15.
- **Draft 2** — Added prior-art justification (§1.6), root-frame and scroll semantics (§5.11),
  content interop and DOM adoption (§8.8), node identity and stable keys (§8.9), error
  isolation (§8.10), trait/layout arbitration (§9.1), a security model (§21.4), TypeScript
  definitions (§22.5), and distribution (§25.5). Rebuilt the module system (§22.2) so every
  source file is independently valid JavaScript. Tiered the element catalog (§11) and cut the
  design-system components. Fixed the core/plugin cut line (§4.2). Resolved D10; added D11–D14.
- **Draft 1** — Initial full outline.

## [0.2.0] - 2026-07-25

### Added

- Project scaffolded on 2026-07-25.

