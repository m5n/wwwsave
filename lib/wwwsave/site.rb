require 'cgi'         # for unescaping HTML entities
require 'fileutils'   # for creating an entire dir path in one go
require 'nokogiri'    # for parsing HTML documents
require 'typhoeus'    # for downloading page resources
require 'watir'       # for automating possibly JavaScript-driven login

require 'wwwsave/errors'

module WWWSave
  # Interface to the site to be saved, encapsulating Typhoeus and Watir.
  class Site
    attr_reader :home_uri

    def initialize(options, logger)
      @options = options
      @logger = logger

      @browser = Watir::Browser.new
      @browser.window.maximize

      # A browser usually has 8 connections per domain, but the browser still
      # gets stuck once in a while with that number. Use something lower.
      @hydra = Typhoeus::Hydra.new(max_concurrency: 6)
    end

    def login
      @logger.log 'Logging in'

      begin
        @browser.goto @options.login_page
        current_url = @browser.url

        form = @browser.element :css => @options.login_form_selector

        form.text_field(
          :name => @options.login_form_username_field_name
        ).when_present.set @options.username

        form.text_field(
          :name => @options.login_form_password_field_name
        ).when_present.set @options.password

        form.element(
          :css => @options.login_form_submit_button_selector
        ).when_present.click

        Watir::Wait.until do
          @browser.elements(
            :css => @options.login_error_text_selector
          ).length > 0 ||
              @browser.elements(
                :css => @options.login_success_element_selector
              ).length > 0
        end

        err_elts = @browser.elements :css => @options.login_error_text_selector
        if err_elts.length > 0
          err_text = err_elts[0].text

          @logger.log 'Login error'
          cleanup
          # TODO: capture_finish false
          abort err_text
        end
      rescue Watir::Wait::TimeoutError => error
        raise LoginError.new(error), 'Unable to log in'
      rescue Selenium::WebDriver::Error => error
        # Same code as above; refactor!
        raise LoginError.new(error), 'Unable to log in'
      end

      @logger.log 'Login success'

      # Now that there's a page to work with, incorporate the username details.
      init_username
    end

    def logout
      # TODO: log out
    end

    def init_username
      @username = @options.username
      if @options.has_actual_username_regex?
        # Capture user ID (in case login username != logged-in username).
        @browser.html[/#{@options.actual_username_regex}/]
        @username = $1
      end
      @logger.log "Username: #{@username}"

      home_page = @options.home_page.sub '{{username}}', @username
      @logger.log "Home page: #{home_page}"
      @home_uri = URI.parse(@browser.url).merge home_page
      @logger.log "Home uri: #{home_uri}"

      if @options.has_content_to_save?
        @options.content_to_save.each do |item|
          item.sub! '{{username}}', @username
          item.sub! '{{home_page}}', @home_uri.to_s
        end
        @logger.log "Content pages to save: #{@options.content_to_save}"
      end

      if @options.has_content_to_exclude?
        @options.content_to_exclude.each do |item|
          item.sub! '{{username}}', @username
          item.sub! '{{home_page}}', @home_uri.to_s
        end
        @logger.log "Content pages to exclude: #{@options.content_to_exclude}"
      end

      if @options.has_content_to_save_only_if_linked_from_other_content?
        @options.content_to_save_only_if_linked_from_other_content.each do |item|
          item.sub! '{{username}}', @username
          item.sub! '{{home_page}}', @home_uri.to_s
        end
        @logger.log "Special linked content to save: #{@options.content_to_save_only_if_linked_from_other_content}"
      end
    end

    def merge_with_home_uri(arr)
      arr.map { |str| @home_uri.merge str }
    end

    def cleanup
      @browser.close
    end

    # Get, process and save the page at the given URI and put any additional
    # page references found in `page_queue`.
    def save_page(uri, page_queue, uri_to_get_instead=nil)
      @page_uri = uri
      @home_uri = uri if @home_uri.nil?   # If just a single page is retrieved.

      path = local_path @page_uri, @options.output_dir

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

            on_content_page = false

            @options.content_to_save.each do |item2|
              if item2.start_with? 'regex:'
                regex = item2['regex:'.length..-1]
                on_content_page = true if @page_uri.to_s[/#{regex}/i]
                match = orig_uri.to_s[/#{regex}/]
              else
                content_uri = @home_uri.merge item2
                on_content_page = true if @page_uri == content_uri
                match = orig_uri == content_uri
              end

              if match
                save_as = local_path orig_uri, @options.output_dir
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
            next if !on_content_page

            @options.content_to_save_only_if_linked_from_other_content.each do |item2|
              if item2.start_with? 'regex:'
                regex = item2['regex:'.length..-1]
                match = orig_uri.to_s[/#{regex}/]
              else
                content_uri = @home_uri.merge item2
                match = orig_uri == content_uri
              end

              if match
                save_as = local_path orig_uri, @options.output_dir
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
    end

    def get_page(uri)
      @logger.log "Retrieving: #{uri}"
      @browser.goto uri.to_s if @browser.url != uri.to_s
      @logger.log "Landed on: #{@browser.url}"
      @page_uri = URI.parse @browser.url

      if @options.has_click_if_present_on_paths_selector?
        begin
          Watir::Wait.until(2) do
            @browser.element(css: @options.click_if_present_on_paths_selector).exists?
          end
          elt = @browser.element css: @options.click_if_present_on_paths_selector
          elt.click if elt.exists?
        rescue Watir::Wait::TimeoutError => error
          # No such element. Ignore.
        end
      end

      if @options.has_lazy_load_on_paths? && @options.lazy_load_on_paths
        on_content_page = false
        @options.content_to_save.each do |item|
          if item.start_with? 'regex:'
            regex = item['regex:'.length..-1]
            on_content_page = true if uri.to_s[/#{regex}/i]
          else
            content_uri = @home_uri.merge item
            on_content_page = true if uri == content_uri
          end
        end
        # TODO: set to false if uri.path is in content_to_exclude?
        #       (no because excluded pages will never reach get_page?)

        if on_content_page
          scroll_height = 0

          # Lazily load all content by controlling the page scroll position.
          while scroll_height != @browser.body.attribute_value('scrollHeight')
            scroll_height = @browser.body.attribute_value('scrollHeight')

            @browser.send_keys :end

            begin
              # Wait until additional content, if any, is added.
              Watir::Wait.until(4) do
                scroll_height != @browser.body.attribute_value('scrollHeight')
              end
            rescue Watir::Wait::TimeoutError => error
              # Height did not change. The while loop will be exited.
            end
          end

          @browser.send_keys :home
        end
      end

      Nokogiri::HTML @browser.html
    end

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

    def local_path(uri, prefix, ext='html')
      clone = URI.parse uri.to_s
      clone.scheme = @page_uri.scheme   # Avoid port mismatch due to scheme.
      clone.fragment = nil   # Don't make anchor part of file name.

      if clone.query
        # Since the query string is made part of the file name (see below),
        # make sure there are no directory separators in it.
        clone.query = clone.query.gsub('/', '_S_')
      end

      if "#{clone.host}:#{clone.port}" == "#{@home_uri.host}:#{@home_uri.port}"
        clone.scheme = clone.host = clone.port = nil
        path = clone.to_s
        path = '/' if path.empty?
      else
        clone.scheme = nil
        path = clone.to_s[1..-1]   # Avoid path starting with "//".
      end

      # Some sites use dynamic concatenation of files by requesting them via
      # the query string, e.g.:
      # http://l-stat.livejournal.net/??lj_base.css,controlstrip-new.css,widgets/calendar.css,widgets/filter-settings.css,popup/popupus.css,popup/popupus-blue.css,lj_base-journal.css,journalpromo/journalpromo_v3.css?v=1417182868
      # So don't chop off the query string, keep it as part of the file name.
      path.gsub! '?', '_Q_'

      # Escaped chars could cause trouble, e.g. %20, which is turned into space.
      path.gsub! '%', '_P_'

      # Make sure there's a '/' between prefix and path.
      path = '/' + path if prefix[-1] != '/' && path[0] != '/'

      path = "#{prefix}#{path}"
      path += "index.#{ext}" if path[-1] == '/'

      # Avoid file names getting too long; usually systems have 255 chars max.
      path.split('/').map { |p| p[0..254] }.join '/'
    end

    def html_ref(in_path, save_as)
      save_as_level = in_path.split('/').length - 1   # #dirs to root
      ref = level_prefix(save_as_level)[0..-2] + save_as   # Remove trailing '.'
      ref = '../' + ref
    end
  end
end
