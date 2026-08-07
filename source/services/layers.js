/**
 * The layer service (§16.1) — core.
 *
 * Named layers with reserved z-index bands eliminate z-index arithmetic
 * entirely. Within a band, order is by insertion, with `bringToFront()` for
 * floating windows — and because that ordering is *within* the band, a
 * floating window can never escape above a modal no matter how many times it
 * is clicked. That is precisely the bug z-index arithmetic produces and layer
 * bands prevent.
 *
 * Plugins register new layers by name with a band, never by picking a number.
 */
import "../core/dev.js";
import * as dom from "../core/dom.js";
import { warn } from "../core/diagnostics.js";

export const DEFAULT_LAYERS = [
  ["base", 0],
  ["content", 100],
  ["docked", 200],
  ["hud", 300],
  ["overlay", 400],
  ["modal", 500],
  ["popover", 600],
  ["tooltip", 700],
  ["toast", 800],
  ["devtools", 900]
];

export class LayerService {
  constructor() {
    this.mk = null;
    this.bands = new Map(DEFAULT_LAYERS);
    this.members = new Map();
    this.roots = new Map();
    this.counter = 0;
    this.backdrops = new Map();
    this.scrollLocks = 0;
    this._scrollRestore = null;
  }

  attach(mk) {
    this.mk = mk;
    for (const [name, band] of this.bands) mk.registry.set("layer", name, { name, band }, { replace: true });
  }

  /** Register a new layer. Bands are declared, never invented at a call site. */
  register(name, band) {
    if (this.bands.has(name)) {
      warn("MK4001", __MK_DEV__ &&
        `layer '${name}' is already registered`, { subject: name });
      return this.bands.get(name);
    }
    this.bands.set(name, band);
    if (this.mk) this.mk.registry.set("layer", name, { name, band });
    return band;
  }

  bandOf(name) {
    const band = this.bands.get(name);
    if (band === undefined) {
      warn("MK4001", __MK_DEV__ &&
        `unknown layer '${name}'; using 'content'`, { subject: name });
      return this.bands.get("content");
    }
    return band;
  }

  /**
   * The DOM element a layer's content is portalled into. Created lazily, so a
   * page that never opens a modal never pays for a modal layer.
   */
  rootFor(name) {
    const existing = this.roots.get(name);
    if (existing) return existing;
    const host = this.mk && this.mk.root ? this.mk.root.el : dom.body();
    const el = dom.el("div", {
      class: `${this.mk ? this.mk.prefix : "mk"}-layer`,
      "data-mk-layer": name,
      style: {
        position: "absolute",
        inset: "0",
        zIndex: String(this.bandOf(name)),
        pointerEvents: "none"
      }
    });
    host.appendChild(el);
    this.roots.set(name, el);
    return el;
  }

  /** Add `node` to a layer and return its resolved z within the band. */
  add(node, name) {
    const layer = name || "content";
    const band = this.bandOf(layer);
    const order = ++this.counter;
    this.members.set(node, { layer, order });
    node.layer = layer;
    this._applyZ(node, band, order);
    return band + (order % 100);
  }

  remove(node) {
    this.members.delete(node);
    this.releaseBackdrop(node);
  }

  /** Raise within the band. Never across bands — that is the whole point. */
  bringToFront(node) {
    const record = this.members.get(node);
    if (!record) return false;
    record.order = ++this.counter;
    this._applyZ(node, this.bandOf(record.layer), record.order);
    return true;
  }

  /** The topmost member of a layer, for dismissal and focus restoration. */
  topOf(name) {
    let best = null;
    let bestOrder = -1;
    for (const [node, record] of this.members) {
      if (record.layer !== name || node.destroyed) continue;
      if (record.order > bestOrder) {
        bestOrder = record.order;
        best = node;
      }
    }
    return best;
  }

  _applyZ(node, band, order) {
    if (!this.mk) return;
    this.mk.compiler.set(node, "--mk-z", String(band + (order % 100)));
    if (node.el) node.el.style.zIndex = String(band + (order % 100));
  }

  /**
   * Backdrops are reference-counted and shared: three stacked modals produce
   * one backdrop, positioned beneath the topmost (§16.2).
   */
  requestBackdrop(node, options) {
    const layer = (this.members.get(node) || {}).layer || "modal";
    let record = this.backdrops.get(layer);
    if (!record) {
      const el = dom.el("div", {
        class: `${this.mk ? this.mk.prefix : "mk"}-backdrop`,
        "data-mk-backdrop": layer,
        style: {
          position: "fixed",
          inset: "0",
          zIndex: String(this.bandOf(layer) - 1),
          background: "var(--mk-backdrop-bg, rgb(15 23 42 / 0.45))",
          pointerEvents: "auto"
        }
      });
      (this.mk && this.mk.root ? this.mk.root.el : dom.body()).appendChild(el);
      record = { el, count: 0, owners: new Set() };
      this.backdrops.set(layer, record);
    }
    if (!record.owners.has(node)) {
      record.owners.add(node);
      record.count++;
    }
    const top = this.members.get(node);
    if (top) record.el.style.zIndex = String(this.bandOf(layer) + (top.order % 100) - 1);
    if (options && options.onDismiss) {
      record.el.onclick = options.onDismiss;
    }
    return record.el;
  }

  releaseBackdrop(node) {
    for (const [layer, record] of this.backdrops) {
      if (!record.owners.has(node)) continue;
      record.owners.delete(node);
      record.count--;
      if (record.count <= 0) {
        dom.remove(record.el);
        this.backdrops.delete(layer);
      } else {
        // Re-seat the backdrop beneath whatever is now topmost.
        const top = this.topOf(layer);
        const order = top ? (this.members.get(top) || {}).order || 0 : 0;
        record.el.style.zIndex = String(this.bandOf(layer) + (order % 100) - 1);
      }
    }
  }

  /**
   * Scroll locking, also reference-counted, so nested overlays neither
   * double-lock nor prematurely unlock (§16.2).
   */
  lockScroll() {
    this.scrollLocks++;
    if (this.scrollLocks > 1 || !dom.isBrowser()) return;
    const root = dom.documentRoot();
    const scrollbar = dom.measureScrollbar();
    this._scrollRestore = {
      overflow: root.style.overflow,
      paddingRight: root.style.paddingRight
    };
    root.style.overflow = "hidden";
    if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
  }

  unlockScroll() {
    if (this.scrollLocks === 0) return;
    this.scrollLocks--;
    if (this.scrollLocks > 0 || !dom.isBrowser() || !this._scrollRestore) return;
    const root = dom.documentRoot();
    root.style.overflow = this._scrollRestore.overflow;
    root.style.paddingRight = this._scrollRestore.paddingRight;
    this._scrollRestore = null;
  }

  destroy() {
    for (const el of this.roots.values()) dom.remove(el);
    this.roots.clear();
    for (const record of this.backdrops.values()) dom.remove(record.el);
    this.backdrops.clear();
    this.members.clear();
    while (this.scrollLocks > 0) this.unlockScroll();
  }
}
