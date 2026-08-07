/**
 * Signals (§15.1) — a minimal reactive primitive.
 *
 * Synchronous reads, batched writes, glitch-free propagation, and effects
 * scheduled into the frame loop's STATE phase (§6.3). Built rather than
 * depended on for two reasons: zero runtime dependencies is a project
 * constraint (§2.1), and the scheduler integration above is the whole point —
 * no off-the-shelf library schedules into someone else's frame loop.
 *
 * Propagation is mark-then-pull: a write marks its dependents stale and
 * queues the reachable effects; effects then pull, so every read inside an
 * effect sees a settled graph. That is what "glitch-free" buys.
 */

const STALE = 2;
const CHECK = 1;
const CLEAN = 0;

let currentObserver = null;
let currentOwner = null;
let batchDepth = 0;

const effectQueue = new Set();
let scheduleFlush = null;
let flushScheduled = false;

/**
 * Hand effect scheduling to the frame loop. `fn` is called when work appears
 * and must eventually call `flushEffects()`. Without one, effects run at the
 * end of the current batch — which is what the DOM-free unit tier wants.
 */
export function setEffectScheduler(fn) {
  scheduleFlush = fn;
}

function request() {
  if (batchDepth > 0) return;
  if (scheduleFlush) {
    if (!flushScheduled) {
      flushScheduled = true;
      scheduleFlush();
    }
    return;
  }
  flushEffects();
}

/** Run every queued effect. Called by the STATE phase, or inline when idle. */
export function flushEffects() {
  flushScheduled = false;
  if (!effectQueue.size) return false;
  // Snapshot: an effect may queue another, which belongs to the next pass so
  // the STATE phase can bound its iterations (§6.3).
  const batchOfEffects = [...effectQueue];
  effectQueue.clear();
  for (const effect of batchOfEffects) {
    if (!effect.disposed) runEffect(effect);
  }
  return true;
}

/** True when effects are waiting — the STATE phase's loop condition. */
export function hasPendingEffects() {
  return effectQueue.size > 0;
}

function link(node) {
  if (!currentObserver) return;
  if (currentObserver.sources.has(node)) return;
  currentObserver.sources.add(node);
  node.observers.add(currentObserver);
}

function markStale(node, state) {
  for (const observer of node.observers) {
    if (observer.state >= state) continue;
    const wasClean = observer.state === CLEAN;
    observer.state = state;
    if (observer.isEffect) {
      effectQueue.add(observer);
    } else if (wasClean || observer.state < STALE) {
      // A computed only needs its dependents told "maybe" — they will pull.
      markStale(observer, CHECK);
    }
  }
}

function equals(a, b, custom) {
  if (custom) return custom(a, b);
  return Object.is(a, b);
}

/** A writable reactive value. Call with no arguments to read, one to write. */
export function signal(initial, options) {
  const node = {
    value: initial,
    version: 0,
    observers: new Set(),
    equals: options && options.equals,
    isSource: true
  };

  function accessor(next) {
    if (arguments.length === 0) {
      link(node);
      return node.value;
    }
    const value = typeof next === "function" && !next.__mkSignal ? next(node.value) : next;
    if (equals(node.value, value, node.equals)) return node.value;
    node.value = value;
    node.version++;
    markStale(node, STALE);
    request();
    return node.value;
  }

  accessor.__mkSignal = true;
  accessor.peek = () => node.value;
  accessor.set = (v) => accessor(v);
  accessor.node = node;
  return accessor;
}

/** A derived value. Recomputes lazily, only when something reads it stale. */
export function computed(fn, options) {
  const node = {
    value: undefined,
    version: 0,
    fn,
    sources: new Set(),
    versions: new Map(),
    observers: new Set(),
    state: STALE,
    equals: options && options.equals
  };

  function accessor() {
    link(node);
    if (node.state !== CLEAN) update(node);
    return node.value;
  }

  accessor.__mkSignal = true;
  accessor.peek = () => {
    if (node.state !== CLEAN) update(node);
    return node.value;
  };
  accessor.node = node;
  return accessor;
}

