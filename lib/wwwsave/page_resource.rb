require 'fileutils'   # for creating an entire dir path in one go
require 'typhoeus'    # for creating Typhoeus requests

require 'wwwsave/css_processor'

# TODO: encapsulate Typhoeus/Hydra in this module.

module WWWSave
  class PageResource
    def initialize(page_uri, uri, save_as, save_as_level, output_dir, hydra, logger)
      @page_uri = page_uri
      @uri = uri
      @save_as = save_as
      @save_as_level = save_as_level
      @output_dir = output_dir
      @hydra = hydra
      @logger = logger

      @request = Typhoeus::Request.new(uri.to_s)
      @request.on_complete do |response|
        begin
          dirname = File.dirname @save_as
          FileUtils.mkpath dirname if !Dir.exists? dirname
          File.open(@save_as, 'wb') do |f|
            content = response.body

            # TODO: any other extensions? Check something else instead?
            if @uri.path.end_with? ".css"
              ref_level = @uri.path.split('/').length - 1
              content = CssProcessor.process(
                content, @page_uri, @uri, @output_dir, @hydra, @logger, @save_as_level, ref_level
              )
            end

            f.write content
            @logger.log "Wrote: #{@save_as}"
          end
        rescue Exception => error   # TODO: something more specific?
          puts "An error occured writing #{@save_as}. Skipping."
          puts error.message if @logger.verbose?
          puts error.backtrace if @logger.verbose?
        end
      end
    end

    def save
      @hydra.queue @request
    end
  end
end
