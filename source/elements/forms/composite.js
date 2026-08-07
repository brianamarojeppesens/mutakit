/**
 * Composite controls (§11.3).
 *
 * These exist where the platform has no single element that does the job:
 * a group of radios needs group semantics the individual inputs cannot carry;
 * a combobox has no native equivalent at all; `tags` and `rating` are
 * compositions with their own keyboard models. Each still wraps native inputs
 * underneath wherever one applies — the rule is native *first*, not native
 * *only*.
 */
import "../../core/dev.js";
import * as dom from "../../core/dom.js";
import { css } from "../../styles/index.js";

/**
 * `radio-group` — the group is the control.
 *
 * Native radios give the arrow-key behaviour and the exclusivity; what they
 * cannot give is a labelled group, which is what a screen reader announces
 * before the options.
 */
export const radioGroup = {
  type: "radio-group",
  version: "1.0.0",
  props: {
    value: { type: "string", default: "", persist: true },
    name: { type: "string", default: "" },
    options: { type: "array", default: () => [] },
    label: { type: "string", default: "" },
    disabled: { type: "boolean", default: false },
    invalid: { type: "boolean", default: false },
    orientation: { type: "enum", values: ["vertical", "horizontal"], default: "vertical" }
  },
  events: ["input", "change"],
  a11y: {
    role: "radiogroup",
    props: {
      "aria-label": (ctx) => ctx.props.label || null,
      "aria-invalid": (ctx) => (ctx.props.invalid ? "true" : null),
      "aria-orientation": (ctx) => ctx.props.orientation
    }
  },
  geometry: { defaults: { size: { w: "100%", h: "auto" } } },

  create(ctx) {
    const el = ctx.dom("div", { class: `mk-radio-group mk-radio-group--${ctx.props.orientation}` }, null);
    const name = ctx.props.name || `mk-radio-${Math.random().toString(36).slice(2, 8)}`;
    ctx.state.inputs = [];

    for (const option of ctx.props.options) {
      const value = typeof option === "string" ? option : option.value;
      const text = typeof option === "string" ? option : option.label;
      const label = dom.el("label", { class: "mk-radio" }, el);
      const input = dom.el("input", {
        type: "radio",
        name,
        value,
        class: "mk-control mk-control--radio",
        disabled: ctx.props.disabled || option.disabled || null
      }, label);
      label.appendChild(dom.el("span", { text }));
      input.checked = ctx.props.value === value;
      ctx.state.inputs.push(input);
      ctx.own(
        dom.listen(input, "change", () => {
          ctx.node.props.value = value;
          ctx.mk.persistDirty = true;
          ctx.emit("input", { value });
          ctx.emit("change", { value });
        })
      );
    }
    return el;
  },

  update(ctx, changed) {
    if (changed.has("value")) {
      for (const input of ctx.state.inputs) input.checked = input.value === ctx.props.value;
    }
    if (changed.has("disabled")) {
      for (const input of ctx.state.inputs) input.disabled = !!ctx.props.disabled;
    }
  },

  styles: css`
    .mk-radio-group { display: flex; gap: var(--mk-space-2); }
    .mk-radio-group--vertical { flex-direction: column; }
    .mk-radio { display: flex; align-items: center; gap: var(--mk-space-2); min-height: var(--mk-target-min); }
  `
};

/**
 * `combobox` — a text input with a filtered listbox.
 *
 * The one control with no native equivalent worth wrapping: `<datalist>` is
 * inconsistent across engines and unstyleable. The ARIA combobox pattern is
 * implemented here in full, because a half-implemented one is worse than a
 * plain text field.
 */
