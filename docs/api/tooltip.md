# `tooltip`

> Generated from the prop schema. Edit `source/`, not this file.

**Version** 1.0.0 · **Origin** core · **Extends** `popover`

## Props

| Name | Type | Default | Constraints | Notes |
|---|---|---|---|---|
| `arrow` | `boolean` | `false` | — |  |
| `delay` | `number` | `500` | — |  |
| `dismiss` | `light` · `modal` · `none` | `light` | — |  |
| `elevation` | `number` | `1` | min 0, max 3 |  |
| `flip` | `boolean` | `true` | — |  |
| `hidden` | `boolean` | `false` | persisted |  |
| `hideDelay` | `number` | `100` | — |  |
| `label` | `string` | `` | — |  |
| `offset` | `number` | `8` | — |  |
| `padding` | `len` | — | — |  |
| `placement` | `string` | `top` | — |  |
| `reference` | `any` | — | — |  |
| `scroll` | `none` · `auto` · `x` · `y` | `none` | — |  |
| `shift` | `boolean` | `true` | — |  |
| `text` | `string` | `` | — |  |
| `trapFocus` | `boolean` | `false` | — |  |
| `variant` | `plain` · `raised` · `sunken` | `raised` | — |  |


## Events

- `open`
- `close`

## Commands

- `close()`

## Traits

- `positioned`
- `dismissible`

## Accessibility

role `tooltip`

## Layout

Children are governed by the `anchor` algorithm (§7).

Slots: `default`
