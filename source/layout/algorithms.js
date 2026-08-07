/**
 * `dock`, `grid`, `flow`, and `free` (§7.4–§7.7).
 *
 * The four algorithms that complete the catalog. Each is small because the
 * engine already does the hard part: `resolveBox` handles edge constraints and
 * anchors, `Len` handles the vocabulary, and the style compiler handles the
 * writes. An algorithm's job is only to decide *which* box each child gets.
 */
import "../core/dev.js";
import { warn } from "../core/diagnostics.js";
import { distributeFr, frCoefficient, isFlexible, parse, toCSS, toNumber } from "../geometry/len.js";
import * as R from "../geometry/rect.js";

/**
 * `dock` (§7.4) — edge regions around a centre, which is the classic
 * application shell.
 *
 * **Corner arbitration** is the property that distinguishes a real dock from a
 * naive one, and it is the first thing an author hits: does the sidebar run
 * under the title bar, or beside it?
 */
export const dockLayout = {
  name: "dock",
  version: "1.0.0",
  /** Regions are named, not ordered — `dock()` returns the shell (§7.4). */
  returns: "self",

  schema: {
    corners: { type: "enum", values: ["horizontal", "vertical", "explicit"], default: "horizontal" },
    regions: { type: "object" },
    breakpoints: { type: "object" }
  },

  childProps: {
    region: { type: "enum", values: ["top", "bottom", "start", "end", "center"], default: "center" },
    size: { type: "len", default: 200, persist: true },
    resizable: { type: "boolean", default: false },
    collapsible: { type: "any" },
    collapsed: { type: "boolean", default: false, persist: true },
    /** An overlay region floats above the centre instead of reserving space. */
    overlay: { type: "boolean", default: false },
    rail: { type: "len" },
    spans: { type: "array", of: "string" },
    hidden: { type: "boolean", default: false }
  },

  childrenFrom(options) {
    if (!options.regions) return null;
    return Object.keys(options.regions).map((name) => {
      const { type = "pane", id, size, resizable, collapsible, collapsed, overlay, rail, spans, ...rest } =
        options.regions[name] || {};
      return {
        type,
        id: id || name,
        ...rest,
        layout: { region: name, size, resizable, collapsible, collapsed, overlay, rail, spans }
      };
    });
  },

  arrange(node, children, ctx) {
    const options = node.algorithmOptions || {};
    const corners = resolveCorners(options, node, ctx);
    const frame = node.frame;
    const insets = { top: 0, right: 0, bottom: 0, left: 0 };
    const rtl = ctx.mk.options.direction === "rtl";

    const byRegion = {};
    for (const child of children) {
      const region = (child.layoutProps && child.layoutProps.region) || "center";
      (byRegion[region] = byRegion[region] || []).push(child);
    }

    // Edges first, in corner order; the centre takes the remainder.
    const order =
      corners === "vertical"
        ? ["start", "end", "top", "bottom"]
        : ["top", "bottom", "start", "end"];

    for (const region of order) {
      for (const child of byRegion[region] || []) {
        const bag = child.layoutProps || {};
        if (bag.hidden) {
          child.computed.w = 0;
          child.computed.h = 0;
          continue;
        }
        const collapsed = !!bag.collapsed;
        const declared = collapsed ? bag.rail || 0 : bag.size;
        const extent = ctx.len(declared, region === "top" || region === "bottom" ? "y" : "x");
        const box = regionBox(region, frame, insets, extent, corners, rtl);
        place(ctx, child, box);
        ctx.mk.compiler.setState(child, "region", region);
        ctx.mk.compiler.setState(child, "collapsed", collapsed);

        if (!bag.overlay) {
          // A non-overlay region contributes to the centre's inset stack under
          // its own name (§7.4), which is how a modal declared `of: 'viewport'`
          // can choose to respect application chrome.
          const edge = physicalEdge(region, rtl);
          insets[edge] += extent;
          node.insets.set(`dock:${child.id || region}`, { [edge]: insets[edge] });
        }
      }
    }

    const centre = {
      x: frame.x + insets.left,
      y: frame.y + insets.top,
      w: Math.max(0, frame.w - insets.left - insets.right),
      h: Math.max(0, frame.h - insets.top - insets.bottom)
    };
    for (const child of byRegion.center || []) place(ctx, child, centre);
  },

  css() {
    return { position: "relative" };
  },

  styles: `
    [data-mk-algorithm="dock"]:not(.mk-node) { position: relative; }
    [data-mk-algorithm="dock"] > .mk-node {
      position: absolute;
      left: var(--mk-x, 0px);
      top: var(--mk-y, 0px);
      width: var(--mk-w, auto);
      height: var(--mk-h, auto);
    }
    [data-mk-algorithm="dock"] > [data-mk-collapsed] { overflow: hidden; }
  `
};

