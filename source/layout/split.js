/**
 * The `split` algorithm (§7.3).
 *
 * `stack` plus separators: draggable gutters, per-pane `min`/`max`,
 * `collapsible`, `snap` points, three resize modes, and persistence of pane
 * sizes by id.
 *
 * **How much of a drag is CSS?** Static layout and container resize are
 * entirely CSS. So are `neighbor` drags, and `distribute` drags in the common
 * case. The track list compiles to
 * `clamp(min, min(var(--mk-w-i), 100% − gutters − Σ neighbour mins), max)`, so
 * JavaScript writes one *unclamped* custom property per pointer move and the
 * browser applies every bound — including the point at which a neighbour hits
 * its minimum and the gutter must stop. That was measured, not assumed
 * (§27.2 R1): writing `--mk-w-0: 3px` produced a 64px track, `1015px` produced
 * 380px, and a container-resize sweep from 1200px to 240px performed **zero**
 * JavaScript property writes.
 *
 * Two exceptions compute in JavaScript during the drag, both consistent with
 * P1 rather than exceptions to it — JavaScript runs only while a pointer is
 * down, and the idle path stays free:
 *
 *   `push`        sequential exhaustion is not what `fr` distribution does,
 *                 and expressing it in CSS costs an O(n²) expression.
 *   `distribute`  only when a pane in the flexible set has a finite `max`, a
 *                 `snap`, or `collapsible`. `minmax(min, 1fr)` gives a
 *                 flexible track a floor and no ceiling, and `fr` cannot
 *                 appear inside `min()`/`clamp()`, so a non-dragged pane would
 *                 overrun its `max` — measured at 643.2px against a max of 500.
 *
 * The JS path is CSS's own fr-distribution algorithm with the finite growth
 * limits restored, so it yields exactly what the CSS path yields whenever the
 * CSS path is legal. That equivalence is the invariant the M2 test asserts,
 * and it is what lets a group cross between paths — a pane gaining a `max` at
 * runtime — with no visible change in behaviour.
 */
import "../core/dev.js";
import { warn } from "../core/diagnostics.js";
import { distributeFr, frCoefficient, isFlexible, parse, toCSS, toNumber } from "../geometry/len.js";

/** `axis` is canonical; the alias names describe the *separator* (D3). */
const AXIS_ALIASES = { vertical: "x", horizontal: "y", x: "x", y: "y" };
let aliasNoted = false;

