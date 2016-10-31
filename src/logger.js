/*jslint node */
(function () {
    "use strict";

    var verbose;

    function init(options) {
        verbose = options.verbose;
    }

    function error() {
        console.error.apply(console, arguments);
    }

    function info() {
        console.info.apply(console, arguments);
    }

    function debug() {
        if (verbose) {
            console.log.apply(console, arguments);
        }
    }

    module.exports = {
        debug: debug,
        error: error,
        info: info,
        init: init
    };
}());
