require 'uri'   # for parsing URLs

require 'wwwsave/errors'
require 'wwwsave/logger'
require 'wwwsave/site'

module WWWSave
  class Main
    # Number of seconds to wait before fetching next page.
    NEXT_PAGE_DELAY = 2

    def initialize(options)
      @cmd = $0.split('/').last
      @options = options
      @logger = Logger.new @options.verbose

      @logger.log "Options: #{@options}"

      if @options.has_resume? && @options.resume
        if File.exists?("#{@options.output_dir}/.pending")
          puts "Resuming save."
        else
          raise NotResumableError.new, 'Nothing to resume.'
        end
      end
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
        if @options.has_resume? && @options.resume
          @page_queue = Marshal.load(
            File.read("#{@options.output_dir}/.pending")
          )

          # Resume with next page.
          uri = @page_queue.shift
        else
          @page_queue = @options.has_paths_to_save? ?
              @site.paths_to_uris(@options.paths_to_save) : []

          # Start with the user's home page.
          uri = @site.home_uri
          @page_queue.delete uri
        end
      end

      @save_extra_root_copy = uri.path.split('/').length > 0

      init_output_dir uri
      save_page uri

      @site.logout if @options.login_required

      @site.cleanup
      capture_finish
    end

    def save_page(uri)
      saved = @site.save_page uri, @page_queue

      if (!@options.has_resume? || !@options.resume) && @save_extra_root_copy
        # Save a copy in the root directory for easy access.
        # (Do this logic here to save a request as the 1st page is still there.)
        @site.save_page uri.merge('/'), @page_queue, uri
        @save_extra_root_copy = false
      end

      if saved
        puts "Saved: #{uri}"
      else
        # Try again later.
        @page_queue.push uri
      end


      # Save the next page, if any.
      if @options.login_required && !@options.has_url?
        puts "Pages left: #{@page_queue.length}"

        # Serialize queue in case there's an error and save needs to resume.
        File.open "#{@options.output_dir}/.pending", 'w' do |f|
          f.write Marshal.dump(@page_queue)
        end

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
      puts "Saving content to \"#{File.join '.', @options.output_dir}\""
    end

    def capture_finish(show_done=true)
      if @options.login_required && !@options.has_url?
        File.delete "#{@options.output_dir}/.pending" if @page_queue.length == 0
      end

      end_time = Time.now
      elapsed = end_time.to_i - @start_time.to_i
      @logger.log "End: #{end_time}."
      puts "Elapsed: #{elapsed / 60}m#{elapsed - (elapsed / 60) * 60}s"
      puts 'Done!' if show_done
    end

    def init_output_dir(site_uri)
      # Back up previous copy if needed.
      if !(@options.has_resume? && @options.resume) &&
          Dir.exists?(@options.output_dir)
        ts = Time.now.to_i
        puts "Renaming existing directory to \"#{File.join '.', @options.output_dir}.#{ts}\""
        File.rename @options.output_dir, "#{@options.output_dir}.#{ts}"
      end

      # Create output directory.
      Dir.mkdir(@options.output_dir) if !Dir.exists?(@options.output_dir)

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
