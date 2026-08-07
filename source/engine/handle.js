/**
 * Handles — tier 1, the fluent JavaScript API (§18.1).
 *
 * Every `create`/`split` returns handles carrying the element's declared
 * `commands` as methods, which is the imperative escape hatch P2 promises. The
 * declarative object form remains canonical: it is what gets serialized,
 * restored, diffed, and shown in devtools.
 *
 * One handle exists per node, cached, so identity comparisons work and
 * commands can be attached once.
 */
import "../core/dev.js";
import { warn } from "../core/diagnostics.js";
import { addListener, emit } from "../core/events.js";
import { freeze } from "../geometry/rect.js";
import { invalidateGeometry } from "./invalidate.js";
import { makeContext } from "./ctx.js";

export class Handle {
  constructor(node) {
    this.node = node;
    this.mk = node.mk;
    attachCommands(this, node);
  }

  get type() {
    return this.node.type;
  }

  get id() {
    return this.node.id;
  }

  get el() {
    return this.node.el;
  }

  get destroyed() {
    return this.node.destroyed;
  }

  get parent() {
    return this.node.parent ? this.mk.handleFor(this.node.parent) : null;
  }

  get children() {
    return this.node.children.map((child) => this.mk.handleFor(child));
  }

  // ── Construction ─────────────────────────────────────────────────────

  /** Create a child element. */
  create(type, props) {
    return this.mk.create(type, props, this.node);
  }

  /** Build a subtree from the tier-2 declarative form (§18.2). */
  build(spec) {
    return this.mk.build(spec, this.node);
  }

  /**
   * Replace this node's layout algorithm with `split` and create its panes
   * (§7.3). Returns one handle per pane, so destructuring reads exactly like
   * the worked example in §5.9.
   */
  split(options) {
    return this.mk.applyAlgorithm(this.node, "split", options);
  }

  stack(options) {
    return this.mk.applyAlgorithm(this.node, "stack", options);
  }

  dock(options) {
    return this.mk.applyAlgorithm(this.node, "dock", options);
  }

  grid(options) {
    return this.mk.applyAlgorithm(this.node, "grid", options);
  }

  free(options) {
    return this.mk.applyAlgorithm(this.node, "free", options);
  }

  flow(options) {
    return this.mk.applyAlgorithm(this.node, "flow", options);
  }

  anchor(options) {
    return this.mk.applyAlgorithm(this.node, "anchor", options);
  }

  /** Adopt a DOM node under this one, taking over only its geometry (§8.8). */
  adopt(element, options) {
    return this.mk.adopt(element, options, this.node);
  }

  // ── Props and geometry ───────────────────────────────────────────────

  /** Update props. Values are validated and coerced through the schema. */
  set(props) {
    this.mk.setProps(this.node, props);
    return this;
  }

  get(name) {
    return name === undefined ? this.node.props : this.node.props[name];
  }

  /** Re-constrain geometry: sizes, anchors, edges (§5). */
  constrain(values) {
    Object.assign(this.node.geometry, values);
    invalidateGeometry(this.node);
    return this;
  }

  /** The resolved rect, as a frozen copy. Valid outside the WRITE phase. */
  rect() {
    this.mk.scheduler.assertReadable(this.node.toString());
    return freeze(this.node.computed);
  }

  /** The child-props bag the parent algorithm reads (§7.0). */
  layout(values) {
    if (values === undefined) return this.node.layoutProps;
    this.mk.setLayoutProps(this.node, values);
    return this;
  }

  // ── Events ───────────────────────────────────────────────────────────

  on(name, fn, options) {
    return addListener(this.node, name, fn, options);
  }

  once(name, fn) {
    return addListener(this.node, name, fn, { once: true });
  }

  emit(name, detail, options) {
    return emit(this.node, name, detail, options);
  }

  // ── Traits ───────────────────────────────────────────────────────────

  /** Attach a trait at runtime, or read an attached trait's API. */
  trait(name, options) {
    if (options === undefined) {
      const record = this.node.traits.get(name);
      return record ? record.api : undefined;
    }
    return this.mk.attachTrait(this.node, name, options);
  }

  // ── Lookup ───────────────────────────────────────────────────────────

  byId(id) {
    const found = this.node.find((n) => n.id === id && n !== this.node);
    return found ? this.mk.handleFor(found) : null;
  }

  query(selector) {
    return this.mk.query(selector, this.node);
  }

  queryAll(selector) {
    return this.mk.queryAll(selector, this.node);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /** Move this element under `parent`. Child props are re-validated (§7.0). */
  moveTo(parent, before) {
    this.mk.reparent(this.node, parent.node || parent, before && (before.node || before));
    return this;
  }

  show() {
    return this.set({ hidden: false });
  }

  hide() {
    return this.set({ hidden: true });
  }

  focus(options) {
    const focus = this.mk.service("focus");
    if (focus) focus.focus(this.node, options);
    else if (this.node.el && this.node.el.focus) this.node.el.focus(options);
    return this;
  }

  /** Remove from the tree and destroy. Exit animations run first (§17). */
  remove() {
    return this.mk.destroy(this.node);
  }

  destroy() {
    return this.mk.destroy(this.node);
  }

  /** The tier-2 form of this subtree (§19.1). */
  serialize(options) {
    return this.mk.serialize(this.node, options);
  }

  toString() {
    return `Handle(${this.node.toString()})`;
  }
}

/**
 * Bind declared commands as methods. A command receives `(ctx, ...args)` and
 * its return value passes through, except that returning `undefined` returns
 * the handle so chains keep working.
 */
function attachCommands(handle, node) {
  const commands = node.definition && node.definition.commands;
  if (!commands) return;
  for (const name of Object.keys(commands)) {
    if (name in handle) {
      warn("MK3002", __MK_DEV__ &&
        `command '${name}' on '${node.type}' shadows a built-in handle method and was skipped`,
        { subject: `${node.type}.${name}` }
      );
      continue;
    }
    const command = commands[name];
    handle[name] = function (...args) {
      const result = node.mk.guard(node, `command:${name}`, command, [makeContext(node), ...args]);
      return result === undefined ? handle : result;
    };
  }
}
