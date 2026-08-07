/**
 * The `Mutakit` namespace (§8.6).
 *
 * Two things live here. Instance creation — `Mutakit.create({ theme })` — and
 * a set of conveniences that forward to a lazily created *default* instance,
 * so the eight-line example in §1.2 needs no ceremony. Registration
 * (`define`, `trait`, `layout`, `unit`) targets the global registry, which
 * every instance inherits from by reference unless created with
 * `inherit: false` (P8).
 */
import { VERSION } from "./core/env.js";
import { globalRegistry } from "./core/kernel.js";
import { conformance, conformanceTrait } from "./core/conformance.js";
import { resolveDefinition } from "./core/define.js";
import { setDiagnosticSink, resetDiagnostics, CATALOGUE } from "./core/diagnostics.js";
import { batch, computed, effect, signal, untrack } from "./core/signals.js";
import { setClock, counters } from "./core/dom.js";
import { MutakitInstance } from "./engine/instance.js";
import { parse, toCSS, toNumber } from "./geometry/len.js";
import { clamp, containsPoint, intersect, rect } from "./geometry/rect.js";
import { place, resolveAnchor } from "./geometry/anchor.js";
import { convertPoint } from "./geometry/spaces.js";

/** A registry-only kernel, so `Mutakit.define()` works before any instance. */
class GlobalKernel extends MutakitInstance {
  constructor() {
    super({ inherit: false });
    this.registry = globalRegistry;
  }
}

let globalKernel = null;
let defaultInstance = null;

function kernel() {
  if (!globalKernel) globalKernel = new GlobalKernel();
  return globalKernel;
}

function instance() {
  if (!defaultInstance || defaultInstance.destroyed) defaultInstance = new MutakitInstance();
  return defaultInstance;
}

export const Mutakit = {
  VERSION,
  version: VERSION,

  /**
   * Overloaded, because both readings appear throughout the design and both
   * are natural: a string is an element type on the default instance
   * (`Mutakit.create('modal', …)` — §5.9), an object is a new instance
   * (`Mutakit.create({ theme: 'dark' })` — §8.6).
   */
  create(typeOrOptions, props) {
    if (typeof typeOrOptions === "string") return instance().create(typeOrOptions, props);
    return new MutakitInstance(typeOrOptions);
  },

  /** Mount a root frame. Returns a handle (§5.11). */
  mount(target, options) {
    return instance().mount(target, options);
  },

  /** The default instance, created on first use. */
  get default() {
    return instance();
  },

  /** Replace the default instance. Tests use this between cases. */
  reset() {
    if (defaultInstance) defaultInstance.destroyInstance();
    defaultInstance = null;
    resetDiagnostics();
    return this;
  },

  // ── Registration, against the global registry ────────────────────────
  define: (definition, options) => kernel().define(definition, options),
  trait: (trait, options) => kernel().trait(trait, options),
  layout: (algorithm, options) => kernel().layout(algorithm, options),
  unit: (name, definition, options) => kernel().unit(name, definition, options),
  anchor: (name, resolve, options) => kernel().anchor(name, resolve, options),
  placement: (name, strategy, options) => kernel().placement(name, strategy, options),
  theme: (name, definition, options) => kernel().theme(name, definition, options),
  motion: (name, preset, options) => kernel().motion(name, preset, options),
  input: (name, source, options) => kernel().input(name, source, options),
  gesture: (name, recognizer, options) => kernel().gesture(name, recognizer, options),
  serializer: (migration, options) => kernel().serializer(migration, options),

  /** Install a plugin into the default instance (§8.5). */
  use(plugin, options) {
    instance().use(plugin, options);
    return this;
  },

  registry: {
    list: () => globalRegistry.list(),
    has: (kind, name) => globalRegistry.has(kind, name),
    get: (kind, name) => globalRegistry.get(kind, name)
  },

  // ── Reactivity (§15.1) ───────────────────────────────────────────────
  signal,
  computed,
  effect,
  batch,
  untrack,

  // ── Lookup and lifecycle on the default instance ─────────────────────
  byId: (id) => instance().byId(id),
  query: (selector, scope) => instance().query(selector, scope),
  queryAll: (selector, scope) => instance().queryAll(selector, scope),
  build: (spec, parent) => instance().build(spec, parent),
  adopt: (element, options, parent) => instance().adopt(element, options, parent),
  serialize: (scope, options) => instance().serialize(scope, options),
  restore: (json, options) => instance().restore(json, options),
  persist: (key, options) => instance().persist(key, options),
  tick: (time) => instance().tick(time),
  flush: (options) => instance().flush(options),

  /**
   * A *curated* geometry surface.
   *
   * Deliberately not `{ Len, Rect, Anchor, Spaces }` as namespace objects. A
   * re-exported namespace is a live binding to every export of its module, so
   * that spelling pinned a dozen functions core never calls into every bundle
   * — `outset`, `union`, `containsRect`, `invertMatrix`, and the rest. It also
   * published a surface §10's complete list of extension points never promised,
   * on top of §8.2's "ctx is the only surface a plugin sees".
   *
   * What is here is what a plugin plausibly needs and nothing else. Anything
   * further should arrive as a named extension point, not by widening this.
   */
  geometry: {
    parse,
    toCSS,
    toNumber,
    rect,
    intersect,
    clamp,
    containsPoint,
    resolveAnchor,
    place
  },
  convert: (p, from, to, refs) => convertPoint(p, from, to, refs),

  /**
   * Run a definition against the contract (§8.7).
   *
   * Development-only: it runs automatically on every `define()` in the
   * development build and is published as a *test* utility, and tests run
   * against that build. Production returns nothing rather than carrying a
   * checker nobody can act on.
   */
  conformance(definition) {
    if (!__MK_DEV__) return [];
    const resolved = definition.extends
      ? resolveDefinition(definition, globalRegistry.get("type", definition.extends), {})
      : null;
    return conformance(definition, resolved);
  },
  conformanceTrait(trait) {
    return __MK_DEV__ ? conformanceTrait(trait) : [];
  },

  diagnostics: {
    catalogue: CATALOGUE,
    sink: setDiagnosticSink,
    reset: resetDiagnostics
  },

  /** Test-only hooks (§23.1, §23.2). Present in both builds; harmless unused. */
  testing: {
    clock: setClock,
    counters,
    measurer(fn) {
      instance().measurer.setStub(fn);
      return instance();
    },
    metrics(values) {
      instance().metrics.override(values);
      return instance();
    }
  }
};

export default Mutakit;
