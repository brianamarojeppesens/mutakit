/**
 * `field`, `form`, and validation (§11.3).
 *
 * Validation is a **first-class subsystem, not a per-control concern**, because
 * getting it right means coordinating timing, accessibility, and focus across a
 * whole form — which no individual control can do.
 *
 * The timing policy is the part most libraries get wrong. The default here is
 * *validate on submit, then revalidate on change for fields that have already
 * errored*. Validating on every keystroke before the user has finished typing
 * is hostile; never revalidating after an error means they cannot tell when
 * they have fixed it.
 */
import "../../core/dev.js";
import * as dom from "../../core/dom.js";
import { css } from "../../styles/index.js";
import { normalizeSchema, validateValue } from "../../core/schema.js";

/**
 * `field` — label + control + description + error, the composition wrapper.
 *
 * The accessibility wiring is automatic and non-negotiable: the label is
 * associated, the description and error are linked through `aria-describedby`,
 * and `aria-invalid` lands on the control. Doing this by hand per form is the
 * single most commonly skipped accessibility task in web applications; here it
 * is the default and opting out is explicit.
 */
export const field = {
  type: "field",
  version: "1.0.0",
  props: {
    label: { type: "string", default: "" },
    description: { type: "string", default: "" },
    error: { type: "string", default: "" },
    required: { type: "boolean", default: false },
    for: { type: "string", default: "" },
    layout: { type: "enum", values: ["stacked", "inline"], default: "stacked" }
  },
  events: ["errorchange"],
  slots: { control: { max: 1 }, default: {} },
  geometry: { defaults: { size: { w: "100%", h: "auto" } } },

  /** A group, not a label: the label element does the labelling. */
  a11y: { role: "group", props: { "aria-labelledby": (ctx) => ctx.node.state.labelId || null } },

  create(ctx) {
    const id = ctx.node.id || `mk-field-${Math.abs(hash(ctx.props.label))}`;
    const el = ctx.dom("div", { class: `mk-field mk-field--${ctx.props.layout}` }, null);

    const labelId = `${id}-label`;
    // No `for` yet. It used to be set here, optimistically, against an id the
    // control would later be given — and a field whose control is not
    // labelable (a button, a toggle group, a fieldset) never got one, leaving a
    // `<label for>` pointing at nothing. Clicking it does nothing and a screen
    // reader announces an orphan. `wire()` sets it when it finds a control and
    // removes it when there is none, so the attribute is never a promise the
    // DOM cannot keep. axe does not flag this, which is why it stood.
    const label = dom.el("label", { class: "mk-field__label", id: labelId }, el);
    dom.setText(label, ctx.props.label);
    if (ctx.props.required) {
      label.appendChild(dom.el("span", { class: "mk-field__required", "aria-hidden": "true", text: " *" }));
    }

    const body = dom.el("div", { class: "mk-field__control" }, el);
    const description = dom.el("p", { class: "mk-field__description", id: `${id}-desc` }, el);
    const error = dom.el("p", { class: "mk-field__error", id: `${id}-error`, role: "alert" }, el);

    dom.setText(description, ctx.props.description);
    dom.setText(error, ctx.props.error);

    Object.assign(ctx.state, { id, labelId, label, body, description, error });
    ctx.node.state.labelId = labelId;
    ctx.node.contentEl = body;
    return el;
  },

  mount(ctx) {
    wire(ctx);
  },

  /**
   * Re-wire each frame the field is arranged.
   *
   * A control is created *after* its field — it is a child — so wiring only at
   * mount associates the label with an element that does not exist yet. This is
   * idempotent and costs four attribute reads.
   */
  arrange(ctx) {
    wire(ctx);
  },

  update(ctx, changed) {
    if (changed.has("label")) dom.setText(ctx.state.label, ctx.props.label);
    if (changed.has("description")) dom.setText(ctx.state.description, ctx.props.description);
    if (changed.has("error")) {
      dom.setText(ctx.state.error, ctx.props.error);
      ctx.setState("invalid", !!ctx.props.error);
      wire(ctx);
      ctx.emit("errorchange", { error: ctx.props.error });
    }
  },

  styles: css`
    .mk-field { display: flex; flex-direction: column; gap: 4px; }
    .mk-field--inline {
      flex-direction: row;
      align-items: center;
      gap: var(--mk-space-3);
    }
    .mk-field__label { font-size: var(--mk-text-sm); font-weight: 500; }
    .mk-field__required { color: var(--mk-color-danger); }
    .mk-field__description { margin: 0; font-size: var(--mk-text-sm); color: var(--mk-text-secondary); }
    .mk-field__description:empty, .mk-field__error:empty { display: none; }
    .mk-field__error { margin: 0; font-size: var(--mk-text-sm); color: var(--mk-color-danger); }
  `
};