export const splitLayout = {
  name: "split",
  version: "1.0.0",

  schema: {
    axis: { type: "any", default: "x" },
    gutter: { type: "any", default: 6 },
    resizeMode: { type: "enum", values: ["neighbor", "distribute", "push"], default: "neighbor" },
    live: { type: "boolean", default: true },
    step: { type: "number", default: 8 },
    panes: { type: "any" }
  },

  childProps: {
    size: { type: "len", default: "1fr", persist: true },
    min: { type: "len" },
    max: { type: "len" },
    collapsible: { type: "any" },
    collapsed: { type: "boolean", default: false, persist: true },
    snap: { type: "array", of: "number" },
    /** A pinned pane never absorbs a `distribute` delta. */
    pinned: { type: "boolean", default: false }
  },

  childrenFrom(options) {
    if (!options.panes) return null;
    return options.panes.map((pane) => ({ type: pane.type || "pane", ...toChildSpec(pane) }));
  },

  /**
   * Insert a `resizer` between every adjacent pair. Gutters are real children
   * and real grid tracks, so they participate in track sizing rather than
   * being overlaid — which is what makes the arithmetic exact.
   */
  setup(node, ctx) {
    const mk = ctx.mk;
    const options = normalizeOptions(node.algorithmOptions);
    node.algorithmOptions = options;
    if (!options.gutter.draggable) return;

    const panes = node.children.filter((child) => child.type !== "resizer");
    for (const existing of node.children.filter((child) => child.type === "resizer")) {
      mk.destroy(existing);
    }
    for (let i = 0; i < panes.length - 1; i++) {
      const resizer = mk.create(
        "resizer",
        { axis: options.axis, index: i, before: panes[i + 1] },
        node
      );
      if (resizer) resizer.node.gutterIndex = i;
    }
  },

  arrange(node, children, ctx) {
    const options = normalizeOptions(node.algorithmOptions);
    node.algorithmOptions = options;
    const axis = options.axis;
    const main = axis === "x" ? "w" : "h";
    const cross = axis === "x" ? "h" : "w";
    const mainPos = axis === "x" ? "x" : "y";
    const crossPos = axis === "x" ? "y" : "x";

    const panes = children.filter((child) => child.type !== "resizer");
    const gutters = children.filter((child) => child.type === "resizer");
    if (!panes.length) return;

    const frame = node.frame;
    const gutterSize = ctx.len(options.gutter.size, axis);
    const model = trackModel(node, panes, frame[main], gutterSize, ctx);
    node.splitModel = model;

    // The track list is the CSS half. Everything below fills in `computed` so
    // snapshots and hit tests have numbers; the browser does not need it.
    ctx.style(axis === "x" ? "grid-template-columns" : "grid-template-rows", model.template);
    ctx.style(axis === "x" ? "grid-template-rows" : "grid-template-columns", "100%");
    ctx.css({ "--mk-gutter": `${gutterSize}px` });

    let cursor = frame[mainPos === "x" ? "x" : "y"];
    for (let i = 0; i < panes.length; i++) {
      const pane = panes[i];
      pane.computed[mainPos] = cursor;
      pane.computed[main] = model.sizes[i];
      pane.computed[crossPos] = frame[crossPos];
      pane.computed[cross] = frame[cross];
      pane.sizeIsFixed = !model.tracks[i].flexible;
      ctx.mk.compiler.setRect(pane, pane.computed);
      ctx.mk.compiler.setStyle(pane, axis === "x" ? "grid-column" : "grid-row", String(i * 2 + 1));
      ctx.mk.compiler.setState(pane, "collapsed", !!pane.layoutProps.collapsed);
      cursor += model.sizes[i];

      const gutter = gutters[i];
      if (i < panes.length - 1 && gutter) {
        gutter.computed[mainPos] = cursor;
        gutter.computed[main] = gutterSize;
        gutter.computed[crossPos] = frame[crossPos];
        gutter.computed[cross] = frame[cross];
        ctx.mk.compiler.setRect(gutter, gutter.computed);
        ctx.mk.compiler.setStyle(gutter, axis === "x" ? "grid-column" : "grid-row", String(i * 2 + 2));
        updateSeparatorSemantics(gutter, model, i, ctx);
      }
      cursor += gutterSize;
    }

    if (model.overflow) {
      // Below Σ mins + gutters, CSS holds the minimums and lets the container
      // overflow. Defined behaviour, not a failure (§27.2 R1) — but worth
      // saying out loud once, because the alternative is a mystery.
      warn("MK2013", __MK_DEV__ &&
        `the panes' minimums plus gutters (${Math.round(model.required)}px) exceed the ` +
          `container (${Math.round(frame[main])}px); the minimums hold and the split overflows`,
        { subject: node.toString() }
      );
    }
  },

  css(node) {
    const options = normalizeOptions(node.algorithmOptions);
    return {
      display: "grid",
      position: "relative",
      "--mk-split-axis": options.axis
    };
  },

  styles: `
    [data-mk-algorithm="split"] {
      display: grid;
      min-width: 0;
      min-height: 0;
    }
    [data-mk-algorithm="split"] > .mk-node {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    [data-mk-algorithm="split"] > .mk-resizer {
      overflow: visible;
    }
  `
};

// ── The track model ──────────────────────────────────────────────────────

/**
 * Resolve the track list once, producing both the CSS template the browser
 * executes and the pixel sizes ARRANGE writes into `computed`.
 *
 * The two must agree — that is the equivalence the M2 test sweeps — so they
 * are computed here from one description rather than derived independently.
 */
export function trackModel(node, panes, available, gutterSize, ctx) {
  const totalGutters = gutterSize * Math.max(0, panes.length - 1);
  const content = Math.max(0, available - totalGutters);
  const lenCtx = ctx.mk ? ctx.mk.lenContext(available, node) : { basis: available };

  const tracks = panes.map((pane) => {
    const bag = pane.layoutProps || {};
    const collapsed = !!bag.collapsed;
    const declared = collapsed ? collapsedSize(bag) : bag.size != null ? bag.size : "1fr";
    const ast = parse(declared);
    const flexible = !collapsed && isFlexible(ast);
    const min = collapsed ? collapsedSize(bag) : resolve(bag.min, lenCtx, 0);
    const max = collapsed ? collapsedSize(bag) : resolve(bag.max, lenCtx, Infinity);
    const base = flexible ? 0 : clampNumber(resolve(declared, lenCtx, 0), min, max);
    return {
      pane,
      flexible,
      fr: flexible ? frCoefficient(ast) : 0,
      declared,
      min,
      max,
      base,
      collapsed,
      pinned: !!bag.pinned,
      hasCeiling: isFinite(max),
      hasSnap: Array.isArray(bag.snap) && bag.snap.length > 0,
      // The raw declaration, not a boolean: `shouldCollapse` needs its `at`.
      collapsible: bag.collapsible || false,
      // A collapsible pane may be dragged *below* its minimum, as far as the
      // collapse threshold — otherwise `min` blocks the very gesture `at`
      // exists to detect, and the pane can never be collapsed by dragging.
      dragMin: dragFloor(bag, collapsed ? collapsedSize(bag) : resolve(bag.min, lenCtx, 0))
    };
  });

  const sizes = distributeFr(tracks, content);
  const required = tracks.reduce((sum, track) => sum + track.min, 0) + totalGutters;

  return {
    tracks,
    sizes,
    gutterSize,
    totalGutters,
    content,
    required,
    overflow: required > available + 0.5,
    template: template(tracks, gutterSize)
  };
}

