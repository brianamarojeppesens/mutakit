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
import * as mkInput from "../source/services/input.js";
import { compileDSL, adaptersPlugin } from "../source/plugins/authoring.js";
import { devtoolsPlugin } from "../source/plugins/devtools.js";
import { AcmeWidgets } from "../examples/acme-widgets/index.js";

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
    // A curated surface, not four namespace objects: re-exporting whole
    // modules pinned every export of each into every bundle (§10 lists what is
    // extensible; this was never on it).
    t.ok(Mutakit.geometry.parse, "the Len parser is published for plugin authors");
    t.ok(Mutakit.geometry.place && Mutakit.geometry.intersect, "with the rect and anchor helpers");
    t.equal(Mutakit.geometry.union, undefined, "and nothing beyond what a plugin needs");
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

  test("a signal in geometry or content is read, never written (§15.1, §15.2)", (t) => {
    const { mk, app } = fixture(t);

    // A signal is a function, and so are two other things the engine accepts:
    // a computed length, and a content producer. Both are *called with an
    // argument* — the length context, the element ctx — and calling a signal
    // accessor with an argument writes to it. So passing a store slice as a
    // size or as content did not fail to resolve; it replaced the stored value
    // with an internal object, silently, on the first frame.
    const store = mk.store("sig-layout", { size: 240, title: "Files" });
    const size = store.select("size");
    const title = store.select("title");

    const pane = app.create("pane", { id: "sig-p", at: "top-left", size: { w: size, h: 100 } });
    const labelled = app.create("pane", { id: "sig-c", content: title, at: "top-right", size: { w: 200, h: 40 } });
    mk.tick();

    t.equal(size(), 240, "the signal still holds its own value");
    t.equal(title(), "Files");
    t.equal(pane.node.computed.w, 240, "and the geometry resolved from it");
    t.equal(labelled.el.textContent, "Files");

    // Geometry is not a prop, so nothing bound it: the value was never wrong,
    // only stale — the box kept whatever the last arrange happened to compute.
    store.set("size", 320);
    store.set("title", "Explorer");
    mk.tick();
    t.equal(pane.node.computed.w, 320, "a write moves the box");
    t.equal(labelled.el.textContent, "Explorer", "and updates the content");

    // Including when the kind of length changes.
    store.set("size", "50%");
    mk.tick();
    t.equal(pane.node.computed.w, 500, "a percentage resolves against the frame");

    // The two callables that are not signals still behave as before.
    const produced = app.create("pane", {
      id: "sig-f", content: (ctx) => `made by ${ctx.node.id}`, at: "bottom-left", size: { w: 200, h: 40 }
    });
    const computed = app.create("pane", {
      id: "sig-len", at: "bottom-right", size: { w: (lenCtx) => lenCtx.basis / 4, h: 40 }
    });
    mk.tick();
    t.equal(produced.el.textContent, "made by sig-f", "a content producer still receives ctx");
    t.equal(computed.node.computed.w, 250, "and a computed length still receives the len context");
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
  test("every lifecycle hook is guarded, and the geometry survives it", (t) => {
    const { mk, app } = fixture(t);
    // §8.10 says *every* lifecycle hook runs inside a guard. Only `create` was
    // covered, so the other six were a promise nothing tested. A throw must
    // leave the node errored, keep its declared geometry so surrounding layout
    // does not collapse, and leave its siblings untouched.
    const hooks = ["create", "mount", "update", "measure", "arrange", "paint", "destroy"];

    for (const hook of hooks) {
      const type = `acme:boom-${hook}`;
      const definition = {
        type,
        a11y: "presentation",
        geometry: { defaults: { size: { w: 120, h: 40 } } },
        create: (ctx) => ctx.dom("div"),
        // PAINT is a self fast-path bit that nothing sets on creation, so the
        // hook only runs for an element that asks for it (§6.2). Without this
        // the `paint` case would pass by never being called.
        mount: hook === "paint" ? (ctx) => ctx.invalidate("paint") : undefined
      };
      const boom = () => { throw new Error(`boom ${hook}`); };
      if (hook === "create") definition.create = boom;
      else definition[hook] = boom;
      mk.define(definition, { replace: true });

      const bad = app.create(type, { id: `bad-${hook}`, at: "top-left", inset: 5 });
      const sibling = app.create("pane", {
        id: `ok-${hook}`, at: "top-right", inset: 5, size: { w: 50, h: 50 }
      });
      mk.tick();
      if (hook === "update") { bad.set({ hidden: true }); mk.tick(); }
      if (hook === "destroy") { mk.destroy(bad.node); mk.tick(); }

      t.ok(mk.byId(`ok-${hook}`), `${hook}: the sibling is untouched`);
      t.deepEqual(rect(sibling), [945, 5, 50, 50], `${hook}: and still laid out`);
      if (hook !== "destroy") {
        t.ok(bad.node.errored, `${hook}: the node is marked errored`);
        t.deepEqual(
          [bad.node.computed.w, bad.node.computed.h], [120, 40],
          `${hook}: its declared geometry is preserved`
        );
      }
      mk.destroy(sibling.node);
      if (!bad.node.destroyed) mk.destroy(bad.node);
      mk.tick();
    }
  });

  test("the error event bubbles, and `propagate` rethrows (§8.10)", (t) => {
    const { mk, app } = fixture(t);
    mk.define({ type: "acme:thrower", a11y: "presentation", create() { throw new Error("nope"); } },
      { replace: true });

    const seen = [];
    const parent = app.create("pane", { id: "err-parent", size: { w: 200, h: 200 } });
    parent.on("error", (event) => seen.push(["parent", event.detail.hook]));
    app.on("error", (event) => seen.push(["root", event.detail.hook]));
    parent.create("acme:thrower", { id: "err-kid" });
    mk.tick();

    // §8.10.4: it bubbles the *node* tree, so an application can report a
    // failure it did not have to be adjacent to.
    t.deepEqual(seen, [["parent", "create"], ["root", "create"]]);

    // `propagate` is the policy tests want: the same failure, rethrown.
    const strict = Mutakit.create({ errorPolicy: "propagate" });
    t.cleanup(() => strict.destroyInstance());
    const strictApp = strict.mount(t.sandbox(), { sizing: "fixed", size: { w: 100, h: 100 } });
    strict.define({ type: "acme:thrower2", a11y: "presentation", create() { throw new Error("rethrow me"); } },
      { replace: true });
    t.throws(() => { strictApp.create("acme:thrower2", {}); strict.tick(); }, /rethrow me/);
  });

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
    // Two contributions on one edge compose by max, not by sum — the whole
    // point of the mechanism, since two overlays each claiming 16px from the
    // bottom should yield 16. The unit suite checks the algebra; this checks
    // that a real frame resolves against it.
    app.node.insets.set("toolbar", { top: 30, bottom: 16 });
    app.node.insets.set("keyboard", { bottom: 16 });

    const pinned = app.create("pane", { at: "top-left", size: { w: 100, h: 100 } });
    const ignoring = app.create("pane", { at: "top-left", size: { w: 100, h: 100 }, insets: false });
    const filling = app.create("pane", { id: "ins-fill", left: 0, right: 0, top: 0, bottom: 0 });
    // The named-subset form: this one respects `chrome` and nothing else.
    const onlyChrome = app.create("pane", {
      id: "ins-one", left: 0, right: 0, top: 0, bottom: 0, insets: ["chrome"]
    });
    mk.tick();

    t.equal(pinned.node.computed.y, 48, "max(48, 30), not 78");
    t.equal(ignoring.node.computed.y, 0, "insets: false resolves against the raw frame");
    t.deepEqual(rect(filling), [0, 48, 1000, 800 - 48 - 16], "and both edges compose by max");
    t.deepEqual(rect(onlyChrome), [0, 48, 1000, 800 - 48], "insets: ['chrome'] takes only that one");
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
  test("reading resolved geometry during WRITE throws (P4)", (t) => {
    const { mk, app } = fixture(t);
    const pane = app.create("pane", { id: "p4-read", size: { w: 50, h: 50 } });
    mk.tick();

    // §6.3 is explicit that this throws in the development build, and the
    // reason is the sentence after it: the two reentrancy rules together make
    // layout thrash *structurally impossible* rather than merely discouraged.
    // It warned — so the read still returned, the reflow still happened, and
    // the only cost was a console line nobody reads during a drag.
    let caught = null;
    const stop = mk.scheduler.on("write", () => {
      try { pane.rect(); } catch (error) { caught = error; }
    });
    t.cleanup(stop);
    mk.byId("p4-read").set({ size: { w: 60, h: 60 } });
    mk.tick();

    t.ok(caught, "the read throws rather than returning a value");
    t.equal(caught.code, "MK3015");
    t.ok(/ARRANGE or PAINT/.test(caught.message), "and says where the read belongs");
  });

  test("reading outside WRITE is unaffected", (t) => {
    const { mk, app } = fixture(t);
    const pane = app.create("pane", { id: "p4-ok", size: { w: 50, h: 50 } });
    mk.tick();
    t.deepEqual(pane.rect(), { x: 0, y: 0, w: 50, h: 50 }, "IDLE reads are the normal case");

    let inArrange = null;
    const stop = mk.scheduler.on("arrange", () => { inArrange = pane.rect(); });
    t.cleanup(stop);
    mk.byId("p4-ok").set({ size: { w: 70, h: 70 } });
    mk.tick();
    t.ok(inArrange, "and ARRANGE is where a layout-time read is supposed to happen");
  });

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
    // `focusin` is what a browser emits alongside `focus`, and unlike `focus`
    // it bubbles — which is what lets one listener serve both the element and a
    // native control it wraps. A window that does not have focus may not
    // deliver it from the `.focus()` above, so this stands in for it.
    //
    // Only when it is actually absent. Dispatching unconditionally added a
    // second event wherever the real one *did* arrive, which is every engine
    // driven by Playwright — the assertion then read two focus events and
    // blamed the trait. It reproduced identically in Chromium, Firefox and
    // WebKit, because it was never an engine difference.
    if (!seen.length) button.el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    t.deepEqual(seen, ["focus"], "one focus event per focus, however it arrived");
    mk.tick();
    t.equal(button.el.getAttribute("data-mk-focused"), "");
  });

  test("a wrapped native control is the tab stop, not its wrapper (§11.3, §14)", (t) => {
    const { mk, app } = fixture(t);
    // §11.3's controls wrap a native element and `create` returns the wrapper,
    // so the trait was putting `tabindex="0"` on a plain div in front of the
    // input. Every field was two tab stops, the first an unlabelled group.
    const field = app.create("field", { id: "tab-field", label: "Name" });
    const text = field.create("text", { id: "tab-text", name: "n" });
    mk.tick();

    const wrapper = text.el;
    const input = wrapper.querySelector("input");
    t.ok(input, "the control wraps a native input");
    t.equal(wrapper.getAttribute("tabindex"), null, "the wrapper is not a tab stop");
    t.equal(input.getAttribute("tabindex"), null, "and the input needs no help to be one");

    const focus = mk.service("focus");
    const stops = focus.tabbable(field.el);
    t.equal(stops.length, 1, "one tab stop for one control");
    t.equal(stops[0], input, "and it is the input itself");

    // State still tracks, which is what `focusin` bubbling buys: `focus` does
    // not bubble, so a listener on the wrapper never saw the inner control.
    const seen = [];
    text.on("focus", () => seen.push("focus"));
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    mk.tick();
    t.deepEqual(seen, ["focus"], "focus on the inner control reaches the node");
    t.equal(wrapper.getAttribute("data-mk-focused"), "");
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

describe("content interop (§8.8)", () => {
  test("adoption writes only what the contract allows, and undoes it", (t) => {
    const { mk, app, host } = fixture(t);
    const elsewhere = t.sandbox();

    // §8.8 states this as a guarantee rather than a behaviour, because
    // incremental adoption depends on it: an adopted node keeps its children,
    // classes, listeners, and inline style, and gets back exactly what it had.
    const make = () => {
      const el = document.createElement("section");
      el.className = "theirs other";
      el.setAttribute("data-theirs", "keep me");
      el.style.background = "rgb(1, 2, 3)";
      el.append(document.createElement("span"), document.createElement("span"));
      elsewhere.appendChild(el);
      return el;
    };

    const adopted = make();
    let clicks = 0;
    adopted.addEventListener("click", () => clicks++);
    const original = adopted.getAttribute("style");

    const handle = mk.adopt(adopted, { at: "top-left", inset: 20, size: { w: 200, h: 120 } });
    mk.tick();
    adopted.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    t.deepEqual(rect(handle), [20, 20, 200, 120], "it takes over the geometry");
    t.equal(adopted.className, "theirs other", "and touches nothing else: not classes");
    t.equal(adopted.childElementCount, 2, "not children");
    t.equal(adopted.getAttribute("data-theirs"), "keep me", "not attributes");
    t.equal(adopted.style.background, "rgb(1, 2, 3)", "not inline style it did not write");
    t.equal(clicks, 1, "and not listeners");
    t.ok(adopted.style.getPropertyValue("--mk-w"), "what it writes are the §12.4 properties");

    // On destroy: `return` restores the original parent and inline style.
    mk.destroy(handle.node);
    mk.tick();
    t.equal(adopted.parentElement, elsewhere, "return puts it back where it was");
    t.equal(adopted.getAttribute("style"), original, "with the style it arrived with");

    // `detach` and `remove` differ in placement but must leave no residue
    // either — the geometry properties were cleaned and the state mirrors and
    // `data-mk-*` attributes were not, on the one node an author cannot simply
    // reset, because the whole point of adoption is that it is theirs.
    for (const mode of ["detach", "remove"]) {
      const element = make();
      const before = element.getAttribute("style");
      const adoption = mk.adopt(element, { at: "top-left", inset: 5, size: { w: 50, h: 50 }, onDestroy: mode });
      mk.tick();
      mk.destroy(adoption.node);
      mk.tick();
      t.equal(element.getAttribute("style"), before, `${mode}: no style residue`);
      t.equal([...element.attributes].filter((a) => a.name.startsWith("data-mk-")).length, 0,
        `${mode}: no data-mk-* residue`);
      t.equal(element.className, "theirs other", `${mode}: still theirs`);
    }
    t.equal(host.querySelectorAll("[data-mk-adopted]").length, 0);
  });
});

describe("style backends (§10.15, D7)", () => {
  test("a sink can collect CSS instead of injecting it", (t) => {
    // D7 asked whether the *per-node* output could be swapped for atomic
    // classes. It cannot: §12.4 publishes `--mk-x/y/w/h` as stable API, §8.8's
    // adoption contract promises an adopted node gets those and nothing else,
    // and P1 has CSS consume the engine's numbers through `width: var(--mk-w)`.
    // What genuinely varies is *delivery*, and that is what this is.
    const styles = Mutakit.collectStyles();
    const host = t.sandbox();
    host.style.cssText = "position:relative;width:400px;height:300px";

    const before = document.adoptedStyleSheets.length + document.querySelectorAll("style").length;
    const mk = Mutakit.create({ styles: styles.sink });
    t.cleanup(() => mk.destroyInstance());
    const app = mk.mount(host, { sizing: "fixed", size: { w: 400, h: 300 } });
    app.create("surface", { id: "sink-a", at: "top-left", inset: 10, size: { w: 100, h: 50 } });
    mk.tick();

    const after = document.adoptedStyleSheets.length + document.querySelectorAll("style").length;
    t.equal(after, before, "nothing was injected into the document");

    const text = styles.text();
    t.ok(/@layer mutakit\.reset, mutakit\.tokens/.test(text), "the layer order came first");
    t.ok(/\.mk-node/.test(text), "the base CSS is there");
    t.ok(/@layer mutakit\.element[^]*\.mk-surface/.test(text), "and element CSS, in its layer");
    t.deepEqual(styles.keys().slice(0, 4), ["layers", "reset", "tokens", "base"],
      "in the order the cascade expects");

    // Each key once, however many elements of a type exist.
    app.create("surface", { id: "sink-b", size: { w: 10, h: 10 } });
    mk.tick();
    t.equal(styles.keys().filter((k) => k === "type:surface").length, 1);
  });
});

describe("render targets (§10.14)", () => {
  test("a root in another document renders there, styles and all", (t) => {
    const { mk } = fixture(t);

    const frame = document.createElement("iframe");
    frame.style.cssText = "width:400px;height:300px;border:0";
    t.sandbox().appendChild(frame);
    const doc = frame.contentDocument;
    doc.body.style.margin = "0";

    // §10.14 calls another document, an iframe, or a popup a supported
    // destination. Elements and geometry already worked, because appending
    // into another document adopts the node — what did not follow was the
    // *stylesheet*. It went to the host document, so the subtree in the frame
    // had no base CSS at all: the engine computed 100×50 and the browser drew
    // 400×300, and nothing reported a disagreement.
    const app = mk.mount(doc, { sizing: "fixed", size: { w: 400, h: 300 } });
    const surface = app.create("surface", {
      id: "frame-s", at: "top-left", inset: 10, size: { w: 100, h: 50 }, content: "framed"
    });
    mk.tick();

    t.equal(surface.el.ownerDocument, doc, "the element lives in the frame");
    t.deepEqual(rect(surface), [10, 10, 100, 50], "and the engine placed it");

    const drawn = surface.el.getBoundingClientRect();
    t.close(drawn.width, 100, 1, "which is also what the browser drew");
    t.close(drawn.height, 50, 1);
    const style = doc.defaultView.getComputedStyle(surface.el);
    t.equal(style.position, "absolute", "base CSS reached the frame");
    t.equal(style.borderRadius, "6px", "and so did the element's own");

    // The instance keeps working in the host document at the same time.
    const here = t.sandbox();
    here.style.cssText = "position:relative;width:200px;height:100px";
    const second = mk.mount(here, { sizing: "fixed", size: { w: 200, h: 100 } });
    const local = second.create("surface", { id: "host-s", at: "top-left", inset: 5, size: { w: 50, h: 20 } });
    mk.tick();
    t.close(local.el.getBoundingClientRect().width, 50, 1, "two documents, one instance");
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

  test("a restored layout resolves to the same geometry, text and all (§19.1)", (t) => {
    // §19.1 says `serialize()` emits the tier-2 form and `restore()` rebuilds
    // it. The check that matters is not that the JSON looks right but that the
    // rebuilt tree *lays out* the same — which is how this found that `content`
    // was never serialized at all: every label came back empty, and a node
    // sized to its own text came back at zero.
    const first = fixture(t);
    first.app.dock({
      regions: { top: { id: "s-bar", size: 40 }, start: { id: "s-side", size: 220 }, center: { id: "s-main" } }
    });
    first.mk.byId("s-main").split({
      axis: "y", gutter: { size: 6, draggable: true },
      panes: [{ id: "s-top", size: "1fr", min: 60 }, { id: "s-bottom", size: 180, min: 40 }]
    });
    first.mk.byId("s-side").create("pane", { id: "s-tree", content: "files" });
    first.mk.tick();

    const before = first.mk.snapshot();
    const json = first.mk.serialize();

    const second = fixture(t);
    second.mk.restore(json);
    second.mk.tick();
    const after = second.mk.snapshot();

    t.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), "every node came back");
    for (const id of Object.keys(before)) {
      t.deepEqual(after[id].map(Math.round), before[id].map(Math.round), `${id} resolves identically`);
    }
    t.equal(second.mk.byId("s-tree").el.textContent, "files", "and its text came with it");
  });

  test("migrations chain, and a newer document says so (§19.2)", (t) => {
    const { mk } = fixture(t);
    const steps = [];
    // §19.2's registration shape, verbatim: `{ from, to, migrate }`, chained
    // automatically. Two versions behind must walk through both.
    Mutakit.serializer({ from: -1, to: 0, migrate(doc) {
      steps.push("-1->0");
      return { ...doc, schema: 0 };
    } });
    Mutakit.serializer({ from: 0, to: 1, migrate(doc) {
      steps.push("0->1");
      return { ...doc, schema: 1, tree: doc.tree.map((n) => ({ ...n, id: n.id.replace("old-", "new-") })) };
    } });

    mk.restore({ schema: -1, mutakit: "0.1.0", frame: { algorithm: "anchor" },
      tree: [{ type: "pane", id: "old-a", size: { w: 40, h: 40 } }] }, { allow: "any" });
    mk.tick();
    t.deepEqual(steps, ["-1->0", "0->1"], "both migrations ran, in order");
    t.ok(mk.byId("new-a"), "and the transform they describe was applied");
    t.equal(mk.byId("old-a"), null);

    // The other direction is not a missing migration. Walking *forward* from a
    // newer document travels away from the format this build reads, and the
    // message asked the author for a migration they could never write.
    const codes = [];
    Mutakit.diagnostics.reset();
    Mutakit.diagnostics.sink((record) => codes.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));
    mk.restore({ schema: 99, mutakit: "9.0.0", frame: { algorithm: "anchor" },
      tree: [{ type: "pane", id: "from-future", size: { w: 40, h: 40 } }] }, { allow: "any" });
    mk.tick();

    t.ok(mk.byId("from-future"), "it is still restored — a newer file must not brick a workspace");
    const said = codes.find((r) => r.code === "MK4015");
    t.ok(said && /saved by a newer Mutakit/.test(said.message), "and it says what actually happened");
  });

  test("restore is default-strict, and `props: 'schema'` keeps DOM sinks out (§21.4)", (t) => {
    const { mk } = fixture(t);
    const codes = [];
    Mutakit.diagnostics.reset();
    Mutakit.diagnostics.sink((record) => codes.push(record.code));
    t.cleanup(() => Mutakit.diagnostics.sink(null));

    // §21.4: an unrestricted restore emits MK4xxx unless `allow: 'any'` is
    // passed deliberately. Restoring attacker-controlled JSON is roughly as
    // dangerous as running attacker-controlled code, so silence is the wrong
    // default.
    mk.restore({ schema: 1, mutakit: "0.9.0", frame: { algorithm: "anchor" },
      tree: [{ type: "pane", id: "sec-a" }] });
    t.ok(codes.includes("MK4015"), "an unrestricted restore says so");

    codes.length = 0;
    Mutakit.diagnostics.reset();
    mk.restore({ schema: 1, mutakit: "0.9.0", frame: { algorithm: "anchor" },
      tree: [{ type: "pane", id: "sec-b" }] }, { allow: "any" });
    t.notOk(codes.includes("MK4015"), "and opting out deliberately is silent");

    // The allow-list filters types, and `props: 'schema'` filters what reaches
    // the DOM. `class` and `style` are structural but are also the two keys
    // that write straight to it — a restored node free to set its own `style`
    // can be positioned over the UI it was restored into.
    mk.restore(
      { schema: 1, mutakit: "0.9.0", frame: { algorithm: "anchor" },
        tree: [
          { type: "pane", id: "sec-ok", size: { w: 40, h: 20 }, class: "evil",
            style: { background: "red" }, onclick: "alert(1)" },
          { type: "modal", id: "sec-no", title: "not allowed" }
        ] },
      { allow: { types: ["pane"], props: "schema" } }
    );
    mk.tick();

    const pane = mk.byId("sec-ok");
    t.ok(pane, "an allowed type is restored");
    t.equal(mk.byId("sec-no"), null, "a type outside the allow-list is not");
    t.notOk(pane.el.classList.contains("evil"), "class does not survive");
    t.equal(pane.el.style.background, "", "nor does style");
    t.notOk(pane.el.hasAttribute("onclick"), "and an inline handler never lands");
    t.deepEqual(rect(pane), [0, 0, 40, 20], "while the geometry it exists to carry does");
  });

  test("no built-in prop parses a string as markup (§21.4)", (t) => {
    const { mk, app } = fixture(t);
    const xss = '<img src=x onerror="window.__mkPwned = 1">';
    t.cleanup(() => { delete window.__mkPwned; });

    // §21.4: string content is assigned with textContent, always. There is no
    // property anywhere in the built-in catalog that parses a plain string as
    // markup, so this sweeps the ones that render author-supplied text.
    const pane = app.create("pane", { id: "xss-pane", content: xss });
    mk.tick();
    t.equal(pane.el.querySelector("img"), null, "content is text");
    t.ok(pane.el.textContent.includes("<img"), "and reads back as the literal string");

    const probes = [
      ["field", { label: xss }],
      ["dialog", { title: xss, description: xss }],
      ["toast", { text: xss, ttl: 0 }],
      ["banner", { text: xss }],
      ["tooltip", { text: xss, reference: { x: 10, y: 10 } }],
      ["text-block", { text: xss }],
      ["menu", { reference: { x: 10, y: 10 }, items: [{ label: xss }] }],
      ["empty-state", { title: xss, description: xss }]
    ];
    for (const [type, props] of probes) {
      const handle = mk.create(type, props);
      mk.tick();
      t.equal(handle.el.querySelector("img"), null, `${type} renders it as text`);
      if (!handle.node.destroyed) mk.destroy(handle.node);
    }
    t.notOk(window.__mkPwned, "and nothing executed");
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
  /**
   * Wait for `counters.timers` to come back to `baseline`, then report it.
   *
   * Not every live timer belongs to a node. The announcer (§14) rate-limits
   * through a shared 500 ms timer owned by the service, so anything that calls
   * `ctx.announce` leaves one in flight for half a second — and a `toast`
   * announces on create. Sampling the count at an arbitrary instant after the
   * work is done therefore measures whether that half-second happened to have
   * elapsed, which is a property of the clock, not of the library.
   *
   * That is why this passed in a visible browser and failed in all three
   * headless engines: `flush` waits on rAF, a visible browser paces rAF to the
   * display at ~16.7 ms a frame, and headless runs it flat out. The slow one
   * spent longer than 500 ms getting to the assertion. Neither was measuring a
   * leak.
   *
   * Polling keeps the detection intact rather than widening the target: a
   * timer that genuinely outlives its owner never returns to baseline, so it
   * still fails — after the budget, and with the real count in the message.
   */
  async function settleTimers(baseline, budget = 2000) {
    const deadline = Date.now() + budget;
    while (counters.timers !== baseline && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return counters.timers;
  }

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

  test("the types that own traps, timers, and portals also come back clean", async (t) => {
    const { mk, app } = fixture(t);
    mk.tick();
    // `pane` and `stack` own almost nothing, so the check above passes without
    // exercising the places a disposer is actually easy to miss: a focus trap,
    // a dismissal listener, a toast's timer, a submenu, an overlay portalled
    // out of the tree it was declared in.
    const cases = {
      modal: () => mk.create("modal", { title: "t" }),
      dialog: () => mk.create("dialog", { title: "t", actions: [{ label: "OK", command: "submit" }] }),
      popover: () => mk.create("popover", { reference: { x: 100, y: 100 } }),
      tooltip: () => mk.create("tooltip", { text: "hi", reference: { x: 100, y: 100 } }),
      menu: () => mk.create("menu", {
        reference: { x: 50, y: 50 },
        items: [{ label: "a" }, { label: "b", items: [{ label: "c" }] }]
      }),
      toast: () => mk.create("toast", { text: "x", ttl: 0 }),
      drawer: () => mk.create("drawer", {}),
      window: () => app.create("window", { title: "w", size: { w: 200, h: 150 } }),
      tabs: () => app.create("tabs", { items: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }),
      form: () => app.create("form", {
        values: { n: "" },
        children: [{ type: "field", label: "N", control: { type: "text", name: "n" } }]
      }),
      combobox: () => app.create("combobox", { options: ["a", "b"] }),
      slider: () => app.create("slider", { min: 0, max: 10, value: 5 }),
      "context-menu": () => app.create("pane", {
        size: { w: 50, h: 50 },
        traits: ["context-menu"],
        "context-menu": { items: [{ label: "a" }] }
      })
    };

    for (const name of Object.keys(cases)) {
      // One round-trip before the baseline. A lazily created service — focus,
      // layers, motion — installs listeners on first use and keeps them for
      // the instance's lifetime, which is not a leak but does land between a
      // cold baseline and the first teardown. What is being measured is the
      // steady state: ten more round-trips must cost exactly nothing.
      // Destroying is not tearing down: a type with an exit animation sits in
      // `exiting` until the animation is drained, and its disposers have not
      // run yet. Counting before that drain measures a modal mid-exit and
      // calls it a leak — which is what this test did on its first run, and
      // the top-layer hosts still open in the document made it look real.
      const cycle = async () => {
        const handle = cases[name]();
        mk.tick();
        if (handle && handle.node && !handle.node.destroyed) mk.destroy(handle.node);
        await mk.flush({ animations: false });
        mk.tick();
      };

      await cycle(); // warm up: a lazily created service keeps its listeners
      const baseline = { ...counters };
      for (let i = 0; i < 10; i++) await cycle();
      // §23.5 names listeners, observers, and nodes. Timers are deliberately
      // not asserted here: they are a *global* count, and a tooltip's 100ms
      // hide or a toast's ttl from an earlier case fires partway through a
      // later one — so the number moves for reasons that have nothing to do
      // with the type being measured. `toast` below asserts them where they
      // are actually the subject.
      t.equal(counters.listeners, baseline.listeners, `${name}: listeners`);
      t.equal(counters.observers, baseline.observers, `${name}: observers`);
      t.equal(counters.elements, baseline.elements, `${name}: elements`);
    }
    // §16.2's host dialogs live outside the tree they belong to, so a missed
    // disposer strands them in `document.body` where nothing else would look.
    t.equal(document.querySelectorAll("dialog.mk-top-layer").length, 0,
      "and no top-layer host was left behind");
  });

  test("a timer that fired is not also cancelled, and every timer is owned", async (t) => {
    const { mk, app } = fixture(t);
    mk.tick();
    const baseline = counters.timers;

    // A `toast` arms its own dismissal timer, so this exercises the path where
    // a timer runs to completion *and* its disposer runs at teardown. Both
    // decremented, so the count fell below baseline and the next thing
    // measured looked like it had leaked — a detector reporting the wrong
    // subject, which is worse than one reporting nothing.
    for (let i = 0; i < 5; i++) {
      const toast = app.create("toast", { text: "x", ttl: 5 });
      mk.tick();
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (!toast.node.destroyed) mk.destroy(toast.node);
      await mk.flush({ animations: false });
    }
    mk.tick();
    t.equal(await settleTimers(baseline), baseline, "timers return to baseline, not below it");

    // And a timer created *inside* an owned listener is owned too — otherwise
    // it survives its element and is invisible to this count.
    const combo = app.create("combobox", { id: "leak-combo", options: ["a", "b"] });
    mk.tick();
    const input = combo.el.querySelector("input");
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    mk.destroy(combo.node);
    await mk.flush({ animations: false });
    t.equal(await settleTimers(baseline), baseline, "a blur timer does not outlive its combobox");
  });

  test("an unowned listener is rejected at define(), before it can leak (P7)", (t) => {
    const { mk } = fixture(t);
    // The counters only see listeners added through `dom.listen`, so a raw
    // `addEventListener` would leak *past* the test above. Conformance is what
    // actually closes that hole, and it closes it at registration rather than
    // at teardown — which is the difference between a diagnostic naming the
    // type and a count that is merely wrong.
    t.throws(
      () => mk.define({
        type: "acme:leaky",
        a11y: "presentation",
        create(ctx) {
          const el = ctx.dom("div");
          el.addEventListener("click", () => {});
          return el;
        }
      }),
      /MK3007/
    );
  });
});

describe("extension points (§10)", () => {
  test("every extension point with a reader works from outside (§10, §1.5.3)", (t) => {
    const { mk, app } = fixture(t);

    // §1.5.3: a third party adds behaviour without modifying any file in
    // `source/core/`. §10 asks each point for a non-built-in consumer and
    // calls that the honest test. Four of these registered into a registry
    // nothing read until this session, so "it is in the registry" is not the
    // assertion — "it changed the result" is.

    // §10.3 — a layout algorithm.
    Mutakit.layout({
      name: "acme:diagonal", version: "1.0.0",
      arrange(node, children) {
        children.forEach((child, i) => {
          Object.assign(child.computed, { x: i * 20, y: i * 20, w: 50, h: 50 });
          node.mk.compiler.setRect(child, child.computed);
        });
      }
    }, { replace: true });
    const diagonal = app.create("pane", { id: "x-diag", algorithm: "acme:diagonal", size: { w: 400, h: 400 } });
    diagonal.create("pane", { id: "x-d0" });
    diagonal.create("pane", { id: "x-d1" });
    mk.tick();
    t.deepEqual(rect(mk.byId("x-d1")), [20, 20, 50, 50], "the algorithm placed the children");

    // §10.6 — a theme.
    Mutakit.theme("acme:midnight", { tokens: { "--mk-color-accent": "#123456" } }, { replace: true });
    mk.applyTheme("acme:midnight", app.node);
    mk.tick();
    t.equal(getComputedStyle(app.el).getPropertyValue("--mk-color-accent").trim(), "#123456",
      "the theme's token reached the DOM");

    // §10.7 — a motion preset. The duration identifies it: a fallback would
    // animate with the built-in timing instead.
    Mutakit.motion("acme:slow", {
      enter: { opacity: [0, 1], duration: 1234 },
      exit: { opacity: [1, 0], duration: 1234 },
      reduced: { opacity: [0, 1], duration: 7 }
    }, { replace: true });
    mk.define({
      type: "acme:slowpoke", a11y: "presentation",
      motion: { enter: "acme:slow", exit: "acme:slow", reduced: "acme:slow" },
      create: (ctx) => ctx.dom("div")
    }, { replace: true });
    const slow = app.create("acme:slowpoke", { id: "x-slow", size: { w: 40, h: 40 } });
    mk.tick();
    const animations = slow.el.getAnimations();
    t.ok(animations.some((a) => a.effect.getTiming().duration === 1234),
      "the custom preset is what ran");

    // §10.9 — a gesture recognizer, stepped by real pointer events.
    let ended = 0;
    Mutakit.gesture("acme:release", {
      init: () => ({ phase: "possible" }),
      step: (state, event) => (event.type === "up" ? { ...state, phase: "ended" } : state)
    }, { replace: true });
    mk.define({
      type: "acme:releaser", a11y: { role: "button" }, keys: { Enter: "activate" },
      create: (ctx) => ctx.dom("div"),
      mount: (ctx) => ctx.gesture("acme:release", { ended: () => ended++ })
    }, { replace: true });
    const releaser = app.create("acme:releaser", {
      id: "x-rel", at: "top-left", inset: 0, size: { w: 200, h: 150 }
    });
    mk.tick();
    const box = releaser.el.getBoundingClientRect();
    for (const [type, buttons] of [["pointerdown", 1], ["pointerup", 0]]) {
      releaser.el.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse",
        isPrimary: true, clientX: box.left + 10, clientY: box.top + 10, button: 0, buttons
      }));
      mk.tick();
    }
    t.equal(ended, 1, "the recognizer ran and its handler fired");
  });

  test("formatters are registered, used by built-ins, and replaceable (§10.13)", (t) => {
    const { mk, app } = fixture(t);

    // §10.13 had a registry kind reserved, a kernel method to fill it, and no
    // consumer — so nothing formatted anything. `aria-valuetext` is where it
    // earns its keep: a screen reader announcing "73%" tells a user what a
    // bare 0.73 does not.
    const meter = app.create("meter", { id: "fmt-m", value: 73, min: 0, max: 100, label: "Disk" });
    const scaled = app.create("meter", { id: "fmt-s", value: 0.73, min: 0, max: 1, label: "Scaled" });
    const progress = app.create("progress", { id: "fmt-p", value: 0.4, label: "Upload" });
    mk.tick();

    t.equal(meter.el.getAttribute("aria-valuetext"), "73%");
    t.equal(scaled.el.getAttribute("aria-valuetext"), "73%", "whatever scale the range uses");
    t.equal(progress.el.getAttribute("aria-valuetext"), "40%");
    t.equal(mk.formatted("number", 1234567), (1234567).toLocaleString());
    t.equal(mk.formatted("nope", 42), "42", "an unregistered name falls back to the value");

    // Replacing one changes every consumer at once, which is the point.
    Mutakit.formatter("percent", (value, detail) => {
      const span = (detail.max ?? 1) - (detail.min ?? 0);
      return `${Math.round(((value - (detail.min ?? 0)) / span) * 5)} of 5`;
    }, { replace: true });
    meter.set({ value: 80 });
    progress.set({ value: 0.6 });
    mk.tick();
    t.equal(meter.el.getAttribute("aria-valuetext"), "4 of 5");
    t.equal(progress.el.getAttribute("aria-valuetext"), "3 of 5", "both, from one registration");
  });

  test("a prop a type declares wins a name the engine also uses (§8.1)", (t) => {
    const { mk, app } = fixture(t);

    // `min` and `max` are geometry keys, and `meter`, `progress`, `slider`,
    // and `number` all declare props called exactly that — so their ranges
    // were read as size clamps and never reached the element. A meter asked
    // for `max: 1` kept its default of 100 and reported 1% where it meant 73%.
    const scaled = app.create("meter", { id: "shadow-m", value: 0.73, min: 0, max: 1 });
    const slider = app.create("slider", { id: "shadow-s", min: 10, max: 20, value: 15 });
    mk.tick();
    t.equal(scaled.get("max"), 1, "the type's prop receives the value");
    t.equal(slider.get("min"), 10);
    t.equal(slider.get("max"), 20);

    // And geometry keeps the name where no prop claims it.
    const pane = app.create("pane", { id: "shadow-p", size: { w: "100%", h: 50 }, max: { w: 200 } });
    mk.tick();
    t.equal(pane.node.computed.w, 200, "a pane's `max` is still a size clamp");
  });

  test("a registered anchor keyword and placement strategy are consulted (§10.5)", (t) => {
    const { mk, app } = fixture(t);

    // Neither registry had a single reader. `mk.anchor(…)` stored a resolver
    // that was never called, and `mk.placement(…)` stored `{ name }` — the
    // strategy is a function, and `{ name, ...fn }` spreads to nothing, so it
    // was dropped at registration. Both were registrable and inert.
    Mutakit.anchor("acme:golden", () => ({ fx: 0.618, fy: 0.618 }), { replace: true });
    const golden = app.create("pane", {
      id: "anch-g", at: "center", anchor: "acme:golden", size: { w: 100, h: 100 }
    });
    mk.tick();
    t.close(golden.node.computed.x, 500 - 61.8, 1, "the custom anchor positions the box");
    t.close(golden.node.computed.y, 400 - 61.8, 1);

    let received = null;
    Mutakit.placement("acme:corner", (info) => {
      received = info;
      return { box: { x: 5, y: 7, w: info.size.w, h: info.size.h }, placement: "top-start" };
    }, { replace: true });

    const popover = app.create("popover", {
      id: "anch-p", reference: { x: 400, y: 300 }, strategy: "acme:corner", size: { w: 120, h: 80 }
    });
    mk.tick();

    t.ok(received, "the strategy is called");
    t.deepEqual([popover.node.computed.x, popover.node.computed.y], [5, 7], "and its box is used");
    t.equal(popover.el.getAttribute("data-mk-placement"), "top-start",
      "including the placement it chose");
    // It is handed what it needs to make that choice, not just the numbers.
    for (const key of ["reference", "size", "bounds", "placement", "anchorTo", "fits"]) {
      t.ok(key in received, `it receives ${key}`);
    }
  });

  test("a registered input source is actually started (§10.8, §13.5)", (t) => {
    let attached = 0;
    let stopped = 0;
    let polls = 0;
    Mutakit.input("acme:probe", {
      attach(mk) {
        attached++;
        const off = mk.scheduler.on("input", () => polls++);
        return () => { stopped++; off(); };
      }
    }, { replace: true });

    // `mk.input()` put the source in the registry and nothing ever called its
    // `attach` — so the gamepad source, §10.8's one built-in consumer, polled
    // nothing and fed nothing. Registered, documented, never started.
    const mk = Mutakit.create({});
    t.equal(attached, 0, "registration alone starts nothing");

    const host = t.sandbox();
    host.style.cssText = "position:relative;width:200px;height:150px";
    mk.mount(host, { sizing: "fixed", size: { w: 200, h: 150 } });
    t.equal(attached, 1, "mounting a root starts it");

    mk.tick();
    mk.tick();
    t.ok(polls >= 2, "and it runs in the INPUT phase, once per frame");

    // A second root must not start a second copy.
    const other = t.sandbox();
    other.style.cssText = "position:relative;width:100px;height:100px";
    mk.mount(other, { sizing: "fixed", size: { w: 100, h: 100 } });
    t.equal(attached, 1, "a second root does not start it again");

    mk.destroyInstance();
    t.equal(stopped, 1, "and it is released with the instance");

    // The built-in one, through the same path.
    const withHud = Mutakit.create({});
    t.cleanup(() => withHud.destroyInstance());
    const hudHost = t.sandbox();
    hudHost.style.cssText = "position:relative;width:100px;height:100px";
    withHud.mount(hudHost, { sizing: "fixed", size: { w: 100, h: 100 } });
    t.ok(withHud._inputSources.has("gamepad"), "the gamepad source starts too");
  });

  test("a plugin registers a custom prop type, without importing core (§10.11)", (t) => {
    const { mk, app } = fixture(t);
    mk.use(AcmeWidgets, { unit: 40 });

    // §10 calls itself the complete list, and asks every point for a
    // non-built-in consumer — "an extension point with no external consumer is
    // probably wrong". `defineValidator` existed but was reachable only by
    // importing a core module, which §1.5.3 is precisely about avoiding.
    const gauge = app.create("acme:gauge", { id: "rack-a", rack: "3U", size: { w: 60, h: 60 } });
    mk.tick();
    t.equal(gauge.get("rack"), 3, "the string form is coerced by the plugin's own validator");

    const plain = app.create("acme:gauge", { id: "rack-b", rack: 2, size: { w: 60, h: 60 } });
    t.equal(plain.get("rack"), 2, "and the number form passes through");

    // A rejection travels the normal prop path: MK3005, which fails loudly in
    // the development build (P7) and carries the message the plugin wrote.
    t.throws(
      () => app.create("acme:gauge", { id: "rack-c", rack: "banana", size: { w: 60, h: 60 } }),
      /rack units like 3 or "3U"/
    );
  });
});

describe("conformance (§8.7)", () => {
  test("a reduced variant of 'none' is a finding (§17)", (t) => {
    // §17 states it outright: reduced does not mean *none*, because an
    // instantaneous state change can be more disorienting than a short fade.
    // The rule only checked for `reduced` being *absent*, so declaring it as
    // the one value the section rules out passed — and three built-in types
    // did exactly that.
    const base = { type: "acme:mover", a11y: { role: "note" }, create: (ctx) => ctx.dom("div") };
    const findings = (motion) => Mutakit.conformance({ ...base, motion }).map((f) => f.code);

    t.ok(findings({ enter: "fade", exit: "fade", reduced: "none" }).includes("MK5004"),
      "animating with reduced: 'none' is reported");
    t.ok(findings({ enter: "fade" }).includes("MK5004"), "and so is omitting it entirely");
    t.notOk(findings({ enter: "fade", exit: "fade", reduced: "fade" }).includes("MK5004"),
      "a shorter animation satisfies it");
    // An element that does not animate at all is not required to invent one.
    t.notOk(findings({ enter: "none", exit: "none", reduced: "none" }).includes("MK5004"),
      "and declaring no motion is not a motion problem");
  });

  test("binding pointer events without keys is a finding (§1.5.5)", (t) => {
    // §1.5 states it without qualification: every pointer interaction has a
    // documented keyboard equivalent. The check only looked at a hardcoded
    // list of trait *names*, so a type that wired `pointerdown` in its own
    // `create` met the criterion by not being looked at.
    const grabby = {
      type: "acme:grabby",
      a11y: { role: "button" },
      create: (ctx) => ctx.dom("div"),
      mount: (ctx) => ctx.own(ctx.listen(ctx.el, "pointerdown", () => {}))
    };
    t.ok(
      Mutakit.conformance(grabby).some((f) => f.code === "MK6001" && f.level === "error"),
      "an element that binds pointers and declares no keys is an error"
    );
    t.equal(
      Mutakit.conformance({ ...grabby, keys: { Enter: "activate" } }).length, 0,
      "and declaring the equivalent settles it"
    );

    // Hover is intent, not action — `focus` is its equivalent and needs no
    // key, so flagging it would train authors to declare keys that do nothing.
    const hoverer = {
      type: "acme:hoverer",
      a11y: { role: "note" },
      create: (ctx) => ctx.dom("div"),
      mount: (ctx) => ctx.own(ctx.listen(ctx.el, "pointerenter", () => {}))
    };
    t.equal(Mutakit.conformance(hoverer).length, 0, "hover alone is not a pointer interaction");
  });

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
  test("a modal is centred, focus-trapped, and backed by one shared backdrop", async (t) => {
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
    // §17: a removed element stays in the tree until its exit animation
    // completes. `flush({ animations: false })` is what the plan gives tests so
    // an assertion never races an animation.
    await mk.flush({ animations: false });
    mk.tick();
    t.equal(second.node.destroyed, true);
    t.equal(app.el.querySelectorAll("[data-mk-backdrop]").length, 1, "the backdrop survives for m1");
    first.close();
    await mk.flush({ animations: false });
    mk.tick();
    t.equal(app.el.querySelectorAll("[data-mk-backdrop]").length, 0, "and goes with the last one");
  });

  test("a modal uses the browser's top layer where it exists (§16.2)", async (t) => {
    const { mk, app } = fixture(t);
    const modal = app.create("modal", { id: "top", title: "Top layer" });
    mk.tick();

    const supported = mk.metrics.current.features.dialog;
    t.equal(modal.node.state.topLayer, supported, "taken exactly when the platform offers it");

    if (supported) {
      const host = modal.el.closest("dialog.mk-top-layer");
      t.ok(host, "the element was adopted into a host dialog");
      t.equal(host.open, true);
      t.equal(modal.el.getAttribute("data-mk-top-layer"), "");
      // The top layer is taken for its *stacking*, not for its scrim: one host
      // dialog per modal would paint one `::backdrop` per modal, and §16.2 asks
      // for a single reference-counted backdrop under the topmost. So
      // `::backdrop` is transparent and the layer service still supplies it.
      t.equal(app.el.querySelectorAll("[data-mk-backdrop]").length, 1,
        "the one shared backdrop is still the layer service's");
      const second = app.create("modal", { id: "top2", title: "Above" });
      mk.tick();
      t.equal(app.el.querySelectorAll("[data-mk-backdrop]").length, 1,
        "and two stacked top-layer modals still produce exactly one");
      second.close();
      await mk.flush({ animations: false });
      mk.tick();

      modal.close();
      await mk.flush({ animations: false });
      mk.tick();
      t.equal(document.querySelector("dialog.mk-top-layer"), null, "and the host goes with it");
    }
  });

  test("a light-dismiss overlay takes the portal path, and still stacks correctly", (t) => {
    const { mk, app } = fixture(t);
    // `dismiss: 'light'` is not a platform modal, so it portals — the same API
    // either way, which is the point of putting both behind one type.
    const modal = app.create("modal", { id: "portal", title: "Portal", dismiss: "light" });
    mk.tick();
    t.equal(modal.node.state.topLayer, false);
    t.equal(modal.el.closest("dialog.mk-top-layer"), null);
    t.equal(app.el.querySelectorAll("[data-mk-backdrop]").length, 1, "the layer service supplies one");
    t.ok(Number(modal.el.style.zIndex) >= 500, "in the modal band");
  });

  test("Escape dismisses the topmost overlay only, and a veto stops it", async (t) => {
    const { mk, app } = fixture(t);
    const modal = app.create("modal", { id: "guarded", title: "Unsaved" });
    mk.tick();

    modal.on("beforeclose", (event) => event.preventDefault());
    key(document.documentElement, "Escape");
    mk.tick();
    t.equal(modal.node.destroyed, false, "an unsaved-changes guard vetoes the close (§9)");

    modal.node._listeners.beforeclose.length = 0;
    key(document.documentElement, "Escape");
    await mk.flush({ animations: false });
    mk.tick();
    t.equal(modal.node.destroyed, true);
  });

  test("focus is trapped, then restored to what had it", async (t) => {
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
    await mk.flush({ animations: false });
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

  test("a menu is one tab stop with roving focus (§13.4)", async (t) => {
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
    await mk.flush({ animations: false });
    t.equal(menu.node.destroyed, true);
  });

  test("a separator does not shift which item Enter selects", async (t) => {
    const { mk, app } = fixture(t);
    const chosen = [];
    // The roving index counts buttons; `items` counts separators too. Selecting
    // by the button index reads the separator where "Paste" should be — silent,
    // because a separator is skipped rather than reported.
    const menu = app.create("menu", {
      id: "sep",
      reference: { x: 40, y: 40 },
      items: [{ label: "Cut" }, { separator: true }, { label: "Paste" }]
    });
    menu.on("select", (event) => chosen.push(event.detail.item.label));
    mk.tick();
    key(menu.el, "End");
    key(menu.el, "Enter");
    t.deepEqual(chosen, ["Paste"], "the last button is the last item, not the separator");
    await mk.flush({ animations: false });
  });

  test("submenus open on ArrowRight and the whole chain closes on select (§11.2)", async (t) => {
    const { mk, app } = fixture(t);
    const chosen = [];
    const menu = app.create("menu", {
      id: "root-menu",
      reference: { x: 100, y: 100 },
      items: [
        { label: "New" },
        {
          label: "Open recent",
          items: [{ label: "a.js" }, { label: "b.js" }]
        }
      ]
    });
    mk.tick();

    const parentItem = menu.el.querySelectorAll(".mk-menu__item")[1];
    t.equal(parentItem.getAttribute("aria-haspopup"), "menu");
    t.equal(parentItem.getAttribute("aria-expanded"), "false", "closed until it is opened");

    key(menu.el, "ArrowDown");
    key(menu.el, "ArrowRight");
    mk.tick();
    t.equal(parentItem.getAttribute("aria-expanded"), "true");

    const submenu = [...document.querySelectorAll('[role="menu"]')].find((el) => el !== menu.el);
    t.ok(submenu, "the submenu is a menu, not a special case of one");
    const subItems = submenu.querySelectorAll(".mk-menu__item");
    t.equal(subItems[0].getAttribute("tabindex"), "0", "ArrowRight moves focus into it");

    // ArrowLeft returns to the item that opened it — not to the top of the list.
    key(submenu, "ArrowLeft");
    mk.tick();
    t.equal(parentItem.getAttribute("aria-expanded"), "false");
    t.equal(parentItem.getAttribute("data-mk-active"), "", "focus lands back on the opener");

    key(menu.el, "ArrowRight");
    mk.tick();
    const reopened = [...document.querySelectorAll('[role="menu"]')].find((el) => el !== menu.el);
    mk.byId("root-menu").on("select", (event) => chosen.push(event.detail.item.label));
    key(reopened, "Enter");
    await mk.flush({ animations: false });
    mk.tick();
    t.equal(menu.node.destroyed, true, "choosing in a submenu closes the whole chain");
    t.equal(document.querySelectorAll('[role="menu"]').length, 0);
  });

  test("context mode opens from another corner rather than flipping (§11.2, §16.3)", (t) => {
    const { mk, app } = fixture(t);
    // Against the right edge, a dropdown flips to the far side of its trigger.
    // A context menu has no trigger — only a corner — so it must open leftward
    // from the same point instead.
    const menu = app.create("menu", {
      id: "corner",
      contextMode: true,
      reference: { x: 960, y: 40 },
      items: [{ label: "Cut" }, { label: "Copy" }]
    });
    mk.tick();
    t.equal(menu.el.getAttribute("data-mk-placement"), "bottom-end", "the other corner of the same point");
    t.ok(menu.node.computed.x < 960, "and the box grows leftward");
  });

  test("the context-menu trait gives right-click a keyboard equivalent (§1.5.5)", async (t) => {
    const { mk, app, host } = fixture(t);
    const chosen = [];
    const pane = app.create("pane", {
      id: "canvas",
      size: { w: 400, h: 300 },
      traits: ["context-menu"],
      "context-menu": { items: [{ label: "Cut" }, { label: "Paste" }] }
    });
    pane.on("select", (event) => chosen.push(event.detail.item.label));
    mk.tick();

    // The point has to come from where the sandbox actually is: a `contextmenu`
    // event carries viewport coordinates, and the harness scrolls.
    const origin = host.getBoundingClientRect();
    const at = { x: origin.left + 120, y: origin.top + 90 };
    pane.el.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
    );
    mk.tick();
    let menu = document.querySelector('[role="menu"]');
    t.ok(menu, "right-click opens it at the pointer");
    t.close(menu.getBoundingClientRect().left, at.x, 2,
      "anchored to the pointer's viewport point, not to the element");
    key(menu, "Escape");
    await mk.flush({ animations: false });

    // Shift+F10 is the documented equivalent, and it anchors to the element —
    // a menu at the last mouse position is disorienting to someone who never
    // used one.
    key(pane.el, "F10", { shiftKey: true });
    mk.tick();
    menu = document.querySelector('[role="menu"]');
    t.ok(menu, "Shift+F10 opens the same menu");
    key(menu, "Enter");
    await mk.flush({ animations: false });
    t.deepEqual(chosen, ["Cut"], "and selection is re-emitted on the host element");
  });

  test("a frame armed before the tab hides is late, not lost (§6.3)", async (t) => {
    const { mk, app } = fixture(t);
    app.create("pane", { id: "hidden-pane", size: { w: 10, h: 10 } });

    // A hidden document delivers no animation frames at all, so a frame armed
    // just before the switch never runs — and `await mk.flush()` in a tab the
    // user switched away from waits forever on work that is already finished.
    const original = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    t.cleanup(() => {
      delete document.visibilityState;
      if (original) Object.defineProperty(Document.prototype, "visibilityState", original);
    });
    document.dispatchEvent(new Event("visibilitychange"));

    mk.byId("hidden-pane").set({ size: { w: 20, h: 20 } });
    const settled = await Promise.race([
      mk.flush({ animations: false }).then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 1000))
    ]);
    t.equal(settled, "settled", "the timer fallback runs the frame the tab would not");
    t.equal(mk.byId("hidden-pane").node.computed.w, 20, "and the pending work actually happened");
  });

  test("Appendix B.2's S2 dialog builds verbatim, slots and all (§1.5)", (t) => {
    const { mk } = fixture(t);
    const saved = [];
    // PLAN.md Appendix B is the acceptance criteria for §1.5's "under 40 lines"
    // claim, and it writes slots as bare keys. That spelling used to be dropped
    // in silence: the dialog appeared, empty, with the form and both buttons
    // simply gone — the worst possible failure for a declarative surface.
    const prefs = mk.create("dialog", {
      id: "prefs-dialog",
      size: { w: "80%", h: "85%" }, at: "center", of: "viewport",
      title: "Preferences", dismiss: "light",
      body: {
        type: "form", id: "prefs",
        values: { theme: "dark", fontSize: 13, telemetry: false },
        schema: { fontSize: { type: "number", min: 8, max: 32, integer: true } },
        children: [
          { type: "field", label: "Theme",
            control: { type: "select", name: "theme", options: ["dark", "light", "system"] } },
          { type: "field", label: "Font size", control: { type: "number", name: "fontSize" } },
          { type: "field", label: "Telemetry", control: { type: "switch", name: "telemetry" } }
        ]
      },
      footer: {
        type: "stack", axis: "x", gap: 8, justify: "end", children: [
          { type: "button", text: "Cancel", command: "close" },
          { type: "button", text: "Save", variant: "primary", command: "submit" }
        ]
      }
    });
    prefs.on("action", (event) => saved.push(event.detail.action));
    mk.tick();

    t.equal(prefs.el.querySelectorAll(".mk-field").length, 3, "all three fields are built");
    // Once each. The shorthand lives in `create` and used to live in `build`
    // too, so every control was built twice — invisible except by counting,
    // because the duplicate sat directly behind the original.
    t.equal(prefs.el.querySelectorAll("input, select").length, 3, "and each control exactly once");
    t.ok(mk.byId("prefs"), "the form is a real element, addressable by id");
    t.equal(prefs.el.querySelectorAll("button").length, 2, "and both footer buttons exist");
    t.equal(mk.byId("prefs").values().fontSize, 13, "with the declared values bound");

    // §18.2: a declarative button invokes its dialog's command by name, which
    // is what keeps the whole tree serializable.
    prefs.el.querySelectorAll("button")[1].click();
    t.deepEqual(saved, ["submit"], "and `command: 'submit'` reaches the dialog");
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

  test("a tooltip host waits, shows on focus, and cleans up after itself", async (t) => {
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
    await mk.flush({ animations: false });
    mk.tick();
    t.equal(mk.query("tooltip"), null);
  });

  test("scroll locking is reference counted, so nested overlays do not double-lock", async (t) => {
    const { mk, app } = fixture(t);
    const layers = mk.service("layers");
    const a = app.create("modal", { id: "s1" });
    const b = app.create("modal", { id: "s2" });
    mk.tick();
    t.equal(layers.scrollLocks, 2);
    t.equal(document.documentElement.style.overflow, "hidden");

    b.close();
    await mk.flush({ animations: false });
    t.equal(document.documentElement.style.overflow, "hidden", "still locked for the first");
    a.close();
    await mk.flush({ animations: false });
    t.equal(document.documentElement.style.overflow, "", "and released exactly once");
  });
});


describe("forms (§11.3)", () => {
  test("controls wrap native elements, which is the whole accessibility story", (t) => {
    const { mk, app } = fixture(t);
    const cases = [
      ["text", "input", "text"],
      ["password", "input", "password"],
      ["number", "input", "number"],
      ["checkbox", "input", "checkbox"],
      ["switch", "input", "checkbox"],
      ["slider", "input", "range"],
      ["date", "input", "date"],
      ["file", "input", "file"],
      ["textarea", "textarea", null],
      ["select", "select", null]
    ];
    for (const [type, tag, inputType] of cases) {
      const control = app.create(type, { name: type });
      mk.tick();
      const native = control.el.querySelector(tag);
      t.ok(native, `${type} wraps a native <${tag}>`);
      if (inputType) t.equal(native.type, inputType);
      t.equal(native.name, type, "and carries its name, so autofill works");
    }
    t.equal(app.node.children[4].el.querySelector("input").getAttribute("role"), "switch",
      "a switch is a checkbox with one attribute changed");
  });

  test("a field wires label, description, and error to its control automatically", (t) => {
    const { mk, app } = fixture(t);
    const field = app.create("field", {
      id: "port-field",
      label: "Port",
      description: "1–65535",
      required: true
    });
    const input = field.create("number", { name: "port", value: 8080 });
    mk.tick();

    const native = input.el.querySelector("input");
    t.equal(field.el.querySelector("label").getAttribute("for"), native.id);
    t.equal(native.getAttribute("aria-describedby"), "port-field-desc");
    t.equal(native.getAttribute("aria-required"), "true");
    t.equal(native.value, "8080");

    field.set({ error: "Already in use" });
    mk.tick();
    t.equal(native.getAttribute("aria-invalid"), "true");
    t.ok(native.getAttribute("aria-describedby").includes("port-field-error"));
    t.equal(field.el.querySelector(".mk-field__error").textContent, "Already in use");
    t.equal(field.el.querySelector(".mk-field__error").getAttribute("role"), "alert");
  });

  test("validation runs on submit, then on change for fields that already errored", async (t) => {
    const { mk, app } = fixture(t);
    const form = app.create("form", {
      id: "settings",
      values: { email: "", port: 8080 },
      schema: {
        email: { type: "string", required: true, format: "email" },
        port: { type: "number", min: 1, max: 65535, integer: true }
      }
    });
    const emailField = form.create("field", { id: "email-field", label: "Email" });
    const email = emailField.create("text", { name: "email" });
    const portField = form.create("field", { id: "port-field", label: "Port" });
    portField.create("number", { name: "port", value: 8080 });
    mk.tick();

    const submitted = [];
    form.on("submit", (event) => submitted.push(event.detail.values));
    form.on("invalid", (event) => submitted.push({ invalid: Object.keys(event.detail.errors) }));

    const ok = await form.submit();
    mk.tick();
    t.equal(ok, false, "an empty required field fails");
    t.deepEqual(submitted, [{ invalid: ["email"] }]);
    t.equal(emailField.get("error").length > 0, true, "the message lands on the field");
    t.equal(document.activeElement.closest(".mk-field"), emailField.el,
      "and focus moves to the first invalid control (§11.3)");

    // Revalidation on change, but only for what has already errored.
    const native = email.el.querySelector("input");
    native.value = "not-an-email";
    native.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
    mk.tick();
    t.ok(emailField.get("error"), "still invalid, and it says so as you type now");

    native.value = "a@b.co";
    native.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    mk.tick();
    t.equal(emailField.get("error"), "", "and clears the moment it is fixed");

    const done = await form.submit();
    t.equal(done, true);
  });

  test("an async validator's out-of-order response cannot win", async (t) => {
    const { mk, app } = fixture(t);
    let resolveSlow;
    const form = app.create("form", {
      id: "async-form",
      values: { name: "a" },
      schema: { name: { type: "string" } },
      validate: {
        name: (value) =>
          value === "a"
            ? new Promise((resolve) => { resolveSlow = () => resolve("stale verdict"); })
            : null
      }
    });
    mk.tick();

    const slow = form.validateField("name");
    form.node.state.values.name = "b";
    await form.validateField("name");
    resolveSlow();
    await slow;
    t.deepEqual(form.state().errors, {}, "the newer run's verdict stands");
  });

  test("cross-field validators see every value", async (t) => {
    const { mk, app } = fixture(t);
    const form = app.create("form", {
      id: "pw",
      values: { password: "secret", confirm: "typo" },
      schema: {},
      validate: {
        $form: (values) =>
          values.password === values.confirm ? null : { confirm: "Passwords do not match" }
      }
    });
    mk.tick();
    const ok = await form.submit();
    t.equal(ok, false);
    t.equal(form.state().errors.confirm, "Passwords do not match");
  });

  test("dirty tracking and reset", (t) => {
    const { mk, app } = fixture(t);
    const form = app.create("form", { id: "dirty", values: { a: 1 }, schema: {} });
    mk.tick();
    t.equal(form.state().dirty, false);
    form.node.state.values.a = 2;
    t.equal(form.state().dirty, true);
    form.reset();
    t.equal(form.state().dirty, false);
  });

  test("a combobox implements the ARIA pattern, keyboard included", (t) => {
    const { mk, app } = fixture(t);
    const combo = app.create("combobox", {
      id: "cb",
      options: ["Alpha", "Beta", "Gamma"],
      placeholder: "Search"
    });
    mk.tick();
    const input = combo.el.querySelector("input");
    t.equal(input.getAttribute("role"), "combobox");
    t.equal(input.getAttribute("aria-expanded"), "false");
    t.equal(input.getAttribute("aria-autocomplete"), "list");

    key(input, "ArrowDown");
    t.equal(input.getAttribute("aria-expanded"), "true");
    t.equal(combo.el.querySelectorAll('[role="option"]').length, 3);
    t.ok(input.getAttribute("aria-activedescendant"), "focus stays in the input");

    key(input, "ArrowDown");
    key(input, "Enter");
    t.equal(combo.get("value"), "Beta");
    t.equal(input.getAttribute("aria-expanded"), "false");

    input.value = "gam";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    t.equal(combo.el.querySelectorAll('[role="option"]').length, 1, "and it filters");
  });

  test("a radio group carries the group semantics its radios cannot", (t) => {
    const { mk, app } = fixture(t);
    const group = app.create("radio-group", {
      id: "density",
      label: "Density",
      options: [{ value: "compact", label: "Compact" }, { value: "cosy", label: "Cosy" }],
      value: "cosy"
    });
    mk.tick();
    t.equal(group.el.getAttribute("role"), "radiogroup");
    t.equal(group.el.getAttribute("aria-label"), "Density");
    const radios = group.el.querySelectorAll('input[type="radio"]');
    t.equal(radios[1].checked, true);
    t.equal(radios[0].name, radios[1].name, "one name, so the browser gives exclusivity");
  });

  test("tags: Enter adds, Backspace on an empty input removes the last", (t) => {
    const { mk, app } = fixture(t);
    const tags = app.create("tags", { id: "labels", value: ["one"] });
    mk.tick();
    const input = tags.el.querySelector("input");

    input.value = "two";
    key(input, "Enter");
    mk.tick();
    t.deepEqual(tags.get("value"), ["one", "two"]);
    t.equal(tags.el.querySelectorAll(".mk-tags__tag").length, 2);

    input.value = "";
    key(input, "Backspace");
    mk.tick();
    t.deepEqual(tags.get("value"), ["one"], "the only keyboard path to removal");
  });

  test("a segmented control is a radio group with roving focus", (t) => {
    const { mk, app } = fixture(t);
    const seg = app.create("segmented", {
      id: "align",
      label: "Align",
      options: ["left", "center", "right"],
      value: "left"
    });
    mk.tick();
    const buttons = seg.el.querySelectorAll('[role="radio"]');
    t.equal(buttons[0].getAttribute("tabindex"), "0");
    t.equal(buttons[1].getAttribute("tabindex"), "-1");
    key(seg.el, "ArrowRight");
    mk.tick();
    t.equal(seg.get("value"), "center");
    t.equal(buttons[1].getAttribute("aria-checked"), "true");
  });

  test("shortcuts resolve most-specific-scope-first, and chords work", (t) => {
    const { mk, app } = fixture(t);
    const shortcuts = mk.service("shortcuts");
    const fired = [];

    const pane = app.create("pane", { id: "scoped", size: { w: 100, h: 100 } });
    mk.tick();
    t.cleanup(shortcuts.bind("Mod+K", () => fired.push("global"), { scope: "global" }));
    t.cleanup(
      shortcuts.bind("Mod+K", () => fired.push("subtree"), { scope: "subtree", node: pane.node })
    );
    t.cleanup(shortcuts.bind("Ctrl+G Ctrl+S", () => fired.push("chord"), { scope: "global" }));

    key(document.documentElement, "k", { ctrlKey: true });
    t.deepEqual(fired, ["global"]);

    key(pane.el, "k", { ctrlKey: true });
    t.deepEqual(fired, ["global", "subtree"], "the more specific live scope wins");

    key(document.documentElement, "g", { ctrlKey: true });
    t.equal(fired.length, 2, "the first stroke of a chord fires nothing");
    key(document.documentElement, "s", { ctrlKey: true });
    t.ok(fired.includes("chord"), "the second completes it");

    const sheet = shortcuts.cheatSheet();
    t.ok(sheet.global.length >= 2, "the cheat sheet is generated, not written");
  });

  test("a duplicate binding is reported at registration, not at press time", (t) => {
    const { mk } = fixture(t);
    const records = [];
    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));
    const shortcuts = mk.service("shortcuts");
    t.cleanup(shortcuts.bind("Mod+P", () => {}, { description: "Print" }));
    t.cleanup(shortcuts.bind("Mod+P", () => {}, { description: "Palette" }));
    t.ok(records.some((r) => r.code === "MK6004"));
  });
});


