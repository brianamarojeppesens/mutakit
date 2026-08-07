/**
 * `dismissible`, `focus-trap`, and `positioned` (§9, §16.3).
 *
 * The three traits the whole overlay family composes. Keeping them as traits
 * rather than as `modal` behaviour is what lets a third party build an overlay
 * type that behaves identically without inheriting from anything — the
 * composition-over-inheritance rule of §8.3, applied where it matters most.
 */
import "../core/dev.js";
import * as dom from "../core/dom.js";
import { warn } from "../core/diagnostics.js";
import { PLACEMENTS } from "../geometry/anchor.js";
import * as R from "../geometry/rect.js";

/**
 * `dismissible` — Escape, click-outside, and a `beforeclose` veto (§9).
 *
 * The veto is the point of routing dismissal through the event system: an
 * unsaved-changes guard cancels a close without either side knowing about the
 * other.
 */
export const dismissible = {
  name: "dismissible",
  version: "1.0.0",
  events: ["beforeclose", "close", "dismiss"],
  keys: { Escape: "dismiss" },

  attach(ctx, options) {
    const opts = options || {};
    /** `light` closes on outside click, `modal` does not, `none` is programmatic. */
    const policy = opts.policy || "light";

    if (policy !== "none") {
      ctx.own(
        dom.listen(
          dom.documentRoot(),
          "keydown",
          (event) => {
            if (event.key !== "Escape") return;
            // Only the topmost overlay in the band responds, so a stack of
            // modals unwinds one at a time rather than all at once.
            const layers = ctx.service("layers");
            if (layers && layers.topOf(ctx.node.layer) !== ctx.node) return;
            if (api.dismiss("escape")) event.preventDefault();
          },
          true
        )
      );
    }

    if (policy === "light") {
      // Deferred to the next task: the click that *opened* this overlay is
      // still propagating, and would otherwise close it immediately.
      const arm = dom.timer(() => {
        ctx.own(
          dom.listen(dom.documentRoot(), "pointerdown", (event) => {
            if (ctx.el && ctx.el.contains(event.target)) return;
            if (opts.ignore && event.target.closest && event.target.closest(opts.ignore)) return;
            api.dismiss("outside");
          })
        );
      }, 0);
      ctx.own(arm);
    }

    const api = {
      /** Returns true when the overlay actually closed. */
      dismiss(reason) {
        const event = ctx.emit("beforeclose", { reason }, { cancelable: true });
        if (event.defaultPrevented) return false;
        ctx.emit("dismiss", { reason });
        ctx.emit("close", { reason });
        return true;
      },
      get policy() {
        return policy;
      }
    };
    return api;
  }
};

/**
 * `focus-trap` — contain focus, restore on close, `inert` the background.
 *
 * All of the work is the focus manager's (§13.4); the trait is the declaration
 * that this element wants it.
 */
export const focusTrap = {
  name: "focus-trap",
  version: "1.0.0",
  requires: [],
  keys: { Tab: "next", "Shift+Tab": "previous" },

  attach(ctx, options) {
    // Deliberately empty. Traits attach before the element joins the document,
    // and focusing a detached element is a no-op — so the trap is installed in
    // `mount`, which is the first moment it can actually take effect.
    ctx.node.state.focusTrapOptions = options || {};
    return {};
  },

  mount(ctx, api) {
    const focus = ctx.service("focus");
    if (!focus) {
      warn("MK3008", __MK_DEV__ &&
        "the focus service is not installed; focus-trap is inert", {
        subject: ctx.node.toString()
      });
      return;
    }
    const release = focus.trap(ctx.el, ctx.node.state.focusTrapOptions);
    ctx.own(release);
    api.release = release;
  }
};

/**
 * `positioned` — anchored positioning with flip, shift, size, arrow, and hide
 * (§16.3).
 *
 * Floating UI solves this better than a first implementation will, and the
 * zero-runtime-dependency constraint means reimplementing it with its
 * published algorithm as the reference specification (§1.6). If that proves a
 * bad trade, this becomes a thin adapter over it — see D13.
 *
 * The **virtual reference** — `reference: () => Rect`, re-evaluated each frame
 * — is what makes cursor-following tooltips, selection-range popovers, and a
 * value readout that tracks a control while dragging all expressible without a
 * fake placeholder element in the DOM.
 */
