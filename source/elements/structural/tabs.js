/**
 * `tabs`, `accordion`, `scroll`, and `window` (§11.1, §11.2).
 *
 * The structural types that need real behaviour rather than just a box: roving
 * focus, managed overflow, and — for `window` — the composition of three traits
 * that would otherwise be reimplemented by every application that wants a
 * floating panel.
 */
import "../../core/dev.js";
import * as dom from "../../core/dom.js";
import { css } from "../../styles/index.js";

/** `tabs` — a tabbed pane group with `tablist`/`tab`/`tabpanel` semantics. */
export const tabs = {
  type: "tabs",
  version: "1.0.0",
  algorithm: "anchor",

  props: {
    items: { type: "array", default: () => [] },
    active: { type: "string", default: "", persist: true },
    closable: { type: "boolean", default: false },
    reorderable: { type: "boolean", default: false },
    placement: { type: "enum", values: ["top", "bottom"], default: "top" }
  },

  events: ["change", "close", "reorder"],
  a11y: { role: "group", props: { "aria-label": (ctx) => ctx.props.label || null } },

  commands: {
    select(ctx, id) {
      if (ctx.props.active === id) return;
      ctx.handle.set({ active: id });
      ctx.mk.persistDirty = true;
      ctx.emit("change", { active: id });
    },
    close(ctx, id) {
      const remaining = ctx.props.items.filter((item) => idOf(item) !== id);
      ctx.handle.set({ items: remaining });
      if (ctx.props.active === id && remaining.length) {
        ctx.node.definition.commands.select(ctx, idOf(remaining[0]));
      }
      ctx.emit("close", { id });
    }
  },

  create(ctx) {
    const el = ctx.dom("div", { class: `mk-tabs mk-tabs--${ctx.props.placement}` }, null);
    ctx.state.list = dom.el("div", { class: "mk-tabs__list", role: "tablist" }, el);
    ctx.state.panels = dom.el("div", { class: "mk-tabs__panels" }, el);
    ctx.node.contentEl = ctx.state.panels;
    ctx.own(dom.listen(ctx.state.list, "keydown", (event) => onTabKey(ctx, event)));
    renderTabs(ctx);
    return el;
  },

  update(ctx, changed) {
    if (changed.has("items") || changed.has("active") || changed.has("closable")) renderTabs(ctx);
  },

  /**
   * Panels are children, and children are created *after* the element that
   * groups them — so syncing only in `create` leaves every panel visible and
   * every one of them in the tab order. Idempotent, and it costs three
   * attribute reads per panel.
   */
  arrange(ctx) {
    syncPanels(ctx);
  },

  styles: css`
    .mk-tabs { display: flex; flex-direction: column; }
    .mk-tabs--bottom { flex-direction: column-reverse; }
    .mk-tabs__list {
      display: flex;
      gap: 2px;
      border-bottom: 1px solid var(--mk-border-subtle);
      overflow-x: auto;
    }
    .mk-tabs__tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      min-height: var(--mk-target-min);
      border: 0;
      background: none;
      cursor: pointer;
      border-bottom: 2px solid transparent;
    }
    .mk-tabs__tab[aria-selected="true"] {
      border-bottom-color: var(--mk-color-accent);
      font-weight: 600;
    }
    .mk-tabs__close {
      border: 0;
      background: none;
      cursor: pointer;
      line-height: 1;
      min-width: 20px;
    }
    .mk-tabs__panels { flex: 1 1 auto; min-height: 0; position: relative; }
  `
};

function idOf(item) {
  return typeof item === "string" ? item : item.id;
}

function labelOf(item) {
  return typeof item === "string" ? item : item.label || item.id;
}

function renderTabs(ctx) {
  const list = ctx.state.list;
  list.textContent = "";
  ctx.state.tabs = [];

  const items = ctx.props.items || [];
  const active = ctx.props.active || (items.length ? idOf(items[0]) : "");

  items.forEach((item) => {
    const id = idOf(item);
    const selected = id === active;
    const tab = dom.el("button", {
      type: "button",
      role: "tab",
      class: "mk-tabs__tab",
      id: `${id}-tab`,
      "aria-selected": String(selected),
      "aria-controls": `${id}-panel`,
      // Roving tabindex: a tablist is one tab stop, and arrows move within it.
      tabindex: selected ? "0" : "-1",
      text: labelOf(item)
    }, list);
    ctx.state.tabs.push({ tab, id });
    ctx.own(dom.listen(tab, "click", () => ctx.node.definition.commands.select(ctx, id)));

    if (ctx.props.closable) {
      const close = dom.el("span", {
        class: "mk-tabs__close",
        role: "button",
        tabindex: "-1",
        "aria-label": `Close ${labelOf(item)}`,
        text: "×"
      }, tab);
      ctx.own(
        dom.listen(close, "click", (event) => {
          event.stopPropagation();
          ctx.node.definition.commands.close(ctx, id);
        })
      );
    }
  });

  syncPanels(ctx);
}

