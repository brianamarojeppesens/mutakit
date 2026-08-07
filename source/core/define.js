/**
 * Element definitions and how `extends` resolves (§8.1, §8.3).
 *
 * A definition is authored as a flat object; what the engine consumes is a
 * *resolved* definition, computed once at registration: schemas merged,
 * lifecycle hooks collected into parent-first chains, styles concatenated in
 * inheritance order. Resolving once means instantiation is cheap and the
 * inheritance rules are stated in exactly one place.
 *
 * `extends` is single-inheritance and shallow-merging. Traits are the primary
 * reuse mechanism; the built-in catalog is deliberately at most two levels
 * deep.
 */
import "../core/dev.js";
import { fail, warn } from "./diagnostics.js";
import { mergeSchema, normalizeSchema } from "./schema.js";

const HOOKS = [
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

/** Fields an element type may declare. Anything else is MK3002. */
const KNOWN_FIELDS = new Set([
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
  return { ...(parent || {}), ...(own || {}) };
}

function mergeArrays(parent, own) {
  const out = [];
  for (const item of parent || []) if (!out.includes(item)) out.push(item);
  for (const item of own || []) if (!out.includes(item)) out.push(item);
  return out;
}

/**
 * Merge an authored definition with its resolved parent.
 *
 * `base` is the resolved `extends` target, or null. The result is frozen
 * enough to be shared between instances — nothing mutates it at runtime.
 */
export function resolveDefinition(definition, base, options) {
  const opts = options || {};

  if (!definition || typeof definition !== "object" || !definition.type) {
    return fail("MK3002", __MK_DEV__ &&
      "a definition needs a `type`", { subject: definition && definition.type });
  }
  for (const key of Object.keys(definition)) {
    if (!KNOWN_FIELDS.has(key)) {
      warn("MK3002", __MK_DEV__ &&
        `unknown field '${key}' in the definition of '${definition.type}'`, {
        subject: definition.type + "." + key
      });
    }
  }
  if (!definition.create && !base && !definition.abstract) {
    return fail("MK3002", __MK_DEV__ &&
      `'${definition.type}' declares neither \`create\` nor \`extends\``, {
      subject: definition.type
    });
  }

  const props = normalizeSchema(definition.props);
  const childProps = normalizeSchema(definition.childProps);

  const resolved = {
    type: definition.type,
    version: definition.version || (base && base.version) || "0.0.0",
    origin: opts.origin || definition.origin || (base && base.origin) || "core",
    extends: definition.extends || null,
    base: base || null,
    abstract: !!definition.abstract,
    /** A node with no DOM of its own; children land in the nearest ancestor. */
    virtual: definition.virtual !== undefined ? !!definition.virtual : !!(base && base.virtual),

    props: base ? mergeSchema(base.props, props) : props,
    childProps: base ? mergeSchema(base.childProps, childProps) : childProps,
    geometry: mergeObjects(base && base.geometry, definition.geometry),
    traits: mergeArrays(base && base.traits, definition.traits),
    algorithm: definition.algorithm || (base && base.algorithm) || null,
    slots: mergeObjects(base && base.slots, definition.slots),
    layer: definition.layer || (base && base.layer) || null,

    commands: mergeObjects(base && base.commands, definition.commands) || {},
    events: mergeArrays(base && base.events, definition.events),
    a11y: definition.a11y !== undefined ? definition.a11y : base ? base.a11y : undefined,
    keys: mergeObjects(base && base.keys, definition.keys) || {},

    styles: mergeArrays(base && base.styles, definition.styles ? [definition.styles] : []),
    tokens: mergeObjects(base && base.tokens, definition.tokens),
    motion: mergeObjects(base && base.motion, definition.motion),
    shadow: definition.shadow !== undefined ? definition.shadow : base ? base.shadow : false,
    content: definition.content !== undefined ? definition.content : base ? base.content : undefined,

    requires: definition.requires || null,
    hooks: Object.create(null),
    source: definition
  };

  for (const hook of HOOKS) {
    resolved.hooks[hook] = chain(base && base.hooks[hook], definition[hook]);
  }

  // A type inheriting neither its own nor an ancestor's a11y declaration is a
  // P5 violation. Warn rather than throw: the element still works, and the
  // build lint (§22.4) is where this becomes a hard failure.
  if (resolved.a11y === undefined && !resolved.abstract) {
    warn("MK3006", __MK_DEV__ &&
      `'${resolved.type}' declares no \`a11y\`. Declare a role, or opt out with ` +
        `a11y: 'presentation'`,
      { subject: resolved.type }
    );
  }

  return resolved;
}

/** The command named `name`, searched up the inheritance chain. */
export function findCommand(resolved, name) {
  return resolved.commands ? resolved.commands[name] : undefined;
}

export { HOOKS };