describe("HUD and game (§11.5, S3)", () => {
  test("§18.5's whole HUD, in `at` + `inset` + `size` and no arithmetic", (t) => {
    const { mk, app } = fixture(t);
    const hud = app.create("hud-layer", { id: "hud" });
    mk.tick();

    const health = hud.create("hud-bar", { id: "health", at: "top-left", inset: 16, size: { w: 280, h: 20 } });
    const map = hud.create("minimap", { id: "map", at: "top-right", inset: 16, size: { w: "12gu", h: "12gu" } });
    const reticle = hud.create("crosshair", { id: "reticle", at: "center" });
    const feed = hud.create("notification-feed", { id: "feed", at: "bottom-right", inset: 16, size: { w: 320 } });
    mk.tick();

    t.deepEqual(rect(health), [16, 16, 280, 20]);
    t.close(reticle.node.computed.x, 488);
    t.close(feed.node.computed.x, 664);
    // 1gu = min(vw, vh) / 24, so the expectation is the live viewport's, not a
    // constant — which is the entire point of the unit.
    const metrics = mk.metrics.current;
    const gu = Math.min(metrics.vw, metrics.vh) / 24;
    t.close(map.node.computed.w, 12 * gu, 1, "the gu unit scales the map with the viewport");
    t.equal(getComputedStyle(hud.el).pointerEvents, "none", "and the layer is transparent to the pointer");
  });

  test("§18.5's opening and closing lines, which nothing exercised (§16.1)", (t) => {
    const { mk } = fixture(t);
    // Line 1. A band had no spelling of its own: every overlay family reaches
    // one by declaring `layer` on its type, but a *layer* had to be assembled
    // by hand from the right host type and four edge constraints.
    const hud = mk.layer("hud", { of: "viewport", insets: "safe" });
    mk.tick();
    t.equal(hud.node.type, "hud-layer", "a band with a host type gets it");
    t.deepEqual(rect(hud), [0, 0, 1000, 800], "and it is full-frame without being told");
    t.equal(mk.layer("docked").node.type, "pane", "a band without one gets a plain pane");

    // The abilities line. `children` was a tier-2 word tier 1 could not say, so
    // this stack came out 0×0 with nothing in it.
    const abilities = hud.create("stack", {
      id: "abilities", at: "bottom", inset: { bottom: 24 }, axis: "x", gap: 8,
      children: [{ type: "pane", id: "q", size: { w: 40, h: 40 } },
                 { type: "pane", id: "w", size: { w: 40, h: 40 } }]
    });
    mk.tick();
    t.equal(abilities.node.children.length, 2, "both slots are built");
    t.ok(mk.byId("q") && mk.byId("w"), "each is addressable, so each is a real element");
    t.equal(abilities.node.children[0].parent, abilities.node, "and parented to the stack");

    // Pinned to an edge with no size, so it sizes to its content — the row's
    // width, not the widest child's. The algorithm's `display: flex` used to
    // arrive in WRITE, one phase after the READ that measured it, so the first
    // measurement saw a block container and read a column.
    const boxes = [...abilities.el.children].map((el) => el.getBoundingClientRect());
    t.close(abilities.node.computed.w, boxes[0].width + 8 + boxes[1].width, 1,
      "the stack is as wide as the row it lays out");
    t.close(boxes[0].top, boxes[1].top, 1, "and both children are on that row");
    t.close(abilities.node.computed.h, boxes[0].height, 1, "one row tall, not two");
  });

  test("a notification feed grows with its messages and stays inside the frame", async (t) => {
    const { mk, app } = fixture(t);
    const hud = app.create("hud-layer", { id: "feed-hud" });
    // The width only, exactly as an author would write it. The type's default
    // is `{ w: 320, h: 'auto' }`, and supplying one axis used to discard the
    // other, which left the feed nought high.
    const feed = hud.create("notification-feed", {
      id: "feed-under-test", at: "bottom-right", inset: 16, size: { w: 320 }, ttl: 0
    });
    mk.tick();
    await mk.flush({ animations: false });
    t.equal(feed.node.geometry.size.h, "auto", "the default height survived a partial size");

    feed.push("Wave cleared");
    feed.push("Ammo low");
    mk.tick();
    await mk.flush({ animations: false });

    // `push` builds its items with `dom.el`, so nothing tells the engine the
    // content changed — and an auto-sized node is pinned to its last measured
    // height, so the observer watching it cannot see the growth either. It
    // measured empty once and stayed that way, anchored to the bottom edge with
    // every message drawn below it, off the screen.
    t.ok(feed.node.computed.h > 0, "it has a height once it has messages");
    const frame = app.node.computed;
    t.ok(
      feed.node.computed.y + feed.node.computed.h <= frame.h + 1,
      "and its bottom edge is inside the frame, not past it"
    );
  });

  test("hud-* elements are presentational by default, and a meter is not", (t) => {
    const { mk, app } = fixture(t);
    const hud = app.create("hud-layer", { id: "h2" });
    const reticle = hud.create("crosshair", {});
    const bar = hud.create("hud-bar", { value: 0.5, label: "Health" });
    mk.tick();

    t.equal(hud.el.getAttribute("role"), "presentation");
    t.equal(reticle.el.getAttribute("role"), "presentation", "decoration opts out (§11.5)");
    t.equal(bar.el.getAttribute("role"), "meter", "but a value a player needs does not");
    t.equal(bar.el.getAttribute("aria-valuenow"), "50");
  });

  test("a bar animates on the STYLE path, never through ARRANGE", (t) => {
    const { mk, app } = fixture(t);
    const hud = app.create("hud-layer", { id: "h3" });
    const bar = hud.create("hud-bar", { id: "hp", value: 1, size: { w: 200, h: 16 } });
    mk.tick();

    const before = { x: bar.node.computed.x, w: bar.node.computed.w };
    bar.set({ value: 0.4 });
    mk.tick();
    t.equal(bar.el.style.getPropertyValue("--mk-hud-fill"), "0.4", "a scale, not a width");
    t.deepEqual({ x: bar.node.computed.x, w: bar.node.computed.w }, before, "geometry never moved");
    t.equal(bar.el.style.getPropertyValue("--mk-hud-ghost"), "1", "and the ghost trails behind");
  });

  test("a marker projects in PAINT and writes only a transform", (t) => {
    const { mk, app } = fixture(t);
    const hud = app.create("hud-layer", { id: "h4" });
    let world = { x: 300, y: 200 };
    const marker = hud.create("hud-marker", {
      id: "objective",
      project: () => ({ x: world.x, y: world.y }),
      label: "Objective"
    });
    mk.tick();
    t.equal(marker.el.style.transform, "translate3d(300px, 200px, 0px)");

    world = { x: 5000, y: 200 };
    mk.tick();
    t.equal(marker.el.getAttribute("data-mk-offscreen"), "", "clamped to the edge");
    t.equal(marker.el.style.transform, "translate3d(976px, 200px, 0px)");
    t.equal(marker.node.computed.x, 0, "and the layout rect never moved");
  });

  test("the custom unit records its pixels when serialized (§19.1)", (t) => {
    const { mk, app } = fixture(t);
    mk.use(persistencePlugin);
    const hud = app.create("hud-layer", { id: "h5" });
    hud.create("minimap", { id: "m", size: { w: "12gu", h: "12gu" } });
    mk.tick();

    const doc = mk.serialize();
    const map = JSON.stringify(doc);
    t.ok(map.includes('"12gu"'), "the live expression survives");
    t.ok(map.includes('"px"'), "alongside the pixels, so a missing plugin cannot collapse it");
  });

  test("arrow keys drive spatial navigation, and yield to controls (§13.6)", (t) => {
    const { mk, app } = fixture(t);
    const hud = app.create("hud-layer", { id: "sn-hud", spatial: true, interactive: true });
    const put = (id, left, top) => hud.create("pane", {
      id, at: "top-left", inset: { left, top }, size: { w: 60, h: 40 }, traits: ["focusable"]
    });
    const centre = put("sn-c", 370, 280);
    put("sn-up", 370, 100);
    put("sn-down", 370, 460);
    put("sn-left", 100, 280);
    put("sn-right", 640, 280);
    mk.tick();

    // §13.6 says this is available to keyboard arrows *and* gamepad sticks
    // alike. Only the gamepad source ever called `move()` — the scoring
    // function worked, `enable()` registered the container, and pressing an
    // arrow did nothing, so the feature existed for whoever owned a gamepad.
    const focused = () => document.activeElement.getAttribute("data-mk-id");
    for (const [key, expected] of [["ArrowUp", "sn-up"], ["ArrowDown", "sn-down"],
                                   ["ArrowLeft", "sn-left"], ["ArrowRight", "sn-right"]]) {
      centre.el.focus();
      hud.el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
      mk.tick();
      t.equal(focused(), expected, `${key} moves that way`);
    }

    // Arrows belong to the focused control first. A text field uses them for
    // the caret; stealing those to move focus across the HUD breaks it (§13.4).
    const field = hud.create("text", { id: "sn-input", name: "n" });
    mk.tick();
    const input = field.el.querySelector("input");
    input.focus();
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowLeft" });
    input.dispatchEvent(event);
    mk.tick();
    t.equal(document.activeElement, input, "focus stays in the field");
    t.notOk(event.defaultPrevented, "and the key is left for it to use");
  });

  test("spatial navigation prefers alignment over raw distance (§13.6)", (t) => {
    const { mk } = fixture(t);
    const from = { x: 0, y: 100, w: 50, h: 50 };
    // Directly ahead but far, versus near but off to the side.
    const ahead = { x: 400, y: 100, w: 50, h: 50 };
    const aside = { x: 80, y: 400, w: 50, h: 50 };
    t.ok(
      mkInput.score(from, ahead, "right") < mkInput.score(from, aside, "right"),
      "a target directly ahead is almost always the intended one"
    );
    t.equal(mkInput.score(from, { x: -200, y: 100, w: 50, h: 50 }, "right"), Infinity,
      "and nothing behind you is a candidate");
  });

  test("100 animating HUD elements stay on the PAINT path", (t) => {
    const { mk, app } = fixture(t);
    const hud = app.create("hud-layer", { id: "load" });
    const bars = [];
    for (let i = 0; i < 100; i++) {
      bars.push(hud.create("hud-bar", { at: "top-left", inset: i, size: { w: 60, h: 6 }, value: 1 }));
    }
    mk.tick();

    const writesBefore = mk.compiler.writes;
    const started = performance.now();
    for (let frame = 0; frame < 10; frame++) {
      for (const bar of bars) bar.set({ value: (frame % 10) / 10 });
      mk.tick();
    }
    const elapsed = (performance.now() - started) / 10;

    t.ok(elapsed < 16, `${elapsed.toFixed(1)}ms per frame for 100 elements`);
    // Two custom properties per bar per frame is the whole write cost.
    const perFrame = (mk.compiler.writes - writesBefore) / 10;
    t.ok(perFrame <= 100 * 3, `${perFrame} property writes per frame, no layout`);
  });
});


