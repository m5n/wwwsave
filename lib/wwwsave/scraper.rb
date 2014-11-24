require 'uri'   # for parsing URLs

require 'wwwsave/logger'
require 'wwwsave/site'

module WWWSave
  class Scraper
    # Number of seconds to wait before fetching next page.
    NEXT_PAGE_DELAY = 2

    def initialize(options)
      @cmd = $0.split('/').last
      @options = options
      @logger = Logger.new @options.verbose

      @logger.log "Options: #{@options}"
    end

    def start
      capture_start
      @site = Site.new @options, @logger

      # Do login before creating directories as an error could still occur.
      @site.login if @options.login_required

      if @options.has_url?
        # Save single page only.
        uri = URI.parse @options.url
      else
        @page_queue = []

        # Start with the user's home page.
        uri = @site.home_uri
      end

      init_output_dir uri
      save_page uri
      # TODO: if uri is in a subdir, need to create a copy as /index.html

      @site.logout if @options.login_required

      @site.cleanup
      capture_finish
    end

    def save_page(uri)
      @site.save_page uri, @page_queue
     
      # Save the next page, if any.
      if @options.login_required && !@options.has_url?
        @logger.log "Pages left: #{@page_queue.length}"
        if @page_queue.length > 0
          # Avoid rate limiting.
          sleep NEXT_PAGE_DELAY

          save_page @page_queue.shift
        end
      end
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

    def init_output_dir(site_uri)
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
        f.puts "Site: #{site_uri}"
        f.puts "User: #{@options.username}" if @options.login_required
        f.puts "Date: #{Time.now}"
      end
    end
  end
end
