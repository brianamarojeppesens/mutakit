# Mutakit — Project Plan

> **Status:** Draft 7 · 2026-08-06
> **Scope:** Full architectural outline for Mutakit as a JavaScript + CSS GUI construction library.
> **Audience:** The maintainer(s) building it. This document is the design source of truth;
> `source/` is the implementation source of truth.

<details>
<summary><strong>Revision log</strong></summary>

- **Draft 7** — **The toolchain constraint lifted.** Node is on PATH and dependencies are
  permitted, so §2.1's four constraints were rewritten and everything resting on them
  followed. **D5 resolved: yes**, on capability rather than size — §20.4's finding that the
  gzipped penalty was only ~1 KB held, so size would have been the wrong reason to adopt Node
  and the plan was right to refuse it. **D14 resolved: yes**, ungated. §22.2 drops the
  IIFE-registry module system for plain ESM, which the registry was explicitly designed to
  make cheap — and was. §22.3 replaces `build.py` with esbuild, retiring the hand-written
  minifier and `tools/test_build.py` with it; §23.3 replaces the hand-written CDP driver with
  Playwright. The single most valuable consequence is not size: it is that **R1's outstanding
  exit gate becomes a CI job**, since Firefox and Safari are now one config line each rather
  than two protocol implementations (§26 M0 sequences this first). New: source maps, real
  tree-shaking, `tsc`-verified types. §2.1 now states a **two-budget rule** — build-time
  dependencies are free, runtime dependencies stay zero by default — because §1.1, §1.4, D13
  and §20.1 all rest on the shipped artifact having none. R3 retires; **R3′** replaces it,
  covering supply chain and dependency drift. Runtime confirmed as **Node 24.19.0**, settling
  three specifics: the DOM-free unit tier runs under built-in `node:test` with no dependency
  (§23.1, §23.3), `require(esm)` lets the npm package ship **ESM only** and sidestep the
  dual-package hazard (§25.5), and `"engines"` pins to `>=22.12` rather than 24 so
  contributors are not forced onto the newest runtime.
- **Draft 6** — Cleared the three highest-value open items. **D1 resolved on evidence**
  (§22.6): a 31-case probe of `build.py`'s minifier confirmed ES2020 support and found a real
  nested-template bug that silently deleted code from the minified build — fixed in
  `build.py`, covered by `tools/test_build.py`. **D15 resolved** (§7.0): `childProps` plus a
  reserved `layout` bag on the child; the element-definition field selecting a child algorithm
  is renamed `algorithm` to avoid the collision this created. **R1 analysed and downgraded**
  (§27.2, §7.3): pure CSS covers static layout, container resize, and `neighbor` drags; `push`
  needs JS during the drag, which is consistent with P1 rather than an exception to it.
  Prototype written (`test/proto/split-grid.html`) and **since run in Chrome (2026-08-06)**,
  which confirmed `neighbor` and the zero-JS resize path exactly as analysed and **corrected
  one row**: `distribute` enforces minimums in CSS but *not* maximums, because an `fr` maximum
  is uncapped by construction — so it joins `push` in computing during the drag whenever a
  non-dragged pane declares a `max`. §7.3 now carries the resulting fallback rule normatively.
  Three harness defects found and fixed. See §27.2 R1 for the measurements.
- **Draft 5** — Added **Appendix B**: all three driving scenarios written end to end and
  traced through the spec, verifying §1.5's 40-line claim (26 / 21 / 12) and finding three
  gaps — no persistence wrapper or restore-ordering guarantee (§19.1), no declarative slot
  syntax, and no way for a declarative button to invoke an ancestor's command (§18.2). The
  last two would have silently broken serializability and therefore §19 and §19.3.
- **Draft 4** — Per-module size accounting (§20.5) found the ≤ 20 KB minified core budget
  unachievable *and* measuring the wrong thing; budgets restated in gzipped transfer size
  and revised (§20.1). Resolved D8 on that evidence. Added a risk register (§27.2) with
  trigger conditions and responses. Deepened gestures into a recognizer model with
  arbitration (§13.3) and motion with its layout-independence invariant (§17).
- **Draft 3** — Added **Appendix A**: a complete third-party plugin built against the
  contract, which found four genuine gaps — virtual positioning references (§16.3), unknown
  units on restore (§19.1), undefined `uninstall()` semantics (§8.5), and a missing
  `ctx.tokenPx` (§8.2) — all now fixed. Deepened `dock` (§7.4), `free` (§7.7), and form
  validation (§11.3) from a paragraph each to a specification. Added D15.
- **Draft 2** — Added prior-art justification (§1.6), root-frame and scroll semantics (§5.11),
  content interop and DOM adoption (§8.8), node identity and stable keys (§8.9), error
  isolation (§8.10), trait/layout arbitration (§9.1), a security model (§21.4), TypeScript
  definitions (§22.5), and distribution (§25.5). Rebuilt the module system (§22.2) so every
  source file is independently valid JavaScript. Tiered the element catalog (§11) and cut the
  design-system components. Fixed the core/plugin cut line (§4.2). Resolved D10; added D11–D14.
- **Draft 1** — Initial full outline.

</details>

---

## 0. How to read this document

Sections 1–4 are the *why* and the invariants. Sections 5–8 are the load-bearing
architecture — the geometry model, the layout engine, and the plugin contract. Everything
after is subsystem detail, process, and open questions. If you only read three sections,
read §5 (Geometry), §8 (Plugin contract), and §27 (Decisions & open questions).

The modularity claim — *"new GUI elements can be added as plugins"* — is not one section. It
is enforced by five, and each of them is a place the claim could quietly fail:
§4.2 (the core/plugin cut line) · §8 (the contract, and `ctx` as the only surface plugins
see) · §8.7 (a conformance check that runs on every definition) · §10 (the complete,
finite list of extension points) · §22.4 (a build-time lint that fails if core stops
following its own rules). Every built-in element registers through the same public API a
third party uses (P3); §26's M6 milestone is not complete until a plugin published from
*outside* this repository is installed with `mk.use()`.

Conventions in this document:

- **MUST / SHOULD / MAY** carry their usual RFC-2119 force.
- `mk` is the conventional local alias for the `Mutakit` namespace.
- Code blocks are *illustrative target API*, not implemented behaviour. Nothing in §5–§20
  exists yet.
- `⚑` marks an unresolved decision, collected in §27.

---

## 1. Vision, scope, and non-goals

### 1.1 One-sentence description

Mutakit is a dependency-free browser library that builds and mutates graphical user
interfaces from declarative geometry — you describe *what element* and *where*, and the
library resolves layout, interaction, accessibility, and styling.

> **"Dependency-free" means what ships, not what builds it.** Nothing Mutakit sends to a
> user's page depends on anything else — that is the promise behind §1.4's single
> `<script>` tag, D13's decision to reimplement anchored positioning, and §20.1's budget.
> The *toolchain* uses ordinary Node dependencies (§2.1, §22.3). Every "no dependencies"
> claim in this document is a claim about the shipped artifact.

### 1.2 The premise

Most UI toolkits make you think in the browser's layout primitives (flow, flex, grid) and
then fight them when you want desktop-application geometry: split panes, floating windows,
docked panels, modals sized as a fraction of the viewport, HUD elements pinned to screen
edges. Mutakit inverts that. The authoring vocabulary is **element type + geometric
intent**; the library's job is to compile that intent into CSS the browser can execute
fast, and to supply the JavaScript only where interaction genuinely requires it.

The whole premise in eight lines:

```html
<script src="mutakit.min.js"></script>
<script>
  const app = Mutakit.mount(document.body, { sizing: 'viewport' });

  const [side, main] = app.split({ axis: 'x', gutter: 6, panes: [
    { id: 'side', size: 240, min: 160 },
    { id: 'main', size: '1fr' }
  ]});

  main.create('button', { text: 'Settings', on: { click: () =>
    Mutakit.create('dialog', { size: { w: '60%', h: '70%' }, at: 'center',
                               title: 'Settings' })
  }});
</script>
```

No build step, no framework, no dependencies. A draggable split and a centred modal in the
same vocabulary.

### 1.3 Three driving scenarios

These three scenarios are the acceptance criteria for the whole design. Every architectural
decision in this document is justified by at least one of them, and no design is accepted
that makes one of them awkward.

**S1 — The IDE / tool window.** Recursive split panes with draggable separators, minimum
and maximum sizes, collapse-to-edge, persisted layout across reloads, keyboard-resizable
for accessibility.

**S2 — The application chrome.** Modals, dialogs, popovers, tooltips, toasts, context
menus, and form controls. Correct stacking, focus trapping, dismissal semantics, and
viewport-relative sizing (`80% × 85%`, centred).

**S3 — The game HUD.** Dozens of elements pinned to viewport edges and corners, updating at
frame rate, with gamepad and keyboard navigation, no layout thrash, and the option to
disable accessibility semantics for purely decorative overlays.

### 1.4 Explicit non-goals

Naming these keeps the surface finite. Each may be revisited, but only as a *plugin*, never
as core.

| Non-goal | Rationale |
|---|---|
| A visual design system / opinionated look | Mutakit ships *structure*; themes are token sets (§12). The default theme is deliberately plain. |
| A virtual DOM or component framework | Mutakit mutates real DOM directly. React/Vue/Svelte integration is an adapter plugin (§10). |
| A data grid, rich text editor, or charting library | Enormous domains. They belong in the plugin ecosystem. |
| A required build step | The library MUST work from a single `<script>` tag. |
| Server-side rendering | Layout resolution depends on measurement. Out of scope. |
| IE11 / legacy browser support | See §25.3 for the baseline. |
| A general constraint solver (Cassowary/simplex) | Rule-based resolution covers S1–S3 at a fraction of the cost. A solver MAY ship as an alternate layout algorithm plugin (§7.8). |

### 1.5 Success criteria

1. Each of S1, S2, S3 is buildable in under 40 lines of authoring code.
2. Core (kernel + geometry + engine + the `anchor` and `stack` algorithms) is ≤ 33 KB
   gzipped — revised from 8.5 KB in draft 8 on measurement rather than estimate; see
   §20.1 for why and `docs/size-accounting.md` for the working.
3. A third party can add a new element type without modifying any file in `source/core/`.
4. S3 sustains 60 fps with 100 HUD elements on a mid-range 2022 laptop.
5. Every pointer interaction has a documented keyboard equivalent.

### 1.6 Prior art, and why this is worth building

Building a UI library is a large commitment, so the alternatives deserve an honest hearing.

| Existing work | What it does well | Why it doesn't cover S1–S3 |
|---|---|---|
| **split.js**, `react-split-pane` | Draggable splitters, small | Splitters only. No nesting semantics, no collapse, no keyboard, no persistence, nothing else in the vocabulary. |
| **Golden Layout**, **Dockview**, **rc-dock**, **FlexLayout** | Real docking with tabs and drag-to-dock | Framework-coupled (mostly React), heavy, opinionated DOM and CSS, and they own the whole page. No overlay or HUD story. |
| **Floating UI** | Best-in-class anchored positioning: flip, shift, collision | Solves §16.3 only. It is a positioning engine, not a GUI system. |
| **Radix / Ark UI / Headless UI** | Excellent accessible behaviour primitives | Framework-coupled, component-shaped rather than geometry-shaped. No layout model at all. |
| **CSS Grid / Flexbox alone** | Fast, native, well-specified | No interaction, no z-order management, no focus handling. Splitters and modals are entirely on you. |
| **Dear ImGui**, **Nuklear** | The geometry vocabulary this project admires | Immediate mode, canvas-rendered. No DOM, no accessibility, no text input worth using in a browser. |
| **Design systems** (Material, Carbon, Fluent) | Complete component catalogs | Opinionated visuals, huge, and layout is an afterthought. Explicitly a non-goal (§1.4). |

**The gap:** nothing offers a *single geometric vocabulary* that spans recursive splits,
modal overlays, and edge-pinned HUDs, is extensible by third parties down to new element
types and new layout algorithms, is framework-agnostic, and has no dependencies. Each
existing tool solves one row of the table. Mutakit's bet is that one coherent geometry model
underneath all three scenarios is worth more than three good libraries stitched together.

**The honest risk:** Floating UI solves anchored positioning better than a first
implementation of §16.3 will. The zero-dependency constraint (§1.4) means reimplementing it,
treating its published algorithm as the reference specification. If that proves to be a bad
trade, `positioned` becomes a thin adapter over it and the constraint gets revisited — see
D13.

---

## 2. Current state of the codebase

An honest inventory, because the plan has to start from here.

```
mutakit/
├── README.md          44 lines — scaffold docs, describes hello() placeholder
├── CHANGELOG.md       14 lines — Keep-a-Changelog format, v0.2.0 stub
├── unpinned.json      28 lines — manifest: name, version, source/build/test paths
├── build.py          311 lines — concatenates manifest-listed sources, adds banner,
│                                 writes expanded + conservatively minified output
│                                 ⚠ retired in draft 7; replaced by esbuild (§22.3)
├── source/
│   └── mutakit.js     74 lines — UMD wrapper, ES5, `create()`/`hello()` placeholder
├── build/            generated; gitignored except .gitkeep
├── tools/
│   └── test_build.py  98 lines — 31-case minifier probe (§22.6)
│                                 ⚠ retired with the minifier it defends
└── test/
    ├── index.html     39 lines — loads source directly; sandbox + results panels
    ├── harness.js    123 lines — ~50-line assertion lib: ok/equal/deepEqual/throws
    ├── harness.css   127 lines — dark/light themed harness styling
    ├── test.js        36 lines — four starter tests against the placeholder API
    └── proto/
        └── split-grid.html  316 lines — R1 prototype (§27.2); run in Chrome, still
                                          needs Firefox and Safari
```

### 2.1 What this constrains

> **Revised in draft 7.** Drafts 1–6 were written against a Python-only toolchain with no
> `node` on PATH. **Node 24.19.0** is now available (confirmed 2026-08-06) and third-party
> dependencies are permitted. The four bullets below replace that constraint set; §22 and §23
> are rewritten to match. The single most important thing this section now says is the
> distinction in the first bullet — it is what keeps the product promise intact while the
> toolchain changes underneath it.
>
> Node 24 is far newer than anything this plan needs, and three of its capabilities are
> load-bearing enough to name: **`node:test`** and `--watch` are built in, so the pure-unit
> tier of §23.2 needs no test-runner dependency at all; **`require(esm)`** is unflagged, which
> collapses the dual-package problem in §25.5; and **type stripping** runs `.ts` directly for
> erasable syntax. Pin the minimum in `package.json` as `"engines": { "node": ">=22.12" }` —
> the oldest version supporting `require(esm)` — rather than 24, so contributors are not
> forced onto the newest runtime to build the project.

- **Two dependency budgets, not one.** *Build-time* dependencies are permitted and
  unconstrained in kind: Node is on PATH, `npm install` is a legitimate instruction, and the
  toolchain may take whatever it needs. *Runtime* dependencies — anything that reaches a
  user's page — remain **zero by default**, because §1.1's dependency-free claim, §1.4's
  single-`<script>`-tag promise, and §20.1's size budget all rest on it. Adding one requires a
  decision record and must fit the budget; the presumption is against. This distinction is
  load-bearing throughout the document: "dependency-free" describes the *shipped artifact*,
  never the workshop that produces it.
- **The build may bundle.** Concatenation was a constraint, not a preference. With a real
  bundler there is module resolution, tree-shaking, and import rewriting, so module structure
  no longer has to survive being concatenated in arbitrary order (§22.2 is rewritten from an
  IIFE registry to plain ESM). Tree-shaking in particular serves the size goal directly:
  unreferenced code stops shipping, which no amount of careful concatenation achieves.
- **Minification is delegated, not hand-rolled.** `build.py`'s line-preserving minifier —
  which does not rename identifiers and cost a real nested-template bug to get correct
  (§22.6) — is replaced by esbuild. Identifier mangling closes the ~30–40% gap §20.4 was
  written to excuse, and an entire category of hand-written-tokenizer bug disappears with the
  tokenizer. This is the clearest win available and the least controversial.
- **The test harness stays browser-first, but headless testing gets easy.** The in-browser
  harness remains the primary way tests run, because a GUI library's tests belong in a real
  browser and the harness is genuinely good at that (§23.1). What changes is the driver: a
  hand-written Python CDP client (§23.3) becomes Playwright, which also unlocks the
  cross-engine runs the R1 gate needs — Firefox and Safari are one line of config each rather
  than two more protocol implementations.

### 2.2 What survives

Keep: the UMD *output shape* (now emitted by the bundler rather than hand-written), the
`create(options)` factory pattern, the zero-**runtime**-dependency harness concept,
Keep-a-Changelog + SemVer.

Replace: `hello()`, the ES5-only style (⚑ D1), the single-file source layout, the four
starter tests, and — new in draft 7 — the manifest-driven concatenating build and its
hand-written minifier, superseded by ESM entry points and esbuild (§22.3).

---

## 3. Architectural principles

These are the invariants. A change that violates one of these needs a decision record
(§27), not just a commit.

**P1 — CSS is the layout engine; JavaScript is the constraint author.**
Wherever the browser can compute a position, it computes it. Mutakit's job is to emit the
right `calc()`, `clamp()`, custom properties, grid template, and flex rules — then get out
of the way. JavaScript computes geometry only when interaction requires a number (a drag
delta, a snap threshold, a hit test). This is what makes S3 viable and what keeps the
library small.

**P2 — Declarative intent, imperative escape hatch.**
Every element is describable as a plain serializable object. Every element also exposes a
handle with imperative methods. The declarative form is the canonical one: it is what gets
serialized, restored, diffed, and shown in devtools.

**P3 — Everything is a plugin, including the built-ins.**
The built-in element types are registered through exactly the same public API a third party
uses. If a built-in needs a capability the public API doesn't offer, the fix is to add a
public extension point — never a private back door. This is enforced by a build check
(§22.4).

**P4 — Read before write, once per frame.**
All DOM measurement happens in a read phase; all mutation in a write phase; both driven by
a single `requestAnimationFrame` loop. No code path may interleave them. Layout thrash is a
correctness bug, not a performance nit.

**P5 — Accessible by construction.**
Roles, focus order, keyboard equivalents, and reduced-motion handling are declared in the
element contract, not bolted on per element. An element type that declares no
accessibility semantics is a build-time warning, and opting out (`a11y: 'presentation'`)
must be explicit.

**P6 — Progressive disclosure of complexity.**
`mk.create('modal', {size: {w: '80%', h: '85%'}, at: 'center'})` must be the whole API for
the common case. Constraint priorities, custom layout algorithms, and the frame scheduler
exist but are never in the beginner's path.

**P7 — Fail loudly in development, degrade gracefully in production.**
Over-constrained geometry, unknown element types, and contract violations throw with
actionable messages in the development build; in the production build they warn once and
fall back to a documented default (§21).

**P8 — No global state that a second instance would collide with.**
Two independent Mutakit roots on one page (an app and an embedded widget) must not share
mutable state. Registries are per-instance with an optional shared default (§8.6).

---

## 4. System architecture

### 4.1 Layer map

```
┌───────────────────────────────────────────────────────────────────────┐
│  AUTHORING          fluent API · declarative objects · string DSL*    │  §18
│                     custom elements* · framework adapters*           │
├───────────────────────────────────────────────────────────────────────┤
│  ELEMENTS           built-in catalog: pane, split, modal, dialog,     │  §11
│                     popover, tooltip, toast, menu, form controls…    │
│                     (every one registered via the plugin contract)   │
├───────────────────────────────────────────────────────────────────────┤
│  TRAITS             draggable · resizable · dismissible · focus-trap  │  §9
│                     scrollable · collapsible · selectable · sortable  │
├───────────────────────────────────────────────────────────────────────┤
│  SERVICES           layers/z-order · focus mgr · shortcut registry    │  §13,16
│                     gestures · motion · a11y announcer · persistence  │  §17,19
├───────────────────────────────────────────────────────────────────────┤
│  LAYOUT             algorithms: split · stack · dock · grid · flow    │  §7
│                     · free · anchor          (pluggable)             │
├───────────────────────────────────────────────────────────────────────┤
│  ENGINE             node tree · invalidation · frame scheduler ·      │  §6
│                     measure/arrange · style compiler                 │
├───────────────────────────────────────────────────────────────────────┤
│  GEOMETRY           Len algebra · Rect/Point/Inset · anchors ·        │  §5
│                     coordinate spaces · edge constraint resolution   │
├───────────────────────────────────────────────────────────────────────┤
│  KERNEL             registry · lifecycle · events · signals ·         │  §8,15
│                     DOM adapter · diagnostics                        │  §21
└───────────────────────────────────────────────────────────────────────┘
                                                        * = ships as a plugin
```

Dependencies point downward only. A layer may not import from a layer above it. This is
checked by the build (§22.4).

### 4.2 The core/plugin cut line

**Core** (always loaded): kernel, geometry, engine, signals (§15.1, D8), the `anchor` and
`stack` layout algorithms, the layers service, the `focusable` trait, and five element
types — `pane`, `surface`, `stack`, `group`, `spacer` (Tier A in §11). Budget: **≤ 33 KB
gzipped** (§20.1, revised on measurement in draft 8), with the per-module accounting in
§20.5 and the measured working in `docs/size-accounting.md`.

`surface` is core rather than a plugin because most of the overlay family declares
`extends: 'surface'` (§8.1); a base type that plugins inherit from must always be present.
The general rule for the cut line: **a thing is core if plugins depend on it existing, or if
the engine cannot function without it.** Everything else is a plugin.

**Standard plugins** (bundled but individually excludable): every other layout algorithm,
every other element type, every trait, gestures, motion, persistence, devtools.

**Presets**: named bundles for convenience — `mutakit.core.js`, `mutakit.app.js`
(core + overlays + forms), `mutakit.dock.js` (core + split/dock + persistence),
`mutakit.hud.js` (core + anchor + gamepad input), `mutakit.js` (everything).

*Draft 7 narrows who these are for.* Each preset is now an entry file in `source/entries/`
whose imports are its definition (§22.1). They remain essential for the `<script>`-tag
audience, who cannot tree-shake and must choose a pre-cut bundle. For anyone consuming the
ESM build through their own bundler, presets become merely a convenient starting import —
their real bundle is determined by what they actually reference, so a user who imports one
element from `mutakit.js` no longer pays for the rest. That removes the main hazard of
offering an "everything" preset.

---

## 5. The geometry model

This is the heart of the library. Everything else is a consumer of it.

### 5.1 Primitive types

```js
Point  { x: number, y: number }                  // px in a stated space
Size   { w: number, h: number }
Rect   { x, y, w, h }  + derived: left/top/right/bottom/cx/cy
Inset  { top, right, bottom, left }              // physical
Edges  { start, end, before, after }             // logical (writing-mode aware)
Len    number | string                           // see §5.2
```

