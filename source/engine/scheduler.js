/**
 * The frame loop (§6.3).
 *
 * A single `requestAnimationFrame` callback runs strictly ordered phases. No
 * code path may interleave reads and writes (P4) — layout thrash is treated as
 * a correctness bug, not a performance nit, and the two reentrancy rules at
 * the bottom of this file are what make it structurally impossible rather than
 * merely discouraged.
 *
 * Phase 7 matters as much as the other six: an idle IDE layout consumes zero
 * CPU because the loop unschedules itself entirely and re-arms on the next
 * invalidation.
 */
import "../core/dev.js";
import { warn } from "../core/diagnostics.js";
import { caf, now, raf } from "../core/dom.js";
import { flushEffects, hasPendingEffects, setEffectScheduler } from "../core/signals.js";

export const PHASES = ["input", "state", "read", "arrange", "write", "paint"];

/** The STATE phase gives up after this many passes and defers the rest. */
const MAX_STATE_PASSES = 8;

export class Scheduler {
  constructor(options) {
    const opts = options || {};
    this.subject = opts.subject || "root";
    this.budget = opts.budget || 8;
    this.handlers = {};
    for (const phase of PHASES) this.handlers[phase] = [];

    this.armed = false;
    this.running = false;
    this.phase = "idle";
    this.frameId = 0;
    this.frames = 0;
    this.lastDuration = 0;
    this.timings = {};
    this._raf = 0;
    this._deferred = false;
    this._onIdle = [];

    // Effects belong to the STATE phase; handing the signal system this
    // scheduler is what integrates the two (§15.1).
    setEffectScheduler(() => this.arm());
  }

  /** Register a phase handler. Returns a disposer. */
  on(phase, fn) {
    const list = this.handlers[phase];
    if (!list) throw new Error(`[mutakit] unknown phase '${phase}'`);
    list.push(fn);
    return () => {
      const index = list.indexOf(fn);
      if (index !== -1) list.splice(index, 1);
    };
  }

  /** Ask for a frame. Idempotent — arming twice in one frame is free. */
  arm() {
    if (this.armed) return;
    if (this.running) {
      // Invalidation raised during a frame belongs to the *next* one; it never
      // extends the current frame (§6.3, reentrancy).
      this._deferred = true;
      return;
    }
    this.armed = true;
    this._raf = raf((time) => this.frame(time));
  }

  /** Cancel a pending frame. */
  disarm() {
    if (!this.armed) return;
    this.armed = false;
    caf(this._raf);
    this._raf = 0;
  }

  /**
   * Force a synchronous flush — for tests, and for the rare case where an
   * author needs a measured value immediately (`mk.tick()`).
   */
  tick(time) {
    this.disarm();
    this.frame(time != null ? time : now());
    return this;
  }

  frame(time) {
    if (this.running) return;
    this.armed = false;
    this.running = true;
    this._deferred = false;
    this.frameId++;
    const started = now();

    try {
      this._run("input", time);
      this._state(time);
      this._run("read", time);
      this._run("arrange", time);
      this._run("write", time);
      this._run("paint", time);
    } finally {
      this.phase = "idle";
      this.running = false;
      this.frames++;
      this.lastDuration = now() - started;
    }

    if (__MK_DEV__ && this.lastDuration > this.budget) {
      warn("MK5001", __MK_DEV__ &&
        `frame took ${this.lastDuration.toFixed(1)}ms against a ${this.budget}ms budget`,
        { subject: this.subject }
      );
    }

    if (this._deferred) {
      // Phase 7 in reverse: work appeared during the frame, so re-arm.
      this.arm();
    } else {
      const callbacks = this._onIdle.splice(0);
      for (const fn of callbacks) fn();
    }
  }

  /**
   * STATE: flush signal updates and element `update()` callbacks, looping
   * until quiescent. If it is still producing work after 8 passes the frame
   * does not spin — the remainder is deferred and MK5003 names what is
   * oscillating. A runaway effect cycle degrades to a janky UI, never a
   * frozen tab.
   */
  _state(time) {
    this.phase = "state";
    const started = __MK_DEV__ ? now() : 0;
    let passes = 0;
    let worked = true;

    while (worked && passes < MAX_STATE_PASSES) {
      worked = flushEffects();
      for (const handler of this.handlers.state) {
        if (handler(time, passes)) worked = true;
      }
      passes++;
    }

    if (passes >= MAX_STATE_PASSES && (worked || hasPendingEffects())) {
      warn("MK5003", __MK_DEV__ &&
        `the STATE phase was still producing work after ${MAX_STATE_PASSES} passes; ` +
          `the rest is deferred to the next frame. Look for an effect that writes a ` +
          `signal it also reads.`,
        { subject: this.subject }
      );
      this._deferred = true;
    }
    if (__MK_DEV__) this.timings.state = now() - started;
  }

  _run(phase, time) {
    this.phase = phase;
    const started = __MK_DEV__ ? now() : 0;
    for (const handler of this.handlers[phase]) handler(time);
    if (__MK_DEV__) this.timings[phase] = now() - started;
  }

  /** Run `fn` once the loop is idle. `mk.flush()` awaits this. */
  whenIdle(fn) {
    if (!this.armed && !this.running) {
      fn();
      return;
    }
    this._onIdle.push(fn);
  }

  /**
   * Reading resolved geometry during WRITE is a P4 violation and throws in the
   * development build. It is the one rule that catches thrash at the moment it
   * is written rather than in a profile a week later.
   */
  assertReadable(subject) {
    if (!__MK_DEV__) return true;
    if (this.phase === "write") {
      warn("MK3015", __MK_DEV__ &&
        "resolved geometry was read during the WRITE phase. Move the read into " +
          "ARRANGE or PAINT — reading here forces a reflow (P4).",
        { subject: subject || this.subject }
      );
      return false;
    }
    return true;
  }

  destroy() {
    this.disarm();
    for (const phase of PHASES) this.handlers[phase].length = 0;
    this._onIdle.length = 0;
  }
}
