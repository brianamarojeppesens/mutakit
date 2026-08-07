# Changelog

All notable changes to Mutakit are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

## [0.5.0] — M2: splits (S1 substantially working)

The `split` algorithm with all of §7.3's interaction detail, the `resizer`
element, the `draggable` and `collapsible` traits, keyboard resizing, and
persistence of pane sizes (PLAN.md §26 M2).

### Added

- **`split`** (§7.3). Compiles to CSS Grid with an explicit track list;
  gutters are real grid tracks, so they participate in track sizing rather than
  being overlaid. All three resize modes, with the CSS-versus-JS path rule from
  the normative fallback: `neighbor` and the common `distribute` case write one
  *unclamped* custom property per pointer move and let the browser apply every
  bound; `push`, and `distribute` against a finite `max`, walk the cascade in
  JavaScript. The idle path performs no JavaScript geometry at all — asserted
  by a test that ticks twice and requires the second frame to write nothing.
- **The path-equivalence test the milestone asks for.** A four-pane group
  declaring no `max` is swept from −160px to +320px, and the browser's resolved
  track widths are compared against the JS path's at every position. It is what
  keeps the two implementations from drifting, and it is what lets a pane gain
  a `max` at runtime with no visible change in behaviour.
- **`resizer`** (§11.1) with the full interaction contract: pointer capture,
  hit slop widened for coarse pointers from the metrics snapshot, live and
  deferred modes, the clamping cascade, collapse with size memory, and a
  keyboard equivalent — arrows by `step`, `Shift` by five, `Home`/`End` to the
  bounds, `Enter` to toggle. `role="separator"` with a live value range.
- **`draggable` and `collapsible`** (§9), and §9.1's arbitration rule with it:
  attaching `draggable` inside a flow-owning algorithm reports MK2011 at attach
  time and names both real fixes rather than letting the element jitter.
- **`mutakit.dock.js`** — the first preset that is genuinely smaller than the
  full bundle.

### Fixed

- **Flow-owning algorithms did not own their children's size.** The base
  stylesheet reset `position`/`left`/`top` for `stack`, `split`, `grid`, `dock`,
  and `flow`, but left `width: var(--mk-w)` in place — so the engine's computed
  number overrode the grid track the browser had resolved. Every split drag
  looked correct and was entirely JavaScript-driven; the grid tracks were inert.
  Caught by the equivalence sweep, which is exactly the test that could catch it.
- **`distribute` distributed the requested delta rather than the granted one.**
  When the dragged pane clamped at its own bound, the flexible set still
  absorbed the full request, and the tracks stopped summing to the container
  (1022px in a 982px box). Pane *k*'s bounds are now applied first and the set
  absorbs what it actually gave up, re-spreading if the set turns out to have
  less capacity than asked.
- **A collapsible pane could never be collapsed by dragging.** Its `min`
  clamped the drag above `collapsible.at`, so the threshold the option exists to
  detect was unreachable. A drag now has its own floor at the collapsed size.
- A backtick inside a comment *inside* a tagged template literal ended the
  template. The stylesheet is JavaScript, so its comments live under JavaScript
  rules.

## [0.4.0] — M1: geometry and engine

`Len`, rect algebra, anchors, edge constraints, insets, coordinate spaces, the
node tree, invalidation, the frame loop, the metrics snapshot, the style
compiler, and the `anchor` and `stack` algorithms (PLAN.md §26 M1).

### Added

- **The geometry model** (§5). `Len` parses to an AST compiled by two backends —
  `toCSS` for the common path, `toNumber` only when interaction needs a number —
  which is what lets P1 hold without duplicating the unit vocabulary. Rect
  algebra, anchor resolution with logical spellings, edge constraints with
  priority-based over-constraint resolution, the inset stack, and coordinate
  spaces with matrix composition.
- **The layout engine** (§6). Retained node tree, four independent dirty bits
  with distinct propagation rules, a seven-phase frame loop that unschedules
  itself when idle, the once-per-frame metrics snapshot, three-strategy
  measurement, and a style compiler that diffs before writing.
- **`anchor` and `stack`** (§7.1, §7.2), plus the five Tier A element types.
- **Layout snapshot testing** (§23.2) — a resolved tree dumps as
  `{ key: [x, y, w, h] }` and compares against readable numbers.

### Measured

- **Core is 31.8 KB gzipped against §20.1's 8.5 KB budget — 3.7x over**, and
  `mutakit.js` is 31.8 KB against 32 KB. Recorded here rather than absorbed as a
  quiet budget revision, which is what §20.5 finding 6 asks for. The estimate
  budgeted the kernel group (kernel, diagnostics, events, DOM adapter) at 5.3 KB
  minified; the implementation is 11.4 KB *after* stripping dev prose. The two
  modules §20.5 named as the ones to watch were right — `geometry/len` is 8.4 KB
  minified, the second largest — but the largest by far is `engine/instance` at
  18.6 KB, which the per-module table had no row for because the estimate split
  that work across `kernel` and six engine modules. A reduction pass belongs
  after the catalog exists (M6), when presets are load-bearing rather than
  identical; until then `npm run build` reports the number on every build and
  `--strict-budget` fails, which the release checklist passes.
