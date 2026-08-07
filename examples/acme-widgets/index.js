/**
 * acme-widgets — a complete third-party plugin (PLAN.md Appendix A).
 *
 * This is §26 M6's completion criterion made concrete: **a plugin published
 * from outside the library's repository, installed with `mk.use()`.** It has
 * its own `package.json`, declares Mutakit as a peer dependency, imports
 * nothing from `source/`, and reaches the library only through `mk` — the
 * argument of `install`.
 *
 * It exercises four of §10's extension points at once — a unit, a trait, an
 * element type, and a layout algorithm — because an extension point with no
 * external consumer is probably wrong (§10, last paragraph).
 */

export const AcmeWidgets = {
  name: "acme-widgets",
  version: "1.2.0",
  requires: { mutakit: ">=0.4.0 <2" },

  install(mk, options) {
    const opts = options || {};

    // ── §10.4 — a custom length unit ────────────────────────────────────
    // `1u` is one rack unit: a fixed module height the whole plugin sizes by.
    const unit = opts.unit == null ? 44 : opts.unit;
    mk.unit("u", {
      toNumber: (value) => value * unit,
      toCSS: (value) => `calc(${value} * var(--acme-unit, ${unit}px))`,
      basis: "absolute"
    });

    // ── §10.11 — a custom prop type ─────────────────────────────────────
    // §10 asks every extension point for a non-built-in consumer, calling it
    // the honest test. A rack slot is `"3U"` or a bare number, and coercing it
    // here means every widget that takes one gets the same parsing, the same
    // error message, and the same value shape without repeating any of it.
    mk.validator("acme:rack-units", (value) => {
      if (typeof value === "number" && Number.isInteger(value) && value > 0) return { value };
      const match = typeof value === "string" && /^(\d+)\s*U$/i.exec(value.trim());
      if (match) return { value: Number(match[1]) };
      return { error: `expected rack units like 3 or "3U", got ${JSON.stringify(value)}` };
    }, { replace: true });

    // ── §10.2 — a trait ─────────────────────────────────────────────────
    mk.trait({
      name: "acme:pulse",
      version: "1.2.0",
      events: ["pulse"],
      /** A pointer-free trait, but Escape still stops it (P5). */
      keys: { Escape: "stop" },
      attach(ctx, traitOptions) {
        const period = (traitOptions && traitOptions.period) || 1000;
        let running = true;
        const beat = () => {
          if (!running) return;
          ctx.setState("pulse", true);
          ctx.emit("pulse", { at: Date.now ? 0 : 0 });
          ctx.own(setTimeoutDisposer(() => ctx.setState("pulse", false), period / 2));
        };
        const timer = setInterval(beat, period);
        ctx.own(() => clearInterval(timer));
        return {
          stop() {
            running = false;
          },
          get running() {
            return running;
          }
        };
      }
    });

    // ── §10.1 — an element type ─────────────────────────────────────────
    mk.define({
      type: "acme:gauge",
      version: "1.2.0",
      extends: "surface",
      traits: ["focusable", "acme:pulse"],
      props: {
        value: { type: "number", default: 0, min: 0, max: 1, reactive: true },
        label: { type: "string", default: "" },
        variant: { type: "enum", values: ["arc", "bar"], default: "arc" },
        /** The custom prop type above: `3` and `"3U"` both arrive as `3`. */
        rack: { type: "acme:rack-units", default: 1 }
      },
      geometry: { defaults: { size: { w: "3u", h: "3u" } } },
      events: ["change", "overload"],
      a11y: {
        role: "meter",
        props: {
          "aria-valuenow": (ctx) => Math.round(ctx.props.value * 100),
          "aria-label": (ctx) => ctx.props.label || "Gauge"
        }
      },
      commands: {
        setValue(ctx, next) {
          ctx.handle.set({ value: next });
          if (next >= 1) ctx.emit("overload", { value: next });
          else ctx.emit("change", { value: next });
        }
      },
      create(ctx) {
        const el = ctx.dom("div", { class: "acme-gauge" }, null);
        // Only `ctx` is reachable — there is no other surface, which is the
        // enforcement mechanism for P3 rather than a convention.
        ctx.css({ "--acme-gauge-value": String(ctx.props.value) });
        return el;
      },
      update(ctx, changed) {
        if (changed.has("value")) ctx.css({ "--acme-gauge-value": String(ctx.props.value) });
      },
      tokens: { "--acme-gauge-track": "var(--mk-color-muted)" },
      styles: `
        .acme-gauge {
          background:
            conic-gradient(
              var(--mk-color-accent) calc(var(--acme-gauge-value, 0) * 360deg),
              var(--acme-gauge-track) 0
            );
          border-radius: 50%;
        }
        .acme-gauge[data-mk-pulse] { filter: brightness(1.25); }
      `
    });

    // ── §10.3 — a layout algorithm ──────────────────────────────────────
    // A rack: children stack vertically in whole units, which is exactly the
    // case §7.0's `layout` bag exists for.
    mk.layout({
      name: "acme:rack",
      version: "1.2.0",
      schema: { gap: { type: "len", default: 4 } },
      childProps: { units: { type: "number", default: 1 } },
      arrange(node, children, ctx) {
        const gap = ctx.len((node.algorithmOptions || {}).gap || 4, "y");
        let cursor = node.frame.y;
        for (const child of children) {
          const units = (child.layoutProps && child.layoutProps.units) || 1;
          const height = units * unit;
          ctx.place(child, { x: node.frame.x, y: cursor, w: node.frame.w, h: height });
          cursor += height + gap;
        }
      },
      css() {
        return { position: "relative" };
      }
    });

    return {
      uninstall() {
        // Deregistration is the kernel's job; the plugin only says what it
        // contributed, and live instances keep working until destroyed (§8.5).
      }
    };
  }
};

function setTimeoutDisposer(fn, ms) {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
}

export default AcmeWidgets;