/**
 * The CSS half. A fixed pane compiles to the clamp expression measured in
 * §27.2 R1; a flexible one to `minmax(min, N fr)`, which enforces its floor
 * and — by construction — no ceiling.
 */
function template(tracks, gutterSize) {
  const parts = [];
  const sumOtherMins = tracks.reduce((sum, track) => sum + track.min, 0);
  const gutterTotal = gutterSize * Math.max(0, tracks.length - 1);

  tracks.forEach((track, i) => {
    if (i > 0) parts.push(`var(--mk-gutter, ${gutterSize}px)`);
    if (track.flexible) {
      parts.push(`minmax(${px(track.min)}, ${track.fr}fr)`);
    } else {
      const others = sumOtherMins - track.min;
      const ceiling = `calc(100% - ${px(gutterTotal + others)})`;
      const wanted = `var(--mk-w-${i}, ${px(track.base)})`;
      const bounded = `min(${wanted}, ${ceiling})`;
      parts.push(
        isFinite(track.max)
          ? `clamp(${px(track.min)}, ${bounded}, ${px(track.max)})`
          : `max(${px(track.min)}, ${bounded})`
      );
    }
  });
  return parts.join(" ");
}

/**
 * The floor a *drag* may reach, which is not the same as the pane's `min`.
 *
 * A collapsible pane can be dragged past its minimum all the way to its
 * collapsed size — that is the gesture `collapsible.at` exists to detect.
 * Clamping the drag at `min` (or even at `at`) means the threshold is never
 * crossed and the pane can never be collapsed by dragging at all.
 */
function dragFloor(bag, min) {
  if (!bag.collapsible) return min;
  return Math.min(collapsedSize(bag), min);
}

function collapsedSize(bag) {
  const to = bag.collapsible && typeof bag.collapsible === "object" ? bag.collapsible.to : 0;
  return to == null ? 0 : to;
}

