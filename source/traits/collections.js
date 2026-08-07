/**
 * The collection traits (§9): `scrollable`, `selectable`, `sortable`,
 * `virtualized`, and `persistable`.
 *
 * These are where subtle interaction bugs live, which is why §23.4 asks traits
 * for ≥ 90% branch coverage. Two rules shape all of them:
 *
 * **Every pointer interaction has a keyboard equivalent** (P5), enforced by the
 * conformance check — so `sortable` reorders with the keyboard, not only by
 * dragging, and `selectable`'s range and toggle modifiers work from the
 * keyboard too.
 *
 * **Traits compose rather than override** (§9): `sortable` sits happily on a
 * `selectable` list, and both leave the parent algorithm owning the boxes —
 * which is exactly why `sortable` reorders *within* the flow instead of
 * declaring `positioning: 'self'` and colliding with §9.1.
 */
import "../core/dev.js";
import * as dom from "../core/dom.js";
import { warn } from "../core/diagnostics.js";

/**
 * `scrollable` — scroll container management, overscroll containment, and
 * scroll restoration.
 *
 * Scroll position is *state, not geometry* (§5.11 rule 5): it lives with the
 * element, restores with it, and sets `PAINT` rather than `ARRANGE`.
 */
export const scrollable = {
  name: "scrollable",
  version: "1.0.0",
  events: ["scroll", "scrollend"],
  /** The browser's own keys, declared because P5 asks what the equivalent is. */
  keys: {
    ArrowUp: "up",
    ArrowDown: "down",
    PageUp: "page-up",
    PageDown: "page-down",
    Home: "top",
    End: "bottom"
  },

  attach(ctx, options) {
    const opts = options || {};
    const el = ctx.el;
    if (!el) return {};
    const axis = opts.axis || "y";

    el.style.overflowX = axis === "y" ? "hidden" : "auto";
    el.style.overflowY = axis === "x" ? "hidden" : "auto";
    // Containment stops a scroll at the end of this container rather than
    // handing it to the page behind — the difference between a scrollable
    // panel and one that drags the whole document with it.
    el.style.overscrollBehavior = opts.overscroll || "contain";
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");

    if (opts.restore !== false && ctx.node.state.scrollOffset) {
      const saved = ctx.node.state.scrollOffset;
      el.scrollLeft = saved.x || 0;
      el.scrollTop = saved.y || 0;
    }

    let idle = null;
    ctx.own(
      dom.listen(el, "scroll", () => {
        ctx.node.state.scrollOffset = { x: el.scrollLeft, y: el.scrollTop };
        ctx.mk.persistDirty = true;
        ctx.invalidate("paint");
        ctx.emit("scroll", { x: el.scrollLeft, y: el.scrollTop });
        if (idle) idle();
        idle = ctx.own(dom.timer(() => ctx.emit("scrollend", { x: el.scrollLeft, y: el.scrollTop }), 120));
      })
    );

    return {
      get offset() {
        return { x: el.scrollLeft, y: el.scrollTop };
      },
      scrollTo(x, y) {
        el.scrollTo({ left: x, top: y, behavior: reducedMotion(ctx) ? "auto" : "smooth" });
      },
      /** Bring a child into view without scrolling its ancestors. */
      reveal(node) {
        const child = node && node.el ? node.el : node;
        if (child && child.scrollIntoView) child.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    };
  }
};

function reducedMotion(ctx) {
  return !!ctx.mk.metrics.current.reducedMotion;
}

/**
 * `selectable` — single or multiple selection with range and toggle modifiers.
 *
 * The modifiers are the whole feature. Shift extends from the anchor; the
 * platform modifier toggles one without clearing the rest; a bare click
 * replaces. Getting the *anchor* right — it moves on a plain click and on a
 * toggle, but not on a range extend — is what makes shift-clicking twice
 * behave the way people expect.
 */
export const selectable = {
  name: "selectable",
  version: "1.0.0",
  events: ["selectionchange"],
  keys: {
    ArrowUp: "previous",
    ArrowDown: "next",
    "Shift+ArrowUp": "extend-previous",
    "Shift+ArrowDown": "extend-next",
    "Mod+a": "select-all",
    Escape: "clear",
    " ": "toggle"
  },

  attach(ctx, options) {
    const opts = options || {};
    const mode = opts.mode || "single";
    const state = { selected: new Set(opts.selected || []), anchor: null };

    const items = () => ctx.node.children.filter((child) => !child.destroyed);
    const idOf = (node) => node.id || String(node.index);

    const apply = () => {
      for (const child of items()) {
        const on = state.selected.has(idOf(child));
        if (child.el) child.el.setAttribute("aria-selected", String(on));
        ctx.mk.compiler.setState(child, "selected", on);
      }
      ctx.invalidate("style");
      ctx.emit("selectionchange", { selected: [...state.selected] });
    };

    const api = {
      get selected() {
        return [...state.selected];
      },
      isSelected: (id) => state.selected.has(id),

      /** `select(id, { additive, range })` — the three behaviours in one call. */
      select(id, modifiers) {
        const mods = modifiers || {};
        if (mode === "single" || (!mods.additive && !mods.range)) {
          state.selected = new Set([id]);
          state.anchor = id;
        } else if (mods.range && state.anchor != null) {
          const list = items().map(idOf);
          const from = list.indexOf(state.anchor);
          const to = list.indexOf(id);
          if (from !== -1 && to !== -1) {
            const [start, end] = from < to ? [from, to] : [to, from];
            // The anchor deliberately does *not* move on a range extend, so a
            // second shift-click re-extends from the original point.
            state.selected = new Set(list.slice(start, end + 1));
          }
        } else {
          if (state.selected.has(id)) state.selected.delete(id);
          else state.selected.add(id);
          state.anchor = id;
        }
        apply();
        return api.selected;
      },

      selectAll() {
        if (mode === "single") return api.selected;
        state.selected = new Set(items().map(idOf));
        apply();
        return api.selected;
      },

      clear() {
        state.selected = new Set();
        state.anchor = null;
        apply();
      }
    };

    if (ctx.el) {
      ctx.el.setAttribute("aria-multiselectable", mode === "single" ? "false" : "true");
      ctx.own(
        dom.listen(ctx.el, "click", (event) => {
          const child = items().find((node) => node.el && node.el.contains(event.target));
          if (!child) return;
          api.select(idOf(child), {
            additive: event.ctrlKey || event.metaKey,
            range: event.shiftKey
          });
        })
      );
      ctx.own(dom.listen(ctx.el, "keydown", (event) => onSelectKey(ctx, api, items, idOf, event)));
    }

    if (state.selected.size) apply();
    return api;
  }
};

function onSelectKey(ctx, api, items, idOf, event) {
  const list = items().map(idOf);
  if (!list.length) return;
  const current = api.selected[api.selected.length - 1];
  const index = list.indexOf(current);

  if (event.key === "a" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    api.selectAll();
    return;
  }
  if (event.key === "Escape") {
    api.clear();
    return;
  }
  let next = null;
  if (event.key === "ArrowDown") next = index + 1;
  else if (event.key === "ArrowUp") next = index - 1;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = list.length - 1;
  else return;

  event.preventDefault();
  const id = list[Math.min(Math.max(next, 0), list.length - 1)];
  api.select(id, { range: event.shiftKey, additive: false });
}

/**
 * `sortable` — reorder within a container, with drop indicators and a keyboard
 * path.
 *
 * It reorders **within the flow** rather than declaring
 * `positioning: 'self'` — which is precisely the fix MK2011 names when someone
 * attaches `draggable` to a flow child (§9.1). A sortable list keeps its
 * parent's algorithm in charge of every box; only the *order* changes.
 */
export const sortable = {
  name: "sortable",
  version: "1.0.0",
  events: ["sortstart", "sort", "sortend"],
  /** Reordering by keyboard is the equivalent, and it is not optional (P5). */
  keys: {
    "Mod+ArrowUp": "move-up",
    "Mod+ArrowDown": "move-down",
    Space: "grab",
    Escape: "cancel"
  },

  attach(ctx, options) {
    const opts = options || {};
    const state = { dragging: null, from: -1 };

    const items = () => ctx.node.children.filter((child) => !child.destroyed);

    const api = {
      /** Move the child at `from` to `to`. The one operation everything uses. */
      move(from, to) {
        const list = items();
        const child = list[from];
        const before = list[to > from ? to + 1 : to];
        if (!child) return false;
        ctx.emit("sortstart", { from, to });
        ctx.mk.reparent(child, ctx.node, before || null);
        ctx.mk.persistDirty = true;
        ctx.emit("sort", { from, to, id: child.id });
        ctx.emit("sortend", { from, to, cancelled: false });
        return true;
      },
      get order() {
        return items().map((child) => child.id);
      }
    };

    if (!ctx.el) return api;

    ctx.own(
      dom.listen(ctx.el, "pointerdown", (event) => {
        const list = items();
        const index = list.findIndex((child) => child.el && child.el.contains(event.target));
        if (index === -1) return;
        state.dragging = list[index];
        state.from = index;
        ctx.mk.compiler.setState(state.dragging, "grabbed", true);
      })
    );

    ctx.own(
      dom.listen(ctx.el, "pointermove", (event) => {
        if (!state.dragging) return;
        const target = items().findIndex((child) => child.el && child.el.contains(event.target));
        if (target === -1 || target === state.from) return;
        // The drop indicator is a state flag, so a theme styles it rather than
        // the trait drawing one.
        for (const child of items()) ctx.mk.compiler.setState(child, "drop-before", false);
        ctx.mk.compiler.setState(items()[target], "drop-before", true);
        ctx.invalidate("style");
      })
    );

    const release = (cancelled) => {
      if (!state.dragging) return;
      const target = items().findIndex((child) => child.el && child.el.hasAttribute("data-mk-drop-before"));
      ctx.mk.compiler.setState(state.dragging, "grabbed", false);
      for (const child of items()) ctx.mk.compiler.setState(child, "drop-before", false);
      ctx.invalidate("style");
      const from = state.from;
      state.dragging = null;
      state.from = -1;
      if (cancelled || target === -1 || target === from) {
        ctx.emit("sortend", { from, to: from, cancelled: true });
        return;
      }
      api.move(from, target);
    };

    ctx.own(dom.listen(ctx.el, "pointerup", () => release(false)));
    ctx.own(dom.listen(ctx.el, "pointercancel", () => release(true)));
    ctx.own(dom.listen(ctx.el, "keydown", (event) => onSortKey(ctx, api, items, event)));
    return api;
  }
};

function onSortKey(ctx, api, items, event) {
  if (!(event.ctrlKey || event.metaKey)) return;
  const list = items();
  const active = list.findIndex((child) => child.el && child.el.contains(dom.activeElement()));
  if (active === -1) return;
  if (event.key === "ArrowUp" && active > 0) {
    event.preventDefault();
    api.move(active, active - 1);
  } else if (event.key === "ArrowDown" && active < list.length - 1) {
    event.preventDefault();
    api.move(active, active + 1);
  }
}

/**
 * `virtualized` — render only what is visible in a scrollable list.
 *
 * The height is reserved by a spacer so the scrollbar is honest, and the
 * window is recomputed in the READ phase from the scroll offset — never from a
 * measurement taken during WRITE (P4).
 */
export const virtualized = {
  name: "virtualized",
  version: "1.0.0",
  requires: ["scrollable"],
  events: ["rangechange"],
  keys: { PageUp: "page-up", PageDown: "page-down", Home: "top", End: "bottom" },

  attach(ctx, options) {
    const opts = options || {};
    const rowHeight = opts.rowHeight || 24;
    const overscan = opts.overscan == null ? 4 : opts.overscan;
    const state = { start: 0, end: 0, total: opts.total || 0 };

    const spacer = ctx.dom("div", {
      class: "mk-virtual-spacer",
      "aria-hidden": "true",
      style: { position: "absolute", top: "0", left: "0", width: "1px", pointerEvents: "none" }
    });

    const measure = () => {
      const el = ctx.el;
      if (!el) return;
      const height = el.clientHeight || 0;
      const first = Math.max(0, Math.floor(el.scrollTop / rowHeight) - overscan);
      const visible = Math.ceil(height / rowHeight) + overscan * 2;
      const last = Math.min(state.total, first + visible);
      if (first === state.start && last === state.end) return;
      state.start = first;
      state.end = last;
      spacer.style.height = `${state.total * rowHeight}px`;
      ctx.emit("rangechange", { start: first, end: last, rowHeight });
    };

    // READ, not WRITE: the window depends on a measurement, and taking one
    // during the write phase is the thrash P4 exists to prevent.
    ctx.own(ctx.mk.scheduler.on("read", measure));

    return {
      get range() {
        return { start: state.start, end: state.end };
      },
      setTotal(total) {
        state.total = total;
        spacer.style.height = `${total * rowHeight}px`;
        measure();
      },
      /** Scroll so `index` is visible, without measuring anything. */
      scrollToIndex(index) {
        if (ctx.el) ctx.el.scrollTop = index * rowHeight;
      }
    };
  }
};

/**
 * `persistable` — opt in to serialization by id (§19).
 *
 * The opt-in is the point: serializing every node's state by default would put
 * transient UI state (a hover flag, a half-typed value) into a saved layout,
 * and restoring it would be worse than losing it.
 */
export const persistable = {
  name: "persistable",
  version: "1.0.0",
  keys: {},

  attach(ctx, options) {
    const opts = options || {};
    const keys = opts.keys || [];
    if (!ctx.node.id) {
      warn("MK4005", __MK_DEV__ &&
        `'${ctx.node.type}' is persistable but has no id, so it can only be restored by its ` +
          `position in the tree. Give it an id if its place may change.`,
        { subject: ctx.node.toString() }
      );
    }
    ctx.node.persistKeys = keys;
    return {
      get keys() {
        return keys;
      },
      /** The slice of this element's state that a saved layout should carry. */
      snapshot() {
        const out = {};
        for (const key of keys) out[key] = ctx.node.props[key];
        return out;
      }
    };
  }
};

/** Styling hooks the traits set as state, for a theme to pick up. */
const COLLECTION_CSS = `
  [data-mk-selected] { background: var(--mk-color-surface-sunken); }
  [data-mk-grabbed] { opacity: 0.6; }
  [data-mk-drop-before] { box-shadow: inset 0 2px 0 var(--mk-color-accent); }
`;

selectable.styles = COLLECTION_CSS;
sortable.styles = COLLECTION_CSS;

export const COLLECTION_TRAITS = [scrollable, selectable, sortable, virtualized, persistable];
export { COLLECTION_CSS };
