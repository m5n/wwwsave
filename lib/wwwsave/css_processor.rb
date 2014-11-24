require 'wwwsave/page_resource'

module WWWSave
  class CssProcessor
    def self.process(content, page_uri, ref_uri, output_dir, hydra, logger,
                     save_as_level=0, ref_level=0)
      matches = content.scan /url\s*\(['"]?(.+?)['"]?\)/i
      matches.map! { |m| m = m[0] }
      matches.uniq.each do |m|
        next if !m[/^[h\/]/i]   # Skip relative URLs or data blocks.

        begin
          uri = ref_uri.merge m
          logger.log "Save CSS ref: #{m}"
          logger.log "         URI: #{uri}"

          new_ref = save_resource page_uri, uri, save_as_level, output_dir, hydra, logger
          new_ref = level_prefix(ref_level) + new_ref
          logger.log "        HTML: #{uri}"

          content.gsub! m, new_ref
        rescue Exception => error   # TODO: something more specific?
          puts "An error occured. Skipping #{uri}"
          puts error.message if logger.verbose?
          puts error.backtrace if logger.verbose?
        end
      end

      content
    end

    # TODO: dupe of scraper's version: refactor
    def self.level_prefix(level)
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

    # TODO: dupe of scraper's version: refactor
    def self.save_resource(page_uri, ref_uri, save_as_level=0, output_dir, hydra, logger)
      save_as = local_path page_uri, ref_uri, output_dir
      new_ref = local_path page_uri, ref_uri, '.'

#p "*** REF_URI: #{ref_uri}"
#p "*** SAVE_AS_LEVEL: #{save_as_level}"
#p "*** SAVE_AS: #{save_as}"
#p "*** NEW_REF: #{new_ref}"

      if File.exists? save_as   # TODO: use in-memory cache?
        logger.log "        Skip: #{save_as}"
      else
        logger.log "          As: #{save_as}"

        resource = WWWSave::PageResource.new(
          page_uri, ref_uri, save_as, save_as_level, output_dir, hydra, logger
        )
        resource.save
      end

      new_ref
    end

    # TODO: dupe of scraper's version: refactor
    def self.local_path(page_uri, uri, prefix)
#p "*** URI: #{uri}"
#p "*** PREFIX: #{prefix}"
      clone = URI.parse uri.to_s
      clone.scheme = page_uri.scheme   # Avoid port mismatch due to scheme.
#p "*** CLONE: #{clone}"

      if "#{clone.host}:#{clone.port}" == "#{page_uri.host}:#{page_uri.port}"
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
