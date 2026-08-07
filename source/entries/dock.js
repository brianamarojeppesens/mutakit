/**
 * The `mutakit.dock.js` preset (§4.2) — core plus splits and persistence.
 *
 * The IDE bundle: the layout is the application, and it has to survive a
 * reload. Everything S1 needs (§1.3) and nothing S2 or S3 does — splits, the
 * remaining layout algorithms, tabs, floating windows, and persistence.
 */
import { Mutakit } from "./core.js";
import { splitLayout } from "../layout/split.js";
import { EXTRA_LAYOUTS } from "../layout/algorithms.js";
import { draggable, collapsible, resizable } from "../traits/draggable.js";
import { resizer } from "../elements/structural/resizer.js";
import { split } from "../elements/structural/split.js";
import { STRUCTURAL_EXTRAS } from "../elements/structural/tabs.js";
import { persistencePlugin } from "../services/persistence.js";

export function installSplits(mk) {
  mk.layout(splitLayout, { replace: true });
  for (const algorithm of EXTRA_LAYOUTS) mk.layout(algorithm, { replace: true });
  mk.trait(draggable, { replace: true });
  mk.trait(collapsible, { replace: true });
  mk.trait(resizable, { replace: true });
  mk.define(resizer, { replace: true });
  mk.define(split, { replace: true });
  for (const definition of STRUCTURAL_EXTRAS) mk.define(definition, { replace: true });
  return { uninstall() {} };
}

export const splitsPlugin = {
  name: "mutakit-splits",
  version: Mutakit.VERSION,
  // `^0.4.0` would exclude 0.5 and later: under SemVer every 0.x minor is a
  // breaking change, and these plugins track the library rather than a line of it.
  requires: { mutakit: ">=0.4.0 <2" },
  install: installSplits
};

installSplits(Mutakit);
Mutakit.use(persistencePlugin);

export { Mutakit, persistencePlugin };
export default Mutakit;
