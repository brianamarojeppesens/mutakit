# Diagnostics

Every Mutakit diagnostic carries a stable code and links here. Codes are public
API under SemVer (§25.1); the *message text* is not, so match on the code.

**How they behave** (§21.3). Development throws on programmer error and warns on
recoverable ambiguity. Production warns once and applies the documented
fallback. Nothing silently does nothing — an element that fails to appear with
no explanation is the worst outcome a layout library can produce.

Diagnostics de-duplicate by code plus subject, so a problem inside the frame
loop reports once rather than sixty times a second. `Mutakit.diagnostics.sink(fn)`
routes them somewhere other than the console; `Mutakit.diagnostics.reset()`
clears the de-duplication keys.

| Range | Category |
|---|---|
| MK1xxx | Geometry |
| MK2xxx | Layout |
| MK3xxx | Contract |
| MK4xxx | Plugin |
| MK5xxx | Performance |
| MK6xxx | Accessibility |

---

## Geometry — MK1xxx

### MK1001 — Mount target measured zero on an axis
**Cause.** `mount()` in the default `'element'` sizing mode takes the root rect
from the mount target's content box, and the target measured zero on at least
one axis. `document.body` has no intrinsic height, which makes this the single
most likely first-run failure.
**Fix.** Give the target a size in CSS, or mount with `{ sizing: 'viewport' }`
for a full-screen application. `{ sizing: 'fixed', size: { w, h } }` is the
third option, used by tests and fixed canvases.

### MK1002 — Unparseable length
**Cause.** A `Len` could not be tokenized. The value resolves to `auto`.
**Fix.** Check the spelling against §5.2. Common slips: a missing unit inside
`calc()`, a stray `%` after a keyword, or a locale decimal comma.

### MK1003 — Axis is over-constrained; a constraint was dropped
**Cause.** All three of `start`, `end`, and `size` were given on one axis. Two
determine it; the third was dropped by priority, then by the fixed order
`size` → `end` → `start`.
**Fix.** Usually none — `{ right: 0, top: 0, bottom: 0, width: 320 }` is a
deliberate, convenient shape and dropping `height` is what you meant. To choose
a different victim, mark one constraint `priority: { end: 'weak' }`.

### MK1004 — Percentage resolves against a container sized by its own content
**Cause.** A child's percentage would resolve against a parent whose size
depends on that child. That is a cycle. The child falls back to `auto`.
**Fix.** Give the container an explicit size on that axis, or size the child
intrinsically.

### MK1005 — Unknown length unit
**Cause.** A unit that is neither built in nor registered via `mk.unit()`.
**Fix.** Register the unit (extension point §10.4), or use a built-in one. If a
saved layout reports this, the plugin providing the unit is not installed — see
MK4013, which keeps the geometry correct meanwhile.

### MK1007 — Layout geometry read under a rotated or skewed ancestor
**Cause.** Hit testing and dragging compose the full matrix, but layout math
assumes axis-aligned parents.
**Fix.** Keep rotation and skew on descendants of the elements Mutakit lays
out, or accept that the resolved rects describe the untransformed box.

### MK1008 — Anchor keyword not recognised
**Cause.** An anchor string that is not one of the nine physical keywords or
their logical spellings. It falls back to `top-left`.
**Fix.** Use a keyword from §5.5, a normalized pair (`[0.5, 0.5]`), an absolute
pair (`['16px', '16px']`), or a mixed pair.

---

## Layout — MK2xxx

### MK2001 — Unknown layout algorithm
**Cause.** A node names an algorithm that is not registered. It falls back to
`anchor`.
**Fix.** Install the plugin providing it, or use one of the registered
algorithms named in the message.

### MK2002 — Layout algorithm rejected a child
**Cause.** The child cannot be placed by this algorithm — most often a
reparenting that would create a cycle.
**Fix.** The message names the specific conflict.

### MK2011 — Self-positioning child inside a flow-owning algorithm
**Cause.** §9.1's rule: **the parent's layout algorithm owns a child's box,
unless that child declares `positioning: 'self'`.** `draggable` and `resizable`
set that automatically when they attach, which makes them a contradiction
inside `stack`, `split`, `grid`, and `dock` — the algorithm computes a track
for something that refuses to sit in it. Left unspecified, this is where UI
libraries misbehave silently: the element jitters or snaps back with no
explanation.
**Fix.** Two real ones, both named in the message: use the `sortable` trait to
reorder *within* the flow, or move the child into a `free`/`anchor` parent to
move it *freely*. A pane inside a split is resized by its gutters, not by
corner handles — see `split`'s own `min`/`max`.

### MK2012 — Unknown key in a child's `layout` bag
**Cause.** The parent algorithm's `childProps` schema does not declare this key.
The value is **retained but ignored**, so moving the child back to a compatible
parent restores it (§7.0).
**Fix.** Check the accepted keys named in the message. This most often means a
typo, or a child that has been reparented into a different algorithm.

