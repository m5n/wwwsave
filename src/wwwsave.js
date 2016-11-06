/*jslint browser, node */
/*global phantom */
(function () {
    "use strict";

    var fs = require("fs");
    var logger = require("./logger");
    var options = require("./options");
    var scraper = require("./scraper");
    var system = require("system");

    function parseOptions(options) {
        var exitCode;

        try {
            options.parse(system.args);
        } catch (error) {
            logger.error(error.message || error);
            exitCode = 1;
        }

        if (options.showUsage) {
            logger.info(options.usage());
            exitCode = 0;
        } else if (options.showVersion) {
            var version = require("./version").version;
            logger.info(options.command + " v" + version);
            exitCode = 0;
        } else if (!options.siteId && !options.url) {
            logger.error("Must specify either -s or --url option");
            exitCode = 2;
        }

        if (exitCode >= 0) {
            // TODO: phantom.exit() does not stop script execution?!
            phantom.exit(exitCode);
            return false;
        } else {
            return true;
        }
    }

    function processScraperResult(result) {
        if (result) {
            phantom.exit(0);
        } else {
            phantom.exit(4);
        }
    }

    function initOutputDir() {
        logger.info("Saving content to \"" + options.outputDir + "\"");

        var exists = fs.exists(options.outputDir);
        logger.debug("Output dir exists?", exists);

        if (!exists) {
            // Create output directory
            fs.makeTree(options.outputDir);
        }

        // Output info about this copy
        var filename = options.outputDir + fs.separator + "README.txt";
        var file;
        if (exists) {
            file = fs.open(filename, "a");
            logger.debug("README file exist");
            file.writeLine("Updated: " + (new Date()).toLocaleString());
        } else {
            file = fs.open(filename, "w");
            logger.debug("Create README file");
            file.writeLine("Thank you for using https://github.com/m5n/" + options.command);
            file.writeLine("");
            if (options.url) {
                file.writeLine("Page: " + options.url);
            } else if (options.home_page) {
                file.writeLine("Site: " + options.home_page);
            }
            if (options.loginRequired) {
                file.writeLine("User: " + options.username);
            }
            file.writeLine("Date: " + (new Date()).toLocaleString());
        }
        file.close();
    }

    if (parseOptions(options)) {
        logger.init(options);
        scraper.init(options);

        logger.debug("Options:", options);

        // Do login before creating directories as an error could still occur.
        if (options.loginRequired) {
            scraper.addLoginSteps();
        }

        if (options.url) {
            scraper.addCorrectUrlArgumentSteps(options);
        }

        if (!options.outputDir) {
            scraper.addIntermediateStep("Determine output directory", function () {
                var suffix;

                options.outputDir = options.command;
                if (options.siteId) {
                    suffix = options.siteId;
                } else if (options.url) {
                    (/^.+:\/\/([^\/]+)/).test(options.url);
                    suffix = RegExp.$1;
                }
                options.outputDir += "-" + suffix;
            });
        }

        if (!options.resume && !options.forceOverwrite) {
            scraper.addIntermediateStep("Make sure output directory does not already exist", function () {
                if (fs.exists(options.outputDir)) {
                    return "Output directory exists (use -f option to append data)";
                    // TODO: this ends up taking a screenshot... avoid that
                }
            });
        }

        var error = false;
        if (options.resume) {
            if (scraper.resume(options)) {
                logger.info("Resuming previous save");
            } else {
                logger.error("Nothing to resume");
                phantom.exit(3);

                // TODO: for some reason, Slimer does not exit per the line above
                error = true;
            }
        } else {
            scraper.addIntermediateStep("Create output directory", initOutputDir);

            // Must be added after login & username substitution
            // TODO: move to scraper so there's no need to pass scraper and have "this" be the scraper...
            scraper.addIntermediateStep("Add content to save", function (options, scraper) {
                if (options.url) {
                    // URL needs to be loaded first, then save as index

                    // Add steps in reverse order
                    scraper.addSaveCurrentPageAsIndexSteps();
                    scraper.addSavePageSteps(options.url, options);
                } else {
                    // Already at home page after login, so save index first, then other pages

                    // Add steps in reverse order
                    if (options.content_to_save) {
                        options.content_to_save.forEach(function (item) {
                            if (item.indexOf("regex:") < 0) {
                                item = scraper.mergeUrl(options.home_page, item);
                                scraper.addSaveSiteSteps(item, options);
                            }
                        });
                    }
                    scraper.addSaveCurrentPageAsIndexSteps();
                    // Already at home page after login, so no step needed to load it
                    //scraper.addSaveSiteSteps(options.home_page, options);
                }
            }, [options, scraper]);
        }

        if (!error) {
            if (options.loginRequired) {
                scraper.addLogoutSteps();
            }

            scraper.addLastStep(processScraperResult);

            scraper.start(options);
        }
    }
}());
