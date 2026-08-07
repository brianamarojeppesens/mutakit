/**
 * The accessibility gate (§23.6).
 *
 * Renders every registered element type in several states — open, focused,
 * invalid, disabled, collapsed — and runs axe-core from a vendored copy.
 * Violations fail the run.
 *
 * Two things this deliberately does *not* do. It does not audit `hud-*` types
 * for missing roles: they declare `a11y: 'presentation'`, which is the correct
 * answer for decoration and an explicit exception (§11.5). And it does not
 * replace the manual screen-reader checklist in §14 — automated tools catch
 * name/role/value problems and almost nothing about whether the result makes
 * sense to listen to.
 */
import { Mutakit } from "../source/entries/full.js";

const scratch = document.getElementById("scratch");
const results = document.getElementById("results");
const summary = document.getElementById("summary");

/** One case per interesting state, not one per type. */
const CASES = [
  ["pane", { label: "A region", size: { w: 200, h: 60 } }],
  ["surface", { label: "A surface", size: { w: 200, h: 60 } }],
  ["stack", { axis: "x", size: { w: 300, h: 40 } }],
  ["split", { axis: "x", size: { w: 400, h: 120 } }],
  ["tabs", { id: "a11y-tabs", items: [{ id: "t1", label: "One" }, { id: "t2", label: "Two" }], active: "t1", closable: true }],
  ["accordion", { sections: [{ id: "s1", label: "Section one" }], open: ["s1"] }],
  // `backdrop: false` throughout: three overlapping scrims make axe measure
  // every title against a stack of them, which is a property of rendering the
  // whole catalog on one page rather than of any element.
  ["modal", { id: "a11y-modal", title: "A dialog", size: { w: 300, h: 160 }, backdrop: false }],
  ["dialog", { id: "a11y-dialog", title: "Confirm", description: "Are you sure?", backdrop: false,
               actions: [{ label: "Cancel", command: "cancel" }, { label: "OK", command: "submit", variant: "primary" }] }],
  ["alert", { id: "a11y-alert", title: "Delete file?", description: "This cannot be undone.", backdrop: false,
              actions: [{ label: "Delete", command: "submit", variant: "danger" }] }],
  ["popover", { id: "a11y-pop", label: "Details", reference: { x: 40, y: 40, w: 10, h: 10 } }],
  ["tooltip", { id: "a11y-tip", text: "A hint", reference: { x: 40, y: 80, w: 10, h: 10 } }],
  ["menu", { id: "a11y-menu", reference: { x: 40, y: 120, w: 10, h: 10 },
             items: [{ label: "Cut" }, { separator: true }, { label: "Paste", disabled: true }] }],
  ["toast", { id: "a11y-toast", text: "Saved", ttl: 0 }],
  ["banner", { text: "Heads up", dismissible: true }],
  ["window", { id: "a11y-window", title: "A window", size: { w: 240, h: 140 } }],
  ["field", { id: "a11y-field-ok", label: "Email", description: "We never share it." }],
  ["field", { id: "a11y-field-bad", label: "Port", error: "Must be 1–65535", required: true }],
  ["form", { id: "a11y-form", label: "Settings", values: {}, schema: {} }],
  ["radio-group", { id: "a11y-radio", label: "Density", options: ["compact", "cosy"], value: "cosy" }],
  ["combobox", { id: "a11y-combo", label: "Search commands", options: ["Alpha", "Beta"] }],
  ["segmented", { id: "a11y-seg", label: "Align", options: ["left", "right"], value: "left" }],
  ["tags", { id: "a11y-tags", value: ["one", "two"] }],
  ["resizer", { axis: "x", index: 0 }],
  ["hud-layer", { id: "a11y-hud" }],
  ["hud-bar", { id: "a11y-bar", value: 0.5, label: "Health" }],
  ["crosshair", {}],
  ["minimap", {}],
  ["key-prompt", { action: "Interact", keyboard: "E" }],
  ["notification-feed", { id: "a11y-feed" }],
  ["drawer", { id: "a11y-drawer", edge: "end", size: 200, title: "A drawer", backdrop: false }],
  ["scroll", { id: "a11y-scroll", label: "Scrollable", size: { w: 200, h: 60 } }],
  ["hud-marker", { id: "a11y-marker", label: "Objective", project: () => ({ x: 10, y: 10 }) }],
  ["text-block", { content: "A paragraph.", variant: "body" }],
  ["icon", { name: "star", label: "Favourite" }],
  ["divider", {}],
  ["progress", { id: "a11y-progress", value: 0.4, label: "Uploading" }],
  ["progress", { id: "a11y-progress-2", indeterminate: true, label: "Working" }],
  ["meter", { id: "a11y-meter", value: 30, min: 0, max: 100, low: 20, label: "Disk" }],
  ["spinner", { label: "Loading results" }],
  ["empty-state", { id: "a11y-empty", title: "Nothing here", description: "Add an item to begin.",
                    action: { label: "Add" } }],
  ["list", { id: "a11y-list", label: "Files", items: ["one", "two", "three"], selection: "multiple" }],
  ["tree", { id: "a11y-tree", label: "Explorer",
             data: [{ id: "src", label: "src", children: [{ id: "a", label: "a.js" }] }],
             expanded: ["src"], selected: "src" }]
];

