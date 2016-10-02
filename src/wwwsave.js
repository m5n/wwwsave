/*jslint node: true */
//(function () {
    //"use strict";

var fs = require('fs'),
    logger = require('./logger'),
    options = require('./options'),
    scraper = require('./scraper'),
    system = require('system');

var resumeFilename = ".pending";

if (parseOptions(options)) {
    logger.init(options);
    scraper.init(options, resumeFilename);

    logger.debug("Options:", options);

    // Do login before creating directories as an error could still occur.
    if (options.loginRequired) {
        scraper.addLoginSteps();
    }

    if (options.resume) {
        logger.log("Resuming save");

        var filename = options.outputDir + fs.separator + resumeFilename;
        var urls = JSON.parse(fs.read(filename));
        urls.forEach(function (url) {
            scraper.addSavePageSteps(url, options);
        });
    } else {
        scraper.addIntermediateStep("Ensure output directory exists", initOutputDir);

        // Must be added after login & username substitution
        // TODO: move to scraper so that no need to pass scraper and have "this" be the scraper...
        scraper.addIntermediateStep("Add content to save", function (options, logger, scraper) {
            if (options.url) {
                // Add steps in reverse order
                scraper.addSaveCurrentPageAsIndexSteps();
                scraper.addSavePageSteps(options.url, options);
            } else {
                // Add steps in reverse order
                if (options.content_to_save) {
                    for (var ii = 0; ii < options.content_to_save.length; ii += 1) {
                        if (options.content_to_save[ii].indexOf('regex:') < 0) {
                            scraper.addSaveSiteSteps(options.content_to_save[ii], options);
                        }
                    }
                }
                scraper.addSaveCurrentPageAsIndexSteps();
                // Already at home page after login, so no step needed to load it
                //scraper.addSaveSiteSteps(options.home_page, options);
            }
        }, [options, logger, scraper]);
    }

    if (options.loginRequired) {
        scraper.addLogoutSteps();
    }

    scraper.addLastStep(processScraperResult);

    scraper.start(options);
}

// TODO: phantom.exit() does not stop script execution?!
function parseOptions(options) {
    try {
        options.parse(system.args);
    } catch (error) {
        logger.error(error.message || error);
        phantom.exit(1);
        return false;
    }

    if (options.showUsage) {
        logger.log(options.usage());
        phantom.exit(0);
        return false;
    } else if (options.showVersion) {
        var version = require("./version").version;
        logger.log(options.command + ' v' + version);
        phantom.exit(0);
        return false;
    } else if (fs.exists(options.outputDir) && !options.forceOverwrite) {
        logger.error("Output directory exists (use -f option to append data)");
        phantom.exit(2);
        return false;
    } else if (options.resume && !fs.exists(options.outputDir + fs.separator + resumeFilename)) {
        logger.error("Nothing to resume");
        phantom.exit(3);
        return false;
    }

    return true;
}

function processScraperResult(result) {
    if (result) {
        fs.remove(options.outputDir + fs.separator + resumeFilename);
        phantom.exit(0);
    } else {
        phantom.exit(4);
    }
}

function initOutputDir() {
    var exists = fs.exists(options.outputDir);
    logger.debug("Output dir exists?", exists);

    if (!exists) {
        // Create output directory
        fs.makeTree(options.outputDir);
    }

    // Output info about this copy
    var filename = options.outputDir + fs.separator + "README.txt";
    var file = fs.open(filename, exists ? "a" : "w");
    if (exists) {
        logger.debug("README file exist");
        file.writeLine("Updated: " + (new Date()).toISOString());
    } else {
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
        file.writeLine("Date: " + (new Date()).toISOString());
    }
    file.close();
}
