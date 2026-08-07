/**
 * The kernel (§8.4–§8.6, §8.10).
 *
 * Registration, plugin installation, identity, and error isolation — the parts
 * of an instance that need no geometry and no DOM. `engine/instance.js`
 * extends this with the node tree and the frame loop, which is what keeps the
 * layer map's downward-only rule (§4.1) true of the kernel itself.
 */
import "./dev.js";
import { VERSION } from "./env.js";
import { conformance, conformanceTrait } from "./conformance.js";
import { resolveDefinition } from "./define.js";
import { diagnosticError, fail, warn } from "./diagnostics.js";
import { emit } from "./events.js";
import { Registry } from "./registry.js";
import { defineValidator, hasValidator } from "./schema.js";
import { satisfies } from "./semver.js";

/** The registry every instance inherits from unless `inherit: false`. */
export const globalRegistry = new Registry(null);

let instanceSeq = 0;

export const DEFAULTS = {
  prefix: "mk",
  theme: null,
  inherit: true,
  errorPolicy: "isolate",
  sanitize: null,
  nonce: null,
  sizing: "element",
  shadow: false
};

export class Kernel {
  constructor(options) {
    this.options = { ...DEFAULTS, ...(options || {}) };
    this.id = `mk${++instanceSeq}`;
    this.version = VERSION;
    this.prefix = this.options.prefix;
    this.registry = new Registry(this.options.inherit === false ? null : globalRegistry);
    this.plugins = new Map();
    this.destroyed = false;
    this._resolved = new Map();
    this._instanceCounts = new Map();
    this._nodeSeq = 0;
  }

  // ── Extension points ───────────────────────────────────────────────────

  /** Register an element type (§8.1). Extension point §10.1. */
  define(definition, options) {
    const opts = options || {};
    const origin = opts.origin || this._installing || "core";

    if (origin !== "core" && definition.type && definition.type.indexOf(":") === -1) {
      return fail("MK4004", __MK_DEV__ &&
        `'${definition.type}' is a bare name; bare names are reserved for core. ` +
          `Namespace it as 'vendor:${definition.type}'.`,
        { subject: definition.type }
      );
    }

    let base = null;
    if (definition.extends) {
      base = this.registry.get("type", definition.extends);
      if (!base) {
        return fail("MK3001", __MK_DEV__ &&
          `'${definition.type}' extends '${definition.extends}', which is not registered. ` +
            `Register the base type first, or list it in \`requires\`.`,
          { subject: definition.type }
        );
      }
    }

    const resolved = resolveDefinition(definition, base, { origin });
    if (!resolved) return null;

    if (__MK_DEV__) {
      const findings = conformance(definition, resolved);
      for (const found of findings) {
        if (found.level === "error") fail(found.code, found.message, { subject: definition.type });
        else warn(found.code, found.message, { subject: definition.type });
      }
    }

    this.registry.set("type", resolved.type, resolved, opts);
    this._resolved.delete(resolved.type);
    return resolved;
  }

  /** Register a trait (§9). Extension point §10.2. */
  trait(trait, options) {
    if (!trait || !trait.name) return fail("MK3002", __MK_DEV__ &&
      "a trait needs a `name`");
    if (__MK_DEV__) {
      for (const found of conformanceTrait(trait)) {
        if (found.level === "error") fail(found.code, found.message, { subject: trait.name });
        else warn(found.code, found.message, { subject: trait.name });
      }
    }
    const record = { ...trait, origin: this._installing || trait.origin || "core" };
    return this.registry.set("trait", trait.name, record, options);
  }

  /** Register a layout algorithm (§7). Extension point §10.3. */
  layout(algorithm, options) {
    if (!algorithm || !algorithm.name) return fail("MK3002", __MK_DEV__ &&
      "a layout algorithm needs a `name`");
    if (!algorithm.arrange && !algorithm.css) {
      return fail("MK2001", __MK_DEV__ &&
        `layout '${algorithm.name}' declares neither \`arrange\` nor \`css\`; ` +
          `one of them has to place the children`,
        { subject: algorithm.name }
      );
    }
    const record = { ...algorithm, origin: this._installing || algorithm.origin || "core" };
    return this.registry.set("layout", algorithm.name, record, options);
  }

  /** Register a custom length unit (§5.2, §10.4). */
  unit(name, definition, options) {
    if (!name || !definition || typeof definition.toNumber !== "function") {
      return fail("MK1005", __MK_DEV__ &&
        `unit '${name}' needs a \`toNumber\``, { subject: name });
    }
    const record = { name, origin: this._installing || "core", ...definition };
    return this.registry.set("unit", name, record, options);
  }

