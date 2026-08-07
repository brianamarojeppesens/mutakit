/**
 * `draggable` and `collapsible` (§9).
 *
 * Both write geometry, so both are subject to §9.1's arbitration rule: **the
 * parent's layout algorithm owns a child's box, unless that child declares
 * `positioning: 'self'`.** `draggable` sets that automatically when it
 * attaches, which is why dragging simply works under `anchor` and `free` and
 * reports MK2011 under `stack`, `split`, `grid`, and `dock` — where a
 * self-positioning child is a contradiction rather than a preference to be
 * guessed at.
 */
import "../core/dev.js";
import * as dom from "../core/dom.js";
const { listen } = dom;
import { warn } from "../core/diagnostics.js";

/** Algorithms that place children in flow and therefore own their boxes. */
const FLOW_OWNING = new Set(["stack", "split", "grid", "dock", "flow"]);

export const draggable = {
  name: "draggable",
  version: "1.0.0",
  requires: ["focusable"],
  events: ["dragstart", "drag", "dragend"],

  /** Mandatory for a pointer trait (P5): arrows move, Escape cancels. */
  keys: {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    Escape: "cancel"
  },

  attach(ctx, options) {
    const opts = options || {};
    if (!arbitrate(ctx)) return {};

    ctx.node.positioning = "self";
    const state = { active: null };

    const el = handleElement(ctx, opts.handle);
    if (!el) return {};
    el.style.touchAction = touchActionFor(opts.axis);

    ctx.own(listen(el, "pointerdown", (event) => start(ctx, state, opts, event)));
    ctx.own(listen(el, "pointermove", (event) => move(ctx, state, opts, event)));
    ctx.own(listen(el, "pointerup", (event) => end(ctx, state, event)));
    ctx.own(listen(el, "pointercancel", () => cancel(ctx, state)));
    ctx.own(listen(ctx.el, "keydown", (event) => onKey(ctx, state, opts, event)));

    return {
      /** Begin a drag programmatically, from a menu command or a test. */
      startDrag(at) {
        state.active = {
          origin: at || { x: 0, y: 0 },
          from: { x: ctx.node.computed.x, y: ctx.node.computed.y }
        };
        ctx.setState("dragging", true);
        ctx.emit("dragstart", { x: state.active.from.x, y: state.active.from.y });
      },
      cancelDrag() {
        cancel(ctx, state);
      },
      get dragging() {
        return !!state.active;
      }
    };
  },

  detach(ctx) {
    ctx.setState("dragging", false);
  }
};

/**
 * §9.1's rule, applied at attach time so the message arrives when the author
 * writes the code rather than when the element jitters.
 */
function arbitrate(ctx) {
  const parent = ctx.node.parent;
  const algorithm = parent && parent.algorithm;
  if (!algorithm || !FLOW_OWNING.has(algorithm)) return true;
  warn("MK2011", __MK_DEV__ &&
    `'${ctx.node.type}' is draggable inside a '${algorithm}' parent, which computes a ` +
      `track for it. Two real fixes: use the \`sortable\` trait to reorder *within* the ` +
      `flow, or move the child into a \`free\`/\`anchor\` parent to move it *freely*.` +
      (algorithm === "split" ? " A pane inside a split is resized by its gutters." : ""),
    { subject: ctx.node.toString() }
  );
  return false;
}

function handleElement(ctx, selector) {
  if (!selector) return ctx.el;
  if (typeof selector === "string") return ctx.el.querySelector(selector) || ctx.el;
  return selector;
}

/**
 * Hand the scroll-versus-drag decision to the browser's compositor rather than
 * racing it on the main thread (§13.3): `touch-action` is set to the
 * complement of the drag axis.
 */
function touchActionFor(axis) {
  if (axis === "x") return "pan-y";
  if (axis === "y") return "pan-x";
  return "none";
}

function start(ctx, state, opts, event) {
  if (event.button !== 0) return;
  event.preventDefault();
  ctx.el.setPointerCapture(event.pointerId);
  state.active = {
    pointerId: event.pointerId,
    origin: { x: event.clientX, y: event.clientY },
    from: { x: ctx.node.computed.x, y: ctx.node.computed.y }
  };
  ctx.setState("dragging", true);
  ctx.emit("dragstart", { ...state.active.from, native: event });
}

function move(ctx, state, opts, event) {
  if (!state.active || event.pointerId !== state.active.pointerId) return;
  const dx = opts.axis === "y" ? 0 : event.clientX - state.active.origin.x;
  const dy = opts.axis === "x" ? 0 : event.clientY - state.active.origin.y;
  apply(ctx, state, opts, state.active.from.x + dx, state.active.from.y + dy, event);
}

