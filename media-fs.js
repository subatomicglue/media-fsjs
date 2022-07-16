let dlna = require( 'dlnajs/dlna.js' );
let xhr = require( 'xhrjs/xhr.js' ).xhr;
let fs = require( 'fs' );
let path = require( 'path' );
let musicmetadata = require( 'music-metadata' );

// config data
let configname = ".config";
const ROOTFOLDER = { name: "/", path: "/", _type: "root", type: "dir", fullpath: "root:///", fullpath_parent: "root:///", abs_path: "/", abs_path_parent: "/", root_path: "/" }
let VERBOSE=false;

//////////////////////////////////////////////////////////////
// UTILITIES

// fs.accessSync is so close, yet just not there.   Make it return true/false:
function checkPermissions( file, perms ) {
  try {
    fs.accessSync(file, perms);
    return true;
  } catch (err) {
    return false;
  }
}
function getExt( path ) {
  return path.replace( /^.*([^.]+)$/, "$1" ).toLowerCase()
}
function dirIsGood( path, writable = false ) {
  let perms = fs.constants.R_OK;
  if (writable) perms = perms | fs.constants.W_OK;
  return fs.existsSync( path ) && checkPermissions( path, perms ) && fs.statSync( path ).isDirectory()
}
function fileIsGood( path, writable = false ) {
  let perms = fs.constants.R_OK;
  if (writable) perms = perms | fs.constants.W_OK;
  return fs.existsSync( path ) && checkPermissions( path, perms ) && fs.statSync( path ).isFile()
}
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

function getType( fullpath ) {
  try {
    let type = fs.statSync( fullpath ).isDirectory() ? "fs.dir" : "fs.file"
    //console.log( type , fullpath )
    return type;
  } catch (e) {
    return "unreadable";
  }
}

function getTime( fullpath ) {
  try {
    return fs.statSync( fullpath ).mtimeMs;
  } catch (e) {
    return -1;
  }
}

function getExt( filename ) {
  let m = filename ? filename.match( /\.[^\.]+$/ ) : "";
  //console.log( path, m )
  return m ? m[0] : ""
}

function getPath( filepath ) {
  return filepath ? filepath.replace( /\/[^\/]+$/, "" ).replace( /^$/, "/" ) : ""
}

