/**
 * `ctx` — the element context (§8.2).
 *
 * The only surface a plugin sees. Nothing else is reachable, and that is the
 * enforcement mechanism for P3: if a built-in needs a capability this object
 * does not offer, the fix is to add a public extension point, never a private
 * back door.
 *
 * `ctx.own()` is deliberately prominent. Every listener, observer, timer, and
 * animation a plugin creates goes through it, and `destroy` runs them in
 * reverse order automatically — which is why passing the leak test (§23.5) is
 * the default rather than an achievement.
 */
import "../core/dev.js";
import * as dom from "../core/dom.js";
import { fail, warn } from "../core/diagnostics.js";
import { addListener, emit as emitEvent } from "../core/events.js";
import { effect } from "../core/signals.js";
import { toNumber, parse } from "../geometry/len.js";
import { invalidate } from "./invalidate.js";

/** Build the context an element's lifecycle hooks receive. */
export function makeContext(node) {
  const mk = node.mk;
  const cached = node._ctx;
  if (cached) return cached;

  const ctx = {
    node,
    get el() {
      return node.el;
    },
    get props() {
      return node.props;
    },
    get state() {
      return node.state;
    },
    get mk() {
      return mk;
    },
    get dev() {
      return __MK_DEV__ ? mk.dev : null;
    },

    /** Child handles; add, remove, reorder. */
    get children() {
      return node.children.map((child) => mk.handleFor(child));
    },

    get slots() {
      return node.slots;
    },

    /** Read the resolved rect. Valid in ARRANGE and PAINT only (P4). */
    get geometry() {
      mk.scheduler.assertReadable(node.toString());
      return node.computed;
    },

    /** Declared geometry inputs — write to re-constrain the element. */
    constrain(values) {
      Object.assign(node.geometry, values);
      invalidate(node, "arrange");
      return ctx;
    },

    emit(name, detail, options) {
      if (__MK_DEV__ && !mayEmit(node, name)) {
        fail("MK3003", __MK_DEV__ &&
          `'${node.type}' emitted '${name}', which neither it nor its attached traits ` +
            `declare in \`events\`. Add it to the definition, or emit a declared name.`,
          { subject: node.toString() }
        );
      }
      return emitEvent(node, name, detail, options);
    },

    on(name, fn, options) {
      return node.own(addListener(node, name, fn, options));
    },

    invalidate(bits) {
      invalidate(node, bits);
      return ctx;
    },

    service(name) {
      return mk.service(name);
    },

    trait(name) {
      const record = node.traits.get(name);
      return record ? record.api : undefined;
    },

    gesture(name, handlers) {
      const gestures = mk.service("gestures");
      if (!gestures) {
        warn("MK3008", __MK_DEV__ &&
          `the gestures service is not installed; '${name}' is inert`, {
          subject: node.toString()
        });
        return () => {};
      }
      return node.own(gestures.attach(node, name, handlers));
    },

    /** Create a DOM element, tracked for automatic teardown. */
    dom(tag, attrs, parent) {
      const element = dom.el(tag, attrs, parent === undefined ? node.contentEl || node.el : parent);
      node.own(() => dom.remove(element));
      return element;
    },

    /** Write custom properties; diffed by the style compiler (§6.6). */
    css(props) {
      mk.compiler.setAll(node, props);
      invalidate(node, "style");
      return ctx;
    },

    /** Set a state flag: a data attribute plus its `--mk-state-*` mirror. */
    setState(name, value) {
      mk.compiler.setState(node, name, value);
      invalidate(node, "style");
      return ctx;
    },

    /**
     * Read a design token as a number, from the frame's metrics snapshot —
     * never a live `getComputedStyle` (§8.2).
     */
    tokenPx(name, fallback) {
      return mk.tokenPx(name, fallback, node);
    },

    /** Resolve a `Len` against this node's frame, on `axis` ('x' | 'y'). */
    len(value, axis) {
      const frame = node.parent ? node.parent.frame : node.frame;
      const basis = axis === "y" ? frame.h : frame.w;
      return toNumber(parse(value), mk.lenContext(basis, node));
    },

    /** Register cleanup. The main defence against leaks. */
    own(disposable) {
      return node.own(disposable);
    },

    /** An effect scoped to this element; disposed with it. */
    effect(fn) {
      return node.own(effect(fn));
    },

    /** Announce through the polite or assertive live region (§14). */
    announce(message, urgency) {
      const announcer = mk.service("announcer");
      if (announcer) announcer.say(message, urgency);
    },

    /** Create a child element under this one. */
    create(type, props) {
      return mk.create(type, props, node);
    },

    /** The handle for this node — what commands return to authors. */
    get handle() {
      return mk.handleFor(node);
    }
  };

  node._ctx = ctx;
  return ctx;
}

/**
 * Whether `name` is declared somewhere on this node.
 *
 * A trait's `events` count as the node's: `focusable` emits `focus`, and the
 * element composing it never mentions focus anywhere. Checking only the
 * element's own declaration made every trait-emitted event a contract
 * violation — which is exactly backwards, since traits are the primary reuse
 * mechanism (§8.3) and their events are declared, just not by the element.
 */
function mayEmit(node, name) {
  if (INTERNAL_EVENTS.has(name)) return true;
  const declared = node.definition && node.definition.events;
  if (declared && declared.indexOf(name) !== -1) return true;
  for (const record of node.traits.values()) {
    if (record.trait.events && record.trait.events.indexOf(name) !== -1) return true;
  }
  return false;
}

/** Events every element may emit without declaring them. */
const INTERNAL_EVENTS = new Set([
  "error",
  "mount",
  "unmount",
  "destroy",
  "propschange",
  "geometrychange"
]);

/**
 * The layout-algorithm context (§8.2, last paragraph) — a separate, smaller
 * surface. An algorithm places children; it does not build DOM or emit events.
 */
export function makeLayoutContext(node, mk) {
  const frame = node.frame;
  return {
    node,
    frame,
    mk,
    get metrics() {
      return mk.metrics.current;
    },

    /** Resolve a `Len` against the container's frame on `axis`. */
    len(value, axis) {
      const basis = axis === "y" ? frame.h : frame.w;
      return toNumber(parse(value), mk.lenContext(basis, node));
    },

    /** Compile a `Len` list into a grid template string. */
    tracks(axis, lens, options) {
      return mk.compileTracks(node, axis, lens, options);
    },

    /** Assign a child's box directly, in frame space. */
    place(child, rect) {
      child.computed.x = rect.x;
      child.computed.y = rect.y;
      child.computed.w = rect.w;
      child.computed.h = rect.h;
      mk.compiler.setRect(child, child.computed);
      return child;
    },

    /** Stage a container-level custom property. */
    css(props) {
      mk.compiler.setAll(node, props);
    },

    /** Stage a plain CSS property on the container. */
    style(name, value) {
      mk.compiler.setStyle(node, name, value);
    },

    /** The validated `layout` bag of a child (§7.0). */
    childProps(child) {
      return child.layoutProps;
    }
  };
}
