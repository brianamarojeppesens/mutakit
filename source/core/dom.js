/**
 * The DOM adapter — the only module that touches `document` or `window`
 * directly (§22.1, enforced by `tools/lint-arch.mjs`).
 *
 * Two consequences fall out of that rule. Everything above this file is
 * testable without a DOM, which is what makes the geometry and engine suites
 * the fastest and highest-value tests in the project (§23.2). And every
 * listener, observer, and timer the library creates passes through here, so
 * the leak test (§23.5) can count them.
 */
import { DEV } from "./dev.js";
import { fail, warn } from "./diagnostics.js";

const hasDOM = typeof document !== "undefined" && typeof window !== "undefined";

/** Live resource counts. The leak test asserts these return to baseline. */
export const counters = {
  listeners: 0,
  observers: 0,
  elements: 0,
  sheets: 0,
  timers: 0
};

export function isBrowser() {
  return hasDOM;
}

function requireDOM(what) {
  if (!hasDOM) {
    throw new Error(`[mutakit] ${what} needs a DOM; this build is running without one`);
  }
}

// ── Trusted Types (§21.4) ────────────────────────────────────────────────
// One named policy created at init for the handful of sinks, or an immediate
// clear failure. Never a failure halfway through building a UI.

let trustedPolicy = null;
let policyChecked = false;

function policy() {
  if (policyChecked) return trustedPolicy;
  policyChecked = true;
  if (!hasDOM || !window.trustedTypes || !window.trustedTypes.createPolicy) return null;
  try {
    trustedPolicy = window.trustedTypes.createPolicy("mutakit", {
      createHTML: (s) => s,
      createScriptURL: (s) => s
    });
  } catch (error) {
    throw new Error(
      "[mutakit] this page enforces Trusted Types but refused the 'mutakit' policy; " +
        "add 'mutakit' to trusted-types in your Content-Security-Policy"
    );
  }
  return trustedPolicy;
}

// ── Element creation ─────────────────────────────────────────────────────

const LIVE = Symbol("mk.live");
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set(["svg", "path", "circle", "rect", "g", "line", "polyline", "polygon", "text"]);

/**
 * Create an element and optionally append it. `attrs` understands `class`,
 * `style` (as an object), `text`, `dataset`, and anything else as an
 * attribute; a `null` value removes rather than stringifies.
 */
export function el(tag, attrs, parent) {
  requireDOM("element creation");
  const node = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);
  counters.elements++;
  // Removal can legitimately be attempted twice — once by the element's own
  // `ctx.dom` disposer and once by the engine's — so the count is tied to the
  // element rather than to the call, and the leak test stays meaningful.
  node[LIVE] = true;
  if (attrs) applyAttrs(node, attrs);
  if (parent) parent.appendChild(node);
  return node;
}

export function applyAttrs(node, attrs) {
  for (const key of Object.keys(attrs)) {
    const value = attrs[key];
    if (value === undefined) continue;
    if (key === "class") setClass(node, value);
    else if (key === "style" && value && typeof value === "object") setStyles(node, value);
    else if (key === "text") setText(node, value);
    else if (key === "dataset" && value) for (const k of Object.keys(value)) node.dataset[k] = value[k];
    else setAttr(node, key, value);
  }
  return node;
}

export function setAttr(node, name, value) {
  if (value === null || value === false || value === undefined) node.removeAttribute(name);
  else if (value === true) node.setAttribute(name, "");
  else node.setAttribute(name, String(value));
}

export function setClass(node, value) {
  if (Array.isArray(value)) node.setAttribute("class", value.filter(Boolean).join(" "));
  else if (value && typeof value === "object") {
    for (const k of Object.keys(value)) node.classList.toggle(k, !!value[k]);
  } else node.setAttribute("class", value == null ? "" : String(value));
}

export function toggleClass(node, name, on) {
  node.classList.toggle(name, !!on);
}

export function setStyles(node, styles) {
  for (const key of Object.keys(styles)) {
    const value = styles[key];
    if (key.charCodeAt(0) === 45 /* '-' */) {
      if (value == null) node.style.removeProperty(key);
      else node.style.setProperty(key, String(value));
    } else if (value == null) {
      node.style[key] = "";
    } else {
      node.style[key] = String(value);
    }
  }
}

