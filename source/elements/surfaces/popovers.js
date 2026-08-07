/**
 * Anchored and transient surfaces (§11.2) — the rest of S2.
 *
 * `popover`, `tooltip`, `menu`, `toast`, and `banner`. Everything anchored
 * composes the `positioned` trait rather than reimplementing placement, and
 * everything transient routes its text through the announcer, because a
 * message a screen reader never hears is not a message.
 */
import "../../core/dev.js";
import * as dom from "../../core/dom.js";
import { css } from "../../styles/index.js";

/** `popover` — a surface anchored to a trigger, with flip/shift collision. */
export const popover = {
  type: "popover",
  version: "1.0.0",
  extends: "surface",
  layer: "popover",
  traits: ["positioned", "dismissible"],

  props: {
    reference: { type: "any" },
    placement: { type: "string", default: "bottom" },
    offset: { type: "number", default: 8 },
    arrow: { type: "boolean", default: false },
    flip: { type: "boolean", default: true },
    shift: { type: "boolean", default: true },
    dismiss: { type: "enum", values: ["light", "modal", "none"], default: "light" },
    trapFocus: { type: "boolean", default: false }
  },

  geometry: { defaults: { size: { w: "auto", h: "auto" } } },
  events: ["open", "close"],
  a11y: { role: "dialog", props: { "aria-label": (ctx) => ctx.props.label || null } },

  commands: {
    close(ctx) {
      const trait = ctx.trait("dismissible");
      if (trait) trait.dismiss("command");
      else ctx.mk.destroy(ctx.node);
    }
  },

  // Not `reduced: 'none'`. §17: an instantaneous appearance is more
  // disorienting than a short one, so the reduced path is the `fade` preset's
  // own reduced variant — 80ms of opacity — rather than nothing at all.
  motion: { enter: "fade", exit: "fade", reduced: "fade" },

  create(ctx, inherited) {
    const el = inherited || ctx.dom("div", null, null);
    // The trait reads its options from the element's props rather than from a
    // second configuration surface: one place to look, one place to document.
    ctx.node.state.traitOptions = {
      positioned: {
        reference: ctx.props.reference,
        placement: ctx.props.placement,
        offset: ctx.props.offset,
        arrow: ctx.props.arrow,
        flip: ctx.props.flip,
        shift: ctx.props.shift,
        corners: !!ctx.props.contextMode
      },
      dismissible: { policy: ctx.props.dismiss }
    };
    if (ctx.props.arrow) {
      const arrow = dom.el("span", { class: "mk-popover__arrow", "aria-hidden": "true" }, el);
      ctx.own(() => dom.remove(arrow));
    }
    return el;
  },

  mount(ctx) {
    const layers = ctx.service("layers");
    if (layers) {
      layers.add(ctx.node, ctx.node.layer);
      ctx.own(() => layers.remove(ctx.node));
    }
    if (ctx.props.trapFocus) ctx.mk.attachTrait(ctx.node, "focus-trap", {});
    ctx.on("close", () => ctx.mk.destroy(ctx.node));
    ctx.emit("open", {});
  },

  styles: css`
    .mk-popover {
      background: var(--mk-popover-bg, var(--mk-color-surface-raised));
      box-shadow: var(--mk-elevation-2);
      border: 1px solid var(--mk-border-subtle);
      border-radius: var(--mk-radius-md);
      padding: var(--mk-space-2);
      max-width: var(--mk-available-width, none);
    }
    .mk-popover__arrow {
      position: absolute;
      width: 8px;
      height: 8px;
      background: inherit;
      border: inherit;
      transform: rotate(45deg);
    }
    .mk-popover[data-mk-placement^="bottom"] .mk-popover__arrow {
      top: -5px;
      left: var(--mk-arrow-offset, 50%);
      border-right: 0;
      border-bottom: 0;
    }
    .mk-popover[data-mk-placement^="top"] .mk-popover__arrow {
      bottom: -5px;
      left: var(--mk-arrow-offset, 50%);
      border-left: 0;
      border-top: 0;
    }
    .mk-popover[data-mk-reference-hidden] { visibility: hidden; }
  `
};

