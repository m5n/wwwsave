require 'watir-webdriver'   # for automating possibly AJAX-y login
require 'mechanize'         # for automating website interaction
require 'uri'               # for URL hostname and path extraction
require 'json'              # for parsing JSON strings
require 'fileutils'         # for creating an entire dir path in one go

require 'wwwsave/errors'

module WWWSave
  class Scraper
    def initialize(options)
      @cmd = $0.split('/').last
      @options = options
      @agent = Mechanize.new

      # Set absolute base URL, for content URLs starting with "/".
      # Don't use URI as we don't want to include port if it wasn't specified.
      parts = @options.url.split('/', 4)
      @abs_base_url = "#{parts[0]}//#{parts[2]}"

      # Set relative base URL, for content URLs NOT starting with "/".
      uri = URI @options.url
      if parts.length == 3
        @rel_base_url = @abs_base_url
      elsif uri.path[-1] == '/' || !uri.path.split('/')[-1].include?('.')
        @rel_base_url = "#{@abs_base_url}#{uri.path}"
      else
        @rel_base_url = "#{@abs_base_url}#{File.dirname uri.path}"
      end

      log "Options: #{@options}"
      log "User-provided URL: #{@options.url}"
      log "Absolute base URL: #{@abs_base_url}"
      log "Relative base URL: #{@rel_base_url}"
    end

    def start
      capture_start

      # Do login before creating directories as an error could still occur.
      begin
        login if @options.login_required
      rescue Watir::Wait::TimeoutError => error
        raise LoginError.new(error), 'Unable to log in'
      rescue Selenium::WebDriver::Error => error
        # Same code as above; refactor!
        raise LoginError.new(error), 'Unable to log in'
      end

      init_output_dir

      save_page @options.url

      # TODO: do this only if depth alone is not enough
      #@options.pages_to_save.each do |p|
      #  save_page "#{@options.url}/#{p}"
      #end

      capture_finish
    end

    def save_page(url)
      parts = url.split('/', 4)
      uri = URI url
      if uri.scheme.nil?
        base = uri.path[0] == '/' ? @abs_base_url : @rel_base_url
      else
        base = "#{parts[0]}//#{parts[2]}"
      end
      path = uri.path.empty? ? '/' : uri.path

log "Save_page:"
log "Page: #{url}"
log "Base: #{base}"
log "Path: #{path}"

      begin
        page = get_page url
        process_content page

        path = "#{@options.output_dir}#{path}"
        path += 'index.html' if path[-1] == '/'
        FileUtils.mkpath File.dirname(path) if !Dir.exists? File.dirname(path)
        log "Saving: #{path}"
        page.save_as path
      rescue Mechanize::ResponseCodeError => error
        puts "An error occured. Skipping #{url}"
        puts error.message if @options.verbose
        puts error.backtrace if @options.verbose
      end
    end

    def get_page(url)
      puts "Retrieving: #{url}"
      @agent.get url
    end

    def process_content(page)
      page.search('img[src], script[src]').each do |item|
        puts item
        puts item['src']
      end
    end

    def capture_start
      @start_time = Time.now
      log "Start: #{@start_time}"
      puts "Going to save content to \"#{File.join '.', @options.output_dir}\""
    end

    def capture_finish
      end_time = Time.now
      elapsed = end_time.to_i - @start_time.to_i
      log "End: #{end_time}. Elapsed: #{elapsed / 60}m#{elapsed - (elapsed / 60) * 60}s"
      puts "Done!"
    end

    def login
      log 'Logging in'

      browser = Watir::Browser.new
      browser.goto @options.login_page
      current_url = browser.url

      form = browser.element(:css => @options.login_form_selector)

      form.text_field(:name => @options.login_form_username_field_name).when_present.set @options.username
      form.text_field(:name => @options.login_form_password_field_name).when_present.set @options.password
      form.element(:css => @options.login_form_submit_button_selector).when_present.click

      Watir::Wait.until { browser.elements(:css => @options.login_error_text_selector).length > 0 || browser.url != current_url }

      # TODO: not all sites redirect after successful login, e.g. LJ.
      if browser.url == current_url
        errorText = browser.element(:css => @options.login_error_text_selector).text
        abort errorText
      end

      # TODO: eventually: browser.close
    end

    def init_output_dir
      # Back up previous copy if needed.
      if Dir.exists? @options.output_dir
        ts = Time.now.to_i
        puts "Renaming existing directory to \"#{File.join '.', @options.output_dir}.#{ts}\""
        File.rename(@options.output_dir, "#{@options.output_dir}.#{ts}")
      end

      # Create output directory.
      Dir.mkdir @options.output_dir

      # Output info about this copy.
      File.open "#{@options.output_dir}/README", 'w' do |f|
        f.puts "Thank you for using #{@cmd} - https://github.com/m5n/#{@cmd}"
        f.puts
        f.puts "Site: #{@options.url}"
        f.puts "User: #{@options.username}" if @options.login_required
        f.puts "Date: #{Time.now}"
      end
    end

    def log(str)
      puts "LOG: #{str}" if @options.verbose
    end
  end
end
