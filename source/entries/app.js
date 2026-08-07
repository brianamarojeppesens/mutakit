/**
 * The `mutakit.app.js` preset (§4.2) — core plus overlays and forms.
 *
 * The application-chrome bundle: everything S2 needs (§1.3). Modals, dialogs,
 * popovers, tooltips, toasts, context menus, the form catalog and its
 * validation subsystem, and the focus, announcer, and shortcut services that
 * make them behave rather than merely appear.
 */
import { Mutakit } from "./core.js";
import { registerService } from "../engine/instance.js";
import { FocusService, AnnouncerService } from "../services/focus.js";
import { dismissible, focusTrap, positioned } from "../traits/overlay.js";
import { OVERLAY_ELEMENTS } from "../elements/surfaces/overlays.js";
import { POPOVER_ELEMENTS, tooltipHost, contextMenu } from "../elements/surfaces/popovers.js";
import { ShortcutService } from "../services/shortcuts.js";
import { MotionService } from "../services/motion.js";
import { GestureService } from "../services/gestures.js";
import { PointerService } from "../services/pointer.js";
import { NATIVE_CONTROLS } from "../elements/forms/controls.js";
import { COMPOSITE_CONTROLS } from "../elements/forms/composite.js";
import { FORM_ELEMENTS } from "../elements/forms/form.js";
import { DISPLAY_ELEMENTS } from "../elements/display/display.js";

export function installOverlays(mk) {
  mk.trait(dismissible, { replace: true });
  mk.trait(focusTrap, { replace: true });
  mk.trait(positioned, { replace: true });
  mk.trait(tooltipHost, { replace: true });
  mk.trait(contextMenu, { replace: true });
  for (const definition of [
    ...OVERLAY_ELEMENTS,
    ...POPOVER_ELEMENTS,
    ...NATIVE_CONTROLS,
    ...COMPOSITE_CONTROLS,
    ...FORM_ELEMENTS,
    ...DISPLAY_ELEMENTS
  ]) {
    mk.define(definition, { replace: true });
  }
  return { uninstall() {} };
}

export const overlaysPlugin = {
  name: "mutakit-overlays",
  version: Mutakit.VERSION,
  // `^0.4.0` would exclude 0.5 and later: under SemVer every 0.x minor is a
  // breaking change, and these plugins track the library rather than a line of it.
  requires: { mutakit: ">=0.4.0 <2" },
  install: installOverlays
};

registerService("focus", () => new FocusService());
registerService("announcer", () => new AnnouncerService());
registerService("shortcuts", () => new ShortcutService());
// Motion is a standard plugin (§4.2), registered as a factory so a page that
// opens no overlay never instantiates it.
registerService("motion", () => new MotionService());
// The pointer queue and the recognizers are one mechanism (§13.2, §13.3): the
// queue is delegated per root and drained in INPUT, and the recognizers are
// what it drains into.
registerService("gestures", () => new GestureService());
registerService("pointer", () => new PointerService());
installOverlays(Mutakit);

export { Mutakit };
export default Mutakit;