export const positioned = {
  name: "positioned",
  version: "1.0.0",
  events: ["reposition"],
  keys: { Escape: "close" },

  attach(ctx, options) {
    // An element that composes this trait declares its placement as ordinary
    // props (§8.1) rather than through a second configuration surface: one
    // place to look, one place to document, one thing to serialize.
    const opts = options || {};
    const state = {
      placement: opts.placement || "bottom",
      reference: opts.reference,
      offset: opts.offset == null ? 8 : opts.offset,
      flip: opts.flip !== false,
      shift: opts.shift !== false,
      size: !!opts.size,
      arrow: opts.arrow || null,
      hide: opts.hide !== false,
      corners: !!opts.corners,
      padding: opts.padding == null ? 8 : opts.padding
    };

    ctx.node.positioning = "self";
    ctx.node.state.positioned = state;

    // Re-evaluated in ARRANGE, which is where a virtual reference is read.
    const reposition = () => place(ctx, state);
    ctx.own(ctx.mk.scheduler.on("arrange", reposition));

    // A DOM reference moves when an ancestor scrolls or the window resizes;
    // an IntersectionObserver reports it leaving view.
    const referenceEl = referenceElement(state.reference);
    if (referenceEl) {
      ctx.own(dom.observeResize(referenceEl, reposition));
      ctx.own(
        dom.observeIntersection(referenceEl, (entries) => {
          if (!state.hide) return;
          ctx.setState("reference-hidden", !entries[0].isIntersecting);
        })
      );
      ctx.own(dom.listen(dom.documentRoot(), "scroll", reposition, true));
    }

    return {
      /** Re-place now, without waiting for the next frame. */
      update: reposition,
      setReference(reference) {
        state.reference = reference;
        reposition();
      },
      setPlacement(placement) {
        state.placement = placement;
        reposition();
      },
      get placement() {
        return state.resolved || state.placement;
      }
    };
  }
};

function referenceElement(reference) {
  if (!reference) return null;
  if (typeof reference === "function") return null;
  if (reference.nodeType === 1) return reference;
  if (reference.el) return reference.el;
  if (reference.node && reference.node.el) return reference.node.el;
  return null;
}

/** The parent's origin in viewport coordinates — the frame space's `(0, 0)`. */
function frameOrigin(ctx) {
  const parent = ctx.node.parent;
  return parent && parent.el ? dom.rectOf(parent.el) : { x: 0, y: 0 };
}

/**
 * The reference rect, in the frame space the overlay is placed in.
 *
 * §16.3 calls a static reference "a Rect **in a named coordinate space**", and
 * the space is what makes it usable: a `contextmenu` event carries viewport
 * coordinates, the overlay is placed in its parent's frame, and the two agree
 * only when the parent happens to start at the top-left of the window. Left
 * implicit, that is a bug you see rather than one you catch — the menu opens,
 * just not where the cursor is.
 */
function referenceRect(ctx, reference) {
  if (typeof reference === "function") return reference();
  const el = referenceElement(reference);
  if (el) {
    const box = dom.rectOf(el);
    const host = frameOrigin(ctx);
    return { x: box.x - host.x, y: box.y - host.y, w: box.w, h: box.h };
  }
  // A point is a rect. Requiring `w: 0, h: 0` at every call site is the kind of
  // ceremony §16.3's "static Rect" wording does not ask for, and forgetting it
  // produces `NaN` coordinates rather than an error.
  if (reference && typeof reference.x === "number") {
    // `frame` is the default because that is the space the overlay is placed
    // in, so a rect with no stated space keeps meaning what it has always
    // meant. Only a caller that says `viewport` pays for the conversion.
    const host = reference.space === "viewport" ? frameOrigin(ctx) : { x: 0, y: 0 };
    return {
      x: reference.x - host.x,
      y: reference.y - host.y,
      w: reference.w || 0,
      h: reference.h || 0
    };
  }
  return null;
}

/**
 * Place the overlay. The order — offset, flip, shift, size, arrow, hide — is
 * the published one, and it matters: flipping after shifting produces a box
 * that jitters between sides at the boundary.
 */
