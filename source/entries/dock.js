/**
 * The `mutakit.dock.js` preset (§4.2) — core plus splits and persistence.
 *
 * The IDE bundle: the layout is the application, and it has to survive a
 * reload. Everything S1 needs (§1.3) and nothing S2 or S3 does.
 */
import { Mutakit } from "./core.js";
import { splitLayout } from "../layout/split.js";
import { draggable, collapsible } from "../traits/draggable.js";
import { resizer } from "../elements/structural/resizer.js";
import { split } from "../elements/structural/split.js";
import { persistencePlugin } from "../services/persistence.js";

export function installSplits(mk) {
  mk.layout(splitLayout, { replace: true });
  mk.trait(draggable, { replace: true });
  mk.trait(collapsible, { replace: true });
  mk.define(resizer, { replace: true });
  mk.define(split, { replace: true });
  return { uninstall() {} };
}

export const splitsPlugin = {
  name: "mutakit-splits",
  version: Mutakit.VERSION,
  requires: { mutakit: "^0.4.0 || ^1" },
  install: installSplits
};

installSplits(Mutakit);
Mutakit.use(persistencePlugin);

export { Mutakit, persistencePlugin };
export default Mutakit;
