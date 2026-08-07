/**
 * A Mutakit instance — the node tree, the frame loop, and element lifecycle.
 *
 * `Kernel` (core) owns registration and error isolation; this class adds
 * everything that needs geometry or a DOM. The split is what keeps the layer
 * map's downward-only rule (§4.1) true of the kernel itself.
 *
 * **Coordinate convention.** A node's `computed` rect is expressed in its
 * parent's positioning space, with the parent's inset stack already folded in
 * — so `--mk-x` is directly usable as `left` with no further arithmetic, which
 * is what keeps the WRITE phase to one property assignment per axis.
 */
import "../core/dev.js";
import { SCHEMA_VERSION } from "../core/env.js";
import { Kernel } from "../core/kernel.js";
import * as dom from "../core/dom.js";
import { fail, warn } from "../core/diagnostics.js";
import { addListener, emit } from "../core/events.js";
import { effect, isSignal, read } from "../core/signals.js";
import { defaultsOf, validateAll, validateValue } from "../core/schema.js";
import { parse, toCSS, toNumber } from "../geometry/len.js";
import * as R from "../geometry/rect.js";
import { axisSpecs, resolveAxis } from "../geometry/constraints.js";
import { insetOffset, place } from "../geometry/anchor.js";
import { LayoutNode, snapshot } from "./node.js";
import { ARRANGE, MEASURE, PAINT, STYLE, clear, invalidate, invalidateGeometry } from "./invalidate.js";
import { Metrics } from "./metrics.js";
import { Measurer } from "./measure.js";
import { GEOMETRY_PROPERTIES, StyleCompiler } from "./compile.js";
import { Scheduler } from "./scheduler.js";
import { Handle } from "./handle.js";
import { makeContext, makeLayoutContext } from "./ctx.js";
import { StyleManager } from "./styles.js";

/** Props the engine owns. Anything else is validated by the element's schema. */
const GEOMETRY_KEYS = new Set([
  "size", "width", "height",
  "min", "max", "minWidth", "maxWidth", "minHeight", "maxHeight",
  "at", "anchor", "of", "offset", "inset",
  "left", "right", "top", "bottom",
  "inlineStart", "inlineEnd", "blockStart", "blockEnd",
  "insets", "keepWithin", "positioning", "scrollWith", "priority", "z"
]);

/** Structural keys that are also raw DOM sinks — never restored under `schema`. */
const RAW_DOM_KEYS = new Set(["class", "style"]);

const STRUCTURAL_KEYS = new Set([
  "id", "key", "traits", "algorithm", "content", "slots", "children", "on", "command",
  "class", "style", "hidden", "a11y", "layer", "layout", "measureSync"
]);

export class MutakitInstance extends Kernel {
  constructor(options) {
    super(options);

    this.metrics = new Metrics();
    this.measurer = new Measurer();
    this.compiler = new StyleCompiler();
    this.styles = new StyleManager(this);
    this.scheduler = new Scheduler({ subject: this.id });

    this.roots = [];
    this.services = new Map();
    /** Nodes mid-exit-animation, awaited by `flush({ animations: false })`. */
    this.exiting = new Set();
    this.handles = new WeakMap();
    this.ids = new Map();
    this.dev = __MK_DEV__ ? { diagnostics: [], frames: 0 } : null;

    /** Bound once — see `resolveBox`, where it is handed to `place()`. */
    this._anchorLookup = (name) => this.registry.get("anchor", name);

    this.scheduler.on("read", (time) => this._read(time));
    this.scheduler.on("arrange", () => this._arrange());
    this.scheduler.on("write", () => this._write());
    this.scheduler.on("paint", (time) => this._paint(time));
  }

  // ── Services ───────────────────────────────────────────────────────────

  /** Register a service (layers, focus, motion, …). Returns the service. */
  provide(name, service) {
    this.services.set(name, service);
    if (service && typeof service.attach === "function") service.attach(this);
    return service;
  }

  service(name) {
    const existing = this.services.get(name);
    if (existing) return existing;
    // Services are per instance (P8). A preset registers a *factory*, and the
    // instance builds its own copy the first time something asks for it —
    // which also means a service nobody uses costs nothing but its bytes.
    const factory = SERVICE_FACTORIES.get(name);
    return factory ? this.provide(name, factory(this)) : undefined;
  }

  // ── Roots (§5.11) ──────────────────────────────────────────────────────

  /**
   * Mount a root frame onto `target`. Roots are independent (P8) and may nest;
   * geometry does not flow across the boundary, so an `'element'`-mode root
   * inside a pane is how a self-contained widget embeds.
   */
  mount(target, options) {
    const opts = { sizing: this.options.sizing, ...(options || {}) };
    const element = dom.resolveTarget(target);
    if (!element) {
      return fail("MK1001", __MK_DEV__ &&
        `mount target ${JSON.stringify(target)} was not found`, {
        subject: String(target)
      });
    }

    const node = new LayoutNode("root", { mk: this, id: opts.id || null, definition: null });
    node.root = node;
    node.el = element;
    node.contentEl = element;
    node.algorithm = opts.algorithm || "anchor";
    node.sizing = opts.sizing;
    node.fixedSize = opts.size || null;
    node.scheduler = this.scheduler;
    node.mounted = true;
    node.sizeIsFixed = opts.sizing !== "element";

    element.classList.add(`${this.prefix}-root`);
    element.setAttribute("data-mk-root", this.id);
    if (opts.sizing === "viewport") element.classList.add(`${this.prefix}-root--viewport`);

    node.insets.set("safe", "env(safe-area-inset-*)");

    if (opts.sizing === "element") {
      node.own(
        dom.observeResize(element, () => {
          invalidate(node, "arrange");
        })
      );
    }

    // After the root joins `this.roots`, below — a root in a new document needs
    // every sheet this instance has already written, not only the base (§10.14).
    if (this.options.theme) this.applyTheme(this.options.theme, node);

    this.roots.push(node);
    this.styles.ensureDocument();
    // Delegation is per root, and a root can be mounted after the service
    // exists — a second root, or one created by a plugin.
    const pointer = this.services.get("pointer");
    if (pointer) node.own(pointer.observe(node));
    this._attachInputSources();
    invalidate(node, "arrange");
    this.scheduler.arm();
    return this.handleFor(node);
  }

  /**
   * Start the registered input sources (§13.5).
   *
   * `mk.input(name, source)` put the source in the registry and nothing ever
   * called its `attach` — so the gamepad source, the one built-in consumer of
   * §10.8, polled nothing and fed nothing. Registered, documented, and never
   * started: the same shape as the gestures pipeline, one layer up.
   *
   * On mount rather than at registration, because a source binds to an
   * instance's scheduler and there may be no instance when a preset registers
   * one. Once per instance, and disposed with it.
   */
  _attachInputSources() {
    if (!this._inputSources) this._inputSources = new Map();
    for (const name of this.registry.names("input")) {
      if (this._inputSources.has(name)) continue;
      const source = this.registry.get("input", name);
      if (!source || typeof source.attach !== "function") continue;
      const stop = this.guard(this.root, `input:${name}.attach`, source.attach, [
        this,
        this.options[name] || {}
      ]);
      this._inputSources.set(name, typeof stop === "function" ? stop : () => {});
    }
  }

  /** The first mounted root, which is what the namespace-level API targets. */
  get root() {
    return this.roots[0] || null;
  }

  // ── Element lifecycle (§8.1) ───────────────────────────────────────────

