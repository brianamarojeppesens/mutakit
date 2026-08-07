/**
 * Edge constraints and over-constraint resolution (§5.6, §5.8).
 *
 * For each axis, geometry is determined by exactly **two** of three values:
 * `{start, end, size}`. Two is the normal case; three is common enough to be
 * worth defining rather than rejecting (a full-height rail declares top,
 * bottom *and* a width), and one or zero fall through to intrinsic sizing and
 * to the parent's layout algorithm respectively.
 *
 * Every dropped constraint is recorded on the result, which is what makes
 * "why is my box the wrong size" answerable in devtools and in the
 * development console.
 */
import "../core/dev.js";
import { warn } from "../core/diagnostics.js";
import { isIntrinsic, parse, toNumber } from "./len.js";

export const PRIORITY = { required: 1000, strong: 750, medium: 500, weak: 250 };

const DEFAULT_PRIORITY = PRIORITY.strong;

/** Tie-break order when priorities are equal (§5.8 step 3). */
const TIE_ORDER = { size: 0, end: 1, start: 2 };

function priorityOf(value) {
  if (value == null) return DEFAULT_PRIORITY;
  if (typeof value === "number") return value;
  return PRIORITY[value] != null ? PRIORITY[value] : DEFAULT_PRIORITY;
}

function present(value) {
  return value !== undefined && value !== null && value !== false;
}

/**
 * Resolve one axis.
 *
 * `spec` carries `{ start, end, size, min, max, priority }` where `priority`
 * is a per-field map. `ctx` carries `{ basis, intrinsic, lenCtx, keepWithin }`.
 * Returns `{ start, size, end, dropped, mode }` — `mode: 'flow'` means the
 * axis was not constrained at all and belongs to the parent algorithm (§7).
 */
export function resolveAxis(spec, ctx) {
  const c = ctx || {};
  const basis = c.basis || 0;
  const lenCtx = { ...(c.lenCtx || {}), basis, intrinsic: c.intrinsic };

  const given = [];
  if (present(spec.start)) given.push("start");
  if (present(spec.end)) given.push("end");
  if (present(spec.size)) given.push("size");

  const dropped = [];

  if (given.length === 0) {
    return { mode: "flow", start: 0, size: c.intrinsic != null ? c.intrinsic : 0, end: 0, dropped };
  }

  let use = given;
  if (given.length === 3) {
    // Over-constrained. Drop the lowest-priority constraint; on a tie, `size`
    // yields to the edges and the `end` edge yields to `start`. The result is
    // that {right, top, bottom, height} drops `height` and the element
    // stretches, which is what an author writing that shape expects.
    const priorities = spec.priority || {};
    const candidates = given
      .filter((name) => priorityOf(priorities[name]) < PRIORITY.required)
      .sort((a, b) => {
        const delta = priorityOf(priorities[a]) - priorityOf(priorities[b]);
        return delta !== 0 ? delta : TIE_ORDER[a] - TIE_ORDER[b];
      });
    const victim = candidates.length ? candidates[0] : "size";
    dropped.push(victim);
    use = given.filter((name) => name !== victim);
    warn("MK1003", __MK_DEV__ &&
      `axis over-constrained by start/end/size; dropped '${victim}'. ` +
        `Set priority: { ${victim}: 'weak' } to choose differently.`,
      { subject: c.subject }
    );
  }

  const startLen = present(spec.start) ? resolve(spec.start, lenCtx) : NaN;
  const endLen = present(spec.end) ? resolve(spec.end, lenCtx) : NaN;
  let sizeLen = present(spec.size) ? resolve(spec.size, lenCtx, c) : NaN;

  let start;
  let extent;

  const has = (name) => use.indexOf(name) !== -1;

  if (has("start") && has("size")) {
    start = startLen;
    extent = sizeLen;
  } else if (has("end") && has("size")) {
    extent = sizeLen;
    start = basis - endLen - extent;
  } else if (has("start") && has("end")) {
    start = startLen;
    extent = basis - endLen - startLen;
  } else if (has("size")) {
    // One of three: the missing edge resolves from the anchor, defaulting to
    // the start edge.
    extent = sizeLen;
    start = c.anchorStart != null ? c.anchorStart : 0;
  } else if (has("start")) {
    start = startLen;
    extent = c.intrinsic != null ? c.intrinsic : 0;
  } else {
    extent = c.intrinsic != null ? c.intrinsic : 0;
    start = basis - endLen - extent;
  }

  // min/max are always `required` and are applied after the axis is solved.
  const bounds = boundsOf(spec, lenCtx);
  const clamped = Math.min(Math.max(extent, bounds.min), bounds.max);
  if (clamped !== extent) {
    // Growing or shrinking has to keep the edge the author pinned. When both
    // edges were given, the start edge wins — the same tie-break as above.
    if (has("end") && !has("start")) start += extent - clamped;
    extent = clamped;
  }

  if (c.keepWithin) {
    const limit = c.keepWithin;
    if (start < limit.min) start = limit.min;
    if (start + extent > limit.max) start = Math.max(limit.min, limit.max - extent);
  }

  return { mode: "fixed", start, size: extent, end: basis - start - extent, dropped };
}

