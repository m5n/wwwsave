#!/usr/bin/ruby

template = IO.read './README.template'
usage = `./wwwsave -h`

template.gsub! '{{usage}}', usage

IO.write 'README.md', template
