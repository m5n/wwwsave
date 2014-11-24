require 'cgi'         # for unescaping HTML entities
require 'fileutils'   # for creating an entire dir path in one go
# TODO: obsolete? require 'json'        # for parsing JSON strings
require 'nokogiri'    # for parsing HTML documents
require 'typhoeus'    # for downloading page resources
require 'watir'       # for automating possibly JavaScript-driven login

require 'wwwsave/css_processor'
require 'wwwsave/errors'
require 'wwwsave/page_resource'

module WWWSave
  # Interface to the site to be `wwwsave`d, encapsulating exposure to Typhoeus
  # and Watir.
  class Site
    def initialize(options, logger)
      @options = options
      @logger = logger

      @browser = Watir::Browser.new
      @hydra = Typhoeus::Hydra.new(max_concurrency: 8)   # Simulate a browser's
                                                         # 8 connection limit
                                                         # (ignoring the "per
                                                         # domain" part).
    end

    def login
      @logger.log 'Logging in'

      begin
        @browser.goto @options.login_page
        current_url = @browser.url

        form = @browser.element :css => @options.login_form_selector

        form.text_field(:name => @options.login_form_username_field_name).when_present.set @options.username
        form.text_field(:name => @options.login_form_password_field_name).when_present.set @options.password
        form.element(:css => @options.login_form_submit_button_selector).when_present.click

        Watir::Wait.until { @browser.elements(:css => @options.login_error_text_selector).length > 0 || @browser.elements(:css => @options.login_success_element_selector).length > 0 }

        err_elts = @browser.elements :css => @options.login_error_text_selector
        if err_elts.length > 0
          err_text = err_elts[0].text

          @logger.log 'Login error'
          cleanup
          capture_finish false
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

      @options.paths_to_save_regexes.each do |regex|
        regex.sub! '{{username}}', @username
      end
      @logger.log "Path regexes to save: #{@options.paths_to_save_regexes}"

      home_page_path = @options.home_page_path.sub '{{username}}', @username
      @logger.log "Home path: #{home_page_path}"
      @home_uri = URI.parse(@browser.url).merge home_page_path
      @logger.log "Home page: #{home_uri}"
    end

    def home_uri
      @home_uri
    end

    def cleanup
      @browser.close
    end

    # Get, process and save the page at the given URI and put any additional
    # page references found in `page_queue`.
    def save_page(uri, page_queue)

      @logger.log '='*75
      @logger.log "Save page: #{uri}"

      begin
        # Note that `get_page` also sets @page_uri.
        page = get_page uri
        @logger.log "      URI: #{@page_uri}"

        path = local_path uri, @options.output_dir
        @logger.log "       As: #{path}"
        @logger.log '='*75

        process_content page

        # Change links to local copies and find more pages to save.
        if @options.login_required && !@options.has_url?
          page.search('a[href]').each do |item|
            @options.paths_to_save_regexes.each do |regex|
              if item['href'][/#{regex}/]
                orig_href = item['href']
                orig_uri = @page_uri.merge orig_href
                save_as = local_path orig_uri, @options.output_dir

                # TODO: hack alert: length + 1 and [0..-2]... another way?
                save_as_level = @page_uri.path.split('/').length + 1
                item['href'] = level_prefix(save_as_level)[0..-2] + save_as

                if @page_uri != orig_uri &&   # Not currently being processed.
                    !File.exists?(save_as) &&   # Not already saved.
                    !page_queue.include?(orig_uri)   # Not already queued.
                  @logger.log "Adding page: #{orig_href}"
                  @logger.log "        URI: #{orig_uri}"
                  @logger.log "         As: #{save_as}"
                  @logger.log "       HTML: #{item['href']}"

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
      rescue Exception => error   # TODO: something more specific?
        puts "An error occured. Skipping #{uri}"
        puts error.message if @options.verbose
        puts error.backtrace if @options.verbose
      end

      # Save page resources.
      @logger.log "Saving #{@hydra.queued_requests.length} page resources..."
      @hydra.run
      @logger.log 'Done saving page resources.'
    end

    def get_page(uri)
      puts "Retrieving: #{uri}"
      @browser.goto uri.to_s if @browser.url != uri.to_s

      # Since content references are based on paths in the URL, re-capture it
      # in case a redirection took place.
      @page_uri = URI.parse @browser.url

      # TODO: need more control?
      #Nokogiri::HTML(@browser.html) do |config|
      #  config.noblanks.noent.strict.nonet
      #end
      Nokogiri::HTML @browser.html
    end

    def process_content(page)
      save_as_level = @page_uri.path.split('/').length - 1

      page.search('[style]').each do |item|
        item['style'] = CssProcessor.process(
          item['style'], @page_uri, @page_uri, @options.output_dir, @hydra, @logger, save_as_level
        )
      end

      page.search('link[href], img[src], script[src], iframe[src]').each do |item|
        begin
          url = item['src'] || item['href']
          url = CGI.unescapeHTML url   # Undo Nokogiri's HTML entitification.
                                       # TODO: how to configure Nokogiri?
          ref_uri = @page_uri.merge url

          @logger.log "Save content: #{url}"
          @logger.log "         URI: #{ref_uri}"

          new_ref = save_resource ref_uri, save_as_level
          new_ref = level_prefix(save_as_level) + new_ref
          @logger.log "        HTML: #{new_ref}"

          # Change reference to resource in page.
          item['src'] ? item['src'] = new_ref : item['href'] = new_ref
        rescue Exception => error   # TODO: something more specific?
          puts "An error occured. Skipping #{ref_uri}"
          puts error.message if @options.verbose
          puts error.backtrace if @options.verbose
        end
      end
    end

    def save_resource(ref_uri, save_as_level=0)
      save_as = local_path ref_uri, @options.output_dir
      new_ref = local_path ref_uri, '.'

      # Don't save pages as resources.
      is_page = false
      @options.paths_to_save_regexes.each do |regex|
        is_page = true if ref_uri.path[/#{regex}/]
      end

      if is_page || File.exists?(save_as)   # TODO: use in-memory cache?
        @logger.log "        Skip: #{save_as}"
      else
        @logger.log "          As: #{save_as}"

        resource = WWWSave::PageResource.new(
          @page_uri, ref_uri, save_as, save_as_level, @options.output_dir, @hydra, @logger
        )
        resource.save
      end

      new_ref
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

    def local_path(uri, prefix)
      clone = URI.parse uri.to_s
      clone.scheme = @page_uri.scheme   # Avoid port mismatch due to scheme.

      if "#{clone.host}:#{clone.port}" == "#{@page_uri.host}:#{@page_uri.port}"
        clone.scheme = clone.host = clone.port = nil
        path = clone.to_s
        path = '/' if path.empty?
      else
        clone.scheme = nil
        path = clone.to_s[1..-1]   # Avoid path starting with "//".
      end

      path = "#{prefix}#{path}"
      path += 'index.html' if path[-1] == '/'
      path
    end
  end
end
