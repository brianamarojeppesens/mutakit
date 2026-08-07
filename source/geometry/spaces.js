/**
 * Coordinate spaces and conversion (§5.4).
 *
 * Every geometric value carries an implicit space; conversions are explicit.
 * Mutakit works entirely in CSS pixels — device pixel ratio and browser zoom
 * are deliberately not modelled, and a plugin that needs device pixels reads
 * `devicePixelRatio` itself and is told when it changes by `metrics:change`.
 */
import "../core/dev.js";
import { warn } from "../core/diagnostics.js";

export const SPACES = ["viewport", "document", "layer", "frame", "element"];

/**
 * Convert a point between spaces. `refs` supplies the rects that define each
 * space for the node in question: `{ viewport, document, layer, frame,
 * element, scroll }`.
 */
export function convertPoint(p, from, to, refs) {
  if (from === to) return { x: p.x, y: p.y };
  const inViewport = toViewport(p, from, refs);
  return fromViewport(inViewport, to, refs);
}

export function convertRect(r, from, to, refs) {
  const origin = convertPoint({ x: r.x, y: r.y }, from, to, refs);
  return { x: origin.x, y: origin.y, w: r.w, h: r.h };
}

function originOf(space, refs) {
  switch (space) {
    case "viewport":
      return { x: 0, y: 0 };
    case "document":
      return { x: -(refs.scroll ? refs.scroll.x : 0), y: -(refs.scroll ? refs.scroll.y : 0) };
    case "layer":
      return refs.layer ? { x: refs.layer.x, y: refs.layer.y } : { x: 0, y: 0 };
    case "frame":
      return refs.frame ? { x: refs.frame.x, y: refs.frame.y } : { x: 0, y: 0 };
    case "element":
      return refs.element ? { x: refs.element.x, y: refs.element.y } : { x: 0, y: 0 };
    default:
      warn("MK1007", __MK_DEV__ &&
        `unknown coordinate space '${space}'`, { subject: space });
      return { x: 0, y: 0 };
  }
}

function toViewport(p, from, refs) {
  const origin = originOf(from, refs);
  return { x: p.x + origin.x, y: p.y + origin.y };
}

function fromViewport(p, to, refs) {
  const origin = originOf(to, refs);
  return { x: p.x - origin.x, y: p.y - origin.y };
}

/**
 * Compose the accumulated transform of an ancestor chain.
 *
 * Elements under a rotated or scaled ancestor are supported for hit testing
 * and dragging; layout math assumes axis-aligned parents and warns otherwise
 * (D6). `chain` is a list of `DOMMatrix`-like objects, outermost first.
 */
export function composeMatrix(chain) {
  let m = identity();
  for (const step of chain) m = multiply(m, step);
  return m;
}

export function identity() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

export function multiply(m, n) {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f
  };
}

export function applyMatrix(m, p) {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export function invertMatrix(m) {
  const determinant = m.a * m.d - m.b * m.c;
  if (Math.abs(determinant) < 1e-12) return null;
  return {
    a: m.d / determinant,
    b: -m.b / determinant,
    c: -m.c / determinant,
    d: m.a / determinant,
    e: (m.c * m.f - m.d * m.e) / determinant,
    f: (m.b * m.e - m.a * m.f) / determinant
  };
}

/** True when the matrix only translates and scales — the layout assumption. */
export function isAxisAligned(m) {
  return Math.abs(m.b) < 1e-6 && Math.abs(m.c) < 1e-6;
}

/** Parse a CSS transform matrix string into the shape used here. */
export function parseMatrix(text) {
  if (!text || text === "none") return identity();
  const match = /^matrix\(([^)]+)\)/.exec(text);
  if (match) {
    const [a, b, c, d, e, f] = match[1].split(",").map((n) => parseFloat(n));
    return { a, b, c, d, e, f };
  }
  const match3d = /^matrix3d\(([^)]+)\)/.exec(text);
  if (match3d) {
    const n = match3d[1].split(",").map((v) => parseFloat(v));
    return { a: n[0], b: n[1], c: n[4], d: n[5], e: n[12], f: n[13] };
  }
  return identity();
}
