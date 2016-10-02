/*jslint node: true */
(function () {
    "use strict";

    var fs = require("fs");
    var logger = require('./logger');
    var page = require('webpage').create();

    // Number of seconds to wait before fetching next page
    var NEXT_PAGE_DELAY = 2000;

    var captureAllPagesInSite = false;
    var completedPreSavePageSetup = false;
    var finalStepCallbackFn = function () {};   // No-op by default
    var loadInProgress = false;
    var resumeFilename;
    var startTime;
    var queue = [];

    function init(options, theResumeFilename) {
        logger.init(options);
        initPage(page, options);
        resumeFilename = theResumeFilename;
    }

    function initPage(page, options) {
        var res = options.viewportSize.split("x");
        page.viewportSize = { width: res[0], height: res[1] };

        if (options.userAgent) {
            page.settings.userAgent = options.userAgent;
        }

        page.onConsoleMessage = function(msg) {
            // Hide messages from web sites that will be visited
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

    function urlToPath(url, prefix, ext) {
        ext = ext || "html";

        var result = url;
        var qs;
        logger.debug('urlToPath', url);

        // Split hostname and path
        var hostname, path;
        if (/.+:\/\/(.*?)(\/.*)/.test(url)) {
            hostname = RegExp.$1;
            path = RegExp.$2;
        } else if (/.+:\/\/(.*)/.test(url)) {
            hostname = RegExp.$1;
            path = "/";
        } else {
            throw "Not a URL? " + url;
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
            path = '/' + path;
        }

        path = prefix + path;
        if (path.charAt(path.length - 1) == "/") {
            path += "index." + ext;
        }

        // Avoid file names getting too long; usually systems have 255 chars max
        var frags = path.split("/");
        for (var ii = 0; ii < frags.length; ii += 1) {
            if (frags[ii].length > 255) {
                frags[ii] = frags[ii].substring(0, 255);
            }
        }
        path = frags.join("/");

        logger.debug(path);
        return path.replace(/\//g, fs.separator);   // Make it a local path.
    }

    function saveFile(path, data) {
        logger.debug('Saving ' + path + '...');
        // path looks like "./some/dirs/deep/file.ext", so skip 1st dir and file.
        var dirs = path.split('/');
        dirs.pop();
        fs.makeTree(dirs.join('/'));
        fs.write(path, data, 'wb');
    /*
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
        logger.debug("Queue:");
        queue.forEach(function (step) {
            logger.debug("-", step.desc);
        });
    };

    function addLoginSteps() {
        queue.unshift({
            desc: 'Load login page',
            fn: function (options) {
                page.open(options.login_page);

                return { result: true };
            }
        });

        queue.unshift({
            desc: 'Ensure login fields can be found',
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

                var msg = '';
                if (!elts.formElt) {
                    msg += 'Could not find login form elt "' + options.login_form_selector + '"\n';
                }
                if (!elts.nameElt) {
                    msg += 'Could not find login form username elt "' + options.login_form_username_field_name + '"\n';
                }
                if (!elts.pwdElt) {
                    msg += 'Could not find login form password elt "' + options.login_form_password_field_name + '"\n';
                }
                if (!elts.btnElt) {
                    msg += 'Could not find login form submit button elt "' + options.login_form_submit_button_selector + '"\n';
                }

                return { result: !msg, msg: msg };
            }
        });

        queue.unshift({
            desc: 'Fill out login fields',
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
            desc: 'Ensure login fields are filled out',
            fn: function (options) {
                var result = page.evaluate(function(options) {
                    var formElt = document.querySelector(options.login_form_selector);
                    var nameElt = formElt.elements[options.login_form_username_field_name];
                    var pwdElt = formElt.elements[options.login_form_password_field_name];

                    var msg = '';
                    if (nameElt.value != options.username) {
                        msg += 'Username field not filled out\n';
                    }
                    if (pwdElt.value != options.password) {
                        msg += 'Password field not filled out\n';
                    }

                    return { result: !msg, msg: msg };
                }, options);

                return result;
            }
        });

        queue.unshift({
            desc: 'Ensure login button enabled',
            fn: function (options) {
                var disabled = page.evaluate(function (options) {
                    var btnElt = document.querySelector(options.login_form_submit_button_selector);
                    return btnElt.hasAttribute('disabled');
                }, options);

                return { result: !disabled, msg: disabled ? 'Login button not enabled after entering credentials' : '' };
            }
        });

        queue.unshift({
            desc: 'Submit login',
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
            desc: 'Check login result',
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

                logger.debug('Error markup: ' + errorHtml +  ', success markup: ' + successHtml);

                return { result: false, msg: 'Could not determine login success or failure (markup may have changed or a longer delay is needed before evaluating this step)' };
            }
        });

        queue.unshift({
            desc: 'Ensure home page link can be found',
            fn: function (options) {
                var exists = page.evaluate(function (options) {
                    var linkElt = document.querySelector(options.homepage_link_selector);
                    return !!linkElt;
                }, options);

                return { result: exists, msg: exists ? '' : 'Could not find home page elt ' + options.homepage_link_selector };
            }
        });

        queue.unshift({
            desc: 'Navigate to home page',
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
            desc: 'Extract username and apply to options',
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
                            options.content_to_save[ii] = options.content_to_save[ii].replace(/{{username}}/, userId);
                            var hp = options.home_page;
                            if (/{{home_page}}\//.test(options.content_to_save[ii]) && hp.lastIndexOf("/") === hp.length - 1) {
                                hp = hp.substring(0, hp.length - 1);
                            }
                            options.content_to_save[ii] = options.content_to_save[ii].replace(/{{home_page}}/, hp);
                        }
                    }
                    logger.debug("Content pages to save: " + options.content_to_save.join(", "));

                    if (options.content_to_exclude) {
                        for (var ii = 0; ii < options.content_to_exclude.length; ii += 1) {
                            options.content_to_exclude[ii] = options.content_to_exclude[ii].replace(/{{username}}/, userId);
                            var hp = options.home_page;
                            if (/{{home_page}}\//.test(options.content_to_exclude[ii]) && hp.lastIndexOf("/") === hp.length - 1) {
                                hp = hp.substring(0, hp.length - 1);
                            }
                            options.content_to_exclude[ii] = options.content_to_exclude[ii].replace(/{{home_page}}/, hp);
                        }
                    }
                    logger.debug("Content pages to exclude: " + options.content_to_exclude.join(", "));

                    if (options.content_to_save_only_if_linked_from_other_content) {
                        for (var ii = 0; ii < options.content_to_save_only_if_linked_from_other_content.length; ii += 1) {
                            options.content_to_save_only_if_linked_from_other_content[ii] = options.content_to_save_only_if_linked_from_other_content[ii].replace(/{{username}}/, userId);
                            var hp = options.home_page;
                            if (/{{home_page}}\//.test(options.content_to_save_only_if_linked_from_other_content[ii]) && hp.lastIndexOf("/") === hp.length - 1) {
                                hp = hp.substring(0, hp.length - 1);
                            }
                            options.content_to_save_only_if_linked_from_other_content[ii] = options.content_to_save_only_if_linked_from_other_content[ii].replace(/{{home_page}}/, hp);
                        }
                    }
                    logger.debug("Special linked content to save: " + options.content_to_save_only_if_linked_from_other_content.join(", "));
                }

                return { result: !!userId, msg: userId ? '' : 'Could not extract username ' + options.username_in_homepage_url_regex };
            }
        });

        logger.debug("Add login steps");
        logQueueContents();
    }

    function addLogoutSteps() {
        queue.unshift({
            desc: 'Pre-logout page setup',
            fn: function (options) {
                page.captureContent = [];
                page.onResourceReceived = function () {};

                return { result: true };
            }
        });

        queue.unshift({
            desc: 'Ensure logout link can be found',
            fn: function (options) {
                var exists = page.evaluate(function (options) {
                    var linkElt = document.querySelector(options.logout_link_selector);
                    return !!linkElt;
                }, options);

                return { result: exists, msg: exists ? '' : 'Could not find logout elt ' + options.logout_link_selector };
            }
        });

        queue.unshift({
            desc: 'Log out',
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
            desc: 'Pre-save page setup',
            fn: function (options) {
                page.captureContent = [ /css/, /font/, /image/ ];
                page.onResourceReceived = function (response) {
                    //logger.debug('Response (#' + response.id + ', stage "' + response.stage + '"): ' + JSON.stringify(response));
                    if (response.stage === 'end' && response.status < 300 && response.body.length > 0) {
                        var body = response.body;
                        delete response.body;   // So it won't be outputted in the logger.debug below
                        saveFile(urlToPath(response.url, options.outputDir), body);
                        logger.debug('Resource received:', response.url, JSON.stringify(response));
                        if (captureAllPagesInSite) {
                            addReferencedPages(body);
                        }
                    }
                };

                return { result: true };
            }
        });

        logger.debug("Add Pre-save page setup steps");
        logQueueContents();
    }

    function addReferencedPages(body) {
        // TODO
        /*
        @page_uri = uri
        @home_uri = uri if @home_uri.nil?   # If just a single page is retrieved.

        path = urlToPath @page_uri, @options.output_dir

        @logger.log '='*75
        @logger.log "Save page: #{@page_uri}"
        @logger.log "       As: #{path}"
        @logger.log '='*75

        begin
          page = get_page uri_to_get_instead.nil? ? @page_uri : uri_to_get_instead
          process_content page, path

          # Change links to pages that will be saved to local copies and find
          # more pages to save.
          if !@options.has_url?
            page.search('a[href]').each do |item|
              orig_href = item['href']

              # Skip empty URLs.
              next if orig_href == ""

              # Don't break on invalid URLs, e.g. "http://ex*mple.com".
              begin
                orig_uri = @page_uri.merge orig_href
              rescue
                @logger.log "Skipping invalid href value: #{orig_href}"
                next;
              end

              # If this href will not be saved, no need to process it either.
              is_exclude_page = false
              @options.content_to_exclude.each do |item2|
                if item2.start_with? 'regex:'
                  regex = item2['regex:'.length..-1]
                  is_exclude_page = true if orig_uri.to_s[/#{regex}/i]
                else
                  content_uri = @home_uri.merge item2
                  # TODO: this merge happens a lot, store URIs in content_to* arrs?
                  is_exclude_page = true if orig_uri == content_uri
                end
              end
              next if is_exclude_page

              onContentPage = false

              @options.content_to_save.each do |item2|
                if item2.start_with? 'regex:'
                  regex = item2['regex:'.length..-1]
                  onContentPage = true if @page_uri.to_s[/#{regex}/i]
                  match = orig_uri.to_s[/#{regex}/]
                else
                  content_uri = @home_uri.merge item2
                  onContentPage = true if @page_uri == content_uri
                  match = orig_uri == content_uri
                end

                if match
                  save_as = urlToPath orig_uri, @options.output_dir
                  item['href'] = html_ref path, save_as

                  # Items that are not regex'es were already added to page_queue
                  # by Main, so only regex'es need to be inspected here.
                  if item2.start_with?('regex:') &&   # Is a regex.
                      @page_uri != orig_uri &&   # Not currently being processed.
                      !File.exists?(save_as) &&   # Not already saved.
                      !page_queue.include?(orig_uri)   # Not already queued.
                    @logger.log "Adding page: #{orig_href}"
                    @logger.log "        URI: #{orig_uri}"
                    @logger.log "         As: #{save_as}"
                    @logger.log "       HTML: #{item['href']}"
                    @logger.log "   (In path: #{path})"

                    page_queue.push orig_uri
                  end
                end
              end

              # Only process if special linkage option is defined.
              next if !@options.has_content_to_save_only_if_linked_from_other_content?

              # Only process if it's a reference off of an included page.
              next if !onContentPage

              @options.content_to_save_only_if_linked_from_other_content.each do |item2|
                if item2.start_with? 'regex:'
                  regex = item2['regex:'.length..-1]
                  match = orig_uri.to_s[/#{regex}/]
                else
                  content_uri = @home_uri.merge item2
                  match = orig_uri == content_uri
                end

                if match
                  save_as = urlToPath orig_uri, @options.output_dir
                  item['href'] = html_ref path, save_as

                  # No pages or regex'es of this list option has been added yet,
                  # so unlike above, don't inspect just regex'es here.
                  if @page_uri != orig_uri &&   # Not currently being processed.
                      !File.exists?(save_as) &&   # Not already saved.
                      !page_queue.include?(orig_uri)   # Not already queued.
                    @logger.log "Adding page: #{orig_href}"
                    @logger.log "        URI: #{orig_uri}"
                    @logger.log "         As: #{save_as}"
                    @logger.log "       HTML: #{item['href']}"
                    @logger.log "   (In path: #{path})"

                    page_queue.push orig_uri
                  end
                end
              end
            end
          end

          # Avoid HTML entities in certain tags.
          # TODO: how to configure Nokogiri so this is not needed?
          #       (config.noent does not accomplish this)
          tags = [ 'noscript', 'script', 'style' ]
          page.traverse do |node|
            if tags.include? node.name
              node.content = CGI.unescapeHTML node.content
            end
          end

          FileUtils.mkpath File.dirname(path) if !Dir.exists? File.dirname(path)
          File.open(path, 'w') { |f| page.write_html_to f }

          # Save page resources.
          @logger.log "Saving #{@hydra.queued_requests.length} page resources..."
          @hydra.run
          @logger.log 'Done saving page resources.'
          true
        rescue Exception => error   # TODO: something more specific?
          puts "Error saving #{@page_uri}. Will retry later."
          puts error.message if @options.verbose
          puts error.backtrace if @options.verbose
          false
        end
        */

        /*
        def process_content(page, path)
          # Process in-page style blocks.
          page.search('style').each do |item|
            item.content = process_css item.content, @page_uri, path
          end

          # Process inline styles.
          page.search('[style]').each do |item|
            item['style'] = process_css item['style'], @page_uri, path
          end

          page.search('link[href], img[src], script[src], iframe[src]').each do |item|
            begin
              url = item['src'] || item['href']
              url = CGI.unescapeHTML url   # Undo Nokogiri's HTML entitification.
                                           # TODO: how to configure Nokogiri?
              ref_uri = @page_uri.merge url

              @logger.log "Save content: #{url}"
              @logger.log "         URI: #{ref_uri}"

              new_ref = save_resource ref_uri, path, item['rel'] == 'styleseet' ? 'css' : 'html'   # TODO: ext could also be js!
              @logger.log "        HTML: #{new_ref}"
              @logger.log "    (In path: #{path})"

              # Change reference to resource in page.
              item['src'] ? item['src'] = new_ref : item['href'] = new_ref
            rescue Exception => error   # TODO: something more specific?
              puts "An error occured. Skipping #{ref_uri}"
              puts error.message if @options.verbose
              puts error.backtrace if @options.verbose
            end
          end
        end

        def process_css(content, ref_uri, ref_path)
          matches = content.scan /url\s*\(\s*['"]?(.+?)['"]?\s*\)/i
          matches.map! { |m| m = m[0] }
          matches.uniq.each do |m|
            next if !m[/^[h\/]/i]   # Skip paths not starting with / or data blocks.

            begin
              uri = ref_uri.merge m
              @logger.log "Save CSS ref: #{m}"
              @logger.log "         URI: #{uri}"

              new_ref = save_resource uri, ref_path, 'css'
              @logger.log "        HTML: #{new_ref}"
              @logger.log "    (In path: #{ref_path})"

              content.gsub! m, new_ref
            rescue Exception => error   # TODO: something more specific?
              puts "An error occured. Skipping #{uri}"
              puts error.message if @logger.verbose?
              puts error.backtrace if @logger.verbose?
            end
          end

          content
        end
        */

        /*
        def save_resource(ref_uri, in_path, ext='html')
          save_as = local_path ref_uri, @options.output_dir, ext
          new_ref = html_ref in_path, save_as

          # Don't save pages as resources.
          is_content_page = false
          if @options.has_content_to_save?
            @options.content_to_save.each do |item|
              if item.start_with? 'regex:'
                regex = item['regex:'.length..-1]
                is_content_page = true if ref_uri.to_s[/#{regex}/i]
              else
                content_uri = @home_uri.merge item
                is_content_page = true if ref_uri == content_uri
              end
            end
          end
          if @options.has_content_to_save_only_if_linked_from_other_content?
            @options.content_to_save_only_if_linked_from_other_content.each do |item|
              if item.start_with? 'regex:'
                regex = item['regex:'.length..-1]
                is_content_page = true if ref_uri.to_s[/#{regex}/i]
              else
                content_uri = @home_uri.merge item
                is_content_page = true if ref_uri == content_uri
              end
            end
          end

          if is_content_page || File.exists?(save_as)   # TODO: use in-memory cache?
            @logger.log "        Skip: #{save_as}"
          else
            @logger.log "          As: #{save_as}"

            process_resource ref_uri, save_as
          end

          new_ref
        end

        def process_resource(uri, save_as)
          request = Typhoeus::Request.new(uri.to_s, followlocation: true)

          request.on_complete do |response|
            begin
              dirname = File.dirname save_as
              FileUtils.mkpath dirname if !Dir.exists? dirname
              File.open(save_as, 'wb') do |f|
                content = response.body

                # TODO: any other extensions? Check something else instead?
                if uri.path.end_with? ".css"
                  ref_path = local_path uri, @options.output_dir, 'css'
                  content = process_css content, uri, ref_path
                end

                f.write content
                @logger.log "Wrote: #{save_as}"
              end
            rescue Exception => error   # TODO: something more specific?
              puts "An error occured writing #{save_as}. Skipping."
              puts error.message if @logger.verbose?
              puts error.backtrace if @logger.verbose?
            end
          end

          @hydra.queue request
        end

        def level_prefix(level)
          result = ''

          first = true
          level.times do
            if first
              result = '.' + result
              first = false
            else
              result = '../' + result
            end
          end

          result
        end

        def html_ref(in_path, save_as)
          save_as_level = in_path.split('/').length - 1   # #dirs to root
          ref = level_prefix(save_as_level)[0..-2] + save_as   # Remove trailing '.'
          ref = '../' + ref
        end

        */
    }

    function addLazyLoadStep(scrollHeight) {
        var wait = true;

        queue.push({
            desc: "Scroll down",
            fn: function (options) {
                var bodyHeight = page.evaluate(function (options) {
                    return document.body.getAttribute("scrollHeight");
                }, options);

                // Lazily load all content by controlling the page scroll position.
                if (scrollHeight === bodyHeight) {
                    // Height did not change; scroll back up for visual feedback
                    page.sendEvent('keypress', page.event.key.Home);
                } else {
                    // Lazily load all content by controlling the page scroll position.
                    page.sendEvent('keypress', page.event.key.End);

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
                return { result: false, msg: 'Something went wrong waiting for a fixed duration (please create an issue)' };
            }
        });

        logger.debug("Add lazy load steps");
        logQueueContents();
    }

    function addSavePageSteps(url, options) {
        // Add in reverse order

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
                            if (regex.test(page.url)) {
                                onContentPage = true;
                            }
                        } else {
                            if (item === page.url) {
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
                    return { result: false, msg: 'Something went wrong waiting for a fixed duration (please create an issue)' };
                }
            });
        }

        queue.push({
            desc: "Retrieving " + url,
            fn: function (options) {
                page.open(url);

                // To avoid rate limiting, delay fetching next page.
                return { result: true, delay: NEXT_PAGE_DELAY };
            }
        });

        if (!completedPreSavePageSetup) {
            addPreSavePageSetupSteps();
        }

        queue.push({
            desc: "Save restore point",
            fn: function (options) {
                logger.log("Pages left: " + queue.length);

                // TODO: this is not right; it ends up storing:
                // [{"desc":"Log out"},{"desc":"Ensure logout link can be found"},{"desc":"Pre-logout page setup"},{"desc":"Load all content on page"},{"desc":"Close any dialog box, if present"},{"desc":"Retrieving https://www.pinterest.com/proftest/settings/"},{"desc":"Pre-save page setup"}]
                // Serialize queue in case there's an error and save needs to resume.
                var filename = options.outputDir + fs.separator + resumeFilename;
                fs.write(filename, JSON.stringify(queue));

                return { result: true };
            }
        });

        logger.debug("Add save page steps");
        logQueueContents();
    }

    function addSaveSiteSteps(url, options) {
        addSavePageSteps(url, options);
        captureAllPagesInSite = true;
    }

    function addSaveCurrentPageAsIndexSteps() {
        queue.push({
            desc: "Save extra copy for convenience: " + page.url,
            fn: function (options) {
                // TODO: correct paths to hopefully already captured resources
                if (!fs.exists(options.outputDir + "/index.html")) {
                    saveFile(options.outputDir + "/index.html", page.content);
                }

                return { result: true };
            }
        });

        logger.debug("Add save current page as index steps");
        logQueueContents();
    }

    function addIntermediateStep(description, callbackFn, callbackArgs) {
        // Since arguments are used later in time, tie them to this step via a closure
        // TODO: closure needed?
        (function (desc, fn, args) {
            queue.unshift({
                desc: desc,
                fn: function (options, logger) {
                    var result = args ? fn.apply(this, args) : fn(options);
                    return { result: result !== false, msg: desc + " failed" };
                }
            });

            logger.debug("Add intermediate step");
            logQueueContents();
        })(description, callbackFn, callbackArgs);
    }

    function addLastStep(callbackFn) {
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
                logger.debug('DONE');
                captureFinish();
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
                logger.debug("Current step:", currentStep.desc + "...");
                if (currentStep.waitFn) {
                    logger.debug('WAIT');
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
                        logger.debug('FAIL');
                        logger.error(result.msg);
                        logger.debug('A screen shot was saved as "failed.png"');
                        page.render('failed.png');
                        captureFinish(true);
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
        logger.log("Saving content to \"" + options.outputDir + "\"");
    }

    function captureFinish(hideDone) {
        var endTime = new Date();
        var elapsed = (endTime.getTime() - startTime.getTime()) / 1000;
        logger.debug("End: " + endTime.toLocaleString());
        logger.log("Elapsed: " + Math.floor(elapsed / 60) + "m" + Math.round(elapsed - Math.floor(elapsed / 60) * 60) + "s");

        if (!hideDone) {
            fs.remove(outputDir + fs.separator + resumeFilename);
            logger.log("Done!");
        }

        finalStepCallbackFn(!hideDone);
    }

    module.exports = {
        addIntermediateStep: addIntermediateStep,
        addLastStep: addLastStep,
        addLoginSteps: addLoginSteps,
        addLogoutSteps: addLogoutSteps,
        addSaveCurrentPageAsIndexSteps: addSaveCurrentPageAsIndexSteps,
        addSavePageSteps: addSavePageSteps,
        addSaveSiteSteps: addSaveSiteSteps,
        init: init,
        start: start
    };
}());