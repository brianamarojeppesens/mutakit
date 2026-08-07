# Layers and overlays

Named layers with reserved z-index bands eliminate z-index arithmetic:

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
| `devtools` | 900 | the inspector overlay |

Within a band, order is by insertion, with `bringToFront()` for floating
windows — and because that ordering is *within* the band, **a window can never
escape above a modal**, however many times it is clicked. That is exactly the
bug z-index arithmetic produces and bands prevent. Plugins register new layers
by name with a band, never by picking a number.

## Backdrops and scroll locks are reference counted

Three stacked modals produce **one** backdrop, positioned beneath the topmost.
Nested overlays neither double-lock scrolling nor prematurely unlock it.

## Anchored positioning

The `positioned` trait places against a reference, which may be a DOM element,
a Mutakit node, a static rect, or a **virtual reference** — `() => Rect`,
re-evaluated each frame. The virtual form is what makes cursor-following
tooltips and selection-range popovers expressible without a placeholder element
in the DOM.

Placement runs offset → flip → shift → size → arrow → hide, in that order.
Flipping after shifting produces a box that jitters between sides at the
boundary, which is why the order is fixed rather than incidental.
