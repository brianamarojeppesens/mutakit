/**
 * Signals, the schema vocabulary, SemVer ranges, the registry, invalidation,
 * and node identity — the DOM-free half of the kernel and engine
 * (§15.1, §8.1, §8.4, §8.9, §6.2).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { quiet } from "./helpers.mjs";
import {
  batch,
  computed,
  effect,
  flushEffects,
  isSignal,
  setEffectScheduler,
  signal,
  untrack
} from "../../source/core/signals.js";
import { satisfies } from "../../source/core/semver.js";
import { defaultsOf, normalizeSchema, validateAll, validateValue } from "../../source/core/schema.js";
import { Registry } from "../../source/core/registry.js";
import { resolveDefinition } from "../../source/core/define.js";
import { conformance } from "../../source/core/conformance.js";
import { LayoutNode } from "../../source/engine/node.js";
import { ARRANGE, MEASURE, PAINT, STYLE, invalidate, isDirty } from "../../source/engine/invalidate.js";

// ── Signals (§15.1) ──────────────────────────────────────────────────────

test("signal: read, write, and identity-based change detection", () => {
  const count = signal(0);
  assert.equal(count(), 0);
  count(5);
  assert.equal(count(), 5);
  count((n) => n + 1);
  assert.equal(count(), 6);
  assert.equal(isSignal(count), true);
  assert.equal(isSignal(() => 1), false);
});

test("computed: derives lazily and caches", () => {
  const base = signal(2);
  let runs = 0;
  const doubled = computed(() => {
    runs++;
    return base() * 2;
  });
  assert.equal(doubled(), 4);
  assert.equal(doubled(), 4);
  assert.equal(runs, 1, "a second read of an unchanged graph recomputes nothing");
  base(3);
  assert.equal(doubled(), 6);
  assert.equal(runs, 2);
});

test("effect: runs immediately, then on every dependency change", () => {
  const value = signal("a");
  const seen = [];
  const dispose = effect(() => seen.push(value()));
  assert.deepEqual(seen, ["a"]);
  value("b");
  flushEffects();
  assert.deepEqual(seen, ["a", "b"]);
  dispose();
  value("c");
  flushEffects();
  assert.deepEqual(seen, ["a", "b"], "a disposed effect is off the graph");
});

test("effect: propagation is glitch-free", () => {
  // The classic diamond: `sum` must never be observed at an intermediate
  // value, which is exactly what mark-then-pull buys.
  const base = signal(1);
  const a = computed(() => base() + 1);
  const b = computed(() => base() * 10);
  const seen = [];
  effect(() => seen.push(a() + b()));
  base(2);
  flushEffects();
  assert.deepEqual(seen, [12, 23], "one run per change, never a torn read");
});

test("batch: coalesces writes into a single effect run", () => {
  const x = signal(1);
  const y = signal(2);
  let runs = 0;
  effect(() => {
    x();
    y();
    runs++;
  });
  assert.equal(runs, 1);
  batch(() => {
    x(10);
    y(20);
  });
  flushEffects();
  assert.equal(runs, 2, "two writes, one run");
});

test("untrack: reads without subscribing", () => {
  const tracked = signal(1);
  const hidden = signal(1);
  let runs = 0;
  effect(() => {
    tracked();
    untrack(() => hidden());
    runs++;
  });
  hidden(2);
  flushEffects();
  assert.equal(runs, 1);
  tracked(2);
  flushEffects();
  assert.equal(runs, 2);
});

test("effect: cleanups run before each re-run and on dispose", () => {
  const value = signal(1);
  const log = [];
  const dispose = effect(() => {
    const current = value();
    log.push(`run:${current}`);
    return () => log.push(`clean:${current}`);
  });
  value(2);
  flushEffects();
  dispose();
  assert.deepEqual(log, ["run:1", "clean:1", "run:2", "clean:2"]);
});

test("effect: nested effects are owned and disposed with the parent", () => {
  const outer = signal(1);
  let innerRuns = 0;
  const dispose = effect(() => {
    outer();
    effect(() => {
      innerRuns++;
    });
  });
  assert.equal(innerRuns, 1);
  outer(2);
  flushEffects();
  assert.equal(innerRuns, 2, "the old inner effect was disposed, a new one created");
  dispose();
});

test("scheduler hook: effects defer until the host flushes them", () => {
  let armed = 0;
  setEffectScheduler(() => armed++);
  const value = signal(0);
  let runs = 0;
  effect(() => {
    value();
    runs++;
  });
  value(1);
  assert.equal(runs, 1, "nothing ran yet — the host owns the STATE phase");
  assert.equal(armed, 1);
  flushEffects();
  assert.equal(runs, 2);
  setEffectScheduler(null);
});

// ── SemVer (§8.4) ────────────────────────────────────────────────────────

test("semver: caret, tilde, comparators, and wildcards", () => {
  const cases = [
    ["1.2.3", "^1.0.0", true],
    ["2.0.0", "^1.0.0", false],
    ["0.2.5", "^0.2.0", true],
    ["0.3.0", "^0.2.0", false],
    ["1.2.9", "~1.2.0", true],
    ["1.3.0", "~1.2.0", false],
    ["2.5.0", "^2", true],
    ["3.0.0", "^2", false],
    ["1.0.0", ">=1.0.0", true],
    ["0.9.9", ">=1.0.0", false],
    ["1.0.0", "*", true],
    ["1.2.3", "1.2.3", true],
    ["1.2.4", "1.2.3", false],
    ["1.2.4", "1.2", true],
    ["1.5.0", ">=1.0.0 <2.0.0", true],
    ["2.5.0", ">=1.0.0 <2.0.0", false],
    ["2.5.0", "^1 || ^2", true],
    ["1.0.0-beta.1", "^1.0.0", false]
  ];
  for (const [version, range, expected] of cases) {
    assert.equal(satisfies(version, range), expected, `${version} vs ${range}`);
  }
});

// ── Prop schemas (§8.1) ──────────────────────────────────────────────────

test("schema: coercion and bounds per type", () => {
  const schema = normalizeSchema({
    value: { type: "number", default: 0, min: 0, max: 1 },
    count: { type: "number", integer: true },
    label: { type: "string", default: "" },
    open: { type: "boolean", default: false },
    variant: { type: "enum", values: ["arc", "bar"], default: "arc" },
    tags: { type: "array", of: "string", max: 2 }
  });

  assert.equal(validateValue(schema.value, "0.5").value, 0.5);
  assert.ok(validateValue(schema.value, 2).error);
  assert.ok(validateValue(schema.count, 1.5).error);
  assert.equal(validateValue(schema.label, 42).value, "42");
  assert.equal(validateValue(schema.open, "false").value, false, "the attribute spelling");
  assert.ok(validateValue(schema.variant, "dial").error);
  assert.ok(validateValue(schema.tags, ["a", "b", "c"]).error);
  assert.deepEqual(validateValue(schema.tags, ["a", "b"]).value, ["a", "b"]);
});

test("schema: a `len` accepts every §5.2 spelling, and a function", () => {
  const len = normalizeSchema({ size: { type: "len" } }).size;
  for (const value of [120, "120px", "50%", "1fr", "auto", "calc(100% - 2rem)"]) {
    assert.equal(validateValue(len, value).error, undefined, String(value));
  }
  assert.equal(typeof validateValue(len, () => 1).value, "function");
  assert.ok(validateValue(len, {}).error);
});

test("schema: required, defaults, and format", () => {
  const schema = normalizeSchema({
    email: { type: "string", required: true, format: "email" },
    port: { type: "number", default: 8080 }
  });
  assert.ok(validateValue(schema.email, undefined).error);
  assert.ok(validateValue(schema.email, "nope").error);
  assert.equal(validateValue(schema.email, "a@b.co").value, "a@b.co");
  assert.deepEqual({ ...defaultsOf(schema) }, { port: 8080 });
});

test("schema: unknown keys are reported but retained (§7.0)", () => {
  const schema = normalizeSchema({ size: { type: "len", default: "1fr" } });
  const strict = validateAll(schema, { size: 100, units: 2 }, { strict: true });
  assert.deepEqual(strict.unknown, ["units"]);
  assert.equal(strict.values.units, undefined, "strict does not merge it back");
  const loose = validateAll(schema, { size: 100, units: 2 }, { strict: false });
  assert.equal(loose.values.units, 2);
});

// ── Registry (§8.4, §8.6) ────────────────────────────────────────────────

test("registry: inheritance by reference, with own registrations shadowing", () => {
  const global = new Registry(null);
  global.set("type", "pane", { type: "pane", version: "1.0.0" });
  const child = new Registry(global);
  assert.equal(child.get("type", "pane").version, "1.0.0");

  child.set("type", "pane", { type: "pane", version: "2.0.0" }, { replace: true });
  assert.equal(child.get("type", "pane").version, "2.0.0");
  assert.equal(global.get("type", "pane").version, "1.0.0", "the parent is untouched");

  const isolated = new Registry(null);
  assert.equal(isolated.get("type", "pane"), undefined, "inherit: false means nothing");
});

test("registry: re-registration without replace throws MK4001 in development", () => {
  const seen = quiet();
  const registry = new Registry(null);
  registry.set("trait", "draggable", { name: "draggable", version: "1.0.0" });
  assert.throws(
    () => registry.set("trait", "draggable", { name: "draggable", version: "2.0.0" }),
    /MK4001/,
    "an accidental collision has to be loud"
  );
  // A deliberate override is allowed, and says what it replaced.
  registry.set("trait", "draggable", { name: "draggable", version: "2.0.0" }, { replace: true });
  assert.equal(registry.get("trait", "draggable").version, "2.0.0");
  assert.ok(seen.has("MK4001"));
  seen.restore();
});

test("registry: list() reports names, versions, and origins", () => {
  const registry = new Registry(null);
  registry.set("type", "acme:gauge", { version: "1.2.0", origin: "acme-widgets" });
  const listed = registry.list().type;
  assert.deepEqual(listed, [{ name: "acme:gauge", version: "1.2.0", origin: "acme-widgets", own: true }]);
});

// ── Definitions and conformance (§8.3, §8.7) ─────────────────────────────

test("define: extends merges props and chains lifecycle hooks", () => {
  const seen = quiet();
  const base = resolveDefinition(
    {
      type: "surface",
      props: { elevation: { type: "number", default: 1 } },
      traits: ["focusable"],
      a11y: { role: "group" },
      create() {},
      mount() {}
    },
    null,
    {}
  );
  const child = resolveDefinition(
    {
      type: "dialog",
      extends: "surface",
      props: { title: { type: "string", default: "" } },
      traits: ["focus-trap"],
      mount() {}
    },
    base,
    {}
  );

  assert.deepEqual(Object.keys(child.props).sort(), ["elevation", "title"]);
  assert.deepEqual(child.traits, ["focusable", "focus-trap"]);
  assert.equal(child.hooks.mount.length, 2, "the parent's runs first");
  assert.equal(child.hooks.create.length, 1, "inherited unchanged");
  assert.deepEqual(child.a11y, { role: "group" });
  seen.restore();
});

test("define: a type with no a11y declaration is MK3006", () => {
  const seen = quiet();
  resolveDefinition({ type: "acme:thing", create() {} }, null, {});
  assert.ok(seen.has("MK3006"));
  seen.restore();
});

test("conformance: catches an undeclared emit and a missing keyboard path", () => {
  const findings = conformance({
    type: "acme:gauge",
    a11y: { role: "meter" },
    events: ["change"],
    traits: ["draggable"],
    create(ctx) {
      ctx.emit("overload", {});
    }
  });
  const codes = findings.map((f) => f.code);
  assert.ok(codes.includes("MK3003"), "undeclared 'overload'");
  assert.ok(codes.includes("MK6001"), "a pointer trait with no keys");
});

test("conformance: catches a listener that bypasses ctx.own", () => {
  const findings = conformance({
    type: "acme:leaky",
    a11y: "presentation",
    create(ctx) {
      ctx.el.addEventListener("click", () => {});
    }
  });
  assert.ok(findings.some((f) => f.code === "MK3007"));
});

test("conformance: a clean definition reports nothing", () => {
  const findings = conformance({
    type: "acme:clean",
    a11y: { role: "meter" },
    events: ["change"],
    create(ctx) {
      ctx.own(() => {});
      ctx.emit("change", {});
    }
  });
  assert.deepEqual(findings, []);
});

// ── Invalidation (§6.2) ──────────────────────────────────────────────────

function tree() {
  const root = new LayoutNode("root");
  const parent = new LayoutNode("pane", { id: "main" });
  const child = new LayoutNode("pane");
  root.insert(parent);
  parent.insert(child);
  for (const node of [root, parent, child]) node.flags = 0;
  return { root, parent, child };
}

test("invalidate: STYLE and PAINT stay on the node", () => {
  const { parent, child } = tree();
  invalidate(parent, "style");
  assert.equal(isDirty(parent, STYLE), true);
  assert.equal(isDirty(child, STYLE), false);

  invalidate(parent, "paint");
  assert.equal(isDirty(parent, PAINT), true);
  assert.equal(isDirty(child, PAINT), false);
});

test("invalidate: ARRANGE propagates down the subtree", () => {
  const { root, parent, child } = tree();
  invalidate(parent, "arrange");
  assert.equal(isDirty(child, ARRANGE), true);
  assert.equal(isDirty(root, ARRANGE), false, "and never up");
});

test("invalidate: MEASURE propagates up to the nearest fixed-size ancestor", () => {
  const { root, parent, child } = tree();
  parent.sizeIsFixed = true;
  invalidate(child, "measure");
  assert.equal(isDirty(child, MEASURE), true);
  assert.equal(isDirty(parent, MEASURE), true);
  assert.equal(isDirty(root, MEASURE), false, "the fixed-size parent absorbs it");
});

test("invalidate: setting a bit twice is free", () => {
  const { parent } = tree();
  assert.equal(invalidate(parent, "style"), true);
  assert.equal(invalidate(parent, "style"), false, "no change, so nothing is armed");
});

// ── Node identity (§8.9) ─────────────────────────────────────────────────

test("node: path keys use ids where present and indices otherwise", () => {
  const root = new LayoutNode("root");
  const split = new LayoutNode("split");
  const pane = new LayoutNode("pane", { id: "main" });
  const tabs = new LayoutNode("tabs");
  root.insert(split);
  split.insert(pane);
  pane.insert(new LayoutNode("pane"));
  pane.insert(new LayoutNode("pane"));
  pane.insert(tabs);

  assert.equal(pane.pathKey, "root[-1]/split[0]/pane#main");
  assert.equal(tabs.pathKey, "root[-1]/split[0]/pane#main/tabs[2]");
  assert.equal(pane.persistKey, "main", "id wins for persistence");
  assert.equal(tabs.persistKey, tabs.pathKey);
});

test("node: reordering invalidates cached path keys", () => {
  const root = new LayoutNode("root");
  const a = new LayoutNode("pane");
  const b = new LayoutNode("pane");
  root.insert(a);
  root.insert(b);
  assert.equal(b.pathKey, "root[-1]/pane[1]");
  root.removeChild(b);
  root.insert(b, a);
  assert.equal(b.pathKey, "root[-1]/pane[0]");
});

test("node: disposers run in reverse order", () => {
  const node = new LayoutNode("pane");
  const order = [];
  node.own(() => order.push(1));
  node.own(() => order.push(2));
  node.own(() => order.push(3));
  node.releaseOwned();
  assert.deepEqual(order, [3, 2, 1]);
});

test("node: a throwing disposer does not strand the rest", () => {
  const node = new LayoutNode("pane");
  const order = [];
  const consoleError = console.error;
  console.error = () => {};
  node.own(() => order.push("first"));
  node.own(() => {
    throw new Error("boom");
  });
  node.releaseOwned();
  console.error = consoleError;
  assert.deepEqual(order, ["first"]);
});
