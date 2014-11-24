require 'cgi'         # for unescaping HTML entities
require 'fileutils'   # for creating an entire dir path in one go
require 'json'        # for parsing JSON strings
require 'nokogiri'    # for parsing HTML documents
require 'typhoeus'    # for downloading page resources
require 'uri'         # for parsing URLs
require 'watir'       # for automating possibly JavaScript-driven login

require 'wwwsave/css_processor'
require 'wwwsave/errors'
require 'wwwsave/logger'
require 'wwwsave/page_resource'

module WWWSave
  class Scraper
    # Number of seconds to wait before fetching next page.
    NEXT_PAGE_DELAY = 2

    def initialize(options)
      @cmd = $0.split('/').last
      @options = options
      @logger = Logger.new @options.verbose
      @seen_first_page = false

      @logger.log "Options: #{@options}"
    end

    def start
      capture_start
      @browser = Watir::Browser.new
      @hydra = Typhoeus::Hydra.new(max_concurrency: 8)   # Simulate a browser's
                                                         # 8 connection limit
                                                         # (ignoring the "per
                                                         # domain" part).

      # Do login before creating directories as an error could still occur.
      login if @options.login_required

      if @options.has_url?
        # Save single page only.
        @uri = URI.parse @options.url
      else
        @more_pages = []

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
        @logger.log "Paths to save: #{@options.paths_to_save_regexes}"

        home_page_path = @options.home_page_path.sub '{{username}}', @username
        @logger.log "Home path: #{home_page_path}"
        home_uri = URI.parse(@browser.url).merge(home_page_path)
        @logger.log "Home page: #{home_uri}"

        @uri = home_uri
      end

      init_output_dir
      save_page @uri
      # TODO: if @uri is in a subdir, need to create a copy as /index.html

      logout if @options.login_required

      @browser.close
      capture_finish
    end

    def save_page(uri)
      path = local_path uri, @options.output_dir

      @logger.log '='*75
      @logger.log "Save page: #{uri}"
      @logger.log "       As: #{path}"
      @logger.log '='*75

      begin
        # TODO: still need this first_time stuff?
        first_time = !@seen_first_page
        page = get_page uri
        uri = @uri if first_time
        process_content uri, page

        # Change links to local copies and find more pages to save.
        if @options.login_required && !@options.has_url?
          page.search('a[href]').each do |item|
            @options.paths_to_save_regexes.each do |regex|
              if item['href'][/#{regex}/]
                orig_href = item['href']
                orig_uri = uri.merge orig_href
                save_as = local_path orig_uri, @options.output_dir

                # TODO: hack alert: length + 1 and [0..-2]... another way?
                save_as_level = uri.path.split('/').length + 1
                item['href'] = level_prefix(save_as_level)[0..-2] + save_as

                if uri != orig_uri &&   # Not currently processing this page.
                    !File.exists?(save_as) &&   # Not already saved.
                    !@more_pages.include?(orig_uri)   # Not already queued.
                  @logger.log "Adding page: #{orig_href}"
                  @logger.log "        URI: #{orig_uri}"
                  @logger.log "         As: #{save_as}"
                  @logger.log "       HTML: #{item['href']}"

                  @more_pages.push orig_uri
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
     
      # Save the next page, if any.
      if @options.login_required && !@options.has_url?
        @logger.log "#Pages left: #{@more_pages.length}"
        next_uri = @more_pages.shift
        if next_uri
          # Avoid rate limiting.
          sleep NEXT_PAGE_DELAY

          save_page next_uri
        end
      end
    end

    def get_page(uri)
      puts "Retrieving: #{uri}"
      @browser.goto uri.to_s if @browser.url != uri.to_s

      if !@seen_first_page
        @logger.log "Update site URI from \"#{@uri}\" to \"#{@browser.url}\""
        @uri = URI.parse @browser.url
        @seen_first_page = true
      end

      # TODO: need more control?
      #Nokogiri::HTML(@browser.html) do |config|
      #  config.noblanks.noent.strict.nonet
      #end
      Nokogiri::HTML @browser.html
    end

    def process_content(page_uri, page)
      save_as_level = page_uri.path.split('/').length - 1

      page.search('[style]').each do |item|
        item['style'] = CssProcessor.process(
          item['style'], @uri, page_uri, @options.output_dir, @hydra, @logger, save_as_level
        )
      end

      page.search('link[href], img[src], script[src], iframe[src]').each do |item|
        begin
          url = item['src'] || item['href']
          url = CGI.unescapeHTML url   # Undo Nokogiri's HTML entitification.
                                       # TODO: how to configure Nokogiri?
          ref_uri = page_uri.merge url

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

#p "*** REF_URI: #{ref_uri}"
#p "*** SAVE_AS_LEVEL: #{save_as_level}"
#p "*** SAVE_AS: #{save_as}"
#p "*** NEW_REF: #{new_ref}"

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
          @uri, ref_uri, save_as, save_as_level, @options.output_dir, @hydra, @logger
        )
        resource.save
      end

      new_ref
    end

    def capture_start
      @start_time = Time.now
      @logger.log "Start: #{@start_time}"
      puts "Going to save content to \"#{File.join '.', @options.output_dir}\""
    end

    def capture_finish(show_done=true)
      end_time = Time.now
      elapsed = end_time.to_i - @start_time.to_i
      @logger.log "End: #{end_time}. Elapsed: #{elapsed / 60}m#{elapsed - (elapsed / 60) * 60}s"
      puts 'Done!' if show_done
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
          @browser.close
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
    end

    def logout
      # TODO: log out
    end

    def init_output_dir
      # Back up previous copy if needed.
      if Dir.exists? @options.output_dir
        ts = Time.now.to_i
        puts "Renaming existing directory to \"#{File.join '.', @options.output_dir}.#{ts}\""
        File.rename @options.output_dir, "#{@options.output_dir}.#{ts}"
      end

      # Create output directory.
      Dir.mkdir @options.output_dir

      # Output info about this copy.
      File.open "#{@options.output_dir}/README", 'w' do |f|
        f.puts "Thank you for using #{@cmd} - https://github.com/m5n/#{@cmd}"
        f.puts
        f.puts "Site: #{@options.has_url? ? @options.url : @uri}"
        f.puts "User: #{@options.username}" if @options.login_required
        f.puts "Date: #{Time.now}"
      end
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
#p "*** URI: #{uri}"
#p "*** PREFIX: #{prefix}"
      clone = URI.parse uri.to_s
      clone.scheme = @uri.scheme   # Avoid port mismatch due to scheme.
#p "*** CLONE: #{clone}"

      if "#{clone.host}:#{clone.port}" == "#{@uri.host}:#{@uri.port}"
        clone.scheme = clone.host = clone.port = nil
#p "*** CLONE1: #{clone}"
        path = clone.to_s.empty? ? '/' : clone.to_s
      else
        clone.scheme = nil
#p "*** CLONE2: #{clone}"
        path = clone.to_s[1..-1]   # Avoid path starting with "//".
      end
#p "*** PATH: #{path}"

      path = "#{prefix}#{path}"
      path += 'index.html' if path[-1] == '/'
#p "*** PATH: #{path}"
      path
    end
  end
end