/** Panels are the element's children, shown and hidden by id. */
function syncPanels(ctx) {
  const items = ctx.props.items || [];
  const active = ctx.props.active || (items.length ? idOf(items[0]) : "");
  for (const child of ctx.node.children) {
    if (!child.el) continue;
    const selected = child.id === active;
    child.el.setAttribute("role", "tabpanel");
    child.el.id = `${child.id}-panel`;
    child.el.setAttribute("aria-labelledby", `${child.id}-tab`);
    child.el.hidden = !selected;
    // A hidden panel is out of the tab order entirely, not merely invisible:
    // `hidden` alone still leaves focusable descendants reachable in engines
    // that treat it as a style.
    child.el.toggleAttribute("inert", !selected);
  }
}

function onTabKey(ctx, event) {
  const entries = ctx.state.tabs || [];
  if (!entries.length) return;
  const index = entries.findIndex((entry) => entry.id === ctx.props.active);
  let next = null;
  if (event.key === "ArrowRight") next = index + 1;
  else if (event.key === "ArrowLeft") next = index - 1;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = entries.length - 1;
  else if (event.key === "Delete" && ctx.props.closable) {
    event.preventDefault();
    ctx.node.definition.commands.close(ctx, entries[index].id);
    return;
  } else return;

  event.preventDefault();
  const entry = entries[(next + entries.length) % entries.length];
  ctx.node.definition.commands.select(ctx, entry.id);
  entry.tab.focus();
}

/** `accordion` — vertically stacked collapsible sections. */
export const accordion = {
  type: "accordion",
  version: "1.0.0",
  algorithm: "stack",
  props: {
    sections: { type: "array", default: () => [] },
    open: { type: "array", of: "string", default: () => [], persist: true },
    multiple: { type: "boolean", default: false }
  },
  events: ["toggle"],
  a11y: { role: "group" },

  commands: {
    toggle(ctx, id) {
      const isOpen = ctx.props.open.includes(id);
      const next = isOpen
        ? ctx.props.open.filter((other) => other !== id)
        : ctx.props.multiple
          ? [...ctx.props.open, id]
          : [id];
      ctx.handle.set({ open: next });
      ctx.emit("toggle", { id, open: !isOpen });
    }
  },

  create(ctx) {
    const el = ctx.dom("div", { class: "mk-accordion" }, null);
    ctx.state.render = () => {
      el.textContent = "";
      for (const section of ctx.props.sections) {
        const id = idOf(section);
        const open = ctx.props.open.includes(id);
        const heading = dom.el("h3", { class: "mk-accordion__heading" }, el);
        const trigger = dom.el("button", {
          type: "button",
          class: "mk-accordion__trigger",
          id: `${id}-trigger`,
          "aria-expanded": String(open),
          "aria-controls": `${id}-region`,
          text: labelOf(section)
        }, heading);
        const region = dom.el("div", {
          class: "mk-accordion__region",
          id: `${id}-region`,
          role: "region",
          "aria-labelledby": `${id}-trigger`,
          hidden: open ? null : ""
        }, el);
        if (section.content) dom.setText(region, section.content);
        ctx.own(dom.listen(trigger, "click", () => ctx.node.definition.commands.toggle(ctx, id)));
      }
    };
    ctx.state.render();
    return el;
  },

  update(ctx, changed) {
    if (changed.has("open") || changed.has("sections")) ctx.state.render();
  },

  styles: css`
    .mk-accordion__heading { margin: 0; }
    .mk-accordion__trigger {
      display: block;
      width: 100%;
      text-align: left;
      padding: 8px 12px;
      min-height: var(--mk-target-min);
      border: 0;
      border-top: 1px solid var(--mk-border-subtle);
      background: none;
      cursor: pointer;
      font-weight: 600;
    }
    .mk-accordion__region { padding: 8px 12px; }
  `
};

/** `scroll` — a scrollable viewport with managed overflow (§5.11). */
export const scroll = {
  type: "scroll",
  version: "1.0.0",
  extends: "pane",
  props: {
    axis: { type: "enum", values: ["y", "x", "both"], default: "y" },
    restore: { type: "boolean", default: true },
    offset: { type: "object", default: () => ({ x: 0, y: 0 }), persist: true }
  },
  events: ["scroll"],
  a11y: { role: "group", props: { tabindex: "0" } },

  mount(ctx) {
    const el = ctx.el;
    el.style.overflowX = ctx.props.axis === "y" ? "hidden" : "auto";
    el.style.overflowY = ctx.props.axis === "x" ? "hidden" : "auto";
    el.style.overscrollBehavior = "contain";
    if (ctx.props.restore) {
      el.scrollLeft = ctx.props.offset.x || 0;
      el.scrollTop = ctx.props.offset.y || 0;
    }
    ctx.own(
      dom.listen(el, "scroll", () => {
        // Scroll position is state, not geometry: it sets PAINT, never
        // ARRANGE (§5.11 rule 5).
        ctx.node.props.offset = { x: el.scrollLeft, y: el.scrollTop };
        ctx.mk.persistDirty = true;
        ctx.invalidate("paint");
        ctx.emit("scroll", { x: el.scrollLeft, y: el.scrollTop });
      })
    );
  }
};

