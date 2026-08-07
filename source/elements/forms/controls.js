/**
 * Form controls (§11.3).
 *
 * **Native first, and it is a hard rule.** Each of these wraps a native
 * control where one exists, because that is what buys accessibility, IME
 * support, autofill, password managers, and mobile keyboards — none of which a
 * custom implementation gets right, and all of which users notice. A custom
 * control appears only where the platform has none (`combobox`, `tags`), and
 * each such case is named.
 *
 * Because the wrapping is mechanical, the definitions are generated from one
 * description rather than written out twenty times. That is not brevity for its
 * own sake: it means every control gets the same validation wiring, the same
 * `aria-invalid` handling, and the same `field` integration, and none can drift
 * from the others by accident.
 */
import "../../core/dev.js";
import * as dom from "../../core/dom.js";
import { css } from "../../styles/index.js";

/** Turn `{ type, tag, inputType, … }` into a full element definition. */
function nativeControl(spec) {
  return {
    type: spec.type,
    version: "1.0.0",
    props: {
      value: { type: spec.valueType || "string", default: spec.defaultValue, persist: true },
      name: { type: "string", default: "" },
      label: { type: "string", default: "" },
      placeholder: { type: "string", default: "" },
      disabled: { type: "boolean", default: false },
      readonly: { type: "boolean", default: false },
      required: { type: "boolean", default: false },
      invalid: { type: "boolean", default: false },
      describedBy: { type: "string", default: "" },
      ...(spec.props || {})
    },

    events: ["input", "change", "focus", "blur", ...(spec.events || [])],
    traits: ["focusable"],
    geometry: { defaults: spec.geometry || { size: { w: "100%", h: "auto" } } },

    /**
     * The native element carries the role. Declaring one here would *replace*
     * the semantics the platform already provides, which is the most common way
     * a "component library" makes a control less accessible than a bare input.
     */
    a11y: {
      props: {
        "aria-invalid": (ctx) => (ctx.props.invalid ? "true" : null),
        "aria-required": (ctx) => (ctx.props.required ? "true" : null),
        "aria-describedby": (ctx) => ctx.props.describedBy || null,
        "aria-label": (ctx) => (ctx.props.label && !ctx.node.state.labelId ? ctx.props.label : null)
      }
    },

    commands: {
      focus(ctx) {
        if (ctx.state.input) ctx.state.input.focus();
      },
      /** Read the current value from the DOM, which is the source of truth. */
      read(ctx) {
        return readValue(ctx, spec);
      },
      clear(ctx) {
        ctx.handle.set({ value: spec.defaultValue });
      }
    },

    create(ctx) {
      const input = dom.el(spec.tag || "input");
      if (spec.inputType) input.type = spec.inputType;
      input.className = `mk-control mk-control--${spec.type}`;
      ctx.state.input = input;

      if (spec.build) spec.build(ctx, input);
      applyNative(ctx, input, spec);

      ctx.own(
        dom.listen(input, "input", () => {
          const value = readValue(ctx, spec);
          ctx.node.props.value = value;
          ctx.mk.persistDirty = true;
          ctx.emit("input", { value });
        })
      );
      ctx.own(
        dom.listen(input, "change", () => ctx.emit("change", { value: readValue(ctx, spec) }))
      );

      // The wrapper exists so `field` has somewhere to put an error message
      // and an affix without touching the control itself.
      const wrapper = ctx.dom("div", { class: `mk-control-wrap` }, null);
      wrapper.appendChild(input);
      ctx.node.contentEl = wrapper;
      return wrapper;
    },

    update(ctx, changed) {
      applyNative(ctx, ctx.state.input, spec, changed);
    },

    styles: spec.styles || CONTROL_CSS
  };
}

function applyNative(ctx, input, spec, changed) {
  if (!input) return;
  const props = ctx.props;
  const set = (name) => !changed || changed.has(name);

  if (set("value")) writeValue(input, props.value, spec);
  if (set("name")) dom.setAttr(input, "name", props.name || null);
  if (set("placeholder") && "placeholder" in input) input.placeholder = props.placeholder || "";
  if (set("disabled")) input.disabled = !!props.disabled;
  if (set("readonly") && "readOnly" in input) input.readOnly = !!props.readonly;
  // Native constraint attributes are set so autofill, password managers, and
  // mobile keyboards behave — but the *messages* are Mutakit's, because native
  // validation bubbles are unstyleable and inconsistent (§11.3).
  if (set("required")) input.required = !!props.required;
  for (const name of spec.nativeProps || []) {
    if (set(name) && props[name] != null) dom.setAttr(input, attrName(name), props[name]);
  }
  if (set("invalid")) ctx.setState("invalid", !!props.invalid);
}

function attrName(name) {
  return name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}

function readValue(ctx, spec) {
  const input = ctx.state.input;
  if (!input) return ctx.props.value;
  if (spec.valueType === "boolean") return input.checked;
  if (spec.valueType === "number") return input.value === "" ? null : Number(input.value);
  if (spec.readValue) return spec.readValue(input);
  return input.value;
}