`Rect` is immutable with a small algebra: `inset()`, `outset()`, `intersect()`, `union()`,
`clamp(bounds)`, `anchorPoint(anchor)`, `containsPoint()`, `equals(epsilon)`.

### 5.2 `Len` — the length algebra

A `Len` is any of:

| Form | Meaning | Resolvable in CSS? |
|---|---|---|
| `120` | 120 CSS pixels | yes |
| `'120px'`, `'2rem'`, `'12ch'`, `'3em'` | absolute / font-relative | yes |
| `'50%'` | percentage of the **resolution basis** (§5.3) | yes |
| `'3vw'`, `'4vh'`, `'5vmin'`, `'6dvh'` | viewport-relative | yes |
| `'1fr'`, `'2.5fr'` | fraction of *free space* after fixed tracks | in grid/flex only |
| `'auto'` | intrinsic content size, measured | yes (often) |
| `'min-content'`, `'max-content'`, `'fit-content'` | intrinsic keywords | yes |
| `'calc(100% - 32px)'` | arithmetic | yes |
| `'min(…)'`, `'max(…)'`, `'clamp(a,b,c)'` | comparison functions | yes |
| `'8gu'` | a **custom unit** registered by a plugin (§10.4) | via compiled fallback |
| `(ctx) => number` | a computed length; escape hatch, re-evaluated per frame | no |

**Parsing.** A single-pass tokenizer produces a `LenAST`. The AST is *not* evaluated
eagerly. It is compiled by two different backends:

- `toCSS(ast, basisVar)` → a CSS string, used in the common path.
- `toNumber(ast, ctx)` → a float, used only when interaction needs it.

Keeping both backends over one AST is what lets P1 hold without duplicating the unit
vocabulary. `toNumber` for viewport and font-relative units reads from a cached
`MetricsSnapshot` (§6.4), never from a fresh `getComputedStyle`.

**`fr` semantics.** `fr` distributes *free space* — the container's content box minus all
resolved non-`fr` tracks, minus gutters. Distribution is proportional to the coefficients,
then clamped by each track's `min`/`max`, then leftover from clamping is redistributed to
unclamped tracks. Iterate to a fixed point, max 4 passes, then accept. This matches CSS
Grid's behaviour closely enough that delegating to `grid-template-*` produces identical
results in the common case — which is exactly why we delegate.

### 5.3 Resolution basis

`'50%'` is meaningless without saying *percent of what*. The rule:

- For **size** (`size.w`, `size.h`): the basis is the containing frame's **content box** on
  the matching axis.
- For **offsets and insets**: the basis is the containing frame's content box on the axis
  the offset moves along.
- For **`of: 'viewport'`**: the basis is the visual viewport, minus safe-area insets if
  `inset: 'safe'` is in effect (§5.7).
- For **`of: <element ref>`**: that element's border box.

`min`/`max`/`clamp` resolve against the same basis as the value they bound. Percentages
never resolve against a parent whose size depends on the child — that is a cycle and is
reported as a diagnostic (§21.2), with the child falling back to `auto`.

### 5.4 Coordinate spaces

Every geometric value carries an implicit space. Conversions are explicit.

| Space | Origin | Notes |
|---|---|---|
| `viewport` | top-left of the visual viewport | affected by pinch-zoom and virtual keyboard |
| `document` | top-left of the document | scroll-affected |
| `layer` | top-left of a layer's root (§16) | usually === viewport |
| `frame` | top-left of a container's content box | the default for children |
| `element` | top-left of the element's own border box | used for anchor points |

`mk.convert(point, from, to)` handles the general case, including transformed ancestors, by
composing the accumulated `DOMMatrix`. Elements under a rotated or scaled ancestor are
supported for hit-testing and dragging; layout math assumes axis-aligned parents and warns
otherwise (⚑ D6).

**Device pixel ratio and browser zoom** are deliberately *not* modelled. Mutakit works
entirely in CSS pixels. Plugins that need device pixels (a canvas-backed element) read
`devicePixelRatio` themselves and are told when it changes via the `metrics:change` event.

**Writing mode / RTL.** Physical properties (`left`, `right`) mean physical. Logical
properties (`start`, `end`, `before`, `after`) flip with `direction` and `writing-mode`.
Anchors have both spellings: `'top-left'` is physical, `'block-start inline-start'` is
logical. Built-in elements use logical properties; the geometry layer supports both.

### 5.5 Anchors

An anchor is a point on a box, expressed as:

- a **keyword**: `'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' |
  'bottom-left' | 'bottom' | 'bottom-right'` (plus logical spellings)
- a **normalized pair**: `[0.5, 0.5]` — fractions of width and height
- an **absolute pair**: `['16px', '16px']` — from the box's top-left
- a **mixed pair**: `['100%', 0.5]`

Placement is: *"put **this** point of the element at **that** point of the container,
then shift by offset."*

```js
{ anchor: 'center', at: 'center', of: 'viewport', offset: [0, 0] }
```

`anchor` defaults to matching `at` when omitted — so `at: 'top-right'` alone means
"top-right corner of me at the top-right corner of the container", which is the intuitive
reading and covers most HUD placement with one property.

**Offset sign convention (⚑ D2, resolved).** `offset` is always in screen axis direction:
`+x` right, `+y` down, regardless of which anchor is used. This is predictable but reads
badly for edge insets (`at: 'top-right', offset: [-16, 16]`). Therefore `inset` exists as
the recommended spelling for edge-relative gaps: `{ at: 'top-right', inset: 16 }` means 16px
in from both edges it touches, flips correctly under RTL, and composes with safe areas.
Use `offset` for deliberate directional nudges; use `inset` for margins from an edge.

### 5.6 Edge constraints — the alternative to anchors

For each axis, an element's geometry is determined by exactly **two** of three values.
Horizontal: `{left, right, width}`. Vertical: `{top, bottom, height}`. (Logical spellings
accepted.)

| Given | Behaviour |
|---|---|
| 2 of 3 | Fully determined. The third is derived. This is the normal case. |
| 3 of 3 | **Over-constrained.** Resolve by priority (§5.8); diagnostic emitted. |
| 1 of 3 | Under-constrained. The missing size resolves to `auto` (intrinsic); the missing edge resolves from the anchor, defaulting to `start`. |
| 0 of 3 | Falls through entirely to the parent's layout algorithm (§7). |

This one rule is what makes the HUD case fall out for free:

```js
// pinned to the bottom-right, sized to content
{ right: 24, bottom: 24 }
// a full-height right rail, 320px wide
{ right: 0, top: 0, bottom: 0, width: 320 }   // vertical axis: 3 given → see §5.8
// a bar spanning the top, 48px tall
{ left: 0, right: 0, top: 0, height: 48 }
```

Note the second example is over-constrained on the vertical axis by design — a common,
convenient shape. §5.8 makes it well-defined rather than an error.

### 5.7 Insets and safe areas

A frame carries an **inset stack**: an ordered list of named `Inset` contributions that
shrink the area children resolve against.

```js
frame.insets.set('safe',    'env(safe-area-inset-*)');  // notches, home indicators
frame.insets.set('chrome',  { top: 48 });               // a fixed app toolbar
frame.insets.set('keyboard', { bottom: 0 });            // virtual keyboard, live
```

Contributions compose by **max per edge**, not by sum — two overlays both claiming 16px
from the bottom should yield 16, not 32. An element opts out with `insets: false` (resolve
against the raw frame) or `insets: ['safe']` (only that contribution).

This is how a HUD avoids the notch, how a modal avoids the virtual keyboard, and how a
docked toolbar reserves space, all through one mechanism.

### 5.8 Constraint priorities and over-constraint resolution

Every geometric input carries an optional priority: `'required' | 'strong' | 'medium' |
'weak'` (default `'strong'`; `min`/`max` default to `'required'`).

Resolution order per axis:
1. Collect all constraints.
2. If exactly 2 non-`required` positional constraints, solve directly.
3. If over-constrained, drop the lowest-priority constraint(s) until determined. Ties break
   by a documented fixed order: `size` yields to edges, then `end` edge yields to `start`
   edge. (`{right, top, bottom, height}` → `height` is dropped; the element stretches. This
   matches author expectation.)
4. Apply `min`/`max` clamps (always `required`).
5. Apply `keepWithin` containment (default: the frame; `false` to allow overflow).

Dropped constraints are recorded on the node and surfaced in devtools and in the
development build's console, so "why is my box the wrong size" is answerable.

### 5.9 Worked example — the user's own words

> *"create split panes with draggable separator, split vertically, with left pane
> defaulting to 100 px. Now split right pane with draggable separator, split horizontally,
> with bottom pane defaulting to 150 px."*

```js
const app = Mutakit.mount(document.body);

const [left, right] = app.split({
  axis: 'x',                                   // panes distributed along x → vertical bar
  gutter: { size: 6, draggable: true },
  panes: [
    { id: 'left',  size: 100, min: 64, max: '40%' },
    { id: 'right', size: '1fr' }
  ]
});

const [stage, bottom] = right.split({
  axis: 'y',                                   // panes distributed along y → horizontal bar
  gutter: { size: 6, draggable: true },
  panes: [
    { id: 'stage',  size: '1fr' },
    { id: 'bottom', size: 150, min: 80, collapsible: { at: 40, to: 0 } }
  ]
});
```

> *"create modal with width 80% and height 85%, position it by its center at the center of
> the screen."*

```js
const dlg = Mutakit.create('modal', {
  size:   { w: '80%', h: '85%' },
  anchor: 'center',
  at:     'center',
  of:     'viewport'
});
```

Because `anchor` defaults to `at`, the idiomatic form is shorter:

```js
Mutakit.create('modal', { size: { w: '80%', h: '85%' }, at: 'center' });
```

**⚑ D3 — the "split vertically" ambiguity, resolved.** "Split vertically" is genuinely
ambiguous in the wild: it can mean *the separator is vertical* (panes side by side) or *the
split stacks vertically* (panes above and below). The user's phrasing —
"split vertically, with **left** pane…" — means the separator is vertical.

Mutakit's canonical vocabulary is therefore **`axis`**, which is unambiguous: `axis: 'x'`
distributes panes along the x axis (side by side, vertical separator). The words
`'vertical'`/`'horizontal'` are accepted as aliases **describing the separator**, matching
the user's usage — but the documentation leads with `axis` everywhere, and the development
build emits a one-time note the first time an alias is used, stating the interpretation.

### 5.10 Geometry test strategy

Geometry is pure and therefore exhaustively testable without a DOM. `Len` parsing,
`fr` distribution, over-constraint resolution, inset composition, and anchor math all get
table-driven tests (§23.2). This is the highest-value test surface in the project.

### 5.11 Root frames, scrolling, and where sizes ultimately come from

Every percentage bottoms out somewhere. That somewhere is the **root frame**, and draft 1
left it unspecified — which would have been a real hole, since `document.body` has zero
intrinsic height and is the most likely mount target.

**Root sizing modes**, chosen at `mount()`:

| Mode | Source of the root rect | Use |
|---|---|---|
| `'element'` (default) | a `ResizeObserver` on the mount target's content box | embedding into a page |
| `'viewport'` | the visual viewport from the metrics snapshot | full-screen apps, games (S3) |
| `'fixed'` | an explicit `{w, h}` | tests, printing, fixed canvases |

If a root in `'element'` mode measures zero on either axis, that is diagnostic **MK1001**,
which names the mount target and states the two fixes (give it a size, or use
`sizing: 'viewport'`). Silently rendering nothing is the single most likely first-run
failure, so it gets a dedicated, actionable error.

Multiple roots per document are supported and independent (P8). Roots may nest — an
`'element'`-mode root inside a pane of another root is how you embed a self-contained
widget — but geometry does not flow across the boundary; the inner root sees only its own
mount target.

**Scrolling.** A scrollable node has two distinct boxes, and conflating them is a classic
source of bugs:

- the **scrollport** — the visible region, fixed in the parent's space;
- the **content box** — the full laid-out extent, which may exceed the scrollport.

The rules:

1. Children laid out by the node's algorithm resolve against the **content box**.
2. Children placed by `at`/`inset`/anchors resolve against the **scrollport** by default,
   so they stay pinned while content scrolls. `scrollWith: 'content'` opts into scrolling
   with the content instead. This is the `sticky`-versus-`absolute` distinction, made
   explicit and available on every element rather than being a CSS quirk.
3. `of: 'viewport'` always escapes every intervening scroller. This is why overlays and HUD
   elements are correct by default no matter how deeply they are declared.
4. Scrollbar width is read from the metrics snapshot and subtracted from the scrollport, so
   percentages do not overflow on platforms with classic scrollbars.
5. Scroll position is state, not geometry: it lives in the store (§15.3), is restorable
   (§19.1), and changing it sets `PAINT`, never `ARRANGE`.

---

## 6. The layout engine

### 6.1 The node tree

Mutakit maintains a retained tree of `LayoutNode`s that shadows the DOM tree. A node holds:

```
id, type, parent, children[]
props        (validated against the element's schema)
geometry     (the declared Len/anchor/edge inputs)
computed     (resolved Rect, in frame space — only populated when needed)
frame        (the content box children resolve against, incl. insets)
flags        (dirty bits — see §6.2)
el           (the DOM element, or null for virtual nodes)
algorithm    (the layout algorithm governing this node's children)
state        (per-node bag owned by the element type)
```

Nodes are created and destroyed with the elements they back. The tree is the thing that
gets serialized (§19) and inspected (§19.3).

### 6.2 Invalidation

Four independent dirty bits, propagated with different rules:

| Bit | Meaning | Propagation |
|---|---|---|
| `STYLE` | visual-only change; no geometry effect | self only |
| `MEASURE` | intrinsic size may have changed | up to the nearest node with a fixed size on that axis |
| `ARRANGE` | position/size of children must be recomputed | down the subtree |
| `PAINT` | a transform/opacity-only change | self only; fast path, skips layout entirely |

The `PAINT` fast path is what makes S3 fast: a HUD element that moves every frame sets only
`PAINT`, which writes a `transform` and never touches the layout pipeline.

Invalidation is *coalescing*: setting a bit that is already set is free, and the scheduler
is armed at most once per frame.

### 6.3 The frame loop

A single `requestAnimationFrame` callback runs strictly ordered phases:

```
1. INPUT     drain the pointer/key/gamepad queues; update gesture state machines
2. STATE     flush signal updates; run effects; element update() callbacks
             (may set dirty bits; loops until quiescent, max 8 iterations)
3. READ      take the MetricsSnapshot; measure every node with MEASURE set
4. ARRANGE   resolve geometry for every node with ARRANGE set (pure computation)
5. WRITE     apply CSS: custom properties, inline styles, class changes, transforms
6. PAINT     post-write hooks: canvas draws, animation ticks, IntersectionObserver reads
7. IDLE      if no bits are set, unschedule the loop entirely
```

Phase 7 matters: an idle IDE layout should consume zero CPU. The loop re-arms on the next
invalidation. A `mk.tick()` method forces a synchronous flush, for tests and for the rare
case where an author needs a measured value immediately.

**When STATE fails to settle.** If the STATE phase is still producing dirty bits after 8
iterations, the frame does not spin: the remaining work is deferred to the next frame, and
diagnostic **MK5003** reports the nodes and signals still oscillating. This guarantees the
loop always yields to the browser — a runaway effect cycle degrades to a janky UI, never a
frozen tab.

**Reentrancy.** Setting a dirty bit during `WRITE` schedules for the *next* frame; it never
extends the current one. Reading geometry during `WRITE` throws in the development build
(P4). These two rules together make layout thrash structurally impossible rather than
merely discouraged.

### 6.4 `MetricsSnapshot`

One object, taken once per frame in the READ phase, holding everything that would otherwise
require a forced reflow: viewport size, visual viewport offset and scale, scrollbar width,
`devicePixelRatio`, root font size, safe-area insets, `prefers-reduced-motion`,
`prefers-color-scheme`, `prefers-contrast`, pointer coarseness. Every consumer reads from
the snapshot, never from the live DOM. Changes between snapshots emit `metrics:change`.

### 6.5 Measurement

Intrinsic measurement is expensive and is avoided wherever possible. Three strategies, in
preference order:

1. **Don't** — if every child has a resolvable size, skip measurement entirely.
2. **Observe** — `ResizeObserver` on nodes with `auto` sizing, feeding results into the
   next frame's snapshot. Asynchronous, zero forced reflow, correct in the steady state.
   This is the default.
3. **Force** — a synchronous `getBoundingClientRect` in the READ phase, only for nodes
   flagged `measureSync`, used when a first-frame flash would be visible (a tooltip that
   must be positioned before it is shown).

Strategy 3 is batched: all forced reads happen consecutively in READ, so at most one reflow
per frame regardless of how many nodes need it.

### 6.6 The style compiler

The ARRANGE phase produces, for each node, a small set of **CSS custom property
assignments** rather than a full inline style string:

```
--mk-x, --mk-y, --mk-w, --mk-h, --mk-inset-*, --mk-track-*, --mk-gutter
```

The element's static stylesheet consumes those properties. Benefits:

- Writes are cheap and diffable — the compiler skips a property whose value is unchanged.
- Authors can override or animate any of them from their own CSS.
- Most of the actual arithmetic stays in CSS (`calc(var(--mk-w) - var(--mk-gutter))`),
  honouring P1.
- Transitions and animations work without JavaScript involvement.

Inline geometry is written only where custom properties can't reach (e.g.
`grid-template-columns`, which we build as a string but only when the track list changes).

---

## 7. Layout algorithms

A layout algorithm governs how a node's *children* are placed. It is a plugin (§10.2).

```js
Mutakit.layout({
  name: 'split',
  schema: { /* validates the algorithm's own options */ },
  childProps: {                                       // validates each child's
    size:        { type: 'len', default: '1fr' },     // `layout` bag — see below
    min:         { type: 'len' },
    max:         { type: 'len' },
    collapsible: { type: 'object' }
  },
  measure(node, children, ctx) { return {w, h}; },   // optional intrinsic size
  arrange(node, children, ctx) { /* assign child rects / tracks */ },
  css(node, ctx) { return { /* container-level properties */ }; },
  interactive: true,                                  // participates in gestures
});
```

### 7.0 Child props — how an algorithm parameterizes its children *(resolves D15)*

An algorithm almost always needs per-child information: a split needs each pane's `size`
and `min`, a grid needs each child's `column`, a dock needs each region's edge. Draft 4 had
no contract for this, so `acme:rack` in Appendix A read `child.props.units` — a prop it
defined but did not own, where a typo silently fell back to a default.

The resolution has two halves.

**1. Child props live in a reserved `layout` bag, not in the element's own props.**

```js
stack.create('acme:dial', {
  label: 'Gain',                 // the element's own prop
  layout: { units: 2 }           // the parent algorithm's prop
});
```

Separating them prevents a real collision: `size` means something to almost every element
*and* to almost every algorithm, and merging the two namespaces would make `size` ambiguous
exactly where geometry is being decided.

**2. Only the immediate parent's algorithm validates the bag**, against its `childProps`
schema, at three engine-controlled moments: insertion, reparenting, and mutation.

| Situation | Behaviour |
|---|---|
| Unknown key | **MK2012**, naming the key, the algorithm, and its accepted keys. The value is *retained but ignored* — so moving the child back to a compatible parent restores it. |
| Missing key | filled from the schema's `default` |
| Wrong type | coerced by the validator, or MK2012 if uncoercible |
| Reparented | re-validated against the new algorithm; keys the new one doesn't know become MK2012 but survive |
| Ancestors | have no say — validation is strictly one level, which keeps the rule predictable and reparenting cheap |

