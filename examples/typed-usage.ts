/**
 * The type check's subject (§22.5).
 *
 * `tsc --noEmit` runs over `examples/`, so a type regression fails the build
 * rather than being discovered by a user. This file exists to exercise the
 * generated definitions against the API as documented, not to be a good
 * example of anything — the runnable examples are the `.html` files beside it.
 */
import Mutakit, { type Handle, type Len, type SplitOptions } from "mutakit";

const app: Handle = Mutakit.mount("#root", { sizing: "viewport" });

// §5.9 — the user's own words, typed.
const options: SplitOptions = {
  axis: "x",
  gutter: { size: 6, draggable: true },
  panes: [
    { id: "left", size: 100, min: 64, max: "40%" },
    { id: "right", size: "1fr" }
  ]
};
const [left, right] = app.split(options);

const [stage, bottom] = right.split({
  axis: "y",
  gutter: { size: 6, draggable: true },
  panes: [
    { id: "stage", size: "1fr" },
    { id: "bottom", size: 150, min: 80, collapsible: { at: 40, to: 0 } }
  ]
});

// §1.2 — a button that opens a centred modal.
left.create("pane", {
  content: "Settings",
  at: "top-left",
  inset: 8,
  on: {
    click: () => {
      Mutakit.create("surface", { size: { w: "60%", h: "70%" }, at: "center" });
    }
  }
});

// §15.1 — signals are accepted anywhere a value is.
const health = Mutakit.signal(100);
const max = Mutakit.signal(100);
const pct = Mutakit.computed(() => health() / max());
Mutakit.effect(() => {
  stage.set({ label: `${Math.round(pct() * 100)}%` });
});

// §5.2 — the Len union covers every documented spelling.
const lengths: Len[] = [120, "120px", "2rem", "50%", "1fr", "auto", "calc(100% - 32px)"];
bottom.constrain({ height: lengths[4] });

// §8.1 — a plugin element type, with its own props and commands.
Mutakit.define<{ value: number; label: string }>({
  type: "acme:gauge",
  version: "1.2.0",
  props: {
    value: { type: "number", default: 0, min: 0, max: 1 },
    label: { type: "string", default: "" }
  },
  a11y: { role: "meter", props: { "aria-valuenow": (ctx) => ctx.props.value } },
  events: ["change"],
  commands: {
    setValue(ctx, next: never) {
      ctx.emit("change", { value: next });
    }
  },
  create(ctx) {
    return ctx.dom("div", { class: "acme-gauge" });
  }
});

export { app, left, stage, bottom };
