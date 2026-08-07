/**
 * `Rect`, `Point`, `Size`, `Inset` — the primitive algebra (§5.1).
 *
 * Rects are immutable value objects. The public API returns frozen copies; the
 * ARRANGE phase uses the mutable `.into()` forms against a pool, because no
 * per-frame allocation in the hot path is a stated performance rule (§20.2).
 */

export function point(x, y) {
  return { x, y };
}

export function size(w, h) {
  return { w, h };
}

/** Construct a rect. `x`/`y` are in whatever space the caller states (§5.4). */
export function rect(x, y, w, h) {
  return { x, y, w, h };
}

export const ZERO = Object.freeze({ x: 0, y: 0, w: 0, h: 0 });

export function left(r) { return r.x; }
export function top(r) { return r.y; }
export function right(r) { return r.x + r.w; }
export function bottom(r) { return r.y + r.h; }
export function centerX(r) { return r.x + r.w / 2; }
export function centerY(r) { return r.y + r.h / 2; }

export function fromEdges(l, t, r, b) {
  return { x: l, y: t, w: r - l, h: b - t };
}

/** Shrink by an inset (a number, `{x, y}`, or a full `Inset`). */
export function inset(r, by) {
  const i = normalizeInset(by);
  return {
    x: r.x + i.left,
    y: r.y + i.top,
    w: Math.max(0, r.w - i.left - i.right),
    h: Math.max(0, r.h - i.top - i.bottom)
  };
}

/** Grow by an inset. */
export function outset(r, by) {
  const i = normalizeInset(by);
  return { x: r.x - i.left, y: r.y - i.top, w: r.w + i.left + i.right, h: r.h + i.top + i.bottom };
}

export function intersect(a, b) {
  const l = Math.max(a.x, b.x);
  const t = Math.max(a.y, b.y);
  const r = Math.min(right(a), right(b));
  const bo = Math.min(bottom(a), bottom(b));
  return { x: l, y: t, w: Math.max(0, r - l), h: Math.max(0, bo - t) };
}

export function union(a, b) {
  const l = Math.min(a.x, b.x);
  const t = Math.min(a.y, b.y);
  return { x: l, y: t, w: Math.max(right(a), right(b)) - l, h: Math.max(bottom(a), bottom(b)) - t };
}

export function intersects(a, b) {
  return a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y;
}

/**
 * Move `r` so it lies inside `bounds`, without resizing.
 *
 * `keepVisible` leaves a margin that must stay on screen, so a floating window
 * can hang off an edge but never become impossible to grab (§7.7).
 */
export function clamp(r, bounds, keepVisible) {
  const keep = keepVisible || 0;
  const minX = bounds.x - r.w + Math.max(keep, 0);
  const maxX = right(bounds) - Math.max(keep, 0);
  const minY = bounds.y - r.h + Math.max(keep, 0);
  const maxY = bottom(bounds) - Math.max(keep, 0);
  return {
    x: keep ? Math.min(Math.max(r.x, minX), maxX) : Math.min(Math.max(r.x, bounds.x), right(bounds) - r.w),
    y: keep ? Math.min(Math.max(r.y, minY), maxY) : Math.min(Math.max(r.y, bounds.y), bottom(bounds) - r.h),
    w: r.w,
    h: r.h
  };
}

export function containsPoint(r, p) {
  return p.x >= r.x && p.x <= right(r) && p.y >= r.y && p.y <= bottom(r);
}

export function containsRect(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    right(inner) <= right(outer) &&
    bottom(inner) <= bottom(outer)
  );
}

export function equals(a, b, epsilon) {
  if (!a || !b) return a === b;
  const e = epsilon == null ? 0.01 : epsilon;
  return (
    Math.abs(a.x - b.x) <= e &&
    Math.abs(a.y - b.y) <= e &&
    Math.abs(a.w - b.w) <= e &&
    Math.abs(a.h - b.h) <= e
  );
}

export function translate(r, dx, dy) {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
}

export function withSize(r, w, h) {
  return { x: r.x, y: r.y, w, h };
}

export function copy(r) {
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

export function freeze(r) {
  return Object.freeze({ x: r.x, y: r.y, w: r.w, h: r.h });
}

export function isEmpty(r) {
  return !r || r.w <= 0 || r.h <= 0;
}

export function area(r) {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

// ── Insets ───────────────────────────────────────────────────────────────

export function insetOf(top, right, bottom, left) {
  return { top, right, bottom, left };
}

export const NO_INSET = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** Accept a number, `{x, y}`, a partial `Inset`, or an array of 1–4 numbers. */
export function normalizeInset(value) {
  if (value == null || value === false) return NO_INSET;
  if (typeof value === "number") return { top: value, right: value, bottom: value, left: value };
  if (Array.isArray(value)) {
    const [a, b = a, c = a, d = b] = value;
    return { top: a, right: b, bottom: c, left: d };
  }
  if (typeof value === "object") {
    if ("x" in value || "y" in value) {
      const x = value.x || 0;
      const y = value.y || 0;
      return { top: y, right: x, bottom: y, left: x };
    }
    return {
      top: value.top || 0,
      right: value.right || 0,
      bottom: value.bottom || 0,
      left: value.left || 0
    };
  }
  return NO_INSET;
}

/**
 * Compose inset contributions by **max per edge, not by sum** (§5.7).
 *
 * Two overlays both claiming 16px from the bottom should yield 16, not 32.
 */
export function maxInsets(list) {
  const out = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const raw of list) {
    const i = normalizeInset(raw);
    if (i.top > out.top) out.top = i.top;
    if (i.right > out.right) out.right = i.right;
    if (i.bottom > out.bottom) out.bottom = i.bottom;
    if (i.left > out.left) out.left = i.left;
  }
  return out;
}

export function addInsets(a, b) {
  const x = normalizeInset(a);
  const y = normalizeInset(b);
  return {
    top: x.top + y.top,
    right: x.right + y.right,
    bottom: x.bottom + y.bottom,
    left: x.left + y.left
  };
}

export function insetsEqual(a, b) {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}