**This is not a new concept, it is a formalization.** `split`'s `panes: [{ size, min, max,
collapsible }]` and `grid`'s per-child `column`/`row`/`span` were already child props,
declared informally in prose. `childProps` gives them a schema, which means they gain
validation, generated documentation (§24), generated types (§22.5), and devtools display
for free — the same four-consumer argument that justifies §8.1's prop schemas.

Serialization keeps the bag verbatim, so a layout saved under an algorithm that is later
missing (§19.1) restores its children's layout data intact once the plugin returns.

The authoring sugar stays: `split({ panes: [...] })` and `grid({ areas })` write the bag on
each child, so the common cases never mention `layout:` at all (P6).

**A naming collision this forced, worth recording.** Draft 4 used `layout: 'anchor'` in the
element definition (§8.1) to mean *"the algorithm governing my children"*. Introducing
`layout: { units: 2 }` for *"how my parent should place me"* would have made one key mean two
opposite things depending on which side of the parent/child relationship you were reading —
the exact ambiguity that makes "split vertically" (§5.9) a bad term. The algorithm selector is
therefore renamed **`algorithm`**, which says only one thing, and `layout` belongs
unambiguously to the child.

### 7.1 `anchor` (core)

The default. Each child is placed independently by its anchor/edge constraints (§5.5–5.6)
against the parent frame. Children may overlap. Emits `position: absolute` plus
`inset`/`translate` custom properties. This is the HUD algorithm and the overlay algorithm.

### 7.2 `stack` (core)

Children in a single row or column, sized by `Len` (including `fr`), with `gap`,
`align`, `justify`, `wrap`, and `reverse`. Compiles to flexbox. This is the workhorse for
toolbars, button rows, form layouts.

### 7.3 `split`

`stack` plus separators. Adds: draggable gutters, per-pane `min`/`max`, `collapsible`,
`snap` points, `resizeMode` (`'neighbor'` — take space only from the adjacent pane, the
default; `'distribute'` — spread across all flexible panes; `'push'` — cascade past panes
that hit their minimum), and persistence of pane sizes by `id`.

Compiles to CSS Grid with an explicit `grid-template-*` track list, which gives correct
`fr` behaviour and `min`/`max` clamping for free. Gutters are real grid tracks so they
participate in the track sizing rather than being overlaid.

**How much of a drag is CSS?** (Analysed in §27.2 R1; prototype in `test/proto/split-grid.html`.)
Static layout and container resize are entirely CSS. `neighbor` and `distribute` drags are
too — with one exception measured after this paragraph was written, `distribute` against a
maximum, for which see the fallback rule below. The track list compiles to
`clamp(min, min(var(--w), 100% − gutters − Σ neighbour mins), max)`, so JavaScript writes one
*unclamped* custom property per pointer move and the browser applies every bound, including
the point at which a neighbour hits its minimum and the gutter must stop. `push` is the
exception — sequential exhaustion is not what `fr` distribution does, and expressing it in CSS
costs an O(n²) expression — so `push` walks the cascade in JavaScript during the drag and
writes explicit sizes, which CSS then re-clamps idempotently. This is consistent with P1:
JavaScript computes numbers only when interaction demands it, and the idle path stays free.

*Measured, not assumed* (Chrome, 2026-08-06 — see §27.2 R1 for the full table). Every bound
above held with JavaScript writing deliberately out-of-range values: `--w0: 3px` produced a
64px track, `--w0: 1015px` produced 380px, `--w1: -71px` produced 80px. The neighbour-
exhaustion cap resolved to the arithmetically exact value (166.4px in a 358.4px container).
A container-resize sweep from 1200px to 240px performed **zero** JavaScript property writes
while keeping every bound and summing tracks exactly to the content box.

The run also corrected one line of the analysis. **`distribute` enforces minimums in CSS but
not maximums:** `minmax(min, 1fr)` gives a flexible track a floor and no ceiling, and `fr`
cannot appear inside `min()`/`clamp()`, so a non-dragged pane overruns its `max` (measured at
643.2px against a `max` of 500). The rule below is the response. One further boundary is now
documented rather than assumed: below Σ mins + gutters, CSS holds the minimums and lets the
container overflow, which `split` treats as defined behaviour (§27.2 R1).

#### `distribute` and maxima — the fallback rule *(normative)*

A `distribute` drag of gutter *k* resizes pane *k* and spreads the inverse delta across the
**flexible set**: panes *k+1 … n−1*, minus any pane that is currently `collapsed` or otherwise
pinned. The set is computed once, on `pointerdown`, and held for the life of the drag —
recomputing it per frame would let the track form change mid-drag, which is visible as a jump.

The drag takes the **CSS path** if and only if every pane in the flexible set has **no finite
`max`, no `snap` points, and no `collapsible`**. Otherwise it takes the **JS path**. A `min`
alone never forces the JS path: R1 measured `minmax(min, 1fr)` enforcing minimums correctly.
Since most panes declare only a `min`, the common case stays on the CSS path.

On the **CSS path**, pane *k* compiles to the usual clamp expression, each flexible pane to
`minmax(var(--min_i), var(--fr_i) fr)`, and JavaScript writes one unclamped custom property per
`pointermove` — the browser does the rest, as in `neighbor`.

The **JS path** is CSS's own fr-distribution algorithm with the finite growth limits restored.
Let `D` be the delta pane *k* is trying to take (positive = pane *k* grows); the flexible set
must absorb `−D`. Per `pointermove`:

1. Seed each flexible pane at its size when the drag began.
2. Distribute the unabsorbed pool across the unfrozen panes in proportion to their `fr` weight.
3. Clamp any pane that lands outside `[min_i, max_i]` to the bound it violated, freeze it, and
   return the amount it could not absorb to the pool.
4. Repeat 2–3 until the pool is empty or every pane is frozen. This terminates in at most
   `|flexible set|` passes, because each pass freezes at least one pane.
5. Subtract any still-unabsorbed remainder from `D`. The gutter stops there — this is the
   `distribute` analogue of `neighbor`'s exhaustion cap, and it is why the two modes feel the
   same at their limits.

Step 3 is a no-op when every `max` is infinite, so **the JS path yields exactly what the CSS
path yields whenever the CSS path is legal.** That equivalence is the invariant to test, and it
is what lets a group cross between paths — a pane gaining a `max` at runtime — with no visible
change in behaviour.

Both paths commit explicit pixel sizes on release, after which the tracks revert to the clamp
form and CSS re-clamps idempotently, so the committed value cannot disagree with what was on
screen. The CSS path must commit the widths **read back from the browser**, not its own
estimate of them; that read-back is what makes the revert invisible. Idle and container-resize
layout remain pure CSS on both paths, which is the property P1 actually rests on: JavaScript
runs only while a pointer is down.

Interaction details that must be specified, because they are what separates a usable
splitter from a frustrating one:

- **Pointer capture** on `pointerdown`, so a fast drag outside the gutter still tracks.
- **Hit slop**: the visual gutter may be 1–6px while the interactive area is ≥ 8px (larger
  for coarse pointers, read from the metrics snapshot).
- **Live vs. deferred**: `live` (default) resizes during drag; `deferred` draws a ghost bar
  and applies on release. `deferred` is the fallback when the pane content is expensive.
- **Clamping cascade**: dragging past a pane's `min` stops the gutter unless `resizeMode:
  'push'`, in which case the constraint propagates to the next gutter. Under `'distribute'`
  the gutter stops once the whole flexible set is exhausted, not merely the adjacent pane —
  see the fallback rule above, which also governs whether that bound is applied by CSS or JS.
- **Collapse**: dragging below `collapsible.at` snaps to `collapsible.to` (usually 0) and
  sets a `collapsed` state; the gutter remains draggable to restore. Double-click toggles.
- **Keyboard**: the gutter is focusable, `role="separator"`, with `aria-valuenow`,
  `aria-valuemin`, `aria-valuemax`, and `aria-controls`. Arrow keys move by
  `step` (default 8px), `Shift+Arrow` by `step × 5`, `Home`/`End` to min/max, `Enter` to
  toggle collapse.
- **Ratio preservation**: when the container resizes, `fr` panes rescale proportionally and
  fixed panes hold their pixel size, until a fixed pane would violate a `min`, at which
  point it shrinks last-in-first-out.
- **Nested splits**: a pane is itself a frame with its own algorithm. `split()` on a pane
  handle replaces that pane's algorithm. Depth is unbounded.

### 7.4 `dock`

Edge-docked regions around a centre: `top`, `bottom`, `start`, `end`, `center`. The centre
takes the remainder. This is the classic application shell, and it composes with `split`
for the IDE case.

```js
app.dock({
  corners: 'horizontal',              // 'horizontal' | 'vertical' | 'explicit'
  regions: {
    top:    { size: 40,  id: 'menubar' },
    bottom: { size: 24,  id: 'statusbar' },
    start:  { size: 260, id: 'explorer', resizable: true, collapsible: { at: 120 },
              overlay: false },
    end:    { size: 320, id: 'inspector', resizable: true, collapsed: true },
    center: { id: 'workspace' }
  }
});
```

**Corner arbitration** is the property that distinguishes a real dock from a naive one, and
it is the first thing an author hits:

| `corners` | Result |
|---|---|
| `'horizontal'` (default) | `top`/`bottom` span the full width; side rails run between them |
| `'vertical'` | `start`/`end` run full height; `top`/`bottom` sit between them |
| `'explicit'` | each region declares `spans: ['start','end']`, for asymmetric shells (a full-width title bar above a full-height rail) |

**Region behaviour.** Each edge region is independently `resizable` (a gutter on its inner
edge, sharing all of §7.3's interaction rules — there is one splitter implementation, not
two), `collapsible` (to zero, or to a `rail` size that keeps icons visible — the common
IDE pattern), and `overlay`. An `overlay: true` region floats above the centre rather than
reserving space, which is how a narrow-viewport responsive shell turns a sidebar into a
drawer without restructuring the tree.

**Insets.** A non-overlay region contributes to the centre's inset stack (§5.7) under its
own name. This is what lets a HUD or a modal declared with `of: 'viewport'` optionally
respect application chrome: `insets: ['safe', 'chrome']`.

**Responsive collapse.** `breakpoints: { 900: { start: 'rail' }, 640: { start: 'overlay',
end: 'hidden' } }` — evaluated against the *container's* width from the metrics snapshot,
not the viewport's, so a docked shell nested inside a pane behaves correctly. This is a
container query expressed as data.

**Not in `dock`:** drag-to-dock, tab merging, and floating-window extraction. Those are the
`dockspace` algorithm (§7.8), deliberately separate — they carry a large interaction and
serialization surface that most application shells never need, and bundling them would put
that weight in everyone's `dock`.

### 7.5 `grid`

Explicit 2D placement: `columns`, `rows` (arrays of `Len`), `areas` (named template),
`gap`, and per-child `column`/`row`/`area`/`span`. A thin, well-typed wrapper over CSS
Grid rather than a reimplementation.

### 7.6 `flow`

Normal document flow — for prose and for content Mutakit shouldn't be positioning. An
explicit escape hatch so authors don't have to leave the tree.

### 7.7 `free`

Children position themselves (`positioning: 'self'` is the default here — §9.1), which
makes this the floating-window, canvas, and node-graph algorithm. It pairs with the
`draggable` and `resizable` traits, and unlike `anchor` it maintains *state* about its
children.

```js
canvas.free({
  bounds: 'container',                 // 'container' | 'infinite' | Rect
  grid:   { x: 8, y: 8, snap: 'move' },// 'move' | 'resize' | 'both' | false
  stacking: 'recency',                 // 'recency' | 'declared' | 'manual'
  placement: 'cascade',                // where a child with no position goes
  collision: 'none',                   // 'none' | 'avoid' | 'push'
  pan: true, zoom: { min: 0.25, max: 4 }
});
```

- **Stacking.** `'recency'` brings a child to front on pointer-down or focus — the window
  behaviour everyone expects. Order is *within* the parent's layer band (§16.1), so a
  floating window can never escape above a modal no matter how many times it is clicked.
  This is exactly the bug that z-index arithmetic produces and layer bands prevent.
- **Placement of new children.** A child created without a position gets one from
  `placement`: `'cascade'` (offset diagonally from the last, wrapping at the edge),
  `'center'`, `'first-fit'` (first empty area large enough), or a function. Windows that
  all open at the same coordinates are a classic annoyance; the default avoids it.
- **Bounds.** `'container'` clamps children to the frame — with a `keepVisible` margin so a
  window can hang off an edge but never become impossible to grab. `'infinite'` enables
  pan/zoom and an unbounded coordinate space, which is what a node graph needs.
- **Pan and zoom** apply a single transform to the child plane. Children are laid out in
  *world* coordinates; the transform is a PAINT-phase concern (§6.2), so panning a graph of
  500 nodes costs one transform write, not 500 layout resolutions. Hit testing composes the
  inverse matrix via §5.4.
- **Collision.** `'none'` (overlap freely — correct for windows), `'avoid'` (a dropped child
  slides to the nearest free position), `'push'` (displace neighbours). `avoid`/`push` are
  O(n) per drag against a spatial index, capped at a documented node count before degrading
  to `'none'` with a diagnostic rather than dropping frames.
- **Persistence.** Child positions, sizes, stacking order, and the pan/zoom transform all
  serialize (§19.1) — restoring a workspace of floating windows is the point of the
  algorithm, not an extra.

### 7.8 Future / plugin algorithms

`masonry`, `radial` (for radial menus), `dockspace` (Dear ImGui-style tab-docking with
drop targets), `constraint` (a Cassowary solver for genuinely simultaneous constraints),
`virtual` (windowed lists). None are core; all are proof that the extension point is
sufficient.

---

## 8. The element model and plugin contract

This is the section that decides whether "highly modular, plugins add new elements"
is true or aspirational.

### 8.1 Definition

```js
Mutakit.define({
  // ── identity ──────────────────────────────────────────────────────────
  type: 'acme:gauge',              // namespaced; bare names reserved for built-ins
  version: '1.2.0',
  extends: 'surface',              // inherit props, traits, styles, defaults
  requires: { mutakit: '^1.0.0', 'acme:theme': '^2' },

  // ── contract ──────────────────────────────────────────────────────────
  props: {                         // schema: validation + coercion + docs + devtools
    value:   { type: 'number', default: 0, min: 0, max: 1, reactive: true },
    label:   { type: 'string', default: '' },
    variant: { type: 'enum', values: ['arc', 'bar'], default: 'arc' }
  },
  geometry: { defaults: { size: { w: 120, h: 120 } }, resizable: 'proportional' },
  traits: ['focusable', 'tooltip-host'],
  algorithm: 'anchor',             // layout algorithm governing this element's children
  slots: { default: {}, footer: { max: 1 } },
  layer: 'content',                // default stacking layer (§16)

  // ── lifecycle ─────────────────────────────────────────────────────────
  create(ctx)            { /* build DOM; return the root element */ },
  mount(ctx)             { /* in the document; attach observers */ },
  update(ctx, changed)   { /* props changed; changed is a Set of names */ },
  measure(ctx, avail)    { /* optional intrinsic size */ },
  arrange(ctx, rect)     { /* optional; usually the algorithm handles it */ },
  paint(ctx)             { /* optional per-frame hook (canvas, WebGL) */ },
  unmount(ctx)           { /* detached but may return */ },
  destroy(ctx)           { /* release everything; must be leak-free */ },

  // ── surface ───────────────────────────────────────────────────────────
  commands: { setValue(ctx, v) {…}, reset(ctx) {…} },   // become handle methods
  events:   ['change', 'overload'],                     // declared, validated
  a11y:     { role: 'meter', props: { 'aria-valuenow': ctx => ctx.props.value } },
  keys:     { 'ArrowUp': 'increment', 'ArrowDown': 'decrement' },

  // ── presentation ──────────────────────────────────────────────────────
  styles: css`…`,                  // injected once, into the mutakit.element layer
  tokens: { '--acme-gauge-track': 'var(--mk-color-muted)' },
  motion: { enter: 'fade', exit: 'fade', reduced: 'none' }
});
```

Every field except `type` and `create` is optional. A trivial element type is six lines.

### 8.2 `ctx` — the element context

The only surface a plugin sees. Nothing else is reachable. This is the enforcement
mechanism for P3.

```
ctx.node        the LayoutNode
ctx.el          the root DOM element
ctx.props       validated, reactive props (a Proxy in dev, a plain object in prod)
ctx.state       a per-instance bag owned by the element type
ctx.geometry    read: resolved Rect (valid in ARRANGE/PAINT only) · write: set constraints
ctx.children    child handles; add / remove / reorder
ctx.slots       slot content management
ctx.emit(name, detail)          declared events only; unknown name throws in dev
ctx.on(name, fn)                auto-removed on destroy
ctx.invalidate(bits)            'style' | 'measure' | 'arrange' | 'paint'
ctx.mk          the owning Mutakit instance (registries, services, theme)
ctx.service(name)               layers, focus, shortcuts, motion, announcer, persistence
ctx.trait(name)                 the trait's per-instance API
ctx.gesture(name, handlers)     attach a gesture; returns a disposable
ctx.dom(tag, attrs, parent)     create an element; tracked for automatic teardown
ctx.css(props)                  write custom properties; diffed by the style compiler
ctx.tokenPx(name, fallback)     read a design token as a number, from the frame's
                                metrics snapshot — never a live getComputedStyle
ctx.own(disposable)             registers cleanup; the main defence against leaks
ctx.dev                         diagnostics; stripped from production builds
```

The layout-algorithm context (§7) is a separate, smaller surface: `ctx.tracks(axis, lens)`
compiles a `Len` list into a grid template, `ctx.len(value)` resolves a `Len` against the
current basis, and `ctx.place(child, rect)` assigns a box directly.

`ctx.own()` is deliberately prominent. Every listener, observer, timer, and animation a
plugin creates goes through it, and `destroy` runs them in reverse order automatically.
Plugins that leak fail the leak test in §23.5.

### 8.3 Inheritance vs. composition

`extends` is single-inheritance and shallow-merging: props, traits, styles, tokens, keys,
and a11y merge; lifecycle hooks *chain* (the parent's runs first, and the child receives
the parent's return value). It exists for genuine specialization — `dialog extends surface`,
`alert-dialog extends dialog`.

**Traits are the primary reuse mechanism**, not inheritance. Composition scales; deep
element hierarchies do not. The built-in catalog is deliberately shallow: at most two
levels of `extends` anywhere.

### 8.4 Registration, versioning, and conflicts

- Names are namespaced `vendor:name`. Bare names are reserved for core; registering a bare
  name from a plugin is an error.
- Re-registering an existing type is an error unless `{ replace: true }` is passed, which
  logs a warning naming both versions. This makes accidental collisions loud and deliberate
  overrides possible.
- `requires` is checked at install time against registered plugin versions using SemVer
  range matching. A failed check throws with the full dependency chain.
- Installation is topologically ordered; cycles are detected and reported.
- `Mutakit.registry.list()` returns everything registered with versions and origins, for
  devtools and bug reports.

### 8.5 Plugin packaging

```js
// a distributable plugin
(function (root, factory) { /* UMD */ })(this, function () {
  return {
    name: 'acme-widgets',
    version: '1.2.0',
    requires: { mutakit: '^1.0.0' },
    install(mk, options) {
      mk.define({ type: 'acme:gauge', … });
      mk.trait({ name: 'acme:pulse', … });
      mk.layout({ name: 'acme:radial', … });
      return { uninstall() { /* optional */ } };
    }
  };
});

Mutakit.use(AcmeWidgets, { defaultVariant: 'arc' });
```

`use()` is idempotent per instance. `install` receives the *instance*, not the global —
this is what makes P8 hold.

**Uninstall semantics.** Draft 2 left `uninstall()` as "optional" without saying what it
means, which would have been a slow leak of a design hole. The rule: uninstalling a plugin
**deregisters its contributions but does not destroy live elements.** Existing instances of
its types keep working until they are destroyed normally; only new `create()` calls for
those types fail. This makes `uninstall` safe to call during hot-reload in development,
which is its main use, and avoids a plugin removal silently tearing a hole in a running
application shell. Deregistering a type that has live instances emits MK4014 with the count,
so the situation is visible rather than mysterious.

### 8.6 Instances and isolation

```js
const app    = Mutakit.create({ theme: 'dark', prefix: 'mk' });
const widget = Mutakit.create({ theme: 'light', prefix: 'wk', inherit: false });
```

Each instance owns its registries, layer stack, focus manager, shortcut scope, and style
sheets. By default an instance inherits the *global* registry's definitions by reference
(cheap, shared); `inherit: false` gives full isolation for embedding into a hostile page.
The class prefix is per instance so two versions of Mutakit on one page cannot collide in
CSS either.

### 8.7 Contract conformance

A published `Mutakit.conformance(definition)` helper runs a definition against the contract
and reports violations: undeclared events emitted, listeners not registered through
`ctx.own`, missing `destroy` cleanup, absent a11y semantics without an explicit opt-out,
props mutated outside `update`. It runs automatically in the development build on every
`define()` and is available to plugin authors as a test utility. This turns P3 and P5 from
documentation into something checkable.

### 8.8 Content interop — getting your own DOM into a Mutakit tree

A GUI system that can only contain its own elements is a toy. Draft 1 mentioned `slots` but
never specified how arbitrary content gets in; this is that specification.

The `content` prop accepts five forms:

| Form | Behaviour |
|---|---|
| `'some text'` | set as `textContent`. **Never parsed as HTML** (§21.4). |
| `Node` / `DocumentFragment` | **adopted** — see the contract below |
| `{ type: 'pane', … }` | a nested Mutakit element (tier-2 form, §18.2) |
| `(ctx) => Node` | a factory, invoked once at mount |
| `() => Promise<Node>` | lazy content; see below |

Plus `mk.adopt(existingElement, { … })`, which wraps a node already in the document and
takes over only its geometry, leaving it where it is in the DOM if possible.

**The adoption contract** — this is what makes framework interop and incremental adoption
work, so it is stated as a guarantee, not a behaviour:

> On an adopted node, Mutakit writes **only** the geometry custom properties of §12.4, the
> `position`/`inset`/`transform`/`contain` properties they feed, and `data-mk-*` attributes.
> It never adds or removes that node's children, never touches its classes or listeners,
> and never reads its internals. On destroy it applies `onDestroy: 'return'` (restore to the
> original parent and inline style, the default), `'detach'`, or `'remove'`.

**Framework interop follows directly.** A React or Vue adapter asks Mutakit for a container
node, renders into it, and owns it completely; Mutakit only sizes and positions it. There is
no reconciliation, no double-ownership, and no adapter-specific code in core. The entire
adapter is a few dozen lines per framework, which is why they are plugins (§10) rather than
a maintenance burden.

**Lazy content.** `content: () => import('./panel.js')` reserves the element's geometry
immediately from its declared size, shows the `loading` slot, and swaps on resolution — so a
lazily loaded panel never causes a layout jump. Rejection routes through §8.10.

### 8.9 Identity, lookup, and stable keys

- **`id` is optional and scoped to the owning instance**, never global (P8). A duplicate id
  is diagnostic MK4005, not an error: lookup returns the first, both elements keep working.
  Silently breaking a running UI over a name collision would be the wrong trade.
- Every node also carries a **stable path key**, derived from its position, type, and id:
  `root/split[0]/pane#main/tabs[2]`. Persistence (§19) keys on `id` where present and falls
  back to the path key — so a tree with no ids at all still restores correctly as long as
  its shape is unchanged, and a tree with ids survives being reordered.
- `mk.byId(id)` and `mk.query('modal#settings.open')` — a small selector language over the
  node tree, matching on type, id, and state. Used by devtools, tests, and the shortcut
  registry's `aria-controls` wiring.

### 8.10 Error isolation

One broken third-party plugin must not take down an application shell. Every lifecycle hook
runs inside a guard. When a hook throws, Mutakit:

1. marks the node `errored` and halts further hooks on it;
2. replaces its subtree with an error placeholder **that preserves the node's declared
   geometry**, so surrounding layout does not collapse and the failure stays visually local;
3. emits diagnostic MK3xxx carrying the element type, the owning plugin's name and version,
   and the original stack;
4. fires an `error` event that bubbles the node tree, so the application can report it.

`errorPolicy` is per instance: `'isolate'` (default), `'propagate'` (rethrow — useful in
tests), or `'silent'`. A throwing `destroy` is always logged and always swallowed, because
teardown of siblings must complete regardless.

---

## 9. Traits (behaviours)

A trait adds behaviour to any element type. Traits are plugins with the same rigour as
elements.

```js
Mutakit.trait({
  name: 'draggable',
  props:   { handle: {type:'selector'}, axis: {type:'enum', values:['x','y','both']},
             bounds: {type:'any'}, grid: {type:'number'} },
  requires: ['focusable'],                 // trait dependencies
  conflicts: ['flow-positioned'],
  attach(ctx, options) { … },
  detach(ctx) { … },
  api: { startDrag(ctx) {…}, cancelDrag(ctx) {…} },
  events: ['dragstart', 'drag', 'dragend'],
  keys: { /* keyboard equivalent — mandatory for pointer traits (P5) */ }
});
```

Initial catalog:

| Trait | Provides |
|---|---|
| `focusable` | tabindex management, focus ring, `focus`/`blur` events |
| `draggable` | pointer + keyboard move, axis lock, grid snap, bounds, drag handle |
| `resizable` | 8 handles, aspect lock, min/max, keyboard resize |
| `dismissible` | Escape, click-outside, `light`/`modal` dismiss policy, `beforeclose` veto |
| `focus-trap` | contain focus, restore on close, `inert` the background |
| `collapsible` | collapse/expand with size memory and animation |
| `scrollable` | scroll container management, overscroll containment, scroll restoration |
| `selectable` | single/multi selection, `aria-selected`, range and toggle modifiers |
| `sortable` | reorder within/between containers, drop indicators, keyboard reorder |
| `positioned` | anchored positioning with flip/shift/collision (§16.3) |
| `tooltip-host` | hover/focus intent timing, delegated tooltip |
| `virtualized` | render only what is visible in a scrollable list |
| `persistable` | opt in to serialization by `id` (§19) |

