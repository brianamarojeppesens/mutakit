/**
 * The node-tree event system (§13.1).
 *
 * Events propagate along the *node* tree, not the DOM tree, so portalled
 * content behaves correctly: a popover rendered into the overlay layer still
 * bubbles to its logical parent. Capture, bubble, `stopPropagation`, and
 * `preventDefault` all work as expected; the originating DOM event, when there
 * was one, is always reachable as `event.native`.
 *
 * Mutakit never re-dispatches synthetic events into the DOM. DOM events are
 * consumed at the boundary and normalized here.
 */

export class MkEvent {
  constructor(type, detail, options) {
    const opts = options || {};
    this.type = type;
    this.detail = detail;
    this.target = null;
    this.currentTarget = null;
    this.phase = "at-target";
    this.native = opts.native || null;
    this.timeStamp = opts.timeStamp != null ? opts.timeStamp : 0;
    this.bubbles = opts.bubbles !== false;
    this.cancelable = opts.cancelable !== false;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.immediateStopped = false;
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation() {
    this.propagationStopped = true;
  }

  stopImmediatePropagation() {
    this.propagationStopped = true;
    this.immediateStopped = true;
  }
}

function listeners(node, type, capture) {
  const bag = capture ? node._capture : node._listeners;
  return bag && bag[type];
}

/**
 * Listen for `type` on `node`. Returns a disposer. Element code reaches this
 * through `ctx.on`, which routes the disposer into `ctx.own` (§8.2).
 */
export function addListener(node, type, fn, options) {
  const opts = options || {};
  const key = opts.capture ? "_capture" : "_listeners";
  if (!node[key]) node[key] = Object.create(null);
  const bag = node[key];
  if (!bag[type]) bag[type] = [];
  const entry = { fn, once: !!opts.once, order: opts.order || 0 };
  bag[type].push(entry);
  // Stable sort by declared order, so traits can compose predictably (§9).
  bag[type].sort((a, b) => a.order - b.order);
  return function remove() {
    const list = bag[type];
    if (!list) return;
    const index = list.indexOf(entry);
    if (index !== -1) list.splice(index, 1);
  };
}

export function removeAllListeners(node) {
  node._listeners = null;
  node._capture = null;
}

function invoke(node, event, capture) {
  const list = listeners(node, event.type, capture);
  if (!list || !list.length) return;
  event.currentTarget = node;
  for (const entry of list.slice()) {
    if (event.immediateStopped) return;
    if (entry.once) {
      const index = list.indexOf(entry);
      if (index !== -1) list.splice(index, 1);
    }
    entry.fn.call(node, event);
  }
}

function pathTo(node) {
  const path = [];
  for (let current = node; current; current = current.eventParent || current.parent) {
    path.push(current);
  }
  return path;
}

/**
 * Dispatch `event` at `node`: capture from the root down, then the target,
 * then bubble back up. Returns the event so callers can read
 * `defaultPrevented` — which is how a trait vetoes another's action (§9).
 */
export function dispatch(node, event) {
  event.target = node;
  const path = pathTo(node);

  event.phase = "capture";
  for (let i = path.length - 1; i > 0; i--) {
    if (event.propagationStopped) break;
    invoke(path[i], event, true);
  }

  if (!event.propagationStopped) {
    event.phase = "at-target";
    invoke(node, event, true);
    invoke(node, event, false);
  }

  if (event.bubbles) {
    event.phase = "bubble";
    for (let i = 1; i < path.length; i++) {
      if (event.propagationStopped) break;
      invoke(path[i], event, false);
    }
  }

  event.currentTarget = null;
  return event;
}

/** Convenience: build and dispatch in one call. */
export function emit(node, type, detail, options) {
  return dispatch(node, new MkEvent(type, detail, options));
}
