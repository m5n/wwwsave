require 'io/console'   # for echo-less password input
require 'optparse'     # for parsing command line options
require 'uri'          # for URL validation and hostname extraction

require 'wwwsave/version'

module WWWSave
  class Options
    def initialize(argv)
      @options = parse argv

      # Replace site config param with a "login required" indicator.
      @options['login_required'] = !@options.delete('site').nil?

      if @options['login_required']
        # Username is required if an authentication scheme is in effect.
        assert_username

        # Ask for password if needed.
        read_password if !@options.has_key?('password')
      end
    end

    def parse(argv)
      cmd = $0.split('/').last

      options = {
        'verbose' => false
      }

      # Gather supported sites for authenticated access.
      known_sites = []
      Dir.glob('config/*') do |file|
        id = file.split(/\/|\./)[1]
        known_sites.push id
      end

      # Parse command line options.
      parser = OptionParser.new do |opts|
        opts.banner = "Usage: #{cmd} [options]"

        opts.separator ''
        opts.separator 'Options:'
        opts.separator ''

        opts.on('-h', '--help', 'Show this message') do
          puts opts
          exit   # TODO: can control be passed back to main program?
        end

        opts.on('--outputdir [DIRECTORY]', 'Directory to save pages to', "    (default: \"./#{cmd}-<web site ID>\"") do |o|
          options['output_dir'] = o if !o.nil?
        end

        opts.on('-p', '--password [PASSWORD]', 'Password for login') do |p|
          options['password'] = p if !p.nil?
        end

        opts.on('--[no-]resume', 'Resume interrupted save') do |r|
          options['resume'] = r
        end

        opts.on('-s', '--site [SITE_ID]', 'Enable login & personal content discovery', '    (supported site IDs are listed below)') do |s|
          options['site'] = s if !s.nil?
        end

        opts.on('--url [URL]', 'Page to save', '    (no other page will be saved)') do |url|
          options['url'] = url if !url.nil?
        end

        opts.on('-u', '--username [USERNAME]', 'Username for login') do |u|
          options['username'] = u if !u.nil?
        end

        opts.on('-v', '--[no-]verbose', 'Run verbosely', "    (default: #{options['verbose']})") do |v|
          options['verbose'] = v
        end

        opts.on('--version', 'Show version') do
          puts WWWSave::Version::VERSION
          exit   # TODO: can control be passed back to main program?
        end

        opts.separator <<EOS


To save a single public page:

    $ ./wwwsave --url http://www.example.com
    $ ./wwwsave --url http://www.example.com/path/to/page.html

To save all personal content on a site requiring login (prompts for password):

    $ ./wwwsave -s site -u myname

To automate login (exposes plaintext password):

    $ ./wwwsave -s site -u myname -p '$3cr3t'

To save a single page on a site requiring login:

    $ ./wwwsave -s site -u myname -p '$3cr3t' --url http://myname.example.com


EOS

        opts.separator 'The following IDs are supported for sites requiring login:'
        opts.separator ''
        known_sites.sort.each do |id|
          opts.separator "    #{id}"
        end
      end
      parser.parse! argv

      # Parse leftover command line arguments.
      raise ArgumentError, 'Invalid or missing option(s). Use -h for usage.' if argv.length != 0

      # Validate authentication scheme.
      raise ArgumentError, 'Unknown authentication scheme. Use -h for usage.' if options.has_key?('site') && !known_sites.include?(options['site'])

      if options.has_key? 'url'
        # Validate URL.
        begin
          uri = URI.parse options['url']
          raise URI::InvalidURIError if !uri.kind_of?(URI::HTTP)
        rescue URI::InvalidURIError => error
          puts error.message if options['verbose']
          puts error.backtrace if options['verbose']
          raise ArgumentError, 'Invalid URL.'
        end
      end

      # Now the output dir can be set if it wasn't passed as an option.
      if !options.has_key?('output_dir') &&
          (options.has_key?('site') || options.has_key?('url'))
        # Extract site identifier from URL if no site ID was passed in.
        options['output_dir'] = "#{cmd}-#{options['site'] || uri.host}"
      end

      if options.has_key? 'site'
        # Augment with web site specific properties.
        site_options = JSON.load IO.read "config/#{options['site']}.json"
        site_options.each do |k, v|
          options[k] = v if !options.has_key? k
        end
      end

      options
    end

    def assert_username
      if !@options.has_key?('username')
        raise ArgumentError, 'Missing username. Use -h for usage.'
      end
    end

    def read_password
      print "Password for #{@options['username']}: "
      @options['password'] = STDIN.noecho(&:gets).strip
      puts   # advance to next line
    end

    # Give read-only access to options.
    def method_missing(method, *args, &block)
      key = method.to_s
      if key[/has_(.+)\?/]
        @options.has_key? $1
      elsif @options.has_key? key
        @options[key]
      else
        raise NoMethodError, "undefined method `#{method.to_s}' for #{to_s}"
      end
    end

    def to_s
      s = @options.to_s
      s.sub /"password"=>".*?"/, '"password"=>"[HIDDEN]"'
    end
  end
end
