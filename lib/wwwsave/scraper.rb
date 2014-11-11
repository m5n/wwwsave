require 'fileutils'   # for creating an entire dir path in one go
require 'json'        # for parsing JSON strings
require 'nokogiri'    # for parsing HTML documents
require 'open-uri'    # for downloading page resources
require 'uri'         # for parsing URLs
require 'watir'       # for automating possibly JavaScript-driven login

require 'wwwsave/errors'

module WWWSave
  class Scraper
    def initialize(options)
      @cmd = $0.split('/').last
      @options = options
      @uri = URI.parse @options.url
      @seen_first_page = false

      log "Options: #{@options}"
    end

    def start
      capture_start
      @browser = Watir::Browser.new

      # Do login before creating directories as an error could still occur.
      login if @options.login_required

      init_output_dir
      save_page @uri

      logout if @options.login_required

      @browser.close
      capture_finish
    end

    def save_page(uri)
      path = local_path uri
      path = "#{@options.output_dir}#{path}"
      path += 'index.html' if path[-1] == '/'

      log 'Save_page:'
      log "Page: #{uri}"
      log "As: #{path}"

      begin
        first_time = !@seen_first_page
        page = get_page uri
        uri = @uri if first_time
        process_content uri, page

        FileUtils.mkpath File.dirname(path) if !Dir.exists? File.dirname(path)
        log "Saving: #{path}"
        File.open(path, 'w') { |f| page.write_html_to f }
      rescue Exception => error   # TODO: something more specific?
        puts "An error occured. Skipping #{uri}"
        puts error.message if @options.verbose
        puts error.backtrace if @options.verbose
      end
    end

    def get_page(uri)
      puts "Retrieving: #{uri}"
      @browser.goto uri.to_s

      if !@seen_first_page
        log "Update site URI from \"#{@uri}\" to \"#{@browser.url}\""
        @uri = URI.parse @browser.url
        @seen_first_page = true
      end

      Nokogiri::HTML(@browser.html) do |config|
        config.strict.nonet.noblanks
      end
    end

    def process_content(page_uri, page)
      page.search('link[href], img[src], script[src]').each do |item|
        begin
          url = item['src'] || item['href']
          ref_uri = page_uri.merge url
          save_as = new_ref = local_path ref_uri
          save_as = "#{@options.output_dir}#{save_as}"
          save_as += 'index.html' if save_as[-1] == '/'
          new_ref = ".#{new_ref}"
          new_ref += 'index.html' if new_ref[-1] == '/'

          log ''
          log 'Process_content:'
          log "Ref: #{url}"
          log "URI: #{ref_uri}"

          if File.exists? save_as
            log "Already saved: #{save_as}"
          else
            log "Save as: #{save_as}"

            # Save page resources "as is".
            FileUtils.mkpath File.dirname(save_as) if !Dir.exists? File.dirname(save_as)
            File.open(save_as, 'wb') do |f|
              f.write open(ref_uri).read
              # TODO: process CSS, e.g. background:url(/assets/...)
            end
          end

          # Change reference to resource in page.
          item['src'] ? item['src'] = new_ref : item['href'] = new_ref
        rescue Exception => error   # TODO: something more specific?
          puts "An error occured. Skipping #{ref_uri}"
          puts error.message if @options.verbose
          puts error.backtrace if @options.verbose
        end
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
      puts 'Done!'
    end

    def login
      log 'Logging in'

      begin
        @browser.goto @options.login_page
        current_url = @browser.url

        form = @browser.element(:css => @options.login_form_selector)

        form.text_field(:name => @options.login_form_username_field_name).when_present.set @options.username
        form.text_field(:name => @options.login_form_password_field_name).when_present.set @options.password
        form.element(:css => @options.login_form_submit_button_selector).when_present.click

        Watir::Wait.until { @browser.elements(:css => @options.login_error_text_selector).length > 0 || @browser.url != current_url }

        # TODO: not all sites redirect after successful login, e.g. LJ.
        if @browser.url == current_url
          log 'Login error'
          errorText = @browser.element(:css => @options.login_error_text_selector).text
          abort errorText
        end
      rescue Watir::Wait::TimeoutError => error
        raise LoginError.new(error), 'Unable to log in'
      rescue Selenium::WebDriver::Error => error
        # Same code as above; refactor!
        raise LoginError.new(error), 'Unable to log in'
      end

      log 'Login success'
    end

    def logout
      # TODO: log out if @options.login_required
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

    def local_path(uri)
      clone = URI.parse uri.to_s
      clone.scheme = @uri.scheme   # Avoid port mismatch due to scheme.

      if "#{clone.host}:#{clone.port}" == "#{@uri.host}:#{@uri.port}"
p "1"
        clone.scheme = clone.host = clone.port = nil
        clone.to_s.empty? ? '/' : clone.to_s
      else
p "2"
        clone.scheme = nil
        clone.to_s[1..-1]   # Avoid path starting with "//".
      end
    end

    def log(str)
      puts "LOG: #{str}" if @options.verbose
    end
  end
end
