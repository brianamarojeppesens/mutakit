/**
 * The `mutakit.core.js` preset (§4.2).
 *
 * Kernel, geometry, engine, signals, the `anchor` and `stack` algorithms, the
 * layers service, the `focusable` trait, and the five Tier A element types.
 * Budget: ≤ 8.5 KB gzipped (§20.1).
 *
 * A preset's imports *are* its definition. For anyone consuming the ESM build
 * through their own bundler these are a convenient starting import rather than
 * a necessity — their real bundle is determined by what they actually
 * reference — but for the `<script>`-tag audience, who cannot tree-shake, a
 * pre-cut bundle is the whole point.
 */
import { Mutakit } from "../namespace.js";
import { registerService } from "../engine/instance.js";
import { anchorLayout } from "../layout/anchor.js";
import { stackLayout } from "../layout/stack.js";
import { focusable } from "../traits/focusable.js";
import { LayerService } from "../services/layers.js";
import { CORE_ELEMENTS } from "../elements/structural/pane.js";

/**
 * Register core's contributions through exactly the same public API a third
 * party uses (P3). If one of these needed something the API cannot express,
 * that would be a hole in the contract, not a reason for a back door.
 */
export function installCore(mk) {
  mk.layout(anchorLayout, { replace: true });
  mk.layout(stackLayout, { replace: true });
  mk.trait(focusable, { replace: true });
  for (const definition of CORE_ELEMENTS) mk.define(definition, { replace: true });
  return { uninstall() {} };
}

export const corePlugin = {
  name: "mutakit-core",
  version: Mutakit.VERSION,
  install: installCore
};

registerService("layers", () => new LayerService());
installCore(Mutakit);

export { Mutakit };
export default Mutakit;