  /**
   * Create an element. `parent` is a node, a handle, or omitted (the first
   * root). Returns a handle carrying the type's declared commands.
   */
  create(type, props, parent) {
    const definition = this.registry.get("type", type);
    if (!definition) {
      const known = this.registry.names("type").slice(0, 8).join(", ");
      return fail("MK3001", __MK_DEV__ &&
        `unknown element type '${type}'. Registered types include: ${known}. ` +
          `A plugin providing it may not be installed yet.`,
        { subject: type }
      );
    }
    if (definition.abstract) {
      return fail("MK3001", __MK_DEV__ &&
        `'${type}' is abstract and cannot be instantiated directly`, {
        subject: type
      });
    }

    const parentNode = nodeOf(parent) || this.root;
    if (!parentNode) {
      return fail("MK1001", __MK_DEV__ &&
        `nothing is mounted yet; call Mutakit.mount(target) first`, {
        subject: type
      });
    }

    const options = props || {};
    const node = new LayoutNode(type, {
      mk: this,
      definition,
      id: options.id || null,
      key: options.key || null
    });
    node.root = parentNode.root;
    node.scheduler = this.scheduler;
    node.algorithm = options.algorithm || definition.algorithm || "anchor";
    node.layer = options.layer || definition.layer || null;
    node.measureSync = !!options.measureSync;

    this._splitProps(node, definition, options);
    this._registerId(node);

    const ctx = makeContext(node);

    // create() may be a chain when the type extends another (§8.3): the
    // parent's runs first and the child receives its return value.
    let element = null;
    for (const hook of definition.hooks.create) {
      const produced = this.guard(node, "create", hook, [ctx, element]);
      if (produced) element = produced;
      if (node.errored) break;
    }
    // An errored node still needs a box: §8.10's placeholder has to preserve
    // the declared geometry, and it cannot do that with nothing to style.
    if (!element && !definition.virtual) element = dom.el("div");

    node.el = element;
    // A virtual node has no box of its own; its children land in the nearest
    // ancestor that does, which is what makes `group` free (§11.1). A `create`
    // hook that nominated an inner element keeps it.
    if (!node.contentEl) node.contentEl = element || parentNode.contentEl;
    if (element) {
      element.classList.add(`${this.prefix}-node`, this.className(type));
      // Written now rather than staged for WRITE. The base stylesheet keys a
      // child's box ownership off this attribute (§9.1), and READ runs before
      // WRITE — so on the first frame every child of a flow-owning algorithm
      // was still absolutely positioned and contributed nothing to its
      // parent's intrinsic size. An auto-sized container measured empty
      // exactly once, and that measurement is the one that got written.
      if (node.algorithm) element.setAttribute("data-mk-algorithm", node.algorithm);
      this._applyAlgorithmCSS(node);
      if (node.id) element.setAttribute("data-mk-id", node.id);
      if (options.class) element.classList.add(...String(options.class).split(/\s+/));
      if (options.style) dom.setStyles(element, options.style);
      node.own(() => dom.remove(element));
    }

    this.styles.ensureType(definition);
    this._applyA11y(node, definition);
    this._attachTraits(node, definition, options);
    this._bindDeclarativeEvents(node, options);

    parentNode.insert(node, nodeOf(options.before));
    if (element && parentNode.contentEl) {
      const beforeNode = nodeOf(options.before);
      dom.insert(parentNode.contentEl, element, beforeNode && beforeNode.el);
    }

    this._validateLayoutProps(node);
    if (options.content !== undefined) this.setContent(node, options.content);
    // Both spellings fill a slot: `slots: { body }` and a bare `body`. The
    // second is what Appendix B writes, and it used to be dropped in silence —
    // the dialog appeared, empty, with the form and the buttons simply gone.
    // `slots` wins on a collision, being the explicit one.
    const declared = definition.slots;
    if (declared) {
      for (const name of Object.keys(declared)) {
        const fill = options.slots && name in options.slots ? options.slots[name] : options[name];
        if (fill !== undefined) this.setSlot(node, name, fill);
      }
    }
    if (options.slots) {
      for (const name of Object.keys(options.slots)) {
        if (!declared || !(name in declared)) this.setSlot(node, name, options.slots[name]);
      }
    }
    // `children` is a tier-2 word that tier 1 could not say, so §18.5's
    // abilities stack — `create('stack', { …, children: abilities.map(toSlot) })`
    // — resolved to 0×0 with nothing in it. `build` strips `children` before
    // calling here, so a declarative tree still builds them exactly once.
    if (options.children) for (const child of options.children) this.build(child, node);

    if (node.errored) this._placeholder(node);


    this._mount(node);
    invalidate(node, MEASURE | ARRANGE | STYLE);
    invalidateGeometry(node);
    return this.handleFor(node);
  }

  /**
   * Replace an errored node's subtree with a placeholder **that preserves the
   * node's declared geometry** (§8.10), so surrounding layout does not
   * collapse and the failure stays visually local. This is the half of error
   * isolation that a `try`/`catch` alone cannot give you.
   */
  _placeholder(node) {
    for (const child of node.children.slice()) this.destroy(child);
    if (!node.el) return;
    node.el.setAttribute("data-mk-errored", node.type);
    node.el.textContent = "";
    // Emitted here rather than at the throw: a failure during `create` happens
    // before the node joins the tree, and an `error` event that cannot bubble
    // is an error the application never hears about (§8.10 step 4).
    emit(node, "error", { error: node.errored, hook: "create", node });
    if (__MK_DEV__) {
      const message = node.errored ? node.errored.message : "element failed";
      node.el.setAttribute("title", `${node.type}: ${message}`);
    }
    // Geometry is untouched: the node keeps whatever size and position it
    // declared, so its siblings never notice.
  }

  _mount(node) {
    if (node.mounted || node.destroyed) return;
    node.mounted = true;
    const ctx = makeContext(node);
    for (const hook of node.definition ? node.definition.hooks.mount : []) {
      this.guard(node, "mount", hook, [ctx]);
    }
    for (const record of node.traits.values()) {
      if (record.trait.mount) this.guard(node, `trait:${record.trait.name}.mount`, record.trait.mount, [ctx, record.api]);
    }
    emit(node, "mount", { node }, { bubbles: false });

    // The declaration is checked *before* the service is asked for, so a page
    // whose elements declare no motion never instantiates the service at all.
    if (node.definition && node.definition.motion) {
      const motion = this.service("motion");
      if (motion) motion.play(node, "enter");
    }
  }

  /**
   * Destroy a node and its subtree. Teardown of siblings must complete
   * regardless of what one `destroy` does, so hook errors are logged and
   * swallowed (§8.10).
   */
  destroy(node) {
    const target = nodeOf(node);
    if (!target || target.destroyed) return false;

    // Exit animations and destruction interact carefully (§17). A removed
    // element stays in the tree until its exit completes, but is *immediately*
    // inert, out of the focus order, and excluded from hit testing — so a
    // "closing" dialog can never swallow a click meant for what is behind it,
    // which is a real and common bug in libraries that merely delay removal.
    // `exited` records that the animation has *already played*, which is not
    // the same as "is playing". Clearing the in-flight flag before re-entering
    // destroy re-armed the exit every time, forever.
    const motion =
      !target.exited && target.el && target.definition && target.definition.motion
        ? this.service("motion")
        : null;
    if (motion) {
      target.exited = true;
      target.exiting = true;
      target.el.setAttribute("data-mk-exiting", "");
      target.el.setAttribute("inert", "");
      target.el.style.pointerEvents = "none";
      const finish = motion.play(target, "exit").then(() => {
        target.exiting = false;
        this.exiting.delete(finish);
        this.destroy(target);
      });
      this.exiting.add(finish);
      return false;
    }

    for (const child of target.children.slice()) this.destroy(child);

    const ctx = makeContext(target);
    if (target.mounted) {
      for (const hook of target.definition ? target.definition.hooks.unmount : []) {
        this.guard(target, "unmount", hook, [ctx]);
      }
      target.mounted = false;
    }
    for (const record of [...target.traits.values()].reverse()) {
      if (record.trait.detach) {
        this.guard(target, `trait:${record.trait.name}.detach`, record.trait.detach, [ctx, record.api]);
      }
    }

    for (const hook of target.definition ? target.definition.hooks.destroy : []) {
      this.guard(target, "destroy", hook, [ctx]);
    }

    const gestures = this.services.get("gestures");
    // Element destruction is a cancellation source like any other (§13.3).
    if (gestures) gestures.cancel(target, "destroyed");

    this.measurer.unobserve(target);
    target.releaseOwned();
    // Cleared *after* the disposers, not before. A trait's cleanup routinely
    // emits one of its own declared events — `tooltip-host` hides its tooltip
    // — and clearing first makes every such emit an undeclared one (MK3003).
    // The disposer guard swallowed the throw, so the tooltip simply never
    // announced that it had gone.
    target.traits.clear();
    if (target.id && this.ids.get(target.id) === target) this.ids.delete(target.id);
    if (target.definition) {
      const count = this._instanceCounts.get(target.type) || 0;
      this._instanceCounts.set(target.type, Math.max(0, count - 1));
    }

    if (target.parent) target.parent.removeChild(target);
    const rootIndex = this.roots.indexOf(target);
    if (rootIndex !== -1) this.roots.splice(rootIndex, 1);

    target.destroyed = true;
    target._ctx = null;
    this.handles.delete(target);
    return true;
  }

