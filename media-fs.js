let dlna = require( 'dlnajs/dlna.js' );
let xhr = require( 'xhrjs/xhr.js' ).xhr;
let fs = require( 'fs' );
let path = require( 'path' );
let musicmetadata = require( 'music-metadata' );
let isPi = require( 'detect-rpi' ); // detect raspberry pi

// config data
const DEFAULT_CONFIG = {
  root_folder_listing: [
    { path: "Music", _type: "fs.dir", resource: "~/Music" },
    { path: "Documents", _type: "fs.dir", resource: "${HOME}/Documents" },
    { path: "Downloads", _type: "fs.dir", resource: "${HOME}/Downloads" },
    { path: "uPnP Media Servers", _type: "dlna.discovery" },
  ]
};
let CONFIGNAME = ".config";
const ROOTFOLDER = { name: "/", path: "/", _type: "root", type: "dir", resource: "root:///", resource_parent: "root:///", abs_path: "/", abs_path_parent: "/", root_path: "/" }
let VERBOSE=false;
let USERDIR = getUserDir( "media-fs" );

//////////////////////////////////////////////////////////////
// UTILITIES

// filter the path to NOT have file://
function fsPath( path ) {
  return path && path.match( /^file:\/\// ) ? path.replace( /^file:\/\//, "" ) : path
}

// filter the path to have file://
function httpPath( path ) {
  return path && (!path.match( /^file:\/\// )) ? ("file://" + path) : path
}

// fs.accessSync is so close, yet just not there.   Make it return true/false:
function checkPermissions( file, perms ) {
  try {
    fs.accessSync(fsPath( file ), perms);
    return true;
  } catch (err) {
    return false;
  }
}

// is the directory good to read/write?
function dirIsGood( path, writable = false ) {
  path = fsPath( path )
  let perms = fs.constants.R_OK;
  if (writable) perms = perms | fs.constants.W_OK;
  return fs.existsSync( path ) && checkPermissions( path, perms ) && fs.statSync( path ).isDirectory()
}

// is the file good to read/write?
function fileIsGood( path, writable = false ) {
  path = fsPath( path )
  let perms = fs.constants.R_OK;
  if (writable) perms = perms | fs.constants.W_OK;
  return fs.existsSync( path ) && checkPermissions( path, perms ) && fs.statSync( path ).isFile()
}

// LocalFS metadata: get the mime type for the filename based on extension
function getMime( filename ) {
  switch (getExt( filename )) {
    case ".jpg": return "image/jpeg";
    case ".png": return "image/png";
    case ".gif": return "image/gif";
    case ".wav": return "audio/wav";
    case ".mp3": return "audio/mp3";
    case ".m4a": return "audio/x-m4a";
    case ".aac": return "audio/aac";
    default: return "data/blob" // todo: what's the real type here?
  }
}

// LocalFS metadata: get the type of LocalFS object pointed to by the path, fs.dir or fs.file
function getType( path ) {
  try {
    let type = fs.statSync( fsPath( path ) ).isDirectory() ? "fs.dir" : "fs.file"
    //console.log( type , path )
    return type;
  } catch (e) {
    return "unreadable";
  }
}

// LocalFS metadata: get the timestamp of the fs object
function getTime( path ) {
  try {
    return fs.statSync( fsPath( path ) ).mtimeMs;
  } catch (e) {
    return -1;
  }
}


// get the file extension  e.g. ".mp3"
// function getExt( path ) {
//   return path.replace( /^.*([^.]+)$/, "$1" ).toLowerCase()
// }
function getExt( filename ) {
  let m = filename ? filename.match( /\.[^\.]+$/ ) : "";
  //console.log( path, m )
  return m ? m[0] : ""
}

// get the file path  e.g. "/home/user/happyuser/Downloads"
function getPath( filepath ) {
  return filepath ? filepath.replace( /\/[^\/]+$/, "" ).replace( /^$/, "/" ) : ""
}

// get the file name  e.g. "subatomicglue - aeonblue - dance of the butterfly"
function getFilename( filepath ) {
  return filepath ? filepath.replace( /^.*\//, "" ).replace( /\.[^\.]+$/, "" ) : ""; // remove path and ext
}

// get the foldername e.g. Downloads
function getFoldername( filepath ) {
  return filepath ? filepath.replace( /^.*?([^\/]+)$/, "$1" ) : ""; // remove path and ext
}

// get the parent foldername e.g. happyuser
function getParentname( filepath ) {
  return filepath ? filepath.replace( /[^\/]+$/, "" ).replace( /\/$/, "" ).replace( /^.*\//, "" ).replace( /^$/, "/" ) : ""; // remove path and ext
}

// collapase ".." in filepath.  e.g. "/home/user/happyuser/../Downloads/.." becomes "/home/user"
function eliminateDotDot( filepath ) {
  return filepath ? filepath.replace( /\/[^\/]+\/\.\./g, "" ).replace( /^$/, "/" ) : ""
}

function shortenImageName( i, rootdir ) {
  return i ? i.replace( "file://" + rootdir + "/", "" ).replace( /\.[^\.]+$/, "" ) : ""
}

function getImage( filepath ) {
  filepath = fsPath( filepath );
  if (filepath == undefined) return "assets/default.png"

  // if (fs.statSync( filepath ).isDirectory()) {
  // }
  let path_filename = path.join( getPath( filepath ), getFilename( filepath ) );
  let image = (
    // TODO: detect if <filepath> is an image type, (maybe) generate a thumbnail for it, and return a link to the thumb (or actual file)
    fs.existsSync( path.join( filepath, "Folder.jpg" ) ) ? ("file://" + path.join( filepath, "Folder.jpg" )) :
    fs.existsSync( path.join( filepath, "Folder.png" ) ) ? ("file://" + path.join( filepath, "Folder.png" )) :
    fs.existsSync( path.join( filepath, "Folder.gif" ) ) ? ("file://" + path.join( filepath, "Folder.gif" )) :
    fs.existsSync( path_filename + ".jpg" ) ? ("file://" + path_filename + ".jpg") :
    fs.existsSync( path_filename + ".png" ) ? ("file://" + path_filename + ".png") :
    fs.existsSync( path_filename + ".gif" ) ? ("file://" + path_filename + ".gif") :
    fs.existsSync( path.join( getPath( filepath ), "Folder.jpg" ) ) ? ("file://" + path.join( getPath( filepath ), "Folder.jpg" )) :
    fs.existsSync( path.join( getPath( filepath ), "Folder.png" ) ) ? ("file://" + path.join( getPath( filepath ), "Folder.png" )) :
    fs.existsSync( path.join( getPath( filepath ), "Folder.gif" ) ) ? ("file://" + path.join( getPath( filepath ), "Folder.gif" )) :
    "assets/default.png"
  )
  //console.log( filepath, "=>", image.slice( 0, 100 ) );
  return image;
}

function fillCategory( item ) {
  let mappings = {
    "dlna.discovery": "dir",
    "dlna.object.item.audioItem.musicTrack": "file",
    "dlna.object.container.storageFolder": "dir",
    "dlna.object.container.album.musicAlbum": "dir",
    "dlna.object.container.genre.musicGenre": "dir",
    "dlna.object.container.person.musicArtist": "dir",
    "fs.file": "file",
    "fs.dir": "dir",
  }
  item.type = mappings[item._type] ? mappings[item._type] : "dir";
}

function enrich( item, virtual_dir = "" ) {
  item.abs_path = eliminateDotDot(virtual_dir + "/" + item.path);
  item.abs_path_parent = getPath( item.abs_path );
  item.root_path = virtual_dir.replace( /^(\/[^\/]+).*$/, "$1" ).replace( /^$/, "/" );
}
async function enrichFS( item, virtual_dir = "" ) {
  //VERBOSE && console.log( "enriching: ", item )

  // VirtualFS metadata:
  enrich( item, virtual_dir );

  // LocalFS metadata:
  item.name = getFilename( item.resource );
  if (getExt( item.resource ) != "")
    item.ext = getExt( item.resource );
  item._type = item._type == undefined ? getType( item.resource ) : item._type;
  fillCategory( item );
  item.time = getTime( item.resource );
  item.image = getImage( item.resource );
  if (item._type == "fs.file") item.content = httpPath( item.resource );
  item.resource_parent = item.abs_path_parent == '/' ? undefined : item.resource.replace( /\/[^\/]+$/, "" ).replace( /^$/, "/" );

  // Audio metadata:
  await enrichFS_Audio( item, virtual_dir );

  return item;
}

async function enrichFS_Audio( r, virtual_dir = "" ) {
  let ext_2_mime = {
    m4a: "audio/mp4",
    aac: "audio/aac",
    mp3: "audio/mpeg",
    wav: "audio/x-wav",
  }
  // https://www.npmjs.com/package/node-id3
  if (r._type == "fs.file" && r.ext && r.ext.match( new RegExp( `/${Object.keys( ext_2_mime ).join("|")}/i` ) )){
    let ext = getExt( r.resource );
    const tags = await musicmetadata.parseFile( r.resource, { duration: false } ); // duration takes a long time for mp3 files...
    //console.log( "tagging....", r, tags )
    //r.path = tags.common.title ? tags.common.title : r.path;
    r.title = tags.common.title;
    r.artist = tags.common.artist;
    r.album = tags.common.album;
    if (tags.common.picture) {
      let picture = musicmetadata.selectCover( tags.common.picture ); // pick the cover image
      if (picture) {
        r.picture = convertBufferToImageEmbed( picture.data, picture.format );
        //console.log( "picture", r.picture )
      }
    }
    r.duration = tags.format.duration
    r.runningtime = tags.format.duration ? toHumanReadableTime( tags.format.duration ) : "??";
  }
}

function enrichDLNA( item, dlna_src, virtual_dir = "" ) {
  //VERBOSE && console.log( "enriching: ", item )
  [
    {dlna: 'title', item: 'title'},
    {dlna: 'title', item: 'name'},
    {dlna: 'album', item: 'album'},
    {dlna: 'artist', item: 'artist'},
    {dlna: 'genre', item: 'genre'},
    {dlna: 'art', item: 'art'},
    {dlna: 'icon', item: 'icon'},
    {dlna: 'description', item: 'description'},
    {dlna: 'file', item: 'content'},
  ].forEach( m => { if (dlna_src && dlna_src[m.dlna]) item[m.item] = dlna_src[m.dlna] } )
  item._type = item._type == undefined ? "dlna.object.container.storageFolder" : item._type;
  fillCategory( item );
  if (item.type == "file") item.content = item.resource;
  enrich( item, virtual_dir );
  return item;
}

function toHumanReadableTime( d ) {
  //return `${Math.floor(d / 60).toString()}:${Math.floor(d % 60).toString()}`   // 01:33
  return d < 60 ? `${Math.floor(d)}s` : (d / 60) < 60 ? `${Math.floor(d / 60).toString()}m` : `${Math.floor(d / (60*60)).toString()}h`     // 1m
}
function convertBufferToImageEmbed( buffer, format ) {
  return `data:${format};base64,` + buffer.toString('base64')
}
function convertFileToImageEmbed( fileURL ) {
  const filepath = fileURL.replace( /^file:\/\//, '' );
  let result = undefined;
  if (fs.existsSync( filepath ) && fs.statSync( filepath ).isFile()) {
    result = `data:${getMime(filepath)};base64,` + fs.readFileSync( filepath, { encoding: "base64" } )
  }
  return result;
}
function dlnaTimeToSeconds( hr ) {
  let s = hr.split( "." )
  let d = s[0].split( ":" )
  return (d[0] * 24 * 60 * 60) + (d[1] * 60 * 60) + (d[2] * 60) + s[1] // convert to number of seconds...
}
function replaceEnvVars( str ) {
  return str.replace( /\${([^}]+)}/g, (all, first) => process.env[first] ).replace( /~/, (all, first) => process.env.HOME )
}

// filename is relative (without a path), defaults to CONFIGNAME, and will be relative to the USERDIR (which depends on appname set by init())
function saveConfig( obj, filename = CONFIGNAME ) {
  let filepath = path.join( USERDIR, filename );
  fs.writeFileSync( filepath, JSON.stringify( obj, null, '  ' ), "utf8" )
  if (!fs.existsSync( filepath ))
    console.log( `[error] couldn't write to ${filepath}` )
}

// filename is relative (without a path), defaults to CONFIGNAME, and will be relative to the USERDIR (which depends on appname set by init())
function loadConfig( filename = CONFIGNAME, default_config_obj = DEFAULT_CONFIG ) {
  let filepath = path.join( USERDIR, filename );
  if (!fs.existsSync( filepath ))
    saveConfig( default_config_obj, filename );
  if (fs.existsSync( filepath )) {
    console.log( `[config] loaded from ${filepath}`)
    return JSON.parse( fs.readFileSync( filepath, 'utf-8' ) );
  }
  console.log( `[error] ${filepath} not found` )
  return {};
}

// like bash's mkdir -p, create the directory only if it doesn't already exist
function mkdir( dir ) {
  if (!fs.existsSync(dir)){
    VERBOSE && console.log( `[mkdir] creating directory ${dir}` )
    fs.mkdirSync(dir, { recursive: true });
  }
}

// get a name for the platform we're running on
function getPlatform() {
  return isPi() ? "pi" : process.platform;
}

function getUserDir( name ) {
  const appname = name;
  const dotappname = "." + name;
  // every path in the checklist needs to point to an app subfolder e.g. /subatomic3ditor,
  let checklist = {
    "pi": [
      path.join( "/media/pi/USB", appname ),
      path.join( "/media/pi/SDCARD", appname ),
      path.join( process.env.HOME, dotappname ),
      path.join( process.env.HOME, "Documents", appname ),
      path.join( process.env.HOME, "Downloads", appname ),
      path.join( process.env.HOME, "Desktop", appname ),
    ],
    "darwin": [
      path.join( process.env.HOME, "Library/Preferences", appname ),
      path.join( process.env.HOME, dotappname ),
      path.join( process.env.HOME, "Documents", appname ),
      path.join( process.env.HOME, "Downloads", appname ),
      path.join( process.env.HOME, "Desktop", appname ),
    ],
    "win32": [
      path.join( process.env.HOME, "AppData", appname ),
      path.join( process.env.HOME, dotappname ),
      path.join( process.env.HOME, "Documents", appname ),
      path.join( process.env.HOME, "Downloads", appname ),
      path.join( process.env.HOME, "Desktop", appname ),
    ],
    "linux": [
      path.join( process.env.HOME, dotappname ),
      path.join( process.env.HOME, "Documents", appname ),
      path.join( process.env.HOME, "Downloads", appname ),
      path.join( process.env.HOME, "Desktop", appname ),
    ],
    "unknown": [
      path.join( process.env.HOME, dotappname ),
      path.join( process.env.HOME, "Documents", appname ),
      path.join( process.env.HOME, "Downloads", appname ),
      path.join( process.env.HOME, "Desktop", appname ),
    ],
  }
  let platform = getPlatform();
  let cl = checklist[platform] ? checklist[platform] : checklist["unknown"];
  for (let d of cl) {
    // every path in the checklist points to an app subfolder /${name},
    // so check for the parent dir existing (we dont want to create Documents on a system that doesn't have it!)
    let onelevelup = d.replace( /[\\/][^\\/]+$/, "" )
    VERBOSE && console.log( `[getUserDir] checking "${d}", "${onelevelup}" == ${dirIsGood( onelevelup, true )}` )
    if (dirIsGood( onelevelup, true )) {
      mkdir( d );
      return d;
    }
  }
  VERBOSE && console.log( `[getUserDir] ERROR: no user directory found on this "${platform}" system!  After checking through these options: `, cl );
  return undefined;
}





//////////////////////////////////////////////////////////////
// directory abstraction: ROOT BOOKMARKS

// get a "directory listing" of the root bookmarks configured/saved.
async function dirRoot( resolve = false ) {
  let config = loadConfig()
  if (config && config.root_folder_listing) {
    let listing = config.root_folder_listing;
    listing = listing.map( r => { if (r.resource) r.resource = replaceEnvVars( r.resource ); return r } );
    // use for loop for async/await
    for (let i = 0; i < listing.length; ++i) {
      let r = listing[i];
      listing[i] = (r._type == undefined || r._type == "fs.dir" || r._type == "fs.file") ? await enrichFS( r ) : (r._type.match( /^dlna./ )) ? enrichDLNA( r ) : r;
    }
    if (resolve) listing = await resolveItems( listing ); // potentially expands certain single items to multiple
    return listing;
  }
  console.log( "[error] couldn't find config file for the root folder, see previous errors for diagnosis" )
  VERBOSE && process.exit( -1 );
}

//////////////////////////////////////////////////////////////
// directory abstraction: LOCAL FILESYSTEM

// get a directory listing of the filesystem path given
async function dirFS( dir, virtual_dir ) {
  VERBOSE && console.log( " - dirFS():", fsPath( dir ), virtual_dir );

  // get the directory listing:
  let result = fs.readdirSync( fsPath( dir ) )
    // map the result to our format
    .map( r => ({ path: r, resource: path.join( fsPath( dir ), r ) }) )

  // because of async/await, use for loop instead of map
  for (let i = 0; i < result.length; ++i) {
    result[i] = await enrichFS( result[i], virtual_dir )
  }

  // only let through dirs or audio files
  result = result.filter( r => r._type == "fs.dir" || (r._type == "fs.file" && r.ext && r.ext.match( /m4a|aac|mp3|wav/i )) ) // |txt|jpg|png|gif

  // add the .. folder (this filesystem type supports listing parent)
  let virtual_parent = getPath( virtual_dir );
  if (virtual_parent == '/') {
    let dotdot = JSON.parse( JSON.stringify( ROOTFOLDER ))
    dotdot.path = ".."
    result.unshift( dotdot );
  } else {
    let dotdot = { path: "..", resource: getPath( dir ) };
    dotdot = await enrichFS( dotdot, virtual_dir );
    result.unshift( dotdot );
  }

  // sort certain directories by time:
  if (dir.match( /\/(Documents|Downloads)$/ ))
    result = result.sort( (a, b) => a.time == b.time ? 0 : a.time < b.time ? 1 : -1 )

  return result;
}

//////////////////////////////////////////////////////////////
// directory abstraction: LOCAL DLNA/uPnP SERVERS

// get a "directory listing" of all DLNA/uPnP media servers on the network (if path is undefined)
// get a "directory listing" of the DLNA/uPnP content folder (if path is given)
async function dirDlna( path = undefined, virtual_dir = "", item ) {
  VERBOSE && console.log( " - dirDlna():", path, virtual_dir );

  if (path && path != "/") {
    let resource = path.split( "|" )
    let url = resource[0]
    let id = resource[1]
    VERBOSE && console.log( `dlna url: "${url}"` )
    VERBOSE && console.log( `dlna id:  "${id}"` )
    let dlna_listing = await dlna.content( [ "content", url, id ] );
    let listing = dlna_listing.items.map( r => {
      let result = { path: r.title, resource: url + "|" + r.id, resource_parent: url + "|" + r.parentID, _type: "dlna." + r.class, /*r: r*/ };
      if (r.file) { result.resource = r.file;  result.ext = getExt( r.file ); }
      if (r.file_size) result.file_size = r.file_size
      if (r.file_duration) {
        let s = r.file_duration.split( "." )
        let d = s[0].split( ":" )
        result.duration = (d[0] * 24 * 60 * 60) + (d[1] * 60 * 60) + (d[2] * 60) + s[1] // convert to number of seconds...
      }
      if (r.file_duration) result.runningtime = r.file_duration
      return enrichDLNA( result, r, virtual_dir )
    })
    // ok... we can't support "..", because we dont get a parent ID for the _current_ directory, only the parent of the children (which is the ID for the cwd)
    // so.   the frontend media player will need to implement a browser "<" back button based on history (a good idea anyways).
    // let dotdot = enrichDLNA( { path: "..", name: getFoldername( virtual_dir ), resource: item.resource_parent }, virtual_dir )
    // listing.unshift( dotdot )
    return listing;
  } else {
    let disc = await dlna.info();
    return Object.keys( disc ).map( r => enrichDLNA( { path: disc[r].name, resource: disc[r].contentdir_control_url + "|0", _type: "dlna.mediaserver" }, virtual_dir ) );
  }
}

// end of directory abstractions
//////////////////////////////////////////////////////////////


// resolve works by replacing a placeholder item with whatever items were found
// the placeholder is something that takes time to find, so it's lazy loaded later
async function resolveItems( items ) {
  for (let i = items.length - 1; 0 <= i; --i) {
    if (items[i]._type == "dlna.discovery") {
      let new_items = await dirDlna();
      console.log( "resolving", items[i] )
      new_items.map( r => r.abs_path = items[i].abs_path + "/" + r.path )
      if (new_items.length > 0) {
        items.splice( i, 1 ); // erase the item...
        items = items.concat( new_items )
      }
    }
  }
  return items;
}




//////////////////////////////////////////////////////////////
// PUBLIC API

// initialize the library before using the API functions.
// appname - important to name your application to distinguish configuration settings between multiple apps that use media-fs
function init( options = { configname: ".config", appname: "media-fs" } ) {
  if (options.appname) USERDIR = getUserDir( options.appname );
  if (options.configname) CONFIGNAME = options.configname;
}
module.exports.init = init;


// return a listing at the directory (recursive utility)
// path    - the virtual absolute path "/Music" (listing must be undefined) or virtual relative path "Music" (requires a listing).
//           dir() or dir( "/" ) retrieves the root of the virtual filesystem
// listing - when using a virtual relative path, supply the path's parent folder listing.  Avoids redundant lookups (single lookup for each relative path).
// resolve - certain types are lazy loaded, like _type="dlna.discovery", call dir( "/" ) then dir( "/", undefined, true ) to replace the list item with it's children
async function dir( path = "/", listing = undefined, resolve = false, absolute_path = "", previous_item = undefined ) {
  //VERBOSE && console.log( "dir", path, listing, resolve )
  // sanitize erroneous /'s
  path = path.replace( /\/+/, "/" ).replace( /(.+)\/$/, "$1" )

  // absolute path given (no listing to start from), so interpret relative path "Music" as absolute "/Music"
  if (listing == undefined && path[0] != "/")
    path = '/' + path

  // parse the path requested
  let first_path = path.split( "/" )[0];                    // when path == "/Music/Ableton/Presets", this will be ""                       |   when path == "Music/Ableton/Presets", this will be "Music"
  let next_path = path.split( "/" ).slice( 1 ).join( "/" )  // when path == "/Music/Ableton/Presets", this will be "Music/Ableton/Presets"  |   when path == "Music/Ableton/Presets", this will be "Ableton/Presets"
  VERBOSE && console.log( `first_path: ${first_path} next_path: ${next_path}`  )

  // SEED: create a listing for "/" root, so we can find the "/" item to recurse from
  if (listing == undefined)
    listing = [JSON.parse( JSON.stringify( ROOTFOLDER ))];

  // we support relative path(s) or absolute:
  // - abs:  path "/Music" or "Music" given without listing (recursion begins relative to root in absense of a previous listing given)
  // - rel:  path "Music"  given with a listing
  let item = listing.find( r => r.path == (first_path == "" ? "/" : first_path) );
  // previous_item = previous_item == undefined && listing ? listing.find( r => r.path == "." ) : previous_item;  // pull the previous item out of the listing if it's not set (for relative path)

  // VERBOSE && console.log( " - listing", listing )
  // VERBOSE && console.log( " - item found from listing:", item )

  // unable to recurse any farther, tail recursion end case, just return the listing
  if (item == undefined) return listing;

  // if going back...
  // if (item.path == "..") {
  //   item.path = item._path;
  //   item.name = item._name;
  // }
  
  absolute_path = eliminateDotDot( item.abs_path_parent + (item.abs_path_parent == "/" ? "" : "/") + first_path )

  //if (previous_item) { previous_item._name = previous_item.name; previous_item._path = previous_item.path; previous_item.name = ".."; previous_item.path = ".."; if (previous_item.previous_item) delete previous_item.previous_item; }
  //let back_item = previous_item;
  let back_item = undefined;

  console.log( `Listing: "${item.path}" (${item._type})  -->  ${absolute_path}` )
  switch (item._type) {
    case "root":
      listing = await dirRoot( resolve );
      //back_item = JSON.parse( JSON.stringify( item ) );
      break;

    case "dlna.object.item.audioItem.musicTrack":
    case "fs.file":
      listing = [item];
      break;

    case "fs.dir":
      if (dirIsGood( item.resource )) {
        listing = await dirFS( item.resource, absolute_path );
      }
      break;

    case "dlna.discovery":
      listing = await dirDlna( undefined, absolute_path )
      break;

    default:
      // handle all other "dlna.*" types here:
      //console.log( item )
      if (item._type.match( /^dlna\./ )) {
        listing = await dirDlna( item.resource, absolute_path )
      }
      break;
  }

  item.path = "."
  listing.unshift( item );
  if (next_path == "")
    return listing //.map( r => { if (previous_item) r.previous_item = previous_item; return r; } )
  else
    return await dir( next_path, listing, resolve, absolute_path, item )
}

module.exports.dir = dir;

// debugging verbosity, default false
module.exports.setVerbose = ( verbose = false ) => { VERBOSE = verbose }

// remove a bookmark from the root.  written to configuration settings, persists across app load
function delRootBookmark( path ) {
  let config = loadConfig()
  if (config && config.root_folder_listing) {
    config.root_folder_listing = config.root_folder_listing.filter( r => r.path != path )
    saveConfig( config )
  }
}

// add a bookmark to the root.  written to configuration settings, persists across app load
function addRootBookmark( obj ) {
  if (obj.path && (obj._type || obj.resource)) {
    let config = loadConfig()
    if (config && config.root_folder_listing) {
      config.root_folder_listing.push( obj )
      saveConfig( config )
    }
  }
}

// add a (LocalFS path) bookmark to the root.  written to configuration settings, persists across app load
function addRootBookmark_FS( fs_path ) {
  addRootBookmark( { path: getFoldername( fs_path ), resource: fs_path } )
}

// add a (dlna discovery) bookmark to the root.  written to configuration settings, persists across app load
function addRootBookmark_DLNA() {
  addRootBookmark( { path: "uPnP Media Servers", _type: "dlna.discovery" } )
}

module.exports.delRootBookmark = delRootBookmark
module.exports.addRootBookmark_FS = addRootBookmark_FS
module.exports.addRootBookmark_DLNA = addRootBookmark_DLNA
