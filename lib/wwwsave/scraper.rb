require 'mechanize'    # for automating website interaction
require 'uri'          # for URL hostname and path extraction
require 'json'         # for parsing JSON strings
require 'fileutils'    # for creating an entire dir path in one go

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
      login if @options.login

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

      page = get_page url
      process_content page

      path = "#{@options.output_dir}#{path}"
      path += 'index.html' if path[-1] == '/'
      FileUtils.mkpath File.dirname(path) if !Dir.exists? File.dirname(path)
      log "Saving: #{path}"
      page.save_as path
    end

    def get_page(url)
      puts "Getting: #{url}"
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
      puts "Saving content to \"#{File.join '.', @options.output_dir}\""
    end

    def capture_finish
      end_time = Time.now
      elapsed = end_time.to_i - @start_time.to_i
      log "End: #{end_time}. Elapsed: #{elapsed / 60}m#{elapsed - (elapsed / 60) * 60}s"
      puts "Done!"
    end

    def login
      log 'Logging in'
      page = get_page @options.login_page
      page = page.form_with(:action => @options.login_form_action) do |form|
        form[@options.login_form_username_field] = @options.username
        form[@options.login_form_password_field] = @options.password
      end.click_button

      # Report error if any.
      errorText = page.search(@options.login_error_text_selector).text
      abort errorText if errorText.length > 0
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
        f.puts "#{@cmd} - https://github.com/m5n/#{@cmd}"
        f.puts
        f.puts "Site: #{@options.url}"
        f.puts "User: #{@options.username}" if @options.login
        f.puts "Date: #{Time.now}"
      end
    end

    def log(str)
      puts "LOG: #{str}" if @options.verbose
    end
  end
end