/**
 * Responsive collapse is evaluated against the *container's* width, not the
 * viewport's, so a docked shell nested inside a pane behaves correctly (§7.4).
 * A container query, expressed as data.
 */
function resolveCorners(options, node, ctx) {
  const breakpoints = options.breakpoints;
  if (!breakpoints) return options.corners || "horizontal";
  const width = node.frame.w;
  const applicable = Object.keys(breakpoints)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((point) => width <= point);
  for (const point of applicable) {
    const rules = breakpoints[point];
    for (const region of Object.keys(rules)) {
      const child = node.children.find((c) => (c.layoutProps || {}).region === region);
      if (!child) continue;
      const rule = rules[region];
      if (rule === "hidden") child.layoutProps.hidden = true;
      else if (rule === "overlay") child.layoutProps.overlay = true;
      else if (rule === "rail") child.layoutProps.collapsed = true;
    }
  }
  return options.corners || "horizontal";
}

function physicalEdge(region, rtl) {
  if (region === "start") return rtl ? "right" : "left";
  if (region === "end") return rtl ? "left" : "right";
  return region;
}

function regionBox(region, frame, insets, extent, corners, rtl) {
  const edge = physicalEdge(region, rtl);
  const full = corners === "horizontal" ? edge === "top" || edge === "bottom" : edge === "left" || edge === "right";

  if (edge === "top" || edge === "bottom") {
    const x = full ? frame.x : frame.x + insets.left;
    const w = full ? frame.w : frame.w - insets.left - insets.right;
    const y = edge === "top" ? frame.y + insets.top : frame.y + frame.h - insets.bottom - extent;
    return { x, y, w: Math.max(0, w), h: extent };
  }
  const y = full ? frame.y : frame.y + insets.top;
  const h = full ? frame.h : frame.h - insets.top - insets.bottom;
  const x = edge === "left" ? frame.x + insets.left : frame.x + frame.w - insets.right - extent;
  return { x, y, w: extent, h: Math.max(0, h) };
}

function place(ctx, child, box) {
  child.computed.x = box.x;
  child.computed.y = box.y;
  child.computed.w = box.w;
  child.computed.h = box.h;
  ctx.mk.compiler.setRect(child, child.computed);
}

/**
 * `grid` (§7.5) — a thin, well-typed wrapper over CSS Grid rather than a
 * reimplementation. The browser resolves the tracks; ARRANGE computes the same
 * numbers so snapshots and hit tests have them.
 */
export const gridLayout = {
  name: "grid",
  version: "1.0.0",

  schema: {
    columns: { type: "array", default: () => ["1fr"] },
    rows: { type: "array", default: () => ["auto"] },
    areas: { type: "any" },
    gap: { type: "len", default: 0 },
    columnGap: { type: "len" },
    rowGap: { type: "len" }
  },

  childProps: {
    column: { type: "any" },
    row: { type: "any" },
    area: { type: "string" },
    span: { type: "number", default: 1 }
  },

  childrenFrom(options) {
    return options.children || null;
  },

  arrange(node, children, ctx) {
    const options = node.algorithmOptions || {};
    const frame = node.frame;
    const gapX = ctx.len(options.columnGap != null ? options.columnGap : options.gap || 0, "x");
    const gapY = ctx.len(options.rowGap != null ? options.rowGap : options.gap || 0, "y");

    const columns = trackSizes(options.columns, frame.w, gapX, ctx, node, "x");
    const rows = trackSizes(options.rows, frame.h, gapY, ctx, node, "y");

    ctx.style("grid-template-columns", template(options.columns, ctx));
    ctx.style("grid-template-rows", template(options.rows, ctx));
    ctx.style("gap", `${gapY}px ${gapX}px`);
    if (options.areas) ctx.style("grid-template-areas", areaTemplate(options.areas));

    children.forEach((child, index) => {
      const bag = child.layoutProps || {};
      const column = resolveIndex(bag.column, index % Math.max(1, columns.length));
      const row = resolveIndex(bag.row, Math.floor(index / Math.max(1, columns.length)));

      child.computed.x = frame.x + offset(columns, column, gapX);
      child.computed.y = frame.y + offset(rows, row, gapY);
      child.computed.w = extent(columns, column, bag.span, gapX);
      child.computed.h = extent(rows, row, 1, gapY);
      ctx.mk.compiler.setRect(child, child.computed);

      if (bag.area) ctx.mk.compiler.setStyle(child, "grid-area", bag.area);
      else {
        ctx.mk.compiler.setStyle(child, "grid-column", `${column + 1} / span ${bag.span || 1}`);
        ctx.mk.compiler.setStyle(child, "grid-row", String(row + 1));
      }
    });
  },

  css() {
    return { display: "grid" };
  },

  styles: `[data-mk-algorithm="grid"] { display: grid; }`
};

