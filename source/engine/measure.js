/**
 * Measurement (§6.5).
 *
 * Intrinsic measurement is expensive and is avoided wherever possible. Three
 * strategies, in preference order:
 *
 *   1. Don't    — if every child has a resolvable size, skip it entirely.
 *   2. Observe  — a `ResizeObserver` feeding the next frame's snapshot.
 *                 Asynchronous, zero forced reflow, correct in the steady
 *                 state. The default.
 *   3. Force    — a synchronous read in the READ phase, only for nodes flagged
 *                 `measureSync`, used when a first-frame flash would be
 *                 visible (a tooltip positioned before it is shown).
 *
 * Strategy 3 is batched: every forced read happens consecutively, so at most
 * one reflow per frame regardless of how many nodes need it.
 */
import * as dom from "../core/dom.js";
import { isIntrinsic, parse } from "../geometry/len.js";
import { MEASURE, clear } from "./invalidate.js";

export class Measurer {
  constructor() {
    this.pending = new Set();
    this.observers = new Map();
    /** A deterministic stub for snapshot tests — `mk.testing.measurer(fn)`. */
    this.stub = null;
  }

  /** Install a deterministic intrinsic-size function (§23.2). */
  setStub(fn) {
    this.stub = fn;
  }

  /** Which axes are intrinsic, or null when neither is. */
  intrinsicAxes(node) {
    return intrinsicAxes(node);
  }

  /** Does this node need measuring at all? Strategy 1 lives here. */
  needsMeasure(node) {
    if (node.measureSync) return true;
    const g = node.geometry;
    if (!g) return false;
    const size = g.size && typeof g.size === "object" ? g.size : null;
    const w = g.width != null ? g.width : size && size.w;
    const h = g.height != null ? g.height : size && size.h;
    if (w === undefined && h === undefined) return true;
    if (w !== undefined && isIntrinsic(parse(w))) return true;
    if (h !== undefined && isIntrinsic(parse(h))) return true;
    return false;
  }

  /** Strategy 2: observe. Idempotent; the disposer is owned by the node. */
  observe(node) {
    if (!node.el || this.observers.has(node)) return;
    const stop = dom.observeResize(node.el, (entries) => {
      for (const entry of entries) {
        // The *border* box, because that is what the engine writes back.
        //
        // This read `entry.contentRect`, which excludes padding and border,
        // while the forced-read path below reads `rectOf` — a border box. The
        // two strategies measured different boxes for the same node, and the
        // engine writes the result into `--mk-h` under `box-sizing:
        // border-box`. So the first frame measured 27px and pinned 27px, and
        // the moment anything made the observer fire it re-measured the same
        // element as 21px, wrote 21px, which left 15px of content for the
        // observer to report next time. A padded element shrank by exactly its
        // padding on every re-measure until it disappeared.
        //
        // `offsetBox` rather than `rectOf`: both are border boxes, but
        // `getBoundingClientRect` includes transforms, and an element mid enter
        // animation is scaled.
        const box = dom.offsetBox(entry.target);
        const measured = { w: box.w, h: box.h };
        if (
          node.measured &&
          Math.abs(node.measured.w - measured.w) < 0.5 &&
          Math.abs(node.measured.h - measured.h) < 0.5
        ) {
          continue;
        }
        node.measured = measured;
        this.pending.add(node);
        if (node.root && node.root.scheduler) node.root.scheduler.arm();
      }
    });
    this.observers.set(node, stop);
    node.own(() => {
      stop();
      this.observers.delete(node);
      this.pending.delete(node);
    });
  }

  unobserve(node) {
    const stop = this.observers.get(node);
    if (stop) {
      stop();
      this.observers.delete(node);
    }
    this.pending.delete(node);
  }

