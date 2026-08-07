/**
 * `Len` — the highest-value test surface in the project (§5.10).
 *
 * Geometry is pure, so this whole tier runs under `node:test` with no
 * dependency and no browser: `node --test test/unit/` is the fastest feedback
 * loop here, and it keeps running even where browsers are unavailable (§23.3).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { quiet } from "./helpers.mjs";
import {
  clearCache,
  distributeFr,
  frCoefficient,
  isCSSResolvable,
  isFlexible,
  isIntrinsic,
  parse,
  toCSS,
  toNumber
} from "../../source/geometry/len.js";

const metrics = { vw: 1000, vh: 800, rem: 16, ch: 8, ex: 8, safe: { top: 44, right: 0, bottom: 34, left: 0 } };
const ctx = { basis: 400, metrics };

test("parse: the whole vocabulary of §5.2", () => {
  const cases = [
    [120, { k: "px", v: 120 }],
    ["120px", { k: "px", v: 120 }],
    ["2rem", { k: "unit", v: 2, u: "rem" }],
    ["12ch", { k: "unit", v: 12, u: "ch" }],
    ["50%", { k: "pct", v: 50 }],
    ["3vw", { k: "unit", v: 3, u: "vw" }],
    ["6dvh", { k: "unit", v: 6, u: "dvh" }],
    ["1fr", { k: "fr", v: 1 }],
    ["2.5fr", { k: "fr", v: 2.5 }],
    ["auto", { k: "kw", v: "auto" }],
    ["min-content", { k: "kw", v: "min-content" }],
    ["8gu", { k: "unit", v: 8, u: "gu" }],
    ["-16px", { k: "px", v: -16 }],
    ["1e2px", { k: "px", v: 100 }]
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(parse(input), expected, `parse(${JSON.stringify(input)})`);
  }
});

test("parse: calc unwraps to its expression", () => {
  const ast = parse("calc(100% - 32px)");
  assert.equal(ast.k, "op");
  assert.equal(ast.op, "-");
  assert.deepEqual(ast.a, { k: "pct", v: 100 });
  assert.deepEqual(ast.b, { k: "px", v: 32 });
});

test("parse: nested comparison functions", () => {
  const ast = parse("clamp(64px, 20%, min(300px, 50vw))");
  assert.equal(ast.k, "call");
  assert.equal(ast.name, "clamp");
  assert.equal(ast.args.length, 3);
  assert.equal(ast.args[2].name, "min");
});

test("parse: var() with and without a fallback", () => {
  assert.deepEqual(parse("var(--mk-w)"), { k: "var", name: "--mk-w", fallback: null });
  const withFallback = parse("var(--mk-w, 240px)");
  assert.equal(withFallback.name, "--mk-w");
  assert.deepEqual(withFallback.fallback, { k: "px", v: 240 });
});

test("parse: a function value is carried through untouched", () => {
  const fn = () => 42;
  assert.deepEqual(parse(fn), { k: "js", fn });
});

test("parse: unparseable input falls back to auto and reports MK1002", () => {
  const seen = quiet();
  const ast = parse("120 px %% wat");
  assert.equal(ast.v, "auto");
  assert.equal(ast.invalid, true);
  assert.equal(seen.codes()[0], "MK1002");
  seen.restore();
});

test("parse: results are cached by input string", () => {
  clearCache();
  const first = parse("37px");
  const second = parse("37px");
  assert.equal(first, second, "the same AST object should come back");
});

test("toCSS: round-trips the common forms", () => {
  const cases = [
    [120, "120px"],
    ["50%", "50%"],
    ["1fr", "1fr"],
    ["auto", "auto"],
    ["2rem", "2rem"],
    ["calc(100% - 32px)", "calc(100% - 32px)"],
    ["clamp(64px, 20%, 300px)", "clamp(64px, 20%, 300px)"],
    ["var(--mk-w, 240px)", "var(--mk-w, 240px)"],
    ["min(100%, 480px)", "min(100%, 480px)"]
  ];
  for (const [input, expected] of cases) {
    assert.equal(toCSS(parse(input)), expected, `toCSS(${input})`);
  }
});

test("toCSS: a nested expression parenthesises rather than reassociating", () => {
  assert.equal(toCSS(parse("calc(100% - (32px + 8px))")), "calc(100% - (32px + 8px))");
});

test("toNumber: absolute, relative, and viewport units", () => {
  const cases = [
    [120, 120],
    ["50%", 200],
    ["2rem", 32],
    ["12ch", 96],
    ["10vw", 100],
    ["10vh", 80],
    ["10vmin", 80],
    ["10vmax", 100],
    ["10dvh", 80],
    ["1in", 96],
    ["calc(100% - 32px)", 368],
    ["clamp(64px, 10%, 300px)", 64],
    ["min(100%, 480px)", 400],
    ["max(100%, 480px)", 480]
  ];
  for (const [input, expected] of cases) {
    assert.equal(toNumber(parse(input), ctx), expected, `toNumber(${input})`);
  }
});

test("toNumber: env() reads safe-area insets from the metrics snapshot", () => {
  assert.equal(toNumber(parse("env(safe-area-inset-top)"), ctx), 44);
  assert.equal(toNumber(parse("env(safe-area-inset-left, 12px)"), ctx), 0);
  assert.equal(toNumber(parse("env(unknown-thing, 12px)"), ctx), 12);
});

test("toNumber: fr resolves against free space and the fr total", () => {
  assert.equal(toNumber(parse("1fr"), { ...ctx, free: 300, frTotal: 3 }), 100);
  assert.equal(toNumber(parse("2fr"), { ...ctx, free: 300, frTotal: 3 }), 200);
  assert.equal(toNumber(parse("1fr"), ctx), 0, "no track context means no space");
});

test("toNumber: a custom unit resolves through the registry", () => {
  const units = (name) =>
    name === "gu" ? { toNumber: (v, c) => (v * Math.min(c.metrics.vw, c.metrics.vh)) / 24 } : undefined;
  assert.equal(toNumber(parse("12gu"), { ...ctx, units }), 400);
});

test("toNumber: an unknown unit reports MK1005 and yields NaN", () => {
  const seen = quiet();
  assert.ok(Number.isNaN(toNumber(parse("8zz"), ctx)));
  assert.equal(seen.codes()[0], "MK1005");
  seen.restore();
});

test("toNumber: var() resolves through the lookup, then the fallback", () => {
  const vars = (name) => (name === "--w" ? "240px" : "");
  assert.equal(toNumber(parse("var(--w)"), { ...ctx, vars }), 240);
  assert.equal(toNumber(parse("var(--missing, 30%)"), { ...ctx, vars }), 120);
});

test("toNumber: a computed length is called with the context", () => {
  const ast = parse((c) => c.basis / 2);
  assert.equal(toNumber(ast, ctx), 200);
});

test("queries: flexible, intrinsic, css-resolvable", () => {
  assert.equal(isFlexible(parse("1fr")), true);
  assert.equal(isFlexible(parse("240px")), false);
  assert.equal(frCoefficient(parse("2.5fr")), 2.5);
  assert.equal(frCoefficient(parse("240px")), 0);

  assert.equal(isIntrinsic(parse("auto")), true);
  assert.equal(isIntrinsic(parse("max-content")), true);
  assert.equal(isIntrinsic(parse("calc(auto + 2px)")), true);
  assert.equal(isIntrinsic(parse("50%")), false);

  assert.equal(isCSSResolvable(parse("calc(100% - 2rem)")), true);
  assert.equal(isCSSResolvable(parse(() => 1)), false);
});

test("distributeFr: proportional split of free space", () => {
  assert.deepEqual(distributeFr([{ fr: 1 }, { fr: 2 }, { fr: 1 }], 400), [100, 200, 100]);
});

test("distributeFr: fixed tracks are subtracted before the split", () => {
  assert.deepEqual(distributeFr([{ base: 100 }, { fr: 1 }, { fr: 1 }], 400), [100, 150, 150]);
});

test("distributeFr: clamping redistributes to the tracks still free", () => {
  // Track 0 wants 200 but is capped at 120; the 80 it gives back goes to
  // track 1, which is the fixed-point iteration §5.2 describes.
  assert.deepEqual(distributeFr([{ fr: 1, max: 120 }, { fr: 1 }], 400), [120, 280]);
  assert.deepEqual(distributeFr([{ fr: 1, min: 300 }, { fr: 1 }], 400), [300, 100]);
});

test("distributeFr: every track clamped still sums to what the bounds allow", () => {
  const sizes = distributeFr([{ fr: 1, max: 50 }, { fr: 1, max: 50 }], 400);
  assert.deepEqual(sizes, [50, 50]);
});

test("distributeFr: a non-flexible track honours its own bounds", () => {
  assert.deepEqual(distributeFr([{ base: 800, max: 300 }, { fr: 1 }], 400), [300, 100]);
});
