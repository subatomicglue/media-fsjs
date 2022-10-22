# media-fs.js - Universal Media Filesystem for NodeJS Apps

Media file browsing and retrieval abstraction for media player apps built on NodeJS (Electron, etc...).
- Access several filesystem types like [ `LocalFS`, `DLNA/uPnP` ] using a single root folder abstraction, with a unified way to navigate them all.
- Root folder view presents a clean list of bookmarks to user-safe locations only.
  - (no way for users to explore full filesystem unless you configure that in the app)
  - like [ `"Music"`, `"Documents"`, `"Downloads"`, `"uPnP Servers"` ], customizable with config file
- Virtual folders
  - Relative to root folder.  e.g. root folder could have LocalFS `~/Music` mapped as `/Music`, and DLNA/uPnP discovery mapped to `/uPnP Servers`.
- Default bookmarks configurable per app.
- Media types supported [audio, image], and configurable (TODO, see Status section)
- Folder list items are auto-enriched with rich metadata as available:
  - **Visual Metadata**:  [ default icon (set in config), folder icon (`folder.jpg|png`), file icon (`<filename>.jpg|png`), file's metadata icon (stored within mp3, m4a, etc)]
  - **Audio Metadata**: [ title, artist, album, duration in seconds, human readable runningtime ]
  - **Filesystem Metadata**: [ timestamp, file size ]
- Folder sorting
- efficient:
  - built in cache for uPNP long network operations:
    - always fetches/caches the current directory
    - uses cache for parent dir traversal
    - auto-refetch when not found
    - use "force" to refetch.
- convenient:
  - less optimally, provide absolute paths and `media-fs` will recurse appropriately
- environment variables (e.g. `${HOME}`) in `.config` root folder bookmarks
## How to use:
Typically you'll have a Frontend (HTML and Javascript) calling a datasevice ([NodeJS](https://nodejs.org/en/)), or through [Electron](https://www.electronjs.org/) bindings to ([NodeJS](https://nodejs.org/en/))...

UseCases:
- User views the root folder:
  - Browser calls `dir( "/" )` to retrieve the root folder listing
- User navigates URL to a child `"/Music"`
  - Browser calls `dir( "/Music" )` to populate the child's folder listing.
- User navigates back `"<"` (change to previous viewed folder)
  - Browser URL history knows the previous folder... (back button restores previous URL)
  - Browser calls `dir( "/" )` to populate the child's folder listing.
- User goes to an random path (maybe they bookmarked it)
  - Frontend calls `dir( "/Bookmarked/Path/To/Thing" )` to populate the listing

### Files:
- `.config`
  - Configuration for the app, contains root list of bookmarks.
    - Location determined by platform and ability to write to the location... typically ends up being:
      - mac: `~/Library/Preferences/<appname>`
      - win: `~/AppData/<appname>`
      - rpi: `/mnt/usb/<appname>` or `~/.<appname>`
      - linux, others: `~/.<appname>`
    - See `getUserDir()` for how this location is determined
- `media-fs.js`
  - Javascript lib for accessing Media files on the network
- `test-media-fs.js`
  - command line script to access Media files on the network (test driver for the lib, and educational)

### Install:
Add to your project's `package.json`
```
  "dependencies": {
    "dlnajs": "https://github.com/subatomicglue/media-fsjs#main",
  }
```
Then run `npm install` to pull the new dependency:
```
$ npm install
```

Include `media-fs` to your NodeJS `.js` file:
```
let mediafs = require( 'media-fsjs/media-fs.js' );
```

Initialize and configure `mediafs` with your app's name:
```
mediafs.init( { appname: "MyAppNameGoesHere" } )
```
To get a folder listing:
```
let listing = mediafs.dir( "/" )
```
To get a child folder listing (relative, avoids redundant reads):
```
listing = mediafs.dir( "Music", listing ) // <-- relative look up
```

To add a bookmark:
```
mediafs.addRootBookmark_FS( "/path/to/some/location" )

// fetch the updated root folder
let listing = mediafs.dir( "/" )
```
To remove a bookmark:
```
mediafs.delRootBookmark( "Music" )

// fetch the updated root folder
let listing = mediafs.dir( "/" )
```

## Status:
- Very much ALPHA status for right now (still check in features, some of the above dont quite exist or are broken)
- WE LOVE MUSIC.
- Depends on [subatomicglue](https://github.com/subatomicglue)'s [ [dlnajs](https://github.com/subatomicglue/dlnajs), [xhrjs](https://github.com/subatomicglue/xhrjs) ]
- TODO:
  - Implement sorting (for now, use `Array.sort()`)
  - need to break a bunch of things out to be configurable
    - for now media types are hard coded to only audio types (`m4a`, `aac`, `wav`, `mp3`), and thus this "media filesystem" is oriented to audio only (for now!)

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

