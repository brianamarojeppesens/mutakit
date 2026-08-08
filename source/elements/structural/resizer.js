/**
 * `resizer` — a standalone gutter (§11.1, §7.3).
 *
 * `split` creates one between every adjacent pair, and an author composing
 * their own split uses it directly. There is **one splitter implementation**,
 * not two: `dock`'s resizable regions share all of the interaction rules
 * below (§7.4).
 *
 * The interaction details here are what separate a usable splitter from a
 * frustrating one, and each is a stated requirement rather than a refinement:
 * pointer capture so a fast drag outside the gutter still tracks; a hit area
 * of at least 8px (larger for coarse pointers) around a 1–6px visual gutter;
 * live versus deferred resizing; a clamping cascade; collapse with a
 * restorable gutter; and a full keyboard equivalent, because every pointer
 * interaction has one (P5).
 */
import "../../core/dev.js";
import { listen } from "../../core/dom.js";
import { css } from "../../styles/index.js";
import {
  applySnap,
  canUseCSSPath,
  normalizeOptions,
  resolveDrag,
  shouldCollapse,
  trackModel
} from "../../layout/split.js";

export const resizer = {
  type: "resizer",
  version: "1.0.0",

  props: {
    axis: { type: "enum", values: ["x", "y"], default: "x" },
    index: { type: "number", default: 0 },
    disabled: { type: "boolean", default: false }
  },

  events: ["resizestart", "resize", "resizeend", "collapse", "expand"],

  /**
   * `role="separator"` with a value range, which is what makes the keyboard
   * path meaningful to a screen reader rather than merely present.
   */
  a11y: {
    role: "separator",
    props: {
      "aria-orientation": (ctx) => (ctx.props.axis === "x" ? "vertical" : "horizontal"),
      "aria-disabled": (ctx) => (ctx.props.disabled ? "true" : null),
      tabindex: (ctx) => (ctx.props.disabled ? null : "0")
    }
  },

  keys: {
    ArrowLeft: "shrink",
    ArrowRight: "grow",
    ArrowUp: "shrink",
    ArrowDown: "grow",
    Home: "min",
    End: "max",
    Enter: "toggle",
    Escape: "cancel"
  },

  commands: {
    /** Move the gutter by `delta` pixels, as a drag of that distance would. */
    nudge(ctx, delta) {
      commit(ctx, drag(ctx, delta));
    },
    /** Collapse or restore the pane before this gutter. */
    toggle(ctx) {
      toggleCollapse(ctx);
    },
    cancel(ctx) {
      cancelDrag(ctx);
    }
  },

  create(ctx) {
    const el = ctx.dom("div", { class: `mk-resizer mk-resizer--${ctx.props.axis}` });
    ctx.state.drag = null;
    // `role="separator"` with a `tabindex` *requires* aria-valuenow. A split
    // fills these in from its track model on the next arrange, but a resizer
    // composed by hand may never have one — and a required ARIA attribute that
    // arrives late is a required ARIA attribute that is sometimes missing.
    el.setAttribute("aria-valuenow", "0");
    el.setAttribute("aria-valuemin", "0");
    el.setAttribute("aria-valuemax", "0");
    return el;
  },

  mount(ctx) {
    const el = ctx.el;
    ctx.own(listen(el, "pointerdown", (event) => onPointerDown(ctx, event)));
    ctx.own(listen(el, "pointermove", (event) => onPointerMove(ctx, event)));
    ctx.own(listen(el, "pointerup", (event) => onPointerUp(ctx, event)));
    ctx.own(listen(el, "pointercancel", () => cancelDrag(ctx)));
    ctx.own(listen(el, "lostpointercapture", () => cancelDrag(ctx)));
    ctx.own(listen(el, "dblclick", () => toggleCollapse(ctx)));
    ctx.own(listen(el, "keydown", (event) => onKeyDown(ctx, event)));
    applyHitSlop(ctx);
  },

  update(ctx, changed) {
    if (changed.has("axis")) applyHitSlop(ctx);
  },

  styles: css`
    .mk-resizer {
      /* No position declaration: the engine decides whether a node is
       absolute or in flow, and an absolutely positioned box establishes a
       containing block just as a relative one does. Declaring it here beat
       the base stylesheet's absolute positioning on .mk-node and displaced
       the element by whatever flow put above it. See layout/anchor.js. */
      background: var(--mk-resizer-bg, var(--mk-border-subtle));
      touch-action: none;
      z-index: 1;
    }
    .mk-resizer--x { cursor: col-resize; }
    .mk-resizer--y { cursor: row-resize; }

    /* The interactive area is larger than the visual gutter. A 1–6px line is
       the right *look* and the wrong *target* (§7.3, and WCAG 2.2 target size). */
    .mk-resizer::before {
      content: "";
      position: absolute;
      inset: calc(-1 * var(--mk-resizer-slop, 4px)) 0;
    }
    .mk-resizer--x::before {
      inset: 0 calc(-1 * var(--mk-resizer-slop, 4px));
    }

    .mk-resizer:hover,
    .mk-resizer[data-mk-dragging] {
      background: var(--mk-resizer-active-bg, var(--mk-color-accent));
    }
    .mk-resizer:focus-visible {
      outline: var(--mk-focus-ring);
      outline-offset: 1px;
    }
    .mk-resizer[aria-disabled="true"] {
      cursor: default;
      pointer-events: none;
    }

    /* The deferred ghost: a preview bar drawn where the gutter would land. */
    .mk-resizer[data-mk-ghost]::after {
      content: "";
      position: absolute;
      inset: 0;
      background: var(--mk-color-accent);
      transform: translate(var(--mk-ghost-x, 0), var(--mk-ghost-y, 0));
      opacity: 0.6;
      pointer-events: none;
    }
  `
};

