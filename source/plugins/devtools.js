/**
 * Devtools (§19.3) — a plugin, excluded from production presets.
 *
 * Six panels, of which two carry most of the value. The **geometry overlay**
 * draws frames, insets, and anchor points on the page, which is the single most
 * useful debugging feature a geometry library can offer. The **constraint
 * explainer** answers "why is my box the wrong size" by showing every
 * constraint and which ones §5.8 dropped — the question the whole priority
 * system exists to make answerable.
 */
import "../core/dev.js";
import * as dom from "../core/dom.js";
import { bitNames } from "../engine/invalidate.js";

export const devtoolsPlugin = {
  name: "mutakit-devtools",
  version: "1.0.0",
  // `^0.4.0` would exclude 0.5 and later: under SemVer every 0.x minor is a
  // breaking change, and these plugins track the library rather than a line of it.
  requires: { mutakit: ">=0.4.0 <2" },

  install(mk, options) {
    const tools = new Devtools(mk, options || {});
    mk.devtools = tools;
    return {
      uninstall() {
        tools.destroy();
        delete mk.devtools;
      }
    };
  }
};

export class Devtools {
  constructor(mk, options) {
    this.mk = mk;
    this.options = options;
    this.panels = new Map();
    this.overlayEl = null;
    this.selected = null;
    this.log = [];
    this.frames = [];
    this._disposers = [];

    this._recordFrames();
    this._recordEvents();
  }

  /** Extension point §10.12 — a plugin adds its own panel. */
  panel(name, definition) {
    this.panels.set(name, definition);
    return this;
  }

  /** The tree inspector: props, computed geometry, traits, and dirty flags. */
  tree(scope) {
    const root = scope || this.mk.root;
    if (!root) return null;
    const describe = (node) => ({
      type: node.type,
      id: node.id,
      key: node.pathKey,
      rect: [round(node.computed.x), round(node.computed.y), round(node.computed.w), round(node.computed.h)],
      frame: [round(node.frame.x), round(node.frame.y), round(node.frame.w), round(node.frame.h)],
      algorithm: node.algorithm,
      traits: [...node.traits.keys()],
      dirty: bitNames(node.flags),
      errored: node.errored ? String(node.errored.message) : null,
      props: plainProps(node),
      layout: { ...node.layoutProps },
      children: node.children.map(describe)
    });
    return describe(root);
  }

  /**
   * The constraint explainer (§19.3).
   *
   * Every dropped constraint is recorded on the node when §5.8 resolves an
   * axis, so this reports what actually happened rather than re-deriving it.
   */
  explain(nodeOrId) {
    const node = typeof nodeOrId === "string" ? idNode(this.mk, nodeOrId) : nodeOrId;
    if (!node) return null;
    return {
      node: node.toString(),
      declared: { ...node.geometry },
      resolved: { ...node.computed },
      frame: { ...node.frame },
      insets: { ...node.effectiveInsets },
      dropped: node.droppedConstraints || [],
      ownedBy:
        node.positioning === "self"
          ? "itself (positioning: 'self')"
          : `its parent's '${node.parent ? node.parent.algorithm : "—"}' algorithm`,
      note:
        (node.droppedConstraints || []).length
          ? `Over-constrained: ${node.droppedConstraints.join(", ")} dropped by §5.8's priority order.`
          : "Fully determined."
    };
  }

  /** The geometry overlay: frames, insets, and anchor points, drawn in place. */
  showOverlay(scope) {
    this.hideOverlay();
    const root = scope || this.mk.root;
    if (!root || !root.el) return null;

    const overlay = dom.el("div", {
      class: "mk-devtools-overlay",
      "aria-hidden": "true",
      style: { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "900" }
    });
    root.el.appendChild(overlay);
    this.overlayEl = overlay;

    const draw = () => {
      overlay.textContent = "";
      root.walk((node) => {
        if (node === root || !node.el) return;
        const box = node.computed;
        dom.el("div", {
          class: "mk-devtools-box",
          "data-mk-devtools-type": node.type,
          style: {
            position: "absolute",
            left: `${box.x}px`,
            top: `${box.y}px`,
            width: `${box.w}px`,
            height: `${box.h}px`,
            outline: `1px solid ${node === this.selected ? "#ef4444" : "rgb(59 130 246 / 0.55)"}`,
            font: "10px ui-monospace, monospace",
            color: "#3b82f6"
          },
          text: `${node.type}${node.id ? "#" + node.id : ""} ${round(box.w)}×${round(box.h)}`
        }, overlay);
      });
    };

    this._disposers.push(this.mk.scheduler.on("paint", draw));
    draw();
    return overlay;
  }

  hideOverlay() {
    if (this.overlayEl) dom.remove(this.overlayEl);
    this.overlayEl = null;
  }

  select(nodeOrId) {
    this.selected = typeof nodeOrId === "string" ? idNode(this.mk, nodeOrId) : nodeOrId;
    return this.explain(this.selected);
  }

  /** The frame profiler: per-phase timing and dirty-node counts. */
  profile() {
    const recent = this.frames.slice(-60);
    if (!recent.length) return null;
    const total = recent.reduce((sum, frame) => sum + frame.duration, 0);
    return {
      frames: recent.length,
      averageMs: round(total / recent.length),
      worstMs: round(Math.max(...recent.map((f) => f.duration))),
      phases: recent[recent.length - 1].timings,
      writes: this.mk.compiler.writes,
      skipped: this.mk.compiler.skipped,
      overBudget: recent.filter((f) => f.duration > this.mk.scheduler.budget).length
    };
  }

  /** The event log: a filterable stream of node-tree events. */
  events(filter) {
    if (!filter) return this.log.slice();
    return this.log.filter((entry) => entry.type.includes(filter) || entry.target.includes(filter));
  }

  /** The layout editor's export: the tier-2 JSON for the current tree. */
  export(scope) {
    return this.mk.serialize ? this.mk.serialize(scope) : this.tree(scope);
  }

  _recordFrames() {
    this._disposers.push(
      this.mk.scheduler.on("paint", () => {
        this.frames.push({
          id: this.mk.scheduler.frameId,
          duration: this.mk.scheduler.lastDuration,
          timings: { ...this.mk.scheduler.timings }
        });
        if (this.frames.length > 240) this.frames.shift();
      })
    );
  }

  _recordEvents() {
    // Recorded at the root, where every node-tree event bubbles to.
    for (const root of this.mk.roots) {
      const bag = root._listeners || (root._listeners = Object.create(null));
      for (const type of ["error", "mount", "propschange", "resize", "change", "select"]) {
        if (!bag[type]) bag[type] = [];
        const entry = {
          fn: (event) => {
            this.log.push({
              type: event.type,
              target: String(event.target),
              detail: event.detail,
              frame: this.mk.scheduler.frameId
            });
            if (this.log.length > 500) this.log.shift();
          },
          once: false,
          order: -100
        };
        bag[type].push(entry);
        this._disposers.push(() => {
          const index = bag[type].indexOf(entry);
          if (index !== -1) bag[type].splice(index, 1);
        });
      }
    }
  }

  destroy() {
    this.hideOverlay();
    for (const dispose of this._disposers) dispose();
    this._disposers.length = 0;
    this.log.length = 0;
    this.frames.length = 0;
  }
}

function idNode(mk, id) {
  const handle = mk.byId(id);
  return handle ? handle.node : null;
}

function plainProps(node) {
  const out = {};
  for (const key of Object.keys(node.props)) {
    const value = node.props[key];
    out[key] = typeof value === "function" ? "(function)" : value;
  }
  return out;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