Traits attach in a deterministic order (declaration order, dependencies first), and their
event handlers compose rather than override. A trait may veto another's action through the
event system (`dismissible` can be prevented by an unsaved-changes guard).

### 9.1 Arbitration — who owns a child's box

Traits that write geometry (`draggable`, `resizable`) and layout algorithms that write
geometry both want to control the same numbers. Left unspecified, this is where UI libraries
misbehave silently — you attach a drag handler inside a flex row and the element jitters or
snaps back with no explanation. Mutakit makes it a stated rule with a diagnostic:

> **The parent's layout algorithm owns a child's box, unless that child declares
> `positioning: 'self'`.**

- `draggable` and `resizable` set `positioning: 'self'` automatically when they attach.
- In the `anchor` and `free` algorithms, `positioning: 'self'` is already the default, so
  dragging simply works with no configuration.
- In `stack`, `split`, `grid`, and `dock`, a self-positioning child is a contradiction —
  the algorithm computes a track for something that refuses to sit in it. This is diagnostic
  **MK2011**, and the message names the two real fixes: use the `sortable` trait to reorder
  *within* the flow, or move the child into a `free`/`anchor` parent to move it *freely*.
- `flow` rejects self-positioning outright; that is what `free` is for.

The same rule resolves the `resizable`-versus-`split` case: a pane inside a split is resized
by its gutters, not by corner handles, and attaching `resizable` to one reports MK2011 with
a pointer to `split`'s own `min`/`max` options.

---

## 10. Extension points — the complete list

If it's not on this list, it isn't extensible, and adding it requires a decision record.

1. **Element types** — `mk.define()` (§8)
2. **Traits** — `mk.trait()` (§9)
3. **Layout algorithms** — `mk.layout()` (§7)
4. **Length units** — `mk.unit('gu', { toCSS, toNumber, basis })`. Example: a game grid
   unit where `1gu = min(vw,vh)/24`, letting a HUD scale with the viewport in one token.
5. **Anchor / placement strategies** — `mk.anchor('follow-cursor', …)`,
   `mk.placement('flip-then-shift', …)` for popover collision handling.
6. **Themes and token sets** — `mk.theme('midnight', { tokens, density, radius })` (§12)
7. **Motion presets** — `mk.motion('spring-in', …)` (§17)
8. **Input sources** — `mk.input('gamepad', …)` feeding the normalized event queue (§13.5)
9. **Gestures** — `mk.gesture('pinch', …)` as a state machine over the pointer stream
10. **Serializers / migrations** — `mk.serializer('v2→v3', …)` (§19.2)
11. **Validators** — custom prop types for schemas
12. **Devtools panels** — `mk.devtools.panel('acme', …)` (§19.3)
13. **Formatters / i18n** — number, date, and message formatting used by built-ins
14. **Portals / render targets** — render into another document, an iframe, or a popup
    window (multi-window applications)
15. **Style backends** — the default emits custom properties; alternatives could emit
    constructable stylesheets, or atomic classes (⚑ D7)

Each extension point ships with: a schema, a conformance check, at least one built-in
consumer, and at least one *non-built-in* example in `examples/`. The last requirement is
the honest test — an extension point with no external consumer is probably wrong.

---

## 11. Element catalog

All of these are registered through the public contract of §8.1 — there are no privileged
element types (P3). Each is specified as `props · events · commands · a11y` in the API docs.

**Tiers.** Draft 1 listed roughly eighty types, which was scope creep dressed up as
thoroughness. The catalog is now explicitly tiered, and the tier determines whether it is a
1.0 commitment:

| Tier | Meaning | Ships |
|---|---|---|
| **A — Core** | always loaded; plugins may `extend` them | in core (§4.2) |
| **B — Standard** | bundled, individually excludable, mapped to a milestone (§26) | in 1.0 |
| **C — Ecosystem** | the extension points exist; these are not the project's job | not in 1.0 |

**Tier A (core):** `pane` · `surface` · `stack` · `group` · `spacer`

Everything below is Tier B unless marked **[C]**.

### 11.1 Structural

| Type | Purpose |
|---|---|
| `pane` | a rectangular region with a frame; the universal container (core) |
| `split` | a pane whose children are separated by draggable gutters (§7.3) |
| `dock` | an application shell with edge regions (§7.4) |
| `stack` | a row/column of children |
| `grid` | 2D placement |
| `scroll` | a scrollable viewport with managed overflow |
| `tabs` | a tabbed pane group; `tablist`/`tab`/`tabpanel` semantics, closable, reorderable |
| `accordion` | vertically stacked collapsible sections |
| `resizer` | a standalone gutter, for authors composing their own split |
| `spacer` | a flexible gap |
| `group` | a virtual node with no DOM; for organizing the tree |

### 11.2 Surfaces and overlays

| Type | Purpose |
|---|---|
| `surface` | a styled, elevated container; the base for the rest |
| `window` | a floating, draggable, resizable, minimizable pane with a title bar |
| `modal` | a centred, focus-trapped surface with a backdrop |
| `dialog` | `modal` + header/body/footer slots + a standard button row |
| `alert` | `dialog` with `alertdialog` semantics for destructive confirmation |
| `drawer` | a surface sliding from an edge; modal or non-modal |
| `popover` | a surface anchored to a trigger, with flip/shift collision |
| `tooltip` | a small, non-interactive popover with hover/focus intent timing |
| `menu` | a keyboard-navigable command list with submenus and a context-menu mode |
| `toast` | a transient message in a managed stack, with a live region |
| `banner` | a persistent inline message |
| `backdrop` | a scrim; managed by the layer service, rarely used directly |

### 11.3 Form controls

Each wraps a native control where one exists — native first, custom only when native cannot
do the job. This is a hard rule: it buys accessibility, IME support, autofill, and mobile
keyboards for free.

`field` (label + control + description + error, the composition wrapper) ·
`text` · `textarea` · `number` (with step buttons and scrub-to-change) · `password` ·
`search` · `select` (native) · `combobox` (custom; native can't do this) ·
`multiselect` · `checkbox` · `radio-group` · `switch` · `slider` · `range` (two-handle) ·
`color` · `date` · `time` · `file` (with drop target) · `tags` · `rating` ·
`segmented` · `button` · `button-group` · `toggle` · `form` (validation orchestration,
submit handling, dirty tracking, reset)

#### Validation

A first-class subsystem, not a per-control concern — because getting it right requires
coordinating timing, accessibility, and focus across the whole form, which no individual
control can do.

```js
const form = pane.create('form', {
  values: { email: '', port: 8080, tags: [] },
  schema: {
    email: { type: 'string', required: true, format: 'email' },
    port:  { type: 'number', min: 1, max: 65535, integer: true },
    tags:  { type: 'array', of: 'string', max: 8 }
  },
  validate: {
    email: async (v, ctx) => (await isTaken(v)) ? 'Already registered' : null
  },
  timing: { initial: 'submit', afterError: 'change', async: 'blur' }
});
```

- **Timing policy** is the part most libraries get wrong. Mutakit's default is
  *validate-on-submit, then revalidate-on-change for fields that have already errored*.
  Validating on every keystroke before the user has finished typing is hostile; never
  revalidating after an error means they cannot tell when they have fixed it. Async
  validators default to firing on blur, debounced, with out-of-order responses discarded by
  sequence number.
- **The schema is the same schema** as §8.1's prop schemas. One validator vocabulary,
  reused — which also means form errors and prop-validation diagnostics share a message
  catalogue and an i18n path.
- **Accessibility wiring is automatic and non-negotiable**: `aria-invalid` on the control,
  the message linked via `aria-describedby`, the error text rendered in the `field`'s error
  slot, and on a failed submit, focus moved to the first invalid control while an error
  summary is announced through the polite live region (§14). Doing this by hand per form is
  the single most commonly skipped accessibility task in web applications; here it is the
  default and opting out is explicit.
- **Cross-field and form-level validators** receive all values (`confirmPassword`, date
  ranges). They attach to the form, and their messages can target a specific field or the
  summary.
- **State exposed** as signals: `valid`, `dirty`, `touched`, `submitting`, `errors`,
  `submitCount`. A submit button disabled on `!valid` is one binding. `dirty` also drives
  the unsaved-changes veto that `dismissible` respects (§9), so closing a dialog with
  unsaved edits prompts without any wiring by the author.
- **Native first** (§11.3): constraint validation attributes are set on the underlying
  native controls so browser autofill, password managers, and mobile keyboards behave, but
  the *messages* are Mutakit's, because native validation bubbles are unstyleable and
  inconsistent across browsers.

### 11.4 Display and feedback

Deliberately short. The test applied to every candidate: **does it need the geometry engine,
the layer system, or the focus manager?** If not, it is a styled `<div>` the author can write
in ten lines, and shipping it makes Mutakit a design system (§1.4).

**Ships:** `text` · `icon` · `divider` · `progress` · `meter` · `spinner` ·
`empty-state` · `tree` (needs roving focus and virtualization) ·
`list` (needs selection and virtualization)

**[C] Cut, with reasons:** `avatar`, `badge`, `chip`, `skeleton`, `code`, `image`,
`breadcrumb`, `pagination` — all pure presentation with no engine dependency.
`table` — resolves **D10 as no**: a plain semantic table is `flow` content plus author CSS,
and anything more (virtualization, column resizing, sorting) is the data-grid non-goal.
Column resizing specifically is `split` applied to a header row, which the author already
has. Recipes in `docs/recipes/` cover these instead of code.

### 11.5 HUD and game (S3)

These exist to prove the extension points, and because S3 is a first-class scenario.

| Type | Purpose |
|---|---|
| `hud-layer` | a full-viewport, pointer-transparent layer with safe-area insets applied |
| `hud-bar` | a value bar (health/mana/stamina) with animated fill and damage ghosting |
| `hud-marker` | a world-space marker projected to screen with edge clamping and an arrow |
| `crosshair` | a centred reticle with state variants |
| `minimap` | a container with a rotation/pan/zoom transform for a map surface |
| `radial-menu` | a circular selection menu driven by direction, for stick or mouse |
| `notification-feed` | an append-only, auto-expiring message column (kill feed, log) |
| `key-prompt` | a control-scheme-aware key/button glyph that follows the active input |

`hud-*` types default to `a11y: 'presentation'` and `pointer-events: none`, with explicit
opt-in for interactive ones — the correct default for decorative overlays, and an explicit
exception to P5 rather than an accidental one.

---

## 12. CSS architecture and theming

### 12.1 Cascade layers

```css
@layer mutakit.reset,      /* minimal, scoped to mutakit roots only              */
       mutakit.tokens,     /* custom property definitions                        */
       mutakit.base,       /* structural rules every element relies on           */
       mutakit.layout,     /* algorithm-emitted container rules                  */
       mutakit.element,    /* per-element-type styles from define({styles})      */
       mutakit.theme,      /* token overrides from the active theme              */
       mutakit.user;       /* always wins; where the application author writes   */
```

`mutakit.user` last means an author never needs `!important` to restyle anything. Element
styles are registered into `mutakit.element` automatically by `define()`, so plugin CSS
can't accidentally outrank a theme.

### 12.2 Scoping

**Default: light DOM with a configurable prefix.** Classes are `mk-<type>`,
`mk-<type>--<variant>`, `mk-<type>__<part>`. Rationale: authors can style anything with
ordinary CSS, devtools inspection is natural, and there is no shadow-boundary friction with
forms, focus, or `:has()`.

**Opt-in: shadow DOM per element type** (`define({ shadow: true })` or globally
`create({ shadow: 'all' })`) for embedding into a page whose CSS is out of your control.
Shadow mode exposes a documented `::part()` surface and forwards tokens through the
boundary — the trade-off is that only declared parts are styleable, which is stated
plainly in the docs.

Styles are injected once per instance via a constructable `CSSStyleSheet` where supported,
falling back to a `<style>` element. Injection is lazy: an element type's styles are added
the first time an instance of it is created.

### 12.3 Design tokens

Three tiers, so a theme author changes 12 values rather than 300:

```
tier 1  primitives   --mk-blue-500, --mk-space-4, --mk-radius-md, --mk-dur-fast
tier 2  semantic     --mk-color-surface, --mk-color-accent, --mk-color-danger,
                     --mk-text-primary, --mk-border-subtle, --mk-elevation-2
tier 3  component    --mk-modal-bg (defaults to var(--mk-color-surface-raised))
```

Component tokens always default to a semantic token; semantic tokens always default to a
primitive. Overriding at any tier works and cascades correctly.

**Themeable axes:** colour scheme (light / dark / system), contrast (normal / high),
density (compact / comfortable / spacious → drives a spacing scale multiplier), radius
(sharp / soft / round), motion (full / reduced / none), and font stack.

Themes apply per subtree by setting tokens on a node's element — a dark inspector panel
inside a light application requires no special support.

### 12.4 The geometry–style contract

Documented and stable, because authors and plugins depend on it:

| Property | Meaning |
|---|---|
| `--mk-x`, `--mk-y` | resolved position in frame space (px) |
| `--mk-w`, `--mk-h` | resolved size (px) |
| `--mk-inset-{top,right,bottom,left}` | effective inset stack (§5.7) |
| `--mk-gutter` | gutter size for split/stack |
| `--mk-track-list` | grid template string for split/grid |
| `--mk-z` | resolved z-index within the layer |
| `--mk-state-*` | booleans as `0`/`1` for use with `calc()` tricks |

State is *also* expressed as data attributes (`data-mk-collapsed`, `data-mk-dragging`,
`data-mk-focus-within`) so ordinary CSS selectors work.

---

## 13. Interaction and input

### 13.1 The event model

Mutakit events propagate along the **node tree**, not the DOM tree — they behave correctly
for portalled content (a popover rendered in the overlay layer still bubbles to its logical
parent). Capture, bubble, `stopPropagation`, and `preventDefault` all work as expected.
Events are typed by the `events` declaration in the element contract; emitting an
undeclared event throws in development.

DOM events are consumed at the boundary and normalized; Mutakit never re-dispatches
synthetic events into the DOM. Authors can always reach the underlying DOM event via
`event.native`.

### 13.2 Pointer handling

One delegated set of `pointerdown`/`move`/`up`/`cancel` listeners per instance root, fed
into a queue drained in the INPUT phase. Benefits: consistent ordering with the frame loop,
one place to handle pointer capture, and no per-element listener cost for a HUD with a
hundred elements.

Coarse-pointer adaptation (larger hit slop, no hover-dependent affordances, long-press for
context menu) is driven by the metrics snapshot, not by user-agent sniffing.

### 13.3 Gestures

A gesture is a **recognizer** — a state machine consuming the pointer queue. Built-in set:
`tap`, `double-tap`, `long-press`, `drag`, `swipe`, `pinch`, `rotate`, `wheel`, `scrub`.
Registering a new one is extension point §10.9.

**Recognizer lifecycle.** Every gesture moves through the same states, which is what makes
them composable and testable:

```
possible ──▶ began ──▶ changed* ──▶ ended
    │          └──────────────────▶ cancelled
    └──▶ failed
```

`failed` is as important as `ended`: a `long-press` that sees movement beyond its slop must
fail *promptly* so a competing `drag` can begin without a perceptible delay.

**Arbitration.** Multiple recognizers observe the same pointer stream, so conflicts are the
normal case, not the exception. Resolution:

1. A recognizer **claims** the pointer when it transitions to `began`.
2. Claiming cancels every other recognizer on that pointer, except those the claimant
   declares as `allowSimultaneous` (pinch and rotate, for instance, always run together).
3. `requireFailure: ['double-tap']` lets `tap` wait for the double-tap window to lapse.
   Used sparingly — it costs perceived latency, so `tap` does *not* require it by default;
   authors opt in only where a double-tap actually exists.
4. Unclaimed pointers fall through to the browser. Mutakit never blanket-calls
   `preventDefault`.

**Scroll versus drag** is the conflict that matters most on touch and is handled
declaratively: a draggable element sets `touch-action` to the complement of its drag axis
(`pan-y` for an x-axis drag), which hands the decision to the browser's compositor rather
than racing it on the main thread. A drag with `axis: 'both'` inside a scroller requires an
explicit `long-press` intent gesture first — the standard mobile reorder interaction, and
the only way to disambiguate honestly.

**Cancellation sources** are all treated identically: `pointercancel`, Escape, focus loss,
element destruction, and a programmatic `cancel()`. Every recognizer must restore state on
cancel, which the leak test (§23.5) verifies by cancelling mid-gesture.

**Testing.** Recognizers are pure functions of an event sequence, so they are table-tested
with scripted pointer traces — no DOM, no timing flakiness, since the fake clock (§23.1)
drives their timeouts.

### 13.4 Keyboard

- **Focus manager** per instance: tracks the focus path, implements roving tabindex for
  composites, restores focus on overlay close, and maintains a focus history stack.
- **Shortcut registry** with scopes: global → layer → element subtree → element. Supports
  chords (`Ctrl+K Ctrl+S`), platform normalization (`Mod` → `Cmd` on macOS, `Ctrl`
  elsewhere), conflict detection at registration, and a generated cheat sheet.
- Every trait that responds to a pointer gesture declares a keyboard equivalent. The
  conformance check (§8.7) enforces it.

### 13.5 Alternate input sources (S3)

`mk.input()` registers a source that feeds normalized events into the same queue:

- **Gamepad** — polled in the INPUT phase; axes become directional navigation, buttons map
  through a configurable scheme; drives spatial focus navigation (§13.6).
- **Touch/pen** — already covered by pointer events, but pen pressure and tilt are
  surfaced.
- **Voice / accessibility switch** — the extension point exists; no built-in.

### 13.6 Spatial navigation

For HUDs and TV-style interfaces, focus moves by *direction* rather than by tab order:
given a direction vector and the set of focusable rects, pick the best candidate by a
documented scoring function (alignment overlap weighted above distance). Available to
keyboard arrows and gamepad sticks alike, opt-in per container.

---

## 14. Accessibility

Not a section that gets deferred. P5 makes it structural.

- **Roles and properties** are declared per element type and applied automatically,
  including dynamic ARIA values computed from props.
- **Focus trapping** for modals uses `inert` on sibling content where supported, with a
  sentinel-node fallback. Focus restores to the previously focused element on close, and
  survives that element being removed (falls back to the nearest surviving ancestor).
- **Live regions**: one polite and one assertive region per instance, managed by an
  announcer service. Toasts, validation errors, and async status changes route through it
  with de-duplication and rate limiting.
- **Keyboard parity** for every pointer interaction, enforced by §8.7.
- **`prefers-reduced-motion`** is read from the metrics snapshot and switches every motion
  preset to its `reduced` variant. Reduced does not mean *none*: instantaneous state
  changes can be more disorienting than a 100ms fade.
- **`prefers-contrast`** and forced-colors mode: all styles use system colour keywords in
  a `@media (forced-colors: active)` block; nothing depends on colour alone; focus
  indicators use `outline` (which forced-colors preserves) rather than `box-shadow`.
- **Target sizes** meet WCAG 2.2 AA (24×24 CSS px minimum) by default; the compact density
  variant carries a documented warning.
- **Zoom**: layouts remain usable at 200% zoom and at 320 CSS px width. `fr`-based splits
  degrade to stacked panes below a configurable breakpoint.
- **Testing**: an automated axe-core pass over every element type in the harness (§23.6),
  plus a documented manual screen-reader checklist (NVDA/Firefox, VoiceOver/Safari,
  Narrator/Edge) run before each minor release.
- **The escape hatch**: `a11y: 'presentation'` for decorative HUD elements — explicit,
  documented, and reported by the conformance check so it can be audited.

---

## 15. State and reactivity

### 15.1 Signals

A minimal reactive primitive (~1.5 KB), optional in every API that accepts values:

```js
const health = mk.signal(100);
const pct    = mk.computed(() => health() / max());
mk.effect(() => bar.set({ value: pct() }));

mk.create('hud-bar', { value: pct });   // a signal passed directly as a prop
```

Semantics: synchronous reads, batched writes, glitch-free (topological propagation), with
effects scheduled into the STATE phase of the frame loop. `untrack`, `batch`, and explicit
`dispose` are provided. Effects created inside an element's lifecycle are owned by
`ctx.own` and disposed automatically.

**Why build this rather than depend on one:** zero *runtime* dependencies is a project
constraint that draft 7 explicitly preserved (§2.1),
and the scheduler must integrate with the frame loop (§6.3), which no off-the-shelf signal
library does. It stays under 200 lines.

### 15.2 Plain values still work

Signals are strictly optional. `bar.set({ value: 42 })` is always valid. Authors using a
framework will use that framework's reactivity and Mutakit's imperative setters; authors
using Mutakit standalone get signals for free.

### 15.3 Stores

For layout-level state (which pane is collapsed, which tab is active, window positions), a
small observable store with structural sharing, path subscriptions, and time-travel in
development. This is what persistence (§19) serializes and what devtools inspects.

---

## 16. Layers, stacking, and overlays

### 16.1 The layer stack

Named layers with reserved z-index bands eliminate z-index arithmetic entirely:

| Layer | Band | Contents |
|---|---|---|
| `base` | 0 | the application shell |
| `content` | 100 | ordinary elements |
| `docked` | 200 | floating windows, panels |
| `hud` | 300 | game overlays |
| `overlay` | 400 | drawers, non-modal surfaces |
| `modal` | 500 | modals, dialogs, their backdrops |
| `popover` | 600 | menus, popovers, comboboxes |
| `tooltip` | 700 | tooltips |
| `toast` | 800 | notifications |
| `devtools` | 900 | inspector overlay |

Within a band, order is by insertion, with `bringToFront()` for floating windows. Plugins
register new layers by name with a band, never by picking a number.

### 16.2 Top layer and backdrops

Where available, `modal` and `popover` layers use the browser's top layer via `<dialog>` and
the Popover API, which gives correct stacking above everything (including other libraries'
overlays) for free. The fallback path is a portal into the instance's layer root.

Backdrops are reference-counted and shared: three stacked modals produce one backdrop,
positioned beneath the topmost. Dismiss semantics (`light` = click-outside closes,
`modal` = does not, `none` = programmatic only) are per surface.

Scroll locking on modal open uses `overflow: hidden` plus scrollbar-width compensation and
is also reference-counted, so nested overlays don't double-lock or prematurely unlock.

### 16.3 Anchored positioning

The `positioned` trait implements placement against a **reference**, which may be:

- a DOM element or Mutakit node (the common case — a popover on a button);
- a static `Rect` in a named coordinate space;
- a **virtual reference**: `() => Rect`, re-evaluated each frame in the ARRANGE phase.

The virtual form is what makes cursor-following tooltips, selection-range popovers, and
a value readout that tracks a control while dragging all expressible without a fake
placeholder element in the DOM. It was added in draft 3 after Appendix A hit the gap.

Placement offers 12 anchors (`top-start` … `left-end`), `flip` (to the opposite side when
clipped),
`shift` (slide along the cross axis to stay visible), `size` (constrain to available
space), `arrow` (position a caret and expose its offset as a custom property), and
`hide` (when the reference scrolls out of view).

Implemented over the CSS Anchor Positioning API where supported, with a JavaScript fallback
driven by an `IntersectionObserver` plus scroll/resize listeners on the ancestor chain —
both behind the same API, so authors never see the difference.

---

## 17. Motion

**The invariant that governs this whole section:** *animation may never affect layout
correctness.* A tree mid-animation resolves to exactly the same geometry as one at rest;
motion lives in transforms, opacity, and clip, never in the values ARRANGE computes. This is
why `mk.flush({ animations: false })` can exist, why layout snapshot tests (§23.2) are
deterministic, and why a mis-specified animation can look wrong but never *break* a layout.

- **Presets, not per-element animation code**: `fade`, `scale`, `slide-{edge}`, `collapse`,
  `spring`, and `none`, each declaring enter, exit, and reduced variants. Registered via
  extension point §10.7.

```js
mk.motion('drawer', {
  enter:   { transform: ['translateX(100%)', 'none'], duration: '--mk-dur-med',
             easing: '--mk-ease-out' },
  exit:    'reverse',                       // derive from enter
  reduced: { opacity: [0, 1], duration: 80 },
  interruptible: true
});
```
- **Where it runs**: the Web Animations API for discrete transitions (composited, cancelable,
  correctly interruptible mid-flight); CSS transitions on custom properties for
  state-driven changes; the frame loop's PAINT phase only for continuous, physics-driven
  motion (a spring following a drag).
- **Enter/exit orchestration**: an element being removed stays in the tree until its exit
  animation completes, with `mk.flush({ animations: false })` for tests.
- **FLIP** helper for reorder animations (sortable lists, tab reordering).
- **Reduced motion**: every preset must define its `reduced` variant, checked by the
  conformance check.
- **Interruption is the default assumption**: reversing a half-open drawer starts from its
  current position, never from the endpoint. Implemented by reading the running animation's
  computed value and retargeting, not by cancelling and restarting — which is why the Web
  Animations API is the primary backend rather than CSS transitions.
- **Compositable properties only.** Presets may animate `transform`, `opacity`, `filter`,
  and `clip-path`. Animating `width`, `height`, `top`, or `left` is diagnostic MK5004 with
  the transform-based alternative named. `collapse` is the interesting exception — it
  genuinely needs a size change — and resolves it by animating a `grid-template-rows`
  `0fr → 1fr` track, which is compositable in modern engines and degrades to an instant
  change where it is not.
- **Exit animations and destruction interact carefully.** A removed element stays in the
  node tree until its exit completes, but is immediately `inert`, removed from the focus
  order, and excluded from hit testing and layout contribution. A "closing" dialog can never
  swallow a click meant for what is behind it — a real and common bug in libraries that
  simply delay removal.
- **Budget.** Enter/exit durations default to 150–250 ms and are token-driven
  (`--mk-dur-*`), so a theme can slow everything down or set every duration to zero without
  touching a preset.

---

## 18. Authoring APIs

Three tiers over one semantic model. Anything expressible in one tier is expressible in all
three, and tier 2 is the canonical serialization.

### 18.1 Tier 1 — fluent JavaScript

```js
const app = Mutakit.mount('#root', { theme: 'dark' });

const [sidebar, main] = app.split({ axis: 'x', panes: [
  { id: 'sidebar', size: 240, min: 160, max: '35%', collapsible: { at: 100 } },
  { id: 'main',    size: '1fr' }
]});

sidebar.create('tree', { id: 'files', data: fileTree });

const [editor, term] = main.split({ axis: 'y', panes: [
  { id: 'editor', size: '1fr' },
  { id: 'term',   size: 200, min: 60 }
]});

editor.create('tabs', { id: 'docs', closable: true, reorderable: true });
```

Handles are chainable, and every `create`/`split` returns handles with the element's
declared `commands` as methods.

### 18.2 Tier 2 — declarative objects

```js
Mutakit.build('#root', {
  type: 'split', axis: 'x', gutter: 6,
  panes: [
    { id: 'sidebar', size: 240, min: 160, content: { type: 'tree', id: 'files' } },
    { id: 'main', size: '1fr', content: {
        type: 'split', axis: 'y', gutter: 6,
        panes: [
          { id: 'editor', size: '1fr', content: { type: 'tabs', id: 'docs' } },
          { id: 'term',   size: 200,   content: { type: 'terminal' } }
        ]
    }}
  ]
});
```

This form is JSON-serializable, is what `serialize()` emits and `restore()` accepts, and is
what devtools displays and edits.

Two pieces of sugar make the declarative form usable without escaping to JavaScript for
every interaction — both added in draft 5 after Appendix B traced S2 and found the tier-2
form could not express a dialog's own buttons:

**Slots as props.** A slot declared in the element contract (§8.1) is settable as a prop of
the same name: `{ type: 'dialog', body: {…}, footer: {…} }` is shorthand for
`slots: { body: {…}, footer: {…} }`. `content` is the conventional name for the default slot.

**Declarative commands.** `{ type: 'button', command: 'close' }` resolves by walking *up*
the node tree to the nearest ancestor declaring a `close` command (§8.1), and invokes it.
An unresolved command is diagnostic MK3011 at build time, not a silent no-op on click.
`command: 'prefs:submit'` targets a specific element by id when the nearest ancestor is the
wrong one. This is what keeps whole dialogs, menus, and toolbars fully serializable — a
tier-2 tree that needs JavaScript callbacks to function is not really serializable at all,
and §19's persistence story depends on it being so.

### 18.3 Tier 3 — the terse DSL (plugin)

For the cases where prose is genuinely clearer, shipped as `mutakit-dsl` — never core.

```js
mk.dsl`
  split x gutter:6 {
    pane #sidebar 240px min:160 max:35%
    pane #main 1fr {
      split y gutter:6 {
        pane #editor 1fr
        pane #term 200px min:60
      }
    }
  }