/**
 * Recompute a stale computed.
 *
 * Deliberately **pull-only**: this never pushes an invalidation outward. An
 * earlier version re-marked dependents whenever a recomputation produced a new
 * value, which re-queued the very effect that had triggered the pull — the
 * effect then ran twice for one write. Freshness instead travels by version
 * comparison, so a `CHECK` computed whose sources all turn out unchanged
 * settles without recomputing and without disturbing anyone.
 */
function update(node) {
  if (node.state === CHECK) {
    for (const source of node.sources) {
      if (source.fn && source.state !== CLEAN) update(source);
    }
    let changed = false;
    for (const [source, version] of node.versions) {
      if (source.version !== version) {
        changed = true;
        break;
      }
    }
    if (!changed) {
      node.state = CLEAN;
      return;
    }
  }

  const previousSources = node.sources;
  node.sources = new Set();
  const prevObserver = currentObserver;
  currentObserver = node;
  let value;
  try {
    value = node.fn(node.value);
  } finally {
    currentObserver = prevObserver;
  }
  for (const source of previousSources) {
    if (!node.sources.has(source)) source.observers.delete(node);
  }
  recordVersions(node);
  node.state = CLEAN;
  if (!equals(node.value, value, node.equals)) {
    node.value = value;
    node.version++;
  }
}

function recordVersions(node) {
  node.versions.clear();
  for (const source of node.sources) node.versions.set(source, source.version);
}

function runEffect(effect) {
  disposeChildren(effect);
  const previousSources = effect.sources;
  effect.sources = new Set();
  const prevObserver = currentObserver;
  const prevOwner = currentOwner;
  currentObserver = effect;
  currentOwner = effect;
  try {
    const cleanup = effect.fn();
    if (typeof cleanup === "function") effect.cleanups.push(cleanup);
  } finally {
    currentObserver = prevObserver;
    currentOwner = prevOwner;
  }
  for (const source of previousSources) {
    if (!effect.sources.has(source)) source.observers.delete(effect);
  }
  effect.state = CLEAN;
}

function disposeChildren(owner) {
  while (owner.cleanups.length) {
    const cleanup = owner.cleanups.pop();
    try {
      cleanup();
    } catch (error) {
      // A cleanup that throws must not strand the rest; report and continue.
      console.error("[mutakit] effect cleanup threw", error);
    }
  }
  for (const child of owner.children) child.dispose();
  owner.children.length = 0;
}

/**
 * Run `fn` now and again whenever a signal it read changes. Returns a
 * disposer; effects created inside an element's lifecycle are owned by
 * `ctx.own` and disposed automatically (§8.2).
 */
export function effect(fn) {
  const node = {
    fn,
    sources: new Set(),
    cleanups: [],
    children: [],
    state: CLEAN,
    isEffect: true,
    disposed: false,
    dispose
  };
  if (currentOwner) currentOwner.children.push(node);

  function dispose() {
    if (node.disposed) return;
    node.disposed = true;
    disposeChildren(node);
    for (const source of node.sources) source.observers.delete(node);
    node.sources.clear();
    effectQueue.delete(node);
  }

  runEffect(node);
  return dispose;
}

/** Read without subscribing. */
export function untrack(fn) {
  const previous = currentObserver;
  currentObserver = null;
  try {
    return fn();
  } finally {
    currentObserver = previous;
  }
}

/** Coalesce writes: effects run once, after `fn` returns. */
export function batch(fn) {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) request();
  }
}

/** Register a cleanup with the enclosing effect. */
export function onCleanup(fn) {
  if (currentOwner) currentOwner.cleanups.push(fn);
}

/** True for anything produced by `signal()` or `computed()`. */
export function isSignal(value) {
  return typeof value === "function" && value.__mkSignal === true;
}

/** Read a value that may or may not be a signal. */
export function read(value) {
  return isSignal(value) ? value() : value;
}
