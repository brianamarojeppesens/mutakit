# The frame loop

One `requestAnimationFrame` callback runs strictly ordered phases:

```
1. INPUT     drain pointer/key/gamepad queues; update gesture state machines
2. STATE     flush signals; run effects and update() callbacks (max 8 passes)
3. READ      take the MetricsSnapshot; measure everything with MEASURE set
4. ARRANGE   resolve geometry (pure computation)
5. WRITE     apply CSS custom properties, inline styles, transforms
6. PAINT     post-write hooks: canvas draws, projections, animation ticks
7. IDLE      nothing dirty → unschedule the loop entirely
```

**Phase 7 matters as much as the other six.** An idle layout consumes zero CPU:
the loop unschedules itself and re-arms on the next invalidation. `mk.tick()`
forces a synchronous flush, which is what tests use.

## Four dirty bits

| Bit | Meaning | Propagation |
|---|---|---|
| `STYLE` | visual only | self |
| `MEASURE` | intrinsic size may have changed | up to the nearest fixed-size ancestor |
| `ARRANGE` | children must be re-placed | down the subtree |
| `PAINT` | transform/opacity only | self; skips layout entirely |

The `PAINT` fast path is what makes a hundred animating HUD elements
affordable. Measured: ~5.4 ms per frame for 100 elements, two custom-property
writes each, no layout.

**A node's box belongs to its parent.** `ARRANGE` propagates downward, so
re-constraining an element invalidates the *parent* — the one whose algorithm
can act on it.

## Two reentrancy rules

Setting a dirty bit during `WRITE` schedules the *next* frame; it never extends
the current one. Reading resolved geometry during `WRITE` reports MK3015 in the
development build. Together these make layout thrash structurally impossible
rather than merely discouraged.

## When STATE does not settle

After eight passes the frame stops and defers the rest, reporting MK5003 with
what is oscillating. A runaway effect degrades to a janky UI, never a frozen
tab.