  /** Move a node under a new parent; child props re-validate (§7.0). */
  reparent(node, parent, before) {
    const target = nodeOf(node);
    const newParent = nodeOf(parent);
    if (!target || !newParent) return false;
    if (target.contains(newParent)) {
      return fail("MK2002", __MK_DEV__ &&
        `cannot reparent '${target}' into its own descendant`, {
        subject: target.toString()
      });
    }
    if (target.parent) target.parent.removeChild(target);
    newParent.insert(target, before ? nodeOf(before) : null);
    if (target.el && newParent.contentEl) {
      dom.insert(newParent.contentEl, target.el, before && nodeOf(before) && nodeOf(before).el);
    }
    this._validateLayoutProps(target);
    invalidate(newParent, "arrange");
    return true;
  }

  // ── Props ──────────────────────────────────────────────────────────────

  _splitProps(node, definition, options) {
    const geometry = node.geometry;
    const own = {};

    const slots = definition.slots || null;
    for (const key of Object.keys(options)) {
      // A prop the type declares wins the name. `min` and `max` are geometry
      // keys, and `meter`, `progress`, `slider`, and `number` all declare props
      // called exactly that — so their ranges were being read as size clamps
      // and never reached the element at all. A meter asked for `max: 1`
      // silently kept the default of 100 and reported 1% where it meant 73%.
      //
      // The type's declaration is the more specific claim, and geometry keeps
      // `minWidth`/`maxWidth`/`minHeight`/`maxHeight` for the case where an
      // element genuinely needs both.
      if (GEOMETRY_KEYS.has(key) && !(key in definition.props)) geometry[key] = options[key];
      // A key naming a declared slot is a slot fill, not a prop. Props win the
      // name if a type declares both, since a prop is the narrower claim.
      else if (slots && slots[key] && !(key in definition.props)) continue;
      else if (!STRUCTURAL_KEYS.has(key)) own[key] = options[key];
    }
    if (options.layout) node.layoutProps = { ...options.layout };
    if (definition.geometry && definition.geometry.defaults) {
      for (const key of Object.keys(definition.geometry.defaults)) {
        if (geometry[key] === undefined) geometry[key] = definition.geometry.defaults[key];
      }
    }
    if (options.positioning) node.positioning = options.positioning;

    const result = validateAll(definition.props, own, { strict: false });
    for (const problem of result.errors) {
      fail("MK3005", __MK_DEV__ &&
        `${node.type}.${problem.name}: ${problem.message}`, {
        subject: `${node.type}.${problem.name}`
      });
    }
    if (__MK_DEV__) reportUndeclaredProps(node, result.unknown);

    Object.assign(node.props, defaultsOf(definition.props), result.values);
    this._bindSignalProps(node, definition);
  }

  /** A signal passed as a prop binds an effect that re-sets it (§15.1). */
  _bindSignalProps(node, definition) {
    for (const name of Object.keys(node.props)) {
      const value = node.props[name];
      if (!isSignal(value)) continue;
      node.props[name] = read(value);
      node.own(
        effect(() => {
          const next = value();
          if (node.destroyed) return;
          this.setProps(node, { [name]: next });
        })
      );
    }
    this._bindSignalGeometry(node);
  }

  /**
   * The same for geometry, which is not a prop (§15.2).
   *
   * A signal in `size`, `inset`, or an edge resolves correctly the first time —
   * `Len` re-reads it on every arrange — so the value was never wrong. It was
   * only ever *stale*: nothing invalidated the node when the signal changed,
   * so the box kept whatever the last arrange happened to compute, and a store
   * slice driving a pane's width moved when something else forced a frame and
   * not otherwise.
   *
   * Only the node is invalidated, not the tree: geometry is the parent's
   * business, which is what `invalidateGeometry` already encodes.
   */
  _bindSignalGeometry(node) {
    for (const key of Object.keys(node.geometry)) {
      const value = node.geometry[key];
      for (const signal of signalsIn(value)) {
        node.own(
          effect(() => {
            signal();
            if (node.destroyed) return;
            invalidate(node, MEASURE | ARRANGE);
            invalidateGeometry(node);
          })
        );
      }
    }
  }

  /** Update props, validating through the schema and calling `update()`. */
  setProps(node, values) {
    const target = nodeOf(node);
    if (!target || target.destroyed || !values) return target;
    const definition = target.definition;
    const changed = new Set();

    for (const name of Object.keys(values)) {
      if (GEOMETRY_KEYS.has(name)) {
        target.geometry[name] = values[name];
        invalidateGeometry(target);
        continue;
      }
      if (name === "layout") {
        this.setLayoutProps(target, values.layout);
        continue;
      }
      if (name === "content") {
        this.setContent(target, values.content);
        continue;
      }

      const descriptor = definition && definition.props[name];
      let next = values[name];
      if (descriptor) {
        const result = validateValue(descriptor, next, `${target.type}.${name}`);
        if (result.error) {
          fail("MK3005", __MK_DEV__ &&
            result.error, { subject: `${target.type}.${name}` });
          continue;
        }
        next = result.value;
      }
      if (target.props[name] === next) continue;
      target.props[name] = next;
      changed.add(name);
    }

    if (!changed.size) return target;

    const ctx = makeContext(target);
    for (const hook of definition ? definition.hooks.update : []) {
      this.guard(target, "update", hook, [ctx, changed]);
    }
    this._applyA11y(target, definition);
    this.persistDirty = true;
    emit(target, "propschange", { changed: [...changed] }, { bubbles: false });
    invalidate(target, STYLE | MEASURE | ARRANGE);
    invalidateGeometry(target);
    return target;
  }

  /**
   * Write the parent algorithm's per-child bag. Only the immediate parent's
   * algorithm validates it, at insertion, reparenting, and mutation (§7.0).
   */
  setLayoutProps(node, values) {
    const target = nodeOf(node);
    if (!target) return target;
    Object.assign(target.layoutProps, values);
    this._validateLayoutProps(target);
    this.persistDirty = true;
    if (target.parent) invalidate(target.parent, "arrange");
    return target;
  }

  _validateLayoutProps(node) {
    const parent = node.parent;
    if (!parent) return;
    const algorithm = this.registry.get("layout", parent.algorithm || "anchor");
    if (!algorithm || !algorithm.childProps) return;

    const schema = algorithm.childProps;
    const result = validateAll(schema, node.layoutProps, { strict: true });
    for (const problem of result.errors) {
      warn("MK2012", __MK_DEV__ &&
        `layout.${problem.name}: ${problem.message}`, {
        subject: `${node}.layout.${problem.name}`
      });
    }
    for (const name of result.unknown) {
      // Retained but ignored, so moving the child back to a compatible parent
      // restores it (§7.0).
      node.layoutExtras[name] = node.layoutProps[name];
      warn("MK2012", __MK_DEV__ &&
        `'${name}' is not a child prop of the '${algorithm.name}' algorithm ` +
          `(it accepts ${Object.keys(schema).join(", ")}). The value is kept but ignored.`,
        { subject: `${node}.layout.${name}` }
      );
    }
    node.layoutProps = { ...node.layoutExtras, ...result.values };
  }