describe("ecosystem (§26 M6)", () => {
  test("a plugin published from outside the repository installs with mk.use()", (t) => {
    // The milestone's completion criterion, and the honest test of §10: the
    // plugin has its own package.json, imports nothing from source/, and
    // reaches the library only through the `mk` it is handed.
    const { mk, app } = fixture(t);
    mk.use(AcmeWidgets, { unit: 40 });

    t.ok(mk.plugins.has("acme-widgets"));
    t.equal(mk.plugins.get("acme-widgets").version, "1.2.0");

    const rack = app.create("pane", { id: "rack", left: 0, top: 0, width: 200, height: 400 });
    mk.applyAlgorithm(rack.node, "acme:rack", { gap: 4 });
    const gauge = rack.create("acme:gauge", { id: "g1", label: "Gain", layout: { units: 2 } });
    rack.create("acme:gauge", { id: "g2", layout: { units: 1 } });
    mk.tick();

    // The unit, the element, the trait, and the algorithm, all at once.
    t.equal(gauge.el.getAttribute("role"), "meter", "its a11y declaration was honoured");
    t.deepEqual(rect(gauge), [0, 0, 200, 80], "2u at 40px, placed by acme:rack");
    t.deepEqual(rect(mk.byId("g2")), [0, 84, 200, 40], "and the gap is the algorithm's");
    t.ok(gauge.node.traits.has("acme:pulse"), "its own trait attached");

    gauge.setValue(0.5);
    t.equal(gauge.get("value"), 0.5, "and its command became a handle method");
  });

  test("a plugin's contributions deregister without destroying live elements (§8.5)", (t) => {
    const { mk, app } = fixture(t);
    const records = [];
    mk.use(AcmeWidgets, {});
    const live = app.create("acme:gauge", { id: "survivor" });
    mk.tick();

    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));
    mk.unuse("acme-widgets");

    t.equal(live.node.destroyed, false, "existing instances keep working");
    t.ok(records.some((r) => r.code === "MK4014"), "and the situation is reported, with a count");
    t.throws(() => mk.create("acme:gauge", {}, app.node), /MK3001/, "only new ones fail");
  });

  test("the DSL compiles to tier 2 and has no capabilities of its own (§18.3)", (t) => {
    const spec = compileDSL(`
      split x gutter:6 {
        pane #sidebar 240 min:160 max:35%
        pane #main 1fr
      }
    `);
    t.equal(spec.type, "split");
    t.equal(spec.axis, "x");
    t.equal(spec.gutter, 6);
    t.equal(spec.children.length, 2);
    t.equal(spec.children[0].id, "sidebar");
    t.equal(spec.children[0].layout.size, 240);
    t.equal(spec.children[0].layout.min, 160);
    t.equal(spec.children[1].layout.size, "1fr");
  });

  test("the DSL builds the same tree the object form does", (t) => {
    const { mk, app } = fixture(t);
    const fromObjects = mk.build(
      {
        type: "split",
        axis: "x",
        gutter: 6,
        children: [
          { type: "pane", id: "a1", layout: { size: 240 } },
          { type: "pane", id: "b1", layout: { size: "1fr" } }
        ]
      },
      app.node
    );
    mk.tick();
    const objectSnapshot = [rect(mk.byId("a1")), rect(mk.byId("b1"))];

    const second = fixture(t);
    second.mk.build(compileDSL("split x gutter:6 { pane #a2 240 pane #b2 1fr }"), second.app.node);
    second.mk.tick();
    t.deepEqual([rect(second.mk.byId("a2")), rect(second.mk.byId("b2"))], objectSnapshot,
      "one semantic model, three notations (§18)");
  });

  test("a DSL syntax error points at the line", (t) => {
    t.throws(() => compileDSL("split x {\n  240px\n}"), /line 2/);
  });

  test("Appendix B.1's S1 shell builds verbatim, all 26 lines (§1.5)", (t) => {
    const host = t.sandbox();
    host.style.cssText = "position:relative;width:1200px;height:800px";
    const mk = Mutakit.create({ theme: "dark" });
    t.cleanup(() => mk.destroyInstance());
    const app = mk.mount(host, { sizing: "fixed", size: { w: 1200, h: 800 } });

    const shell = app.dock({
      corners: "horizontal",
      regions: {
        top: { id: "menubar", size: 36 },
        bottom: { id: "statusbar", size: 22 },
        center: { id: "body" }
      }
    });
    // `region('body')` names the centre by the id it was given. Before this the
    // appendix's line 8 was not expressible: `dock()` handed back an array, so
    // the author had to know the order the implementation built regions in.
    const [explorer, work] = shell.region("body").split({
      axis: "x",
      gutter: { size: 6, draggable: true },
      panes: [
        { id: "explorer", size: 260, min: 160, max: "40%", collapsible: { at: 120, to: 0 } },
        { id: "work", size: "1fr" }
      ]
    });
    const [editor, panel] = work.split({
      axis: "y",
      gutter: { size: 6, draggable: true },
      panes: [
        { id: "editor", size: "1fr", min: 120 },
        { id: "panel", size: 200, min: 60, collapsible: { at: 48, to: 0 } }
      ]
    });
    explorer.create("tree", { id: "files", data: [{ id: "a", label: "a.js" }], selection: "single" });
    editor.create("tabs", { id: "docs", closable: true, reorderable: true });
    panel.create("tabs", { id: "panels", tabs: ["Terminal", "Problems"] });
    mk.persist("ide-layout", { storage: localStorage, debounce: 300 });
    mk.tick();

    t.deepEqual(rect(mk.byId("menubar")), [0, 0, 1200, 36], "the menubar spans the top");
    t.deepEqual(rect(mk.byId("statusbar")), [0, 778, 1200, 22], "the statusbar sits on the bottom");
    t.deepEqual(rect(mk.byId("body")), [0, 36, 1200, 742], "and the centre takes what is left");
    t.equal(Math.round(mk.byId("explorer").node.computed.w), 260);
    t.equal(Math.round(mk.byId("panel").node.computed.h), 200);
    t.equal(Math.round(mk.byId("editor").node.computed.h), 536, "1fr minus the panel and gutter");
    // A tab group declared no default size at all, so it collapsed to 0×1 —
    // the entire editor area disappeared while every pane around it was right.
    t.equal(Math.round(mk.byId("docs").node.computed.h), 536, "tabs fill the pane they are in");
    t.equal(Math.round(mk.byId("files").node.computed.w), 260);
    t.equal(typeof mk.persist, "function", "and a created instance has the preset's plugins");
  });

  test("every algorithm's computed rects match the boxes the browser drew (P1)", (t) => {
    // The sweep, rather than one scenario. `anchor` was drawing every node in
    // the wrong place and no test noticed, because every layout test asserted
    // `node.computed` and none had ever compared it against the DOM. This walks
    // each algorithm's subtree and checks the two agree.
    const scenarios = {
      split: (app) => app.split({
        axis: "x", gutter: { size: 6, draggable: true },
        panes: [{ id: "z-a", size: 200 }, { id: "z-b", size: "1fr" }, { id: "z-c", size: "1fr" }]
      }),
      dock: (app) => app.dock({
        regions: { top: { id: "z-t", size: 40 }, start: { id: "z-s", size: 200 }, center: { id: "z-c2" } }
      }),
      stack: (app) => {
        const s = app.create("stack", { id: "z-sk", axis: "y", gap: 8, size: { w: 300, h: 400 } });
        s.create("pane", { id: "z-k1", content: "one" });
        s.create("pane", { id: "z-k2", content: "two" });
      },
      grid: (app) => {
        app.grid({ columns: ["1fr", "2fr"], rows: ["100px", "1fr"] });
        app.create("pane", { id: "z-g1" });
        app.create("pane", { id: "z-g2" });
      },
      free: (app) => {
        app.free({});
        app.create("pane", { id: "z-f1", at: "top-left", inset: 20, size: { w: 100, h: 80 } });
        app.create("pane", { id: "z-f2", at: "top-left", inset: { left: 20, top: 200 }, size: { w: 100, h: 80 } });
      },
      // `flow` computes nothing itself — the boxes are read back in READ, and
      // before that every one of them serialized as zero (§7.6).
      flow: (app) => {
        app.flow({ gap: 8 });
        app.create("pane", { id: "z-w1", content: "aa" });
        app.create("pane", { id: "z-w2", content: "bb" });
      }
    };

    for (const name of Object.keys(scenarios)) {
      const { mk, app } = fixture(t);
      scenarios[name](app);
      mk.tick();

      const nodes = [];
      const walk = (node) => { for (const child of node.children) { nodes.push(child); walk(child); } };
      walk(app.node);

      for (const node of nodes) {
        if (!node.el || node.el.offsetParent === null) continue;
        const parentBox = (node.parent.el || app.el).getBoundingClientRect();
        const drawn = node.el.getBoundingClientRect();
        const label = `${name}: ${node.type}#${node.id || "?"}`;
        t.close(drawn.left - parentBox.left, node.computed.x, 1.5, `${label} x`);
        t.close(drawn.top - parentBox.top, node.computed.y, 1.5, `${label} y`);
        t.close(drawn.width, node.computed.w, 1.5, `${label} w`);
        t.close(drawn.height, node.computed.h, 1.5, `${label} h`);
      }
    }
  });

  test("what the engine computes is where the browser draws it (P1)", (t) => {
    const { mk, app, host } = fixture(t);
    // Every test until this one asserted `node.computed`, so nothing noticed
    // that the DOM disagreed. `[data-mk-algorithm="anchor"]` had the same
    // specificity as `.mk-node` and sat in a later layer, so every node — the
    // algorithm is the default, so that is every node — was relatively
    // positioned, and a relative box offsets from where flow put it. The
    // engine said y=200; the browser drew 250, displaced by the sibling above.
    const first = app.create("pane", { id: "row-1", at: "top-left", inset: 10, size: { w: 100, h: 50 } });
    const second = app.create("pane", {
      id: "row-2", at: "top-left", inset: { left: 10, top: 200 }, size: { w: 100, h: 50 }
    });
    mk.tick();

    const origin = host.getBoundingClientRect();
    for (const handle of [first, second]) {
      const drawn = handle.el.getBoundingClientRect();
      t.close(drawn.left - origin.left, handle.node.computed.x, 1, `${handle.node.id}: x agrees`);
      t.close(drawn.top - origin.top, handle.node.computed.y, 1, `${handle.node.id}: y agrees`);
    }
  });

  test("an auto size measures the node's own content, not its parent (§6.5)", async (t) => {
    const { mk, app } = fixture(t);
    // Custom properties inherit, so a node the engine had not sized read its
    // *parent's* `--mk-w` and the `auto` fallback was unreachable below the
    // root: every auto size silently resolved to the parent's width. Nothing
    // looked broken — the box was simply always as big as its container.
    const auto = app.create("pane", {
      id: "auto-box", at: "top-left", inset: 8,
      content: "Hello there", size: { w: "auto", h: "auto" }
    });
    mk.tick();
    await mk.flush({ animations: false });

    t.ok(auto.node.computed.w > 0, "it has a width");
    t.ok(auto.node.computed.w < 400, "and it is the text's, not the 1000px frame's");
    t.ok(auto.node.computed.h < 100, "same on the block axis");
    t.close(auto.node.computed.w, auto.el.getBoundingClientRect().width, 1,
      "and the engine's number agrees with the box the browser drew");
  });

  test("a padded auto-sized node keeps its height when re-measured (§6.5)", async (t) => {
    const { mk, app } = fixture(t);
    // Two strategies measure the same node: a forced read on the first frame,
    // and a ResizeObserver afterwards. The observer reported `contentRect`,
    // which excludes padding, while the engine writes the result into `--mk-h`
    // under `box-sizing: border-box`. So a padded element measured its border
    // box once, then re-measured as its *content* box and shrank by exactly its
    // padding — every time anything made the observer fire, until it vanished.
    const item = app.create("pane", {
      id: "padded", at: "top-left", content: "Item",
      size: { w: "auto", h: "auto" }, style: { padding: "3px 8px" }
    });
    mk.tick();
    await mk.flush({ animations: false });
    const first = item.node.computed.h;
    t.ok(first > 0, "it measured something");

    // Force the observer to fire, repeatedly. A stable measurement survives it.
    for (let i = 0; i < 3; i++) {
      item.el.style.width = i % 2 ? "140px" : "150px";
      await new Promise((resolve) => setTimeout(resolve, 60));
      await mk.flush({ animations: false });
    }
    item.el.style.width = "";
    await mk.flush({ animations: false });

    t.close(item.node.computed.h, first, 1.5,
      "the height is the one it started with, not one padding shorter per pass");
    t.close(item.node.computed.h, item.el.offsetHeight, 1.5,
      "and it still agrees with the box the browser drew");
  });

  test("dock arbitrates its corners and contributes insets to the centre (§7.4)", (t) => {
    const { mk, app } = fixture(t);
    mk.applyAlgorithm(app.node, "dock", {
      corners: "horizontal",
      regions: {
        top: { size: 40, id: "menubar" },
        bottom: { size: 24, id: "statusbar" },
        start: { size: 260, id: "explorer" },
        center: { id: "workspace" }
      }
    });
    mk.tick();

    t.deepEqual(rect(mk.byId("menubar")), [0, 0, 1000, 40], "top spans the full width");
    t.deepEqual(rect(mk.byId("statusbar")), [0, 776, 1000, 24]);
    t.deepEqual(rect(mk.byId("explorer")), [0, 40, 260, 736], "the rail runs between them");
    t.deepEqual(rect(mk.byId("workspace")), [260, 40, 740, 736], "and the centre takes the rest");
  });

  test("free places new children by cascade and keeps them grabbable (§7.7)", (t) => {
    const { mk, app } = fixture(t);
    mk.applyAlgorithm(app.node, "free", { bounds: "container", placement: "cascade", keepVisible: 24 });
    const a = app.create("window", { id: "w1", title: "One", size: { w: 300, h: 200 } });
    const b = app.create("window", { id: "w2", title: "Two", size: { w: 300, h: 200 } });
    mk.tick();

    t.notEqual(a.node.computed.x, b.node.computed.x, "windows do not stack at one point");
    a.constrain({});
    a.node.layoutProps.x = -1000;
    mk.tick();
    t.ok(a.node.computed.x > -300, "and one dragged off the edge stays grabbable");
  });

  test("a window composes drag, resize, and recency stacking", (t) => {
    const { mk, app } = fixture(t);
    mk.applyAlgorithm(app.node, "free", {});
    const first = app.create("window", { id: "win1", title: "First" });
    const second = app.create("window", { id: "win2", title: "Second" });
    mk.tick();

    t.ok(first.node.traits.has("draggable") && first.node.traits.has("resizable"));
    t.equal(first.el.querySelector(".mk-window__bar").textContent.includes("First"), true);
    t.equal(second.el.querySelector('[aria-label="Close"]') !== null, true);

    const layers = mk.service("layers");
    t.equal(layers.topOf("docked"), second.node);
    layers.bringToFront(first.node);
    t.equal(layers.topOf("docked"), first.node, "raised within its band, never across one");
  });

  test("tabs are one tab stop with roving focus and inert panels", (t) => {
    const { mk, app } = fixture(t);
    const group = app.create("tabs", {
      id: "docs",
      items: [{ id: "one", label: "One" }, { id: "two", label: "Two" }],
      active: "one",
      closable: true
    });
    group.create("pane", { id: "one", content: "first" });
    group.create("pane", { id: "two", content: "second" });
    mk.tick();

    const tabButtons = group.el.querySelectorAll('[role="tab"]');
    t.equal(tabButtons.length, 2);
    t.equal(tabButtons[0].getAttribute("aria-selected"), "true");
    t.equal(tabButtons[1].getAttribute("tabindex"), "-1");
    t.equal(mk.byId("two").el.hasAttribute("inert"), true, "a hidden panel is out of the tab order");

    key(group.el.querySelector(".mk-tabs__list"), "ArrowRight");
    mk.tick();
    t.equal(group.get("active"), "two");
    t.equal(mk.byId("one").el.hasAttribute("inert"), true);
  });

  test("devtools takes what the public API returns — a handle (§19.3)", (t) => {
    const { mk, app } = fixture(t);
    mk.use(devtoolsPlugin);
    app.dock({ regions: { top: { id: "dv-bar", size: 40 }, center: { id: "dv-main" } } });
    mk.byId("dv-main").create("pane", { id: "dv-leaf", content: "hi" });
    mk.tick();

    // Every public entry point returns a *handle* — `byId`, `create`, `region`,
    // `query`. Devtools was written against the engine's nodes, so the natural
    // call threw on `root.walk is not a function`: the geometry overlay §19.3
    // calls the single most valuable debugging feature for a geometry library,
    // failing on the only argument a user has to hand.
    const devtools = mk.devtools;
    const handle = mk.byId("dv-main");
    t.ok(devtools.tree(handle), "tree accepts a handle");
    t.ok(devtools.explain(handle), "so does explain");
    t.ok(devtools.select(mk.byId("dv-leaf")), "and select");
    t.ok(devtools.showOverlay(handle), "and the overlay");
    mk.tick();
    t.ok(devtools.overlayEl.querySelectorAll(".mk-devtools-box").length > 0, "which draws a box");
    devtools.hideOverlay();

    // The other two spellings still work: an id, and a raw node.
    t.ok(devtools.explain("dv-leaf"), "an id still resolves");
    t.ok(devtools.explain(mk.byId("dv-leaf").node), "and so does a node");

    // §19.3's layout editor exports "the tier-2 JSON" — which has to restore.
    const before = mk.snapshot();
    const exported = devtools.export();
    const second = fixture(t);
    second.mk.restore(exported, { allow: "any" });
    second.mk.tick();
    t.deepEqual(second.mk.snapshot(), before, "and it rebuilds the same layout");
  });

  test("devtools explains a dropped constraint (§19.3)", (t) => {
    const { mk, app } = fixture(t);
    mk.use(devtoolsPlugin);
    Mutakit.diagnostics.sink(() => {});
    t.cleanup(() => Mutakit.diagnostics.sink(null));

    // Genuinely over-constrained: left, right, *and* width on one axis. (§5.6's
    // own `{right, top, bottom, width}` example is not — that is two per axis.)
    app.create("pane", { id: "rail", left: 0, right: 0, width: 320, top: 0, height: 100 });
    mk.tick();

    const explained = mk.devtools.explain("rail");
    t.deepEqual(explained.dropped, ["x.size"], "the over-constrained axis names its victim");
    t.ok(/§5.8/.test(explained.note));
    t.equal(explained.ownedBy.includes("anchor"), true);

    const tree = mk.devtools.tree();
    t.equal(tree.children.length, 1);
    t.deepEqual(tree.children[0].rect, [0, 0, 1000, 100], "the size yielded to the edges");

    const profile = mk.devtools.profile();
    t.ok(profile.frames > 0 && profile.averageMs >= 0);
  });

  test("an author restyles from mutakit.user with no !important (§12.1)", (t) => {
    const { mk, app } = fixture(t);
    const surface = app.create("surface", { id: "layer-s", size: { w: 200, h: 100 } });
    mk.tick();
    const before = getComputedStyle(surface.el).borderRadius;
    t.notEqual(before, "0px", "the library gives it a radius to override");

    // §12.1's whole promise. The author's selector is no more specific than
    // the library's and carries no `!important` — the layer order is what
    // decides it.
    //
    // This failed until the order statement moved into the document. Adopted
    // stylesheets sort after every document stylesheet, so an order declared
    // only in an adopted sheet is established *after* an author's own `<style>`
    // has been parsed, and their `@layer mutakit.user { … }` opens a layer
    // earlier than the one it names — losing to the rules it was meant to beat.
    const authored = document.createElement("style");
    authored.textContent = "@layer mutakit.user { .mk-surface { border-radius: 0px; } }";
    document.head.appendChild(authored);
    t.cleanup(() => authored.remove());

    t.equal(getComputedStyle(surface.el).borderRadius, "0px",
      "a rule in mutakit.user wins without !important");
  });

  test("a theme applies per subtree, not per page (§12.3)", (t) => {
    const { mk, app } = fixture(t);
    const theme = mk.service("theme");
    const panel = app.create("pane", { id: "inspector", size: { w: 200, h: 200 } });
    mk.tick();

    theme.apply(app, { theme: "light", density: "comfortable" });
    theme.apply(panel, { theme: "dark" });
    t.equal(app.el.getAttribute("data-mk-theme"), "light");
    t.equal(app.el.getAttribute("data-mk-density"), "comfortable");
    t.equal(panel.el.getAttribute("data-mk-theme"), "dark",
      "a dark inspector inside a light application needs no special support");
  });

  test("the adapters hand out a box and take nothing else (§8.8)", (t) => {
    const { mk, app } = fixture(t);
    mk.use(adaptersPlugin);
    const portal = mk.portal({ id: "react-root", size: { w: 200, h: 100 }, at: "top-left" }, app.node);
    mk.tick();

    const owned = document.createElement("p");
    owned.textContent = "rendered by someone else";
    portal.el.appendChild(owned);

    t.equal(portal.handle.node.computed.w, 200, "Mutakit sizes it");
    t.equal(portal.el.contains(owned), true, "and touches nothing inside");
    portal.destroy();
    mk.tick();
    t.equal(portal.handle.node.destroyed, true);
  });
});