/** Controls need a label, and a label needs a field — so pair them. */
const CONTROLS = [
  ["text", { name: "a11y-text", label: "Name" }],
  ["password", { name: "a11y-pass", label: "Password" }],
  ["search", { name: "a11y-search", label: "Search" }],
  ["email", { name: "a11y-email", label: "Email" }],
  ["textarea", { name: "a11y-area", label: "Notes" }],
  ["number", { name: "a11y-num", label: "Port", value: 8080 }],
  ["checkbox", { name: "a11y-check", label: "Enabled" }],
  ["switch", { name: "a11y-switch", label: "Dark mode" }],
  ["slider", { name: "a11y-slider", label: "Volume", value: 50 }],
  ["color", { name: "a11y-color", label: "Accent" }],
  ["date", { name: "a11y-date", label: "Start" }],
  ["time", { name: "a11y-time", label: "At" }],
  ["file", { name: "a11y-file", label: "Upload" }],
  ["select", { name: "a11y-select", label: "Theme", options: ["light", "dark"] }],
  ["button", { text: "Save", variant: "primary" }],
  ["toggle", { text: "Pin", pressed: true }],
  ["spacer", {}],
  ["group", {}]
];

const host = document.createElement("div");
host.style.cssText = "position:relative;width:900px;min-height:2400px";
scratch.appendChild(host);

const mk = Mutakit.create();
const app = mk.mount(host, { sizing: "fixed", size: { w: 900, h: 2400 } });
const rendered = [];

// Laid out down the page rather than stacked at one point. Overlapping
// surfaces make axe compute colour contrast against whatever happens to be
// behind — a property of the audit page, not of the library, and one that
// buries the real findings under sixteen false ones.
let row = 0;
const nextSlot = () => ({ at: "top-left", inset: { left: 16, top: 16 + row++ * 70 } });

for (const [type, props] of CASES) {
  try {
    const handle = app.create(type, { ...nextSlot(), ...props });
    if (handle) rendered.push(type);
  } catch (error) {
    report(type, [`could not render: ${error.message}`]);
  }
}

// Every control inside a labelled field, which is how they are meant to be used
// and the only shape in which "does it have an accessible name" is a fair test.
for (const [type, props] of CONTROLS) {
  const field = app.create("field", { id: `f-${type}`, label: props.label || type, ...nextSlot() });
  const handle = field.create(type, props);
  if (handle) rendered.push(type);
}

mk.tick();

const missing = Mutakit.registry
  .list()
  .type.map((entry) => entry.name)
  .filter((name) => !rendered.includes(name) && !name.includes(":"));

let extraFailures = 0;

const options = {
  // The library's own surface, not the harness chrome around it.
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }
};

/**
 * Every ARIA relationship must point at an element that exists.
 *
 * axe does not flag an orphaned `<label for>` or a dangling
 * `aria-describedby` — the rules that would are scoped to the referencing
 * element's role, so a reference into nothing passes. It is still broken:
 * clicking such a label does nothing and a screen reader announces a
 * relationship the DOM cannot honour. This found five of them.
 */
