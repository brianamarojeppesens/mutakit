/**
 * The browser tier (§23.2): element construction, layout snapshots, error
 * isolation, and leaks — everything that needs real layout rather than a
 * simulated DOM.
 *
 * The pure tier lives in `test/unit/` and runs under `node --test`.
 */
import { describe, fakeClock, start, teardown, test } from "./harness.js";
import { Mutakit } from "../source/entries/full.js";
import { persistencePlugin } from "../source/services/persistence.js";
import { counters } from "../source/core/dom.js";

/** Mount a fresh, deterministically sized instance for one test. */
function fixture(t, options) {
  const host = t.sandbox();
  host.style.cssText = "position:relative;width:1000px;height:800px";
  const mk = Mutakit.create({ ...(options || {}) });
  const app = mk.mount(host, { sizing: "fixed", size: { w: 1000, h: 800 } });
  t.cleanup(() => mk.destroyInstance());
  return { mk, app, host };
}

describe("kernel", () => {
  test("the namespace exposes a version and the geometry primitives", (t) => {
    t.equal(typeof Mutakit.VERSION, "string");
    t.ok(Mutakit.geometry.Len.parse, "Len is published for plugin authors");
    t.ok(Mutakit.signal, "signals are part of the surface");
  });

  test("core registers its five Tier A types through the public API", (t) => {
    const types = Mutakit.registry.list().type.map((entry) => entry.name);
    for (const name of ["pane", "surface", "stack", "group", "spacer"]) {
      t.ok(types.includes(name), `${name} is registered`);
    }
  });

  test("two instances do not share mutable state (P8)", (t) => {
    const a = fixture(t);
    const b = fixture(t);
    t.notEqual(a.mk.id, b.mk.id);
    a.mk.define({ type: "acme:only-a", a11y: "presentation", create: (ctx) => ctx.dom("div") });
    t.ok(a.mk.registry.has("type", "acme:only-a"));
    t.equal(b.mk.registry.maps.type.has("acme:only-a"), false, "b's own map is untouched");
  });
});

describe("mount", () => {
  test("a root renders and reports its size", (t) => {
    const { mk, app } = fixture(t);
    mk.tick();
    t.equal(app.node.computed.w, 1000);
    t.equal(app.node.computed.h, 800);
    t.ok(app.el.hasAttribute("data-mk-root"));
  });

  test("a zero-sized element-mode root reports MK1001 rather than rendering nothing", (t) => {
    const records = [];
    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));

    const host = t.sandbox();
    host.style.cssText = "width:0;height:0";
    const mk = Mutakit.create();
    t.cleanup(() => mk.destroyInstance());
    mk.mount(host, { sizing: "element" });
    mk.tick();
    t.ok(records.some((r) => r.code === "MK1001"), "the most likely first-run failure is named");
  });
});

