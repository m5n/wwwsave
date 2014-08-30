require 'wwwsave/version'

require 'optparse'     # for parsing command line options
require 'io/console'   # for echo-less password input
require 'uri'          # for URL validation and hostname extraction

module WWWSave
  class Options
    def initialize(argv)
      @options = parse argv

      # Auth scheme was used to read properties file, so remove from options.
      # Replace it with a "login required" indicator.
      @options['login_required'] = !@options.delete('auth_scheme').nil?

      if @options['login_required']
        # Username is required if an authentication scheme is in effect.
        assert_username

        # Ask for password if needed.
        read_password if !@options.has_key?('password')
      end
    end

    def parse(argv)
      options = {
        'verbose' => false
      }

      # Gather supported sites for authenticated access.
      known_auth_schemes = []
      Dir.glob('config/*') do |file|
        id = file.split(/\/|\./)[1]
        known_auth_schemes.push id
      end

      # Parse command line options.
      parser = OptionParser.new do |opts|
        opts.banner = "Usage: #{$0.split('/').last} [options] url"

        opts.separator ''
        opts.separator 'Use the "-s" option with any of these authentication schemes:'
        known_auth_schemes.sort.each do |id|
          opts.separator "    #{id}"
        end

        opts.separator ''
        opts.separator 'Options:'

        opts.on('-h', '--help', 'Show this message') do
          puts opts
          exit   # TODO: can control be passed back to main program?
        end

        opts.on('-o', '--outputdir [DIRECTORY]', 'Set directory to save pages to', "  (default: \"./saved-<web site ID>\"") do |o|
          options['output_dir'] = o if !o.nil?
        end

        opts.on('-p', '--password [PASSWORD]',
                'Set password',
                '  (to be prompted while keeping your',
                '   password concealed, leave unspecified)') do |p|
          options['password'] = p if !p.nil?
        end

        opts.on('-s', '--scheme [AUTH_SCHEME]', 'Enable Web site authentication') do |s|
          options['auth_scheme'] = s if !s.nil?
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

      # Validate authentication scheme.
      raise ArgumentError, 'Unknown authentication scheme. Use -h for usage.' if options.has_key?('auth_scheme') && !known_auth_schemes.include?(options['auth_scheme'])

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
        # Extract site identifier from URL if no site ID was passed in.
        options['output_dir'] = "saved-#{options['auth_scheme'] || uri.host}"
      end

      if options.has_key? 'auth_scheme'
        # Augment with web site specific properties.
        site_options = JSON.load IO.read "config/#{options['auth_scheme']}.json"
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