  // ── Content and slots (§8.8) ───────────────────────────────────────────

  /** The `content` prop accepts five forms; this is the one place they meet. */
  setContent(node, content) {
    const target = nodeOf(node);
    const host = target.contentEl || target.el;
    if (!host) return target;

    // Text content is part of the tier-2 form (§18.2 — `content` is the
    // default slot's name), so it has to survive `serialize()`. Nothing kept
    // it before: a persisted layout restored with every label gone, and an
    // auto-sized node holding only text came back at zero.
    //
    // Only the serializable forms are recorded. An element spec becomes real
    // children and round-trips as `children`; a DOM node, a function, or a
    // promise is no more serializable than a function prop, and is skipped for
    // the same reason.
    if (content == null || content === false) {
      dom.setText(host, "");
      target.content = undefined;
      return target;
    }
    if (typeof content === "string" || typeof content === "number") {
      dom.setText(host, content); // never parsed as HTML (§21.4)
      target.content = content;
      return target;
    }
    // A signal before a producer function. Both are callable, and the
    // difference is destructive rather than cosmetic: calling a signal
    // accessor with an argument *writes* to it, so `content: someSignal`
    // replaced the signal's value with the element's own `ctx` — silently, on
    // create, before anything had a chance to render it.
    if (isSignal(content)) {
      const bound = content;
      target.own(
        effect(() => {
          const next = bound();
          if (!target.destroyed) this.setContent(target, next);
        })
      );
      return target;
    }
    if (typeof content === "function") {
      const produced = this.guard(target, "content", content, [makeContext(target)]);
      if (produced && typeof produced.then === "function") {
        this._lazyContent(target, produced);
        return target;
      }
      if (produced) return this.setContent(target, produced);
      return target;
    }
    if (content && typeof content.nodeType === "number") {
      host.appendChild(content);
      return target;
    }
    if (Array.isArray(content)) {
      for (const item of content) this.setContent(target, item);
      return target;
    }
    if (typeof content === "object" && content.type) {
      this.build(content, target);
      return target;
    }
    warn("MK3017", __MK_DEV__ &&
      `unsupported \`content\` value on '${target.type}'`, {
      subject: target.toString()
    });
    return target;
  }

  /**
   * Lazy content reserves the element's geometry immediately from its declared
   * size, shows the `loading` slot, and swaps on resolution, so a lazily
   * loaded panel never causes a layout jump (§8.8).
   */
  _lazyContent(node, promise) {
    this.compiler.setState(node, "loading", true);
    promise.then(
      (value) => {
        if (node.destroyed) return;
        this.compiler.setState(node, "loading", false);
        this.setContent(node, value && value.default ? value.default : value);
      },
      (error) => {
        if (node.destroyed) return;
        this.compiler.setState(node, "loading", false);
        this.reportHookError(node, "content", error);
      }
    );
  }

  setSlot(node, name, content) {
    const target = nodeOf(node);
    const declared = target.definition && target.definition.slots;
    if (declared && !(name in declared)) {
      warn("MK3012", __MK_DEV__ &&
        `'${target.type}' has no slot '${name}' (it declares ${Object.keys(declared).join(", ") || "none"})`,
        { subject: `${target.type}.${name}` }
      );
      return target;
    }
    const slot = target.slots[name] || (target.slots[name] = { name, host: null, nodes: [] });
    const max = declared && declared[name] && declared[name].max;
    if (max != null && slot.nodes.length >= max) {
      warn("MK3013", __MK_DEV__ &&
        `slot '${name}' on '${target.type}' accepts at most ${max}`, {
        subject: `${target.type}.${name}`
      });
      return target;
    }
    const host = slot.host || target.contentEl || target.el;
    const previousContent = target.contentEl;
    target.contentEl = host;
    this.setContent(target, content);
    target.contentEl = previousContent;
    return target;
  }

  // ── Tier 2 — declarative objects (§18.2) ───────────────────────────────

  /**
   * Build a subtree from the declarative form. This is the canonical shape:
   * it is what `serialize()` emits, what `restore()` accepts, and what
   * devtools displays and edits (P2).
   */
  build(spec, parent) {
    if (Array.isArray(spec)) return spec.map((one) => this.build(one, parent));
    if (!spec || typeof spec !== "object") return null;

    const parentNode = nodeOf(parent) || this.root;
    // `slots` stays in `rest`: filling slots — by the `slots` bag or by a bare
    // key naming one — belongs to `create`, so both tiers get it from one
    // place. Doing it here as well built every control twice.
    const { type, children, panes, regions, content, ...rest } = spec;
    if (!type) {
      return fail("MK3001", __MK_DEV__ &&
        "a declarative node needs a `type`", { subject: JSON.stringify(spec).slice(0, 60) });
    }

    const handle = this.create(type, rest, parentNode);
    if (!handle) return null;
    const node = handle.node;

    if (panes) this.applyAlgorithm(node, "split", { ...rest, panes });
    else if (regions) this.applyAlgorithm(node, "dock", { ...rest, regions });

    if (content !== undefined) this.setContent(node, content);
    if (children) for (const child of children) this.build(child, node);
    return handle;
  }

  /**
   * Adopt an element already in the document, taking over only its geometry
   * and leaving it where it is (§8.8). The contract is a guarantee, not a
   * behaviour: Mutakit writes only the §12.4 custom properties, the
   * properties they feed, and `data-mk-*` attributes.
   */
  adopt(element, options, parent) {
    const target = dom.resolveTarget(element);
    if (!target) return fail("MK3001", __MK_DEV__ &&
      "adopt() needs an element", { subject: String(element) });

    const opts = options || {};
    const parentNode = nodeOf(parent) || this.root;
    const node = new LayoutNode("adopted", {
      mk: this,
      definition: ADOPTED_DEFINITION,
      id: opts.id || null
    });
    node.root = parentNode.root;
    node.scheduler = this.scheduler;
    node.algorithm = "anchor";
    node.el = target;
    node.contentEl = target;
    node.adopted = {
      parent: target.parentNode,
      next: target.nextSibling,
      cssText: target.style.cssText,
      onDestroy: opts.onDestroy || "return"
    };

    for (const key of Object.keys(opts)) if (GEOMETRY_KEYS.has(key)) node.geometry[key] = opts[key];

    target.setAttribute("data-mk-adopted", this.id);
    parentNode.insert(node, null);
    if (opts.reparent !== false && parentNode.contentEl && target.parentNode !== parentNode.contentEl) {
      parentNode.contentEl.appendChild(target);
    }

    node.own(() => {
      // Undo precisely what §8.8's contract says was written: the geometry
      // custom properties, the state mirrors, and the `data-mk-*` attributes.
      // Only the geometry half was removed, so `detach` and `remove` handed
      // back an element still carrying `--mk-state-*` and `data-mk-*` —
      // residue on a node Mutakit had explicitly let go of, and the one case
      // where an author cannot simply reset the element, because the whole
      // point of adoption is that the element is theirs.
      //
      // `return` restores `cssText` wholesale below, so this is belt and
      // braces there and the only cleanup for the other two.
      target.removeAttribute("data-mk-adopted");
      for (const property of GEOMETRY_PROPERTY_NAMES) target.style.removeProperty(property);
      for (const property of [...target.style]) {
        if (property.startsWith(`--${this.prefix}-`)) target.style.removeProperty(property);
      }
      for (const attribute of [...target.attributes]) {
        if (attribute.name.startsWith("data-mk-")) target.removeAttribute(attribute.name);
      }
      const policy = node.adopted.onDestroy;
      if (policy === "remove") dom.remove(target);
      else if (policy === "return" && node.adopted.parent) {
        target.style.cssText = node.adopted.cssText;
        node.adopted.parent.insertBefore(target, node.adopted.next);
      }
    });

    this._registerId(node);
    this._mount(node);
    invalidate(node, MEASURE | ARRANGE);
    return this.handleFor(node);
  }

