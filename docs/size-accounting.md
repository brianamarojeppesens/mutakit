# Core size accounting — measured

> Regenerate with `npm run build`; the numbers come from `build/manifest.json`,
> which is esbuild's metafile and therefore reports **what actually shipped
> after tree-shaking** rather than the sum of a declared file list.
>
> Measured at 0.9.0, Chrome-targeted build (`chrome111, firefox113, safari16.4`),
> production output with dev code stripped and CSS templates minified.
> **Re-measured after motion (§17), gestures (§13.3), stores (§15.3), and the
> collection traits (§9) landed** — see "The full preset since" below, which is
> why the proposed full-bundle figure moved.

## The finding

**Core measures 29.87 KB gzipped against §20.1's 8.5 KB budget — 3.5× over.**
The full preset measures 70.34 KB against 32 KB — 2.2× over.

PLAN.md §20.5 point 6 asks for exactly this to be recorded rather than absorbed:

> *"Expect the measured numbers to come in at or under these estimates; if any
> module comes in **over**, that is a finding worth a line in the changelog
> rather than a quiet budget revision."*

This document is that finding, worked module by module so the revision it
proposes rests on evidence rather than on the shortfall being inconvenient.

## Group-by-group, against §20.5's own rows

| Group | §20.5 estimate | Measured | Ratio |
|---|---:|---:|---:|
| Kernel | 5.3 KB | 19.5 KB | 3.7× |
| Signals | 1.5 KB | 2.4 KB | 1.6× |
| Geometry | 6.2 KB | 15.0 KB | 2.4× |
| Engine | 5.7 KB | 34.6 KB | **6.1×** |
| Layout (`anchor`, `stack`) | 1.6 KB | 3.7 KB | 2.3× |
| Services & traits | 1.4 KB | 3.8 KB | 2.7× |
| Elements (Tier A) | 1.2 KB | 3.0 KB | 2.5× |
| Base CSS | 2.0 KB | 3.6 KB | 1.8× |
| Namespace / entry | — | 1.9 KB | — |
| **Total** | **24.9 KB min** | **88.4 KB min** | **3.5×** |
| | ~8.0 KB gzip | **29.87 KB gzip** | 3.7× |

## Why Engine is 6.1× — the load-bearing part

§20.5's engine row lists six modules: `compile` (1.2), `scheduler` (1.2),
`measure` (1.0), `node` (1.0), `metrics` (0.8), `invalidate` (0.5). Measured,
those six come to **9.1 KB** — 1.6× the estimate, which is ordinary
estimate-versus-reality drift.

The other **25.5 KB** is in four modules the table has **no row for at all**:

| Module | Measured | What it implements |
|---|---:|---|
| `engine/instance.js` | 18.57 KB | element lifecycle (§8.1), content interop (§8.8), identity and lookup (§8.9), error isolation (§8.10), trait attachment (§9), root frames (§5.11), the ARRANGE pass |
| `engine/handle.js` | 2.36 KB | tier-1 fluent handles (§18.1) |
| `engine/ctx.js` | 1.64 KB | `ctx` — the only surface a plugin sees (§8.2) |
| `engine/styles.js` | 1.45 KB | cascade-layer injection and prefix scoping (§12.2) |

None of these is optional and none is unspecified: each is a section of the
plan the estimate simply did not cost. `instance.js` alone is larger than the
entire estimated core, and it is the module that makes §8 true.

I checked the alternative explanation before reaching this one. Every method in
`instance.js` maps to specified behaviour — the largest are `create` (2.9 KB
of source), `resolveBox` (2.2), `_arrangeNode` (2.1), `attachTrait` (1.7),
`adopt` (1.7), `setProps` (1.6), and `_bindCommand` (1.5, §18.2's declarative
commands). There is no dead code to delete and no subsystem in core that §4.2's
cut line does not put there.

**Geometry at 2.4×** has the same shape in miniature: `len` was estimated at
2.5 KB and measures 7.69 KB, because the estimate costed "a tokenizer, an AST,
and two compile backends" without costing `distributeFr`, `isFlexible`,
`isIntrinsic`, `frCoefficient`, `isCSSResolvable`, or `env()`/`var()` support —
all of which §5.2 and §7.3 require.

