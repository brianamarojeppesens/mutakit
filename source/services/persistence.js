/**
 * Persistence, serialization, and migrations (§19.1, §19.2).
 *
 * A standard plugin, not core (§4.2): a HUD or a single modal never needs it,
 * and the whole point of the preset split is that they should not pay for it.
 * It augments the instance with `serialize`, `restore`, and `persist`, which
 * is the same mechanism any third-party plugin has available (P3).
 *
 * Two rules make this subsystem worth its size. **Missing plugins must never
 * brick a saved layout** — every category of unknown reference has a defined
 * fallback rather than a thrown error. And **restore is default-strict**,
 * because `restore()` instantiates types and sets props that reach DOM sinks,
 * which makes untrusted layout JSON roughly as dangerous as untrusted code
 * (§21.4).
 */
import "../core/dev.js";
import { SCHEMA_VERSION } from "../core/env.js";
import * as dom from "../core/dom.js";
import { warn } from "../core/diagnostics.js";
import { parse, toNumber } from "../geometry/len.js";

export const persistencePlugin = {
  name: "mutakit-persistence",
  version: "1.0.0",
  install(mk) {
    const service = new Persistence(mk);
    mk.provide("persistence", service);
    mk.serialize = (scope, options) => service.serialize(scope, options);
    mk.restore = (doc, options) => service.restore(doc, options);
    mk.persist = (key, options) => service.persist(key, options);
    return {
      uninstall() {
        delete mk.serialize;
        delete mk.restore;
        delete mk.persist;
      }
    };
  }
};

export class Persistence {
  constructor(mk) {
    this.mk = mk;
  }

  /** Walk the tree and emit the tier-2 form, stable-ordered so it diffs well. */
  serialize(scope, options) {
    const mk = this.mk;
    const opts = options || {};
    const target = resolve(mk, scope) || mk.root;
    if (!target) return null;
    return {
      schema: SCHEMA_VERSION,
      mutakit: mk.version,
      tree:
        target === mk.root
          ? target.children.map((child) => this._node(child, opts))
          : this._node(target, opts)
    };
  }

  _node(node, opts) {
    // A placeholder round-trips losslessly, so opening and saving a workspace
    // on a machine without a plugin does not destroy that plugin's state for
    // everyone else (§19.1).
    if (node.placeholderFor) return node.placeholderFor;

    const out = { type: node.type };
    if (node.id) out.id = node.id;

    const schema = node.definition ? node.definition.props : {};
    for (const name of Object.keys(node.props).sort()) {
      const descriptor = schema[name];
      const value = node.props[name];
      if (typeof value === "function") continue;
      if (descriptor && descriptor.persist === false) continue;
      if (descriptor && descriptor.default === value) continue;
      out[name] = value;
    }

    for (const key of Object.keys(node.geometry).sort()) {
      const value = node.geometry[key];
      if (typeof value === "function") continue;
      out[key] = this._len(node, key, value);
    }
    if (Object.keys(node.layoutProps).length) out.layout = { ...node.layoutProps };
    if (node.algorithm && node.algorithm !== "anchor") {
      out.algorithm = node.algorithm;
      if (node.algorithmOptions) out.algorithmOptions = { ...node.algorithmOptions };
    }
    if (node.traits.size) out.traits = [...node.traits.keys()];

    for (const hook of node.definition ? node.definition.hooks.serialize : []) {
      const extra = this.mk.guard(node, "serialize", hook, [this.mk.contextFor(node)]);
      if (extra) Object.assign(out, extra);
    }

    if (node.children.length) out.children = node.children.map((child) => this._node(child, opts));
    return out;
  }

  /**
   * Record the resolved pixel value alongside a custom-unit expression (§19.1).
   *
   * This is the subtler of the two missing-plugin cases: a dropped element type
   * fails visibly, whereas a dropped *unit* silently collapses an element to
   * zero. Recording the pixels keeps the layout geometrically correct without
   * the plugin, and it snaps back to the live expression when it returns.
   */
  _len(node, key, value) {
    if (typeof value !== "string") return value;
    const ast = parse(value);
    if (!ast || ast.k !== "unit") return value;
    if (!this.mk.registry.get("unit", ast.u)) return value;
    const axis = key === "height" || key === "top" || key === "bottom" ? "y" : "x";
    const basis = node.parent ? (axis === "y" ? node.parent.frame.h : node.parent.frame.w) : 0;
    const px = toNumber(ast, this.mk.lenContext(basis, node));
    return { value, px: isFinite(px) ? px : undefined };
  }

  restore(doc, options) {
    const mk = this.mk;
    const opts = options || {};
    if (!doc) return null;
    if (opts.allow === undefined) {
      warn("MK4015", __MK_DEV__ &&
        "restore() was called with no `allow`. A layout from your own localStorage is " +
          "lower risk; one from a server or another user must pass " +
          "{ allow: { types: [...], props: 'schema' } }. Pass { allow: 'any' } to opt out.",
        { subject: "restore" }
      );
    }

    let saved = doc;
    if (saved.schema !== undefined && saved.schema !== SCHEMA_VERSION) {
      saved = this._migrate(saved);
    }

    const parent = resolve(mk, opts.into) || mk.root;
    const tree = saved.tree || saved;
    const specs = Array.isArray(tree) ? tree : [tree];
    const restored = [];
    for (const spec of specs) {
      const handle = this._restore(spec, parent, opts);
      if (handle) restored.push(handle);
    }
    // Restore before first paint applies during that frame's ARRANGE, so a
    // saved layout never renders at its defaults and then visibly snaps (§19.1).
    mk.invalidateNode(parent, "arrange");
    return restored;
  }

