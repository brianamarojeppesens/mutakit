# Recipes

Short answers to common shapes. Each is the whole solution, not a sketch.

## A resizable sidebar

```js
const [side, main] = app.split({ axis: 'x', panes: [
  { id: 'side', size: 260, min: 180, max: '40%', collapsible: { at: 100, to: 0 } },
  { id: 'main', size: '1fr' }
]});
```

## A command palette

```js
const palette = Mutakit.create('modal', {
  size: { w: 560, h: 'auto' }, at: 'top', inset: { top: 80 }, dismiss: 'light'
});
palette.create('combobox', { name: 'command', options: commands, placeholder: 'Type a command' });
mk.service('shortcuts').bind('Mod+K', () => palette.open(), { description: 'Command palette' });
```

## A toast queue

```js
function notify(text, variant = 'info') {
  return app.create('toast', { text, variant, ttl: 6000 });
}
```
Toasts stack in the `toast` band and announce through the shared live region
with de-duplication — you do not manage either.

## A context menu

```js
pane.on('contextmenu', (event) => {
  event.native.preventDefault();
  app.create('menu', {
    reference: { x: event.native.clientX, y: event.native.clientY, w: 0, h: 0 },
    items: [{ label: 'Cut' }, { label: 'Copy' }, { separator: true }, { label: 'Paste' }]
  });
});
```

## Dockable panels

```js
app.dock({
  regions: {
    top:    { size: 40,  id: 'menubar' },
    start:  { size: 260, id: 'explorer', resizable: true, collapsible: { at: 120 } },
    bottom: { size: 24,  id: 'statusbar' },
    center: { id: 'workspace' }
  }
});
```

## Things Mutakit deliberately does not ship

`avatar`, `badge`, `chip`, `skeleton`, `code`, `image`, `breadcrumb`,
`pagination`, `table` — all pure presentation with no dependency on the
geometry engine, the layer system, or the focus manager. Each is a styled
`<div>` you can write in ten lines, and shipping them would make Mutakit a
design system, which is an explicit non-goal.

Column resizing specifically is `split` applied to a header row, which you
already have.