describe("elements", () => {
  test("create('pane') renders a positioned box — the M0 demo", (t) => {
    const { mk, app } = fixture(t);
    const pane = app.create("pane", { id: "box", size: { w: 240, h: 120 }, at: "top-left" });
    mk.tick();

    t.ok(pane.el.classList.contains("mk-pane"));
    t.deepEqual([pane.node.computed.w, pane.node.computed.h], [240, 120]);
    t.equal(pane.el.style.getPropertyValue("--mk-w"), "240px");
    const box = pane.el.getBoundingClientRect();
    const host = app.el.getBoundingClientRect();
    t.close(box.left - host.left, 0);
    t.close(box.width, 240);
  });

  test("§5.9's centred modal geometry", (t) => {
    const { mk, app } = fixture(t);
    const dialog = app.create("surface", { size: { w: "80%", h: "85%" }, at: "center" });
    mk.tick();
    t.deepEqual(
      [dialog.node.computed.x, dialog.node.computed.y, dialog.node.computed.w, dialog.node.computed.h],
      [100, 60, 800, 680]
    );
  });

  test("props validate, coerce, and drive update()", (t) => {
    const { mk, app } = fixture(t);
    const seen = [];
    mk.define({
      type: "acme:probe",
      a11y: "presentation",
      props: { value: { type: "number", default: 0, min: 0, max: 10 } },
      create: (ctx) => ctx.dom("div"),
      update: (ctx, changed) => seen.push([...changed])
    });
    const probe = app.create("acme:probe", { value: "3" });
    t.equal(probe.get("value"), 3, "coerced through the schema");
    probe.set({ value: 7 });
    t.deepEqual(seen, [["value"]]);
    t.throws(() => probe.set({ value: 99 }), /MK3005/);
  });

  test("a signal passed as a prop keeps the element in sync", (t) => {
    const { mk, app } = fixture(t);
    const health = Mutakit.signal(50);
    mk.define({
      type: "acme:bar",
      a11y: { role: "meter" },
      props: { value: { type: "number", default: 0 } },
      create: (ctx) => ctx.dom("div")
    });
    const bar = app.create("acme:bar", { value: health });
    t.equal(bar.get("value"), 50);
    health(80);
    mk.tick();
    t.equal(bar.get("value"), 80);
  });

  test("commands become handle methods", (t) => {
    const { mk, app } = fixture(t);
    mk.define({
      type: "acme:counter",
      a11y: "presentation",
      props: { n: { type: "number", default: 0 } },
      commands: {
        bump(ctx) {
          ctx.node.props.n++;
        },
        read: (ctx) => ctx.props.n
      },
      create: (ctx) => ctx.dom("div")
    });
    const counter = app.create("acme:counter");
    t.equal(counter.bump().bump().read(), 2, "void commands chain, value commands return");
  });

  test("content is assigned as text, never parsed as markup (§21.4)", (t) => {
    const { mk, app } = fixture(t);
    const pane = app.create("pane", { content: "<img src=x onerror=alert(1)>" });
    mk.tick();
    t.equal(pane.el.querySelector("img"), null, "no element was created");
    t.ok(pane.el.textContent.includes("<img"), "it is text");
  });

  test("a virtual `group` adds a node but no DOM", (t) => {
    const { mk, app } = fixture(t);
    const group = app.create("group");
    const child = group.create("pane", { size: { w: 10, h: 10 } });
    mk.tick();
    t.equal(group.el, null);
    t.equal(child.el.parentElement, app.el, "children land in the nearest real ancestor");
  });
});

describe("error isolation (§8.10)", () => {
  test("a broken plugin fails without taking the tree down — the M0 demo", (t) => {
    const { mk, app } = fixture(t);
    const records = [];
    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));

    mk.define({
      type: "acme:broken",
      a11y: "presentation",
      geometry: { defaults: { size: { w: 200, h: 100 } } },
      create() {
        throw new Error("this plugin is broken");
      }
    });

    const before = app.create("pane", { id: "before", size: { w: 100, h: 100 }, at: "top-left" });
    const broken = app.create("acme:broken", { id: "broken", at: "center" });
    const after = app.create("pane", { id: "after", size: { w: 100, h: 100 }, at: "bottom-right" });
    mk.tick();

    t.ok(records.some((r) => r.code === "MK3007"), "the failure is reported with its origin");
    t.ok(broken.el.hasAttribute("data-mk-errored"), "the node is marked");
    t.deepEqual(
      [broken.node.computed.w, broken.node.computed.h],
      [200, 100],
      "the placeholder preserves declared geometry, so layout does not collapse"
    );
    t.equal(before.node.computed.x, 0, "siblings are unaffected");
    t.equal(after.node.computed.x, 900);
  });

  test("errorPolicy: 'propagate' rethrows, which is what tests want", (t) => {
    const { mk, app } = fixture(t, { errorPolicy: "propagate" });
    mk.define({
      type: "acme:throws",
      a11y: "presentation",
      create() {
        throw new Error("boom");
      }
    });
    t.throws(() => app.create("acme:throws"), /boom/);
  });

  test("an `error` event bubbles the node tree", (t) => {
    const { mk, app } = fixture(t);
    Mutakit.diagnostics.sink(() => {});
    t.cleanup(() => Mutakit.diagnostics.sink(null));
    const seen = [];
    app.on("error", (event) => seen.push(event.detail.hook));
    mk.define({ type: "acme:bad", a11y: "presentation", create: () => { throw new Error("x"); } });
    app.create("acme:bad");
    t.deepEqual(seen, ["create"]);
  });
});

