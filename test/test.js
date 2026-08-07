/**
 * Tests for Mutakit.
 *
 * This file is the per-project one — replace these starter cases as the real
 * API takes shape. `test` and the assertion object come from harness.js.
 */
(function () {
  "use strict";

  var lib = window.Mutakit;

  test("the library loads and exposes a version", function (t) {
    t.ok(lib, "window.Mutakit should exist");
    t.equal(typeof lib.VERSION, "string");
  });

  test("hello() greets the given name", function (t) {
    t.equal(lib.hello("mutakit"), "Hello, mutakit!");
  });

  test("hello() falls back to world", function (t) {
    t.equal(lib.hello(), "Hello, world!");
  });

  test("create() returns an instance with its own config", function (t) {
    var instance = lib.create({ debug: true });
    t.equal(instance.config.debug, true);
    t.equal(lib.defaults.debug, false, "the defaults should not be mutated");
  });

  // Sandbox: render something into #demo to eyeball behaviour by hand.
  document.addEventListener("DOMContentLoaded", function () {
    var demo = document.getElementById("demo");
    if (demo) demo.textContent = lib.hello("Mutakit");
  });
})();
