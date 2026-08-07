/**
 * Gesture recognizers (§13.3), table-tested with scripted pointer traces.
 *
 * This whole file is the payoff of making recognizers pure reducers: no DOM,
 * no service, no real clock, and therefore no timing flakiness. §13.3 asks for
 * exactly this — *"recognizers are pure functions of an event sequence, so they
 * are table-tested with scripted pointer traces"* — and a recognizer that
 * reached for a timer or an element could not be tested here at all.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BEGAN,
  CANCELLED,
  CHANGED,
  ENDED,
  FAILED,
  POSSIBLE,
  doubleTap,
  drag,
  longPress,
  pinch,
  rotate,
  scrub,
  swipe,
  tap,
  touchActionFor,
  wheel
} from "../../source/services/gestures.js";

/** Run a trace through a recognizer and return the final state. */
function run(recognizer, trace, config) {
  let state = recognizer.init(config);
  for (const event of trace) state = recognizer.step(state, event);
  return state;
}

/** Every phase the trace passed through, which is what arbitration reads. */
function phases(recognizer, trace, config) {
  let state = recognizer.init(config);
  const seen = [state.phase];
  for (const event of trace) {
    state = recognizer.step(state, event);
    if (state.phase !== seen[seen.length - 1]) seen.push(state.phase);
  }
  return seen;
}

const down = (x, y, time = 0, id = 1) => ({ type: "down", x, y, time, id });
const move = (x, y, time = 0, id = 1) => ({ type: "move", x, y, time, id });
const up = (x, y, time = 0, id = 1) => ({ type: "up", x, y, time, id });
const cancel = (id = 1) => ({ type: "cancel", id, x: 0, y: 0, time: 0 });
const tick = (time) => ({ type: "tick", time });

// ── tap ──────────────────────────────────────────────────────────────────

test("tap: down and up inside the slop ends", () => {
  assert.equal(run(tap, [down(10, 10, 0), up(12, 11, 90)]).phase, ENDED);
});

test("tap: moving beyond the slop fails, and fails at the move", () => {
  assert.deepEqual(
    phases(tap, [down(10, 10, 0), move(40, 10, 30), up(40, 10, 60)]),
    [POSSIBLE, FAILED],
    "it does not wait for the release to decide"
  );
});

test("tap: held too long fails on the clock, not on the release", () => {
  assert.deepEqual(phases(tap, [down(10, 10, 0), tick(600)]), [POSSIBLE, FAILED]);
});

test("tap: a cancelled pointer cancels", () => {
  assert.equal(run(tap, [down(10, 10, 0), cancel()]).phase, CANCELLED);
});

// ── double-tap ───────────────────────────────────────────────────────────

test("double-tap: two taps inside the window end", () => {
  const trace = [down(10, 10, 0), up(10, 10, 60), down(11, 11, 160), up(11, 11, 200)];
  assert.equal(run(doubleTap, trace).phase, ENDED);
});

test("double-tap: too slow fails on the clock", () => {
  const trace = [down(10, 10, 0), up(10, 10, 60), tick(500)];
  assert.deepEqual(phases(doubleTap, trace), [POSSIBLE, FAILED]);
});

test("double-tap: two taps far apart never end — the second restarts the count", () => {
  const trace = [down(10, 10, 0), up(10, 10, 60), down(90, 90, 120), up(90, 90, 160)];
  assert.ok(
    !phases(doubleTap, trace).includes(ENDED),
    "measured against the first tap, not against each press's own position"
  );
  // And the strayed press becomes the first of a new pair rather than a
  // failure, so a third tap near the second still completes one.
  const continued = [...trace, down(92, 92, 220), up(92, 92, 260)];
  assert.equal(run(doubleTap, continued).phase, ENDED);
});

// ── long-press ───────────────────────────────────────────────────────────

test("long-press: begins on the clock, ends on release", () => {
  const trace = [down(10, 10, 0), tick(200), tick(520), up(10, 10, 600)];
  assert.deepEqual(phases(longPress, trace), [POSSIBLE, BEGAN, ENDED]);
});

test("long-press: fails promptly on movement, so a drag can start", () => {
  // §13.3 names this specifically: `failed` is as important as `ended`,
  // because a competing drag must not wait out the press threshold.
  const trace = [down(10, 10, 0), move(40, 10, 50)];
  assert.deepEqual(phases(longPress, trace), [POSSIBLE, FAILED]);
  assert.equal(run(longPress, [...trace, tick(600)]).phase, FAILED, "and stays failed");
});

test("long-press: released early fails", () => {
  assert.equal(run(longPress, [down(10, 10, 0), up(10, 10, 100)]).phase, FAILED);
});

// ── drag ─────────────────────────────────────────────────────────────────

