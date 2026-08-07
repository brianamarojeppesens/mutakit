/**
 * The shortcut registry (§13.4).
 *
 * Scopes run global → layer → element subtree → element, and the *most
 * specific* live scope wins, which is what makes `Escape` inside a modal mean
 * "close the modal" rather than "close the application". Chords
 * (`Ctrl+K Ctrl+S`), platform normalization (`Mod` → `Cmd` on macOS, `Ctrl`
 * elsewhere), conflict detection at registration, and a generated cheat sheet.
 */
import "../core/dev.js";
import * as dom from "../core/dom.js";
import { warn } from "../core/diagnostics.js";

const SCOPE_RANK = { element: 3, subtree: 2, layer: 1, global: 0 };

/** How long a chord waits for its second stroke before giving up. */
const CHORD_TIMEOUT = 1500;

export class ShortcutService {
  constructor() {
    this.mk = null;
    this.bindings = [];
    this.pending = null;
    this.pendingTimer = null;
    this._detach = null;
    this.mac = false;
  }

  attach(mk) {
    this.mk = mk;
    this.mac = dom.isBrowser() && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
    this._detach = dom.listen(dom.documentRoot(), "keydown", (event) => this._onKey(event), true);
  }

  /**
   * Bind `keys` to `run`. Returns a disposer.
   *
   * `keys` is `'Mod+K'`, or a chord `'Ctrl+K Ctrl+S'`. `scope` is `'global'`,
   * `'layer'`, `'subtree'`, or `'element'`, with `node` naming the element for
   * the latter two.
   */
  bind(keys, run, options) {
    const opts = options || {};
    const strokes = String(keys).trim().split(/\s+(?=[^+]|$)/).map((part) => this.normalize(part));
    const binding = {
      keys: String(keys),
      strokes,
      run,
      scope: opts.scope || "global",
      node: opts.node || null,
      when: opts.when || null,
      description: opts.description || "",
      preventDefault: opts.preventDefault !== false
    };

    const clash = this.bindings.find(
      (other) =>
        other.scope === binding.scope &&
        other.node === binding.node &&
        other.strokes.join(" ") === binding.strokes.join(" ")
    );
    if (clash) {
      // At registration, not at press time: a conflict discovered when the user
      // presses the key is a conflict discovered by the user.
      warn("MK6004", __MK_DEV__ &&
        `'${binding.keys}' is already bound in the '${binding.scope}' scope ` +
          `(${clash.description || "no description"}); the later binding wins`,
        { subject: binding.keys }
      );
    }

    this.bindings.push(binding);
    return () => {
      const index = this.bindings.indexOf(binding);
      if (index !== -1) this.bindings.splice(index, 1);
    };
  }

  /** `'Mod+Shift+K'` → a canonical, comparable string. */
  normalize(stroke) {
    const parts = String(stroke).split("+").map((part) => part.trim()).filter(Boolean);
    const key = parts.pop() || "";
    const modifiers = new Set(parts.map((part) => part.toLowerCase()));
    if (modifiers.delete("mod")) modifiers.add(this.mac ? "meta" : "ctrl");
    if (modifiers.delete("cmd")) modifiers.add("meta");
    if (modifiers.delete("option")) modifiers.add("alt");
    const order = ["ctrl", "alt", "shift", "meta"].filter((name) => modifiers.has(name));
    return [...order, key.length === 1 ? key.toLowerCase() : key].join("+");
  }

  _strokeOf(event) {
    const modifiers = [];
    if (event.ctrlKey) modifiers.push("ctrl");
    if (event.altKey) modifiers.push("alt");
    if (event.shiftKey) modifiers.push("shift");
    if (event.metaKey) modifiers.push("meta");
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    return [...modifiers, key].join("+");
  }

  _onKey(event) {
    if (isTypingTarget(event.target) && !event.ctrlKey && !event.metaKey) return;
    const stroke = this._strokeOf(event);

    const candidates = this.bindings.filter((binding) => {
      const index = this.pending ? this.pending.depth : 0;
      if (binding.strokes[index] !== stroke) return false;
      if (this.pending && binding !== this.pending.binding && index > 0) return false;
      if (binding.when && !binding.when()) return false;
      return this._inScope(binding, event.target);
    });
    if (!candidates.length) {
      this._clearChord();
      return;
    }

    // The most specific live scope wins; among equals, the longer sequence
    // claims a shared prefix. `Ctrl+K` bound alongside `Ctrl+K Ctrl+S` has to
    // wait for the second stroke, or the chord could never fire at all.
    candidates.sort(
      (a, b) => SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope] || b.strokes.length - a.strokes.length
    );
    const binding = candidates[0];
    const depth = this.pending ? this.pending.depth + 1 : 1;

    if (depth < binding.strokes.length) {
      this._clearChord();
      this.pending = { binding, depth };
      this.pendingTimer = dom.timer(() => this._clearChord(), CHORD_TIMEOUT);
      if (binding.preventDefault) event.preventDefault();
      return;
    }

    this._clearChord();
    if (binding.preventDefault) event.preventDefault();
    binding.run(event);
  }

  _clearChord() {
    if (this.pendingTimer) this.pendingTimer();
    this.pendingTimer = null;
    this.pending = null;
  }

  _inScope(binding, target) {
    if (binding.scope === "global") return true;
    const el = binding.node && binding.node.el;
    if (!el) return false;
    if (binding.scope === "element") return el === target;
    if (binding.scope === "subtree") return el.contains(target);
    if (binding.scope === "layer") {
      const layers = this.mk && this.mk.service("layers");
      return !layers || layers.topOf(binding.node.layer) === binding.node;
    }
    return true;
  }

  /** The generated cheat sheet (§13.4) — grouped, sorted, and printable. */
  cheatSheet() {
    const groups = {};
    for (const binding of this.bindings) {
      const group = binding.scope;
      (groups[group] = groups[group] || []).push({
        keys: binding.keys,
        description: binding.description
      });
    }
    for (const group of Object.keys(groups)) groups[group].sort((a, b) => a.keys.localeCompare(b.keys));
    return groups;
  }

  destroy() {
    this._clearChord();
    if (this._detach) this._detach();
    this.bindings.length = 0;
  }
}

/** A keystroke in a text field belongs to the text field. */
function isTypingTarget(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}
