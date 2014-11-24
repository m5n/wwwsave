module WWWSave
  class Logger
    def initialize(verbose)
      @verbose = verbose
    end

    def log(str)
      puts "LOG: #{str}" if @verbose
    end

    def verbose?
      @verbose
    end
  end
end
