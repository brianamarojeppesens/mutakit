/**
 * The browser tier (§23.2): element construction, layout snapshots, error
 * isolation, and leaks — everything that needs real layout rather than a
 * simulated DOM.
 *
 * The pure tier lives in `test/unit/` and runs under `node --test`.
 */
import { describe, fakeClock, key, start, teardown, test } from "./harness.js";
import { Mutakit } from "../source/entries/full.js";
import { persistencePlugin } from "../source/services/persistence.js";
import { counters } from "../source/core/dom.js";
import * as mkSplit from "../source/layout/split.js";

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

describe("layout: split (§7.3)", () => {
  /** The exact three-pane layout from the user's brief (§5.9). */
  function brief(t) {
    const { mk, app } = fixture(t);
    const [left, right] = app.split({
      axis: "x",
      gutter: { size: 6, draggable: true },
      panes: [
        { id: "left", size: 100, min: 64, max: "40%" },
        { id: "right", size: "1fr" }
      ]
    });
    const [stage, bottom] = right.split({
      axis: "y",
      gutter: { size: 6, draggable: true },
      panes: [
        { id: "stage", size: "1fr" },
        { id: "bottom", size: 150, min: 80, collapsible: { at: 40, to: 0 } }
      ]
    });
    mk.tick();
    return { mk, app, left, right, stage, bottom };
  }

  test("the user's brief resolves to the geometry they described", (t) => {
    const { left, right, stage, bottom } = brief(t);
    t.close(left.node.computed.w, 100);
    t.close(right.node.computed.w, 894, 1);
    t.close(right.node.computed.x, 106);
    t.close(bottom.node.computed.h, 150);
    t.close(stage.node.computed.h, 644, 1);
    t.close(bottom.node.computed.y, 650, 1);
  });

  test("a gutter is a real grid track, with separator semantics", (t) => {
    const { app } = brief(t);
    const gutter = app.node.children.find((n) => n.type === "resizer");
    t.ok(gutter, "one gutter between the two panes");
    t.equal(gutter.el.getAttribute("role"), "separator");
    t.equal(gutter.el.getAttribute("aria-orientation"), "vertical");
    t.equal(gutter.el.getAttribute("aria-valuenow"), "100");
    t.equal(gutter.el.getAttribute("aria-valuemin"), "64");
    t.equal(gutter.el.getAttribute("aria-controls"), "left");
    t.equal(gutter.el.getAttribute("tabindex"), "0", "and it is reachable by keyboard");
    t.close(gutter.computed.w, 6);
  });

  test("the container compiles to grid, and the idle path writes no JavaScript geometry", (t) => {
    const { mk, app } = brief(t);
    t.equal(getComputedStyle(app.el).display, "grid");
    const template = app.el.style.getPropertyValue("grid-template-columns");
    t.ok(template.includes("var(--mk-gutter"), "the gutter is a track");
    t.ok(template.includes("clamp(") || template.includes("max("), "and the pane carries its bounds");

    const writes = mk.compiler.writes;
    mk.tick();
    t.equal(mk.compiler.writes, writes, "a second idle frame writes nothing at all");
  });

  test("neighbor: the drag is clamped by both panes' bounds", (t) => {
    const { mk, app } = brief(t);
    const model = app.node.splitModel;
    const wide = splitDrag(app, 0, 300);
    t.close(wide.sizes[0], 400, 1, "40% of 1000 is the pane's own ceiling");
    const narrow = splitDrag(app, 0, -300);
    t.close(narrow.sizes[0], 64, 1, "and its minimum stops it going further");
    t.close(narrow.sizes[0] + narrow.sizes[1], model.content, 1, "tracks always sum to the content box");
  });

  test("distribute: the CSS and JS paths agree across a swept drag", async (t) => {
    // The M2 invariant (§7.3): a group whose panes declare no `max` must
    // produce identical track sizes on both paths. It is what keeps the two
    // implementations from drifting, and what lets a pane gain a `max` at
    // runtime without a visible change in behaviour.
    const { mk, app } = fixture(t);
    app.split({
      axis: "x",
      resizeMode: "distribute",
      gutter: { size: 6, draggable: true },
      panes: [
        { id: "a", size: 200, min: 80 },
        { id: "b", size: "1fr", min: 60 },
        { id: "c", size: "1fr", min: 60 },
        { id: "d", size: "2fr", min: 60 }
      ]
    });
    mk.tick();

    const model = app.node.splitModel;
    t.ok(mkSplit.canUseCSSPath(model, 0, "distribute"), "no maxima, so CSS is legal here");

    const gutter = app.node.children.find((n) => n.type === "resizer");
    const mismatches = [];
    for (let delta = -160; delta <= 320; delta += 40) {
      const js = mkSplit.resolveDrag(model, 0, delta, "distribute", model.sizes);

      // The CSS path: write the unclamped value and let the browser resolve.
      app.el.style.setProperty("--mk-w-0", `${model.sizes[0] + delta}px`);
      const css = model.tracks.map((track) => track.pane.el.getBoundingClientRect().width);

      css.forEach((width, i) => {
        if (Math.abs(width - js.sizes[i]) > 1) {
          mismatches.push(`Δ${delta} pane ${i}: css ${width.toFixed(1)} vs js ${js.sizes[i].toFixed(1)}`);
        }
      });
    }
    app.el.style.removeProperty("--mk-w-0");
    t.deepEqual(mismatches, [], "every swept position agrees");
  });

  test("distribute: a finite max on a flexible pane forces the JS path", (t) => {
    const { mk, app } = fixture(t);
    app.split({
      axis: "x",
      resizeMode: "distribute",
      panes: [
        { id: "a", size: 200 },
        { id: "b", size: "1fr", max: 300 },
        { id: "c", size: "1fr" }
      ]
    });
    mk.tick();
    const model = app.node.splitModel;
    t.equal(mkSplit.canUseCSSPath(model, 0, "distribute"), false, "an fr maximum is uncapped in CSS");

    // And the JS path honours the ceiling the CSS path would overrun.
    const result = mkSplit.resolveDrag(model, 0, -300, "distribute", model.sizes);
    t.ok(result.sizes[1] <= 300 + 1, `pane b stayed within its max (${result.sizes[1].toFixed(1)})`);
  });

  test("push: the cascade walks past panes that hit their minimum", (t) => {
    const { mk, app } = fixture(t);
    app.split({
      axis: "x",
      resizeMode: "push",
      panes: [
        { id: "a", size: 200, min: 50 },
        { id: "b", size: 200, min: 150 },
        { id: "c", size: 200, min: 50 }
      ]
    });
    mk.tick();
    const model = app.node.splitModel;
    const result = mkSplit.resolveDrag(model, 0, 200, "push", model.sizes);
    t.close(result.sizes[1], 150, 1, "b stops at its minimum");
    t.ok(result.sizes[2] < 200, "and the rest cascades to c");
    const before = model.sizes.reduce((s, n) => s + n, 0);
    t.close(result.sizes.reduce((s, n) => s + n, 0), before, 1, "the total is conserved");
  });

  test("collapse: below the threshold, with size memory on restore", (t) => {
    const { mk, bottom, app } = brief(t);
    const inner = app.node.children.find((n) => n.type !== "resizer" && n.id === "right");
    const gutter = inner.children.find((n) => n.type === "resizer");
    const handle = mk.handleFor(gutter);

    handle.nudge(130);
    mk.tick();
    t.equal(bottom.node.layoutProps.collapsed, true, "dragging past `at` collapses");
    t.close(bottom.node.computed.h, 0, 1);

    handle.toggle();
    mk.tick();
    t.equal(bottom.node.layoutProps.collapsed, false);
    t.ok(bottom.node.computed.h > 0, "and it comes back");
  });

  test("keyboard: arrows resize, Shift multiplies, Enter toggles (§7.3, P5)", (t) => {
    const { mk, app, left } = brief(t);
    const gutter = app.node.children.find((n) => n.type === "resizer");
    const before = left.node.computed.w;

    key(gutter.el, "ArrowRight");
    mk.tick();
    t.close(left.node.computed.w, before + 8, 1, "one step");

    key(gutter.el, "ArrowRight", { shiftKey: true });
    mk.tick();
    t.close(left.node.computed.w, before + 48, 1, "five steps");

    key(gutter.el, "Home");
    mk.tick();
    t.close(left.node.computed.w, 64, 1, "Home goes to the minimum");
  });

  test("pane sizes persist across serialize and restore", (t) => {
    const { mk, app, left } = brief(t);
    mk.use(persistencePlugin);
    const gutter = app.node.children.find((n) => n.type === "resizer");
    mk.handleFor(gutter).nudge(120);
    mk.tick();
    const dragged = left.node.computed.w;
    t.close(dragged, 220, 1);

    const doc = mk.serialize();
    const second = fixture(t);
    second.mk.use(persistencePlugin);
    second.mk.restore(doc, { allow: "any" });
    second.mk.tick();

    const restored = second.mk.byId("left");
    t.close(restored.node.computed.w, dragged, 1, "the layout comes back where it was left");
  });

  test("a draggable pane inside a split reports MK2011 with the two real fixes", (t) => {
    const { mk, app } = fixture(t);
    const records = [];
    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));

    const [first] = app.split({ panes: [{ id: "p1", size: "1fr" }, { id: "p2", size: "1fr" }] });
    mk.tick();
    first.trait("draggable", {});

    const found = records.find((r) => r.code === "MK2011");
    t.ok(found, "the arbitration rule fires at attach time");
    t.ok(/sortable/.test(found.message) && /free/.test(found.message), "and names both fixes");
  });
});