function resolve(value, lenCtx, fallback) {
  if (value == null) return fallback;
  const n = toNumber(parse(value), lenCtx);
  return isFinite(n) ? n : fallback;
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function px(value) {
  return `${Math.round(value * 100) / 100}px`;
}

// ── Options ──────────────────────────────────────────────────────────────

export function normalizeOptions(raw) {
  const options = raw || {};
  if (options.__normalized) return options;

  let axis = options.axis == null ? "x" : String(options.axis).toLowerCase();
  if (axis === "vertical" || axis === "horizontal") {
    if (__MK_DEV__ && !aliasNoted) {
      aliasNoted = true;
      // Not a diagnostic: the alias is supported and documented. It is a note,
      // once, because "split vertically" is genuinely ambiguous in the wild and
      // silence here is how an author discovers the interpretation the hard way.
      console.info(
        `[mutakit] axis: '${axis}' describes the separator — panes are distributed ` +
          `along '${AXIS_ALIASES[axis]}'. The documentation leads with axis: '${AXIS_ALIASES[axis]}'.`
      );
    }
  }
  axis = AXIS_ALIASES[axis] || "x";

  const gutter =
    typeof options.gutter === "number"
      ? { size: options.gutter, draggable: true }
      : { size: 6, draggable: true, ...(options.gutter || {}) };

  return {
    __normalized: true,
    axis,
    gutter,
    resizeMode: options.resizeMode || "neighbor",
    live: options.live !== false,
    step: options.step == null ? 8 : options.step,
    panes: options.panes
  };
}

/** Split `{ id, size, min, collapsible, … }` into element props plus the bag. */
function toChildSpec(pane) {
  const { type, id, content, children, ...rest } = pane;
  const bag = {};
  const props = {};
  for (const key of Object.keys(rest)) {
    if (CHILD_KEYS.has(key)) bag[key] = rest[key];
    else props[key] = rest[key];
  }
  return { id, content, children, ...props, layout: bag };
}

const CHILD_KEYS = new Set(["size", "min", "max", "collapsible", "collapsed", "snap", "pinned"]);

// ── Separator semantics (§7.3, §14) ──────────────────────────────────────

function updateSeparatorSemantics(gutter, model, index, ctx) {
  const track = model.tracks[index];
  const now = model.sizes[index];
  const room = model.content;
  const max = isFinite(track.max) ? track.max : room - sumMins(model, index);
  ctx.mk.compiler.setState(gutter, "index", String(index));
  if (!gutter.el) return;
  gutter.el.setAttribute("aria-valuenow", String(Math.round(now)));
  gutter.el.setAttribute("aria-valuemin", String(Math.round(track.min)));
  gutter.el.setAttribute("aria-valuemax", String(Math.round(max)));
  const controls = model.tracks[index].pane.id;
  if (controls) gutter.el.setAttribute("aria-controls", controls);
}

function sumMins(model, exceptIndex) {
  return model.tracks.reduce((sum, track, i) => (i === exceptIndex ? sum : sum + track.min), 0);
}

// ── Drag resolution ──────────────────────────────────────────────────────

/**
 * Whether gutter `index` can be dragged entirely in CSS.
 *
 * `neighbor` always can: R1 measured every bound holding against deliberately
 * out-of-range writes. `distribute` can when every pane in the flexible set has
 * no finite `max`, no `snap`, and no `collapsible` — a `min` alone never forces
 * the JS path, which is why the common case (panes declaring only a minimum)
 * stays on the CSS path. `push` never can.
 */
export function canUseCSSPath(model, index, mode) {
  if (mode === "push") return false;
  if (mode === "neighbor") {
    const next = model.tracks[index + 1];
    return !!next && !next.hasSnap && !next.collapsible;
  }
  return flexibleSet(model, index).every(
    (track) => !track.hasCeiling && !track.hasSnap && !track.collapsible
  );
}

/**
 * The flexible set of a `distribute` drag: panes after the gutter, minus any
 * that is collapsed or pinned. Computed once on `pointerdown` and held for the
 * life of the drag — recomputing it per frame would let the track form change
 * mid-drag, which is visible as a jump.
 */
export function flexibleSet(model, index) {
  return model.tracks.slice(index + 1).filter((track) => !track.collapsed && !track.pinned);
}

/**
 * Resolve a drag of gutter `index` by `delta` pixels.
 *
 * Returns `{ sizes, applied }` — the new pane sizes and how much of `delta`
 * the split could actually absorb. The gutter stops where `applied` stops,
 * which is what makes every mode feel the same at its limits.
 */
export function resolveDrag(model, index, delta, mode, start) {
  const sizes = (start || model.sizes).slice();
  switch (mode) {
    case "distribute":
      return dragDistribute(model, index, delta, sizes);
    case "push":
      return dragPush(model, index, delta, sizes);
    default:
      return dragNeighbor(model, index, delta, sizes);
  }
}

/** Take space only from the adjacent pane. The default, and the simplest. */
function dragNeighbor(model, index, delta, sizes) {
  const a = model.tracks[index];
  const b = model.tracks[index + 1];
  if (!b) return { sizes, applied: 0 };

  const wantA = sizes[index] + delta;
  const wantB = sizes[index + 1] - delta;
  const newA = clampNumber(wantA, a.dragMin, a.max);
  const newB = clampNumber(wantB, b.dragMin, b.max);

  // Whichever bound binds first decides how far the gutter travels.
  const applied = Math.abs(newA - sizes[index]) < Math.abs(sizes[index + 1] - newB)
    ? newA - sizes[index]
    : sizes[index + 1] - newB;

  sizes[index] += applied;
  sizes[index + 1] -= applied;
  return { sizes, applied };
}

/**
 * CSS's own fr-distribution algorithm with the finite growth limits restored
 * (§7.3, normative).
 *
 * Step 3 is a no-op when every `max` is infinite, which is precisely why this
 * yields what the CSS path yields whenever the CSS path is legal.
 */
function dragDistribute(model, index, delta, sizes) {
  const set = flexibleSet(model, index);
  if (!set.length) return dragNeighbor(model, index, delta, sizes);

  const indices = set.map((track) => model.tracks.indexOf(track));
  const seeded = indices.map((i) => sizes[i]);
  const dragged = model.tracks[index];
  const seedK = sizes[index];

  // Pane k's own bounds come first. Distributing the *requested* delta and
  // capping pane k afterwards is the tempting shape and the wrong one: the set
  // then absorbs more than pane k gave up and the tracks stop summing to the
  // container.
  let applied = clampNumber(seedK + delta, dragged.dragMin, dragged.max) - seedK;
  let result = seeded.slice();

  for (let round = 0; round < 3; round++) {
    result = spread(model, indices, seeded, -applied);
    const absorbed = result.reduce((sum, size, slot) => sum + (size - seeded[slot]), 0);
    if (Math.abs(absorbed + applied) < 0.01) break;
    // The set could only take this much, so that is all pane k may take. One
    // more pass settles it, because the second spread asks for exactly the
    // capacity the first measured.
    applied = -absorbed;
  }

  indices.forEach((i, slot) => {
    sizes[i] = result[slot];
  });
  sizes[index] = seedK + applied;
  return { sizes, applied };
}

/**
 * CSS's own fr-distribution with the finite growth limits restored: spread
 * `pool` across the set in proportion to weight, freeze whatever lands outside
 * its bounds, return what it could not absorb to the pool, repeat.
 *
 * Step 3 is a no-op when every `max` is infinite, which is exactly why this
 * yields what the CSS path yields whenever the CSS path is legal.
 */
function spread(model, indices, seeded, pool) {
  const result = seeded.slice();
  const frozen = new Set();

  for (let pass = 0; pass <= indices.length; pass++) {
    const active = indices.filter((i) => !frozen.has(i));
    if (!active.length || Math.abs(pool) < 0.01) break;

    const weight = active.reduce((sum, i) => sum + Math.max(model.tracks[i].fr || 1, 0), 0);
    let froze = false;

    for (const i of active) {
      const slot = indices.indexOf(i);
      const share = (Math.max(model.tracks[i].fr || 1, 0) / weight) * pool;
      const wanted = seeded[slot] + share;
      const clamped = clampNumber(wanted, model.tracks[i].dragMin, model.tracks[i].max);
      result[slot] = clamped;
      if (Math.abs(clamped - wanted) > 0.01) {
        frozen.add(i);
        froze = true;
      }
    }
    if (!froze) break;

    // Each pass freezes at least one pane, so this terminates in at most
    // |set| passes.
    let taken = 0;
    for (const i of frozen) taken += result[indices.indexOf(i)] - seeded[indices.indexOf(i)];
    pool -= taken;
    const remaining = indices.filter((i) => !frozen.has(i));
    for (const i of remaining) result[indices.indexOf(i)] = seeded[indices.indexOf(i)];
    if (!remaining.length) break;
    seeded = seeded.slice();
  }
  return result;
}

/** Cascade past panes that hit their minimum, one after another. */
function dragPush(model, index, delta, sizes) {
  let remaining = delta;
  const direction = delta >= 0 ? 1 : -1;
  const a = model.tracks[index];

  const headroom = direction > 0 ? (isFinite(a.max) ? a.max - sizes[index] : Infinity) : sizes[index] - a.dragMin;
  if (headroom <= 0) return { sizes, applied: 0 };
  remaining = direction > 0 ? Math.min(remaining, headroom) : Math.max(remaining, -headroom);

  let absorbed = 0;
  const order = direction > 0
    ? model.tracks.map((_, i) => i).slice(index + 1)
    : model.tracks.map((_, i) => i).slice(0, index + 1).reverse();

  for (const i of order) {
    if (Math.abs(remaining - absorbed) < 0.01) break;
    const track = model.tracks[i];
    const want = remaining - absorbed;
    const room = direction > 0 ? sizes[i] - track.dragMin : (isFinite(track.max) ? track.max - sizes[i] : Infinity);
    const take = Math.min(Math.abs(want), room) * direction;
    sizes[i] -= take;
    absorbed += take;
  }

  sizes[index] += absorbed;
  if (direction < 0) {
    // Dragging back shrinks pane k and returns the space the same way.
    sizes[index] = clampNumber(sizes[index], a.dragMin, a.max);
  }
  return { sizes, applied: absorbed };
}

/** Snap a size to the nearest declared point within `tolerance`. */
export function applySnap(track, size, tolerance) {
  if (!track.hasSnap) return size;
  const bag = track.pane.layoutProps || {};
  let best = size;
  let bestDistance = tolerance == null ? 12 : tolerance;
  for (const point of bag.snap) {
    const distance = Math.abs(point - size);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

/**
 * Should this pane collapse at `size`? Dragging below `collapsible.at` snaps to
 * `collapsible.to` (usually 0) and sets the `collapsed` state; the gutter stays
 * draggable so it can be restored.
 */
export function shouldCollapse(track, size) {
  if (!track.collapsible) return false;
  const at = typeof track.collapsible === "object" ? track.collapsible.at : track.min;
  return size < (at == null ? track.min : at);
}

export { AXIS_ALIASES };
