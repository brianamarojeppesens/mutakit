# Build a game HUD (S3)

Dozens of elements pinned to viewport edges, updating at frame rate, with
gamepad navigation and no layout thrash.

```js
import { Mutakit } from 'mutakit/hud';

const app = Mutakit.mount(document.body, { sizing: 'viewport' });
const hud = app.create('hud-layer', { id: 'hud', spatial: true });

const health = Mutakit.signal(1);

hud.create('hud-bar',   { id: 'health', at: 'top-left',     inset: 16,
                          size: { w: 280, h: 20 }, value: health, variant: 'health' });
hud.create('minimap',   { id: 'map',    at: 'top-right',    inset: 16,
                          size: { w: '12gu', h: '12gu' } });
hud.create('crosshair', { id: 'reticle', at: 'center' });
hud.create('notification-feed', { id: 'feed', at: 'bottom-right', inset: 16,
                                  size: { w: 320 }, max: 5, ttl: 6000 });
```

Every element uses only `at` + `inset` + `size`. No manual arithmetic, correct
under window resize, and safe-area aware.

## The `gu` unit

`1gu = min(vw, vh) / 24`. One token scales the whole HUD with the viewport, and
it compiles to a CSS `min()` expression so the idle path runs no JavaScript at
all. It is registered through `mk.unit()` — the same extension point available
to any plugin.

## Why it stays fast

A value that changes every frame must never reach ARRANGE. `hud-bar` animates a
`scaleX` transform rather than a width; `hud-marker` writes its projection
directly in the `paint` hook. Both set only the `PAINT` bit, which skips the
layout pipeline entirely.

Measured: 100 animating elements at ~5.4 ms per frame, two custom-property
writes each.

## Accessibility, deliberately

`hud-*` types default to `a11y: 'presentation'` and `pointer-events: none` —
the right default for decoration, and an **explicit** exception to the
accessible-by-construction rule rather than an accidental one. `hud-bar` keeps
`role="meter"`, because a health bar carries information a player needs.

## Gamepad and spatial navigation

`spatial: true` opts the layer in. Focus then moves by *direction*: given a
direction and the focusable rects, the best candidate is chosen by alignment
overlap weighted above distance — a target directly ahead beats a nearer one off
to the side, which is what makes a grid of HUD buttons feel like a grid.

The gamepad source polls in the INPUT phase and arms the frame loop only while a
pad is connected, so an idle page stays at zero CPU.