function place(ctx, state) {
  const node = ctx.node;
  if (!node.el || node.destroyed) return;
  const reference = referenceRect(ctx, state.reference);
  if (!reference) return;

  const parent = node.parent;
  const bounds = parent
    ? { x: 0, y: 0, w: parent.frame.w, h: parent.frame.h }
    : { x: 0, y: 0, w: 0, h: 0 };
  const size = { w: node.computed.w || node.el.offsetWidth, h: node.computed.h || node.el.offsetHeight };

  let placement = state.placement;
  let box = anchorTo(reference, size, placement, state.offset);

  if (state.flip && !R.containsRect(inset(bounds, state.padding), box)) {
    // `corners` is the context-menu response: with a zero-size reference there
    // is no trigger to stay attached to, so the right answer is to open from a
    // different corner of the same point rather than to jump to its far side.
    // Ordinary flip keeps the surface tied to its trigger, which is the right
    // answer for everything that has one.
    const candidates = state.corners ? corners(placement) : [opposite(placement)];
    let best = fits(box, bounds, state.padding);
    for (const next of candidates) {
      const candidate = anchorTo(reference, size, next, state.offset);
      const score = fits(candidate, bounds, state.padding);
      if (score > best) {
        best = score;
        placement = next;
        box = candidate;
      }
    }
  }

  if (state.shift) box = shiftInto(box, bounds, state.padding, placement);

  if (state.size) {
    const room = available(reference, bounds, placement, state.offset, state.padding);
    ctx.css({
      "--mk-available-width": `${Math.round(room.w)}px`,
      "--mk-available-height": `${Math.round(room.h)}px`
    });
  }

  state.resolved = placement;
  // Written directly rather than re-constrained. `positioning: 'self'` means
  // this element owns its box (§9.1), and routing through the parent's
  // algorithm would cost a whole extra frame — visible as a one-frame lag on
  // every cursor-following tooltip, which is exactly the case the virtual
  // reference exists to serve.
  node.computed.x = box.x;
  node.computed.y = box.y;
  node.computed.w = box.w;
  node.computed.h = box.h;
  node.geometry.left = box.x;
  node.geometry.top = box.y;
  ctx.mk.compiler.setRect(node, node.computed);
  ctx.setState("placement", placement);

  if (state.arrow) {
    // The caret's offset is published as a custom property rather than
    // positioned directly, so a theme can restyle it without recomputing it.
    const along = axisOf(placement) === "y" ? "x" : "y";
    const centre =
      along === "x" ? reference.x + reference.w / 2 - box.x : reference.y + reference.h / 2 - box.y;
    const limit = along === "x" ? box.w : box.h;
    ctx.css({ "--mk-arrow-offset": `${Math.round(Math.min(Math.max(centre, 8), limit - 8))}px` });
  }

  ctx.emit("reposition", { placement, rect: box });
}

function anchorTo(reference, size, placement, offset) {
  const [side, align] = String(placement).split("-");
  let x = reference.x;
  let y = reference.y;

  if (side === "top") y = reference.y - size.h - offset;
  else if (side === "bottom") y = reference.y + reference.h + offset;
  else if (side === "left") x = reference.x - size.w - offset;
  else if (side === "right") x = reference.x + reference.w + offset;

  if (side === "top" || side === "bottom") {
    if (align === "start") x = reference.x;
    else if (align === "end") x = reference.x + reference.w - size.w;
    else x = reference.x + reference.w / 2 - size.w / 2;
  } else {
    if (align === "start") y = reference.y;
    else if (align === "end") y = reference.y + reference.h - size.h;
    else y = reference.y + reference.h / 2 - size.h / 2;
  }
  return { x, y, w: size.w, h: size.h };
}

function opposite(placement) {
  const [side, align] = String(placement).split("-");
  const flipped = { top: "bottom", bottom: "top", left: "right", right: "left" }[side] || side;
  return align ? `${flipped}-${align}` : flipped;
}

/**
 * The other three corners of a point, best-first.
 *
 * `bottom-start` → `bottom-end`, `top-start`, `top-end`: swap the alignment
 * before the side, because a menu that has run out of room to the right is
 * still better placed below the cursor than above it.
 */
function corners(placement) {
  const [side, align] = String(placement).split("-");
  if (align !== "start" && align !== "end") return [opposite(placement)];
  const otherAlign = align === "start" ? "end" : "start";
  const otherSide = { top: "bottom", bottom: "top", left: "right", right: "left" }[side] || side;
  return [`${side}-${otherAlign}`, `${otherSide}-${align}`, `${otherSide}-${otherAlign}`];
}

function axisOf(placement) {
  const side = String(placement).split("-")[0];
  return side === "top" || side === "bottom" ? "y" : "x";
}

function inset(bounds, padding) {
  return R.inset(bounds, padding);
}

/** How much of `box` lies inside `bounds` — the flip decision's score. */
function fits(box, bounds, padding) {
  return R.area(R.intersect(box, inset(bounds, padding)));
}

/** Slide along the cross axis to stay visible, without leaving the reference. */
function shiftInto(box, bounds, padding, placement) {
  const limits = inset(bounds, padding);
  const next = { ...box };
  if (axisOf(placement) === "y") {
    next.x = Math.min(Math.max(next.x, limits.x), Math.max(limits.x, limits.x + limits.w - box.w));
  } else {
    next.y = Math.min(Math.max(next.y, limits.y), Math.max(limits.y, limits.y + limits.h - box.h));
  }
  return next;
}

function available(reference, bounds, placement, offset, padding) {
  const limits = inset(bounds, padding);
  const side = String(placement).split("-")[0];
  if (side === "top") return { w: limits.w, h: reference.y - limits.y - offset };
  if (side === "bottom") {
    return { w: limits.w, h: limits.y + limits.h - (reference.y + reference.h) - offset };
  }
  if (side === "left") return { w: reference.x - limits.x - offset, h: limits.h };
  return { w: limits.x + limits.w - (reference.x + reference.w) - offset, h: limits.h };
}

export { PLACEMENTS };
