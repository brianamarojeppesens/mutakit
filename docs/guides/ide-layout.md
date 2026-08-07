# Build an IDE layout (S1)

The scenario: recursive split panes with draggable separators, minimum and
maximum sizes, collapse-to-edge, layout persisted across reloads, and keyboard
resizing. Runnable version: [`examples/ide-layout.html`](../../examples/ide-layout.html).

```js
import { Mutakit } from 'mutakit/dock';

const app = Mutakit.mount(document.body, { sizing: 'viewport' });

const [left, right] = app.split({
  axis: 'x',                                   // panes along x → a vertical bar
  gutter: { size: 6, draggable: true },
  panes: [
    { id: 'left',  size: 100, min: 64, max: '40%', collapsible: { at: 40, to: 0 } },
    { id: 'right', size: '1fr' }
  ]
});

const [stage, bottom] = right.split({
  axis: 'y',
  gutter: { size: 6, draggable: true },
  panes: [
    { id: 'stage',  size: '1fr' },
    { id: 'bottom', size: 150, min: 80, collapsible: { at: 40, to: 0 } }
  ]
});

Mutakit.persist('ide-layout', { allow: 'any' });
```

Twelve lines. Everything below is what you did not have to write.

## `axis`, not "vertical"

"Split vertically" is genuinely ambiguous — it can mean *the separator is
vertical* or *the split stacks vertically*. `axis: 'x'` says panes are
distributed along x, which is unambiguous. `'vertical'`/`'horizontal'` are
accepted as aliases describing the **separator**, and the development build
notes the interpretation once.

## What the drag costs

Almost nothing. A split compiles to CSS Grid with an explicit track list, and a
`neighbor` drag writes **one unclamped custom property per pointer move** — the
browser applies every bound, including the point at which a neighbour hits its
minimum and the gutter must stop.

`push`, and `distribute` against a finite `max`, compute in JavaScript, because
neither can be expressed as a track. Both are exceptions the design names
rather than discovers.

## Keyboard, for free

Every gutter is `role="separator"` with a live `aria-valuenow`, focusable, and
driven by arrows (`step`, default 8px), `Shift`+arrow (×5), `Home`/`End`, and
`Enter` to toggle collapse. Double-click toggles too.

## Persistence

`persist()` restores on call and saves on a debounced timer. A restore issued
before the first frame applies during that frame's ARRANGE, so a saved layout
never renders at its defaults and then visibly snaps.

Pane sizes key on `id` where present and fall back to a stable path key, so a
tree with no ids restores correctly as long as its shape is unchanged, and a
tree with ids survives being reordered.