describe("layout: anchor (§7.1)", () => {
  test("edge constraints place a HUD without arithmetic (§5.6)", (t) => {
    const { mk, app } = fixture(t);
    const corner = app.create("pane", { id: "corner", right: 24, bottom: 24, size: { w: 100, h: 40 } });
    const rail = app.create("pane", { id: "rail", right: 0, top: 0, bottom: 0, width: 320 });
    const bar = app.create("pane", { id: "bar", left: 0, right: 0, top: 0, height: 48 });
    mk.tick();

    t.deepEqual(rect(corner), [876, 736, 100, 40]);
    t.deepEqual(rect(rail), [680, 0, 320, 800], "over-constrained by design; height wins");
    t.deepEqual(rect(bar), [0, 0, 1000, 48]);
  });

  test("`at` plus `inset` is the whole HUD vocabulary (§18.5)", (t) => {
    const { mk, app } = fixture(t);
    const health = app.create("pane", { at: "top-left", inset: 16, size: { w: 280, h: 20 } });
    const map = app.create("pane", { at: "top-right", inset: 16, size: { w: 120, h: 120 } });
    const reticle = app.create("pane", { at: "center", size: { w: 32, h: 32 } });
    mk.tick();

    t.deepEqual(rect(health), [16, 16, 280, 20]);
    t.deepEqual(rect(map), [864, 16, 120, 120]);
    t.deepEqual(rect(reticle), [484, 384, 32, 32]);
  });

  test("the inset stack shrinks what children resolve against (§5.7)", (t) => {
    const { mk, app } = fixture(t);
    app.node.insets.set("chrome", { top: 48 });
    const pinned = app.create("pane", { at: "top-left", size: { w: 100, h: 100 } });
    const ignoring = app.create("pane", { at: "top-left", size: { w: 100, h: 100 }, insets: false });
    mk.tick();
    t.equal(pinned.node.computed.y, 48);
    t.equal(ignoring.node.computed.y, 0, "insets: false resolves against the raw frame");
  });

  test("a layout snapshot is a readable set of numbers (§23.2)", (t) => {
    const { mk, app } = fixture(t);
    app.create("pane", { id: "a", at: "top-left", inset: 8, size: { w: 100, h: 50 } });
    app.create("pane", { id: "b", at: "bottom-right", inset: 8, size: { w: 100, h: 50 } });
    mk.tick();
    t.deepEqual(mk.snapshot(), {
      a: [8, 8, 100, 50],
      b: [892, 742, 100, 50]
    });
  });
});

describe("layout: stack (§7.2)", () => {
  test("fr distributes free space and gaps are real space", (t) => {
    const { mk, app } = fixture(t);
    const row = app.create("stack", {
      id: "row",
      axis: "x",
      gap: 10,
      left: 0,
      top: 0,
      width: 520,
      height: 100
    });
    const a = row.create("pane", { layout: { size: 100 } });
    const b = row.create("pane", { layout: { size: "1fr" } });
    const c = row.create("pane", { layout: { size: "2fr" } });
    mk.tick();

    // 520 − 100 fixed − 20 gaps = 400 free, split 1:2.
    t.close(a.node.computed.w, 100);
    t.close(b.node.computed.w, 400 / 3);
    t.close(c.node.computed.w, 800 / 3);
    t.close(b.node.computed.x, 110);
    t.close(c.node.computed.x, 110 + 400 / 3 + 10);
  });

  test("child props are validated by the immediate parent only (§7.0)", (t) => {
    const { mk, app } = fixture(t);
    const records = [];
    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));

    const row = app.create("stack", { axis: "x", left: 0, top: 0, width: 400, height: 100 });
    const child = row.create("pane", { layout: { size: 100, units: 2 } });
    mk.tick();

    t.ok(records.some((r) => r.code === "MK2012"), "an unknown key is named, not swallowed");
    t.equal(child.node.layoutProps.units, 2, "and retained, so reparenting can restore it");
  });

  test("the container compiles to flexbox, so CSS does the work (P1)", (t) => {
    const { mk, app } = fixture(t);
    const row = app.create("stack", { axis: "x", left: 0, top: 0, width: 400, height: 100 });
    row.create("pane", { layout: { size: "1fr" } });
    mk.tick();
    t.equal(getComputedStyle(row.el).display, "flex");
    t.equal(getComputedStyle(row.el).flexDirection, "row");
  });
});

