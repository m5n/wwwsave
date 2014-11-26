require 'net/http'   # for SocketError

require 'wwwsave/errors'
require 'wwwsave/main'
require 'wwwsave/options'

module WWWSave
  class CLI
    def self.start(argv)
      begin
        options = WWWSave::Options.new argv
        main = WWWSave::Main.new options
        main.start
      rescue ArgumentError => error   # raised by WWWSave::Options
        puts error.message
      rescue WWWSaveError => error    # raised by WWWSave::Scraper & ::Site
        puts error.message
        puts error.nested_error.message if options.verbose
        puts error.nested_error.backtrace if options.verbose
      rescue SocketError => error     # raised by net/http.rb
        parts = options.url.split('/', 4)
        puts "Cannot connect to #{parts[0]}//#{parts[2]}"
        puts error.message if options.verbose
        puts error.backtrace if options.verbose
      end
    end
  end
end
