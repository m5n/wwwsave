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
      @resume_file = "#{@options.output_dir}/.pending"

      @logger.log "Options: #{@options}"

      if resume?
        if File.exists? @resume_file
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
        page_uri = home_uri = URI.parse @options.url
      else
        home_uri = @site.home_uri

        if resume?
          page_queue = Marshal.load File.read @resume_file
        else
          page_queue = @options.has_content_to_save? ?
              @site.merge_with_home_uri(
                @options.content_to_save.select { |i| !i.start_with? 'regex:' }
              ) : []

          # Make sure the user's home page is included, and because of the
          # `@save_extra_root_copy` logic, make sure it's the first entry.
          page_queue.delete home_uri
          page_queue.unshift home_uri
        end
      end

      # Save an extra copy in the root dir if requested page is in a subdir.
      @save_extra_root_copy = !resume? && home_uri.path.split('/').length > 0

      init_output_dir home_uri

      if @options.has_url?
        save_page page_uri
      else
        save_pages page_queue
      end

      @site.logout if @options.login_required

      @site.cleanup
      capture_finish page_queue
    end

    def save_pages(page_queue)
      while page_queue.length > 0
        # Note that `save_page` may add more items to `page_queue`.
        save_page page_queue.shift, page_queue

        puts "Pages left: #{page_queue.length}"

        # Serialize queue in case there's an error and save needs to resume.
        File.open @resume_file, 'w' do |f|
          f.write Marshal.dump(page_queue)
        end

        # Avoid rate limiting.
        sleep NEXT_PAGE_DELAY if page_queue.length > 0
      end
    end

    def save_page(uri, page_queue=nil)
      # Note that `@site.save_page` may add more items to `page_queue`.
      saved = @site.save_page uri, page_queue

      if @save_extra_root_copy
        # Save a copy in the root directory for easy access.
        # (Do this logic here to save a request as the 1st page is still there.)
        @site.save_page uri.merge('/'), page_queue, uri
        # TODO: handle if @site.save_page fails

        @save_extra_root_copy = false
      end

      if saved
        puts "Saved: #{uri}"
      else
        # Try again later.
        page_queue.push uri
      end
    end

    def capture_start
      @start_time = Time.now
      @logger.log "Start: #{@start_time}"
      puts "Saving content to \"#{File.join '.', @options.output_dir}\""
    end

    def capture_finish(queue, show_done=true)
      File.delete @resume_file if !@options.has_url? && queue.length == 0

      end_time = Time.now
      elapsed = end_time.to_i - @start_time.to_i
      @logger.log "End: #{end_time}."
      puts "Elapsed: #{elapsed / 60}m#{elapsed - (elapsed / 60) * 60}s"
      puts 'Done!' if show_done
    end

    def init_output_dir(site_uri)
      # Back up previous copy if needed.
      if !resume? && Dir.exists?(@options.output_dir)
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

    def resume?
      @options.has_resume? && @options.resume
    end
  end
end
