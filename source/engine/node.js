/**
 * `LayoutNode` — the retained tree that shadows the DOM (§6.1).
 *
 * This is the thing that gets serialized (§19) and inspected (§19.3), and the
 * thing events propagate along (§13.1). Nodes are created and destroyed with
 * the elements they back; a node with `el === null` is virtual, which is how
 * `group` organizes a tree without adding DOM.
 */
import { InsetStack } from "../geometry/insets.js";
import { NO_INSET } from "../geometry/rect.js";
import { ARRANGE, MEASURE } from "./invalidate.js";

export class LayoutNode {
  constructor(type, options) {
    const opts = options || {};

    this.type = type;
    this.id = opts.id || null;
    this.key = opts.key || null;
    this.definition = opts.definition || null;
    this.mk = opts.mk || null;
    this.root = opts.root || null;

    this.parent = null;
    this.children = [];
    /** Where events go when it differs from `parent` — portalled content. */
    this.eventParent = null;

    this.props = Object.create(null);
    /** The parent algorithm's per-child bag (§7.0). */
    this.layoutProps = Object.create(null);
    /** Keys the parent algorithm did not recognise: retained, ignored. */
    this.layoutExtras = Object.create(null);
    /** Declared geometry inputs — `Len`s, anchors, edges (§5). */
    this.geometry = Object.create(null);

    /** Resolved rect in frame space. Populated only when needed. */
    this.computed = { x: 0, y: 0, w: 0, h: 0 };
    /** The content box children resolve against, insets applied. */
    this.frame = { x: 0, y: 0, w: 0, h: 0 };
    this.insets = new InsetStack();
    this.effectiveInsets = NO_INSET;

    this.flags = MEASURE | ARRANGE;
    this.el = null;
    /** The element children are appended to, when it differs from `el`. */
    this.contentEl = null;
    this.algorithm = null;
    this.state = Object.create(null);
    this.traits = new Map();
    this.slots = Object.create(null);

    this.layer = opts.layer || null;
    this.mounted = false;
    this.destroyed = false;
    this.errored = null;
    /** Set by `draggable`/`resizable`, and the default under `anchor`/`free`. */
    this.positioning = "parent";
    this.sizeIsFixed = false;
    this.measured = null;
    this.disposers = [];

    this._listeners = null;
    this._capture = null;
    this._pathKey = null;
  }

  // ── Tree ─────────────────────────────────────────────────────────────

  insert(child, before) {
    if (child.parent === this) this.removeChild(child, { keep: true });
    child.parent = this;
    child.root = this.root;
    child.mk = child.mk || this.mk;
    const index = before ? this.children.indexOf(before) : -1;
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    invalidatePaths(child);
    return child;
  }

  removeChild(child, options) {
    const index = this.children.indexOf(child);
    if (index === -1) return false;
    this.children.splice(index, 1);
    if (!(options && options.keep)) child.parent = null;
    invalidatePaths(child);
    return true;
  }

  get index() {
    return this.parent ? this.parent.children.indexOf(this) : -1;
  }

  get depth() {
    let depth = 0;
    for (let node = this.parent; node; node = node.parent) depth++;
    return depth;
  }

  ancestors() {
    const out = [];
    for (let node = this.parent; node; node = node.parent) out.push(node);
    return out;
  }

  /** Depth-first walk, self included. `fn` returning `false` prunes a branch. */
  walk(fn) {
    if (fn(this) === false) return;
    for (const child of this.children.slice()) child.walk(fn);
  }

  find(predicate) {
    let found = null;
    this.walk((node) => {
      if (found) return false;
      if (predicate(node)) {
        found = node;
        return false;
      }
      return true;
    });
    return found;
  }

  findAll(predicate) {
    const out = [];
    this.walk((node) => {
      if (predicate(node)) out.push(node);
    });
    return out;
  }

  contains(other) {
    for (let node = other; node; node = node.parent) if (node === this) return true;
    return false;
  }

  // ── Identity (§8.9) ──────────────────────────────────────────────────

  /**
   * A stable path key derived from position, type, and id:
   * `root/split[0]/pane#main/tabs[2]`.
   *
   * Persistence keys on `id` where present and falls back to this, so a tree
   * with no ids at all still restores correctly as long as its shape is
   * unchanged, and a tree with ids survives being reordered.
   */
  get pathKey() {
    if (this._pathKey) return this._pathKey;
    const segment = this.id ? `${this.type}#${this.id}` : `${this.type}[${this.index}]`;
    this._pathKey = this.parent ? `${this.parent.pathKey}/${segment}` : segment;
    return this._pathKey;
  }

  /** The key persistence uses: `id` when present, the path key otherwise. */
  get persistKey() {
    return this.id || this.pathKey;
  }

  toString() {
    return this.id ? `${this.type}#${this.id}` : this.type;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  /** Register a disposable. `ctx.own` routes here (§8.2). */
  own(disposable) {
    if (!disposable) return disposable;
    this.disposers.push(typeof disposable === "function" ? disposable : () => disposable.dispose());
    return disposable;
  }

  /** Run every registered disposer, most recent first. */
  releaseOwned() {
    while (this.disposers.length) {
      const dispose = this.disposers.pop();
      try {
        dispose();
      } catch (error) {
        // Teardown of siblings must complete regardless (§8.10).
        console.error("[mutakit] disposer threw during teardown", error);
      }
    }
  }
}

function invalidatePaths(node) {
  node.walk((n) => {
    n._pathKey = null;
  });
}

/** A snapshot of the node's resolved geometry, for tests and devtools. */
export function snapshot(node, into) {
  const out = into || {};
  node.walk((n) => {
    if (n === node) return; // the scope itself is the frame, not a result
    if (!n.el && !n.children.length) return;
    out[n.persistKey] = [
      round(n.computed.x),
      round(n.computed.y),
      round(n.computed.w),
      round(n.computed.h)
    ];
  });
  return out;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
