/**
 * Display and feedback (§11.4).
 *
 * **Deliberately short**, and the test applied to every candidate is stated in
 * the plan: *does it need the geometry engine, the layer system, or the focus
 * manager?* If not, it is a styled `<div>` an author can write in ten lines,
 * and shipping it would make Mutakit a design system — an explicit non-goal.
 *
 * That test cuts `avatar`, `badge`, `chip`, `skeleton`, `code`, `image`,
 * `breadcrumb`, `pagination`, and `table`; `docs/recipes/` covers those in
 * prose instead of code. What survives are the ones that pass: `progress`,
 * `meter`, and `spinner` carry live ARIA values, `empty-state` composes a
 * layout, and `tree` and `list` need roving focus, selection, and
 * virtualization — three things no `<div>` gets for free.
 */
import "../../core/dev.js";
import * as dom from "../../core/dom.js";
import { css } from "../../styles/index.js";

/**
 * `text-block` — a typographic primitive, present so the tier-2 form can carry
 * copy.
 *
 * **Named `text-block`, not `text`.** §11.3 lists `text` among the form
 * controls, where it unambiguously means a text *input*, and §11.4 lists `text`
 * among the display primitives, where it means a paragraph. Both are bare names
 * in the same flat registry, so only one can have it — and `field.create('text',
 * { name })` is the established call site, while a top-level `create('text')`
 * has none. The collision only becomes visible once both catalogs exist.
 */
export const textBlock = {
  type: "text-block",
  version: "1.0.0",
  props: {
    content: { type: "string", default: "" },
    variant: { type: "enum", values: ["body", "heading", "caption", "mono"], default: "body" },
    as: { type: "string", default: "p" },
    truncate: { type: "boolean", default: false }
  },
  a11y: "presentation",
  geometry: { defaults: { size: { w: "auto", h: "auto" } } },

  create(ctx) {
    // The tag is the semantics: a heading that renders as `<p>` is a heading
    // only to sighted readers.
    const el = ctx.dom(ctx.props.as || "p", { class: `mk-text mk-text--${ctx.props.variant}` });
    dom.setText(el, ctx.props.content);
    ctx.setState("truncate", ctx.props.truncate);
    return el;
  },

  update(ctx, changed) {
    if (changed.has("content")) dom.setText(ctx.el, ctx.props.content);
    if (changed.has("truncate")) ctx.setState("truncate", ctx.props.truncate);
  },

  styles: css`
    .mk-text { margin: 0; }
    .mk-text--heading { font-size: var(--mk-text-lg); font-weight: 600; }
    .mk-text--caption { font-size: var(--mk-text-sm); color: var(--mk-text-secondary); }
    .mk-text--mono { font-family: var(--mk-font-mono); }
    .mk-text[data-mk-truncate] {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `
};

/** `icon` — a glyph slot. Presentational unless it is given a label. */
export const icon = {
  type: "icon",
  version: "1.0.0",
  props: {
    name: { type: "string", default: "" },
    label: { type: "string", default: "" },
    size: { type: "len", default: 16 }
  },
  /**
   * `img` when it carries meaning, `presentation` when it does not — decided
   * by whether the author gave it a label, which is the only honest signal.
   */
  a11y: {
    role: (ctx) => (ctx.props.label ? "img" : "presentation"),
    props: { "aria-label": (ctx) => ctx.props.label || null }
  },
  geometry: { defaults: { size: { w: "auto", h: "auto" } } },

  create(ctx) {
    const el = ctx.dom("span", { class: "mk-icon", "data-icon": ctx.props.name });
    ctx.css({ "--mk-icon-size": lengthOf(ctx.props.size) });
    return el;
  },

  styles: css`
    .mk-icon {
      display: inline-block;
      width: var(--mk-icon-size, 16px);
      height: var(--mk-icon-size, 16px);
      background: currentColor;
      mask: var(--mk-icon-mask) center / contain no-repeat;
      -webkit-mask: var(--mk-icon-mask) center / contain no-repeat;
    }
  `
};

function lengthOf(value) {
  return typeof value === "number" ? `${value}px` : String(value);
}

/** `divider` — a separator, with the role that makes it one. */
export const divider = {
  type: "divider",
  version: "1.0.0",
  props: { orientation: { type: "enum", values: ["horizontal", "vertical"], default: "horizontal" } },
  a11y: {
    role: "separator",
    props: { "aria-orientation": (ctx) => ctx.props.orientation }
  },
  geometry: { defaults: { size: { w: "auto", h: "auto" } } },
  create(ctx) {
    return ctx.dom("hr", { class: `mk-divider mk-divider--${ctx.props.orientation}` });
  },
  styles: css`
    .mk-divider { border: 0; background: var(--mk-border-subtle); margin: 0; }
    .mk-divider--horizontal { height: 1px; width: 100%; }
    .mk-divider--vertical { width: 1px; height: 100%; }
  `
};