/** String content is *always* textContent. There is no HTML path here (§21.4). */
export function setText(node, value) {
  node.textContent = value == null ? "" : String(value);
}

/**
 * The single markup sink. With no sanitizer configured this throws in
 * development and escapes in production — the insecure path is never the
 * quiet default (§21.4).
 */
export function setHTML(node, markup, sanitize, subject) {
  if (typeof sanitize !== "function") {
    fail("MK3014", __MK_DEV__ &&
      "an html-prefixed prop needs a sanitizer: Mutakit.create({ sanitize }). " +
        "Falling back to text.",
      { subject }
    );
    setText(node, markup);
    return;
  }
  const clean = sanitize(markup);
  const p = policy();
  node.innerHTML = p ? p.createHTML(clean) : clean;
}

/**
 * Detach a node, and account for everything that goes with it.
 *
 * The whole subtree, not just the node named. `el()` increments on creation
 * and only this decrements, so a composite that built a footer of buttons and
 * removed the footer left every button counted forever — detached and
 * collectable, but permanently on the books. §23.5's gate is that count, so
 * the effect was not a leak but something worse: a leak detector drifting away
 * from the truth, one composite at a time.
 */
export function remove(node) {
  if (!node) return;
  if (node.parentNode) node.parentNode.removeChild(node);
  release(node);
  // `querySelectorAll` only exists on elements; a text node has no subtree.
  if (!node.querySelectorAll) return;
  for (const descendant of node.querySelectorAll("*")) release(descendant);
}

function release(node) {
  if (!node[LIVE]) return;
  node[LIVE] = false;
  counters.elements--;
}

export function insert(parent, node, before) {
  if (before && before.parentNode === parent) parent.insertBefore(node, before);
  else parent.appendChild(node);
}

// ── Listeners and observers ──────────────────────────────────────────────

/** Attach a DOM listener. Returns a disposer; the count feeds the leak test. */
export function listen(target, type, handler, options) {
  if (!target || !target.addEventListener) return () => {};
  target.addEventListener(type, handler, options);
  counters.listeners++;
  let live = true;
  return function unlisten() {
    if (!live) return;
    live = false;
    target.removeEventListener(type, handler, options);
    counters.listeners--;
  };
}

export function observeResize(target, callback, options) {
  if (!hasDOM || typeof ResizeObserver === "undefined") return () => {};
  const observer = new ResizeObserver(callback);
  observer.observe(target, options);
  counters.observers++;
  let live = true;
  return function unobserve() {
    if (!live) return;
    live = false;
    observer.disconnect();
    counters.observers--;
  };
}

export function observeIntersection(target, callback, options) {
  if (!hasDOM || typeof IntersectionObserver === "undefined") return () => {};
  const observer = new IntersectionObserver(callback, options);
  observer.observe(target);
  counters.observers++;
  let live = true;
  return function unobserve() {
    if (!live) return;
    live = false;
    observer.disconnect();
    counters.observers--;
  };
}

