# `list`

> Generated from the prop schema. Edit `source/`, not this file.

**Version** 1.0.0 · **Origin** core

## Props

| Name | Type | Default | Constraints | Notes |
|---|---|---|---|---|
| `items` | `array` | `undefined` | — |  |
| `label` | `string` | `` | — |  |
| `rowHeight` | `number` | `28` | — |  |
| `selection` | `none` · `single` · `multiple` | `single` | — |  |
| `virtual` | `boolean` | `false` | — |  |


## Events

- `select`
- `activate`

## Commands

- `rendered()`

## Traits

- `scrollable`
- `selectable`

## Accessibility

role `listbox`

## Layout

Children are governed by the `anchor` algorithm (§7).

