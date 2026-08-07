/**
 * The `mutakit.app.js` preset (§4.2) — core plus overlays and forms.
 *
 * The application-chrome bundle: everything S2 needs (§1.3). Modals, dialogs,
 * popovers, tooltips, toasts, context menus, and the focus and announcer
 * services that make them behave rather than merely appear.
 */
import { Mutakit } from "./core.js";
import { registerService } from "../engine/instance.js";
import { FocusService, AnnouncerService } from "../services/focus.js";
import { dismissible, focusTrap, positioned } from "../traits/overlay.js";
import { OVERLAY_ELEMENTS } from "../elements/surfaces/overlays.js";
import { POPOVER_ELEMENTS, tooltipHost } from "../elements/surfaces/popovers.js";

export function installOverlays(mk) {
  mk.trait(dismissible, { replace: true });
  mk.trait(focusTrap, { replace: true });
  mk.trait(positioned, { replace: true });
  mk.trait(tooltipHost, { replace: true });
  for (const definition of [...OVERLAY_ELEMENTS, ...POPOVER_ELEMENTS]) {
    mk.define(definition, { replace: true });
  }
  return { uninstall() {} };
}

export const overlaysPlugin = {
  name: "mutakit-overlays",
  version: Mutakit.VERSION,
  requires: { mutakit: "^0.4.0 || ^1" },
  install: installOverlays
};

registerService("focus", () => new FocusService());
registerService("announcer", () => new AnnouncerService());
installOverlays(Mutakit);

export { Mutakit };
export default Mutakit;
