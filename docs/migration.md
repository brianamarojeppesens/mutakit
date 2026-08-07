# Migrating from 0.x

## From the 0.2.0 scaffold

The scaffold's API — `Mutakit.hello()`, `Mutakit.create({ debug })`, and the
UMD wrapper in `source/mutakit.js` — was deleted in 0.3.0. Nothing about it
survives, and nothing should: it was a placeholder that never described the
library.

If you have code against it, the mapping is:

| 0.2.0 | Now |
|---|---|
| `Mutakit.hello(name)` | — (deleted) |
| `Mutakit.create({ debug })` | `Mutakit.create({ errorPolicy, theme, prefix })` |
| `<script src="build/mutakit.min.js">` | unchanged — the UMD *output shape* survives |
| `python3 build.py` | `npm run build` |

## Between 0.x minors

Under SemVer, **every 0.x minor is a breaking change**, and this project used
that licence: the milestones from 0.3.0 to 0.9.0 added subsystems rather than
revising them, so in practice each minor is additive. The exceptions are
recorded in `CHANGELOG.md` under **Fixed**, and three changed observable
behaviour:

- **0.5.0** — flow-owning algorithms (`stack`, `split`, `grid`, `dock`, `flow`)
  stopped writing `width`/`height` onto their children. If you were reading a
  child's CSS width to discover its size, read `handle.rect()` instead — the
  browser owns the box now, which was always the intent.
- **0.7.0** — `required` began treating `""` and `[]` as absent. A form field
  that previously passed validation while empty now fails, which is what
  `required` means.
- **0.9.0** — bundled plugins' `requires` ranges widened from `^0.4.0` to
  `>=0.4.0 <2`. A plugin of your own pinned to `^0.x` will refuse to install
  against a later minor; widen it the same way.

## What is frozen at 1.0

Everything in §25.1: the JavaScript API, element type names, prop names and
semantics, event names and payloads, the CSS custom properties of §12.4, data
attributes, class name patterns, the serialization format, the plugin contract,
the adoption contract, and the generated type definitions.

Deliberately **not** frozen: exact pixel output, internal DOM structure unless
documented as a part, diagnostic *message text* (the codes are frozen; match on
those), and devtools.

The CSS contract being versioned is unusual and deliberate. Authors *will*
style against `.mk-modal__header`, so renaming it is a breaking change whether
anyone likes it or not — better to say so than to discover it.

## After 1.0

Deprecated API keeps working for one full minor cycle, warns once with a
diagnostic code and a migration hint, and is listed under **Deprecated** in
`CHANGELOG.md` with its planned removal version.
