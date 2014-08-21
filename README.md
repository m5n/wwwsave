wwwsave
=======

Usage
-----
No login required:

    $ ./wwwsave http://www.somesite.com

Login required:

    $ ./wwwsave -s somesite -u thatsme -p $3cre3t http://thatsme.somesite.com


Developer Setup
---------------
If you don't have Ruby installed:

    $ \curl -sSL https://get.rvm.io | bash -s stable --ruby

This will install the latest RVM and Ruby. Follow all instructions the RVM installer gives you. (This should include sourcing the rvm script.)

If you use gnome-terminal or screen on certain Linux flavors (e.g. Mint), make sure you follow the instructions here: https://rvm.io/integration/gnome-terminal

Determine the Ruby installed by running the following and grabbing the ruby listed (e.g. ruby-2.1.1):

    $ rvm list

Now configure a compartmentalized independent Ruby setup for this project (replace ruby-2.1.1 with whatever version of Ruby got installed earlier):

    $ rvm --ruby-version use ruby-2.1.1@wwwsave

Install the gems this project relies on:

    $ bundle install

Show the usage:

    $ ./wwwsave.rb -h