  /**
   * Register a custom prop type — §10's eleventh extension point.
   *
   * `defineValidator` has always existed; what did not was a way to reach it
   * from the public surface, so the only route was importing a core module.
   * §10 calls itself the complete list and §1.5.3 asks that a third party
   * extend without touching `source/core/`, which an internal import is at
   * best the letter of.
   *
   * A validator returns `{ value }` to accept — coercing if it likes, which is
   * what makes `size` turn `8` into `{ w: 8, h: 8 }` — or `{ error }` to
   * reject with a message the author reads.
   */
  validator(name, check, options) {
    if (!name || typeof check !== "function") {
      return fail("MK3002", __MK_DEV__ &&
        `validator '${name}' needs a check function`, { subject: name });
    }
    const opts = options || {};
    if (hasValidator(name) && !opts.replace) {
      warn("MK4001", __MK_DEV__ &&
        `prop type '${name}' is already registered; pass { replace: true } to override it`,
        { subject: name }
      );
      return this;
    }
    defineValidator(name, check);
    return this;
  }

  /** Register an anchor keyword (§10.5). */
  anchor(name, resolve, options) {
    return this.registry.set("anchor", name, { name, resolve }, options);
  }

  /** Register a placement strategy for anchored positioning (§10.5). */
  placement(name, strategy, options) {
    // A function has no own enumerable properties, so `{ name, ...strategy }`
    // stored `{ name }` and dropped the strategy on the floor — the record
    // registered fine and did nothing, which is why §10.5's collision half
    // could look wired from the registry and never run.
    const record = typeof strategy === "function" ? { name, strategy } : { name, ...strategy };
    return this.registry.set("placement", name, record, options);
  }

  /** Register a theme (§12, §10.6). */
  theme(name, definition, options) {
    return this.registry.set("theme", name, { name, ...definition }, options);
  }

  /** Register a motion preset (§17, §10.7). */
  motion(name, preset, options) {
    return this.registry.set("motion", name, { name, ...preset }, options);
  }

  /** Register an input source (§13.5, §10.8). */
  input(name, source, options) {
    return this.registry.set("input", name, { name, ...source }, options);
  }

  /** Register a gesture recognizer (§13.3, §10.9). */
  gesture(name, recognizer, options) {
    return this.registry.set("gesture", name, { name, ...recognizer }, options);
  }

  /** Register a serialization migration (§19.2, §10.10). */
  serializer(migration, options) {
    const name = `${migration.from}->${migration.to}`;
    return this.registry.set("serializer", name, { name, ...migration }, options);
  }

  /** Register a devtools panel (§19.3, §10.12). */
  panel(name, definition, options) {
    return this.registry.set("panel", name, { name, ...definition }, options);
  }

  /** Register a formatter (§10.13). */
  formatter(name, fn, options) {
    return this.registry.set("formatter", name, { name, format: fn }, options);
  }

  // ── Plugins (§8.5) ─────────────────────────────────────────────────────

  /**
   * Install a plugin. Idempotent per instance; `install` receives the
   * *instance*, never the global, which is what makes P8 hold.
   */
  use(plugin, options) {
    if (!plugin) return this;
    if (Array.isArray(plugin)) {
      for (const one of plugin) this.use(one, options);
      return this;
    }
    if (typeof plugin === "function") plugin = { name: plugin.name || "anonymous", install: plugin };
    const name = plugin.name || "anonymous";

    if (this.plugins.has(name)) return this;
    if (this._installStack && this._installStack.includes(name)) {
      fail("MK4003", __MK_DEV__ &&
        `plugin dependency cycle: ${this._installStack.concat(name).join(" → ")}`, {
        subject: name
      });
      return this;
    }

    // Requirements first, so a failure names the chain rather than surfacing
    // as a mysterious missing type later (§8.4).
    if (plugin.requires) {
      for (const dependency of Object.keys(plugin.requires)) {
        const range = plugin.requires[dependency];
        const actual =
          dependency === "mutakit" ? this.version : this._pluginVersion(dependency);
        if (actual == null) {
          fail("MK4002", __MK_DEV__ &&
            `'${name}' requires ${dependency}@${range}, which is not installed`,
            { subject: name }
          );
          return this;
        }
        if (!satisfies(actual, range)) {
          fail("MK4002", __MK_DEV__ &&
            `'${name}' requires ${dependency}@${range} but ${dependency}@${actual} is installed`,
            { subject: name }
          );
          return this;
        }
      }
    }

    this._installStack = (this._installStack || []).concat(name);
    const previousOrigin = this._installing;
    this._installing = name;
    let handle = null;
    try {
      handle = plugin.install ? plugin.install(this, options) : null;
    } catch (error) {
      warn("MK4006", __MK_DEV__ &&
        `plugin '${name}' threw during install: ${error.message}`, {
        subject: name,
        error
      });
    } finally {
      this._installing = previousOrigin;
      this._installStack.pop();
    }

    this.plugins.set(name, {
      name,
      version: plugin.version || "0.0.0",
      options: options || null,
      uninstall: handle && handle.uninstall,
      contributions: this._contributionsOf(name)
    });
    return this;
  }

