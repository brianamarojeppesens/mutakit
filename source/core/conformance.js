/**
 * Contract conformance (§8.7).
 *
 * Runs a definition against the contract and reports violations. It runs
 * automatically in the development build on every `define()`, and is published
 * so plugin authors can run it as a test. This is what turns P3 and P5 from
 * documentation into something checkable.
 *
 * Findings are returned, not thrown: a definition with a warning still works,
 * and the caller decides how loud to be.
 */

const POINTER_TRAIT_HINT =
  "every pointer interaction needs a documented keyboard equivalent (P5, §13.4)";

function finding(level, code, message) {
  return { level, code, message };
}

/**
 * Check an *authored* definition (before resolution) plus its resolved form.
 * `resolved` may be omitted when checking a definition in isolation.
 */
export function conformance(definition, resolved) {
  const findings = [];
  if (!definition || typeof definition !== "object") {
    return [finding("error", "MK3002", "not a definition object")];
  }

  const type = definition.type || "(unnamed)";
  const merged = resolved || definition;

  // ── P5: accessibility is declared or explicitly opted out of ───────────
  if (merged.a11y === undefined && !merged.abstract) {
    findings.push(
      finding(
        "error",
        "MK3006",
        `'${type}' declares no a11y semantics. Declare a role, or opt out ` +
          `explicitly with a11y: 'presentation'.`
      )
    );
  }

  // ── Declared events are the only ones that may be emitted ──────────────
  const declared = new Set(merged.events || []);
  const emitted = collectEmitted(definition);
  for (const name of emitted) {
    if (!declared.has(name)) {
      findings.push(
        finding("error", "MK3003", `'${type}' emits '${name}' but does not declare it in \`events\`.`)
      );
    }
  }

  // ── Cleanup: anything that creates must destroy ────────────────────────
  const body = sourceOf(definition);
  if (/addEventListener\s*\(/.test(body) && !/ctx\.own\s*\(/.test(body)) {
    findings.push(
      finding(
        "error",
        "MK3007",
        `'${type}' attaches a DOM listener without ctx.own(); it will fail the leak test (§23.5). ` +
          `Use ctx.on / ctx.dom / ctx.own so teardown is automatic.`
      )
    );
  }
  if (/setInterval\s*\(|setTimeout\s*\(/.test(body) && !/ctx\.own\s*\(/.test(body)) {
    findings.push(
      finding("warn", "MK3007", `'${type}' starts a timer that is not registered with ctx.own().`)
    );
  }

  // ── Keyboard parity for pointer traits (§13.4) ─────────────────────────
  const pointerTraits = ["draggable", "resizable", "sortable", "selectable"];
  const usesPointer = (merged.traits || []).some((t) => pointerTraits.includes(t));
  if (usesPointer && !hasKeys(merged)) {
    findings.push(
      finding("error", "MK6001", `'${type}' composes a pointer trait but declares no \`keys\`; ${POINTER_TRAIT_HINT}.`)
    );
  }

  // ── Commands and slots are well-formed ─────────────────────────────────
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

  // ── Motion presets must define a reduced variant (§17) ─────────────────
  if (merged.motion) {
    for (const phase of ["enter", "exit"]) {
      if (merged.motion[phase] && merged.motion.reduced === undefined) {
        findings.push(
          finding(
            "warn",
            "MK5004",
            `'${type}' declares motion.${phase} but no \`reduced\` variant; ` +
              `reduced-motion users will get the full animation.`
          )
        );
        break;
      }
    }
  }

  // ── Namespacing (§8.4) ─────────────────────────────────────────────────
  if (merged.origin && merged.origin !== "core" && type.indexOf(":") === -1) {
    findings.push(
      finding(
        "error",
        "MK4004",
        `'${type}' is a bare name registered from '${merged.origin}'. Bare names are ` +
          `reserved for core; use 'vendor:${type}'.`
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

/**
 * Find `ctx.emit('name')` calls. A static scan only sees literal names, which
 * is the point: a dynamic event name is exactly the case a reader cannot
 * verify either, and it shows up as an undeclared emit at runtime instead.
 */
function collectEmitted(definition) {
  const names = new Set();
  const text = sourceOf(definition);
  const pattern = /\.emit\(\s*["'`]([^"'`]+)["'`]/g;
  let match;
  while ((match = pattern.exec(text))) names.add(match[1]);
  return names;
}

/** Same idea for traits (§9), which share the contract's shape. */
export function conformanceTrait(trait) {
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
  // `ctx.own()` *is* the answer to cleanup, so a trait that uses it needs no
  // `detach`. Warning anyway would train authors to add empty ones, which is
  // strictly worse than the thing the check exists to prevent.
  if (!trait.detach && trait.attach && !/ctx\.own\s*\(/.test(sourceOf(trait))) {
    findings.push(
      finding(
        "warn",
        "MK3007",
        `trait '${trait.name}' has \`attach\` but neither \`detach\` nor any ctx.own() ` +
          `registration; whatever it creates will leak.`
      )
    );
  }
  return findings;
}
