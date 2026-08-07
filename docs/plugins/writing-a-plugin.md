# Writing a plugin

A plugin is an object with `install(mk, options)`. It receives the **instance**,
never the global, which is what keeps two Mutakit roots on one page from
colliding. `use()` is idempotent per instance.

```js
export const AcmeWidgets = {
  name: 'acme-widgets',
  version: '1.2.0',
  requires: { mutakit: '>=0.4.0 <2' },
  install(mk, options) {
    mk.define({ type: 'acme:gauge', … });
    mk.trait({ name: 'acme:pulse', … });
    mk.layout({ name: 'acme:rack', … });
    mk.unit('u', { toNumber, toCSS });
    return { uninstall() {} };
  }
};

Mutakit.use(AcmeWidgets, { unit: 44 });
```

A complete worked example lives in
[`examples/acme-widgets/`](../../examples/acme-widgets/) — its own package, its
own `package.json`, importing nothing from `source/`, exercising four extension
points at once.

## The rules that actually bind

**Namespace everything.** Bare names are reserved for core; `vendor:name` is
the form. Registering a bare name from a plugin is MK4004.

**`ctx` is the whole surface.** An element sees nothing else. If a built-in
needed something `ctx` does not offer, the fix would be a new public extension
point — never a private back door. Every built-in in this library registers
through the same API you are using.

**Everything you create goes through `ctx.own()`.** Listeners, observers,
timers, animations, effects. `destroy` runs them in reverse order, which is why
passing the leak test is the default rather than an achievement.

**Declare your events.** Emitting an undeclared event throws in development.
Traits' declared events count as their host's.

**Declare accessibility, or opt out explicitly.** `a11y: 'presentation'` is a
legitimate answer for decoration; silence is not, and reports MK3006.

**A pointer interaction needs a keyboard equivalent.** The conformance check
enforces it for traits that handle pointers.

## Check your work

```js
import Mutakit from 'mutakit';
const findings = Mutakit.conformance(myDefinition);   // [] when clean
```

It runs automatically on every `define()` in the development build, and is
published so you can run it as a test.

## Uninstalling

`unuse(name)` deregisters a plugin's contributions but **does not destroy live
elements**. Existing instances keep working until destroyed normally; only new
`create()` calls fail, and MK4014 reports the live count. That is what makes
`uninstall` safe during hot reload.
