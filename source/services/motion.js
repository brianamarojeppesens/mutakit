/**
 * Motion (§17).
 *
 * **The invariant that governs this whole file:** *animation may never affect
 * layout correctness.* A tree mid-animation resolves to exactly the same
 * geometry as one at rest; motion lives in transforms, opacity, and clip, never
 * in the values ARRANGE computes. That is why `mk.flush({ animations: false })`
 * can exist, why layout snapshot tests are deterministic, and why a
 * mis-specified animation can look wrong but never *break* a layout.
 *
 * The backend is the Web Animations API rather than CSS transitions, and the
 * reason is interruption: reversing a half-open drawer must start from its
 * current position, not from the endpoint. That is implemented by reading the
 * running animation's computed value and retargeting — which needs a handle on
 * the animation, which CSS transitions do not give you.
 */
import "../core/dev.js";
import * as dom from "../core/dom.js";
import { warn } from "../core/diagnostics.js";

/** Properties a preset may animate. Everything else is MK5004 (§17). */
const COMPOSITABLE = new Set(["transform", "opacity", "filter", "clipPath", "clip-path"]);

/**
 * The built-in presets. Each declares `enter`, `exit`, and `reduced`, and the
 * conformance check enforces that third one: reduced does not mean *none* —
 * an instantaneous state change can be more disorienting than a 100ms fade.
 */
export const PRESETS = {
  none: { enter: null, exit: null, reduced: null },

  fade: {
    enter: { opacity: [0, 1], duration: "--mk-dur-med", easing: "--mk-ease-out" },
    exit: "reverse",
    reduced: { opacity: [0, 1], duration: 80 }
  },

  scale: {
    enter: {
      opacity: [0, 1],
      transform: ["scale(0.96)", "none"],
      duration: "--mk-dur-med",
      easing: "--mk-ease-out"
    },
    exit: "reverse",
    reduced: { opacity: [0, 1], duration: 80 }
  },

  slide: {
    enter: {
      transform: ["translateY(8px)", "none"],
      opacity: [0, 1],
      duration: "--mk-dur-med",
      easing: "--mk-ease-out"
    },
    exit: "reverse",
    reduced: { opacity: [0, 1], duration: 80 }
  },

  "slide-end": {
    enter: { transform: ["translateX(100%)", "none"], duration: "--mk-dur-med", easing: "--mk-ease-out" },
    exit: "reverse",
    reduced: { opacity: [0, 1], duration: 80 }
  },

  "slide-start": {
    enter: { transform: ["translateX(-100%)", "none"], duration: "--mk-dur-med", easing: "--mk-ease-out" },
    exit: "reverse",
    reduced: { opacity: [0, 1], duration: 80 }
  },

  "slide-bottom": {
    enter: { transform: ["translateY(100%)", "none"], duration: "--mk-dur-med", easing: "--mk-ease-out" },
    exit: "reverse",
    reduced: { opacity: [0, 1], duration: 80 }
  },

  /**
   * The interesting exception: `collapse` genuinely needs a size change, and
   * resolves it by animating a `grid-template-rows` `0fr → 1fr` track, which is
   * compositable in modern engines and degrades to an instant change where it
   * is not (§17).
   */
  collapse: {
    enter: { gridTemplateRows: ["0fr", "1fr"], duration: "--mk-dur-med", easing: "--mk-ease-out" },
    exit: "reverse",
    reduced: { gridTemplateRows: ["0fr", "1fr"], duration: 0 },
    allowLayout: true
  },

  spring: {
    enter: {
      transform: ["scale(0.9)", "none"],
      opacity: [0, 1],
      duration: "--mk-dur-slow",
      easing: "cubic-bezier(0.34, 1.56, 0.64, 1)"
    },
    exit: "reverse",
    reduced: { opacity: [0, 1], duration: 80 }
  }
};