/**
 * `tooltip` — a small, non-interactive popover with hover/focus intent timing.
 *
 * The timing *is* the feature. A tooltip that appears instantly is noise on the
 * way to somewhere else; one that never appears on focus is inaccessible.
 */
export const tooltip = {
  type: "tooltip",
  version: "1.0.0",
  extends: "popover",
  layer: "tooltip",
  traits: ["positioned"],

  props: {
    text: { type: "string", default: "" },
    delay: { type: "number", default: 500 },
    hideDelay: { type: "number", default: 100 },
    placement: { type: "string", default: "top" }
  },

  /** Never interactive, so it is described *by* its reference, not focused. */
  a11y: { role: "tooltip" },

  create(ctx, inherited) {
    const el = inherited;
    dom.setText(ctx.node.contentEl || el, ctx.props.text);
    el.style.pointerEvents = "none";
    return el;
  },

  update(ctx, changed) {
    if (changed.has("text")) dom.setText(ctx.node.contentEl || ctx.el, ctx.props.text);
  },

  styles: css`
    .mk-tooltip {
      padding: 4px 8px;
      font-size: var(--mk-text-sm);
      background: var(--mk-tooltip-bg, var(--mk-gray-900));
      color: var(--mk-gray-50);
      border: 0;
      border-radius: var(--mk-radius-sm);
      box-shadow: var(--mk-elevation-1);
    }
  `
};

/**
 * `tooltip-host` — the trait that owns the intent timing (§9).
 *
 * It lives with the tooltip rather than in `traits/` because the two are one
 * feature: the delegated host is what keeps a page with two hundred tooltips
 * to one tooltip element.
 */
export const tooltipHost = {
  name: "tooltip-host",
  version: "1.0.0",
  events: ["tooltipshow", "tooltiphide"],
  /** Focus is the keyboard equivalent of hover, and it is not optional (P5). */
  keys: { Escape: "hide" },

  attach(ctx, options) {
    const opts = options || {};
    const text = () => opts.text || ctx.props.tooltip || ctx.el.getAttribute("aria-label") || "";
    let showTimer = null;
    let hideTimer = null;
    let live = null;

    const show = () => {
      if (live || !text()) return;
      live = ctx.mk.create(
        "tooltip",
        { text: text(), reference: ctx.el, placement: opts.placement || "top" },
        ctx.node.parent || ctx.node
      );
      // Described by, not labelled by: the tooltip supplements the control's
      // own name rather than replacing it.
      if (live) ctx.el.setAttribute("aria-describedby", live.node.id || "");
      ctx.emit("tooltipshow", { text: text() });
    };

    const hide = () => {
      if (!live) return;
      ctx.mk.destroy(live.node);
      live = null;
      ctx.el.removeAttribute("aria-describedby");
      ctx.emit("tooltiphide", {});
    };

    const arm = () => {
      if (hideTimer) hideTimer();
      const delay = opts.delay == null ? 500 : opts.delay;
      showTimer = dom.timer(show, delay);
      ctx.own(showTimer);
    };
    const disarm = () => {
      if (showTimer) showTimer();
      hideTimer = dom.timer(hide, opts.hideDelay == null ? 100 : opts.hideDelay);
      ctx.own(hideTimer);
    };

    ctx.own(dom.listen(ctx.el, "pointerenter", arm));
    ctx.own(dom.listen(ctx.el, "pointerleave", disarm));
    ctx.own(dom.listen(ctx.el, "focus", show));
    ctx.own(dom.listen(ctx.el, "blur", hide));
    ctx.own(dom.listen(ctx.el, "keydown", (event) => event.key === "Escape" && hide()));
    ctx.own(hide);

    return { show, hide, get visible() { return !!live; } };
  }
};

/**
 * `menu` — a keyboard-navigable command list with submenus and a context mode.
 *
 * Roving tabindex rather than tabbable items: a menu is one tab stop, and
 * arrows move within it. That is the ARIA pattern, and it is also simply how
 * menus feel.
 */
