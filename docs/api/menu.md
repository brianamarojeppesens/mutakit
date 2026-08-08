# `menu`

> Generated from the prop schema. Edit `source/`, not this file.

**Version** 1.0.0 · **Origin** core · **Extends** `popover`

## Props

| Name | Type | Default | Constraints | Notes |
|---|---|---|---|---|
| `arrow` | `boolean` | `false` | — |  |
| `autoFocus` | `boolean` | `true` | — |  |
| `contextMode` | `boolean` | `false` | — |  |
| `dismiss` | `light` · `modal` · `none` | `light` | — |  |
| `elevation` | `number` | `1` | min 0, max 3 |  |
| `flip` | `boolean` | `true` | — |  |
| `hidden` | `boolean` | `false` | persisted |  |
| `items` | `array` | `undefined` | — |  |
| `label` | `string` | `` | — |  |
| `offset` | `number` | `8` | — |  |
| `padding` | `len` | — | — |  |
| `placement` | `string` | `bottom-start` | — |  |
| `reference` | `any` | — | — |  |
| `scroll` | `none` · `auto` · `x` · `y` | `none` | — |  |
| `shift` | `boolean` | `true` | — |  |
| `strategy` | `string` | — | — |  |
| `trapFocus` | `boolean` | `false` | — |  |
| `variant` | `plain` · `raised` · `sunken` | `raised` | — |  |


## Events

- `open`
- `close`
- `select`

## Commands

- `close()`
- `select()`
- `closeChain()`

## Traits

- `positioned`
- `dismissible`

## Accessibility

role `menu`

## Layout

Children are governed by the `anchor` algorithm (§7).

Slots: `default`
