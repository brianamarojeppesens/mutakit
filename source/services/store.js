/**
 * Stores (§15.3).
 *
 * For layout-level state — which pane is collapsed, which tab is active, where
 * the windows are — a small observable store with **structural sharing**,
 * **path subscriptions**, and **time-travel in development**. This is what
 * persistence serializes (§19) and what devtools inspects (§19.3).
 *
 * Why not just signals: a signal is one value with one identity. Layout state
 * is a *tree* whose consumers each care about one branch, and the two
 * properties that follow — a subscriber woken only when its own path changed,
 * and an unchanged branch keeping its object identity so a diff can skip it —
 * are exactly what a signal per value cannot give you.
 *
 * A store sits **above** signals rather than replacing them: `select()` returns
 * a signal, so anything that accepts a signal accepts a slice of a store.
 */
import "../core/dev.js";
import { warn } from "../core/diagnostics.js";
import { batch, signal } from "../core/signals.js";

/** How many snapshots development keeps for time travel. */
const HISTORY_LIMIT = 50;

export class Store {
  constructor(initial, options) {
    const opts = options || {};
    this.state = initial == null ? {} : initial;
    this.subscribers = new Map();
    this.signals = new Map();
    this.name = opts.name || "store";

    /** Time travel is a development affordance and costs nothing in production. */
    this.history = __MK_DEV__ ? [this.state] : null;
    this.cursor = 0;
  }

  /** Read a path: `store.get('panes.left.size')`, or the whole state. */
  get(path) {
    if (!path) return this.state;
    return readPath(this.state, splitPath(path));
  }

  /**
   * Write a path, sharing structure with the previous state.
   *
   * Only the nodes on the path are recreated; every sibling branch keeps its
   * identity, so a consumer holding `state.windows` can compare by reference
   * and skip work when only `state.panes` moved.
   */
  set(path, value) {
    const keys = splitPath(path);
    if (!keys.length) return this.replace(value);

    const next = writePath(this.state, keys, typeof value === "function" ? value(this.get(path)) : value);
    if (next === this.state) return this.state;
    return this._commit(next, keys);
  }

  /** Replace the whole state. Subscribers on every changed path are notified. */
  replace(next) {
    if (next === this.state) return this.state;
    return this._commit(next, null);
  }

  /** Apply several writes as one notification. */
  update(fn) {
    const before = this.state;
    let touched = [];
    const draft = {
      get: (path) => this.get(path),
      set: (path, value) => {
        const keys = splitPath(path);
        this.state = writePath(this.state, keys, typeof value === "function" ? value(this.get(path)) : value);
        touched.push(keys);
      }
    };
    fn(draft);
    if (this.state === before) return this.state;
    const next = this.state;
    this.state = before;
    return this._commit(next, touched.length === 1 ? touched[0] : null);
  }

  _commit(next, keys) {
    const previous = this.state;
    this.state = next;

    if (__MK_DEV__ && this.history) {
      // Truncate the redo tail: a write after an undo starts a new branch,
      // which is what every editor does and what nobody expects otherwise.
      this.history.length = this.cursor + 1;
      this.history.push(next);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
      this.cursor = this.history.length - 1;
    }

    this._notify(previous, next, keys);
    return next;
  }

  /**
   * Subscribe to a path. Returns an unsubscriber.
   *
   * `''` subscribes to everything. A subscriber on `panes.left` is woken when
   * `panes.left` or anything under it changes, and *not* when `panes.right`
   * does — which is the whole reason a store beats one big signal.
   */
  subscribe(path, fn) {
    const key = normalizePath(path);
    const list = this.subscribers.get(key) || [];
    list.push(fn);
    this.subscribers.set(key, list);
    return () => {
      const index = list.indexOf(fn);
      if (index !== -1) list.splice(index, 1);
      if (!list.length) this.subscribers.delete(key);
    };
  }

  /**
   * A path as a signal, so a store slice can be passed anywhere a value can.
   *
   * Cached per path: two callers selecting the same slice share one signal and
   * therefore one subscription.
   */
  select(path) {
    const key = normalizePath(path);
    const existing = this.signals.get(key);
    if (existing) return existing.accessor;

    const accessor = signal(this.get(key));
    const stop = this.subscribe(key, (value) => accessor(value));
    this.signals.set(key, { accessor, stop });
    return accessor;
  }