function writeValue(input, value, spec) {
  if (spec.valueType === "boolean") input.checked = !!value;
  else if (spec.writeValue) spec.writeValue(input, value);
  else input.value = value == null ? "" : String(value);
}

const CONTROL_CSS = css`
  .mk-control-wrap { display: flex; align-items: center; gap: var(--mk-space-2); width: 100%; }
  .mk-control {
    flex: 1 1 auto;
    min-width: 0;
    min-height: var(--mk-target-min);
    padding: 5px 8px;
    border: 1px solid var(--mk-border-strong);
    border-radius: var(--mk-radius-sm);
    background: var(--mk-color-surface-raised);
    color: inherit;
  }
  .mk-control:focus-visible { outline: var(--mk-focus-ring); outline-offset: 1px; }
  .mk-control:disabled { opacity: 0.55; cursor: not-allowed; }
  [data-mk-invalid] .mk-control { border-color: var(--mk-color-danger); }
  .mk-control--checkbox, .mk-control--switch, .mk-control--radio {
    flex: 0 0 auto;
    min-height: 0;
    width: 16px;
    height: 16px;
  }
  .mk-control--slider, .mk-control--color { padding: 0; }
`;

// ── The catalog ──────────────────────────────────────────────────────────

export const text = nativeControl({ type: "text", inputType: "text", defaultValue: "" });
export const password = nativeControl({
  type: "password",
  inputType: "password",
  defaultValue: "",
  nativeProps: ["autocomplete", "minlength", "maxlength"],
  props: { autocomplete: { type: "string", default: "current-password" } }
});
export const search = nativeControl({ type: "search", inputType: "search", defaultValue: "" });
export const email = nativeControl({
  type: "email",
  inputType: "email",
  defaultValue: "",
  nativeProps: ["autocomplete"]
});

export const textarea = nativeControl({
  type: "textarea",
  tag: "textarea",
  defaultValue: "",
  nativeProps: ["rows", "maxlength"],
  props: { rows: { type: "number", default: 3 } },
  geometry: { defaults: { size: { w: "100%", h: "auto" } } }
});

/** `number` — with step buttons and scrub-to-change (§11.3). */
export const number = nativeControl({
  type: "number",
  inputType: "number",
  valueType: "number",
  defaultValue: 0,
  nativeProps: ["min", "max", "step"],
  props: {
    min: { type: "number" },
    max: { type: "number" },
    step: { type: "number", default: 1 },
    scrub: { type: "boolean", default: true }
  },
  events: ["scrub"],
  build(ctx, input) {
    const step = (direction) => {
      const next = clampNumber(ctx, (Number(input.value) || 0) + direction * (ctx.props.step || 1));
      input.value = String(next);
      ctx.node.props.value = next;
      ctx.emit("input", { value: next });
    };

    const buttons = dom.el("span", { class: "mk-number__steps" });
    for (const [label, direction] of [["−", -1], ["+", 1]]) {
      const button = dom.el("button", {
        type: "button",
        tabindex: "-1",
        "aria-hidden": "true",
        text: label
      }, buttons);
      ctx.own(dom.listen(button, "click", () => step(direction)));
    }
    ctx.state.affix = buttons;

    // Scrub-to-change: drag horizontally over the field to adjust. Purely
    // additive — the field is still an ordinary number input, and the keyboard
    // path is the native one (P5).
    if (ctx.props.scrub) {
      let origin = null;
      ctx.own(
        dom.listen(input, "pointerdown", (event) => {
          if (event.target !== input || ctx.props.disabled) return;
          origin = { x: event.clientX, value: Number(input.value) || 0 };
        })
      );
      ctx.own(
        dom.listen(dom.documentRoot(), "pointermove", (event) => {
          if (!origin) return;
          const next = clampNumber(ctx, origin.value + Math.round((event.clientX - origin.x) / 2) * (ctx.props.step || 1));
          input.value = String(next);
          ctx.node.props.value = next;
          ctx.emit("scrub", { value: next });
        })
      );
      ctx.own(dom.listen(dom.documentRoot(), "pointerup", () => { origin = null; }));
    }
  },
  styles: css`
    ${CONTROL_CSS}
    .mk-number__steps { display: inline-flex; flex-direction: column; }
    .mk-number__steps button {
      border: 1px solid var(--mk-border-subtle);
      background: var(--mk-color-surface);
      cursor: pointer;
      line-height: 1;
      padding: 0 4px;
    }
  `
});

function clampNumber(ctx, value) {
  const min = ctx.props.min == null ? -Infinity : ctx.props.min;
  const max = ctx.props.max == null ? Infinity : ctx.props.max;
  return Math.min(Math.max(value, min), max);
}

export const checkbox = nativeControl({
  type: "checkbox",
  inputType: "checkbox",
  valueType: "boolean",
  defaultValue: false,
  geometry: { defaults: { size: { w: "auto", h: "auto" } } }
});

