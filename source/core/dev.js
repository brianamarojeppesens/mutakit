/**
 * The development-build gate (§21.1).
 *
 * `mutakit.js` (development) includes schema validation, conformance checks,
 * the constraint explainer, reentrancy assertions, and verbose messages;
 * `mutakit.min.js` (production) strips all of it. Behaviour must never differ
 * between the two except in diagnostics.
 *
 * **Why a bare global rather than an imported constant.** Three spellings were
 * measured against esbuild 0.28, minifying the real bundle:
 *
 *   `import { DEV }`, computed value   → folded to `!1`, branch *kept*
 *   `import { DEV }`, literal `false`  → folded to `!1`, branch *kept*
 *   bare `__MK_DEV__` + `define`       → branch pruned, referenced code shaken
 *
 * Only the third actually removes the code. The first two leave every dev-only
 * message string in the production bundle behind an `if (!1)` — unreachable,
 * but shipped, which is the opposite of the point. So the codebase writes
 * `if (__MK_DEV__)` at the branch itself, and this module guarantees the
 * identifier exists when source is loaded raw, with no build step, in the
 * harness (§23.3).
 *
 * A build defines `__MK_DEV__` and this assignment is then irrelevant; without
 * one, development is the default, which is the safe direction to fail.
 */
if (typeof globalThis !== "undefined" && globalThis.__MK_DEV__ === undefined) {
  globalThis.__MK_DEV__ = true;
}

/**
 * The same flag as a value, for the handful of places that need a boolean
 * rather than a branch. Reading this never strips anything — use
 * `if (__MK_DEV__)` for that.
 */
export const DEV = typeof __MK_DEV__ === "undefined" ? true : __MK_DEV__;
