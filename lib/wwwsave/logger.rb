module WWWSave
  class Logger
    attr_reader :verbose
    alias_method :verbose?, :verbose

    def initialize(verbose)
      @verbose = verbose
    end

    def log(str)
      puts "LOG: #{str}" if verbose?
    end
  end
end
