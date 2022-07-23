const { v4: uuidv4 } = require('uuid');
const EJSON = require('ejson');
const fs = require('fs');
const nrl = require('n-readlines');

//todo fix exports - uggo

let randomId = () => uuidv4();

let randomString = (chars, len) => {
  var out = '';
  for (var i = 0; i < len; ++i) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
};
  
let randomDigits = (len) => randomString('0123456789', len);
  
let randomLetters = (len) => randomString('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', len);

let errlog = (level, ...args) => {
  if (module.exports.VERBOSITY >= level) {
    console.error(...args);
  }
};

let errlog0 = (...args) => errlog(0, ...args);
let errlog1 = (...args) => errlog(1, ...args);
let errlog2 = (...args) => errlog(2, ...args);
let errlog3 = (...args) => errlog(3, ...args);

let ejsonClone = (o) => EJSON.parse(EJSON.stringify(o));

const parsePkgAndUrl = (url) => {
  if (url.indexOf('https://') === 0) {
    return {url: url, pkg: https};
  } else if (url.indexOf('http://') === 0) {
    return {url: url, pkg: http};
  }
  
  let httpResult = {url: 'http://' + url, pkg: http};
  let httpsResult = {url: 'https://' + url, pkg: https};
  
  let hostPart = url.split('/')[0];
  if (hostPart.indexOf(':') === -1) {
    httpResult;
  }
  let port = parseInt(hostPart.split(':')[1]);
  if (port === 80 || port === 8080 || port === 8888 || port === 8000) {
    httpResult;
  }
  return httpsResult;
};

//todo
/**
 * i want this class so I can have multiple probemanagers reading from the same
 * wordlist where (1) we only read the entire wordlist from disk once (compare
 * the behavior of multiple FileProbeManagers on the same file with the same
 * lineDelta), and (2) lines are removed from RAM after every one of the 
 * probemanagers has already used that line.  Current name references a comic
 * book store because we discard an "issue" (i.e., a line from the file) after
 * all of our "readers" (managers) are past that point in the "series" (file).
 * Yeah, silly, but you come up with a better name.
 **/
/*
class FileComicBookStore {
  constructor(fn) {
    this.filename = fn;
    this.file = new nReadLines(this.filename);
    this.lines = {}
    this.nextIndex = 0;
    this.
  }
}
*/


module.exports = {randomId, randomString, randomDigits, randomLetters, errlog, errlog0, errlog1, errlog2, errlog3, ejsonClone, parsePkgAndUrl};

module.exports.VERBOSITY = 0;
