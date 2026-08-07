/**
 * Rect algebra, anchors, insets, coordinate spaces, and constraint resolution
 * (§5.1, §5.4–§5.8). All pure, all DOM-free.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { quiet, roundRect } from "./helpers.mjs";
import * as R from "../../source/geometry/rect.js";
import {
  anchorPoint,
  edgesOf,
  insetOffset,
  normalizeKeyword,
  place,
  resolveAnchor
} from "../../source/geometry/anchor.js";
import { InsetStack } from "../../source/geometry/insets.js";
import { axisSpecs, checkPercentageCycle, resolveAxis } from "../../source/geometry/constraints.js";
import {
  applyMatrix,
  convertPoint,
  identity,
  invertMatrix,
  isAxisAligned,
  multiply,
  parseMatrix
} from "../../source/geometry/spaces.js";

// ── Rect ─────────────────────────────────────────────────────────────────

test("rect: derived edges", () => {
  const r = R.rect(10, 20, 100, 50);
  assert.equal(R.left(r), 10);
  assert.equal(R.top(r), 20);
  assert.equal(R.right(r), 110);
  assert.equal(R.bottom(r), 70);
  assert.equal(R.centerX(r), 60);
  assert.equal(R.centerY(r), 45);
});

test("rect: inset and outset", () => {
  const r = R.rect(0, 0, 100, 100);
  assert.deepEqual(R.inset(r, 10), { x: 10, y: 10, w: 80, h: 80 });
  assert.deepEqual(R.inset(r, { top: 5, left: 5 }), { x: 5, y: 5, w: 95, h: 95 });
  assert.deepEqual(R.outset(r, 10), { x: -10, y: -10, w: 120, h: 120 });
  assert.deepEqual(R.inset(r, 200), { x: 200, y: 200, w: 0, h: 0 }, "never negative");
});

test("rect: intersect, union, intersects", () => {
  const a = R.rect(0, 0, 100, 100);
  const b = R.rect(50, 50, 100, 100);
  assert.deepEqual(R.intersect(a, b), { x: 50, y: 50, w: 50, h: 50 });
  assert.deepEqual(R.union(a, b), { x: 0, y: 0, w: 150, h: 150 });
  assert.equal(R.intersects(a, b), true);
  assert.equal(R.intersects(a, R.rect(200, 200, 10, 10)), false);
  assert.deepEqual(R.intersect(a, R.rect(200, 200, 10, 10)), { x: 200, y: 200, w: 0, h: 0 });
});

test("rect: clamp keeps a box inside its bounds", () => {
  const bounds = R.rect(0, 0, 200, 200);
  assert.deepEqual(R.clamp(R.rect(-50, -50, 100, 100), bounds), { x: 0, y: 0, w: 100, h: 100 });
  assert.deepEqual(R.clamp(R.rect(300, 300, 100, 100), bounds), { x: 100, y: 100, w: 100, h: 100 });
});

test("rect: keepVisible lets a window hang off an edge but stay grabbable", () => {
  const bounds = R.rect(0, 0, 200, 200);
  const clamped = R.clamp(R.rect(-300, 10, 100, 40), bounds, 24);
  assert.equal(clamped.x, -76, "24px of the window stays on screen");
});

test("rect: equality uses an epsilon", () => {
  assert.equal(R.equals(R.rect(0, 0, 10, 10), R.rect(0.005, 0, 10, 10)), true);
  assert.equal(R.equals(R.rect(0, 0, 10, 10), R.rect(0.5, 0, 10, 10)), false);
});

test("insets: compose by max per edge, never by sum", () => {
  const composed = R.maxInsets([{ bottom: 16 }, { bottom: 16 }, { top: 44 }]);
  assert.deepEqual(composed, { top: 44, right: 0, bottom: 16, left: 0 });
});

test("insets: normalize accepts numbers, pairs, arrays, and partials", () => {
  assert.deepEqual(R.normalizeInset(8), { top: 8, right: 8, bottom: 8, left: 8 });
  assert.deepEqual(R.normalizeInset({ x: 4, y: 8 }), { top: 8, right: 4, bottom: 8, left: 4 });
  assert.deepEqual(R.normalizeInset([1, 2, 3, 4]), { top: 1, right: 2, bottom: 3, left: 4 });
  assert.deepEqual(R.normalizeInset([1, 2]), { top: 1, right: 2, bottom: 1, left: 2 });
  assert.deepEqual(R.normalizeInset(false), R.NO_INSET);
});

// ── The inset stack ──────────────────────────────────────────────────────

test("inset stack: named contributions, opt-out, and filtering", () => {
  const stack = new InsetStack();
  const metrics = { safe: { top: 44, right: 0, bottom: 34, left: 0 } };
  stack.set("safe", "env(safe-area-inset-*)");
  stack.set("chrome", { top: 48 });
  stack.set("keyboard", { bottom: 300 });

  assert.deepEqual(stack.compose(metrics), { top: 48, right: 0, bottom: 300, left: 0 });
  assert.deepEqual(stack.compose(metrics, ["safe"]), { top: 44, right: 0, bottom: 34, left: 0 });
  assert.deepEqual(stack.compose(metrics, false), R.NO_INSET);
  assert.deepEqual(stack.names(), ["safe", "chrome", "keyboard"]);

  stack.delete("keyboard");
  assert.deepEqual(stack.compose(metrics), { top: 48, right: 0, bottom: 34, left: 0 });
});

test("inset stack: a function contribution is re-resolved each frame", () => {
  const stack = new InsetStack();
  let height = 0;
  stack.set("keyboard", () => ({ bottom: height }));
  assert.equal(stack.compose({}).bottom, 0);
  height = 260;
  assert.equal(stack.compose({}).bottom, 260);
});

// ── Anchors ──────────────────────────────────────────────────────────────

test("anchor: keywords resolve to fractions", () => {
  assert.deepEqual(resolveAnchor("top-left"), { fx: 0, fy: 0, dx: 0, dy: 0 });
  assert.deepEqual(resolveAnchor("center"), { fx: 0.5, fy: 0.5, dx: 0, dy: 0 });
  assert.deepEqual(resolveAnchor("bottom-right"), { fx: 1, fy: 1, dx: 0, dy: 0 });
});

test("anchor: normalized, absolute, and mixed pairs", () => {
  assert.deepEqual(resolveAnchor([0.5, 0.5]), { fx: 0.5, fy: 0.5, dx: 0, dy: 0 });
  assert.deepEqual(resolveAnchor(["16px", "16px"]), { fx: 0, fy: 0, dx: 16, dy: 16 });
  assert.deepEqual(resolveAnchor(["100%", 0.5]), { fx: 1, fy: 0.5, dx: 0, dy: 0 });
});

test("anchor: an unknown keyword reports MK1008 and falls back", () => {
  const seen = quiet();
  assert.deepEqual(resolveAnchor("north-by-northwest"), { fx: 0, fy: 0, dx: 0, dy: 0 });
  assert.ok(seen.has("MK1008"));
  seen.restore();
});

test("anchor: logical spellings flip under RTL", () => {
  assert.equal(normalizeKeyword("block-start inline-start", {}), "top-left");
  assert.equal(normalizeKeyword("block-start inline-start", { direction: "rtl" }), "top-right");
  assert.equal(normalizeKeyword("top-left", { direction: "rtl" }), "top-left", "physical stays physical");
});

test("anchor: anchorPoint on a box", () => {
  const box = R.rect(10, 10, 100, 50);
  assert.deepEqual(anchorPoint(box, "center"), { x: 60, y: 35 });
  assert.deepEqual(anchorPoint(box, "bottom-right"), { x: 110, y: 60 });
});

test("place: §5.9's centred modal", () => {
  const viewport = R.rect(0, 0, 1000, 800);
  const box = place(viewport, { w: 800, h: 680 }, { at: "center" });
  assert.deepEqual(roundRect(box), [100, 60, 800, 680]);
});

test("place: anchor defaults to `at`, which is what makes HUD placement one property", () => {
  const frame = R.rect(0, 0, 1000, 800);
  assert.deepEqual(roundRect(place(frame, { w: 200, h: 100 }, { at: "top-right" })), [800, 0, 200, 100]);
  assert.deepEqual(roundRect(place(frame, { w: 200, h: 100 }, { at: "bottom" })), [400, 700, 200, 100]);
});

test("place: offset is always in screen axis direction (D2)", () => {
  const frame = R.rect(0, 0, 1000, 800);
  const box = place(frame, { w: 200, h: 100 }, { at: "top-right", offset: [-16, 16] });
  assert.deepEqual(roundRect(box), [784, 16, 200, 100]);
});

test("inset: 16px in from every edge the anchor touches, in the right direction", () => {
  assert.deepEqual(insetOffset("top-right", 16), { x: -16, y: 16 });
  assert.deepEqual(insetOffset("bottom-left", 16), { x: 16, y: -16 });
  assert.deepEqual(insetOffset("center", 16), { x: 0, y: 0 }, "centre touches no edge");
  assert.deepEqual(insetOffset("bottom", { bottom: 24 }), { x: 0, y: -24 });
});

test("edgesOf reports which edges a keyword touches", () => {
  assert.deepEqual(edgesOf("top-right"), { top: true, bottom: false, left: false, right: true });
});

// ── Edge constraints (§5.6, §5.8) ────────────────────────────────────────

const basis = { basis: 1000, lenCtx: { basis: 1000, metrics: { vw: 1000, vh: 800, rem: 16 } } };

test("constraints: two of three is fully determined", () => {
  assert.deepEqual(pick(resolveAxis({ start: 0, size: 320 }, basis)), [0, 320]);
  assert.deepEqual(pick(resolveAxis({ end: 0, size: 320 }, basis)), [680, 320]);
  assert.deepEqual(pick(resolveAxis({ start: 100, end: 100 }, basis)), [100, 800]);
});

test("constraints: percentages resolve against the basis", () => {
  assert.deepEqual(pick(resolveAxis({ start: 0, size: "80%" }, basis)), [0, 800]);
});

test("constraints: three of three drops size and stretches (§5.8)", () => {
  const seen = quiet();
  const result = resolveAxis({ start: 0, end: 0, size: 320 }, basis);
  assert.deepEqual(pick(result), [0, 1000]);
  assert.deepEqual(result.dropped, ["size"]);
  assert.ok(seen.has("MK1003"));
  seen.restore();
});

test("constraints: an explicit priority chooses a different victim", () => {
  const seen = quiet();
  const result = resolveAxis(
    { start: 0, end: 0, size: 320, priority: { end: "weak" } },
    basis
  );
  assert.deepEqual(result.dropped, ["end"]);
  assert.deepEqual(pick(result), [0, 320]);
  seen.restore();
});

test("constraints: one of three resolves the rest from intrinsic size", () => {
  assert.deepEqual(pick(resolveAxis({ size: 320 }, basis)), [0, 320]);
  assert.deepEqual(pick(resolveAxis({ start: 40 }, { ...basis, intrinsic: 120 })), [40, 120]);
  assert.deepEqual(pick(resolveAxis({ end: 40 }, { ...basis, intrinsic: 120 })), [840, 120]);
});

test("constraints: nothing given falls through to the parent algorithm", () => {
  assert.equal(resolveAxis({}, basis).mode, "flow");
});

test("constraints: min and max are required and applied after solving", () => {
  assert.deepEqual(pick(resolveAxis({ start: 0, size: 320, min: 400 }, basis)), [0, 400]);
  assert.deepEqual(pick(resolveAxis({ start: 0, size: 320, max: 200 }, basis)), [0, 200]);
  assert.deepEqual(
    pick(resolveAxis({ start: 0, size: "80%", max: "40%" }, basis)),
    [0, 400],
    "bounds resolve against the same basis as the value they bound"
  );
});

test("constraints: clamping an end-anchored box keeps the end edge", () => {
  assert.deepEqual(pick(resolveAxis({ end: 0, size: 320, max: 200 }, basis)), [800, 200]);
});

test("constraints: §5.6's three worked shapes", () => {
  const seen = quiet();
  // pinned bottom-right, sized to content
  assert.deepEqual(pick(resolveAxis({ end: 24 }, { ...basis, intrinsic: 100 })), [876, 100]);
  // a full-height right rail — over-constrained on the vertical axis by design
  const rail = resolveAxis({ start: 0, end: 0, size: 320 }, basis);
  assert.deepEqual(rail.dropped, ["size"]);
  // a bar spanning the top
  assert.deepEqual(pick(resolveAxis({ start: 0, end: 0 }, basis)), [0, 1000]);
  seen.restore();
});

test("axisSpecs: splits an authored bag into two per-axis specs", () => {
  const specs = axisSpecs({ size: { w: "80%", h: "85%" }, left: 10, min: { w: 100 } });
  assert.equal(specs.x.size, "80%");
  assert.equal(specs.x.start, 10);
  assert.equal(specs.x.min, 100);
  assert.equal(specs.y.size, "85%");
});

test("axisSpecs: logical inline edges flip under RTL", () => {
  const ltr = axisSpecs({ inlineStart: 16 }, { direction: "ltr" });
  const rtl = axisSpecs({ inlineStart: 16 }, { direction: "rtl" });
  assert.equal(ltr.x.start, 16);
  assert.equal(rtl.x.end, 16);
});

test("constraints: a percentage against an intrinsic container is MK1004", () => {
  const seen = quiet();
  assert.equal(checkPercentageCycle("50%", true, "pane#a"), true);
  assert.ok(seen.has("MK1004"));
  assert.equal(checkPercentageCycle("50%", false, "pane#b"), false);
  seen.restore();
});

function pick(result) {
  return [Math.round(result.start * 100) / 100, Math.round(result.size * 100) / 100];
}

// ── Coordinate spaces (§5.4) ─────────────────────────────────────────────

test("spaces: document ↔ viewport accounts for scroll", () => {
  const refs = { scroll: { x: 0, y: 200 } };
  assert.deepEqual(convertPoint({ x: 10, y: 10 }, "document", "viewport", refs), { x: 10, y: -190 });
  assert.deepEqual(convertPoint({ x: 10, y: -190 }, "viewport", "document", refs), { x: 10, y: 10 });
});

test("spaces: frame space is relative to the container's box", () => {
  const refs = { frame: { x: 100, y: 50 } };
  assert.deepEqual(convertPoint({ x: 0, y: 0 }, "frame", "viewport", refs), { x: 100, y: 50 });
});

test("spaces: matrices compose, invert, and report axis alignment", () => {
  const translate = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 };
  const scale = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
  const composed = multiply(translate, scale);
  assert.deepEqual(applyMatrix(composed, { x: 5, y: 5 }), { x: 20, y: 30 });

  const inverse = invertMatrix(composed);
  assert.deepEqual(applyMatrix(inverse, { x: 20, y: 30 }), { x: 5, y: 5 });

  assert.equal(isAxisAligned(composed), true);
  assert.equal(isAxisAligned({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }), false, "a rotation is not");
  assert.equal(invertMatrix({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }), null, "singular");
});

test("spaces: parseMatrix understands both CSS spellings", () => {
  assert.deepEqual(parseMatrix("none"), identity());
  assert.deepEqual(parseMatrix("matrix(1, 0, 0, 1, 10, 20)"), { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
  const m3d = parseMatrix("matrix3d(2,0,0,0, 0,2,0,0, 0,0,1,0, 8,9,0,1)");
  assert.deepEqual(m3d, { a: 2, b: 0, c: 0, d: 2, e: 8, f: 9 });
});
