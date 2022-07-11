const { parsePkgAndUrl } = require('./util');

const http = require('http');
const https = require('https');

/**
 * Given the base URL of a meteor app, download the app's main client-side JS
 * bundle (app.js) and search for calls to methods on the Meteor global object
 * that reveal the names of publications or methods.  This function dumps them
 * to stdout.  TODO: return the data and let ehf.js generate the output.
 **/
(async searchAppJs(baseUrl) {
  let {url, pkg} = parsePkgAndUrl(baseUrl + '/app/app.js');
  let next = (body) => {
    let lines = body.split("\n").map((x, index) => ({line: x.trim(), index: index}));
    let lineOutput = (x) => "app.js:" + x.index + ":" + x.line;
    let stringFilter = (lines, probe) => lines.filter((x) => x.line.includes(probe)).map(lineOutput);
    let callLines      = stringFilter(lines, "Meteor.call");
    let methodLines    = stringFilter(lines, "Meteor.methods");
    let subscribeLines = stringFilter(lines, "Meteor.subscribe");
    let publishLines   = stringFilter(lines, "Meteor.publish");
    
    if ((callLines + methodLines).length > 0) {
      console.log("-------- METHODS --------");
      if (callLines.length > 0) {
        console.log("Client-side definitions:");
        console.log(callLines.join("\n"));
      }
      if (methodLines.length > 0) {
        console.log("Server-side definitions:");
        console.log(methodLines.join("\n"));
      }
    }
    if ((subscribeLines + publishLines).length > 0) {
      console.log("------ PUBLICATIONS -----");
      if (subscribeLines.length > 0) {
        console.log("Client-side definitions:");
        console.log(subscribeLines.join("\n"));
      }
      if (publishLines.length > 0) {
        console.log("Server-side definitions:");
        console.log(publishLines.join("\n"));
      }
    }
  };
  let handle = (response) => {
    let body = '';
    response.on('data', (part) => body += part);
    response.on('end', () => { next(body); });
    response.on('error', (e) => { console.error(e); });
  };
  pkg.get(url, handle);
})();

module.exports = {searchAppJs};