export const combobox = {
  type: "combobox",
  version: "1.0.0",
  props: {
    value: { type: "string", default: "", persist: true },
    name: { type: "string", default: "" },
    options: { type: "array", default: () => [] },
    placeholder: { type: "string", default: "" },
    disabled: { type: "boolean", default: false },
    invalid: { type: "boolean", default: false },
    allowCustom: { type: "boolean", default: false },
    filter: { type: "function" }
  },
  events: ["input", "change", "open", "close"],
  traits: ["focusable"],
  geometry: { defaults: { size: { w: "100%", h: "auto" } } },
  a11y: { props: { "aria-invalid": (ctx) => (ctx.props.invalid ? "true" : null) } },

  commands: {
    open(ctx) {
      setOpen(ctx, true);
    },
    close(ctx) {
      setOpen(ctx, false);
    }
  },

  create(ctx) {
    const id = ctx.node.id || `mk-combo-${Math.random().toString(36).slice(2, 8)}`;
    const el = ctx.dom("div", { class: "mk-combobox" }, null);

    const input = dom.el("input", {
      type: "text",
      class: "mk-control mk-control--combobox",
      role: "combobox",
      id: `${id}-input`,
      "aria-expanded": "false",
      "aria-controls": `${id}-list`,
      "aria-autocomplete": "list",
      autocomplete: "off",
      placeholder: ctx.props.placeholder
    }, el);
    const list = dom.el("ul", { class: "mk-combobox__list", id: `${id}-list`, role: "listbox", hidden: "" }, el);

    Object.assign(ctx.state, { id, input, list, open: false, active: -1, matches: [] });
    input.value = ctx.props.value || "";

    ctx.own(dom.listen(input, "input", () => {
      ctx.node.props.value = input.value;
      renderOptions(ctx);
      setOpen(ctx, true);
      ctx.emit("input", { value: input.value });
    }));
    ctx.own(dom.listen(input, "focus", () => renderOptions(ctx)));
    ctx.own(dom.listen(input, "blur", () => dom.timer(() => setOpen(ctx, false), 120)));
    ctx.own(dom.listen(input, "keydown", (event) => onKey(ctx, event)));
    return el;
  },

  update(ctx, changed) {
    if (changed.has("value") && ctx.state.input.value !== ctx.props.value) {
      ctx.state.input.value = ctx.props.value == null ? "" : String(ctx.props.value);
    }
    if (changed.has("options")) renderOptions(ctx);
  },

  styles: css`
    .mk-combobox { position: relative; width: 100%; }
    .mk-combobox__list {
      position: absolute;
      z-index: 1;
      left: 0;
      right: 0;
      margin: 2px 0 0;
      padding: 4px;
      list-style: none;
      max-height: 240px;
      overflow: auto;
      background: var(--mk-color-surface-raised);
      border: 1px solid var(--mk-border-subtle);
      border-radius: var(--mk-radius-sm);
      box-shadow: var(--mk-elevation-2);
    }
    .mk-combobox__option {
      padding: 5px 8px;
      min-height: var(--mk-target-min);
      border-radius: var(--mk-radius-sm);
      cursor: pointer;
    }
    .mk-combobox__option[aria-selected="true"] { background: var(--mk-color-surface-sunken); }
  `
};

function optionValue(option) {
  return typeof option === "string" ? option : option.value;
}

function optionLabel(option) {
  return typeof option === "string" ? option : option.label;
}

function renderOptions(ctx) {
  const query = String(ctx.state.input.value || "").toLowerCase();
  const filter = ctx.props.filter || ((option) => optionLabel(option).toLowerCase().includes(query));
  ctx.state.matches = (ctx.props.options || []).filter(filter);
  ctx.state.list.textContent = "";
  ctx.state.active = -1;

  ctx.state.matches.forEach((option, index) => {
    const item = dom.el("li", {
      class: "mk-combobox__option",
      role: "option",
      id: `${ctx.state.id}-o${index}`,
      "aria-selected": "false",
      text: optionLabel(option)
    }, ctx.state.list);
    // `mousedown`, not `click`: the input's `blur` would close the list first.
    ctx.own(dom.listen(item, "mousedown", (event) => {
      event.preventDefault();
      choose(ctx, index);
    }));
  });
}

function setOpen(ctx, open) {
  if (ctx.state.open === open) return;
  ctx.state.open = open;
  ctx.state.list.hidden = !open;
  ctx.state.input.setAttribute("aria-expanded", String(open));
  ctx.setState("open", open);
  ctx.emit(open ? "open" : "close", {});
}

