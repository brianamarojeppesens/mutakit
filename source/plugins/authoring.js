/**
 * The authoring plugins (§18.3, §18.4) and the framework adapters (§10.14).
 *
 * All three ship as plugins, never as core, because each is a *translation*
 * into the tier-2 declarative form (§18.2) and has no capabilities of its own.
 * That is the property worth protecting: if the DSL could express something
 * the object form cannot, the object form would have stopped being canonical
 * and §19's persistence story would quietly break.
 */
import "../core/dev.js";
import * as dom from "../core/dom.js";
import { fail, warn } from "../core/diagnostics.js";

/**
 * Tier 3 — the terse DSL (§18.3).
 *
 * ```
 * split x gutter:6 {
 *   pane #sidebar 240px min:160 max:35%
 *   pane #main 1fr
 * }
 * ```
 *
 * Compiles to tier 2 and nothing else. **No `eval`, no `new Function`** — it
 * builds data structures, which is what lets it work under a strict CSP
 * (§21.4).
 */
export function compileDSL(source) {
  const tokens = tokenize(String(source));
  const nodes = parseBlock(tokens, { index: 0 }, source);
  return nodes.length === 1 ? nodes[0] : nodes;
}

function tokenize(text) {
  const out = [];
  const pattern = /\s*(?:(\{)|(\})|(#[\w-]+)|(\.[\w-]+)|([\w-]+:[^\s{}]+)|("(?:[^"\\]|\\.)*")|([^\s{}]+))/g;
  let match;
  let line = 1;
  let consumed = 0;
  while ((match = pattern.exec(text))) {
    // The pattern begins with `\s*`, so `match.index` is the start of the
    // *whitespace*, not of the token. Counting to there attributes a token to
    // the line before its own — which makes every reported line number off by
    // one for exactly the tokens an error is most likely to name.
    const start = match.index + Math.max(0, match[0].search(/\S/));
    line += (text.slice(consumed, start).match(/\n/g) || []).length;
    consumed = start;
    const [, open, close, id, className, pair, quoted, word] = match;
    if (open) out.push({ kind: "{", line });
    else if (close) out.push({ kind: "}", line });
    else if (id) out.push({ kind: "id", value: id.slice(1), line });
    else if (className) out.push({ kind: "class", value: className.slice(1), line });
    else if (pair) {
      const at = pair.indexOf(":");
      out.push({ kind: "pair", key: pair.slice(0, at), value: pair.slice(at + 1), line });
    } else if (quoted) out.push({ kind: "text", value: JSON.parse(quoted), line });
    else out.push({ kind: "word", value: word, line });
  }
  return out;
}

function parseBlock(tokens, cursor, source) {
  const out = [];
  while (cursor.index < tokens.length) {
    const token = tokens[cursor.index];
    if (token.kind === "}") break;
    out.push(parseNode(tokens, cursor, source));
  }
  return out;
}

function parseNode(tokens, cursor, source) {
  const first = tokens[cursor.index++];
  if (first.kind !== "word" || /^[\d.]/.test(first.value)) {
    // A source-mapped error pointing at the offending token, which is the
    // whole reason the DSL carries line numbers.
    return fail("MK3002", __MK_DEV__ &&
      `line ${first.line}: expected an element type, found ${describeToken(first)}`,
      { subject: `dsl:${first.line}` }
    );
  }

  const spec = { type: first.value };
  for (;;) {
    const token = tokens[cursor.index];
    if (!token || token.kind === "}" ) break;
    if (token.kind === "{") {
      cursor.index++;
      spec.children = parseBlock(tokens, cursor, source);
      const closing = tokens[cursor.index++];
      if (!closing || closing.kind !== "}") {
        return fail("MK3002", __MK_DEV__ && `line ${first.line}: unclosed block`, {
          subject: `dsl:${first.line}`
        });
      }
      break;
    }
    if (token.kind === "id") {
      spec.id = token.value;
      cursor.index++;
    } else if (token.kind === "class") {
      spec.class = spec.class ? `${spec.class} ${token.value}` : token.value;
      cursor.index++;
    } else if (token.kind === "pair") {
      assign(spec, token.key, coerce(token.value));
      cursor.index++;
    } else if (token.kind === "text") {
      spec.content = token.value;
      cursor.index++;
    } else if (token.kind === "word") {
      // A bare word is either an axis (`x`, `y`) or a size (`240px`, `1fr`).
      if (token.value === "x" || token.value === "y") spec.axis = token.value;
      else if (/^[\d.]/.test(token.value)) assign(spec, "size", coerce(token.value));
      else spec[token.value] = true;
      cursor.index++;
    } else break;
    if (tokens[cursor.index] && tokens[cursor.index].kind === "word" &&
        !/^[\d.]/.test(tokens[cursor.index].value) &&
        tokens[cursor.index].value !== "x" && tokens[cursor.index].value !== "y") {
      // The next bare word starts a sibling element.
      break;
    }
  }
  return spec;
}

function describeToken(token) {
  return token.kind === "word" ? `'${token.value}'` : `'${token.kind}'`;
}

function assign(spec, key, value) {
  if (key === "size" || key === "min" || key === "max") {
    if (key === "size") spec.size = value;
    else spec[key] = value;
    spec.layout = { ...(spec.layout || {}), [key]: value };
    return;
  }
  spec[key] = value;
}

function coerce(text) {
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

export const dslPlugin = {
  name: "mutakit-dsl",
  version: "1.0.0",
  // `^0.4.0` would exclude 0.5 and later: under SemVer every 0.x minor is a
  // breaking change, and these plugins track the library rather than a line of it.
  requires: { mutakit: ">=0.4.0 <2" },
  install(mk) {
    /** `mk.dsl\`…\`` — a tagged template that compiles to tier 2. */
    mk.dsl = (strings, ...values) => {
      const source = strings.reduce(
        (out, part, i) => out + part + (i < values.length ? String(values[i]) : ""),
        ""
      );
      return compileDSL(source);
    };
    mk.build.dsl = (strings, ...values) => mk.build(mk.dsl(strings, ...values));
    return {
      uninstall() {
        delete mk.dsl;
      }
    };
  }
};

/**
 * Tier 3b — declarative HTML (§18.4).
 *
 * ```html
 * <mk-split axis="x" gutter="6">
 *   <mk-pane id="sidebar" size="240" min="160"></mk-pane>
 * </mk-split>
 * ```
 *
 * Custom elements that upgrade in place and hand off to the same core.
 * Attribute parsing maps to the tier-2 schema mechanically — there is no
 * second vocabulary to learn or to keep in step.
 */
export const customElementsPlugin = {
  name: "mutakit-elements",
  version: "1.0.0",
  // `^0.4.0` would exclude 0.5 and later: under SemVer every 0.x minor is a
  // breaking change, and these plugins track the library rather than a line of it.
  requires: { mutakit: ">=0.4.0 <2" },

  install(mk, options) {
    if (!dom.isBrowser() || typeof customElements === "undefined") return {};
    const opts = options || {};
    const prefix = opts.prefix || "mk";
    const defined = [];

    for (const entry of mk.registry.list().type) {
      const tag = `${prefix}-${entry.name.replace(":", "-")}`;
      if (customElements.get(tag)) continue;
      customElements.define(tag, makeCustomElement(mk, entry.name));
      defined.push(tag);
    }

    return {
      uninstall() {
        // Custom element definitions cannot be withdrawn; saying so is better
        // than implying otherwise.
        warn("MK4014", __MK_DEV__ &&
          `${defined.length} custom element definitions cannot be removed; the registry is ` +
            `append-only by specification. Reload to clear them.`,
          { subject: "mutakit-elements" }
        );
      }
    };
  }
};

function makeCustomElement(mk, type) {
  return class extends HTMLElement {
    connectedCallback() {
      if (this.__mkHandle) return;
      const props = {};
      for (const attribute of this.attributes) {
        props[camel(attribute.name)] = coerce(attribute.value === "" ? "true" : attribute.value);
      }
      // Adopted rather than replaced: the custom element *is* the box, so the
      // author's markup and their CSS keep working (§8.8).
      this.__mkHandle = mk.create(type, { ...props, adopt: this });
    }

    disconnectedCallback() {
      if (this.__mkHandle) mk.destroy(this.__mkHandle.node);
      this.__mkHandle = null;
    }

    attributeChangedCallback(name, previous, next) {
      if (this.__mkHandle) this.__mkHandle.set({ [camel(name)]: coerce(next) });
    }
  };
}

function camel(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Framework adapters (§8.8, §10.14).
 *
 * The adoption contract is what makes these a few dozen lines each: the
 * framework asks Mutakit for a container node, renders into it, and owns it
 * completely; Mutakit only sizes and positions it. There is no reconciliation,
 * no double ownership, and no adapter-specific code anywhere in core.
 */
export const adaptersPlugin = {
  name: "mutakit-adapters",
  version: "1.0.0",
  // `^0.4.0` would exclude 0.5 and later: under SemVer every 0.x minor is a
  // breaking change, and these plugins track the library rather than a line of it.
  requires: { mutakit: ">=0.4.0 <2" },

  install(mk) {
    /**
     * Give me a positioned box; I will render into it.
     *
     * Returns `{ el, handle, destroy }`. Whatever the caller puts in `el` is
     * theirs — Mutakit writes only the §12.4 custom properties, the properties
     * they feed, and `data-mk-*`.
     */
    mk.portal = (props, parent) => {
      const handle = mk.create("pane", { ...props }, parent);
      return {
        el: handle.node.contentEl || handle.el,
        handle,
        destroy: () => mk.destroy(handle.node)
      };
    };

    /** React: `useMutakitPortal(props)` is four lines on top of this. */
    mk.adapters = {
      react: (React) => (props) => {
        const ref = React.useRef(null);
        const portal = React.useRef(null);
        React.useEffect(() => {
          portal.current = mk.portal(props);
          if (ref.current) portal.current.el.appendChild(ref.current);
          return () => portal.current.destroy();
        }, []);
        return ref;
      },

      /** Vue: a directive that adopts the element it is bound to. */
      vue: {
        mounted(el, binding) {
          el.__mk = mk.adopt(el, binding.value || {});
        },
        updated(el, binding) {
          if (el.__mk) el.__mk.constrain(binding.value || {});
        },
        unmounted(el) {
          if (el.__mk) mk.destroy(el.__mk.node);
        }
      },

      /** Svelte: the action shape, which is the same idea again. */
      svelte: (el, params) => {
        const handle = mk.adopt(el, params || {});
        return {
          update: (next) => handle.constrain(next || {}),
          destroy: () => mk.destroy(handle.node)
        };
      }
    };

    return {
      uninstall() {
        delete mk.portal;
        delete mk.adapters;
      }
    };
  }
};