test("drag: begins past the threshold, then reports every move", () => {
  const trace = [down(0, 0, 0), move(2, 0, 10), move(20, 5, 20), move(40, 5, 30), up(40, 5, 40)];
  assert.deepEqual(phases(drag, trace), [POSSIBLE, BEGAN, CHANGED, ENDED]);
  const state = run(drag, trace.slice(0, 4));
  assert.equal(state.dx, 40);
  assert.equal(state.dy, 5);
});

test("drag: an axis lock zeroes the other axis", () => {
  const state = run(drag, [down(0, 0, 0), move(30, 30, 10), move(60, 60, 20)], { axis: "x" });
  assert.equal(state.dx, 60);
  assert.equal(state.dy, 0);
});

test("drag: a press that never moves fails rather than ending", () => {
  assert.equal(run(drag, [down(0, 0, 0), up(1, 0, 40)]).phase, FAILED);
});

test("drag: touch-action is the complement of the axis (§13.3)", () => {
  assert.equal(touchActionFor("x"), "pan-y");
  assert.equal(touchActionFor("y"), "pan-x");
  assert.equal(touchActionFor("both"), "none");
});

// ── swipe ────────────────────────────────────────────────────────────────

test("swipe: direction is decided on release", () => {
  const state = run(swipe, [down(0, 0, 0), move(120, 4, 60), up(120, 4, 120)]);
  assert.equal(state.phase, ENDED);
  assert.equal(state.direction, "right");
});

test("swipe: too slow or too short fails", () => {
  assert.equal(run(swipe, [down(0, 0, 0), up(120, 0, 900)]).phase, FAILED, "too slow");
  assert.equal(run(swipe, [down(0, 0, 0), up(10, 0, 100)]).phase, FAILED, "too short");
});

// ── pinch and rotate ─────────────────────────────────────────────────────

test("pinch: scale is relative to the span at the second touch", () => {
  const trace = [
    down(0, 0, 0, 1),
    down(100, 0, 0, 2),
    move(200, 0, 10, 2)
  ];
  const state = run(pinch, trace);
  assert.equal(state.phase, CHANGED);
  assert.equal(state.scale, 2);
});

test("rotate: rotation is relative to the angle at the second touch", () => {
  const trace = [down(0, 0, 0, 1), down(100, 0, 0, 2), move(0, 100, 10, 2)];
  const state = run(rotate, trace);
  assert.equal(state.phase, CHANGED);
  assert.equal(Math.round(state.rotation), 90);
});

test("pinch and rotate declare each other simultaneous, so neither cancels the other", () => {
  assert.deepEqual(pinch.allowSimultaneous, ["rotate"]);
  assert.deepEqual(rotate.allowSimultaneous, ["pinch"]);
});

test("lifting one finger ends a two-pointer gesture", () => {
  const trace = [down(0, 0, 0, 1), down(100, 0, 0, 2), move(200, 0, 10, 2), up(200, 0, 20, 2)];
  assert.equal(run(pinch, trace).phase, ENDED);
});

// ── wheel and scrub ──────────────────────────────────────────────────────

test("wheel is discrete: it reports a delta and nothing else", () => {
  const state = run(wheel, [{ type: "wheel", dx: 0, dy: -120, time: 0 }]);
  assert.equal(state.phase, CHANGED);
  assert.equal(state.dy, -120);
});

test("scrub scales its delta by sensitivity", () => {
  const state = run(scrub, [down(0, 0, 0), move(50, 0, 10)], { sensitivity: 0.5 });
  assert.equal(state.phase, BEGAN);
  assert.equal(state.delta, 25);
});

// ── the shared lifecycle ─────────────────────────────────────────────────

test("every recognizer starts `possible` and accepts a cancel from any state", () => {
  for (const recognizer of [tap, doubleTap, longPress, drag, swipe, scrub]) {
    assert.equal(recognizer.init({}).phase, POSSIBLE, `${recognizer.name} starts possible`);
    const cancelled = run(recognizer, [down(0, 0, 0), move(30, 30, 10), cancel()]);
    assert.ok(
      cancelled.phase === CANCELLED || cancelled.phase === FAILED,
      `${recognizer.name} handles a cancel (got ${cancelled.phase})`
    );
  }
});

test("a recognizer is a pure function of its trace", () => {
  const trace = [down(0, 0, 0), move(20, 0, 10), up(20, 0, 20)];
  const first = run(drag, trace);
  const second = run(drag, trace);
  assert.deepEqual(first.phase, second.phase);
  assert.deepEqual(first.dx, second.dx);
  // The same input twice, and no shared state between runs: that is the
  // property that makes this file possible without a browser.
  assert.notEqual(first, second);
});
