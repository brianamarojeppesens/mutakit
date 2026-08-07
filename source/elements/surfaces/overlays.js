/**
 * The surface family (§11.2) — the overlay half of S2.
 *
 * Every one of these `extends: 'surface'`, which is exactly why `surface` is
 * core (§4.2): a base type plugins inherit from must always be present. The
 * catalog stays two levels deep at most — `alert extends dialog extends
 * surface` is the deepest chain in the library, and `dialog` is the only place
 * inheritance earns its keep over composition (§8.3).
 */
import "../../core/dev.js";
import * as dom from "../../core/dom.js";
import { css } from "../../styles/index.js";

/**
 * `modal` — a centred, focus-trapped surface with a backdrop.
 *
 * Where the platform offers it, the top layer via `<dialog>` gives correct
 * stacking above everything — including other libraries' overlays — for free
 * (§16.2). The fallback is a portal into the instance's layer root, behind the
 * same API, so an author never sees the difference.
 */
export const modal = {
  type: "modal",
  version: "1.0.0",
  extends: "surface",
  layer: "modal",
  traits: ["focus-trap", "dismissible"],

  /*
   * Flow, not the `anchor` inherited from `pane`.
   *
   * `create` builds a header, a body and a footer, and publishes the body as
   * `contentEl` — the slots exist precisely so that filling `body` puts content
   * between the other two. Under `anchor` a slot fill was positioned against
   * the whole dialog frame instead, so a form in the body was drawn on top of
   * the header and through the footer, at its intrinsic width. The slots
   * promised a place to put things and the layout ignored it.
   */
  algorithm: "stack",

  props: {
    open: { type: "boolean", default: true, persist: true },
    title: { type: "string", default: "" },
    dismiss: { type: "enum", values: ["light", "modal", "none"], default: "modal" },
    backdrop: { type: "boolean", default: true },
    lockScroll: { type: "boolean", default: true },
    initialFocus: { type: "selector" }
  },

  geometry: { defaults: { size: { w: "80%", h: "85%" }, at: "center", of: "viewport" } },
  slots: { header: { max: 1 }, body: { max: 1 }, footer: { max: 1 }, default: {} },
  events: ["open", "close", "beforeclose"],

  a11y: {
    role: "dialog",
    props: {
      "aria-modal": (ctx) => (ctx.props.dismiss === "modal" ? "true" : "false"),
      "aria-label": (ctx) => (ctx.props.title && !ctx.node.state.titleId ? ctx.props.title : null),
      "aria-labelledby": (ctx) => ctx.node.state.titleId || null
    }
  },

  commands: {
    close(ctx) {
      const dismissible = ctx.trait("dismissible");
      if (dismissible) dismissible.dismiss("command");
      else ctx.mk.destroy(ctx.node);
    },
    open(ctx) {
      ctx.handle.set({ open: true });
    }
  },

  motion: { enter: "scale", exit: "scale", reduced: "fade" },

  create(ctx, inherited) {
    const el = inherited || ctx.dom("div", null, null);
    // Where the platform offers it, the browser's own top layer gives correct
    // stacking above *everything* — including other libraries' overlays and
    // anything with a `z-index` of nine million — for free (§16.2). The
    // fallback is a portal into the instance's layer root, behind the same
    // API, so an author never sees which one they got.
    ctx.state.topLayer = ctx.mk.metrics.current.features.dialog && ctx.props.dismiss === "modal";
    if (ctx.props.title) {
      const id = `${ctx.node.id || ctx.node.type}-title`;
      const header = dom.el("h2", { class: "mk-modal__header", id, text: ctx.props.title });
      el.appendChild(header);
      ctx.node.state.titleId = id;
      ctx.own(() => dom.remove(header));
    }
    const body = dom.el("div", { class: "mk-modal__body" }, el);
    ctx.node.contentEl = body;
    ctx.own(() => dom.remove(body));

    // Hand `initialFocus` to the trait that can act on it.
    //
    // The prop has been declared since this type was written and nothing ever
    // read it — the focus service has supported `{ initial }` the whole time,
    // but `focus-trap` was attached as a bare string, so it received no options
    // and the prop was inert. An author asking for a specific control to take
    // focus got the first tabbable one instead, silently. This is the staging
    // channel `_attachTraits` reads for exactly this purpose.
    if (ctx.props.initialFocus) {
      const staged = ctx.node.state.traitOptions || (ctx.node.state.traitOptions = {});
      staged["focus-trap"] = { ...staged["focus-trap"], initial: ctx.props.initialFocus };
    }
    return el;
  },

  mount(ctx) {
    const layers = ctx.service("layers");
    if (ctx.state.topLayer) promoteToTopLayer(ctx);
    if (layers) {
      layers.add(ctx.node, ctx.node.layer);
      // The top layer is used for *stacking*, not for its scrim. Each host
      // dialog paints its own `::backdrop`, so three stacked modals would paint
      // three — while §16.2 requires one shared, reference-counted backdrop
      // beneath the topmost. `::backdrop` is therefore transparent and the
      // layer service keeps supplying the single scrim, which satisfies both
      // halves of that section rather than trading one for the other.
      if (ctx.props.backdrop) {
        layers.requestBackdrop(ctx.node, {
          onDismiss:
            ctx.props.dismiss === "light"
              ? () => {
                  const trait = ctx.trait("dismissible");
                  if (trait) trait.dismiss("backdrop");
                }
              : null
        });
      }
      if (ctx.props.lockScroll) {
        layers.lockScroll();
        ctx.own(() => layers.unlockScroll());
      }
      ctx.own(() => layers.remove(ctx.node));
    }
    ctx.on("close", () => ctx.mk.destroy(ctx.node));
    ctx.emit("open", {});
  },

  update(ctx, changed) {
    if (changed.has("open") && !ctx.props.open) {
      const trait = ctx.trait("dismissible");
      if (trait) trait.dismiss("prop");
    }
  },

  styles: css`
    /*
     * The host is a positioning context only: no background, no padding, no
     * size of its own. Everything visible is still the element's, so the two
     * paths look identical.
     */
    .mk-top-layer {
      border: 0;
      padding: 0;
      margin: 0;
      max-width: none;
      max-height: none;
      width: 100%;
      height: 100%;
      background: none;
      overflow: visible;
    }
    .mk-top-layer::backdrop {
      background: transparent;
    }
    .mk-modal {
      display: flex;
      flex-direction: column;
      background: var(--mk-modal-bg, var(--mk-color-surface-raised));
      box-shadow: var(--mk-elevation-3);
      border-radius: var(--mk-radius-lg);
      overflow: hidden;
    }
    .mk-modal__header {
      margin: 0;
      padding: var(--mk-space-4);
      font-size: var(--mk-text-lg);
      font-weight: 600;
      border-bottom: 1px solid var(--mk-border-subtle);
    }
    .mk-modal__body {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: var(--mk-space-4);
    }
    .mk-modal__footer {
      display: flex;
      gap: var(--mk-space-2);
      justify-content: flex-end;
      padding: var(--mk-space-3) var(--mk-space-4);
      border-top: 1px solid var(--mk-border-subtle);
    }
  `
};