function template(lens, ctx) {
  return (lens || ["1fr"]).map((len) => toCSS(parse(len), { units: (n) => ctx.mk.registry.get("unit", n) })).join(" ");
}

function areaTemplate(areas) {
  if (typeof areas === "string") return areas;
  return areas.map((row) => `"${Array.isArray(row) ? row.join(" ") : row}"`).join(" ");
}

function trackSizes(lens, available, gap, ctx, node, axis) {
  const list = lens || ["1fr"];
  const lenCtx = ctx.mk.lenContext(available, node);
  const content = Math.max(0, available - gap * Math.max(0, list.length - 1));
  const tracks = list.map((len) => {
    const ast = parse(len);
    const flexible = isFlexible(ast);
    return {
      fr: flexible ? frCoefficient(ast) : 0,
      base: flexible ? 0 : Math.max(0, toNumber(ast, lenCtx) || 0)
    };
  });
  return distributeFr(tracks, content);
}

function resolveIndex(value, fallback) {
  if (value == null) return fallback;
  return typeof value === "number" ? value - 1 : fallback;
}

function offset(tracks, index, gap) {
  let out = 0;
  for (let i = 0; i < index && i < tracks.length; i++) out += tracks[i] + gap;
  return out;
}

function extent(tracks, index, span, gap) {
  const count = Math.max(1, span || 1);
  let out = 0;
  for (let i = index; i < index + count && i < tracks.length; i++) {
    out += tracks[i] + (i > index ? gap : 0);
  }
  return out;
}

/**
 * `flow` (§7.6) — normal document flow, for prose and for content Mutakit
 * should not be positioning. An explicit escape hatch, so an author does not
 * have to leave the tree to get out of the way.
 */
export const flowLayout = {
  name: "flow",
  version: "1.0.0",
  schema: { gap: { type: "len", default: 0 } },

  arrange(node, children, ctx) {
    for (const child of children) {
      if (child.positioning !== "self") continue;
      // `flow` rejects self-positioning outright; that is what `free` is for.
      warn("MK2011", __MK_DEV__ &&
        `'${child.type}' declares positioning: 'self' inside a 'flow' parent, which places ` +
          `children in document flow. Move it into a 'free' or 'anchor' parent.`,
        { subject: child.toString() }
      );
      child.positioning = "parent";
    }
  },

  css(node) {
    const options = node.algorithmOptions || {};
    return { display: "block", gap: options.gap ? `${options.gap}px` : null };
  },

  styles: `
    [data-mk-algorithm="flow"] { display: block; }
    [data-mk-algorithm="flow"] > .mk-node { position: static; }
  `
};

/**
 * `free` (§7.7) — children position themselves. The floating-window, canvas,
 * and node-graph algorithm.
 *
 * Unlike `anchor` it maintains *state* about its children: stacking order,
 * placement of new arrivals, and the pan/zoom transform — all of which
 * serialize, because restoring a workspace of floating windows is the point of
 * the algorithm rather than an extra.
 */