### MK2013 — Split pane minimums exceed the container
**Cause.** Below Σ minimums + gutters there is no arrangement that satisfies
every bound. CSS holds the minimums and lets the container overflow, which
`split` treats as defined behaviour (§27.2 R1) rather than as a failure.
**Fix.** None is required — but if the overflow is unwanted, lower a `min`, or
collapse a pane. Reported once per split so a resize sweep does not flood the
console.

---

## Contract — MK3xxx

### MK3001 — Unknown element type
**Cause.** `create()` named a type that is not registered.
**Fix.** Install the plugin that provides it, or check the namespace — bare
names are reserved for core, and plugin types are `vendor:name`.

### MK3002 — Element definition is invalid
**Cause.** A definition is missing `type`, has neither `create` nor `extends`,
declares an unknown field, or has a malformed `commands`/`slots` entry.
**Fix.** The message names the field. See §8.1 for the complete contract.

### MK3003 — Undeclared event emitted
**Cause.** `ctx.emit(name)` where neither the element type nor any attached
trait declares `name` in its `events`.
**Fix.** Add it to the definition's `events`. Declaring events is what makes
them typed, documented, and checkable.

### MK3004 — Prop is not declared in the type's schema
**Cause.** A prop was passed that the type does not declare. It is kept, but
nothing reads it.
**Fix.** Declare it in `props` to gain validation, generated types, docs, and
devtools display — the four consumers that make a schema worth more than a
defaults object.

### MK3005 — Prop value failed validation
**Cause.** A value that the schema's validator rejected or could not coerce.
**Fix.** The message names the prop and the constraint it violated.

### MK3006 — Element type declares no accessibility semantics
**Cause.** P5 requires every type to declare `a11y` or opt out explicitly.
**Fix.** Declare a role (`a11y: { role: 'meter', props: { … } }`), or opt out
with `a11y: 'presentation'` — which is correct for decorative HUD overlays and
is reported by the conformance check so it can be audited.

### MK3007 — Lifecycle hook threw; the node is isolated
**Cause.** A `create`, `mount`, `update`, `measure`, `arrange`, or `paint` hook
threw. The node is marked errored, its subtree is replaced by a placeholder
**preserving its declared geometry**, and an `error` event bubbles the node
tree. A throwing `destroy` is always logged and always swallowed, because
teardown of siblings must complete.
**Fix.** The message carries the element type, the owning plugin's name and
version, and the original stack. `errorPolicy: 'propagate'` rethrows, which is
what you want in tests.

### MK3008 — Unknown trait
**Cause.** A trait name that is not registered. It is skipped; the element still
works without the behaviour.
**Fix.** Install the plugin providing it.

### MK3009 — Trait dependency missing
**Cause.** A trait declares `requires: ['focusable']` and that trait could not
be attached.
**Fix.** Register the dependency, or drop the requirement.

### MK3010 — Trait conflict
**Cause.** A trait declares `conflicts` with one already attached.
**Fix.** Attach one or the other. The message names both.

### MK3011 — Declarative command did not resolve
**Cause.** `{ type: 'button', command: 'close' }` found no ancestor declaring a
`close` command. Reported at build time rather than as a silent no-op on click.
**Fix.** Declare the command in an ancestor's `commands`, or target a specific
element by id: `command: 'prefs:submit'`.

### MK3012 — Slot is not declared by the element type
**Cause.** Content was assigned to a slot the type does not declare.
**Fix.** The message lists the declared slots.

### MK3013 — Slot cardinality exceeded
**Cause.** More content than the slot's `max` allows.
**Fix.** Raise `max` in the definition, or place the extra content elsewhere.

### MK3014 — `html`-prefixed prop used with no sanitizer configured
**Cause.** Mutakit never parses a plain string as markup (§21.4). An
`html`-prefixed prop routes through a sanitizer configured at instance
creation; with none, it **throws in development and escapes in production** —
the insecure path is never the quiet default.
**Fix.** `Mutakit.create({ sanitize })`, passing a real sanitizer.

### MK3015 — Reading resolved geometry during the WRITE phase
**Cause.** P4 forbids interleaving reads and writes. Reading here forces a
reflow.
**Fix.** Move the read into ARRANGE or PAINT.

### MK3017 — Content value is of an unsupported form
**Cause.** `content` accepts a string, a `Node`, a nested element object, a
factory, or a promise of one (§8.8).
**Fix.** Use one of those five forms.

---

## Plugin — MK4xxx

### MK4001 — Type re-registered without `replace: true`
**Cause.** Something is already registered under that name. Accidental
collisions must be loud.
**Fix.** Pass `{ replace: true }` if the override is deliberate — it logs a
warning naming both versions — or choose a different name.

### MK4002 — Plugin requirement not satisfied
**Cause.** `requires` names a dependency that is absent or at an incompatible
version. Checked at install time, with the full chain.
**Fix.** Install the dependency, or widen the range.

### MK4003 — Plugin dependency cycle
**Cause.** Installation is topologically ordered; this cycle cannot be ordered.
**Fix.** Break the cycle. The message prints the path.