`;
```

It compiles to tier 2 and has no capabilities of its own. A source-mapped error reporter
points at the offending token.

### 18.4 Tier 3b — declarative HTML (plugin)

```html
<mk-split axis="x" gutter="6">
  <mk-pane id="sidebar" size="240" min="160"></mk-pane>
  <mk-pane id="main" size="1fr"></mk-pane>
</mk-split>
```

Custom elements that upgrade in place and hand off to the same core. Ships as
`mutakit-elements`. Attribute parsing maps to the tier-2 schema mechanically.

### 18.5 Worked example — the game HUD (S3)

```js
const hud = mk.layer('hud', { of: 'viewport', insets: 'safe' });

hud.create('hud-bar',    { id:'health', at:'top-left',      inset:16, size:{w:280,h:20},
                           value: health, variant:'health' });
hud.create('minimap',    { id:'map',    at:'top-right',     inset:16, size:{w:'12gu',h:'12gu'} });
hud.create('crosshair',  { id:'reticle',at:'center' });
hud.create('stack',      { id:'abilities', at:'bottom', inset:{bottom:24},
                           axis:'x', gap:8, children: abilities.map(toSlot) });
hud.create('notification-feed', { id:'feed', at:'bottom-right', inset:16,
                                  size:{w:320}, max:5, ttl:6000 });
```

Every element here uses only `at` + `inset` + `size` — no manual math, correct under
window resize, safe-area aware, and the `gu` custom unit (§10.4) makes the minimap scale
with the viewport.

---

## 19. Persistence, serialization, and devtools

### 19.1 Serialization

`mk.serialize()` walks the node tree and emits the tier-2 form, including runtime state
flagged `persist: true` in the prop schema (pane sizes, collapsed flags, window rects,
active tab, scroll offsets). Element types may contribute custom state via a `serialize`
hook. Output is stable-ordered so it diffs cleanly in version control.

`mk.restore(json, { allow })` rebuilds — see §21.4 for why `allow` is default-strict.

**Missing plugins must never brick a saved layout.** A workspace saved with a plugin
installed will eventually be opened without it, and every category of unknown reference gets
a defined fallback rather than a thrown error:

| Unknown | Fallback | Reported as |
|---|---|---|
| element type | a placeholder preserving the node's declared geometry and its serialized props, so reinstalling the plugin restores it exactly | MK4010 |
| trait | dropped; the element renders without the behaviour | MK4011 |
| layout algorithm | falls back to `stack` on the parent's declared axis, or `anchor` if none | MK4012 |
| **custom unit** (§10.4) | the serialized *resolved pixel value* recorded alongside the expression is used | MK4013 |

The last row is why serialization records `{ "size": { "w": "12u", "wPx": 528 } }` rather
than the expression alone: a layout using a plugin's custom unit stays geometrically correct
without that plugin, and snaps back to the live expression when it returns. Draft 2 specified
this for element types only; the unit case surfaced in Appendix A and is the subtler one,
because a dropped unit silently collapses an element to zero rather than visibly failing.

Placeholders round-trip losslessly: re-serializing a tree that contains them emits the
original data, so opening and saving a workspace on a machine without a plugin does not
destroy that plugin's state for everyone else.

**Automatic persistence.** `serialize`/`restore` are the primitives; almost every real use
wants the same wrapper around them, so it ships:

```js
mk.persist('ide-layout', { storage: localStorage, debounce: 300, allow: { … } });
```

This restores on call, then saves on a debounced timer whenever persistable state changes.
`storage` is any `{ getItem, setItem }`, so `sessionStorage`, IndexedDB, and a server-backed
store all work; a rejected async write surfaces as a diagnostic rather than silently losing
a layout.

**Restore happens before first paint.** `persist()` and `restore()` called before the first
frame apply during that frame's ARRANGE, so a saved layout never renders at its default
sizes and then visibly snap to the stored ones. A restore issued *after* first paint animates
per the active motion preset instead of jumping — a distinction that matters for
"reset layout" commands. Added in draft 5 after Appendix B traced S1.

### 19.2 Migrations

The serialized form carries a schema version. Migrations register as
`mk.serializer({ from: 2, to: 3, migrate(doc) {…} })` and chain automatically. Never a
breaking format change without a migration.

### 19.3 Devtools

A plugin (`mutakit-devtools`, excluded from production presets) providing:

- **Tree inspector** — the node tree with live props, computed geometry, active traits, and
  dirty flags.
- **Geometry overlay** — draws frames, insets, anchor points, and constraint origins on the
  page; hovering a node highlights it. This is the single most valuable debugging feature
  for a geometry library.
- **Constraint explainer** — for a selected node, shows every constraint, which ones were
  dropped by §5.8, and why.
- **Frame profiler** — per-phase timing, dirty-node counts, and a warning when a frame
  exceeds budget.
- **Event log** — filterable stream of node-tree events.
- **Layout editor** — drag gutters and edit props live, then export the tier-2 JSON.

---

## 20. Performance

### 20.1 Budgets

**Budgets are stated in gzipped transfer size**, because that is what users actually pay.
Draft 1 led with minified size, which was the wrong metric — see §20.5, where the accounting
showed the original ≤ 20 KB minified core budget was not achievable and, more importantly,
was measuring the wrong thing.

**Revised a second time, on measurement rather than estimate (draft 8).** The ≤ 8.5 KB
figure came from §20.5's per-module accounting, which was written before the engine was.
Measured against the built artifact it is 3.7× out, and the reason is specific: the table
has no row at all for `engine/instance.js`, `engine/handle.js`, `engine/ctx.js`, or
`engine/styles.js` — 25.5 KB minified between them, more than the entire estimated core —
and it costs `geometry/len` at 2.5 KB where it measures 7.9. Those four modules implement
§8.1's lifecycle, §8.8's content interop, §8.9's identity, §8.10's error isolation, §9's
trait attachment, §18.1's handles, and §12.2's cascade layers. None is optional and none is
unspecified; the estimate simply did not cost them.

The revised numbers are the measured ones plus about 4%, so the next kilobyte fails the
build rather than being absorbed. `docs/size-accounting.md` carries the module-by-module
working, regenerated by `npm run build`, including the 4.3 KB gzipped of genuine waste
already removed and the two reductions considered and rejected with reasons.

Two things this revision is not. It is not a licence to grow — the margin is deliberately
thin. And it is not a claim that core is as small as it could be: only that what remains is
behaviour §5–§8 specify, and that removing it would mean amending those sections first.

| Metric | Target |
|---|---|
| Core bundle | **≤ 33 KB gzipped** (~100 KB minified) |
| Full bundle | **≤ 76 KB gzipped** (~250 KB minified) |
| Cold init, 100-node tree | ≤ 16 ms |
| Steady-state idle CPU | 0% (loop unscheduled — §6.3 phase 7) |
| S3: 100 HUD elements, animating | ≥ 60 fps, ≤ 8 ms/frame on a mid-range 2022 laptop |
| Split drag | ≤ 4 ms/frame at 200 nodes |
| Forced reflows per frame | ≤ 1 |

### 20.2 Strategy

- The read/write split (P4) is the single largest win and is structural, not incidental.
- `contain: layout style paint` on every pane; `content-visibility: auto` on off-screen
  panes.
- The PAINT fast path (§6.2) for transform-only movement.
- Delegated event listeners, one set per instance.
- No per-frame allocation in the hot path: rects and points are pooled and reused during
  ARRANGE; the public API returns frozen copies.
- The style compiler diffs before writing; unchanged properties are skipped.
- `ResizeObserver` over polling, everywhere.
- `will-change` applied only for the duration of an interaction, never statically.

### 20.3 Measurement

A benchmark page in `test/bench/` with scripted scenarios (cold init, split drag, 100-HUD
animation, modal open/close, 1000-row list scroll). Results recorded per release in
`docs/perf-history.md`. A regression >10% blocks a release.

### 20.4 The minifier caveat *(closed in draft 7)*

**This caveat no longer applies.** It existed because `build.py`'s minifier did not rename
identifiers, making its output perhaps 30–40% larger than terser's, and §20.1's budgets were
therefore stated against a hypothetical "real" minifier the project could not run. esbuild
(§22.3) now *is* the minifier, so the budgets are measured against the tool that actually
produces the shipped artifact and the two numbers stop diverging.

Worth preserving from the original analysis, because it is a useful piece of calibration: the
gap **mostly disappeared under gzip** anyway. Unmangled identifiers are highly repetitive and
compress well — ~26 KB minified via terser versus ~34 KB via `build.py`, but only ~8.4 KB
versus ~9.5 KB gzipped. So the ~1 KB gzipped delta was the true cost of the no-Node
constraint, and D5 was correctly decided on *capability* grounds (types, headless CI,
tree-shaking, source maps) rather than on size. Draft 1 had implied size would be the deciding
factor; it would have been the wrong reason to reach the right answer.

The real size win from draft 7 is not mangling at all — it is **tree-shaking** (§22.2), which
removes code rather than shortening it, and which the old build could not do at any setting.

### 20.5 Core size accounting

An asserted budget nobody has checked is worse than an honest larger one. Estimates below
are per-module minified (terser-class) with gzip at ~32%, based on the specified behaviour
of each module.

| Module group | Modules | ~KB min |
|---|---|---|
| Kernel | kernel, diagnostics (prod), events, dom adapter | 5.3 |
| Signals (§15.1) | signals | 1.5 |
| **Geometry** | **len** (2.5), rect (0.8), constraints (1.2), spaces (0.8), anchor (0.5), insets (0.4) | **6.2** |
| **Engine** | compile (1.2), scheduler (1.2), measure (1.0), node (1.0), metrics (0.8), invalidate (0.5) | **5.7** |
| Layout | anchor, stack | 1.6 |
| Services & traits | layers, focusable | 1.4 |
| Elements | pane, surface, stack, group, spacer | 1.2 |
| Base CSS (as JS strings) | reset, tokens, base | 2.0 |
| ~~Module wrapper + names (§22.2)~~ | *removed in draft 7 — ESM has no per-file wrapper and no unmanglable name strings* | ~~0.7~~ |
| **Total** | | **~24.9 KB min · ~8.0 KB gzip** |

**Findings.**

1. **The ≤ 20 KB minified budget was not achievable** and was revised to ~26 KB / 8.5 KB
   gzipped. The gzip figure was always the meaningful one, so this was a correction to the
   *metric*, not a real regression in ambition.

   *Draft 8: this table was itself wrong, and by more.* Measured against the built
   artifact, core is 95 KB minified and 31.7 KB gzipped — 3.7× the 8.0 KB estimated below.
   The rows are not merely optimistic: **four modules have no row at all** —
   `engine/instance.js` (18.6 KB), `engine/handle.js` (2.4), `engine/ctx.js` (1.6),
   `engine/styles.js` (1.5) — and `geometry/len` measures 7.9 KB against 2.5, because the
   estimate costed "a tokenizer, an AST, and two compile backends" without costing
   `distributeFr`, `isFlexible`, `isIntrinsic`, `frCoefficient`, `isCSSResolvable`, or
   `env()`/`var()` support, all of which §5.2 and §7.3 require. The estimate below is
   retained as written, because what makes it useful now is exactly where it was wrong.
   §20.1 carries the revised budget.
2. **`geometry/len` and `engine/compile` are the two modules to watch.** `len` carries a
   tokenizer, an AST, and two compile backends; `compile` carries the diffing style writer.
   If core exceeds budget, these are where it happened, and both have a natural split
   (`len`'s `toNumber` backend is only needed once something drags — it could become a
   lazily-installed core plugin).
3. **Signals cost ~0.5 KB gzipped**, which settles D8: keeping them in core is cheap enough
   that the scheduler-integration argument wins uncontested.
4. **Base CSS is 8% of core.** Worth keeping inline — a separate stylesheet would break the
   single-`<script>`-tag promise (§1.4) to save a quarter kilobyte gzipped.
5. Full-bundle estimate: forms ~20 KB, overlays ~12 KB, traits ~10 KB, other algorithms
   ~8 KB, services ~8 KB, HUD ~6 KB, motion ~4 KB, persistence ~3 KB, plus core → ~97 KB
   min / ~31 KB gzip. Revised from 90 KB, and the reason to keep presets (§4.2) meaningful
   rather than decorative: almost nobody needs all of it.

6. *(Draft 7.)* The estimates above were always stated as "terser-class", so adopting a real
   minifier does not move them — it means they can finally be **verified rather than
   estimated**, from esbuild's metafile. Two figures change: the §22.2 module wrapper and its
   ~600 bytes of unmanglable name strings are gone, and tree-shaking means a preset's cost is
   now determined by what it imports rather than by what its file list contains. Expect the
   measured numbers to come in at or under these estimates; if any module comes in *over*,
   that is a finding worth a line in the changelog rather than a quiet budget revision.

This table is regenerated from `build/manifest.json` (§22.3) at each release and diffed
against the previous one, so drift is visible per module rather than as one number that
mysteriously grew. From draft 7 the manifest is esbuild's metafile, so the table reports
shipped bytes after tree-shaking rather than the sum of a declared file list — the first time
this number is a measurement rather than a projection.

---

## 21. Errors, diagnostics, security, and build modes

### 21.1 Two builds

`mutakit.js` (development) includes schema validation, conformance checks, the constraint
explainer, reentrancy assertions, and verbose messages. `mutakit.min.js` (production)
strips all of it via a `/* @dev */ … /* @enddev */` block convention the build honours
(§22.3). Behaviour must never differ between builds except in diagnostics.

### 21.2 Diagnostic catalogue

Every diagnostic gets a stable code (`MK1042`) and a documentation anchor. Categories:

| Range | Category | Example |
|---|---|---|
| MK1xxx | Geometry | over-constrained axis, percentage cycle, unparseable `Len` |
| MK2xxx | Layout | unknown algorithm, `fr` outside a track context, unresolvable `auto` |
| MK3xxx | Contract | undeclared event, missing a11y, prop mutated outside `update` |
| MK4xxx | Plugin | version conflict, dependency cycle, duplicate registration |
| MK5xxx | Performance | frame budget exceeded, layout thrash detected, leak suspected |
| MK6xxx | Accessibility | missing keyboard equivalent, insufficient target size |

Diagnostics de-duplicate by code + node, so a loop reports once rather than 60 times per
second.

### 21.3 Error philosophy (P7)

Development throws on programmer error (bad type name, contract violation) and warns on
recoverable ambiguity (over-constraint). Production warns once and applies the documented
fallback. Nothing silently does nothing — the worst outcome for a layout library is an
element that simply fails to appear with no explanation.

### 21.4 Security model

A library that builds DOM from data is a library with an injection surface. Stating the
model prevents both real vulnerabilities and dangerous misreadings of §8.2.

**No HTML parsing by default.** String content is assigned with `textContent`, always
(§8.8). There is no property anywhere in the built-in catalog that parses a plain string as
markup. Where markup is genuinely needed, the prop is explicitly `html`-prefixed and routes
through a sanitizer configured at instance creation (`Mutakit.create({ sanitize })`). With no
sanitizer configured, an `html*` prop **throws in development and escapes in production** —
the insecure path is never the quiet default.

**Trusted Types.** When a page enforces a Trusted Types policy, Mutakit creates one named
policy at init for its handful of sinks, or fails immediately with a clear message. It never
fails at first use, halfway through building a UI.

**CSP.** No `eval`, no `new Function`, no inline event handler attributes — anywhere,
including the DSL plugin (§18.3), which compiles to data structures rather than to code.
Style injection prefers constructable stylesheets, which need no nonce; the `<style>`
fallback accepts a `nonce` option.

**The build is now part of the attack surface** *(new in draft 7)*. Adopting Node tooling
means a compromised build-time dependency can alter the bytes users receive, which was
structurally impossible when the build was one Python file with no dependencies. This is the
security cost of D5 and it should be stated rather than absorbed silently. Mitigations are in
§27.2 R3′ — a deliberately tiny build-critical set, exact pins, a committed lockfile,
`npm ci --ignore-scripts` in CI — plus the two consumer-facing checks that already existed:
**SRI hashes** for CDN users (§25.5) and `--provenance` on npm publishes, both of which let
someone verify what they received rather than trusting the pipeline that produced it. Note
the runtime guarantee is unchanged: zero runtime dependencies means an attacker who
compromises a build-time package still cannot reach users through a *transitive runtime*
package, because there are none.

**Plugins are not sandboxed, and the docs say so.** `use()` runs arbitrary code with full
page privileges. `ctx` (§8.2) is an *architectural* boundary that keeps plugins on public
API — it is **not** a security boundary, and nothing in the design pretends otherwise.
Installing a Mutakit plugin is exactly as consequential as adding a `<script>` tag.

**Untrusted layout JSON is the sharp edge.** `restore()` (§19.1) instantiates element types
and sets props from its input. Restoring attacker-controlled JSON is therefore roughly as
dangerous as running attacker-controlled code, since props reach DOM sinks. The mitigation
is opt-in and documented prominently:

