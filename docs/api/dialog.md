# `dialog`

> Generated from the prop schema. Edit `source/`, not this file.

**Version** 1.0.0 · **Origin** core · **Extends** `modal`

## Props

| Name | Type | Default | Constraints | Notes |
|---|---|---|---|---|
| `actions` | `array` | `undefined` | — |  |
| `backdrop` | `boolean` | `true` | — |  |
| `description` | `string` | `` | — |  |
| `dismiss` | `light` · `modal` · `none` | `modal` | — |  |
| `elevation` | `number` | `1` | min 0, max 3 |  |
| `hidden` | `boolean` | `false` | persisted |  |
| `initialFocus` | `selector` | — | — |  |
| `label` | `string` | `` | — |  |
| `lockScroll` | `boolean` | `true` | — |  |
| `open` | `boolean` | `true` | persisted |  |
| `padding` | `len` | — | — |  |
| `scroll` | `none` · `auto` · `x` · `y` | `none` | — |  |
| `title` | `string` | `` | — |  |
| `variant` | `plain` · `raised` · `sunken` | `raised` | — |  |


## Events

- `open`
- `close`
- `beforeclose`
- `action`

## Commands

- `close()`
- `open()`
- `submit()`
- `cancel()`

## Traits

- `focus-trap`
- `dismissible`

## Accessibility

role `dialog`

## Layout

Children are governed by the `stack` algorithm (§7).

Slots: `default`, `header`, `body`, `footer`