/** Coarse pointers get a larger target, read from the metrics snapshot. */
function applyHitSlop(ctx) {
  const metrics = ctx.mk.metrics.current;
  const slop = metrics.coarsePointer ? 12 : 4;
  ctx.css({ "--mk-resizer-slop": `${slop}px` });
}

// ── Pointer ──────────────────────────────────────────────────────────────

function onPointerDown(ctx, event) {
  if (ctx.props.disabled || event.button !== 0) return;
  const split = ctx.node.parent;
  if (!split) return;

  const options = normalizeOptions(split.algorithmOptions);
  const model = split.splitModel;
  if (!model) return;

  event.preventDefault();
  // Pointer capture, so a fast drag that leaves the gutter still tracks.
  ctx.el.setPointerCapture(event.pointerId);

  ctx.state.drag = {
    pointerId: event.pointerId,
    axis: options.axis,
    mode: options.resizeMode,
    live: options.live,
    origin: options.axis === "x" ? event.clientX : event.clientY,
    start: model.sizes.slice(),
    model,
    // Computed once and held: recomputing the flexible set per frame would let
    // the track form change mid-drag, which is visible as a jump (§7.3).
    css: canUseCSSPath(model, ctx.props.index, options.resizeMode),
    moved: false
  };

  ctx.setState("dragging", true);
  ctx.emit("resizestart", { index: ctx.props.index, sizes: model.sizes.slice() });
}

function onPointerMove(ctx, event) {
  const state = ctx.state.drag;
  if (!state || event.pointerId !== state.pointerId) return;
  const position = state.axis === "x" ? event.clientX : event.clientY;
  const delta = position - state.origin;
  state.moved = true;

  const result = drag(ctx, delta);
  if (!state.live) {
    // Deferred: draw a ghost and apply on release. The fallback when pane
    // content is expensive to relayout.
    ctx.setState("ghost", true);
    ctx.css({
      [state.axis === "x" ? "--mk-ghost-x" : "--mk-ghost-y"]: `${result.applied}px`
    });
    return;
  }
  writeSizes(ctx, result);
  ctx.emit("resize", { index: ctx.props.index, sizes: result.sizes });
}

function onPointerUp(ctx, event) {
  const state = ctx.state.drag;
  if (!state || event.pointerId !== state.pointerId) return;
  const position = state.axis === "x" ? event.clientX : event.clientY;
  const result = drag(ctx, position - state.origin);
  commit(ctx, result);
}

function cancelDrag(ctx) {
  const state = ctx.state.drag;
  if (!state) return;
  // Every cancellation source is treated identically (§13.3): pointercancel,
  // Escape, focus loss, lost capture, and a programmatic cancel all restore.
  writeSizes(ctx, { sizes: state.start, applied: 0 });
  finish(ctx);
  ctx.emit("resizeend", { index: ctx.props.index, sizes: state.start, cancelled: true });
}

function finish(ctx) {
  ctx.state.drag = null;
  ctx.setState("dragging", false);
  ctx.setState("ghost", false);
  ctx.css({ "--mk-ghost-x": null, "--mk-ghost-y": null });
}

// ── The shared drag body ─────────────────────────────────────────────────

/**
 * Restore a collapsed pane to the size it had, not to a default (§7.3).
 */
function restoreTrack(ctx, track) {
  ctx.mk.setLayoutProps(track.pane, {
    collapsed: false,
    size: track.pane.state.restoreSize != null ? track.pane.state.restoreSize : track.min || 200
  });
  ctx.emit("expand", { index: ctx.props.index, pane: track.pane.id });
}