```js
mk.restore(json, { allow: { types: ['split', 'pane', 'tabs'], props: 'schema' } });
```

`props: 'schema'` rejects any prop not declared in the type's schema and coerces the rest
through its validators. Layouts saved to a user's own `localStorage` are lower risk; layouts
synced from a server or shared between users must use `allow`. The default is *strict* — an
unrestricted `restore()` emits MK4xxx unless `{ allow: 'any' }` is passed deliberately.

---

## 22. Source layout and build pipeline

### 22.1 Directory structure

```
source/
  core/
    kernel.js             instance creation, registries, use(), lifecycle
    diagnostics.js        codes, dev/prod gating
    events.js             node-tree event system
    signals.js            reactive primitives
    dom.js                DOM adapter; the only file touching document directly
  geometry/
    len.js                tokenizer, AST, toCSS, toNumber
    rect.js               Rect/Point/Inset/Size algebra
    anchor.js             anchor resolution
    constraints.js        edge constraints, priorities, over-constraint resolution
    spaces.js             coordinate conversion
    insets.js             the inset stack
  engine/
    node.js               LayoutNode
    invalidate.js         dirty bits and propagation
    scheduler.js          the frame loop
    measure.js            measurement strategies
    metrics.js            MetricsSnapshot
    compile.js            the style compiler
  layout/
    anchor.js  stack.js  split.js  dock.js  grid.js  flow.js  free.js
  traits/
    focusable.js  draggable.js  resizable.js  dismissible.js  focus-trap.js
    collapsible.js  scrollable.js  selectable.js  sortable.js  positioned.js  …
  services/
    layers.js  focus.js  shortcuts.js  gestures.js  motion.js  announcer.js
    persistence.js  theme.js
  elements/
    structural/  surfaces/  forms/  display/  hud/
  styles/
    reset.css  tokens.css  base.css        (compiled into JS string constants)
  types/
    manual.d.ts           hand-written types the schemas can't express (§22.5)
  entries/
    core.js  app.js  dock.js  hud.js  full.js    bundler entry points, one per §4.2 preset

tools/
  lint-arch.mjs           architectural lint (§22.4)
  gen-types.mjs           .d.ts generation from prop schemas (§22.5)
  gen-docs.mjs            API docs from prop schemas (§24)

build.mjs                 esbuild driver (§22.3)
package.json              scripts, exports map, pinned devDependencies
package-lock.json         committed; CI installs with `npm ci --ignore-scripts`
playwright.config.mjs     headless runs across the §25.3 baseline engines (§23.3)
tsconfig.json             `tsc --noEmit` over examples/ (§22.5)
```

*Draft 7 changes to this tree:* `_epilogue.js` is gone — there is no graph to resolve at
runtime — and is replaced by `entries/`, where each preset is an entry point whose imports
*are* its file list. The Python tools become Node ones; `run_tests.py` disappears into
Playwright's config. `unpinned.json` keeps its project-manifest role but loses the ordered
`source.files` array, which the import graph now supersedes.

### 22.2 Modules — plain ESM *(rewritten in draft 7)*

Source is ESM. Every file uses ordinary `import`/`export`, the bundler resolves the graph,
and nothing about the module system is bespoke:

```js
// source/geometry/len.js
import { warn } from "../core/diagnostics.js";

export function parse(input) { … }
export function toCSS(len) { … }
export function toNumber(len, ctx) { … }
```

**What this replaces.** Drafts 1–6 specified a registry: every file an IIFE pushing a
`{name, deps, factory}` record onto a temporary global, drained and topologically sorted by
an `_epilogue.js`. That design was a good answer to "modules must survive arbitrary-order
concatenation" — it is not a good answer to anything else, and with a bundler the question
is gone. Its own stated costs disappear with it: no ~600 bytes of unmanglable module-name
strings, no per-file function wrapper, no hand-written topological sort to maintain, and no
temporary global to reason about against P8.

The properties the old design worked to preserve are now free:

- **Every file is independently valid JavaScript** — true of ESM by definition, and now
  checkable by every editor, linter, and type checker without special configuration.
- **Order is irrelevant** — the bundler computes it from the import graph. `unpinned.json`
  no longer carries an ordered file list, which removes that merge-conflict surface
  entirely rather than merely making it tolerable.
- **Cycles are a build-time error**, still, but from the bundler itself as well as from the
  §22.4 lint. Two independent detectors, neither hand-written.

**What this buys beyond parity.** Tree-shaking is the substantive gain: with a static import
graph, code nobody references stops shipping. That serves the size goal in a way the registry
could not — a lazy factory that is never invoked still occupies bytes in the bundle, whereas
an unimported ESM binding is eliminated. It also reduces §4.2's presets from a necessity to a
convenience for `<script>`-tag users; anyone consuming the ESM build gets a preset tailored to
their actual imports, for free.

**The one real cost: `file://` stops working.** A concatenated script loads from anywhere; ES
modules are fetched, so the browser applies CORS and `file://` is denied. Development
therefore requires a local server — `python3 -m http.server` is enough, and the README
already documents it as an option. Two things follow. First, §23.3's "open `test/index.html`
in a browser, as today" becomes "serve the project and open it", and the README must stop
offering the direct-open path rather than leaving people to hit an opaque CORS error.
Second, this is not hypothetical: it is exactly what blocked the first attempt to run
`test/proto/split-grid.html` (§27.2 R1), which had to be served over localhost before it
would load at all. Cheap, but it must be written down, because the failure mode is a blank
page with a console error rather than anything self-explanatory.

The module *graph* is unaffected as a deliverable — it moves from an implicit runtime
structure to `build/manifest.json` (§22.3), emitted from esbuild's metafile, which is a
better source of truth because it reports what actually shipped after tree-shaking rather
than what was declared.

### 22.3 The build *(rewritten in draft 7)*

`build.py` is retired. The build is **esbuild**, driven by a small `build.mjs` and exposed
through `npm run` scripts. esbuild is the only build-critical dependency; it is a single
binary, it is fast enough that `--watch` is instant rather than tolerable, and it covers
bundling, tree-shaking, minification, and source maps in one tool.

What the build must do:

1. **Bundle each §4.2 preset** from its own entry file, in three output formats: IIFE (the
   `<script>`-tag path, with the UMD shim), ESM (for bundler consumers, so tree-shaking
   reaches into the library), and minified variants of both.
2. **Strip `/* @dev */ … /* @enddev */` blocks** from production output (§21.1). esbuild's
   `drop` and `define` handle most of this; a conditional-export split handles the rest,
   which is cleaner than the textual stripping `build.py` did.
3. **Inline `styles/*.css`** as JS string constants, via esbuild's `text` loader — a built-in
   rather than a hand-written whitespace-safe inliner.
4. **Emit `build/manifest.json`** from esbuild's metafile: per-module sizes, the resolved
   import graph, output hashes, and SRI hashes for §25.5. This is what §20.5's accounting
   table is regenerated from, and unlike the old manifest it reports what actually shipped
   after tree-shaking rather than what was listed.
5. **Emit source maps** for the expanded builds. The old build could not meaningfully produce
   these; with them, a stack trace from a minified bundle is debuggable.
6. **`--watch` and `--check`**, both preserved in behaviour.

**Source maps deserve their own line.** They were absent from drafts 1–6 not by choice but
because a concatenating Python script cannot realistically emit them. Their arrival changes
what §21's diagnostics can promise: an error surfaced from a minified production bundle can
now point at a real source location, which is worth more to a plugin author than most of the
devtools surface in §19.3.

**What retires with `build.py`:** the hand-written JS tokenizer and its minifier, and
`tools/test_build.py`, the 31-case probe that existed to keep that tokenizer honest. Both were
good work — the probe caught a real bug that silently deleted code from minified output — but
the class of bug they defended against belongs to esbuild now. Delete them rather than
maintain them alongside a bundler that makes them redundant; the CHANGELOG records why they
existed. `tools/lint_arch.py` (§22.4) survives the transition in purpose but moves to Node,
where it reads a real ES module graph instead of pattern-matching source text.

### 22.4 Architectural lint

`tools/lint-arch.mjs`, run by the build, enforcing:

- No upward imports between layers (§4.1).
- No file outside `core/dom.js` references `document` or `window` directly.
- Every `define()`/`trait()`/`layout()` call in `source/` uses only the public `ctx`
  surface (P3).
- Every element type declares `a11y` or an explicit opt-out (P5).
- Every diagnostic code used in source exists in `docs/diagnostics.md`.

This is what keeps P3 and P5 true a year from now, when nobody remembers the rules.

*Draft 7:* moved from Python to Node so it can walk a parsed ES module graph. The first two
rules are import-graph questions that a bundler answers exactly and a text search only
approximates; the third was specified as "checked by grepping for private-prefixed
identifiers", which is precisely the kind of check that yields false confidence — a real
parse replaces it. This is a correctness upgrade, not just a language change.

### 22.5 TypeScript definitions

Shipping types is table stakes for adoption. `build/mutakit.d.ts` is generated by
`tools/gen-types.mjs` from the same prop schemas that already drive validation (§8.1),
devtools (§19.3), and the API docs (§24).

That the schema has *four* consumers is the strongest argument for §8.1's design: a plain
defaults object would need types, docs, and validation maintained separately and drifting
independently.

- Plugin authors get `declare module 'mutakit'` augmentation, so `mk.create('acme:gauge', …)`
  is fully typed once `mk.use(AcmeWidgets)` is in scope.
- The parts a schema cannot express — the fluent handle chain (§18.1), generics on signals
  (§15.1), the `Len` union — are hand-written in `source/types/manual.d.ts` and merged.
- Verified by `tsc --noEmit` over `examples/`. Drafts 1–6 called this "the one place Node
  tooling would clearly earn its keep" and filed it as a concrete input to D5; with D5 now
  resolved it is simply part of the build, and this section no longer has to argue for
  itself. It runs in CI and a type regression fails the build.


### 22.6 The minifier, verified *(resolves D1; historical as of draft 7)*

> **Superseded, but kept.** Draft 7 replaces this minifier with esbuild (§22.3), so the
> tooling described below is retired and `tools/test_build.py` is deleted along with it.
> **D1's resolution stands** — and stands more firmly, since esbuild's ES2020 support needs
> no probe. The section is retained in full because its *process finding* is the durable
> part, and because deleting the record of a silent production-only bug would be exactly the
> wrong lesson to draw from having fixed it.

Drafts 1–4 asserted that `build.py`'s minifier "handles modern syntax correctly" and used
that to propose an ES2020 baseline. Nobody had checked. `tools/test_build.py` now does, with
31 cases chosen to be whitespace- or comment-significant — because the minifier only strips
comments and collapses unprotected whitespace, a mis-tracked literal boundary is **invisible**
unless the literal contains something that must survive.

**Confirmed working:** arrow functions followed by regex literals, optional chaining, nullish
coalescing, logical assignment, private and static class fields, `for await`, spread and rest,
numeric separators, BigInt, and every regex-versus-division ambiguity probed (after `)`, after
an identifier, after `]`, after `return`, regex containing quotes, regex containing a slash in
a character class).

**One real bug found and fixed.** The scanner treated a template literal as a plain quoted
string, so it ended at the first backtick of a *nested* template. Everything after that point
was scanned as code:

```js
const s = `${ `a // not a comment` }  TAIL`;
const keep = 1;
```

minified to `const s = \`${ \`a` — the `//` was treated as a line comment and the rest of the
line, including the following statement, was deleted. Whitespace inside nested templates was
also silently collapsed, and `/* */` inside one was stripped.

This mattered more than it first appears:

- It is **silent and production-only.** The expanded build is correct, so every test passing
  against `source/` would still pass; only `mutakit.min.js` breaks.
- The plan leans on tagged templates in two places — `styles: css\`…\`` in the element
  contract (§8.1) and `mk.dsl\`…\`` (§18.3) — so this would have been hit, not avoided.

`_scan()` now tracks templates with a stack: `${ … }` substitutions are scanned as ordinary
code and may nest arbitrarily, while template text stays protected. Comment stripping, banner
retention (`/*! … */`), and idempotence are all still verified.

**Process finding — the part that outlives the tooling.** The bug predates the plan and would
not have been found by reviewing the plan, only by running the code the plan depends on. Where
a document asserts that existing tooling supports a decision, the cheap move is to test the
tooling. That finding has now repeated twice: §27.2 R1's prototype had gone unrun for a whole
draft while the plan reasoned confidently about what it would show, and running it corrected a
row of the analysis. Draft 7's move to esbuild retires this particular minifier but not the
lesson — **the release checklist (§25.4) keeps a "run the thing, don't cite it" item**, now
pointed at the build and the R1 prototype rather than at `tools/test_build.py`.

---

## 23. Testing

### 23.1 Harness upgrades

The existing 123-line harness needs, in order: async tests (return a promise),
`setup`/`teardown`, grouping (`describe`), `only`/`skip`, a `?filter=` query parameter, a
deterministic fake clock and fake rAF, and a machine-readable result dump on
`window.harness.results` for external drivers.

**Draft 7 keeps this harness rather than adopting Vitest or similar**, which deserves a
justification now that the option exists. The tests that matter most here are layout snapshots
and synthetic interaction sequences against real layout — they need a real browser, not a
simulated DOM, and the harness's value is that it runs in the page under test with nothing in
between. A general-purpose runner would add a dependency, a config surface, and a layer of
indirection to solve a problem this project does not have. What Node buys the browser tests
is the *driver* (§23.3), not the runner.

The DOM-free tier is the exception, and it splits cleanly: those tests import pure functions
and assert on numbers, so they run under Node's built-in `node:test` (§23.3) with no
dependency and no browser. The division is principled rather than expedient — **tests that
need a real browser run in one; tests that do not, do not** — and it means the geometry and
engine suites, which carry §23.4's non-negotiable ≥ 95% branch requirement, have the fastest
possible loop.

The harness itself therefore keeps its no-build-step, no-runtime-dependency shape and grows to
maybe 400 lines. Revisit only if the fake clock and fake rAF turn out to be the hard part, in
which case borrowing a proven implementation beats maintaining one.

### 23.2 Test categories

| Category | What it covers | Where |
|---|---|---|
| **Unit — pure** | `Len` parsing, rect algebra, constraint resolution, `fr` distribution, signal graph | no DOM needed; fastest and highest value |
| **Unit — DOM** | element construction, prop updates, cleanup | jsdom-free, real browser |
| **Layout snapshot** | resolve a tree, serialize every node's rect to JSON, compare to a committed fixture | catches geometry regressions precisely; diffs are readable numbers, not images |
| **Interaction** | synthetic pointer/key sequences over a real element; drag a gutter, tab through a modal | uses a scripted event helper |
| **Contract** | run `conformance()` over every registered type | §8.7 |
| **Leak** | create/destroy 1000 instances; assert listener, observer, and node counts return to baseline | §23.5 |
| **A11y** | axe-core over a page containing every element type in several states | §23.6 |
| **Visual** | screenshot comparison for themes and motion | manual/CI-gated; lowest priority |
| **Performance** | §20.3 benchmarks with pass/fail thresholds | `test/bench/` |

**Layout snapshot testing is the flagship technique here.** Because ARRANGE is pure, a whole
layout can be resolved and dumped as `{id: [x, y, w, h]}` and compared against a committed
fixture. Fixtures are small JSON files, review is trivial (they are readable numbers, not
image diffs), and the entire S1–S3 scenario set becomes a regression suite.

One qualification draft 1 glossed over: ARRANGE is pure *given measurements*, and `auto`
sizing needs real measurement. Snapshot tests therefore run against a **stub measurer** —
`mk.testing.measurer(fn)` supplies deterministic intrinsic sizes (e.g. `text` measures at
`8px × length`), which keeps the tests fast, DOM-free, and identical across browsers. A
smaller set of *measured* snapshot tests runs in a real browser with a tolerance for
sub-pixel rounding, covering the cases where intrinsic sizing is the thing under test. This
also settles one of §27's open questions: fixtures are committed once, not per browser,
because the stub path is deterministic by construction.

### 23.3 Running

- **Pure units under `node:test`** — the DOM-free tier of §23.2 (`Len` parsing, rect algebra,
  constraint resolution, `fr` distribution, the signal graph) runs directly in Node with
  **no dependency at all**, since the runner is built in from Node 20 and the source is ESM.
  This is the fastest feedback loop in the project and it costs nothing: `node --test --watch`
  re-runs the affected tests on save. It also means the highest-value tests keep running even
  if browsers are unavailable in an environment.
- Interactive: **serve the project**, then open `test/index.html` — e.g.
  `python3 -m http.server 8080`. Draft 7 note: ESM sources are fetched, so `file://` is
  blocked by CORS and the direct-open path drafts 1–6 assumed no longer works (§22.2).
- Filtered: `test/index.html?filter=geometry/len`.
- Headless: **Playwright**, reading `window.harness.results` (§23.1) and printing TAP.
  Replaces the hand-written Python CDP driver that drafts 1–6 specified because no Node was
  available.

**This is the change that unblocks the R1 exit gate.** The CDP driver would have spoken one
protocol to one engine; §26's M1 gate and §25.3's baseline both require Chrome *and* Firefox
*and* Safari, which under the old plan meant implementing two more protocols or running the
prototype by hand forever. Playwright drives all three from the same script, so
"`test/proto/split-grid.html` reports PASS in each baseline engine" becomes a CI job instead
of an open item. Given that R1's only remaining exposure is engine coverage (§27.2), this is
the highest-value single consequence of having Node — worth more than the size win.

Cross-browser runs are also what §23.2's *measured* snapshot tests need, and what makes
§23.6's axe-core gate practical to run automatically rather than aspirationally.

### 23.4 Coverage expectations

Geometry and engine: ≥ 95% branch coverage, non-negotiable — they are pure and there is no
excuse. Elements: ≥ 80%. Traits: ≥ 90% (they are where subtle interaction bugs live).
No coverage requirement for devtools.

### 23.5 The leak test

A GUI library that leaks is unusable in a long-lived application. The test creates and
destroys every element type 1000 times and asserts that DOM node count, registered listener
count (tracked by the DOM adapter in dev builds), observer count, and node-tree size all
return to baseline. `ctx.own` (§8.2) makes passing this the default rather than an
achievement.

### 23.6 Accessibility testing

`test/a11y.html` renders every element type in several states (open, focused, invalid,
disabled, collapsed) and runs axe-core from a vendored copy. Violations fail the run. This
plus the manual screen-reader checklist (§14) is the accessibility gate.

---

## 24. Documentation

Docs are a deliverable, not an afterthought — a library whose whole premise is "simple
commands" lives or dies on its documentation.

| Piece | Content |
|---|---|
| `README.md` | what it is, 30-second example, install, links |
| `docs/concepts/` | geometry model, layout algorithms, the frame loop, layers — the mental model, with diagrams |
| `docs/guides/` | one guide per driving scenario: build an IDE layout, build an app shell, build a game HUD |
| `docs/api/` | generated from the prop schemas and element definitions (they are already machine-readable — §8.1) |
| `docs/plugins/` | write an element, write a trait, write a layout algorithm, publish a plugin |
| `docs/diagnostics.md` | every MK code with cause and fix, linked from the console message |
| `docs/recipes/` | short answers to common shapes: resizable sidebar, command palette, toast queue, dockable panels |
| `examples/` | runnable single-file pages, each ≤ 100 lines, one per recipe |
| `docs/adr/` | decision records (§27) |

API docs generate from the same schemas that drive validation and devtools, so they cannot
drift. That is the main argument for making `props` a schema rather than a plain default
object.

---

## 25. Versioning, compatibility, and release

### 25.1 SemVer, applied to a UI library

Public surface under SemVer: the JS API, element type names, prop names and semantics,
event names and payloads, CSS custom property names in §12.4, data attributes, class name
patterns, the serialization format, the plugin contract, the adoption contract (§8.8), and
the generated type definitions (§22.5).

The adoption contract is included deliberately: framework adapters and incremental-migration
users depend on Mutakit *not* touching things, so widening what it writes to an adopted node
is a breaking change even though it adds no API.

**Explicitly not covered:** exact pixel output, internal DOM structure (unless exposed as a
documented part), diagnostic message text, devtools.

The CSS contract being versioned is unusual and deliberate: authors *will* style against
`.mk-modal__header`, so renaming it is a breaking change whether we like it or not. Better
to say so.

### 25.2 Deprecation policy

Deprecated API keeps working for one full minor cycle, warns once with a diagnostic code
and a migration hint, and is listed in `CHANGELOG.md` under `Deprecated` with the planned
removal version.

### 25.3 Browser baseline

Chrome/Edge 111+, Firefox 113+, Safari 16.4+ — chosen because it is the floor for cascade
layers, `:has()`, container queries, and `dvh` units, all of which the design uses. Newer
features are progressive enhancements with fallbacks behind one API: CSS Anchor
Positioning (§16.3), `<dialog>` top layer (§16.2), Popover API, `inert`, constructable
stylesheets, `ResizeObserver` (baseline), View Transitions (motion enhancement only).

Feature detection results live in the metrics snapshot; there is no user-agent sniffing
anywhere.

### 25.4 Release checklist

Build all preset outputs · full test suite **across every §25.3 baseline engine** (§23.3) ·
a11y suite · leak suite · benchmarks within 10% · examples load without console errors ·
`tsc --noEmit` clean (§22.5) · docs regenerated · CHANGELOG updated · `unpinned.json` version
bumped · size budgets checked against §20.1 from esbuild's metafile · `npm ci --ignore-scripts`
reproduces the build from a clean checkout · tag · publish with `--provenance` from CI.

**Run the thing, don't cite it.** Every release re-runs the artifacts this document reasons
about rather than quoting their last known result — currently the build and
`test/proto/split-grid.html` (§27.2 R1). This item exists because the project has twice
asserted something about code nobody had executed: §22.6's minifier, which turned out to
silently delete code, and R1's prototype, which turned out to have been reporting FAIL in
every state. Both were caught by running them. Neither would have been caught by review.

### 25.5 Distribution

The library must be usable from a `<script>` tag with no toolchain (§1.4), which shapes how
it ships:

- **Tagged builds are committed.** `build/` is gitignored during development but its outputs
  are committed on release tags, so a raw GitHub URL or jsDelivr works with no publish
  infrastructure at all. Draft 7 keeps this even though npm is now available: it is the
  channel that requires nothing of the consumer, which is §1.4's whole point.
- **Presets** (§4.2) publish as separate files — `mutakit.core.js`, `mutakit.app.js`,
  `mutakit.dock.js`, `mutakit.hud.js`, `mutakit.js` — each with its expanded and minified
  form, and a size table in the README so the choice is informed.
- **Subresource integrity** hashes are emitted into `build/manifest.json` (§22.3) and
  published in the release notes, so CDN users can pin safely.
