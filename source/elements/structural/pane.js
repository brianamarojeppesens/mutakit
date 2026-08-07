/**
 * Tier A structural elements (§11, §11.1) — the five types that ship in core.
 *
 * Every one of them registers through exactly the same public API a third
 * party uses (P3). If one of these needed something `mk.define()` cannot
 * express, that would be a hole in the contract, not a reason for a back door.
 */
import { css } from "../../styles/index.js";

/** `pane` — a rectangular region with a frame; the universal container. */
export const pane = {
  type: "pane",
  version: "1.0.0",
  props: {
    label: { type: "string", default: "" },
    hidden: { type: "boolean", default: false, persist: true },
    scroll: { type: "enum", values: ["none", "auto", "x", "y"], default: "none" },
    padding: { type: "len" }
  },
  algorithm: "anchor",
  a11y: { role: "group", props: { "aria-label": (ctx) => ctx.props.label || null } },
  slots: { default: {} },

  create(ctx) {
    return ctx.dom("div", null, null);
  },

  update(ctx, changed) {
    if (changed.has("hidden")) ctx.setState("hidden", ctx.props.hidden);
    if (changed.has("scroll")) applyScroll(ctx);
    if (changed.has("padding")) ctx.css({ "--mk-padding": lengthOf(ctx.props.padding) });
  },

  mount(ctx) {
    if (ctx.props.hidden) ctx.setState("hidden", true);
    if (ctx.props.scroll !== "none") applyScroll(ctx);
    if (ctx.props.padding != null) ctx.css({ "--mk-padding": lengthOf(ctx.props.padding) });
  },

  styles: css`
    .mk-pane {
      padding: var(--mk-padding, 0);
    }
    .mk-pane[data-mk-scroll] {
      overscroll-behavior: contain;
    }
  `
};

function applyScroll(ctx) {
  const mode = ctx.props.scroll;
  ctx.setState("scroll", mode === "none" ? false : mode);
  ctx.css({
    "--mk-overflow-x": mode === "auto" || mode === "x" ? "auto" : "hidden",
    "--mk-overflow-y": mode === "auto" || mode === "y" ? "auto" : "hidden"
  });
  if (ctx.el) {
    ctx.el.style.overflowX = mode === "auto" || mode === "x" ? "auto" : "";
    ctx.el.style.overflowY = mode === "auto" || mode === "y" ? "auto" : "";
  }
}

function lengthOf(value) {
  if (value == null) return null;
  return typeof value === "number" ? `${value}px` : String(value);
}

/**
 * `surface` — a styled, elevated container; the base most of the overlay
 * family extends. It is core rather than a plugin precisely because a base
 * type plugins inherit from must always be present (§4.2).
 */
export const surface = {
  type: "surface",
  version: "1.0.0",
  extends: "pane",
  props: {
    elevation: { type: "number", default: 1, min: 0, max: 3 },
    variant: { type: "enum", values: ["plain", "raised", "sunken"], default: "raised" }
  },
  a11y: { role: "group", props: { "aria-label": (ctx) => ctx.props.label || null } },

  mount(ctx) {
    applySurface(ctx);
  },

  update(ctx, changed) {
    if (changed.has("elevation") || changed.has("variant")) applySurface(ctx);
  },

  styles: css`
    .mk-surface {
      background: var(--mk-surface-bg, var(--mk-color-surface-raised));
      color: var(--mk-text-primary);
      border-radius: var(--mk-radius-md);
      box-shadow: var(--mk-surface-shadow, var(--mk-elevation-1));
    }
    .mk-surface[data-mk-variant="plain"] {
      --mk-surface-bg: transparent;
      --mk-surface-shadow: none;
    }
    .mk-surface[data-mk-variant="sunken"] {
      --mk-surface-bg: var(--mk-color-surface-sunken);
      --mk-surface-shadow: none;
    }
  `
};

function applySurface(ctx) {
  ctx.setState("variant", ctx.props.variant);
  ctx.css({
    "--mk-surface-shadow":
      ctx.props.elevation === 0 ? "none" : `var(--mk-elevation-${ctx.props.elevation})`
  });
}

/** `stack` — a row or column of children. The element form of §7.2. */
export const stack = {
  type: "stack",
  version: "1.0.0",
  props: {
    axis: { type: "enum", values: ["x", "y"], default: "y" },
    gap: { type: "len", default: 0 },
    align: { type: "enum", values: ["start", "center", "end", "stretch", "baseline"], default: "stretch" },
    justify: { type: "enum", values: ["start", "center", "end", "between", "around", "evenly"], default: "start" },
    wrap: { type: "boolean", default: false },
    reverse: { type: "boolean", default: false }
  },
  algorithm: "stack",
  a11y: { role: "group" },

  create(ctx) {
    ctx.node.algorithmOptions = optionsOf(ctx);
    return ctx.dom("div", null, null);
  },

  update(ctx) {
    ctx.node.algorithmOptions = optionsOf(ctx);
    ctx.invalidate("arrange");
  }
};

function optionsOf(ctx) {
  return {
    axis: ctx.props.axis,
    gap: ctx.props.gap,
    align: ctx.props.align,
    justify: ctx.props.justify,
    wrap: ctx.props.wrap,
    reverse: ctx.props.reverse
  };
}

/**
 * `group` — a virtual node with no DOM, for organizing the tree.
 *
 * Its children are appended to the group's own parent, so a group costs a node
 * and nothing else. Useful for keeping a serialized tree readable without
 * paying for a wrapper element.
 */
export const group = {
  type: "group",
  version: "1.0.0",
  virtual: true,
  props: { label: { type: "string", default: "" } },
  a11y: "presentation",

  create() {
    // Nothing. `virtual: true` tells the engine to leave `el` null and let the
    // children land in the nearest ancestor that has one.
    return null;
  }
};

/** `spacer` — a flexible gap. Six lines, as the contract promises (§8.1). */
export const spacer = {
  type: "spacer",
  version: "1.0.0",
  props: { size: { type: "len", default: "1fr" } },
  a11y: "presentation",
  geometry: { defaults: {} },

  create(ctx) {
    const el = ctx.dom("div", { "aria-hidden": "true" }, null);
    ctx.node.layoutProps.size = ctx.props.size;
    return el;
  }
};

/** Everything Tier A, in registration order (`surface` extends `pane`). */
export const CORE_ELEMENTS = [pane, surface, stack, group, spacer];