describe("the frame loop (§6.3)", () => {
  test("the loop unschedules itself when nothing is dirty (phase 7)", (t) => {
    const { mk, app } = fixture(t);
    app.create("pane", { size: { w: 10, h: 10 } });
    mk.tick();
    t.equal(mk.scheduler.armed, false, "an idle layout costs zero CPU");
    const frames = mk.scheduler.frames;
    mk.tick();
    t.equal(mk.scheduler.frames, frames + 1);
  });

  test("invalidation during WRITE schedules the next frame, never extends this one", (t) => {
    const { mk, app } = fixture(t);
    const pane = app.create("pane", { size: { w: 10, h: 10 } });
    mk.tick();
    let ran = 0;
    const off = mk.scheduler.on("write", () => {
      ran++;
      if (ran === 1) pane.constrain({ size: { w: 20, h: 20 } });
    });
    t.cleanup(off);
    mk.tick();
    t.equal(ran, 1, "one write pass");
    t.equal(mk.scheduler.armed, true, "and a frame queued for the change");
  });

  test("a runaway effect degrades to a janky frame, never a frozen tab (MK5003)", (t) => {
    const { mk } = fixture(t);
    const records = [];
    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));

    const value = Mutakit.signal(0);
    const dispose = Mutakit.effect(() => value(value() + 1));
    t.cleanup(dispose);
    mk.tick();
    t.ok(records.some((r) => r.code === "MK5003"), "the oscillation is named");
  });

  test("the fake clock drives frames deterministically", (t) => {
    const clock = fakeClock();
    const restore = Mutakit.testing.clock(clock.api);
    t.cleanup(restore);
    const { mk, app } = fixture(t);
    app.create("pane", { size: { w: 10, h: 10 } });
    t.equal(mk.scheduler.frames, 0);
    clock.frame();
    t.equal(mk.scheduler.frames, 1, "exactly one frame, at a time we chose");
  });
});

describe("the style compiler (§6.6)", () => {
  test("unchanged properties are skipped", (t) => {
    const { mk, app } = fixture(t);
    app.create("pane", { size: { w: 100, h: 100 }, at: "top-left" });
    mk.tick();
    const before = mk.compiler.writes;
    mk.compiler.skipped = 0;
    app.node.children[0].flags |= 4; // ARRANGE, recompute the same numbers
    mk.tick();
    t.equal(mk.compiler.writes, before, "the same numbers wrote nothing");
    t.ok(mk.compiler.skipped > 0, "and the diff counted them");
  });

  test("state is both a data attribute and a --mk-state-* mirror (§12.4)", (t) => {
    const { mk, app } = fixture(t);
    const pane = app.create("pane", { size: { w: 10, h: 10 } });
    pane.set({ hidden: true });
    mk.tick();
    t.equal(pane.el.getAttribute("data-mk-hidden"), "");
    t.equal(pane.el.style.getPropertyValue("--mk-state-hidden"), "1");
  });
});

describe("traits (§9)", () => {
  test("focusable manages tabindex and emits focus/blur", (t) => {
    const { mk, app } = fixture(t);
    mk.define({
      type: "acme:button",
      a11y: { role: "button" },
      traits: ["focusable"],
      create: (ctx) => ctx.dom("div")
    });
    const button = app.create("acme:button", { size: { w: 100, h: 30 } });
    mk.tick();
    t.equal(button.el.getAttribute("tabindex"), "0");

    const seen = [];
    button.on("focus", () => seen.push("focus"));
    button.el.focus();
    t.equal(document.activeElement, button.el, "focus() lands");
    // Dispatched rather than awaited: a headless or unfocused window delivers
    // the real focus event late or not at all, and that is a property of the
    // window manager, not of the trait.
    button.el.dispatchEvent(new FocusEvent("focus"));
    t.deepEqual(seen, ["focus"]);
    mk.tick();
    t.equal(button.el.getAttribute("data-mk-focused"), "");
  });

  test("an unknown trait is reported and skipped, not fatal", (t) => {
    const { mk, app } = fixture(t);
    const records = [];
    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));
    mk.define({ type: "acme:t", a11y: "presentation", traits: ["nope"], create: (ctx) => ctx.dom("div") });
    const handle = app.create("acme:t");
    t.ok(handle, "the element still exists");
    t.ok(records.some((r) => r.code === "MK3008"));
  });
});

