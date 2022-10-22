let dlna = require( 'dlnajs/dlna.js' );
let xhr = require( 'xhrjs/xhr.js' ).xhr;
let fs = require( 'fs' );
let path = require( 'path' );
let musicmetadata = require( 'music-metadata' );
let isPi = require( 'detect-rpi' ); // detect raspberry pi

let fs_cache;
function fs_reset() {
  fs_cache = {};
}
function fs_existsSync( file ) {
  if (fs_cache == undefined) fs_reset();
  if (fs_cache[file]) return true;
  if (fs.existsSync( file )) {
    fs_cache[file] = {}
    fs_cache[file].stat = fs.statSync( file );
    return true;
  }
  return false;
}
function fs_statSync( file ) {
  if (fs_existsSync( file )) return fs_cache[file].stat;

  // not found at all.
  return {
    isDirectory: () => false,
    isFile: () => false,
    mtimeMs: -1,
  };
}
function fs_checkPermissions( file, perms = fs.R_OK | fs.W_OK ) {
  if (fs_existsSync( file )) {
    if (fs_cache[file].read == undefined) {
      fs_cache[file].read = checkPermissions( file, fs.R_OK );
      fs_cache[file].write = checkPermissions( file, fs.W_OK );
    }
    return (((perms & fs.R_OK) == fs.R_OK && fs_cache[file].read) || ((perms & fs.R_OK) == 0)) && (((perms & fs.W_OK) == fs.W_OK && fs_cache[file].write) || ((perms & fs.W_OK) == 0));
  }
  return false;
}
async function fs_media( file, options = { duration: false } ) {
  if (isAudioFile( file )) {
    if (fs_cache[file].media_tags) return fs_cache[file].media_tags;

    let tags = await musicmetadata.parseFile( file, options ); // duration takes a long time for mp3 files...
    if (fs_cache[file]) // the await above means that another process could have fs_reset() and caused this to be undefined.
      fs_cache[file].media_tags = tags;
    return tags;
  }
}
async function fs_getImageFromMetadata( file ) {
  if ("image" in fs_cache[file]) return fs_cache[file].image;
  const tags = await fs_media( file, { duration: false } ); // duration takes a long time for mp3 files...
  if (tags && tags.common.picture) {
    let picture = musicmetadata.selectCover( tags.common.picture ); // pick the cover image
    if (picture) {
      let image = convertBufferToImageEmbed( picture.data, picture.format );
      if (fs_cache[file]) // the await above means that another process could have fs_reset() and caused this to be undefined.
        fs_cache[file].image = image;
      //VERBOSE && console.log( "[mediafs] picture", r.picture )
      return image;
    }
  }
  if (fs_cache[file]) // the await above means that another process could have fs_reset() and caused this to be undefined.
    fs_cache[file].image = undefined;
  return undefined;
}

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
let CACHENAME = ".cache";
const ROOTFOLDER = { name: "/", path: "/", _type: "root", type: "dir", resource: "root:///", resource_parent: "root:///", abs_path: "", abs_path_parent: "", abs_path_top: "" }
let VERBOSE=false;
let USERDIR = getUserDir( "media-fs" );
const DEFAULT_IMAGE_FS="assets/default.png";
const DEFAULT_IMAGE=`file://${DEFAULT_IMAGE_FS}`;
const DEFAULT_AUDIO_IMAGE_FS="assets/default-audio2.png";
const DEFAULT_AUDIO_IMAGE=`file://${DEFAULT_AUDIO_IMAGE_FS}`;
const DEFAULT_DLNA_IMAGE_FS="assets/default-dlna.png";
const DEFAULT_DLNA_IMAGE=`file://${DEFAULT_DLNA_IMAGE_FS}`;

/// cache
/// maps abs path to resource locator, flat
// let cache = {
//   "Downloads": {
//     item: { ... },
//     listing: [] // what dir( path ) normally returns
//   }
// };
let cache;
function setCache( path, item, listing ) {
  if (path != "")
    cache[path] = {
      item: item,
      listing: listing
    }
  saveStore( cache, CACHENAME );
}
function getCache( path ) {
  if (cache == undefined) {
    cache = loadStore( CACHENAME, {} );
  }
  return cache[path];
}



//////////////////////////////////////////////////////////////
// UTILITIES