/**
 * `progress` — task completion, determinate or not.
 *
 * It earns its place by carrying a *live* ARIA value: an indeterminate
 * progress bar must drop `aria-valuenow` entirely rather than report zero,
 * which is the distinction a styled `<div>` invariably gets wrong.
 */
export const progress = {
  type: "progress",
  version: "1.0.0",
  props: {
    value: { type: "number", min: 0, max: 1 },
    label: { type: "string", default: "" },
    indeterminate: { type: "boolean", default: false }
  },
  events: ["complete"],
  a11y: {
    role: "progressbar",
    props: {
      "aria-label": (ctx) => ctx.props.label || null,
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      // Absent, not zero: "unknown" and "none yet" are different claims.
      "aria-valuenow": (ctx) =>
        ctx.props.indeterminate || ctx.props.value == null
          ? null
          : Math.round(ctx.props.value * 100),
      "aria-valuetext": (ctx) =>
        ctx.props.indeterminate || ctx.props.value == null
          ? null
          : ctx.mk.formatted("percent", ctx.props.value, { min: 0, max: 1 })
    }
  },
  geometry: { defaults: { size: { w: "100%", h: 6 } } },

  create(ctx) {
    const el = ctx.dom("div", { class: "mk-progress" });
    ctx.state.fill = dom.el("span", { class: "mk-progress__fill", "aria-hidden": "true" }, el);
    applyProgress(ctx);
    return el;
  },

  update(ctx, changed) {
    if (!changed.has("value") && !changed.has("indeterminate")) return;
    applyProgress(ctx);
    if (ctx.props.value >= 1) ctx.emit("complete", { value: ctx.props.value });
  },

  styles: css`
    .mk-progress {
      overflow: hidden;
      border-radius: 999px;
      background: var(--mk-color-surface-sunken);
    }
    .mk-progress__fill {
      display: block;
      height: 100%;
      transform-origin: left center;
      transform: scaleX(var(--mk-progress-value, 0));
      background: var(--mk-color-accent);
      transition: transform var(--mk-dur-med) var(--mk-ease-out);
    }
    .mk-progress[data-mk-indeterminate] .mk-progress__fill {
      transform: none;
      width: 40%;
      animation: mk-progress-slide 1.2s ease-in-out infinite;
    }
    @keyframes mk-progress-slide {
      from { margin-left: -40%; }
      to { margin-left: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .mk-progress__fill { transition: none; }
      .mk-progress[data-mk-indeterminate] .mk-progress__fill { animation-duration: 3s; }
    }
  `
};

function applyProgress(ctx) {
  ctx.setState("indeterminate", ctx.props.indeterminate || ctx.props.value == null);
  // A scale, not a width: the same reason `hud-bar` uses one (§17).
  ctx.css({ "--mk-progress-value": String(clamp01(ctx.props.value)) });
}

function clamp01(value) {
  return Math.min(Math.max(value || 0, 0), 1);
}

/** `meter` — a measurement within a range, which is not the same as progress. */
export const meter = {
  type: "meter",
  version: "1.0.0",
  props: {
    value: { type: "number", default: 0 },
    min: { type: "number", default: 0 },
    max: { type: "number", default: 100 },
    low: { type: "number" },
    high: { type: "number" },
    label: { type: "string", default: "" }
  },
  /**
   * `meter`, not `progressbar`: progress goes one way and completes, a meter
   * reports a level that can move either way and never completes.
   */
  a11y: {
    role: "meter",
    props: {
      "aria-label": (ctx) => ctx.props.label || null,
      "aria-valuenow": (ctx) => ctx.props.value,
      "aria-valuemin": (ctx) => ctx.props.min,
      "aria-valuemax": (ctx) => ctx.props.max,
      // §10.13's formatters, where they earn their keep. A screen reader
      // announcing "73%" tells a user what a bare 0.73 does not, and routing
      // it through the registry means an application says "3 of 5" or "two
      // thirds full" once rather than per element.
      "aria-valuetext": (ctx) =>
        ctx.mk.formatted("percent", ctx.props.value, { min: ctx.props.min, max: ctx.props.max })
    }
  },
  geometry: { defaults: { size: { w: 120, h: 8 } } },

  create(ctx) {
    const el = ctx.dom("div", { class: "mk-meter" });
    dom.el("span", { class: "mk-meter__fill", "aria-hidden": "true" }, el);
    applyMeter(ctx);
    return el;
  },

  update(ctx) {
    applyMeter(ctx);
  },

  styles: css`
    .mk-meter { overflow: hidden; border-radius: 999px; background: var(--mk-color-surface-sunken); }
    .mk-meter__fill {
      display: block;
      height: 100%;
      transform-origin: left center;
      transform: scaleX(var(--mk-meter-value, 0));
      background: var(--mk-meter-colour, var(--mk-color-success));
    }
    .mk-meter[data-mk-level="low"] { --mk-meter-colour: var(--mk-color-danger); }
    .mk-meter[data-mk-level="high"] { --mk-meter-colour: var(--mk-color-warning); }
  `
};

