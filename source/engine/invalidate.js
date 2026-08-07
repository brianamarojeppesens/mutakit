/**
 * Invalidation (§6.2).
 *
 * Four independent dirty bits, each with its own propagation rule. Setting a
 * bit that is already set is free, and the scheduler arms at most once per
 * frame, so invalidation is coalescing by construction.
 *
 * The `PAINT` fast path is what makes S3 viable: a HUD element that moves
 * every frame sets only `PAINT`, which writes a transform and never touches
 * the layout pipeline.
 */

export const STYLE = 1;
export const MEASURE = 2;
export const ARRANGE = 4;
export const PAINT = 8;
export const ALL = STYLE | MEASURE | ARRANGE | PAINT;

const NAMES = { style: STYLE, measure: MEASURE, arrange: ARRANGE, paint: PAINT, all: ALL };

/** Accept a bit mask, a name, or a list of names. */
export function bitsOf(value) {
  if (value == null) return ARRANGE;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.reduce((mask, name) => mask | bitsOf(name), 0);
  return NAMES[value] || 0;
}

export function bitNames(mask) {
  const out = [];
  if (mask & STYLE) out.push("style");
  if (mask & MEASURE) out.push("measure");
  if (mask & ARRANGE) out.push("arrange");
  if (mask & PAINT) out.push("paint");
  return out;
}

/**
 * Set `bits` on `node` and propagate.
 *
 *   STYLE    self only
 *   MEASURE  up to the nearest ancestor with a fixed size on that axis
 *   ARRANGE  down the subtree
 *   PAINT    self only; the fast path, skips layout entirely
 */
export function invalidate(node, bits) {
  const mask = bitsOf(bits);
  if (!node || !mask) return false;

  let armed = false;

  if (mask & STYLE) armed = setBit(node, STYLE) || armed;
  if (mask & PAINT) armed = setBit(node, PAINT) || armed;

  if (mask & MEASURE) {
    armed = setBit(node, MEASURE) || armed;
    for (let parent = node.parent; parent; parent = parent.parent) {
      // A parent whose size on both axes is fixed absorbs the change; nothing
      // above it can be affected by what a descendant measured.
      armed = setBit(parent, MEASURE | ARRANGE) || armed;
      if (parent.sizeIsFixed) break;
    }
  }

  if (mask & ARRANGE) {
    armed = markSubtree(node) || armed;
  }

  if (armed && node.root && node.root.scheduler) node.root.scheduler.arm();
  return armed;
}

function setBit(node, bits) {
  const before = node.flags;
  node.flags |= bits;
  return node.flags !== before;
}

function markSubtree(node) {
  let armed = setBit(node, ARRANGE);
  const stack = node.children.slice();
  while (stack.length) {
    const child = stack.pop();
    // A child that is already fully arranged-dirty has a dirty subtree too.
    if (child.flags & ARRANGE) continue;
    armed = setBit(child, ARRANGE) || armed;
    for (const grandchild of child.children) stack.push(grandchild);
  }
  return armed;
}

export function clear(node, bits) {
  node.flags &= ~bitsOf(bits);
}

export function isDirty(node, bits) {
  return (node.flags & bitsOf(bits)) !== 0;
}