- Dev-message stripping is worth **6.4 KB minified / 2.4 KB gzipped** on its
  own, measured by toggling it.

### Fixed

- `calc(100% - 32px)` and every other subtraction failed to parse and silently
  fell back to `auto`. A leading `-` was treated as the start of an identifier
  (correct for `--custom-property`, wrong for subtraction), so the whole
  expression was rejected. Caught by the first run of the `Len` suite — the same
  lesson §22.6 records: run the thing, don't cite it.
- Signals ran an effect twice per write. Recomputing a `computed` during a pull
  re-marked its dependents, re-queueing the effect that had triggered the pull.
  Freshness now travels by version comparison and `update()` is strictly
  pull-only.
- A trait's declared events were invisible to `ctx.emit`, so every
  trait-emitted event was reported as a contract violation (MK3003) — exactly
  backwards, since traits are the primary reuse mechanism.

## [0.3.0] — M0: foundation

Replaces the scaffold. The kernel, registries, diagnostics, error isolation,
node identity, the event system, and the DOM adapter, plus the whole draft-7
toolchain migration (PLAN.md §26 M0).

### Added

- **The plugin contract** (§8): `define`/`trait`/`layout`/`unit`, `extends`
  resolution with chained lifecycle hooks, `ctx` as the only surface a plugin
  sees, per-instance registries inheriting a global one by reference, SemVer
  `requires` checking, and `uninstall` semantics that deregister contributions
  without destroying live elements.
- **Error isolation** (§8.10). Every lifecycle hook runs inside a guard; a
  throw marks the node, replaces its subtree with a placeholder **preserving
  the declared geometry**, reports MK3007 with the owning plugin's identity,
  and fires an `error` event that bubbles the node tree.
- **Diagnostics** (§21.2) — 43 stable codes, de-duplicated by code plus
  subject, each with a documented cause and fix in `docs/diagnostics.md`.
- **Signals** (§15.1), scheduled into the frame loop's STATE phase.
- **Conformance checking** (§8.7), run automatically on every `define()` in the
  development build and published for plugin authors to use as a test.
- **The harness upgrades** (§23.1): async tests, `describe`, `setup`/`teardown`,
  `only`/`skip`, `?filter=`, a deterministic fake clock and fake rAF, synthetic
  pointer traces, and machine-readable results on `window.harness`.
- **Generated types and docs** (§22.5, §24) from the same prop schemas that
  drive validation and devtools, verified by `tsc --noEmit` over `examples/`.

### Changed

- **The toolchain moved to Node** (§22.2, §22.3, §23.3). `package.json` with a
  committed lockfile; `build.mjs` on esbuild emitting IIFE and ESM, expanded and
  minified, with source maps and a metafile-derived `build/manifest.json`;
  plain ESM source in place of the IIFE registry; Playwright wired to the §25.3
  baseline engines; the Python tools ported to Node.
- **`docs/diagnostics.md` is now load-bearing**, not documentation: the lint
  fails if a code is used without being catalogued *and* documented.

### Removed

- **`hello()` and the 0.2.0 scaffold API** — breaking, and the reason M0 bumps
  the minor rather than the patch. `source/mutakit.js`, the UMD wrapper, and the
  four starter tests are gone; the UMD *output shape* survives, emitted by the
  bundler.
- **`build.py` and `tools/test_build.py`** (§22.3). Both were good work — the
  probe caught a real bug that silently deleted code from minified output — but
  the class of bug they defended against belongs to esbuild now. The record of
  why they existed stays in PLAN.md §22.6 and below.
- **`unpinned.json`'s ordered `source.files` array.** The ES module import graph
  supersedes it, which removes that merge-conflict surface entirely rather than
  merely making it tolerable.

### Fixed

- Dev-only code was shipping in the production bundle. Three spellings of the
  build flag were measured against esbuild: an imported constant — computed
  *or* literal — is folded to `!1` but the branch is **kept**, so every dev-only
  message string shipped behind `if (!1)`. Only a bare `define`d identifier
  prunes the branch and tree-shakes what it referenced. The gate is now
  `if (__MK_DEV__)`, and `source/core/dev.js` records the measurement.

## [Unreleased] — pre-implementation history

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
  Runtime confirmed as **Node 24.19.0**, settling three specifics: the DOM-free unit tier
  runs under built-in `node:test` with no dependency, `require(esm)` lets the npm package
  ship **ESM only** and sidestep the dual-package hazard, and `"engines"` pins to `>=22.12`
  rather than 24 so contributors are not forced onto the newest runtime.
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