  // ── Published helpers ──────────────────────────────────────────────────
  // Plugins reach the engine only through public API (P3). These four exist
  // because the persistence plugin (§19) needs them and a back door would be
  // the wrong fix.

  /** The element context for a node — the same object its hooks receive. */
  contextFor(node) {
    return makeContext(nodeOf(node));
  }

  /**
   * Put the algorithm's formatting context on the element straight away.
   *
   * ARRANGE stages this every frame and remains the authority — but staged
   * writes flush in WRITE, and READ runs first. So on the frame a container is
   * created it was still `display: block` when its own intrinsic size was
   * measured: a row of children measured as a column, and the number that got
   * written was the width of the widest child rather than the width of the
   * row.
   *
   * Every algorithm's `css()` is a pure function of `algorithmOptions`, which
   * the element's `create` hook has already set by the time this runs — none
   * of them reads the frame or the layout context, which is what makes calling
   * it this early sound rather than merely convenient.
   */
  _applyAlgorithmCSS(node) {
    if (!node.el || !node.algorithm) return;
    const algorithm = this.registry.get("layout", node.algorithm);
    if (!algorithm || !algorithm.css) return;
    const styles = this.guard(node, `layout:${algorithm.name}.css`, algorithm.css, [node, null]);
    if (styles) dom.setStyles(node.el, styles);
  }

  /** Set dirty bits on a node (§6.2). */
  invalidateNode(node, bits) {
    return invalidate(nodeOf(node), bits);
  }

  /** Keep only the geometry keys of a bag — what a placeholder preserves. */
  geometryOnly(props) {
    const out = {};
    for (const key of Object.keys(props)) if (GEOMETRY_KEYS.has(key)) out[key] = props[key];
    return out;
  }

  /** `props: 'schema'` — reject anything the type does not declare (§21.4). */
  filterToSchema(props, definition) {
    const out = {};
    for (const key of Object.keys(props)) {
      if (RAW_DOM_KEYS.has(key)) {
        // Structural, but also the only two structural keys that write
        // straight to the DOM. §21.4 asks `props: 'schema'` to reject anything
        // the type does not declare precisely because props reach DOM sinks,
        // and a restored node free to set its own `style` can be positioned
        // over the UI it was restored into. Neither is needed to rebuild a
        // layout: geometry is, and geometry is kept.
        warn("MK4015", __MK_DEV__ &&
          `restore dropped '${key}': presentation is not restorable under \`props: 'schema'\``, {
          subject: `${definition.type}.${key}`
        });
        continue;
      }
      if (GEOMETRY_KEYS.has(key) || STRUCTURAL_KEYS.has(key) || key in definition.props) {
        out[key] = props[key];
      } else {
        warn("MK4015", __MK_DEV__ &&
          `restore dropped '${key}': not declared by '${definition.type}'`, {
          subject: `${definition.type}.${key}`
        });
      }
    }
    return out;
  }

  // ── Traits (§9) ────────────────────────────────────────────────────────

  _attachTraits(node, definition, options) {
    const requested = [...(definition.traits || []), ...(options.traits || [])];
    for (const entry of requested) {
      const name = typeof entry === "string" ? entry : entry.name;
      // Three sources, in order of specificity: the create() call, whatever the
      // element's own `create` hook staged for the trait it composes, and the
      // entry itself. Without the middle one an element cannot pass its props
      // through to a trait, and every trait grows a second configuration
      // surface to compensate.
      const staged = node.state.traitOptions && node.state.traitOptions[name];
      const traitOptions = typeof entry === "string" ? options[name] || staged : entry.options;
      this.attachTrait(node, name, traitOptions);
    }
  }

  /** Attach a trait, resolving its dependencies and rejecting conflicts. */
  attachTrait(node, name, options) {
    const target = nodeOf(node);
    if (target.traits.has(name)) return target.traits.get(name).api;

    const trait = this.registry.get("trait", name);
    if (!trait) {
      warn("MK3008", __MK_DEV__ &&
        `unknown trait '${name}' on '${target.type}'; it is skipped`, {
        subject: `${target.type}:${name}`
      });
      return undefined;
    }
    for (const required of trait.requires || []) {
      if (!target.traits.has(required)) this.attachTrait(target, required, undefined);
      if (!target.traits.has(required)) {
        warn("MK3009", __MK_DEV__ &&
          `trait '${name}' requires '${required}', which is not registered`, {
          subject: `${target.type}:${name}`
        });
        return undefined;
      }
    }
    for (const conflict of trait.conflicts || []) {
      if (target.traits.has(conflict)) {
        warn("MK3010", __MK_DEV__ &&
          `trait '${name}' conflicts with '${conflict}' already attached to '${target.type}'`,
          { subject: `${target.type}:${name}` }
        );
        return undefined;
      }
    }

    const ctx = makeContext(target);
    // A trait may ship styles, injected once per instance like an element
    // type's (§12.2). Without this a trait that sets a state flag has no way
    // to say what that flag should look like.
    if (trait.styles) this.styles.add(trait.styles, "mutakit.element", `trait:${name}`);

    const record = { trait, api: {}, options: options || null };
    target.traits.set(name, record);

    const produced = this.guard(target, `trait:${name}.attach`, trait.attach || noop, [
      ctx,
      record.options || {}
    ]);
    if (produced && typeof produced === "object") {
      // Descriptors, not `Object.assign`: a trait's `get visible()` is a live
      // read of its own state, and assignment would copy the value it happened
      // to have at attach time and freeze it there forever.
      Object.defineProperties(record.api, Object.getOwnPropertyDescriptors(produced));
    }
    if (trait.api) {
      for (const key of Object.keys(trait.api)) {
        record.api[key] = (...args) => trait.api[key](ctx, ...args);
      }
    }
    return record.api;
  }

  detachTrait(node, name) {
    const target = nodeOf(node);
    const record = target.traits.get(name);
    if (!record) return false;
    if (record.trait.detach) {
      this.guard(target, `trait:${name}.detach`, record.trait.detach, [makeContext(target), record.api]);
    }
    target.traits.delete(name);
    return true;
  }

  // ── Accessibility (§14, P5) ────────────────────────────────────────────

  _applyA11y(node, definition) {
    if (!node.el || !definition) return;
    const a11y = definition.a11y;
    if (a11y === undefined) return;
    if (a11y === "presentation" || a11y === false) {
      node.el.setAttribute("role", "presentation");
      return;
    }
    const ctx = makeContext(node);
    if (a11y.role) dom.setAttr(node.el, "role", resolveA11yValue(a11y.role, ctx));
    if (a11y.props) {
      for (const name of Object.keys(a11y.props)) {
        dom.setAttr(node.el, name, resolveA11yValue(a11y.props[name], ctx));
      }
    }
  }

  // ── Declarative wiring (§18.2) ─────────────────────────────────────────

  _bindDeclarativeEvents(node, options) {
    if (options.on) {
      for (const name of Object.keys(options.on)) {
        node.own(addNodeListener(node, name, options.on[name]));
      }
    }
    if (options.command) this._bindCommand(node, options.command);
  }