export const menu = {
  type: "menu",
  version: "1.0.0",
  extends: "popover",
  layer: "popover",

  props: {
    items: { type: "array", default: () => [] },
    placement: { type: "string", default: "bottom-start" },
    /**
     * Context mode: anchored to a point rather than to a trigger.
     *
     * The difference that earns the prop is the collision response. A dropdown
     * that will not fit below its button *flips* to above it, because it must
     * stay attached to that button. A context menu has no button — it has a
     * corner at the cursor — so when it will not fit it should open from the
     * other corner instead, which is what every desktop does and what a flip
     * alone does not produce.
     */
    contextMode: { type: "boolean", default: false },
    autoFocus: { type: "boolean", default: true }
  },

  events: ["select", "open", "close"],
  a11y: { role: "menu", props: { "aria-orientation": "vertical" } },

  commands: {
    /** Invoke the item at `index`, as a click or Enter would. */
    select(ctx, index) {
      const item = ctx.props.items[index];
      if (!item || item.disabled || item.separator) return;
      // A parent item is not a command. Selecting it opens its submenu, which
      // is what both the pointer and `ArrowRight` mean by "activate" here.
      if (item.items) return openSubmenu(ctx, index, true);
      ctx.emit("select", { item, index });
      // The whole chain closes, not just the submenu the item lives in — a
      // context menu that leaves its parent standing after a choice is the
      // single most common way this goes wrong.
      dismissChain(ctx, "select");
    },
    /** Close this menu and every menu it opened. */
    closeChain(ctx) {
      dismissChain(ctx, "command");
    }
  },

  create(ctx, inherited) {
    const el = inherited;
    ctx.state.active = -1;
    ctx.state.buttons = [];
    ctx.state.submenu = null;

    ctx.props.items.forEach((item, index) => {
      if (item.separator) {
        el.appendChild(dom.el("div", { class: "mk-menu__separator", role: "separator" }));
        return;
      }
      const button = dom.el("div", {
        class: "mk-menu__item",
        role: item.checked === undefined ? "menuitem" : "menuitemcheckbox",
        tabindex: "-1",
        "aria-disabled": item.disabled ? "true" : null,
        "aria-checked": item.checked === undefined ? null : String(!!item.checked),
        "aria-haspopup": item.items ? "menu" : null,
        "aria-expanded": item.items ? "false" : null,
        text: item.label
      }, el);
      if (item.shortcut) {
        button.appendChild(dom.el("kbd", { class: "mk-menu__shortcut", text: item.shortcut }));
      }
      if (item.items) {
        button.appendChild(dom.el("span", { class: "mk-menu__caret", "aria-hidden": "true", text: "›" }));
      }
      ctx.state.buttons.push(button);
      ctx.own(dom.listen(button, "click", () => ctx.node.definition.commands.select(ctx, index)));
      ctx.own(
        dom.listen(button, "pointerenter", () => {
          focusItem(ctx, index);
          // Hovering a sibling closes whatever the last one opened; hovering a
          // parent opens its own. Focus stays here either way — moving it into
          // the submenu on hover fights the pointer.
          if (item.items) openSubmenu(ctx, index, false);
          else closeSubmenu(ctx);
        })
      );
    });

    ctx.own(dom.listen(el, "keydown", (event) => onMenuKey(ctx, event)));
    ctx.own(() => closeSubmenu(ctx));
    return el;
  },

  mount(ctx) {
    if (ctx.props.autoFocus && ctx.state.buttons.length) focusItem(ctx, 0);
  },

  styles: css`
    .mk-menu { padding: 4px; min-width: 180px; }
    .mk-menu__item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mk-space-4);
      padding: 6px 10px;
      min-height: var(--mk-target-min);
      border-radius: var(--mk-radius-sm);
      cursor: pointer;
      user-select: none;
    }
    .mk-menu__item[data-mk-active],
    .mk-menu__item:hover { background: var(--mk-color-surface-sunken); }
    .mk-menu__item[aria-disabled="true"] { opacity: 0.5; cursor: default; }
    .mk-menu__separator {
      height: 1px;
      margin: 4px 0;
      background: var(--mk-border-subtle);
    }
    .mk-menu__shortcut { color: var(--mk-text-secondary); font-size: var(--mk-text-sm); }
    .mk-menu__caret { color: var(--mk-text-secondary); margin-inline-start: auto; }
  `
};

