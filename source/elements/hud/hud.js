/**
 * The HUD and game family (§11.5) — S3.
 *
 * These exist to prove the extension points and because S3 is a first-class
 * scenario, not an afterthought. Two rules govern the whole family:
 *
 * `hud-*` types default to `a11y: 'presentation'` and `pointer-events: none`.
 * That is the **correct default for decorative overlays** and an explicit
 * exception to P5 rather than an accidental one — an interactive HUD element
 * opts back in and declares its semantics.
 *
 * Everything that moves every frame sets **only `PAINT`** (§6.2), which writes
 * a transform and never touches the layout pipeline. That fast path is what
 * makes a hundred animating elements affordable, and the benchmark in
 * `test/bench/` is what keeps it honest.
 */
import "../../core/dev.js";
import * as dom from "../../core/dom.js";
import { css } from "../../styles/index.js";
import { PAINT } from "../../engine/invalidate.js";

/**
 * `hud-layer` — a full-viewport, pointer-transparent layer with safe-area
 * insets applied.
 */
export const hudLayer = {
  type: "hud-layer",
  version: "1.0.0",
  layer: "hud",
  algorithm: "anchor",
  props: {
    interactive: { type: "boolean", default: false },
    spatial: { type: "boolean", default: false }
  },
  a11y: "presentation",
  geometry: { defaults: { left: 0, top: 0, right: 0, bottom: 0, of: "viewport", insets: ["safe"] } },

  create(ctx) {
    return ctx.dom("div", { class: "mk-hud-layer" }, null);
  },

  mount(ctx) {
    const layers = ctx.service("layers");
    if (layers) {
      layers.add(ctx.node, "hud");
      ctx.own(() => layers.remove(ctx.node));
    }
    if (ctx.props.interactive) ctx.el.style.pointerEvents = "auto";
    // Spatial navigation is opt-in per container (§13.6): a HUD is exactly the
    // case for it, and a form is exactly not.
    if (ctx.props.spatial) {
      const spatial = ctx.service("spatial");
      if (spatial) ctx.own(spatial.enable(ctx.node));
    }
  },

  styles: css`
    .mk-hud-layer { pointer-events: none; }
    .mk-hud-layer > .mk-node { pointer-events: none; }
    .mk-hud-layer [data-mk-interactive] { pointer-events: auto; }
  `
};

/**
 * `hud-bar` — a value bar with an animated fill and damage ghosting.
 *
 * The ghost is the point: a health bar that drops instantly tells you the
 * number, and one that leaves a trailing bar tells you *how much you just
 * lost*, which is the information the player actually wants.
 */
