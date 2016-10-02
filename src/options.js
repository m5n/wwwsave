/*jslint node: true */
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

        if (!module.exports.outputDir) {
            // Set default
            module.exports.outputDir = module.exports.command;
            if (module.exports.siteId) {
                module.exports.outputDir += "-" + module.exports.siteId;
            } else if (module.exports.url) {
                /.+:\/\/(.+)\/?/.test(module.exports.url);
                module.exports.outputDir += "-" + RegExp.$1;
            } else {
                module.exports.outputDir += "-" + (new Date()).toISOString();
            }
        }

        if (!module.exports.viewportSize) {
            module.exports.viewportSize = defaultViewportSize;
        }
    }

    function usage() {
        if (!parsed) {
            throw "Must call parse() first";
        }

        var command = module.exports.command;
        var page = require('webpage').create();

        var output = "Usage: " + command + " [options]\n";

        output += "\nOptions:\n";

        output += "\t--agent ua\tUser agent to load pages as\n";
        output += "\t\t\t\t(default: " + page.settings.userAgent + ")\n";

        output += "\t-f\t\tForce appending data to existing output directory\n";
        output += "\t\t\t\t(will add new files, not refresh existing ones)\n";

        output += "\t-h\t\tShow this message\n";

        output += "\t-o dir\t\tDirectory to save pages to\n";
        output += "\t\t\t\t(default: \"" + module.exports.command + "-<site>\")\n";

        output += "\t-p pwd\t\tPassword for login\n";

        output += "\t-r\t\tResume interrupted save\n";

        output += "\t-s site\t\tEnable login & personal content discovery\n";
        output += "\t\t\t\t(see below for supported sites)\n";

        output += "\t-u name\t\tUsername for login\n";

        output += "\t--url url\tSingle page to save\n";
        output += "\t\t\t\t(use -s to save an entire site)\n";

        output += "\t-v\t\tRun verbosely\n";
        output += "\t\t\t\t(default: false)\n";

        output += "\t--version\tShow version\n";

        output += "\t--view size\tBrowser viewport resolution in pixels (format: wxh)\n";
        output += "\t\t\t\t(default: " + defaultViewportSize + ")\n";

        output += "\nTo save a single public page:\n";
        output += "\t$ " + command + " --url http://www.example.com\n";
        output += "\t$ " + command + " --url http://www.example.com/path/to/page.html\n";

        // TODO:
        //output += "\nTo save all personal content on a site requiring login (prompts for password):\n";
        //output += "\t$ " + command + " -s site -u myname\n";

        //output += "\nTo automate login (exposes plaintext password):\n";
        output += "\nTo save all personal content on a site requiring login:\n";
        output += "\t$ " + command + " -s site -u myname -p '$3cr3t'\n";

        output += "\nTo save a single page on a site requiring login:\n";
        output += "\t$ " + command + " -s site -u myname -p '$3cr3t' --url http://myname.example.com\n";

        output += "\nThe following sites are supported for use with the -s option:\n";
        supportedSites.forEach(function (site) {
            output += "\t" + site + "\n";
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