/**
 * A drag away from a collapsed pane re-opens it.
 *
 * While a pane is collapsed its track is pinned — `min` and `max` are both the
 * collapsed size — so every drag resolved to nothing at all. The gutter still
 * took the pointer, still showed a resize cursor, and did absolutely nothing,
 * and neither `ArrowRight` nor `End` could reach the pane either. The only way
 * back was the double-click that closed it, which is not discoverable from a
 * gutter you are already dragging.
 *
 * The gesture is symmetric with the one that collapses: drag *towards* a pane
 * far enough and it closes, drag *away* far enough and it opens, using the same
 * threshold. Restoring here rather than mid-resolution keeps the track model
 * stable for the rest of the gesture, which is what stops the layout jumping.
 */
function restoreFromDrag(ctx, model, index, delta) {
  const candidates = [
    { track: model.tracks[index], grows: delta > 0 },
    { track: model.tracks[index + 1], grows: delta < 0 }
  ];
  for (let i = 0; i < candidates.length; i++) {
    const { track, grows } = candidates[i];
    if (!track || !track.collapsed || !grows) continue;
    const at = typeof track.collapsible === "object" ? track.collapsible.at : track.min;
    if (Math.abs(delta) < (at || 0)) continue;
    restoreTrack(ctx, track);
    return index + i;
  }
  return -1;
}

function drag(ctx, delta) {
  const state = ctx.state.drag || seedFromCurrent(ctx);
  const model = state.model;
  const index = ctx.props.index;
  const restored = restoreFromDrag(ctx, model, index, delta);
  if (restored !== -1) {
    return { sizes: model.sizes.slice(), applied: 0, restored };
  }
  const result = resolveDrag(model, index, delta, state.mode, state.start);

  // Both neighbours are candidates: a gutter dragged *towards* a pane
  // collapses that pane, and which side that is depends on the direction.
  for (const i of [index, index + 1]) {
    const track = model.tracks[i];
    if (!track) continue;
    result.sizes[i] = applySnap(track, result.sizes[i]);
    if (shouldCollapse(track, result.sizes[i])) result.collapse = i;
  }
  return result;
}

/** Keyboard nudges have no pointerdown, so they seed a one-shot drag state. */
function seedFromCurrent(ctx) {
  const split = ctx.node.parent;
  const options = normalizeOptions(split.algorithmOptions);
  const model = split.splitModel;
  return {
    axis: options.axis,
    mode: options.resizeMode,
    live: true,
    start: model ? model.sizes.slice() : [],
    model,
    css: false
  };
}

/**
 * Write the drag's result.
 *
 * On the CSS path this is one *unclamped* custom property per pane and nothing
 * else: no invalidation, no ARRANGE, no measurement. The browser applies every
 * bound. That is the whole point of the track expression.
 */
function writeSizes(ctx, result) {
  const split = ctx.node.parent;
  const state = ctx.state.drag;
  const model = state ? state.model : split.splitModel;
  if (!split || !model) return;

  const properties = {};
  result.sizes.forEach((size, i) => {
    if (model.tracks[i].flexible && state && state.css) return;
    properties[`--mk-w-${i}`] = `${Math.round(size * 100) / 100}px`;
  });
  ctx.mk.compiler.setAll(split, properties);
  ctx.mk.compiler.flush(split);
}

/**
 * Commit on release.
 *
 * The CSS path commits the widths **read back from the browser**, not its own
 * estimate of them: that read-back is what makes reverting to the clamp form
 * invisible. Both paths then write explicit sizes, after which CSS re-clamps
 * idempotently and the committed value cannot disagree with what was on screen.
 */