## What was already removed

These were genuine waste, and they are gone. Together they account for
**4.3 KB gzipped** — the difference between 33.9 KB and today's 29.87 KB:

| Change | Saved (core, gzip) |
|---|---:|
| Dev-only diagnostic prose behind `__MK_DEV__ &&` at every call site | 2.4 KB |
| `Mutakit.geometry` curated instead of four re-exported namespace objects | 0.6 KB |
| Conformance pruned from *inside* its functions, not at its call sites | 0.7 KB |
| CSS template comments and whitespace minified at build time | 0.6 KB |

The first and third are the same lesson twice: esbuild computes reachability
before it folds constants, so marking a *call site* dev-only does not remove
the callee. Pruning has to happen inside the thing being removed.

## What was considered and rejected

**Stripping schema validation in production**, which §21.1 appears to sanction
("`mutakit.min.js` strips all of it"). Rejected: §11.3 makes form validation
messages *user-facing UI*, and §11.3 also makes them the *same* schema as
§8.1's props. Message text that a user reads cannot be a build-mode
diagnostic, and separating the two would mean two validator vocabularies —
which is the exact duplication §11.3 exists to avoid. Worth ~1.2 KB; not worth
that.

**Moving `build`, `adopt`, or `query` out of core.** Rejected: `setContent`
needs `build` for §8.8's nested-element form, and §8.8/§8.9 both sit inside the
plugin contract. They are core by the cut line's own rule — *a thing is core if
plugins depend on it existing*.

## The proposed revision

§20.5 revised this budget once already, on evidence, when the ≤ 20 KB minified
figure proved unachievable — and noted then that the gzip figure was always the
meaningful one. The same correction is due again, and for the same reason: the
number was projected from an accounting that had not yet been written against
the specification it was costing.

| | Current (§20.1) | Proposed | Measured today |
|---|---:|---:|---:|
| Core | ≤ 8.5 KB gzip | **≤ 30 KB gzip** | 29.87 KB |
| Full | ≤ 32 KB gzip | **≤ 71 KB gzip** | 70.34 KB |

### The full preset since

The full-bundle figure moved because four subsystems the plan specifies had no
implementation when this document was first written, and now do. None of them
touches core:

| Subsystem | Cost (full, minified) |
|---:|---:|
| Gestures + the pointer queue (§13.3, §13.2) | 8.36 KB |
| The display catalog (§11.4) | 8.30 KB |
| The collection traits (§9) | 6.01 KB |
| Motion (§17) | 3.96 KB |
| Stores (§15.3) | 2.83 KB |

That is the shape a preset split is supposed to have: `mutakit.hud` moved
33.78 → 34.00 KB gzipped across all four, because a HUD uses none of them.

Two things this revision is *not*. It is not a licence to grow: the proposed
numbers sit ~1% above today's measurement, so the next kilobyte fails the
build. And it is not a claim that core is as small as it could be — only that
what remains is specified behaviour, and that removing it would mean amending
§5–§8 first.

**This document does not change PLAN.md.** §20.1 is the design source of truth
and the revision is the maintainer's call; `npm run build` reports the overage
on every build and `--strict-budget` fails on it until then.

## For comparison

<!-- sizes:start -->
<!-- Generated by `npm run build`. Edits here are overwritten. -->

| Preset | Minified | Gzipped |
|---|---:|---:|
| `mutakit` | 237.20 KB | 72.66 KB |
| `mutakit.core` | 92.26 KB | 30.86 KB |
| `mutakit.dock` | 142.75 KB | 46.26 KB |
| `mutakit.app` | 167.25 KB | 51.17 KB |
| `mutakit.hud` | 106.22 KB | 35.22 KB |
<!-- sizes:end -->

`mutakit.core` is §4.2's core; `mutakit.hud` adds the HUD elements and gamepad;
`mutakit.dock` adds splits, persistence, and stores; `mutakit.app` adds
overlays, forms, motion, and gestures; `mutakit` is everything.

The preset split does what §4.2 says it should: a HUD pays roughly half what
the full bundle costs, and an ESM consumer bundling through their own toolchain
pays for what they reference rather than for any of these.