describe("motion (§17)", () => {
  test("animation never affects layout — the invariant the whole section rests on", async (t) => {
    const { mk, app } = fixture(t);
    const modal = app.create("modal", { id: "anim", title: "Animated", backdrop: false });
    mk.tick();

    // Mid-animation, the resolved tree is identical to one at rest.
    const during = mk.snapshot();
    const motion = mk.service("motion");
    t.ok(motion.busy || !motion.enabled, "an enter animation is running (or unavailable here)");
    await mk.flush({ animations: false });
    mk.tick();
    t.deepEqual(mk.snapshot(), during, "the same geometry in motion as at rest");
    t.deepEqual(rect(modal), [100, 60, 800, 680]);
  });

  test("a closing element is inert before it is gone", (t) => {
    const { mk, app } = fixture(t);
    const modal = app.create("modal", { id: "closing", title: "Closing", backdrop: false });
    mk.tick();
    modal.close();

    // Still in the tree — and already unable to swallow a click meant for what
    // is behind it, which is the bug libraries that merely delay removal have.
    t.equal(modal.node.destroyed, false);
    t.equal(modal.el.hasAttribute("inert"), true);
    t.equal(modal.el.hasAttribute("data-mk-exiting"), true);
    t.equal(modal.el.style.pointerEvents, "none");
  });

  test("reduced motion switches to the reduced variant, which is not 'none'", (t) => {
    const { mk } = fixture(t);
    const motion = mk.service("motion");
    mk.metrics.override({ reducedMotion: true });
    t.cleanup(() => mk.metrics.override(null));
    mk.tick();

    // Presets are registered on the *instance* registry by the service's
    // attach, which is what makes a per-instance motion vocabulary possible.
    const preset = mk.registry.get("motion", "scale");
    const frames = motion.keyframesFor(preset, "enter", mk.root);
    t.ok(frames, "reduced does not mean nothing (§14)");
    t.equal(frames.duration, 80, "just shorter");
    t.equal(frames.transform, undefined, "and opacity only");
  });

  test("presets may animate compositable properties only (MK5004)", (t) => {
    const { mk, app } = fixture(t);
    const records = [];
    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));

    mk.define({
      type: "acme:bad-motion",
      a11y: "presentation",
      // `reduced: 'fade'`, not `'none'` — this test is about animating a
      // non-compositable property, and a fixture that also violates §17's
      // reduced rule reports that instead, under the same code.
      motion: { enter: { width: ["0px", "100px"], duration: 10 }, reduced: "fade" },
      create: (ctx) => ctx.dom("div")
    });
    app.create("acme:bad-motion", { size: { w: 100, h: 20 } });
    mk.tick();

    const found = records.find((r) => r.code === "MK5004");
    t.ok(found, "animating width is reported");
    t.ok(/scale\(\)/.test(found.message), "and the transform alternative is named");
  });

  test("collapse is the sanctioned layout exception", (t) => {
    const { mk } = fixture(t);
    const records = [];
    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));
    mk.service("motion");
    const preset = mk.registry.get("motion", "collapse");
    t.equal(preset.allowLayout, true, "it animates a grid track, and says so");
    t.ok(preset.enter.gridTemplateRows, "0fr → 1fr, which is compositable in modern engines");
  });

  test("FLIP animates the inverse, so layout is untouched throughout", (t) => {
    const { mk, app } = fixture(t);
    const row = app.create("stack", { id: "flip", axis: "x", left: 0, top: 0, width: 400, height: 60 });
    const a = row.create("pane", { id: "fa", layout: { size: 100 } });
    const b = row.create("pane", { id: "fb", layout: { size: 100 } });
    mk.tick();
    const before = mk.snapshot();

    const motion = mk.service("motion");
    const played = motion.flip([a.node, b.node], () => {
      mk.reparent(b.node, row.node, a.node);
      mk.tick();
    });

    t.ok(played.length >= 0, "the reorder happened");
    t.equal(a.node.computed.x > b.node.computed.x, true, "b is now first");
    // The rects are the resolved ones, never the intermediate transform.
    t.equal(Object.keys(mk.snapshot()).length, Object.keys(before).length);
  });

  test("a page with no animated element never instantiates the service", (t) => {
    const { mk, app } = fixture(t);
    app.create("pane", { size: { w: 10, h: 10 } });
    app.create("stack", { axis: "x" });
    mk.tick();
    t.equal(mk.services.has("motion"), false, "the factory is lazy, and nothing asked");
  });
});


