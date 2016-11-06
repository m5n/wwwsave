/*jslint node */
(function () {
    "use strict";

    var fs = require("fs");
    var system = require("system");

    var parsed = false;
    var supportedSites = [];
    var defaultViewportSize = "1280x1024";   // Smaller sizes could make site hide content

    function readSupportedSites() {
        var list = fs.list("./config").sort();
        list.forEach(function (item) {
            supportedSites.push(item.split(".")[0]);
        });
    }

    function determineCommandName(args) {
        (/([^/]+)\.js/).test(args[0]);
        module.exports.command = RegExp.$1;
    }

    function readConfig(site) {
        var config = JSON.parse(fs.read("config/" + site + ".json"));
        Object.keys(config).forEach(function (key) {
            module.exports[key] = config[key];
        });
    }

    //function readPassword() {
    //    system.standardout.write("Password for " + module.exports.username + ": ");   // Does not output newline
    //    system.standardin.read();   // Does not include newline
    //    // TODO: line above not supported on Windows; also it doesn't block execution of the rest of the script...
    //}

    function parse(args) {
        var ii;

        parsed = true;

        readSupportedSites();
        determineCommandName(args);

        // Options passed are prefixed with "wwwsave"; see the wwwsave shell script for details
        for (ii = 1; ii < args.length; ii += 1) {   // Cannot use args.forEach as we look ahead to and skip the next option
            if (args[ii] === "wwwsave--agent") {
                if (!args[ii + 1]) {
                    throw "User agent --ua value required";
                }

                ii += 1;
                module.exports.userAgent = args[ii];
            } else if (args[ii] === "wwwsave-f") {
                module.exports.forceOverwrite = true;
            } else if (args[ii] === "wwwsave-h" || args[ii] === "wwwsave-?" || args[ii] === "wwwsave--help") {
                module.exports.showUsage = true;
            } else if (args[ii] === "wwwsave-o") {
                if (!args[ii + 1]) {
                    throw "Output directory -o value required";
                }

                ii += 1;
                module.exports.outputDir = args[ii];
            } else if (args[ii] === "wwwsave-p") {
                if (!args[ii + 1]) {
                    throw "Password -p value required";
                }

                ii += 1;
                module.exports.password = args[ii];
            } else if (args[ii] === "wwwsave-r") {
                module.exports.resume = true;
            } else if (args[ii] === "wwwsave-s") {
                if (!args[ii + 1]) {
                    throw "Site -s value required";
                }

                ii += 1;
                module.exports.siteId = args[ii];
            } else if (args[ii] === "wwwsave-u") {
                if (!args[ii + 1]) {
                    throw "Username -u value required";
                }

                ii += 1;
                module.exports.username = args[ii];
            } else if (args[ii] === "wwwsave--url") {
                if (!args[ii + 1]) {
                    throw "URL --url value required";
                }

                ii += 1;
                module.exports.url = args[ii];
            } else if (args[ii] === "wwwsave-v") {
                module.exports.verbose = true;
            } else if (args[ii] === "wwwsave--version") {
                module.exports.showVersion = true;
            } else if (args[ii] === "wwwsave--view") {
                if (!args[ii + 1]) {
                    throw "View --view value required";
                }

                ii += 1;
                module.exports.viewportSize = args[ii];
            }
        }

        if (module.exports.siteId) {
            // Validate authentication scheme.
            var found = supportedSites.some(function (site) {
                return site === module.exports.siteId;
            });
            if (!found) {
                throw "Unknown site -s value \"" + module.exports.siteId + "\"";
            }
            readConfig(module.exports.siteId);

            // Username is required if an authentication scheme is in effect.
            if (!module.exports.username) {
                throw "Username -u option is required with -s option";
            }

            // Ask for password if needed.
            // TODO: make this work
            // SlimerJS issue: https://github.com/laurentj/slimerjs/issues/188
            // Seems to work in PhantomJS, so switch as soon as PJS supports request.body
            if (!module.exports.password && !module.exports.showUsage && !module.exports.showVersion) {
                //module.exports.password = readPassword();
                throw "Password -p option is required with -s option";
            }

            // Expose a more understandable option than siteId
            module.exports.loginRequired = true;
        }

        if (!module.exports.viewportSize) {
            module.exports.viewportSize = defaultViewportSize;
        }

        // Default outputDir is set by wwwsave.js
    }

    function usage() {
        if (!parsed) {
            throw "Must call parse() first";
        }

        var command = "./" + module.exports.command;
        var page = require("webpage").create();

        var padding = "               ";
        var output = "Usage: " + command + " [options]\n";

        output += "\nOptions:\n\n";

        var oo = "--agent ua";
        output += "    " + oo + padding.substring(oo.length) + "User agent to load pages as\n";
        output += "    " + padding + "    " + "(default: " + page.settings.userAgent + ")\n";

        oo = "-f";
        output += "    " + oo + padding.substring(oo.length) + "Force appending data to existing output directory\n";
        output += "    " + padding + "    " + "(will add new files but not update existing files)\n";

        oo = "-h";
        output += "    " + oo + padding.substring(oo.length) + "Show this message\n";

        oo = "-o dir";
        output += "    " + oo + padding.substring(oo.length) + "Directory to save pages to\n";
        output += "    " + padding + "    " + "(default: \"" + command + "-<site>\")\n";

        oo = "-p pwd";
        output += "    " + oo + padding.substring(oo.length) + "Password for login\n";

        oo = "-r";
        output += "    " + oo + padding.substring(oo.length) + "Resume interrupted save\n";

        oo = "-s site";
        output += "    " + oo + padding.substring(oo.length) + "Enable login & personal content discovery\n";
        output += "    " + padding + "    " + "(see below for supported sites)\n";

        oo = "-u name";
        output += "    " + oo + padding.substring(oo.length) + "Username for login\n";

        oo = "--url url";
        output += "    " + oo + padding.substring(oo.length) + "Single page to save\n";
        output += "    " + padding + "    " + "(use -s to save an entire site)\n";

        oo = "-v";
        output += "    " + oo + padding.substring(oo.length) + "Run verbosely\n";
        output += "    " + padding + "    " + "(default: false)\n";

        oo = "--version";
        output += "    " + oo + padding.substring(oo.length) + "Show version\n";

        oo = "--view size";
        output += "    " + oo + padding.substring(oo.length) + "Browser viewport resolution in pixels (format: wxh)\n";
        output += "    " + padding + "    " + "(default: " + defaultViewportSize + ")\n";

        output += "\nTo save a single public page:\n\n";
        output += "    $ " + command + " --url http://www.example.com\n";
        output += "    $ " + command + " --url http://www.example.com/path/to/page.html\n";

        // TODO:
        //output += "\nTo save all personal content on a site requiring login (prompts for password):\n\n";
        //output += "    $ " + command + " -s site -u myname\n";

        //output += "\nTo automate login (exposes plaintext password):\n\n";
        output += "\nTo save all personal content on a site requiring login:\n\n";
        output += "    $ " + command + " -s site -u myname -p '$3cr3t'\n";

        output += "\nTo save a single page on a site requiring login:\n\n";
        output += "    $ " + command + " -s site -u myname -p '$3cr3t' --url http://myname.example.com\n";

        output += "\nThe following sites are supported for use with the -s option:\n\n";
        supportedSites.forEach(function (site) {
            output += "* " + site + "\n";
        });
        output += "\nSee https://github.com/m5n/wwwsave for adding support for different sites";

        return output;
    }

    function toString() {
        var str = JSON.stringify(this);
        str = str.replace(/"password":".*?"/, "\"password\":\"[HIDDEN]\"");
        return str;
    }

    module.exports = {
        parse: parse,
        toString: toString,
        usage: usage
    };
}());
