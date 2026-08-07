/**
 * The browser test harness (§23.1).
 *
 * Kept rather than replaced with a general-purpose runner, and the reason is
 * specific: the tests that matter most here are layout snapshots and synthetic
 * interaction sequences against *real* layout. They need a real browser, not a
 * simulated DOM, and this harness's value is that it runs in the page under
 * test with nothing in between. What Node buys the browser tier is the driver
 * (§23.3), not the runner.
 *
 *   describe("geometry", () => {
 *     test("resolves", async (t) => { t.equal(a, b); });
 *   });
 *
 * Results land on `window.harness.results` for external drivers, and
 * `?filter=` narrows a run without editing anything.
 */

const queue = [];
const stack = [];
const state = {
  results: [],
  running: false,
  done: false,
  only: false,
  filter: new URLSearchParams(location.search).get("filter") || ""
};

class Assert {
  constructor(name) {
    this.name = name;
    this.assertions = [];
    this.disposers = [];
  }

  _record(passed, message) {
    this.assertions.push({ passed, message });
    if (!passed) {
      const error = new Error(message);
      error.assertion = true;
      throw error;
    }
  }

  ok(value, message) {
    this._record(!!value, message || `expected a truthy value, got ${format(value)}`);
  }

  notOk(value, message) {
    this._record(!value, message || `expected a falsy value, got ${format(value)}`);
  }

  equal(actual, expected, message) {
    this._record(
      Object.is(actual, expected),
      message || `expected ${format(expected)}, got ${format(actual)}`
    );
  }

  notEqual(actual, expected, message) {
    this._record(!Object.is(actual, expected), message || `expected not ${format(expected)}`);
  }

  /** Numeric comparison with a tolerance — sub-pixel rounding is not a bug. */
  close(actual, expected, epsilon, message) {
    const tolerance = epsilon == null ? 0.5 : epsilon;
    this._record(
      Math.abs(actual - expected) <= tolerance,
      message || `expected ${expected} ± ${tolerance}, got ${actual}`
    );
  }

  deepEqual(actual, expected, message) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    this._record(a === b, message || `expected ${b}, got ${a}`);
  }

  throws(fn, pattern, message) {
    let threw = null;
    try {
      fn();
    } catch (error) {
      threw = error;
    }
    if (!threw) {
      this._record(false, message || "expected the call to throw");
      return null;
    }
    if (pattern instanceof RegExp) {
      this._record(
        pattern.test(threw.message),
        message || `expected a message matching ${pattern}, got ${JSON.stringify(threw.message)}`
      );
    } else {
      this._record(true, message || "threw");
    }
    return threw;
  }

  /** Register cleanup for this test. Runs even when the test fails. */
  cleanup(fn) {
    this.disposers.push(fn);
    return fn;
  }

  /** A fresh detached container, removed automatically. */
  sandbox() {
    const el = document.createElement("div");
    el.className = "harness-sandbox";
    document.getElementById("scratch").appendChild(el);
    this.cleanup(() => el.remove());
    return el;
  }
}

function format(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }
  return String(value);
}

function fullName(name) {
  return [...stack, name].join(" › ");
}

/** Group tests. Groups nest, and the joined name is what `?filter=` matches. */
export function describe(name, fn) {
  stack.push(name);
  try {
    fn();
  } finally {
    stack.pop();
  }
}

export function test(name, fn, options) {
  queue.push({ name: fullName(name), fn, ...(options || {}) });
}

/** Run only this test (and any other `only`). Nothing else runs. */
test.only = (name, fn) => {
  state.only = true;
  queue.push({ name: fullName(name), fn, only: true });
};

test.skip = (name, fn) => {
  queue.push({ name: fullName(name), fn, skip: true });
};

const hooks = { setup: [], teardown: [] };

export function setup(fn) {
  hooks.setup.push({ scope: stack.join(" › "), fn });
}

export function teardown(fn) {
  hooks.teardown.push({ scope: stack.join(" › "), fn });
}

function hooksFor(list, name) {
  return list.filter((hook) => hook.scope === "" || name.startsWith(hook.scope)).map((h) => h.fn);
}

/**
 * A deterministic fake clock and fake rAF (§23.1).
 *
 * Gesture recognizers and motion are timing-dependent, and timing-dependent
 * tests are flaky tests unless the clock is under the test's control. This is
 * installed per test rather than globally so a test that wants real time can
 * simply not ask for it.
 */
