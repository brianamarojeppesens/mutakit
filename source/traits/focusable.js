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

    /**
     * The thing that actually takes focus, which is not always `ctx.el`.
     *
     * §11.3's controls wrap a native element, and `create` returns the
     * *wrapper* — so this trait was putting `tabindex="0"` on a plain `div`
     * sitting in front of the `input` it contains. Every field became two tab
     * stops, the first an unlabelled div announced as a focusable group.
     *
     * A wrapper around a native control defers to it. A composite that owns
     * its own roving tabindex still gets it on the container, because there
     * the container *is* the control (§13.4) — that case passes `tabIndex`
     * explicitly, so honour that first.
     */
    const target =
      opts.tabIndex != null || isNativelyFocusable(el) ? el : nativeInside(el) || el;

    if (!target.hasAttribute("tabindex") && !isNativelyFocusable(target)) {
      target.setAttribute("tabindex", String(tabIndex));
    }

    // `focusin`/`focusout` rather than `focus`/`blur`: the former bubble, and
    // when the real control is a descendant the non-bubbling pair never fires
    // on the node's own element at all — so `data-mk-focused` and the `focus`
    // event were both silently dead for every wrapped control.
    ctx.own(
      listen(el, "focusin", (event) => {
        ctx.setState("focused", true);
        ctx.emit("focus", { native: event });
      })
    );
    ctx.own(
      listen(el, "focusout", (event) => {
        if (el.contains(event.relatedTarget)) return;
        ctx.setState("focused", false);
        ctx.emit("blur", { native: event });
      })
    );

    return {
      /** Move this element in or out of the tab order (roving tabindex). */
      setTabIndex(value) {
        tabIndex = value;
        target.setAttribute("tabindex", String(value));
      },
      get tabIndex() {
        return tabIndex;
      },
      focus(focusOptions) {
        target.focus(focusOptions);
      },
      blur() {
        target.blur();
      },
      get focused() {
        return el.contains(el.ownerDocument.activeElement);
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

/** The single native control this element wraps, if that is what it is. */
function nativeInside(el) {
  const found = el.querySelectorAll("a[href], button, input, select, textarea");
  return found.length === 1 ? found[0] : null;
}