function focusItem(ctx, index) {
  const buttons = ctx.state.buttons;
  if (!buttons.length) return;
  const next = (index + buttons.length) % buttons.length;
  buttons.forEach((button, i) => {
    button.setAttribute("tabindex", i === next ? "0" : "-1");
    button.toggleAttribute("data-mk-active", i === next);
  });
  ctx.state.active = next;
  buttons[next].focus();
}

/**
 * Open the submenu for `index`, as its own `menu` anchored to the parent item.
 *
 * A submenu is a menu, not a special case of one: it gets the same keyboard
 * model, the same dismissal, the same placement machinery. The only things it
 * inherits explicitly are the chain link back to its opener and the side it
 * opens on — `right-start`, which `flip` turns into `left-start` when the
 * screen runs out, exactly as it would for any other anchored surface.
 */
function openSubmenu(ctx, index, focus) {
  const item = ctx.props.items[index];
  const open = ctx.state.submenu;
  if (open && open.index === index) {
    if (focus) focusItem(ctx.mk.contextFor(open.handle.node), 0);
    return;
  }
  closeSubmenu(ctx);
  if (!item || !item.items || !item.items.length) return;

  const button = ctx.state.buttons[buttonIndex(ctx, index)];
  const handle = ctx.mk.create(
    "menu",
    {
      items: item.items,
      reference: button,
      placement: "right-start",
      offset: 0,
      contextMode: ctx.props.contextMode,
      // Opening on hover must not steal focus — the pointer is already the
      // thing pointing. Opening on ArrowRight must, because there is nothing
      // else for the keyboard to follow.
      autoFocus: focus,
      // Dismissal is the chain's, not the submenu's: an outside click closes
      // everything, and a click on the parent menu is not "outside" the
      // submenu even though it lands on a different element.
      dismiss: "none"
    },
    ctx.node.parent || ctx.node
  );
  if (!handle) return;

  handle.node.state.menuParent = ctx.node;
  ctx.state.submenu = { index, handle };
  if (button) button.setAttribute("aria-expanded", "true");
}

function closeSubmenu(ctx) {
  const open = ctx.state.submenu;
  if (!open) return;
  ctx.state.submenu = null;
  const button = ctx.state.buttons[buttonIndex(ctx, open.index)];
  if (button) button.setAttribute("aria-expanded", "false");
  if (!open.handle.node.destroyed) ctx.mk.destroy(open.handle.node);
}

/** Separators take a slot in `items` but not in `buttons`. */
function buttonIndex(ctx, index) {
  let count = 0;
  for (let i = 0; i < index; i++) if (!ctx.props.items[i].separator) count++;
  return count;
}

/**
 * Dismiss the whole chain from the root down.
 *
 * Only the root carries a `dismissible` trait worth invoking — the submenus
 * were created with `dismiss: 'none'` precisely so that closing one of them
 * cannot leave the rest orphaned.
 */
function dismissChain(ctx, reason) {
  let node = ctx.node;
  while (node.state.menuParent && !node.state.menuParent.destroyed) node = node.state.menuParent;
  const root = node === ctx.node ? ctx : ctx.mk.contextFor(node);
  const trait = root.trait("dismissible");
  if (trait) trait.dismiss(reason);
  else ctx.mk.destroy(node);
}

function onMenuKey(ctx, event) {
  const count = ctx.state.buttons.length;
  if (!count) return;
  const key = event.key;
  if (key === "ArrowDown") focusItem(ctx, ctx.state.active + 1);
  else if (key === "ArrowUp") focusItem(ctx, ctx.state.active - 1);
  else if (key === "Home") focusItem(ctx, 0);
  else if (key === "End") focusItem(ctx, count - 1);
  else if (key === "ArrowRight") openSubmenu(ctx, itemIndex(ctx, ctx.state.active), true);
  else if (key === "ArrowLeft") closeToParent(ctx);
  else if (key === "Escape" && ctx.node.state.menuParent) closeToParent(ctx);
  else if (key === "Enter" || key === " ") {
    ctx.node.definition.commands.select(ctx, itemIndex(ctx, ctx.state.active));
  } else return;
  event.preventDefault();
  // A submenu's keys are its own. Without this the parent menu sees the same
  // ArrowDown and both menus move their selection on one press.
  event.stopPropagation();
}