  /**
   * Wake the right subscribers, and only those.
   *
   * Two relationships are *not* the same and conflating them wakes every
   * sibling of a write. `exact` is what actually changed; `containing` is the
   * ancestors that now hold a change. A subscriber is woken when its path is
   * an exact change, when it is one of those ancestors, or when it sits
   * *under* an exact change — but never merely because it shares a parent
   * with one.
   */
  _notify(previous, next, keys) {
    const exact = keys ? new Set([normalizePath(keys)]) : diffPaths(previous, next);
    const containing = keys ? prefixes(keys) : exact;
    if (!exact.size) return;

    const wakes = (key) =>
      key === "" || exact.has(key) || containing.has(key) || isUnder(key, exact);

    batch(() => {
      for (const [key, list] of this.subscribers) {
        if (!wakes(key)) continue;
        const value = key === "" ? next : readPath(next, splitPath(key));
        for (const fn of list.slice()) fn(value, key);
      }
      for (const [key, entry] of this.signals) {
        if (!wakes(key)) continue;
        entry.accessor(key === "" ? next : readPath(next, splitPath(key)));
      }
    });
  }

  // ── Time travel (development only) ─────────────────────────────────────

  /** Step back one commit. Returns false when there is nothing to undo. */
  undo() {
    if (!__MK_DEV__ || !this.history || this.cursor === 0) return false;
    this.cursor--;
    const previous = this.state;
    this.state = this.history[this.cursor];
    this._notify(previous, this.state, null);
    return true;
  }

  redo() {
    if (!__MK_DEV__ || !this.history || this.cursor >= this.history.length - 1) return false;
    this.cursor++;
    const previous = this.state;
    this.state = this.history[this.cursor];
    this._notify(previous, this.state, null);
    return true;
  }

  /** Every retained snapshot, for the devtools panel. */
  get timeline() {
    if (!__MK_DEV__ || !this.history) {
      warn("MK5006", __MK_DEV__ && "time travel is a development-build affordance", {
        subject: this.name
      });
      return [];
    }
    return this.history.map((snapshot, index) => ({ index, current: index === this.cursor, snapshot }));
  }

  destroy() {
    for (const entry of this.signals.values()) entry.stop();
    this.signals.clear();
    this.subscribers.clear();
    if (this.history) this.history.length = 0;
  }
}

// ── Path helpers ─────────────────────────────────────────────────────────

function splitPath(path) {
  if (Array.isArray(path)) return path;
  if (!path) return [];
  return String(path).split(".");
}

function normalizePath(path) {
  return splitPath(path).join(".");
}

function readPath(state, keys) {
  let current = state;
  for (const key of keys) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Write `value` at `keys`, recreating only the nodes on the path.
 *
 * Returns the *original* state when the value is unchanged, so a no-op write
 * notifies nobody — which matters because layout state is written on every
 * frame of a drag.
 */
function writePath(state, keys, value) {
  if (!keys.length) return value;
  const [key, ...rest] = keys;
  const child = state == null ? undefined : state[key];
  const nextChild = rest.length ? writePath(child, rest, value) : value;
  if (nextChild === child) return state;

  if (Array.isArray(state)) {
    const copy = state.slice();
    copy[key] = nextChild;
    return copy;
  }
  return { ...(state || {}), [key]: nextChild };
}

/** `a.b.c` → `['a', 'a.b', 'a.b.c']`, so ancestors hear about descendants. */
function prefixes(keys) {
  const out = new Set([""]);
  let path = "";
  for (const key of keys) {
    path = path ? `${path}.${key}` : String(key);
    out.add(path);
  }
  return out;
}

/** True when `key` sits under one of the paths that actually changed. */
function isUnder(key, exact) {
  for (const path of exact) {
    if (path && key.startsWith(path + ".")) return true;
  }
  return false;
}

/**
 * Which paths differ between two states.
 *
 * Structural sharing is what makes this cheap: an unchanged branch is the same
 * object, so the walk stops there rather than comparing it field by field.
 */
function diffPaths(previous, next, prefix = "", out = new Set([""])) {
  if (previous === next) return out;
  const keys = new Set([
    ...(previous && typeof previous === "object" ? Object.keys(previous) : []),
    ...(next && typeof next === "object" ? Object.keys(next) : [])
  ]);
  if (!keys.size) {
    if (prefix) out.add(prefix);
    return out;
  }
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const a = previous == null ? undefined : previous[key];
    const b = next == null ? undefined : next[key];
    if (a === b) continue;
    out.add(path);
    if (a && b && typeof a === "object" && typeof b === "object") diffPaths(a, b, path, out);
  }
  return out;
}

export const storePlugin = {
  name: "mutakit-store",
  version: "1.0.0",
  requires: { mutakit: ">=0.4.0 <2" },
  install(mk) {
    const stores = new Map();
    /** `mk.store('layout', { … })` — named, so devtools can list them. */
    mk.store = (name, initial, options) => {
      if (typeof name !== "string") return new Store(name, initial);
      const existing = stores.get(name);
      if (existing) return existing;
      const store = new Store(initial, { ...(options || {}), name });
      stores.set(name, store);
      return store;
    };
    mk.stores = stores;
    return {
      uninstall() {
        for (const store of stores.values()) store.destroy();
        stores.clear();
        delete mk.store;
        delete mk.stores;
      }
    };
  }
};

export { diffPaths, writePath, readPath };