  /**
   * `{ type: 'button', command: 'close' }` walks *up* the node tree to the
   * nearest ancestor declaring that command and invokes it. An unresolved
   * command is MK3011 at build time, not a silent no-op on click (§18.2).
   */
  _bindCommand(node, command) {
    const [targetId, name] = command.indexOf(":") !== -1 ? command.split(":") : [null, command];
    const resolve = () => {
      if (targetId) {
        const byId = this.ids.get(targetId);
        return byId && byId.definition && byId.definition.commands[name] ? byId : null;
      }
      for (let current = node.parent; current; current = current.parent) {
        if (current.definition && current.definition.commands && current.definition.commands[name]) {
          return current;
        }
      }
      return null;
    };

    node.own(
      addNodeListener(node, "activate", () => {
        const owner = resolve();
        if (!owner) {
          warn("MK3011", __MK_DEV__ &&
            `command '${command}' did not resolve: no ancestor of '${node.type}' declares it`,
            { subject: `${node}:${command}` }
          );
          return;
        }
        this.guard(owner, `command:${name}`, owner.definition.commands[name], [makeContext(owner)]);
      })
    );

    if (__MK_DEV__) {
      // Report at build time rather than on the first click.
      this.scheduler.whenIdle(() => {
        if (node.destroyed) return;
        if (!resolve()) {
          warn("MK3011", __MK_DEV__ &&
            `command '${command}' on '${node.type}' has no owner in the tree; ` +
              `declare it in an ancestor's \`commands\`, or target one by id ` +
              `(command: 'someId:${name}')`,
            { subject: `${node}:${command}` }
          );
        }
      });
    }
  }

  // ── Identity and lookup (§8.9) ─────────────────────────────────────────

  _registerId(node) {
    if (!node.id) return;
    const existing = this.ids.get(node.id);
    if (existing && !existing.destroyed) {
      // A duplicate id is a diagnostic, not an error: lookup returns the
      // first and both elements keep working. Silently breaking a running UI
      // over a name collision would be the wrong trade.
      warn("MK4005", __MK_DEV__ &&
        `duplicate id '${node.id}'; lookup returns the first`, { subject: node.id });
      return;
    }
    this.ids.set(node.id, node);
    const count = this._instanceCounts.get(node.type) || 0;
    this._instanceCounts.set(node.type, count + 1);
  }

  byId(id) {
    const node = this.ids.get(id);
    return node && !node.destroyed ? this.handleFor(node) : null;
  }

  /**
   * A full-frame host in a named layer band — `mk.layer('hud', …)` (§16.1).
   *
   * Every overlay family already reaches its band by declaring `layer` on the
   * type, but a *layer itself* had no spelling: §18.5 opens the HUD example
   * with this line, and building it by hand meant knowing which type hosts a
   * band and repeating the four edge constraints that make it full-frame.
   *
   * A band with a `<name>-layer` type registered uses it — `hud` has one, and
   * it carries the pointer-transparency and safe-area insets that make a HUD a
   * HUD. Any other band gets a plain `pane` assigned to it, which is what a
   * plugin registering a new band would otherwise write itself.
   */
  layer(name, options) {
    const type = this.registry.get("type", `${name}-layer`) ? `${name}-layer` : "pane";
    const props = { left: 0, top: 0, right: 0, bottom: 0, ...(options || {}), layer: name };
    return this.create(type, props);
  }

  /** A small selector language over the node tree: type, #id, .state. */
  query(selector, scope) {
    const all = this.queryAll(selector, scope);
    return all.length ? all[0] : null;
  }

  queryAll(selector, scope) {
    const match = compileSelector(selector);
    const roots = scope ? [nodeOf(scope)] : this.roots;
    const out = [];
    for (const root of roots) {
      root.walk((node) => {
        if (node !== root && match(node)) out.push(this.handleFor(node));
      });
    }
    return out;
  }

  handleFor(node) {
    if (!node) return null;
    let handle = this.handles.get(node);
    if (!handle) {
      handle = new Handle(node);
      this.handles.set(node, handle);
    }
    return handle;
  }

  className(type) {
    return `${this.prefix}-${type.replace(":", "-")}`;
  }

  // ── Layout algorithms (§7) ─────────────────────────────────────────────

  /**
   * Replace a node's algorithm and create the children it describes. Returns
   * one handle per child, so `const [left, right] = app.split({…})` reads
   * exactly like §5.9.
   */
  applyAlgorithm(node, name, options) {
    const target = nodeOf(node);
    const algorithm = this.registry.get("layout", name);
    if (!algorithm) {
      const known = this.registry.names("layout").join(", ");
      return fail("MK2001", __MK_DEV__ &&
        `unknown layout algorithm '${name}'. Registered: ${known}`, {
        subject: name
      });
    }

    const opts = options || {};
    target.algorithm = name;
    target.algorithmOptions = algorithm.schema
      ? validateAll(algorithm.schema, opts, { strict: false }).values
      : { ...opts };
    // Same reason as at create: the children built below measure in the next
    // READ, which comes before the WRITE that would otherwise establish the
    // formatting context they are measured in.
    if (target.el) target.el.setAttribute("data-mk-algorithm", name);
    this._applyAlgorithmCSS(target);

    const created = [];
    const describedChildren = algorithm.childrenFrom ? algorithm.childrenFrom(opts) : null;
    if (describedChildren) {
      for (const spec of describedChildren) {
        const { type = "pane", ...rest } = spec;
        created.push(this.create(type, rest, target));
      }
    }

    // After the children, not before: `split` inserts a gutter between every
    // adjacent pair, and it cannot do that until the pairs exist.
    if (algorithm.setup) {
      this.guard(target, `layout:${name}.setup`, algorithm.setup, [
        target,
        makeLayoutContext(target, this)
      ]);
    }

    for (const child of target.children) this._validateLayoutProps(child);
    invalidate(target, "arrange");
    // An algorithm whose children are *named* rather than ordered says so, and
    // gets the parent handle back instead of an array — `shell.region('body')`
    // reads at the call site, where `created[2]` asks the author to know the
    // order the implementation happened to build them in.
    if (algorithm.returns === "self") return this.handleFor(target);
    return created.length ? created : this.handleFor(target);
  }

  /** Compile a `Len` list into a grid track template (§7.3, §7.5). */
  compileTracks(node, axis, lens, options) {
    const opts = options || {};
    const out = [];
    for (const len of lens) {
      if (len && len.raw) out.push(len.raw);
      else out.push(toCSS(parse(len), { units: (name) => this.registry.get("unit", name) }));
    }
    return opts.join === false ? out : out.join(" ");
  }

  /** The evaluation context `Len.toNumber` needs (§5.2). */
  lenContext(basis, node) {
    return {
      basis,
      metrics: this.metrics.current,
      units: (name) => this.registry.get("unit", name),
      vars: node && node.el ? (name) => dom.readCustomProperty(node.el, name) : undefined,
      intrinsic: node && node.measured ? node.measured.w : undefined
    };
  }

  /** Read a design token as a number, from the metrics snapshot (§8.2). */
  tokenPx(name, fallback, node) {
    const key = name.indexOf("--") === 0 ? name : `--${this.prefix}-${name}`;
    if (!this._tokenCache) this._tokenCache = new Map();
    const cacheKey = key + "@" + this.metrics.current.time;
    if (this._tokenCache.has(key) && this._tokenCache.get(key).time === this.metrics.current.time) {
      return this._tokenCache.get(key).value;
    }
    let value = fallback;
    const host = (node && node.el) || (this.root && this.root.el);
    if (host) {
      const raw = dom.readCustomProperty(host, key);
      if (raw) {
        const n = toNumber(parse(raw), this.lenContext(0, node));
        if (isFinite(n)) value = n;
      }
    }
    this._tokenCache.set(key, { time: this.metrics.current.time, value, cacheKey });
    return value;
  }

  applyTheme(name, node) {
    const theme = this.registry.get("theme", name);
    const host = (node && node.el) || (this.root && this.root.el);
    if (!host) return this;
    if (!theme) {
      host.setAttribute("data-mk-theme", String(name));
      return this;
    }
    host.setAttribute("data-mk-theme", theme.name);
    if (theme.tokens) {
      for (const token of Object.keys(theme.tokens)) host.style.setProperty(token, theme.tokens[token]);
    }
    return this;
  }

  // ── The frame passes ───────────────────────────────────────────────────

