# `window`

> Generated from the prop schema. Edit `source/`, not this file.

**Version** 1.0.0 · **Origin** core · **Extends** `surface`

## Props

| Name | Type | Default | Constraints | Notes |
|---|---|---|---|---|
| `closable` | `boolean` | `true` | — |  |
| `elevation` | `number` | `1` | min 0, max 3 |  |
| `hidden` | `boolean` | `false` | persisted |  |
| `label` | `string` | `` | — |  |
| `minimizable` | `boolean` | `false` | — |  |
| `minimized` | `boolean` | `false` | persisted |  |
| `padding` | `len` | — | — |  |
| `scroll` | `none` · `auto` · `x` · `y` | `none` | — |  |
| `title` | `string` | `` | — |  |
| `variant` | `plain` · `raised` · `sunken` | `raised` | — |  |


## Events

- `close`
- `minimize`
- `restore`
- `focus`

## Commands

- `close()`
- `minimize()`
- `bringToFront()`

## Traits

- `draggable`
- `resizable`

## Accessibility

role `dialog`

## Layout

Children are governed by the `anchor` algorithm (§7).

Slots: `default`
