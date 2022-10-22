#!/usr/bin/env node

let mediafs = require( "./media-fs" )
let path = require( 'path' );


function getFilename( filepath ) {
  return filepath ? filepath.replace( /^.*\//, "" ).replace( /\.[^\.]+$/, "" ) : ""; // remove path and ext
}
function getExt( filename ) {
  let m = filename ? filename.match( /\.[^\.]+$/ ) : "";
  //console.log( path, m )
  return m ? m[0] : ""
}
function getPath( filepath ) {
  return filepath ? filepath.replace( /\/[^\/]+$/, "" ).replace( /^$/, "/" ) : ""
}

//////////////////////////////////////////////////////////////////
// test driver (CLI)

// options:
let args = [];
let VERBOSE=false;
let RESOLVE=false;
let FORCE=false;

/////////////////////////////////////
// scan command line args:
function usage()
{
  let me = path.join( ".", getFilename( process.argv[1] ) + getExt( process.argv[1] ) )
  console.log( `${me} filesystem for user apps` );
  console.log( `Usage:
   ${me}                                         (outputs the / path)
   ${me} "/"                                     (outputs the / path)
   ${me} <absolute item name>                    (recursive listing retrieval)
   ${me} --resolve                               (resolve dlna discovery items before returning result)
   ${me} --force                                 (do not use the cache to fetch results)
   ${me} --help                                  (this help)
   ${me} --verbose                               (output verbose information)
  ` );
}
let ARGC = process.argv.length-2; // 1st 2 are node and script name...
let ARGV = process.argv;
let non_flag_args = 0;
let non_flag_args_required = 0;
for (let i = 2; i < (ARGC+2); i++) {
  if (ARGV[i] == "--help") {
    usage();
    process.exit( -1 )
  }

  if (ARGV[i] == "--verbose") {
    VERBOSE=true
    continue
  }
  if (ARGV[i] == "--force") {
    FORCE=true
    continue
  }
  if (ARGV[i] == "--resolve") {
    RESOLVE=true
    continue
  }
  /*
  if (ARGV[i] == "--note") {
    i+=1;
    note=ARGV[i]
    VERBOSE && console.log( `Parsing Args: Note ${note}` )
    continue
  }
  */
  if (ARGV[i].substr(0,2) == "--") {
    console.log( `Unknown option ${ARGV[i]}` );
    process.exit(-1)
  }

  args.push( ARGV[i] )
  VERBOSE && console.log( `Parsing Args: argument #${non_flag_args}: \"${ARGV[i]}\"` )
  non_flag_args += 1
}

// output help if they're getting it wrong...
if (non_flag_args_required != 0 && (ARGC == 0 || !(non_flag_args >= non_flag_args_required))) {
  (ARGC > 0) && console.log( `Expected ${non_flag_args_required} args, but only got ${non_flag_args}` );
  usage();
  process.exit( -1 );
}
//////////////////////////////////////////


// main entrypoint
(async () => {
  mediafs.setVerbose( VERBOSE );
  let result = await mediafs.dir( args.length == 0 ? "/" : args[0], args.length > 1 ? JSON.parse( args[1] ) : undefined, RESOLVE, FORCE );
  console.log( `result:`, result )
  process.exit( 0 );
}) ()
