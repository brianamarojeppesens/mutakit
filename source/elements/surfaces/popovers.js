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

  motion: { enter: "fade", exit: "fade", reduced: "none" },

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
        shift: ctx.props.shift
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
    contextMode: { type: "boolean", default: false }
  },

  events: ["select", "open", "close"],
  a11y: { role: "menu", props: { "aria-orientation": "vertical" } },

  commands: {
    /** Invoke the item at `index`, as a click or Enter would. */
    select(ctx, index) {
      const item = ctx.props.items[index];
      if (!item || item.disabled || item.separator) return;
      ctx.emit("select", { item, index });
      if (!item.items) {
        const trait = ctx.trait("dismissible");
        if (trait) trait.dismiss("select");
      }
    }
  },

  create(ctx, inherited) {
    const el = inherited;
    ctx.state.active = -1;
    ctx.state.buttons = [];

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
        text: item.label
      }, el);
      if (item.shortcut) {
        button.appendChild(dom.el("kbd", { class: "mk-menu__shortcut", text: item.shortcut }));
      }
      ctx.state.buttons.push(button);
      ctx.own(dom.listen(button, "click", () => ctx.node.definition.commands.select(ctx, index)));
      ctx.own(dom.listen(button, "pointerenter", () => focusItem(ctx, index)));
    });

    ctx.own(dom.listen(el, "keydown", (event) => onMenuKey(ctx, event)));
    return el;
  },

  mount(ctx) {
    if (ctx.state.buttons.length) focusItem(ctx, 0);
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

function onMenuKey(ctx, event) {
  const count = ctx.state.buttons.length;
  if (!count) return;
  const key = event.key;
  if (key === "ArrowDown") focusItem(ctx, ctx.state.active + 1);
  else if (key === "ArrowUp") focusItem(ctx, ctx.state.active - 1);
  else if (key === "Home") focusItem(ctx, 0);
  else if (key === "End") focusItem(ctx, count - 1);
  else if (key === "Enter" || key === " ") ctx.node.definition.commands.select(ctx, ctx.state.active);
  else return;
  event.preventDefault();
}

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
