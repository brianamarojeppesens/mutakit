/**
 * The `stack` algorithm (§7.2) — core.
 *
 * Children in a single row or column, sized by `Len` including `fr`, with
 * `gap`, `align`, `justify`, `wrap`, and `reverse`. It compiles to flexbox,
 * which is the workhorse for toolbars, button rows, and form layouts.
 *
 * ARRANGE still computes each child's rect even though flexbox will produce
 * it: that is what makes layout snapshot testing (§23.2) possible, and the two
 * agree because the `fr` distribution here is CSS's own algorithm (§5.2).
 */
import { distributeFr, frCoefficient, isFlexible, parse, toNumber } from "../geometry/len.js";

export const stackLayout = {
  name: "stack",
  version: "1.0.0",

  schema: {
    axis: { type: "enum", values: ["x", "y"], default: "y" },
    gap: { type: "len", default: 0 },
    align: {
      type: "enum",
      values: ["start", "center", "end", "stretch", "baseline"],
      default: "stretch"
    },
    justify: {
      type: "enum",
      values: ["start", "center", "end", "between", "around", "evenly"],
      default: "start"
    },
    wrap: { type: "boolean", default: false },
    reverse: { type: "boolean", default: false },
    padding: { type: "any" }
  },

  childProps: {
    size: { type: "len", default: "auto" },
    min: { type: "len" },
    max: { type: "len" },
    align: { type: "enum", values: ["start", "center", "end", "stretch", "baseline"] },
    order: { type: "number" }
  },

  /** `stack({ children: [...] })` — the fluent form's sugar. */
  childrenFrom(options) {
    return options.children || null;
  },

  arrange(node, children, ctx) {
    const options = node.algorithmOptions || {};
    const axis = options.axis || "y";
    const main = axis === "x" ? "w" : "h";
    const cross = axis === "x" ? "h" : "w";
    const mainPos = axis === "x" ? "x" : "y";
    const crossPos = axis === "x" ? "y" : "x";

    const frame = node.frame;
    const gap = ctx.len(options.gap || 0, axis);
    const visible = children.filter((child) => !child.destroyed && !child.props.hidden);
    if (!visible.length) return;

    const available = frame[main] - gap * (visible.length - 1);
    const lenCtx = ctx.mk.lenContext(frame[main], node);

    const tracks = visible.map((child) => {
      const bag = child.layoutProps || {};
      const declared = bag.size != null ? bag.size : sizeFromGeometry(child, main);
      const ast = parse(declared);
      const intrinsic = child.measured ? child.measured[main] : 0;
      const flexible = isFlexible(ast);
      return {
        fr: flexible ? frCoefficient(ast) : 0,
        base: flexible ? 0 : resolveBase(ast, lenCtx, intrinsic),
        min: bag.min != null ? toNumber(parse(bag.min), lenCtx) : 0,
        max: bag.max != null ? toNumber(parse(bag.max), lenCtx) : Infinity
      };
    });

    const sizes = distributeFr(tracks, available);

    // `justify` only has anything to distribute when nothing is flexible.
    const used = sizes.reduce((sum, s) => sum + s, 0) + gap * (visible.length - 1);
    const slack = Math.max(0, frame[main] - used);
    const hasFlex = tracks.some((t) => t.fr > 0);
    let cursor = frame[axis === "x" ? "x" : "y"] + (hasFlex ? 0 : leadingOffset(options.justify, slack));
    const spacing = hasFlex ? 0 : betweenOffset(options.justify, slack, visible.length);

    for (let i = 0; i < visible.length; i++) {
      const child = visible[i];
      const bag = child.layoutProps || {};
      const align = bag.align || options.align || "stretch";
      const crossSize = crossExtent(child, node, cross, align, ctx);

      child.computed[mainPos] = cursor;
      child.computed[main] = sizes[i];
      child.computed[crossPos] =
        frame[crossPos] + crossOffset(align, frame[cross], crossSize);
      child.computed[cross] = crossSize;
      child.sizeIsFixed = tracks[i].fr === 0;

      ctx.mk.compiler.setRect(child, child.computed);
      ctx.mk.compiler.setStyle(child, "flex", flexFor(tracks[i], sizes[i]));
      if (bag.order != null) ctx.mk.compiler.setStyle(child, "order", String(bag.order));
      if (align !== (options.align || "stretch")) {
        ctx.mk.compiler.setStyle(child, "align-self", cssAlign(align));
      }

      cursor += sizes[i] + gap + spacing;
    }
  },

  css(node, ctx) {
    const options = node.algorithmOptions || {};
    const axis = options.axis || "y";
    const direction = axis === "x" ? "row" : "column";
    return {
      display: "flex",
      "flex-direction": options.reverse ? `${direction}-reverse` : direction,
      "flex-wrap": options.wrap ? "wrap" : "nowrap",
      gap: cssLength(options.gap),
      "align-items": cssAlign(options.align || "stretch"),
      "justify-content": cssJustify(options.justify || "start"),
      padding: options.padding != null ? cssLength(options.padding) : null
    };
  },

  styles: `
    [data-mk-algorithm="stack"] {
      display: flex;
    }
  `
};

function sizeFromGeometry(child, main) {
  const g = child.geometry || {};
  const size = g.size && typeof g.size === "object" ? g.size : null;
  const value = main === "w" ? g.width != null ? g.width : size && size.w : g.height != null ? g.height : size && size.h;
  return value != null ? value : "auto";
}

function resolveBase(ast, lenCtx, intrinsic) {
  const value = toNumber(ast, { ...lenCtx, intrinsic });
  return isFinite(value) ? value : intrinsic || 0;
}

function crossExtent(child, node, cross, align, ctx) {
  if (align === "stretch") return node.frame[cross];
  const declared = sizeFromGeometry(child, cross);
  if (declared === "auto") return child.measured ? child.measured[cross] : 0;
  const value = toNumber(parse(declared), ctx.mk.lenContext(node.frame[cross], child));
  return isFinite(value) ? value : 0;
}

function crossOffset(align, available, size) {
  if (align === "center") return Math.max(0, (available - size) / 2);
  if (align === "end") return Math.max(0, available - size);
  return 0;
}

function leadingOffset(justify, slack) {
  switch (justify) {
    case "center": return slack / 2;
    case "end": return slack;
    case "around": return 0;
    case "evenly": return 0;
    default: return 0;
  }
}

function betweenOffset(justify, slack, count) {
  if (count < 2) return 0;
  if (justify === "between") return slack / (count - 1);
  if (justify === "around") return slack / count;
  if (justify === "evenly") return slack / (count + 1);
  return 0;
}

function flexFor(track, size) {
  if (track.fr > 0) return `${track.fr} 1 0%`;
  return `0 0 ${round(size)}px`;
}

function cssLength(value) {
  if (value == null) return null;
  return typeof value === "number" ? `${value}px` : String(value);
}

function cssAlign(align) {
  switch (align) {
    case "start": return "flex-start";
    case "end": return "flex-end";
    case "center": return "center";
    case "baseline": return "baseline";
    default: return "stretch";
  }
}

function cssJustify(justify) {
  switch (justify) {
    case "center": return "center";
    case "end": return "flex-end";
    case "between": return "space-between";
    case "around": return "space-around";
    case "evenly": return "space-evenly";
    default: return "flex-start";
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}
