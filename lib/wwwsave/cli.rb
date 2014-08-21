require 'wwwsave/options'
require 'wwwsave/scraper'

module WWWSave
  class CLI
    def self.start(argv)
      begin
        options = WWWSave::Options.new argv
        scraper = WWWSave::Scraper.new options
        scraper.start
      rescue ArgumentError => error   # raised by WWWSave::Options
        puts error.message
      rescue SocketError => error     # raised by net/http.rb
        puts error.message if options.verbose
        puts error.backtrace if options.verbose
        puts 'No Internet connection.'
      end
    end
  end
end
