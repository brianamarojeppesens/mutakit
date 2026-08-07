/**
 * The `mutakit.hud.js` preset (§4.2) — core, the HUD family, and gamepad input.
 *
 * Everything S3 needs (§1.3) and nothing S1 or S2 does: no splits, no overlays,
 * no forms. A game HUD that shipped a form validation subsystem would be the
 * clearest possible sign that the preset split had stopped meaning anything.
 */
import { Mutakit } from "./core.js";
import { registerService } from "../engine/instance.js";
import { FocusService } from "../services/focus.js";
import { SpatialService, gamepadSource } from "../services/input.js";
import { HUD_ELEMENTS, gridUnit } from "../elements/hud/hud.js";

export function installHud(mk) {
  for (const definition of HUD_ELEMENTS) mk.define(definition, { replace: true });
  mk.unit("gu", gridUnit, { replace: true });
  mk.input("gamepad", gamepadSource, { replace: true });
  return { uninstall() {} };
}

export const hudPlugin = {
  name: "mutakit-hud",
  version: Mutakit.VERSION,
  // `^0.4.0` would exclude 0.5 and later: under SemVer every 0.x minor is a
  // breaking change, and these plugins track the library rather than a line of it.
  requires: { mutakit: ">=0.4.0 <2" },
  install: installHud
};

registerService("focus", () => new FocusService());
registerService("spatial", () => new SpatialService());
installHud(Mutakit);

export { Mutakit };
export default Mutakit;