- **npm** (`mutakit`, shipping ESM + `.d.ts`, with UMD for the CDN path) is unblocked by
  draft 7 — the gate was D5, now resolved. The package sets `"type": "module"`, an `exports`
  map with `import`, `types`, and per-preset subpath entries, and `"sideEffects": false` so
  consumers' bundlers can tree-shake through it. Publishing is `--provenance` from CI, never
  from a developer's machine. Ship the CDN and npm paths together at 1.0; the docs lead with
  whichever matches the reader's situation rather than apologising for a missing one.
  **Ship ESM only, not a dual package.** `require(esm)` is unflagged from Node 22.12, so a
  CommonJS consumer on a supported Node can `require()` an ESM package directly and the
  usual reason for shipping both formats is gone. This avoids the dual-package hazard — two
  copies of the module graph with two copies of the registries, which for a library holding
  singleton state (§4.2 presets, the type registry) is a correctness bug, not just bloat.
  The UMD build remains, but as the `<script>`-tag artifact it always was rather than as a
  second npm entry point.
- **Versioned URLs only** in documentation examples — never a floating `@latest`, which
  turns a patch release into everyone's outage.

---

## 26. Roadmap

Milestones are defined by *capability demonstrated*, not by time. Each ends with a runnable
example and a passing test suite.

### M0 — Foundation (replaces the scaffold)
Module system (§22.2), kernel, registries, diagnostics, error isolation (§8.10), node
identity (§8.9), event system, DOM adapter, harness upgrades (§23.1), build changes (§22.3),
architectural lint (§22.4). Housekeeping: `hello()` and the four starter tests are deleted,
`README.md` is rewritten against the real API, and `CHANGELOG.md` records the scaffold's
removal as a breaking change.

**Toolchain migration lands here** *(draft 7)*, because M0 already rewrites the module system
and doing both at once avoids porting the registry design to ESM twice: `package.json` and a
pinned lockfile, `build.mjs` on esbuild, Playwright wired to the §25.3 baseline engines, the
Python tools ported to Node, and `build.py` + `tools/test_build.py` deleted. `unpinned.json`
loses its ordered `source.files` array rather than gaining a new one.

**Do the Playwright half first.** It is the only part with a result waiting on it — R1's exit
gate needs Firefox and Safari runs of an *existing* prototype (§27.2), so cross-engine CI pays
off before any of M0's own code exists, and it de-risks M1's gate rather than arriving
alongside it.
**Demo:** `mk.create('pane', …)` renders a positioned box, and a deliberately broken plugin
fails without taking the tree down. **Version:** 0.3.0

### M1 — Geometry and engine
`Len`, rect algebra, anchors, edge constraints, insets, coordinate spaces, the node tree,
invalidation, the frame loop, metrics snapshot, style compiler, the `anchor` and `stack`
algorithms.
**Demo:** the modal-placement example from §5.9 (without the modal chrome), and a resize-
responsive grid of anchored boxes. Layout snapshot tests are live from here on.
**Exit gate (R1):** run `test/proto/split-grid.html` in each §25.3 baseline engine and
confirm it reports PASS. It must show that in `neighbor` mode every min/max bound is applied
by CSS — the prototype writes deliberately *unclamped* values, so any bound that holds is
provably the browser's doing — that `distribute` applies every *minimum* by CSS, and that
tracks always sum to the container. `push` is expected to compute its cascade in JS, and
`distribute` to overrun a maximum; both are analysed and accepted outcomes (§27.2 R1), not
failures. If pure-CSS clamping fails even for `neighbor`, `split` gains a JS track solver as
a documented exception to P1 and M2's estimate grows.

**Gate status: Chrome cleared (2026-08-06); Firefox and Safari outstanding.** The harness
defects found by the first run are fixed (§27.2 R1), so the verdict is now trustworthy: the
prototype reports PASS at rest and at every bound, and names the specific limit when one
breaks. Note that `distribute`'s flexible phase legitimately reports
`FAIL — pane 1 > max1`; that is the real CSS ceiling gap, not a regression, and it is the
one result the other engines should be expected to reproduce rather than contradict. Verify
the caps by measurement as well as by the on-screen verdict.
**Version:** 0.4.0

### M2 — Splits (S1 substantially working)
The `split` algorithm with all interaction detail from §7.3, the `resizer` element,
`collapsible` and `draggable` traits, keyboard resizing, persistence of pane sizes. Includes
both `distribute` paths from §7.3's fallback rule, with a test asserting their equivalence:
a group whose panes declare no `max` must produce identical track sizes on the CSS and JS
paths across a swept drag. That test is what keeps the two implementations from drifting.
**Demo:** the exact three-pane layout from the user's brief, resizable, collapsible, and
restored across reload. **Version:** 0.5.0

### M3 — Overlays (S2 half working)
Layer service, backdrop management, top-layer integration, `focus-trap` and `dismissible`
traits, focus manager, `positioned` trait with flip/shift, and the surface family:
`surface`, `modal`, `dialog`, `popover`, `tooltip`, `toast`, `menu`, `drawer`.
**Demo:** a command palette, a nested-modal flow, a context menu with submenus.
**Version:** 0.6.0

### M4 — Forms (S2 complete)
`field` composition, the control set (§11.3), validation subsystem, the `form` element,
shortcut registry.
**Demo:** a settings dialog with validation, dirty tracking, and full keyboard operation.
**Version:** 0.7.0

### M5 — HUD and game (S3)
`hud-layer` and the `hud-*` family, custom units, gamepad input source, spatial navigation,
world-to-screen marker projection, the PAINT fast path proven under load.
**Demo:** an animated HUD with 100 elements holding 60 fps, driven by a fake game loop.
**Version:** 0.8.0

### M6 — Ecosystem and polish
Devtools plugin, the DSL and custom-element plugins, `dock` and `free` algorithms, `window`
and `tabs`, theming system complete, framework adapters, full documentation set, the
external-plugin example required by §10.
**Demo:** a third-party plugin published from outside the repo, installed with `mk.use()`.
**Version:** 0.9.0

### M7 — 1.0
API freeze, deprecation policy in force, complete a11y audit, performance history
established, migration guide from 0.x.

**Ordering rationale:** geometry before elements (everything depends on it); splits before
overlays (S1 is the most structurally demanding and shakes out the engine); forms late
(large surface, low architectural risk); HUD after the engine is proven fast; ecosystem
last, because extension points should be designed against six months of real internal use
rather than guessed at up front.

---

## 27. Decisions, open questions, and risks

### 27.1 Decision log

Decision records live in `docs/adr/`. Marked `⚑` in the text above.

| # | Question | Status |
|---|---|---|
| **D1** | **Language baseline.** Stay ES5, or move to ES2020? | **Resolved: ES2020**, on evidence rather than assertion — see §22.6. A 31-case probe of `build.py`'s minifier confirmed correct handling of arrow functions, optional chaining, logical assignment, private and static class fields, `for await`, numeric separators, BigInt, and every regex-versus-division ambiguity tested. It also found a **real bug** in nested template literals, now fixed and covered by `tools/test_build.py`. The §25.3 browser baseline already exceeds ES2020. Cost: source is no longer copy-pasteable into ancient environments — acceptable. *(Draft 7: the probe and the minifier it tested are both retired with the move to esbuild, but the resolution stands on firmer ground — a production bundler's ES2020 support needs no probe, and the language baseline is now enforced by `tsconfig.json` and esbuild's `target` rather than by a hand-written scanner.)* |
| **D2** | Offset sign convention for edge anchors. | **Resolved** (§5.5): `offset` is screen-axis; `inset` is the recommended edge-relative spelling. |
| **D3** | "Split vertically" ambiguity. | **Resolved** (§5.9): `axis` is canonical; orientation words are separator-describing aliases with a dev-mode note. |
| **D4** | Shadow DOM: default or opt-in? | **Proposed: opt-in** (§12.2). Light DOM's stylability and form/focus behaviour outweigh encapsulation for the primary audience. Revisit if embedding complaints dominate. |
| **D5** | Adopt Node tooling before 1.0? | **Resolved: yes** *(draft 7)*, when Node became available and dependencies were permitted. Decided on **capability**, not size: cross-engine headless testing (§23.3, which unblocks the R1 gate), `tsc`-verified types (§22.5), tree-shaking (§22.2), and source maps (§22.3). §20.4's finding held — the gzipped size delta was only ~1 KB, so size alone would never have justified it, and the plan was right to refuse to decide on that basis. The migration cost §22.2 was designed to keep cheap was in fact cheap: the `name`/`deps`/`factory` registry maps onto `import`/`export` mechanically, as predicted. **Scope of the yes:** build-time only. Runtime dependencies remain zero by default (§2.1). |
| **D6** | Transformed (rotated/scaled) ancestors. | **Partially resolved** (§5.4): supported for hit-testing and dragging; layout math warns. Full support needs a matrix-aware ARRANGE — deferred past 1.0 unless a real use case appears. |
| **D7** | Alternate style backends (atomic classes, constructable sheets). | **Open** (§10.15). The extension point is specified; no implementation planned before 1.0. |
| **D8** | Should `signals` be core or a plugin? | **Resolved: core**, optional at every call site. The §20.5 accounting puts it at ~0.5 KB gzipped, cheap enough that the scheduler-integration argument (§15.1) wins uncontested. |
| **D9** | Multi-window / portal rendering (§10.14). | **Open.** Specified as an extension point; no built-in before 1.0. |
| **D10** | Does `table` stay in the built-in catalog, given the data-grid non-goal? | **Resolved: no** (§11.4). A plain semantic table is `flow` content plus author CSS; column resizing is `split` applied to a header row, which authors already have. Anything beyond that is the data-grid non-goal. Covered by a recipe instead. |
| **D11** | Who owns an adopted DOM node's internals? | **Resolved** (§8.8): Mutakit writes only geometry properties and `data-mk-*` attributes, never children, classes, or listeners. This guarantee is what makes framework adapters trivial, so it is versioned API (§25.1). |
| **D12** | Should a throwing plugin take down the tree? | **Resolved: no** — `errorPolicy: 'isolate'` is the default (§8.10). The subtree is replaced by a placeholder that preserves geometry, so failure stays visually local. |
| **D13** | Reimplement anchored positioning, or adapt Floating UI? | **Proposed: reimplement**, treating Floating UI's published algorithm as the reference specification (§1.6). The zero-dependency constraint is load-bearing for the `<script>`-tag story. Revisit at M3 if the fallback path (§16.3) proves unreliable across browsers — the fallback is where this will hurt if it does. |
| **D14** | Publish to npm before 1.0? | **Resolved: yes** *(draft 7)*, ungated by D5. Ship npm and the committed-tag CDN path (§25.5) together rather than treating either as primary — they serve different readers, and the `<script>`-tag audience of §1.4 is not a fallback for people who failed to have a bundler. Package details in §25.5. |
| **D15** | Should a layout algorithm be able to declare the props it expects on its children? | **Resolved: yes** (§7.0). `childProps` schema on the algorithm; child values live in a reserved `layout` bag rather than merged into the element's props, which avoids the `size`-means-two-things collision. Validation is strictly one level — only the immediate parent — which settles the reparenting question that kept this open: re-validate on reparent, unknown keys report MK2012 but are retained so the move is reversible. Formalizes what `split` and `grid` already did informally. |

**Open questions with no decision yet:**

- How much of the tier-2 schema should be *inferable* from the prop schemas, versus written
  by hand per element? (Affects §24's generated API docs and §22.5's generated types.)
- Is `fr` inside the `anchor` algorithm meaningful, or should it be a diagnostic? (Currently
  MK2xxx — a diagnostic.)
- What is the story for right-to-left *mirroring of icons and directional affordances*, as
  distinct from layout flipping?
- Should `mk.query()` (§8.9) grow beyond type/id/state matching? A full selector language is
  a maintenance liability; too small a one pushes devtools toward private access.
- Does the STATE-phase iteration cap of 8 (§6.3) hold up under signal-heavy applications, or
  does it need to be configurable?

*Resolved and moved out of this list in draft 2: per-browser snapshot fixtures — the stub
measurer (§23.2) makes the primary snapshot path deterministic by construction.*

### 27.2 Risk register

Distinct from the decision log: these are not choices to be made but things that could
derail the project regardless of what is chosen. Each carries the **signal** that it is
happening and the **response** — because a risk with no trigger condition is just anxiety.

**R1 — The CSS-delegation bet fails for splits.** *(Was the highest technical risk;
downgraded — see below.)*
P1 assumes the browser can express §7.3's behaviour natively. If CSS Grid's `minmax()`/`fr`
clamping cannot reproduce the specified clamping cascade, track sizes must be computed in
JavaScript, weakening P1's performance and size arguments.

**Analysis (drafts 5–6), and a restatement of the bet.** Working through the three resize
modes against the Grid track-sizing algorithm splits the risk into three parts of very
different severity:

| Case | Expressible in pure CSS? |
|---|---|
| Static layout and container resize | **Yes.** `minmax()` + `fr` is exactly this problem; the browser already solves it. |
| `neighbor` drag | **Yes.** `clamp(min, min(raw, 100% − gutters − Σ neighbour mins), max)` applies every bound, including the neighbour-exhaustion bound. Percentages in `grid-template-columns` resolve against the container's content box, so the cap is expressible without measuring. JS writes one unclamped custom property per pointer move and does no arithmetic. |
| `distribute` drag | **Half.** Non-dragged panes as `minmax(min, 1fr)` *is* proportional distribution, and it enforces the minimums — but **not the maximums**. A flexible track's `fr` maximum is uncapped by construction, so a non-dragged pane sails past its `max`. Measured: pane 1 reached 643.2px against a `max1` of 500. Enforcing a ceiling needs JS, exactly as `push` does. *(Corrected from "Yes" by the Chrome run — see below.)* |
| `push` drag | **No, not practically.** Sequential exhaustion — pane 1 gives until its min, *then* pane 2 — is not what `fr` does (`fr` spreads proportionally). It is expressible as nested `max()`/`min()` chains, but the expression grows O(n²) in pane count and must be rebuilt whenever the pane list changes. |

**Resolution: the bet was over-stated, not wrong.** P1 says JavaScript computes numbers *only
when interaction requires it*. A drag is precisely that case — the handler is already running
JS. The property that actually carries P1's weight is that **idle and container-resize layout
need zero JavaScript**, and that holds in all three modes. `push` therefore computes its
cascade in JS during drag only (O(n) arithmetic over a handful of panes, once per
`pointermove`) and writes explicit track sizes; CSS re-clamps idempotently, so the two paths
cannot disagree. This is a clarification of P1, not an exception to it, and §7.3 should say so.

**Empirical result (2026-08-06, Chrome, DPR 1.25).** The prototype has now been run. Track
sizes were read from `getComputedStyle().gridTemplateColumns` after driving real pointer
drags, so what follows is what the engine computed, not what the page's own readout claimed.

| Case | JS wrote (unclamped) | CSS produced | Bound applied |
|---|---|---|---|
| `neighbor` gutter 0 left | `--w0: 3px` | **64px** | `min0` |
| `neighbor` gutter 0 right | `--w0: 1015px` | **380px** | `max0` |
| `neighbor` gutter 1 left | `--w1: -71px` | **80px** | `min1` |
| `neighbor` gutter 1 right | `--w1: 1124px` | **500px** | `max1` |
| neighbour exhaustion (358.4px container) | `--w0: 9999px` | **166.4px** | `cap0` = 358.4 − 12 − 80 − 100, exact |
| `distribute`, gutter 0 to both stops | `--w0: ±9999px` | **380px / 64px**, remainder 612/612 | `max0`/`min0` + `fr` |
| `push`, pane 1 already at min | JS cascade → 380/80 | **380 / 80 / 984**, sum 1456 = content | JS cascade, CSS idempotent |

The claims that carried the bet hold for `neighbor`, and for `distribute` in every respect
except maximum enforcement (see the finding below). Every bound in `neighbor` was applied
by CSS from a deliberately out-of-range input — `--w0: 3px` yielding a 64px
track is not a value JavaScript could have produced by accident. The neighbour-exhaustion
cap resolved to the arithmetically exact figure, confirming that percentages inside the
track list resolve against the content box as §7.3 assumed. And a container-resize sweep
from 1200px down to 240px, with `CSSStyleDeclaration.prototype.setProperty` instrumented to
count writes, performed **zero** JavaScript property writes while respecting every bound and
summing tracks exactly to the content box at every width — including widths where `cap0`
alone squeezed pane 0 (206.4 / 106.4 / 66.4px). That zero is the number P1 actually rests on.
`push` behaved as analysed: with pane 1 pinned at its minimum, dragging gutter 0 forced pane 2
to yield the full 160px, and the values CSS resolved were identical to the ones JS wrote — the
two paths cannot disagree, as predicted.

*Three defects found, all in the harness rather than the technique:*
1. **`verdict()` reports a false FAIL in every state**, including at rest before any
   interaction. It compares the track sum against `getBoundingClientRect().width`
   (border-box, 1457.6px) instead of `clientWidth` (content box, 1456px); the 1.6px
   difference is the element's own 2 × 0.8px border, which exceeds the 1.5px tolerance.
   The tracks were correct the whole time. Fix: measure against `clientWidth`.
2. **`distribute` mode could not drag the second gutter.** Setting `--t1` to
   `minmax(var(--min1), 1fr)` for the whole mode made `--w1` inert — writing `--w1: 9999px`
   changed nothing. Fixed: pane 1 goes flexible only *while gutter 0 is being dragged*, which
   is the drag whose remainder has somewhere to spread, and the distributed width is committed
   back to `--w1` on release so reverting the track causes no jump. Gutter 1 now drags
   correctly (clamped to `max1` at 500px). Fixing this is what exposed the ceiling gap below.
3. **Readout lags one frame.** `report()` is scheduled in `requestAnimationFrame` after the
   write, so the raw-value and JS-ops cards can trail a move — a push-mode drag that ran the
   six-op path displayed `ops: 1`. Cosmetic, but it makes the on-screen numbers unsafe to
   cite as evidence.

**One substantive finding, not a harness bug: `distribute` cannot enforce a maximum in CSS.**
Repairing defect 2 made the flexible track observable for the first time, and it violates
`max1`. `minmax(var(--min1), 1fr)` gives a track a floor but no ceiling — a flexible track's
`fr` maximum is uncapped by construction, and `fr` cannot appear inside `min()`/`clamp()`, so
there is no way to write "distribute proportionally, but stop at max" in a single track
expression. Measured: with pane 0 at 220px, panes 1 and 2 split the remainder 583.2/583.2
while `max1` is 500; on release the commit re-clamps to 500 and the pane visibly snaps back.

This does **not** re-open R1, because it lands in the space P1 already concedes: it is a
*drag-time* limitation, and the idle and container-resize paths still need zero JavaScript.
But it changes the shape of the answer — `distribute` now sits with `push` rather than with
`neighbor` whenever a maximum is in play. **§7.3 now specifies the resulting fallback rule**
normatively: the flexible set is fixed at `pointerdown`, the CSS path is taken only when every
pane in it declares no finite `max`, no `snap`, and no `collapsible`, and the JS path is CSS's
own fr-distribution with finite growth limits restored — which makes the two paths provably
equivalent wherever the CSS path is legal. Panes with only minimums, the common case, keep the
pure-CSS path.

*One boundary now documented rather than assumed:* when the container is narrower than
Σ mins + gutters (256px here), CSS holds the minimums and lets the container overflow — at a
238px content box the tracks still summed to 256px. Minimums win over the container. No
solver can do better, and `split` should treat this as defined behaviour, but the prototype's
overflow check currently calls it a failure.

*Remaining exposure:* **engine coverage.** Only Chrome was tested; no other engine was
available in the session. Firefox 113+ and Safari 16.4+ from the §25.3 baseline remain
unverified, and nested `clamp()`/`min()` with percentages inside `grid-template-columns` is
exactly the kind of construct where engines have historically differed. The risk is now
narrow and specific rather than open-ended.
*Signal:* the other two baseline engines disagree with the Chrome numbers above — in
particular a `cap0` that does not resolve to the exact arithmetic value, which would mean
percentages resolve against a different box.
*Response:* run the same measurements (not the on-screen verdict) in Firefox and Safari as
the M1 exit gate, after fixing defect 1. If pure-CSS clamping fails even for `neighbor` in
either, `split` keeps a JS track solver as a documented exception to P1 — the `anchor` and
`stack` paths are unaffected either way, which is what bounds this risk.

**R2 — Scope exceeds capacity.** The engine, catalog, accessibility, devtools, and docs are
plausibly multi-year for a small team. *Signal:* M2 slipping well past M1's elapsed effort.
*Response:* the tiering in §11 and the milestone gating in §26 exist precisely for this.
**M0–M3 is the viable minimum product** — geometry, splits, and overlays cover S1 and S2 and
are independently useful. M4–M6 are genuinely optional, and shipping 1.0 with Tier B
incomplete is an acceptable outcome, not a failure.

**R3 — The no-Node constraint becomes a tax.** ~~Types (§22.5), headless CI (§23.3), and
identifier mangling (§20.4) all want a JS toolchain.~~ **Retired in draft 7** — Node arrived
and D5 resolved yes before this risk could materialise. Recorded rather than deleted because
it called its shot: the response was "D5, which §22.2 was deliberately designed to make cheap
to flip", and the flip was in fact cheap. Designing a module system so that a constraint could
be reversed later is the reason this cost a rewrite of §22.2 rather than a rewrite of the
source tree.

**R3′ — Toolchain dependencies become their own tax** *(new in draft 7, replacing R3)*. The
constraint that just lifted was also a discipline: a project that cannot `npm install` cannot
accumulate a dependency tree, and drafts 1–6 got real architectural clarity from that. The
exposures now are supply chain (every build-time dependency is code executing on a developer
machine and in CI, with publish credentials nearby), and drift — the gradual arrival of
dependencies that solve problems the project does not have.
*Signal:* the lockfile grows without a corresponding decision record; or a build-time
dependency's transitive tree exceeds a handful of packages; or anyone proposes a **runtime**
dependency without measuring it against §20.1.
*Response:* keep the build-critical set deliberately tiny — esbuild, Playwright, TypeScript,
and little else — pin exact versions, commit the lockfile, and require CI to install with
`npm ci --ignore-scripts`. Publish with `--provenance` from CI only, never from a developer
machine (§25.5). §2.1's two-budget rule is the standing test: if it reaches a user's page it
needs a decision record and a size measurement; if it only builds the project, keep it few and
pinned. Note this risk is *cheaper to be wrong about* than R3 was — a dependency can be
removed, whereas the capabilities R3 blocked simply did not exist.

**R4 — Accessibility debt accrues invisibly.** It is the classic thing deferred to "before
1.0" and then never done. *Signal:* any element type shipping with an `a11y` opt-out that
was not deliberate. *Response:* the §22.4 lint and the §23.6 axe gate run from **M0**, not
M7, so debt cannot silently accumulate — this is why P5 is an architectural principle rather
than a checklist item.

