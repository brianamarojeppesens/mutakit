/**
 * The `mutakit.js` preset — everything (§4.2).
 *
 * Tree-shaking removes the hazard that used to come with offering an
 * "everything" bundle: a user who imports one element through their own
 * bundler no longer pays for the rest. The `<script>`-tag audience still gets
 * the whole catalog, which is what they asked for by choosing this file.
 */
import { Mutakit } from "./dock.js";

export { Mutakit };
export default Mutakit;
