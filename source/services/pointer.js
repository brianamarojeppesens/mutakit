/**
 * Pointer handling (§13.2).
 *
 * **One delegated set of listeners per instance root**, feeding a queue drained
 * in the INPUT phase. Three things follow, and the third is the reason it is
 * worth doing at all:
 *
 *   - ordering is consistent with the frame loop, so a gesture never sees a
 *     move that arrives after the frame it belongs to;
 *   - pointer capture is handled in one place rather than per element;
 *   - **a HUD with a hundred elements pays for four listeners, not four
 *     hundred** — which is what makes S3's element count affordable.
 *
 * Coarse-pointer adaptation — larger hit slop, no hover-dependent affordances,
 * long-press for context menu — is driven by the metrics snapshot, never by
 * user-agent sniffing.
 */
import "../core/dev.js";
import * as dom from "../core/dom.js";

export class PointerService {
  constructor() {
    this.mk = null;
    this.queue = [];
    this.captures = new Map();
    this._disposers = [];
    this._roots = new Set();
  }

  attach(mk) {
    this.mk = mk;
    this._stop = mk.scheduler.on("input", () => this.drain());
    for (const root of mk.roots) this.observe(root);
  }

  /** Delegate from one root. Idempotent, so late roots can join. */
  observe(root) {
    if (!root || !root.el || this._roots.has(root)) return () => {};
    this._roots.add(root);
    const el = root.el;

    const push = (type) => (event) => {
      this.queue.push(normalize(type, event));
      // Arm rather than handle: the queue is drained in INPUT, which is what
      // keeps ordering consistent with everything else in the frame.
      this.mk.scheduler.arm();
    };

    const disposers = [
      dom.listen(el, "pointerdown", push("down")),
      dom.listen(el, "pointermove", push("move")),
      dom.listen(el, "pointerup", push("up")),
      dom.listen(el, "pointercancel", push("cancel")),
      dom.listen(el, "lostpointercapture", push("cancel")),
      dom.listen(el, "wheel", push("wheel"), { passive: true })
    ];
    this._disposers.push(...disposers);

    return () => {
      for (const dispose of disposers) dispose();
      this._roots.delete(root);
    };
  }

  /**
   * Drain the queue into the gesture service.
   *
   * An event whose target is inside a node with attached recognizers is routed
   * to that node; anything else falls through to the browser untouched, which
   * is §13.3's fourth arbitration rule.
   */
  drain() {
    if (!this.queue.length) return 0;
    const events = this.queue.splice(0);
    const gestures = this.mk.services.get("gestures");
    if (!gestures) return events.length;

    for (const event of events) {
      const node = this.nodeFor(event.target, gestures);
      if (node) gestures.dispatch(node, event);
    }
    return events.length;
  }

  /** The nearest ancestor node with recognizers attached. */
  nodeFor(target, gestures) {
    if (!target || !target.closest) return null;
    for (const node of gestures.attachments.keys()) {
      if (node.el && (node.el === target || node.el.contains(target))) return node;
    }
    return null;
  }

  /** Hit slop, widened for coarse pointers from the metrics snapshot. */
  get slop() {
    return this.mk && this.mk.metrics.current.coarsePointer ? 12 : 4;
  }

  destroy() {
    if (this._stop) this._stop();
    for (const dispose of this._disposers) dispose();
    this._disposers.length = 0;
    this._roots.clear();
    this.queue.length = 0;
  }
}

/**
 * The normalized shape recognizers consume.
 *
 * Deliberately plain data: a recognizer that could reach `event.preventDefault`
 * would be a recognizer that could not be table-tested, and §13.3 asks for
 * exactly that test. The original is kept as `native` for the one caller that
 * genuinely needs it.
 */
export function normalize(type, event) {
  return {
    type,
    id: event.pointerId == null ? 0 : event.pointerId,
    x: event.clientX || 0,
    y: event.clientY || 0,
    dx: event.deltaX || 0,
    dy: event.deltaY || 0,
    time: event.timeStamp || 0,
    buttons: event.buttons || 0,
    pointerType: event.pointerType || "mouse",
    shift: !!event.shiftKey,
    ctrl: !!event.ctrlKey,
    alt: !!event.altKey,
    meta: !!event.metaKey,
    target: event.target,
    native: event
  };
}
