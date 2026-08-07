/**
 * Mutakit
 *
 * Source of truth for this module. The build step adds the release banner, so
 * this header is stripped from build output — keep notes-to-self here freely.
 */
(function (root, factory) {
  "use strict";
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Mutakit = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "0.2.0";

  var defaults = {
    debug: false
  };

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      if (!source) continue;
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }
    return target;
  }

  /**
   * Create an instance with its own options.
   * @param {Object} [options]
   */
  function create(options) {
    var config = assign({}, defaults, options);

    return {
      config: config,

      /**
       * Placeholder method — replace with the real API.
       * @param {string} name
       * @returns {string}
       */
      hello: function (name) {
        var message = "Hello, " + (name || "world") + "!";
        if (config.debug && typeof console !== "undefined") {
          console.log("[mutakit]", message);
        }
        return message;
      }
    };
  }

  var api = create();

  // Public surface: the default instance, plus the factory for scoped ones.
  return {
    VERSION: VERSION,
    defaults: defaults,
    create: create,
    hello: function (name) {
      return api.hello(name);
    }
  };
});