function resolve(value, lenCtx, ctx) {
  const ast = parse(value);
  if (!ast) return NaN;
  if (ctx && isIntrinsic(ast) && ctx.intrinsic == null) {
    // An intrinsic size with nothing measured yet resolves to zero for this
    // frame; the ResizeObserver path (§6.5) fills it in on the next one.
    return 0;
  }
  const n = toNumber(ast, lenCtx);
  return isFinite(n) ? n : 0;
}

function boundsOf(spec, lenCtx) {
  const min = present(spec.min) ? resolve(spec.min, lenCtx) : 0;
  const max = present(spec.max) ? resolve(spec.max, lenCtx) : Infinity;
  return { min: isFinite(min) ? min : 0, max: isFinite(max) ? max : Infinity };
}

/**
 * Detect the percentage cycle of §5.3: a child sized as a percentage of a
 * container whose own size depends on its content. Reported as MK1004 with
 * the child falling back to `auto`.
 */
export function checkPercentageCycle(childValue, containerIsIntrinsic, subject) {
  if (!containerIsIntrinsic) return false;
  const ast = parse(childValue);
  if (!ast) return false;
  const percent = containsPercentage(ast);
  if (percent) {
    warn("MK1004", __MK_DEV__ &&
      "a percentage resolves against a container sized by its own content; " +
        "the child falls back to 'auto'. Give the container a size on this axis.",
      { subject }
    );
  }
  return percent;
}

function containsPercentage(ast) {
  if (!ast) return false;
  if (ast.k === "pct") return true;
  if (ast.k === "op") return containsPercentage(ast.a) || containsPercentage(ast.b);
  if (ast.k === "call") return ast.args.some(containsPercentage);
  return false;
}

/**
 * Split an authored geometry bag into the two per-axis specs `resolveAxis`
 * consumes. Logical spellings are accepted and mapped to physical here, so
 * nothing downstream has to think about writing mode.
 */
export function axisSpecs(geometry, options) {
  const g = geometry || {};
  const opts = options || {};
  const rtl = opts.direction === "rtl";

  const startX = rtl ? g.inlineEnd : g.inlineStart;
  const endX = rtl ? g.inlineStart : g.inlineEnd;

  const sizeObject = g.size && typeof g.size === "object" ? g.size : null;

  return {
    x: {
      start: pick(g.left, startX),
      end: pick(g.right, endX),
      size: pick(g.width, sizeObject && sizeObject.w),
      min: pick(g.minWidth, g.min && g.min.w),
      max: pick(g.maxWidth, g.max && g.max.w),
      priority: g.priority && (g.priority.x || g.priority)
    },
    y: {
      start: pick(g.top, g.blockStart),
      end: pick(g.bottom, g.blockEnd),
      size: pick(g.height, sizeObject && sizeObject.h),
      min: pick(g.minHeight, g.min && g.min.h),
      max: pick(g.maxHeight, g.max && g.max.h),
      priority: g.priority && (g.priority.y || g.priority)
    }
  };
}

function pick(a, b) {
  return a !== undefined && a !== null ? a : b;
}