  _read(time) {
    this.metrics.take(time);
    const changed = this.metrics.diff();
    if (changed.length) {
      for (const root of this.roots) {
        emit(root, "metrics:change", { changed, metrics: this.metrics.current }, { bubbles: false });
        // A viewport-sized root, safe-area change, or scrollbar change all
        // move geometry, so the whole tree re-arranges.
        invalidate(root, "arrange");
      }
    }

    const nodes = [];
    for (const root of this.roots) root.walk((node) => nodes.push(node));
    this.measurer.read(nodes, (node) => makeContext(node));
    this._readBack(nodes);
  }

  /**
   * Record boxes the engine does not compute (§7.6).
   *
   * `flow` hands its children to normal document flow and works out nothing
   * itself, so their `computed` rects stayed at zero — and `computed` is what
   * `handle.rect()` returns, what hit-testing uses, and what §23.2's layout
   * snapshot serializes. A tree with prose in it dumped a subtree of zeroes
   * and the flagship regression technique quietly said nothing about it.
   *
   * §7.5 already states the intent for `grid`: the browser resolves the boxes,
   * and ARRANGE records the same numbers so snapshots and hit tests have them.
   * `grid` can derive them arithmetically; `flow` cannot — text wrapping is not
   * something to reimplement — so it reads them. Here, in READ, which is the
   * phase where reading is legal (P4).
   */
  _readBack(nodes) {
    for (const node of nodes) {
      const parent = node.parent;
      if (!node.el || !parent || parent.algorithm !== "flow") continue;
      const box = dom.offsetBox(node.el);
      node.computed.x = box.x;
      node.computed.y = box.y;
      node.computed.w = box.w;
      node.computed.h = box.h;
    }
  }

  _arrange() {
    for (const root of this.roots) {
      this._sizeRoot(root);
      this._arrangeNode(root);
    }
  }

  _sizeRoot(root) {
    let w = 0;
    let h = 0;
    if (root.sizing === "viewport") {
      w = this.metrics.current.vw;
      h = this.metrics.current.vh;
    } else if (root.sizing === "fixed" && root.fixedSize) {
      w = root.fixedSize.w;
      h = root.fixedSize.h;
    } else if (root.el) {
      const box = dom.rectOf(root.el);
      w = box.w;
      h = box.h;
      if ((w === 0 || h === 0) && !root._zeroReported) {
        root._zeroReported = true;
        warn("MK1001", __MK_DEV__ &&
          `the mount target measured ${w}×${h}. Give it a size in CSS, or mount with ` +
            `{ sizing: 'viewport' } for a full-screen app.`,
          { subject: root.el.tagName ? root.el.tagName.toLowerCase() : "root" }
        );
      }
    }
    root.computed.x = 0;
    root.computed.y = 0;
    root.computed.w = w;
    root.computed.h = h;
  }

  _arrangeNode(node) {
    if (!(node.flags & ARRANGE)) {
      for (const child of node.children) this._arrangeNode(child);
      return;
    }

    node.effectiveInsets = node.insets.compose(this.metrics.current, node.geometry.insets);
    const insets = node.effectiveInsets;
    node.frame.x = insets.left;
    node.frame.y = insets.top;
    node.frame.w = Math.max(0, node.computed.w - insets.left - insets.right);
    node.frame.h = Math.max(0, node.computed.h - insets.top - insets.bottom);
    this.compiler.setInsets(node, insets);

    const algorithm = this.registry.get("layout", node.algorithm || "anchor");
    if (!algorithm) {
      warn("MK2001", __MK_DEV__ &&
        `unknown layout algorithm '${node.algorithm}'; falling back to 'anchor'`, {
        subject: node.toString()
      });
      node.algorithm = "anchor";
    }
    const resolved = algorithm || this.registry.get("layout", "anchor");
    // The container's algorithm is expressed as a data attribute so the base
    // stylesheet can hand ownership of a child's box to flow (§9.1).
    this.compiler.setState(node, "algorithm", resolved ? resolved.name : "anchor");
    if (resolved) this.styles.ensureLayout(resolved);

    if (resolved && node.children.length) {
      const ctx = makeLayoutContext(node, this);
      // Overlays are portalled to their layer (§16.2), so the parent's
      // algorithm never sees them. Without this a `modal` created under a
      // `split` becomes a *pane*: it takes a track, and every real pane
      // shrinks to make room for it. The layer band already governs where it
      // sits; the parent's tracks have nothing to say about it.
      const inFlow = node.children.filter((child) => !isPortalled(child));
      const portalled = node.children.filter(isPortalled);
      this.guard(node, `layout:${resolved.name}.arrange`, resolved.arrange || noop, [
        node,
        inFlow,
        ctx
      ]);
      // A portalled child resolves against the frame of the root it belongs
      // to, which is what makes `of: 'viewport'` correct however deeply the
      // overlay was declared (§5.11 rule 3).
      for (const child of portalled) {
        const host = child.root || node;
        this.resolveBox(child, host.frame, host);
      }
      if (resolved.css) {
        const styles = this.guard(node, `layout:${resolved.name}.css`, resolved.css, [node, ctx]);
        if (styles) for (const key of Object.keys(styles)) this.compiler.setStyle(node, key, styles[key]);
      }
    }

    // The element's own arrange hook runs after the algorithm, so it can
    // adjust what the algorithm decided rather than fight it.
    if (node.definition) {
      for (const hook of node.definition.hooks.arrange) {
        this.guard(node, "arrange", hook, [makeContext(node), node.computed]);
      }
    }

    clear(node, ARRANGE);
    for (const child of node.children) this._arrangeNode(child);
  }

  /**
   * Resolve one child's box against its parent frame using edge constraints
   * and anchors (§5.5–§5.8). Shared by every algorithm that positions children
   * independently — `anchor`, `free`, and the overlay path.
   */
  resolveBox(child, containerFrame, container) {
    const geometry = child.geometry;
    // An element opts out of the frame's insets by naming them, so a HUD
    // element can ignore application chrome while its neighbour respects it
    // (§5.7). The filter belongs to the *child*, the contributions to the
    // parent, which is why the frame is recomputed here rather than reused.
    const parent = container || child.parent;
    const frame =
      geometry.insets === undefined || !parent
        ? containerFrame
        : frameWithInsets(parent, this.metrics.current, geometry.insets);
    const specs = axisSpecs(geometry, { direction: this.options.direction });
    const measured = child.measured || { w: 0, h: 0 };

    const hasEdges =
      specs.x.start != null || specs.x.end != null || specs.y.start != null || specs.y.end != null;

    const x = resolveAxis(specs.x, {
      basis: frame.w,
      intrinsic: measured.w,
      lenCtx: this.lenContext(frame.w, child),
      subject: child.toString()
    });
    const y = resolveAxis(specs.y, {
      basis: frame.h,
      intrinsic: measured.h,
      lenCtx: this.lenContext(frame.h, child),
      subject: child.toString()
    });

    let box = { x: x.start, y: y.start, w: x.size, h: y.size };

    // With no edges given, `at`/`anchor`/`offset`/`inset` place the box.
    if (!hasEdges && (geometry.at != null || geometry.anchor != null || geometry.inset != null)) {
      const container = { x: 0, y: 0, w: frame.w, h: frame.h };
      const options = {
        direction: this.options.direction,
        lenCtx: this.lenContext(frame.w, child),
        // §10.5's anchor keywords, looked up the way §10.4's units are. Bound
        // once per instance rather than rebuilt here: this runs for every
        // anchored child on every arranged frame, and a fresh closure per call
        // is the kind of allocation a 200-node drag notices.
        anchors: this._anchorLookup
      };
      box = place(container, { w: box.w, h: box.h }, geometry, options);
      const nudge = insetOffset(geometry.at, geometry.inset, options);
      box.x += nudge.x;
      box.y += nudge.y;
    }

    if (geometry.keepWithin !== false) {
      const bounds = { x: 0, y: 0, w: frame.w, h: frame.h };
      if (geometry.keepWithin === true || geometry.keepWithin === undefined) {
        // The default containment is soft: it never resizes, only slides, and
        // only when the box would leave the frame entirely.
        if (box.w <= frame.w && box.h <= frame.h) box = R.clamp(box, bounds);
      }
    }

    box.x += frame.x;
    box.y += frame.y;

    child.computed.x = box.x;
    child.computed.y = box.y;
    child.computed.w = box.w;
    child.computed.h = box.h;
    child.sizeIsFixed = x.mode === "fixed" && y.mode === "fixed";
    // Recorded so devtools can answer "why is my box the wrong size" (§5.8).
    // The priority system is only worth having if the outcome is inspectable.
    const dropped = [...x.dropped.map((n) => `x.${n}`), ...y.dropped.map((n) => `y.${n}`)];
    child.droppedConstraints = dropped.length ? dropped : null;
    this.compiler.setRect(child, child.computed);
    return child.computed;
  }