/**
 * Move the element into the browser's top layer.
 *
 * A `<dialog>` cannot simply *be* the element — the type may be extended, and
 * `showModal()` has opinions about sizing and centring that fight §5's
 * geometry. So a host dialog is opened and the element is adopted into it: the
 * platform supplies stacking, `::backdrop`, and its own Escape; Mutakit keeps
 * the box.
 */
function promoteToTopLayer(ctx) {
  const host = dom.el("dialog", { class: "mk-top-layer" });
  dom.body().appendChild(host);
  host.appendChild(ctx.el);
  try {
    host.showModal();
  } catch (error) {
    // Already open, detached, or a platform that changed its mind. The portal
    // fallback is correct in every one of those cases and nothing else needs
    // to know which path it got.
    ctx.state.topLayer = false;
    dom.remove(host);
    return;
  }
  // The platform's own Escape would close the host directly, skipping the
  // dismissal policy, the `beforeclose` veto, and focus restoration (§9).
  ctx.own(dom.listen(host, "cancel", (event) => event.preventDefault()));
  ctx.own(() => {
    if (host.open) host.close();
    dom.remove(host);
  });
  ctx.setState("top-layer", true);
}

/** `dialog` — `modal` plus header/body/footer slots and a standard button row. */
export const dialog = {
  type: "dialog",
  version: "1.0.0",
  extends: "modal",

  props: {
    /** `[{ label, command, variant }]` — declarative, so a dialog serializes. */
    actions: { type: "array", default: () => [] },
    description: { type: "string", default: "" }
  },

  geometry: { defaults: { size: { w: 480, h: "auto" }, at: "center", of: "viewport" } },
  events: ["action"],

  a11y: {
    role: "dialog",
    props: {
      "aria-modal": "true",
      "aria-labelledby": (ctx) => ctx.node.state.titleId || null,
      "aria-describedby": (ctx) => ctx.node.state.descriptionId || null
    }
  },

  commands: {
    /** Resolve the dialog with a named result — what a button's command hits. */
    submit(ctx, result) {
      ctx.emit("action", { action: "submit", result });
      const trait = ctx.trait("dismissible");
      if (trait) trait.dismiss("submit");
    },
    cancel(ctx) {
      ctx.emit("action", { action: "cancel" });
      const trait = ctx.trait("dismissible");
      if (trait) trait.dismiss("cancel");
    }
  },

  create(ctx, inherited) {
    const el = inherited;
    if (ctx.props.description) {
      const id = `${ctx.node.id || ctx.node.type}-desc`;
      const p = dom.el("p", { class: "mk-dialog__description", id, text: ctx.props.description });
      ctx.node.contentEl.appendChild(p);
      ctx.node.state.descriptionId = id;
      ctx.own(() => dom.remove(p));
    }
    if (ctx.props.actions && ctx.props.actions.length) {
      const footer = dom.el("div", { class: "mk-modal__footer" }, el);
      for (const action of ctx.props.actions) {
        const button = dom.el("button", {
          type: "button",
          class: `mk-button mk-button--${action.variant || "default"}`,
          text: action.label
        }, footer);
        ctx.own(
          dom.listen(button, "click", () => {
            // A declarative action resolves like a declarative command (§18.2):
            // by name, against this element, so the tree stays serializable.
            const command = ctx.node.definition.commands[action.command];
            if (command) command(ctx, action.result);
            else ctx.emit("action", { action: action.command, result: action.result });
          })
        );
      }
      ctx.own(() => dom.remove(footer));
    }
    return el;
  },

  styles: css`
    .mk-dialog__description {
      margin: 0 0 var(--mk-space-3);
      color: var(--mk-text-secondary);
    }
    .mk-button {
      padding: 6px 14px;
      min-height: var(--mk-target-min);
      border: 1px solid var(--mk-border-strong);
      border-radius: var(--mk-radius-sm);
      background: var(--mk-color-surface-raised);
      cursor: pointer;
    }
    .mk-button--primary {
      background: var(--mk-color-accent);
      border-color: var(--mk-color-accent);
      color: #fff;
    }
    .mk-button--danger {
      background: var(--mk-color-danger);
      border-color: var(--mk-color-danger);
      color: #fff;
    }
    .mk-button:focus-visible { outline: var(--mk-focus-ring); outline-offset: 2px; }
  `
};

