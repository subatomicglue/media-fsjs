# media-fs.js - Universal Media Filesystem for NodeJS Apps

Media file browsing and retrieval abstraction for media player apps built on NodeJS (Electron, etc...).  
- Access several FS types like [ `LocalFS`, `DLNA/uPnP` ] using single folder abstraction, with a unified way to navigate them all.
- Root folder view presents a clean list of bookmarks to user-safe locations only.  
  - (no way for users to explore full filesystem unless you configure that in the app)
  - like [ `"~/Documents"`, `"~/Music"`, `"~/Downloads"`, `dlna-discovery` ], customizable with config file
- Default bookmarks configurable per app.  
- Media types supported [audio, image], and configurable (TODO, see Status section)
- Folder list item auto-enrichment using available media [default icon, folder icon, file icon, audio file playtime, folder/file timestamp]
- Folder sorting
- efficient:
  - as with a unix `cd` command, we can use relative paths with previous listing data to efficiently descend into the immediate child folders (e.g. avoid recursing from root every time, which is nice for LocalFS, but especially nice for avoiding multiple DLNA discoveries which is expensive).
- convenient:
  - less optimally, provide absolute paths and media-fs will recurse appropriately
## How to use:
Typically you'll have a Frontend (HTML and Javascript) calling a datasevice ([NodeJS](https://nodejs.org/en/)), or through [Electron](https://www.electronjs.org/) bindings to ([NodeJS](https://nodejs.org/en/))...

- User views the root folder:
  - Frontend calls `dir( "/" )` to retrieve the root folder listing, push the listing onto the `previous_listings` stack
- User navigates to a child `"/Music"`
  - Frontend calls `dir( "Music", previous_listing )` to populate the child's folder listing.
  - Using `previous_listing` optimizes the directory read, avoids recursing from the `"/"` root.
  - Pushes the `{foldername, previous_listing}` onto the `previous_listings` stack.
- User navigates back `"<"` (change to previous viewed folder)
  - Frontend keeps a stack of `previous_listings` with `{foldername, previous_listing}`, pops the stack, and then calls `dir( foldername, previous_listing )` to populate the previous folder listing
- User navigates back `".."` (to view parent folder)
  - Frontend looks at `previous_listings`, and then calls `dir( .., previous_listing )` to fetch the parent folder listing
  - NOTE: Some folder protocols (like DLNA) do not support the  `".."` folder functionality, and will not return the `".."` item with the listing.
    - In that case the user can use Frontend's implemented back `"<"` functionality instead.
- User goes to an **absolute** path (maybe they bookmarked it)
  - Frontend calls `dir( "/Bookmarked/Path/To/Thing" )` to populate the listing, push the listing onto the stack

### Files:
- media-fs.js
  - Javascript lib for accessing Media files on the network
- test-media-fs.js
  - command line script to access Media files on the network (test driver for the lib, and educational)

### Install:
```
TODO:
```

## Status:
- WE LOVE MUSIC.
- Depends on [subatomicglue](https://github.com/subatomicglue)'s [ [dlnajs](https://github.com/subatomicglue/dlnajs), [xhrjs](https://github.com/subatomicglue/xhrjs) ]
- TODO:
  - `.config` file has hardcoded paths right now, but for production release, we'll need to support `ENV` variables in the pathnames there so we can refer to at least `$HOME` or `~` types of wildcards.
  - Implement sorting (for now, use `Array.sort()`)
  - need to break a bunch of things out to be configurable
    - for now media types are hard coded to only audio types (`m4a`, `aac`, `wav`, `mp3`), and thus this "media filesystem" is oriented to audio only (for now!)
  - need to code a [frontend app](https://github.com/subatomicglue/flaming-monkey-head-musicplayer) on top of this to learn what problems or idiosyncracies to improve
    - the *efficient* scheme of providing previous listing for the frontend to manage and hand back to `media-fs` intelligently might be overly complicated and might be best to implement caching in the library instead
      - TLDR: absolute `dir()` listing are well implemented here, but relative `dir()` searches might not be (was trying to emulate unix `cd` command).
  - cache all listings, which would optimise absolute dir() calls. 
    - introduce a "force" flag to repopulate the cache for that one path (frontends could see some "that file no longer exists" warnings, but that could auto trigger a `dir( path, {force: true } )` without user noticing.)
    - could refresh cache on app start, or, keep a cache that persistents between app loads

## Testing:
```
> ./test-media-fs.js  --help

test-media-fs.js filesystem for user apps
Usage:
   test-media-fs.js                                         (outputs the / path)
   test-media-fs.js "/"                                     (outputs the / path)
   test-media-fs.js <absolute item name>                    (recursive listing retrieval, slow)
   test-media-fs.js <relative item name>   <last dir data>  (uses the last dir listing to list the item)
   test-media-fs.js --resolve                               (resolve dlna discovery items before returning result)
   test-media-fs.js --help                                  (this help)
   test-media-fs.js --verbose                               (output verbose information)
```

