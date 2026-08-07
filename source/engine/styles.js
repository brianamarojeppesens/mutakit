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

    /**
     * Where stylesheets go — §10.15's extension point, resolved narrowly.
     *
     * D7 asked whether the *per-node* output could be swapped for atomic
     * classes. It cannot, and that is now decided rather than open: §12.4
     * publishes `--mk-x/y/w/h` as stable API, §8.8's adoption contract
     * promises an adopted node gets those properties and nothing else, and P1
     * has CSS consume the engine's numbers through `width: var(--mk-w)`.
     * Emitting classes instead would break all three and move resolution back
     * into JavaScript, which is the architecture inverted.
     *
     * What genuinely varies is *delivery*: a constructable sheet, a `<style>`
     * with a nonce, another document (§10.14), or no DOM at all — collecting
     * CSS text for server rendering, static extraction, or a test. A sink is
     * `(css, options) => dispose`.
     */
    this.sink = (mk.options && mk.options.styles) || dom.injectStyle;
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
    if (!this.written.some((entry) => entry.key === key)) {
      this.written.push({ css, key, options: options || {} });
    }
    // A sink that is not the DOM still wants the CSS — that is the whole point
    // of §10.15 — so the browser check belongs to the default sink, not here.
    if (this.sink !== dom.injectStyle) {
      const remove = this.sink(css, { key, nonce: this.mk.options.nonce, ...(options || {}) });
      if (typeof remove === "function") this.disposers.push(remove);
      return;
    }
    if (!dom.isBrowser()) return;
    for (const document of this.documents()) this._write(css, key, options, document);
  }

  _write(css, key, options, document) {
    let seen = this.injected.get(document);
    if (!seen) this.injected.set(document, (seen = new Set()));
    if (seen.has(key)) return;
    seen.add(key);
    const remove = this.sink(css, {
      key,
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

/**
 * A sink that keeps the CSS instead of injecting it — §10.15's built-in.
 *
 * The case §10.15 is actually for: rendering where there is no document, or
 * where the stylesheet has to be emitted rather than installed. Server-side
 * rendering and static extraction want the text; a test wants to assert on it
 * without reading `document.adoptedStyleSheets`.
 *
 *     const styles = collectStyles();
 *     const mk = Mutakit.create({ styles: styles.sink });
 *     …
 *     styles.text()   // every rule this instance produced, in order
 */
export function collectStyles() {
  const chunks = [];
  return {
    sink(css, options) {
      const key = (options && options.key) || `adhoc:${chunks.length}`;
      if (chunks.some((chunk) => chunk.key === key)) return () => {};
      chunks.push({ key, css });
      return () => {
        const index = chunks.findIndex((chunk) => chunk.key === key);
        if (index !== -1) chunks.splice(index, 1);
      };
    },
    /** Every rule produced, in the order the cascade layers expect. */
    text() {
      return chunks.map((chunk) => chunk.css).join("\n");
    },
    keys() {
      return chunks.map((chunk) => chunk.key);
    }
  };
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