export class MotionService {
  constructor() {
    this.mk = null;
    /** Every animation currently running, so `finishAll()` can settle them. */
    this.running = new Map();
  }

  attach(mk) {
    this.mk = mk;
    for (const name of Object.keys(PRESETS)) {
      mk.registry.set("motion", name, { name, ...PRESETS[name] }, { replace: true });
    }
  }

  /** True when the platform can animate. */
  get enabled() {
    return !!this.mk.metrics.current.features.webAnimations;
  }

  get reduced() {
    return !!(this.mk && this.mk.metrics.current.reducedMotion);
  }

  /**
   * Play `phase` on `node`. Returns a promise that settles when the animation
   * finishes, is cancelled, or is skipped — callers can always await it.
   */
  play(node, phase, options) {
    const opts = options || {};
    const preset = this.presetFor(node, opts.preset);
    if (!preset || !node.el || !this.enabled) return Promise.resolve(false);

    const keyframes = this.keyframesFor(preset, phase, node);
    if (!keyframes) return Promise.resolve(false);

    const timing = this.timingFor(keyframes, node);
    const frames = toFrames(keyframes, phase);
    if (!frames) return Promise.resolve(false);

    if (__MK_DEV__) checkCompositable(node, keyframes, preset);

    // Interruption is the default assumption: a running animation is
    // retargeted from where it *is*, not cancelled and restarted from the
    // endpoint (§17).
    const existing = this.running.get(node.el);
    if (existing) {
      const from = currentValues(node.el, Object.keys(frames[0] || {}));
      existing.animation.cancel();
      this.running.delete(node.el);
      if (from) Object.assign(frames[0], from);
    }

    const animation = node.el.animate(frames, timing);
    const record = { animation, phase, node };
    this.running.set(node.el, record);

    return animation.finished
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        if (this.running.get(node.el) === record) this.running.delete(node.el);
      });
  }

  /** The preset for a node: an explicit name, its type's declaration, or none. */
  presetFor(node, override) {
    const declared = override || (node.definition && node.definition.motion);
    if (!declared) return null;
    if (typeof declared === "string") return this.mk.registry.get("motion", declared) || null;
    return declared;
  }

  /**
   * The keyframes for a phase, resolving `'reverse'` and the reduced variant.
   *
   * `prefers-reduced-motion` is read from the metrics snapshot and switches
   * every preset to its `reduced` variant — which is usually a short fade, not
   * nothing.
   */
  keyframesFor(preset, phase, node) {
    if (this.reduced) {
      const reduced = resolveNamed(this.mk, preset.reduced);
      if (reduced == null) return null;
      return reduced;
    }
    let frames = resolveNamed(this.mk, preset[phase]);
    if (frames === "reverse") frames = resolveNamed(this.mk, preset.enter);
    if (!frames) return null;
    return frames;
  }

  /** Durations and easings are token-driven, so a theme can slow everything. */
  timingFor(keyframes, node) {
    const duration = this.resolveToken(keyframes.duration, node, 200);
    const easing = typeof keyframes.easing === "string" && keyframes.easing.startsWith("--")
      ? this.resolveTokenString(keyframes.easing, node, "ease")
      : keyframes.easing || "ease";
    return { duration, easing, fill: "both" };
  }

  resolveToken(value, node, fallback) {
    if (typeof value === "number") return value;
    if (typeof value !== "string") return fallback;
    if (!value.startsWith("--")) return parseFloat(value) || fallback;
    const raw = this.resolveTokenString(value, node, "");
    return parseFloat(raw) || fallback;
  }

  resolveTokenString(name, node, fallback) {
    const host = (node && node.el) || (this.mk.root && this.mk.root.el);
    if (!host) return fallback;
    const raw = dom.readCustomProperty(host, name);
    return raw || fallback;
  }

  /**
   * Finish every running animation immediately.
   *
   * `mk.flush({ animations: false })` routes here, which is what makes layout
   * snapshot tests deterministic without them having to know what is animating.
   */
  finishAll() {
    for (const [el, record] of [...this.running]) {
      try {
        record.animation.finish();
      } catch (error) {
        record.animation.cancel();
      }
      this.running.delete(el);
    }
    return this;
  }

  /** True while anything is animating — the exit-orchestration gate. */
  get busy() {
    return this.running.size > 0;
  }

  /**
   * FLIP, for reorder animations (sortable lists, tab reordering).
   *
   * Measure before, mutate, measure after, animate the *inverse* — so the
   * elements never actually move through the intermediate positions and layout
   * is untouched throughout.
   */
  flip(nodes, mutate) {
    const before = new Map();
    for (const node of nodes) {
      if (node.el) before.set(node, dom.rectOf(node.el));
    }
    mutate();
    const played = [];
    for (const node of nodes) {
      const first = before.get(node);
      if (!first || !node.el) continue;
      const last = dom.rectOf(node.el);
      const dx = first.x - last.x;
      const dy = first.y - last.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      if (!this.enabled || this.reduced) continue;
      played.push(
        node.el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
          { duration: this.resolveToken("--mk-dur-med", node, 200), easing: "ease-out" }
        )
      );
    }
    return played;
  }

  destroy() {
    this.finishAll();
    this.running.clear();
  }
}