function applyMeter(ctx) {
  const { value, min, max, low, high } = ctx.props;
  const span = max - min || 1;
  ctx.css({ "--mk-meter-value": String(clamp01((value - min) / span)) });
  ctx.setState("level", low != null && value < low ? "low" : high != null && value > high ? "high" : "ok");
}

/**
 * `spinner` — an indeterminate wait.
 *
 * `role="status"` with a label, because a spinner nobody can perceive is a
 * page that has silently stopped responding.
 */
export const spinner = {
  type: "spinner",
  version: "1.0.0",
  props: { label: { type: "string", default: "Loading" }, size: { type: "len", default: 20 } },
  a11y: { role: "status", props: { "aria-label": (ctx) => ctx.props.label || "Loading" } },
  geometry: { defaults: { size: { w: "auto", h: "auto" } } },
  create(ctx) {
    const el = ctx.dom("span", { class: "mk-spinner" });
    ctx.css({ "--mk-spinner-size": lengthOf(ctx.props.size) });
    return el;
  },
  styles: css`
    .mk-spinner {
      display: inline-block;
      width: var(--mk-spinner-size, 20px);
      height: var(--mk-spinner-size, 20px);
      border: 2px solid var(--mk-border-strong);
      border-top-color: var(--mk-color-accent);
      border-radius: 50%;
      animation: mk-spin 0.8s linear infinite;
    }
    @keyframes mk-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      /* Slowed, not stopped: a frozen spinner reads as a hung page. */
      .mk-spinner { animation-duration: 2.4s; }
    }
  `
};

/** `empty-state` — the composition every application writes badly once. */
export const emptyState = {
  type: "empty-state",
  version: "1.0.0",
  extends: "pane",
  props: {
    title: { type: "string", default: "" },
    description: { type: "string", default: "" },
    action: { type: "any" }
  },
  events: ["action"],
  a11y: { role: "status", props: { "aria-label": (ctx) => ctx.props.title || null } },
  algorithm: "stack",

  create(ctx, inherited) {
    const el = inherited;
    el.classList.add("mk-empty-state");
    if (ctx.props.title) dom.el("h3", { class: "mk-empty-state__title", text: ctx.props.title }, el);
    if (ctx.props.description) {
      dom.el("p", { class: "mk-empty-state__description", text: ctx.props.description }, el);
    }
    if (ctx.props.action) {
      const button = dom.el("button", {
        type: "button",
        class: "mk-button mk-button--primary",
        text: ctx.props.action.label
      }, el);
      ctx.own(dom.listen(button, "click", () => ctx.emit("action", { action: ctx.props.action })));
    }
    return el;
  },

  styles: css`
    .mk-empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--mk-space-2);
      text-align: center;
      padding: var(--mk-space-6);
      color: var(--mk-text-secondary);
    }
    .mk-empty-state__title { margin: 0; font-size: var(--mk-text-lg); color: var(--mk-text-primary); }
    .mk-empty-state__description { margin: 0; }
  `
};

/**
 * `list` — selection and virtualization, which is why it is an element and not
 * a `<ul>` an author writes themselves.
 *
 * It composes the traits rather than reimplementing them: `selectable` for the
 * modifiers, `virtualized` for the window, `scrollable` for the container. The
 * element's job is to say which traits and to render rows.
 */