/**
 * `window` — a floating, draggable, resizable pane with a title bar.
 *
 * Three traits composed, which is the whole implementation. It sits in a
 * `free` parent, where `positioning: 'self'` is already the default (§9.1), so
 * dragging works with no configuration.
 */
export const windowElement = {
  type: "window",
  version: "1.0.0",
  extends: "surface",
  layer: "docked",
  traits: ["draggable", "resizable"],

  props: {
    title: { type: "string", default: "" },
    closable: { type: "boolean", default: true },
    minimizable: { type: "boolean", default: false },
    minimized: { type: "boolean", default: false, persist: true }
  },

  events: ["close", "minimize", "restore", "focus"],
  /** A pointer trait is composed, so a keyboard equivalent is mandatory (P5). */
  keys: {
    ArrowLeft: "move-left",
    ArrowRight: "move-right",
    ArrowUp: "move-up",
    ArrowDown: "move-down",
    Escape: "close"
  },
  geometry: { defaults: { size: { w: 420, h: 300 } } },
  a11y: {
    role: "dialog",
    props: {
      "aria-label": (ctx) => ctx.props.title || null,
      "aria-modal": "false"
    }
  },

  commands: {
    close(ctx) {
      ctx.emit("close", {});
      ctx.mk.destroy(ctx.node);
    },
    minimize(ctx) {
      ctx.handle.set({ minimized: !ctx.props.minimized });
      ctx.emit(ctx.props.minimized ? "minimize" : "restore", {});
    },
    bringToFront(ctx) {
      const layers = ctx.service("layers");
      if (layers) layers.bringToFront(ctx.node);
    }
  },

  create(ctx, inherited) {
    const el = inherited;
    const bar = dom.el("div", { class: "mk-window__bar" }, el);
    dom.el("span", { class: "mk-window__title", text: ctx.props.title }, bar);

    if (ctx.props.minimizable) {
      const minimize = dom.el("button", {
        type: "button", class: "mk-window__action", "aria-label": "Minimize", text: "–"
      }, bar);
      ctx.own(dom.listen(minimize, "click", () => ctx.node.definition.commands.minimize(ctx)));
    }
    if (ctx.props.closable) {
      const close = dom.el("button", {
        type: "button", class: "mk-window__action", "aria-label": "Close", text: "×"
      }, bar);
      ctx.own(dom.listen(close, "click", () => ctx.node.definition.commands.close(ctx)));
    }

    const body = dom.el("div", { class: "mk-window__body" }, el);
    ctx.node.contentEl = body;
    // Dragging is by the title bar, not the whole surface — otherwise a drag
    // that begins on the content selects text instead.
    ctx.node.state.traitOptions = { draggable: { handle: ".mk-window__bar" } };
    return el;
  },

  mount(ctx) {
    const layers = ctx.service("layers");
    if (layers) {
      layers.add(ctx.node, ctx.node.layer);
      ctx.own(() => layers.remove(ctx.node));
      // Recency stacking: raise on pointer-down or focus. Order is *within*
      // the band, so a window can never escape above a modal (§7.7, §16.1).
      ctx.own(dom.listen(ctx.el, "pointerdown", () => layers.bringToFront(ctx.node)));
      ctx.own(dom.listen(ctx.el, "focusin", () => {
        layers.bringToFront(ctx.node);
        ctx.emit("focus", {});
      }));
    }
  },

  update(ctx, changed) {
    if (changed.has("minimized")) ctx.setState("minimized", ctx.props.minimized);
    if (changed.has("title")) {
      const title = ctx.el.querySelector(".mk-window__title");
      if (title) dom.setText(title, ctx.props.title);
    }
  },

  styles: css`
    .mk-window { display: flex; flex-direction: column; box-shadow: var(--mk-elevation-2); }
    .mk-window__bar {
      display: flex;
      align-items: center;
      gap: var(--mk-space-2);
      padding: 4px 8px;
      cursor: move;
      background: var(--mk-color-surface-sunken);
      border-bottom: 1px solid var(--mk-border-subtle);
      touch-action: none;
    }
    .mk-window__title { flex: 1 1 auto; font-weight: 600; font-size: var(--mk-text-sm); }
    .mk-window__action {
      border: 0;
      background: none;
      cursor: pointer;
      min-width: var(--mk-target-min);
      min-height: var(--mk-target-min);
    }
    .mk-window__body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: var(--mk-space-3); }
    .mk-window[data-mk-minimized] .mk-window__body { display: none; }
    .mk-window[data-mk-minimized] { height: auto !important; }
  `
};

export const STRUCTURAL_EXTRAS = [tabs, accordion, scroll, windowElement];
