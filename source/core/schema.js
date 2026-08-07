/**
 * Prop schemas (§8.1) — one vocabulary with four consumers.
 *
 * The same descriptor drives runtime validation, generated `.d.ts` (§22.5),
 * generated API docs (§24), and devtools display (§19.3). Form validation
 * (§11.3) reuses it wholesale, which is why field errors and prop diagnostics
 * share a message catalogue.
 *
 * A descriptor is `{ type, default, ... }`. Everything but `type` is optional,
 * and a bare shorthand — `{ value: 'number' }` — expands to `{ type: 'number' }`.
 */
import "../core/dev.js";
import { warn } from "./diagnostics.js";

/** Validators, keyed by `type`. Extension point §10.11 adds to this map. */
const VALIDATORS = Object.create(null);

const LEN_KEYWORDS = new Set(["auto", "min-content", "max-content", "fit-content", "none"]);

/**
 * Register a prop type. `check(value, desc, path)` returns `{ value }` on
 * success or `{ error }` with a human-readable reason.
 */
export function defineValidator(name, check) {
  VALIDATORS[name] = check;
}

export function hasValidator(name) {
  return name in VALIDATORS;
}

function ok(value) {
  return { value };
}

function bad(error) {
  return { error };
}

defineValidator("any", (v) => ok(v));

defineValidator("string", (v) =>
  typeof v === "string" ? ok(v) : v == null ? ok("") : ok(String(v))
);

defineValidator("number", (v, desc) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!isFinite(n)) return bad(`expected a number, got ${describe(v)}`);
  if (desc.integer && !Number.isInteger(n)) return bad(`expected an integer, got ${n}`);
  if (desc.min != null && n < desc.min) return bad(`must be >= ${desc.min}, got ${n}`);
  if (desc.max != null && n > desc.max) return bad(`must be <= ${desc.max}, got ${n}`);
  return ok(n);
});

defineValidator("boolean", (v) => ok(v === "false" ? false : Boolean(v)));

defineValidator("enum", (v, desc) =>
  desc.values && desc.values.indexOf(v) === -1
    ? bad(`expected one of ${desc.values.join(", ")}, got ${describe(v)}`)
    : ok(v)
);

defineValidator("object", (v) =>
  v == null || (typeof v === "object" && !Array.isArray(v))
    ? ok(v)
    : bad(`expected an object, got ${describe(v)}`)
);

defineValidator("array", (v, desc, path) => {
  if (!Array.isArray(v)) return bad(`expected an array, got ${describe(v)}`);
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

defineValidator("function", (v) =>
  typeof v === "function" ? ok(v) : bad(`expected a function, got ${describe(v)}`)
);

/** A `Len` (§5.2). Structural only — `geometry/len.js` owns the grammar. */
defineValidator("len", (v) => {
  if (typeof v === "number" && isFinite(v)) return ok(v);
  if (typeof v === "function") return ok(v);
  if (typeof v === "string" && v.trim() !== "") return ok(v.trim());
  return bad(`expected a length, got ${describe(v)}`);
});

defineValidator("size", (v) => {
  if (v == null) return ok(v);
  if (typeof v === "number" || typeof v === "string") return ok({ w: v, h: v });
  if (typeof v === "object") return ok(v);
  return bad(`expected {w, h}, got ${describe(v)}`);
});

defineValidator("selector", (v) =>
  v == null || typeof v === "string" || typeof v === "function" || isElementLike(v)
    ? ok(v)
    : bad(`expected a selector, got ${describe(v)}`)
);

defineValidator("node", (v) => ok(v));

/** Markup. §21.4: never assigned raw — the sanitizer gate lives in `dom.js`. */
defineValidator("html", (v) =>
  typeof v === "string" ? ok(v) : bad(`expected a markup string, got ${describe(v)}`)
);

defineValidator("color", (v) =>
  typeof v === "string" ? ok(v) : bad(`expected a colour, got ${describe(v)}`)
);

const FORMATS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  url: /^https?:\/\/[^\s]+$/i,
  // A Len that CSS can resolve on its own; used by form-level `len` fields.
  cssLength: /^(-?[\d.]+(px|rem|em|ch|ex|vw|vh|vmin|vmax|dvh|dvw|svh|lvh|%|fr)?|0)$/
};

function isElementLike(v) {
  return !!v && typeof v === "object" && typeof v.nodeType === "number";
}

function describe(v) {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "object") return Array.isArray(v) ? "an array" : "an object";
  return String(v);
}

/** Expand shorthand and fill in the fields the rest of the system reads. */
export function normalizeDescriptor(desc, name) {
  const d = typeof desc === "string" ? { type: desc } : { ...desc };
  if (!d.type) d.type = d.values ? "enum" : "any";
  if (!VALIDATORS[d.type]) {
    warn("MK3002", __MK_DEV__ &&
      `prop '${name}' declares unknown type '${d.type}'; treated as 'any'`, {
      subject: name
    });
    d.type = "any";
  }
  d.name = name;
  if (d.reactive === undefined) d.reactive = true;
  return d;
}

/** Normalize a whole `{ name: descriptor }` map. */
export function normalizeSchema(schema) {
  const out = Object.create(null);
  if (!schema) return out;
  for (const name of Object.keys(schema)) out[name] = normalizeDescriptor(schema[name], name);
  return out;
}

/**
 * Validate and coerce one value. Returns `{ value }` or `{ error }` — never
 * throws, because the caller decides whether a bad prop is fatal.
 */
export function validateValue(desc, value, path) {
  const d = desc.name ? desc : normalizeDescriptor(desc, path || "value");
  if (value === undefined || value === null) {
    if (d.required) return bad(`${path || d.name} is required`);
    if (value === undefined && d.default !== undefined) {
      return ok(typeof d.default === "function" && d.type !== "function" ? d.default() : d.default);
    }
    return ok(value === undefined ? d.default : value);
  }
  // A signal (§15.1) passed where a value is expected stays a signal; the
  // element binds to it and the validator sees each produced value instead.
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

/**
 * Validate a whole value bag against a schema.
 *
 * `strict` reports keys the schema does not declare (MK3004 at the call site);
 * they are returned in `unknown` rather than dropped, because §7.0 requires an
 * unknown child-prop key to be *retained but ignored*.
 */
export function validateAll(schema, values, options) {
  const opts = options || {};
  const out = Object.create(null);
  const errors = [];
  const unknown = [];

  for (const name of Object.keys(schema)) {
    const desc = schema[name];
    const given = values ? values[name] : undefined;
    if (given === undefined && desc.default === undefined && !desc.required) continue;
    const result = validateValue(desc, given, name);
    if (result.error) errors.push({ name, message: result.error });
    else if (result.value !== undefined) out[name] = result.value;
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

/** Every default the schema declares, as a fresh object. */
export function defaultsOf(schema) {
  const out = Object.create(null);
  for (const name of Object.keys(schema)) {
    const d = schema[name];
    if (d.default === undefined) continue;
    out[name] = typeof d.default === "function" && d.type !== "function" ? d.default() : d.default;
  }
  return out;
}

/** Merge a parent type's schema with a child's (§8.3 — shallow, child wins). */
export function mergeSchema(parent, child) {
  const out = Object.create(null);
  for (const k of Object.keys(parent || {})) out[k] = parent[k];
  for (const k of Object.keys(child || {})) out[k] = child[k];
  return out;
}

export { LEN_KEYWORDS };