export const list = {
  type: "list",
  version: "1.0.0",
  traits: ["scrollable", "selectable"],
  props: {
    items: { type: "array", default: () => [] },
    selection: { type: "enum", values: ["none", "single", "multiple"], default: "single" },
    rowHeight: { type: "number", default: 28 },
    virtual: { type: "boolean", default: false },
    label: { type: "string", default: "" }
  },
  events: ["select", "activate"],
  keys: { ArrowUp: "previous", ArrowDown: "next", Enter: "activate" },
  a11y: {
    role: "listbox",
    props: {
      "aria-label": (ctx) => ctx.props.label || null,
      "aria-multiselectable": (ctx) => (ctx.props.selection === "multiple" ? "true" : null)
    }
  },
  geometry: { defaults: { size: { w: "100%", h: "100%" } } },

  commands: {
    /** The rows currently rendered — the window, when virtualized. */
    rendered(ctx) {
      return ctx.state.rendered.slice();
    }
  },

  create(ctx) {
    const el = ctx.dom("div", { class: "mk-list" });
    ctx.node.state.traitOptions = {
      selectable: { mode: ctx.props.selection === "multiple" ? "multiple" : "single" },
      scrollable: { axis: "y" }
    };
    ctx.state.rendered = [];
    ctx.state.render = () => renderRows(ctx, el);
    ctx.state.render();
    return el;
  },

  mount(ctx) {
    if (!ctx.props.virtual) return;
    const api = ctx.mk.attachTrait(ctx.node, "virtualized", {
      rowHeight: ctx.props.rowHeight,
      total: ctx.props.items.length
    });
    ctx.state.virtual = api;
    ctx.on("rangechange", () => ctx.state.render());
  },

  update(ctx, changed) {
    if (changed.has("items")) {
      if (ctx.state.virtual) ctx.state.virtual.setTotal(ctx.props.items.length);
      ctx.state.render();
    }
  },

  styles: css`
    /* No position declaration: the engine decides whether a node is
       absolute or in flow, and an absolutely positioned box establishes a
       containing block just as a relative one does. Declaring it here beat
       the base stylesheet's absolute positioning on .mk-node and displaced
       the element by whatever flow put above it. See layout/anchor.js. */
    .mk-list { overflow: auto; }
    .mk-list__row {
      display: flex;
      align-items: center;
      padding: 0 var(--mk-space-3);
      cursor: default;
      user-select: none;
    }
    .mk-list__row[aria-selected="true"] { background: var(--mk-color-surface-sunken); }
  `
};

function renderRows(ctx, el) {
  const items = ctx.props.items || [];
  const range = ctx.state.virtual ? ctx.state.virtual.range : { start: 0, end: items.length };
  const rowHeight = ctx.props.rowHeight;
  ctx.state.rendered = [];

  for (const old of [...el.querySelectorAll(".mk-list__row")]) dom.remove(old);

  for (let index = range.start; index < Math.min(range.end, items.length); index++) {
    const item = items[index];
    const id = typeof item === "string" ? item : item.id;
    const label = typeof item === "string" ? item : item.label;
    const row = dom.el("div", {
      class: "mk-list__row",
      role: "option",
      id: `row-${id}`,
      tabindex: index === range.start ? "0" : "-1",
      "aria-selected": "false",
      "aria-setsize": String(items.length),
      "aria-posinset": String(index + 1),
      text: label,
      style: ctx.state.virtual
        ? { position: "absolute", top: `${index * rowHeight}px`, left: "0", right: "0", height: `${rowHeight}px` }
        : { height: `${rowHeight}px` }
    }, el);
    ctx.state.rendered.push(id);
    ctx.own(
      dom.listen(row, "click", (event) => {
        const selectable = ctx.trait("selectable");
        if (selectable) {
          selectable.select(id, { additive: event.ctrlKey || event.metaKey, range: event.shiftKey });
        }
        ctx.emit("select", { id, index, item });
      })
    );
    ctx.own(dom.listen(row, "dblclick", () => ctx.emit("activate", { id, index, item })));
  }
}

/**
 * `tree` — roving focus over a hierarchy.
 *
 * The roving tabindex is the reason this is an element: a tree is **one** tab
 * stop, arrows move within it, and left/right collapse and expand. None of
 * that is available to a nested `<ul>` without writing exactly this.
 */
