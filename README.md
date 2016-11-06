wwwsave
=======

Usage
-----
Usage: ./wwwsave [options]

Options:

    --agent ua     User agent to load pages as
                       (default: Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:49.0) Gecko/20100101 SlimerJS/0.10.0)
    -f             Force appending data to existing output directory
                       (will add new files but not update existing files)
    -h             Show this message
    -o dir         Directory to save pages to
                       (default: "./wwwsave-<site>")
    -p pwd         Password for login
    -r             Resume interrupted save
    -s site        Enable login & personal content discovery
                       (see below for supported sites)
    -u name        Username for login
    --url url      Single page to save
                       (use -s to save an entire site)
    -v             Run verbosely
                       (default: false)
    --version      Show version
    --view size    Browser viewport resolution in pixels (format: wxh)
                       (default: 1280x1024)

To save a single public page:

    $ ./wwwsave --url http://www.example.com
    $ ./wwwsave --url http://www.example.com/path/to/page.html

To save all personal content on a site requiring login:

    $ ./wwwsave -s site -u myname -p '$3cr3t'

To save a single page on a site requiring login:

    $ ./wwwsave -s site -u myname -p '$3cr3t' --url http://myname.example.com

The following sites are supported for use with the -s option:

* livejournal
* pinterest

To view the downloaded content:

* Load <output directory>/index.html in your browser
* Start a local web server in the <output directory> and load its default URL in your browser, e.g.

    $ cd <output directory>
    $ python -m SimpleHTTPServer 8000
    (Load http://localhost:8000 in your browser.)

Because browsers employ various security measures, accessing content even from your own machine may not be allowed.
The second option above will have the best results and does not require any changes to your browser settings.


Adding authentication for other sites
-------------------------------------
Copy one of the existing config/*.json files and provide values for the site you're interested in. See the [Site Config File Explained](https://github.com/m5n/wwwsave/wiki/Site-Config-File-Explained) Wiki page for more information.


Framework choice
----------------
Finding the right scraping framework wasn't easy. I initially wanted this to be a Ruby project, so Mechanize seemed like the logical choice. But as many modern web sites dynamically alter the page HTML using JavaScript, Mechanize fell through as it does not execute JavaScript.

Then I realized a browser testing framework may work better. Using an actual browser, Watir captures exactly what the user sees. I even improved performance by using Typhoeus for downloading the in-page resources. In the end, though, Watir cannot be instructed to save an image on a page. (A hybrid approach where Watir saves only the page HTML and Mechanize/Typhoeus saves all assets (JS, CSS, images, etc) also didn't work as HttpOnly cookies are (rightly) not exposed outside of the Watir internals and so cannot be accessed. (Unfortunately, sites like LiveJournal requires HttpOnly cookies to access certain assets, e.g. scrapbook images, so this inability was a show-stopper.))

Then I realized my approach was inefficient: the browser already downloaded all assets, so why download them again programmatically? Looking at headless browsers with full JavaScript support, PhantomJS seemed promising, but it does not give access to the response body--[not yet](https://github.com/ariya/phantomjs/issues/13908) perhaps in [v2.2](https://github.com/ariya/phantomjs/issues/13937). Luckily, SlimerJS has added support for accessing the response body, so the Ruby code was ported to JavaScript. Although a true headless browser would be preferred (Slimer.JS is not yet completely headless), having a visual of what the script is doing is actually rather nice.

So far, all is well!


Developer setup
---------------
1. Install Firefox: http://getfirefox.com/
1. Install Slimer.JS: http://slimerjs.org/
1. Do any additonal Slimer setup, if needed: http://docs.slimerjs.org/current/installation.html#setup
1. Show the usage:

    $ ./wwwsave -h