export function fakeClock() {
  let now = 0;
  const frames = [];
  const timers = [];
  let nextId = 1;

  return {
    api: {
      raf(fn) {
        const id = nextId++;
        frames.push({ id, fn });
        return id;
      },
      caf(id) {
        const index = frames.findIndex((f) => f.id === id);
        if (index !== -1) frames.splice(index, 1);
      },
      now: () => now
    },
    /** Advance by `ms`, running any frame callbacks that fall due. */
    advance(ms, step) {
      const slice = step || 16;
      const target = now + ms;
      while (now < target) {
        now = Math.min(now + slice, target);
        this.frame();
      }
      return now;
    },
    /** Run exactly one animation frame. */
    frame() {
      const due = frames.splice(0);
      for (const entry of due) entry.fn(now);
    },
    get time() {
      return now;
    },
    timers
  };
}

/**
 * Synthetic pointer sequences (§23.2, interaction tier).
 *
 * A scripted trace rather than a real gesture: recognizers are pure functions
 * of an event sequence (§13.3), so this is all they need.
 */
export function pointer(target, options) {
  const opts = options || {};
  let id = opts.pointerId || 1;
  const fire = (type, x, y, extra) => {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      pointerType: opts.pointerType || "mouse",
      isPrimary: true,
      clientX: x,
      clientY: y,
      buttons: type === "pointerup" ? 0 : 1,
      ...(extra || {})
    });
    target.dispatchEvent(event);
    return event;
  };
  return {
    down: (x, y) => fire("pointerdown", x, y),
    move: (x, y) => fire("pointermove", x, y),
    up: (x, y) => fire("pointerup", x, y),
    cancel: (x, y) => fire("pointercancel", x, y),
    /** down → n moves → up, which is what a drag test almost always wants. */
    drag(from, to, steps) {
      const count = steps || 4;
      this.down(from.x, from.y);
      for (let i = 1; i <= count; i++) {
        this.move(
          from.x + ((to.x - from.x) * i) / count,
          from.y + ((to.y - from.y) * i) / count
        );
      }
      this.up(to.x, to.y);
    }
  };
}

export function key(target, name, options) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: name,
    ...(options || {})
  });
  target.dispatchEvent(event);
  return event;
}

async function runOne(entry) {
  const t = new Assert(entry.name);
  const started = performance.now();
  const record = { name: entry.name, passed: true, skipped: false, error: null, assertions: 0, ms: 0 };

  if (entry.skip || (state.only && !entry.only) || (state.filter && !entry.name.includes(state.filter))) {
    record.skipped = true;
    return record;
  }

  try {
    for (const fn of hooksFor(hooks.setup, entry.name)) await fn(t);
    await entry.fn(t);
  } catch (error) {
    record.passed = false;
    record.error = error && error.message ? error.message : String(error);
    if (error && !error.assertion) record.stack = error.stack;
  } finally {
    for (const fn of hooksFor(hooks.teardown, entry.name).reverse()) {
      try {
        await fn(t);
      } catch (error) {
        record.passed = false;
        record.error = record.error || `teardown: ${error.message}`;
      }
    }
    for (const dispose of t.disposers.reverse()) {
      try {
        dispose();
      } catch (error) {
        /* a cleanup failure must not mask the test's own result */
      }
    }
  }

  record.assertions = t.assertions.length;
  record.ms = performance.now() - started;
  return record;
}

function render(record) {
  const list = document.getElementById("results");
  if (!list) return;
  const item = document.createElement("li");
  item.className = record.skipped ? "skip" : record.passed ? "pass" : "fail";
  item.innerHTML = "";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = record.name;
  item.appendChild(name);
  if (record.error) {
    const why = document.createElement("span");
    why.className = "why";
    why.textContent = record.error;
    item.appendChild(why);
  }
  list.appendChild(item);
}

async function run() {
  state.running = true;
  for (const entry of queue) {
    const record = await runOne(entry);
    state.results.push(record);
    render(record);
  }
  state.running = false;
  state.done = true;

  const passed = state.results.filter((r) => r.passed && !r.skipped).length;
  const failed = state.results.filter((r) => !r.passed).length;
  const skipped = state.results.filter((r) => r.skipped).length;
  const summary = document.getElementById("summary");
  if (summary) {
    summary.textContent = `${passed} passed · ${failed} failed · ${skipped} skipped`;
    summary.className = `summary ${failed ? "fail" : "pass"}`;
  }
  document.documentElement.setAttribute("data-harness", failed ? "fail" : "pass");
  return { passed, failed, skipped, results: state.results };
}

/** Start the run once every test module has registered. */
export function start() {
  return run().then((summary) => {
    window.harness.summary = summary;
    return summary;
  });
}

window.harness = {
  get results() {
    return state.results;
  },
  get done() {
    return state.done;
  },
  summary: null,
  filter: state.filter,
  queue
};

export { state as harnessState };