/** Link label, description, and error to whatever control landed in the slot. */
function wire(ctx) {
  const control = ctx.state.body && ctx.state.body.querySelector("input, select, textarea, [role]");
  if (!control) {
    // A field can legitimately wrap something unlabelable. The group's own
    // `aria-labelledby` still names it (§11.3), so the label element stays —
    // it just stops claiming to be `for` an element that is not there.
    ctx.state.label.removeAttribute("for");
    return;
  }
  if (ctx.state.wired === control && ctx.state.wiredError === ctx.props.error) return;
  ctx.state.wired = control;
  ctx.state.wiredError = ctx.props.error;
  if (!control.id) control.id = `${ctx.state.id}-input`;
  ctx.state.label.setAttribute("for", control.id);

  const described = [];
  if (ctx.props.description) described.push(`${ctx.state.id}-desc`);
  if (ctx.props.error) described.push(`${ctx.state.id}-error`);
  if (described.length) control.setAttribute("aria-describedby", described.join(" "));
  else control.removeAttribute("aria-describedby");

  if (ctx.props.error) control.setAttribute("aria-invalid", "true");
  else control.removeAttribute("aria-invalid");
  if (ctx.props.required) control.setAttribute("aria-required", "true");
}

function hash(text) {
  let value = 0;
  for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) | 0;
  return value;
}

/**
 * `form` — validation orchestration, submit handling, dirty tracking, reset.
 *
 * The schema is **the same schema** as §8.1's prop schemas. One validator
 * vocabulary, reused — which also means form errors and prop-validation
 * diagnostics share a message catalogue and an i18n path.
 */
export const form = {
  type: "form",
  version: "1.0.0",
  algorithm: "stack",

  props: {
    values: { type: "object", default: () => ({}), persist: true },
    schema: { type: "object", default: () => ({}) },
    validate: { type: "object", default: () => ({}) },
    timing: {
      type: "object",
      default: () => ({ initial: "submit", afterError: "change", async: "blur" })
    },
    disabled: { type: "boolean", default: false }
  },

  events: ["submit", "invalid", "change", "reset", "validated"],
  a11y: { role: "form", props: { "aria-label": (ctx) => ctx.props.label || null } },

  commands: {
    /**
     * Validate everything, then submit or report.
     *
     * On failure, focus moves to the first invalid control while an error
     * summary is announced through the polite live region (§14). That pairing
     * is the whole reason validation is a form-level subsystem.
     */
    async submit(ctx) {
      ctx.state.submitCount++;
      const errors = await validateAll(ctx, Object.keys(ctx.props.schema));
      ctx.state.errors = errors;
      applyErrors(ctx, errors);

      const names = Object.keys(errors);
      if (names.length) {
        ctx.emit("invalid", { errors });
        focusFirstInvalid(ctx, names[0]);
        ctx.announce(
          names.length === 1
            ? `1 field needs attention: ${errors[names[0]]}`
            : `${names.length} fields need attention.`,
          "assertive"
        );
        return false;
      }
      ctx.emit("submit", { values: { ...ctx.state.values } });
      return true;
    },

    reset(ctx) {
      ctx.state.values = { ...ctx.state.initial };
      ctx.state.errors = {};
      ctx.state.touched = {};
      applyErrors(ctx, {});
      syncControls(ctx);
      ctx.emit("reset", { values: { ...ctx.state.values } });
    },

    /** Validate one field now, whatever the timing policy says. */
    async validateField(ctx, name) {
      const errors = await validateAll(ctx, [name]);
      Object.assign(ctx.state.errors, errors);
      if (!errors[name]) delete ctx.state.errors[name];
      applyErrors(ctx, ctx.state.errors);
      return !errors[name];
    },

    values(ctx) {
      return { ...ctx.state.values };
    },

    /** Signals, so `disabled: !valid` is one binding (§11.3). */
    state(ctx) {
      return {
        valid: Object.keys(ctx.state.errors).length === 0,
        dirty: ctx.state.dirty(),
        touched: { ...ctx.state.touched },
        errors: { ...ctx.state.errors },
        submitting: ctx.state.submitting,
        submitCount: ctx.state.submitCount
      };
    }
  },

  create(ctx) {
    const el = ctx.dom("form", { class: "mk-form", novalidate: "" }, null);
    Object.assign(ctx.state, {
      values: { ...ctx.props.values },
      initial: { ...ctx.props.values },
      errors: {},
      touched: {},
      sequence: 0,
      submitting: false,
      submitCount: 0,
      schema: normalizeSchema(ctx.props.schema),
      dirty: () => JSON.stringify(ctx.state.values) !== JSON.stringify(ctx.state.initial)
    });

    ctx.own(
      dom.listen(el, "submit", (event) => {
        event.preventDefault();
        ctx.node.definition.commands.submit(ctx);
      })
    );
    return el;
  },

  mount(ctx) {
    // Controls report through the node tree, so a field nested six levels deep
    // needs no wiring of its own.
    ctx.on("input", (event) => onControlInput(ctx, event));
    ctx.on("blur", (event) => onControlBlur(ctx, event));
    syncControls(ctx);

    // The unsaved-changes veto `dismissible` respects (§9), wired by default:
    // closing a dialog over a dirty form prompts without the author arranging it.
    const surface = surfaceAncestor(ctx.node);
    if (surface) {
      ctx.own(
        addNodeListener(surface, "beforeclose", (event) => {
          if (!ctx.state.dirty() || ctx.state.submitting) return;
          if (!ctx.props.confirmDiscard) return;
          event.preventDefault();
          ctx.emit("invalid", { reason: "unsaved" });
        })
      );
    }
  },

  styles: css`
    .mk-form { display: flex; flex-direction: column; gap: var(--mk-space-4); }
  `
};