export const tree = {
  type: "tree",
  version: "1.0.0",
  traits: ["scrollable"],
  props: {
    data: { type: "array", default: () => [] },
    expanded: { type: "array", of: "string", default: () => [], persist: true },
    selected: { type: "string", default: "", persist: true },
    label: { type: "string", default: "" }
  },
  events: ["select", "expand", "collapse"],
  keys: {
    ArrowUp: "previous",
    ArrowDown: "next",
    ArrowRight: "expand",
    ArrowLeft: "collapse",
    Home: "first",
    End: "last",
    Enter: "select"
  },
  a11y: { role: "tree", props: { "aria-label": (ctx) => ctx.props.label || null } },
  geometry: { defaults: { size: { w: "100%", h: "100%" } } },

  commands: {
    toggle(ctx, id) {
      const open = ctx.props.expanded.includes(id);
      ctx.handle.set({
        expanded: open ? ctx.props.expanded.filter((other) => other !== id) : [...ctx.props.expanded, id]
      });
      ctx.emit(open ? "collapse" : "expand", { id });
    },
    select(ctx, id) {
      ctx.handle.set({ selected: id });
      ctx.emit("select", { id });
    }
  },

  create(ctx) {
    const el = ctx.dom("div", { class: "mk-tree" });
    ctx.state.render = () => renderTree(ctx, el);
    ctx.state.render();
    ctx.own(dom.listen(el, "keydown", (event) => onTreeKey(ctx, event)));
    return el;
  },

  update(ctx, changed) {
    if (changed.has("data") || changed.has("expanded") || changed.has("selected")) ctx.state.render();
  },

  styles: css`
    .mk-tree { overflow: auto; }
    .mk-tree__node {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px var(--mk-space-2);
      min-height: var(--mk-target-min);
      cursor: default;
      user-select: none;
    }
    .mk-tree__node[aria-selected="true"] { background: var(--mk-color-surface-sunken); }
    .mk-tree__twisty { width: 12px; text-align: center; opacity: 0.7; }
  `
};

function flatten(nodes, expanded, depth = 1, out = []) {
  for (const node of nodes || []) {
    out.push({ node, depth });
    // Only expanded branches are flattened, so the visible order *is* the
    // keyboard order — which is what makes arrow navigation correct rather
    // than merely present.
    if (node.children && expanded.includes(node.id)) {
      flatten(node.children, expanded, depth + 1, out);
    }
  }
  return out;
}

function renderTree(ctx, el) {
  el.textContent = "";
  const rows = flatten(ctx.props.data, ctx.props.expanded);
  ctx.state.rows = rows;

  rows.forEach(({ node, depth }, index) => {
    const expandable = !!(node.children && node.children.length);
    const open = ctx.props.expanded.includes(node.id);
    const selected = ctx.props.selected === node.id;
    const row = dom.el("div", {
      class: "mk-tree__node",
      role: "treeitem",
      id: `tree-${node.id}`,
      "aria-level": String(depth),
      "aria-expanded": expandable ? String(open) : null,
      "aria-selected": String(selected),
      // One tab stop: the selected row, or the first.
      tabindex: selected || (!ctx.props.selected && index === 0) ? "0" : "-1",
      style: { paddingLeft: `${depth * 12}px` }
    }, el);
    dom.el("span", { class: "mk-tree__twisty", "aria-hidden": "true", text: expandable ? (open ? "▾" : "▸") : "" }, row);
    dom.el("span", { text: node.label }, row);

    ctx.own(dom.listen(row, "click", () => ctx.node.definition.commands.select(ctx, node.id)));
    if (expandable) {
      ctx.own(
        dom.listen(row, "dblclick", () => ctx.node.definition.commands.toggle(ctx, node.id))
      );
    }
  });
}

function onTreeKey(ctx, event) {
  const rows = ctx.state.rows || [];
  if (!rows.length) return;
  const index = rows.findIndex(({ node }) => node.id === ctx.props.selected);
  const current = rows[index === -1 ? 0 : index];
  let next = null;

  if (event.key === "ArrowDown") next = index + 1;
  else if (event.key === "ArrowUp") next = index - 1;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = rows.length - 1;
  else if (event.key === "ArrowRight") {
    if (current && current.node.children && !ctx.props.expanded.includes(current.node.id)) {
      event.preventDefault();
      ctx.node.definition.commands.toggle(ctx, current.node.id);
    }
    return;
  } else if (event.key === "ArrowLeft") {
    if (current && ctx.props.expanded.includes(current.node.id)) {
      event.preventDefault();
      ctx.node.definition.commands.toggle(ctx, current.node.id);
    }
    return;
  } else return;

  event.preventDefault();
  const row = rows[Math.min(Math.max(next, 0), rows.length - 1)];
  ctx.node.definition.commands.select(ctx, row.node.id);
  const el = ctx.el.querySelector(`#tree-${CSS.escape(row.node.id)}`);
  if (el) el.focus();
}

export const DISPLAY_ELEMENTS = [textBlock, icon, divider, progress, meter, spinner, emptyState, list, tree];
