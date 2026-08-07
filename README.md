# Mutakit

A dependency-free browser library that builds and mutates graphical user interfaces from
declarative geometry — you describe *what element* and *where*, and the library resolves
layout, interaction, accessibility, and styling.

> **Status: pre-implementation scaffold (v0.2.0).** What ships today is the scaffold, not the
> library above — `source/mutakit.js` is a UMD placeholder with a `hello()` function. The
> design is complete and lives in [`PLAN.md`](PLAN.md), which is the source of truth;
> `source/` is the implementation source of truth. Implementation starts at M0 (§26).
>
> **The toolchain is mid-migration.** The commands below are the ones that work *now*. Draft 7
> of the plan moves the build to Node, and that lands in M0 — see [Toolchain](#toolchain).

## Layout

```
PLAN.md         the design source of truth — read this first
source/         the implementation source of truth — edit here
build/          generated output, both expanded and minified; regenerated, never edited
test/           browser harness for exercising the library
  proto/        standalone prototypes that answer a specific design question
tools/          build-support scripts
unpinned.json   project manifest read by the dev shell
```

## Build

```bash
python3 build.py
```

Produces `build/mutakit.js` and `build/mutakit.min.js`. Nothing in `build/` should be edited
by hand. `python3 build.py --check` verifies without writing.

`build.py` concatenates the files listed in `unpinned.json:source.files` and runs a
line-preserving minifier that strips comments and collapses whitespace without renaming
identifiers. Its nested-template handling is covered by a regression probe:

```bash
python3 tools/test_build.py      # 31 cases, all passing
```

## Test

Open `test/index.html` in a browser, or serve the project folder:

```bash
python3 -m http.server 8080
```

The harness loads `source/mutakit.js` directly, so a rebuild is not needed while developing.
Switch the `<script src>` in `test/index.html` to the build output when verifying a release.

### Prototypes

`test/proto/` holds self-contained pages that answer one design question and report their own
PASS/FAIL. These **must be served, not opened over `file://`** — the browser blocks local file
access that they depend on.

```bash
python3 -m http.server 8080     # then open test/proto/split-grid.html
```

- `split-grid.html` — whether CSS Grid alone can express the `split` clamping cascade
  (PLAN.md §27.2 R1). Passes in Chrome; Firefox and Safari runs are still outstanding, and
  are the M1 exit gate.

## Toolchain

Node **24.19.0** is available and build-time dependencies are permitted. Draft 7 of the plan
acts on that, and the migration lands in M0:

| Today | After M0 | Why |
|---|---|---|
| `build.py` concatenates | esbuild bundles | tree-shaking, source maps (§22.3) |
| hand-written minifier | esbuild minifies | identifier mangling; deletes a hand-rolled tokenizer (§20.4) |
| IIFE module registry | plain ESM | the registry existed only to survive concatenation (§22.2) |
| open `test/index.html` | serve it | ESM is fetched, so `file://` is CORS-blocked (§23.3) |
| Chrome by hand | Playwright | cross-engine CI; unblocks the R1 gate (§23.3) |
| — | `node --test` | the DOM-free unit tier needs no dependency at all |

Two rules survive the migration and are worth stating plainly:

- **Dependency-free describes what ships, not what builds it.** Nothing Mutakit sends to a
  user's page depends on anything else. The toolchain uses ordinary Node dependencies; the
  library has zero runtime dependencies, and adding one requires a decision record and a size
  measurement (PLAN.md §2.1).
- **The `<script>`-tag path is not a fallback.** Mutakit must stay usable from a single tag
  with no build step, which is why tagged builds are committed and presets are pre-cut.

## Usage

```html
<script src="build/mutakit.min.js"></script>
<script>
  Mutakit.hello("world");
</script>
```

The module ships as UMD, so it also works with CommonJS and AMD loaders.

> `hello()` is scaffold placeholder API and is deleted in M0. The real surface is
> `mk.create('pane', …)` — see PLAN.md §8 for the element contract and §5 for the geometry
> model. After M0 the package also publishes as ESM to npm, with UMD retained for the CDN
> path (§25.5).
