/**
 * The focus manager and the announcer (§13.4, §14).
 *
 * Both are per instance, and both exist because the correct behaviour is
 * *coordination*, not something an individual element can do. Focus must
 * restore when an overlay closes — and must survive the element it would
 * restore to having been removed. Announcements must de-duplicate and rate
 * limit, or a busy form turns a screen reader into noise.
 */
import "../core/dev.js";
import * as dom from "../core/dom.js";
import { warn } from "../core/diagnostics.js";

/** What the browser will focus, in document order. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), summary, iframe, object, embed, audio[controls], ' +
  'video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]';

export class FocusService {
  constructor() {
    this.mk = null;
    this.history = [];
    this.traps = [];
  }

  attach(mk) {
    this.mk = mk;
  }

  /** Every tabbable descendant of `root`, in order, skipping hidden subtrees. */
  tabbable(root) {
    if (!root || !root.querySelectorAll) return [];
    return [...root.querySelectorAll(FOCUSABLE)].filter(isVisiblyFocusable);
  }

  focus(node, options) {
    const el = node && node.el ? node.el : node;
    if (!el) return false;
    const target = el.matches && el.matches(FOCUSABLE) ? el : this.tabbable(el)[0];
    if (!target) return false;
    target.focus(options);
    return true;
  }

  /** Remember what was focused, so an overlay can put it back on close. */
  remember() {
    const active = dom.activeElement();
    this.history.push(active && active !== dom.body() ? active : null);
    return active;
  }

  /**
   * Restore focus, falling back to the nearest surviving ancestor when the
   * element that had it has since been removed — which is the common case
   * after a delete-and-close flow, and the one libraries usually drop.
   */
  restore() {
    const previous = this.history.pop();
    if (!previous) return false;
    if (previous.isConnected) {
      previous.focus();
      return true;
    }
    for (let parent = previous.parentElement; parent; parent = parent.parentElement) {
      if (!parent.isConnected) continue;
      const fallback = parent.matches(FOCUSABLE) ? parent : this.tabbable(parent)[0];
      if (fallback) {
        fallback.focus();
        return true;
      }
    }
    return false;
  }

  /**
   * Contain focus within `el`. Uses `inert` on sibling content where
   * supported, with a sentinel-node fallback (§14).
   */
  trap(el, options) {
    const opts = options || {};
    const record = { el, inerted: [], disposers: [] };
    this.traps.push(record);
    this.remember();

    const features = this.mk ? this.mk.metrics.current.features : {};
    if (features.inert) {
      for (const sibling of siblingsOf(el)) {
        if (sibling.inert) continue;
        sibling.inert = true;
        record.inerted.push(sibling);
      }
    } else {
      record.disposers.push(installSentinels(el));
    }

    // Even with `inert`, a keydown guard is what keeps Tab cycling *within*
    // the trap rather than escaping to the browser's own UI.
    record.disposers.push(
      dom.listen(el, "keydown", (event) => {
        if (event.key !== "Tab") return;
        const items = this.tabbable(el);
        if (!items.length) {
          event.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = dom.activeElement();
        if (event.shiftKey && (active === first || !el.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      })
    );

    if (opts.autoFocus !== false) {
      const initial = opts.initial ? el.querySelector(opts.initial) : null;
      const target = initial || this.tabbable(el)[0] || el;
      if (target === el && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      target.focus();
    }

    return () => this.release(record);
  }

  release(record) {
    const index = this.traps.indexOf(record);
    if (index === -1) return;
    this.traps.splice(index, 1);
    for (const el of record.inerted) el.inert = false;
    for (const dispose of record.disposers) dispose();
    this.restore();
  }

  destroy() {
    for (const record of this.traps.slice()) this.release(record);
    this.history.length = 0;
  }
}

function isVisiblyFocusable(el) {
  if (el.hasAttribute("disabled") || el.getAttribute("aria-hidden") === "true") return false;
  if (el.tabIndex < 0) return false;
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function siblingsOf(el) {
  const out = [];
  for (let node = el; node && node.parentElement; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node && sibling.tagName !== "SCRIPT" && sibling.tagName !== "STYLE") {
        out.push(sibling);
      }
    }
    if (node.parentElement === dom.body()) break;
  }
  return out;
}

/**
 * The fallback where `inert` is unavailable: two zero-size focusable sentinels
 * that bounce focus back into the trap.
 */
function installSentinels(el) {
  const before = dom.el("span", { tabindex: "0", "aria-hidden": "true", "data-mk-sentinel": "start" });
  const after = dom.el("span", { tabindex: "0", "aria-hidden": "true", "data-mk-sentinel": "end" });
  el.insertBefore(before, el.firstChild);
  el.appendChild(after);
  const focusLast = dom.listen(before, "focus", () => {
    const items = [...el.querySelectorAll(FOCUSABLE)].filter((n) => !n.dataset.mkSentinel);
    if (items.length) items[items.length - 1].focus();
  });
  const focusFirst = dom.listen(after, "focus", () => {
    const items = [...el.querySelectorAll(FOCUSABLE)].filter((n) => !n.dataset.mkSentinel);
    if (items.length) items[0].focus();
  });
  return () => {
    focusLast();
    focusFirst();
    dom.remove(before);
    dom.remove(after);
  };
}

/**
 * The announcer (§14) — one polite and one assertive live region per instance.
 *
 * Toasts, validation errors, and async status changes all route through here
 * with de-duplication and rate limiting, because a live region that fires on
 * every keystroke is worse than none.
 */
export class AnnouncerService {
  constructor() {
    this.mk = null;
    this.regions = {};
    this.recent = new Map();
    this.queue = [];
    this.timer = null;
    /** Minimum gap between announcements, in milliseconds. */
    this.interval = 500;
  }

  attach(mk) {
    this.mk = mk;
  }

  region(urgency) {
    const key = urgency === "assertive" ? "assertive" : "polite";
    if (this.regions[key]) return this.regions[key];
    const el = dom.el("div", {
      "aria-live": key,
      "aria-atomic": "true",
      role: key === "assertive" ? "alert" : "status",
      class: `${this.mk ? this.mk.prefix : "mk"}-live`,
      style: {
        position: "absolute",
        width: "1px",
        height: "1px",
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
        clipPath: "inset(50%)",
        whiteSpace: "nowrap"
      }
    });
    (this.mk && this.mk.root ? this.mk.root.el : dom.body()).appendChild(el);
    this.regions[key] = el;
    return el;
  }

  /** Announce `message`. Repeats within the window are dropped, once. */
  say(message, urgency) {
    if (!message) return false;
    const key = `${urgency || "polite"}:${message}`;
    const now = dom.now();
    const last = this.recent.get(key);
    if (last != null && now - last < 2000) {
      warn("MK6003", __MK_DEV__ &&
        `repeated announcement dropped: ${JSON.stringify(message)}`, { subject: key });
      return false;
    }
    this.recent.set(key, now);
    this.queue.push({ message, urgency });
    this._drain();
    return true;
  }

  _drain() {
    if (this.timer || !this.queue.length) return;
    const { message, urgency } = this.queue.shift();
    const el = this.region(urgency);
    // Clearing first is what makes a repeat of the same text announce again
    // in the engines that compare against the previous value.
    el.textContent = "";
    el.textContent = message;
    this.timer = dom.timer(() => {
      this.timer = null;
      this._drain();
    }, this.interval);
  }

  destroy() {
    if (this.timer) this.timer();
    for (const key of Object.keys(this.regions)) dom.remove(this.regions[key]);
    this.regions = {};
    this.queue.length = 0;
    this.recent.clear();
  }
}