  /**
   * The READ pass. Runs every node's own `measure` hook, then the batched
   * forced reads. Returns the number of nodes measured, which the scheduler
   * uses only for diagnostics.
   */
  read(nodes, ctxFor) {
    let count = 0;
    const forced = [];

    for (const node of nodes) {
      if (!(node.flags & MEASURE)) continue;
      count++;

      if (this.stub) {
        node.measured = this.stub(node) || node.measured || { w: 0, h: 0 };
        clear(node, MEASURE);
        continue;
      }

      const hooks = node.definition && node.definition.hooks.measure;
      if (hooks && hooks.length) {
        const ctx = ctxFor(node);
        let result = null;
        for (const hook of hooks) {
          const value = node.mk.guard(node, "measure", hook, [ctx, node.frame]);
          if (value) result = value;
        }
        if (result) {
          node.measured = { w: result.w || 0, h: result.h || 0 };
          clear(node, MEASURE);
          continue;
        }
      }

      if (node.measureSync && node.el) forced.push(node);
      else if (node.el) {
        this.observe(node);
        // A node only reaches here with MEASURE actually set, which means
        // something said its content changed. The observer cannot answer that
        // question for an intrinsically sized node: the engine pins such a node
        // to its last measurement, so its own box does not move when its
        // contents grow, and the observer watching that box sees nothing. A
        // `notification-feed` measured empty at create and stayed nought high
        // however many messages it was given.
        //
        // Only an unpinned read can tell, so intrinsic nodes take the forced
        // path. It stays batched into the single reflow below, and a node with
        // both axes fixed still costs nothing — for those the observer really
        // is enough.
        if (!node.measured || intrinsicAxes(node)) forced.push(node);
        else clear(node, MEASURE);
      } else {
        clear(node, MEASURE);
      }
    }

    // Batched: every forced read happens here, together (§6.5 strategy 3).
    //
    // Intrinsic axes are unpinned first, all of them, then read, then restored
    // — three passes so the batch still costs one reflow rather than one per
    // node. Reading an auto-sized element while the engine's own `--mk-w` is
    // in effect is circular: the box reports back the number the engine last
    // wrote, so a container that measured 0 once was pinned at 0 forever, and
    // one that measured its parent's width stayed that wide no matter what it
    // held.
    const unpinned = [];
    for (const node of forced) {
      const axes = intrinsicAxes(node);
      if (!axes) continue;
      if (axes.w) node.el.style.width = "auto";
      if (axes.h) node.el.style.height = "auto";
      unpinned.push({ node, axes });
    }
    for (const node of forced) {
      const box = dom.rectOf(node.el);
      node.measured = { w: box.w, h: box.h };
      clear(node, MEASURE);
    }
    for (const { node, axes } of unpinned) {
      if (axes.w) node.el.style.width = "";
      if (axes.h) node.el.style.height = "";
    }

    this.pending.clear();
    return count;
  }

  destroy() {
    for (const stop of this.observers.values()) stop();
    this.observers.clear();
    this.pending.clear();
  }
}

/**
 * Which axes a node sizes to its own content, or null when neither does.
 *
 * An axis with nothing declared is intrinsic — that is what makes a `stack`
 * created with no size mean "as big as what I hold" — and so is one declared
 * auto, min-content, max-content, or fit-content.
 */
const FLOW_OWNING = new Set(["stack", "split", "grid", "dock", "flow"]);

function intrinsicAxes(node) {
  const g = node.geometry;
  if (!g) return null;
  // A root's box comes from its mount sizing (§5.11), not from `geometry` —
  // which is empty on a root, so it reads as intrinsic on both axes. Unpinning
  // one collapses whatever it hosts: a split container measured with its width
  // removed resolves every `fr` track against nothing and comes back wider
  // than the element that holds it.
  const parent = node.parent;
  if (!parent) return null;
  // A child of a flow-owning algorithm has no size of its own to uncover
  // (§9.1): the stylesheet already hands its box to CSS, so there is nothing
  // for the engine to lift.
  if (parent.algorithm && FLOW_OWNING.has(parent.algorithm)) return null;
  const size = g.size && typeof g.size === "object" ? g.size : null;
  const w = g.width != null ? g.width : size && size.w;
  const h = g.height != null ? g.height : size && size.h;
  const axes = {
    w: w == null || isIntrinsic(parse(w)),
    h: h == null || isIntrinsic(parse(h))
  };
  return axes.w || axes.h ? axes : null;
}