  _pluginVersion(name) {
    const record = this.plugins.get(name);
    if (record) return record.version;
    const type = this.registry.get("type", name);
    return type ? type.version : null;
  }

  _contributionsOf(origin) {
    const out = [];
    for (const kind of Object.keys(this.registry.maps)) {
      for (const [name, value] of this.registry.maps[kind]) {
        if (value && value.origin === origin) out.push({ kind, name });
      }
    }
    return out;
  }

  /**
   * Deregister a plugin's contributions (§8.5). Live elements keep working
   * until destroyed normally; only new `create()` calls for its types fail.
   * That is what makes this safe to call during hot reload.
   */
  unuse(name) {
    const record = this.plugins.get(name);
    if (!record) return false;
    if (record.uninstall) {
      try {
        record.uninstall(this);
      } catch (error) {
        warn("MK4006", __MK_DEV__ &&
          `plugin '${name}' threw during uninstall: ${error.message}`, {
          subject: name,
          error
        });
      }
    }
    for (const { kind, name: contributed } of record.contributions) {
      if (kind === "type") {
        const live = this._instanceCounts.get(contributed) || 0;
        if (live > 0) {
          warn("MK4014", __MK_DEV__ &&
            `'${contributed}' deregistered with ${live} live instance(s); they keep working ` +
              `until destroyed, but new ones cannot be created`,
            { subject: contributed }
          );
        }
      }
      this.registry.delete(kind, contributed);
    }
    this.plugins.delete(name);
    return true;
  }

  // ── Identity (§8.9) ────────────────────────────────────────────────────

  nextNodeId(type) {
    return `${type}-${++this._nodeSeq}`;
  }

  // ── Error isolation (§8.10) ────────────────────────────────────────────

  /**
   * Run a lifecycle hook inside a guard. On a throw the node is marked
   * `errored`, further hooks on it stop, a diagnostic carrying the plugin's
   * identity is emitted, and an `error` event bubbles the node tree so the
   * application can report it.
   */
  guard(node, hookName, fn, args) {
    try {
      return fn.apply(null, args || []);
    } catch (error) {
      return this.reportHookError(node, hookName, error);
    }
  }

  reportHookError(node, hookName, error) {
    const policy = this.options.errorPolicy;
    const definition = node && node.definition;
    const detail = {
      subject: node ? `${node.type}#${node.id}` : hookName,
      hook: hookName,
      type: definition && definition.type,
      plugin: definition && definition.origin,
      pluginVersion: definition && definition.version,
      error
    };

    // Teardown of siblings must complete regardless of what one destroy does.
    if (hookName === "destroy" || hookName === "unmount") {
      warn("MK3007", __MK_DEV__ &&
        `${hookName}() threw in '${detail.type}': ${error.message}`, detail);
      return undefined;
    }

    if (node) {
      node.errored = error;
      node.flags = 0;
    }

    if (policy === "propagate") throw error;
    if (policy !== "silent") {
      warn("MK3007", __MK_DEV__ &&
        `${hookName}() threw in '${detail.type}' (from ${detail.plugin}@${detail.pluginVersion}): ` +
          error.message,
        detail
      );
    }
    // A node with no parent cannot bubble yet; `_placeholder` emits once it
    // has been inserted, so the event is never silently dropped.
    if (node && node.parent) {
      emit(node, "error", { error, hook: hookName, node }, { cancelable: false });
    }
    return undefined;
  }

  /** Build a diagnostic Error without throwing — used by the isolation path. */
  error(code, message, detail) {
    return diagnosticError(code, message, detail);
  }

  // ── Introspection ──────────────────────────────────────────────────────

  list() {
    return this.registry.list();
  }

  has(kind, name) {
    return this.registry.has(kind, name);
  }
}
