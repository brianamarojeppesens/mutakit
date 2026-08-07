/**
 * Alternate input sources and spatial navigation (§13.5, §13.6).
 *
 * `mk.input()` registers a source that feeds normalized events into the same
 * queue as the pointer and the keyboard, which is what lets a gamepad drive
 * the same focus model as `Tab` without any element knowing the difference.
 */
import "../core/dev.js";
import * as dom from "../core/dom.js";

/**
 * The gamepad source (§13.5).
 *
 * Polled in the INPUT phase — there is no event API — with axes becoming
 * directional navigation and buttons mapping through a configurable scheme.
 * Polling only while a pad is connected keeps an idle page at zero cost, which
 * §20.1's "steady-state idle CPU: 0%" requires.
 */
export const gamepadSource = {
  name: "gamepad",
  version: "1.0.0",

  attach(mk, options) {
    const opts = options || {};
    const scheme = opts.scheme || DEFAULT_SCHEME;
    const deadzone = opts.deadzone == null ? 0.35 : opts.deadzone;
    const repeat = opts.repeat == null ? 180 : opts.repeat;
    const state = { pads: 0, lastAxis: 0, buttons: new Map() };

    const poll = () => {
      if (!dom.isBrowser() || !navigator.getGamepads) return;
      const pads = [...navigator.getGamepads()].filter(Boolean);
      state.pads = pads.length;
      for (const pad of pads) {
        readAxes(mk, pad, state, deadzone, repeat);
        readButtons(mk, pad, state, scheme);
      }
    };

    const stop = mk.scheduler.on("input", poll);
    // A frame is only scheduled while a pad is connected; connecting one arms
    // the loop, disconnecting lets it go idle again (§6.3 phase 7).
    const connect = dom.listen(window, "gamepadconnected", () => mk.scheduler.arm());
    const disconnect = dom.listen(window, "gamepaddisconnected", () => mk.scheduler.arm());

    return () => {
      stop();
      connect();
      disconnect();
    };
  }
};

const DEFAULT_SCHEME = {
  0: "activate",
  1: "cancel",
  9: "menu",
  12: "up",
  13: "down",
  14: "left",
  15: "right"
};

function readAxes(mk, pad, state, deadzone, repeat) {
  const x = pad.axes[0] || 0;
  const y = pad.axes[1] || 0;
  if (Math.abs(x) < deadzone && Math.abs(y) < deadzone) {
    state.lastAxis = 0;
    return;
  }
  const now = dom.now();
  if (now - state.lastAxis < repeat) return;
  state.lastAxis = now;
  const direction =
    Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : y > 0 ? "down" : "up";
  navigate(mk, direction);
}

function readButtons(mk, pad, state, scheme) {
  pad.buttons.forEach((button, index) => {
    const was = state.buttons.get(index) || false;
    const is = button.pressed;
    state.buttons.set(index, is);
    if (is === was || !is) return;
    const action = scheme[index];
    if (!action) return;
    if (["up", "down", "left", "right"].includes(action)) navigate(mk, action);
    else if (action === "activate") activate(mk);
    else if (action === "cancel") cancel(mk);
  });
}

function activate(mk) {
  const active = dom.activeElement();
  if (active && active.click) active.click();
}

function cancel(mk) {
  const layers = mk.service("layers");
  if (!layers) return;
  for (const name of ["popover", "modal", "overlay"]) {
    const top = layers.topOf(name);
    if (!top) continue;
    const record = top.traits.get("dismissible");
    if (record && record.api.dismiss) record.api.dismiss("gamepad");
    return;
  }
}

function navigate(mk, direction) {
  const spatial = mk.service("spatial");
  if (spatial) spatial.move(direction);
}

/**
 * Spatial navigation (§13.6).
 *
 * Focus moves by *direction* rather than by tab order: given a direction and
 * the set of focusable rects, pick the best candidate by a documented scoring
 * function — **alignment overlap weighted above distance**, because a target
 * directly ahead but far away is almost always the intended one, and a nearer
 * target off to the side almost never is.
 */
export class SpatialService {
  constructor() {
    this.mk = null;
    this.containers = new Set();
  }

  attach(mk) {
    this.mk = mk;
  }

  /** Opt a container in. Only its descendants participate. */
  enable(node) {
    this.containers.add(node);
    return () => this.containers.delete(node);
  }

  /** Every candidate rect, in viewport space. */
  candidates() {
    const focus = this.mk.service("focus");
    const roots = this.containers.size
      ? [...this.containers].map((node) => node.el).filter(Boolean)
      : this.mk.roots.map((root) => root.el).filter(Boolean);
    const out = [];
    for (const root of roots) {
      for (const el of focus ? focus.tabbable(root) : []) {
        const box = dom.rectOf(el);
        if (box.w > 0 && box.h > 0) out.push({ el, box });
      }
    }
    return out;
  }

  /** Move focus in `direction`. Returns the element focused, or null. */
  move(direction) {
    const active = dom.activeElement();
    const items = this.candidates();
    if (!items.length) return null;

    const from = active && active.getBoundingClientRect
      ? dom.rectOf(active)
      : { x: 0, y: 0, w: 0, h: 0 };
    const best = pick(from, items.filter((item) => item.el !== active), direction);
    if (!best) return null;
    best.el.focus();
    return best.el;
  }
}

/** The documented scoring function. Lower is better. */
export function score(from, to, direction) {
  const horizontal = direction === "left" || direction === "right";
  const forward =
    direction === "right" ? to.x - (from.x + from.w) :
    direction === "left" ? from.x - (to.x + to.w) :
    direction === "down" ? to.y - (from.y + from.h) :
    from.y - (to.y + to.h);
  if (forward < -Math.max(1, horizontal ? from.w : from.h) / 2) return Infinity;

  // Overlap on the cross axis, as a fraction of the smaller extent.
  const overlap = horizontal
    ? span(from.y, from.y + from.h, to.y, to.y + to.h) / Math.max(1, Math.min(from.h, to.h))
    : span(from.x, from.x + from.w, to.x, to.x + to.w) / Math.max(1, Math.min(from.w, to.w));

  const distance = Math.max(0, forward);
  // Alignment dominates: a fully overlapping target is preferred over a nearer
  // one that is off to the side, which is what makes a grid feel like a grid.
  return distance + (1 - Math.min(overlap, 1)) * 2000;
}

function span(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

function pick(from, items, direction) {
  let best = null;
  let bestScore = Infinity;
  for (const item of items) {
    const value = score(from, item.box, direction);
    if (value < bestScore) {
      bestScore = value;
      best = item;
    }
  }
  return bestScore === Infinity ? null : best;
}
