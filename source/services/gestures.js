/**
 * Gesture recognizers (§13.3).
 *
 * A gesture is a **state machine consuming the pointer stream**, and every one
 * moves through the same states — which is what makes them composable,
 * arbitrable, and testable:
 *
 *     possible ──▶ began ──▶ changed* ──▶ ended
 *         │          └──────────────────▶ cancelled
 *         └──▶ failed
 *
 * `failed` matters as much as `ended`: a `long-press` that sees movement beyond
 * its slop must fail *promptly* so a competing `drag` can begin without a
 * perceptible delay.
 *
 * **Recognizers here are pure reducers** — `step(state, event) → state` — with
 * no DOM, no timers, and no service in sight. That is not incidental tidiness:
 * §13.3 asks for them to be table-tested with scripted pointer traces, and a
 * reducer is the shape in which that test is possible at all. The service below
 * supplies the events and the clock; the recognizers never reach for either.
 */
import "../core/dev.js";
import { warn } from "../core/diagnostics.js";

export const POSSIBLE = "possible";
export const BEGAN = "began";
export const CHANGED = "changed";
export const ENDED = "ended";
export const CANCELLED = "cancelled";
export const FAILED = "failed";

/** A recognizer's initial state. `config` is whatever the author passed. */
function seed(config, extra) {
  return { phase: POSSIBLE, config: config || {}, ...extra };
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * `tap` — down and up inside the slop, within the time limit.
 *
 * It does **not** `requireFailure: ['double-tap']` by default: waiting for the
 * double-tap window to lapse costs perceived latency on every tap, and most
 * interfaces have no double-tap at all. Authors opt in where one exists.
 */
export const tap = {
  name: "tap",
  init: (config) => seed(config, { origin: null, start: 0 }),
  step(state, event) {
    const slop = state.config.slop == null ? 8 : state.config.slop;
    const limit = state.config.maxDuration == null ? 500 : state.config.maxDuration;

    switch (event.type) {
      case "down":
        return { ...state, phase: POSSIBLE, origin: event, start: event.time };
      case "move":
        if (!state.origin) return state;
        return distance(state.origin, event) > slop ? { ...state, phase: FAILED } : state;
      case "up": {
        if (!state.origin || state.phase === FAILED) return { ...state, phase: FAILED };
        const tooSlow = event.time - state.start > limit;
        const moved = distance(state.origin, event) > slop;
        return { ...state, phase: tooSlow || moved ? FAILED : ENDED, at: event };
      }
      case "cancel":
        return { ...state, phase: CANCELLED };
      case "tick":
        return event.time - state.start > limit && state.origin && state.phase === POSSIBLE
          ? { ...state, phase: FAILED }
          : state;
      default:
        return state;
    }
  }
};

/** `double-tap` — two taps inside the window, close together. */
export const doubleTap = {
  name: "double-tap",
  init: (config) => seed(config, { taps: 0, anchor: null, last: null, lastTime: 0 }),
  step(state, event) {
    const window = state.config.window == null ? 300 : state.config.window;
    const slop = state.config.slop == null ? 16 : state.config.slop;

    switch (event.type) {
      case "down": {
        const stale = state.taps === 1 && event.time - state.lastTime > window;
        // Measured against the *first* tap, not against this press. Comparing
        // each release to its own press means two taps anywhere on the screen
        // count as a double-tap, because each one is zero pixels from itself.
        const strayed = state.taps === 1 && state.anchor && distance(state.anchor, event) > slop;
        // A stale or strayed second press is not a failure — it is the *first*
        // press of a new potential double-tap, which is what a user who taps
        // twice in different places actually did. Emitting `failed` here would
        // make `requireFailure: ['double-tap']` release a competing `tap` one
        // press too early.
        if (stale || strayed) {
          return { ...state, taps: 0, anchor: event, last: event, lastTime: event.time, phase: POSSIBLE };
        }
        return {
          ...state,
          anchor: state.taps === 0 ? event : state.anchor,
          last: event,
          lastTime: event.time,
          phase: POSSIBLE
        };
      }
      case "up": {
        if (!state.last) return state;
        if (distance(state.last, event) > slop) return { ...state, taps: 0, phase: FAILED };
        const taps = state.taps + 1;
        if (taps >= 2) return { ...state, taps: 0, phase: ENDED, at: event };
        return { ...state, taps, lastTime: event.time, phase: POSSIBLE };
      }
      case "tick":
        return state.taps === 1 && event.time - state.lastTime > window
          ? { ...state, taps: 0, phase: FAILED }
          : state;
      case "cancel":
        return { ...state, taps: 0, anchor: null, phase: CANCELLED };
      default:
        return state;
    }
  }
};

/**
 * `long-press` — held past the threshold without moving.
 *
 * Fails on the *first* move beyond slop rather than at the deadline, which is
 * what lets a drag start immediately instead of after half a second of nothing.
 */
export const longPress = {
  name: "long-press",
  init: (config) => seed(config, { origin: null, start: 0 }),
  step(state, event) {
    const threshold = state.config.threshold == null ? 500 : state.config.threshold;
    const slop = state.config.slop == null ? 10 : state.config.slop;

    switch (event.type) {
      case "down":
        return { ...state, phase: POSSIBLE, origin: event, start: event.time };
      case "move":
        if (!state.origin || state.phase === BEGAN) return state;
        return distance(state.origin, event) > slop ? { ...state, phase: FAILED } : state;
      case "tick":
        if (state.phase !== POSSIBLE || !state.origin) return state;
        return event.time - state.start >= threshold
          ? { ...state, phase: BEGAN, at: state.origin }
          : state;
      case "up":
        return { ...state, phase: state.phase === BEGAN ? ENDED : FAILED, at: event };
      case "cancel":
        return { ...state, phase: CANCELLED };
      default:
        return state;
    }
  }
};

/** `drag` — began once past the threshold, then `changed` per move. */
export const drag = {
  name: "drag",
  init: (config) => seed(config, { origin: null, last: null }),
  step(state, event) {
    const threshold = state.config.threshold == null ? 4 : state.config.threshold;
    const axis = state.config.axis || "both";

    switch (event.type) {
      case "down":
        return { ...state, phase: POSSIBLE, origin: event, last: event };
      case "move": {
        if (!state.origin) return state;
        const dx = axis === "y" ? 0 : event.x - state.origin.x;
        const dy = axis === "x" ? 0 : event.y - state.origin.y;
        if (state.phase === POSSIBLE) {
          if (Math.hypot(dx, dy) < threshold) return state;
          return { ...state, phase: BEGAN, last: event, dx, dy };
        }
        return {
          ...state,
          phase: CHANGED,
          last: event,
          dx,
          dy,
          vx: event.x - state.last.x,
          vy: event.y - state.last.y
        };
      }
      case "up":
        return state.phase === POSSIBLE
          ? { ...state, phase: FAILED }
          : { ...state, phase: ENDED, at: event };
      case "cancel":
        return { ...state, phase: CANCELLED };
      default:
        return state;
    }
  }
};

/** `swipe` — a fast directional flick, decided on release. */
export const swipe = {
  name: "swipe",
  init: (config) => seed(config, { origin: null }),
  step(state, event) {
    const minDistance = state.config.distance == null ? 40 : state.config.distance;
    const maxDuration = state.config.maxDuration == null ? 500 : state.config.maxDuration;

    switch (event.type) {
      case "down":
        return { ...state, phase: POSSIBLE, origin: event };
      case "up": {
        if (!state.origin) return state;
        const dx = event.x - state.origin.x;
        const dy = event.y - state.origin.y;
        const elapsed = event.time - state.origin.time;
        if (elapsed > maxDuration || Math.hypot(dx, dy) < minDistance) {
          return { ...state, phase: FAILED };
        }
        const direction =
          Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        return { ...state, phase: ENDED, direction, dx, dy, at: event };
      }
      case "cancel":
        return { ...state, phase: CANCELLED };
      default:
        return state;
    }
  }
};

/**
 * `pinch` and `rotate` — two pointers, and always allowed together.
 *
 * They share a state shape because they read the same two points; declaring
 * `allowSimultaneous` for each other is what stops arbitration cancelling one
 * the moment the other claims.
 */
function twoPointerState(state, event) {
  const points = { ...state.points };
  if (event.type === "down" || event.type === "move") points[event.id] = event;
  if (event.type === "up" || event.type === "cancel") delete points[event.id];
  return points;
}

function pair(points) {
  const ids = Object.keys(points);
  return ids.length >= 2 ? [points[ids[0]], points[ids[1]]] : null;
}

export const pinch = {
  name: "pinch",
  allowSimultaneous: ["rotate"],
  init: (config) => seed(config, { points: {}, base: 0 }),
  step(state, event) {
    const points = twoPointerState(state, event);
    const both = pair(points);
    if (!both) {
      const ended = state.phase === BEGAN || state.phase === CHANGED;
      return { ...state, points, phase: ended ? ENDED : POSSIBLE };
    }
    const span = distance(both[0], both[1]);
    if (state.phase === POSSIBLE || !state.base) {
      return { ...state, points, base: span, scale: 1, phase: BEGAN };
    }
    return { ...state, points, phase: CHANGED, scale: span / state.base, span };
  }
};

export const rotate = {
  name: "rotate",
  allowSimultaneous: ["pinch"],
  init: (config) => seed(config, { points: {}, base: null }),
  step(state, event) {
    const points = twoPointerState(state, event);
    const both = pair(points);
    if (!both) {
      const ended = state.phase === BEGAN || state.phase === CHANGED;
      return { ...state, points, phase: ended ? ENDED : POSSIBLE, base: null };
    }
    const angle = (Math.atan2(both[1].y - both[0].y, both[1].x - both[0].x) * 180) / Math.PI;
    if (state.base == null) return { ...state, points, base: angle, rotation: 0, phase: BEGAN };
    return { ...state, points, phase: CHANGED, rotation: angle - state.base, angle };
  }
};

/** `wheel` — discrete, so it begins and ends on the same event. */
export const wheel = {
  name: "wheel",
  init: (config) => seed(config, {}),
  step(state, event) {
    if (event.type !== "wheel") return state;
    return { ...state, phase: CHANGED, dx: event.dx, dy: event.dy, at: event };
  }
};

/**
 * `scrub` — a horizontal drag that reports a delta scaled by sensitivity.
 *
 * The `number` control's drag-to-change uses this shape; having it as a
 * recognizer rather than bespoke code is what makes it arbitrable against a
 * competing `drag`.
 */
export const scrub = {
  name: "scrub",
  init: (config) => seed(config, { origin: null }),
  step(state, event) {
    const threshold = state.config.threshold == null ? 3 : state.config.threshold;
    const sensitivity = state.config.sensitivity == null ? 1 : state.config.sensitivity;

    switch (event.type) {
      case "down":
        return { ...state, phase: POSSIBLE, origin: event };
      case "move": {
        if (!state.origin) return state;
        const dx = event.x - state.origin.x;
        if (state.phase === POSSIBLE && Math.abs(dx) < threshold) return state;
        return { ...state, phase: state.phase === POSSIBLE ? BEGAN : CHANGED, delta: dx * sensitivity };
      }
      case "up":
        return state.phase === POSSIBLE ? { ...state, phase: FAILED } : { ...state, phase: ENDED };
      case "cancel":
        return { ...state, phase: CANCELLED };
      default:
        return state;
    }
  }
};

export const BUILT_IN = [tap, doubleTap, longPress, drag, swipe, pinch, rotate, wheel, scrub];

/**
 * The gesture service.
 *
 * Multiple recognizers observe the same pointer stream, so conflicts are the
 * normal case rather than the exception (§13.3). Resolution:
 *
 *   1. A recognizer **claims** the pointer when it transitions to `began`.
 *   2. Claiming cancels every other recognizer on that pointer, except those
 *      the claimant declares as `allowSimultaneous`.
 *   3. `requireFailure: ['double-tap']` lets one wait for another to lapse.
 *   4. Unclaimed pointers fall through to the browser. Mutakit never
 *      blanket-calls `preventDefault`.
 */
export class GestureService {
  constructor() {
    this.mk = null;
    this.attachments = new Map();
    this.claims = new Map();
  }

  attach(mk) {
    this.mk = mk;
    for (const recognizer of BUILT_IN) {
      mk.registry.set("gesture", recognizer.name, recognizer, { replace: true });
    }
    // Recognizers are driven from the INPUT phase, which is where §6.3 puts
    // gesture state machines — so their timeouts advance with the frame loop
    // and the fake clock drives them in tests.
    this._stop = mk.scheduler.on("input", (time) => this.tick(time));
  }

  /**
   * Attach `name` to `node` with `handlers`. Returns a disposable.
   *
   * `ctx.gesture(name, handlers)` routes here and hands the disposable to
   * `ctx.own`, so a recognizer cannot outlive the element that wanted it.
   */
  attachTo(node, name, handlers) {
    const recognizer = this.mk.registry.get("gesture", name);
    if (!recognizer) {
      warn("MK3008", __MK_DEV__ &&
        `unknown gesture '${name}'. Registered: ${this.mk.registry.names("gesture").join(", ")}`,
        { subject: `${node}:${name}` }
      );
      return () => {};
    }

    const config = (handlers && handlers.config) || {};
    const entry = {
      node,
      name,
      recognizer,
      handlers: handlers || {},
      config,
      state: recognizer.init(config)
    };
    const list = this.attachments.get(node) || [];
    list.push(entry);
    this.attachments.set(node, list);

    // The scroll-versus-drag conflict is handed to the compositor rather than
    // raced on the main thread (§13.3): `touch-action` is set to the complement
    // of the drag axis.
    if (node.el && (name === "drag" || name === "scrub")) {
      node.el.style.touchAction = touchActionFor(config.axis);
    }

    return () => {
      const index = list.indexOf(entry);
      if (index !== -1) list.splice(index, 1);
      if (!list.length) this.attachments.delete(node);
    };
  }

  /** Feed one normalized pointer event to every recognizer that wants it. */
  dispatch(node, event) {
    const list = this.attachments.get(node);
    if (!list || !list.length) return false;
    let claimed = false;

    for (const entry of list) {
      const previous = entry.state.phase;
      const next = entry.recognizer.step(entry.state, event);
      entry.state = next;
      if (next.phase !== previous || next.phase === CHANGED) {
        claimed = this._settle(list, entry, next, previous) || claimed;
      }
    }
    this._flushPending(list);
    return claimed;
  }

  /** Advance every live recognizer's clock, which is how timeouts resolve. */
  tick(time) {
    for (const list of this.attachments.values()) {
      for (const entry of list) {
        if (entry.state.phase !== POSSIBLE && entry.state.phase !== BEGAN) continue;
        const previous = entry.state.phase;
        const next = entry.recognizer.step(entry.state, { type: "tick", time });
        entry.state = next;
        if (next.phase !== previous) this._settle(list, entry, next, previous);
      }
      this._flushPending(list);
    }
  }

  /**
   * Whether `entry` must wait for another recognizer to fail.
   *
   * A required recognizer that has *ended* is not a block — it won, and the
   * waiting one should be dropped rather than released.
   */
  _blocker(list, entry) {
    const required = entry.config.requireFailure || entry.recognizer.requireFailure;
    if (!required || !required.length) return null;
    for (const name of required) {
      const other = list.find((candidate) => candidate.name === name);
      if (!other) continue;
      if (other.state.phase !== FAILED && other.state.phase !== CANCELLED) return other;
    }
    return null;
  }

  /**
   * Emit a phase, or park it until a `requireFailure` dependency settles.
   *
   * Parking the *emission* rather than skipping the *input* is the difference
   * between working and not: a recognizer denied its events never advances, so
   * the thing it was waiting for restarts forever and the waiter never fires.
   * Here both see every event, and only the outcome waits.
   */
  _settle(list, entry, state, previous) {
    if ((state.phase === ENDED || state.phase === BEGAN) && this._blocker(list, entry)) {
      entry.pending = { ...state };
      return false;
    }
    return this._emit(list, entry, state);
  }

  /** Release or discard anything parked, now that the blockers have moved. */
  _flushPending(list) {
    for (const entry of list) {
      if (!entry.pending) continue;
      const blocker = this._blocker(list, entry);
      if (blocker) {
        // The blocker won outright — the waiting gesture never happened.
        if (blocker.state.phase === ENDED) entry.pending = null;
        continue;
      }
      const pending = entry.pending;
      entry.pending = null;
      this._emit(list, entry, pending);
    }
  }

  _emit(list, entry, state) {
    const handler = entry.handlers[state.phase];
    if (typeof handler === "function") handler({ ...state, gesture: entry.name, node: entry.node });

    if (state.phase === BEGAN) {
      this._claim(list, entry);
      return true;
    }
    return false;
  }

  /** Claiming cancels the others, except those declared simultaneous. */
  _claim(list, claimant) {
    const allowed = new Set(
      claimant.config.allowSimultaneous || claimant.recognizer.allowSimultaneous || []
    );
    for (const entry of list) {
      if (entry === claimant || allowed.has(entry.name)) continue;
      if (entry.state.phase === FAILED || entry.state.phase === CANCELLED) continue;
      const previous = entry.state.phase;
      entry.state = { ...entry.state, phase: CANCELLED };
      if (previous === BEGAN || previous === CHANGED) {
        const handler = entry.handlers[CANCELLED];
        if (typeof handler === "function") {
          handler({ ...entry.state, gesture: entry.name, node: entry.node, reason: "claimed" });
        }
      }
    }
  }

  /**
   * Cancel everything on a node. Every cancellation source is treated
   * identically (§13.3): `pointercancel`, Escape, focus loss, element
   * destruction, and a programmatic cancel all arrive here.
   */
  cancel(node, reason) {
    const list = this.attachments.get(node);
    if (!list) return;
    for (const entry of list) {
      const previous = entry.state.phase;
      entry.state = entry.recognizer.init(entry.config);
      entry.pending = null;
      if (previous === BEGAN || previous === CHANGED) {
        const handler = entry.handlers[CANCELLED];
        if (typeof handler === "function") handler({ gesture: entry.name, node, reason });
      }
    }
  }

  destroy() {
    if (this._stop) this._stop();
    this.attachments.clear();
    this.claims.clear();
  }
}

/**
 * `touch-action` is set to the complement of the drag axis, which hands the
 * scroll-versus-drag decision to the browser's compositor rather than racing
 * it on the main thread (§13.3).
 */
export function touchActionFor(axis) {
  if (axis === "x") return "pan-y";
  if (axis === "y") return "pan-x";
  return "none";
}
