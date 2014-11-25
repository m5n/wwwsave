module WWWSave
  class WWWSaveError < StandardError
    attr_reader :nested_error

    def initialize(nested_error=nil)
      @nested_error = nested_error
    end
  end

  class LoginError < WWWSaveError
  end

  class NotResumableError < WWWSaveError
  end
end