### MK4004 — Bare type name registered from a plugin
**Cause.** Bare names are reserved for core.
**Fix.** Namespace it: `vendor:name`.

### MK4005 — Duplicate element id
**Cause.** Two elements share an id in one instance. Lookup returns the first;
both elements keep working, because silently breaking a running UI over a name
collision would be the wrong trade.
**Fix.** Make ids unique if you rely on lookup.

### MK4006 — Plugin install threw
**Cause.** A plugin's `install` or `uninstall` threw. The rest of the
application continues.
**Fix.** The message carries the plugin name and the original error.

### MK4010 — Restored element type is not registered
**Cause.** A saved layout names a type this build does not have. A placeholder
preserving the node's declared geometry **and its serialized props** is used, so
reinstalling the plugin restores it exactly, and re-serializing emits the
original data.
**Fix.** Install the plugin and restore again. No action is needed to avoid data
loss — placeholders round-trip losslessly.

### MK4011 — Restored trait is not registered
**Cause.** As MK4010, for a trait. It is dropped; the element renders without
the behaviour.
**Fix.** Install the plugin providing it.

### MK4012 — Restored layout algorithm is not registered
**Cause.** As MK4010, for an algorithm. It falls back to `stack` on the parent's
declared axis, or `anchor` if none.
**Fix.** Install the plugin providing it.

### MK4013 — Restored custom unit is not registered
**Cause.** A saved layout uses a plugin's custom unit. Serialization records the
**resolved pixel value** alongside the expression precisely for this case, so
the layout stays geometrically correct and snaps back to the live expression
when the plugin returns. This is the subtler missing-plugin case: a dropped type
fails visibly, a dropped unit would silently collapse an element to zero.
**Fix.** Install the plugin providing the unit.

### MK4014 — Type deregistered while instances are live
**Cause.** `unuse()` deregistered a type that still has live elements. They keep
working until destroyed normally; only new `create()` calls fail. This makes
`uninstall` safe during hot reload.
**Fix.** None required. The count is reported so the situation is visible rather
than mysterious.

### MK4015 — Restore rejected a type or prop not in `allow`
**Cause.** `restore()` instantiates types and sets props that reach DOM sinks,
which makes untrusted layout JSON roughly as dangerous as untrusted code. The
default is strict.
**Fix.** Layouts from the user's own `localStorage` are lower risk; anything
synced from a server or shared between users must pass
`{ allow: { types: [...], props: 'schema' } }`. Pass `{ allow: 'any' }` only
deliberately.

### MK4016 — Persisted layout could not be read or written
**Cause.** The storage backend threw, rejected, or returned unparseable data.
**Fix.** The message carries the key and the underlying error. A rejected async
write surfaces here rather than silently losing a layout.

---

## Performance — MK5xxx

### MK5001 — Frame budget exceeded
**Cause.** A frame took longer than the budget (8 ms by default), or resources
were not released when a subtree was destroyed.
**Fix.** Profile with the devtools frame profiler. Common causes: a `measure`
hook doing real work, or an `auto`-sized subtree forcing synchronous reads.

### MK5003 — STATE phase did not settle
**Cause.** Effects were still producing work after eight passes. The remainder
is deferred to the next frame, so a runaway cycle degrades to a janky UI rather
than a frozen tab.
**Fix.** Look for an effect that writes a signal it also reads.

### MK5006 — Development-only affordance used in a production build
**Cause.** Something that exists only in the development build was asked for in
production — a store's time-travel timeline is the case that occurs. It returns
an empty result rather than throwing.
**Fix.** None in production; the affordance is a debugging tool and its absence
is the point. If you need the data at runtime, keep your own snapshots.

### MK5004 — Animating a layout-affecting property
**Cause.** Motion presets may animate `transform`, `opacity`, `filter`, and
`clip-path` only. Animation may never affect layout correctness (§17).
**Fix.** The message names the transform-based alternative. `collapse` is the
sanctioned exception and animates a `grid-template-rows` `0fr → 1fr` track.

---

## Accessibility — MK6xxx

### MK6001 — Pointer interaction has no keyboard equivalent
**Cause.** Every trait that responds to a pointer gesture must declare a
keyboard equivalent (P5, §13.4). Enforced by the conformance check and the
build lint.
**Fix.** Declare `keys` on the trait or the element type.

### MK6004 — Shortcut is already bound in this scope
**Cause.** Two bindings claim the same chord in the same scope. Detected at
registration, not at press time — a conflict discovered when the user presses
the key is a conflict discovered by the user.
**Fix.** Rebind one, or narrow its scope. Scopes run global → layer → element
subtree → element, and the most specific live scope wins, so moving one binding
into a subtree usually resolves the clash rather than papering over it.

### MK6003 — Live-region announcement was rate limited
**Cause.** The same message was announced twice within two seconds. A live
region that fires on every keystroke is worse than none, so the announcer
de-duplicates and rate limits (§14).
**Fix.** Usually none — the drop is the correct behaviour. If the repeat is
meaningful (a counter reaching the same value again), vary the text, or space
the announcements out.
