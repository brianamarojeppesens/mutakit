/**
 * Style injection and cascade layers (§12.1, §12.2).
 *
 * Element styles are registered into `mutakit.element` automatically, so
 * plugin CSS cannot accidentally outrank a theme, and `mutakit.user` is last
 * so an author never needs `!important` to restyle anything.
 *
 * Injection is lazy: a type's styles are added the first time an instance of
 * it is created, which keeps a preset's real cost proportional to what a page
 * actually uses.
 */
import * as dom from "../core/dom.js";
import { LAYER_ORDER, BASE_CSS, RESET_CSS, TOKENS_CSS } from "../styles/index.js";

export class StyleManager {
  constructor(mk) {
    this.mk = mk;
    /** What has been written, per document — see `into` (§10.14). */
    this.injected = new Map();
    this.disposers = [];
    /** Every CSS this instance has produced, replayed into a new document. */
    this.written = [];
  }

  /**
   * The documents this instance renders into.
   *
   * §10.14's render targets are a supported destination, not a special case:
   * a root mounted into an iframe or a popup window renders there already,
   * because appending an element into another document adopts it. What did
   * *not* follow was the stylesheet — it went to the host document, so the
   * subtree in the frame had no base CSS at all and every node laid itself
   * out at the browser's defaults instead of the engine's.
   */
  documents() {
    const out = new Set();
    for (const root of this.mk.roots) {
      if (root.el && root.el.ownerDocument) out.add(root.el.ownerDocument);
    }
    if (!out.size && dom.isBrowser()) out.add(dom.documentRoot());
    return out;
  }

  /** Whether this instance has produced the CSS registered under `key`. */
  has(key) {
    return this.written.some((entry) => entry.key === key);
  }

  /** How many times `key` was written — one per document, never per node. */
  writes(key) {
    let count = 0;
    for (const seen of this.injected.values()) if (seen.has(key)) count++;
    return count;
  }

  /** Give a newly mounted root every sheet this instance has written. */
  ensureDocument() {
    this.ensureBase();
    for (const document of this.documents()) {
      for (const entry of this.written) this._write(entry.css, entry.key, entry.options, document);
    }
  }

  /** The cascade-layer declaration plus reset, tokens, and base rules. */
  ensureBase() {
    if (!dom.isBrowser()) return;
    // In the document, ahead of any author sheet — see `injectStyle`. The
    // layers themselves stay constructable; only the one-line order statement
    // needs to be somewhere an author's own stylesheet will see it first.
    this._inject(LAYER_ORDER, "layers", { first: true });
    this._inject(wrap("mutakit.reset", scope(RESET_CSS, this.mk.prefix)), "reset");
    this._inject(wrap("mutakit.tokens", scope(TOKENS_CSS, this.mk.prefix)), "tokens");
    this._inject(wrap("mutakit.base", scope(BASE_CSS, this.mk.prefix)), "base");
  }

  /** Inject one element type's styles, once per instance. */
  ensureType(definition) {
    if (!definition || !definition.styles || !definition.styles.length) return;
    const key = `type:${definition.type}`;
    this.ensureBase();
    const css = definition.styles.join("\n");
    this._inject(wrap("mutakit.element", scope(css, this.mk.prefix)), key);
    if (definition.tokens) {
      const tokens = Object.keys(definition.tokens)
        .map((name) => `  ${name}: ${definition.tokens[name]};`)
        .join("\n");
      this._inject(wrap("mutakit.tokens", `:where([data-mk-root]) {\n${tokens}\n}`), key + ":tokens");
    }
  }

  /** Inject an algorithm's container rules into `mutakit.layout`. */
  ensureLayout(algorithm) {
    if (!algorithm || !algorithm.styles) return;
    const key = `layout:${algorithm.name}`;
    this.ensureBase();
    this._inject(wrap("mutakit.layout", scope(algorithm.styles, this.mk.prefix)), key);
  }

  /** Inject arbitrary CSS into a named layer. Used by themes and traits. */
  add(css, layer, key) {
    // De-duplication is `_inject`'s, keyed by document rather than by
    // instance, so the same CSS reaches a second document exactly once.
    const id = key || `adhoc:${this.written.length}`;
    this.ensureBase();
    this._inject(wrap(layer || "mutakit.element", scope(css, this.mk.prefix)), id);
  }

  /**
   * Write `css` into every document this instance renders into, once each.
   *
   * Recorded as well as written, so a root mounted later — into a popup, say —
   * receives everything already produced rather than only what happens to be
   * defined after it arrives.
   */
  _inject(css, key, options) {
    if (!dom.isBrowser()) return;
    if (!this.written.some((entry) => entry.key === key)) {
      this.written.push({ css, key, options: options || {} });
    }
    for (const document of this.documents()) this._write(css, key, options, document);
  }

  _write(css, key, options, document) {
    let seen = this.injected.get(document);
    if (!seen) this.injected.set(document, (seen = new Set()));
    if (seen.has(key)) return;
    seen.add(key);
    const remove = dom.injectStyle(css, {
      nonce: this.mk.options.nonce,
      ...(options || {}),
      root: document
    });
    this.disposers.push(remove);
    return remove;
  }

  destroy() {
    for (const remove of this.disposers) remove();
    this.disposers.length = 0;
    this.injected.clear();
    this.written.length = 0;
  }
}

function wrap(layer, css) {
  return `@layer ${layer} {\n${css}\n}`;
}

/**
 * Rewrite the `mk-` prefix so two instances on one page cannot collide in CSS
 * either (§8.6). Only whole class tokens are rewritten, never arbitrary text.
 */
function scope(css, prefix) {
  if (!prefix || prefix === "mk") return css;
  return css.replace(/\.mk-/g, `.${prefix}-`).replace(/--mk-/g, `--${prefix}-`);
}