describe("lookup and identity (§8.9)", () => {
  test("byId, query, and duplicate ids", (t) => {
    const { mk, app } = fixture(t);
    const records = [];
    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));

    const first = app.create("pane", { id: "dup", size: { w: 10, h: 10 } });
    app.create("pane", { id: "dup", size: { w: 10, h: 10 } });
    t.equal(mk.byId("dup").node, first.node, "lookup returns the first");
    t.ok(records.some((r) => r.code === "MK4005"), "and says so");

    app.create("surface", { id: "settings" });
    t.ok(mk.query("surface#settings"), "the selector language matches type and id");
    t.equal(mk.queryAll("pane").length, 2);
  });
});

describe("persistence (§19)", () => {
  test("serialize → restore round-trips the tier-2 form", (t) => {
    const { mk, app } = fixture(t);
    mk.use(persistencePlugin);
    app.create("pane", { id: "left", size: { w: 240, h: 100 }, at: "top-left" });
    app.create("surface", { id: "right", size: { w: 300, h: 200 }, at: "top-right", elevation: 2 });
    mk.tick();

    const doc = mk.serialize();
    t.equal(doc.schema, 1);
    t.equal(doc.tree.length, 2);

    const second = fixture(t);
    second.mk.use(persistencePlugin);
    second.mk.restore(doc, { allow: "any" });
    second.mk.tick();
    t.deepEqual(second.mk.snapshot(), mk.snapshot());
  });

  test("an unregistered type restores as a placeholder that round-trips (§19.1)", (t) => {
    const { mk } = fixture(t);
    mk.use(persistencePlugin);
    const records = [];
    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));

    mk.restore(
      { schema: 1, tree: [{ type: "acme:absent", id: "gone", size: { w: 120, h: 60 }, at: "top-left", custom: 7 }] },
      { allow: "any" }
    );
    mk.tick();
    t.ok(records.some((r) => r.code === "MK4010"));
    const round = mk.serialize();
    t.equal(round.tree[0].type, "acme:absent", "re-serializing emits the original data");
    t.equal(round.tree[0].custom, 7, "including props this build knows nothing about");
  });

  test("restore is default-strict about types and props (§21.4)", (t) => {
    const { mk } = fixture(t);
    mk.use(persistencePlugin);
    const records = [];
    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));

    mk.restore({ schema: 1, tree: [{ type: "surface" }] }, { allow: { types: ["pane"] } });
    t.ok(records.some((r) => r.code === "MK4015"), "a type outside `allow` is rejected");
  });
});

describe("leaks (§23.5)", () => {
  test("create and destroy 200 elements, and every counter returns to baseline", (t) => {
    const { mk, app } = fixture(t);
    mk.tick();
    const baseline = { ...counters };

    for (let i = 0; i < 200; i++) {
      const pane = app.create("pane", { size: { w: 10, h: 10 }, at: "top-left" });
      pane.create("stack", { axis: "x" });
      mk.tick();
      pane.destroy();
    }
    mk.tick();

    t.equal(counters.listeners, baseline.listeners, "listeners");
    t.equal(counters.observers, baseline.observers, "observers");
    t.equal(counters.elements, baseline.elements, "elements");
    t.equal(app.node.children.length, 0, "and the node tree is empty again");
  });
});

describe("conformance (§8.7)", () => {
  test("every registered type passes its own contract check", (t) => {
    const findings = [];
    for (const entry of Mutakit.registry.list().type) {
      const definition = Mutakit.registry.get("type", entry.name);
      if (!definition || !definition.source) continue;
      for (const found of Mutakit.conformance(definition.source)) {
        if (found.level === "error") findings.push(`${entry.name}: ${found.message}`);
      }
    }
    t.deepEqual(findings, [], "core follows the rules it asks plugins to follow (P3)");
  });
});

function rect(handle) {
  const r = handle.node.computed;
  return [round(r.x), round(r.y), round(r.w), round(r.h)];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

start();