function getFilename( filepath ) {
  return filepath ? filepath.replace( /^.*\//, "" ).replace( /\.[^\.]+$/, "" ) : ""; // remove path and ext
}
function getFoldername( filepath ) {
  return filepath ? filepath.replace( /^.*?([^\/]+)$/, "$1" ) : ""; // remove path and ext
}
function getParentname( filepath ) {
  return filepath ? filepath.replace( /[^\/]+$/, "" ).replace( /\/$/, "" ).replace( /^.*\//, "" ).replace( /^$/, "/" ) : ""; // remove path and ext
}
function eliminateDotDot( filepath ) {
  return filepath ? filepath.replace( /\/[^\/]+\/\.\./g, "" ).replace( /^$/, "/" ) : ""
}

function shortenImageName( i, rootdir ) {
  return i ? i.replace( "file://" + rootdir + "/", "" ).replace( /\.[^\.]+$/, "" ) : ""
}

function getImage( filepath ) {
  if (filepath == undefined) return "assets/default.png"

  // if (fs.statSync( filepath ).isDirectory()) {
  // }
  let path_filename = path.join( getPath( filepath ), getFilename( filepath ) );
  let image = (
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
function enrichFS( item, virtual_dir = "" ) {
  //VERBOSE && console.log( "enriching: ", item )
  item.name = getFilename( item.fullpath );
  if (getExt( item.fullpath ) != "")
    item.ext = getExt( item.fullpath );
  item._type = item._type == undefined ? getType( item.fullpath ) : item._type;
  fillCategory( item );
  item.time = getTime( item.fullpath );
  item.image = getImage( item.fullpath );
  enrich( item, virtual_dir );
  item.fullpath_parent = item.abs_path_parent == '/' ? undefined : item.fullpath.replace( /\/[^\/]+$/, "" ).replace( /^$/, "/" );
  return item;
}

function enrichDLNA( item, virtual_dir = "" ) {
  //VERBOSE && console.log( "enriching: ", item )
  item.name = getParentname( virtual_dir );
  item._type = item._type == undefined ? "dlna.object.container.storageFolder" : item._type;
  fillCategory( item );
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



//////////////////////////////////////////////////////////////
// directory abstraction: ROOT BOOKMARKS

// get a "directory listing" of the root bookmarks configured/saved.
async function dirRoot( resolve = false ) {
  if (!fs.existsSync( configname )) {
    fs.writeFileSync( configname, JSON.stringify([
      { path: "Music", fullpath: path.join( process.env.HOME, "Music" ) },
      { path: "Documents", fullpath: path.join( process.env.HOME, "Documents" ) },
      { path: "Downloads", fullpath: path.join( process.env.HOME, "Downloads" ) },
      { path: "uPnP Media Servers", _type: "dlna.discovery" },
    ]), "utf8" )
  }
  if (fs.existsSync( configname )) {
    let config = JSON.parse( fs.readFileSync( configname, 'utf-8' ) )
    config = config.map( r => (r._type == undefined || r._type == "fs.dir" || r._type == "fs.file") ? enrichFS( r ) : (r._type.match( /^dlna./ )) ? enrichDLNA( r ) : r );
    if (resolve) config = await resolveItems( config ); // potentially expands certain single items to multiple
    return config;
  }
  process.exit( -1 );
}

//////////////////////////////////////////////////////////////
// directory abstraction: LOCAL FILESYSTEM

// get a directory listing of the filesystem path given
async function dirFS( dir, virtual_dir ) {
  VERBOSE && console.log( " - dirFS():", dir, virtual_dir );

  // get the directory listing:
  let result = fs.readdirSync( dir )
    // map the result to our format
    .map( r => enrichFS( { path: r, fullpath: path.join( dir, r ) }, virtual_dir ) )
    // only let through dirs or audio files
    .filter( r => r._type == "fs.dir" || (r._type == "fs.file" && r.ext && r.ext.match( /m4a|aac|mp3|wav/i )) ) // |txt|jpg|png|gif

  // add the . and .. directories
  // let dot = enrichFS( { path: getFoldername( virtual_dir ), fullpath: dir }, virtual_dir );
  // dot.path = "."
  // dot.name = "."
  let virtual_parent = getPath( virtual_dir );
  if (virtual_parent == '/') {
    let dotdot = JSON.parse( JSON.stringify( ROOTFOLDER ))
    dotdot.path = ".."
    result.unshift( dotdot );
  } else {
    let dotdot = { path: "..", fullpath: getPath( dir ) };
    dotdot = enrichFS( dotdot, virtual_dir );
    result.unshift( dotdot );
  }

  // fill in pretty names
  for (let x = 0; x < result.length; ++x) {
    let r = result[x];

    // https://www.npmjs.com/package/node-id3
    if (r._type == "fs.file" && r.ext.match( /m4a|aac|mp3|wav/i )){
      let ext_2_mime = {
        m4a: "audio/mp4",
        aac: "audio/aac",
        mp3: "audio/mpeg",
        wav: "audio/x-wav",
      }
      let ext = getExt( r.fullpath );
      const tags = await musicmetadata.parseFile( r.fullpath, { duration: false } ); // duration takes a long time for mp3 files...
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
    let fullpath = path.split( "|" )
    let url = fullpath[0]
    let id = fullpath[1]
    VERBOSE && console.log( `dlna url: "${url}"` )
    VERBOSE && console.log( `dlna id:  "${id}"` )
    let dlna_listing = await dlna.content( [ "content", url, id ] );
    let listing = dlna_listing.items.map( r => {
      let result = { path: r.title, fullpath: url + "|" + r.id, fullpath_parent: url + "|" + r.parentID, _type: "dlna." + r.class, /*r: r*/ };
      if (r.file) { result.fullpath = r.file;  result.ext = getExt( r.file ); }
      if (r.file_size) result.file_size = r.file_size
      if (r.file_duration) {
        let s = r.file_duration.split( "." )
        let d = s[0].split( ":" )
        result.duration = (d[0] * 24 * 60 * 60) + (d[1] * 60 * 60) + (d[2] * 60) + s[1] // convert to number of seconds...
      }
      if (r.file_duration) result.runningtime = r.file_duration
      return enrichDLNA( result, virtual_dir )
    })
    // ok... we can't support "..", because we dont get a parent ID for the _current_ directory, only the parent of the children (which is the ID for the cwd)
    // so.   the frontend media player will need to implement a browser "<" back button based on history (a good idea anyways).
    // let dotdot = enrichDLNA( { path: "..", name: getFoldername( virtual_dir ), fullpath: item.fullpath_parent }, virtual_dir )
    // listing.unshift( dotdot )
    return listing;
  } else {
    let disc = await dlna.info();
    return Object.keys( disc ).map( r => enrichDLNA( { path: disc[r].name, fullpath: disc[r].contentdir_control_url + "|0", _type: "dlna.mediaserver" }, virtual_dir ) );
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

function init( options = { configname: ".config" } ) {
  if (options.configname) configname = options.configname;
}
module.exports.init = init;


// return a listing at the directory (recursive utility)
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
    listing = [ROOTFOLDER];

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
      if (dirIsGood( item.fullpath )) {
        listing = await dirFS( item.fullpath, absolute_path );
      }
      break;

    case "dlna.discovery":
      listing = await dirDlna( undefined, absolute_path )
      break;

    default:
      // handle all other "dlna.*" types here:
      //console.log( item )
      if (item._type.match( /^dlna\./ )) {
        listing = await dirDlna( item.fullpath, absolute_path )
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


module.exports.setVerbose = ( verbose ) => { VERBOSE = verbose }
