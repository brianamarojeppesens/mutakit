/**
 * Stores (§15.3) — structural sharing, path subscriptions, and time travel.
 *
 * Pure, so it runs in the DOM-free tier. The properties asserted here are the
 * ones that make a store worth having over one signal per value: an untouched
 * branch keeps its identity, and a subscriber hears only about its own path.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { quiet } from "./helpers.mjs";
import { Store, diffPaths, writePath } from "../../source/services/store.js";
import { flushEffects } from "../../source/core/signals.js";

function layout() {
  return new Store({
    panes: { left: { size: 240, collapsed: false }, right: { size: "1fr" } },
    windows: [{ id: "w1", x: 10, y: 10 }],
    activeTab: "one"
  });
}

test("get reads a path, or the whole state", () => {
  const store = layout();
  assert.equal(store.get("panes.left.size"), 240);
  assert.equal(store.get("activeTab"), "one");
  assert.equal(store.get("panes.missing.deep"), undefined, "a missing branch is undefined, not a throw");
  assert.equal(store.get().activeTab, "one");
});

test("set shares structure: untouched branches keep their identity", () => {
  const store = layout();
  const windowsBefore = store.get("windows");
  const rightBefore = store.get("panes.right");

  store.set("panes.left.size", 300);

  assert.equal(store.get("panes.left.size"), 300);
  assert.equal(store.get("windows"), windowsBefore, "an untouched sibling is the same object");
  assert.equal(store.get("panes.right"), rightBefore, "and so is an untouched sibling one level down");
  assert.notEqual(store.get("panes"), undefined);
});

test("an unchanged write notifies nobody", () => {
  // Layout state is written on every frame of a drag, so a no-op write has to
  // be free rather than merely correct.
  const store = layout();
  const before = store.get();
  let woken = 0;
  store.subscribe("panes.left.size", () => woken++);
  store.set("panes.left.size", 240);
  assert.equal(store.get(), before, "the state object is unchanged");
  assert.equal(woken, 0);
});

test("a subscriber hears its own path and its descendants, and nothing else", () => {
  const store = layout();
  const heard = [];
  store.subscribe("panes.left", (value) => heard.push(["left", value.size]));
  store.subscribe("panes.right", () => heard.push(["right"]));
  store.subscribe("", () => heard.push(["root"]));

  store.set("panes.left.size", 300);
  assert.deepEqual(heard, [["left", 300], ["root"]], "the right pane was not woken");

  heard.length = 0;
  store.set("windows.0.x", 40);
  assert.deepEqual(heard, [["root"]], "and neither pane was");
});

test("an ancestor hears about a descendant", () => {
  const store = layout();
  const heard = [];
  store.subscribe("panes", () => heard.push("panes"));
  store.set("panes.left.collapsed", true);
  assert.deepEqual(heard, ["panes"]);
});

test("update applies several writes as one notification", () => {
  const store = layout();
  let woken = 0;
  store.subscribe("", () => woken++);
  store.update((draft) => {
    draft.set("panes.left.size", 100);
    draft.set("activeTab", "two");
  });
  assert.equal(woken, 1, "two writes, one notification");
  assert.equal(store.get("panes.left.size"), 100);
  assert.equal(store.get("activeTab"), "two");
});

test("select returns a signal, so a slice goes anywhere a value does", () => {
  const store = layout();
  const size = store.select("panes.left.size");
  assert.equal(size(), 240);
  store.set("panes.left.size", 320);
  flushEffects();
  assert.equal(size(), 320);
  assert.equal(store.select("panes.left.size"), size, "the same path shares one signal");
});

test("replace notifies exactly the paths that differ", () => {
  const store = layout();
  const heard = [];
  store.subscribe("panes.left", () => heard.push("left"));
  store.subscribe("activeTab", () => heard.push("tab"));
  store.replace({ ...store.get(), activeTab: "three" });
  assert.deepEqual(heard, ["tab"], "the diff walk stops at branches that are the same object");
});

test("time travel steps back and forward through commits", () => {
  const store = layout();
  store.set("activeTab", "two");
  store.set("activeTab", "three");
  assert.equal(store.get("activeTab"), "three");

  assert.equal(store.undo(), true);
  assert.equal(store.get("activeTab"), "two");
  assert.equal(store.undo(), true);
  assert.equal(store.get("activeTab"), "one");
  assert.equal(store.undo(), false, "and stops at the beginning");

  assert.equal(store.redo(), true);
  assert.equal(store.get("activeTab"), "two");
});

test("a write after an undo starts a new branch", () => {
  const store = layout();
  store.set("activeTab", "two");
  store.set("activeTab", "three");
  store.undo();
  store.set("activeTab", "four");
  assert.equal(store.redo(), false, "the redo tail is gone, as in every editor");
  assert.equal(store.get("activeTab"), "four");
});

test("undo notifies subscribers, so the UI follows", () => {
  const store = layout();
  const heard = [];
  store.subscribe("activeTab", (value) => heard.push(value));
  store.set("activeTab", "two");
  store.undo();
  assert.deepEqual(heard, ["two", "one"]);
});

test("the timeline reports every retained snapshot and which is current", () => {
  const store = layout();
  store.set("activeTab", "two");
  const timeline = store.timeline;
  assert.equal(timeline.length, 2);
  assert.equal(timeline[1].current, true);
  assert.equal(timeline[0].snapshot.activeTab, "one");
});

test("writePath recreates only the nodes on the path", () => {
  const state = { a: { x: 1 }, b: { y: 2 } };
  const next = writePath(state, ["a", "x"], 9);
  assert.equal(next.b, state.b, "b is the same object");
  assert.notEqual(next.a, state.a, "a is not");
  assert.equal(next.a.x, 9);
  assert.equal(writePath(state, ["a", "x"], 1), state, "and an equal write is a no-op");
});

test("writePath preserves arrays as arrays", () => {
  const state = { list: [1, 2, 3] };
  const next = writePath(state, ["list", 1], 9);
  assert.ok(Array.isArray(next.list));
  assert.deepEqual(next.list, [1, 9, 3]);
});

test("diffPaths reports every differing path and stops at shared branches", () => {
  const shared = { deep: true };
  const before = { a: 1, keep: shared, nested: { x: 1 } };
  const after = { a: 2, keep: shared, nested: { x: 2 } };
  const paths = diffPaths(before, after);
  assert.ok(paths.has("a"));
  assert.ok(paths.has("nested"));
  assert.ok(paths.has("nested.x"));
  assert.equal(paths.has("keep"), false, "an identical branch is never walked");
});

test("destroy releases subscriptions and selected signals", () => {
  const seen = quiet();
  const store = layout();
  const size = store.select("panes.left.size");
  let woken = 0;
  store.subscribe("", () => woken++);
  store.destroy();
  store.set("activeTab", "two");
  assert.equal(woken, 0);
  assert.equal(size(), 240, "the signal stopped following");
  seen.restore();
});
