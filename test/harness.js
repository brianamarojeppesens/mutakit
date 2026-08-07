/**
 * Minimal test harness — no dependencies, no build step.
 *
 *   test("description", function (t) {
 *     t.equal(actual, expected, "optional message");
 *     t.ok(value);
 *     t.throws(function () { ... });
 *   });
 *
 * Results render into #results; the summary lands in #summary. Also exposed as
 * window.harness.results for programmatic checks.
 */
(function (global) {
  "use strict";

  var queue = [];
  var results = [];

  function Assert() {
    this.assertions = [];
  }

  Assert.prototype._record = function (passed, message) {
    this.assertions.push({ passed: passed, message: message });
    if (!passed) throw new Error(message);
  };

  Assert.prototype.ok = function (value, message) {
    this._record(!!value, message || "expected a truthy value, got " + format(value));
  };

  Assert.prototype.equal = function (actual, expected, message) {
    this._record(
      actual === expected,
      message || "expected " + format(expected) + ", got " + format(actual)
    );
  };

  Assert.prototype.deepEqual = function (actual, expected, message) {
    this._record(
      JSON.stringify(actual) === JSON.stringify(expected),
      message || "expected " + format(expected) + ", got " + format(actual)
    );
  };

  Assert.prototype.throws = function (fn, message) {
    var threw = false;
    try { fn(); } catch (e) { threw = true; }
    this._record(threw, message || "expected the function to throw");
  };

  function format(value) {
    try {
      return typeof value === "string" ? '"' + value + '"' : JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  }

  function test(name, fn) {
    queue.push({ name: name, fn: fn });
  }

  function run() {
    results = queue.map(function (item) {
      var assert = new Assert();
      try {
        item.fn(assert);
        return { name: item.name, passed: true, count: assert.assertions.length };
      } catch (error) {
        return { name: item.name, passed: false, error: error.message };
      }
    });
    render();
    return results;
  }

  function render() {
    var list = document.getElementById("results");
    var summary = document.getElementById("summary");
    if (!list) return;

    list.innerHTML = "";
    var passed = 0;

    results.forEach(function (result) {
      if (result.passed) passed++;
      var li = document.createElement("li");
      li.className = "result " + (result.passed ? "pass" : "fail");
      var label = document.createElement("span");
      label.className = "result-name";
      label.textContent = result.name;
      li.appendChild(label);
      if (!result.passed) {
        var detail = document.createElement("span");
        detail.className = "result-detail";
        detail.textContent = result.error;
        li.appendChild(detail);
      }
      list.appendChild(li);
    });

    if (summary) {
      var total = results.length;
      summary.textContent = passed + "/" + total + " passing";
      summary.className = "summary " + (passed === total ? "pass" : "fail");
    }
  }

  global.test = test;
  global.harness = {
    test: test,
    run: run,
    get results() { return results; }
  };

  // Tests register during test.js, which loads after this file; run on ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    setTimeout(run, 0);
  }
})(window);