export const hudBar = {
  type: "hud-bar",
  version: "1.0.0",
  props: {
    value: { type: "number", default: 1, min: 0, max: 1 },
    variant: { type: "enum", values: ["health", "mana", "stamina", "xp"], default: "health" },
    ghost: { type: "boolean", default: true },
    ghostDelay: { type: "number", default: 400 },
    label: { type: "string", default: "" }
  },
  events: ["change"],
  /**
   * Not `presentation`: a health bar carries information a player relying on a
   * screen reader needs. The opt-out is for decoration, not for anything that
   * means something.
   */
  a11y: {
    role: "meter",
    props: {
      "aria-valuenow": (ctx) => Math.round(ctx.props.value * 100),
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-label": (ctx) => ctx.props.label || ctx.props.variant
    }
  },
  geometry: { defaults: { size: { w: 280, h: 20 } } },

  create(ctx) {
    const el = ctx.dom("div", { class: "mk-hud-bar" }, null);
    ctx.state.ghost = dom.el("span", { class: "mk-hud-bar__ghost", "aria-hidden": "true" }, el);
    ctx.state.fill = dom.el("span", { class: "mk-hud-bar__fill", "aria-hidden": "true" }, el);
    ctx.state.ghostValue = ctx.props.value;
    applyBar(ctx);
    return el;
  },

  update(ctx, changed) {
    if (!changed.has("value")) return;
    if (ctx.props.ghost && ctx.props.value < ctx.state.ghostValue) {
      if (ctx.state.ghostTimer) ctx.state.ghostTimer();
      ctx.state.ghostTimer = ctx.own(
        dom.timer(() => {
          ctx.state.ghostValue = ctx.props.value;
          applyBar(ctx);
        }, ctx.props.ghostDelay)
      );
    } else {
      ctx.state.ghostValue = ctx.props.value;
    }
    applyBar(ctx);
    ctx.emit("change", { value: ctx.props.value });
  },

  styles: css`
    .mk-hud-bar {
      /*
       * No position declaration here. The fill and ghost need a containing
       * block, and an absolutely positioned box establishes one exactly as a
       * relative box does — so declaring relative bought nothing and cost the
       * layout: it beat the base stylesheet's absolute positioning on .mk-node,
       * and a relative box offsets from where *flow* put it. With ninety bars
       * in one anchor parent those offsets compounded and the whole row was
       * pushed off the bottom of the viewport, engine-correct geometry and all.
       *
       * This is the same defect the guard in layout/anchor.js was written to
       * fix, reintroduced one layer further out. The engine decides whether a
       * node is absolute or in flow; an element stylesheet must not.
       */
      overflow: hidden;
      background: var(--mk-hud-bar-track, rgb(0 0 0 / 0.5));
      border-radius: var(--mk-radius-sm);
    }
    .mk-hud-bar__fill, .mk-hud-bar__ghost {
      position: absolute;
      inset: 0;
      transform-origin: left center;
      /* scaleX, not width: a transform is compositable and never reflows. */
      transform: scaleX(var(--mk-hud-fill, 1));
    }
    .mk-hud-bar__ghost {
      background: var(--mk-hud-bar-ghost, rgb(255 255 255 / 0.45));
      transform: scaleX(var(--mk-hud-ghost, 1));
      transition: transform var(--mk-dur-slow) var(--mk-ease-out);
    }
    .mk-hud-bar__fill { background: var(--mk-hud-bar-fill, var(--mk-color-danger)); }
    .mk-hud-bar[data-mk-variant="mana"] { --mk-hud-bar-fill: var(--mk-blue-500); }
    .mk-hud-bar[data-mk-variant="stamina"] { --mk-hud-bar-fill: var(--mk-green-500); }
    .mk-hud-bar[data-mk-variant="xp"] { --mk-hud-bar-fill: var(--mk-amber-500); }
    @media (prefers-reduced-motion: reduce) {
      .mk-hud-bar__ghost { transition: none; }
    }
  `
};

function applyBar(ctx) {
  ctx.setState("variant", ctx.props.variant);
  // STYLE only: a bar that changes sixty times a second must never reach
  // ARRANGE, and a scale transform is why it does not have to.
  ctx.css({
    "--mk-hud-fill": String(clamp01(ctx.props.value)),
    "--mk-hud-ghost": String(clamp01(ctx.state.ghostValue))
  });
}

function clamp01(value) {
  return Math.min(Math.max(value || 0, 0), 1);
}

/**
 * `hud-marker` — a world-space marker projected to screen, with edge clamping
 * and an arrow.
 *
 * The projection runs in `paint`, so a marker following a moving object costs
 * one transform write per frame and no layout at all.
 */
export const hudMarker = {
  type: "hud-marker",
  version: "1.0.0",
  props: {
    /** `(ctx) => ({ x, y, visible })` in the layer's space. */
    project: { type: "function" },
    label: { type: "string", default: "" },
    clampToEdge: { type: "boolean", default: true },
    margin: { type: "number", default: 24 }
  },
  a11y: "presentation",
  geometry: { defaults: { size: { w: 24, h: 24 }, at: "top-left" } },

  create(ctx) {
    const el = ctx.dom("div", { class: "mk-hud-marker" }, null);
    ctx.state.arrow = dom.el("span", { class: "mk-hud-marker__arrow", "aria-hidden": "true" }, el);
    if (ctx.props.label) dom.el("span", { class: "mk-hud-marker__label", text: ctx.props.label }, el);
    return el;
  },

  mount(ctx) {
    // Arming PAINT every frame is what keeps this on the fast path: the
    // scheduler runs `paint` and nothing else for this node.
    ctx.state.tick = () => {
      ctx.node.flags |= PAINT;
      ctx.mk.scheduler.arm();
    };
    ctx.state.tick();
  },

  paint(ctx) {
    const project = ctx.props.project;
    if (typeof project !== "function") return;
    const point = project(ctx);
    if (!point) return;

    const frame = ctx.node.parent ? ctx.node.parent.frame : { x: 0, y: 0, w: 0, h: 0 };
    const margin = ctx.props.margin;
    let { x, y } = point;
    let clamped = false;

    if (ctx.props.clampToEdge) {
      const nx = Math.min(Math.max(x, margin), Math.max(margin, frame.w - margin));
      const ny = Math.min(Math.max(y, margin), Math.max(margin, frame.h - margin));
      clamped = nx !== x || ny !== y;
      x = nx;
      y = ny;
    }

    // Written directly, not staged: PAINT runs *after* WRITE (§6.3), so a
    // staged state flag would land a frame late — and a frame late on a marker
    // that moves every frame is a marker whose arrow points the wrong way.
    ctx.el.toggleAttribute("data-mk-offscreen", clamped);
    if (clamped) {
      const angle = Math.atan2(point.y - y, point.x - x) * (180 / Math.PI);
      ctx.state.arrow.style.transform = `rotate(${angle.toFixed(1)}deg)`;
    }
    // A transform, never `--mk-x`/`--mk-y`: PAINT must not touch geometry.
    ctx.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    ctx.state.tick();
  },

  styles: css`
    .mk-hud-marker {
      left: 0;
      top: 0;
      will-change: transform;
      display: grid;
      place-items: center;
    }
    .mk-hud-marker__arrow { display: none; width: 0; height: 0;
      border: 6px solid transparent; border-left-color: currentColor; }
    .mk-hud-marker[data-mk-offscreen] .mk-hud-marker__arrow { display: block; }
    .mk-hud-marker[data-mk-offscreen] .mk-hud-marker__label { display: none; }
  `
};