/** `switch` — a checkbox with `role="switch"`, which is the entire difference. */
export const toggleSwitch = nativeControl({
  type: "switch",
  inputType: "checkbox",
  valueType: "boolean",
  defaultValue: false,
  geometry: { defaults: { size: { w: "auto", h: "auto" } } },
  build(ctx, input) {
    input.setAttribute("role", "switch");
  }
});

export const slider = nativeControl({
  type: "slider",
  inputType: "range",
  valueType: "number",
  defaultValue: 0,
  nativeProps: ["min", "max", "step"],
  props: {
    min: { type: "number", default: 0 },
    max: { type: "number", default: 100 },
    step: { type: "number", default: 1 }
  }
});

export const color = nativeControl({ type: "color", inputType: "color", defaultValue: "#000000" });
export const date = nativeControl({ type: "date", inputType: "date", defaultValue: "" });
export const time = nativeControl({ type: "time", inputType: "time", defaultValue: "" });

/** `file` — with a drop target, which is the one thing native lacks. */
export const file = nativeControl({
  type: "file",
  inputType: "file",
  valueType: "any",
  defaultValue: null,
  nativeProps: ["accept", "multiple"],
  props: { accept: { type: "string", default: "" }, multiple: { type: "boolean", default: false } },
  events: ["drop"],
  readValue: (input) => (input.files && input.files.length ? [...input.files] : null),
  writeValue: () => {},
  build(ctx, input) {
    const drop = ctx.node;
    ctx.own(
      dom.listen(input.parentElement || input, "dragover", (event) => {
        event.preventDefault();
        ctx.setState("dropping", true);
      })
    );
    ctx.own(dom.listen(input.parentElement || input, "dragleave", () => ctx.setState("dropping", false)));
    ctx.own(
      dom.listen(input.parentElement || input, "drop", (event) => {
        event.preventDefault();
        ctx.setState("dropping", false);
        const files = [...(event.dataTransfer ? event.dataTransfer.files : [])];
        input.files = event.dataTransfer.files;
        drop.props.value = files;
        ctx.emit("drop", { files });
        ctx.emit("input", { value: files });
      })
    );
  }
});

/** `select` — genuinely native; a custom one would be worse in every way. */
export const select = nativeControl({
  type: "select",
  tag: "select",
  defaultValue: "",
  props: { options: { type: "array", default: () => [] } },
  build(ctx, input) {
    ctx.state.renderOptions = () => {
      input.textContent = "";
      for (const option of ctx.props.options || []) {
        const value = typeof option === "string" ? option : option.value;
        const label = typeof option === "string" ? option : option.label;
        dom.el("option", { value, text: label, disabled: option.disabled || null }, input);
      }
      input.value = ctx.props.value == null ? "" : String(ctx.props.value);
    };
    ctx.state.renderOptions();
  }
});

/** `button` — the one control whose semantics are its whole job. */
export const button = {
  type: "button",
  version: "1.0.0",
  props: {
    text: { type: "string", default: "" },
    variant: { type: "enum", values: ["default", "primary", "danger", "ghost"], default: "default" },
    disabled: { type: "boolean", default: false },
    pressed: { type: "boolean" },
    buttonType: { type: "enum", values: ["button", "submit", "reset"], default: "button" }
  },
  events: ["activate"],
  traits: ["focusable"],
  geometry: { defaults: { size: { w: "auto", h: "auto" } } },
  a11y: {
    props: {
      "aria-pressed": (ctx) => (ctx.props.pressed === undefined ? null : String(!!ctx.props.pressed)),
      "aria-disabled": (ctx) => (ctx.props.disabled ? "true" : null)
    }
  },
  commands: {
    click(ctx) {
      if (!ctx.props.disabled) ctx.emit("activate", { source: "command" });
    }
  },
  create(ctx) {
    const el = ctx.dom("button", {
      type: ctx.props.buttonType,
      class: `mk-button mk-button--${ctx.props.variant}`,
      text: ctx.props.text
    }, null);
    el.disabled = !!ctx.props.disabled;
    // `activate` rather than `click`: it is what a declarative `command`
    // listens for (§18.2), and it fires for the keyboard path too.
    ctx.own(dom.listen(el, "click", (event) => ctx.emit("activate", { native: event })));
    return el;
  },
  update(ctx, changed) {
    if (changed.has("text")) dom.setText(ctx.el, ctx.props.text);
    if (changed.has("disabled")) ctx.el.disabled = !!ctx.props.disabled;
    if (changed.has("variant")) ctx.el.className = `mk-button mk-button--${ctx.props.variant}`;
  }
};

/** `toggle` — a button with a pressed state. */
export const toggle = {
  ...button,
  type: "toggle",
  props: { ...button.props, pressed: { type: "boolean", default: false, persist: true } },
  create(ctx) {
    const el = button.create(ctx);
    ctx.on("activate", () => ctx.handle.set({ pressed: !ctx.props.pressed }));
    return el;
  }
};

export const NATIVE_CONTROLS = [
  text, password, search, email, textarea, number,
  checkbox, toggleSwitch, slider, color, date, time, file, select,
  button, toggle
];
