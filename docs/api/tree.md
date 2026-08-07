# `tree`

> Generated from the prop schema. Edit `source/`, not this file.

**Version** 1.0.0 · **Origin** core

## Props

| Name | Type | Default | Constraints | Notes |
|---|---|---|---|---|
| `data` | `array` | `undefined` | — |  |
| `expanded` | `string[]` | `undefined` | persisted |  |
| `label` | `string` | `` | — |  |
| `selected` | `string` | `` | persisted |  |


## Events

- `select`
- `expand`
- `collapse`

## Commands

- `toggle()`
- `select()`

## Traits

- `scrollable`

## Accessibility

role `tree`

## Layout

Children are governed by the `anchor` algorithm (§7).

