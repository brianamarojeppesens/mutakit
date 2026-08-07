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
    this.injected = new Set();
    this.disposers = [];
    this.baseDone = false;
  }

  /** The cascade-layer declaration plus reset, tokens, and base rules. */
  ensureBase() {
    if (this.baseDone || !dom.isBrowser()) return;
    this.baseDone = true;
    this._inject(LAYER_ORDER, "layers");
    this._inject(wrap("mutakit.reset", scope(RESET_CSS, this.mk.prefix)), "reset");
    this._inject(wrap("mutakit.tokens", scope(TOKENS_CSS, this.mk.prefix)), "tokens");
    this._inject(wrap("mutakit.base", scope(BASE_CSS, this.mk.prefix)), "base");
  }

  /** Inject one element type's styles, once per instance. */
  ensureType(definition) {
    if (!definition || !definition.styles || !definition.styles.length) return;
    const key = `type:${definition.type}`;
    if (this.injected.has(key)) return;
    this.injected.add(key);
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
    if (this.injected.has(key)) return;
    this.injected.add(key);
    this.ensureBase();
    this._inject(wrap("mutakit.layout", scope(algorithm.styles, this.mk.prefix)), key);
  }

  /** Inject arbitrary CSS into a named layer. Used by themes and traits. */
  add(css, layer, key) {
    const id = key || `adhoc:${this.injected.size}`;
    if (this.injected.has(id)) return;
    this.injected.add(id);
    this.ensureBase();
    this._inject(wrap(layer || "mutakit.element", scope(css, this.mk.prefix)), id);
  }

  _inject(css, key) {
    if (!dom.isBrowser()) return;
    const remove = dom.injectStyle(css, { nonce: this.mk.options.nonce });
    this.disposers.push(remove);
    return remove;
  }

  destroy() {
    for (const remove of this.disposers) remove();
    this.disposers.length = 0;
    this.injected.clear();
    this.baseDone = false;
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