/** A preset entry may name another registered preset. */
function resolveNamed(mk, value) {
  if (typeof value !== "string" || value === "reverse") return value;
  const named = mk && mk.registry.get("motion", value);
  return named ? named.enter || null : value;
}

/**
 * Turn a keyframe declaration into the two-frame array the Web Animations API
 * wants, reversed for an exit.
 */
function toFrames(keyframes, phase) {
  const frames = [{}, {}];
  let any = false;
  for (const property of Object.keys(keyframes)) {
    if (property === "duration" || property === "easing" || property === "interruptible") continue;
    const value = keyframes[property];
    if (!Array.isArray(value) || value.length !== 2) continue;
    frames[0][property] = value[0];
    frames[1][property] = value[1];
    any = true;
  }
  if (!any) return null;
  return phase === "exit" ? [frames[1], frames[0]] : frames;
}

/** The current computed value of each property, for retargeting. */
function currentValues(el, properties) {
  const style = dom.computedStyle(el);
  const out = {};
  let any = false;
  for (const property of properties) {
    const value = style[property];
    if (value) {
      out[property] = value;
      any = true;
    }
  }
  return any ? out : null;
}

/**
 * Presets may animate `transform`, `opacity`, `filter`, and `clip-path` only.
 * Animating `width`, `height`, `top`, or `left` is MK5004 with the
 * transform-based alternative named — because those are the values ARRANGE
 * computes, and animating them is how a library ends up with a layout that is
 * correct at rest and wrong in motion.
 */
function checkCompositable(node, keyframes, preset) {
  if (preset.allowLayout) return;
  for (const property of Object.keys(keyframes)) {
    if (property === "duration" || property === "easing" || property === "interruptible") continue;
    if (COMPOSITABLE.has(property)) continue;
    warn("MK5004", __MK_DEV__ &&
      `'${node.type}' animates '${property}', which affects layout. Animate a transform ` +
        `instead — ${suggest(property)} — so the tree resolves to the same geometry in ` +
        `motion as at rest (§17).`,
      { subject: `${node.type}.${property}` }
    );
  }
}

function suggest(property) {
  if (property === "width" || property === "height") return "scale()";
  if (property === "top" || property === "left" || property === "right" || property === "bottom") {
    return "translate()";
  }
  return "transform or opacity";
}

export const motionPlugin = {
  name: "mutakit-motion",
  version: "1.0.0",
  requires: { mutakit: ">=0.4.0 <2" },
  install(mk) {
    mk.provide("motion", new MotionService());
    return { uninstall() {} };
  }
};