/** The inverse of `buttonIndex` — which item a focused button belongs to. */
function itemIndex(ctx, button) {
  let count = -1;
  for (let i = 0; i < ctx.props.items.length; i++) {
    if (ctx.props.items[i].separator) continue;
    if (++count === button) return i;
  }
  return -1;
}

/** `ArrowLeft` in a submenu returns to the item that opened it. */
function closeToParent(ctx) {
  const parent = ctx.node.state.menuParent;
  if (!parent || parent.destroyed) return;
  const parentCtx = ctx.mk.contextFor(parent);
  const open = parentCtx.state.submenu;
  const index = open ? open.index : -1;
  closeSubmenu(parentCtx);
  // Focus has to land back on the item that opened it, not merely somewhere in
  // the parent: returning to the top of the list loses the user's place.
  if (index !== -1) focusItem(parentCtx, buttonIndex(parentCtx, index));
}

/**
 * `context-menu` — the trait that puts §11.2's context mode behind a prop.
 *
 * Without it a context menu costs an author a raw `contextmenu` listener, a
 * `preventDefault`, a hand-built point rect, and — if they remember — a
 * `Shift+F10` handler. §1.3 accepts no design that makes S2 awkward and §1.5.5
 * requires a documented keyboard equivalent for every pointer interaction, so
 * both belong here rather than in every application that wants a right-click.
 *
 * It lives beside `menu` rather than in `traits/` for the same reason
 * `tooltip-host` does: the two are one feature, and a trait that can only ever
 * open a `menu` has no business shipping in a bundle that has none.
 */
export const contextMenu = {
  name: "context-menu",
  version: "1.0.0",
  events: ["contextopen", "select"],
  /** The keyboard equivalents, declared so §14.4's audit can find them. */
  keys: { "Shift+F10": "open", ContextMenu: "open" },

  attach(ctx, options) {
    const opts = options || {};
    let live = null;

    const items = () => (typeof opts.items === "function" ? opts.items() : opts.items || []);

    const close = () => {
      if (live && !live.node.destroyed) ctx.mk.destroy(live.node);
      live = null;
    };

    /**
     * `at` is a viewport point for the pointer path and `null` for the keyboard
     * path, where the right anchor is the element itself — a menu that opens at
     * the last mouse position is disorienting to someone who never used one.
     */
    const open = (at) => {
      const list = items();
      if (!list.length) return null;
      close();
      live = ctx.mk.create(
        "menu",
        {
          items: list,
          contextMode: true,
          placement: "bottom-start",
          offset: at ? 0 : 4,
          reference: at || ctx.el,
          dismiss: "light"
        },
        ctx.node.parent || ctx.node
      );
      if (!live) return null;
      // Re-emitted on the *host*, so an author listens on the element they put
      // the trait on rather than on a menu they never created.
      live.on("select", (event) => ctx.emit("select", event.detail));
      ctx.own(close);
      ctx.emit("contextopen", { items: list, at: at || null });
      return live;
    };

    ctx.own(
      dom.listen(ctx.el, "contextmenu", (event) => {
        if (!items().length) return;
        event.preventDefault();
        open({ x: event.clientX, y: event.clientY, space: "viewport" });
      })
    );
    ctx.own(
      dom.listen(ctx.el, "keydown", (event) => {
        if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
        event.preventDefault();
        open(null);
      })
    );

    return { open, close, get visible() { return !!live; } };
  }
};

/**
 * `toast` — a transient message in a managed stack, with a live region.
 *
 * The stack is the service's, not the element's: toasts arrive from anywhere
 * and must queue, which no individual toast can arrange.
 */