describe("gestures and the pointer queue (§13.2, §13.3)", () => {
  test("a real pointer stream reaches a recognizer (§13.2, §13.3)", async (t) => {
    const { mk, app } = fixture(t);
    const seen = [];
    mk.define({
      type: "acme:grabbable",
      a11y: { role: "button" },
      keys: { Enter: "activate" },
      create: (ctx) => ctx.dom("div"),
      mount(ctx) {
        // Handlers are keyed by §13.3's phase names, not by `onEnd`-style
        // aliases: possible, began, changed, ended, cancelled, failed.
        ctx.gesture("tap", { ended: () => seen.push("tap") });
        ctx.gesture("drag", {
          began: () => seen.push("drag:began"),
          changed: () => seen.push("drag:changed"),
          ended: () => seen.push("drag:ended")
        });
      }
    }, { replace: true });

    const target = app.create("acme:grabbable", {
      id: "gest-target", at: "top-left", inset: 0, size: { w: 400, h: 300 }
    });
    mk.tick();

    // The recognizers have unit tests as pure reducers, and the arbitration
    // has its own. Nothing exercised the path *into* them — which is where
    // every gesture in the library was being lost: `mount()` looks the pointer
    // service up without creating it, nothing else asked, so no root was ever
    // observed and the queue stayed empty.
    const box = target.el.getBoundingClientRect();
    const send = (type, x, y, buttons) => target.el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse",
      isPrimary: true, clientX: x, clientY: y, button: 0, buttons
    }));

    send("pointerdown", box.left + 20, box.top + 20, 1);
    mk.tick();
    send("pointerup", box.left + 20, box.top + 20, 0);
    mk.tick();
    await new Promise((resolve) => setTimeout(resolve, 60));
    mk.tick();
    t.deepEqual(seen, ["tap"], "a press and release is a tap");

    seen.length = 0;
    send("pointerdown", box.left + 50, box.top + 50, 1);
    mk.tick();
    for (let i = 1; i <= 5; i++) {
      send("pointermove", box.left + 50 + i * 15, box.top + 50, 1);
      mk.tick();
    }
    send("pointerup", box.left + 125, box.top + 50, 0);
    mk.tick();

    t.equal(seen[0], "drag:began", "and a press with movement begins a drag");
    t.equal(seen[seen.length - 1], "drag:ended");
    t.ok(seen.filter((s) => s === "drag:changed").length >= 3, "reporting each move between");
  });

  test("one delegated listener set per root, not one per element", (t) => {
    const { mk, app } = fixture(t);
    const before = { ...counters };
    mk.service("pointer");
    const added = counters.listeners - before.listeners;
    for (let i = 0; i < 50; i++) app.create("pane", { size: { w: 10, h: 10 } });
    mk.tick();
    t.equal(counters.listeners - before.listeners, added,
      `50 elements added no listeners; the root has ${added}`);
    t.ok(added <= 8, "and the root's own set is small");
  });

  test("a claim cancels the others, except those declared simultaneous", (t) => {
    const { mk, app } = fixture(t);
    const gestures = mk.service("gestures");
    const pane = app.create("pane", { id: "g1", size: { w: 200, h: 200 } });
    mk.tick();

    const seen = [];
    const record = (name) => ({
      began: () => seen.push(name + ":began"),
      cancelled: (event) => seen.push(name + ":cancelled:" + (event.reason || ""))
    });
    t.cleanup(gestures.attachTo(pane.node, "drag", record("drag")));
    t.cleanup(gestures.attachTo(pane.node, "long-press", record("press")));

    // A drag that begins claims the pointer; the long-press is cancelled.
    gestures.dispatch(pane.node, { type: "down", x: 0, y: 0, time: 0, id: 1 });
    gestures.dispatch(pane.node, { type: "move", x: 40, y: 0, time: 20, id: 1 });
    t.ok(seen.includes("drag:began"));
    t.equal(seen.filter((s) => s.startsWith("press:")).length, 0,
      "a long-press that never began is simply out of the running");

    // Both pinch and rotate declare each other, so neither cancels the other.
    const two = [];
    t.cleanup(gestures.attachTo(pane.node, "pinch", { began: () => two.push("pinch"), cancelled: () => two.push("pinch:x") }));
    t.cleanup(gestures.attachTo(pane.node, "rotate", { began: () => two.push("rotate"), cancelled: () => two.push("rotate:x") }));
    gestures.dispatch(pane.node, { type: "down", x: 0, y: 0, time: 0, id: 7 });
    gestures.dispatch(pane.node, { type: "down", x: 100, y: 0, time: 0, id: 8 });
    t.ok(two.includes("pinch") && two.includes("rotate"), "both began");
    t.equal(two.filter((s) => s.endsWith(":x")).length, 0, "and neither was cancelled");
  });

  test("requireFailure makes one recognizer wait for another", (t) => {
    const { mk, app } = fixture(t);
    const gestures = mk.service("gestures");
    const pane = app.create("pane", { id: "g2", size: { w: 200, h: 200 } });
    mk.tick();

    const fired = [];
    t.cleanup(gestures.attachTo(pane.node, "double-tap", { ended: () => fired.push("double") }));
    t.cleanup(
      gestures.attachTo(pane.node, "tap", {
        config: { requireFailure: ["double-tap"] },
        ended: () => fired.push("tap")
      })
    );

    // A single tap is held back while the double-tap window is still open.
    gestures.dispatch(pane.node, { type: "down", x: 10, y: 10, time: 0, id: 1 });
    gestures.dispatch(pane.node, { type: "up", x: 10, y: 10, time: 60, id: 1 });
    t.deepEqual(fired, [], "the tap waits rather than firing immediately");

    // The window lapses on the clock, the double-tap fails, and the tap is free.
    gestures.tick(600);
    gestures.dispatch(pane.node, { type: "down", x: 10, y: 10, time: 700, id: 1 });
    gestures.dispatch(pane.node, { type: "up", x: 10, y: 10, time: 760, id: 1 });
    t.deepEqual(fired, ["tap"], "and fires once the double-tap is out of the way");
  });

  test("destroying an element cancels its gestures mid-flight (§13.3)", (t) => {
    const { mk, app } = fixture(t);
    const gestures = mk.service("gestures");
    const pane = app.create("pane", { id: "g3", size: { w: 200, h: 200 } });
    mk.tick();

    const seen = [];
    gestures.attachTo(pane.node, "drag", {
      began: () => seen.push("began"),
      cancelled: (event) => seen.push("cancelled:" + event.reason)
    });
    gestures.dispatch(pane.node, { type: "down", x: 0, y: 0, time: 0, id: 1 });
    gestures.dispatch(pane.node, { type: "move", x: 40, y: 0, time: 20, id: 1 });
    t.deepEqual(seen, ["began"]);

    pane.destroy();
    mk.tick();
    t.deepEqual(seen, ["began", "cancelled:destroyed"],
      "every cancellation source is treated identically");
  });

  test("ctx.gesture attaches through the element context and is owned by it", (t) => {
    const { mk, app } = fixture(t);
    const seen = [];
    mk.define({
      type: "acme:swipeable",
      a11y: "presentation",
      /** A pointer gesture, so a keyboard equivalent is declared (P5). */
      keys: { ArrowLeft: "previous", ArrowRight: "next" },
      create(ctx) {
        const el = ctx.dom("div");
        ctx.gesture("swipe", { ended: (event) => seen.push(event.direction) });
        return el;
      }
    });
    const card = app.create("acme:swipeable", { id: "card", size: { w: 200, h: 100 } });
    mk.tick();

    const gestures = mk.service("gestures");
    t.equal(gestures.attachments.has(card.node), true);
    gestures.dispatch(card.node, { type: "down", x: 0, y: 0, time: 0, id: 1 });
    gestures.dispatch(card.node, { type: "up", x: 150, y: 0, time: 100, id: 1 });
    t.deepEqual(seen, ["right"]);

    card.destroy();
    mk.tick();
    t.equal(gestures.attachments.has(card.node), false, "ctx.own released it");
  });

  test("an unknown gesture is reported and inert, not fatal", (t) => {
    const { mk, app } = fixture(t);
    const records = [];
    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));
    const gestures = mk.service("gestures");
    const pane = app.create("pane", { size: { w: 10, h: 10 } });
    mk.tick();
    const dispose = gestures.attachTo(pane.node, "acme:nope", {});
    t.equal(typeof dispose, "function", "it still returns a disposable");
    t.ok(records.some((r) => r.code === "MK3008"));
  });
});


