/**
 * Registries (§8.4, §8.6, §10).
 *
 * One registry per kind of extension point, all held in one object so
 * `list()` can report everything registered with versions and origins for
 * devtools and bug reports. Instances inherit a parent registry by reference
 * (cheap, shared) unless created with `inherit: false`, which is what P8's
 * two-independent-roots requirement rests on.
 */
import "../core/dev.js";
import { fail, warn } from "./diagnostics.js";

/** Every extension point in §10 that is name-keyed. */
export const KINDS = [
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

export class Registry {
  constructor(parent) {
    this.parent = parent || null;
    this.maps = Object.create(null);
    for (const kind of KINDS) this.maps[kind] = new Map();
  }

  /** Register `value` under `name`. Re-registration needs `replace: true`. */
  set(kind, name, value, options) {
    const opts = options || {};
    const map = this.maps[kind];
    if (!map) return fail("MK3002", __MK_DEV__ &&
      `unknown extension kind '${kind}'`, { subject: name });

    const existing = this.get(kind, name);
    if (existing && !opts.replace) {
      return fail("MK4001", __MK_DEV__ &&
        `'${name}' is already registered as a ${kind}` +
          (existing.version ? ` (version ${existing.version})` : "") +
          "; pass { replace: true } to override deliberately",
        { subject: name }
      );
    }
    if (existing && opts.replace) {
      warn("MK4001", __MK_DEV__ &&
        `'${name}' replaced: ${existing.version || "?"} → ${value.version || "?"}`,
        { subject: name + ":replace" }
      );
    }
    map.set(name, value);
    return value;
  }

  get(kind, name) {
    const map = this.maps[kind];
    if (!map) return undefined;
    const own = map.get(name);
    if (own !== undefined) return own;
    return this.parent ? this.parent.get(kind, name) : undefined;
  }

  has(kind, name) {
    return this.get(kind, name) !== undefined;
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
          origin: (value && value.origin) || "core",
          own: this.maps[kind].has(name)
        };
      });
    }
    return out;
  }
}