  _restore(spec, parent, opts) {
    const mk = this.mk;
    if (!spec || !spec.type) return null;

    const allow = opts.allow;
    if (allow && allow !== "any" && allow.types && allow.types.indexOf(spec.type) === -1) {
      warn("MK4015", __MK_DEV__ &&
        `restore rejected type '${spec.type}': not in \`allow.types\``, {
        subject: spec.type
      });
      return null;
    }

    const definition = mk.registry.get("type", spec.type);
    const { children, layout, algorithm, algorithmOptions, traits, ...props } = spec;

    if (!definition) {
      warn("MK4010", __MK_DEV__ &&
        `'${spec.type}' is not registered; a placeholder preserving its geometry and props ` +
          `is used instead. Install the plugin and restore again.`,
        { subject: spec.type }
      );
      const placeholder = mk.create("pane", { ...mk.geometryOnly(props), class: "mk-placeholder" }, parent);
      if (placeholder) placeholder.node.placeholderFor = spec;
      return placeholder;
    }

    const filtered =
      allow && allow !== "any" && allow.props === "schema"
        ? mk.filterToSchema(props, definition)
        : props;

    const handle = mk.create(spec.type, this._lens(filtered), parent);
    if (!handle) return null;
    const node = handle.node;

    if (layout) mk.setLayoutProps(node, layout);
    if (algorithm) {
      if (mk.registry.has("layout", algorithm)) {
        node.algorithm = algorithm;
        node.algorithmOptions = algorithmOptions || {};
      } else {
        warn("MK4012", __MK_DEV__ &&
          `layout algorithm '${algorithm}' is not registered; falling back to 'stack'`, {
          subject: algorithm
        });
        node.algorithm = "stack";
      }
    }
    for (const name of traits || []) {
      if (mk.registry.has("trait", name)) mk.attachTrait(node, name);
      else warn("MK4011", __MK_DEV__ &&
        `trait '${name}' is not registered; the element renders without it`, { subject: name });
    }
    for (const child of children || []) this._restore(child, node, opts);
    return handle;
  }

  /** `{ value: '12u', px: 528 }` → the expression, or the pixels if it is gone. */
  _lens(props) {
    const out = {};
    for (const key of Object.keys(props)) {
      const value = props[key];
      if (!(value && typeof value === "object" && typeof value.value === "string" && "px" in value)) {
        out[key] = value;
        continue;
      }
      const ast = parse(value.value);
      if (ast && ast.k === "unit" && !this.mk.registry.get("unit", ast.u)) {
        warn("MK4013", __MK_DEV__ &&
          `unit '${ast.u}' is not registered; using the recorded ${value.px}px so the layout ` +
            `stays geometrically correct`,
          { subject: ast.u }
        );
        out[key] = value.px;
      } else {
        out[key] = value.value;
      }
    }
    return out;
  }

  _migrate(doc) {
    let current = doc;
    let guard = 0;
    while (current.schema !== SCHEMA_VERSION && guard++ < 32) {
      const migration = this.mk.registry.get("serializer", `${current.schema}->${current.schema + 1}`);
      if (!migration) {
        warn("MK4015", __MK_DEV__ &&
          `no migration from schema ${current.schema} to ${current.schema + 1}; the document ` +
            `is restored as-is`,
          { subject: `schema:${current.schema}` }
        );
        return current;
      }
      current = migration.migrate(current) || current;
      current.schema = migration.to;
    }
    return current;
  }

  /**
   * Restore now, then save on a debounced timer whenever persistable state
   * changes. `storage` is any `{ getItem, setItem }`, so `sessionStorage`,
   * IndexedDB, and a server-backed store all work; a rejected async write
   * surfaces as a diagnostic rather than silently losing a layout.
   */
  persist(key, options) {
    const mk = this.mk;
    const opts = options || {};
    const storage = opts.storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!storage) {
      warn("MK4016", __MK_DEV__ &&
        "persist() found no storage; pass { storage }", { subject: key });
      return { save() {}, stop() {} };
    }

    let raw = null;
    try {
      raw = storage.getItem(key);
    } catch (error) {
      warn("MK4016", __MK_DEV__ &&
        `could not read '${key}': ${error.message}`, { subject: key });
    }
    if (raw) {
      try {
        this.restore(JSON.parse(raw), { allow: opts.allow, into: opts.into });
      } catch (error) {
        warn("MK4016", __MK_DEV__ &&
          `'${key}' did not parse as a layout: ${error.message}`, { subject: key });
      }
    }

    let pending = null;
    const save = () => {
      try {
        const result = storage.setItem(key, JSON.stringify(this.serialize(opts.into)));
        if (result && typeof result.catch === "function") {
          result.catch((error) =>
            warn("MK4016", __MK_DEV__ &&
              `could not write '${key}': ${error.message}`, { subject: key })
          );
        }
      } catch (error) {
        warn("MK4016", __MK_DEV__ &&
          `could not write '${key}': ${error.message}`, { subject: key });
      }
    };

    const stop = mk.scheduler.on("write", () => {
      if (!mk.persistDirty) return;
      mk.persistDirty = false;
      if (pending) pending();
      pending = dom.timer(() => {
        pending = null;
        save();
      }, opts.debounce == null ? 300 : opts.debounce);
    });

    return {
      save,
      stop() {
        stop();
        if (pending) pending();
      }
    };
  }
}

function resolve(mk, value) {
  if (!value) return null;
  return value.node || value;
}