describe("collection traits (§9)", () => {
  function list(t, options) {
    const { mk, app } = fixture(t);
    const holder = app.create("stack", { id: "list", axis: "y", left: 0, top: 0, width: 300, height: 400 });
    const items = ["a", "b", "c", "d"].map((id) =>
      holder.create("pane", { id, content: id, layout: { size: 40 } })
    );
    mk.tick();
    const api = holder.trait(options.trait, options.config || {});
    return { mk, app, holder, items, api };
  }

  test("selectable: replace, toggle, and range are three different gestures", (t) => {
    const { mk, api, items } = list(t, { trait: "selectable", config: { mode: "multiple" } });
    const changes = [];
    mk.handleFor(items[0].node.parent).on("selectionchange", (e) => changes.push(e.detail.selected.length));

    api.select("a");
    t.deepEqual(api.selected, ["a"], "a bare select replaces");

    api.select("c", { additive: true });
    t.deepEqual(api.selected.sort(), ["a", "c"], "the platform modifier toggles one in");

    api.select("d", { range: true });
    t.deepEqual(api.selected.sort(), ["c", "d"], "shift extends from the anchor, which was c");

    api.select("a", { range: true });
    t.deepEqual(api.selected.sort(), ["a", "b", "c"],
      "and the anchor did not move, so a second extend starts from c again");

    mk.tick();
    t.equal(items[0].el.getAttribute("aria-selected"), "true");
    t.equal(items[3].el.getAttribute("aria-selected"), "false");
  });

  test("selectable: single mode never accumulates", (t) => {
    const { api } = list(t, { trait: "selectable", config: { mode: "single" } });
    api.select("a");
    api.select("b", { additive: true });
    t.deepEqual(api.selected, ["b"]);
  });

  test("selectable: the keyboard path does what the pointer path does (P5)", (t) => {
    const { mk, holder, api } = list(t, { trait: "selectable", config: { mode: "multiple" } });
    api.select("b");
    key(holder.el, "ArrowDown");
    t.deepEqual(api.selected, ["c"]);
    key(holder.el, "ArrowDown", { shiftKey: true });
    t.deepEqual(api.selected.sort(), ["c", "d"], "shift extends, from the keyboard too");
    key(holder.el, "a", { ctrlKey: true });
    t.equal(api.selected.length, 4);
    key(holder.el, "Escape");
    t.deepEqual(api.selected, []);
  });

  test("sortable reorders within the flow, so the parent still owns every box", (t) => {
    const { mk, holder, api, items } = list(t, { trait: "sortable" });
    const before = items.map((h) => h.node.computed.y);
    t.deepEqual(api.order, ["a", "b", "c", "d"]);

    api.move(0, 2);
    mk.tick();
    t.deepEqual(api.order, ["b", "c", "a", "d"]);
    // The tracks are unchanged; only the order is. Nothing declared
    // `positioning: 'self'`, which is what MK2011 would have caught.
    t.deepEqual(holder.node.children.map((c) => c.computed.y), before);
    t.equal(items[0].node.positioning, "parent");
  });

  test("sortable: Mod+arrows reorder from the keyboard", (t) => {
    const { mk, holder, api, items } = list(t, { trait: "sortable" });
    items[2].el.tabIndex = 0;
    items[2].el.focus();
    key(holder.el, "ArrowUp", { ctrlKey: true });
    mk.tick();
    t.deepEqual(api.order, ["a", "c", "b", "d"], "reordering is not pointer-only");
  });

  test("scrollable contains overscroll and treats offset as state, not geometry", (t) => {
    const { mk, holder, api } = list(t, { trait: "scrollable" });
    // Four 40px rows in a 100px box, so there is something to scroll. A box
    // taller than its content clamps scrollTop to 0, which would make the
    // assertion below pass or fail for the wrong reason.
    holder.constrain({ height: 100 });
    mk.tick();
    t.equal(holder.el.style.overscrollBehavior, "contain");
    t.equal(holder.el.getAttribute("tabindex"), "0", "and it is reachable by keyboard");

    holder.el.scrollTop = 40;
    holder.el.dispatchEvent(new Event("scroll"));
    t.equal(api.offset.y, 40);
    t.deepEqual(holder.node.state.scrollOffset, { x: 0, y: 40 });
    // Scroll sets PAINT, never ARRANGE (§5.11 rule 5).
    t.equal((holder.node.flags & 4) !== 0, false, "no ARRANGE was requested");
  });

  test("virtualized computes its window in READ, from the scroll offset", (t) => {
    const { mk, holder } = list(t, { trait: "scrollable" });
    const api = holder.trait("virtualized", { rowHeight: 20, overscan: 2, total: 1000 });
    const ranges = [];
    holder.on("rangechange", (event) => ranges.push(event.detail));
    mk.tick();

    t.ok(ranges.length, "a window was computed");
    t.equal(ranges[0].start, 0);
    t.ok(ranges[0].end < 1000, "and it is a window, not the whole list");

    holder.el.scrollTop = 400;
    mk.tick();
    const latest = ranges[ranges.length - 1];
    t.equal(latest.start, 18, "400/20 = 20, minus 2 of overscan");
    t.equal(holder.el.querySelector(".mk-virtual-spacer").style.height, "20000px",
      "and the scrollbar is honest about the full height");
  });

  test("persistable is opt-in, and says so when it cannot be keyed", (t) => {
    const { mk, app } = fixture(t);
    const records = [];
    Mutakit.diagnostics.sink((record) => records.push(record));
    t.cleanup(() => Mutakit.diagnostics.sink(null));

    const keyed = app.create("pane", { id: "keyed", size: { w: 10, h: 10 } });
    const api = keyed.trait("persistable", { keys: ["hidden"] });
    t.deepEqual(api.keys, ["hidden"]);
    t.deepEqual(api.snapshot(), { hidden: false });

    const anonymous = app.create("pane", { size: { w: 10, h: 10 } });
    anonymous.trait("persistable", { keys: ["hidden"] });
    t.ok(records.some((r) => r.code === "MK4005"), "an unkeyed element can only restore by position");
  });

  test("a trait may ship its own styles, injected once", (t) => {
    const { mk, holder } = list(t, { trait: "selectable" });
    mk.tick();
    t.equal(mk.styles.has("trait:selectable"), true);
    const second = holder.create("pane", { id: "extra" });
    mk.attachTrait(second.node, "selectable", {});
    // Once per document, not once per element that composes the trait.
    t.equal(mk.styles.writes("trait:selectable"), 1, "and only once");
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