export const toast = {
  type: "toast",
  version: "1.0.0",
  extends: "surface",
  layer: "toast",

  props: {
    text: { type: "string", default: "" },
    variant: { type: "enum", values: ["info", "success", "warning", "danger"], default: "info" },
    ttl: { type: "number", default: 6000 },
    urgency: { type: "enum", values: ["polite", "assertive"], default: "polite" },
    action: { type: "any" }
  },

  geometry: { defaults: { at: "bottom-right", inset: 16, size: { w: 320, h: "auto" } } },
  events: ["dismiss", "action"],
  a11y: { role: "status" },
  motion: { enter: "slide", exit: "fade", reduced: "fade" },

  commands: {
    dismiss(ctx) {
      ctx.emit("dismiss", {});
      ctx.mk.destroy(ctx.node);
    }
  },

  create(ctx, inherited) {
    const el = inherited;
    el.appendChild(dom.el("span", { class: "mk-toast__text", text: ctx.props.text }));
    if (ctx.props.action) {
      const button = dom.el("button", {
        type: "button",
        class: "mk-toast__action",
        text: ctx.props.action.label
      }, el);
      ctx.own(dom.listen(button, "click", () => ctx.emit("action", { action: ctx.props.action })));
    }
    return el;
  },

  mount(ctx) {
    const layers = ctx.service("layers");
    if (layers) {
      layers.add(ctx.node, ctx.node.layer);
      ctx.own(() => layers.remove(ctx.node));
    }
    // Announced through the shared live region rather than by being one:
    // de-duplication and rate limiting belong to the announcer (§14).
    ctx.announce(ctx.props.text, ctx.props.urgency);
    if (ctx.props.ttl > 0) {
      ctx.own(dom.timer(() => ctx.mk.destroy(ctx.node), ctx.props.ttl));
    }
  },

  styles: css`
    .mk-toast {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mk-space-3);
      padding: var(--mk-space-3);
      box-shadow: var(--mk-elevation-2);
      border-left: 3px solid var(--mk-toast-accent, var(--mk-color-accent));
    }
    .mk-toast[data-mk-variant="success"] { --mk-toast-accent: var(--mk-color-success); }
    .mk-toast[data-mk-variant="warning"] { --mk-toast-accent: var(--mk-color-warning); }
    .mk-toast[data-mk-variant="danger"] { --mk-toast-accent: var(--mk-color-danger); }
    .mk-toast__action {
      background: none;
      border: 0;
      color: var(--mk-color-accent);
      cursor: pointer;
      font-weight: 600;
    }
  `
};

/** `banner` — a persistent inline message. Not an overlay; it takes space. */
export const banner = {
  type: "banner",
  version: "1.0.0",
  extends: "surface",
  props: {
    text: { type: "string", default: "" },
    variant: { type: "enum", values: ["info", "success", "warning", "danger"], default: "info" },
    dismissible: { type: "boolean", default: false }
  },
  events: ["dismiss"],
  a11y: { role: "region", props: { "aria-label": (ctx) => ctx.props.label || "Notice" } },

  create(ctx, inherited) {
    const el = inherited;
    el.appendChild(dom.el("span", { text: ctx.props.text }));
    if (ctx.props.dismissible) {
      const close = dom.el("button", {
        type: "button",
        class: "mk-banner__close",
        "aria-label": "Dismiss",
        text: "×"
      }, el);
      ctx.own(
        dom.listen(close, "click", () => {
          ctx.emit("dismiss", {});
          ctx.mk.destroy(ctx.node);
        })
      );
    }
    return el;
  },

  styles: css`
    .mk-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mk-space-3);
      padding: var(--mk-space-3);
      border-left: 3px solid var(--mk-banner-accent, var(--mk-color-accent));
    }
    .mk-banner[data-mk-variant="danger"] { --mk-banner-accent: var(--mk-color-danger); }
    .mk-banner__close {
      background: none;
      border: 0;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      min-width: var(--mk-target-min);
      min-height: var(--mk-target-min);
    }
  `
};

export const POPOVER_ELEMENTS = [popover, tooltip, menu, toast, banner];