  _write() {
    let written = 0;
    for (const root of this.roots) {
      root.walk((node) => {
        written += this.compiler.flush(node);
        clear(node, STYLE);
      });
    }
    return written;
  }

  _paint(time) {
    for (const root of this.roots) {
      root.walk((node) => {
        if (!(node.flags & PAINT)) return;
        clear(node, PAINT);
        if (!node.definition) return;
        for (const hook of node.definition.hooks.paint) {
          this.guard(node, "paint", hook, [makeContext(node), time]);
        }
      });
    }
  }

  // ── Public loop control ────────────────────────────────────────────────

  /** Force a synchronous flush. Tests use this constantly. */
  tick(time) {
    this.scheduler.tick(time);
    return this;
  }

  /** Resolve once the loop is idle. `{ animations: false }` skips motion. */
  /**
   * Resolve once the loop is idle.
   *
   * `{ animations: false }` finishes every running animation *and* awaits the
   * teardowns their exits were holding open — which is what §17 promises tests
   * so that a snapshot never races an animation.
   */
  async flush(options) {
    if (options && options.animations === false) {
      const motion = this.services.get("motion");
      if (motion) motion.finishAll();
      // Each settled exit may start another (a subtree unwinding), so drain.
      let guard = 0;
      while (this.exiting.size && guard++ < 32) {
        await Promise.all([...this.exiting]);
        if (motion) motion.finishAll();
      }
    }
    return new Promise((resolve) => this.scheduler.whenIdle(resolve));
  }

  /** A `{ key: [x, y, w, h] }` dump of the resolved tree (§23.2). */
  snapshot(scope) {
    const target = nodeOf(scope) || this.root;
    return target ? snapshot(target) : {};
  }

  // ── Teardown ───────────────────────────────────────────────────────────

  destroyInstance() {
    for (const root of this.roots.slice()) {
      for (const child of root.children.slice()) this.destroy(child);
      root.releaseOwned();
    }
    this.roots.length = 0;
    if (this._inputSources) {
      for (const stop of this._inputSources.values()) stop();
      this._inputSources.clear();
    }
    for (const service of this.services.values()) if (service && service.destroy) service.destroy();
    this.services.clear();
    this.styles.destroy();
    this.measurer.destroy();
    this.metrics.destroy();
    this.scheduler.destroy();
    this.ids.clear();
    this.destroyed = true;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Signals reachable in a geometry value — `240`, `{ w: signal }`, `[a, b]`.
 * One level of nesting is all the geometry vocabulary has (§5.3).
 */
function signalsIn(value) {
  if (isSignal(value)) return [value];
  if (!value || typeof value !== "object") return [];
  const out = [];
  for (const inner of Object.keys(value)) {
    if (isSignal(value[inner])) out.push(value[inner]);
  }
  return out;
}

/** Per-instance service factories, contributed by presets and plugins. */
const SERVICE_FACTORIES = new Map();

/** Register a service factory. `factory(mk)` returns the service instance. */
export function registerService(name, factory) {
  SERVICE_FACTORIES.set(name, factory);
}

const GEOMETRY_PROPERTY_NAMES = GEOMETRY_PROPERTIES;

/**
 * The definition an adopted node carries. It declares no props and no
 * lifecycle, which is exactly the adoption contract: Mutakit sizes and
 * positions the node and touches nothing else (§8.8).
 */
const ADOPTED_DEFINITION = {
  type: "adopted",
  version: "1.0.0",
  origin: "core",
  props: Object.create(null),
  childProps: Object.create(null),
  geometry: null,
  traits: [],
  algorithm: "anchor",
  slots: null,
  layer: null,
  commands: {},
  events: [],
  a11y: undefined,
  keys: {},
  styles: [],
  tokens: null,
  motion: null,
  shadow: false,
  virtual: false,
  hooks: {
    create: [],
    mount: [],
    update: [],
    measure: [],
    arrange: [],
    paint: [],
    unmount: [],
    destroy: [],
    serialize: [],
    restore: []
  }
};

function noop() {}

/** Layers at or above `overlay` sit outside the parent's flow entirely. */
const PORTALLED_LAYERS = new Set(["overlay", "modal", "popover", "tooltip", "toast", "devtools"]);

function isPortalled(node) {
  return !!node.layer && PORTALLED_LAYERS.has(node.layer);
}

/** A container's frame with only the inset contributions `filter` names. */
function frameWithInsets(parent, metrics, filter) {
  const insets = parent.insets.compose(metrics, filter);
  return {
    x: insets.left,
    y: insets.top,
    w: Math.max(0, parent.computed.w - insets.left - insets.right),
    h: Math.max(0, parent.computed.h - insets.top - insets.bottom)
  };
}

/**
 * Dev-only reporting, extracted into a function on purpose.
 *
 * A `for…of` sitting directly inside `if (__MK_DEV__) { … }` survives production
 * minification as `if (!1) { … }` — the branch is folded but not pruned, so
 * the strings ship. A bare call *is* pruned, and the function then tree-shakes
 * away. Measured with esbuild 0.28; it is the reason dev blocks in this
 * codebase delegate rather than inline.
 */
function reportUndeclaredProps(node, names) {
  names.forEach((name) => {
    warn("MK3004", __MK_DEV__ &&
      `'${name}' is not declared in the props schema of '${node.type}'; it is kept but ` +
        `nothing reads it. Declare it in \`props\` to get validation, types, and docs.`,
      { subject: `${node.type}.${name}` }
    );
  });
}

function nodeOf(value) {
  if (!value) return null;
  if (value instanceof LayoutNode) return value;
  return value.node || null;
}

function addNodeListener(node, name, fn) {
  return addListener(node, name, fn);
}

function resolveA11yValue(value, ctx) {
  return typeof value === "function" ? value(ctx) : value;
}

/** Compile `'modal#settings.open'` into a predicate over nodes (§8.9). */
function compileSelector(selector) {
  const parts = String(selector).trim().split(/\s+/);
  const compiled = parts.map((part) => {
    const type = /^[^#.\[]*/.exec(part)[0];
    const id = /#([^.\[]+)/.exec(part);
    const states = [...part.matchAll(/\.([^.#\[]+)/g)].map((m) => m[1]);
    return (node) => {
      if (type && type !== "*" && node.type !== type) return false;
      if (id && node.id !== id[1]) return false;
      for (const state of states) {
        if (!node.el || !node.el.hasAttribute(`data-mk-${state}`)) return false;
      }
      return true;
    };
  });
  // Only the last simple selector is matched against the node; ancestors are
  // matched loosely, which is enough for the uses in §8.9 and keeps this small.
  return (node) => {
    if (!compiled[compiled.length - 1](node)) return false;
    let index = compiled.length - 2;
    for (let ancestor = node.parent; ancestor && index >= 0; ancestor = ancestor.parent) {
      if (compiled[index](ancestor)) index--;
    }
    return index < 0;
  };
}