function apply(ctx, state, opts, x, y, native) {
  let nextX = x;
  let nextY = y;

  if (opts.grid) {
    const stepX = typeof opts.grid === "number" ? opts.grid : opts.grid.x || 0;
    const stepY = typeof opts.grid === "number" ? opts.grid : opts.grid.y || 0;
    if (stepX) nextX = Math.round(nextX / stepX) * stepX;
    if (stepY) nextY = Math.round(nextY / stepY) * stepY;
  }

  const bounds = boundsOf(ctx, opts);
  if (bounds) {
    nextX = Math.min(Math.max(nextX, bounds.x), bounds.x + bounds.w - ctx.node.computed.w);
    nextY = Math.min(Math.max(nextY, bounds.y), bounds.y + bounds.h - ctx.node.computed.h);
  }

  ctx.constrain({ left: nextX, top: nextY, at: undefined, anchor: undefined });
  ctx.emit("drag", { x: nextX, y: nextY, native: native || null });
}

function boundsOf(ctx, opts) {
  if (opts.bounds === false) return null;
  const parent = ctx.node.parent;
  if (!parent) return null;
  if (opts.bounds && typeof opts.bounds === "object") return opts.bounds;
  return { x: 0, y: 0, w: parent.frame.w, h: parent.frame.h };
}

function end(ctx, state, event) {
  if (!state.active || event.pointerId !== state.active.pointerId) return;
  state.active = null;
  ctx.setState("dragging", false);
  ctx.emit("dragend", { x: ctx.node.computed.x, y: ctx.node.computed.y, cancelled: false });
}

function cancel(ctx, state) {
  if (!state.active) return;
  const { from } = state.active;
  state.active = null;
  ctx.constrain({ left: from.x, top: from.y });
  ctx.setState("dragging", false);
  ctx.emit("dragend", { ...from, cancelled: true });
}

/** The keyboard equivalent. Not optional, and not an afterthought (P5). */
function onKey(ctx, state, opts, event) {
  const step = event.shiftKey ? 10 : 1;
  const map = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step]
  };
  if (event.key === "Escape") {
    cancel(ctx, state);
    return;
  }
  const move = map[event.key];
  if (!move) return;
  if (opts.axis === "x" && move[1]) return;
  if (opts.axis === "y" && move[0]) return;
  event.preventDefault();
  apply(ctx, state, opts, ctx.node.computed.x + move[0], ctx.node.computed.y + move[1], event);
  ctx.emit("dragend", { x: ctx.node.computed.x, y: ctx.node.computed.y, cancelled: false });
}

/**
 * `collapsible` (§9) — collapse and expand with size memory.
 *
 * The memory is the point: a pane restored from collapse returns to where it
 * was, not to a default, which is what makes the gutter's double-click feel
 * like a toggle rather than a reset.
 */
export const collapsible = {
  name: "collapsible",
  version: "1.0.0",
  events: ["collapse", "expand"],
  keys: { Enter: "toggle", " ": "toggle" },

  attach(ctx, options) {
    const opts = options || {};
    const axis = opts.axis || "y";

    const api = {
      get collapsed() {
        return !!ctx.node.layoutProps.collapsed;
      },
      collapse() {
        if (api.collapsed) return;
        const size = axis === "x" ? ctx.node.computed.w : ctx.node.computed.h;
        ctx.node.state.restoreSize = size;
        ctx.mk.setLayoutProps(ctx.node, { collapsed: true });
        ctx.setState("collapsed", true);
        ctx.emit("collapse", { restoreSize: size });
      },
      expand() {
        if (!api.collapsed) return;
        ctx.mk.setLayoutProps(ctx.node, {
          collapsed: false,
          size: ctx.node.state.restoreSize != null ? ctx.node.state.restoreSize : opts.to || 200
        });
        ctx.setState("collapsed", false);
        ctx.emit("expand", {});
      },
      toggle() {
        if (api.collapsed) api.expand();
        else api.collapse();
      }
    };

    if (ctx.node.layoutProps.collapsed) ctx.setState("collapsed", true);
    return api;
  },

  detach(ctx) {
    // Nothing is owned here beyond the state flag, but the hook exists rather
    // than being absent: the conformance check reads a missing `detach` as an
    // unanswered question about cleanup, and it is right to.
    ctx.setState("collapsed", null);
  }
};

/**
 * `resizable` (§9) — eight handles, aspect lock, min/max, keyboard resize.
 *
 * Subject to the same arbitration rule as `draggable` (§9.1): a pane inside a
 * split is resized by its gutters, not by corner handles, and attaching this
 * there reports MK2011 with a pointer to `split`'s own `min`/`max`.
 */
