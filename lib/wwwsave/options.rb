require 'wwwsave/version'

require 'optparse'     # for parsing command line options
require 'io/console'   # for echo-less password input
require 'uri'          # for URL validation and hostname extraction

module WWWSave
  class Options
    def initialize(argv)
      @options = parse argv

      # Username is required if login is requested.
      assert_username if @options['login']

      # Ask for password if needed.
      read_password if @options['login'] && !@options.has_key?('password')
    end

    def parse(argv)
      options = {
        'login' => false,
        'verbose' => false
      }
      known_site_ids = []

      # Parse command line options.
      parser = OptionParser.new do |opts|
        opts.banner = "Usage: #{$0.split('/').last} [options] url"

        opts.separator ''
        opts.separator 'Use the "-s" option for authenticated access. These site IDs are supported:'

        # Gather supported sites for authenticated access.
        Dir.glob('config/*') do |file|
          id = file.split(/\/|\./)[1]
          known_site_ids.push id
          opts.separator "    #{id}"
        end

        opts.separator ''
        opts.separator 'Options:'

        opts.on('-h', '--help', 'Show this message') do
          puts opts
          exit   # TODO: can control be passed back to main program?
        end

        opts.on('-l', '--[no-]login', 'Require login', "  (default: #{options['login']})") do |l|
          options['login'] = l
        end

        opts.on('-o', '--outputdir [DIRECTORY]', 'Set directory to save pages to', "  (default: \"./saved-<web site ID>\"") do |o|
          options['output_dir'] = o if !o.nil?
        end

        opts.on('-p', '--password [PASSWORD]',
                'Set password',
                '  (to enter it without revealing your',
                '   plaintext password, leave unspecified)') do |p|
          options['password'] = p if !p.nil?
        end

        opts.on('-s', '--siteid [SITEID]', 'Use specific Web site configuration', '  (allows authentication)') do |s|
          options['site_id'] = s if !s.nil?
        end

        opts.on('-u', '--username [USERNAME]', 'Set username') do |u|
          options['username'] = u if !u.nil?
        end

        opts.on('-v', '--[no-]verbose', 'Run verbosely', "  (default: #{options['verbose']})") do |v|
          options['verbose'] = v
        end

        opts.on('--version', 'Show version') do
          puts WWWSave::Version::VERSION
          exit   # TODO: can control be passed back to main program?
        end
      end
      parser.parse! argv

      # Parse leftover command line arguments.
      raise ArgumentError, 'Incorrect number of arguments. Use -h for usage.' if argv.length != 1
      options['url'] = argv.shift

      # Validate site ID.
      raise ArgumentError, 'Unknown site id. Use -h for usage.' if options.has_key?('site_id') && !known_site_ids.include?(options['site_id'])

      # Validate URL.
      begin
        uri = URI.parse(options['url'])
        raise URI::InvalidURIError if !uri.kind_of?(URI::HTTP)
      rescue URI::InvalidURIError => error
        puts error.message if options['verbose']
        puts error.backtrace if options['verbose']
        raise ArgumentError, 'Invalid URL.'
      end

      # Now the output dir can be set if it wasn't passed as an option.
      if !options.has_key? 'output_dir'
        id = options['site_id']
        # Extract site identifier from URL if no site ID was passed in.
        options['output_dir'] = "saved-#{options['site_id'] || uri.host}"
      end

      if options.has_key? 'site_id'
        # Augment with web site specific properties.
        site_options = JSON.load IO.read "config/#{options['site_id']}.json"
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
      if @options.has_key?(key)
        @options[key]
      else
        raise NoMethodError, "undefined method `#{method.to_s}' for #{inspect}"
      end
    end

    def to_s
      s = @options.to_s
      s.sub /"password"=>".*?"/, '"password"=>"[HIDDEN]"'
    end
  end
end
