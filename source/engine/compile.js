/**
 * The style compiler (§6.6) and the geometry–style contract (§12.4).
 *
 * ARRANGE produces, per node, a small set of **CSS custom property
 * assignments** rather than a full inline style string. That choice buys four
 * things at once: writes are cheap and diffable, authors can override or
 * animate any of them from their own CSS, most of the arithmetic stays in CSS
 * (honouring P1), and transitions work with no JavaScript involvement.
 *
 * Inline geometry is written only where custom properties cannot reach —
 * `grid-template-columns` is the notable case, built as a string but only when
 * the track list actually changes.
 */
import * as dom from "../core/dom.js";

/** The documented, SemVer-covered property surface (§12.4, §25.1). */
export const GEOMETRY_PROPERTIES = [
  "--mk-x",
  "--mk-y",
  "--mk-w",
  "--mk-h",
  "--mk-inset-top",
  "--mk-inset-right",
  "--mk-inset-bottom",
  "--mk-inset-left",
  "--mk-gutter",
  "--mk-track-list",
  "--mk-z"
];

export class StyleCompiler {
  constructor() {
    this.writes = 0;
    this.skipped = 0;
  }

  /**
   * Stage a custom property on `node`. Nothing reaches the DOM until
   * `flush()` runs in the WRITE phase.
   */
  set(node, name, value) {
    if (!node._pendingStyle) node._pendingStyle = new Map();
    node._pendingStyle.set(name, value == null ? null : String(value));
  }

  /** Stage several at once. */
  setAll(node, values) {
    for (const name of Object.keys(values)) this.set(node, name, values[name]);
  }

  /** Stage a plain (non-custom) CSS property. */
  setStyle(node, name, value) {
    if (!node._pendingCss) node._pendingCss = new Map();
    node._pendingCss.set(name, value == null ? null : String(value));
  }

  /** Stage a data attribute — state that ordinary CSS selectors can read. */
  setState(node, name, value) {
    if (!node._pendingState) node._pendingState = new Map();
    node._pendingState.set(name, value);
  }

  /** Stage the resolved rect, in the units the contract promises (px). */
  setRect(node, r) {
    this.set(node, "--mk-x", `${px(r.x)}px`);
    this.set(node, "--mk-y", `${px(r.y)}px`);
    this.set(node, "--mk-w", `${px(r.w)}px`);
    this.set(node, "--mk-h", `${px(r.h)}px`);
  }

  setInsets(node, insets) {
    this.set(node, "--mk-inset-top", `${px(insets.top)}px`);
    this.set(node, "--mk-inset-right", `${px(insets.right)}px`);
    this.set(node, "--mk-inset-bottom", `${px(insets.bottom)}px`);
    this.set(node, "--mk-inset-left", `${px(insets.left)}px`);
  }

  /**
   * Write everything staged on `node`, skipping properties whose value has not
   * changed. The skip counter is what the benchmark in §20.3 watches.
   */
  flush(node) {
    const el = node.el;
    if (!el) {
      node._pendingStyle = null;
      node._pendingCss = null;
      node._pendingState = null;
      return 0;
    }

    let written = 0;
    if (!node._written) node._written = new Map();
    const previous = node._written;

    if (node._pendingStyle) {
      for (const [name, value] of node._pendingStyle) {
        if (previous.get(name) === value) {
          this.skipped++;
          continue;
        }
        previous.set(name, value);
        if (value === null) el.style.removeProperty(name);
        else el.style.setProperty(name, value);
        written++;
      }
      node._pendingStyle.clear();
    }

    if (node._pendingCss) {
      for (const [name, value] of node._pendingCss) {
        const key = "!" + name;
        if (previous.get(key) === value) {
          this.skipped++;
          continue;
        }
        previous.set(key, value);
        if (value === null) el.style.removeProperty(name);
        else el.style.setProperty(name, value);
        written++;
      }
      node._pendingCss.clear();
    }

    if (node._pendingState) {
      for (const [name, value] of node._pendingState) {
        const key = "@" + name;
        const text = value === true ? "" : value === false || value == null ? null : String(value);
        if (previous.get(key) === text) {
          this.skipped++;
          continue;
        }
        previous.set(key, text);
        const attribute = `data-mk-${name}`;
        if (text === null) el.removeAttribute(attribute);
        else el.setAttribute(attribute, text);
        // The boolean mirror, so `calc()` tricks can read state (§12.4).
        el.style.setProperty(`--mk-state-${name}`, text === null ? "0" : "1");
        written++;
      }
      node._pendingState.clear();
    }

    this.writes += written;
    return written;
  }

  /** Forget what was written, so the next flush writes everything again. */
  reset(node) {
    node._written = null;
  }
}

function px(value) {
  if (!isFinite(value)) return 0;
  // Sub-pixel noise makes the diff useless and the DOM busy; two decimals is
  // finer than any display and stable across arithmetic.
  return Math.round(value * 100) / 100;
}

/**
 * Build a `grid-template-*` track list. Gutters are real tracks so they
 * participate in track sizing rather than being overlaid (§7.3).
 */
export function trackList(tracks) {
  return tracks.join(" ");
}

/** Apply the base positioning mode an algorithm needs on a container. */
export function containerStyles(el, styles) {
  dom.setStyles(el, styles);
}