export const resizable = {
  name: "resizable",
  version: "1.0.0",
  requires: ["focusable"],
  events: ["resizestart", "resize", "resizeend"],
  keys: {
    "Shift+ArrowLeft": "narrower",
    "Shift+ArrowRight": "wider",
    "Shift+ArrowUp": "shorter",
    "Shift+ArrowDown": "taller"
  },

  attach(ctx, options) {
    const opts = options || {};
    if (!arbitrate(ctx)) return {};
    ctx.node.positioning = "self";

    const handles = opts.handles || ["n", "e", "s", "w", "ne", "se", "sw", "nw"];
    const state = { active: null };

    for (const direction of handles) {
      const handle = ctx.dom("span", {
        class: `mk-resize-handle mk-resize-handle--${direction}`,
        "data-mk-handle": direction,
        "aria-hidden": "true"
      });
      ctx.own(dom.listen(handle, "pointerdown", (event) => startResize(ctx, state, opts, direction, event)));
    }

    ctx.own(dom.listen(ctx.el, "pointermove", (event) => moveResize(ctx, state, opts, event)));
    ctx.own(dom.listen(ctx.el, "pointerup", () => endResize(ctx, state)));
    ctx.own(dom.listen(ctx.el, "pointercancel", () => endResize(ctx, state, true)));
    ctx.own(dom.listen(ctx.el, "keydown", (event) => onResizeKey(ctx, opts, event)));

    return {
      get resizing() {
        return !!state.active;
      },
      resizeBy(dw, dh) {
        applyResize(ctx, opts, ctx.node.computed.w + dw, ctx.node.computed.h + dh);
      }
    };
  }
};

function startResize(ctx, state, opts, direction, event) {
  event.preventDefault();
  event.stopPropagation();
  event.target.setPointerCapture(event.pointerId);
  state.active = {
    direction,
    pointerId: event.pointerId,
    origin: { x: event.clientX, y: event.clientY },
    from: { ...ctx.node.computed }
  };
  ctx.setState("resizing", true);
  ctx.emit("resizestart", { direction });
}

function moveResize(ctx, state, opts, event) {
  if (!state.active) return;
  const { direction, origin, from } = state.active;
  const dx = event.clientX - origin.x;
  const dy = event.clientY - origin.y;

  let w = from.w + (direction.includes("e") ? dx : direction.includes("w") ? -dx : 0);
  let h = from.h + (direction.includes("s") ? dy : direction.includes("n") ? -dy : 0);
  let x = from.x + (direction.includes("w") ? dx : 0);
  let y = from.y + (direction.includes("n") ? dy : 0);

  if (opts.aspect) {
    // Aspect lock follows whichever axis moved further, so the box never
    // fights the pointer.
    const ratio = typeof opts.aspect === "number" ? opts.aspect : from.w / from.h;
    if (Math.abs(dx) > Math.abs(dy)) h = w / ratio;
    else w = h * ratio;
  }

  const bounded = applyResize(ctx, opts, w, h);
  ctx.constrain({
    left: direction.includes("w") ? x + (w - bounded.w) : from.x,
    top: direction.includes("n") ? y + (h - bounded.h) : from.y
  });
  ctx.emit("resize", { ...bounded, direction });
}

function applyResize(ctx, opts, w, h) {
  const min = opts.min || {};
  const max = opts.max || {};
  const width = Math.min(Math.max(w, min.w == null ? 32 : min.w), max.w == null ? Infinity : max.w);
  const height = Math.min(Math.max(h, min.h == null ? 32 : min.h), max.h == null ? Infinity : max.h);
  ctx.constrain({ width, height, size: undefined });
  return { w: width, h: height };
}

function endResize(ctx, state, cancelled) {
  if (!state.active) return;
  const { from } = state.active;
  state.active = null;
  ctx.setState("resizing", false);
  if (cancelled) ctx.constrain({ width: from.w, height: from.h, left: from.x, top: from.y });
  ctx.emit("resizeend", { cancelled: !!cancelled });
}

/** The keyboard equivalent: Shift+arrows resize by a step. */
function onResizeKey(ctx, opts, event) {
  if (!event.shiftKey) return;
  const step = opts.step || 16;
  const map = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step]
  };
  const move = map[event.key];
  if (!move) return;
  event.preventDefault();
  applyResize(ctx, opts, ctx.node.computed.w + move[0], ctx.node.computed.h + move[1]);
  ctx.emit("resizeend", { cancelled: false });
}

/** Handles are drawn by CSS; the trait only listens. */
export const RESIZE_HANDLE_CSS = `
  .mk-resize-handle { position: absolute; width: 8px; height: 8px; z-index: 2; }
  .mk-resize-handle--n { top: -4px; left: 8px; right: 8px; width: auto; cursor: ns-resize; }
  .mk-resize-handle--s { bottom: -4px; left: 8px; right: 8px; width: auto; cursor: ns-resize; }
  .mk-resize-handle--e { right: -4px; top: 8px; bottom: 8px; height: auto; cursor: ew-resize; }
  .mk-resize-handle--w { left: -4px; top: 8px; bottom: 8px; height: auto; cursor: ew-resize; }
  .mk-resize-handle--ne { top: -4px; right: -4px; cursor: nesw-resize; }
  .mk-resize-handle--se { bottom: -4px; right: -4px; cursor: nwse-resize; }
  .mk-resize-handle--sw { bottom: -4px; left: -4px; cursor: nesw-resize; }
  .mk-resize-handle--nw { top: -4px; left: -4px; cursor: nwse-resize; }
`;
