wwwsave
=======
STILL A WORK IN PROGRESS
========================

Usage
-----
Usage: wwwsave [options]

Options:

    -h, --help                       Show this message
    -o, --outputdir [DIRECTORY]      Directory to save pages to
                                         (default: "./wwwsave-<web site ID>"
    -p, --password [PASSWORD]        Password for login
    -s, --site [SITE_ID]             Enable login & personal content discovery
                                         (supported site IDs are listed below)
    -u, --username [USERNAME]        Username for login
    -v, --[no-]verbose               Run verbosely
                                         (default: false)
        --url [URL]                  Page to save
                                         (no other page will be saved)
        --version                    Show version


To save a single public page:

    $ ./wwwsave --url http://www.example.com
    $ ./wwwsave --url http://www.example.com/path/to/page.html

To save all personal content on a site requiring login (prompts for password):

    $ ./wwwsave -s site -u myname

To automate login (exposes plaintext password):

    $ ./wwwsave -s site -u myname -p '$3cr3t'

To save a single page on a site requiring login:

    $ ./wwwsave -s site -u myname -p '$3cr3t' --url http://myname.example.com


The following IDs are supported for sites requiring login:

    livejournal
    pinterest


Adding authentication for other sites
-------------------------------------
Copy one of the existing config/*.json files and provide values for the site you're interested in. Be careful to target elements that are visible.


Developer setup
---------------
If you don't have Ruby installed:

    $ \curl -sSL https://get.rvm.io | bash -s stable --ruby

This will install the latest RVM and Ruby. Follow all instructions the RVM installer gives you. (This should include sourcing the rvm script.)

If you use gnome-terminal or screen on certain Linux flavors (e.g. Mint), make sure you follow the instructions here: https://rvm.io/integration/gnome-terminal

Determine the Ruby installed by running the following and grabbing the ruby listed (e.g. ruby-2.1.1):

    $ rvm list

Now configure a compartmentalized independent Ruby setup for this project (replace ruby-2.1.1 with whatever version of Ruby got installed earlier):

    $ rvm --create --ruby-version use ruby-2.1.1@wwwsave

Install the gems this project relies on:

    $ bundle install

Show the usage:

    $ ./wwwsave -h