export function observeMutations(target, callback, options) {
  if (!hasDOM || typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(target, options);
  counters.observers++;
  let live = true;
  return function unobserve() {
    if (!live) return;
    live = false;
    observer.disconnect();
    counters.observers--;
  };
}

export function timer(fn, ms) {
  // `live` is cleared when the timer *fires*, not only when it is cancelled.
  // Almost every timer here is handed to `ctx.own()`, so a timer that ran to
  // completion was then cancelled at teardown and decremented a second time —
  // pushing `counters.timers` below its baseline and making the next thing
  // measured look like it had leaked. A leak detector that reports the wrong
  // subject is worse than one that reports nothing (§23.5).
  let live = true;
  const id = setTimeout(() => {
    live = false;
    counters.timers--;
    fn();
  }, ms);
  counters.timers++;
  return function cancel() {
    if (!live) return;
    live = false;
    counters.timers--;
    clearTimeout(id);
  };
}

// ── The frame clock ──────────────────────────────────────────────────────
// Indirected so tests can install a deterministic fake (§23.1) without any
// module above this one knowing.

/**
 * A hidden document delivers no animation frames at all — not late ones, none
 * — so a frame armed just before the tab was backgrounded is never run, and
 * anything awaiting it waits forever. `await mk.flush()` in a tab the user
 * switched away from is the case that bites: the work is finished, the promise
 * is not.
 *
 * The fallback is a timer, which browsers keep running (throttled to about a
 * second) while hidden. That is the right trade in both directions: pending
 * work still completes, and nothing animates at frame rate in a tab nobody is
 * looking at — the loop unschedules when idle either way (§6.3).
 */
function frameRequest(fn) {
  if (hidden()) return { timer: setTimeout(() => fn(now()), 16) };
  return window.requestAnimationFrame(fn);
}

function frameCancel(handle) {
  if (handle && handle.timer !== undefined) clearTimeout(handle.timer);
  else window.cancelAnimationFrame(handle);
}

function hidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

let clock = {
  raf: hasDOM ? frameRequest : (fn) => setTimeout(() => fn(now()), 16),
  caf: hasDOM ? frameCancel : (id) => clearTimeout(id),
  now: () =>
    typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()
};

export function setClock(next) {
  const previous = clock;
  clock = next || previous;
  return () => {
    clock = previous;
  };
}

export function raf(fn) {
  return clock.raf(fn);
}

export function caf(id) {
  return clock.caf(id);
}

export function now() {
  return clock.now();
}

/** Subscribe to the document's visibility. Returns a disposer. */
export function onVisibilityChange(fn) {
  if (!hasDOM) return () => {};
  return listen(document, "visibilitychange", fn);
}

// ── Reads (READ phase only — §6.4) ───────────────────────────────────────

export function rectOf(node) {
  const r = node.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/**
 * The offset box — position within the offset parent, and border-box size.
 *
 * Cheaper than `getBoundingClientRect` and, unlike it, already relative to the
 * containing block, which is the space a node's `computed` rect is expressed
 * in. Used to record boxes CSS decided and the engine did not (§7.6).
 */
export function offsetBox(node) {
  return { x: node.offsetLeft, y: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight };
}

export function computedStyle(node) {
  return window.getComputedStyle(node);
}

export function readCustomProperty(node, name) {
  return window.getComputedStyle(node).getPropertyValue(name).trim();
}

export function media(query) {
  if (!hasDOM || !window.matchMedia) return { matches: false, addListener: () => () => {} };
  const list = window.matchMedia(query);
  return {
    get matches() {
      return list.matches;
    },
    addListener(fn) {
      return listen(list, "change", fn);
    }
  };
}

/** Device pixel ratio. Plugins that need device pixels read it from here. */
export function devicePixelRatio() {
  return hasDOM ? window.devicePixelRatio || 1 : 1;
}

/**
 * The gap between the layout and visual viewports — the only honest signal a
 * virtual keyboard gives the page. There is no API for it.
 */
export function viewportGap(visual) {
  if (!hasDOM || !window.visualViewport) return 0;
  return window.innerHeight - (visual.h + visual.offsetY);
}

export function viewport() {
  if (!hasDOM) return { w: 0, h: 0, offsetX: 0, offsetY: 0, scale: 1 };
  const vv = window.visualViewport;
  return {
    w: vv ? vv.width : window.innerWidth,
    h: vv ? vv.height : window.innerHeight,
    offsetX: vv ? vv.offsetLeft : 0,
    offsetY: vv ? vv.offsetTop : 0,
    scale: vv ? vv.scale : 1
  };
}

/**
 * Scrollbar width, measured once with a throwaway element. Percentages would
 * otherwise overflow the scrollport on platforms with classic scrollbars
 * (§5.11 rule 4).
 */
let scrollbarWidth = null;
export function measureScrollbar() {
  if (scrollbarWidth !== null) return scrollbarWidth;
  if (!hasDOM) return (scrollbarWidth = 0);
  const outer = document.createElement("div");
  outer.style.cssText =
    "position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;visibility:hidden";
  document.body.appendChild(outer);
  scrollbarWidth = outer.offsetWidth - outer.clientWidth;
  document.body.removeChild(outer);
  return scrollbarWidth;
}

export function documentRoot() {
  requireDOM("document access");
  return document.documentElement;
}

export function body() {
  requireDOM("document access");
  return document.body;
}

export function resolveTarget(target) {
  if (!target) return null;
  if (typeof target === "string") {
    requireDOM("selector lookup");
    return document.querySelector(target);
  }
  return target;
}

export function activeElement() {
  return hasDOM ? document.activeElement : null;
}

export function contains(ancestor, node) {
  return !!ancestor && !!node && ancestor.contains(node);
}

// ── Feature detection (§25.3 — never user-agent sniffing) ────────────────

let features = null;
export function detectFeatures() {
  if (features) return features;
  const supports = (property, value) =>
    hasDOM && window.CSS && CSS.supports ? CSS.supports(property, value) : false;
  features = {
    dom: hasDOM,
    anchorPositioning: supports("anchor-name", "--x"),
    popover: hasDOM && "popover" in HTMLElement.prototype,
    dialog: hasDOM && typeof HTMLDialogElement !== "undefined",
    inert: hasDOM && "inert" in HTMLElement.prototype,
    constructableSheets:
      hasDOM && typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype,
    resizeObserver: hasDOM && typeof ResizeObserver !== "undefined",
    containerQueries: supports("container-type", "inline-size"),
    cascadeLayers: hasDOM && typeof CSSLayerBlockRule !== "undefined",
    has: supports("selector(:has(*))", "") || safeSelector(":has(*)"),
    viewTransitions: hasDOM && typeof document.startViewTransition === "function",
    webAnimations: hasDOM && typeof Element !== "undefined" && "animate" in Element.prototype,
    dvh: supports("height", "100dvh")
  };
  return features;
}

function safeSelector(selector) {
  if (!hasDOM) return false;
  try {
    document.querySelector(selector);
    return true;
  } catch (error) {
    return false;
  }
}

// ── Style injection (§12.2) ──────────────────────────────────────────────

/**
 * Inject a stylesheet into `root` (a Document or ShadowRoot). Prefers a
 * constructable sheet — no nonce needed, which matters under CSP — and falls
 * back to a `<style>` element that accepts one.
 */
export function injectStyle(css, options) {
  requireDOM("style injection");
  const opts = options || {};
  const root = opts.root || document;
  const target = root.adoptedStyleSheets !== undefined ? root : document;
  const f = detectFeatures();

  // `first` forces the `<style>` path, at the top of `<head>`.
  //
  // Adopted stylesheets sort *after* every document stylesheet in the author
  // origin, so a layer order declared only in an adopted sheet is established
  // after an author's own `<style>` has already been parsed — and their
  // `@layer mutakit.user { … }` block therefore opens a layer in an earlier
  // position than the one it names, losing to the library's element rules.
  // That breaks §12.1's whole promise, which is that restyling never needs
  // `!important`. Declaring the order in the document, before anything else,
  // is what makes the name mean what it says.
  if (!opts.first && f.constructableSheets && target.adoptedStyleSheets !== undefined) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
    counters.sheets++;
    return function removeSheet() {
      target.adoptedStyleSheets = target.adoptedStyleSheets.filter((s) => s !== sheet);
      counters.sheets--;
    };
  }

  const style = document.createElement("style");
  if (opts.nonce) style.setAttribute("nonce", opts.nonce);
  style.textContent = css;
  const parent = root.head || root;
  if (opts.first) parent.insertBefore(style, parent.firstChild);
  else parent.appendChild(style);
  counters.sheets++;
  return function removeSheet() {
    if (style.parentNode) style.parentNode.removeChild(style);
    counters.sheets--;
  };
}

/** Development-only assertion that DEV-build listener counts stay sane. */
export function assertNoLeaks(baseline, subject) {
  if (!__MK_DEV__) return true;
  const leaked = [];
  for (const key of Object.keys(baseline)) {
    if (counters[key] > baseline[key]) leaked.push(`${key}: ${baseline[key]} → ${counters[key]}`);
  }
  if (leaked.length) {
    warn("MK5001", __MK_DEV__ &&
      `resources not released: ${leaked.join(", ")}`, { subject });
    return false;
  }
  return true;
}
