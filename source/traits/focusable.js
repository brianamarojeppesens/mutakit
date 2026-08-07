/**
 * The `focusable` trait (§9) — core.
 *
 * Tabindex management, a focus ring, and `focus`/`blur` events on the node
 * tree. It is core because the focus manager and every interactive element
 * depend on one consistent answer to "is this thing focusable", and because
 * roving tabindex for composites (§13.4) needs a single place to change it.
 */
import { listen } from "../core/dom.js";

export const focusable = {
  name: "focusable",
  version: "1.0.0",
  events: ["focus", "blur"],
  keys: {
    // Focus movement itself is the browser's; what the trait declares is that
    // there is nothing pointer-only about becoming focused (P5).
    Tab: "next",
    "Shift+Tab": "previous"
  },

  attach(ctx, options) {
    const el = ctx.el;
    if (!el) return {};
    const opts = options || {};
    let tabIndex = opts.tabIndex != null ? opts.tabIndex : 0;

    if (!el.hasAttribute("tabindex") && !isNativelyFocusable(el)) {
      el.setAttribute("tabindex", String(tabIndex));
    }

    ctx.own(
      listen(el, "focus", (event) => {
        ctx.setState("focused", true);
        ctx.emit("focus", { native: event });
      })
    );
    ctx.own(
      listen(el, "blur", (event) => {
        ctx.setState("focused", false);
        ctx.emit("blur", { native: event });
      })
    );

    return {
      /** Move this element in or out of the tab order (roving tabindex). */
      setTabIndex(value) {
        tabIndex = value;
        el.setAttribute("tabindex", String(value));
      },
      get tabIndex() {
        return tabIndex;
      },
      focus(focusOptions) {
        el.focus(focusOptions);
      },
      blur() {
        el.blur();
      },
      get focused() {
        return el.ownerDocument.activeElement === el;
      }
    };
  },

  detach(ctx) {
    if (ctx.el) ctx.el.removeAttribute("tabindex");
  }
};

const NATIVE = new Set(["a", "button", "input", "select", "textarea", "summary", "details"]);

function isNativelyFocusable(el) {
  return NATIVE.has(el.tagName.toLowerCase());
}