const IDREF_ATTRIBUTES = [
  "for", "aria-labelledby", "aria-describedby", "aria-controls",
  "aria-owns", "aria-activedescendant", "aria-errormessage", "aria-details"
];

function danglingReferences(root) {
  const bad = [];
  for (const attribute of IDREF_ATTRIBUTES) {
    for (const el of root.querySelectorAll(`[${attribute}]`)) {
      const value = el.getAttribute(attribute).trim();
      if (!value) {
        bad.push(`${el.tagName.toLowerCase()}.${el.className.split(" ")[0]} has an empty ${attribute}`);
        continue;
      }
      for (const id of value.split(/\s+/)) {
        if (document.getElementById(id)) continue;
        bad.push(`${el.tagName.toLowerCase()}.${el.className.split(" ")[0]} ${attribute} → #${id}, which does not exist`);
      }
    }
  }
  return bad;
}

window.axe
  .run(host, options)
  .then((axeResults) => {
    const dangling = danglingReferences(host);
    if (dangling.length) report("dangling ARIA reference", dangling.slice(0, 6));
    extraFailures = dangling.length ? 1 : 0;
    for (const violation of axeResults.violations) {
      report(
        `${violation.id} (${violation.impact})`,
        violation.nodes.slice(0, 4).map((node) => `${node.target.join(" ")} — ${node.failureSummary.split("\n")[1] || ""}`)
      );
    }
    if (missing.length) {
      report("coverage", [`types not rendered by this page: ${missing.join(", ")}`]);
    }
    finish(axeResults);
  })
  .catch((error) => {
    report("axe-core", [String(error)]);
    finish({ violations: [{ id: "axe-failed" }], passes: [] });
  });

function report(name, details) {
  const item = document.createElement("li");
  item.className = "fail";
  const label = document.createElement("span");
  label.className = "name";
  label.textContent = name;
  item.appendChild(label);
  for (const detail of details) {
    const why = document.createElement("span");
    why.className = "why";
    why.textContent = detail;
    item.appendChild(why);
  }
  results.appendChild(item);
}

function finish(axeResults) {
  const failed = axeResults.violations.length + (missing.length ? 1 : 0) + extraFailures;
  summary.textContent = `${rendered.length} types · ${axeResults.passes.length} checks passed · ${failed} violation(s)`;
  summary.className = `summary ${failed ? "fail" : "pass"}`;
  if (!failed) {
    const item = document.createElement("li");
    item.className = "pass";
    item.innerHTML = "<span class='name'>no violations</span>";
    results.appendChild(item);
  }
  document.documentElement.setAttribute("data-harness", failed ? "fail" : "pass");

  // `results` used to be the violations and nothing else, which made a clean
  // sweep indistinguishable from a sweep that never ran: both are the empty
  // array, and a driver reading it reports "no failures" for both. Worse, two
  // of the three things counted in `failed` — an unrendered type and a dangling
  // ARIA reference — produced no entry at all, so the page could set
  // data-harness="fail" while the TAP stream said everything passed.
  //
  // The structural checks are therefore always reported, pass or fail, and the
  // sweep reports itself. Silence is no longer a result.
  const checks = [
    {
      name: `axe sweep ran (${rendered.length} types, ${axeResults.passes.length} checks)`,
      passed: rendered.length > 0 && axeResults.passes.length > 0,
      skipped: false,
      error: "the sweep produced no passing checks, so it did not run"
    },
    {
      name: "every catalogued type is rendered by this page",
      passed: missing.length === 0,
      skipped: false,
      error: missing.length ? `not rendered: ${missing.join(", ")}` : null
    },
    {
      name: "no dangling ARIA references",
      passed: extraFailures === 0,
      skipped: false,
      error: extraFailures ? "an aria-* attribute points at an id that is not in the document" : null
    }
  ];

  window.harness = {
    done: true,
    results: [
      ...checks,
      ...axeResults.violations.map((v) => ({
        name: `${v.id} (${v.impact})`,
        passed: false,
        skipped: false,
        error: v.help,
        nodes: v.nodes.length
      }))
    ],
    summary: { passed: axeResults.passes.length, failed, skipped: 0, rendered, missing }
  };
}