function commit(ctx, result) {
  const split = ctx.node.parent;
  const state = ctx.state.drag;
  const model = state ? state.model : split && split.splitModel;
  if (!split || !model) return;

  // A restore has already written the pane's size and cleared `collapsed`;
  // committing measured tracks on top would write the collapsed zero back.
  //
  // The stale custom property has to go with it. A drag on the CSS path writes
  // `--mk-w-{i}` every pointermove, and while the pane was collapsed that value
  // was zero — which the track expression reads in preference to the restored
  // size, so the pane came back at its *minimum* rather than the width it had.
  // The memory was right all along; this was overruling it.
  if (result && result.restored !== undefined && result.restored !== -1) {
    ctx.mk.compiler.setAll(split, { [`--mk-w-${result.restored}`]: null });
    ctx.mk.compiler.flush(split);
    finish(ctx);
    ctx.mk.persistDirty = true;
    ctx.invalidate("arrange");
    return;
  }

  const axis = state ? state.axis : ctx.props.axis;
  const measured = state && state.css ? readBack(model, axis) : result.sizes;

  // A flexible track stays flexible. Committing its measured pixels turned
  // `1fr` into a fixed width, and a track that no longer flexes cannot absorb
  // anything: collapsing the sidebar afterwards freed 180px that nothing
  // claimed, so the layout kept its old width and left a gap. Worse, each
  // later drag re-pinned it to the already-short width, so the panes shrank a
  // little more every time the sidebar was collapsed and reopened.
  //
  // What the drag actually changed for a flexible track is its *share*, so
  // that is what gets committed. With one flexible track the share is the
  // whole, and `1fr` commits as `1fr` — unchanged, still absorbing. With
  // several, the ratio between them moves, which is what the drag meant.
  const flexible = model.tracks.filter((track, i) =>
    track.flexible && !track.collapsed && isFinite(measured[i])
  );
  const flexPx = flexible.reduce((sum, track) => sum + measured[model.tracks.indexOf(track)], 0);
  const flexFr = flexible.reduce((sum, track) => sum + (track.fr || 0), 0);

  model.tracks.forEach((track, i) => {
    if (track.collapsed) return;
    const size = measured[i];
    if (size == null || !isFinite(size)) return;
    if (track.flexible) {
      if (flexPx > 0 && flexFr > 0) {
        const share = Math.round(((size / flexPx) * flexFr) * 1000) / 1000;
        ctx.mk.setLayoutProps(track.pane, { size: `${share}fr` });
      }
      return;
    }
    ctx.mk.setLayoutProps(track.pane, { size });
  });

  if (result.collapse != null) {
    const track = model.tracks[result.collapse];
    track.pane.state.restoreSize = model.sizes[result.collapse];
    ctx.mk.setLayoutProps(track.pane, { collapsed: true });
    ctx.emit("collapse", { index: result.collapse, pane: track.pane.id });
  }

  finish(ctx);
  ctx.mk.persistDirty = true;
  ctx.invalidate("arrange");
  ctx.emit("resizeend", { index: ctx.props.index, sizes: measured, cancelled: false });
}

function readBack(model, axis) {
  return model.tracks.map((track) => {
    if (!track.pane.el) return null;
    const box = track.pane.el.getBoundingClientRect();
    return axis === "x" ? box.width : box.height;
  });
}

// ── Collapse and keyboard ────────────────────────────────────────────────

function toggleCollapse(ctx) {
  const split = ctx.node.parent;
  const model = split && split.splitModel;
  if (!model) return;
  // Toggling from the gutter targets whichever neighbour declares collapse.
  const track = [model.tracks[ctx.props.index], model.tracks[ctx.props.index + 1]].find(
    (candidate) => candidate && candidate.collapsible
  );
  if (!track) return;

  const bag = track.pane.layoutProps;
  if (bag.collapsed) {
    restoreTrack(ctx, track);
  } else {
    track.pane.state.restoreSize = model.sizes[model.tracks.indexOf(track)];
    ctx.mk.setLayoutProps(track.pane, { collapsed: true });
    ctx.emit("collapse", { index: ctx.props.index, pane: track.pane.id });
  }
  ctx.mk.persistDirty = true;
  ctx.invalidate("arrange");
}

/**
 * The keyboard equivalent (§7.3, P5). Arrow keys move by `step`, `Shift` by
 * five times that, `Home`/`End` to the bounds, `Enter` toggles collapse.
 */
function onKeyDown(ctx, event) {
  if (ctx.props.disabled) return;
  const split = ctx.node.parent;
  const model = split && split.splitModel;
  if (!model) return;
  const options = normalizeOptions(split.algorithmOptions);
  const axis = options.axis;
  const step = options.step * (event.shiftKey ? 5 : 1);

  const forward = axis === "x" ? "ArrowRight" : "ArrowDown";
  const backward = axis === "x" ? "ArrowLeft" : "ArrowUp";
  let delta = null;

  if (event.key === forward) delta = step;
  else if (event.key === backward) delta = -step;
  else if (event.key === "Home") delta = -Infinity;
  else if (event.key === "End") delta = Infinity;
  else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleCollapse(ctx);
    return;
  } else if (event.key === "Escape") {
    cancelDrag(ctx);
    return;
  } else {
    return;
  }

  event.preventDefault();
  const bounded = delta === Infinity ? model.content : delta === -Infinity ? -model.content : delta;
  commit(ctx, drag(ctx, bounded));
}
