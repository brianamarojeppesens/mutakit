/**
 * `split` — a pane whose children are separated by draggable gutters (§11.1).
 *
 * The element is a thin declaration; §7.3's algorithm does the work. It exists
 * so a split is expressible in the tier-2 declarative form — which is what
 * `serialize()` emits and `restore()` accepts — rather than only through the
 * fluent `pane.split({…})` call.
 */
import "../../core/dev.js";
import { normalizeOptions } from "../../layout/split.js";

export const split = {
  type: "split",
  version: "1.0.0",
  extends: "pane",
  algorithm: "split",

  props: {
    axis: { type: "any", default: "x", persist: true },
    gutter: { type: "any", default: 6 },
    resizeMode: { type: "enum", values: ["neighbor", "distribute", "push"], default: "neighbor" },
    live: { type: "boolean", default: true },
    step: { type: "number", default: 8 }
  },

  /**
   * `role="group"` rather than anything more specific: the interactive part is
   * each `resizer`, which carries `role="separator"` and its own value range.
   */
  a11y: { role: "group", props: { "aria-label": (ctx) => ctx.props.label || null } },

  events: ["resize", "collapse", "expand"],

  commands: {
    /** The sizes of every pane, in order — what an author reads back. */
    sizes(ctx) {
      const model = ctx.node.splitModel;
      return model ? model.sizes.slice() : [];
    },
    /** Restore every pane to its declared size, discarding drag state. */
    reset(ctx) {
      for (const child of ctx.node.children) {
        if (child.type === "resizer") continue;
        ctx.mk.setLayoutProps(child, { collapsed: false });
      }
      ctx.invalidate("arrange");
    }
  },

  create(ctx, inherited) {
    ctx.node.algorithmOptions = normalizeOptions({
      axis: ctx.props.axis,
      gutter: ctx.props.gutter,
      resizeMode: ctx.props.resizeMode,
      live: ctx.props.live,
      step: ctx.props.step
    });
    return inherited;
  },

  update(ctx, changed) {
    if (!["axis", "gutter", "resizeMode", "live", "step"].some((key) => changed.has(key))) return;
    ctx.node.algorithmOptions = normalizeOptions({
      axis: ctx.props.axis,
      gutter: ctx.props.gutter,
      resizeMode: ctx.props.resizeMode,
      live: ctx.props.live,
      step: ctx.props.step
    });
    ctx.invalidate("arrange");
  }
};