function highlight(ctx, index) {
  const items = [...ctx.state.list.children];
  if (!items.length) return;
  const next = (index + items.length) % items.length;
  items.forEach((item, i) => item.setAttribute("aria-selected", String(i === next)));
  ctx.state.active = next;
  // `aria-activedescendant`, not focus: the input keeps focus so typing works.
  ctx.state.input.setAttribute("aria-activedescendant", items[next].id);
  items[next].scrollIntoView({ block: "nearest" });
}

function choose(ctx, index) {
  const option = ctx.state.matches[index];
  if (!option) return;
  const value = optionValue(option);
  ctx.state.input.value = optionLabel(option);
  ctx.node.props.value = value;
  setOpen(ctx, false);
  ctx.emit("input", { value });
  ctx.emit("change", { value });
}

function onKey(ctx, event) {
  if (event.key === "ArrowDown") {
    if (!ctx.state.open) {
      renderOptions(ctx);
      setOpen(ctx, true);
    }
    highlight(ctx, ctx.state.active + 1);
  } else if (event.key === "ArrowUp") {
    highlight(ctx, ctx.state.active - 1);
  } else if (event.key === "Enter") {
    if (ctx.state.active >= 0) choose(ctx, ctx.state.active);
    else if (!ctx.props.allowCustom) return;
  } else if (event.key === "Escape") {
    if (!ctx.state.open) return;
    setOpen(ctx, false);
  } else {
    return;
  }
  event.preventDefault();
}

/** `segmented` — a radio group that looks like a button bar. */
export const segmented = {
  type: "segmented",
  version: "1.0.0",
  props: {
    value: { type: "string", default: "", persist: true },
    options: { type: "array", default: () => [] },
    label: { type: "string", default: "" },
    disabled: { type: "boolean", default: false }
  },
  events: ["input", "change"],
  a11y: { role: "radiogroup", props: { "aria-label": (ctx) => ctx.props.label || null } },
  geometry: { defaults: { size: { w: "auto", h: "auto" } } },

  create(ctx) {
    const el = ctx.dom("div", { class: "mk-segmented" }, null);
    ctx.state.buttons = [];
    ctx.props.options.forEach((option) => {
      const value = optionValue(option);
      const button = dom.el("button", {
        type: "button",
        role: "radio",
        class: "mk-segmented__item",
        "aria-checked": String(ctx.props.value === value),
        text: optionLabel(option),
        tabindex: ctx.props.value === value ? "0" : "-1"
      }, el);
      ctx.state.buttons.push({ button, value });
      ctx.own(dom.listen(button, "click", () => {
        ctx.handle.set({ value });
        ctx.emit("input", { value });
        ctx.emit("change", { value });
      }));
    });
    ctx.own(dom.listen(el, "keydown", (event) => onSegmentedKey(ctx, event)));
    return el;
  },

  update(ctx, changed) {
    if (!changed.has("value")) return;
    for (const entry of ctx.state.buttons) {
      const on = entry.value === ctx.props.value;
      entry.button.setAttribute("aria-checked", String(on));
      entry.button.setAttribute("tabindex", on ? "0" : "-1");
    }
  },

  styles: css`
    .mk-segmented {
      display: inline-flex;
      border: 1px solid var(--mk-border-strong);
      border-radius: var(--mk-radius-sm);
      overflow: hidden;
    }
    .mk-segmented__item {
      padding: 5px 12px;
      min-height: var(--mk-target-min);
      border: 0;
      border-left: 1px solid var(--mk-border-subtle);
      background: var(--mk-color-surface-raised);
      cursor: pointer;
    }
    .mk-segmented__item:first-child { border-left: 0; }
    .mk-segmented__item[aria-checked="true"] {
      background: var(--mk-color-accent);
      color: #fff;
    }
  `
};