/** `alert` — `dialog` with `alertdialog` semantics for destructive confirmation. */
export const alert = {
  type: "alert",
  version: "1.0.0",
  extends: "dialog",
  a11y: {
    role: "alertdialog",
    props: {
      "aria-modal": "true",
      "aria-labelledby": (ctx) => ctx.node.state.titleId || null,
      "aria-describedby": (ctx) => ctx.node.state.descriptionId || null
    }
  }
};

/**
 * `drawer` — a surface sliding from an edge, modal or not.
 *
 * Its geometry is edge constraints and nothing else (§5.6), which is why it
 * needs no code of its own beyond choosing which two of three to set.
 */
export const drawer = {
  type: "drawer",
  version: "1.0.0",
  extends: "modal",
  layer: "overlay",

  props: {
    edge: { type: "enum", values: ["start", "end", "top", "bottom"], default: "end" },
    size: { type: "len", default: 320 },
    dismiss: { type: "enum", values: ["light", "modal", "none"], default: "light" }
  },

  geometry: { defaults: {} },
  motion: { enter: "slide", exit: "slide", reduced: "fade" },

  create(ctx, inherited) {
    const edge = ctx.props.edge;
    const size = ctx.props.size;
    const geometry =
      edge === "top" || edge === "bottom"
        ? { left: 0, right: 0, height: size, [edge]: 0 }
        : { top: 0, bottom: 0, width: size, [edge === "start" ? "inlineStart" : "inlineEnd"]: 0 };
    Object.assign(ctx.node.geometry, geometry);
    return inherited;
  },

  styles: css`
    .mk-drawer { border-radius: 0; }
  `
};

export const OVERLAY_ELEMENTS = [modal, dialog, alert, drawer];
