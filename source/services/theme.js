/**
 * Themes and token sets (§12.3, extension point §10.6).
 *
 * Three token tiers mean a theme author changes a dozen values rather than
 * three hundred, and the **themeable axes** — colour scheme, contrast, density,
 * radius, motion, font — are separate from the palette on purpose: a dark
 * inspector panel inside a light application is a subtree, not a second theme.
 */
import "../core/dev.js";

export const AXES = ["scheme", "contrast", "density", "radius", "motion", "font"];

/** The two themes core ships. Anything richer is a plugin's business (§1.4). */
export const BUILT_IN_THEMES = {
  light: { name: "light", tokens: {} },
  dark: { name: "dark", tokens: {} },
  system: { name: "system", tokens: {} }
};

export class ThemeService {
  constructor() {
    this.mk = null;
    this.active = null;
  }

  attach(mk) {
    this.mk = mk;
    for (const name of Object.keys(BUILT_IN_THEMES)) {
      mk.registry.set("theme", name, BUILT_IN_THEMES[name], { replace: true });
    }
  }

  /**
   * Apply a theme, or a set of axes, to a subtree.
   *
   * Themes apply per subtree by setting tokens on a node's element, which is
   * why a dark panel inside a light application needs no special support.
   */
  apply(target, values) {
    const node = target && target.node ? target.node : target || (this.mk && this.mk.root);
    const el = node && node.el;
    if (!el) return this;

    const settings = typeof values === "string" ? { scheme: values } : values || {};
    for (const axis of AXES) {
      if (settings[axis] == null) continue;
      el.setAttribute(`data-mk-${axis}`, String(settings[axis]));
    }
    if (settings.theme || typeof values === "string") {
      const name = settings.theme || values;
      const theme = this.mk.registry.get("theme", name);
      el.setAttribute("data-mk-theme", name);
      if (theme && theme.tokens) {
        for (const token of Object.keys(theme.tokens)) {
          el.style.setProperty(token, theme.tokens[token]);
        }
      }
      this.active = name;
    }
    if (settings.tokens) {
      for (const token of Object.keys(settings.tokens)) {
        el.style.setProperty(token, settings.tokens[token]);
      }
    }
    return this;
  }

  /** Follow the system colour scheme from the metrics snapshot (§6.4). */
  follow(target) {
    const node = target && target.node ? target.node : target || (this.mk && this.mk.root);
    if (!node || !node.el) return () => {};
    const sync = () => {
      node.el.setAttribute("data-mk-theme", "system");
      node.el.setAttribute("data-mk-scheme", this.mk.metrics.current.darkScheme ? "dark" : "light");
    };
    sync();
    return this.mk.scheduler.on("read", sync);
  }
}
