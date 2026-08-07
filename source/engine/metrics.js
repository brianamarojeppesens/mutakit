/**
 * `MetricsSnapshot` (§6.4).
 *
 * One object, taken once per frame in the READ phase, holding everything that
 * would otherwise force a reflow or a media query. Every consumer reads from
 * the snapshot, never from the live DOM — which is the rule that makes
 * "≤ 1 forced reflow per frame" (§20.1) achievable rather than aspirational.
 *
 * Changes between snapshots emit `metrics:change`, which is how a plugin
 * needing device pixels learns that `devicePixelRatio` moved (§5.4).
 */
import * as dom from "../core/dom.js";

const QUERIES = {
  reducedMotion: "(prefers-reduced-motion: reduce)",
  darkScheme: "(prefers-color-scheme: dark)",
  moreContrast: "(prefers-contrast: more)",
  lessContrast: "(prefers-contrast: less)",
  forcedColors: "(forced-colors: active)",
  coarsePointer: "(pointer: coarse)",
  noHover: "(hover: none)",
  reducedTransparency: "(prefers-reduced-transparency: reduce)"
};

export function emptySnapshot() {
  return {
    time: 0,
    vw: 0,
    vh: 0,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    dpr: 1,
    rem: 16,
    ch: 8,
    ex: 8,
    scrollbar: 0,
    keyboard: 0,
    safe: { top: 0, right: 0, bottom: 0, left: 0 },
    reducedMotion: false,
    darkScheme: false,
    moreContrast: false,
    lessContrast: false,
    forcedColors: false,
    coarsePointer: false,
    noHover: false,
    reducedTransparency: false,
    features: { dom: false }
  };
}

export class Metrics {
  constructor() {
    this.current = emptySnapshot();
    // Feature detection is cached, forces no reflow, and is *true before the
    // first frame* — unlike everything else here, which needs a READ phase to
    // measure. Leaving it empty until then meant `create` and `mount` saw a
    // browser with no capabilities at all, and three subsystems in a row
    // silently took their fallback path while appearing to work.
    this.current.features = dom.detectFeatures();
    this.previous = this.current;
    this._queries = null;
    this._probe = null;
    this._disposers = [];
    this.overrides = null;
  }

  /** Install a fixed snapshot. Tests use this; nothing else should. */
  override(values) {
    this.overrides = values;
    if (values) this.current = { ...this.current, ...values };
  }

  /** Take a fresh snapshot. Called once per frame, in READ. */
  take(time) {
    if (this.overrides) {
      this.previous = this.current;
      this.current = { ...this.current, ...this.overrides, time };
      return this.current;
    }
    if (!dom.isBrowser()) {
      this.previous = this.current;
      this.current = { ...this.current, time };
      return this.current;
    }

    const viewport = dom.viewport();
    const queries = this._mediaQueries();
    const probe = this._safeAreaProbe();

    const next = {
      time,
      vw: viewport.w,
      vh: viewport.h,
      offsetX: viewport.offsetX,
      offsetY: viewport.offsetY,
      scale: viewport.scale,
      dpr: dom.devicePixelRatio(),
      rem: rootFontSize(),
      ch: this.current.ch,
      ex: this.current.ex,
      scrollbar: dom.measureScrollbar(),
      keyboard: keyboardHeight(viewport),
      safe: probe,
      features: dom.detectFeatures()
    };
    for (const name of Object.keys(QUERIES)) next[name] = queries[name].matches;

    this.previous = this.current;
    this.current = next;
    return next;
  }

  /** The fields that differ from the previous snapshot. */
  diff() {
    const changed = [];
    const a = this.previous;
    const b = this.current;
    for (const key of Object.keys(b)) {
      if (key === "time" || key === "safe" || key === "features") continue;
      if (a[key] !== b[key]) changed.push(key);
    }
    const sa = a.safe || {};
    const sb = b.safe || {};
    if (sa.top !== sb.top || sa.right !== sb.right || sa.bottom !== sb.bottom || sa.left !== sb.left) {
      changed.push("safe");
    }
    return changed;
  }

  _mediaQueries() {
    if (this._queries) return this._queries;
    this._queries = {};
    for (const name of Object.keys(QUERIES)) this._queries[name] = dom.media(QUERIES[name]);
    return this._queries;
  }

  /**
   * Safe-area insets, read from a hidden probe styled with `env()`.
   *
   * There is no direct API for these, and `getComputedStyle` on a probe is the
   * only honest way to get numbers out of `env()`. The probe is created once
   * and read once per frame, so it costs one style read, not a reflow.
   */
  _safeAreaProbe() {
    if (!dom.isBrowser()) return this.current.safe;
    if (!this._probe) {
      const probe = dom.el("div", {
        "aria-hidden": "true",
        style: {
          position: "fixed",
          top: "0",
          left: "0",
          width: "0",
          height: "0",
          visibility: "hidden",
          pointerEvents: "none",
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          paddingLeft: "env(safe-area-inset-left, 0px)"
        }
      });
      dom.body().appendChild(probe);
      this._probe = probe;
      this._disposers.push(() => dom.remove(probe));
    }
    const style = dom.computedStyle(this._probe);
    return {
      top: parseFloat(style.paddingTop) || 0,
      right: parseFloat(style.paddingRight) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
      left: parseFloat(style.paddingLeft) || 0
    };
  }

  destroy() {
    for (const dispose of this._disposers) dispose();
    this._disposers.length = 0;
    this._probe = null;
    this._queries = null;
  }
}

function rootFontSize() {
  const size = parseFloat(dom.computedStyle(dom.documentRoot()).fontSize);
  return isFinite(size) && size > 0 ? size : 16;
}

/**
 * The virtual keyboard's height, inferred from the gap between the layout and
 * visual viewports. There is no reliable API; this is the measurement every
 * mobile web app ends up making, and the threshold keeps a scrolled toolbar
 * from being mistaken for a keyboard.
 */
function keyboardHeight(visual) {
  const gap = dom.viewportGap(visual);
  return gap > 80 ? gap : 0;
}
