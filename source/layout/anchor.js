/**
 * The `anchor` algorithm (§7.1) — core.
 *
 * The default. Each child is placed independently by its anchor and edge
 * constraints (§5.5–§5.6) against the parent frame; children may overlap. This
 * is the HUD algorithm and the overlay algorithm, and it is the reason §5.6's
 * two-of-three rule makes the whole S3 case fall out for free.
 *
 * `positioning: 'self'` is already the default here, so attaching `draggable`
 * to a child simply works with no configuration (§9.1).
 */

export const anchorLayout = {
  name: "anchor",
  version: "1.0.0",
  positioning: "self",

  childProps: {
    /** Stacking within the parent, below the layer band (§16.1). */
    z: { type: "number" }
  },

  arrange(node, children, ctx) {
    for (const child of children) {
      if (child.destroyed) continue;
      ctx.mk.resolveBox(child, node.frame, node);
      const z = child.layoutProps && child.layoutProps.z;
      if (z != null) ctx.mk.compiler.set(child, "--mk-z", String(z));
    }
  },

  css() {
    return { position: "relative" };
  },

  styles: `
    [data-mk-algorithm="anchor"] {
      position: relative;
    }
    [data-mk-algorithm="anchor"] > .mk-node {
      z-index: var(--mk-z, auto);
    }
  `
};
