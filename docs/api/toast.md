# `toast`

> Generated from the prop schema. Edit `source/`, not this file.

**Version** 1.0.0 · **Origin** core · **Extends** `surface`

## Props

| Name | Type | Default | Constraints | Notes |
|---|---|---|---|---|
| `action` | `any` | — | — |  |
| `elevation` | `number` | `1` | min 0, max 3 |  |
| `hidden` | `boolean` | `false` | persisted |  |
| `label` | `string` | `` | — |  |
| `padding` | `len` | — | — |  |
| `scroll` | `none` · `auto` · `x` · `y` | `none` | — |  |
| `text` | `string` | `` | — |  |
| `ttl` | `number` | `6000` | — |  |
| `urgency` | `polite` · `assertive` | `polite` | — |  |
| `variant` | `info` · `success` · `warning` · `danger` | `info` | — |  |


## Events

- `dismiss`
- `action`

## Commands

- `dismiss()`

## Traits

_None._

## Accessibility

role `status`

## Layout

Children are governed by the `anchor` algorithm (§7).

Slots: `default`