/** `crosshair` — a centred reticle with state variants. */
export const crosshair = {
  type: "crosshair",
  version: "1.0.0",
  props: {
    state: { type: "enum", values: ["idle", "target", "hit", "reload"], default: "idle" }
    // No `size` prop. It was declared as a number, never read by `create` or
    // `update`, and contradicted this type's own geometry default of
    // `{ w: 24, h: 24 }` — a declared prop wins the name over geometry, so the
    // universal `size: { w, h }` was validated as a number and threw. A
    // crosshair sizes itself the way every other element does.
  },
  a11y: "presentation",
  geometry: { defaults: { at: "center", size: { w: 24, h: 24 } } },
  create(ctx) {
    const el = ctx.dom("div", { class: "mk-crosshair" }, null);
    ctx.setState("state", ctx.props.state);
    return el;
  },
  update(ctx, changed) {
    if (changed.has("state")) ctx.setState("state", ctx.props.state);
  },
  styles: css`
    .mk-crosshair {
      border: 2px solid var(--mk-crosshair-color, rgb(255 255 255 / 0.85));
      border-radius: 50%;
      transition: transform var(--mk-dur-fast) var(--mk-ease-out);
    }
    .mk-crosshair[data-mk-state="target"] { --mk-crosshair-color: var(--mk-color-warning); }
    .mk-crosshair[data-mk-state="hit"] { --mk-crosshair-color: var(--mk-color-danger);
      transform: scale(1.25); }
  `
};

/** `minimap` — a container with a rotation/pan/zoom transform for a map. */
export const minimap = {
  type: "minimap",
  version: "1.0.0",
  props: {
    zoom: { type: "number", default: 1, min: 0.1 },
    rotation: { type: "number", default: 0 },
    center: { type: "object", default: () => ({ x: 0, y: 0 }) }
  },
  a11y: "presentation",
  geometry: { defaults: { size: { w: 160, h: 160 } } },

  create(ctx) {
    const el = ctx.dom("div", { class: "mk-minimap" }, null);
    const plane = dom.el("div", { class: "mk-minimap__plane" }, el);
    ctx.node.contentEl = plane;
    ctx.state.plane = plane;
    applyMinimap(ctx);
    return el;
  },

  update(ctx, changed) {
    if (changed.has("zoom") || changed.has("rotation") || changed.has("center")) applyMinimap(ctx);
  },

  styles: css`
    .mk-minimap {
      overflow: hidden;
      border-radius: 50%;
      background: var(--mk-minimap-bg, rgb(0 0 0 / 0.5));
    }
    .mk-minimap__plane {
      width: 100%;
      height: 100%;
      transform-origin: center;
      /* One transform for the whole plane: panning a map of five hundred
         markers costs one write, not five hundred (§7.7). */
      transform: translate(var(--mk-map-x, 0px), var(--mk-map-y, 0px))
                 rotate(var(--mk-map-rotate, 0deg))
                 scale(var(--mk-map-zoom, 1));
      will-change: transform;
    }
  `
};

function applyMinimap(ctx) {
  ctx.css({
    "--mk-map-x": `${-(ctx.props.center.x || 0)}px`,
    "--mk-map-y": `${-(ctx.props.center.y || 0)}px`,
    "--mk-map-rotate": `${ctx.props.rotation || 0}deg`,
    "--mk-map-zoom": String(ctx.props.zoom || 1)
  });
}

