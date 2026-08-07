/**
 * Version constants.
 *
 * The development-build flag lives in `dev.js`, separately, because the
 * bundler can only inline a *literal* export — see that file for why the
 * distinction is load-bearing rather than stylistic.
 */

/** The library version. Kept here so every module can cite it without a cycle. */
export const VERSION = "0.7.0";

/** The serialization schema version (§19.2). */
export const SCHEMA_VERSION = 1;