export const freeLayout = {
  name: "free",
  version: "1.0.0",
  positioning: "self",

  schema: {
    bounds: { type: "any", default: "container" },
    grid: { type: "any", default: false },
    stacking: { type: "enum", values: ["recency", "declared", "manual"], default: "recency" },
    placement: { type: "any", default: "cascade" },
    collision: { type: "enum", values: ["none", "avoid", "push"], default: "none" },
    pan: { type: "boolean", default: false },
    zoom: { type: "any", default: false },
    keepVisible: { type: "number", default: 24 }
  },

  childProps: {
    x: { type: "number", persist: true },
    y: { type: "number", persist: true },
    z: { type: "number", persist: true },
    pinned: { type: "boolean", default: false }
  },

  childrenFrom(options) {
    return options.children || null;
  },

  setup(node) {
    node.state.freeCounter = node.state.freeCounter || 0;
    node.state.freePan = node.state.freePan || { x: 0, y: 0, scale: 1 };
  },

  arrange(node, children, ctx) {
    const options = node.algorithmOptions || {};
    const frame = node.frame;
    const bounds =
      options.bounds === "infinite"
        ? null
        : options.bounds && typeof options.bounds === "object"
          ? options.bounds
          : { x: 0, y: 0, w: frame.w, h: frame.h };

    for (const child of children) {
      const bag = child.layoutProps || {};
      if (bag.x == null || bag.y == null) Object.assign(bag, placeNew(node, children, child, options));

      let box = { x: bag.x, y: bag.y, w: child.computed.w, h: child.computed.h };
      const measured = child.measured || { w: 0, h: 0 };
      if (!box.w) box.w = measured.w;
      if (!box.h) box.h = measured.h;

      if (options.grid) {
        const step = typeof options.grid === "number" ? { x: options.grid, y: options.grid } : options.grid;
        if (step.snap !== "resize") {
          box.x = Math.round(box.x / step.x) * step.x;
          box.y = Math.round(box.y / step.y) * step.y;
        }
      }
      if (bounds) {
        // `keepVisible` lets a window hang off an edge but never become
        // impossible to grab (§7.7).
        box = R.clamp(box, bounds, options.keepVisible);
      }

      child.computed.x = frame.x + box.x;
      child.computed.y = frame.y + box.y;
      child.computed.w = box.w;
      child.computed.h = box.h;
      ctx.mk.compiler.setRect(child, child.computed);
      if (bag.z != null) ctx.mk.compiler.set(child, "--mk-z", String(bag.z));
    }

    if (options.pan || options.zoom) {
      const pan = node.state.freePan;
      // One transform for the whole child plane: panning a graph of 500 nodes
      // costs one write, not 500 layout resolutions (§7.7).
      ctx.css({
        "--mk-pan-x": `${pan.x}px`,
        "--mk-pan-y": `${pan.y}px`,
        "--mk-pan-scale": String(pan.scale)
      });
    }
  },

  css() {
    return { position: "relative" };
  },

  styles: `
    [data-mk-algorithm="free"]:not(.mk-node) { position: relative; }
    [data-mk-algorithm="free"] { overflow: hidden; }
    [data-mk-algorithm="free"] > .mk-node { z-index: var(--mk-z, auto); }
  `
};

/**
 * Where a child with no position goes. Windows that all open at the same
 * coordinates are a classic annoyance; `cascade` is the default that avoids it.
 */
function placeNew(node, children, child, options) {
  const mode = options.placement || "cascade";
  if (typeof mode === "function") return mode(child, children, node);

  const frame = node.frame;
  const size = child.measured || { w: 320, h: 240 };

  if (mode === "center") {
    return { x: Math.max(0, (frame.w - size.w) / 2), y: Math.max(0, (frame.h - size.h) / 2) };
  }
  if (mode === "first-fit") {
    for (let y = 0; y + size.h <= frame.h; y += 24) {
      for (let x = 0; x + size.w <= frame.w; x += 24) {
        const candidate = { x, y, w: size.w, h: size.h };
        const clash = children.some(
          (other) =>
            other !== child &&
            other.layoutProps.x != null &&
            R.intersects(candidate, {
              x: other.layoutProps.x,
              y: other.layoutProps.y,
              w: other.computed.w,
              h: other.computed.h
            })
        );
        if (!clash) return candidate;
      }
    }
    return { x: 0, y: 0 };
  }

  const index = node.state.freeCounter++;
  const step = 28;
  const wrap = Math.max(1, Math.floor((frame.h - size.h) / step) || 1);
  return { x: (index % wrap) * step, y: (index % wrap) * step };
}

export const EXTRA_LAYOUTS = [dockLayout, gridLayout, flowLayout, freeLayout];