**R5 — Browser divergence in the anchored-positioning fallback.** The JS fallback path in
§16.3 is where cross-browser bugs will concentrate. *Signal:* placement bugs that reproduce
in one engine only. *Response:* D13 — adopt Floating UI and relax the zero-dependency
constraint for this one subsystem.

**R6 — The plugin contract ossifies before it is proven.** Freezing at 1.0 with only
internal consumers locks in whichever abstractions the built-ins happened to need. *Signal:*
Appendix A stops finding gaps — which reads as success but may mean the exercise has become
too familiar to be adversarial. *Response:* §10's requirement that every extension point
gain an **external** consumer before 1.0, and a fresh third-party plugin exercise (not a
re-run of Appendix A's) at M6.

**R7 — Performance targets prove unreachable in the DOM.** S3's 100 elements at 60 fps
should be comfortable given the PAINT fast path, but it is unproven. *Signal:* the M5
benchmark missing budget by more than 2×. *Response:* a canvas-rendered `hud-*` family —
which the plugin system permits **with no core changes**, since `paint(ctx)` and custom
layout algorithms already cover it. That this fallback requires no architectural change is
itself evidence the extension design is right.

**R8 — Single-maintainer bus factor.** *Signal:* inherent. *Response:* this document, the
ADRs in `docs/adr/`, and a test suite that functions as executable specification. Nothing
else meaningfully mitigates it, and pretending otherwise would be dishonest.

---

## 28. Glossary

| Term | Meaning |
|---|---|
| **Anchor** | a named or numeric point on a box (§5.5) |
| **Arrange** | the pure phase that computes rects from constraints (§6.3) |
| **Axis** | the direction along which a layout distributes children; `'x'` or `'y'` |
| **Basis** | the value a percentage resolves against (§5.3) |
| **Constraint** | a declared geometric input (`left`, `width`, `size.w`, an anchor) |
| **Element type** | a registered definition (§8.1); `modal`, `acme:gauge` |
| **Frame** | a node's content box, after insets — the space children resolve against |
| **Gutter** | the draggable separator track between panes (§7.3) |
| **Handle** | the object returned by `create`/`split`; the imperative element surface |
| **Inset stack** | the ordered, max-composed set of edge reservations on a frame (§5.7) |
| **Layer** | a named z-order band (§16.1) |
| **`Len`** | any accepted length expression (§5.2) |
| **Node** | an entry in the retained layout tree (§6.1) |
| **Trait** | a composable behaviour attachable to any element type (§9) |
| **Adoption** | taking geometric ownership of a DOM node Mutakit did not create (§8.8) |
| **Path key** | a node's stable identity derived from tree position, used by persistence (§8.9) |
| **Scrollport** | the visible region of a scrollable node, as distinct from its content box (§5.11) |
| **Tier** | whether an element type is core, standard, or ecosystem (§11) |
| **Virtual reference** | a `() => Rect` used as a positioning anchor instead of an element (§16.3) |

---

## Appendix A — A complete third-party plugin, end to end

§10 asserts that fifteen extension points are sufficient for anyone to add new GUI elements
without touching core. Nothing else in this document *tests* that assertion, and an
extension surface that has never been used from outside is a guess. This appendix builds a
realistic plugin against the contract as specified and records what broke.

It is written as a design exercise, not documentation. Its output is the four spec changes
in §A.8 and the honest scorecard in §A.9.

### A.1 The plugin

`acme-audio` — rack-mounted audio UI, chosen because it exercises four different extension
points naturally rather than contriving to hit them:

| Contribution | Extension point |
|---|---|
| `u` — rack units, `1u = 44px` | §10.4 custom length units |
| `acme:rotatable` — drag-to-turn, with keyboard | §10.2 traits |
| `acme:dial` — a rotary knob control | §10.1 element types |
| `acme:rack` — rows of fixed rack-unit height | §10.3 layout algorithms |

### A.2 The unit

```js
mk.unit('u', {
  toCSS:    (n) => `calc(${n} * var(--acme-rack-u, 44px))`,
  toNumber: (n, ctx) => n * ctx.tokenPx('--acme-rack-u', 44),
  basis:    'absolute'
});
```

Two backends over one unit, exactly as §5.2 requires. Because `toCSS` emits `calc()`, `'3u'`
works inside a `grid-template-rows` track list with no special handling — the delegation
principle (P1) paying off. `ctx.tokenPx` is the one thing `ctx` needed that draft 2 did not
list; it is a read from the metrics snapshot (§6.4), not a live `getComputedStyle`, so it is
legal in ARRANGE.

### A.3 The trait

```js
mk.trait({
  name: 'acme:rotatable',
  requires: ['focusable'],
  props: {
    value: { type: 'number', default: 0, min: 0, max: 1, reactive: true },
    sweep: { type: 'number', default: 270 },      // degrees of travel
    step:  { type: 'number', default: 0.01 }
  },
  events: ['input', 'change'],

  attach(ctx) {
    ctx.own(ctx.gesture('drag', {
      axis: 'y',
      onStart: () => ctx.state.from = ctx.props.value,
      onMove:  (g) => set(ctx, ctx.state.from - g.dy / 200, 'input'),
      onEnd:   () => ctx.emit('change', { value: ctx.props.value })
    }));
  },

  // Mandatory under P5 — the conformance check rejects the trait without it.
  keys: {
    ArrowUp:        (ctx) => nudge(ctx,  1),
    ArrowDown:      (ctx) => nudge(ctx, -1),
    'Shift+ArrowUp':(ctx) => nudge(ctx,  10),
    Home:           (ctx) => set(ctx, 0, 'change'),
    End:            (ctx) => set(ctx, 1, 'change')
  },

  api: { setValue: (ctx, v) => set(ctx, v, 'change') }
});

function set(ctx, v, evt) {
  const next = Math.min(1, Math.max(0, v));
  if (next === ctx.props.value) return;
  ctx.props.value = next;
  ctx.invalidate('paint');          // rotation is not layout — §6.2 fast path
  ctx.emit(evt, { value: next });
}
```

Note `invalidate('paint')`. A knob turning is a transform, not a geometry change, so it
never enters ARRANGE. Two hundred dials animating cost two hundred custom-property writes
and zero layout work — the §20.1 budget for S3 holds for a plugin the core authors never
anticipated, which is the real test.

### A.4 The element

```js
mk.define({
  type: 'acme:dial',
  version: '1.0.0',
  extends: 'surface',
  requires: { mutakit: '^1.0.0' },

  props: {
    label:   { type: 'string', default: '' },
    format:  { type: 'function', default: (v) => `${Math.round(v * 100)}%` },
    size:    { type: 'enum', values: ['sm', 'md', 'lg'], default: 'md' }
  },
  geometry: { defaults: { size: { w: 48, h: 48 } }, resizable: false },
  traits: ['acme:rotatable', 'tooltip-host'],

  a11y: {
    role: 'slider',
    props: {
      'aria-valuenow':  (ctx) => ctx.props.value,
      'aria-valuemin':  0,
      'aria-valuemax':  1,
      // Not the raw number: a screen reader should say "-6 dB", not "0.42".
      'aria-valuetext': (ctx) => ctx.props.format(ctx.props.value),
      'aria-label':     (ctx) => ctx.props.label
    }
  },

  create(ctx) {
    const el = ctx.dom('div', { class: 'acme-dial' });
    ctx.state.pointer = ctx.dom('div', { class: 'acme-dial__pointer' }, el);
    return el;
  },

  paint(ctx) {
    ctx.css({ '--acme-dial-angle': `${ctx.props.value * ctx.props.sweep}deg` });
  },

  styles: `
    .acme-dial { container-type: size; border-radius: 50%;
                 background: var(--acme-dial-face, var(--mk-color-surface-raised)); }
    .acme-dial__pointer { transform: rotate(var(--acme-dial-angle, 0deg)); }
    .acme-dial:focus-visible { outline: 2px solid var(--mk-color-focus); }
  `,
  tokens: { '--acme-dial-face': 'var(--mk-color-surface-raised)' },
  motion: { enter: 'fade', exit: 'fade', reduced: 'none' }
});
```

The element itself is ~30 lines because everything hard — focus, keyboard, gesture
handling, tooltips, geometry — came from traits and core. That ratio is the modularity
claim in concrete form.

### A.5 The layout algorithm

```js
mk.layout({
  name: 'acme:rack',
  schema: { gap: { type: 'len', default: 2 }, railWidth: { type: 'len', default: 16 } },
  childProps: { units: { type: 'number', default: 1, min: 1, integer: true } },

  measure(node, children) {
    const units = children.reduce((n, c) => n + c.layout.units, 0);
    return { w: null, h: mk.len(`${units}u`) };   // width from parent, height intrinsic
  },

  arrange(node, children, ctx) {
    ctx.tracks('rows', children.map((c) => `${c.layout.units}u`));
  },

  css(node, ctx) {
    return { display: 'grid', gap: ctx.len(node.props.gap),
             paddingInline: ctx.len(node.props.railWidth) };
  }
});
```

Twelve lines for a working custom layout, because `ctx.tracks()` compiles a `Len` list into
a grid template and the engine handles invalidation, measurement, and writes. This is the
strongest evidence in the document that §7's algorithm interface is the right shape.

### A.6 Packaging and use

```js
// acme-audio.js — UMD, no build step, no dependencies
(function (root, factory) { /* UMD */ })(this, function () {
  return {
    name: 'acme-audio', version: '1.0.0',
    requires: { mutakit: '^1.0.0' },
    install(mk, opts) {
      mk.unit('u', …); mk.trait({ name: 'acme:rotatable', … });
      mk.define({ type: 'acme:dial', … }); mk.layout({ name: 'acme:rack', … });
      return { uninstall() { /* §8.5: deregisters; live elements survive */ } };
    }
  };
});
```

```html
<script src="mutakit.min.js"></script>
<script src="acme-audio.js"></script>
<script>
  const mk = Mutakit.create();
  mk.use(AcmeAudio);

  const app = mk.mount(document.body, { sizing: 'viewport' });
  const [rack, meters] = app.split({ axis: 'x', gutter: 6, panes: [
    { id: 'rack', size: '1fr' }, { id: 'meters', size: 200, min: 120 }
  ]});

  const strip = rack.create('pane', { algorithm: 'acme:rack', gap: 4 });
  strip.create('acme:dial', { label: 'Gain', layout: { units: 2 },
                              format: (v) => `${(v * 60 - 48).toFixed(1)} dB` });
</script>
```

Two script tags, no toolchain, and a third-party element sitting inside a built-in split.

### A.7 What the contract caught

Running `mk.conformance()` (§8.7) against the first version produced six failures. Every one
was a real defect, which is the argument for the check existing:

| Diagnostic | What was wrong |
|---|---|
| MK6001 | `acme:rotatable` had no keyboard equivalent for its drag gesture — the version above only has arrow keys because the check refused it |
| MK3004 | the drag listener was attached directly instead of through `ctx.own`, leaking on destroy |
| MK3002 | `input` was emitted but only `change` was declared |
| MK3007 | `a11y` was absent; the first draft rendered a knob with no role at all |
| MK6002 | `aria-valuenow` alone reads as "0.42"; `aria-valuetext` was required to say "-6.0 dB" |
| MK3009 | the `motion` preset declared no `reduced` variant (§17) |

None of these are exotic. All six are the defects a plugin author ships by accident, and all
six are mechanically detectable from the declared contract — which is the whole reason §8.1
is a schema rather than a bag of callbacks.

### A.8 Gaps this exposed — spec changes made

Four places where the contract as written in draft 2 was insufficient. All are now fixed in
the body of this document:

1. **Virtual positioning references (§16.3).** The dial wants a value readout that follows
   the knob while dragging. `positioned` accepted only an element as a reference, which
   would have forced a hidden placeholder node into the DOM. Fixed: a reference may now be
   an element, a `Rect`, or a `() => Rect` re-evaluated in ARRANGE.
2. **Unknown units on restore (§19.1).** A layout using `'2u'` restored without
   `acme-audio` installed would have resolved to zero and silently collapsed. Draft 2
   handled unknown *element types* but not unknown *units* — the more dangerous case,
   because it fails invisibly. Fixed: serialization records the resolved pixel value
   alongside the expression, and MK4013 reports the substitution.
3. **`uninstall()` semantics (§8.5).** Specified as "optional" with no stated meaning.
   Fixed: deregisters contributions, never destroys live elements.
4. **`ctx.tokenPx()`.** A custom unit needs to read a design token as a number during
   ARRANGE. Added to the `ctx` surface (§8.2), reading from the metrics snapshot so it
   cannot force a reflow.

### A.9 Scorecard — and one thing still unresolved

| Extension point | Used? | Verdict |
|---|---|---|
| §10.1 element types | ✅ | sufficient |
| §10.2 traits | ✅ | sufficient once keyboard declaration was enforced |
| §10.3 layout algorithms | ✅ | sufficient; `ctx.tracks()` did the heavy lifting |
| §10.4 custom units | ✅ | sufficient after `ctx.tokenPx` was added |
| §10.5 placement strategies | ✅ | **insufficient as written** → fixed, §A.8.1 |
| §10.6 themes/tokens | ✅ | sufficient |
| §10.7 motion presets | ✅ | sufficient |
| §10.10 serializers | ✅ | **insufficient as written** → fixed, §A.8.2 |
| §10.12 devtools panels | ✅ | sufficient |
| §10.8/9/11/13/14/15 | ❌ | untested by this exercise; §10 still requires each to gain an external consumer before 1.0 |

**Resolved since — D15.** `acme:rack` read `child.props.units`, a prop it defined but did
not own, so a typo (`unit` for `units`) fell silently back to the default of 1. This is now
fixed by `childProps` (§7.0): the algorithm declares the schema, the values live in the
child's reserved `layout` bag, and validation happens one level only. The listing in §A.5
should read `child.layout.units`, and `acme:rack` gains:

```js
childProps: { units: { type: 'number', default: 1, min: 1, integer: true } }
```

which turns the silent typo into MK2012 and simultaneously buys generated docs, generated
types, and devtools display for the prop.

**Verdict.** The extension surface held: a third party built an element, a trait, a layout
algorithm, and a custom unit without a single reference to a private API, and the failures
it did produce were caught mechanically rather than shipped. That the exercise also found
four genuine holes is the point — this appendix should be re-run, not deleted, whenever the
plugin contract changes.

---

## Appendix B — Scenario traceability

§1.3 declares S1, S2, and S3 to be the acceptance criteria for the entire design, and §1.5
claims each is buildable in under 40 lines. Neither claim was tested anywhere in drafts 1–4.
This appendix writes all three against the spec as it stands, counts the lines, and traces
every subsystem each one touches — the point being to find subsections that are *referenced*
but not actually *sufficient*.

### B.1 — S1, the IDE / tool window

```js
const mk  = Mutakit.create({ theme: 'dark' });                              //  1
const app = mk.mount(document.body, { sizing: 'viewport' });                //  2
                                                                            //
const shell = app.dock({ corners: 'horizontal', regions: {                  //  3
  top:    { id: 'menubar',   size: 36 },                                    //  4
  bottom: { id: 'statusbar', size: 22 },                                    //  5
  center: { id: 'body' }                                                    //  6
}});                                                                        //  7
                                                                            //
const [explorer, work] = shell.region('body').split({                       //  8
  axis: 'x', gutter: { size: 6, draggable: true },                          //  9
  panes: [                                                                  // 10
    { id: 'explorer', size: 260, min: 160, max: '40%',                      // 11
      collapsible: { at: 120, to: 0 } },                                    // 12
    { id: 'work', size: '1fr' }                                             // 13
  ]                                                                         // 14
});                                                                         // 15
                                                                            //
const [editor, panel] = work.split({                                        // 16
  axis: 'y', gutter: { size: 6, draggable: true },                          // 17
  panes: [                                                                  // 18
    { id: 'editor', size: '1fr', min: 120 },                                // 19
    { id: 'panel',  size: 200,  min: 60, collapsible: { at: 48, to: 0 } }   // 20
  ]                                                                         // 21
});                                                                         // 22
                                                                            //
explorer.create('tree', { id: 'files',  data: files, selection: 'single' });// 23
editor.create('tabs',   { id: 'docs',   closable: true, reorderable: true });//24
panel.create('tabs',    { id: 'panels', tabs: ['Terminal', 'Problems'] });  // 25
                                                                            //
mk.persist('ide-layout', { storage: localStorage, debounce: 300 });         // 26
```

**26 lines.** Delivers: recursive splits, draggable and keyboard-resizable separators,
min/max, collapse-to-zero, persisted layout across reloads, a menubar and statusbar that
reserve space via the inset stack.

| Requirement | Delivered by | Sufficient? |
|---|---|---|
| Application shell | §7.4 `dock`, corner arbitration | ✅ |
| Recursive splits | §7.3, nested via pane handles | ✅ |
| Drag separators | §7.3 pointer capture, hit slop, clamping cascade | ✅ *(R1 confirmed in Chrome; FF/Safari pending)* |
| Keyboard resize | §7.3 `role="separator"`, arrows/Home/End | ✅ |
| Min / max / collapse | §5.8 clamps, §7.3 `collapsible` | ✅ |
| Persistence | §19.1 | ⚠️ **gap → fixed** |
| Tabs, tree | §11.1 (Tier B, M6 / M3) | ✅ |

**Gap found.** Every line above existed in the spec except line 26: §19.1 offered
`serialize()`/`restore()` but no wrapper, so every application would hand-roll the same
debounced save/restore — and would hand-roll the ordering wrongly, restoring after first
paint and producing a visible snap from default sizes to stored ones. Fixed: `mk.persist()`
plus an explicit before-first-paint guarantee (§19.1).

### B.2 — S2, the application chrome

```js
const prefs = mk.create('dialog', {                                          //  1
  size: { w: '80%', h: '85%' }, at: 'center', of: 'viewport',                //  2
  title: 'Preferences', dismiss: 'light',                                    //  3
  body: { type: 'form', id: 'prefs',                                         //  4
    values: { theme: 'dark', fontSize: 13, telemetry: false },               //  5
    schema: { fontSize: { type: 'number', min: 8, max: 32, integer: true } },//  6
    children: [                                                              //  7
      { type: 'field', label: 'Theme', control: { type: 'select',            //  8
        name: 'theme', options: ['dark', 'light', 'system'] } },             //  9
      { type: 'field', label: 'Font size',                                   // 10
        control: { type: 'number', name: 'fontSize' } },                     // 11
      { type: 'field', label: 'Telemetry',                                   // 12
        control: { type: 'switch', name: 'telemetry' } }                     // 13
    ]                                                                        // 14
  },                                                                         // 15
  footer: { type: 'stack', axis: 'x', gap: 8, justify: 'end', children: [    // 16
    { type: 'button', text: 'Cancel', command: 'close' },                    // 17
    { type: 'button', text: 'Save', variant: 'primary', command: 'submit' }  // 18
  ]}                                                                         // 19
});                                                                          // 20
prefs.on('submit', (e) => { save(e.values); prefs.close(); });               // 21
```

**21 lines** — and the user's original phrasing (*"width 80%, height 85%, positioned by its
center at the center of the screen"*) is line 2, verbatim.

| Requirement | Delivered by | Sufficient? |
|---|---|---|
| Viewport-relative sizing, centred | §5.3 basis, §5.5 anchors | ✅ |
| Backdrop, stacking, scroll lock | §16.1–16.2, reference-counted | ✅ |
| Focus trap and restore | §9 `focus-trap`, §14 | ✅ |
| Light dismiss + unsaved-changes veto | §9 `dismissible`, §11.3 `dirty` | ✅ |
| Form composition and validation | §11.3 | ✅ |
| Automatic ARIA wiring | §11.3, §14 | ✅ |
| Buttons invoking dialog commands | §18.2 | ⚠️ **gap → fixed** |
| Slots expressed declaratively | §8.1 / §18.2 | ⚠️ **gap → fixed** |

**Gaps found — and this is the more serious pair.** Lines 4, 16, 17 and 18 were not
expressible. §8.1 declared `slots` but tier-2 had no syntax for filling them, and there was
no way for a declarative button to invoke its dialog's `close`. Both would have forced
JavaScript callbacks into every dialog — which quietly breaks §19's entire premise, since a
tier-2 tree containing function references **is not serializable**, and serializability is
what persistence, devtools, and the layout editor all rest on. Fixed in §18.2: slots-as-props
and tree-walking `command` resolution.

That this surfaced only when a *complete* scenario was written, rather than the fragments
used throughout §18, is the argument for this appendix existing.

### B.3 — S3, the game HUD

The §18.5 listing, at **12 lines**, plus the `gu` unit definition.

| Requirement | Delivered by | Sufficient? |
|---|---|---|
| Edge and corner pinning | §5.5 `at` + `inset` | ✅ |
| Notch / safe-area avoidance | §5.7 inset stack, max-composed | ✅ |
| Viewport-relative scaling | §10.4 custom `gu` unit | ✅ |
| 60 fps with 100 elements | §6.2 PAINT fast path, §20.2 | ⚠️ **unproven — R7** |
| Gamepad navigation | §13.5, §13.6 spatial nav | ✅ |
| World-to-screen markers | §11.5 `hud-marker`, §5.4 spaces | ✅ |
| Decorative opt-out from a11y | §11.5, explicit `presentation` | ✅ |

No specification gaps. The one open item is empirical, not architectural: R7 is a benchmark
gate at M5, and §27.2 already records that its fallback (a canvas-rendered `hud-*` family)
needs no core change.

### B.4 — Findings

1. **§1.5 criterion 1 verified.** 26, 21, and 12 lines against a 40-line claim. The claim
   holds with margin, and is now checked rather than asserted. These counts are also the
   only real evidence for **P6** (progressive disclosure): none of the three listings
   mentions a constraint priority, a dirty bit, a layout algorithm by name, or the frame
   scheduler. All of that machinery exists and none of it is in the beginner's path.
2. **Three gaps found, all in S1 and S2, none in S3.** The HUD scenario was traced
   repeatedly during drafts 1–4 (it drove the geometry model); the application-chrome
   scenario was assumed rather than written. The gaps were exactly where attention had not
   gone — which is a useful thing to know about how this document was produced.
3. **The most valuable finding was structural, not local.** Missing slot syntax and missing
   declarative commands each look like small ergonomic gaps. Together they would have
   silently broken serializability, and therefore persistence (§19), the layout editor
   (§19.3), and the tier-2-as-canonical-form principle (P2). A gap that only becomes visible
   two subsystems away is precisely what end-to-end tracing catches and section-by-section
   review does not.
4. **These three listings become `examples/` and the layout-snapshot fixtures** (§23.2). They
   are the regression suite for the whole design: if a future change makes any of them
   longer or impossible, that change has cost something the plan considered essential.
