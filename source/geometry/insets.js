/**
 * The inset stack (§5.7).
 *
 * A frame carries an ordered list of *named* inset contributions that shrink
 * the area its children resolve against. One mechanism covers the notch, the
 * virtual keyboard, a fixed app toolbar, and a docked region reserving space —
 * which is why an element opts out by naming contributions rather than by
 * knowing what produced them.
 *
 * Contributions compose by **max per edge, not by sum**: two overlays both
 * claiming 16px from the bottom yield 16, not 32.
 */
import { maxInsets, normalizeInset, insetsEqual, NO_INSET } from "./rect.js";

export class InsetStack {
  constructor() {
    this.entries = new Map();
    this._composed = NO_INSET;
    this._dirty = false;
  }

  /**
   * Contribute under `name`. A CSS string such as `'env(safe-area-inset-*)'`
   * is stored as a *resolver* — the metrics snapshot fills in the number each
   * frame rather than the caller measuring once and going stale.
   */
  set(name, value) {
    const entry =
      typeof value === "string" || typeof value === "function"
        ? { dynamic: value }
        : { fixed: normalizeInset(value) };
    this.entries.set(name, entry);
    this._dirty = true;
    return this;
  }

  delete(name) {
    const had = this.entries.delete(name);
    if (had) this._dirty = true;
    return had;
  }

  has(name) {
    return this.entries.has(name);
  }

  names() {
    return [...this.entries.keys()];
  }

  clear() {
    this.entries.clear();
    this._dirty = true;
  }

  /**
   * The composed inset. `filter` is `false` (opt out entirely), an array of
   * names to include, or undefined for everything.
   */
  compose(metrics, filter) {
    if (filter === false) return NO_INSET;
    const list = [];
    for (const [name, entry] of this.entries) {
      if (Array.isArray(filter) && filter.indexOf(name) === -1) continue;
      list.push(entry.fixed ? entry.fixed : resolveDynamic(entry.dynamic, metrics, name));
    }
    const composed = maxInsets(list);
    if (filter === undefined) {
      this._dirty = !insetsEqual(composed, this._composed);
      this._composed = composed;
    }
    return composed;
  }

  /** True when the last full compose produced a different result. */
  get changed() {
    return this._dirty;
  }

  settle() {
    this._dirty = false;
  }
}

function resolveDynamic(value, metrics, name) {
  if (typeof value === "function") return normalizeInset(value(metrics));
  // The one string form worth understanding directly, because it is the one
  // the platform gives us and the one every HUD needs (§5.7).
  if (typeof value === "string" && value.indexOf("safe-area-inset") !== -1) {
    return normalizeInset((metrics && metrics.safe) || NO_INSET);
  }
  return NO_INSET;
}

/** Insets contributed by a keyboard overlay, in the shape the stack wants. */
export function keyboardInset(metrics) {
  const height = metrics && metrics.keyboard ? metrics.keyboard : 0;
  return { top: 0, right: 0, bottom: height, left: 0 };
}