/** Drive a drag through the algorithm, the way the resizer does. */
function splitDrag(app, index, delta) {
  const model = app.node.splitModel;
  const mode = app.node.algorithmOptions.resizeMode;
  return mkSplit.resolveDrag(model, index, delta, mode, model.sizes);
}


describe("overlays (§11.2, §16)", () => {
  test("a modal is centred, focus-trapped, and backed by one shared backdrop", (t) => {
    const { mk, app } = fixture(t);
    const trigger = app.create("pane", { id: "trigger", at: "top-left", size: { w: 80, h: 30 } });
    trigger.el.tabIndex = 0;
    trigger.el.focus();

    const first = app.create("modal", { id: "m1", title: "Settings" });
    const second = app.create("modal", { id: "m2", title: "Nested" });
    mk.tick();

    t.deepEqual(rect(first), [100, 60, 800, 680], "80% × 85%, centred (§5.9)");
    t.equal(first.el.getAttribute("role"), "dialog");
    t.equal(first.el.getAttribute("aria-modal"), "true");
    t.equal(first.el.getAttribute("aria-labelledby"), "m1-title");

    const backdrops = app.el.querySelectorAll("[data-mk-backdrop]");
    t.equal(backdrops.length, 1, "two stacked modals produce one backdrop (§16.2)");

    const layers = mk.service("layers");
    t.equal(layers.topOf("modal"), second.node, "and the second is on top");
    t.ok(Number(second.el.style.zIndex) > Number(first.el.style.zIndex), "within one band");

    second.close();
    mk.tick();
    t.equal(second.node.destroyed, true);
    t.equal(app.el.querySelectorAll("[data-mk-backdrop]").length, 1, "the backdrop survives for m1");
    first.close();
    mk.tick();
    t.equal(app.el.querySelectorAll("[data-mk-backdrop]").length, 0, "and goes with the last one");
  });

  test("Escape dismisses the topmost overlay only, and a veto stops it", (t) => {
    const { mk, app } = fixture(t);
    const modal = app.create("modal", { id: "guarded", title: "Unsaved" });
    mk.tick();

    modal.on("beforeclose", (event) => event.preventDefault());
    key(document.documentElement, "Escape");
    mk.tick();
    t.equal(modal.node.destroyed, false, "an unsaved-changes guard vetoes the close (§9)");

    modal.node._listeners.beforeclose.length = 0;
    key(document.documentElement, "Escape");
    mk.tick();
    t.equal(modal.node.destroyed, true);
  });

  test("focus is trapped, then restored to what had it", (t) => {
    const { mk, app } = fixture(t);
    const before = document.createElement("button");
    before.textContent = "opener";
    app.el.appendChild(before);
    t.cleanup(() => before.remove());
    before.focus();

    const modal = app.create("modal", { id: "trapped", title: "Trap" });
    modal.create("pane", { content: "body" });
    mk.tick();
    t.ok(modal.el.contains(document.activeElement), "focus moved inside");

    modal.close();
    mk.tick();
    t.equal(document.activeElement, before, "and came back out");
  });

  test("a dialog's declarative actions keep it serializable (§18.2)", (t) => {
    const { mk, app } = fixture(t);
    const seen = [];
    const dialog = app.create("dialog", {
      id: "prefs",
      title: "Preferences",
      description: "Choose a theme.",
      actions: [
        { label: "Cancel", command: "cancel" },
        { label: "Save", command: "submit", variant: "primary", result: "saved" }
      ]
    });
    dialog.on("action", (event) => seen.push(event.detail));
    mk.tick();

    t.equal(dialog.el.getAttribute("aria-describedby"), "prefs-desc");
    const buttons = dialog.el.querySelectorAll(".mk-button");
    t.equal(buttons.length, 2);
    buttons[1].click();
    t.deepEqual(seen, [{ action: "submit", result: "saved" }], "no JavaScript callback needed");
  });

  test("a popover flips when it would be clipped (§16.3)", (t) => {
    const { mk, app } = fixture(t);
    // A trigger near the bottom edge: `bottom` placement does not fit.
    const trigger = app.create("pane", { id: "trg", left: 100, top: 760, size: { w: 80, h: 30 } });
    mk.tick();

    const pop = app.create("popover", {
      id: "pop",
      reference: trigger.el,
      placement: "bottom",
      size: { w: 200, h: 120 }
    });
    mk.tick();
    mk.tick();

    t.equal(pop.el.getAttribute("data-mk-placement"), "top", "it flipped to the side that fits");
    t.ok(pop.node.computed.y + pop.node.computed.h <= 800, "and stays inside the frame");
  });

  test("a virtual reference is a function, re-read every frame (§16.3)", (t) => {
    const { mk, app } = fixture(t);
    let cursor = { x: 200, y: 200, w: 0, h: 0 };
    const pop = app.create("popover", {
      id: "follow",
      reference: () => cursor,
      placement: "bottom-start",
      size: { w: 120, h: 40 }
    });
    mk.tick();
    mk.tick();
    t.close(pop.node.computed.x, 200, 1);

    cursor = { x: 500, y: 300, w: 0, h: 0 };
    mk.tick();
    t.close(pop.node.computed.x, 500, 1, "no placeholder element was needed");
  });

  test("a menu is one tab stop with roving focus (§13.4)", (t) => {
    const { mk, app } = fixture(t);
    const chosen = [];
    const menu = app.create("menu", {
      id: "ctx",
      reference: { x: 100, y: 100, w: 0, h: 0 },
      items: [
        { label: "Cut", shortcut: "Ctrl+X" },
        { label: "Copy" },
        { separator: true },
        { label: "Paste", disabled: true }
      ]
    });
    menu.on("select", (event) => chosen.push(event.detail.item.label));
    mk.tick();

    const items = menu.el.querySelectorAll(".mk-menu__item");
    t.equal(items.length, 3);
    t.equal(items[0].getAttribute("tabindex"), "0", "one tab stop");
    t.equal(items[1].getAttribute("tabindex"), "-1");

    key(menu.el, "ArrowDown");
    t.equal(items[1].getAttribute("tabindex"), "0", "arrows move within it");
    key(menu.el, "End");
    t.equal(items[2].getAttribute("data-mk-active"), "", "End reaches the last item");

    key(menu.el, "Home");
    key(menu.el, "ArrowDown");
    key(menu.el, "Enter");
    t.deepEqual(chosen, ["Copy"], "and choosing one closes the menu");
    t.equal(menu.node.destroyed, true);
  });

  test("a toast announces through the shared live region and expires", (t) => {
    const { mk, app } = fixture(t);
    const toast = app.create("toast", { id: "saved", text: "Layout saved", ttl: 0 });
    mk.tick();

    const announcer = mk.service("announcer");
    t.ok(announcer.regions.polite, "one polite region per instance (§14)");
    t.equal(announcer.regions.polite.textContent, "Layout saved");
    t.equal(toast.el.getAttribute("role"), "status");

    const records = [];
    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));
    announcer.say("Layout saved");
    t.ok(records.some((r) => r.code === "MK6003"), "a repeat inside the window is dropped");
  });

  test("a tooltip host waits, shows on focus, and cleans up after itself", (t) => {
    const { mk, app } = fixture(t);
    mk.define({
      type: "acme:field",
      a11y: { role: "textbox" },
      traits: ["tooltip-host"],
      props: { tooltip: { type: "string", default: "" } },
      create: (ctx) => ctx.dom("div")
    });
    const field = app.create("acme:field", { tooltip: "The port to listen on", size: { w: 80, h: 24 } });
    mk.tick();

    const host = field.trait("tooltip-host");
    t.equal(host.visible, false, "nothing on hover intent alone");
    host.show();
    mk.tick();
    t.equal(host.visible, true);
    t.ok(mk.query("tooltip"), "one tooltip element, delegated");

    host.hide();
    mk.tick();
    t.equal(mk.query("tooltip"), null);
  });

  test("scroll locking is reference counted, so nested overlays do not double-lock", (t) => {
    const { mk, app } = fixture(t);
    const layers = mk.service("layers");
    const a = app.create("modal", { id: "s1" });
    const b = app.create("modal", { id: "s2" });
    mk.tick();
    t.equal(layers.scrollLocks, 2);
    t.equal(document.documentElement.style.overflow, "hidden");

    b.close();
    mk.tick();
    t.equal(document.documentElement.style.overflow, "hidden", "still locked for the first");
    a.close();
    mk.tick();
    t.equal(document.documentElement.style.overflow, "", "and released exactly once");
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
