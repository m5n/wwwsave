/*jslint node */
(function () {
    "use strict";

    var fs = require("fs");
    var logger = require("./logger");
    var page = require("webpage").create();

    // Number of milliseconds to wait before fetching next page
    var NEXT_PAGE_DELAY = 2000;

    var captureAllPagesInSite = false;
    var completedPreSavePageSetup = false;
    var finalStepCallbackFn = function () { logger.debug("No-op last step"); };   // No-op by default
    var loadInProgress = false;
    var resumeFilename = ".pending";
    var startTime;
    var queue = [];   // Contains steps to be taken still
    var extensionLookup = {};   // Contains extensions for certain received resources
                                // (Needed because content type is not known when processing <img> src's for example)

    function init(options) {
        logger.init(options);
        initPage(page, options);
    }

    function initPage(page, options) {
        var res = options.viewportSize.split("x");
        page.viewportSize = { width: res[0], height: res[1] };

        if (options.userAgent) {
            page.settings.userAgent = options.userAgent;
        }

        page.onConsoleMessage = function(msg) {
            // Hide messages from web sites that will be visited
            //logger.debug("REMOTE CONSOLE: " + msg);
        };

        page.onUrlChanged = function(request) {
            logger.debug("URL change:", JSON.stringify(request, undefined, 4));
        };

        page.onLoadStarted = function() {
            loadInProgress = true;
        };

        page.onLoadFinished = function() {
            loadInProgress = false;
        };
    }

    function resume(options) {
        var filename = options.outputDir + fs.separator + resumeFilename;
        if (fs.exists(filename)) {
            addIntermediateStep("Adding pending pages", function (options, filename) {
                var method = options.url ? addSavePageSteps : addSaveSiteSteps;
                var urls = JSON.parse(fs.read(filename));
                urls.forEach(function (url) {
                    method(url, options);
                });
            }, [options, filename]);

            return true;
        } else {
            return false;
        }
    }

    function mergeUrl(templateUrl, url) {
        if (!url.startsWith("h")) {
            if (url.startsWith("//")) {
                // Add protocol
                logger.debug("Add protocol from", templateUrl, "to", url);
                if ((/^(.+)\/\//).test(templateUrl)) {
                    var protocol = RegExp.$1;
                    url = protocol + url;
                    logger.debug("Protocol:", protocol);
                } else {
                    logger.error("Cannot extract protocol from \"" + templateUrl + "\"; not converting \"" + url + "\"");
                }
            } else if (url.startsWith("/")) {
                // Add base URL
                logger.debug("Add base URL from", templateUrl, "to", url);
                if ((/^(.+:\/\/[^\/]+)/).test(templateUrl)) {
                    var baseUrl = RegExp.$1;
                    url = baseUrl + url;
                    logger.debug("Base URL:", baseUrl);
                } else {
                    logger.error("Cannot extract base URL from \"" + templateUrl + "\"; not converting \"" + url + "\"");
                }
            } else {
                logger.error("Unexpected URL; not converting \"" + url + "\"");
            }
        }

        return url;
    }

    function urlToPath(url, prefix, ext) {
        var result = url;
        var qs;

        // Extract hostname and path
        var path;
        if (/.+:\/\/(.*)/.test(url)) {   // Has protocol
            path = RegExp.$1;
        } else {
            path = url;
        }

        // Since the query string is made part of the file name (see below),
        // make sure there are no directory separators in it.
        var idx = path.indexOf("?");
        if (idx >= 0) {
            qs = path.substring(idx).replace(/\//g, "_S_");
            path = path.substring(0, idx) + qs;
        }

        // Some sites use dynamic concatenation of files by requesting them via
        // the query string, e.g.:
        // http://l-stat.livejournal.net/??lj_base.css,controlstrip-new.css,widgets/calendar.css,widgets/filter-settings.css,popup/popupus.css,popup/popupus-blue.css,lj_base-journal.css,journalpromo/journalpromo_v3.css?v=1417182868
        // So don't chop off the query string, keep it as part of the file name.
        path = path.replace(/\?/g, "_Q_");

        // Escaped chars could cause trouble, e.g. %20, which is turned into space.
        path = path.replace(/%/g, "_P_");

        // Make sure there's a '/' between prefix and path.
        if (prefix.charAt(prefix.length - 1) != "/" && path.charAt(0) != "/") {
            path = "/" + path;
        }
        path = prefix + path;

        // Make sure there's an ending "/" for root directory URLs, e.g.
        // "https://github.com"
        // TODO: what about nested directory URLs?
        if (url.split("/").length === 3) {
            path += "/";
        }

        // Make sure there's a filename
        if (path.charAt(path.length - 1) == "/") {
            path += "index." + ext;
            extensionLookup[url] = ext;
        }

        // Make sure there's an extension (SVGs won't render without it)
        if (!(/\.[^./]+$/).test(path)) {
            path += "." + ext;
            extensionLookup[url] = ext;
        }

        // Avoid file names getting too long; usually systems have 255 chars max
        var frags = path.split("/");
        for (var ii = 0; ii < frags.length; ii += 1) {
            if (frags[ii].length > 255) {
                frags[ii] = frags[ii].substring(0, 255);
            }
        }
        path = frags.join("/");

        return path.replace(/\//g, fs.separator);   // Make it a local path.
    }

    function saveFile(path, data) {
        logger.debug("           As: " + path);
        // Path looks like "./some/dirs/deep/file.ext", so skip 1st dir and file.
        var dirs = path.split("/");
        dirs.pop();
        fs.makeTree(dirs.join("/"));
        fs.write(path, data, "wb");
    /*
        // TODO: use this if using phantomjs instead of slimerjs
        fs.access(path, fs.F_OK | fs.W_OK, function (err) {
            logger.debug('fs.access callback');
            if (err) {
                // Dir does not exist or file does not exist in dir.
                logger.debug('path or file does not exist');

                var dirs = path.split('/');
                logger.debug('going to mkdir ' + dirs);
                // path looks like "./some/dirs/deep/file.ext", so skip 1st dir and file.
                var dir = dirs[0];
                for (var idx = 1; idx < dirs.length - 1; idx += 1) {
                    dir += '/' + dirs[idx];
                    logger.debug('mkdir ' + dir);
                    fs.mkdir(dir, function (err) {
                        logger.debug('fs.mkdir callback');
                        if (err) {
                            if (err.code !== 'EEXIST') {
                                throw('Could not create directory: ' + JSON.stringify(err));
                            }
                            // Else dir already existed.
                            else logger.debug('dir already existed');
                        }
                        // Else dir was created.
                        else logger.debug('dir ' + dir + ' was created');
                    });
                }
                // Dir now exists; just write out the file.
                logger.debug('write file ' + path);
                fs.writeFile(path, data, function (error) {
                    logger.debug('fs.writeFile callback');
                    if (error) {
                        logger.error("write error:  " + error.message);
                    } else {
                        logger.debug("Successful Write to " + path);
                    }
                });
            }
            // Else file was saved before. Skip.
            else logger.debug('File was saved before; skip ' + path);
        });
        */
    }

    function logQueueContents() {
        logger.debug("Steps (in reverse order):");
        queue.forEach(function (step) {
            logger.debug("-", step.desc);
        });
    };

    function addLoginSteps() {
        addLoadPageSteps(options.login_page, "unshift", "login page: " + options.login_page);

        queue.unshift({
            desc: "Ensure login fields can be found",
            fn: function (options) {
                var elts = page.evaluate(function (options) {
                    var formElt = document.querySelector(options.login_form_selector);
                    if (formElt) {
                        var nameElt = formElt.elements[options.login_form_username_field_name];
                        var pwdElt = formElt.elements[options.login_form_password_field_name];
                    }
                    var btnElt = document.querySelector(options.login_form_submit_button_selector);
                    return { formElt: !!formElt, nameElt: !!nameElt, pwdElt: !!pwdElt, btnElt: !!btnElt };
                }, options);

                var msg = "";
                if (!elts.formElt) {
                    msg += "Could not find login form elt \"" + options.login_form_selector + "\"\n";
                }
                if (!elts.nameElt) {
                    msg += "Could not find login form username elt \"" + options.login_form_username_field_name + "\"\n";
                }
                if (!elts.pwdElt) {
                    msg += "Could not find login form password elt \"" + options.login_form_password_field_name + "\"\n";
                }
                if (!elts.btnElt) {
                    msg += "Could not find login form submit button elt \"" + options.login_form_submit_button_selector + "\"\n";
                }

                return { result: !msg, msg: msg };
            }
        });

        queue.unshift({
            desc: "Fill out login fields",
            fn: function (options) {
                page.evaluate(function(options) {
                    var formElt = document.querySelector(options.login_form_selector);
                    var nameElt = formElt.elements[options.login_form_username_field_name];
                    var pwdElt = formElt.elements[options.login_form_password_field_name];

                    // Setting value on field is like pasting: no key or focus/blur events occur.
                    // This is a problem with sites that validate on blur, so simulate this in code.
                    nameElt.focus();
                    nameElt.value = options.username;
                    pwdElt.focus();
                    pwdElt.value = options.password;
                    nameElt.focus();
                }, options);

                return { result: true };
            }
        });

        queue.unshift({
            desc: "Ensure login fields are filled out",
            fn: function (options) {
                var result = page.evaluate(function(options) {
                    var formElt = document.querySelector(options.login_form_selector);
                    var nameElt = formElt.elements[options.login_form_username_field_name];
                    var pwdElt = formElt.elements[options.login_form_password_field_name];

                    var msg = "";
                    if (nameElt.value != options.username) {
                        msg += "Username field not filled out\n";
                    }
                    if (pwdElt.value != options.password) {
                        msg += "Password field not filled out\n";
                    }

                    return { result: !msg, msg: msg };
                }, options);

                return result;
            }
        });

        queue.unshift({
            desc: "Ensure login button enabled",
            fn: function (options) {
                var disabled = page.evaluate(function (options) {
                    var btnElt = document.querySelector(options.login_form_submit_button_selector);
                    return btnElt.hasAttribute("disabled");
                }, options);

                return { result: !disabled, msg: disabled ? "Login button not enabled after entering credentials" : "" };
            }
        });

        queue.unshift({
            desc: "Submit login",
            fn: function (options) {
                // Authenticate
                page.evaluate(function(options) {
                    if (options.login_form_submit_via_button) {
                        var btnElt = document.querySelector(options.login_form_submit_button_selector);
                        btnElt.focus();
                        btnElt.click();
                    } else {
                        var formElt = document.querySelector(options.login_form_selector);
                        formElt.submit();
                    }
                }, options);

                return { result: true };
            }
        });

        queue.unshift({
            desc: "Check login result",
            fn: function (options) {
                var result = page.evaluate(function(options) {
                    var errorElt = document.querySelector(options.login_error_text_selector);

                    var msg;
                    // Some sites always render the error element, so make sure it's not empty.
                    if (errorElt && errorElt.innerText) {
                        msg = errorElt.innerText;
                    }

                    return { result: !msg, msg: msg };
                }, options);

                return result;
            },
            waitFn: function (options) {
                var result = page.evaluate(function(options) {
                    var errorElt = document.querySelector(options.login_error_text_selector);
                    var successElt = document.querySelector(options.login_success_element_selector);

                    // Some sites always render the error element, so make sure it's not empty.
                    return (errorElt && errorElt.innerText) || successElt;
                }, options);

                return result;
            },
            timeoutFn: function (options) {
                var errorHtml = page.evaluate(function(options) {
                    var errorElt = document.querySelector(options.login_error_text_selector);
                    return errorElt ? errorElt.outerHTML : undefined;
                }, options);

                var successHtml = page.evaluate(function(options) {
                    var successElt = document.querySelector(options.login_success_element_selector);
                    return successElt ? successElt.outerHTML : undefined;
                }, options);

                logger.debug("Error markup: " + errorHtml + ", success markup: " + successHtml);

                return { result: false, msg: "Could not determine login success or failure (markup may have changed or a longer delay is needed before evaluating this step)" };
            }
        });

        queue.unshift({
            desc: "Ensure home page link can be found",
            fn: function (options) {
                var exists = page.evaluate(function (options) {
                    var linkElt = document.querySelector(options.homepage_link_selector);
                    return !!linkElt;
                }, options);

                return { result: exists, msg: exists ? "" : "Could not find home page elt " + options.homepage_link_selector };
            }
        });

        queue.unshift({
            desc: "Navigate to home page",
            fn: function (options) {
                page.evaluate(function (options) {
                    var linkElt = document.querySelector(options.homepage_link_selector);
                    linkElt.click();
                }, options);

                return { result: true };
            }
        });

        // Now that there's a page to work with, incorporate the username details
        queue.unshift({
            desc: "Extract username and apply to options",
            fn: function (options) {
                // Capture user ID (in case login username != logged-in username)
                var userId = page.evaluate(function(options) {
                    var regex = new RegExp(options.username_in_homepage_url_regex);
                    regex.test(document.location.href);
                    return RegExp.$1;
                }, options);

                if (userId) {
                    logger.debug("Username: " + userId);

                    options.home_page = page.url;
                    logger.debug("Home page: " + options.home_page);

                    if (options.content_to_save) {
                        for (var ii = 0; ii < options.content_to_save.length; ii += 1) {
                            options.content_to_save[ii] = options.content_to_save[ii].replace(/\{\{username\}\}/, userId);
                            var hp = options.home_page;
                            if (/\{\{home_page\}\}\//.test(options.content_to_save[ii]) && hp.lastIndexOf("/") === hp.length - 1) {
                                hp = hp.substring(0, hp.length - 1);
                            }
                            options.content_to_save[ii] = options.content_to_save[ii].replace(/\{\{home_page\}\}/, hp);
                        }
                    }
                    logger.debug("Content pages to save: " + options.content_to_save.join(", "));

                    if (options.content_to_exclude) {
                        for (var ii = 0; ii < options.content_to_exclude.length; ii += 1) {
                            options.content_to_exclude[ii] = options.content_to_exclude[ii].replace(/\{\{username\}\}/, userId);
                            var hp = options.home_page;
                            if (/\{\{home_page\}\}\//.test(options.content_to_exclude[ii]) && hp.lastIndexOf("/") === hp.length - 1) {
                                hp = hp.substring(0, hp.length - 1);
                            }
                            options.content_to_exclude[ii] = options.content_to_exclude[ii].replace(/\{\{home_page\}\}/, hp);
                        }
                    }
                    logger.debug("Content pages to exclude: " + options.content_to_exclude.join(", "));

                    if (options.content_to_save_only_if_linked_from_other_content) {
                        for (var ii = 0; ii < options.content_to_save_only_if_linked_from_other_content.length; ii += 1) {
                            options.content_to_save_only_if_linked_from_other_content[ii] = options.content_to_save_only_if_linked_from_other_content[ii].replace(/\{\{username\}\}/, userId);
                            var hp = options.home_page;
                            if (/\{\{home_page\}\}\//.test(options.content_to_save_only_if_linked_from_other_content[ii]) && hp.lastIndexOf("/") === hp.length - 1) {
                                hp = hp.substring(0, hp.length - 1);
                            }
                            options.content_to_save_only_if_linked_from_other_content[ii] = options.content_to_save_only_if_linked_from_other_content[ii].replace(/\{\{home_page\}\}/, hp);
                        }
                    }
                    logger.debug("Special linked content to save: " + options.content_to_save_only_if_linked_from_other_content.join(", "));
                }

                return { result: !!userId, msg: userId ? "" : "Could not extract username " + options.username_in_homepage_url_regex };
            }
        });

        logger.debug("Add login steps");
        logQueueContents();
    }

    function addLogoutSteps() {
        queue.unshift({
            desc: "Pre-logout page setup",
            fn: function (options) {
                page.captureContent = [];
                page.onResourceReceived = function () {};

                return { result: true };
            }
        });

        queue.unshift({
            desc: "Ensure logout link can be found",
            fn: function (options) {
                var exists = page.evaluate(function (options) {
                    var linkElt = document.querySelector(options.logout_link_selector);
                    return !!linkElt;
                }, options);

                return { result: exists, msg: exists ? "" : "Could not find logout elt " + options.logout_link_selector };
            }
        });

        queue.unshift({
            desc: "Log out",
            fn: function (options) {
                page.evaluate(function (options) {
                    var linkElt = document.querySelector(options.logout_link_selector);
                    linkElt.click();
                }, options);

                return { result: true };
            }
        });

        logger.debug("Add logout steps");
        logQueueContents();
    }

    function addPreSavePageSetupSteps() {
        completedPreSavePageSetup = true;

        queue.push({
            desc: "Pre-save page setup",
            fn: function (options) {
                page.captureContent = [ /css/, /font/, /html/, /image/, /javascript/ ];
                page.onResourceReceived = function (response) {
                    if (response.stage === "end" && response.status < 300 && response.body.length > 0) {
                        var body = response.body;
                        delete response.body;   // So it won't be outputted in the logger.debug below
                        logger.debug("Resource received:", response.url, JSON.stringify(response));

                        var ext;
                        // SVGs don't load without a file extension...
                        // map each of the captureContent items to an extension
                        if ((/image\/(\w+)/).test(response.contentType)) {   // Image, even image/svg+xml
                            ext = RegExp.$1 === "jpeg" ? "jpg" : RegExp.$1;
                        } else if ((/text\/(\w+)/).test(response.contentType)) {   // CSS or HTML
                            ext = RegExp.$1;
                        } else if ((/javascript/).test(response.contentType)) {   // JS
                            ext = "js";
                        }
                        // TODO: font

                        var path = urlToPath(response.url, options.outputDir, ext);
                        if (fs.exists(path)) {
                            logger.debug("Already saved resource: " + response.url);
                        } else {
                            logger.debug("Save resource: " + response.url);

                            var isCss = response.url.endsWith(".css");
                            var isHtml = response.url.endsWith(".html");
                            if (!isCss || !isHtml) {
                                if (response.contentType.startsWith("text/css")) {
                                    isCss = true;
                                } else if (response.contentType.startsWith("text/html")) {
                                    isHtml = true;
                                }
                            }
                            logger.debug("isCss", isCss, "isHtml", isHtml);

                            if (isCss) {
                                body = processCss(body, response.url, path, options);
                            } else if (isHtml) {
                                body = processHtml(body, path, options);
                            }

                            saveFile(path, body);
                        }
                    }
                };

                return { result: true };
            }
        });

        logger.debug("Add Pre-save page setup steps");
        logQueueContents();
    }

    function processHtml(body, path, options) {
        function replacer(match, prefix, href) {
            var origHref = href;
            var resultHref = origHref;
            var unprocessed = prefix + "\"" + href + "\"";

            logger.debug("Replace \"" + href + "\"");

            // Skip empty URLs
            if (!href) {
                logger.debug("Skip empty URLs");
                return unprocessed;
            }

            // Skip in-page anchors
            if (href.charAt(0) === "#") {
                logger.debug("Skip in-page anchors");
                return unprocessed;
            }

            // TODO: don't break on invalid URLs, e.g. "http://ex*mple.com"
            href = mergeUrl(page.url, href);
            logger.debug("= URL \"" + href + "\"");

            if (options.url) {
                // Use full URLs wherever possible if user only saves a single page,
                // so refresh default return value now that href may have changed
                unprocessed = prefix + "\"" + href + "\"";
            }

            // If this URL will not be saved, no need to process it either
            var isExcludePage = false;
            if (options.content_to_exclude) {
                options.content_to_exclude.forEach(function (item) {
                    logger.debug("Excluded page check: " + item);
                    if (item.indexOf("regex:") === 0) {
                        var regex = item.substring("regex:".length);
                        regex = new RegExp(regex, "i");
                        if (regex.test(href)) {
                            isExcludePage = true;
                        }
                    } else {
                        if (item === href) {
                            isExcludePage = true;
                        }
                    }
                });
            }
            if (isExcludePage) {
                logger.debug("Skip excluded pages");
                return unprocessed;
            }

            logger.debug("Not an excluded page");

            var onContentPage = false;
            if (options.content_to_save) {
                options.content_to_save.forEach(function (item) {
                    var match = false;
                    if (item.indexOf("regex:") === 0) {
                        var regex = item.substring("regex:".length);
                        regex = new RegExp(regex, "i");
                        if (regex.test(page.url)) {
                            onContentPage = true;
                        }
                        if (regex.test(href)) {
                            match = true;
                        }
                    } else {
                        if (item === page.url) {
                            onContentPage = true;
                        }
                        if (item === href) {
                            match = true;
                        }
                    }

                    if (match) {
                        var saveAs = urlToPath(href, options.outputDir, "html");

                        resultHref = htmlRef(path, saveAs);

                        if (captureAllPagesInSite) {
                            var inQueue = false;
                            queue.forEach(function (qItem) {
                                // TODO: how to test if URL is in queue?
                                if (qItem === origHref) {
                                    inQueue = true;
                                }
                            });

                            // Items that are not regex'es were already added to queue
                            // by wwwsave.js, so only regex'es need to be inspected here
                            if (item.indexOf("regex:") === 0 &&   // Is a regex
                                    page.url !== origHref &&      // Not currently being processed
                                    !fs.exists(saveAs) &&         // Not already saved
                                    !inQueue) {                   // Not already queued
                                logger.debug("Adding page:", origHref);
                                logger.debug("         As:", saveAs);
                                logger.debug("       HTML:", resultHref);
                                logger.debug("   (In path:", path);

                                addSavePageSteps(origHref, options);
                            }
                        }
                    }
                });
            }

            // Only process if it's a reference off of an included page
            if (!onContentPage) {
                logger.debug("Skip references off of non-content pages");
                return unprocessed;
            }

            logger.debug("On a content page");

            // Only process if special linkage option is defined
            if (!options.content_to_save_only_if_linked_from_other_content) {
                logger.debug("Skip if special linkage option is not defined");
                return unprocessed;
            }

            options.content_to_save_only_if_linked_from_other_content.forEach(function (item) {
                var match = false;
                if (item.indexOf("regex:") === 0) {
                    var regex = item.substring("regex:".length);
                    regex = new RegExp(regex, "i");
                    if (regex.test(href)) {
                        match = true;
                    }
                } else {
                    if (item === href) {
                        match = true;
                    }
                }

                if (match) {
                    var saveAs = urlToPath(href, options.outputDir, "html");

                    resultHref = htmlRef(path, saveAs);

                    if (captureAllPagesInSite) {
                        var inQueue = false;
                        queue.forEach(function (qItem) {
                            // TODO: how to test if URL is in queue?
                            if (qItem === origHref) {
                                inQueue = true;
                            }
                        });

                        // No pages or regex'es of this list option has been added yet,
                        // so unlike above, don't inspect just regex'es here.
                        if (page.url !== origHref &&    // Not currently being processed
                                !fs.exists(saveAs) &&   // Not already saved
                                !inQueue) {             // Not already queued
                            logger.debug("Adding page:", origHref);
                            logger.debug("         As:", saveAs);
                            logger.debug("       HTML:", resultHref);
                            logger.debug("   (In path:", path);

                            addSavePageSteps(origHref, options);
                        }
                    }
                }
            });

            logger.debug("Processed to \"" + resultHref + "\"");
            return prefix + "\"" + resultHref + "\"";
        }

        logger.debug("Process anchor links...");
        body = body.replace(/(<a[^>?]+href=)["']([^"']+)["']/g, replacer);

        // TODO:
        /*
        # Avoid HTML entities in certain tags.
        tags = [ 'noscript', 'script', 'style' ]
        page.traverse do |node|
          if tags.include? node.name
            node.content = CGI.unescapeHTML node.content
          end
        end

        # Process in-page style blocks.
        page.search('style').each do |item|
          item.content = processCss item.content, @page_uri, path, @options
        end

        # Process inline styles.
        page.search('[style]').each do |item|
          item['style'] = processCss item['style'], @page_uri, path, @options
        end
        */

        logger.debug("Process stylesheet links...");
        body = body.replace(/(<link[^>]*\shref=)["']([^"']+)["']/g, function (match, prefix, href) {
            // TODO: refactor these repeated replacer functions
            var ext = "css";
            var url = mergeUrl(page.url, href);
            var saveAs = urlToPath(url, options.outputDir, ext);
            var newHref = htmlRef(path, saveAs);
            logger.debug(" HTML link:", href);
            logger.debug("  URL link:", url);
            logger.debug("   Save as:", saveAs);
            logger.debug("Local link:", newHref);
            logger.debug("   In path:", path);
            return prefix + "\"" + newHref + "\"";
        });

        logger.debug("Process image links...");
        body = body.replace(/(<img[^>]*\ssrc=)["']([^"']+)["']/g, function (match, prefix, src) {
            var url = mergeUrl(page.url, src);
            var ext = extensionLookup[url] || "png";
            var saveAs = urlToPath(url, options.outputDir, ext);
            var newSrc = htmlRef(path, saveAs);
            logger.debug(" HTML link:", src);
            logger.debug("  URL link:", url);
            logger.debug("   Save as:", saveAs);
            logger.debug("Local link:", newSrc);
            logger.debug("   In path:", path);
            return prefix + "\"" + newSrc + "\"";
        });

        logger.debug("Process JavaScript links...");
        body = body.replace(/(<script[^>]*\ssrc=)["']([^"']+)["']/g, function (match, prefix, src) {
            var ext = "js";
            var url = mergeUrl(page.url, src);
            var saveAs = urlToPath(url, options.outputDir, ext);
            var newSrc = htmlRef(path, saveAs);
            logger.debug(" HTML link:", src);
            logger.debug("  URL link:", url);
            logger.debug("   Save as:", saveAs);
            logger.debug("Local link:", newSrc);
            logger.debug("   In path:", path);
            return prefix + "\"" + newSrc + "\"";
        });

        logger.debug("Process iframe links...");
        body = body.replace(/(<iframe[^>]*\ssrc=)["']([^"']+)["']/g, function (match, prefix, src) {
            var ext = "html";
            var url = mergeUrl(page.url, src);
            var saveAs = urlToPath(url, options.outputDir, ext);
            var newSrc = htmlRef(path, saveAs);
            logger.debug(" HTML link:", src);
            logger.debug("  URL link:", url);
            logger.debug("   Save as:", saveAs);
            logger.debug("Local link:", newSrc);
            logger.debug("   In path:", path);
            return prefix + "\"" + newSrc + "\"";
        });

        // TODO: add code from addReferencedPages below
        return body;
    }

    function addReferencedPages(body) {
        // TODO

        /*
        def save_resource(refUrl, in_path, ext='html')
          saveAs = local_path refUrl, @options.output_dir, ext
          new_ref = htmlRef in_path, saveAs

          # Don't save pages as resources.
          is_content_page = false
          if @options.has_content_to_save?
            @options.content_to_save.each do |item|
              if item.start_with? 'regex:'
                regex = item['regex:'.length..-1]
                is_content_page = true if refUrl.to_s[/#{regex}/i]
              else
                content_uri = @home_uri.merge item
                is_content_page = true if refUrl == content_uri
              end
            end
          end
          if @options.has_content_to_save_only_if_linked_from_other_content?
            @options.content_to_save_only_if_linked_from_other_content.each do |item|
              if item.start_with? 'regex:'
                regex = item['regex:'.length..-1]
                is_content_page = true if refUrl.to_s[/#{regex}/i]
              else
                content_uri = @home_uri.merge item
                is_content_page = true if refUrl == content_uri
              end
            end
          end

          if is_content_page || File.exists?(saveAs)   # TODO: use in-memory cache?
            @logger.log "        Skip: #{saveAs}"
          else
            @logger.log "          As: #{saveAs}"

            process_resource refUrl, saveAs
          end

          new_ref
        end
        */
    }

    function processCss(content, refUrl, refPath, options) {
        return content.replace(/(url\s*\(\s*['"]?)(.+?)(['"]?\s*\))/gi, function (match, prefix, url, suffix) {
            // Skip paths not starting with / or data blocks
            if (!/^[h\/]/i.test(url)) {
                return prefix + url + suffix;
            }

            logger.debug("  CSS link:", url);

            var url = mergeUrl(refUrl, url);
            var saveAs = urlToPath(url, options.outputDir, "css");
            var newUrl = htmlRef(refPath, saveAs);
            logger.debug("  URL link:", url);
            logger.debug("   Save as:", saveAs);
            logger.debug("Local link:", newUrl);
            logger.debug("   In path:", refPath);

            return prefix + newUrl + suffix;
        });
    }

    function htmlRef(inPath, saveAs) {
        // Remove options.outputDir as HTML refs should be relative to outputDir
        inPath = inPath.replace((/^.+?\//), "");
        saveAs = saveAs.replace((/^.+?\//), "");

        var ref = saveAs;
        var saveAsLevel = inPath.split("/").length - 1;   // #dirs to root
        for (var ii = 0; ii < saveAsLevel; ii += 1) {
            ref = "../" + ref;
        }

        return ref;
    }

    function addLazyLoadStep(scrollHeight) {
        var wait = true;

        queue.push({
            desc: "Scroll down",
            fn: function (options) {
                var bodyHeight = page.evaluate(function (options) {
                    return document.body.getAttribute("scrollHeight");
                }, options);

                // Lazily load all content by controlling the page scroll position
                if (scrollHeight === bodyHeight) {
                    // Height did not change; scroll back up for visual feedback
                    page.sendEvent("keypress", page.event.key.Home);
                } else {
                    // Lazily load all content by controlling the page scroll position
                    page.sendEvent("keypress", page.event.key.End);

                    // When this step is executed, it's at the top of the
                    // queue, so any additional steps can be added via push
                    addLazyLoadStep(bodyHeight);
                }

                return { result: true };
            },
            waitFn: function (options) {
                var result = false;

                if (wait) {
                    wait = false;

                    // Wait until additional content, if any, is added
                    // TODO: wait for something specific rather than a fixed duration
                    setTimeout(function () {
                        result = true;
                    }, 4000);
                }

                return result;
            },
            timeoutFn: function (options) {
                // Should never get here
                return { result: false, msg: "Something went wrong waiting for a fixed duration (please create an issue)" };
            }
        });

        logger.debug("Add lazy load steps");
        logQueueContents();
    }

    function addSavePageSteps(url, options) {
        // Since arguments are used later in time, tie them to this step via a closure
        (function (pageUrl) {
            // Add in reverse order
            queue.push({
                desc: "Save " + pageUrl,
                pending: pageUrl,   // Add reference to URL so it can be found later
                fn: function (options) {
                    // onResourceReceived also saves HTML (even though we don't ask for it), so make sure to overwrite anything that's there already
                    var path = urlToPath(pageUrl, options.outputDir, "html");

                    logger.debug("    Save page:", path);
                    saveFile(path, processHtml(page.content, path, options));

                    return { result: true };
                }
            });

            // TODO: does lazy load call onContentReceived for the main HTML page again too? If not, need to explicitly save it.
            if (options.lazy_load_on_paths) {
                queue.push({
                    desc: "Load all content on page",
                    fn: function (options) {
                        var onContentPage = false
                        options.content_to_save.forEach(function (item) {
                            if (item.indexOf("regex:") === 0) {
                                var regex = item.substring("regex:".length);
                                regex = new RegExp(regex, "i");
                                if (regex.test(pageUrl)) {
                                    onContentPage = true;
                                }
                            } else {
                                if (item === pageUrl) {
                                    onContentPage = true;
                                }
                            }
                        });

                        // TODO: set to false if uri.path is in content_to_exclude?
                        //       (no because excluded pages will never reach get_page?)

                        if (onContentPage) {
                            var bodyHeight = page.evaluate(function (options) {
                                return document.body.getAttribute("scrollHeight");
                            }, options);

                            // When this step is executed, it's at the top of the
                            // queue, so any additional steps can be added via push
                            addLazyLoadStep(bodyHeight);
                        }

                        return { result: true };
                    }
                });
            }

            if (options.click_if_present_on_paths_selector) {
                var wait = true;

                queue.push({
                    desc: "Close any dialog box, if present",
                    fn: function (options) {
                        page.evaluate(function (options) {
                            var elt = document.querySelector(options.click_if_present_on_paths_selector);
                            if (elt) {
                                elt.click();
                            }
                        }, options);

                        return { result: true };
                    },
                    waitFn: function (options) {
                        var result = false;

                        if (wait) {
                            wait = false;

                            // TODO: wait for something specific rather than a fixed duration
                            setTimeout(function () {
                                result = true;
                            }, 2000);
                        }

                        return result;
                    },
                    timeoutFn: function (options) {
                        // Should never get here
                        return { result: false, msg: "Something went wrong waiting for a fixed duration (please create an issue)" };
                    }
                });
            }

            addLoadPageSteps(pageUrl);

            if (!completedPreSavePageSetup) {
                addPreSavePageSetupSteps();
            }

            // Serialize queue in case there's an error and save needs to resume
            queue.push({
                desc: "Save restore point",
                fn: function (options) {
                    // Find URLs left to save
                    var urls = [];
                    queue.forEach(function (item) {
                        if (item.pending) {
                            urls.push(item.pending);
                        }
                    });
                    logger.info("Pages left: " + urls.length);

                    var filename = options.outputDir + fs.separator + resumeFilename;
                    fs.write(filename, JSON.stringify(urls));

                    return { result: true };
                }
            });

            logger.debug("Add save page steps");
            logQueueContents();
        })(url);
    }

    function addSaveSiteSteps(url, options) {
        addSavePageSteps(url, options);
        captureAllPagesInSite = true;
    }

    function addSaveCurrentPageAsIndexSteps() {
        queue.push({
            desc: "Save current page as index",
            descFn: function () {
                return "Save " + page.url + " as index";
            },
            fn: function (options) {
                var path = options.outputDir;
                if (path.charAt(path.length - 1) !== "/") {
                    path += "/";
                }
                path += "index.html";

                logger.debug("    Save page:", path);
                saveFile(path, processHtml(page.content, path, options));

                return { result: true };
            }
        });

        logger.debug("Add save current page as index steps");
        logQueueContents();
    }

    function addCorrectUrlArgumentSteps(options) {
        addLoadPageSteps(options.url, "unshift");

        queue.unshift({
            desc: "Correct URL option value if needed",
            fn: function (options) {
                if (page.url === options.url) {
                    logger.info("No correction needed");
                } else {
                    logger.info("Correct", options.url, "to", page.url);
                    options.url = page.url;
                }

                return { result: true };
            }
        });

        logger.debug("Add correct URL option value steps");
        logQueueContents();
    }

    function addLoadPageSteps(url, method, desc) {
        method = method || "push";
        desc = desc || url;
        var firstTime = true;

        // Since arguments are used later in time, tie them to this step via a closure
        (function (pageUrl, method, desc) {
            queue[method]({
                desc: "Load " + desc,
                fn: function (options) {
                    // (Re-)load page if this is the first time here; onResourceReceived was not in effect before now
                    if (pageUrl === page.url && !firstTime) {
                        logger.info("Already loaded", pageUrl);
                        return { result: true };
                    } else {
                        firstTime = false;
                        page.open(pageUrl);

                        // To avoid rate limiting, delay fetching next page.
                        return { result: true, delay: NEXT_PAGE_DELAY };
                    }
                }
            });
        })(url, method, desc);
    }

    function addIntermediateStep(description, callbackFn, callbackArgs) {
        // Since arguments are used later in time, tie them to this step via a closure
        (function (desc, fn, args) {
            queue.unshift({
                desc: desc,
                fn: function (options, logger) {
                    var errorMsg = args ? fn.apply(this, args) : fn(options);
                    return { result: !errorMsg, msg: errorMsg };
                }
            });

            logger.debug("Add intermediate step");
            logQueueContents();
        })(description, callbackFn, callbackArgs);
    }

    function addLastStep(callbackFn) {
        logger.debug("Add last step");
        finalStepCallbackFn = callbackFn;
    }

    function start(options) {
        var currentStep;
        var stepDelay = 100;
        var waitDelay = 250;
        var maxWaitTime = 7500;
        var waitInProgress = false;
        var waitStartTime;

        captureStart(options);

        function doStep() {
            if (!waitInProgress && !loadInProgress && queue.length === 0) {
                logger.debug("DONE");
                captureFinish(options);
            }
            if (waitInProgress) {
                // Check if wait condition is satisfied
                var expired = (new Date()).getTime() - waitStartTime > maxWaitTime;
                if (expired || currentStep.waitFn(options, logger)) {
                    waitInProgress = false;
                    waitStartTime = undefined;
                    currentStep.waitFn = undefined;   // Don't wait again

                    if (expired) {
                        currentStep.fn = currentStep.timeoutFn;
                        logger.debug("Wait time expired");
                    } else {
                        logger.debug("Wait condition satisfied");
                    }

                    // Process step again, now with real fn or timeout fn
                    queue.push(currentStep);

                    logger.debug("Process step again");
                    logQueueContents();
                } else {
                    logger.debug("WAIT MORE");
                }
                setTimeout(doStep, waitDelay);
            } else if (!loadInProgress) {
                currentStep = queue.pop();
                var desc = currentStep.descFn ? currentStep.descFn() : currentStep.desc;
                logger.debug("* Current step:", desc + "...");
                if (currentStep.waitFn) {
                    logger.debug("WAIT");
                    waitInProgress = true;
                    waitStartTime = (new Date()).getTime();
                    setTimeout(doStep, waitDelay);
                } else {
                    var result = currentStep.fn(options, logger);
                    if (result.result) {
                        // Don't take shortcut and skip delay if queue.length == 0
                        // as page.open may end up adding new items to queue
                        // In fact, add extra delay for last page load.
                        if (queue.length === 0) {
                            result.delay = maxWaitTime;
                        }
                        setTimeout(doStep, result.delay | stepDelay);
                    } else {
                        logger.debug("FAIL");
                        logger.error(result.msg);
                        logger.debug("A screen shot was saved as \"failed.png\"");
                        page.render("failed.png");
                        captureFinish(options, true);
                    }
                }
            } else {
                // Sleep
                setTimeout(doStep, stepDelay);
            }
        }

        // Cannot use setInterval as the timeout delay varies
        setTimeout(doStep, stepDelay);
    }

    function captureStart(options) {
        startTime = new Date();
        logger.debug("Start: " + startTime.toLocaleString());
    }

    function captureFinish(options, hideDone) {
        var endTime = new Date();
        var elapsed = (endTime.getTime() - startTime.getTime()) / 1000;
        logger.debug("End: " + endTime.toLocaleString());
        logger.info("Elapsed: " + Math.floor(elapsed / 60) + "m" + Math.round(elapsed - Math.floor(elapsed / 60) * 60) + "s");

        if (!hideDone) {
            logger.debug("Removing resume file");
            var filename = options.outputDir + fs.separator + resumeFilename;
            fs.remove(filename);
            logger.info("Done!");
        }

        finalStepCallbackFn(!hideDone);
    }

    module.exports = {
        addCorrectUrlArgumentSteps: addCorrectUrlArgumentSteps,
        addIntermediateStep: addIntermediateStep,
        addLastStep: addLastStep,
        addLoginSteps: addLoginSteps,
        addLogoutSteps: addLogoutSteps,
        addSaveCurrentPageAsIndexSteps: addSaveCurrentPageAsIndexSteps,
        addSavePageSteps: addSavePageSteps,
        addSaveSiteSteps: addSaveSiteSteps,
        init: init,
        resume: resume,
        start: start
    };
}());
