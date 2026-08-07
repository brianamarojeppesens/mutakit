/**
 * Anchors (§5.5).
 *
 * An anchor is a point on a box. Placement reads: *put **this** point of the
 * element at **that** point of the container, then shift by offset.*
 *
 * `anchor` defaults to matching `at`, so `at: 'top-right'` alone means
 * "my top-right corner at the container's top-right corner" — the intuitive
 * reading, and enough for most HUD placement in one property.
 */
import "../core/dev.js";
import { warn } from "../core/diagnostics.js";
import { toNumber, parse } from "./len.js";

/** Physical keywords, as normalized fractions of width and height. */
const KEYWORDS = {
  "top-left": [0, 0],
  top: [0.5, 0],
  "top-right": [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  centre: [0.5, 0.5],
  right: [1, 0.5],
  "bottom-left": [0, 1],
  bottom: [0.5, 1],
  "bottom-right": [1, 1]
};

/** Logical spellings flip with `direction` and `writing-mode` (§5.4). */
const LOGICAL = {
  "inline-start": "left",
  "inline-end": "right",
  "block-start": "top",
  "block-end": "bottom"
};

/** The 12 placements the `positioned` trait offers (§16.3). */
export const PLACEMENTS = [
  "top-start", "top", "top-end",
  "right-start", "right", "right-end",
  "bottom-start", "bottom", "bottom-end",
  "left-start", "left", "left-end"
];

/**
 * Turn any anchor spelling into `{ fx, fy, dx, dy }`: fractions of the box
 * plus absolute pixel offsets. Mixed pairs like `['100%', 0.5]` resolve to
 * `{fx: 1, fy: 0.5}`; `['16px', '16px']` to `{dx: 16, dy: 16}`.
 */
export function resolveAnchor(anchor, options) {
  const opts = options || {};
  if (anchor == null) return { fx: 0, fy: 0, dx: 0, dy: 0 };

  if (typeof anchor === "string") {
    const keyword = normalizeKeyword(anchor, opts);
    const pair = KEYWORDS[keyword];
    if (!pair) {
      warn("MK1008", __MK_DEV__ &&
        `unknown anchor '${anchor}'; using 'top-left'`, { subject: anchor });
      return { fx: 0, fy: 0, dx: 0, dy: 0 };
    }
    return { fx: pair[0], fy: pair[1], dx: 0, dy: 0 };
  }

  if (Array.isArray(anchor)) {
    const x = component(anchor[0], opts, "x");
    const y = component(anchor[1], opts, "y");
    return { fx: x.f, fy: y.f, dx: x.d, dy: y.d };
  }

  if (typeof anchor === "object") {
    const x = component(anchor.x != null ? anchor.x : 0, opts, "x");
    const y = component(anchor.y != null ? anchor.y : 0, opts, "y");
    return { fx: x.f, fy: y.f, dx: x.d, dy: y.d };
  }

  return { fx: 0, fy: 0, dx: 0, dy: 0 };
}

function component(value, opts, axis) {
  if (typeof value === "number") {
    // A bare number in [0,1] is a fraction; anything else is pixels. This is
    // the one piece of ambiguity in the notation, and 0..1 is the useful read.
    return value >= 0 && value <= 1 ? { f: value, d: 0 } : { f: 0, d: value };
  }
  if (typeof value === "string") {
    const ast = parse(value);
    if (ast && ast.k === "pct") return { f: ast.v / 100, d: 0 };
    return { f: 0, d: toNumber(ast, opts.lenCtx || {}) || 0 };
  }
  return { f: 0, d: 0 };
}

/**
 * Normalize logical spellings and separators. `'block-start inline-start'`
 * becomes `'top-left'` under a left-to-right, horizontal writing mode, and
 * `'top-right'` under RTL.
 */
export function normalizeKeyword(anchor, options) {
  const opts = options || {};
  const rtl = opts.direction === "rtl";
  const vertical = opts.writingMode && opts.writingMode.indexOf("vertical") === 0;

  const parts = String(anchor)
    .trim()
    .toLowerCase()
    .split(/[\s_]+/)
    .flatMap((part) => (part.indexOf("-") !== -1 && !(part in LOGICAL) ? part.split("-") : [part]));

  let physical = [];
  for (const part of parts) {
    const full = LOGICAL[part] ? part : LOGICAL[`${part}-start`] ? part : part;
    if (LOGICAL[full]) physical.push(flip(LOGICAL[full], rtl, vertical, full));
    else physical.push(part);
  }
  // Re-join into a canonical keyword: vertical component first.
  const set = new Set(physical);
  if (set.has("center") && set.size === 1) return "center";
  const v = set.has("top") ? "top" : set.has("bottom") ? "bottom" : "";
  const h = set.has("left") ? "left" : set.has("right") ? "right" : "";
  if (v && h) return `${v}-${h}`;
  if (v) return v;
  if (h) return h;
  return physical.join("-");
}

function flip(physical, rtl, vertical, logical) {
  if (vertical) {
    // In a vertical writing mode the inline axis is vertical and vice versa.
    if (logical === "inline-start") return "top";
    if (logical === "inline-end") return "bottom";
    if (logical === "block-start") return rtl ? "right" : "left";
    if (logical === "block-end") return rtl ? "left" : "right";
  }
  if (!rtl) return physical;
  if (physical === "left") return "right";
  if (physical === "right") return "left";
  return physical;
}

/** The absolute point an anchor names on `box`. */
export function anchorPoint(box, anchor, options) {
  const a = resolveAnchor(anchor, options);
  return { x: box.x + box.w * a.fx + a.dx, y: box.y + box.h * a.fy + a.dy };
}

/**
 * Place a box of `size` so its `anchor` point lands on the container's `at`
 * point, then shift by `offset` (§5.5). Returns the rect in container space.
 *
 * `offset` is always in screen axis direction — `+x` right, `+y` down —
 * regardless of which anchor is used (D2). Use `inset` for edge-relative gaps.
 */
export function place(container, boxSize, spec, options) {
  const opts = options || {};
  const at = spec.at != null ? spec.at : "top-left";
  const anchor = spec.anchor != null ? spec.anchor : at;

  const target = anchorPoint(container, at, opts);
  const self = resolveAnchor(anchor, opts);
  const offset = spec.offset || [0, 0];
  const ox = Array.isArray(offset) ? offset[0] || 0 : offset.x || 0;
  const oy = Array.isArray(offset) ? offset[1] || 0 : offset.y || 0;

  return {
    x: target.x - (boxSize.w * self.fx + self.dx) + ox,
    y: target.y - (boxSize.h * self.fy + self.dy) + oy,
    w: boxSize.w,
    h: boxSize.h
  };
}

/**
 * Which edges a keyword touches — the information `inset` needs to mean
 * "16px in from both edges it touches", correctly under RTL.
 */
export function edgesOf(anchor, options) {
  const keyword = typeof anchor === "string" ? normalizeKeyword(anchor, options) : "";
  return {
    top: keyword.indexOf("top") !== -1,
    bottom: keyword.indexOf("bottom") !== -1,
    left: keyword.indexOf("left") !== -1,
    right: keyword.indexOf("right") !== -1
  };
}

/** Turn `inset` into a directional offset for the edges `at` touches (§5.5). */
export function insetOffset(anchor, insetValue, options) {
  if (insetValue == null || insetValue === false) return { x: 0, y: 0 };
  const edges = edgesOf(anchor, options);
  const i =
    typeof insetValue === "number"
      ? { top: insetValue, right: insetValue, bottom: insetValue, left: insetValue }
      : {
          top: insetValue.top || 0,
          right: insetValue.right || 0,
          bottom: insetValue.bottom || 0,
          left: insetValue.left || 0
        };
  let x = 0;
  let y = 0;
  if (edges.left) x += i.left;
  if (edges.right) x -= i.right;
  if (edges.top) y += i.top;
  if (edges.bottom) y -= i.bottom;
  return { x, y };
}

export { KEYWORDS as ANCHOR_KEYWORDS };
