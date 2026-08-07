/**
 * The `mutakit.js` preset — everything (§4.2).
 *
 * Tree-shaking removes the hazard that used to come with offering an
 * "everything" bundle: a user who imports one element through their own
 * bundler no longer pays for the rest. The `<script>`-tag audience still gets
 * the whole catalog, which is what they asked for by choosing this file.
 *
 * **Every preset is imported by *binding*, never as a bare side-effect
 * import.** `package.json` declares `"sideEffects": false` — which is true, and
 * which consumers' bundlers rely on — and under that declaration a bundler is
 * entitled to drop `import "./app.js"` outright. It did: the full bundle came
 * out byte-identical to `mutakit.dock.js`, shipping no overlays and no forms
 * at all, silently. Naming what each preset contributes is what makes the
 * import load-bearing rather than decorative.
 */
import { Mutakit, splitsPlugin, persistencePlugin } from "./dock.js";
import { overlaysPlugin } from "./app.js";
import { hudPlugin } from "./hud.js";
import { ThemeService } from "../services/theme.js";
import { registerService } from "../engine/instance.js";
import { adaptersPlugin, customElementsPlugin, dslPlugin } from "../plugins/authoring.js";
import { devtoolsPlugin } from "../plugins/devtools.js";

registerService("theme", () => new ThemeService());
Mutakit.use(dslPlugin);
Mutakit.use(adaptersPlugin);

export {
  Mutakit,
  splitsPlugin,
  persistencePlugin,
  overlaysPlugin,
  hudPlugin,
  dslPlugin,
  adaptersPlugin,
  // Opt-in rather than installed: custom elements cannot be undefined once
  // registered, and devtools has no business in a production page (§19.3).
  customElementsPlugin,
  devtoolsPlugin
};
export default Mutakit;