function addNodeListener(node, name, fn) {
  if (!node._listeners) node._listeners = Object.create(null);
  const bag = node._listeners;
  if (!bag[name]) bag[name] = [];
  const entry = { fn, once: false, order: 0 };
  bag[name].push(entry);
  return () => {
    const index = bag[name].indexOf(entry);
    if (index !== -1) bag[name].splice(index, 1);
  };
}

function surfaceAncestor(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.traits && current.traits.has("dismissible")) return current;
  }
  return null;
}

function nameOf(node) {
  return node.props.name || node.id || null;
}

function onControlInput(ctx, event) {
  const name = nameOf(event.target);
  if (!name) return;
  ctx.state.values[name] = event.detail.value;
  ctx.emit("change", { name, value: event.detail.value, values: { ...ctx.state.values } });

  // Revalidate only what has already errored, which is the whole timing policy
  // in one condition.
  const timing = ctx.props.timing || {};
  if (timing.afterError !== "change") return;
  if (ctx.state.errors[name] === undefined) return;
  ctx.node.definition.commands.validateField(ctx, name);
}

function onControlBlur(ctx, event) {
  const name = nameOf(event.target);
  if (!name) return;
  ctx.state.touched[name] = true;
  const timing = ctx.props.timing || {};
  if (timing.async === "blur" && (ctx.props.validate || {})[name]) {
    ctx.node.definition.commands.validateField(ctx, name);
  }
}

/**
 * Run the schema validators, then the custom ones.
 *
 * Async results are matched by sequence number, so an out-of-order response
 * from a slow uniqueness check cannot overwrite a newer verdict.
 */
async function validateAll(ctx, names) {
  const errors = {};
  const sequence = ++ctx.state.sequence;
  const custom = ctx.props.validate || {};

  for (const name of names) {
    const value = ctx.state.values[name];
    const descriptor = ctx.state.schema[name];
    if (descriptor) {
      const result = validateValue(descriptor, value, name);
      if (result.error) {
        errors[name] = result.error;
        continue;
      }
    }
    if (typeof custom[name] === "function") {
      const message = await custom[name](value, ctx);
      if (sequence !== ctx.state.sequence) return errors; // a newer run won
      if (message) errors[name] = message;
    }
  }

  // Cross-field and form-level validators see every value (`confirmPassword`,
  // date ranges) and may target a field or the summary.
  if (typeof custom.$form === "function") {
    const result = await custom.$form({ ...ctx.state.values }, ctx);
    if (sequence === ctx.state.sequence && result) {
      if (typeof result === "string") errors.$form = result;
      else Object.assign(errors, result);
    }
  }

  ctx.emit("validated", { errors, sequence });
  return errors;
}

/** Push messages down to the `field` wrappers that own the controls. */
function applyErrors(ctx, errors) {
  ctx.node.walk((node) => {
    if (node.type !== "field") return;
    // Excluding the field itself: `find` includes the node it is called on, and
    // a field's own id would otherwise be mistaken for its control's name.
    const control = node.find((child) => child !== node && nameOf(child));
    const name = control ? nameOf(control) : node.props.for || node.id;
    if (!name) return;
    const message = errors[name] || "";
    if (node.props.error !== message) ctx.mk.setProps(node, { error: message });
    if (control) ctx.mk.setProps(control, { invalid: !!message });
  });
}

function focusFirstInvalid(ctx, name) {
  const control = ctx.node.find((node) => nameOf(node) === name);
  if (!control) return;
  const focus = ctx.service("focus");
  if (focus) focus.focus(control);
  else if (control.el) {
    const input = control.el.querySelector("input, select, textarea") || control.el;
    if (input.focus) input.focus();
  }
}

function syncControls(ctx) {
  ctx.node.walk((node) => {
    const name = nameOf(node);
    if (!name || node === ctx.node) return;
    if (ctx.state.values[name] === undefined) ctx.state.values[name] = node.props.value;
    else if (node.props.value !== ctx.state.values[name]) {
      ctx.mk.setProps(node, { value: ctx.state.values[name] });
    }
  });
}

export const FORM_ELEMENTS = [field, form];