// deeply clone an object hierarchy
function deepClone( obj ) {
  if (obj == undefined) return undefined;
  return JSON.parse( JSON.stringify( obj ) );
}

// filter the path to NOT have file://
function fsPath( path ) {
  return path && path.match( /^file:\/\// ) ? path.replace( /^file:\/\//, "" ) : path
}

// filter the path to have file://
function httpPath( path ) {
  return path && (!path.match( /^file:\/\// )) ? ("file://" + path) : path
}

// fs.accessSync is so close, yet just not there.   Make it return true/false:
function checkPermissions( file, perms = fs.R_OK | fs.W_OK ) {
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
  return fs_existsSync( path ) && fs_checkPermissions( path, perms ) && fs_statSync( path ).isDirectory()
}

// is the file good to read/write?
function fileIsGood( path, writable = false ) {
  path = fsPath( path )
  let perms = fs.constants.R_OK;
  if (writable) perms = perms | fs.constants.W_OK;
  return fs_existsSync( path ) && fs_checkPermissions( path, perms ) && fs_statSync( path ).isFile()
}

// LocalFS metadata: get the mime type for the filename based on extension
function getMime( filename ) {
  switch (getExt( filename )) {
    case "jpg": return "image/jpeg";
    case "png": return "image/png";
    case "gif": return "image/gif";
    case "wav": return "audio/wav";
    case "mp3": return "audio/mp3";
    case "m4a": return "audio/x-m4a";
    case "aac": return "audio/aac";
    default: return "data/blob" // todo: what's the real type here?
  }
}

// LocalFS metadata: get the type of LocalFS object pointed to by the path, fs.dir or fs.file
function getType( path ) {
  try {
    let type = fs_statSync( fsPath( path ) ).isDirectory() ? "fs.dir" : "fs.file"
    //console.log( type , path )
    return type;
  } catch (e) {
    return "unreadable";
  }
}

// LocalFS metadata: get the timestamp of the fs object
function getTime( path ) {
  try {
    return fs_statSync( fsPath( path ) ).mtimeMs;
  } catch (e) {
    return -1;
  }
}


// get the file extension  e.g. "mp3", or "" when none
// function getExt( path ) {
//   return path.replace( /^.*([^.]+)$/, "$1" ).toLowerCase()
// }
function getExt( filename ) {
  let m = filename ? filename.replace( /^.*\.([^\.]+)$/, "$1" ) : "";
  //console.log( path, m )
  return m;
}

// get the file path e.g.:
// - "/path/to/Downloads" from "/path/to/Downloads/myfile.m4a"
// - "Downloads" from "Downloads/myfile.m4a"
// - "" from "Downloads"
function getPath( filepath ) {
  return filepath ? (filepath.match( /\// ) ? filepath.replace( /\/[^\/]+$/, "" ).replace( /^$/, "/" ) : "") : ""
}

// getPath tests
(()=>{
  function testGetPath( a, b ) { if (getPath( a ) != b) console.log( `TEST FAILED: ${getPath( a )} != ${b}` ) }
  testGetPath( "/path/to/Downloads/myfile.m4a", "/path/to/Downloads" )
  testGetPath( "Downloads/myfile.m4a", "Downloads" )
  testGetPath( "Downloads", "" )
})()

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

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// FILESYSTEM FILE/FOLDER ICON
async function getImage( filepath, dircache ) {
  //console.log( "[getImage] ", filepath )
  filepath = fsPath( filepath );
  let images = [];
  if (filepath == undefined) return DEFAULT_IMAGE_FS



  function escForRegex( str ) {
    return str ? str.replace( /([./])/g, `\\$1` ) : ""
  }

  function folderImages( filepath, names = ["Folder","folder","FOLDER"], types = ["jpg","png","gif", "JPG","PNG","GIF"] ) {
    return names.flatMap( r => types.map( f => path.join( filepath, `${r}.${f}` ) ));
  }

  function folderAudioFiles( filepath ) {
    if (!fs_statSync( filepath ).isDirectory() || !fs_checkPermissions( filepath, fs.R_OK )) return [];

    let files = fs.readdirSync( filepath )
    let ranking = {
      m4a: 1,
      mp3: 2,
      //flac: 3,
      //ogg: 4,
      //wav: 5,
    }
    files = files.map( r => path.join( filepath, r ) )
    files = files.filter( r => ranking[getExt( r )] != undefined && fs_existsSync( r ) )
    files = files.sort( (a, b) => (ranking[getExt( a )] || 4) < (ranking[getExt( b )] || 4) ? -1 : 1 );
    return files;
  }

  function findRoot( filepath ) {
    // read the global root_listing which should be up to date...
    let root_dir = deepClone( root_listing );
    if (root_dir) {
      root_dir = root_dir.filter( r => {
        //console.log( `regex:    "^${escForRegex( r.resource )}"` )
        return filepath.match( new RegExp( `^${escForRegex( r.resource )}` ) )
      })
    }
    return root_dir && root_dir.length > 0 && root_dir[0].resource ? root_dir[0].resource : `/NOT/FOUND/ROOT/OF/${filepath}/NOT/FOUND/IN/CONFIGURED/ROOT/FOLDERS`;
  }

  function allPathsBackToRoot( filepath, maxpaths = 10 ) {
    let retval = [];

    if (fs_statSync( filepath ).isFile()) {
      if (isAudioFile( filepath ))
        retval.push( filepath );                                                         // see if  /filepath/filename.m4a  has an embedded picture
      retval.push( ...folderImages( getPath( filepath ), [getFilename( filepath )] ) );  // see if  /filepath/filename.jpg  exists
      filepath = getPath( filepath )                                                     // fallback to dir (for folder.jpg or dirname.jpg or <somefile>.m4a image)
      if (!fs_statSync( filepath ).isDirectory()) return;                                // should be a dir
    }

    let root_path = findRoot( filepath );
    //console.log( "[allPathsBackToRoot]   roooooot path: ", root_path, );
    while (filepath && 0 <= (--maxpaths) && root_path && filepath != "/" && filepath.match( new RegExp( `^${escForRegex( root_path )}` ) )) {
      //console.log( "[allPathsBackToRoot]   - parent", filepath )
      retval.push( ...folderImages( filepath ) );                                          // see if  /filepath/folder.jpg exists
      retval.push( ...folderImages( getPath( filepath ), [getFilename( filepath )] ) );    // see if  /filepath/../dirname.jpg  exists (weird, but ok)
      retval.push( ...folderAudioFiles( filepath ) );                                      // see if  /filepath/<somefile>.m4a  has an embedded picture
      filepath = getPath( filepath );
    }
    return retval;
  }

  images.push( ...allPathsBackToRoot( filepath, 1 ) )
  images.push( isAudioFile( filepath ) ? DEFAULT_AUDIO_IMAGE_FS : DEFAULT_IMAGE_FS )
  //console.log( "trying these: ", images );
  let image = DEFAULT_IMAGE;
  let num = 0;
  let num_hits = 0;
  let num_false_hits = 0;
  const start = performance.now();
  for (let img of images) {
    num++;
    if (isAudioFile( img )) {
      image = await fs_getImageFromMetadata( img )
      if (image) {
        num_hits++;
        break;
      } else {num_false_hits++;}
    } else if (fs_existsSync( img )) {
      image = "file://" + img;
      num_hits++;
      break;
    }
  }
  const end = performance.now();
  //if (Math.floor(end - start) > 40) {
  //  console.log( "trying these: ", images );
  //}
  //console.log( `finding image for: "${filepath}" => ${image.slice( 0, 100 )}  num:${num} hits:${num_hits} fhits:${num_false_hits} time:${Math.floor(end - start)}ms` );
  if (num_hits > 1) {
    process.exit(-1);
  }
  return image;
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

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
  item.abs_path = eliminateDotDot( path.join( virtual_dir, item.path ) ).replace( /^([^/])/, "/$1" );
  item.abs_path_parent = getPath( item.abs_path ).replace( /^([^/])/, "/$1" );

  // put special things into "." entry
  if (item.path == ".") {
    item.abs_path_top = item.abs_path_parent.replace( /^(\/[^\/]+).*$/, "$1" ).replace( /^([^/])/, "/$1" );
  }
//   console.log( `enrich():
// - virtual dir:          "${virtual_dir}"
// - item.path:            "${item.path}"
// - item.abs_path:        "${item.abs_path}"
// - item.abs_path_parent: "${item.abs_path_parent}"` )
}

async function enrichFS( item, virtual_dir = "" ) {
  item.image = DEFAULT_IMAGE;
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
  item.image = await getImage( item.resource );
  if (item._type == "fs.file") item.content = httpPath( item.resource );
  item.resource_parent = item.abs_path_parent == '/' ? undefined : item.resource.replace( /\/[^\/]+$/, "" ).replace( /^$/, "/" );

  // Audio metadata:
  await enrichFS_Audio( item, virtual_dir );

  return item;
}

async function enrichRoot( item, virtual_dir = "" ) {
  item.name = "/"
  item._type = "root"
  item.image = DEFAULT_IMAGE;
  return item;
}

function isAudioFile( filepath ) {
  const ext_2_mime = {
    m4a: "audio/mp4",
    aac: "audio/aac",
    mp3: "audio/mpeg",
    wav: "audio/x-wav",
  }
  let ext = getExt( filepath );
  let is_audio_file = ext && ext_2_mime[ext.toLowerCase()] && fs_existsSync( filepath ) && fs_statSync( filepath ).isFile();
  return is_audio_file;
}
async function enrichFS_Audio( r, virtual_dir = "" ) {
  //VERBOSE && console.log( `[mediafs] ${r._type == "fs.file" ? r.ext : r._type} Audio File:`, is_audio_file, is_audio_file_pattern )
  if (isAudioFile( r.resource )){
    //let ext = getExt( r.resource );
    const tags = await fs_media( r.resource, { duration: false, picture: false } ); // duration takes a long time for mp3 files...
    //VERBOSE && console.log( "[mediafs] pulling metatags....", r, tags )
    //r.path = tags.common.title ? tags.common.title : r.path;
    r.title = tags.common.title;
    r.artist = tags.common.artist;
    r.album = tags.common.album;
    // if (tags.common.picture) {
    //   let picture = musicmetadata.selectCover( tags.common.picture ); // pick the cover image
    //   if (picture) {
    //     r.image = convertBufferToImageEmbed( picture.data, picture.format );
    //     //VERBOSE && console.log( "[mediafs] picture", r.picture )
    //   }
    // }
    r.duration = tags.format.duration
    r.runningtime = tags.format.duration ? toHumanReadableTime( tags.format.duration ) : "??";
  }
}

function enrichDLNA( item, dlna_src = undefined, virtual_dir = "" ) {
  item.image = DEFAULT_DLNA_IMAGE;
  //VERBOSE && console.log( "enriching DLNA: ", item );
  //console.log( `=================================\nenriching DLNA: path: "${item.path}" abs_path: "${item.abs_path}" virtual: "${virtual_dir}"` );

  // copy dlna item fields into the item, if given
  [
    {dlna: 'title', item: 'title'},
    {dlna: 'title', item: 'name'},
    {dlna: 'album', item: 'album'},
    {dlna: 'artist', item: 'artist'},
    {dlna: 'genre', item: 'genre'},
    {dlna: 'icon', item: 'image'},
    {dlna: 'art', item: 'image'},
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
  if (fs_existsSync( filepath ) && fs_statSync( filepath ).isFile()) {
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

// filename is relative (without a path), and will be relative to the USERDIR (which depends on appname set by init())
function saveStore( obj, filename ) {
  let filepath = path.join( USERDIR, filename );
  fs.writeFileSync( filepath, JSON.stringify( obj, null, '  ' ), "utf8" )
  if (!fs_existsSync( filepath ))
    console.log( `[error] couldn't write to ${filepath}` )
}

// filename is relative (without a path), and will be relative to the USERDIR (which depends on appname set by init())
function loadStore( filename, default_obj ) {
  let filepath = path.join( USERDIR, filename );
  if (!fs_existsSync( filepath ))
    saveStore( default_obj, filename );
  if (fs_existsSync( filepath )) {
    console.log( `[store] loaded: ${filepath}`)
    return JSON.parse( fs.readFileSync( filepath, 'utf-8' ) );
  }
  console.log( `[error] ${filepath} not found` )
  return {};
}

// like bash's mkdir -p, create the directory only if it doesn't already exist
function mkdir( dir ) {
  if (!fs_existsSync(dir)){
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

let root_listing = [];


// will update the global root_listing when called...
function getConfiguredRoot() {
  let config = loadStore( CONFIGNAME, DEFAULT_CONFIG );
  if (config && config.root_folder_listing) {
    let listing = config.root_folder_listing;
    listing = listing.map( r => { if (r.resource) r.resource = replaceEnvVars( r.resource ); return r } );
    root_listing = deepClone( listing )
    return listing;
  }
  return undefined;
}

// get a "directory listing" of the root bookmarks configured/saved.
async function dirRoot( resolve = false ) {
  //console.log( "[dirRoot]")
  let listing = getConfiguredRoot();
  if (listing) {
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
    let dotdot = deepClone( ROOTFOLDER )
    dotdot.path = ".."
    dotdot = await enrichRoot( dotdot, virtual_dir );
    //console.log( ".. ============ROOT=================", dotdot );
    result.unshift( dotdot );
  } else {
    let dotdot = { path: "..", resource: getPath( dir ) };
    dotdot = await enrichFS( dotdot, virtual_dir );
    //console.log( ".. =============PARENT================", dotdot );
    result.unshift( dotdot );
  }

  // sort certain directories by time:
  if (dir.match( /\/(Documents|Downloads)$/ ))
    result = result.sort( (a, b) => a.time == b.time ? 0 : a.time < b.time ? 1 : -1 ).sort( (a,b) => a.path == ".." ? -1 : 0 ).sort( (a,b) => a.path == "." ? -1 : 0 )

  return result;
}

//////////////////////////////////////////////////////////////
// directory abstraction: LOCAL DLNA/uPnP SERVERS

// get a "directory listing" of all DLNA/uPnP media servers on the network (if path is undefined)
// get a "directory listing" of the DLNA/uPnP content folder (if path is given)
async function dirDlna( path = undefined, virtual_dir = "", item ) {
  VERBOSE && console.log( ` - dirDlna(): path:"${path}" virtual:"${virtual_dir}"` );
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
    //console.log( "DLNA DISCOVERY INFO:", disc )
    return Object.keys( disc ).map( r => enrichDLNA(
        { path: disc[r].name, resource: disc[r].contentdir_control_url + "|0", _type: "dlna.mediaserver" },
        undefined,
        virtual_dir
      )
    );
  }
}

// end of directory abstractions
//////////////////////////////////////////////////////////////


// resolve works by replacing a placeholder item with whatever items were found
// the placeholder is something that takes time to find, so it's lazy loaded later
async function resolveItems( items ) {
  //console.log( "RESOLVE" )
  for (let i = items.length - 1; 0 <= i; --i) {
    if (items[i]._type == "dlna.discovery") {
      let new_items = await dirDlna();
      //console.log( "resolving", items[i] )
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
let initFinished = false;
function init( options = { configname: ".config", appname: "media-fs" } ) {
  console.log( "[media-fs]  initializing...")
  if (options.appname) USERDIR = getUserDir( options.appname );
  if (options.configname) CONFIGNAME = options.configname;
  getConfiguredRoot(); // updates root_listing
  initFinished = true;
}
module.exports.init = init;

async function waitForTrue( v, timeout_sec = 5 ) {
  return new Promise( (rs, rj) => {
    if (v == true) return rs();
    let startTime = new Date();
    let handle = setInterval( () => {
      let endTime = new Date();
      var timeDiff = (endTime - startTime)/1000;
      if (timeout_sec < timeDiff) {
        console.log( "timeout! v:", v )
        clearInterval( handle );
        return rs();
      } else if (v == true) {
        console.log( "it's finally true! timeout_sec:", timeout_sec )
        clearInterval( handle );
        return rs();
      } else {
        console.log( "waiting for true..." )
      }
    }, 1)
  })
}

// return a listing at the directory (recursive utility)
// path    - the virtual absolute path "/Music" (listing must be undefined) or virtual relative path "Music" (requires a listing).
//           dir() or dir( "/" ) retrieves the root of the virtual filesystem
// listing - when using a virtual relative path, supply the path's parent folder listing.  Avoids redundant lookups (single lookup for each relative path).
// resolve - certain types are lazy loaded, like _type="dlna.discovery", call dir( "/" ) then dir( "/", undefined, true ) to replace the list item with it's children
// force   - do not use the cache, fetch everything
// absolute_path - used for path recursion, use the default value when dalling dir()
async function dir( vpath = "/", listing = undefined, resolve = false, force = false, absolute_path = "" ) {
  await waitForTrue( initFinished );
  VERBOSE && console.log( "dir", vpath, listing, resolve, force, absolute_path )
  //console.log( `dir  abs_path:${absolute_path}` )
  // sanitize erroneous /'s
  vpath = vpath.replace( /\/+/, "/" ).replace( /(.+)\/$/, "$1" )

  // absolute path given (no listing to start from), so interpret relative path "Music" as absolute "/Music"
  if (listing == undefined && vpath[0] != "/")
    vpath = '/' + vpath

  // parse the vpath requested
  let first_path = vpath.split( "/" )[0];                    // when vpath == "/Music/Ableton/Presets", this will be ""                       |   when vpath == "Music/Ableton/Presets", this will be "Music"
  let next_path = vpath.split( "/" ).slice( 1 ).join( "/" )  // when vpath == "/Music/Ableton/Presets", this will be "Music/Ableton/Presets"  |   when vpath == "Music/Ableton/Presets", this will be "Ableton/Presets"
  VERBOSE && console.log( `first_path: ${first_path} next_path: ${next_path}`  )
  absolute_path = absolute_path + (absolute_path == "/" ? "" : "/") + first_path

  // SEED: create a listing for "/" root, so we can find the "/" item to recurse from
  if (listing == undefined)
    listing = [deepClone( ROOTFOLDER )];

  // we support relative path(s) or absolute:
  // - abs:  path "/Music" or "Music" given without listing (recursion begins relative to root in absense of a previous listing given)
  // - rel:  path "Music"  given with a listing
  let item = deepClone( listing.find( r => r.path == (first_path == "" ? "/" : first_path) ) );

  VERBOSE && console.log( " - listing", listing )
  VERBOSE && console.log( " - item found from listing:", item )

  // unable to recurse any farther, tail recursion end case, just return the listing
  //if (item == undefined && next_path) return listing;
  if (item == undefined) return listing;

  // if going back...
  // if (item.path == "..") {
  //   item.path = item._path;
  //   item.name = item._name;
  // }

  //absolute_path = eliminateDotDot( item.abs_path_parent + (item.abs_path_parent == "/" ? "" : "/") + first_path )

  console.log( `Listing: "${item.path}" (${item._type})  -->  ${absolute_path}` )
  // use cache for parent-traversal, but always re-pull the requested path
  if (getCache( absolute_path ) && next_path != "" && force == false) {
    listing = getCache( absolute_path ).listing;
    //console.log( `CACHE HIT: ${absolute_path}`, next_path )
  } else {
    switch (item._type) {
      case "root":
        listing = await dirRoot( resolve );
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

    //console.log( `CACHE MISS: ${absolute_path}`, getCache( absolute_path ) != undefined, next_path == "", next_path )

    // cache anything we retrieve so it's faster next time.
    setCache( absolute_path, item, listing );
  }

  item.path = "."
  listing.unshift( item );
  if (next_path == "") {
    fs_reset(); // done... clear the quick fs stat cache
    return listing
  }
  else
    return await dir( next_path, listing, resolve, force, absolute_path )
}

module.exports.dir = dir;

// debugging verbosity, default false
module.exports.setVerbose = ( verbose = false ) => { VERBOSE = verbose }

// remove a bookmark from the root.  written to configuration settings, persists across app load
function delRootBookmark( path ) {
  let config = loadStore( CONFIGNAME, DEFAULT_CONFIG );
  if (config && config.root_folder_listing) {
    config.root_folder_listing = config.root_folder_listing.filter( r => r.path != path )
    saveStore( config, CONFIGNAME )
    getConfiguredRoot(); // update root_listing
  }
}

// add a bookmark to the root.  written to configuration settings, persists across app load
function addRootBookmark( obj ) {
  if (obj.path && (obj._type || obj.resource)) {
    let config = loadStore( CONFIGNAME, DEFAULT_CONFIG );
    if (config && config.root_folder_listing) {
      config.root_folder_listing.push( obj )
      saveStore( config, CONFIGNAME )
      getConfiguredRoot(); // update root_listing
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
