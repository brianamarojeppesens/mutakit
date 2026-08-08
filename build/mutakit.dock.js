/*! Mutakit 1.0.1 — core + splits + persistence · MIT · https://mutakit.dev */
"use strict";
var Mutakit = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // source/entries/dock.js
  var dock_exports = {};
  __export(dock_exports, {
    Mutakit: () => Mutakit,
    default: () => dock_default,
    installSplits: () => installSplits,
    persistencePlugin: () => persistencePlugin,
    splitsPlugin: () => splitsPlugin,
    storePlugin: () => storePlugin
  });

  // source/core/env.js
  var VERSION = "1.0.1";
  var SCHEMA_VERSION = 1;

  // source/core/conformance.js
  var POINTER_TRAIT_HINT = "every pointer interaction needs a documented keyboard equivalent (P5, \xA713.4)";
  function finding(level, code, message) {
    return { level, code, message };
  }
  function conformance(definition, resolved) {
    if (false) return [];
    const findings = [];
    if (!definition || typeof definition !== "object") {
      return [finding("error", "MK3002", "not a definition object")];
    }
    const type = definition.type || "(unnamed)";
    const merged = resolved || definition;
    if (merged.a11y === void 0 && !merged.abstract) {
      findings.push(
        finding(
          "error",
          "MK3006",
          `'${type}' declares no a11y semantics. Declare a role, or opt out explicitly with a11y: 'presentation'.`
        )
      );
    }
    const declared = new Set(merged.events || []);
    const emitted = collectEmitted(definition);
    for (const name of emitted) {
      if (!declared.has(name)) {
        findings.push(
          finding("error", "MK3003", `'${type}' emits '${name}' but does not declare it in \`events\`.`)
        );
      }
    }
    const body2 = sourceOf(definition);
    if (/addEventListener\s*\(/.test(body2) && !/ctx\.own\s*\(/.test(body2)) {
      findings.push(
        finding(
          "error",
          "MK3007",
          `'${type}' attaches a DOM listener without ctx.own(); it will fail the leak test (\xA723.5). Use ctx.on / ctx.dom / ctx.own so teardown is automatic.`
        )
      );
    }
    if (/setInterval\s*\(|setTimeout\s*\(/.test(body2) && !/ctx\.own\s*\(/.test(body2)) {
      findings.push(
        finding("warn", "MK3007", `'${type}' starts a timer that is not registered with ctx.own().`)
      );
    }
    const pointerTraits = ["draggable", "resizable", "sortable", "selectable"];
    const usesPointerTrait = (merged.traits || []).some((t) => pointerTraits.includes(t));
    const bindsPointer = /["'`](pointerdown|pointermove|mousedown|dblclick|contextmenu)["'`]/.test(body2);
    if ((usesPointerTrait || bindsPointer) && !hasKeys(merged)) {
      const how = usesPointerTrait ? "composes a pointer trait" : "binds pointer events";
      findings.push(
        finding("error", "MK6001", `'${type}' ${how} but declares no \`keys\`; ${POINTER_TRAIT_HINT}.`)
      );
    }
    for (const name of Object.keys(merged.commands || {})) {
      if (typeof merged.commands[name] !== "function") {
        findings.push(finding("error", "MK3002", `command '${name}' on '${type}' is not a function.`));
      }
    }
    for (const name of Object.keys(merged.slots || {})) {
      const slot = merged.slots[name];
      if (slot && slot.max != null && (typeof slot.max !== "number" || slot.max < 1)) {
        findings.push(finding("error", "MK3002", `slot '${name}' on '${type}' has an invalid \`max\`.`));
      }
    }
    if (merged.motion) {
      for (const phase of ["enter", "exit"]) {
        const animates = merged.motion[phase] && merged.motion[phase] !== "none";
        if (!animates) continue;
        if (merged.motion.reduced === void 0) {
          findings.push(
            finding(
              "warn",
              "MK5004",
              `'${type}' declares motion.${phase} but no \`reduced\` variant; reduced-motion users will get the full animation.`
            )
          );
          break;
        }
        if (merged.motion.reduced === "none" || merged.motion.reduced === null) {
          findings.push(
            finding(
              "warn",
              "MK5004",
              `'${type}' animates on ${phase} but its \`reduced\` variant is 'none'; \xA717 asks for a shorter animation, not for none \u2014 an instantaneous change can be more disorienting than a 100ms fade.`
            )
          );
          break;
        }
      }
    }
    if (merged.origin && merged.origin !== "core" && type.indexOf(":") === -1) {
      findings.push(
        finding(
          "error",
          "MK4004",
          `'${type}' is a bare name registered from '${merged.origin}'. Bare names are reserved for core; use 'vendor:${type}'.`
        )
      );
    }
    return findings;
  }
  function hasKeys(merged) {
    return !!merged.keys && Object.keys(merged.keys).length > 0;
  }
  function sourceOf(definition) {
    let text = "";
    for (const key of Object.keys(definition)) {
      const value = definition[key];
      if (typeof value === "function") text += Function.prototype.toString.call(value) + "\n";
      else if (value && typeof value === "object") {
        for (const inner of Object.keys(value)) {
          if (typeof value[inner] === "function") {
            text += Function.prototype.toString.call(value[inner]) + "\n";
          }
        }
      }
    }
    return text;
  }
  function collectEmitted(definition) {
    const names = /* @__PURE__ */ new Set();
    const text = sourceOf(definition);
    const pattern = /\.emit\(\s*["'`]([^"'`]+)["'`]/g;
    let match;
    while (match = pattern.exec(text)) names.add(match[1]);
    return names;
  }
  function conformanceTrait(trait) {
    if (false) return [];
    const findings = [];
    if (!trait || !trait.name) return [finding("error", "MK3002", "a trait needs a `name`")];
    const declared = new Set(trait.events || []);
    for (const name of collectEmitted(trait)) {
      if (!declared.has(name)) {
        findings.push(
          finding("error", "MK3003", `trait '${trait.name}' emits '${name}' without declaring it.`)
        );
      }
    }
    if (/pointerdown|pointermove/.test(sourceOf(trait)) && !hasKeys(trait)) {
      findings.push(
        finding("error", "MK6001", `trait '${trait.name}' handles pointers but declares no \`keys\`; ${POINTER_TRAIT_HINT}.`)
      );
    }
    const traitBody = sourceOf(trait);
    const creates = /ctx\.dom\s*\(|listen\s*\(|setInterval\s*\(|setTimeout\s*\(|observe[A-Z]/.test(traitBody);
    if (!trait.detach && trait.attach && creates && !/ctx\.own\s*\(/.test(traitBody)) {
      findings.push(
        finding(
          "warn",
          "MK3007",
          `trait '${trait.name}' has \`attach\` but neither \`detach\` nor any ctx.own() registration; whatever it creates will leak.`
        )
      );
    }
    return findings;
  }

  // source/core/diagnostics.js
  var CATALOGUE = true ? {
    // ── 1xxx geometry ──────────────────────────────────────────────────────
    MK1001: "Mount target measured zero on an axis",
    MK1002: "Unparseable length",
    MK1003: "Axis is over-constrained; a constraint was dropped",
    MK1004: "Percentage resolves against a container sized by its own content",
    MK1005: "Unknown length unit",
    MK1007: "Layout geometry read under a rotated or skewed ancestor",
    MK1008: "Anchor keyword not recognised",
    // ── 2xxx layout ────────────────────────────────────────────────────────
    MK2001: "Unknown layout algorithm",
    MK2002: "Layout algorithm rejected a child",
    MK2011: "Self-positioning child inside a flow-owning algorithm",
    MK2012: "Unknown key in a child's `layout` bag",
    MK2013: "Split pane minimums exceed the container",
    MK2014: "No such region",
    // ── 3xxx contract ──────────────────────────────────────────────────────
    MK3001: "Unknown element type",
    MK3002: "Element definition is invalid",
    MK3003: "Undeclared event emitted",
    MK3004: "Prop is not declared in the type's schema",
    MK3005: "Prop value failed validation",
    MK3006: "Element type declares no accessibility semantics",
    MK3007: "Lifecycle hook threw; the node is isolated",
    MK3008: "Unknown trait",
    MK3009: "Trait dependency missing",
    MK3010: "Trait conflict",
    MK3011: "Declarative command did not resolve",
    MK3012: "Slot is not declared by the element type",
    MK3013: "Slot cardinality exceeded",
    MK3014: "html-prefixed prop used with no sanitizer configured",
    MK3015: "Reading resolved geometry during the WRITE phase",
    MK3017: "Content value is of an unsupported form",
    // ── 4xxx plugin ────────────────────────────────────────────────────────
    MK4001: "Type re-registered without `replace: true`",
    MK4002: "Plugin requirement not satisfied",
    MK4003: "Plugin dependency cycle",
    MK4004: "Bare type name registered from a plugin",
    MK4005: "Duplicate element id",
    MK4006: "Plugin install threw",
    MK4010: "Restored element type is not registered",
    MK4011: "Restored trait is not registered",
    MK4012: "Restored layout algorithm is not registered",
    MK4013: "Restored custom unit is not registered",
    MK4014: "Type deregistered while instances are live",
    MK4015: "Restore rejected a type or prop not in `allow`",
    MK4016: "Persisted layout could not be read or written",
    // ── 5xxx performance ───────────────────────────────────────────────────
    MK5001: "Frame budget exceeded",
    MK5003: "STATE phase did not settle",
    MK5006: "Development-only affordance used in a production build",
    MK5004: "Animating a layout-affecting property",
    // ── 6xxx accessibility ─────────────────────────────────────────────────
    MK6001: "Pointer interaction has no keyboard equivalent",
    MK6004: "Shortcut is already bound in this scope",
    MK6003: "Live-region announcement was rate limited"
  } : {};
  var DOC_BASE = "https://mutakit.dev/docs/diagnostics#";
  var sink = null;
  var seen = /* @__PURE__ */ new Set();
  function setDiagnosticSink(fn) {
    sink = fn;
  }
  function resetDiagnostics() {
    seen.clear();
  }
  function describe(code, message, subject) {
    const summary = CATALOGUE[code] || "Unknown diagnostic";
    const where = subject == null ? "" : ` [${subject}]`;
    return `${code}${where} ${message || summary}
  \u2192 ${DOC_BASE}${code.toLowerCase()}`;
  }
  function deliver(level, code, message, detail) {
    const record = { level, code, message, detail, summary: CATALOGUE[code] };
    if (sink) sink(record);
    if (!sink || sink.passthrough) {
      const line = describe(code, message, detail && detail.subject);
      if (level === "error") console.error(line, detail || "");
      else console.warn(line, detail || "");
    }
    return record;
  }
  function warn(code, message, detail) {
    const key = code + "\0" + (detail && detail.subject || "");
    if (seen.has(key)) return null;
    seen.add(key);
    return deliver("warn", code, message, detail);
  }
  function fail(code, message, detail) {
    if (true) {
      const error = new Error(describe(code, message, detail && detail.subject));
      error.code = code;
      error.detail = detail;
      if (sink) sink({ level: "error", code, message, detail, error });
      throw error;
    }
    return deliver("error", code, message, detail);
  }
  function diagnosticError(code, message, detail) {
    const error = new Error(describe(code, message, detail && detail.subject));
    error.code = code;
    error.detail = detail;
    return error;
  }

  // source/core/schema.js
  var VALIDATORS = /* @__PURE__ */ Object.create(null);
  function defineValidator(name, check) {
    VALIDATORS[name] = check;
  }
  function hasValidator(name) {
    return name in VALIDATORS;
  }
  function ok(value) {
    return { value };
  }
  function bad(error) {
    return { error };
  }
  defineValidator("any", (v) => ok(v));
  defineValidator(
    "string",
    (v) => typeof v === "string" ? ok(v) : v == null ? ok("") : ok(String(v))
  );
  defineValidator("number", (v, desc) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    if (!isFinite(n)) return bad(`expected a number, got ${describe2(v)}`);
    if (desc.integer && !Number.isInteger(n)) return bad(`expected an integer, got ${n}`);
    if (desc.min != null && n < desc.min) return bad(`must be >= ${desc.min}, got ${n}`);
    if (desc.max != null && n > desc.max) return bad(`must be <= ${desc.max}, got ${n}`);
    return ok(n);
  });
  defineValidator("boolean", (v) => ok(v === "false" ? false : Boolean(v)));
  defineValidator(
    "enum",
    (v, desc) => desc.values && desc.values.indexOf(v) === -1 ? bad(`expected one of ${desc.values.join(", ")}, got ${describe2(v)}`) : ok(v)
  );
  defineValidator(
    "object",
    (v) => v == null || typeof v === "object" && !Array.isArray(v) ? ok(v) : bad(`expected an object, got ${describe2(v)}`)
  );
  defineValidator("array", (v, desc, path) => {
    if (!Array.isArray(v)) return bad(`expected an array, got ${describe2(v)}`);
    if (desc.max != null && v.length > desc.max) return bad(`at most ${desc.max} items`);
    if (desc.min != null && v.length < desc.min) return bad(`at least ${desc.min} items`);
    if (!desc.of) return ok(v);
    const out = [];
    for (let i = 0; i < v.length; i++) {
      const item = validateValue({ type: desc.of }, v[i], `${path}[${i}]`);
      if (item.error) return bad(item.error);
      out.push(item.value);
    }
    return ok(out);
  });
  defineValidator(
    "function",
    (v) => typeof v === "function" ? ok(v) : bad(`expected a function, got ${describe2(v)}`)
  );
  defineValidator("len", (v) => {
    if (typeof v === "number" && isFinite(v)) return ok(v);
    if (typeof v === "function") return ok(v);
    if (typeof v === "string" && v.trim() !== "") return ok(v.trim());
    return bad(`expected a length, got ${describe2(v)}`);
  });
  defineValidator("size", (v) => {
    if (v == null) return ok(v);
    if (typeof v === "number" || typeof v === "string") return ok({ w: v, h: v });
    if (typeof v === "object") return ok(v);
    return bad(`expected {w, h}, got ${describe2(v)}`);
  });
  defineValidator(
    "selector",
    (v) => v == null || typeof v === "string" || typeof v === "function" || isElementLike(v) ? ok(v) : bad(`expected a selector, got ${describe2(v)}`)
  );
  defineValidator("node", (v) => ok(v));
  defineValidator(
    "html",
    (v) => typeof v === "string" ? ok(v) : bad(`expected a markup string, got ${describe2(v)}`)
  );
  defineValidator(
    "color",
    (v) => typeof v === "string" ? ok(v) : bad(`expected a colour, got ${describe2(v)}`)
  );
  var FORMATS = {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    url: /^https?:\/\/[^\s]+$/i,
    // A Len that CSS can resolve on its own; used by form-level `len` fields.
    cssLength: /^(-?[\d.]+(px|rem|em|ch|ex|vw|vh|vmin|vmax|dvh|dvw|svh|lvh|%|fr)?|0)$/
  };
  function isElementLike(v) {
    return !!v && typeof v === "object" && typeof v.nodeType === "number";
  }
  function describe2(v) {
    if (v === null) return "null";
    if (v === void 0) return "undefined";
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "object") return Array.isArray(v) ? "an array" : "an object";
    return String(v);
  }
  function normalizeDescriptor(desc, name) {
    const d = typeof desc === "string" ? { type: desc } : { ...desc };
    if (!d.type) d.type = d.values ? "enum" : "any";
    if (!VALIDATORS[d.type]) {
      warn("MK3002", `prop '${name}' declares unknown type '${d.type}'; treated as 'any'`, {
        subject: name
      });
      d.type = "any";
    }
    d.name = name;
    if (d.reactive === void 0) d.reactive = true;
    return d;
  }
  function normalizeSchema(schema) {
    const out = /* @__PURE__ */ Object.create(null);
    if (!schema) return out;
    for (const name of Object.keys(schema)) out[name] = normalizeDescriptor(schema[name], name);
    return out;
  }
  function validateValue(desc, value, path) {
    const d = desc.name ? desc : normalizeDescriptor(desc, path || "value");
    const empty = value === void 0 || value === null || value === "" || Array.isArray(value) && value.length === 0;
    if (d.required && empty) return bad(`${path || d.name} is required`);
    if (value === void 0 || value === null) {
      if (value === void 0 && d.default !== void 0) {
        return ok(typeof d.default === "function" && d.type !== "function" ? d.default() : d.default);
      }
      return ok(value === void 0 ? d.default : value);
    }
    if (typeof value === "function" && value.__mkSignal && d.type !== "function") return ok(value);
    const result = VALIDATORS[d.type](value, d, path || d.name);
    if (result.error) return result;
    let v = result.value;
    if (d.format && FORMATS[d.format] && typeof v === "string" && v !== "") {
      if (!FORMATS[d.format].test(v)) return bad(`${path || d.name} is not a valid ${d.format}`);
    }
    if (d.coerce) v = d.coerce(v);
    if (d.validate) {
      const message = d.validate(v);
      if (message) return bad(message);
    }
    return ok(v);
  }
  function validateAll(schema, values, options) {
    const opts = options || {};
    const out = /* @__PURE__ */ Object.create(null);
    const errors = [];
    const unknown = [];
    for (const name of Object.keys(schema)) {
      const desc = schema[name];
      const given = values ? values[name] : void 0;
      if (given === void 0 && desc.default === void 0 && !desc.required) continue;
      const result = validateValue(desc, given, name);
      if (result.error) errors.push({ name, message: result.error });
      else if (result.value !== void 0) out[name] = result.value;
    }
    if (values) {
      for (const name of Object.keys(values)) {
        if (name in schema) continue;
        unknown.push(name);
        if (!opts.strict) out[name] = values[name];
      }
    }
    return { values: out, errors, unknown };
  }
  function defaultsOf(schema) {
    const out = /* @__PURE__ */ Object.create(null);
    for (const name of Object.keys(schema)) {
      const d = schema[name];
      if (d.default === void 0) continue;
      out[name] = typeof d.default === "function" && d.type !== "function" ? d.default() : d.default;
    }
    return out;
  }
  function mergeSchema(parent, child) {
    const out = /* @__PURE__ */ Object.create(null);
    for (const k of Object.keys(parent || {})) out[k] = parent[k];
    for (const k of Object.keys(child || {})) out[k] = child[k];
    return out;
  }

  // source/core/define.js
  var HOOKS = [
    "create",
    "mount",
    "update",
    "measure",
    "arrange",
    "paint",
    "unmount",
    "destroy",
    "serialize",
    "restore"
  ];
  var KNOWN_FIELDS = /* @__PURE__ */ new Set([
    "type",
    "version",
    "extends",
    "requires",
    "origin",
    "props",
    "childProps",
    "geometry",
    "traits",
    "algorithm",
    "slots",
    "layer",
    "commands",
    "events",
    "a11y",
    "keys",
    "styles",
    "tokens",
    "motion",
    "shadow",
    "content",
    "abstract",
    "virtual",
    ...HOOKS
  ]);
  function chain(parent, own) {
    const list = parent ? parent.slice() : [];
    if (own) list.push(own);
    return list;
  }
  function mergeObjects(parent, own) {
    if (!parent && !own) return null;
    return { ...parent || {}, ...own || {} };
  }
  function mergeArrays(parent, own) {
    const out = [];
    for (const item of parent || []) if (!out.includes(item)) out.push(item);
    for (const item of own || []) if (!out.includes(item)) out.push(item);
    return out;
  }
  function resolveDefinition(definition, base, options) {
    const opts = options || {};
    if (!definition || typeof definition !== "object" || !definition.type) {
      return fail("MK3002", "a definition needs a `type`", { subject: definition && definition.type });
    }
    for (const key of Object.keys(definition)) {
      if (!KNOWN_FIELDS.has(key)) {
        warn("MK3002", `unknown field '${key}' in the definition of '${definition.type}'`, {
          subject: definition.type + "." + key
        });
      }
    }
    if (!definition.create && !base && !definition.abstract) {
      return fail("MK3002", `'${definition.type}' declares neither \`create\` nor \`extends\``, {
        subject: definition.type
      });
    }
    const props = normalizeSchema(definition.props);
    const childProps = normalizeSchema(definition.childProps);
    const resolved = {
      type: definition.type,
      version: definition.version || base && base.version || "0.0.0",
      origin: opts.origin || definition.origin || base && base.origin || "core",
      extends: definition.extends || null,
      base: base || null,
      abstract: !!definition.abstract,
      /** A node with no DOM of its own; children land in the nearest ancestor. */
      virtual: definition.virtual !== void 0 ? !!definition.virtual : !!(base && base.virtual),
      props: base ? mergeSchema(base.props, props) : props,
      childProps: base ? mergeSchema(base.childProps, childProps) : childProps,
      geometry: mergeObjects(base && base.geometry, definition.geometry),
      traits: mergeArrays(base && base.traits, definition.traits),
      algorithm: definition.algorithm || base && base.algorithm || null,
      slots: mergeObjects(base && base.slots, definition.slots),
      layer: definition.layer || base && base.layer || null,
      commands: mergeObjects(base && base.commands, definition.commands) || {},
      events: mergeArrays(base && base.events, definition.events),
      a11y: definition.a11y !== void 0 ? definition.a11y : base ? base.a11y : void 0,
      keys: mergeObjects(base && base.keys, definition.keys) || {},
      styles: mergeArrays(base && base.styles, definition.styles ? [definition.styles] : []),
      tokens: mergeObjects(base && base.tokens, definition.tokens),
      motion: mergeObjects(base && base.motion, definition.motion),
      shadow: definition.shadow !== void 0 ? definition.shadow : base ? base.shadow : false,
      content: definition.content !== void 0 ? definition.content : base ? base.content : void 0,
      requires: definition.requires || null,
      hooks: /* @__PURE__ */ Object.create(null),
      source: definition
    };
    for (const hook of HOOKS) {
      resolved.hooks[hook] = chain(base && base.hooks[hook], definition[hook]);
    }
    if (resolved.a11y === void 0 && !resolved.abstract) {
      warn(
        "MK3006",
        `'${resolved.type}' declares no \`a11y\`. Declare a role, or opt out with a11y: 'presentation'`,
        { subject: resolved.type }
      );
    }
    return resolved;
  }

  // source/core/events.js
  var MkEvent = class {
    constructor(type, detail, options) {
      const opts = options || {};
      this.type = type;
      this.detail = detail;
      this.target = null;
      this.currentTarget = null;
      this.phase = "at-target";
      this.native = opts.native || null;
      this.timeStamp = opts.timeStamp != null ? opts.timeStamp : 0;
      this.bubbles = opts.bubbles !== false;
      this.cancelable = opts.cancelable !== false;
      this.defaultPrevented = false;
      this.propagationStopped = false;
      this.immediateStopped = false;
    }
    preventDefault() {
      if (this.cancelable) this.defaultPrevented = true;
    }
    stopPropagation() {
      this.propagationStopped = true;
    }
    stopImmediatePropagation() {
      this.propagationStopped = true;
      this.immediateStopped = true;
    }
  };
  function listeners(node, type, capture) {
    const bag = capture ? node._capture : node._listeners;
    return bag && bag[type];
  }
  function addListener(node, type, fn, options) {
    const opts = options || {};
    const key = opts.capture ? "_capture" : "_listeners";
    if (!node[key]) node[key] = /* @__PURE__ */ Object.create(null);
    const bag = node[key];
    if (!bag[type]) bag[type] = [];
    const entry = { fn, once: !!opts.once, order: opts.order || 0 };
    bag[type].push(entry);
    bag[type].sort((a, b) => a.order - b.order);
    return function remove2() {
      const list = bag[type];
      if (!list) return;
      const index = list.indexOf(entry);
      if (index !== -1) list.splice(index, 1);
    };
  }
  function invoke(node, event, capture) {
    const list = listeners(node, event.type, capture);
    if (!list || !list.length) return;
    event.currentTarget = node;
    for (const entry of list.slice()) {
      if (event.immediateStopped) return;
      if (entry.once) {
        const index = list.indexOf(entry);
        if (index !== -1) list.splice(index, 1);
      }
      entry.fn.call(node, event);
    }
  }
  function pathTo(node) {
    const path = [];
    for (let current = node; current; current = current.eventParent || current.parent) {
      path.push(current);
    }
    return path;
  }
  function dispatch(node, event) {
    event.target = node;
    const path = pathTo(node);
    event.phase = "capture";
    for (let i = path.length - 1; i > 0; i--) {
      if (event.propagationStopped) break;
      invoke(path[i], event, true);
    }
    if (!event.propagationStopped) {
      event.phase = "at-target";
      invoke(node, event, true);
      invoke(node, event, false);
    }
    if (event.bubbles) {
      event.phase = "bubble";
      for (let i = 1; i < path.length; i++) {
        if (event.propagationStopped) break;
        invoke(path[i], event, false);
      }
    }
    event.currentTarget = null;
    return event;
  }
  function emit(node, type, detail, options) {
    return dispatch(node, new MkEvent(type, detail, options));
  }

  // source/core/registry.js
  var KINDS = [
    "type",
    "trait",
    "layout",
    "unit",
    "anchor",
    "placement",
    "theme",
    "motion",
    "input",
    "gesture",
    "serializer",
    "validator",
    "panel",
    "formatter",
    "layer",
    "target"
  ];
  var Registry = class {
    constructor(parent) {
      this.parent = parent || null;
      this.maps = /* @__PURE__ */ Object.create(null);
      for (const kind of KINDS) this.maps[kind] = /* @__PURE__ */ new Map();
    }
    /** Register `value` under `name`. Re-registration needs `replace: true`. */
    set(kind, name, value, options) {
      const opts = options || {};
      const map = this.maps[kind];
      if (!map) return fail("MK3002", `unknown extension kind '${kind}'`, { subject: name });
      const existing = this.get(kind, name);
      if (existing && !opts.replace) {
        return fail(
          "MK4001",
          `'${name}' is already registered as a ${kind}` + (existing.version ? ` (version ${existing.version})` : "") + "; pass { replace: true } to override deliberately",
          { subject: name }
        );
      }
      if (existing && opts.replace) {
        warn(
          "MK4001",
          `'${name}' replaced: ${existing.version || "?"} \u2192 ${value.version || "?"}`,
          { subject: name + ":replace" }
        );
      }
      map.set(name, value);
      return value;
    }
    get(kind, name) {
      const map = this.maps[kind];
      if (!map) return void 0;
      const own = map.get(name);
      if (own !== void 0) return own;
      return this.parent ? this.parent.get(kind, name) : void 0;
    }
    has(kind, name) {
      return this.get(kind, name) !== void 0;
    }
    /** Remove a registration owned by *this* registry. Parents are untouched. */
    delete(kind, name) {
      const map = this.maps[kind];
      return map ? map.delete(name) : false;
    }
    /** Every name of `kind` visible here, own registrations shadowing inherited. */
    names(kind) {
      const out = new Set(this.parent ? this.parent.names(kind) : []);
      for (const name of this.maps[kind].keys()) out.add(name);
      return [...out].sort();
    }
    /** Everything registered, for devtools and bug reports (§8.4). */
    list() {
      const out = {};
      for (const kind of KINDS) {
        out[kind] = this.names(kind).map((name) => {
          const value = this.get(kind, name);
          return {
            name,
            version: value && value.version,
            origin: value && value.origin || "core",
            own: this.maps[kind].has(name)
          };
        });
      }
      return out;
    }
  };

  // source/core/semver.js
  function parse(version) {
    const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z-.]+))?/.exec(String(version).trim());
    if (!match) return null;
    return {
      major: Number(match[1]),
      minor: match[2] === void 0 ? 0 : Number(match[2]),
      patch: match[3] === void 0 ? 0 : Number(match[3]),
      pre: match[4] || "",
      partial: { minor: match[2] === void 0, patch: match[3] === void 0 }
    };
  }
  function compare(a, b) {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    if (a.patch !== b.patch) return a.patch - b.patch;
    if (a.pre === b.pre) return 0;
    if (!a.pre) return 1;
    if (!b.pre) return -1;
    return a.pre < b.pre ? -1 : 1;
  }
  function upperBound(v, operator) {
    if (operator === "^") {
      if (v.major > 0) return { major: v.major + 1, minor: 0, patch: 0, pre: "" };
      if (v.minor > 0 || v.partial.minor) return { major: 0, minor: v.minor + 1, patch: 0, pre: "" };
      return { major: 0, minor: 0, patch: v.patch + 1, pre: "" };
    }
    if (v.partial.minor) return { major: v.major + 1, minor: 0, patch: 0, pre: "" };
    return { major: v.major, minor: v.minor + 1, patch: 0, pre: "" };
  }
  function satisfiesOne(version, range) {
    const trimmed = range.trim();
    if (trimmed === "" || trimmed === "*" || trimmed === "x" || trimmed === "latest") return true;
    const match = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(trimmed);
    if (!match) return false;
    const operator = match[1] || "=";
    const bound = parse(match[2]);
    if (!bound || !version) return false;
    switch (operator) {
      case "^":
      case "~": {
        if (compare(version, bound) < 0) return false;
        return compare(version, upperBound(bound, operator)) < 0;
      }
      case ">":
        return compare(version, bound) > 0;
      case ">=":
        return compare(version, bound) >= 0;
      case "<":
        return compare(version, bound) < 0;
      case "<=":
        return compare(version, bound) <= 0;
      default: {
        if (bound.partial.minor) return version.major === bound.major;
        if (bound.partial.patch) return version.major === bound.major && version.minor === bound.minor;
        return compare(version, bound) === 0;
      }
    }
  }
  function satisfies(version, range) {
    const v = parse(version);
    if (!v) return false;
    return String(range).split("||").some(
      (alternative) => alternative.trim().split(/\s+(?![\d.])/).every((term) => satisfiesOne(v, term))
    );
  }

  // source/core/kernel.js
  var globalRegistry = new Registry(null);
  var instanceSeq = 0;
  var DEFAULTS = {
    prefix: "mk",
    theme: null,
    inherit: true,
    errorPolicy: "isolate",
    sanitize: null,
    nonce: null,
    sizing: "element",
    shadow: false
  };
  var Kernel = class {
    constructor(options) {
      this.options = { ...DEFAULTS, ...options || {} };
      this.id = `mk${++instanceSeq}`;
      this.version = VERSION;
      this.prefix = this.options.prefix;
      this.registry = new Registry(this.options.inherit === false ? null : globalRegistry);
      this.plugins = /* @__PURE__ */ new Map();
      this.destroyed = false;
      this._resolved = /* @__PURE__ */ new Map();
      this._instanceCounts = /* @__PURE__ */ new Map();
      this._nodeSeq = 0;
    }
    // ── Extension points ───────────────────────────────────────────────────
    /** Register an element type (§8.1). Extension point §10.1. */
    define(definition, options) {
      const opts = options || {};
      const origin = opts.origin || this._installing || "core";
      if (origin !== "core" && definition.type && definition.type.indexOf(":") === -1) {
        return fail(
          "MK4004",
          `'${definition.type}' is a bare name; bare names are reserved for core. Namespace it as 'vendor:${definition.type}'.`,
          { subject: definition.type }
        );
      }
      let base = null;
      if (definition.extends) {
        base = this.registry.get("type", definition.extends);
        if (!base) {
          return fail(
            "MK3001",
            `'${definition.type}' extends '${definition.extends}', which is not registered. Register the base type first, or list it in \`requires\`.`,
            { subject: definition.type }
          );
        }
      }
      const resolved = resolveDefinition(definition, base, { origin });
      if (!resolved) return null;
      if (true) {
        const findings = conformance(definition, resolved);
        for (const found of findings) {
          if (found.level === "error") fail(found.code, found.message, { subject: definition.type });
          else warn(found.code, found.message, { subject: definition.type });
        }
      }
      this.registry.set("type", resolved.type, resolved, opts);
      this._resolved.delete(resolved.type);
      return resolved;
    }
    /** Register a trait (§9). Extension point §10.2. */
    trait(trait, options) {
      if (!trait || !trait.name) return fail("MK3002", "a trait needs a `name`");
      if (true) {
        for (const found of conformanceTrait(trait)) {
          if (found.level === "error") fail(found.code, found.message, { subject: trait.name });
          else warn(found.code, found.message, { subject: trait.name });
        }
      }
      const record = { ...trait, origin: this._installing || trait.origin || "core" };
      return this.registry.set("trait", trait.name, record, options);
    }
    /** Register a layout algorithm (§7). Extension point §10.3. */
    layout(algorithm, options) {
      if (!algorithm || !algorithm.name) return fail("MK3002", "a layout algorithm needs a `name`");
      if (!algorithm.arrange && !algorithm.css) {
        return fail(
          "MK2001",
          `layout '${algorithm.name}' declares neither \`arrange\` nor \`css\`; one of them has to place the children`,
          { subject: algorithm.name }
        );
      }
      const record = { ...algorithm, origin: this._installing || algorithm.origin || "core" };
      return this.registry.set("layout", algorithm.name, record, options);
    }
    /** Register a custom length unit (§5.2, §10.4). */
    unit(name, definition, options) {
      if (!name || !definition || typeof definition.toNumber !== "function") {
        return fail("MK1005", `unit '${name}' needs a \`toNumber\``, { subject: name });
      }
      const record = { name, origin: this._installing || "core", ...definition };
      return this.registry.set("unit", name, record, options);
    }
    /**
     * Register a custom prop type — §10's eleventh extension point.
     *
     * `defineValidator` has always existed; what did not was a way to reach it
     * from the public surface, so the only route was importing a core module.
     * §10 calls itself the complete list and §1.5.3 asks that a third party
     * extend without touching `source/core/`, which an internal import is at
     * best the letter of.
     *
     * A validator returns `{ value }` to accept — coercing if it likes, which is
     * what makes `size` turn `8` into `{ w: 8, h: 8 }` — or `{ error }` to
     * reject with a message the author reads.
     */
    /**
     * Apply a registered formatter, falling back to the value itself.
     *
     * Built-ins call this rather than formatting inline, which is what makes
     * §10.13 an extension point rather than a claim: replacing `number` changes
     * every meter, progress bar, and slider at once.
     */
    formatted(name, value, detail) {
      const record = this.registry.get("formatter", name);
      if (!record) return value == null ? "" : String(value);
      const out = record.format(value, detail || {});
      return out == null ? "" : String(out);
    }
    validator(name, check, options) {
      if (!name || typeof check !== "function") {
        return fail("MK3002", `validator '${name}' needs a check function`, { subject: name });
      }
      const opts = options || {};
      if (hasValidator(name) && !opts.replace) {
        warn(
          "MK4001",
          `prop type '${name}' is already registered; pass { replace: true } to override it`,
          { subject: name }
        );
        return this;
      }
      defineValidator(name, check);
      return this;
    }
    /** Register an anchor keyword (§10.5). */
    anchor(name, resolve4, options) {
      return this.registry.set("anchor", name, { name, resolve: resolve4 }, options);
    }
    /** Register a placement strategy for anchored positioning (§10.5). */
    placement(name, strategy, options) {
      const record = typeof strategy === "function" ? { name, strategy } : { name, ...strategy };
      return this.registry.set("placement", name, record, options);
    }
    /** Register a theme (§12, §10.6). */
    theme(name, definition, options) {
      return this.registry.set("theme", name, { name, ...definition }, options);
    }
    /** Register a motion preset (§17, §10.7). */
    motion(name, preset, options) {
      return this.registry.set("motion", name, { name, ...preset }, options);
    }
    /** Register an input source (§13.5, §10.8). */
    input(name, source, options) {
      return this.registry.set("input", name, { name, ...source }, options);
    }
    /** Register a gesture recognizer (§13.3, §10.9). */
    gesture(name, recognizer, options) {
      return this.registry.set("gesture", name, { name, ...recognizer }, options);
    }
    /** Register a serialization migration (§19.2, §10.10). */
    serializer(migration, options) {
      const name = `${migration.from}->${migration.to}`;
      return this.registry.set("serializer", name, { name, ...migration }, options);
    }
    /** Register a devtools panel (§19.3, §10.12). */
    panel(name, definition, options) {
      return this.registry.set("panel", name, { name, ...definition }, options);
    }
    /**
     * Register a formatter (§10.13, §10's thirteenth extension point).
     *
     * Number, date, and message formatting that built-ins use, so an
     * application decides how a value reads once rather than per element. The
     * built-in set is deliberately thin: a locale, a currency, or a domain
     * vocabulary — "3 of 5", "two thirds full" — is the application's to choose.
     */
    formatter(name, fn, options) {
      if (!name || typeof fn !== "function") {
        return fail("MK3002", `formatter '${name}' needs a function`, { subject: name });
      }
      return this.registry.set("formatter", name, { name, format: fn }, options);
    }
    // ── Plugins (§8.5) ─────────────────────────────────────────────────────
    /**
     * Install a plugin. Idempotent per instance; `install` receives the
     * *instance*, never the global, which is what makes P8 hold.
     */
    use(plugin, options) {
      if (!plugin) return this;
      if (Array.isArray(plugin)) {
        for (const one of plugin) this.use(one, options);
        return this;
      }
      if (typeof plugin === "function") plugin = { name: plugin.name || "anonymous", install: plugin };
      const name = plugin.name || "anonymous";
      if (this.plugins.has(name)) return this;
      if (this._installStack && this._installStack.includes(name)) {
        fail("MK4003", `plugin dependency cycle: ${this._installStack.concat(name).join(" \u2192 ")}`, {
          subject: name
        });
        return this;
      }
      if (plugin.requires) {
        for (const dependency of Object.keys(plugin.requires)) {
          const range = plugin.requires[dependency];
          const actual = dependency === "mutakit" ? this.version : this._pluginVersion(dependency);
          if (actual == null) {
            fail(
              "MK4002",
              `'${name}' requires ${dependency}@${range}, which is not installed`,
              { subject: name }
            );
            return this;
          }
          if (!satisfies(actual, range)) {
            fail(
              "MK4002",
              `'${name}' requires ${dependency}@${range} but ${dependency}@${actual} is installed`,
              { subject: name }
            );
            return this;
          }
        }
      }
      this._installStack = (this._installStack || []).concat(name);
      const previousOrigin = this._installing;
      this._installing = name;
      let handle = null;
      try {
        handle = plugin.install ? plugin.install(this, options) : null;
      } catch (error) {
        warn("MK4006", `plugin '${name}' threw during install: ${error.message}`, {
          subject: name,
          error
        });
      } finally {
        this._installing = previousOrigin;
        this._installStack.pop();
      }
      this.plugins.set(name, {
        name,
        version: plugin.version || "0.0.0",
        options: options || null,
        uninstall: handle && handle.uninstall,
        contributions: this._contributionsOf(name)
      });
      return this;
    }
    _pluginVersion(name) {
      const record = this.plugins.get(name);
      if (record) return record.version;
      const type = this.registry.get("type", name);
      return type ? type.version : null;
    }
    _contributionsOf(origin) {
      const out = [];
      for (const kind of Object.keys(this.registry.maps)) {
        for (const [name, value] of this.registry.maps[kind]) {
          if (value && value.origin === origin) out.push({ kind, name });
        }
      }
      return out;
    }
    /**
     * Deregister a plugin's contributions (§8.5). Live elements keep working
     * until destroyed normally; only new `create()` calls for its types fail.
     * That is what makes this safe to call during hot reload.
     */
    unuse(name) {
      const record = this.plugins.get(name);
      if (!record) return false;
      if (record.uninstall) {
        try {
          record.uninstall(this);
        } catch (error) {
          warn("MK4006", `plugin '${name}' threw during uninstall: ${error.message}`, {
            subject: name,
            error
          });
        }
      }
      for (const { kind, name: contributed } of record.contributions) {
        if (kind === "type") {
          const live = this._instanceCounts.get(contributed) || 0;
          if (live > 0) {
            warn(
              "MK4014",
              `'${contributed}' deregistered with ${live} live instance(s); they keep working until destroyed, but new ones cannot be created`,
              { subject: contributed }
            );
          }
        }
        this.registry.delete(kind, contributed);
      }
      this.plugins.delete(name);
      return true;
    }
    // ── Identity (§8.9) ────────────────────────────────────────────────────
    nextNodeId(type) {
      return `${type}-${++this._nodeSeq}`;
    }
    // ── Error isolation (§8.10) ────────────────────────────────────────────
    /**
     * Run a lifecycle hook inside a guard. On a throw the node is marked
     * `errored`, further hooks on it stop, a diagnostic carrying the plugin's
     * identity is emitted, and an `error` event bubbles the node tree so the
     * application can report it.
     */
    guard(node, hookName, fn, args) {
      try {
        return fn.apply(null, args || []);
      } catch (error) {
        return this.reportHookError(node, hookName, error);
      }
    }
    reportHookError(node, hookName, error) {
      const policy2 = this.options.errorPolicy;
      const definition = node && node.definition;
      const detail = {
        subject: node ? `${node.type}#${node.id}` : hookName,
        hook: hookName,
        type: definition && definition.type,
        plugin: definition && definition.origin,
        pluginVersion: definition && definition.version,
        error
      };
      if (hookName === "destroy" || hookName === "unmount") {
        warn("MK3007", `${hookName}() threw in '${detail.type}': ${error.message}`, detail);
        return void 0;
      }
      if (node) {
        node.errored = error;
        node.flags = 0;
      }
      if (policy2 === "propagate") throw error;
      if (policy2 !== "silent") {
        warn(
          "MK3007",
          `${hookName}() threw in '${detail.type}' (from ${detail.plugin}@${detail.pluginVersion}): ` + error.message,
          detail
        );
      }
      if (node && node.parent) {
        emit(node, "error", { error, hook: hookName, node }, { cancelable: false });
      }
      return void 0;
    }
    /** Build a diagnostic Error without throwing — used by the isolation path. */
    error(code, message, detail) {
      return diagnosticError(code, message, detail);
    }
    // ── Introspection ──────────────────────────────────────────────────────
    list() {
      return this.registry.list();
    }
    has(kind, name) {
      return this.registry.has(kind, name);
    }
  };

  // source/core/signals.js
  var STALE = 2;
  var CHECK = 1;
  var CLEAN = 0;
  var currentObserver = null;
  var currentOwner = null;
  var batchDepth = 0;
  var effectQueue = /* @__PURE__ */ new Set();
  var scheduleFlush = null;
  var flushScheduled = false;
  function setEffectScheduler(fn) {
    scheduleFlush = fn;
  }
  function request() {
    if (batchDepth > 0) return;
    if (scheduleFlush) {
      if (!flushScheduled) {
        flushScheduled = true;
        scheduleFlush();
      }
      return;
    }
    flushEffects();
  }
  function flushEffects() {
    flushScheduled = false;
    if (!effectQueue.size) return false;
    const batchOfEffects = [...effectQueue];
    effectQueue.clear();
    for (const effect2 of batchOfEffects) {
      if (!effect2.disposed) runEffect(effect2);
    }
    return true;
  }
  function hasPendingEffects() {
    return effectQueue.size > 0;
  }
  function link(node) {
    if (!currentObserver) return;
    if (currentObserver.sources.has(node)) return;
    currentObserver.sources.add(node);
    node.observers.add(currentObserver);
  }
  function markStale(node, state) {
    for (const observer of node.observers) {
      if (observer.state >= state) continue;
      const wasClean = observer.state === CLEAN;
      observer.state = state;
      if (observer.isEffect) {
        effectQueue.add(observer);
      } else if (wasClean || observer.state < STALE) {
        markStale(observer, CHECK);
      }
    }
  }
  function equals(a, b, custom) {
    if (custom) return custom(a, b);
    return Object.is(a, b);
  }
  function signal(initial, options) {
    const node = {
      value: initial,
      version: 0,
      observers: /* @__PURE__ */ new Set(),
      equals: options && options.equals,
      isSource: true
    };
    function accessor(next) {
      if (arguments.length === 0) {
        link(node);
        return node.value;
      }
      const value = typeof next === "function" && !next.__mkSignal ? next(node.value) : next;
      if (equals(node.value, value, node.equals)) return node.value;
      node.value = value;
      node.version++;
      markStale(node, STALE);
      request();
      return node.value;
    }
    accessor.__mkSignal = true;
    accessor.peek = () => node.value;
    accessor.set = (v) => accessor(v);
    accessor.node = node;
    return accessor;
  }
  function computed(fn, options) {
    const node = {
      value: void 0,
      version: 0,
      fn,
      sources: /* @__PURE__ */ new Set(),
      versions: /* @__PURE__ */ new Map(),
      observers: /* @__PURE__ */ new Set(),
      state: STALE,
      equals: options && options.equals
    };
    function accessor() {
      link(node);
      if (node.state !== CLEAN) update(node);
      return node.value;
    }
    accessor.__mkSignal = true;
    accessor.peek = () => {
      if (node.state !== CLEAN) update(node);
      return node.value;
    };
    accessor.node = node;
    return accessor;
  }
  function update(node) {
    if (node.state === CHECK) {
      for (const source of node.sources) {
        if (source.fn && source.state !== CLEAN) update(source);
      }
      let changed = false;
      for (const [source, version] of node.versions) {
        if (source.version !== version) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        node.state = CLEAN;
        return;
      }
    }
    const previousSources = node.sources;
    node.sources = /* @__PURE__ */ new Set();
    const prevObserver = currentObserver;
    currentObserver = node;
    let value;
    try {
      value = node.fn(node.value);
    } finally {
      currentObserver = prevObserver;
    }
    for (const source of previousSources) {
      if (!node.sources.has(source)) source.observers.delete(node);
    }
    recordVersions(node);
    node.state = CLEAN;
    if (!equals(node.value, value, node.equals)) {
      node.value = value;
      node.version++;
    }
  }
  function recordVersions(node) {
    node.versions.clear();
    for (const source of node.sources) node.versions.set(source, source.version);
  }
  function runEffect(effect2) {
    disposeChildren(effect2);
    const previousSources = effect2.sources;
    effect2.sources = /* @__PURE__ */ new Set();
    const prevObserver = currentObserver;
    const prevOwner = currentOwner;
    currentObserver = effect2;
    currentOwner = effect2;
    try {
      const cleanup = effect2.fn();
      if (typeof cleanup === "function") effect2.cleanups.push(cleanup);
    } finally {
      currentObserver = prevObserver;
      currentOwner = prevOwner;
    }
    for (const source of previousSources) {
      if (!effect2.sources.has(source)) source.observers.delete(effect2);
    }
    effect2.state = CLEAN;
  }
  function disposeChildren(owner) {
    while (owner.cleanups.length) {
      const cleanup = owner.cleanups.pop();
      try {
        cleanup();
      } catch (error) {
        console.error("[mutakit] effect cleanup threw", error);
      }
    }
    for (const child of owner.children) child.dispose();
    owner.children.length = 0;
  }
  function effect(fn) {
    const node = {
      fn,
      sources: /* @__PURE__ */ new Set(),
      cleanups: [],
      children: [],
      state: CLEAN,
      isEffect: true,
      disposed: false,
      dispose
    };
    if (currentOwner) currentOwner.children.push(node);
    function dispose() {
      if (node.disposed) return;
      node.disposed = true;
      disposeChildren(node);
      for (const source of node.sources) source.observers.delete(node);
      node.sources.clear();
      effectQueue.delete(node);
    }
    runEffect(node);
    return dispose;
  }
  function untrack(fn) {
    const previous = currentObserver;
    currentObserver = null;
    try {
      return fn();
    } finally {
      currentObserver = previous;
    }
  }
  function batch(fn) {
    batchDepth++;
    try {
      return fn();
    } finally {
      batchDepth--;
      if (batchDepth === 0) request();
    }
  }
  function isSignal(value) {
    return typeof value === "function" && value.__mkSignal === true;
  }
  function read(value) {
    return isSignal(value) ? value() : value;
  }

  // source/core/dom.js
  var dom_exports = {};
  __export(dom_exports, {
    activeElement: () => activeElement,
    applyAttrs: () => applyAttrs,
    assertNoLeaks: () => assertNoLeaks,
    body: () => body,
    caf: () => caf,
    computedStyle: () => computedStyle,
    contains: () => contains,
    counters: () => counters,
    detectFeatures: () => detectFeatures,
    devicePixelRatio: () => devicePixelRatio,
    documentRoot: () => documentRoot,
    el: () => el,
    injectStyle: () => injectStyle,
    insert: () => insert,
    isBrowser: () => isBrowser,
    listen: () => listen,
    measureScrollbar: () => measureScrollbar,
    media: () => media,
    now: () => now,
    observeIntersection: () => observeIntersection,
    observeMutations: () => observeMutations,
    observeResize: () => observeResize,
    offsetBox: () => offsetBox,
    onVisibilityChange: () => onVisibilityChange,
    raf: () => raf,
    readCustomProperty: () => readCustomProperty,
    rectOf: () => rectOf,
    remove: () => remove,
    resolveTarget: () => resolveTarget,
    setAttr: () => setAttr,
    setClass: () => setClass,
    setClock: () => setClock,
    setHTML: () => setHTML,
    setStyles: () => setStyles,
    setText: () => setText,
    timer: () => timer,
    toggleClass: () => toggleClass,
    viewport: () => viewport,
    viewportGap: () => viewportGap
  });
  var hasDOM = typeof document !== "undefined" && typeof window !== "undefined";
  var counters = {
    listeners: 0,
    observers: 0,
    elements: 0,
    sheets: 0,
    timers: 0
  };
  function isBrowser() {
    return hasDOM;
  }
  function requireDOM(what) {
    if (!hasDOM) {
      throw new Error(`[mutakit] ${what} needs a DOM; this build is running without one`);
    }
  }
  var trustedPolicy = null;
  var policyChecked = false;
  function policy() {
    if (policyChecked) return trustedPolicy;
    policyChecked = true;
    if (!hasDOM || !window.trustedTypes || !window.trustedTypes.createPolicy) return null;
    try {
      trustedPolicy = window.trustedTypes.createPolicy("mutakit", {
        createHTML: (s) => s,
        createScriptURL: (s) => s
      });
    } catch (error) {
      throw new Error(
        "[mutakit] this page enforces Trusted Types but refused the 'mutakit' policy; add 'mutakit' to trusted-types in your Content-Security-Policy"
      );
    }
    return trustedPolicy;
  }
  var LIVE = /* @__PURE__ */ Symbol("mk.live");
  var SVG_NS = "http://www.w3.org/2000/svg";
  var SVG_TAGS = /* @__PURE__ */ new Set(["svg", "path", "circle", "rect", "g", "line", "polyline", "polygon", "text"]);
  function el(tag, attrs, parent) {
    requireDOM("element creation");
    const node = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    counters.elements++;
    node[LIVE] = true;
    if (attrs) applyAttrs(node, attrs);
    if (parent) parent.appendChild(node);
    return node;
  }
  function applyAttrs(node, attrs) {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (value === void 0) continue;
      if (key === "class") setClass(node, value);
      else if (key === "style" && value && typeof value === "object") setStyles(node, value);
      else if (key === "text") setText(node, value);
      else if (key === "dataset" && value) for (const k of Object.keys(value)) node.dataset[k] = value[k];
      else setAttr(node, key, value);
    }
    return node;
  }
  function setAttr(node, name, value) {
    if (value === null || value === false || value === void 0) node.removeAttribute(name);
    else if (value === true) node.setAttribute(name, "");
    else node.setAttribute(name, String(value));
  }
  function setClass(node, value) {
    if (Array.isArray(value)) node.setAttribute("class", value.filter(Boolean).join(" "));
    else if (value && typeof value === "object") {
      for (const k of Object.keys(value)) node.classList.toggle(k, !!value[k]);
    } else node.setAttribute("class", value == null ? "" : String(value));
  }
  function toggleClass(node, name, on) {
    node.classList.toggle(name, !!on);
  }
  function setStyles(node, styles) {
    for (const key of Object.keys(styles)) {
      const value = styles[key];
      if (key.charCodeAt(0) === 45) {
        if (value == null) node.style.removeProperty(key);
        else node.style.setProperty(key, String(value));
      } else if (value == null) {
        node.style[key] = "";
      } else {
        node.style[key] = String(value);
      }
    }
  }
  function setText(node, value) {
    node.textContent = value == null ? "" : String(value);
  }
  function setHTML(node, markup, sanitize, subject) {
    if (typeof sanitize !== "function") {
      fail(
        "MK3014",
        "an html-prefixed prop needs a sanitizer: Mutakit.create({ sanitize }). Falling back to text.",
        { subject }
      );
      setText(node, markup);
      return;
    }
    const clean = sanitize(markup);
    const p = policy();
    node.innerHTML = p ? p.createHTML(clean) : clean;
  }
  function remove(node) {
    if (!node) return;
    if (node.parentNode) node.parentNode.removeChild(node);
    release(node);
    if (!node.querySelectorAll) return;
    for (const descendant of node.querySelectorAll("*")) release(descendant);
  }
  function release(node) {
    if (!node[LIVE]) return;
    node[LIVE] = false;
    counters.elements--;
  }
  function insert(parent, node, before) {
    if (before && before.parentNode === parent) parent.insertBefore(node, before);
    else parent.appendChild(node);
  }
  function listen(target, type, handler, options) {
    if (!target || !target.addEventListener) return () => {
    };
    target.addEventListener(type, handler, options);
    counters.listeners++;
    let live = true;
    return function unlisten() {
      if (!live) return;
      live = false;
      target.removeEventListener(type, handler, options);
      counters.listeners--;
    };
  }
  function observeResize(target, callback, options) {
    if (!hasDOM || typeof ResizeObserver === "undefined") return () => {
    };
    const observer = new ResizeObserver(callback);
    observer.observe(target, options);
    counters.observers++;
    let live = true;
    return function unobserve() {
      if (!live) return;
      live = false;
      observer.disconnect();
      counters.observers--;
    };
  }
  function observeIntersection(target, callback, options) {
    if (!hasDOM || typeof IntersectionObserver === "undefined") return () => {
    };
    const observer = new IntersectionObserver(callback, options);
    observer.observe(target);
    counters.observers++;
    let live = true;
    return function unobserve() {
      if (!live) return;
      live = false;
      observer.disconnect();
      counters.observers--;
    };
  }
  function observeMutations(target, callback, options) {
    if (!hasDOM || typeof MutationObserver === "undefined") return () => {
    };
    const observer = new MutationObserver(callback);
    observer.observe(target, options);
    counters.observers++;
    let live = true;
    return function unobserve() {
      if (!live) return;
      live = false;
      observer.disconnect();
      counters.observers--;
    };
  }
  function timer(fn, ms) {
    let live = true;
    const id = setTimeout(() => {
      live = false;
      counters.timers--;
      fn();
    }, ms);
    counters.timers++;
    return function cancel2() {
      if (!live) return;
      live = false;
      counters.timers--;
      clearTimeout(id);
    };
  }
  function frameRequest(fn) {
    if (hidden()) return { timer: setTimeout(() => fn(now()), 16) };
    return window.requestAnimationFrame(fn);
  }
  function frameCancel(handle) {
    if (handle && handle.timer !== void 0) clearTimeout(handle.timer);
    else window.cancelAnimationFrame(handle);
  }
  function hidden() {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
  }
  var clock = {
    raf: hasDOM ? frameRequest : (fn) => setTimeout(() => fn(now()), 16),
    caf: hasDOM ? frameCancel : (id) => clearTimeout(id),
    now: () => typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()
  };
  function setClock(next) {
    const previous = clock;
    clock = next || previous;
    return () => {
      clock = previous;
    };
  }
  function raf(fn) {
    return clock.raf(fn);
  }
  function caf(id) {
    return clock.caf(id);
  }
  function now() {
    return clock.now();
  }
  function onVisibilityChange(fn) {
    if (!hasDOM) return () => {
    };
    return listen(document, "visibilitychange", fn);
  }
  function rectOf(node) {
    const r = node.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  function offsetBox(node) {
    return { x: node.offsetLeft, y: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight };
  }
  function computedStyle(node) {
    return window.getComputedStyle(node);
  }
  function readCustomProperty(node, name) {
    return window.getComputedStyle(node).getPropertyValue(name).trim();
  }
  function media(query) {
    if (!hasDOM || !window.matchMedia) return { matches: false, addListener: () => () => {
    } };
    const list = window.matchMedia(query);
    return {
      get matches() {
        return list.matches;
      },
      addListener(fn) {
        return listen(list, "change", fn);
      }
    };
  }
  function devicePixelRatio() {
    return hasDOM ? window.devicePixelRatio || 1 : 1;
  }
  function viewportGap(visual) {
    if (!hasDOM || !window.visualViewport) return 0;
    return window.innerHeight - (visual.h + visual.offsetY);
  }
  function viewport() {
    if (!hasDOM) return { w: 0, h: 0, offsetX: 0, offsetY: 0, scale: 1 };
    const vv = window.visualViewport;
    return {
      w: vv ? vv.width : window.innerWidth,
      h: vv ? vv.height : window.innerHeight,
      offsetX: vv ? vv.offsetLeft : 0,
      offsetY: vv ? vv.offsetTop : 0,
      scale: vv ? vv.scale : 1
    };
  }
  var scrollbarWidth = null;
  function measureScrollbar() {
    if (scrollbarWidth !== null) return scrollbarWidth;
    if (!hasDOM) return scrollbarWidth = 0;
    const outer = document.createElement("div");
    outer.style.cssText = "position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;visibility:hidden";
    document.body.appendChild(outer);
    scrollbarWidth = outer.offsetWidth - outer.clientWidth;
    document.body.removeChild(outer);
    return scrollbarWidth;
  }
  function documentRoot() {
    requireDOM("document access");
    return document.documentElement;
  }
  function body() {
    requireDOM("document access");
    return document.body;
  }
  function resolveTarget(target) {
    if (!target) return null;
    if (typeof target === "string") {
      requireDOM("selector lookup");
      return document.querySelector(target);
    }
    if (target.nodeType === 9) return target.body || target.documentElement;
    if (target.document && target.document.nodeType === 9) {
      return target.document.body || target.document.documentElement;
    }
    return target;
  }
  function activeElement() {
    return hasDOM ? document.activeElement : null;
  }
  function contains(ancestor, node) {
    return !!ancestor && !!node && ancestor.contains(node);
  }
  var features = null;
  function detectFeatures() {
    if (features) return features;
    const supports = (property, value) => hasDOM && window.CSS && CSS.supports ? CSS.supports(property, value) : false;
    features = {
      dom: hasDOM,
      anchorPositioning: supports("anchor-name", "--x"),
      popover: hasDOM && "popover" in HTMLElement.prototype,
      dialog: hasDOM && typeof HTMLDialogElement !== "undefined",
      inert: hasDOM && "inert" in HTMLElement.prototype,
      constructableSheets: hasDOM && typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype,
      resizeObserver: hasDOM && typeof ResizeObserver !== "undefined",
      containerQueries: supports("container-type", "inline-size"),
      cascadeLayers: hasDOM && typeof CSSLayerBlockRule !== "undefined",
      has: supports("selector(:has(*))", "") || safeSelector(":has(*)"),
      viewTransitions: hasDOM && typeof document.startViewTransition === "function",
      webAnimations: hasDOM && typeof Element !== "undefined" && "animate" in Element.prototype,
      dvh: supports("height", "100dvh")
    };
    return features;
  }
  function safeSelector(selector) {
    if (!hasDOM) return false;
    try {
      document.querySelector(selector);
      return true;
    } catch (error) {
      return false;
    }
  }
  function injectStyle(css2, options) {
    requireDOM("style injection");
    const opts = options || {};
    const root = opts.root || document;
    const target = root.adoptedStyleSheets !== void 0 ? root : document;
    const f = detectFeatures();
    const foreign = root.nodeType === 9 && root !== document;
    if (!opts.first && !foreign && f.constructableSheets && target.adoptedStyleSheets !== void 0) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css2);
      target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
      counters.sheets++;
      return function removeSheet() {
        target.adoptedStyleSheets = target.adoptedStyleSheets.filter((s) => s !== sheet);
        counters.sheets--;
      };
    }
    const owner = root.nodeType === 9 ? root : document;
    const style = owner.createElement("style");
    if (opts.nonce) style.setAttribute("nonce", opts.nonce);
    style.textContent = css2;
    const parent = root.head || root;
    if (opts.first) parent.insertBefore(style, parent.firstChild);
    else parent.appendChild(style);
    counters.sheets++;
    return function removeSheet() {
      if (style.parentNode) style.parentNode.removeChild(style);
      counters.sheets--;
    };
  }
  function assertNoLeaks(baseline, subject) {
    if (false) return true;
    const leaked = [];
    for (const key of Object.keys(baseline)) {
      if (counters[key] > baseline[key]) leaked.push(`${key}: ${baseline[key]} \u2192 ${counters[key]}`);
    }
    if (leaked.length) {
      warn("MK5001", `resources not released: ${leaked.join(", ")}`, { subject });
      return false;
    }
    return true;
  }

  // source/geometry/len.js
  var PX = "px";
  var PCT = "pct";
  var FR = "fr";
  var KEYWORD = "kw";
  var UNIT = "unit";
  var CALL = "call";
  var OP = "op";
  var VAR = "var";
  var COMPUTED = "js";
  var KEYWORDS = /* @__PURE__ */ new Set([
    "auto",
    "none",
    "min-content",
    "max-content",
    "fit-content",
    "stretch",
    "inherit"
  ]);
  var ABSOLUTE = { px: 1, cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72, pc: 16, q: 96 / 101.6 };
  var FONT_RELATIVE = /* @__PURE__ */ new Set(["em", "rem", "ex", "ch", "cap", "ic", "lh", "rlh"]);
  var VIEWPORT_RELATIVE = /* @__PURE__ */ new Set([
    "vw",
    "vh",
    "vmin",
    "vmax",
    "vi",
    "vb",
    "dvw",
    "dvh",
    "dvmin",
    "dvmax",
    "svw",
    "svh",
    "svmin",
    "svmax",
    "lvw",
    "lvh",
    "lvmin",
    "lvmax"
  ]);
  var CALLS = /* @__PURE__ */ new Set(["calc", "min", "max", "clamp", "var", "env", "round"]);
  var cache = /* @__PURE__ */ new Map();
  var CACHE_LIMIT = 512;
  function tokenize(input) {
    const tokens = [];
    const length = input.length;
    let i = 0;
    while (i < length) {
      const code = input.charCodeAt(i);
      if (code === 32 || code === 9 || code === 10 || code === 13) {
        i++;
        continue;
      }
      if (code >= 48 && code <= 57 || code === 46 || (code === 43 || code === 45) && isNumberStart(input, i + 1)) {
        let start2 = i;
        if (code === 43 || code === 45) i++;
        while (i < length && isDigit(input.charCodeAt(i))) i++;
        if (input.charCodeAt(i) === 46) {
          i++;
          while (i < length && isDigit(input.charCodeAt(i))) i++;
        }
        if (input.charCodeAt(i) === 101 || input.charCodeAt(i) === 69) {
          const save = i;
          i++;
          if (input.charCodeAt(i) === 43 || input.charCodeAt(i) === 45) i++;
          if (isDigit(input.charCodeAt(i))) while (i < length && isDigit(input.charCodeAt(i))) i++;
          else i = save;
        }
        const value = parseFloat(input.slice(start2, i));
        let unit = "";
        if (input.charCodeAt(i) === 37) {
          unit = "%";
          i++;
        } else {
          const unitStart = i;
          while (i < length && isIdentChar(input.charCodeAt(i))) i++;
          unit = input.slice(unitStart, i).toLowerCase();
        }
        tokens.push({ t: "num", v: value, u: unit });
        continue;
      }
      if (isIdentStart(code) && (code !== 45 || isIdentStart(input.charCodeAt(i + 1)))) {
        const start2 = i;
        while (i < length && isIdentChar(input.charCodeAt(i))) i++;
        const word = input.slice(start2, i);
        if (input.charCodeAt(i) === 40) {
          i++;
          tokens.push({ t: "fn", v: word.toLowerCase() });
        } else {
          tokens.push({ t: "ident", v: word });
        }
        continue;
      }
      if (code === 40) {
        tokens.push({ t: "(" });
        i++;
        continue;
      }
      if (code === 41) {
        tokens.push({ t: ")" });
        i++;
        continue;
      }
      if (code === 44) {
        tokens.push({ t: "," });
        i++;
        continue;
      }
      if (code === 43 || code === 45 || code === 42 || code === 47) {
        tokens.push({ t: "op", v: input[i] });
        i++;
        continue;
      }
      return null;
    }
    return tokens;
  }
  function isDigit(code) {
    return code >= 48 && code <= 57;
  }
  function isNumberStart(input, index) {
    const code = input.charCodeAt(index);
    return isDigit(code) || code === 46;
  }
  function isIdentStart(code) {
    return code >= 97 && code <= 122 || code >= 65 && code <= 90 || code === 95 || code === 45 || code > 127;
  }
  function isIdentChar(code) {
    return isIdentStart(code) || isDigit(code);
  }
  function parseTokens(tokens) {
    let position = 0;
    function peek() {
      return tokens[position];
    }
    function next() {
      return tokens[position++];
    }
    function expression() {
      let left = product();
      if (left == null) return null;
      let token = peek();
      while (token && token.t === "op" && (token.v === "+" || token.v === "-")) {
        next();
        const right2 = product();
        if (right2 == null) return null;
        left = { k: OP, op: token.v, a: left, b: right2 };
        token = peek();
      }
      return left;
    }
    function product() {
      let left = unary();
      if (left == null) return null;
      let token = peek();
      while (token && token.t === "op" && (token.v === "*" || token.v === "/")) {
        next();
        const right2 = unary();
        if (right2 == null) return null;
        left = { k: OP, op: token.v, a: left, b: right2 };
        token = peek();
      }
      return left;
    }
    function unary() {
      const token = peek();
      if (token && token.t === "op" && (token.v === "-" || token.v === "+")) {
        next();
        const operand = unary();
        if (operand == null) return null;
        return token.v === "-" ? { k: OP, op: "*", a: { k: PX, v: -1 }, b: operand } : operand;
      }
      return primary();
    }
    function primary() {
      const token = next();
      if (!token) return null;
      if (token.t === "num") return numberNode(token);
      if (token.t === "ident") {
        const word = token.v.toLowerCase();
        if (KEYWORDS.has(word)) return { k: KEYWORD, v: word };
        return { k: KEYWORD, v: word };
      }
      if (token.t === "(") {
        const inner = expression();
        if (inner == null || !peek() || peek().t !== ")") return null;
        next();
        return inner;
      }
      if (token.t === "fn") {
        const args = [];
        if (peek() && peek().t === ")") {
          next();
        } else {
          for (; ; ) {
            if (token.v === "var" && peek() && peek().t === "ident" && args.length === 0) {
              args.push({ k: KEYWORD, v: next().v });
            } else if (token.v === "env" && peek() && peek().t === "ident" && args.length === 0) {
              args.push({ k: KEYWORD, v: next().v });
            } else {
              const argument = expression();
              if (argument == null) return null;
              args.push(argument);
            }
            const after = next();
            if (!after) return null;
            if (after.t === ")") break;
            if (after.t !== ",") return null;
          }
        }
        if (token.v === "calc") return args[0] || null;
        if (token.v === "var") return { k: VAR, name: args[0] && args[0].v, fallback: args[1] || null };
        if (!CALLS.has(token.v)) return { k: CALL, name: token.v, args };
        return { k: CALL, name: token.v, args };
      }
      return null;
    }
    const ast = expression();
    if (ast == null || position !== tokens.length) return null;
    return ast;
  }
  function numberNode(token) {
    if (token.u === "") return { k: PX, v: token.v };
    if (token.u === "%") return { k: PCT, v: token.v };
    if (token.u === "fr") return { k: FR, v: token.v };
    if (token.u === "px") return { k: PX, v: token.v };
    return { k: UNIT, v: token.v, u: token.u };
  }
  function parse2(input) {
    if (input == null) return null;
    if (typeof input === "number") {
      return isFinite(input) ? { k: PX, v: input } : invalid(input);
    }
    if (typeof input === "function") return { k: COMPUTED, fn: input };
    if (typeof input === "object" && input.k) return input;
    if (typeof input !== "string") return invalid(input);
    const text = input.trim();
    if (text === "") return invalid(input);
    const cached = cache.get(text);
    if (cached !== void 0) return cached;
    const tokens = tokenize(text);
    const ast = tokens ? parseTokens(tokens) : null;
    const result = ast || invalid(input);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(text, result);
    return result;
  }
  function invalid(input) {
    warn("MK1002", `cannot parse the length ${JSON.stringify(input)}; falling back to 'auto'`, {
      subject: String(input)
    });
    return { k: KEYWORD, v: "auto", invalid: true };
  }
  function toCSS(ast, options) {
    const node = typeof ast === "object" && ast && ast.k ? ast : parse2(ast);
    if (!node) return "";
    const text = emit2(node, options || {});
    if (node.k === OP && !(options && options.raw)) return `calc(${text})`;
    return text;
  }
  function emit2(node, options) {
    switch (node.k) {
      case PX:
        return node.v === 0 ? "0px" : `${round(node.v)}px`;
      case PCT:
        return `${round(node.v)}%`;
      case FR:
        return `${round(node.v)}fr`;
      case UNIT: {
        const custom = options.units && options.units(node.u);
        if (custom && custom.toCSS) return custom.toCSS(node.v, options);
        return `${round(node.v)}${node.u}`;
      }
      case KEYWORD:
        return node.v;
      case VAR:
        return node.fallback ? `var(${node.name}, ${emit2(node.fallback, options)})` : `var(${node.name})`;
      case CALL: {
        if (node.name === "env") {
          const [first, ...rest] = node.args;
          const tail = rest.map((a) => emit2(a, options));
          return `env(${[first.v, ...tail].join(", ")})`;
        }
        return `${node.name}(${node.args.map((a) => emit2(a, options)).join(", ")})`;
      }
      case OP: {
        const a = emit2(node.a, options);
        const b = emit2(node.b, options);
        const left = node.a.k === OP ? `(${a})` : a;
        const right2 = node.b.k === OP ? `(${b})` : b;
        return `${left} ${node.op} ${right2}`;
      }
      case COMPUTED:
        return "auto";
      default:
        return "auto";
    }
  }
  function round(value) {
    return Math.abs(value % 1) < 1e-6 ? value.toFixed(0) : parseFloat(value.toFixed(4));
  }
  function toNumber(ast, ctx) {
    const node = typeof ast === "object" && ast && ast.k ? ast : parse2(ast);
    if (!node) return NaN;
    const c = ctx || {};
    return evaluate(node, c);
  }
  function evaluate(node, ctx) {
    switch (node.k) {
      case PX:
        return node.v;
      case PCT:
        return node.v / 100 * (ctx.basis || 0);
      case FR: {
        if (!ctx.frTotal) return 0;
        return node.v / ctx.frTotal * (ctx.free || 0);
      }
      case KEYWORD:
        return keywordValue(node.v, ctx);
      case UNIT:
        return unitValue(node, ctx);
      case VAR: {
        const raw = ctx.vars ? ctx.vars(node.name) : void 0;
        if (raw === void 0 || raw === "" || raw === null) {
          return node.fallback ? evaluate(node.fallback, ctx) : NaN;
        }
        return typeof raw === "number" ? raw : toNumber(raw, ctx);
      }
      case CALL:
        return callValue(node, ctx);
      case OP: {
        const a = evaluate(node.a, ctx);
        const b = evaluate(node.b, ctx);
        switch (node.op) {
          case "+":
            return a + b;
          case "-":
            return a - b;
          case "*":
            return a * b;
          case "/":
            return b === 0 ? NaN : a / b;
          default:
            return NaN;
        }
      }
      case COMPUTED:
        return isSignal(node.fn) ? toNumber(parse2(node.fn()), ctx) : node.fn(ctx);
      default:
        return NaN;
    }
  }
  function keywordValue(word, ctx) {
    if (word === "auto" || word === "fit-content" || word === "stretch") {
      return ctx.intrinsic != null ? ctx.intrinsic : NaN;
    }
    if (word === "min-content") return ctx.minContent != null ? ctx.minContent : ctx.intrinsic ?? NaN;
    if (word === "max-content") return ctx.maxContent != null ? ctx.maxContent : ctx.intrinsic ?? NaN;
    if (word === "none") return Infinity;
    return NaN;
  }
  function unitValue(node, ctx) {
    const unit = node.u;
    const metrics = ctx.metrics || {};
    if (unit in ABSOLUTE) return node.v * ABSOLUTE[unit];
    if (FONT_RELATIVE.has(unit)) {
      switch (unit) {
        case "rem":
        case "rlh":
          return node.v * (metrics.rem || 16);
        case "em":
        case "lh":
          return node.v * (ctx.em || metrics.rem || 16);
        case "ex":
          return node.v * (metrics.ex || (ctx.em || metrics.rem || 16) * 0.5);
        case "ch":
        case "ic":
          return node.v * (metrics.ch || (ctx.em || metrics.rem || 16) * 0.5);
        case "cap":
          return node.v * (metrics.cap || (ctx.em || metrics.rem || 16) * 0.7);
        default:
          return node.v * (metrics.rem || 16);
      }
    }
    if (VIEWPORT_RELATIVE.has(unit)) {
      const w = metrics.vw || 0;
      const h = metrics.vh || 0;
      const axis = unit.replace(/^[dsl]/, "");
      switch (axis) {
        case "vw":
        case "vi":
          return node.v / 100 * w;
        case "vh":
        case "vb":
          return node.v / 100 * h;
        case "vmin":
          return node.v / 100 * Math.min(w, h);
        case "vmax":
          return node.v / 100 * Math.max(w, h);
        default:
          return NaN;
      }
    }
    const custom = ctx.units && ctx.units(unit);
    if (custom) return custom.toNumber(node.v, ctx);
    warn("MK1005", `unknown length unit '${unit}'`, { subject: unit });
    return NaN;
  }
  function callValue(node, ctx) {
    const args = node.args.map((a) => a.k === KEYWORD && node.name === "env" ? NaN : evaluate(a, ctx));
    switch (node.name) {
      case "min":
        return Math.min(...args);
      case "max":
        return Math.max(...args);
      case "clamp":
        return Math.min(Math.max(args[1], args[0]), args[2]);
      case "round":
        return Math.round(args[args.length - 1]);
      case "env": {
        const name = node.args[0] && node.args[0].v;
        const safe = ctx.metrics && ctx.metrics.safe || {};
        const value = safeAreaValue(name, safe);
        if (value != null) return value;
        return node.args[1] ? evaluate(node.args[1], ctx) : 0;
      }
      default:
        return NaN;
    }
  }
  function safeAreaValue(name, safe) {
    switch (name) {
      case "safe-area-inset-top":
        return safe.top || 0;
      case "safe-area-inset-right":
        return safe.right || 0;
      case "safe-area-inset-bottom":
        return safe.bottom || 0;
      case "safe-area-inset-left":
        return safe.left || 0;
      default:
        return null;
    }
  }
  function isFlexible(ast) {
    const node = typeof ast === "object" && ast && ast.k ? ast : parse2(ast);
    if (!node) return false;
    if (node.k === FR) return true;
    if (node.k === OP) return isFlexible(node.a) || isFlexible(node.b);
    if (node.k === CALL) return node.args.some(isFlexible);
    return false;
  }
  function isIntrinsic(ast) {
    const node = typeof ast === "object" && ast && ast.k ? ast : parse2(ast);
    if (!node) return false;
    if (node.k === KEYWORD) {
      return node.v === "auto" || node.v === "min-content" || node.v === "max-content" || node.v === "fit-content";
    }
    if (node.k === OP) return isIntrinsic(node.a) || isIntrinsic(node.b);
    if (node.k === CALL) return node.args.some(isIntrinsic);
    return false;
  }
  function frCoefficient(ast) {
    const node = typeof ast === "object" && ast && ast.k ? ast : parse2(ast);
    if (!node) return 0;
    if (node.k === FR) return node.v;
    if (node.k === OP && node.op === "+") return frCoefficient(node.a) + frCoefficient(node.b);
    return 0;
  }
  function distributeFr(tracks, free) {
    const state = tracks.map((track) => ({
      fr: track.fr || 0,
      min: track.min != null ? track.min : 0,
      max: track.max != null ? track.max : Infinity,
      size: 0,
      flexible: (track.fr || 0) > 0,
      frozen: false
    }));
    let fixed = 0;
    for (let i = 0; i < state.length; i++) {
      if (state[i].flexible) continue;
      const base = tracks[i].base != null ? tracks[i].base : 0;
      state[i].size = clampTo(base, state[i].min, state[i].max);
      state[i].frozen = true;
      fixed += state[i].size;
    }
    const budget = free - fixed;
    let pool = budget;
    for (let pass = 0; pass < 4; pass++) {
      const active = state.filter((t) => t.flexible && !t.frozen);
      if (!active.length) break;
      const total = active.reduce((sum, t) => sum + t.fr, 0);
      if (total <= 0) break;
      let froze = false;
      for (const track of active) {
        const wanted = track.fr / total * pool;
        const clamped = clampTo(wanted, track.min, track.max);
        track.size = clamped;
        if (Math.abs(clamped - wanted) > 1e-6) {
          track.frozen = true;
          froze = true;
        }
      }
      if (!froze) break;
      let taken = 0;
      for (const track of state) if (track.flexible && track.frozen) taken += track.size;
      pool = budget - taken;
    }
    return state.map((t) => t.size);
  }
  function clampTo(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  // source/geometry/rect.js
  function rect(x, y, w, h) {
    return { x, y, w, h };
  }
  var ZERO = Object.freeze({ x: 0, y: 0, w: 0, h: 0 });
  function right(r) {
    return r.x + r.w;
  }
  function bottom(r) {
    return r.y + r.h;
  }
  function intersect(a, b) {
    const l = Math.max(a.x, b.x);
    const t = Math.max(a.y, b.y);
    const r = Math.min(right(a), right(b));
    const bo = Math.min(bottom(a), bottom(b));
    return { x: l, y: t, w: Math.max(0, r - l), h: Math.max(0, bo - t) };
  }
  function intersects(a, b) {
    return a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y;
  }
  function clamp(r, bounds, keepVisible) {
    const keep = keepVisible || 0;
    const minX = bounds.x - r.w + Math.max(keep, 0);
    const maxX = right(bounds) - Math.max(keep, 0);
    const minY = bounds.y - r.h + Math.max(keep, 0);
    const maxY = bottom(bounds) - Math.max(keep, 0);
    return {
      x: keep ? Math.min(Math.max(r.x, minX), maxX) : Math.min(Math.max(r.x, bounds.x), right(bounds) - r.w),
      y: keep ? Math.min(Math.max(r.y, minY), maxY) : Math.min(Math.max(r.y, bounds.y), bottom(bounds) - r.h),
      w: r.w,
      h: r.h
    };
  }
  function containsPoint(r, p) {
    return p.x >= r.x && p.x <= right(r) && p.y >= r.y && p.y <= bottom(r);
  }
  function freeze(r) {
    return Object.freeze({ x: r.x, y: r.y, w: r.w, h: r.h });
  }
  var NO_INSET = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
  function normalizeInset(value) {
    if (value == null || value === false) return NO_INSET;
    if (typeof value === "number") return { top: value, right: value, bottom: value, left: value };
    if (Array.isArray(value)) {
      const [a, b = a, c = a, d = b] = value;
      return { top: a, right: b, bottom: c, left: d };
    }
    if (typeof value === "object") {
      if ("x" in value || "y" in value) {
        const x = value.x || 0;
        const y = value.y || 0;
        return { top: y, right: x, bottom: y, left: x };
      }
      return {
        top: value.top || 0,
        right: value.right || 0,
        bottom: value.bottom || 0,
        left: value.left || 0
      };
    }
    return NO_INSET;
  }
  function maxInsets(list) {
    const out = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const raw of list) {
      const i = normalizeInset(raw);
      if (i.top > out.top) out.top = i.top;
      if (i.right > out.right) out.right = i.right;
      if (i.bottom > out.bottom) out.bottom = i.bottom;
      if (i.left > out.left) out.left = i.left;
    }
    return out;
  }
  function insetsEqual(a, b) {
    return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
  }

  // source/geometry/constraints.js
  var PRIORITY = { required: 1e3, strong: 750, medium: 500, weak: 250 };
  var DEFAULT_PRIORITY = PRIORITY.strong;
  var TIE_ORDER = { size: 0, end: 1, start: 2 };
  function priorityOf(value) {
    if (value == null) return DEFAULT_PRIORITY;
    if (typeof value === "number") return value;
    return PRIORITY[value] != null ? PRIORITY[value] : DEFAULT_PRIORITY;
  }
  function present(value) {
    return value !== void 0 && value !== null && value !== false;
  }
  function resolveAxis(spec, ctx) {
    const c = ctx || {};
    const basis = c.basis || 0;
    const lenCtx = { ...c.lenCtx || {}, basis, intrinsic: c.intrinsic };
    const given = [];
    if (present(spec.start)) given.push("start");
    if (present(spec.end)) given.push("end");
    if (present(spec.size)) given.push("size");
    const dropped = [];
    if (given.length === 0) {
      return { mode: "flow", start: 0, size: c.intrinsic != null ? c.intrinsic : 0, end: 0, dropped };
    }
    let use = given;
    if (given.length === 3) {
      const priorities = spec.priority || {};
      const candidates = given.filter((name) => priorityOf(priorities[name]) < PRIORITY.required).sort((a, b) => {
        const delta = priorityOf(priorities[a]) - priorityOf(priorities[b]);
        return delta !== 0 ? delta : TIE_ORDER[a] - TIE_ORDER[b];
      });
      const victim = candidates.length ? candidates[0] : "size";
      dropped.push(victim);
      use = given.filter((name) => name !== victim);
      warn(
        "MK1003",
        `axis over-constrained by start/end/size; dropped '${victim}'. Set priority: { ${victim}: 'weak' } to choose differently.`,
        { subject: c.subject }
      );
    }
    const startLen = present(spec.start) ? resolve(spec.start, lenCtx) : NaN;
    const endLen = present(spec.end) ? resolve(spec.end, lenCtx) : NaN;
    let sizeLen = present(spec.size) ? resolve(spec.size, lenCtx, c) : NaN;
    let start2;
    let extent2;
    const has = (name) => use.indexOf(name) !== -1;
    if (has("start") && has("size")) {
      start2 = startLen;
      extent2 = sizeLen;
    } else if (has("end") && has("size")) {
      extent2 = sizeLen;
      start2 = basis - endLen - extent2;
    } else if (has("start") && has("end")) {
      start2 = startLen;
      extent2 = basis - endLen - startLen;
    } else if (has("size")) {
      extent2 = sizeLen;
      start2 = c.anchorStart != null ? c.anchorStart : 0;
    } else if (has("start")) {
      start2 = startLen;
      extent2 = c.intrinsic != null ? c.intrinsic : 0;
    } else {
      extent2 = c.intrinsic != null ? c.intrinsic : 0;
      start2 = basis - endLen - extent2;
    }
    const bounds = boundsOf(spec, lenCtx);
    const clamped = Math.min(Math.max(extent2, bounds.min), bounds.max);
    if (clamped !== extent2) {
      if (has("end") && !has("start")) start2 += extent2 - clamped;
      extent2 = clamped;
    }
    if (c.keepWithin) {
      const limit = c.keepWithin;
      if (start2 < limit.min) start2 = limit.min;
      if (start2 + extent2 > limit.max) start2 = Math.max(limit.min, limit.max - extent2);
    }
    return { mode: "fixed", start: start2, size: extent2, end: basis - start2 - extent2, dropped };
  }
  function resolve(value, lenCtx, ctx) {
    const ast = parse2(value);
    if (!ast) return NaN;
    if (ctx && isIntrinsic(ast) && ctx.intrinsic == null) {
      return 0;
    }
    const n = toNumber(ast, lenCtx);
    return isFinite(n) ? n : 0;
  }
  function boundsOf(spec, lenCtx) {
    const min = present(spec.min) ? resolve(spec.min, lenCtx) : 0;
    const max = present(spec.max) ? resolve(spec.max, lenCtx) : Infinity;
    return { min: isFinite(min) ? min : 0, max: isFinite(max) ? max : Infinity };
  }
  function axisSpecs(geometry, options) {
    const g = geometry || {};
    const opts = options || {};
    const rtl = opts.direction === "rtl";
    const startX = rtl ? g.inlineEnd : g.inlineStart;
    const endX = rtl ? g.inlineStart : g.inlineEnd;
    const sizeObject = g.size && typeof g.size === "object" ? g.size : null;
    return {
      x: {
        start: pick(g.left, startX),
        end: pick(g.right, endX),
        size: pick(g.width, sizeObject && sizeObject.w),
        min: pick(g.minWidth, g.min && g.min.w),
        max: pick(g.maxWidth, g.max && g.max.w),
        priority: g.priority && (g.priority.x || g.priority)
      },
      y: {
        start: pick(g.top, g.blockStart),
        end: pick(g.bottom, g.blockEnd),
        size: pick(g.height, sizeObject && sizeObject.h),
        min: pick(g.minHeight, g.min && g.min.h),
        max: pick(g.maxHeight, g.max && g.max.h),
        priority: g.priority && (g.priority.y || g.priority)
      }
    };
  }
  function pick(a, b) {
    return a !== void 0 && a !== null ? a : b;
  }

  // source/geometry/anchor.js
  var KEYWORDS2 = {
    "top-left": [0, 0],
    top: [0.5, 0],
    "top-right": [1, 0],
    left: [0, 0.5],
    center: [0.5, 0.5],
    centre: [0.5, 0.5],
    right: [1, 0.5],
    "bottom-left": [0, 1],
    bottom: [0.5, 1],
    "bottom-right": [1, 1]
  };
  var LOGICAL = {
    "inline-start": "left",
    "inline-end": "right",
    "block-start": "top",
    "block-end": "bottom"
  };
  function resolveAnchor(anchor, options) {
    const opts = options || {};
    if (anchor == null) return { fx: 0, fy: 0, dx: 0, dy: 0 };
    if (typeof anchor === "string") {
      const keyword = normalizeKeyword(anchor, opts);
      const pair = KEYWORDS2[keyword];
      if (!pair) {
        const custom = opts.anchors && opts.anchors(anchor);
        if (custom && typeof custom.resolve === "function") {
          const resolved = custom.resolve(opts) || {};
          return {
            fx: resolved.fx || 0,
            fy: resolved.fy || 0,
            dx: resolved.dx || 0,
            dy: resolved.dy || 0
          };
        }
        warn("MK1008", `unknown anchor '${anchor}'; using 'top-left'`, { subject: anchor });
        return { fx: 0, fy: 0, dx: 0, dy: 0 };
      }
      return { fx: pair[0], fy: pair[1], dx: 0, dy: 0 };
    }
    if (Array.isArray(anchor)) {
      const x = component(anchor[0], opts, "x");
      const y = component(anchor[1], opts, "y");
      return { fx: x.f, fy: y.f, dx: x.d, dy: y.d };
    }
    if (typeof anchor === "object") {
      const x = component(anchor.x != null ? anchor.x : 0, opts, "x");
      const y = component(anchor.y != null ? anchor.y : 0, opts, "y");
      return { fx: x.f, fy: y.f, dx: x.d, dy: y.d };
    }
    return { fx: 0, fy: 0, dx: 0, dy: 0 };
  }
  function component(value, opts, axis) {
    if (typeof value === "number") {
      return value >= 0 && value <= 1 ? { f: value, d: 0 } : { f: 0, d: value };
    }
    if (typeof value === "string") {
      const ast = parse2(value);
      if (ast && ast.k === "pct") return { f: ast.v / 100, d: 0 };
      return { f: 0, d: toNumber(ast, opts.lenCtx || {}) || 0 };
    }
    return { f: 0, d: 0 };
  }
  function normalizeKeyword(anchor, options) {
    const opts = options || {};
    const rtl = opts.direction === "rtl";
    const vertical = opts.writingMode && opts.writingMode.indexOf("vertical") === 0;
    const parts = String(anchor).trim().toLowerCase().split(/[\s_]+/).flatMap((part) => part.indexOf("-") !== -1 && !(part in LOGICAL) ? part.split("-") : [part]);
    let physical = [];
    for (const part of parts) {
      const full = LOGICAL[part] ? part : LOGICAL[`${part}-start`] ? part : part;
      if (LOGICAL[full]) physical.push(flip(LOGICAL[full], rtl, vertical, full));
      else physical.push(part);
    }
    const set = new Set(physical);
    if (set.has("center") && set.size === 1) return "center";
    const v = set.has("top") ? "top" : set.has("bottom") ? "bottom" : "";
    const h = set.has("left") ? "left" : set.has("right") ? "right" : "";
    if (v && h) return `${v}-${h}`;
    if (v) return v;
    if (h) return h;
    return physical.join("-");
  }
  function flip(physical, rtl, vertical, logical) {
    if (vertical) {
      if (logical === "inline-start") return "top";
      if (logical === "inline-end") return "bottom";
      if (logical === "block-start") return rtl ? "right" : "left";
      if (logical === "block-end") return rtl ? "left" : "right";
    }
    if (!rtl) return physical;
    if (physical === "left") return "right";
    if (physical === "right") return "left";
    return physical;
  }
  function anchorPoint(box, anchor, options) {
    const a = resolveAnchor(anchor, options);
    return { x: box.x + box.w * a.fx + a.dx, y: box.y + box.h * a.fy + a.dy };
  }
  function place(container, boxSize, spec, options) {
    const opts = options || {};
    const at = spec.at != null ? spec.at : "top-left";
    const anchor = spec.anchor != null ? spec.anchor : at;
    const target = anchorPoint(container, at, opts);
    const self = resolveAnchor(anchor, opts);
    const offset2 = spec.offset || [0, 0];
    const ox = Array.isArray(offset2) ? offset2[0] || 0 : offset2.x || 0;
    const oy = Array.isArray(offset2) ? offset2[1] || 0 : offset2.y || 0;
    return {
      x: target.x - (boxSize.w * self.fx + self.dx) + ox,
      y: target.y - (boxSize.h * self.fy + self.dy) + oy,
      w: boxSize.w,
      h: boxSize.h
    };
  }
  function edgesOf(anchor, options) {
    const keyword = typeof anchor === "string" ? normalizeKeyword(anchor, options) : "";
    return {
      top: keyword.indexOf("top") !== -1,
      bottom: keyword.indexOf("bottom") !== -1,
      left: keyword.indexOf("left") !== -1,
      right: keyword.indexOf("right") !== -1
    };
  }
  function insetOffset(anchor, insetValue, options) {
    if (insetValue == null || insetValue === false) return { x: 0, y: 0 };
    const edges = edgesOf(anchor, options);
    const i = typeof insetValue === "number" ? { top: insetValue, right: insetValue, bottom: insetValue, left: insetValue } : {
      top: insetValue.top || 0,
      right: insetValue.right || 0,
      bottom: insetValue.bottom || 0,
      left: insetValue.left || 0
    };
    let x = 0;
    let y = 0;
    if (edges.left) x += i.left;
    if (edges.right) x -= i.right;
    if (edges.top) y += i.top;
    if (edges.bottom) y -= i.bottom;
    return { x, y };
  }

  // source/geometry/insets.js
  var InsetStack = class {
    constructor() {
      this.entries = /* @__PURE__ */ new Map();
      this._composed = NO_INSET;
      this._dirty = false;
    }
    /**
     * Contribute under `name`. A CSS string such as `'env(safe-area-inset-*)'`
     * is stored as a *resolver* — the metrics snapshot fills in the number each
     * frame rather than the caller measuring once and going stale.
     */
    set(name, value, options) {
      const entry = typeof value === "string" || typeof value === "function" ? { dynamic: value } : { fixed: normalizeInset(value) };
      entry.selfApply = !(options && options.selfApply === false);
      this.entries.set(name, entry);
      this._dirty = true;
      return this;
    }
    delete(name) {
      const had = this.entries.delete(name);
      if (had) this._dirty = true;
      return had;
    }
    has(name) {
      return this.entries.has(name);
    }
    names() {
      return [...this.entries.keys()];
    }
    clear() {
      this.entries.clear();
      this._dirty = true;
    }
    /**
     * The composed inset. `filter` is `false` (opt out entirely), an array of
     * names to include, or undefined for everything.
     */
    compose(metrics, filter, options) {
      if (filter === false) return NO_INSET;
      const forSelf = !!(options && options.forSelf);
      const list = [];
      for (const [name, entry] of this.entries) {
        if (Array.isArray(filter) && filter.indexOf(name) === -1) continue;
        if (forSelf && entry.selfApply === false) continue;
        list.push(entry.fixed ? entry.fixed : resolveDynamic(entry.dynamic, metrics, name));
      }
      const composed = maxInsets(list);
      if (filter === void 0) {
        this._dirty = !insetsEqual(composed, this._composed);
        this._composed = composed;
      }
      return composed;
    }
    /** True when the last full compose produced a different result. */
    get changed() {
      return this._dirty;
    }
    settle() {
      this._dirty = false;
    }
  };
  function resolveDynamic(value, metrics, name) {
    if (typeof value === "function") return normalizeInset(value(metrics));
    if (typeof value === "string" && value.indexOf("safe-area-inset") !== -1) {
      return normalizeInset(metrics && metrics.safe || NO_INSET);
    }
    return NO_INSET;
  }

  // source/engine/invalidate.js
  var STYLE = 1;
  var MEASURE = 2;
  var ARRANGE = 4;
  var PAINT = 8;
  var ALL = STYLE | MEASURE | ARRANGE | PAINT;
  var NAMES = { style: STYLE, measure: MEASURE, arrange: ARRANGE, paint: PAINT, all: ALL };
  function bitsOf(value) {
    if (value == null) return ARRANGE;
    if (typeof value === "number") return value;
    if (Array.isArray(value)) return value.reduce((mask, name) => mask | bitsOf(name), 0);
    return NAMES[value] || 0;
  }
  function invalidate(node, bits) {
    const mask = bitsOf(bits);
    if (!node || !mask) return false;
    let armed = false;
    if (mask & STYLE) armed = setBit(node, STYLE) || armed;
    if (mask & PAINT) armed = setBit(node, PAINT) || armed;
    if (mask & MEASURE) {
      armed = setBit(node, MEASURE) || armed;
      for (let parent = node.parent; parent; parent = parent.parent) {
        armed = setBit(parent, MEASURE | ARRANGE) || armed;
        if (parent.sizeIsFixed) break;
      }
    }
    if (mask & ARRANGE) {
      armed = markSubtree(node) || armed;
    }
    if (armed && node.root && node.root.scheduler) node.root.scheduler.arm();
    return armed;
  }
  function setBit(node, bits) {
    const before = node.flags;
    node.flags |= bits;
    return node.flags !== before;
  }
  function markSubtree(node) {
    let armed = setBit(node, ARRANGE);
    const stack2 = node.children.slice();
    while (stack2.length) {
      const child = stack2.pop();
      if (child.flags & ARRANGE) continue;
      armed = setBit(child, ARRANGE) || armed;
      for (const grandchild of child.children) stack2.push(grandchild);
    }
    return armed;
  }
  function invalidateGeometry(node) {
    return invalidate(node.parent || node, ARRANGE);
  }
  function clear(node, bits) {
    node.flags &= ~bitsOf(bits);
  }

  // source/engine/node.js
  var LayoutNode = class {
    constructor(type, options) {
      const opts = options || {};
      this.type = type;
      this.id = opts.id || null;
      this.key = opts.key || null;
      this.definition = opts.definition || null;
      this.mk = opts.mk || null;
      this.root = opts.root || null;
      this.parent = null;
      this.children = [];
      this.eventParent = null;
      this.props = /* @__PURE__ */ Object.create(null);
      this.layoutProps = /* @__PURE__ */ Object.create(null);
      this.layoutExtras = /* @__PURE__ */ Object.create(null);
      this.geometry = /* @__PURE__ */ Object.create(null);
      this.computed = { x: 0, y: 0, w: 0, h: 0 };
      this.frame = { x: 0, y: 0, w: 0, h: 0 };
      this.insets = new InsetStack();
      this.effectiveInsets = NO_INSET;
      this.flags = MEASURE | ARRANGE;
      this.el = null;
      this.contentEl = null;
      this.algorithm = null;
      this.state = /* @__PURE__ */ Object.create(null);
      this.traits = /* @__PURE__ */ new Map();
      this.slots = /* @__PURE__ */ Object.create(null);
      this.layer = opts.layer || null;
      this.mounted = false;
      this.destroyed = false;
      this.errored = null;
      this.positioning = "parent";
      this.sizeIsFixed = false;
      this.measured = null;
      this.disposers = [];
      this._listeners = null;
      this._capture = null;
      this._pathKey = null;
    }
    // ── Tree ─────────────────────────────────────────────────────────────
    insert(child, before) {
      if (child.parent === this) this.removeChild(child, { keep: true });
      child.parent = this;
      child.root = this.root;
      child.mk = child.mk || this.mk;
      const index = before ? this.children.indexOf(before) : -1;
      if (index === -1) this.children.push(child);
      else this.children.splice(index, 0, child);
      invalidatePaths(child);
      return child;
    }
    removeChild(child, options) {
      const index = this.children.indexOf(child);
      if (index === -1) return false;
      this.children.splice(index, 1);
      if (!(options && options.keep)) child.parent = null;
      invalidatePaths(child);
      return true;
    }
    get index() {
      return this.parent ? this.parent.children.indexOf(this) : -1;
    }
    get depth() {
      let depth = 0;
      for (let node = this.parent; node; node = node.parent) depth++;
      return depth;
    }
    ancestors() {
      const out = [];
      for (let node = this.parent; node; node = node.parent) out.push(node);
      return out;
    }
    /** Depth-first walk, self included. `fn` returning `false` prunes a branch. */
    walk(fn) {
      if (fn(this) === false) return;
      for (const child of this.children.slice()) child.walk(fn);
    }
    find(predicate) {
      let found = null;
      this.walk((node) => {
        if (found) return false;
        if (predicate(node)) {
          found = node;
          return false;
        }
        return true;
      });
      return found;
    }
    findAll(predicate) {
      const out = [];
      this.walk((node) => {
        if (predicate(node)) out.push(node);
      });
      return out;
    }
    contains(other) {
      for (let node = other; node; node = node.parent) if (node === this) return true;
      return false;
    }
    // ── Identity (§8.9) ──────────────────────────────────────────────────
    /**
     * A stable path key derived from position, type, and id:
     * `root/split[0]/pane#main/tabs[2]`.
     *
     * Persistence keys on `id` where present and falls back to this, so a tree
     * with no ids at all still restores correctly as long as its shape is
     * unchanged, and a tree with ids survives being reordered.
     */
    get pathKey() {
      if (this._pathKey) return this._pathKey;
      const segment = this.id ? `${this.type}#${this.id}` : `${this.type}[${this.index}]`;
      this._pathKey = this.parent ? `${this.parent.pathKey}/${segment}` : segment;
      return this._pathKey;
    }
    /** The key persistence uses: `id` when present, the path key otherwise. */
    get persistKey() {
      return this.id || this.pathKey;
    }
    toString() {
      return this.id ? `${this.type}#${this.id}` : this.type;
    }
    // ── Cleanup ──────────────────────────────────────────────────────────
    /** Register a disposable. `ctx.own` routes here (§8.2). */
    own(disposable) {
      if (!disposable) return disposable;
      this.disposers.push(typeof disposable === "function" ? disposable : () => disposable.dispose());
      return disposable;
    }
    /** Run every registered disposer, most recent first. */
    releaseOwned() {
      while (this.disposers.length) {
        const dispose = this.disposers.pop();
        try {
          dispose();
        } catch (error) {
          console.error("[mutakit] disposer threw during teardown", error);
        }
      }
    }
  };
  function invalidatePaths(node) {
    node.walk((n) => {
      n._pathKey = null;
    });
  }
  function snapshot(node, into) {
    const out = into || {};
    node.walk((n) => {
      if (n === node) return;
      if (!n.el && !n.children.length) return;
      out[n.persistKey] = [
        round2(n.computed.x),
        round2(n.computed.y),
        round2(n.computed.w),
        round2(n.computed.h)
      ];
    });
    return out;
  }
  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  // source/engine/metrics.js
  var QUERIES = {
    reducedMotion: "(prefers-reduced-motion: reduce)",
    darkScheme: "(prefers-color-scheme: dark)",
    moreContrast: "(prefers-contrast: more)",
    lessContrast: "(prefers-contrast: less)",
    forcedColors: "(forced-colors: active)",
    coarsePointer: "(pointer: coarse)",
    noHover: "(hover: none)",
    reducedTransparency: "(prefers-reduced-transparency: reduce)"
  };
  function emptySnapshot() {
    return {
      time: 0,
      vw: 0,
      vh: 0,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      dpr: 1,
      rem: 16,
      ch: 8,
      ex: 8,
      scrollbar: 0,
      keyboard: 0,
      safe: { top: 0, right: 0, bottom: 0, left: 0 },
      reducedMotion: false,
      darkScheme: false,
      moreContrast: false,
      lessContrast: false,
      forcedColors: false,
      coarsePointer: false,
      noHover: false,
      reducedTransparency: false,
      features: { dom: false }
    };
  }
  var Metrics = class {
    constructor() {
      this.current = emptySnapshot();
      this.current.features = detectFeatures();
      this.previous = this.current;
      this._queries = null;
      this._probe = null;
      this._disposers = [];
      this.overrides = null;
    }
    /** Install a fixed snapshot. Tests use this; nothing else should. */
    override(values) {
      this.overrides = values;
      if (values) this.current = { ...this.current, ...values };
    }
    /** Take a fresh snapshot. Called once per frame, in READ. */
    take(time) {
      if (this.overrides) {
        this.previous = this.current;
        this.current = { ...this.current, ...this.overrides, time };
        return this.current;
      }
      if (!isBrowser()) {
        this.previous = this.current;
        this.current = { ...this.current, time };
        return this.current;
      }
      const viewport2 = viewport();
      const queries = this._mediaQueries();
      const probe = this._safeAreaProbe();
      const next = {
        time,
        vw: viewport2.w,
        vh: viewport2.h,
        offsetX: viewport2.offsetX,
        offsetY: viewport2.offsetY,
        scale: viewport2.scale,
        dpr: devicePixelRatio(),
        rem: rootFontSize(),
        ch: this.current.ch,
        ex: this.current.ex,
        scrollbar: measureScrollbar(),
        keyboard: keyboardHeight(viewport2),
        safe: probe,
        features: detectFeatures()
      };
      for (const name of Object.keys(QUERIES)) next[name] = queries[name].matches;
      this.previous = this.current;
      this.current = next;
      return next;
    }
    /** The fields that differ from the previous snapshot. */
    diff() {
      const changed = [];
      const a = this.previous;
      const b = this.current;
      for (const key of Object.keys(b)) {
        if (key === "time" || key === "safe" || key === "features") continue;
        if (a[key] !== b[key]) changed.push(key);
      }
      const sa = a.safe || {};
      const sb = b.safe || {};
      if (sa.top !== sb.top || sa.right !== sb.right || sa.bottom !== sb.bottom || sa.left !== sb.left) {
        changed.push("safe");
      }
      return changed;
    }
    _mediaQueries() {
      if (this._queries) return this._queries;
      this._queries = {};
      for (const name of Object.keys(QUERIES)) this._queries[name] = media(QUERIES[name]);
      return this._queries;
    }
    /**
     * Safe-area insets, read from a hidden probe styled with `env()`.
     *
     * There is no direct API for these, and `getComputedStyle` on a probe is the
     * only honest way to get numbers out of `env()`. The probe is created once
     * and read once per frame, so it costs one style read, not a reflow.
     */
    _safeAreaProbe() {
      if (!isBrowser()) return this.current.safe;
      if (!this._probe) {
        const probe = el("div", {
          "aria-hidden": "true",
          style: {
            position: "fixed",
            top: "0",
            left: "0",
            width: "0",
            height: "0",
            visibility: "hidden",
            pointerEvents: "none",
            paddingTop: "env(safe-area-inset-top, 0px)",
            paddingRight: "env(safe-area-inset-right, 0px)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            paddingLeft: "env(safe-area-inset-left, 0px)"
          }
        });
        body().appendChild(probe);
        this._probe = probe;
        this._disposers.push(() => remove(probe));
      }
      const style = computedStyle(this._probe);
      return {
        top: parseFloat(style.paddingTop) || 0,
        right: parseFloat(style.paddingRight) || 0,
        bottom: parseFloat(style.paddingBottom) || 0,
        left: parseFloat(style.paddingLeft) || 0
      };
    }
    destroy() {
      for (const dispose of this._disposers) dispose();
      this._disposers.length = 0;
      this._probe = null;
      this._queries = null;
    }
  };
  function rootFontSize() {
    const size = parseFloat(computedStyle(documentRoot()).fontSize);
    return isFinite(size) && size > 0 ? size : 16;
  }
  function keyboardHeight(visual) {
    const gap = viewportGap(visual);
    return gap > 80 ? gap : 0;
  }

  // source/engine/measure.js
  var Measurer = class {
    constructor() {
      this.pending = /* @__PURE__ */ new Set();
      this.observers = /* @__PURE__ */ new Map();
      this.stub = null;
    }
    /** Install a deterministic intrinsic-size function (§23.2). */
    setStub(fn) {
      this.stub = fn;
    }
    /** Which axes are intrinsic, or null when neither is. */
    intrinsicAxes(node) {
      return intrinsicAxes(node);
    }
    /** Does this node need measuring at all? Strategy 1 lives here. */
    needsMeasure(node) {
      if (node.measureSync) return true;
      const g = node.geometry;
      if (!g) return false;
      const size = g.size && typeof g.size === "object" ? g.size : null;
      const w = g.width != null ? g.width : size && size.w;
      const h = g.height != null ? g.height : size && size.h;
      if (w === void 0 && h === void 0) return true;
      if (w !== void 0 && isIntrinsic(parse2(w))) return true;
      if (h !== void 0 && isIntrinsic(parse2(h))) return true;
      return false;
    }
    /** Strategy 2: observe. Idempotent; the disposer is owned by the node. */
    observe(node) {
      if (!node.el || this.observers.has(node)) return;
      const stop = observeResize(node.el, (entries) => {
        for (const entry of entries) {
          const box = offsetBox(entry.target);
          const measured = { w: box.w, h: box.h };
          if (node.measured && Math.abs(node.measured.w - measured.w) < 0.5 && Math.abs(node.measured.h - measured.h) < 0.5) {
            continue;
          }
          node.measured = measured;
          this.pending.add(node);
          if (node.root && node.root.scheduler) node.root.scheduler.arm();
        }
      });
      this.observers.set(node, stop);
      node.own(() => {
        stop();
        this.observers.delete(node);
        this.pending.delete(node);
      });
    }
    unobserve(node) {
      const stop = this.observers.get(node);
      if (stop) {
        stop();
        this.observers.delete(node);
      }
      this.pending.delete(node);
    }
    /**
     * The READ pass. Runs every node's own `measure` hook, then the batched
     * forced reads. Returns the number of nodes measured, which the scheduler
     * uses only for diagnostics.
     */
    read(nodes, ctxFor) {
      let count = 0;
      const forced = [];
      for (const node of nodes) {
        if (!(node.flags & MEASURE)) continue;
        count++;
        if (this.stub) {
          node.measured = this.stub(node) || node.measured || { w: 0, h: 0 };
          clear(node, MEASURE);
          continue;
        }
        const hooks = node.definition && node.definition.hooks.measure;
        if (hooks && hooks.length) {
          const ctx = ctxFor(node);
          let result = null;
          for (const hook of hooks) {
            const value = node.mk.guard(node, "measure", hook, [ctx, node.frame]);
            if (value) result = value;
          }
          if (result) {
            node.measured = { w: result.w || 0, h: result.h || 0 };
            clear(node, MEASURE);
            continue;
          }
        }
        if (node.measureSync && node.el) forced.push(node);
        else if (node.el) {
          this.observe(node);
          if (!node.measured || intrinsicAxes(node)) forced.push(node);
          else clear(node, MEASURE);
        } else {
          clear(node, MEASURE);
        }
      }
      const unpinned = [];
      for (const node of forced) {
        const axes = intrinsicAxes(node);
        if (!axes) continue;
        if (axes.w) node.el.style.width = "auto";
        if (axes.h) node.el.style.height = "auto";
        unpinned.push({ node, axes });
      }
      for (const node of forced) {
        const box = rectOf(node.el);
        node.measured = { w: box.w, h: box.h };
        clear(node, MEASURE);
      }
      for (const { node, axes } of unpinned) {
        if (axes.w) node.el.style.width = "";
        if (axes.h) node.el.style.height = "";
      }
      this.pending.clear();
      return count;
    }
    destroy() {
      for (const stop of this.observers.values()) stop();
      this.observers.clear();
      this.pending.clear();
    }
  };
  var FLOW_OWNING = /* @__PURE__ */ new Set(["stack", "split", "grid", "dock", "flow"]);
  function intrinsicAxes(node) {
    const g = node.geometry;
    if (!g) return null;
    const parent = node.parent;
    if (!parent) return null;
    if (parent.algorithm && FLOW_OWNING.has(parent.algorithm)) return null;
    const size = g.size && typeof g.size === "object" ? g.size : null;
    const w = g.width != null ? g.width : size && size.w;
    const h = g.height != null ? g.height : size && size.h;
    const axes = {
      w: w == null || isIntrinsic(parse2(w)),
      h: h == null || isIntrinsic(parse2(h))
    };
    return axes.w || axes.h ? axes : null;
  }

  // source/engine/compile.js
  var GEOMETRY_PROPERTIES = [
    "--mk-x",
    "--mk-y",
    "--mk-w",
    "--mk-h",
    "--mk-inset-top",
    "--mk-inset-right",
    "--mk-inset-bottom",
    "--mk-inset-left",
    "--mk-gutter",
    "--mk-track-list",
    "--mk-z"
  ];
  var StyleCompiler = class {
    constructor() {
      this.writes = 0;
      this.skipped = 0;
    }
    /**
     * Stage a custom property on `node`. Nothing reaches the DOM until
     * `flush()` runs in the WRITE phase.
     */
    set(node, name, value) {
      if (!node._pendingStyle) node._pendingStyle = /* @__PURE__ */ new Map();
      node._pendingStyle.set(name, value == null ? null : String(value));
    }
    /** Stage several at once. */
    setAll(node, values) {
      for (const name of Object.keys(values)) this.set(node, name, values[name]);
    }
    /** Stage a plain (non-custom) CSS property. */
    setStyle(node, name, value) {
      if (!node._pendingCss) node._pendingCss = /* @__PURE__ */ new Map();
      node._pendingCss.set(name, value == null ? null : String(value));
    }
    /** Stage a data attribute — state that ordinary CSS selectors can read. */
    setState(node, name, value) {
      if (!node._pendingState) node._pendingState = /* @__PURE__ */ new Map();
      node._pendingState.set(name, value);
    }
    /** Stage the resolved rect, in the units the contract promises (px). */
    setRect(node, r) {
      this.set(node, "--mk-x", `${px(r.x)}px`);
      this.set(node, "--mk-y", `${px(r.y)}px`);
      this.set(node, "--mk-w", `${px(r.w)}px`);
      this.set(node, "--mk-h", `${px(r.h)}px`);
    }
    setInsets(node, insets) {
      this.set(node, "--mk-inset-top", `${px(insets.top)}px`);
      this.set(node, "--mk-inset-right", `${px(insets.right)}px`);
      this.set(node, "--mk-inset-bottom", `${px(insets.bottom)}px`);
      this.set(node, "--mk-inset-left", `${px(insets.left)}px`);
    }
    /**
     * Write everything staged on `node`, skipping properties whose value has not
     * changed. The skip counter is what the benchmark in §20.3 watches.
     */
    flush(node) {
      const el2 = node.el;
      if (!el2) {
        node._pendingStyle = null;
        node._pendingCss = null;
        node._pendingState = null;
        return 0;
      }
      let written = 0;
      if (!node._written) node._written = /* @__PURE__ */ new Map();
      const previous = node._written;
      if (node._pendingStyle) {
        for (const [name, value] of node._pendingStyle) {
          if (previous.get(name) === value) {
            this.skipped++;
            continue;
          }
          previous.set(name, value);
          if (value === null) el2.style.removeProperty(name);
          else el2.style.setProperty(name, value);
          written++;
        }
        node._pendingStyle.clear();
      }
      if (node._pendingCss) {
        for (const [name, value] of node._pendingCss) {
          const key = "!" + name;
          if (previous.get(key) === value) {
            this.skipped++;
            continue;
          }
          previous.set(key, value);
          if (value === null) el2.style.removeProperty(name);
          else el2.style.setProperty(name, value);
          written++;
        }
        node._pendingCss.clear();
      }
      if (node._pendingState) {
        for (const [name, value] of node._pendingState) {
          const key = "@" + name;
          const text = value === true ? "" : value === false || value == null ? null : String(value);
          if (previous.get(key) === text) {
            this.skipped++;
            continue;
          }
          previous.set(key, text);
          const attribute = `data-mk-${name}`;
          if (text === null) el2.removeAttribute(attribute);
          else el2.setAttribute(attribute, text);
          el2.style.setProperty(`--mk-state-${name}`, text === null ? "0" : "1");
          written++;
        }
        node._pendingState.clear();
      }
      this.writes += written;
      return written;
    }
    /** Forget what was written, so the next flush writes everything again. */
    reset(node) {
      node._written = null;
    }
  };
  function px(value) {
    if (!isFinite(value)) return 0;
    return Math.round(value * 100) / 100;
  }

  // source/engine/scheduler.js
  var PHASES = ["input", "state", "read", "arrange", "write", "paint"];
  var MAX_STATE_PASSES = 8;
  var Scheduler = class {
    constructor(options) {
      const opts = options || {};
      this.subject = opts.subject || "root";
      this.budget = opts.budget || 8;
      this.handlers = {};
      for (const phase of PHASES) this.handlers[phase] = [];
      this.armed = false;
      this.running = false;
      this.phase = "idle";
      this.frameId = 0;
      this.frames = 0;
      this.lastDuration = 0;
      this.timings = {};
      this._raf = 0;
      this._deferred = false;
      this._onIdle = [];
      setEffectScheduler(() => this.arm());
      this._stopVisibility = onVisibilityChange(() => {
        if (!this.armed) return;
        this.disarm();
        this.arm();
      });
    }
    /** Register a phase handler. Returns a disposer. */
    on(phase, fn) {
      const list = this.handlers[phase];
      if (!list) throw new Error(`[mutakit] unknown phase '${phase}'`);
      list.push(fn);
      return () => {
        const index = list.indexOf(fn);
        if (index !== -1) list.splice(index, 1);
      };
    }
    /** Ask for a frame. Idempotent — arming twice in one frame is free. */
    arm() {
      if (this.armed) return;
      if (this.running) {
        this._deferred = true;
        return;
      }
      this.armed = true;
      this._raf = raf((time) => this.frame(time));
    }
    /** Cancel a pending frame. */
    disarm() {
      if (!this.armed) return;
      this.armed = false;
      caf(this._raf);
      this._raf = 0;
    }
    /**
     * Force a synchronous flush — for tests, and for the rare case where an
     * author needs a measured value immediately (`mk.tick()`).
     */
    tick(time) {
      this.disarm();
      this.frame(time != null ? time : now());
      return this;
    }
    frame(time) {
      if (this.running) return;
      this.armed = false;
      this.running = true;
      this._deferred = false;
      this.frameId++;
      const started = now();
      try {
        this._run("input", time);
        this._state(time);
        this._run("read", time);
        this._run("arrange", time);
        this._run("write", time);
        this._run("paint", time);
      } finally {
        this.phase = "idle";
        this.running = false;
        this.frames++;
        this.lastDuration = now() - started;
      }
      if (this.lastDuration > this.budget) {
        warn(
          "MK5001",
          `frame took ${this.lastDuration.toFixed(1)}ms against a ${this.budget}ms budget`,
          { subject: this.subject }
        );
      }
      if (this._deferred) {
        this.arm();
      } else {
        const callbacks = this._onIdle.splice(0);
        for (const fn of callbacks) fn();
      }
    }
    /**
     * STATE: flush signal updates and element `update()` callbacks, looping
     * until quiescent. If it is still producing work after 8 passes the frame
     * does not spin — the remainder is deferred and MK5003 names what is
     * oscillating. A runaway effect cycle degrades to a janky UI, never a
     * frozen tab.
     */
    _state(time) {
      this.phase = "state";
      const started = true ? now() : 0;
      let passes = 0;
      let worked = true;
      while (worked && passes < MAX_STATE_PASSES) {
        worked = flushEffects();
        for (const handler of this.handlers.state) {
          if (handler(time, passes)) worked = true;
        }
        passes++;
      }
      if (passes >= MAX_STATE_PASSES && (worked || hasPendingEffects())) {
        warn(
          "MK5003",
          `the STATE phase was still producing work after ${MAX_STATE_PASSES} passes; the rest is deferred to the next frame. Look for an effect that writes a signal it also reads.`,
          { subject: this.subject }
        );
        this._deferred = true;
      }
      if (true) this.timings.state = now() - started;
    }
    _run(phase, time) {
      this.phase = phase;
      const started = true ? now() : 0;
      for (const handler of this.handlers[phase]) handler(time);
      if (true) this.timings[phase] = now() - started;
    }
    /** Run `fn` once the loop is idle. `mk.flush()` awaits this. */
    whenIdle(fn) {
      if (!this.armed && !this.running) {
        fn();
        return;
      }
      this._onIdle.push(fn);
    }
    /**
     * Reading resolved geometry during WRITE is a P4 violation and throws in the
     * development build. It is the one rule that catches thrash at the moment it
     * is written rather than in a profile a week later.
     */
    assertReadable(subject) {
      if (false) return true;
      if (this.phase === "write") {
        fail(
          "MK3015",
          "resolved geometry was read during the WRITE phase. Move the read into ARRANGE or PAINT \u2014 reading here forces a reflow (P4).",
          { subject: subject || this.subject }
        );
        return false;
      }
      return true;
    }
    destroy() {
      this.disarm();
      if (this._stopVisibility) this._stopVisibility();
      for (const phase of PHASES) this.handlers[phase].length = 0;
      this._onIdle.length = 0;
    }
  };

  // source/engine/ctx.js
  function makeContext(node) {
    const mk = node.mk;
    const cached = node._ctx;
    if (cached) return cached;
    const ctx = {
      node,
      get el() {
        return node.el;
      },
      get props() {
        return node.props;
      },
      get state() {
        return node.state;
      },
      get mk() {
        return mk;
      },
      get dev() {
        return true ? mk.dev : null;
      },
      /** Child handles; add, remove, reorder. */
      get children() {
        return node.children.map((child) => mk.handleFor(child));
      },
      get slots() {
        return node.slots;
      },
      /** Read the resolved rect. Valid in ARRANGE and PAINT only (P4). */
      get geometry() {
        mk.scheduler.assertReadable(node.toString());
        return node.computed;
      },
      /** Declared geometry inputs — write to re-constrain the element. */
      constrain(values) {
        Object.assign(node.geometry, values);
        invalidateGeometry(node);
        return ctx;
      },
      emit(name, detail, options) {
        if (!mayEmit(node, name)) {
          fail(
            "MK3003",
            `'${node.type}' emitted '${name}', which neither it nor its attached traits declare in \`events\`. Add it to the definition, or emit a declared name.`,
            { subject: node.toString() }
          );
        }
        return emit(node, name, detail, options);
      },
      on(name, fn, options) {
        return node.own(addListener(node, name, fn, options));
      },
      invalidate(bits) {
        invalidate(node, bits);
        return ctx;
      },
      service(name) {
        return mk.service(name);
      },
      trait(name) {
        const record = node.traits.get(name);
        return record ? record.api : void 0;
      },
      gesture(name, handlers) {
        const gestures = mk.service("gestures");
        if (!gestures) {
          warn("MK3008", `the gestures service is not installed; '${name}' is inert`, {
            subject: node.toString()
          });
          return () => {
          };
        }
        return node.own(gestures.attachTo(node, name, handlers));
      },
      /** Create a DOM element, tracked for automatic teardown. */
      dom(tag, attrs, parent) {
        const element = el(tag, attrs, parent === void 0 ? node.contentEl || node.el : parent);
        node.own(() => remove(element));
        return element;
      },
      /** Write custom properties; diffed by the style compiler (§6.6). */
      css(props) {
        mk.compiler.setAll(node, props);
        invalidate(node, "style");
        return ctx;
      },
      /** Set a state flag: a data attribute plus its `--mk-state-*` mirror. */
      setState(name, value) {
        mk.compiler.setState(node, name, value);
        invalidate(node, "style");
        return ctx;
      },
      /**
       * Read a design token as a number, from the frame's metrics snapshot —
       * never a live `getComputedStyle` (§8.2).
       */
      tokenPx(name, fallback) {
        return mk.tokenPx(name, fallback, node);
      },
      /** Resolve a `Len` against this node's frame, on `axis` ('x' | 'y'). */
      len(value, axis) {
        const frame = node.parent ? node.parent.frame : node.frame;
        const basis = axis === "y" ? frame.h : frame.w;
        return toNumber(parse2(value), mk.lenContext(basis, node));
      },
      /** Register cleanup. The main defence against leaks. */
      own(disposable) {
        return node.own(disposable);
      },
      /** An effect scoped to this element; disposed with it. */
      effect(fn) {
        return node.own(effect(fn));
      },
      /** Announce through the polite or assertive live region (§14). */
      announce(message, urgency) {
        const announcer = mk.service("announcer");
        if (announcer) announcer.say(message, urgency);
      },
      /** Create a child element under this one. */
      create(type, props) {
        return mk.create(type, props, node);
      },
      /** The handle for this node — what commands return to authors. */
      get handle() {
        return mk.handleFor(node);
      }
    };
    node._ctx = ctx;
    return ctx;
  }
  function mayEmit(node, name) {
    if (INTERNAL_EVENTS.has(name)) return true;
    const declared = node.definition && node.definition.events;
    if (declared && declared.indexOf(name) !== -1) return true;
    for (const record of node.traits.values()) {
      if (record.trait.events && record.trait.events.indexOf(name) !== -1) return true;
    }
    return false;
  }
  var INTERNAL_EVENTS = /* @__PURE__ */ new Set([
    "error",
    "mount",
    "unmount",
    "destroy",
    "propschange",
    "geometrychange"
  ]);
  function makeLayoutContext(node, mk) {
    const frame = node.frame;
    return {
      node,
      frame,
      mk,
      get metrics() {
        return mk.metrics.current;
      },
      /** Resolve a `Len` against the container's frame on `axis`. */
      len(value, axis) {
        const basis = axis === "y" ? frame.h : frame.w;
        return toNumber(parse2(value), mk.lenContext(basis, node));
      },
      /** Compile a `Len` list into a grid template string. */
      tracks(axis, lens, options) {
        return mk.compileTracks(node, axis, lens, options);
      },
      /** Assign a child's box directly, in frame space. */
      place(child, rect2) {
        child.computed.x = rect2.x;
        child.computed.y = rect2.y;
        child.computed.w = rect2.w;
        child.computed.h = rect2.h;
        mk.compiler.setRect(child, child.computed);
        return child;
      },
      /** Stage a container-level custom property. */
      css(props) {
        mk.compiler.setAll(node, props);
      },
      /** Stage a plain CSS property on the container. */
      style(name, value) {
        mk.compiler.setStyle(node, name, value);
      },
      /** The validated `layout` bag of a child (§7.0). */
      childProps(child) {
        return child.layoutProps;
      }
    };
  }

  // source/engine/handle.js
  var Handle = class {
    constructor(node) {
      this.node = node;
      this.mk = node.mk;
      attachCommands(this, node);
    }
    get type() {
      return this.node.type;
    }
    get id() {
      return this.node.id;
    }
    get el() {
      return this.node.el;
    }
    get destroyed() {
      return this.node.destroyed;
    }
    get parent() {
      return this.node.parent ? this.mk.handleFor(this.node.parent) : null;
    }
    get children() {
      return this.node.children.map((child) => this.mk.handleFor(child));
    }
    // ── Construction ─────────────────────────────────────────────────────
    /** Create a child element. */
    create(type, props) {
      return this.mk.create(type, props, this.node);
    }
    /** Build a subtree from the tier-2 declarative form (§18.2). */
    build(spec) {
      return this.mk.build(spec, this.node);
    }
    /**
     * Replace this node's layout algorithm with `split` and create its panes
     * (§7.3). Returns one handle per pane, so destructuring reads exactly like
     * the worked example in §5.9.
     */
    split(options) {
      return this.mk.applyAlgorithm(this.node, "split", options);
    }
    stack(options) {
      return this.mk.applyAlgorithm(this.node, "stack", options);
    }
    /**
     * Replace this node's algorithm with `dock` and create its regions (§7.4).
     *
     * Returns *this* handle rather than the regions, because dock's children are
     * named where split's are ordered — `region('body')` says what it means at
     * the call site, and an array would ask the author to remember the order the
     * implementation happened to create them in.
     */
    dock(options) {
      return this.mk.applyAlgorithm(this.node, "dock", options);
    }
    /**
     * A named child of a docked node — `shell.region('body')` (§7.4).
     *
     * Either name works: the region's own (`'center'`) or the id the author gave
     * it (`'body'`). They are the same string unless an id was supplied, since a
     * region with no id takes its region name as one — so accepting both is not
     * two lookups but one, spelled the way the author already thinks of it.
     */
    region(name) {
      for (const child of this.node.children) {
        const bag = child.layoutProps;
        if (child.id === name || bag && bag.region === name) return this.mk.handleFor(child);
      }
      const known = this.node.children.map((child) => child.id).filter(Boolean).join(", ");
      warn("MK2014", `no region '${name}' on '${this.node.type}' (it has ${known || "none"})`, {
        subject: `${this.node.type}.${name}`
      });
      return null;
    }
    grid(options) {
      return this.mk.applyAlgorithm(this.node, "grid", options);
    }
    free(options) {
      return this.mk.applyAlgorithm(this.node, "free", options);
    }
    flow(options) {
      return this.mk.applyAlgorithm(this.node, "flow", options);
    }
    anchor(options) {
      return this.mk.applyAlgorithm(this.node, "anchor", options);
    }
    /** Adopt a DOM node under this one, taking over only its geometry (§8.8). */
    adopt(element, options) {
      return this.mk.adopt(element, options, this.node);
    }
    // ── Props and geometry ───────────────────────────────────────────────
    /** Update props. Values are validated and coerced through the schema. */
    set(props) {
      this.mk.setProps(this.node, props);
      return this;
    }
    get(name) {
      return name === void 0 ? this.node.props : this.node.props[name];
    }
    /** Re-constrain geometry: sizes, anchors, edges (§5). */
    constrain(values) {
      Object.assign(this.node.geometry, values);
      invalidateGeometry(this.node);
      return this;
    }
    /** The resolved rect, as a frozen copy. Valid outside the WRITE phase. */
    rect() {
      this.mk.scheduler.assertReadable(this.node.toString());
      return freeze(this.node.computed);
    }
    /** The child-props bag the parent algorithm reads (§7.0). */
    layout(values) {
      if (values === void 0) return this.node.layoutProps;
      this.mk.setLayoutProps(this.node, values);
      return this;
    }
    // ── Events ───────────────────────────────────────────────────────────
    on(name, fn, options) {
      return addListener(this.node, name, fn, options);
    }
    once(name, fn) {
      return addListener(this.node, name, fn, { once: true });
    }
    emit(name, detail, options) {
      return emit(this.node, name, detail, options);
    }
    // ── Traits ───────────────────────────────────────────────────────────
    /** Attach a trait at runtime, or read an attached trait's API. */
    trait(name, options) {
      if (options === void 0) {
        const record = this.node.traits.get(name);
        return record ? record.api : void 0;
      }
      return this.mk.attachTrait(this.node, name, options);
    }
    // ── Lookup ───────────────────────────────────────────────────────────
    byId(id) {
      const found = this.node.find((n) => n.id === id && n !== this.node);
      return found ? this.mk.handleFor(found) : null;
    }
    query(selector) {
      return this.mk.query(selector, this.node);
    }
    queryAll(selector) {
      return this.mk.queryAll(selector, this.node);
    }
    // ── Lifecycle ────────────────────────────────────────────────────────
    /** Move this element under `parent`. Child props are re-validated (§7.0). */
    moveTo(parent, before) {
      this.mk.reparent(this.node, parent.node || parent, before && (before.node || before));
      return this;
    }
    show() {
      return this.set({ hidden: false });
    }
    hide() {
      return this.set({ hidden: true });
    }
    focus(options) {
      const focus = this.mk.service("focus");
      if (focus) focus.focus(this.node, options);
      else if (this.node.el && this.node.el.focus) this.node.el.focus(options);
      return this;
    }
    /** Remove from the tree and destroy. Exit animations run first (§17). */
    remove() {
      return this.mk.destroy(this.node);
    }
    destroy() {
      return this.mk.destroy(this.node);
    }
    /** The tier-2 form of this subtree (§19.1). */
    serialize(options) {
      return this.mk.serialize(this.node, options);
    }
    toString() {
      return `Handle(${this.node.toString()})`;
    }
  };
  function attachCommands(handle, node) {
    const commands = node.definition && node.definition.commands;
    if (!commands) return;
    for (const name of Object.keys(commands)) {
      if (name in handle) {
        warn(
          "MK3002",
          `command '${name}' on '${node.type}' shadows a built-in handle method and was skipped`,
          { subject: `${node.type}.${name}` }
        );
        continue;
      }
      const command = commands[name];
      handle[name] = function(...args) {
        const result = node.mk.guard(node, `command:${name}`, command, [makeContext(node), ...args]);
        return result === void 0 ? handle : result;
      };
    }
  }

  // source/styles/index.js
  function css(strings, ...values) {
    return strings.reduce((out, part, i) => out + part + (i < values.length ? values[i] : ""), "");
  }
  var LAYER_ORDER = `@layer mutakit.reset, mutakit.tokens, mutakit.base, mutakit.layout, mutakit.element, mutakit.theme, mutakit.user;`;
  var RESET_CSS = css`
  [data-mk-root],
  [data-mk-root] .mk-node {
    box-sizing: border-box;
  }
  [data-mk-root] .mk-node {
    margin: 0;
    min-width: 0;
    min-height: 0;
  }
  [data-mk-root] :where(button, input, select, textarea) {
    font: inherit;
    color: inherit;
  }
`;
  var TOKENS_CSS = css`
  [data-mk-root] {
    /* tier 1 — primitives */
    --mk-gray-50: #f8fafc;
    --mk-gray-100: #f1f5f9;
    --mk-gray-200: #e2e8f0;
    --mk-gray-300: #cbd5e1;
    --mk-gray-500: #64748b;
    --mk-gray-700: #334155;
    --mk-gray-800: #1e293b;
    --mk-gray-900: #0f172a;
    --mk-blue-500: #3b82f6;
    --mk-blue-600: #2563eb;
    --mk-red-500: #ef4444;
    --mk-red-600: #dc2626;
    --mk-amber-500: #f59e0b;
    --mk-green-500: #22c55e;

    --mk-space-1: 4px;
    --mk-space-2: 8px;
    --mk-space-3: 12px;
    --mk-space-4: 16px;
    --mk-space-6: 24px;

    --mk-radius-sm: 3px;
    --mk-radius-md: 6px;
    --mk-radius-lg: 10px;

    --mk-dur-fast: 120ms;
    --mk-dur-med: 200ms;
    --mk-dur-slow: 320ms;
    --mk-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --mk-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);

    --mk-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mk-font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
    --mk-text-sm: 13px;
    --mk-text-md: 14px;
    --mk-text-lg: 16px;

    /* tier 2 — semantic */
    --mk-color-surface: var(--mk-gray-50);
    --mk-color-surface-raised: #ffffff;
    --mk-color-surface-sunken: var(--mk-gray-100);
    --mk-color-accent: var(--mk-blue-600);
    /*
     * red-600, not red-500. White on #ef4444 measures 3.76:1, below WCAG AA's
     * 4.5:1 for normal text, and a destructive button is the last place to be
     * hard to read. Measured by axe-core, not chosen by eye.
     */
    --mk-color-danger: var(--mk-red-600);
    --mk-color-warning: var(--mk-amber-500);
    --mk-color-success: var(--mk-green-500);
    --mk-color-muted: var(--mk-gray-300);
    --mk-text-primary: var(--mk-gray-900);
    --mk-text-secondary: var(--mk-gray-500);
    --mk-border-subtle: var(--mk-gray-200);
    --mk-border-strong: var(--mk-gray-300);
    --mk-elevation-1: 0 1px 2px rgb(15 23 42 / 0.08);
    --mk-elevation-2: 0 4px 12px rgb(15 23 42 / 0.12);
    --mk-elevation-3: 0 12px 32px rgb(15 23 42 / 0.18);
    --mk-focus-ring: 2px solid var(--mk-color-accent);

    /* geometry defaults, so the contract's properties always resolve */
    --mk-gutter: 6px;
    --mk-density: 1;
    --mk-target-min: 24px;

    color: var(--mk-text-primary);
    font-family: var(--mk-font);
    font-size: var(--mk-text-md);
  }

  [data-mk-root][data-mk-scheme="dark"],
  [data-mk-root][data-mk-theme="dark"] {
    --mk-color-surface: var(--mk-gray-900);
    --mk-color-surface-raised: var(--mk-gray-800);
    --mk-color-surface-sunken: #0a1120;
    --mk-color-muted: var(--mk-gray-700);
    --mk-text-primary: var(--mk-gray-100);
    --mk-text-secondary: var(--mk-gray-300);
    --mk-border-subtle: #24324a;
    --mk-border-strong: #35486a;
    --mk-elevation-1: 0 1px 2px rgb(0 0 0 / 0.4);
    --mk-elevation-2: 0 4px 12px rgb(0 0 0 / 0.5);
    --mk-elevation-3: 0 12px 32px rgb(0 0 0 / 0.6);
  }

  @media (prefers-color-scheme: dark) {
    [data-mk-root][data-mk-theme="system"] {
      --mk-color-surface: var(--mk-gray-900);
      --mk-color-surface-raised: var(--mk-gray-800);
      --mk-text-primary: var(--mk-gray-100);
      --mk-text-secondary: var(--mk-gray-300);
      --mk-border-subtle: #24324a;
    }
  }

  [data-mk-root][data-mk-density="compact"] {
    --mk-density: 0.75;
  }
  [data-mk-root][data-mk-density="spacious"] {
    --mk-density: 1.35;
  }
`;
  var BASE_CSS = css`
  [data-mk-root] {
    position: relative;
    contain: layout style;
  }
  .mk-root--viewport {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .mk-node {
    /*
     * Custom properties inherit, and these four must not.
     *
     * Without this reset a node the engine has not sized reads its *parent's*
     * width, so the auto fallback below is unreachable anywhere but the root:
     * an auto size silently resolved to the parent's width, and measuring an
     * auto-sized node returned the parent's box rather than its own content.
     * Setting a custom property to "initial" makes it guaranteed-invalid,
     * which is exactly what makes var() take its fallback — and the engine's
     * inline write still wins over this rule, so nothing the engine does size
     * is affected.
     *
     * The inset properties are deliberately left inheriting: §12.4 publishes
     * them for authors, and a child reading its ancestor's safe-area inset is
     * the point of them.
     */
    --mk-x: initial;
    --mk-y: initial;
    --mk-w: initial;
    --mk-h: initial;
    position: absolute;
    left: var(--mk-x, 0px);
    top: var(--mk-y, 0px);
    width: var(--mk-w, auto);
    height: var(--mk-h, auto);
    contain: layout style;
  }

  /*
   * Algorithms that put children in flow own the whole box, not just its
   * position (§9.1) — size included. Leaving the width var-read in place here
   * would let the engine's computed number override the track the browser
   * resolved, which is P1 exactly backwards: a split's grid tracks would be
   * inert and every drag would have to be computed in JavaScript.
   */
  [data-mk-algorithm="stack"] > .mk-node,
  [data-mk-algorithm="flow"] > .mk-node,
  [data-mk-algorithm="grid"] > .mk-node,
  [data-mk-algorithm="split"] > .mk-node,
  [data-mk-algorithm="dock"] > .mk-node {
    position: relative;
    left: auto;
    top: auto;
    width: auto;
    height: auto;
  }

  [data-mk-hidden] {
    display: none !important;
  }
  [data-mk-errored] {
    outline: 1px dashed var(--mk-color-danger);
    outline-offset: -1px;
  }

  .mk-node:focus-visible {
    outline: var(--mk-focus-ring);
    outline-offset: 2px;
  }

  /* Focus indicators use outline, which forced-colors preserves (§14). */
  @media (forced-colors: active) {
    .mk-node:focus-visible {
      outline: 2px solid Highlight;
    }
  }

  [data-mk-dragging] {
    user-select: none;
    will-change: transform;
  }
`;

  // source/engine/styles.js
  var StyleManager = class {
    constructor(mk) {
      this.mk = mk;
      this.injected = /* @__PURE__ */ new Map();
      this.disposers = [];
      this.written = [];
      this.sink = mk.options && mk.options.styles || injectStyle;
    }
    /**
     * The documents this instance renders into.
     *
     * §10.14's render targets are a supported destination, not a special case:
     * a root mounted into an iframe or a popup window renders there already,
     * because appending an element into another document adopts it. What did
     * *not* follow was the stylesheet — it went to the host document, so the
     * subtree in the frame had no base CSS at all and every node laid itself
     * out at the browser's defaults instead of the engine's.
     */
    documents() {
      const out = /* @__PURE__ */ new Set();
      for (const root of this.mk.roots) {
        if (root.el && root.el.ownerDocument) out.add(root.el.ownerDocument);
      }
      if (!out.size && isBrowser()) out.add(documentRoot());
      return out;
    }
    /** Whether this instance has produced the CSS registered under `key`. */
    has(key) {
      return this.written.some((entry) => entry.key === key);
    }
    /** How many times `key` was written — one per document, never per node. */
    writes(key) {
      let count = 0;
      for (const seen2 of this.injected.values()) if (seen2.has(key)) count++;
      return count;
    }
    /** Give a newly mounted root every sheet this instance has written. */
    ensureDocument() {
      this.ensureBase();
      for (const document2 of this.documents()) {
        for (const entry of this.written) this._write(entry.css, entry.key, entry.options, document2);
      }
    }
    /** The cascade-layer declaration plus reset, tokens, and base rules. */
    ensureBase() {
      if (!isBrowser()) return;
      this._inject(LAYER_ORDER, "layers", { first: true });
      this._inject(wrap("mutakit.reset", scope(RESET_CSS, this.mk.prefix)), "reset");
      this._inject(wrap("mutakit.tokens", scope(TOKENS_CSS, this.mk.prefix)), "tokens");
      this._inject(wrap("mutakit.base", scope(BASE_CSS, this.mk.prefix)), "base");
    }
    /** Inject one element type's styles, once per instance. */
    ensureType(definition) {
      if (!definition || !definition.styles || !definition.styles.length) return;
      const key = `type:${definition.type}`;
      this.ensureBase();
      const css2 = definition.styles.join("\n");
      this._inject(wrap("mutakit.element", scope(css2, this.mk.prefix)), key);
      if (definition.tokens) {
        const tokens = Object.keys(definition.tokens).map((name) => `  ${name}: ${definition.tokens[name]};`).join("\n");
        this._inject(wrap("mutakit.tokens", `:where([data-mk-root]) {
${tokens}
}`), key + ":tokens");
      }
    }
    /** Inject an algorithm's container rules into `mutakit.layout`. */
    ensureLayout(algorithm) {
      if (!algorithm || !algorithm.styles) return;
      const key = `layout:${algorithm.name}`;
      this.ensureBase();
      this._inject(wrap("mutakit.layout", scope(algorithm.styles, this.mk.prefix)), key);
    }
    /** Inject arbitrary CSS into a named layer. Used by themes and traits. */
    add(css2, layer, key) {
      const id = key || `adhoc:${this.written.length}`;
      this.ensureBase();
      this._inject(wrap(layer || "mutakit.element", scope(css2, this.mk.prefix)), id);
    }
    /**
     * Write `css` into every document this instance renders into, once each.
     *
     * Recorded as well as written, so a root mounted later — into a popup, say —
     * receives everything already produced rather than only what happens to be
     * defined after it arrives.
     */
    _inject(css2, key, options) {
      if (!this.written.some((entry) => entry.key === key)) {
        this.written.push({ css: css2, key, options: options || {} });
      }
      if (this.sink !== injectStyle) {
        const remove2 = this.sink(css2, { key, nonce: this.mk.options.nonce, ...options || {} });
        if (typeof remove2 === "function") this.disposers.push(remove2);
        return;
      }
      if (!isBrowser()) return;
      for (const document2 of this.documents()) this._write(css2, key, options, document2);
    }
    _write(css2, key, options, document2) {
      let seen2 = this.injected.get(document2);
      if (!seen2) this.injected.set(document2, seen2 = /* @__PURE__ */ new Set());
      if (seen2.has(key)) return;
      seen2.add(key);
      const remove2 = this.sink(css2, {
        key,
        nonce: this.mk.options.nonce,
        ...options || {},
        root: document2
      });
      this.disposers.push(remove2);
      return remove2;
    }
    destroy() {
      for (const remove2 of this.disposers) remove2();
      this.disposers.length = 0;
      this.injected.clear();
      this.written.length = 0;
    }
  };
  function collectStyles() {
    const chunks = [];
    return {
      sink(css2, options) {
        const key = options && options.key || `adhoc:${chunks.length}`;
        if (chunks.some((chunk) => chunk.key === key)) return () => {
        };
        chunks.push({ key, css: css2 });
        return () => {
          const index = chunks.findIndex((chunk) => chunk.key === key);
          if (index !== -1) chunks.splice(index, 1);
        };
      },
      /** Every rule produced, in the order the cascade layers expect. */
      text() {
        return chunks.map((chunk) => chunk.css).join("\n");
      },
      keys() {
        return chunks.map((chunk) => chunk.key);
      }
    };
  }
  function wrap(layer, css2) {
    return `@layer ${layer} {
${css2}
}`;
  }
  function scope(css2, prefix) {
    if (!prefix || prefix === "mk") return css2;
    return css2.replace(/\.mk-/g, `.${prefix}-`).replace(/--mk-/g, `--${prefix}-`);
  }

  // source/engine/instance.js
  var GEOMETRY_KEYS = /* @__PURE__ */ new Set([
    "size",
    "width",
    "height",
    "min",
    "max",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight",
    "at",
    "anchor",
    "of",
    "offset",
    "inset",
    "left",
    "right",
    "top",
    "bottom",
    "inlineStart",
    "inlineEnd",
    "blockStart",
    "blockEnd",
    "insets",
    "keepWithin",
    "positioning",
    "scrollWith",
    "priority",
    "z"
  ]);
  var RAW_DOM_KEYS = /* @__PURE__ */ new Set(["class", "style"]);
  var STRUCTURAL_KEYS = /* @__PURE__ */ new Set([
    // `before` is the insertion anchor `create` passes to `parent.insert` — an
    // engine key like `id` or `traits`, and it was missing from this list, so
    // the engine reported its own documented option as an undeclared prop.
    // `split` uses it for every gutter, which put an MK3004 in the console of
    // any application with a split in it, blaming an element that never saw it.
    "id",
    "key",
    "before",
    "traits",
    "algorithm",
    "content",
    "slots",
    "children",
    "on",
    "command",
    "class",
    "style",
    "hidden",
    "a11y",
    "layer",
    "layout",
    "measureSync"
  ]);
  var MutakitInstance = class extends Kernel {
    constructor(options) {
      super(options);
      this.metrics = new Metrics();
      this.measurer = new Measurer();
      this.compiler = new StyleCompiler();
      this.styles = new StyleManager(this);
      this.scheduler = new Scheduler({ subject: this.id });
      this.roots = [];
      this.services = /* @__PURE__ */ new Map();
      this.exiting = /* @__PURE__ */ new Set();
      this.handles = /* @__PURE__ */ new WeakMap();
      this.ids = /* @__PURE__ */ new Map();
      this.dev = true ? { diagnostics: [], frames: 0 } : null;
      this._anchorLookup = (name) => this.registry.get("anchor", name);
      this.scheduler.on("read", (time) => this._read(time));
      this.scheduler.on("arrange", () => this._arrange());
      this.scheduler.on("write", () => this._write());
      this.scheduler.on("paint", (time) => this._paint(time));
    }
    // ── Services ───────────────────────────────────────────────────────────
    /** Register a service (layers, focus, motion, …). Returns the service. */
    provide(name, service) {
      this.services.set(name, service);
      if (service && typeof service.attach === "function") service.attach(this);
      return service;
    }
    service(name) {
      const existing = this.services.get(name);
      if (existing) return existing;
      const factory = SERVICE_FACTORIES.get(name);
      return factory ? this.provide(name, factory(this)) : void 0;
    }
    // ── Roots (§5.11) ──────────────────────────────────────────────────────
    /**
     * Mount a root frame onto `target`. Roots are independent (P8) and may nest;
     * geometry does not flow across the boundary, so an `'element'`-mode root
     * inside a pane is how a self-contained widget embeds.
     */
    mount(target, options) {
      const opts = { sizing: this.options.sizing, ...options || {} };
      const element = resolveTarget(target);
      if (!element) {
        return fail("MK1001", `mount target ${JSON.stringify(target)} was not found`, {
          subject: String(target)
        });
      }
      const node = new LayoutNode("root", { mk: this, id: opts.id || null, definition: null });
      node.root = node;
      node.el = element;
      node.contentEl = element;
      node.algorithm = opts.algorithm || "anchor";
      node.sizing = opts.sizing;
      node.fixedSize = opts.size || null;
      node.scheduler = this.scheduler;
      node.mounted = true;
      node.sizeIsFixed = opts.sizing !== "element";
      element.classList.add(`${this.prefix}-root`);
      element.setAttribute("data-mk-root", this.id);
      if (opts.sizing === "viewport") element.classList.add(`${this.prefix}-root--viewport`);
      node.insets.set("safe", "env(safe-area-inset-*)");
      if (opts.sizing === "element") {
        node.own(
          observeResize(element, () => {
            invalidate(node, "arrange");
          })
        );
      }
      if (this.options.theme) this.applyTheme(this.options.theme, node);
      this.roots.push(node);
      this.styles.ensureDocument();
      const pointer = this.services.get("pointer");
      if (pointer) node.own(pointer.observe(node));
      this._attachInputSources();
      invalidate(node, "arrange");
      this.scheduler.arm();
      return this.handleFor(node);
    }
    /**
     * Start the registered input sources (§13.5).
     *
     * `mk.input(name, source)` put the source in the registry and nothing ever
     * called its `attach` — so the gamepad source, the one built-in consumer of
     * §10.8, polled nothing and fed nothing. Registered, documented, and never
     * started: the same shape as the gestures pipeline, one layer up.
     *
     * On mount rather than at registration, because a source binds to an
     * instance's scheduler and there may be no instance when a preset registers
     * one. Once per instance, and disposed with it.
     */
    _attachInputSources() {
      if (!this._inputSources) this._inputSources = /* @__PURE__ */ new Map();
      for (const name of this.registry.names("input")) {
        if (this._inputSources.has(name)) continue;
        const source = this.registry.get("input", name);
        if (!source || typeof source.attach !== "function") continue;
        const stop = this.guard(this.root, `input:${name}.attach`, source.attach, [
          this,
          this.options[name] || {}
        ]);
        this._inputSources.set(name, typeof stop === "function" ? stop : () => {
        });
      }
    }
    /** The first mounted root, which is what the namespace-level API targets. */
    get root() {
      return this.roots[0] || null;
    }
    // ── Element lifecycle (§8.1) ───────────────────────────────────────────
    /**
     * Create an element. `parent` is a node, a handle, or omitted (the first
     * root). Returns a handle carrying the type's declared commands.
     */
    create(type, props, parent) {
      const definition = this.registry.get("type", type);
      if (!definition) {
        const known = this.registry.names("type").slice(0, 8).join(", ");
        return fail(
          "MK3001",
          `unknown element type '${type}'. Registered types include: ${known}. A plugin providing it may not be installed yet.`,
          { subject: type }
        );
      }
      if (definition.abstract) {
        return fail("MK3001", `'${type}' is abstract and cannot be instantiated directly`, {
          subject: type
        });
      }
      const parentNode = nodeOf(parent) || this.root;
      if (!parentNode) {
        return fail("MK1001", `nothing is mounted yet; call Mutakit.mount(target) first`, {
          subject: type
        });
      }
      const options = props || {};
      const node = new LayoutNode(type, {
        mk: this,
        definition,
        id: options.id || null,
        key: options.key || null
      });
      node.root = parentNode.root;
      node.scheduler = this.scheduler;
      node.algorithm = options.algorithm || definition.algorithm || "anchor";
      node.layer = options.layer || definition.layer || null;
      node.measureSync = !!options.measureSync;
      this._splitProps(node, definition, options);
      this._registerId(node);
      const ctx = makeContext(node);
      let element = null;
      for (const hook of definition.hooks.create) {
        const produced = this.guard(node, "create", hook, [ctx, element]);
        if (produced) element = produced;
        if (node.errored) break;
      }
      if (!element && !definition.virtual) element = el("div");
      node.el = element;
      if (!node.contentEl) node.contentEl = element || parentNode.contentEl;
      if (element) {
        element.classList.add(`${this.prefix}-node`, ...this.classNames(type));
        if (node.algorithm) {
          element.setAttribute("data-mk-algorithm", node.algorithm);
          if (node.contentEl && node.contentEl !== element) {
            node.contentEl.setAttribute("data-mk-algorithm", node.algorithm);
          }
        }
        this._applyAlgorithmCSS(node);
        if (node.id) element.setAttribute("data-mk-id", node.id);
        if (options.class) {
          node.className = String(options.class);
          element.classList.add(...node.className.split(/\s+/));
        }
        if (options.style) {
          node.inlineStyle = options.style;
          setStyles(element, options.style);
        }
        node.own(() => remove(element));
      }
      this.styles.ensureType(definition);
      this._applyA11y(node, definition);
      this._attachTraits(node, definition, options);
      this._bindDeclarativeEvents(node, options);
      parentNode.insert(node, nodeOf(options.before));
      if (element && parentNode.contentEl) {
        const beforeNode = nodeOf(options.before);
        insert(parentNode.contentEl, element, beforeNode && beforeNode.el);
      }
      this._validateLayoutProps(node);
      if (options.content !== void 0) this.setContent(node, options.content);
      const declared = definition.slots;
      if (declared) {
        for (const name of Object.keys(declared)) {
          const fill = options.slots && name in options.slots ? options.slots[name] : options[name];
          if (fill !== void 0) this.setSlot(node, name, fill);
        }
      }
      if (options.slots) {
        for (const name of Object.keys(options.slots)) {
          if (!declared || !(name in declared)) this.setSlot(node, name, options.slots[name]);
        }
      }
      if (options.children) for (const child of options.children) this.build(child, node);
      if (node.errored) this._placeholder(node);
      this._mount(node);
      invalidate(node, MEASURE | ARRANGE | STYLE);
      invalidateGeometry(node);
      return this.handleFor(node);
    }
    /**
     * Replace an errored node's subtree with a placeholder **that preserves the
     * node's declared geometry** (§8.10), so surrounding layout does not
     * collapse and the failure stays visually local. This is the half of error
     * isolation that a `try`/`catch` alone cannot give you.
     */
    _placeholder(node) {
      for (const child of node.children.slice()) this.destroy(child);
      if (!node.el) return;
      node.el.setAttribute("data-mk-errored", node.type);
      node.el.textContent = "";
      emit(node, "error", { error: node.errored, hook: "create", node });
      if (true) {
        const message = node.errored ? node.errored.message : "element failed";
        node.el.setAttribute("title", `${node.type}: ${message}`);
      }
    }
    _mount(node) {
      if (node.mounted || node.destroyed) return;
      node.mounted = true;
      const ctx = makeContext(node);
      for (const hook of node.definition ? node.definition.hooks.mount : []) {
        this.guard(node, "mount", hook, [ctx]);
      }
      for (const record of node.traits.values()) {
        if (record.trait.mount) this.guard(node, `trait:${record.trait.name}.mount`, record.trait.mount, [ctx, record.api]);
      }
      emit(node, "mount", { node }, { bubbles: false });
      if (node.definition && node.definition.motion) {
        const motion = this.service("motion");
        if (motion) motion.play(node, "enter");
      }
    }
    /**
     * Destroy a node and its subtree. Teardown of siblings must complete
     * regardless of what one `destroy` does, so hook errors are logged and
     * swallowed (§8.10).
     */
    destroy(node) {
      const target = nodeOf(node);
      if (!target || target.destroyed) return false;
      const motion = !target.exited && target.el && target.definition && target.definition.motion ? this.service("motion") : null;
      if (motion) {
        target.exited = true;
        target.exiting = true;
        target.el.setAttribute("data-mk-exiting", "");
        target.el.setAttribute("inert", "");
        target.el.style.pointerEvents = "none";
        const finish2 = motion.play(target, "exit").then(() => {
          target.exiting = false;
          this.exiting.delete(finish2);
          this.destroy(target);
        });
        this.exiting.add(finish2);
        return false;
      }
      for (const child of target.children.slice()) this.destroy(child);
      const ctx = makeContext(target);
      if (target.mounted) {
        for (const hook of target.definition ? target.definition.hooks.unmount : []) {
          this.guard(target, "unmount", hook, [ctx]);
        }
        target.mounted = false;
      }
      for (const record of [...target.traits.values()].reverse()) {
        if (record.trait.detach) {
          this.guard(target, `trait:${record.trait.name}.detach`, record.trait.detach, [ctx, record.api]);
        }
      }
      for (const hook of target.definition ? target.definition.hooks.destroy : []) {
        this.guard(target, "destroy", hook, [ctx]);
      }
      const gestures = this.services.get("gestures");
      if (gestures) gestures.cancel(target, "destroyed");
      this.measurer.unobserve(target);
      target.releaseOwned();
      target.traits.clear();
      if (target.id && this.ids.get(target.id) === target) this.ids.delete(target.id);
      if (target.definition) {
        const count = this._instanceCounts.get(target.type) || 0;
        this._instanceCounts.set(target.type, Math.max(0, count - 1));
      }
      if (target.parent) target.parent.removeChild(target);
      const rootIndex = this.roots.indexOf(target);
      if (rootIndex !== -1) this.roots.splice(rootIndex, 1);
      target.destroyed = true;
      target._ctx = null;
      this.handles.delete(target);
      return true;
    }
    /** Move a node under a new parent; child props re-validate (§7.0). */
    reparent(node, parent, before) {
      const target = nodeOf(node);
      const newParent = nodeOf(parent);
      if (!target || !newParent) return false;
      if (target.contains(newParent)) {
        return fail("MK2002", `cannot reparent '${target}' into its own descendant`, {
          subject: target.toString()
        });
      }
      if (target.parent) target.parent.removeChild(target);
      newParent.insert(target, before ? nodeOf(before) : null);
      if (target.el && newParent.contentEl) {
        insert(newParent.contentEl, target.el, before && nodeOf(before) && nodeOf(before).el);
      }
      this._validateLayoutProps(target);
      invalidate(newParent, "arrange");
      return true;
    }
    // ── Props ──────────────────────────────────────────────────────────────
    _splitProps(node, definition, options) {
      const geometry = node.geometry;
      const own = {};
      const slots = definition.slots || null;
      const traitNames = /* @__PURE__ */ new Set();
      for (const entry of [...definition.traits || [], ...options.traits || []]) {
        traitNames.add(typeof entry === "string" ? entry : entry.name);
      }
      for (const key of Object.keys(options)) {
        if (GEOMETRY_KEYS.has(key) && !(key in definition.props)) geometry[key] = options[key];
        else if (slots && slots[key] && !(key in definition.props)) continue;
        else if (traitNames.has(key) && !(key in definition.props)) continue;
        else if (!STRUCTURAL_KEYS.has(key)) own[key] = options[key];
      }
      if (options.layout) node.layoutProps = { ...options.layout };
      if (definition.geometry && definition.geometry.defaults) {
        for (const key of Object.keys(definition.geometry.defaults)) {
          const fallback = definition.geometry.defaults[key];
          if (geometry[key] === void 0) {
            geometry[key] = fallback;
            continue;
          }
          if (isPlainObject(fallback) && isPlainObject(geometry[key])) {
            for (const axis of Object.keys(fallback)) {
              if (geometry[key][axis] === void 0) geometry[key][axis] = fallback[axis];
            }
          }
        }
      }
      if (options.positioning) node.positioning = options.positioning;
      const result = validateAll(definition.props, own, { strict: false });
      for (const problem of result.errors) {
        fail("MK3005", `${node.type}.${problem.name}: ${problem.message}`, {
          subject: `${node.type}.${problem.name}`
        });
      }
      if (true) reportUndeclaredProps(node, result.unknown);
      Object.assign(node.props, defaultsOf(definition.props), result.values);
      this._bindSignalProps(node, definition);
    }
    /** A signal passed as a prop binds an effect that re-sets it (§15.1). */
    _bindSignalProps(node, definition) {
      for (const name of Object.keys(node.props)) {
        const value = node.props[name];
        if (!isSignal(value)) continue;
        node.props[name] = read(value);
        node.own(
          effect(() => {
            const next = value();
            if (node.destroyed) return;
            this.setProps(node, { [name]: next });
          })
        );
      }
      this._bindSignalGeometry(node);
    }
    /**
     * The same for geometry, which is not a prop (§15.2).
     *
     * A signal in `size`, `inset`, or an edge resolves correctly the first time —
     * `Len` re-reads it on every arrange — so the value was never wrong. It was
     * only ever *stale*: nothing invalidated the node when the signal changed,
     * so the box kept whatever the last arrange happened to compute, and a store
     * slice driving a pane's width moved when something else forced a frame and
     * not otherwise.
     *
     * Only the node is invalidated, not the tree: geometry is the parent's
     * business, which is what `invalidateGeometry` already encodes.
     */
    _bindSignalGeometry(node) {
      for (const key of Object.keys(node.geometry)) {
        const value = node.geometry[key];
        for (const signal2 of signalsIn(value)) {
          node.own(
            effect(() => {
              signal2();
              if (node.destroyed) return;
              invalidate(node, MEASURE | ARRANGE);
              invalidateGeometry(node);
            })
          );
        }
      }
    }
    /** Update props, validating through the schema and calling `update()`. */
    setProps(node, values) {
      const target = nodeOf(node);
      if (!target || target.destroyed || !values) return target;
      const definition = target.definition;
      const changed = /* @__PURE__ */ new Set();
      for (const name of Object.keys(values)) {
        if (GEOMETRY_KEYS.has(name) && !(definition && name in definition.props)) {
          target.geometry[name] = values[name];
          invalidateGeometry(target);
          continue;
        }
        if (name === "layout") {
          this.setLayoutProps(target, values.layout);
          continue;
        }
        if (name === "content") {
          this.setContent(target, values.content);
          continue;
        }
        const descriptor = definition && definition.props[name];
        let next = values[name];
        if (descriptor) {
          const result = validateValue(descriptor, next, `${target.type}.${name}`);
          if (result.error) {
            fail("MK3005", result.error, { subject: `${target.type}.${name}` });
            continue;
          }
          next = result.value;
        }
        if (target.props[name] === next) continue;
        target.props[name] = next;
        changed.add(name);
      }
      if (!changed.size) return target;
      const ctx = makeContext(target);
      for (const hook of definition ? definition.hooks.update : []) {
        this.guard(target, "update", hook, [ctx, changed]);
      }
      this._applyA11y(target, definition);
      this.persistDirty = true;
      emit(target, "propschange", { changed: [...changed] }, { bubbles: false });
      invalidate(target, STYLE | MEASURE | ARRANGE);
      invalidateGeometry(target);
      return target;
    }
    /**
     * Write the parent algorithm's per-child bag. Only the immediate parent's
     * algorithm validates it, at insertion, reparenting, and mutation (§7.0).
     */
    setLayoutProps(node, values) {
      const target = nodeOf(node);
      if (!target) return target;
      Object.assign(target.layoutProps, values);
      this._validateLayoutProps(target);
      this.persistDirty = true;
      if (target.parent) invalidate(target.parent, "arrange");
      return target;
    }
    _validateLayoutProps(node) {
      const parent = node.parent;
      if (!parent) return;
      const algorithm = this.registry.get("layout", parent.algorithm || "anchor");
      if (!algorithm || !algorithm.childProps) return;
      const schema = algorithm.childProps;
      const result = validateAll(schema, node.layoutProps, { strict: true });
      for (const problem of result.errors) {
        warn("MK2012", `layout.${problem.name}: ${problem.message}`, {
          subject: `${node}.layout.${problem.name}`
        });
      }
      for (const name of result.unknown) {
        node.layoutExtras[name] = node.layoutProps[name];
        warn(
          "MK2012",
          `'${name}' is not a child prop of the '${algorithm.name}' algorithm (it accepts ${Object.keys(schema).join(", ")}). The value is kept but ignored.`,
          { subject: `${node}.layout.${name}` }
        );
      }
      node.layoutProps = { ...node.layoutExtras, ...result.values };
    }
    // ── Content and slots (§8.8) ───────────────────────────────────────────
    /** The `content` prop accepts five forms; this is the one place they meet. */
    setContent(node, content) {
      const target = nodeOf(node);
      const host = target.contentEl || target.el;
      if (!host) return target;
      if (content == null || content === false) {
        setText(host, "");
        target.content = void 0;
        return target;
      }
      if (typeof content === "string" || typeof content === "number") {
        setText(host, content);
        target.content = content;
        return target;
      }
      if (isSignal(content)) {
        const bound = content;
        target.own(
          effect(() => {
            const next = bound();
            if (!target.destroyed) this.setContent(target, next);
          })
        );
        return target;
      }
      if (typeof content === "function") {
        const produced = this.guard(target, "content", content, [makeContext(target)]);
        if (produced && typeof produced.then === "function") {
          this._lazyContent(target, produced);
          return target;
        }
        if (produced) return this.setContent(target, produced);
        return target;
      }
      if (content && typeof content.nodeType === "number") {
        host.appendChild(content);
        return target;
      }
      if (Array.isArray(content)) {
        for (const item of content) this.setContent(target, item);
        return target;
      }
      if (typeof content === "object" && content.type) {
        this.build(content, target);
        return target;
      }
      warn("MK3017", `unsupported \`content\` value on '${target.type}'`, {
        subject: target.toString()
      });
      return target;
    }
    /**
     * Lazy content reserves the element's geometry immediately from its declared
     * size, shows the `loading` slot, and swaps on resolution, so a lazily
     * loaded panel never causes a layout jump (§8.8).
     */
    _lazyContent(node, promise) {
      this.compiler.setState(node, "loading", true);
      promise.then(
        (value) => {
          if (node.destroyed) return;
          this.compiler.setState(node, "loading", false);
          this.setContent(node, value && value.default ? value.default : value);
        },
        (error) => {
          if (node.destroyed) return;
          this.compiler.setState(node, "loading", false);
          this.reportHookError(node, "content", error);
        }
      );
    }
    setSlot(node, name, content) {
      const target = nodeOf(node);
      const declared = target.definition && target.definition.slots;
      if (declared && !(name in declared)) {
        warn(
          "MK3012",
          `'${target.type}' has no slot '${name}' (it declares ${Object.keys(declared).join(", ") || "none"})`,
          { subject: `${target.type}.${name}` }
        );
        return target;
      }
      const slot = target.slots[name] || (target.slots[name] = { name, host: null, nodes: [] });
      const max = declared && declared[name] && declared[name].max;
      if (max != null && slot.nodes.length >= max) {
        warn("MK3013", `slot '${name}' on '${target.type}' accepts at most ${max}`, {
          subject: `${target.type}.${name}`
        });
        return target;
      }
      const host = slot.host || target.contentEl || target.el;
      const previousContent = target.contentEl;
      target.contentEl = host;
      this.setContent(target, content);
      target.contentEl = previousContent;
      return target;
    }
    // ── Tier 2 — declarative objects (§18.2) ───────────────────────────────
    /**
     * Build a subtree from the declarative form. This is the canonical shape:
     * it is what `serialize()` emits, what `restore()` accepts, and what
     * devtools displays and edits (P2).
     */
    build(spec, parent) {
      if (Array.isArray(spec)) return spec.map((one) => this.build(one, parent));
      if (!spec || typeof spec !== "object") return null;
      const parentNode = nodeOf(parent) || this.root;
      const { type, children, panes, regions, content, ...rest } = spec;
      if (!type) {
        return fail("MK3001", "a declarative node needs a `type`", { subject: JSON.stringify(spec).slice(0, 60) });
      }
      const handle = this.create(type, rest, parentNode);
      if (!handle) return null;
      const node = handle.node;
      if (panes) this.applyAlgorithm(node, "split", { ...rest, panes });
      else if (regions) this.applyAlgorithm(node, "dock", { ...rest, regions });
      if (content !== void 0) this.setContent(node, content);
      if (children) for (const child of children) this.build(child, node);
      return handle;
    }
    /**
     * Adopt an element already in the document, taking over only its geometry
     * and leaving it where it is (§8.8). The contract is a guarantee, not a
     * behaviour: Mutakit writes only the §12.4 custom properties, the
     * properties they feed, and `data-mk-*` attributes.
     */
    adopt(element, options, parent) {
      const target = resolveTarget(element);
      if (!target) return fail("MK3001", "adopt() needs an element", { subject: String(element) });
      const opts = options || {};
      const parentNode = nodeOf(parent) || this.root;
      const node = new LayoutNode("adopted", {
        mk: this,
        definition: ADOPTED_DEFINITION,
        id: opts.id || null
      });
      node.root = parentNode.root;
      node.scheduler = this.scheduler;
      node.algorithm = "anchor";
      node.el = target;
      node.contentEl = target;
      node.adopted = {
        parent: target.parentNode,
        next: target.nextSibling,
        cssText: target.style.cssText,
        onDestroy: opts.onDestroy || "return"
      };
      for (const key of Object.keys(opts)) if (GEOMETRY_KEYS.has(key)) node.geometry[key] = opts[key];
      target.setAttribute("data-mk-adopted", this.id);
      parentNode.insert(node, null);
      if (opts.reparent !== false && parentNode.contentEl && target.parentNode !== parentNode.contentEl) {
        parentNode.contentEl.appendChild(target);
      }
      node.own(() => {
        target.removeAttribute("data-mk-adopted");
        for (const property of GEOMETRY_PROPERTY_NAMES) target.style.removeProperty(property);
        for (const property of [...target.style]) {
          if (property.startsWith(`--${this.prefix}-`)) target.style.removeProperty(property);
        }
        for (const attribute of [...target.attributes]) {
          if (attribute.name.startsWith("data-mk-")) target.removeAttribute(attribute.name);
        }
        const policy2 = node.adopted.onDestroy;
        if (policy2 === "remove") remove(target);
        else if (policy2 === "return" && node.adopted.parent) {
          target.style.cssText = node.adopted.cssText;
          node.adopted.parent.insertBefore(target, node.adopted.next);
        }
      });
      this._registerId(node);
      this._mount(node);
      invalidate(node, MEASURE | ARRANGE);
      return this.handleFor(node);
    }
    // ── Published helpers ──────────────────────────────────────────────────
    // Plugins reach the engine only through public API (P3). These four exist
    // because the persistence plugin (§19) needs them and a back door would be
    // the wrong fix.
    /** The element context for a node — the same object its hooks receive. */
    contextFor(node) {
      return makeContext(nodeOf(node));
    }
    /**
     * Put the algorithm's formatting context on the element straight away.
     *
     * ARRANGE stages this every frame and remains the authority — but staged
     * writes flush in WRITE, and READ runs first. So on the frame a container is
     * created it was still `display: block` when its own intrinsic size was
     * measured: a row of children measured as a column, and the number that got
     * written was the width of the widest child rather than the width of the
     * row.
     *
     * Every algorithm's `css()` is a pure function of `algorithmOptions`, which
     * the element's `create` hook has already set by the time this runs — none
     * of them reads the frame or the layout context, which is what makes calling
     * it this early sound rather than merely convenient.
     */
    _applyAlgorithmCSS(node) {
      if (!node.el || !node.algorithm) return;
      const algorithm = this.registry.get("layout", node.algorithm);
      if (!algorithm || !algorithm.css) return;
      const styles = this.guard(node, `layout:${algorithm.name}.css`, algorithm.css, [node, null]);
      if (!styles) return;
      setStyles(node.el, styles);
      if (node.contentEl && node.contentEl !== node.el) setStyles(node.contentEl, styles);
    }
    /** Set dirty bits on a node (§6.2). */
    invalidateNode(node, bits) {
      return invalidate(nodeOf(node), bits);
    }
    /** Keep only the geometry keys of a bag — what a placeholder preserves. */
    geometryOnly(props) {
      const out = {};
      for (const key of Object.keys(props)) if (GEOMETRY_KEYS.has(key)) out[key] = props[key];
      return out;
    }
    /** `props: 'schema'` — reject anything the type does not declare (§21.4). */
    filterToSchema(props, definition) {
      const out = {};
      for (const key of Object.keys(props)) {
        if (RAW_DOM_KEYS.has(key)) {
          warn("MK4015", `restore dropped '${key}': presentation is not restorable under \`props: 'schema'\``, {
            subject: `${definition.type}.${key}`
          });
          continue;
        }
        if (GEOMETRY_KEYS.has(key) || STRUCTURAL_KEYS.has(key) || key in definition.props) {
          out[key] = props[key];
        } else {
          warn("MK4015", `restore dropped '${key}': not declared by '${definition.type}'`, {
            subject: `${definition.type}.${key}`
          });
        }
      }
      return out;
    }
    // ── Traits (§9) ────────────────────────────────────────────────────────
    _attachTraits(node, definition, options) {
      const requested = [...definition.traits || [], ...options.traits || []];
      for (const entry of requested) {
        const name = typeof entry === "string" ? entry : entry.name;
        const staged = node.state.traitOptions && node.state.traitOptions[name];
        const traitOptions = typeof entry === "string" ? options[name] || staged : entry.options;
        this.attachTrait(node, name, traitOptions);
      }
    }
    /** Attach a trait, resolving its dependencies and rejecting conflicts. */
    attachTrait(node, name, options) {
      const target = nodeOf(node);
      if (target.traits.has(name)) return target.traits.get(name).api;
      const trait = this.registry.get("trait", name);
      if (!trait) {
        warn("MK3008", `unknown trait '${name}' on '${target.type}'; it is skipped`, {
          subject: `${target.type}:${name}`
        });
        return void 0;
      }
      for (const required of trait.requires || []) {
        if (!target.traits.has(required)) this.attachTrait(target, required, void 0);
        if (!target.traits.has(required)) {
          warn("MK3009", `trait '${name}' requires '${required}', which is not registered`, {
            subject: `${target.type}:${name}`
          });
          return void 0;
        }
      }
      for (const conflict of trait.conflicts || []) {
        if (target.traits.has(conflict)) {
          warn(
            "MK3010",
            `trait '${name}' conflicts with '${conflict}' already attached to '${target.type}'`,
            { subject: `${target.type}:${name}` }
          );
          return void 0;
        }
      }
      const ctx = makeContext(target);
      if (trait.styles) this.styles.add(trait.styles, "mutakit.element", `trait:${name}`);
      const record = { trait, api: {}, options: options || null };
      target.traits.set(name, record);
      const produced = this.guard(target, `trait:${name}.attach`, trait.attach || noop, [
        ctx,
        record.options || {}
      ]);
      if (produced && typeof produced === "object") {
        Object.defineProperties(record.api, Object.getOwnPropertyDescriptors(produced));
      }
      if (trait.api) {
        for (const key of Object.keys(trait.api)) {
          record.api[key] = (...args) => trait.api[key](ctx, ...args);
        }
      }
      return record.api;
    }
    detachTrait(node, name) {
      const target = nodeOf(node);
      const record = target.traits.get(name);
      if (!record) return false;
      if (record.trait.detach) {
        this.guard(target, `trait:${name}.detach`, record.trait.detach, [makeContext(target), record.api]);
      }
      target.traits.delete(name);
      return true;
    }
    // ── Accessibility (§14, P5) ────────────────────────────────────────────
    _applyA11y(node, definition) {
      if (!node.el || !definition) return;
      const a11y = definition.a11y;
      if (a11y === void 0) return;
      if (a11y === "presentation" || a11y === false) {
        node.el.setAttribute("role", "presentation");
        return;
      }
      const ctx = makeContext(node);
      if (a11y.role) setAttr(node.el, "role", resolveA11yValue(a11y.role, ctx));
      if (a11y.props) {
        for (const name of Object.keys(a11y.props)) {
          setAttr(node.el, name, resolveA11yValue(a11y.props[name], ctx));
        }
      }
    }
    // ── Declarative wiring (§18.2) ─────────────────────────────────────────
    _bindDeclarativeEvents(node, options) {
      if (options.on) {
        for (const name of Object.keys(options.on)) {
          node.own(addNodeListener(node, name, options.on[name]));
        }
      }
      if (options.command) this._bindCommand(node, options.command);
    }
    /**
     * `{ type: 'button', command: 'close' }` walks *up* the node tree to the
     * nearest ancestor declaring that command and invokes it. An unresolved
     * command is MK3011 at build time, not a silent no-op on click (§18.2).
     */
    _bindCommand(node, command) {
      const [targetId, name] = command.indexOf(":") !== -1 ? command.split(":") : [null, command];
      const resolve4 = () => {
        if (targetId) {
          const byId = this.ids.get(targetId);
          return byId && byId.definition && byId.definition.commands[name] ? byId : null;
        }
        for (let current = node.parent; current; current = current.parent) {
          if (current.definition && current.definition.commands && current.definition.commands[name]) {
            return current;
          }
        }
        return null;
      };
      node.own(
        addNodeListener(node, "activate", () => {
          const owner = resolve4();
          if (!owner) {
            warn(
              "MK3011",
              `command '${command}' did not resolve: no ancestor of '${node.type}' declares it`,
              { subject: `${node}:${command}` }
            );
            return;
          }
          this.guard(owner, `command:${name}`, owner.definition.commands[name], [makeContext(owner)]);
        })
      );
      if (true) {
        this.scheduler.whenIdle(() => {
          if (node.destroyed) return;
          if (!resolve4()) {
            warn(
              "MK3011",
              `command '${command}' on '${node.type}' has no owner in the tree; declare it in an ancestor's \`commands\`, or target one by id (command: 'someId:${name}')`,
              { subject: `${node}:${command}` }
            );
          }
        });
      }
    }
    // ── Identity and lookup (§8.9) ─────────────────────────────────────────
    _registerId(node) {
      if (!node.id) return;
      const existing = this.ids.get(node.id);
      if (existing && !existing.destroyed) {
        warn("MK4005", `duplicate id '${node.id}'; lookup returns the first`, { subject: node.id });
        return;
      }
      this.ids.set(node.id, node);
      const count = this._instanceCounts.get(node.type) || 0;
      this._instanceCounts.set(node.type, count + 1);
    }
    byId(id) {
      const node = this.ids.get(id);
      return node && !node.destroyed ? this.handleFor(node) : null;
    }
    /**
     * A full-frame host in a named layer band — `mk.layer('hud', …)` (§16.1).
     *
     * Every overlay family already reaches its band by declaring `layer` on the
     * type, but a *layer itself* had no spelling: §18.5 opens the HUD example
     * with this line, and building it by hand meant knowing which type hosts a
     * band and repeating the four edge constraints that make it full-frame.
     *
     * A band with a `<name>-layer` type registered uses it — `hud` has one, and
     * it carries the pointer-transparency and safe-area insets that make a HUD a
     * HUD. Any other band gets a plain `pane` assigned to it, which is what a
     * plugin registering a new band would otherwise write itself.
     */
    layer(name, options) {
      const type = this.registry.get("type", `${name}-layer`) ? `${name}-layer` : "pane";
      const props = { left: 0, top: 0, right: 0, bottom: 0, ...options || {}, layer: name };
      return this.create(type, props);
    }
    /** A small selector language over the node tree: type, #id, .state. */
    query(selector, scope2) {
      const all = this.queryAll(selector, scope2);
      return all.length ? all[0] : null;
    }
    queryAll(selector, scope2) {
      const match = compileSelector(selector);
      const roots = scope2 ? [nodeOf(scope2)] : this.roots;
      const out = [];
      for (const root of roots) {
        root.walk((node) => {
          if (node !== root && match(node)) out.push(this.handleFor(node));
        });
      }
      return out;
    }
    handleFor(node) {
      if (!node) return null;
      let handle = this.handles.get(node);
      if (!handle) {
        handle = new Handle(node);
        this.handles.set(node, handle);
      }
      return handle;
    }
    className(type) {
      return `${this.prefix}-${type.replace(":", "-")}`;
    }
    /**
     * The type's class and every class it extends, base last (§8.3).
     *
     * `extends` inherited props, commands, a11y, slots and the `create` chain —
     * everything except the styles, because only the concrete type's class was
     * ever applied. `dialog` extends `modal` extends `surface`, so it ran modal's
     * `create`, got a `.mk-modal__header` and a `.mk-modal__body` inside it, and
     * then matched none of the `.mk-modal` or `.mk-surface` rules that draw the
     * panel: no background, no padding, no elevation. The whole overlay family
     * rendered as unstyled boxes on the scrim, and a plain `modal` looked fine,
     * which is what made it hard to see.
     *
     * Derived last in *source* order is what decides the cascade — a base type is
     * defined before the type extending it, so its rules are injected first and
     * the derived type's win ties. The order of the class list itself is not what
     * resolves that, and nothing here should depend on it.
     */
    classNames(type) {
      const names = [];
      const seen2 = /* @__PURE__ */ new Set();
      let current = type;
      while (current && !seen2.has(current)) {
        seen2.add(current);
        names.push(this.className(current));
        const definition = this.registry.get("type", current);
        current = definition && definition.extends;
      }
      return names;
    }
    // ── Layout algorithms (§7) ─────────────────────────────────────────────
    /**
     * Replace a node's algorithm and create the children it describes. Returns
     * one handle per child, so `const [left, right] = app.split({…})` reads
     * exactly like §5.9.
     */
    applyAlgorithm(node, name, options) {
      const target = nodeOf(node);
      const algorithm = this.registry.get("layout", name);
      if (!algorithm) {
        const known = this.registry.names("layout").join(", ");
        return fail("MK2001", `unknown layout algorithm '${name}'. Registered: ${known}`, {
          subject: name
        });
      }
      const opts = options || {};
      target.algorithm = name;
      target.algorithmOptions = algorithm.schema ? validateAll(algorithm.schema, opts, { strict: false }).values : { ...opts };
      if (target.el) target.el.setAttribute("data-mk-algorithm", name);
      this._applyAlgorithmCSS(target);
      const created = [];
      const describedChildren = algorithm.childrenFrom ? algorithm.childrenFrom(opts) : null;
      if (describedChildren) {
        for (const spec of describedChildren) {
          const { type = "pane", ...rest } = spec;
          created.push(this.create(type, rest, target));
        }
      }
      if (algorithm.setup) {
        this.guard(target, `layout:${name}.setup`, algorithm.setup, [
          target,
          makeLayoutContext(target, this)
        ]);
      }
      for (const child of target.children) this._validateLayoutProps(child);
      invalidate(target, "arrange");
      if (algorithm.returns === "self") return this.handleFor(target);
      return created.length ? created : this.handleFor(target);
    }
    /** Compile a `Len` list into a grid track template (§7.3, §7.5). */
    compileTracks(node, axis, lens, options) {
      const opts = options || {};
      const out = [];
      for (const len of lens) {
        if (len && len.raw) out.push(len.raw);
        else out.push(toCSS(parse2(len), { units: (name) => this.registry.get("unit", name) }));
      }
      return opts.join === false ? out : out.join(" ");
    }
    /** The evaluation context `Len.toNumber` needs (§5.2). */
    lenContext(basis, node) {
      return {
        basis,
        metrics: this.metrics.current,
        units: (name) => this.registry.get("unit", name),
        vars: node && node.el ? (name) => readCustomProperty(node.el, name) : void 0,
        intrinsic: node && node.measured ? node.measured.w : void 0
      };
    }
    /** Read a design token as a number, from the metrics snapshot (§8.2). */
    tokenPx(name, fallback, node) {
      const key = name.indexOf("--") === 0 ? name : `--${this.prefix}-${name}`;
      if (!this._tokenCache) this._tokenCache = /* @__PURE__ */ new Map();
      const cacheKey = key + "@" + this.metrics.current.time;
      if (this._tokenCache.has(key) && this._tokenCache.get(key).time === this.metrics.current.time) {
        return this._tokenCache.get(key).value;
      }
      let value = fallback;
      const host = node && node.el || this.root && this.root.el;
      if (host) {
        const raw = readCustomProperty(host, key);
        if (raw) {
          const n = toNumber(parse2(raw), this.lenContext(0, node));
          if (isFinite(n)) value = n;
        }
      }
      this._tokenCache.set(key, { time: this.metrics.current.time, value, cacheKey });
      return value;
    }
    applyTheme(name, node) {
      const theme = this.registry.get("theme", name);
      const host = node && node.el || this.root && this.root.el;
      if (!host) return this;
      if (!theme) {
        host.setAttribute("data-mk-theme", String(name));
        return this;
      }
      host.setAttribute("data-mk-theme", theme.name);
      if (theme.tokens) {
        for (const token of Object.keys(theme.tokens)) host.style.setProperty(token, theme.tokens[token]);
      }
      return this;
    }
    // ── The frame passes ───────────────────────────────────────────────────
    _read(time) {
      this.metrics.take(time);
      const changed = this.metrics.diff();
      if (changed.length) {
        for (const root of this.roots) {
          emit(root, "metrics:change", { changed, metrics: this.metrics.current }, { bubbles: false });
          invalidate(root, "arrange");
        }
      }
      const nodes = [];
      for (const root of this.roots) root.walk((node) => nodes.push(node));
      this.measurer.read(nodes, (node) => makeContext(node));
      this._readBack(nodes);
    }
    /**
     * Record boxes the engine does not compute (§7.6).
     *
     * `flow` hands its children to normal document flow and works out nothing
     * itself, so their `computed` rects stayed at zero — and `computed` is what
     * `handle.rect()` returns, what hit-testing uses, and what §23.2's layout
     * snapshot serializes. A tree with prose in it dumped a subtree of zeroes
     * and the flagship regression technique quietly said nothing about it.
     *
     * §7.5 already states the intent for `grid`: the browser resolves the boxes,
     * and ARRANGE records the same numbers so snapshots and hit tests have them.
     * `grid` can derive them arithmetically; `flow` cannot — text wrapping is not
     * something to reimplement — so it reads them. Here, in READ, which is the
     * phase where reading is legal (P4).
     */
    _readBack(nodes) {
      for (const node of nodes) {
        const parent = node.parent;
        if (!node.el || !parent || parent.algorithm !== "flow") continue;
        const box = offsetBox(node.el);
        node.computed.x = box.x;
        node.computed.y = box.y;
        node.computed.w = box.w;
        node.computed.h = box.h;
      }
    }
    _arrange() {
      for (const root of this.roots) {
        this._sizeRoot(root);
        this._arrangeNode(root);
      }
    }
    _sizeRoot(root) {
      let w = 0;
      let h = 0;
      if (root.sizing === "viewport") {
        w = this.metrics.current.vw;
        h = this.metrics.current.vh;
      } else if (root.sizing === "fixed" && root.fixedSize) {
        w = root.fixedSize.w;
        h = root.fixedSize.h;
      } else if (root.el) {
        const box = rectOf(root.el);
        w = box.w;
        h = box.h;
        if ((w === 0 || h === 0) && !root._zeroReported) {
          root._zeroReported = true;
          warn(
            "MK1001",
            `the mount target measured ${w}\xD7${h}. Give it a size in CSS, or mount with { sizing: 'viewport' } for a full-screen app.`,
            { subject: root.el.tagName ? root.el.tagName.toLowerCase() : "root" }
          );
        }
      }
      root.computed.x = 0;
      root.computed.y = 0;
      root.computed.w = w;
      root.computed.h = h;
    }
    _arrangeNode(node) {
      if (!(node.flags & ARRANGE)) {
        for (const child of node.children) this._arrangeNode(child);
        return;
      }
      node.effectiveInsets = node.insets.compose(this.metrics.current, node.geometry.insets, {
        forSelf: true
      });
      const insets = node.effectiveInsets;
      node.frame.x = insets.left;
      node.frame.y = insets.top;
      node.frame.w = Math.max(0, node.computed.w - insets.left - insets.right);
      node.frame.h = Math.max(0, node.computed.h - insets.top - insets.bottom);
      this.compiler.setInsets(node, insets);
      const algorithm = this.registry.get("layout", node.algorithm || "anchor");
      if (!algorithm) {
        warn("MK2001", `unknown layout algorithm '${node.algorithm}'; falling back to 'anchor'`, {
          subject: node.toString()
        });
        node.algorithm = "anchor";
      }
      const resolved = algorithm || this.registry.get("layout", "anchor");
      this.compiler.setState(node, "algorithm", resolved ? resolved.name : "anchor");
      if (resolved) this.styles.ensureLayout(resolved);
      if (resolved && node.children.length) {
        const ctx = makeLayoutContext(node, this);
        const inFlow = node.children.filter((child) => !isPortalled(child));
        const portalled = node.children.filter(isPortalled);
        this.guard(node, `layout:${resolved.name}.arrange`, resolved.arrange || noop, [
          node,
          inFlow,
          ctx
        ]);
        for (const child of portalled) {
          const host = child.root || node;
          this.resolveBox(child, host.frame, host);
        }
        if (resolved.css) {
          const styles = this.guard(node, `layout:${resolved.name}.css`, resolved.css, [node, ctx]);
          if (styles) for (const key of Object.keys(styles)) this.compiler.setStyle(node, key, styles[key]);
        }
      }
      if (node.definition) {
        for (const hook of node.definition.hooks.arrange) {
          this.guard(node, "arrange", hook, [makeContext(node), node.computed]);
        }
      }
      clear(node, ARRANGE);
      for (const child of node.children) this._arrangeNode(child);
    }
    /**
     * Resolve one child's box against its parent frame using edge constraints
     * and anchors (§5.5–§5.8). Shared by every algorithm that positions children
     * independently — `anchor`, `free`, and the overlay path.
     */
    resolveBox(child, containerFrame, container) {
      const geometry = child.geometry;
      const parent = container || child.parent;
      const frame = geometry.insets === void 0 || !parent ? containerFrame : frameWithInsets(parent, this.metrics.current, geometry.insets);
      const specs = axisSpecs(geometry, { direction: this.options.direction });
      const measured = child.measured || { w: 0, h: 0 };
      const hasEdges = specs.x.start != null || specs.x.end != null || specs.y.start != null || specs.y.end != null;
      const x = resolveAxis(specs.x, {
        basis: frame.w,
        intrinsic: measured.w,
        lenCtx: this.lenContext(frame.w, child),
        subject: child.toString()
      });
      const y = resolveAxis(specs.y, {
        basis: frame.h,
        intrinsic: measured.h,
        lenCtx: this.lenContext(frame.h, child),
        subject: child.toString()
      });
      let box = { x: x.start, y: y.start, w: x.size, h: y.size };
      if (!hasEdges && (geometry.at != null || geometry.anchor != null || geometry.inset != null)) {
        const container2 = { x: 0, y: 0, w: frame.w, h: frame.h };
        const options = {
          direction: this.options.direction,
          lenCtx: this.lenContext(frame.w, child),
          // §10.5's anchor keywords, looked up the way §10.4's units are. Bound
          // once per instance rather than rebuilt here: this runs for every
          // anchored child on every arranged frame, and a fresh closure per call
          // is the kind of allocation a 200-node drag notices.
          anchors: this._anchorLookup
        };
        box = place(container2, { w: box.w, h: box.h }, geometry, options);
        const nudge = insetOffset(geometry.at, geometry.inset, options);
        box.x += nudge.x;
        box.y += nudge.y;
      }
      if (geometry.keepWithin !== false) {
        const bounds = { x: 0, y: 0, w: frame.w, h: frame.h };
        if (geometry.keepWithin === true || geometry.keepWithin === void 0) {
          if (box.w <= frame.w && box.h <= frame.h) box = clamp(box, bounds);
        }
      }
      box.x += frame.x;
      box.y += frame.y;
      child.computed.x = box.x;
      child.computed.y = box.y;
      child.computed.w = box.w;
      child.computed.h = box.h;
      child.sizeIsFixed = x.mode === "fixed" && y.mode === "fixed";
      const dropped = [...x.dropped.map((n) => `x.${n}`), ...y.dropped.map((n) => `y.${n}`)];
      child.droppedConstraints = dropped.length ? dropped : null;
      this.compiler.setRect(child, child.computed);
      return child.computed;
    }
    _write() {
      let written = 0;
      for (const root of this.roots) {
        root.walk((node) => {
          written += this.compiler.flush(node);
          clear(node, STYLE);
        });
      }
      return written;
    }
    _paint(time) {
      for (const root of this.roots) {
        root.walk((node) => {
          if (!(node.flags & PAINT)) return;
          clear(node, PAINT);
          if (!node.definition) return;
          for (const hook of node.definition.hooks.paint) {
            this.guard(node, "paint", hook, [makeContext(node), time]);
          }
        });
      }
    }
    // ── Public loop control ────────────────────────────────────────────────
    /** Force a synchronous flush. Tests use this constantly. */
    tick(time) {
      this.scheduler.tick(time);
      return this;
    }
    /** Resolve once the loop is idle. `{ animations: false }` skips motion. */
    /**
     * Resolve once the loop is idle.
     *
     * `{ animations: false }` finishes every running animation *and* awaits the
     * teardowns their exits were holding open — which is what §17 promises tests
     * so that a snapshot never races an animation.
     */
    async flush(options) {
      if (options && options.animations === false) {
        const motion = this.services.get("motion");
        if (motion) motion.finishAll();
        let guard = 0;
        while (this.exiting.size && guard++ < 32) {
          await Promise.all([...this.exiting]);
          if (motion) motion.finishAll();
        }
      }
      return new Promise((resolve4) => this.scheduler.whenIdle(resolve4));
    }
    /** A `{ key: [x, y, w, h] }` dump of the resolved tree (§23.2). */
    snapshot(scope2) {
      const target = nodeOf(scope2) || this.root;
      return target ? snapshot(target) : {};
    }
    // ── Teardown ───────────────────────────────────────────────────────────
    destroyInstance() {
      for (const root of this.roots.slice()) {
        for (const child of root.children.slice()) this.destroy(child);
        root.releaseOwned();
      }
      this.roots.length = 0;
      if (this._inputSources) {
        for (const stop of this._inputSources.values()) stop();
        this._inputSources.clear();
      }
      for (const service of this.services.values()) if (service && service.destroy) service.destroy();
      this.services.clear();
      this.styles.destroy();
      this.measurer.destroy();
      this.metrics.destroy();
      this.scheduler.destroy();
      this.ids.clear();
      this.destroyed = true;
    }
  };
  function signalsIn(value) {
    if (isSignal(value)) return [value];
    if (!value || typeof value !== "object") return [];
    const out = [];
    for (const inner of Object.keys(value)) {
      if (isSignal(value[inner])) out.push(value[inner]);
    }
    return out;
  }
  var SERVICE_FACTORIES = /* @__PURE__ */ new Map();
  function registerService(name, factory) {
    SERVICE_FACTORIES.set(name, factory);
  }
  var GEOMETRY_PROPERTY_NAMES = GEOMETRY_PROPERTIES;
  var ADOPTED_DEFINITION = {
    type: "adopted",
    version: "1.0.0",
    origin: "core",
    props: /* @__PURE__ */ Object.create(null),
    childProps: /* @__PURE__ */ Object.create(null),
    geometry: null,
    traits: [],
    algorithm: "anchor",
    slots: null,
    layer: null,
    commands: {},
    events: [],
    a11y: void 0,
    keys: {},
    styles: [],
    tokens: null,
    motion: null,
    shadow: false,
    virtual: false,
    hooks: {
      create: [],
      mount: [],
      update: [],
      measure: [],
      arrange: [],
      paint: [],
      unmount: [],
      destroy: [],
      serialize: [],
      restore: []
    }
  };
  function noop() {
  }
  function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  var PORTALLED_LAYERS = /* @__PURE__ */ new Set(["overlay", "modal", "popover", "tooltip", "toast", "devtools"]);
  function isPortalled(node) {
    return !!node.layer && PORTALLED_LAYERS.has(node.layer);
  }
  function frameWithInsets(parent, metrics, filter) {
    const insets = parent.insets.compose(metrics, filter);
    return {
      x: insets.left,
      y: insets.top,
      w: Math.max(0, parent.computed.w - insets.left - insets.right),
      h: Math.max(0, parent.computed.h - insets.top - insets.bottom)
    };
  }
  function reportUndeclaredProps(node, names) {
    names.forEach((name) => {
      warn(
        "MK3004",
        `'${name}' is not declared in the props schema of '${node.type}'; it is kept but nothing reads it. Declare it in \`props\` to get validation, types, and docs.`,
        { subject: `${node.type}.${name}` }
      );
    });
  }
  function nodeOf(value) {
    if (!value) return null;
    if (value instanceof LayoutNode) return value;
    return value.node || null;
  }
  function addNodeListener(node, name, fn) {
    return addListener(node, name, fn);
  }
  function resolveA11yValue(value, ctx) {
    return typeof value === "function" ? value(ctx) : value;
  }
  function compileSelector(selector) {
    const parts = String(selector).trim().split(/\s+/);
    const compiled = parts.map((part) => {
      const type = /^[^#.\[]*/.exec(part)[0];
      const id = /#([^.\[]+)/.exec(part);
      const states = [...part.matchAll(/\.([^.#\[]+)/g)].map((m) => m[1]);
      return (node) => {
        if (type && type !== "*" && node.type !== type) return false;
        if (id && node.id !== id[1]) return false;
        for (const state of states) {
          if (!node.el || !node.el.hasAttribute(`data-mk-${state}`)) return false;
        }
        return true;
      };
    });
    return (node) => {
      if (!compiled[compiled.length - 1](node)) return false;
      let index = compiled.length - 2;
      for (let ancestor = node.parent; ancestor && index >= 0; ancestor = ancestor.parent) {
        if (compiled[index](ancestor)) index--;
      }
      return index < 0;
    };
  }

  // source/geometry/spaces.js
  function convertPoint(p, from, to, refs) {
    if (from === to) return { x: p.x, y: p.y };
    const inViewport = toViewport(p, from, refs);
    return fromViewport(inViewport, to, refs);
  }
  function originOf(space, refs) {
    switch (space) {
      case "viewport":
        return { x: 0, y: 0 };
      case "document":
        return { x: -(refs.scroll ? refs.scroll.x : 0), y: -(refs.scroll ? refs.scroll.y : 0) };
      case "layer":
        return refs.layer ? { x: refs.layer.x, y: refs.layer.y } : { x: 0, y: 0 };
      case "frame":
        return refs.frame ? { x: refs.frame.x, y: refs.frame.y } : { x: 0, y: 0 };
      case "element":
        return refs.element ? { x: refs.element.x, y: refs.element.y } : { x: 0, y: 0 };
      default:
        warn("MK1007", `unknown coordinate space '${space}'`, { subject: space });
        return { x: 0, y: 0 };
    }
  }
  function toViewport(p, from, refs) {
    const origin = originOf(from, refs);
    return { x: p.x + origin.x, y: p.y + origin.y };
  }
  function fromViewport(p, to, refs) {
    const origin = originOf(to, refs);
    return { x: p.x - origin.x, y: p.y - origin.y };
  }

  // source/namespace.js
  var GlobalKernel = class extends MutakitInstance {
    constructor() {
      super({ inherit: false });
      this.registry = globalRegistry;
    }
  };
  var globalKernel = null;
  var defaultInstance = null;
  var installed = [];
  function kernel() {
    if (!globalKernel) globalKernel = new GlobalKernel();
    return globalKernel;
  }
  function instance() {
    if (!defaultInstance || defaultInstance.destroyed) {
      defaultInstance = new MutakitInstance();
      applyPlugins(defaultInstance);
    }
    return defaultInstance;
  }
  function applyPlugins(mk) {
    for (const entry of installed) mk.use(entry.plugin, entry.options);
    return mk;
  }
  var Mutakit = {
    VERSION,
    version: VERSION,
    /**
     * Overloaded, because both readings appear throughout the design and both
     * are natural: a string is an element type on the default instance
     * (`Mutakit.create('modal', …)` — §5.9), an object is a new instance
     * (`Mutakit.create({ theme: 'dark' })` — §8.6).
     */
    create(typeOrOptions, props) {
      if (typeof typeOrOptions === "string") return instance().create(typeOrOptions, props);
      const mk = new MutakitInstance(typeOrOptions);
      if (!typeOrOptions || typeOrOptions.inherit !== false) applyPlugins(mk);
      return mk;
    },
    /** Mount a root frame. Returns a handle (§5.11). */
    mount(target, options) {
      return instance().mount(target, options);
    },
    /** The default instance, created on first use. */
    get default() {
      return instance();
    },
    /** Replace the default instance. Tests use this between cases. */
    reset() {
      if (defaultInstance) defaultInstance.destroyInstance();
      defaultInstance = null;
      resetDiagnostics();
      return this;
    },
    // ── Registration, against the global registry ────────────────────────
    define: (definition, options) => kernel().define(definition, options),
    trait: (trait, options) => kernel().trait(trait, options),
    layout: (algorithm, options) => kernel().layout(algorithm, options),
    unit: (name, definition, options) => kernel().unit(name, definition, options),
    anchor: (name, resolve4, options) => kernel().anchor(name, resolve4, options),
    placement: (name, strategy, options) => kernel().placement(name, strategy, options),
    theme: (name, definition, options) => kernel().theme(name, definition, options),
    motion: (name, preset, options) => kernel().motion(name, preset, options),
    input: (name, source, options) => kernel().input(name, source, options),
    gesture: (name, recognizer, options) => kernel().gesture(name, recognizer, options),
    serializer: (migration, options) => kernel().serializer(migration, options),
    /** A custom prop type for schemas — §10's eleventh extension point. */
    validator: (name, check, options) => kernel().validator(name, check, options),
    /** Collect CSS instead of injecting it — §10.15's built-in sink. */
    collectStyles,
    /** A number, date, or message formatter used by built-ins — §10.13. */
    formatter: (name, fn, options) => kernel().formatter(name, fn, options),
    /** A devtools panel — §10.12. */
    panel: (name, definition, options) => kernel().panel(name, definition, options),
    /**
     * Install a plugin into every instance this namespace makes (§8.5).
     *
     * Recorded before it is applied, so an instance created later — or a default
     * instance recreated after `reset()` — gets the same set. `use()` on an
     * instance directly still installs into that one alone.
     */
    use(plugin, options) {
      for (const one of Array.isArray(plugin) ? plugin : [plugin]) {
        if (one) installed.push({ plugin: one, options });
      }
      instance().use(plugin, options);
      return this;
    },
    registry: {
      list: () => globalRegistry.list(),
      has: (kind, name) => globalRegistry.has(kind, name),
      get: (kind, name) => globalRegistry.get(kind, name)
    },
    // ── Reactivity (§15.1) ───────────────────────────────────────────────
    signal,
    computed,
    effect,
    batch,
    untrack,
    // ── Lookup and lifecycle on the default instance ─────────────────────
    byId: (id) => instance().byId(id),
    query: (selector, scope2) => instance().query(selector, scope2),
    queryAll: (selector, scope2) => instance().queryAll(selector, scope2),
    build: (spec, parent) => instance().build(spec, parent),
    layer: (name, options) => instance().layer(name, options),
    adopt: (element, options, parent) => instance().adopt(element, options, parent),
    serialize: (scope2, options) => instance().serialize(scope2, options),
    restore: (json, options) => instance().restore(json, options),
    persist: (key, options) => instance().persist(key, options),
    tick: (time) => instance().tick(time),
    flush: (options) => instance().flush(options),
    /**
     * A *curated* geometry surface.
     *
     * Deliberately not `{ Len, Rect, Anchor, Spaces }` as namespace objects. A
     * re-exported namespace is a live binding to every export of its module, so
     * that spelling pinned a dozen functions core never calls into every bundle
     * — `outset`, `union`, `containsRect`, `invertMatrix`, and the rest. It also
     * published a surface §10's complete list of extension points never promised,
     * on top of §8.2's "ctx is the only surface a plugin sees".
     *
     * What is here is what a plugin plausibly needs and nothing else. Anything
     * further should arrive as a named extension point, not by widening this.
     */
    geometry: {
      parse: parse2,
      toCSS,
      toNumber,
      rect,
      intersect,
      clamp,
      containsPoint,
      resolveAnchor,
      place
    },
    convert: (p, from, to, refs) => convertPoint(p, from, to, refs),
    /**
     * Run a definition against the contract (§8.7).
     *
     * Development-only: it runs automatically on every `define()` in the
     * development build and is published as a *test* utility, and tests run
     * against that build. Production returns nothing rather than carrying a
     * checker nobody can act on.
     */
    conformance(definition) {
      if (false) return [];
      const resolved = definition.extends ? resolveDefinition(definition, globalRegistry.get("type", definition.extends), {}) : null;
      return conformance(definition, resolved);
    },
    conformanceTrait(trait) {
      return true ? conformanceTrait(trait) : [];
    },
    diagnostics: {
      catalogue: CATALOGUE,
      sink: setDiagnosticSink,
      reset: resetDiagnostics
    },
    /** Test-only hooks (§23.1, §23.2). Present in both builds; harmless unused. */
    testing: {
      clock: setClock,
      counters,
      measurer(fn) {
        instance().measurer.setStub(fn);
        return instance();
      },
      metrics(values) {
        instance().metrics.override(values);
        return instance();
      }
    }
  };

  // source/layout/anchor.js
  var anchorLayout = {
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
    styles: `
    /*
     * The :not(.mk-node) guard is load-bearing, not tidiness. This rule and
     * the base stylesheet's absolute positioning have the same specificity,
     * and the layout layer comes after base \u2014 so without the guard every node
     * hosting this algorithm (which is every node, since it is the default)
     * turned relative, and a relatively positioned box offsets from where flow
     * put it. The engine wrote y=200 and the browser drew the element at 250,
     * displaced by the height of the sibling above it. Absolute positioning
     * establishes a containing block just as relative does, so the guard costs
     * nothing: the root, which is not a node element, still gets it.
     */
    [data-mk-algorithm="anchor"]:not(.mk-node) {
      position: relative;
    }
    [data-mk-algorithm="anchor"] > .mk-node {
      z-index: var(--mk-z, auto);
    }
  `
  };

  // source/layout/stack.js
  var stackLayout = {
    name: "stack",
    version: "1.0.0",
    schema: {
      axis: { type: "enum", values: ["x", "y"], default: "y" },
      gap: { type: "len", default: 0 },
      align: {
        type: "enum",
        values: ["start", "center", "end", "stretch", "baseline"],
        default: "stretch"
      },
      justify: {
        type: "enum",
        values: ["start", "center", "end", "between", "around", "evenly"],
        default: "start"
      },
      wrap: { type: "boolean", default: false },
      reverse: { type: "boolean", default: false },
      padding: { type: "any" }
    },
    childProps: {
      size: { type: "len", default: "auto" },
      min: { type: "len" },
      max: { type: "len" },
      align: { type: "enum", values: ["start", "center", "end", "stretch", "baseline"] },
      order: { type: "number" }
    },
    /** `stack({ children: [...] })` — the fluent form's sugar. */
    childrenFrom(options) {
      return options.children || null;
    },
    arrange(node, children, ctx) {
      const options = node.algorithmOptions || {};
      const axis = options.axis || "y";
      const main = axis === "x" ? "w" : "h";
      const cross = axis === "x" ? "h" : "w";
      const mainPos = axis === "x" ? "x" : "y";
      const crossPos = axis === "x" ? "y" : "x";
      const frame = node.frame;
      const gap = ctx.len(options.gap || 0, axis);
      const visible = children.filter((child) => !child.destroyed && !child.props.hidden);
      if (!visible.length) return;
      const available = frame[main] - gap * (visible.length - 1);
      const lenCtx = ctx.mk.lenContext(frame[main], node);
      const tracks = visible.map((child) => {
        const bag = child.layoutProps || {};
        const declared = bag.size != null ? bag.size : sizeFromGeometry(child, main);
        const ast = parse2(declared);
        const intrinsic = child.measured ? child.measured[main] : 0;
        const flexible = isFlexible(ast);
        return {
          fr: flexible ? frCoefficient(ast) : 0,
          base: flexible ? 0 : resolveBase(ast, lenCtx, intrinsic),
          min: bag.min != null ? toNumber(parse2(bag.min), lenCtx) : 0,
          max: bag.max != null ? toNumber(parse2(bag.max), lenCtx) : Infinity
        };
      });
      const sizes = distributeFr(tracks, available);
      const used = sizes.reduce((sum, s) => sum + s, 0) + gap * (visible.length - 1);
      const slack = Math.max(0, frame[main] - used);
      const hasFlex = tracks.some((t) => t.fr > 0);
      let cursor = frame[axis === "x" ? "x" : "y"] + (hasFlex ? 0 : leadingOffset(options.justify, slack));
      const spacing = hasFlex ? 0 : betweenOffset(options.justify, slack, visible.length);
      for (let i = 0; i < visible.length; i++) {
        const child = visible[i];
        const bag = child.layoutProps || {};
        const align = bag.align || options.align || "stretch";
        const crossSize = crossExtent(child, node, cross, align, ctx);
        child.computed[mainPos] = cursor;
        child.computed[main] = sizes[i];
        child.computed[crossPos] = frame[crossPos] + crossOffset(align, frame[cross], crossSize);
        child.computed[cross] = crossSize;
        child.sizeIsFixed = tracks[i].fr === 0;
        ctx.mk.compiler.setRect(child, child.computed);
        ctx.mk.compiler.setStyle(child, "flex", flexFor(tracks[i], sizes[i]));
        if (bag.order != null) ctx.mk.compiler.setStyle(child, "order", String(bag.order));
        if (align !== (options.align || "stretch")) {
          ctx.mk.compiler.setStyle(child, "align-self", cssAlign(align));
        }
        cursor += sizes[i] + gap + spacing;
      }
    },
    css(node, ctx) {
      const options = node.algorithmOptions || {};
      const axis = options.axis || "y";
      const direction = axis === "x" ? "row" : "column";
      return {
        display: "flex",
        "flex-direction": options.reverse ? `${direction}-reverse` : direction,
        "flex-wrap": options.wrap ? "wrap" : "nowrap",
        gap: cssLength(options.gap),
        "align-items": cssAlign(options.align || "stretch"),
        "justify-content": cssJustify(options.justify || "start"),
        padding: options.padding != null ? cssLength(options.padding) : null
      };
    },
    styles: `
    [data-mk-algorithm="stack"] {
      display: flex;
    }
  `
  };
  function sizeFromGeometry(child, main) {
    const g = child.geometry || {};
    const size = g.size && typeof g.size === "object" ? g.size : null;
    const value = main === "w" ? g.width != null ? g.width : size && size.w : g.height != null ? g.height : size && size.h;
    return value != null ? value : "auto";
  }
  function resolveBase(ast, lenCtx, intrinsic) {
    const value = toNumber(ast, { ...lenCtx, intrinsic });
    return isFinite(value) ? value : intrinsic || 0;
  }
  function crossExtent(child, node, cross, align, ctx) {
    if (align === "stretch") return node.frame[cross];
    const declared = sizeFromGeometry(child, cross);
    if (declared === "auto") return child.measured ? child.measured[cross] : 0;
    const value = toNumber(parse2(declared), ctx.mk.lenContext(node.frame[cross], child));
    return isFinite(value) ? value : 0;
  }
  function crossOffset(align, available, size) {
    if (align === "center") return Math.max(0, (available - size) / 2);
    if (align === "end") return Math.max(0, available - size);
    return 0;
  }
  function leadingOffset(justify, slack) {
    switch (justify) {
      case "center":
        return slack / 2;
      case "end":
        return slack;
      case "around":
        return 0;
      case "evenly":
        return 0;
      default:
        return 0;
    }
  }
  function betweenOffset(justify, slack, count) {
    if (count < 2) return 0;
    if (justify === "between") return slack / (count - 1);
    if (justify === "around") return slack / count;
    if (justify === "evenly") return slack / (count + 1);
    return 0;
  }
  function flexFor(track, size) {
    if (track.fr > 0) return `${track.fr} 1 0%`;
    return `0 0 ${round3(size)}px`;
  }
  function cssLength(value) {
    if (value == null) return null;
    return typeof value === "number" ? `${value}px` : String(value);
  }
  function cssAlign(align) {
    switch (align) {
      case "start":
        return "flex-start";
      case "end":
        return "flex-end";
      case "center":
        return "center";
      case "baseline":
        return "baseline";
      default:
        return "stretch";
    }
  }
  function cssJustify(justify) {
    switch (justify) {
      case "center":
        return "center";
      case "end":
        return "flex-end";
      case "between":
        return "space-between";
      case "around":
        return "space-around";
      case "evenly":
        return "space-evenly";
      default:
        return "flex-start";
    }
  }
  function round3(value) {
    return Math.round(value * 100) / 100;
  }

  // source/traits/focusable.js
  var focusable = {
    name: "focusable",
    version: "1.0.0",
    events: ["focus", "blur"],
    keys: {
      // Focus movement itself is the browser's; what the trait declares is that
      // there is nothing pointer-only about becoming focused (P5).
      Tab: "next",
      "Shift+Tab": "previous"
    },
    attach(ctx, options) {
      const el2 = ctx.el;
      if (!el2) return {};
      const opts = options || {};
      let tabIndex = opts.tabIndex != null ? opts.tabIndex : 0;
      const target = opts.tabIndex != null || isNativelyFocusable(el2) ? el2 : nativeInside(el2) || el2;
      if (!target.hasAttribute("tabindex") && !isNativelyFocusable(target)) {
        target.setAttribute("tabindex", String(tabIndex));
      }
      ctx.own(
        listen(el2, "focusin", (event) => {
          ctx.setState("focused", true);
          ctx.emit("focus", { native: event });
        })
      );
      ctx.own(
        listen(el2, "focusout", (event) => {
          if (el2.contains(event.relatedTarget)) return;
          ctx.setState("focused", false);
          ctx.emit("blur", { native: event });
        })
      );
      return {
        /** Move this element in or out of the tab order (roving tabindex). */
        setTabIndex(value) {
          tabIndex = value;
          target.setAttribute("tabindex", String(value));
        },
        get tabIndex() {
          return tabIndex;
        },
        focus(focusOptions) {
          target.focus(focusOptions);
        },
        blur() {
          target.blur();
        },
        get focused() {
          return el2.contains(el2.ownerDocument.activeElement);
        }
      };
    },
    detach(ctx) {
      if (ctx.el) ctx.el.removeAttribute("tabindex");
    }
  };
  var NATIVE = /* @__PURE__ */ new Set(["a", "button", "input", "select", "textarea", "summary", "details"]);
  function isNativelyFocusable(el2) {
    return NATIVE.has(el2.tagName.toLowerCase());
  }
  function nativeInside(el2) {
    const found = el2.querySelectorAll("a[href], button, input, select, textarea");
    return found.length === 1 ? found[0] : null;
  }

  // source/services/layers.js
  var DEFAULT_LAYERS = [
    ["base", 0],
    ["content", 100],
    ["docked", 200],
    ["hud", 300],
    ["overlay", 400],
    ["modal", 500],
    ["popover", 600],
    ["tooltip", 700],
    ["toast", 800],
    ["devtools", 900]
  ];
  var LayerService = class {
    constructor() {
      this.mk = null;
      this.bands = new Map(DEFAULT_LAYERS);
      this.members = /* @__PURE__ */ new Map();
      this.roots = /* @__PURE__ */ new Map();
      this.counter = 0;
      this.backdrops = /* @__PURE__ */ new Map();
      this.scrollLocks = 0;
      this._scrollRestore = null;
    }
    attach(mk) {
      this.mk = mk;
      for (const [name, band] of this.bands) mk.registry.set("layer", name, { name, band }, { replace: true });
    }
    /** Register a new layer. Bands are declared, never invented at a call site. */
    register(name, band) {
      if (this.bands.has(name)) {
        warn("MK4001", `layer '${name}' is already registered`, { subject: name });
        return this.bands.get(name);
      }
      this.bands.set(name, band);
      if (this.mk) this.mk.registry.set("layer", name, { name, band });
      return band;
    }
    bandOf(name) {
      const band = this.bands.get(name);
      if (band === void 0) {
        warn("MK4001", `unknown layer '${name}'; using 'content'`, { subject: name });
        return this.bands.get("content");
      }
      return band;
    }
    /**
     * The DOM element a layer's content is portalled into. Created lazily, so a
     * page that never opens a modal never pays for a modal layer.
     */
    rootFor(name) {
      const existing = this.roots.get(name);
      if (existing) return existing;
      const host = this.mk && this.mk.root ? this.mk.root.el : body();
      const el2 = el("div", {
        class: `${this.mk ? this.mk.prefix : "mk"}-layer`,
        "data-mk-layer": name,
        style: {
          position: "absolute",
          inset: "0",
          zIndex: String(this.bandOf(name)),
          pointerEvents: "none"
        }
      });
      host.appendChild(el2);
      this.roots.set(name, el2);
      return el2;
    }
    /** Add `node` to a layer and return its resolved z within the band. */
    add(node, name) {
      const layer = name || "content";
      const band = this.bandOf(layer);
      const order = ++this.counter;
      this.members.set(node, { layer, order });
      node.layer = layer;
      this._applyZ(node, band, order);
      return band + order % 100;
    }
    remove(node) {
      this.members.delete(node);
      this.releaseBackdrop(node);
    }
    /** Raise within the band. Never across bands — that is the whole point. */
    bringToFront(node) {
      const record = this.members.get(node);
      if (!record) return false;
      record.order = ++this.counter;
      this._applyZ(node, this.bandOf(record.layer), record.order);
      return true;
    }
    /** The topmost member of a layer, for dismissal and focus restoration. */
    topOf(name) {
      let best = null;
      let bestOrder = -1;
      for (const [node, record] of this.members) {
        if (record.layer !== name || node.destroyed) continue;
        if (record.order > bestOrder) {
          bestOrder = record.order;
          best = node;
        }
      }
      return best;
    }
    _applyZ(node, band, order) {
      if (!this.mk) return;
      this.mk.compiler.set(node, "--mk-z", String(band + order % 100));
      if (node.el) node.el.style.zIndex = String(band + order % 100);
    }
    /**
     * Backdrops are reference-counted and shared: three stacked modals produce
     * one backdrop, positioned beneath the topmost (§16.2).
     */
    requestBackdrop(node, options) {
      const layer = (this.members.get(node) || {}).layer || "modal";
      let record = this.backdrops.get(layer);
      if (!record) {
        const el2 = el("div", {
          class: `${this.mk ? this.mk.prefix : "mk"}-backdrop`,
          "data-mk-backdrop": layer,
          style: {
            position: "fixed",
            inset: "0",
            zIndex: String(this.bandOf(layer) - 1),
            background: "var(--mk-backdrop-bg, rgb(15 23 42 / 0.45))",
            pointerEvents: "auto"
          }
        });
        (this.mk && this.mk.root ? this.mk.root.el : body()).appendChild(el2);
        record = { el: el2, count: 0, owners: /* @__PURE__ */ new Set() };
        this.backdrops.set(layer, record);
      }
      if (!record.owners.has(node)) {
        record.owners.add(node);
        record.count++;
      }
      const top = this.members.get(node);
      if (top) record.el.style.zIndex = String(this.bandOf(layer) + top.order % 100 - 1);
      if (options && options.onDismiss) {
        record.el.onclick = options.onDismiss;
      }
      return record.el;
    }
    releaseBackdrop(node) {
      for (const [layer, record] of this.backdrops) {
        if (!record.owners.has(node)) continue;
        record.owners.delete(node);
        record.count--;
        if (record.count <= 0) {
          remove(record.el);
          this.backdrops.delete(layer);
        } else {
          const top = this.topOf(layer);
          const order = top ? (this.members.get(top) || {}).order || 0 : 0;
          record.el.style.zIndex = String(this.bandOf(layer) + order % 100 - 1);
        }
      }
    }
    /**
     * Scroll locking, also reference-counted, so nested overlays neither
     * double-lock nor prematurely unlock (§16.2).
     */
    lockScroll() {
      this.scrollLocks++;
      if (this.scrollLocks > 1 || !isBrowser()) return;
      const root = documentRoot();
      const scrollbar = measureScrollbar();
      this._scrollRestore = {
        overflow: root.style.overflow,
        paddingRight: root.style.paddingRight
      };
      root.style.overflow = "hidden";
      if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
    }
    unlockScroll() {
      if (this.scrollLocks === 0) return;
      this.scrollLocks--;
      if (this.scrollLocks > 0 || !isBrowser() || !this._scrollRestore) return;
      const root = documentRoot();
      root.style.overflow = this._scrollRestore.overflow;
      root.style.paddingRight = this._scrollRestore.paddingRight;
      this._scrollRestore = null;
    }
    destroy() {
      for (const el2 of this.roots.values()) remove(el2);
      this.roots.clear();
      for (const record of this.backdrops.values()) remove(record.el);
      this.backdrops.clear();
      this.members.clear();
      while (this.scrollLocks > 0) this.unlockScroll();
    }
  };

  // source/elements/structural/pane.js
  var pane = {
    type: "pane",
    version: "1.0.0",
    props: {
      label: { type: "string", default: "" },
      hidden: { type: "boolean", default: false, persist: true },
      scroll: { type: "enum", values: ["none", "auto", "x", "y"], default: "none" },
      padding: { type: "len" }
    },
    algorithm: "anchor",
    a11y: { role: "group", props: { "aria-label": (ctx) => ctx.props.label || null } },
    slots: { default: {} },
    create(ctx) {
      return ctx.dom("div", null, null);
    },
    update(ctx, changed) {
      if (changed.has("hidden")) ctx.setState("hidden", ctx.props.hidden);
      if (changed.has("scroll")) applyScroll(ctx);
      if (changed.has("padding")) ctx.css({ "--mk-padding": lengthOf(ctx.props.padding) });
    },
    mount(ctx) {
      if (ctx.props.hidden) ctx.setState("hidden", true);
      if (ctx.props.scroll !== "none") applyScroll(ctx);
      if (ctx.props.padding != null) ctx.css({ "--mk-padding": lengthOf(ctx.props.padding) });
    },
    styles: css`
    .mk-pane {
      padding: var(--mk-padding, 0);
    }
    .mk-pane[data-mk-scroll] {
      overscroll-behavior: contain;
    }
  `
  };
  function applyScroll(ctx) {
    const mode = ctx.props.scroll;
    ctx.setState("scroll", mode === "none" ? false : mode);
    ctx.css({
      "--mk-overflow-x": mode === "auto" || mode === "x" ? "auto" : "hidden",
      "--mk-overflow-y": mode === "auto" || mode === "y" ? "auto" : "hidden"
    });
    if (ctx.el) {
      ctx.el.style.overflowX = mode === "auto" || mode === "x" ? "auto" : "";
      ctx.el.style.overflowY = mode === "auto" || mode === "y" ? "auto" : "";
    }
  }
  function lengthOf(value) {
    if (value == null) return null;
    return typeof value === "number" ? `${value}px` : String(value);
  }
  var surface = {
    type: "surface",
    version: "1.0.0",
    extends: "pane",
    props: {
      elevation: { type: "number", default: 1, min: 0, max: 3 },
      variant: { type: "enum", values: ["plain", "raised", "sunken"], default: "raised" }
    },
    a11y: { role: "group", props: { "aria-label": (ctx) => ctx.props.label || null } },
    mount(ctx) {
      applySurface(ctx);
    },
    update(ctx, changed) {
      if (changed.has("elevation") || changed.has("variant")) applySurface(ctx);
    },
    styles: css`
    .mk-surface {
      background: var(--mk-surface-bg, var(--mk-color-surface-raised));
      color: var(--mk-text-primary);
      border-radius: var(--mk-radius-md);
      box-shadow: var(--mk-surface-shadow, var(--mk-elevation-1));
    }
    .mk-surface[data-mk-variant="plain"] {
      --mk-surface-bg: transparent;
      --mk-surface-shadow: none;
    }
    .mk-surface[data-mk-variant="sunken"] {
      --mk-surface-bg: var(--mk-color-surface-sunken);
      --mk-surface-shadow: none;
    }
  `
  };
  function applySurface(ctx) {
    ctx.setState("variant", ctx.props.variant);
    ctx.css({
      "--mk-surface-shadow": ctx.props.elevation === 0 ? "none" : `var(--mk-elevation-${ctx.props.elevation})`
    });
  }
  var stack = {
    type: "stack",
    version: "1.0.0",
    props: {
      axis: { type: "enum", values: ["x", "y"], default: "y" },
      gap: { type: "len", default: 0 },
      align: { type: "enum", values: ["start", "center", "end", "stretch", "baseline"], default: "stretch" },
      justify: { type: "enum", values: ["start", "center", "end", "between", "around", "evenly"], default: "start" },
      wrap: { type: "boolean", default: false },
      reverse: { type: "boolean", default: false }
    },
    algorithm: "stack",
    a11y: { role: "group" },
    create(ctx) {
      ctx.node.algorithmOptions = optionsOf(ctx);
      return ctx.dom("div", null, null);
    },
    update(ctx) {
      ctx.node.algorithmOptions = optionsOf(ctx);
      ctx.invalidate("arrange");
    }
  };
  function optionsOf(ctx) {
    return {
      axis: ctx.props.axis,
      gap: ctx.props.gap,
      align: ctx.props.align,
      justify: ctx.props.justify,
      wrap: ctx.props.wrap,
      reverse: ctx.props.reverse
    };
  }
  var group = {
    type: "group",
    version: "1.0.0",
    virtual: true,
    props: { label: { type: "string", default: "" } },
    a11y: "presentation",
    create() {
      return null;
    }
  };
  var spacer = {
    type: "spacer",
    version: "1.0.0",
    props: { size: { type: "len", default: "1fr" } },
    a11y: "presentation",
    geometry: { defaults: {} },
    create(ctx) {
      const el2 = ctx.dom("div", { "aria-hidden": "true" }, null);
      ctx.node.layoutProps.size = ctx.props.size;
      return el2;
    }
  };
  var CORE_ELEMENTS = [pane, surface, stack, group, spacer];

  // source/entries/core.js
  var FORMATTERS = {
    number: (value) => typeof value === "number" ? value.toLocaleString() : String(value ?? ""),
    percent: (value, detail) => {
      const min = detail.min == null ? 0 : detail.min;
      const max = detail.max == null ? 1 : detail.max;
      const span = max - min;
      const ratio = span ? (Number(value) - min) / span : 0;
      return `${Math.round(ratio * 100)}%`;
    },
    date: (value) => {
      const date = value instanceof Date ? value : new Date(value);
      return isNaN(date.getTime()) ? String(value ?? "") : date.toLocaleDateString();
    },
    time: (value) => {
      const date = value instanceof Date ? value : new Date(value);
      return isNaN(date.getTime()) ? String(value ?? "") : date.toLocaleTimeString();
    }
  };
  function installCore(mk) {
    mk.layout(anchorLayout, { replace: true });
    mk.layout(stackLayout, { replace: true });
    mk.trait(focusable, { replace: true });
    for (const name of Object.keys(FORMATTERS)) mk.formatter(name, FORMATTERS[name], { replace: true });
    for (const definition of CORE_ELEMENTS) mk.define(definition, { replace: true });
    return { uninstall() {
    } };
  }
  var corePlugin = {
    name: "mutakit-core",
    version: Mutakit.VERSION,
    install: installCore
  };
  registerService("layers", () => new LayerService());
  installCore(Mutakit);

  // source/layout/split.js
  var AXIS_ALIASES = { vertical: "x", horizontal: "y", x: "x", y: "y" };
  var aliasNoted = false;
  var splitLayout = {
    name: "split",
    version: "1.0.0",
    schema: {
      axis: { type: "any", default: "x" },
      gutter: { type: "any", default: 6 },
      resizeMode: { type: "enum", values: ["neighbor", "distribute", "push"], default: "neighbor" },
      live: { type: "boolean", default: true },
      step: { type: "number", default: 8 },
      panes: { type: "any" }
    },
    childProps: {
      size: { type: "len", default: "1fr", persist: true },
      min: { type: "len" },
      max: { type: "len" },
      collapsible: { type: "any" },
      collapsed: { type: "boolean", default: false, persist: true },
      snap: { type: "array", of: "number" },
      /** A pinned pane never absorbs a `distribute` delta. */
      pinned: { type: "boolean", default: false }
    },
    childrenFrom(options) {
      if (!options.panes) return null;
      return options.panes.map((pane2) => ({ type: pane2.type || "pane", ...toChildSpec(pane2) }));
    },
    /**
     * Insert a `resizer` between every adjacent pair. Gutters are real children
     * and real grid tracks, so they participate in track sizing rather than
     * being overlaid — which is what makes the arithmetic exact.
     */
    setup(node, ctx) {
      const mk = ctx.mk;
      const options = normalizeOptions(node.algorithmOptions);
      node.algorithmOptions = options;
      if (!options.gutter.draggable) return;
      const panes = node.children.filter((child) => child.type !== "resizer");
      for (const existing of node.children.filter((child) => child.type === "resizer")) {
        mk.destroy(existing);
      }
      for (let i = 0; i < panes.length - 1; i++) {
        const resizer2 = mk.create(
          "resizer",
          { axis: options.axis, index: i, before: panes[i + 1] },
          node
        );
        if (resizer2) resizer2.node.gutterIndex = i;
      }
    },
    arrange(node, children, ctx) {
      const options = normalizeOptions(node.algorithmOptions);
      node.algorithmOptions = options;
      const axis = options.axis;
      const main = axis === "x" ? "w" : "h";
      const cross = axis === "x" ? "h" : "w";
      const mainPos = axis === "x" ? "x" : "y";
      const crossPos = axis === "x" ? "y" : "x";
      const panes = children.filter((child) => child.type !== "resizer");
      const gutters = children.filter((child) => child.type === "resizer");
      if (!panes.length) return;
      const frame = node.frame;
      const gutterSize = ctx.len(options.gutter.size, axis);
      const model = trackModel(node, panes, frame[main], gutterSize, ctx);
      node.splitModel = model;
      ctx.style(axis === "x" ? "grid-template-columns" : "grid-template-rows", model.template);
      ctx.style(axis === "x" ? "grid-template-rows" : "grid-template-columns", "100%");
      ctx.css({ "--mk-gutter": `${gutterSize}px` });
      let cursor = frame[mainPos === "x" ? "x" : "y"];
      for (let i = 0; i < panes.length; i++) {
        const pane2 = panes[i];
        pane2.computed[mainPos] = cursor;
        pane2.computed[main] = model.sizes[i];
        pane2.computed[crossPos] = frame[crossPos];
        pane2.computed[cross] = frame[cross];
        pane2.sizeIsFixed = !model.tracks[i].flexible;
        ctx.mk.compiler.setRect(pane2, pane2.computed);
        ctx.mk.compiler.setStyle(pane2, axis === "x" ? "grid-column" : "grid-row", String(i * 2 + 1));
        ctx.mk.compiler.setState(pane2, "collapsed", !!pane2.layoutProps.collapsed);
        cursor += model.sizes[i];
        const gutter = gutters[i];
        if (i < panes.length - 1 && gutter) {
          gutter.computed[mainPos] = cursor;
          gutter.computed[main] = gutterSize;
          gutter.computed[crossPos] = frame[crossPos];
          gutter.computed[cross] = frame[cross];
          ctx.mk.compiler.setRect(gutter, gutter.computed);
          ctx.mk.compiler.setStyle(gutter, axis === "x" ? "grid-column" : "grid-row", String(i * 2 + 2));
          updateSeparatorSemantics(gutter, model, i, ctx);
        }
        cursor += gutterSize;
      }
      if (model.overflow) {
        warn(
          "MK2013",
          `the panes' minimums plus gutters (${Math.round(model.required)}px) exceed the container (${Math.round(frame[main])}px); the minimums hold and the split overflows`,
          { subject: node.toString() }
        );
      }
    },
    /*
     * Only what varies per node. `display` and `position` are constants and
     * belong in `styles` below, where the selector can be guarded — written
     * inline they override the stylesheet unconditionally, which is how every
     * container ended up relatively positioned regardless of the guard.
     */
    css(node) {
      return { "--mk-split-axis": normalizeOptions(node.algorithmOptions).axis };
    },
    styles: `
    [data-mk-algorithm="split"]:not(.mk-node) { position: relative; }
    [data-mk-algorithm="split"] {
      display: grid;
      min-width: 0;
      min-height: 0;
    }
    [data-mk-algorithm="split"] > .mk-node {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    [data-mk-algorithm="split"] > .mk-resizer {
      overflow: visible;
    }
  `
  };
  function trackModel(node, panes, available, gutterSize, ctx) {
    const totalGutters = gutterSize * Math.max(0, panes.length - 1);
    const content = Math.max(0, available - totalGutters);
    const lenCtx = ctx.mk ? ctx.mk.lenContext(available, node) : { basis: available };
    const tracks = panes.map((pane2) => {
      const bag = pane2.layoutProps || {};
      const collapsed = !!bag.collapsed;
      const declared = collapsed ? collapsedSize(bag) : bag.size != null ? bag.size : "1fr";
      const ast = parse2(declared);
      const flexible = !collapsed && isFlexible(ast);
      const min = collapsed ? collapsedSize(bag) : resolve2(bag.min, lenCtx, 0);
      const max = collapsed ? collapsedSize(bag) : resolve2(bag.max, lenCtx, Infinity);
      const base = flexible ? 0 : clampNumber(resolve2(declared, lenCtx, 0), min, max);
      return {
        pane: pane2,
        flexible,
        fr: flexible ? frCoefficient(ast) : 0,
        declared,
        min,
        max,
        base,
        collapsed,
        pinned: !!bag.pinned,
        hasCeiling: isFinite(max),
        hasSnap: Array.isArray(bag.snap) && bag.snap.length > 0,
        // The raw declaration, not a boolean: `shouldCollapse` needs its `at`.
        collapsible: bag.collapsible || false,
        // A collapsible pane may be dragged *below* its minimum, as far as the
        // collapse threshold — otherwise `min` blocks the very gesture `at`
        // exists to detect, and the pane can never be collapsed by dragging.
        dragMin: dragFloor(bag, collapsed ? collapsedSize(bag) : resolve2(bag.min, lenCtx, 0))
      };
    });
    const sizes = distributeFr(tracks, content);
    const required = tracks.reduce((sum, track) => sum + track.min, 0) + totalGutters;
    return {
      tracks,
      sizes,
      gutterSize,
      totalGutters,
      content,
      required,
      overflow: required > available + 0.5,
      template: template(tracks, gutterSize)
    };
  }
  function template(tracks, gutterSize) {
    const parts = [];
    const sumOtherMins = tracks.reduce((sum, track) => sum + track.min, 0);
    const gutterTotal = gutterSize * Math.max(0, tracks.length - 1);
    tracks.forEach((track, i) => {
      if (i > 0) parts.push(`var(--mk-gutter, ${gutterSize}px)`);
      if (track.flexible) {
        parts.push(`minmax(${px2(track.min)}, ${track.fr}fr)`);
      } else {
        const others = sumOtherMins - track.min;
        const ceiling = `calc(100% - ${px2(gutterTotal + others)})`;
        const wanted = `var(--mk-w-${i}, ${px2(track.base)})`;
        const bounded = `min(${wanted}, ${ceiling})`;
        parts.push(
          isFinite(track.max) ? `clamp(${px2(track.min)}, ${bounded}, ${px2(track.max)})` : `max(${px2(track.min)}, ${bounded})`
        );
      }
    });
    return parts.join(" ");
  }
  function dragFloor(bag, min) {
    if (!bag.collapsible) return min;
    return Math.min(collapsedSize(bag), min);
  }
  function collapsedSize(bag) {
    const to = bag.collapsible && typeof bag.collapsible === "object" ? bag.collapsible.to : 0;
    return to == null ? 0 : to;
  }
  function resolve2(value, lenCtx, fallback) {
    if (value == null) return fallback;
    const n = toNumber(parse2(value), lenCtx);
    return isFinite(n) ? n : fallback;
  }
  function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
  function px2(value) {
    return `${Math.round(value * 100) / 100}px`;
  }
  function normalizeOptions(raw) {
    const options = raw || {};
    if (options.__normalized) return options;
    let axis = options.axis == null ? "x" : String(options.axis).toLowerCase();
    if (axis === "vertical" || axis === "horizontal") {
      if (!aliasNoted) {
        aliasNoted = true;
        console.info(
          `[mutakit] axis: '${axis}' describes the separator \u2014 panes are distributed along '${AXIS_ALIASES[axis]}'. The documentation leads with axis: '${AXIS_ALIASES[axis]}'.`
        );
      }
    }
    axis = AXIS_ALIASES[axis] || "x";
    const gutter = typeof options.gutter === "number" ? { size: options.gutter, draggable: true } : { size: 6, draggable: true, ...options.gutter || {} };
    return {
      __normalized: true,
      axis,
      gutter,
      resizeMode: options.resizeMode || "neighbor",
      live: options.live !== false,
      step: options.step == null ? 8 : options.step,
      panes: options.panes
    };
  }
  function toChildSpec(pane2) {
    const { type, id, content, children, ...rest } = pane2;
    const bag = {};
    const props = {};
    for (const key of Object.keys(rest)) {
      if (CHILD_KEYS.has(key)) bag[key] = rest[key];
      else props[key] = rest[key];
    }
    return { id, content, children, ...props, layout: bag };
  }
  var CHILD_KEYS = /* @__PURE__ */ new Set(["size", "min", "max", "collapsible", "collapsed", "snap", "pinned"]);
  function updateSeparatorSemantics(gutter, model, index, ctx) {
    const track = model.tracks[index];
    const now2 = model.sizes[index];
    const room = model.content;
    const max = isFinite(track.max) ? track.max : room - sumMins(model, index);
    ctx.mk.compiler.setState(gutter, "index", String(index));
    if (!gutter.el) return;
    gutter.el.setAttribute("aria-valuenow", String(Math.round(now2)));
    gutter.el.setAttribute("aria-valuemin", String(Math.round(track.min)));
    gutter.el.setAttribute("aria-valuemax", String(Math.round(max)));
    const controls = model.tracks[index].pane.id;
    if (controls) gutter.el.setAttribute("aria-controls", controls);
  }
  function sumMins(model, exceptIndex) {
    return model.tracks.reduce((sum, track, i) => i === exceptIndex ? sum : sum + track.min, 0);
  }
  function canUseCSSPath(model, index, mode) {
    if (mode === "push") return false;
    if (mode === "neighbor") {
      const next = model.tracks[index + 1];
      return !!next && !next.hasSnap && !next.collapsible;
    }
    return flexibleSet(model, index).every(
      (track) => !track.hasCeiling && !track.hasSnap && !track.collapsible
    );
  }
  function flexibleSet(model, index) {
    return model.tracks.slice(index + 1).filter((track) => !track.collapsed && !track.pinned);
  }
  function resolveDrag(model, index, delta, mode, start2) {
    const sizes = (start2 || model.sizes).slice();
    switch (mode) {
      case "distribute":
        return dragDistribute(model, index, delta, sizes);
      case "push":
        return dragPush(model, index, delta, sizes);
      default:
        return dragNeighbor(model, index, delta, sizes);
    }
  }
  function dragNeighbor(model, index, delta, sizes) {
    const a = model.tracks[index];
    const b = model.tracks[index + 1];
    if (!b) return { sizes, applied: 0 };
    const wantA = sizes[index] + delta;
    const wantB = sizes[index + 1] - delta;
    const newA = clampNumber(wantA, a.dragMin, a.max);
    const newB = clampNumber(wantB, b.dragMin, b.max);
    const applied = Math.abs(newA - sizes[index]) < Math.abs(sizes[index + 1] - newB) ? newA - sizes[index] : sizes[index + 1] - newB;
    sizes[index] += applied;
    sizes[index + 1] -= applied;
    return { sizes, applied };
  }
  function dragDistribute(model, index, delta, sizes) {
    const set = flexibleSet(model, index);
    if (!set.length) return dragNeighbor(model, index, delta, sizes);
    const indices = set.map((track) => model.tracks.indexOf(track));
    const seeded = indices.map((i) => sizes[i]);
    const dragged = model.tracks[index];
    const seedK = sizes[index];
    let applied = clampNumber(seedK + delta, dragged.dragMin, dragged.max) - seedK;
    let result = seeded.slice();
    for (let round4 = 0; round4 < 3; round4++) {
      result = spread(model, indices, seeded, -applied);
      const absorbed = result.reduce((sum, size, slot) => sum + (size - seeded[slot]), 0);
      if (Math.abs(absorbed + applied) < 0.01) break;
      applied = -absorbed;
    }
    indices.forEach((i, slot) => {
      sizes[i] = result[slot];
    });
    sizes[index] = seedK + applied;
    return { sizes, applied };
  }
  function spread(model, indices, seeded, pool) {
    const result = seeded.slice();
    const frozen = /* @__PURE__ */ new Set();
    for (let pass = 0; pass <= indices.length; pass++) {
      const active = indices.filter((i) => !frozen.has(i));
      if (!active.length || Math.abs(pool) < 0.01) break;
      const weight = active.reduce((sum, i) => sum + Math.max(model.tracks[i].fr || 1, 0), 0);
      let froze = false;
      for (const i of active) {
        const slot = indices.indexOf(i);
        const share = Math.max(model.tracks[i].fr || 1, 0) / weight * pool;
        const wanted = seeded[slot] + share;
        const clamped = clampNumber(wanted, model.tracks[i].dragMin, model.tracks[i].max);
        result[slot] = clamped;
        if (Math.abs(clamped - wanted) > 0.01) {
          frozen.add(i);
          froze = true;
        }
      }
      if (!froze) break;
      let taken = 0;
      for (const i of frozen) taken += result[indices.indexOf(i)] - seeded[indices.indexOf(i)];
      pool -= taken;
      const remaining = indices.filter((i) => !frozen.has(i));
      for (const i of remaining) result[indices.indexOf(i)] = seeded[indices.indexOf(i)];
      if (!remaining.length) break;
      seeded = seeded.slice();
    }
    return result;
  }
  function dragPush(model, index, delta, sizes) {
    let remaining = delta;
    const direction = delta >= 0 ? 1 : -1;
    const a = model.tracks[index];
    const headroom = direction > 0 ? isFinite(a.max) ? a.max - sizes[index] : Infinity : sizes[index] - a.dragMin;
    if (headroom <= 0) return { sizes, applied: 0 };
    remaining = direction > 0 ? Math.min(remaining, headroom) : Math.max(remaining, -headroom);
    let absorbed = 0;
    const order = direction > 0 ? model.tracks.map((_, i) => i).slice(index + 1) : model.tracks.map((_, i) => i).slice(0, index + 1).reverse();
    for (const i of order) {
      if (Math.abs(remaining - absorbed) < 0.01) break;
      const track = model.tracks[i];
      const want = remaining - absorbed;
      const room = direction > 0 ? sizes[i] - track.dragMin : isFinite(track.max) ? track.max - sizes[i] : Infinity;
      const take = Math.min(Math.abs(want), room) * direction;
      sizes[i] -= take;
      absorbed += take;
    }
    sizes[index] += absorbed;
    if (direction < 0) {
      sizes[index] = clampNumber(sizes[index], a.dragMin, a.max);
    }
    return { sizes, applied: absorbed };
  }
  function applySnap(track, size, tolerance) {
    if (!track.hasSnap) return size;
    const bag = track.pane.layoutProps || {};
    let best = size;
    let bestDistance = tolerance == null ? 12 : tolerance;
    for (const point of bag.snap) {
      const distance = Math.abs(point - size);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }
    return best;
  }
  function shouldCollapse(track, size) {
    if (!track.collapsible) return false;
    const at = typeof track.collapsible === "object" ? track.collapsible.at : track.min;
    return size < (at == null ? track.min : at);
  }

  // source/layout/algorithms.js
  var dockLayout = {
    name: "dock",
    version: "1.0.0",
    /** Regions are named, not ordered — `dock()` returns the shell (§7.4). */
    returns: "self",
    schema: {
      corners: { type: "enum", values: ["horizontal", "vertical", "explicit"], default: "horizontal" },
      regions: { type: "object" },
      breakpoints: { type: "object" }
    },
    childProps: {
      region: { type: "enum", values: ["top", "bottom", "start", "end", "center"], default: "center" },
      size: { type: "len", default: 200, persist: true },
      resizable: { type: "boolean", default: false },
      collapsible: { type: "any" },
      collapsed: { type: "boolean", default: false, persist: true },
      /** An overlay region floats above the centre instead of reserving space. */
      overlay: { type: "boolean", default: false },
      rail: { type: "len" },
      spans: { type: "array", of: "string" },
      hidden: { type: "boolean", default: false }
    },
    childrenFrom(options) {
      if (!options.regions) return null;
      return Object.keys(options.regions).map((name) => {
        const { type = "pane", id, size, resizable: resizable2, collapsible: collapsible2, collapsed, overlay, rail, spans, ...rest } = options.regions[name] || {};
        return {
          type,
          id: id || name,
          ...rest,
          layout: { region: name, size, resizable: resizable2, collapsible: collapsible2, collapsed, overlay, rail, spans }
        };
      });
    },
    arrange(node, children, ctx) {
      const options = node.algorithmOptions || {};
      const corners = resolveCorners(options, node, ctx);
      const frame = node.frame;
      const insets = { top: 0, right: 0, bottom: 0, left: 0 };
      const rtl = ctx.mk.options.direction === "rtl";
      const byRegion = {};
      for (const child of children) {
        const region = child.layoutProps && child.layoutProps.region || "center";
        (byRegion[region] = byRegion[region] || []).push(child);
      }
      const order = corners === "vertical" ? ["start", "end", "top", "bottom"] : ["top", "bottom", "start", "end"];
      for (const region of order) {
        for (const child of byRegion[region] || []) {
          const bag = child.layoutProps || {};
          if (bag.hidden) {
            child.computed.w = 0;
            child.computed.h = 0;
            continue;
          }
          const collapsed = !!bag.collapsed;
          const declared = collapsed ? bag.rail || 0 : bag.size;
          const extent2 = ctx.len(declared, region === "top" || region === "bottom" ? "y" : "x");
          const box = regionBox(region, frame, insets, extent2, corners, rtl);
          place2(ctx, child, box);
          ctx.mk.compiler.setState(child, "region", region);
          ctx.mk.compiler.setState(child, "collapsed", collapsed);
          if (!bag.overlay) {
            const edge = physicalEdge(region, rtl);
            insets[edge] += extent2;
            node.insets.set(`dock:${child.id || region}`, { [edge]: insets[edge] }, { selfApply: false });
          }
        }
      }
      const centre = {
        x: frame.x + insets.left,
        y: frame.y + insets.top,
        w: Math.max(0, frame.w - insets.left - insets.right),
        h: Math.max(0, frame.h - insets.top - insets.bottom)
      };
      for (const child of byRegion.center || []) place2(ctx, child, centre);
    },
    styles: `
    [data-mk-algorithm="dock"]:not(.mk-node) { position: relative; }
    [data-mk-algorithm="dock"] > .mk-node {
      position: absolute;
      left: var(--mk-x, 0px);
      top: var(--mk-y, 0px);
      width: var(--mk-w, auto);
      height: var(--mk-h, auto);
    }
    [data-mk-algorithm="dock"] > [data-mk-collapsed] { overflow: hidden; }
  `
  };
  function resolveCorners(options, node, ctx) {
    const breakpoints = options.breakpoints;
    if (!breakpoints) return options.corners || "horizontal";
    const width = node.frame.w;
    const applicable = Object.keys(breakpoints).map(Number).sort((a, b) => a - b).filter((point) => width <= point);
    for (const point of applicable) {
      const rules = breakpoints[point];
      for (const region of Object.keys(rules)) {
        const child = node.children.find((c) => (c.layoutProps || {}).region === region);
        if (!child) continue;
        const rule = rules[region];
        if (rule === "hidden") child.layoutProps.hidden = true;
        else if (rule === "overlay") child.layoutProps.overlay = true;
        else if (rule === "rail") child.layoutProps.collapsed = true;
      }
    }
    return options.corners || "horizontal";
  }
  function physicalEdge(region, rtl) {
    if (region === "start") return rtl ? "right" : "left";
    if (region === "end") return rtl ? "left" : "right";
    return region;
  }
  function regionBox(region, frame, insets, extent2, corners, rtl) {
    const edge = physicalEdge(region, rtl);
    const full = corners === "horizontal" ? edge === "top" || edge === "bottom" : edge === "left" || edge === "right";
    if (edge === "top" || edge === "bottom") {
      const x2 = full ? frame.x : frame.x + insets.left;
      const w = full ? frame.w : frame.w - insets.left - insets.right;
      const y2 = edge === "top" ? frame.y + insets.top : frame.y + frame.h - insets.bottom - extent2;
      return { x: x2, y: y2, w: Math.max(0, w), h: extent2 };
    }
    const y = full ? frame.y : frame.y + insets.top;
    const h = full ? frame.h : frame.h - insets.top - insets.bottom;
    const x = edge === "left" ? frame.x + insets.left : frame.x + frame.w - insets.right - extent2;
    return { x, y, w: extent2, h: Math.max(0, h) };
  }
  function place2(ctx, child, box) {
    child.computed.x = box.x;
    child.computed.y = box.y;
    child.computed.w = box.w;
    child.computed.h = box.h;
    ctx.mk.compiler.setRect(child, child.computed);
  }
  var gridLayout = {
    name: "grid",
    version: "1.0.0",
    schema: {
      columns: { type: "array", default: () => ["1fr"] },
      rows: { type: "array", default: () => ["auto"] },
      areas: { type: "any" },
      gap: { type: "len", default: 0 },
      columnGap: { type: "len" },
      rowGap: { type: "len" }
    },
    childProps: {
      column: { type: "any" },
      row: { type: "any" },
      area: { type: "string" },
      span: { type: "number", default: 1 }
    },
    childrenFrom(options) {
      return options.children || null;
    },
    arrange(node, children, ctx) {
      const options = node.algorithmOptions || {};
      const frame = node.frame;
      const gapX = ctx.len(options.columnGap != null ? options.columnGap : options.gap || 0, "x");
      const gapY = ctx.len(options.rowGap != null ? options.rowGap : options.gap || 0, "y");
      const columns = trackSizes(options.columns, frame.w, gapX, ctx, node, "x");
      const rows = trackSizes(options.rows, frame.h, gapY, ctx, node, "y");
      ctx.style("grid-template-columns", template2(options.columns, ctx));
      ctx.style("grid-template-rows", template2(options.rows, ctx));
      ctx.style("gap", `${gapY}px ${gapX}px`);
      if (options.areas) ctx.style("grid-template-areas", areaTemplate(options.areas));
      children.forEach((child, index) => {
        const bag = child.layoutProps || {};
        const column = resolveIndex(bag.column, index % Math.max(1, columns.length));
        const row = resolveIndex(bag.row, Math.floor(index / Math.max(1, columns.length)));
        child.computed.x = frame.x + offset(columns, column, gapX);
        child.computed.y = frame.y + offset(rows, row, gapY);
        child.computed.w = extent(columns, column, bag.span, gapX);
        child.computed.h = extent(rows, row, 1, gapY);
        ctx.mk.compiler.setRect(child, child.computed);
        if (bag.area) ctx.mk.compiler.setStyle(child, "grid-area", bag.area);
        else {
          ctx.mk.compiler.setStyle(child, "grid-column", `${column + 1} / span ${bag.span || 1}`);
          ctx.mk.compiler.setStyle(child, "grid-row", String(row + 1));
        }
      });
    },
    styles: `[data-mk-algorithm="grid"] { display: grid; }`
  };
  function template2(lens, ctx) {
    return (lens || ["1fr"]).map((len) => toCSS(parse2(len), { units: (n) => ctx.mk.registry.get("unit", n) })).join(" ");
  }
  function areaTemplate(areas) {
    if (typeof areas === "string") return areas;
    return areas.map((row) => `"${Array.isArray(row) ? row.join(" ") : row}"`).join(" ");
  }
  function trackSizes(lens, available, gap, ctx, node, axis) {
    const list = lens || ["1fr"];
    const lenCtx = ctx.mk.lenContext(available, node);
    const content = Math.max(0, available - gap * Math.max(0, list.length - 1));
    const tracks = list.map((len) => {
      const ast = parse2(len);
      const flexible = isFlexible(ast);
      return {
        fr: flexible ? frCoefficient(ast) : 0,
        base: flexible ? 0 : Math.max(0, toNumber(ast, lenCtx) || 0)
      };
    });
    return distributeFr(tracks, content);
  }
  function resolveIndex(value, fallback) {
    if (value == null) return fallback;
    return typeof value === "number" ? value - 1 : fallback;
  }
  function offset(tracks, index, gap) {
    let out = 0;
    for (let i = 0; i < index && i < tracks.length; i++) out += tracks[i] + gap;
    return out;
  }
  function extent(tracks, index, span, gap) {
    const count = Math.max(1, span || 1);
    let out = 0;
    for (let i = index; i < index + count && i < tracks.length; i++) {
      out += tracks[i] + (i > index ? gap : 0);
    }
    return out;
  }
  var flowLayout = {
    name: "flow",
    version: "1.0.0",
    schema: { gap: { type: "len", default: 0 } },
    arrange(node, children, ctx) {
      for (const child of children) {
        if (child.positioning !== "self") continue;
        warn(
          "MK2011",
          `'${child.type}' declares positioning: 'self' inside a 'flow' parent, which places children in document flow. Move it into a 'free' or 'anchor' parent.`,
          { subject: child.toString() }
        );
        child.positioning = "parent";
      }
    },
    css(node) {
      const options = node.algorithmOptions || {};
      return { gap: options.gap ? `${options.gap}px` : null };
    },
    styles: `
    [data-mk-algorithm="flow"] { display: block; }
    [data-mk-algorithm="flow"] > .mk-node { position: static; }
  `
  };
  var freeLayout = {
    name: "free",
    version: "1.0.0",
    positioning: "self",
    schema: {
      bounds: { type: "any", default: "container" },
      grid: { type: "any", default: false },
      stacking: { type: "enum", values: ["recency", "declared", "manual"], default: "recency" },
      placement: { type: "any", default: "cascade" },
      collision: { type: "enum", values: ["none", "avoid", "push"], default: "none" },
      pan: { type: "boolean", default: false },
      zoom: { type: "any", default: false },
      keepVisible: { type: "number", default: 24 }
    },
    childProps: {
      x: { type: "number", persist: true },
      y: { type: "number", persist: true },
      z: { type: "number", persist: true },
      pinned: { type: "boolean", default: false }
    },
    childrenFrom(options) {
      return options.children || null;
    },
    setup(node) {
      node.state.freeCounter = node.state.freeCounter || 0;
      node.state.freePan = node.state.freePan || { x: 0, y: 0, scale: 1 };
    },
    arrange(node, children, ctx) {
      const options = node.algorithmOptions || {};
      const frame = node.frame;
      const bounds = options.bounds === "infinite" ? null : options.bounds && typeof options.bounds === "object" ? options.bounds : { x: 0, y: 0, w: frame.w, h: frame.h };
      for (const child of children) {
        const bag = child.layoutProps || {};
        if (bag.x == null || bag.y == null) Object.assign(bag, placeNew(node, children, child, options));
        let box = { x: bag.x, y: bag.y, w: child.computed.w, h: child.computed.h };
        const measured = child.measured || { w: 0, h: 0 };
        if (!box.w) box.w = measured.w;
        if (!box.h) box.h = measured.h;
        if (options.grid) {
          const step = typeof options.grid === "number" ? { x: options.grid, y: options.grid } : options.grid;
          if (step.snap !== "resize") {
            box.x = Math.round(box.x / step.x) * step.x;
            box.y = Math.round(box.y / step.y) * step.y;
          }
        }
        if (bounds) {
          box = clamp(box, bounds, options.keepVisible);
        }
        child.computed.x = frame.x + box.x;
        child.computed.y = frame.y + box.y;
        child.computed.w = box.w;
        child.computed.h = box.h;
        ctx.mk.compiler.setRect(child, child.computed);
        if (bag.z != null) ctx.mk.compiler.set(child, "--mk-z", String(bag.z));
      }
      if (options.pan || options.zoom) {
        const pan = node.state.freePan;
        ctx.css({
          "--mk-pan-x": `${pan.x}px`,
          "--mk-pan-y": `${pan.y}px`,
          "--mk-pan-scale": String(pan.scale)
        });
      }
    },
    styles: `
    [data-mk-algorithm="free"]:not(.mk-node) { position: relative; }
    [data-mk-algorithm="free"] { overflow: hidden; }
    [data-mk-algorithm="free"] > .mk-node { z-index: var(--mk-z, auto); }
  `
  };
  function placeNew(node, children, child, options) {
    const mode = options.placement || "cascade";
    if (typeof mode === "function") return mode(child, children, node);
    const frame = node.frame;
    const size = child.measured || { w: 320, h: 240 };
    if (mode === "center") {
      return { x: Math.max(0, (frame.w - size.w) / 2), y: Math.max(0, (frame.h - size.h) / 2) };
    }
    if (mode === "first-fit") {
      for (let y = 0; y + size.h <= frame.h; y += 24) {
        for (let x = 0; x + size.w <= frame.w; x += 24) {
          const candidate = { x, y, w: size.w, h: size.h };
          const clash = children.some(
            (other) => other !== child && other.layoutProps.x != null && intersects(candidate, {
              x: other.layoutProps.x,
              y: other.layoutProps.y,
              w: other.computed.w,
              h: other.computed.h
            })
          );
          if (!clash) return candidate;
        }
      }
      return { x: 0, y: 0 };
    }
    const index = node.state.freeCounter++;
    const step = 28;
    const wrap2 = Math.max(1, Math.floor((frame.h - size.h) / step) || 1);
    return { x: index % wrap2 * step, y: index % wrap2 * step };
  }
  var EXTRA_LAYOUTS = [dockLayout, gridLayout, flowLayout, freeLayout];

  // source/traits/draggable.js
  var { listen: listen2 } = dom_exports;
  var FLOW_OWNING2 = /* @__PURE__ */ new Set(["stack", "split", "grid", "dock", "flow"]);
  var draggable = {
    name: "draggable",
    version: "1.0.0",
    requires: ["focusable"],
    events: ["dragstart", "drag", "dragend"],
    /** Mandatory for a pointer trait (P5): arrows move, Escape cancels. */
    keys: {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      Escape: "cancel"
    },
    attach(ctx, options) {
      const opts = options || {};
      if (!arbitrate(ctx)) return {};
      ctx.node.positioning = "self";
      const state = { active: null };
      const el2 = handleElement(ctx, opts.handle);
      if (!el2) return {};
      el2.style.touchAction = touchActionFor(opts.axis);
      ctx.own(listen2(el2, "pointerdown", (event) => start(ctx, state, opts, event)));
      ctx.own(listen2(el2, "pointermove", (event) => move(ctx, state, opts, event)));
      ctx.own(listen2(el2, "pointerup", (event) => end(ctx, state, event)));
      ctx.own(listen2(el2, "pointercancel", () => cancel(ctx, state)));
      ctx.own(listen2(ctx.el, "keydown", (event) => onKey(ctx, state, opts, event)));
      return {
        /** Begin a drag programmatically, from a menu command or a test. */
        startDrag(at) {
          state.active = {
            origin: at || { x: 0, y: 0 },
            from: { x: ctx.node.computed.x, y: ctx.node.computed.y }
          };
          ctx.setState("dragging", true);
          ctx.emit("dragstart", { x: state.active.from.x, y: state.active.from.y });
        },
        cancelDrag() {
          cancel(ctx, state);
        },
        get dragging() {
          return !!state.active;
        }
      };
    },
    detach(ctx) {
      ctx.setState("dragging", false);
    }
  };
  function arbitrate(ctx) {
    const parent = ctx.node.parent;
    const algorithm = parent && parent.algorithm;
    if (!algorithm || !FLOW_OWNING2.has(algorithm)) return true;
    warn(
      "MK2011",
      `'${ctx.node.type}' is draggable inside a '${algorithm}' parent, which computes a track for it. Two real fixes: use the \`sortable\` trait to reorder *within* the flow, or move the child into a \`free\`/\`anchor\` parent to move it *freely*.` + (algorithm === "split" ? " A pane inside a split is resized by its gutters." : ""),
      { subject: ctx.node.toString() }
    );
    return false;
  }
  function handleElement(ctx, selector) {
    if (!selector) return ctx.el;
    if (typeof selector === "string") return ctx.el.querySelector(selector) || ctx.el;
    return selector;
  }
  function touchActionFor(axis) {
    if (axis === "x") return "pan-y";
    if (axis === "y") return "pan-x";
    return "none";
  }
  function start(ctx, state, opts, event) {
    if (event.button !== 0) return;
    event.preventDefault();
    ctx.el.setPointerCapture(event.pointerId);
    state.active = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      from: { x: ctx.node.computed.x, y: ctx.node.computed.y }
    };
    ctx.setState("dragging", true);
    ctx.emit("dragstart", { ...state.active.from, native: event });
  }
  function move(ctx, state, opts, event) {
    if (!state.active || event.pointerId !== state.active.pointerId) return;
    const dx = opts.axis === "y" ? 0 : event.clientX - state.active.origin.x;
    const dy = opts.axis === "x" ? 0 : event.clientY - state.active.origin.y;
    apply(ctx, state, opts, state.active.from.x + dx, state.active.from.y + dy, event);
  }
  function apply(ctx, state, opts, x, y, native) {
    let nextX = x;
    let nextY = y;
    if (opts.grid) {
      const stepX = typeof opts.grid === "number" ? opts.grid : opts.grid.x || 0;
      const stepY = typeof opts.grid === "number" ? opts.grid : opts.grid.y || 0;
      if (stepX) nextX = Math.round(nextX / stepX) * stepX;
      if (stepY) nextY = Math.round(nextY / stepY) * stepY;
    }
    const bounds = boundsOf2(ctx, opts);
    if (bounds) {
      nextX = Math.min(Math.max(nextX, bounds.x), bounds.x + bounds.w - ctx.node.computed.w);
      nextY = Math.min(Math.max(nextY, bounds.y), bounds.y + bounds.h - ctx.node.computed.h);
    }
    ctx.constrain({ left: nextX, top: nextY, at: void 0, anchor: void 0 });
    ctx.emit("drag", { x: nextX, y: nextY, native: native || null });
  }
  function boundsOf2(ctx, opts) {
    if (opts.bounds === false) return null;
    const parent = ctx.node.parent;
    if (!parent) return null;
    if (opts.bounds && typeof opts.bounds === "object") return opts.bounds;
    return { x: 0, y: 0, w: parent.frame.w, h: parent.frame.h };
  }
  function end(ctx, state, event) {
    if (!state.active || event.pointerId !== state.active.pointerId) return;
    state.active = null;
    ctx.setState("dragging", false);
    ctx.emit("dragend", { x: ctx.node.computed.x, y: ctx.node.computed.y, cancelled: false });
  }
  function cancel(ctx, state) {
    if (!state.active) return;
    const { from } = state.active;
    state.active = null;
    ctx.constrain({ left: from.x, top: from.y });
    ctx.setState("dragging", false);
    ctx.emit("dragend", { ...from, cancelled: true });
  }
  function onKey(ctx, state, opts, event) {
    const step = event.shiftKey ? 10 : 1;
    const map = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };
    if (event.key === "Escape") {
      cancel(ctx, state);
      return;
    }
    const move2 = map[event.key];
    if (!move2) return;
    if (opts.axis === "x" && move2[1]) return;
    if (opts.axis === "y" && move2[0]) return;
    event.preventDefault();
    apply(ctx, state, opts, ctx.node.computed.x + move2[0], ctx.node.computed.y + move2[1], event);
    ctx.emit("dragend", { x: ctx.node.computed.x, y: ctx.node.computed.y, cancelled: false });
  }
  var collapsible = {
    name: "collapsible",
    version: "1.0.0",
    events: ["collapse", "expand"],
    keys: { Enter: "toggle", " ": "toggle" },
    attach(ctx, options) {
      const opts = options || {};
      const axis = opts.axis || "y";
      const api = {
        get collapsed() {
          return !!ctx.node.layoutProps.collapsed;
        },
        collapse() {
          if (api.collapsed) return;
          const size = axis === "x" ? ctx.node.computed.w : ctx.node.computed.h;
          ctx.node.state.restoreSize = size;
          ctx.mk.setLayoutProps(ctx.node, { collapsed: true });
          ctx.setState("collapsed", true);
          ctx.emit("collapse", { restoreSize: size });
        },
        expand() {
          if (!api.collapsed) return;
          ctx.mk.setLayoutProps(ctx.node, {
            collapsed: false,
            size: ctx.node.state.restoreSize != null ? ctx.node.state.restoreSize : opts.to || 200
          });
          ctx.setState("collapsed", false);
          ctx.emit("expand", {});
        },
        toggle() {
          if (api.collapsed) api.expand();
          else api.collapse();
        }
      };
      if (ctx.node.layoutProps.collapsed) ctx.setState("collapsed", true);
      return api;
    },
    detach(ctx) {
      ctx.setState("collapsed", null);
    }
  };
  var resizable = {
    name: "resizable",
    version: "1.0.0",
    requires: ["focusable"],
    events: ["resizestart", "resize", "resizeend"],
    keys: {
      "Shift+ArrowLeft": "narrower",
      "Shift+ArrowRight": "wider",
      "Shift+ArrowUp": "shorter",
      "Shift+ArrowDown": "taller"
    },
    attach(ctx, options) {
      const opts = options || {};
      if (!arbitrate(ctx)) return {};
      ctx.node.positioning = "self";
      const handles = opts.handles || ["n", "e", "s", "w", "ne", "se", "sw", "nw"];
      const state = { active: null };
      for (const direction of handles) {
        const handle = ctx.dom("span", {
          class: `mk-resize-handle mk-resize-handle--${direction}`,
          "data-mk-handle": direction,
          "aria-hidden": "true"
        });
        ctx.own(listen(handle, "pointerdown", (event) => startResize(ctx, state, opts, direction, event)));
      }
      ctx.own(listen(ctx.el, "pointermove", (event) => moveResize(ctx, state, opts, event)));
      ctx.own(listen(ctx.el, "pointerup", () => endResize(ctx, state)));
      ctx.own(listen(ctx.el, "pointercancel", () => endResize(ctx, state, true)));
      ctx.own(listen(ctx.el, "keydown", (event) => onResizeKey(ctx, opts, event)));
      return {
        get resizing() {
          return !!state.active;
        },
        resizeBy(dw, dh) {
          applyResize(ctx, opts, ctx.node.computed.w + dw, ctx.node.computed.h + dh);
        }
      };
    }
  };
  function startResize(ctx, state, opts, direction, event) {
    event.preventDefault();
    event.stopPropagation();
    event.target.setPointerCapture(event.pointerId);
    state.active = {
      direction,
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      from: { ...ctx.node.computed }
    };
    ctx.setState("resizing", true);
    ctx.emit("resizestart", { direction });
  }
  function moveResize(ctx, state, opts, event) {
    if (!state.active) return;
    const { direction, origin, from } = state.active;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    let w = from.w + (direction.includes("e") ? dx : direction.includes("w") ? -dx : 0);
    let h = from.h + (direction.includes("s") ? dy : direction.includes("n") ? -dy : 0);
    let x = from.x + (direction.includes("w") ? dx : 0);
    let y = from.y + (direction.includes("n") ? dy : 0);
    if (opts.aspect) {
      const ratio = typeof opts.aspect === "number" ? opts.aspect : from.w / from.h;
      if (Math.abs(dx) > Math.abs(dy)) h = w / ratio;
      else w = h * ratio;
    }
    const bounded = applyResize(ctx, opts, w, h);
    ctx.constrain({
      left: direction.includes("w") ? x + (w - bounded.w) : from.x,
      top: direction.includes("n") ? y + (h - bounded.h) : from.y
    });
    ctx.emit("resize", { ...bounded, direction });
  }
  function applyResize(ctx, opts, w, h) {
    const min = opts.min || {};
    const max = opts.max || {};
    const width = Math.min(Math.max(w, min.w == null ? 32 : min.w), max.w == null ? Infinity : max.w);
    const height = Math.min(Math.max(h, min.h == null ? 32 : min.h), max.h == null ? Infinity : max.h);
    ctx.constrain({ width, height, size: void 0 });
    return { w: width, h: height };
  }
  function endResize(ctx, state, cancelled) {
    if (!state.active) return;
    const { from } = state.active;
    state.active = null;
    ctx.setState("resizing", false);
    if (cancelled) ctx.constrain({ width: from.w, height: from.h, left: from.x, top: from.y });
    ctx.emit("resizeend", { cancelled: !!cancelled });
  }
  function onResizeKey(ctx, opts, event) {
    if (!event.shiftKey) return;
    const step = opts.step || 16;
    const map = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };
    const move2 = map[event.key];
    if (!move2) return;
    event.preventDefault();
    applyResize(ctx, opts, ctx.node.computed.w + move2[0], ctx.node.computed.h + move2[1]);
    ctx.emit("resizeend", { cancelled: false });
  }

  // source/traits/collections.js
  var scrollable = {
    name: "scrollable",
    version: "1.0.0",
    events: ["scroll", "scrollend"],
    /** The browser's own keys, declared because P5 asks what the equivalent is. */
    keys: {
      ArrowUp: "up",
      ArrowDown: "down",
      PageUp: "page-up",
      PageDown: "page-down",
      Home: "top",
      End: "bottom"
    },
    attach(ctx, options) {
      const opts = options || {};
      const el2 = ctx.el;
      if (!el2) return {};
      const axis = opts.axis || "y";
      el2.style.overflowX = axis === "y" ? "hidden" : "auto";
      el2.style.overflowY = axis === "x" ? "hidden" : "auto";
      el2.style.overscrollBehavior = opts.overscroll || "contain";
      if (!el2.hasAttribute("tabindex")) el2.setAttribute("tabindex", "0");
      if (opts.restore !== false && ctx.node.state.scrollOffset) {
        const saved = ctx.node.state.scrollOffset;
        el2.scrollLeft = saved.x || 0;
        el2.scrollTop = saved.y || 0;
      }
      let idle = null;
      ctx.own(
        listen(el2, "scroll", () => {
          ctx.node.state.scrollOffset = { x: el2.scrollLeft, y: el2.scrollTop };
          ctx.mk.persistDirty = true;
          ctx.invalidate("paint");
          ctx.emit("scroll", { x: el2.scrollLeft, y: el2.scrollTop });
          if (idle) idle();
          idle = ctx.own(timer(() => ctx.emit("scrollend", { x: el2.scrollLeft, y: el2.scrollTop }), 120));
        })
      );
      return {
        get offset() {
          return { x: el2.scrollLeft, y: el2.scrollTop };
        },
        scrollTo(x, y) {
          el2.scrollTo({ left: x, top: y, behavior: reducedMotion(ctx) ? "auto" : "smooth" });
        },
        /** Bring a child into view without scrolling its ancestors. */
        reveal(node) {
          const child = node && node.el ? node.el : node;
          if (child && child.scrollIntoView) child.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      };
    }
  };
  function reducedMotion(ctx) {
    return !!ctx.mk.metrics.current.reducedMotion;
  }
  var selectable = {
    name: "selectable",
    version: "1.0.0",
    events: ["selectionchange"],
    keys: {
      ArrowUp: "previous",
      ArrowDown: "next",
      "Shift+ArrowUp": "extend-previous",
      "Shift+ArrowDown": "extend-next",
      "Mod+a": "select-all",
      Escape: "clear",
      " ": "toggle"
    },
    attach(ctx, options) {
      const opts = options || {};
      const mode = opts.mode || "single";
      const state = { selected: new Set(opts.selected || []), anchor: null };
      const items = () => ctx.node.children.filter((child) => !child.destroyed);
      const idOf2 = (node) => node.id || String(node.index);
      const apply2 = () => {
        for (const child of items()) {
          const on = state.selected.has(idOf2(child));
          if (child.el) child.el.setAttribute("aria-selected", String(on));
          ctx.mk.compiler.setState(child, "selected", on);
        }
        ctx.invalidate("style");
        ctx.emit("selectionchange", { selected: [...state.selected] });
      };
      const api = {
        get selected() {
          return [...state.selected];
        },
        isSelected: (id) => state.selected.has(id),
        /** `select(id, { additive, range })` — the three behaviours in one call. */
        select(id, modifiers) {
          const mods = modifiers || {};
          if (mode === "single" || !mods.additive && !mods.range) {
            state.selected = /* @__PURE__ */ new Set([id]);
            state.anchor = id;
          } else if (mods.range && state.anchor != null) {
            const list = items().map(idOf2);
            const from = list.indexOf(state.anchor);
            const to = list.indexOf(id);
            if (from !== -1 && to !== -1) {
              const [start2, end2] = from < to ? [from, to] : [to, from];
              state.selected = new Set(list.slice(start2, end2 + 1));
            }
          } else {
            if (state.selected.has(id)) state.selected.delete(id);
            else state.selected.add(id);
            state.anchor = id;
          }
          apply2();
          return api.selected;
        },
        selectAll() {
          if (mode === "single") return api.selected;
          state.selected = new Set(items().map(idOf2));
          apply2();
          return api.selected;
        },
        clear() {
          state.selected = /* @__PURE__ */ new Set();
          state.anchor = null;
          apply2();
        }
      };
      if (ctx.el) {
        ctx.el.setAttribute("aria-multiselectable", mode === "single" ? "false" : "true");
        ctx.own(
          listen(ctx.el, "click", (event) => {
            const child = items().find((node) => node.el && node.el.contains(event.target));
            if (!child) return;
            api.select(idOf2(child), {
              additive: event.ctrlKey || event.metaKey,
              range: event.shiftKey
            });
          })
        );
        ctx.own(listen(ctx.el, "keydown", (event) => onSelectKey(ctx, api, items, idOf2, event)));
      }
      if (state.selected.size) apply2();
      return api;
    }
  };
  function onSelectKey(ctx, api, items, idOf2, event) {
    const list = items().map(idOf2);
    if (!list.length) return;
    const current = api.selected[api.selected.length - 1];
    const index = list.indexOf(current);
    if (event.key === "a" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      api.selectAll();
      return;
    }
    if (event.key === "Escape") {
      api.clear();
      return;
    }
    let next = null;
    if (event.key === "ArrowDown") next = index + 1;
    else if (event.key === "ArrowUp") next = index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = list.length - 1;
    else return;
    event.preventDefault();
    const id = list[Math.min(Math.max(next, 0), list.length - 1)];
    api.select(id, { range: event.shiftKey, additive: false });
  }
  var sortable = {
    name: "sortable",
    version: "1.0.0",
    events: ["sortstart", "sort", "sortend"],
    /** Reordering by keyboard is the equivalent, and it is not optional (P5). */
    keys: {
      "Mod+ArrowUp": "move-up",
      "Mod+ArrowDown": "move-down",
      Space: "grab",
      Escape: "cancel"
    },
    attach(ctx, options) {
      const opts = options || {};
      const state = { dragging: null, from: -1 };
      const items = () => ctx.node.children.filter((child) => !child.destroyed);
      const api = {
        /** Move the child at `from` to `to`. The one operation everything uses. */
        move(from, to) {
          const list = items();
          const child = list[from];
          const before = list[to > from ? to + 1 : to];
          if (!child) return false;
          ctx.emit("sortstart", { from, to });
          ctx.mk.reparent(child, ctx.node, before || null);
          ctx.mk.persistDirty = true;
          ctx.emit("sort", { from, to, id: child.id });
          ctx.emit("sortend", { from, to, cancelled: false });
          return true;
        },
        get order() {
          return items().map((child) => child.id);
        }
      };
      if (!ctx.el) return api;
      ctx.own(
        listen(ctx.el, "pointerdown", (event) => {
          const list = items();
          const index = list.findIndex((child) => child.el && child.el.contains(event.target));
          if (index === -1) return;
          state.dragging = list[index];
          state.from = index;
          ctx.mk.compiler.setState(state.dragging, "grabbed", true);
        })
      );
      ctx.own(
        listen(ctx.el, "pointermove", (event) => {
          if (!state.dragging) return;
          const target = items().findIndex((child) => child.el && child.el.contains(event.target));
          if (target === -1 || target === state.from) return;
          for (const child of items()) ctx.mk.compiler.setState(child, "drop-before", false);
          ctx.mk.compiler.setState(items()[target], "drop-before", true);
          ctx.invalidate("style");
        })
      );
      const release2 = (cancelled) => {
        if (!state.dragging) return;
        const target = items().findIndex((child) => child.el && child.el.hasAttribute("data-mk-drop-before"));
        ctx.mk.compiler.setState(state.dragging, "grabbed", false);
        for (const child of items()) ctx.mk.compiler.setState(child, "drop-before", false);
        ctx.invalidate("style");
        const from = state.from;
        state.dragging = null;
        state.from = -1;
        if (cancelled || target === -1 || target === from) {
          ctx.emit("sortend", { from, to: from, cancelled: true });
          return;
        }
        api.move(from, target);
      };
      ctx.own(listen(ctx.el, "pointerup", () => release2(false)));
      ctx.own(listen(ctx.el, "pointercancel", () => release2(true)));
      ctx.own(listen(ctx.el, "keydown", (event) => onSortKey(ctx, api, items, event)));
      return api;
    }
  };
  function onSortKey(ctx, api, items, event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const list = items();
    const active = list.findIndex((child) => child.el && child.el.contains(activeElement()));
    if (active === -1) return;
    if (event.key === "ArrowUp" && active > 0) {
      event.preventDefault();
      api.move(active, active - 1);
    } else if (event.key === "ArrowDown" && active < list.length - 1) {
      event.preventDefault();
      api.move(active, active + 1);
    }
  }
  var virtualized = {
    name: "virtualized",
    version: "1.0.0",
    requires: ["scrollable"],
    events: ["rangechange"],
    keys: { PageUp: "page-up", PageDown: "page-down", Home: "top", End: "bottom" },
    attach(ctx, options) {
      const opts = options || {};
      const rowHeight = opts.rowHeight || 24;
      const overscan = opts.overscan == null ? 4 : opts.overscan;
      const state = { start: 0, end: 0, total: opts.total || 0 };
      const spacer2 = ctx.dom("div", {
        class: "mk-virtual-spacer",
        "aria-hidden": "true",
        style: { position: "absolute", top: "0", left: "0", width: "1px", pointerEvents: "none" }
      });
      const measure = () => {
        const el2 = ctx.el;
        if (!el2) return;
        const height = el2.clientHeight || 0;
        const first = Math.max(0, Math.floor(el2.scrollTop / rowHeight) - overscan);
        const visible = Math.ceil(height / rowHeight) + overscan * 2;
        const last = Math.min(state.total, first + visible);
        if (first === state.start && last === state.end) return;
        state.start = first;
        state.end = last;
        spacer2.style.height = `${state.total * rowHeight}px`;
        ctx.emit("rangechange", { start: first, end: last, rowHeight });
      };
      ctx.own(ctx.mk.scheduler.on("read", measure));
      return {
        get range() {
          return { start: state.start, end: state.end };
        },
        setTotal(total) {
          state.total = total;
          spacer2.style.height = `${total * rowHeight}px`;
          measure();
        },
        /** Scroll so `index` is visible, without measuring anything. */
        scrollToIndex(index) {
          if (ctx.el) ctx.el.scrollTop = index * rowHeight;
        }
      };
    }
  };
  var persistable = {
    name: "persistable",
    version: "1.0.0",
    keys: {},
    attach(ctx, options) {
      const opts = options || {};
      const keys = opts.keys || [];
      if (!ctx.node.id) {
        warn(
          "MK4005",
          `'${ctx.node.type}' is persistable but has no id, so it can only be restored by its position in the tree. Give it an id if its place may change.`,
          { subject: ctx.node.toString() }
        );
      }
      ctx.node.persistKeys = keys;
      return {
        get keys() {
          return keys;
        },
        /** The slice of this element's state that a saved layout should carry. */
        snapshot() {
          const out = {};
          for (const key of keys) out[key] = ctx.node.props[key];
          return out;
        }
      };
    }
  };
  var COLLECTION_CSS = `
  [data-mk-selected] { background: var(--mk-color-surface-sunken); }
  [data-mk-grabbed] { opacity: 0.6; }
  [data-mk-drop-before] { box-shadow: inset 0 2px 0 var(--mk-color-accent); }
`;
  selectable.styles = COLLECTION_CSS;
  sortable.styles = COLLECTION_CSS;
  var COLLECTION_TRAITS = [scrollable, selectable, sortable, virtualized, persistable];

  // source/elements/structural/resizer.js
  var resizer = {
    type: "resizer",
    version: "1.0.0",
    props: {
      axis: { type: "enum", values: ["x", "y"], default: "x" },
      index: { type: "number", default: 0 },
      disabled: { type: "boolean", default: false }
    },
    events: ["resizestart", "resize", "resizeend", "collapse", "expand"],
    /**
     * `role="separator"` with a value range, which is what makes the keyboard
     * path meaningful to a screen reader rather than merely present.
     */
    a11y: {
      role: "separator",
      props: {
        "aria-orientation": (ctx) => ctx.props.axis === "x" ? "vertical" : "horizontal",
        "aria-disabled": (ctx) => ctx.props.disabled ? "true" : null,
        tabindex: (ctx) => ctx.props.disabled ? null : "0"
      }
    },
    keys: {
      ArrowLeft: "shrink",
      ArrowRight: "grow",
      ArrowUp: "shrink",
      ArrowDown: "grow",
      Home: "min",
      End: "max",
      Enter: "toggle",
      Escape: "cancel"
    },
    commands: {
      /** Move the gutter by `delta` pixels, as a drag of that distance would. */
      nudge(ctx, delta) {
        commit(ctx, drag(ctx, delta));
      },
      /** Collapse or restore the pane before this gutter. */
      toggle(ctx) {
        toggleCollapse(ctx);
      },
      cancel(ctx) {
        cancelDrag(ctx);
      }
    },
    create(ctx) {
      const el2 = ctx.dom("div", { class: `mk-resizer mk-resizer--${ctx.props.axis}` });
      ctx.state.drag = null;
      el2.setAttribute("aria-valuenow", "0");
      el2.setAttribute("aria-valuemin", "0");
      el2.setAttribute("aria-valuemax", "0");
      return el2;
    },
    mount(ctx) {
      const el2 = ctx.el;
      ctx.own(listen(el2, "pointerdown", (event) => onPointerDown(ctx, event)));
      ctx.own(listen(el2, "pointermove", (event) => onPointerMove(ctx, event)));
      ctx.own(listen(el2, "pointerup", (event) => onPointerUp(ctx, event)));
      ctx.own(listen(el2, "pointercancel", () => cancelDrag(ctx)));
      ctx.own(listen(el2, "lostpointercapture", () => cancelDrag(ctx)));
      ctx.own(listen(el2, "dblclick", () => toggleCollapse(ctx)));
      ctx.own(listen(el2, "keydown", (event) => onKeyDown(ctx, event)));
      applyHitSlop(ctx);
    },
    update(ctx, changed) {
      if (changed.has("axis")) applyHitSlop(ctx);
    },
    styles: css`
    .mk-resizer {
      /* No position declaration: the engine decides whether a node is
       absolute or in flow, and an absolutely positioned box establishes a
       containing block just as a relative one does. Declaring it here beat
       the base stylesheet's absolute positioning on .mk-node and displaced
       the element by whatever flow put above it. See layout/anchor.js. */
      background: var(--mk-resizer-bg, var(--mk-border-subtle));
      touch-action: none;
      z-index: 1;
    }
    .mk-resizer--x { cursor: col-resize; }
    .mk-resizer--y { cursor: row-resize; }

    /* The interactive area is larger than the visual gutter. A 1–6px line is
       the right *look* and the wrong *target* (§7.3, and WCAG 2.2 target size). */
    .mk-resizer::before {
      content: "";
      position: absolute;
      inset: calc(-1 * var(--mk-resizer-slop, 4px)) 0;
    }
    .mk-resizer--x::before {
      inset: 0 calc(-1 * var(--mk-resizer-slop, 4px));
    }

    .mk-resizer:hover,
    .mk-resizer[data-mk-dragging] {
      background: var(--mk-resizer-active-bg, var(--mk-color-accent));
    }
    .mk-resizer:focus-visible {
      outline: var(--mk-focus-ring);
      outline-offset: 1px;
    }
    .mk-resizer[aria-disabled="true"] {
      cursor: default;
      pointer-events: none;
    }

    /* The deferred ghost: a preview bar drawn where the gutter would land. */
    .mk-resizer[data-mk-ghost]::after {
      content: "";
      position: absolute;
      inset: 0;
      background: var(--mk-color-accent);
      transform: translate(var(--mk-ghost-x, 0), var(--mk-ghost-y, 0));
      opacity: 0.6;
      pointer-events: none;
    }
  `
  };
  function applyHitSlop(ctx) {
    const metrics = ctx.mk.metrics.current;
    const slop = metrics.coarsePointer ? 12 : 4;
    ctx.css({ "--mk-resizer-slop": `${slop}px` });
  }
  function onPointerDown(ctx, event) {
    if (ctx.props.disabled || event.button !== 0) return;
    const split2 = ctx.node.parent;
    if (!split2) return;
    const options = normalizeOptions(split2.algorithmOptions);
    ctx.mk.tick();
    const model = split2.splitModel;
    if (!model) return;
    event.preventDefault();
    ctx.el.setPointerCapture(event.pointerId);
    ctx.state.drag = {
      pointerId: event.pointerId,
      axis: options.axis,
      mode: options.resizeMode,
      live: options.live,
      origin: options.axis === "x" ? event.clientX : event.clientY,
      start: model.sizes.slice(),
      model,
      // Computed once and held: recomputing the flexible set per frame would let
      // the track form change mid-drag, which is visible as a jump (§7.3).
      css: canUseCSSPath(model, ctx.props.index, options.resizeMode),
      moved: false
    };
    ctx.setState("dragging", true);
    ctx.emit("resizestart", { index: ctx.props.index, sizes: model.sizes.slice() });
  }
  function onPointerMove(ctx, event) {
    const state = ctx.state.drag;
    if (!state || event.pointerId !== state.pointerId) return;
    const position = state.axis === "x" ? event.clientX : event.clientY;
    const delta = position - state.origin;
    state.moved = true;
    const result = drag(ctx, delta);
    if (!state.live) {
      ctx.setState("ghost", true);
      ctx.css({
        [state.axis === "x" ? "--mk-ghost-x" : "--mk-ghost-y"]: `${result.applied}px`
      });
      return;
    }
    writeSizes(ctx, result);
    ctx.emit("resize", { index: ctx.props.index, sizes: result.sizes });
  }
  function onPointerUp(ctx, event) {
    const state = ctx.state.drag;
    if (!state || event.pointerId !== state.pointerId) return;
    const position = state.axis === "x" ? event.clientX : event.clientY;
    const result = drag(ctx, position - state.origin);
    commit(ctx, result);
  }
  function cancelDrag(ctx) {
    const state = ctx.state.drag;
    if (!state) return;
    writeSizes(ctx, { sizes: state.start, applied: 0 });
    finish(ctx);
    ctx.emit("resizeend", { index: ctx.props.index, sizes: state.start, cancelled: true });
  }
  function finish(ctx) {
    ctx.state.drag = null;
    ctx.setState("dragging", false);
    ctx.setState("ghost", false);
    ctx.css({ "--mk-ghost-x": null, "--mk-ghost-y": null });
  }
  function restoreTrack(ctx, track, index) {
    ctx.mk.setLayoutProps(track.pane, {
      collapsed: false,
      size: track.pane.state.restoreSize != null ? track.pane.state.restoreSize : track.min || 200
    });
    const split2 = ctx.node.parent;
    if (split2 && index != null && index >= 0) {
      ctx.mk.compiler.setAll(split2, { [`--mk-w-${index}`]: null });
      ctx.mk.compiler.flush(split2);
    }
    ctx.emit("expand", { index: ctx.props.index, pane: track.pane.id });
  }
  function restoreFromDrag(ctx, model, index, delta) {
    const candidates = [
      { track: model.tracks[index], grows: delta > 0 },
      { track: model.tracks[index + 1], grows: delta < 0 }
    ];
    for (let i = 0; i < candidates.length; i++) {
      const { track, grows } = candidates[i];
      if (!track || !track.collapsed || !grows) continue;
      const at = typeof track.collapsible === "object" ? track.collapsible.at : track.min;
      if (Math.abs(delta) < (at || 0)) continue;
      restoreTrack(ctx, track, index + i);
      return index + i;
    }
    return -1;
  }
  function drag(ctx, delta) {
    const state = ctx.state.drag || seedFromCurrent(ctx);
    const model = state.model;
    const index = ctx.props.index;
    const restored = restoreFromDrag(ctx, model, index, delta);
    if (restored !== -1) {
      return { sizes: model.sizes.slice(), applied: 0, restored };
    }
    const result = resolveDrag(model, index, delta, state.mode, state.start);
    for (const i of [index, index + 1]) {
      const track = model.tracks[i];
      if (!track) continue;
      result.sizes[i] = applySnap(track, result.sizes[i]);
      if (!track.collapsed && shouldCollapse(track, result.sizes[i])) result.collapse = i;
    }
    return result;
  }
  function seedFromCurrent(ctx) {
    const split2 = ctx.node.parent;
    const options = normalizeOptions(split2.algorithmOptions);
    ctx.mk.tick();
    const model = split2.splitModel;
    return {
      axis: options.axis,
      mode: options.resizeMode,
      live: true,
      start: model ? model.sizes.slice() : [],
      model,
      css: false
    };
  }
  function writeSizes(ctx, result) {
    const split2 = ctx.node.parent;
    const state = ctx.state.drag;
    const model = state ? state.model : split2.splitModel;
    if (!split2 || !model) return;
    const properties = {};
    result.sizes.forEach((size, i) => {
      if (model.tracks[i].flexible && state && state.css) return;
      properties[`--mk-w-${i}`] = `${Math.round(size * 100) / 100}px`;
    });
    ctx.mk.compiler.setAll(split2, properties);
    ctx.mk.compiler.flush(split2);
  }
  function commit(ctx, result) {
    const split2 = ctx.node.parent;
    const state = ctx.state.drag;
    const model = state ? state.model : split2 && split2.splitModel;
    if (!split2 || !model) return;
    if (result && result.restored !== void 0 && result.restored !== -1) {
      finish(ctx);
      ctx.mk.persistDirty = true;
      ctx.invalidate("arrange");
      return;
    }
    const axis = state ? state.axis : ctx.props.axis;
    const measured = state && state.css ? readBack(model, axis) : result.sizes;
    const flexible = model.tracks.filter(
      (track, i) => track.flexible && !track.collapsed && isFinite(measured[i])
    );
    const flexPx = flexible.reduce((sum, track) => sum + measured[model.tracks.indexOf(track)], 0);
    const flexFr = flexible.reduce((sum, track) => sum + (track.fr || 0), 0);
    model.tracks.forEach((track, i) => {
      if (track.collapsed) return;
      const size = measured[i];
      if (size == null || !isFinite(size)) return;
      if (track.flexible) {
        if (flexPx > 0 && flexFr > 0) {
          const share = Math.round(size / flexPx * flexFr * 1e3) / 1e3;
          ctx.mk.setLayoutProps(track.pane, { size: `${share}fr` });
        }
        return;
      }
      ctx.mk.setLayoutProps(track.pane, { size });
    });
    const pinned = {};
    model.tracks.forEach((track, i) => {
      if (track.collapsed || track.flexible) return;
      const size = measured[i];
      if (size == null || !isFinite(size)) return;
      pinned[`--mk-w-${i}`] = `${Math.round(size * 100) / 100}px`;
    });
    if (Object.keys(pinned).length) {
      ctx.mk.compiler.setAll(split2, pinned);
      ctx.mk.compiler.flush(split2);
    }
    if (result.collapse != null) {
      const track = model.tracks[result.collapse];
      track.pane.state.restoreSize = model.sizes[result.collapse];
      ctx.mk.setLayoutProps(track.pane, { collapsed: true });
      ctx.emit("collapse", { index: result.collapse, pane: track.pane.id });
    }
    finish(ctx);
    ctx.mk.persistDirty = true;
    ctx.invalidate("arrange");
    ctx.emit("resizeend", { index: ctx.props.index, sizes: measured, cancelled: false });
  }
  function readBack(model, axis) {
    return model.tracks.map((track) => {
      if (!track.pane.el) return null;
      const box = track.pane.el.getBoundingClientRect();
      return axis === "x" ? box.width : box.height;
    });
  }
  function toggleCollapse(ctx) {
    const split2 = ctx.node.parent;
    const model = split2 && split2.splitModel;
    if (!model) return;
    const track = [model.tracks[ctx.props.index], model.tracks[ctx.props.index + 1]].find(
      (candidate) => candidate && candidate.collapsible
    );
    if (!track) return;
    const bag = track.pane.layoutProps;
    if (bag.collapsed) {
      restoreTrack(ctx, track, model.tracks.indexOf(track));
    } else {
      track.pane.state.restoreSize = model.sizes[model.tracks.indexOf(track)];
      ctx.mk.setLayoutProps(track.pane, { collapsed: true });
      ctx.emit("collapse", { index: ctx.props.index, pane: track.pane.id });
    }
    ctx.mk.persistDirty = true;
    ctx.invalidate("arrange");
  }
  function onKeyDown(ctx, event) {
    if (ctx.props.disabled) return;
    const split2 = ctx.node.parent;
    const model = split2 && split2.splitModel;
    if (!model) return;
    const options = normalizeOptions(split2.algorithmOptions);
    const axis = options.axis;
    const step = options.step * (event.shiftKey ? 5 : 1);
    const forward = axis === "x" ? "ArrowRight" : "ArrowDown";
    const backward = axis === "x" ? "ArrowLeft" : "ArrowUp";
    let delta = null;
    if (event.key === forward) delta = step;
    else if (event.key === backward) delta = -step;
    else if (event.key === "Home") delta = -Infinity;
    else if (event.key === "End") delta = Infinity;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleCollapse(ctx);
      return;
    } else if (event.key === "Escape") {
      cancelDrag(ctx);
      return;
    } else {
      return;
    }
    event.preventDefault();
    const bounded = delta === Infinity ? model.content : delta === -Infinity ? -model.content : delta;
    commit(ctx, drag(ctx, bounded));
  }

  // source/elements/structural/split.js
  var split = {
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

  // source/elements/structural/tabs.js
  var tabs = {
    type: "tabs",
    version: "1.0.0",
    algorithm: "anchor",
    props: {
      items: { type: "array", default: () => [] },
      active: { type: "string", default: "", persist: true },
      closable: { type: "boolean", default: false },
      reorderable: { type: "boolean", default: false },
      placement: { type: "enum", values: ["top", "bottom"], default: "top" }
    },
    // A tab group fills the pane it is put in. Declaring nothing left it at 0×1
    // — the whole editor area vanished, and the author's next move is to guess a
    // pixel size for something that should simply take the space it was given.
    geometry: { defaults: { size: { w: "100%", h: "100%" } } },
    events: ["change", "close", "reorder"],
    a11y: { role: "group", props: { "aria-label": (ctx) => ctx.props.label || null } },
    commands: {
      select(ctx, id) {
        if (ctx.props.active === id) return;
        ctx.handle.set({ active: id });
        ctx.mk.persistDirty = true;
        ctx.emit("change", { active: id });
      },
      close(ctx, id) {
        const remaining = ctx.props.items.filter((item) => idOf(item) !== id);
        ctx.handle.set({ items: remaining });
        if (ctx.props.active === id && remaining.length) {
          ctx.node.definition.commands.select(ctx, idOf(remaining[0]));
        }
        ctx.emit("close", { id });
      }
    },
    create(ctx) {
      const el2 = ctx.dom("div", { class: `mk-tabs mk-tabs--${ctx.props.placement}` }, null);
      ctx.state.list = el("div", { class: "mk-tabs__list", role: "tablist" }, el2);
      ctx.state.panels = el("div", { class: "mk-tabs__panels" }, el2);
      ctx.node.contentEl = ctx.state.panels;
      ctx.own(listen(ctx.state.list, "keydown", (event) => onTabKey(ctx, event)));
      renderTabs(ctx);
      return el2;
    },
    update(ctx, changed) {
      if (changed.has("items") || changed.has("active") || changed.has("closable")) renderTabs(ctx);
    },
    /**
     * Panels are children, and children are created *after* the element that
     * groups them — so syncing only in `create` leaves every panel visible and
     * every one of them in the tab order. Idempotent, and it costs three
     * attribute reads per panel.
     */
    arrange(ctx) {
      syncPanels(ctx);
    },
    styles: css`
    .mk-tabs { display: flex; flex-direction: column; }
    .mk-tabs--bottom { flex-direction: column-reverse; }
    .mk-tabs__list {
      display: flex;
      gap: 2px;
      border-bottom: 1px solid var(--mk-border-subtle);
      overflow-x: auto;
    }
    .mk-tabs__tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      min-height: var(--mk-target-min);
      border: 0;
      background: none;
      cursor: pointer;
      border-bottom: 2px solid transparent;
    }
    .mk-tabs__tab[aria-selected="true"] {
      border-bottom-color: var(--mk-color-accent);
      font-weight: 600;
    }
    .mk-tabs__close {
      border: 0;
      background: none;
      cursor: pointer;
      line-height: 1;
      min-width: 20px;
    }
    .mk-tabs__panels { flex: 1 1 auto; min-height: 0; position: relative; }
  `
  };
  function idOf(item) {
    return typeof item === "string" ? item : item.id;
  }
  function labelOf(item) {
    return typeof item === "string" ? item : item.label || item.id;
  }
  function renderTabs(ctx) {
    const list = ctx.state.list;
    list.textContent = "";
    ctx.state.tabs = [];
    const items = ctx.props.items || [];
    const active = ctx.props.active || (items.length ? idOf(items[0]) : "");
    items.forEach((item) => {
      const id = idOf(item);
      const selected = id === active;
      const tab = el("button", {
        type: "button",
        role: "tab",
        class: "mk-tabs__tab",
        id: `${id}-tab`,
        "aria-selected": String(selected),
        // Set only once the panel exists — see syncPanels. A dangling
        // `aria-controls` is worse than none: it promises a relationship the
        // assistive technology then cannot follow.
        "aria-controls": null,
        // Roving tabindex: a tablist is one tab stop, and arrows move within it.
        tabindex: selected ? "0" : "-1",
        // The keyboard path to closing, announced rather than left to be
        // discovered. It is the *real* path: the × below is a pointer
        // affordance, deliberately not a control.
        "aria-keyshortcuts": ctx.props.closable ? "Delete" : null,
        text: labelOf(item)
      }, list);
      ctx.state.tabs.push({ tab, id });
      ctx.own(listen(tab, "click", () => ctx.node.definition.commands.select(ctx, id)));
      if (ctx.props.closable) {
        const close = el("span", {
          class: "mk-tabs__close",
          "aria-hidden": "true",
          text: "\xD7"
        }, tab);
        ctx.own(
          listen(close, "click", (event) => {
            event.stopPropagation();
            ctx.node.definition.commands.close(ctx, id);
          })
        );
      }
    });
    syncPanels(ctx);
  }
  function syncPanels(ctx) {
    const items = ctx.props.items || [];
    const active = ctx.props.active || (items.length ? idOf(items[0]) : "");
    for (const child of ctx.node.children) {
      if (!child.el) continue;
      const selected = child.id === active;
      child.el.setAttribute("role", "tabpanel");
      child.el.id = `${child.id}-panel`;
      child.el.setAttribute("aria-labelledby", `${child.id}-tab`);
      const tab = ctx.state.list.querySelector(`#${CSS.escape(child.id)}-tab`);
      if (tab) tab.setAttribute("aria-controls", `${child.id}-panel`);
      child.el.hidden = !selected;
      child.el.toggleAttribute("inert", !selected);
    }
  }
  function onTabKey(ctx, event) {
    const entries = ctx.state.tabs || [];
    if (!entries.length) return;
    const index = entries.findIndex((entry2) => entry2.id === ctx.props.active);
    let next = null;
    if (event.key === "ArrowRight") next = index + 1;
    else if (event.key === "ArrowLeft") next = index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = entries.length - 1;
    else if (event.key === "Delete" && ctx.props.closable) {
      event.preventDefault();
      ctx.node.definition.commands.close(ctx, entries[index].id);
      return;
    } else return;
    event.preventDefault();
    const entry = entries[(next + entries.length) % entries.length];
    ctx.node.definition.commands.select(ctx, entry.id);
    entry.tab.focus();
  }
  var accordion = {
    type: "accordion",
    version: "1.0.0",
    algorithm: "stack",
    props: {
      sections: { type: "array", default: () => [] },
      open: { type: "array", of: "string", default: () => [], persist: true },
      multiple: { type: "boolean", default: false }
    },
    events: ["toggle"],
    a11y: { role: "group" },
    commands: {
      toggle(ctx, id) {
        const isOpen = ctx.props.open.includes(id);
        const next = isOpen ? ctx.props.open.filter((other) => other !== id) : ctx.props.multiple ? [...ctx.props.open, id] : [id];
        ctx.handle.set({ open: next });
        ctx.emit("toggle", { id, open: !isOpen });
      }
    },
    create(ctx) {
      const el2 = ctx.dom("div", { class: "mk-accordion" }, null);
      ctx.state.render = () => {
        el2.textContent = "";
        for (const section of ctx.props.sections) {
          const id = idOf(section);
          const open = ctx.props.open.includes(id);
          const heading = el("h3", { class: "mk-accordion__heading" }, el2);
          const trigger = el("button", {
            type: "button",
            class: "mk-accordion__trigger",
            id: `${id}-trigger`,
            "aria-expanded": String(open),
            "aria-controls": `${id}-region`,
            text: labelOf(section)
          }, heading);
          const region = el("div", {
            class: "mk-accordion__region",
            id: `${id}-region`,
            role: "region",
            "aria-labelledby": `${id}-trigger`,
            hidden: open ? null : ""
          }, el2);
          if (section.content) setText(region, section.content);
          ctx.own(listen(trigger, "click", () => ctx.node.definition.commands.toggle(ctx, id)));
        }
      };
      ctx.state.render();
      return el2;
    },
    update(ctx, changed) {
      if (changed.has("open") || changed.has("sections")) ctx.state.render();
    },
    styles: css`
    .mk-accordion__heading { margin: 0; }
    .mk-accordion__trigger {
      display: block;
      width: 100%;
      text-align: left;
      padding: 8px 12px;
      min-height: var(--mk-target-min);
      border: 0;
      border-top: 1px solid var(--mk-border-subtle);
      background: none;
      cursor: pointer;
      font-weight: 600;
    }
    .mk-accordion__region { padding: 8px 12px; }
  `
  };
  var scroll = {
    type: "scroll",
    version: "1.0.0",
    extends: "pane",
    props: {
      axis: { type: "enum", values: ["y", "x", "both"], default: "y" },
      restore: { type: "boolean", default: true },
      offset: { type: "object", default: () => ({ x: 0, y: 0 }), persist: true }
    },
    events: ["scroll"],
    a11y: { role: "group", props: { tabindex: "0" } },
    mount(ctx) {
      const el2 = ctx.el;
      el2.style.overflowX = ctx.props.axis === "y" ? "hidden" : "auto";
      el2.style.overflowY = ctx.props.axis === "x" ? "hidden" : "auto";
      el2.style.overscrollBehavior = "contain";
      if (ctx.props.restore) {
        el2.scrollLeft = ctx.props.offset.x || 0;
        el2.scrollTop = ctx.props.offset.y || 0;
      }
      ctx.own(
        listen(el2, "scroll", () => {
          ctx.node.props.offset = { x: el2.scrollLeft, y: el2.scrollTop };
          ctx.mk.persistDirty = true;
          ctx.invalidate("paint");
          ctx.emit("scroll", { x: el2.scrollLeft, y: el2.scrollTop });
        })
      );
    }
  };
  var windowElement = {
    type: "window",
    version: "1.0.0",
    extends: "surface",
    layer: "docked",
    traits: ["draggable", "resizable"],
    props: {
      title: { type: "string", default: "" },
      closable: { type: "boolean", default: true },
      minimizable: { type: "boolean", default: false },
      minimized: { type: "boolean", default: false, persist: true }
    },
    events: ["close", "minimize", "restore", "focus"],
    /** A pointer trait is composed, so a keyboard equivalent is mandatory (P5). */
    keys: {
      ArrowLeft: "move-left",
      ArrowRight: "move-right",
      ArrowUp: "move-up",
      ArrowDown: "move-down",
      Escape: "close"
    },
    geometry: { defaults: { size: { w: 420, h: 300 } } },
    a11y: {
      role: "dialog",
      props: {
        "aria-label": (ctx) => ctx.props.title || null,
        "aria-modal": "false"
      }
    },
    commands: {
      close(ctx) {
        ctx.emit("close", {});
        ctx.mk.destroy(ctx.node);
      },
      minimize(ctx) {
        ctx.handle.set({ minimized: !ctx.props.minimized });
        ctx.emit(ctx.props.minimized ? "minimize" : "restore", {});
      },
      bringToFront(ctx) {
        const layers = ctx.service("layers");
        if (layers) layers.bringToFront(ctx.node);
      }
    },
    create(ctx, inherited) {
      const el2 = inherited;
      const bar = el("div", { class: "mk-window__bar" }, el2);
      el("span", { class: "mk-window__title", text: ctx.props.title }, bar);
      if (ctx.props.minimizable) {
        const minimize = el("button", {
          type: "button",
          class: "mk-window__action",
          "aria-label": "Minimize",
          text: "\u2013"
        }, bar);
        ctx.own(listen(minimize, "click", () => ctx.node.definition.commands.minimize(ctx)));
      }
      if (ctx.props.closable) {
        const close = el("button", {
          type: "button",
          class: "mk-window__action",
          "aria-label": "Close",
          text: "\xD7"
        }, bar);
        ctx.own(listen(close, "click", () => ctx.node.definition.commands.close(ctx)));
      }
      const body2 = el("div", { class: "mk-window__body" }, el2);
      ctx.node.contentEl = body2;
      ctx.node.state.traitOptions = { draggable: { handle: ".mk-window__bar" } };
      return el2;
    },
    mount(ctx) {
      const layers = ctx.service("layers");
      if (layers) {
        layers.add(ctx.node, ctx.node.layer);
        ctx.own(() => layers.remove(ctx.node));
        ctx.own(listen(ctx.el, "pointerdown", () => layers.bringToFront(ctx.node)));
        ctx.own(listen(ctx.el, "focusin", () => {
          layers.bringToFront(ctx.node);
          ctx.emit("focus", {});
        }));
      }
    },
    update(ctx, changed) {
      if (changed.has("minimized")) ctx.setState("minimized", ctx.props.minimized);
      if (changed.has("title")) {
        const title = ctx.el.querySelector(".mk-window__title");
        if (title) setText(title, ctx.props.title);
      }
    },
    styles: css`
    .mk-window { display: flex; flex-direction: column; box-shadow: var(--mk-elevation-2); }
    .mk-window__bar {
      display: flex;
      align-items: center;
      gap: var(--mk-space-2);
      padding: 4px 8px;
      cursor: move;
      background: var(--mk-color-surface-sunken);
      border-bottom: 1px solid var(--mk-border-subtle);
      touch-action: none;
    }
    .mk-window__title { flex: 1 1 auto; font-weight: 600; font-size: var(--mk-text-sm); }
    .mk-window__action {
      border: 0;
      background: none;
      cursor: pointer;
      min-width: var(--mk-target-min);
      min-height: var(--mk-target-min);
    }
    .mk-window__body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: var(--mk-space-3); }
    .mk-window[data-mk-minimized] .mk-window__body { display: none; }
    .mk-window[data-mk-minimized] { height: auto !important; }
  `
  };
  var STRUCTURAL_EXTRAS = [tabs, accordion, scroll, windowElement];

  // source/services/persistence.js
  var persistencePlugin = {
    name: "mutakit-persistence",
    version: "1.0.0",
    install(mk) {
      const service = new Persistence(mk);
      mk.provide("persistence", service);
      mk.serialize = (scope2, options) => service.serialize(scope2, options);
      mk.restore = (doc, options) => service.restore(doc, options);
      mk.persist = (key, options) => service.persist(key, options);
      return {
        uninstall() {
          delete mk.serialize;
          delete mk.restore;
          delete mk.persist;
        }
      };
    }
  };
  var Persistence = class {
    constructor(mk) {
      this.mk = mk;
    }
    /** Walk the tree and emit the tier-2 form, stable-ordered so it diffs well. */
    serialize(scope2, options) {
      const mk = this.mk;
      const opts = options || {};
      const target = resolve3(mk, scope2) || mk.root;
      if (!target) return null;
      return {
        schema: SCHEMA_VERSION,
        mutakit: mk.version,
        frame: {
          algorithm: target.algorithm || "anchor",
          algorithmOptions: stripInternal(target.algorithmOptions)
        },
        tree: target === mk.root ? target.children.map((child) => this._node(child, opts)) : this._node(target, opts)
      };
    }
    _node(node, opts) {
      if (node.placeholderFor) return node.placeholderFor;
      const out = { type: node.type };
      if (node.id) out.id = node.id;
      const schema = node.definition ? node.definition.props : {};
      for (const name of Object.keys(node.props).sort()) {
        const descriptor = schema[name];
        const value = node.props[name];
        if (typeof value === "function") continue;
        if (descriptor && descriptor.persist === false) continue;
        if (descriptor && descriptor.default === value) continue;
        out[name] = value;
      }
      for (const key of Object.keys(node.geometry).sort()) {
        const value = node.geometry[key];
        if (typeof value === "function") continue;
        out[key] = this._len(node, key, value);
      }
      if (Object.keys(node.layoutProps).length) out.layout = { ...node.layoutProps };
      if (node.algorithm && node.algorithm !== "anchor") {
        out.algorithm = node.algorithm;
        if (node.algorithmOptions) out.algorithmOptions = { ...node.algorithmOptions };
      }
      if (node.traits.size) out.traits = [...node.traits.keys()];
      if (node.content !== void 0) out.content = node.content;
      if (node.className) out.class = node.className;
      if (node.inlineStyle) out.style = node.inlineStyle;
      for (const hook of node.definition ? node.definition.hooks.serialize : []) {
        const extra = this.mk.guard(node, "serialize", hook, [this.mk.contextFor(node)]);
        if (extra) Object.assign(out, extra);
      }
      if (node.children.length) out.children = node.children.map((child) => this._node(child, opts));
      return out;
    }
    /**
     * Record the resolved pixel value alongside a custom-unit expression (§19.1).
     *
     * This is the subtler of the two missing-plugin cases: a dropped element type
     * fails visibly, whereas a dropped *unit* silently collapses an element to
     * zero. Recording the pixels keeps the layout geometrically correct without
     * the plugin, and it snaps back to the live expression when it returns.
     */
    _len(node, key, value) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const out = {};
        for (const inner of Object.keys(value)) out[inner] = this._len(node, inner, value[inner]);
        return out;
      }
      if (typeof value !== "string") return value;
      const ast = parse2(value);
      if (!ast || ast.k !== "unit") return value;
      if (!this.mk.registry.get("unit", ast.u)) return value;
      const axis = key === "h" || key === "height" || key === "top" || key === "bottom" ? "y" : "x";
      const basis = node.parent ? axis === "y" ? node.parent.frame.h : node.parent.frame.w : 0;
      const px3 = toNumber(ast, this.mk.lenContext(basis, node));
      return { value, px: isFinite(px3) ? px3 : void 0 };
    }
    restore(doc, options) {
      const mk = this.mk;
      const opts = options || {};
      if (!doc) return null;
      if (opts.allow === void 0) {
        warn(
          "MK4015",
          "restore() was called with no `allow`. A layout from your own localStorage is lower risk; one from a server or another user must pass { allow: { types: [...], props: 'schema' } }. Pass { allow: 'any' } to opt out.",
          { subject: "restore" }
        );
      }
      let saved = doc;
      if (saved.schema !== void 0 && saved.schema !== SCHEMA_VERSION) {
        saved = this._migrate(saved);
      }
      const parent = resolve3(mk, opts.into) || mk.root;
      if (saved.frame && saved.frame.algorithm && mk.registry.has("layout", saved.frame.algorithm)) {
        parent.algorithm = saved.frame.algorithm;
        parent.algorithmOptions = saved.frame.algorithmOptions || {};
      }
      const tree = saved.tree || saved;
      const specs = Array.isArray(tree) ? tree : [tree];
      const restored = [];
      for (const spec of specs) {
        if (spec && spec.type === "resizer") continue;
        const handle = this._restore(spec, parent, opts);
        if (handle) restored.push(handle);
      }
      const algorithm = mk.registry.get("layout", parent.algorithm);
      if (algorithm && algorithm.setup) {
        mk.guard(parent, `layout:${parent.algorithm}.setup`, algorithm.setup, [
          parent,
          { mk, node: parent, frame: parent.frame }
        ]);
      }
      mk.invalidateNode(parent, "arrange");
      return restored;
    }
    _restore(spec, parent, opts) {
      const mk = this.mk;
      if (!spec || !spec.type) return null;
      const allow = opts.allow;
      if (allow && allow !== "any" && allow.types && allow.types.indexOf(spec.type) === -1) {
        warn("MK4015", `restore rejected type '${spec.type}': not in \`allow.types\``, {
          subject: spec.type
        });
        return null;
      }
      const definition = mk.registry.get("type", spec.type);
      const { children, layout, algorithm, algorithmOptions, traits, ...props } = spec;
      if (!definition) {
        warn(
          "MK4010",
          `'${spec.type}' is not registered; a placeholder preserving its geometry and props is used instead. Install the plugin and restore again.`,
          { subject: spec.type }
        );
        const placeholder = mk.create("pane", { ...mk.geometryOnly(props), class: "mk-placeholder" }, parent);
        if (placeholder) placeholder.node.placeholderFor = spec;
        return placeholder;
      }
      const filtered = allow && allow !== "any" && allow.props === "schema" ? mk.filterToSchema(props, definition) : props;
      const handle = mk.create(spec.type, this._lens(filtered), parent);
      if (!handle) return null;
      const node = handle.node;
      if (layout) mk.setLayoutProps(node, layout);
      if (algorithm) {
        if (mk.registry.has("layout", algorithm)) {
          node.algorithm = algorithm;
          node.algorithmOptions = algorithmOptions || {};
        } else {
          warn("MK4012", `layout algorithm '${algorithm}' is not registered; falling back to 'stack'`, {
            subject: algorithm
          });
          node.algorithm = "stack";
        }
      }
      for (const name of traits || []) {
        if (mk.registry.has("trait", name)) mk.attachTrait(node, name);
        else warn("MK4011", `trait '${name}' is not registered; the element renders without it`, { subject: name });
      }
      for (const child of children || []) this._restore(child, node, opts);
      return handle;
    }
    /** `{ value: '12u', px: 528 }` → the expression, or the pixels if it is gone. */
    _lens(props) {
      const out = {};
      for (const key of Object.keys(props)) {
        const value = props[key];
        if (!(value && typeof value === "object" && typeof value.value === "string" && "px" in value)) {
          out[key] = value;
          continue;
        }
        const ast = parse2(value.value);
        if (ast && ast.k === "unit" && !this.mk.registry.get("unit", ast.u)) {
          warn(
            "MK4013",
            `unit '${ast.u}' is not registered; using the recorded ${value.px}px so the layout stays geometrically correct`,
            { subject: ast.u }
          );
          out[key] = value.px;
        } else {
          out[key] = value.value;
        }
      }
      return out;
    }
    _migrate(doc) {
      if (doc.schema > SCHEMA_VERSION) {
        warn(
          "MK4015",
          `this layout was saved by a newer Mutakit (schema ${doc.schema}; this build reads ${SCHEMA_VERSION}) and is restored as-is. Anything it declares that this version does not understand is reported separately and kept.`,
          { subject: `schema:${doc.schema}` }
        );
        return doc;
      }
      let current = doc;
      let guard = 0;
      while (current.schema !== SCHEMA_VERSION && guard++ < 32) {
        const migration = this.mk.registry.get("serializer", `${current.schema}->${current.schema + 1}`);
        if (!migration) {
          warn(
            "MK4015",
            `no migration from schema ${current.schema} to ${current.schema + 1}; the document is restored as-is`,
            { subject: `schema:${current.schema}` }
          );
          return current;
        }
        current = migration.migrate(current) || current;
        current.schema = migration.to;
      }
      return current;
    }
    /**
     * Restore now, then save on a debounced timer whenever persistable state
     * changes. `storage` is any `{ getItem, setItem }`, so `sessionStorage`,
     * IndexedDB, and a server-backed store all work; a rejected async write
     * surfaces as a diagnostic rather than silently losing a layout.
     */
    persist(key, options) {
      const mk = this.mk;
      const opts = options || {};
      const storage = opts.storage || (typeof localStorage !== "undefined" ? localStorage : null);
      if (!storage) {
        warn("MK4016", "persist() found no storage; pass { storage }", { subject: key });
        return { save() {
        }, stop() {
        } };
      }
      let raw = null;
      try {
        raw = storage.getItem(key);
      } catch (error) {
        warn("MK4016", `could not read '${key}': ${error.message}`, { subject: key });
      }
      if (raw) {
        try {
          const doc = JSON.parse(raw);
          const specs = doc && (Array.isArray(doc.tree || doc) ? doc.tree || doc : [doc.tree || doc]);
          if (specs && specs.length) {
            const target = resolve3(mk, opts.into) || mk.root;
            if (target) for (const child of [...target.children]) mk.destroy(child);
          }
          this.restore(doc, { allow: opts.allow, into: opts.into });
        } catch (error) {
          warn("MK4016", `'${key}' did not parse as a layout: ${error.message}`, { subject: key });
        }
      }
      let pending = null;
      const save = () => {
        try {
          const result = storage.setItem(key, JSON.stringify(this.serialize(opts.into)));
          if (result && typeof result.catch === "function") {
            result.catch(
              (error) => warn("MK4016", `could not write '${key}': ${error.message}`, { subject: key })
            );
          }
        } catch (error) {
          warn("MK4016", `could not write '${key}': ${error.message}`, { subject: key });
        }
      };
      const stop = mk.scheduler.on("write", () => {
        if (!mk.persistDirty) return;
        mk.persistDirty = false;
        if (pending) pending();
        pending = timer(() => {
          pending = null;
          save();
        }, opts.debounce == null ? 300 : opts.debounce);
      });
      return {
        save,
        stop() {
          stop();
          if (pending) pending();
        }
      };
    }
  };
  function stripInternal(options) {
    if (!options) return null;
    const { __normalized, panes, ...rest } = options;
    return rest;
  }
  function resolve3(mk, value) {
    if (!value) return null;
    return value.node || value;
  }

  // source/services/store.js
  var HISTORY_LIMIT = 50;
  var Store = class {
    constructor(initial, options) {
      const opts = options || {};
      this.state = initial == null ? {} : initial;
      this.subscribers = /* @__PURE__ */ new Map();
      this.signals = /* @__PURE__ */ new Map();
      this.name = opts.name || "store";
      this.history = true ? [this.state] : null;
      this.cursor = 0;
    }
    /** Read a path: `store.get('panes.left.size')`, or the whole state. */
    get(path) {
      if (!path) return this.state;
      return readPath(this.state, splitPath(path));
    }
    /**
     * Write a path, sharing structure with the previous state.
     *
     * Only the nodes on the path are recreated; every sibling branch keeps its
     * identity, so a consumer holding `state.windows` can compare by reference
     * and skip work when only `state.panes` moved.
     */
    set(path, value) {
      const keys = splitPath(path);
      if (!keys.length) return this.replace(value);
      const next = writePath(this.state, keys, typeof value === "function" ? value(this.get(path)) : value);
      if (next === this.state) return this.state;
      return this._commit(next, keys);
    }
    /** Replace the whole state. Subscribers on every changed path are notified. */
    replace(next) {
      if (next === this.state) return this.state;
      return this._commit(next, null);
    }
    /** Apply several writes as one notification. */
    update(fn) {
      const before = this.state;
      let touched = [];
      const draft = {
        get: (path) => this.get(path),
        set: (path, value) => {
          const keys = splitPath(path);
          this.state = writePath(this.state, keys, typeof value === "function" ? value(this.get(path)) : value);
          touched.push(keys);
        }
      };
      fn(draft);
      if (this.state === before) return this.state;
      const next = this.state;
      this.state = before;
      return this._commit(next, touched.length === 1 ? touched[0] : null);
    }
    _commit(next, keys) {
      const previous = this.state;
      this.state = next;
      if (this.history) {
        this.history.length = this.cursor + 1;
        this.history.push(next);
        if (this.history.length > HISTORY_LIMIT) this.history.shift();
        this.cursor = this.history.length - 1;
      }
      this._notify(previous, next, keys);
      return next;
    }
    /**
     * Subscribe to a path. Returns an unsubscriber.
     *
     * `''` subscribes to everything. A subscriber on `panes.left` is woken when
     * `panes.left` or anything under it changes, and *not* when `panes.right`
     * does — which is the whole reason a store beats one big signal.
     */
    subscribe(path, fn) {
      const key = normalizePath(path);
      const list = this.subscribers.get(key) || [];
      list.push(fn);
      this.subscribers.set(key, list);
      return () => {
        const index = list.indexOf(fn);
        if (index !== -1) list.splice(index, 1);
        if (!list.length) this.subscribers.delete(key);
      };
    }
    /**
     * A path as a signal, so a store slice can be passed anywhere a value can.
     *
     * Cached per path: two callers selecting the same slice share one signal and
     * therefore one subscription.
     */
    select(path) {
      const key = normalizePath(path);
      const existing = this.signals.get(key);
      if (existing) return existing.accessor;
      const accessor = signal(this.get(key));
      const stop = this.subscribe(key, (value) => accessor(value));
      this.signals.set(key, { accessor, stop });
      return accessor;
    }
    /**
     * Wake the right subscribers, and only those.
     *
     * Two relationships are *not* the same and conflating them wakes every
     * sibling of a write. `exact` is what actually changed; `containing` is the
     * ancestors that now hold a change. A subscriber is woken when its path is
     * an exact change, when it is one of those ancestors, or when it sits
     * *under* an exact change — but never merely because it shares a parent
     * with one.
     */
    _notify(previous, next, keys) {
      const exact = keys ? /* @__PURE__ */ new Set([normalizePath(keys)]) : diffPaths(previous, next);
      const containing = keys ? prefixes(keys) : exact;
      if (!exact.size) return;
      const wakes = (key) => key === "" || exact.has(key) || containing.has(key) || isUnder(key, exact);
      batch(() => {
        for (const [key, list] of this.subscribers) {
          if (!wakes(key)) continue;
          const value = key === "" ? next : readPath(next, splitPath(key));
          for (const fn of list.slice()) fn(value, key);
        }
        for (const [key, entry] of this.signals) {
          if (!wakes(key)) continue;
          entry.accessor(key === "" ? next : readPath(next, splitPath(key)));
        }
      });
    }
    // ── Time travel (development only) ─────────────────────────────────────
    /** Step back one commit. Returns false when there is nothing to undo. */
    undo() {
      if (!this.history || this.cursor === 0) return false;
      this.cursor--;
      const previous = this.state;
      this.state = this.history[this.cursor];
      this._notify(previous, this.state, null);
      return true;
    }
    redo() {
      if (!this.history || this.cursor >= this.history.length - 1) return false;
      this.cursor++;
      const previous = this.state;
      this.state = this.history[this.cursor];
      this._notify(previous, this.state, null);
      return true;
    }
    /** Every retained snapshot, for the devtools panel. */
    get timeline() {
      if (!this.history) {
        warn("MK5006", "time travel is a development-build affordance", {
          subject: this.name
        });
        return [];
      }
      return this.history.map((snapshot2, index) => ({ index, current: index === this.cursor, snapshot: snapshot2 }));
    }
    destroy() {
      for (const entry of this.signals.values()) entry.stop();
      this.signals.clear();
      this.subscribers.clear();
      if (this.history) this.history.length = 0;
    }
  };
  function splitPath(path) {
    if (Array.isArray(path)) return path;
    if (!path) return [];
    return String(path).split(".");
  }
  function normalizePath(path) {
    return splitPath(path).join(".");
  }
  function readPath(state, keys) {
    let current = state;
    for (const key of keys) {
      if (current == null) return void 0;
      current = current[key];
    }
    return current;
  }
  function writePath(state, keys, value) {
    if (!keys.length) return value;
    const [key, ...rest] = keys;
    const child = state == null ? void 0 : state[key];
    const nextChild = rest.length ? writePath(child, rest, value) : value;
    if (nextChild === child) return state;
    if (Array.isArray(state)) {
      const copy = state.slice();
      copy[key] = nextChild;
      return copy;
    }
    return { ...state || {}, [key]: nextChild };
  }
  function prefixes(keys) {
    const out = /* @__PURE__ */ new Set([""]);
    let path = "";
    for (const key of keys) {
      path = path ? `${path}.${key}` : String(key);
      out.add(path);
    }
    return out;
  }
  function isUnder(key, exact) {
    for (const path of exact) {
      if (path && key.startsWith(path + ".")) return true;
    }
    return false;
  }
  function diffPaths(previous, next, prefix = "", out = /* @__PURE__ */ new Set([""])) {
    if (previous === next) return out;
    const keys = /* @__PURE__ */ new Set([
      ...previous && typeof previous === "object" ? Object.keys(previous) : [],
      ...next && typeof next === "object" ? Object.keys(next) : []
    ]);
    if (!keys.size) {
      if (prefix) out.add(prefix);
      return out;
    }
    for (const key of keys) {
      const path = prefix ? `${prefix}.${key}` : key;
      const a = previous == null ? void 0 : previous[key];
      const b = next == null ? void 0 : next[key];
      if (a === b) continue;
      out.add(path);
      if (a && b && typeof a === "object" && typeof b === "object") diffPaths(a, b, path, out);
    }
    return out;
  }
  var storePlugin = {
    name: "mutakit-store",
    version: "1.0.0",
    requires: { mutakit: ">=0.4.0 <2" },
    install(mk) {
      const stores = /* @__PURE__ */ new Map();
      mk.store = (name, initial, options) => {
        if (typeof name !== "string") return new Store(name, initial);
        const existing = stores.get(name);
        if (existing) return existing;
        const store = new Store(initial, { ...options || {}, name });
        stores.set(name, store);
        return store;
      };
      mk.stores = stores;
      return {
        uninstall() {
          for (const store of stores.values()) store.destroy();
          stores.clear();
          delete mk.store;
          delete mk.stores;
        }
      };
    }
  };

  // source/entries/dock.js
  function installSplits(mk) {
    mk.layout(splitLayout, { replace: true });
    for (const algorithm of EXTRA_LAYOUTS) mk.layout(algorithm, { replace: true });
    mk.trait(draggable, { replace: true });
    mk.trait(collapsible, { replace: true });
    mk.trait(resizable, { replace: true });
    for (const trait of COLLECTION_TRAITS) mk.trait(trait, { replace: true });
    mk.define(resizer, { replace: true });
    mk.define(split, { replace: true });
    for (const definition of STRUCTURAL_EXTRAS) mk.define(definition, { replace: true });
    return { uninstall() {
    } };
  }
  var splitsPlugin = {
    name: "mutakit-splits",
    version: Mutakit.VERSION,
    // `^0.4.0` would exclude 0.5 and later: under SemVer every 0.x minor is a
    // breaking change, and these plugins track the library rather than a line of it.
    requires: { mutakit: ">=0.4.0 <2" },
    install: installSplits
  };
  installSplits(Mutakit);
  Mutakit.use(persistencePlugin);
  Mutakit.use(storePlugin);
  var dock_default = Mutakit;
  return __toCommonJS(dock_exports);
})();
Mutakit=function(m){var n=m&&m.Mutakit?m.Mutakit:m;for(var k in m){if(k!=="default"&&k!=="Mutakit"&&!(k in n)){try{n[k]=m[k]}catch(e){}}}return n}(Mutakit);if(typeof module==="object"&&module.exports){module.exports=Mutakit}else if(typeof define==="function"&&define.amd){define([],function(){return Mutakit})}
//# sourceMappingURL=mutakit.dock.js.map