function onSegmentedKey(ctx, event) {
  const entries = ctx.state.buttons;
  const index = entries.findIndex((entry) => entry.value === ctx.props.value);
  let next = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index + 1;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index - 1;
  else return;
  event.preventDefault();
  const entry = entries[(next + entries.length) % entries.length];
  ctx.handle.set({ value: entry.value });
  entry.button.focus();
  ctx.emit("change", { value: entry.value });
}

/** `tags` — a token list with an input. No native equivalent. */
export const tags = {
  type: "tags",
  version: "1.0.0",
  props: {
    value: { type: "array", of: "string", default: () => [], persist: true },
    placeholder: { type: "string", default: "" },
    max: { type: "number" },
    disabled: { type: "boolean", default: false },
    invalid: { type: "boolean", default: false }
  },
  events: ["input", "change", "add", "remove"],
  a11y: { role: "group", props: { "aria-label": (ctx) => ctx.props.label || "Tags" } },
  geometry: { defaults: { size: { w: "100%", h: "auto" } } },

  commands: {
    add(ctx, text) {
      const value = String(text || "").trim();
      if (!value || ctx.props.value.includes(value)) return false;
      if (ctx.props.max != null && ctx.props.value.length >= ctx.props.max) return false;
      const next = [...ctx.props.value, value];
      ctx.handle.set({ value: next });
      ctx.emit("add", { tag: value });
      ctx.emit("input", { value: next });
      return true;
    },
    remove(ctx, tag) {
      const next = ctx.props.value.filter((item) => item !== tag);
      ctx.handle.set({ value: next });
      ctx.emit("remove", { tag });
      ctx.emit("input", { value: next });
    }
  },

  create(ctx) {
    const el = ctx.dom("div", { class: "mk-tags" }, null);
    const list = dom.el("ul", { class: "mk-tags__list", role: "list" }, el);
    const input = dom.el("input", {
      type: "text",
      class: "mk-control mk-control--tags",
      placeholder: ctx.props.placeholder
    }, el);
    Object.assign(ctx.state, { list, input });

    ctx.own(dom.listen(input, "keydown", (event) => {
      if (event.key === "Enter" || event.key === ",") {
        event.preventDefault();
        if (ctx.node.definition.commands.add(ctx, input.value)) input.value = "";
      } else if (event.key === "Backspace" && !input.value && ctx.props.value.length) {
        // Backspace on an empty input removes the last token — the behaviour
        // every tag field has, and the only keyboard path to removal.
        ctx.node.definition.commands.remove(ctx, ctx.props.value[ctx.props.value.length - 1]);
      }
    }));
    renderTags(ctx);
    return el;
  },

  update(ctx, changed) {
    if (changed.has("value")) renderTags(ctx);
  },

  styles: css`
    .mk-tags {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      padding: 4px;
      border: 1px solid var(--mk-border-strong);
      border-radius: var(--mk-radius-sm);
      background: var(--mk-color-surface-raised);
    }
    .mk-tags__list { display: contents; margin: 0; padding: 0; list-style: none; }
    .mk-tags__tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      background: var(--mk-color-surface-sunken);
      border-radius: var(--mk-radius-sm);
      font-size: var(--mk-text-sm);
    }
    .mk-tags__remove {
      border: 0;
      background: none;
      cursor: pointer;
      min-width: var(--mk-target-min);
      min-height: var(--mk-target-min);
    }
    .mk-tags .mk-control { border: 0; flex: 1 1 80px; min-width: 80px; }
  `
};

function renderTags(ctx) {
  ctx.state.list.textContent = "";
  for (const tag of ctx.props.value) {
    const item = dom.el("li", { class: "mk-tags__tag", text: tag }, ctx.state.list);
    const remove = dom.el("button", {
      type: "button",
      class: "mk-tags__remove",
      "aria-label": `Remove ${tag}`,
      text: "×"
    }, item);
    ctx.own(dom.listen(remove, "click", () => ctx.node.definition.commands.remove(ctx, tag)));
  }
}

export const COMPOSITE_CONTROLS = [radioGroup, combobox, segmented, tags];