/** `notification-feed` — an append-only, auto-expiring column (a kill feed). */
export const notificationFeed = {
  type: "notification-feed",
  version: "1.0.0",
  props: {
    max: { type: "number", default: 5 },
    ttl: { type: "number", default: 6000 },
    announce: { type: "boolean", default: false }
  },
  events: ["push", "expire"],
  a11y: "presentation",
  geometry: { defaults: { at: "bottom-right", inset: 16, size: { w: 320, h: "auto" } } },

  commands: {
    push(ctx, message) {
      const item = dom.el("li", { class: "mk-feed__item", text: String(message) }, ctx.state.list);
      ctx.state.items.push(item);
      while (ctx.state.items.length > ctx.props.max) {
        const oldest = ctx.state.items.shift();
        dom.remove(oldest);
      }
      if (ctx.props.ttl > 0) {
        ctx.own(
          dom.timer(() => {
            const index = ctx.state.items.indexOf(item);
            if (index !== -1) ctx.state.items.splice(index, 1);
            dom.remove(item);
            ctx.emit("expire", { message });
          }, ctx.props.ttl)
        );
      }
      // Off by default: a kill feed announced aloud is unusable. Opt in for
      // feeds that carry information a player needs rather than flavour.
      if (ctx.props.announce) ctx.announce(String(message), "polite");
      ctx.emit("push", { message });
      return item;
    }
  },

  create(ctx) {
    const el = ctx.dom("div", { class: "mk-feed" }, null);
    ctx.state.list = dom.el("ul", { class: "mk-feed__list", role: "list" }, el);
    ctx.state.items = [];
    return el;
  },

  styles: css`
    .mk-feed__list { margin: 0; padding: 0; list-style: none; display: flex;
      flex-direction: column; gap: 4px; }
    .mk-feed__item {
      padding: 4px 8px;
      background: rgb(0 0 0 / 0.5);
      color: #fff;
      border-radius: var(--mk-radius-sm);
      font-size: var(--mk-text-sm);
    }
  `
};

/** `key-prompt` — a glyph that follows the active input scheme. */
export const keyPrompt = {
  type: "key-prompt",
  version: "1.0.0",
  props: {
    action: { type: "string", default: "" },
    keyboard: { type: "string", default: "" },
    gamepad: { type: "string", default: "" },
    scheme: { type: "enum", values: ["auto", "keyboard", "gamepad"], default: "auto" }
  },
  a11y: { role: "img", props: { "aria-label": (ctx) => ctx.props.action || null } },
  geometry: { defaults: { size: { w: "auto", h: "auto" } } },

  create(ctx) {
    const el = ctx.dom("kbd", { class: "mk-key-prompt" }, null);
    ctx.state.render = () => {
      const scheme =
        ctx.props.scheme !== "auto"
          ? ctx.props.scheme
          : ctx.mk.metrics.current.lastInput === "gamepad"
            ? "gamepad"
            : "keyboard";
      dom.setText(el, scheme === "gamepad" ? ctx.props.gamepad : ctx.props.keyboard);
      ctx.setState("scheme", scheme);
    };
    ctx.state.render();
    return el;
  },

  update(ctx) {
    ctx.state.render();
  },

  styles: css`
    .mk-key-prompt {
      display: inline-block;
      padding: 1px 6px;
      border: 1px solid currentColor;
      border-radius: 3px;
      font-family: var(--mk-font-mono);
      font-size: var(--mk-text-sm);
    }
  `
};

export const HUD_ELEMENTS = [
  hudLayer, hudBar, hudMarker, crosshair, minimap, notificationFeed, keyPrompt
];

/**
 * The `gu` unit (§10.4) — the worked example the plan names.
 *
 * `1gu = min(vw, vh) / 24`, which lets a whole HUD scale with the viewport
 * through one token. It is registered as a *plugin* unit rather than built in,
 * because it is an example of the extension point, not part of the vocabulary.
 */
export const gridUnit = {
  toNumber(value, ctx) {
    const metrics = ctx.metrics || {};
    return (value * Math.min(metrics.vw || 0, metrics.vh || 0)) / 24;
  },
  /** CSS can express it exactly, so the idle path stays free of JavaScript. */
  toCSS(value) {
    return `calc(${value} * min(100vw, 100vh) / 24)`;
  },
  basis: "viewport"
};
