# The geometry model

Mutakit's authoring vocabulary is **element type + geometric intent**. You say
*what* and *where*; the library compiles that into CSS the browser executes and
supplies JavaScript only where interaction genuinely needs a number.

## Two of three

For each axis, an element's geometry is determined by exactly **two** of three
values — horizontal `{left, right, width}`, vertical `{top, bottom, height}`.

| Given | Behaviour |
|---|---|
| 2 of 3 | Fully determined. The third is derived. The normal case. |
| 3 of 3 | Over-constrained: resolved by priority, and MK1003 says which one was dropped. |
| 1 of 3 | The missing size resolves to `auto`; the missing edge to the anchor, defaulting to `start`. |
| 0 of 3 | Falls through to the parent's layout algorithm. |

This one rule is why the HUD case falls out for free:

```js
app.create('pane', { right: 24, bottom: 24 });                 // pinned, sized to content
app.create('pane', { right: 0, top: 0, bottom: 0, width: 320 }); // a full-height rail
app.create('pane', { left: 0, right: 0, top: 0, height: 48 });   // a bar across the top
```

## Anchors

*Put **this** point of the element at **that** point of the container, then
shift by offset.* `anchor` defaults to matching `at`, so `at: 'top-right'`
alone means "my top-right corner at the container's top-right corner".

```js
Mutakit.create('modal', { size: { w: '80%', h: '85%' }, at: 'center' });
```

`offset` is always in screen axis direction — `+x` right, `+y` down —
regardless of the anchor. For edge-relative gaps use **`inset`**, which flips
correctly under RTL and composes with safe areas:

```js
hud.create('hud-bar', { at: 'top-left', inset: 16 });   // 16px in from both edges it touches
```

## `Len`

Every length is one of: a number (CSS pixels), `'120px' | '2rem' | '12ch'`, a
percentage, `'3vw' | '6dvh'`, `'1fr'`, `'auto'` and the intrinsic keywords,
`calc()`, `min()`/`max()`/`clamp()`, a plugin's custom unit, or a function
`(ctx) => number`.

A `Len` parses once to an AST, which two backends compile: `toCSS` for the
common path and `toNumber` only when interaction needs a number. That is what
lets the browser own layout without duplicating the unit vocabulary.

**What a percentage resolves against** is the containing frame's content box on
the matching axis — or the visual viewport for `of: 'viewport'`, or an
element's border box for `of: <ref>`. A percentage against a container sized by
its own content is a cycle, reported as MK1004.

## Insets

A frame carries an ordered stack of *named* inset contributions:

```js
frame.insets.set('safe', 'env(safe-area-inset-*)');
frame.insets.set('chrome', { top: 48 });
```

They compose **by max per edge, not by sum** — two overlays each claiming 16px
from the bottom yield 16, not 32. An element opts out with `insets: false`, or
names the ones it wants with `insets: ['safe']`. One mechanism covers the
notch, the virtual keyboard, an app toolbar, and a docked region.

## Coordinate spaces

`viewport` · `document` · `layer` · `frame` · `element`. Conversions are
explicit: `Mutakit.convert(point, from, to, refs)`. Mutakit works entirely in
CSS pixels — device pixel ratio and browser zoom are deliberately not modelled,
and a plugin that needs device pixels reads `devicePixelRatio` itself and is
told when it changes by `metrics:change`.
