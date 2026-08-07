# `split`

> Generated from the prop schema. Edit `source/`, not this file.

**Version** 1.0.0 · **Origin** core · **Extends** `pane`

## Props

| Name | Type | Default | Constraints | Notes |
|---|---|---|---|---|
| `axis` | `any` | `x` | persisted |  |
| `gutter` | `any` | `6` | — |  |
| `hidden` | `boolean` | `false` | persisted |  |
| `label` | `string` | `` | — |  |
| `live` | `boolean` | `true` | — |  |
| `padding` | `len` | — | — |  |
| `resizeMode` | `neighbor` · `distribute` · `push` | `neighbor` | — |  |
| `scroll` | `none` · `auto` · `x` · `y` | `none` | — |  |
| `step` | `number` | `8` | — |  |


## Events

- `resize`
- `collapse`
- `expand`

## Commands

- `sizes()`
- `reset()`

## Traits

_None._

## Accessibility

role `group`

## Layout

Children are governed by the `split` algorithm (§7).

Slots: `default`
