wwwsave
=======
STILL A WORK IN PROGRESS
========================

Usage
-----
Usage: wwwsave [options] url

Specific options:

    -h, --help                       Show this message
    -o, --outputdir [DIRECTORY]      Set directory to save pages to
                                         (default: "./wwwsave-<web site ID>"
    -p, --password [PASSWORD]        Set password
    -s, --scheme [AUTH_SCHEME]       Enable Web site authentication (see below)
    -u, --username [USERNAME]        Set username
    -v, --[no-]verbose               Run verbosely
                                         (default: false)
        --version                    Show version


Simple example:

    $ ./wwwsave http://www.somesite.com
    $ ./wwwsave http://www.somesite.com/some/page.html

With authenticated access (prompts for password so it's not exposed):

    $ ./wwwsave -s somesite -u thatsme http://somesite.com/users/thatsme

With fully automated authenticated access (exposes paintext password):

    $ ./wwwsave -s somesite -u thatsme -p '$3cre3t' http://thatsme.somesite.com


The following authentication schemes are supported (use with the "-s" option):

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
