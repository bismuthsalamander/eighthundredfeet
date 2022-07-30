const util = require('./util');

const http = require('http');
const https = require('https');

/**
 * Since an application's browser JS files are structured differently in
 * development and production (many individual files versus a single minified
 * bundle), the most simplest way to scan through the client-side JS is to pull
 * down every JS file referenced from the app's index pgae.
 **/
async function getJsUrls(baseUrl) {
  try {
    let homePage = await util.getUrl(baseUrl);
    return [...homePage.matchAll(/<script[^>]+src="([^"]+)"[^>]*>/gm)].map((x) => x[1]);
  } catch (e) {
    console.error(e);
    return [];
  }
}

async function scanAllJs(baseUrl) {
  if (baseUrl[baseUrl.length - 1] != '/') {
    baseUrl += '/';
  }
  let data = {
    'call': [],
    'method': [],
    'subscribe': [],
    'publish': [],
    'pkg': []
  };
  let urls = await getJsUrls(baseUrl);
  for (let i = 0; i < urls.length; ++i) {
    let u = urls[i];
    if (u[0] == '/') {
      u = u.substring(1);
    }
    let fileText = await util.getUrl(baseUrl + u);
    data.call = data.call.concat(await findFunctionCalls('Meteor.call', fileText, u));
    data.method = data.method.concat(await findFunctionCalls('Meteor.method', fileText, u));
    data.subscribe = data.subscribe.concat(await findFunctionCalls('Meteor.subscribe', fileText, u));
    data.publish = data.publish.concat(await findFunctionCalls('Meteor.publish', fileText, u));
    data.pkg = data.pkg.concat(await findFunctionCalls('Package._define', fileText, u));
  }
  data.call = Array.from(new Set(data.call)).sort();
  data.method = Array.from(new Set(data.method)).sort();
  data.subscribe = Array.from(new Set(data.subscribe)).sort();
  data.publish = Array.from(new Set(data.publish)).sort();
  data.pkg = Array.from(new Set(data.pkg)).sort();
  return data;
}

function findFunctionCalls(func, data, filename) {
  let finds = [];
  let re = new RegExp(func + "\\((['\"])([^'\"]+)\\1", 'gi');
  
  data.split("\n").forEach((line, idx) => {
    let matches = [...line.matchAll(re)];
    matches.forEach((m) => {
      util.errlog1(filename + " line " + idx + " char " + m.index + ", found " + m[0] + " " + m[2]);
      finds.push(m[2]);
    });
  });
  
  return finds;
}

/**
 * Given the base URL of a meteor app, download the app's main client-side JS
 * bundle (app.js) and search for calls to methods on the Meteor global object
 * that reveal the names of publications or methods.  This function dumps them
 * to stdout.  TODO: return the data and let ehf.js generate the output.
 **/
async function searchJsFile(data, filename) {
  let lines = data.split("\n").map((x, index) => ({line: x.trim(), index: index}));
  let lineOutput = (x) => "app.js:" + x.index + ":" + x.line;
  let stringFilter = (lines, probe) => lines.filter((x, idx) => x.line.includes(probe))
    .map({'location':filename+':'+idx, 'text':lineOutput});
  return {
    'call': stringFilter(lines, "Meteor.call"),
    'method': stringFilter(lines, "Meteor.methods"),
    'subscribe': stringFilter(lines, "Meteor.subscribe"),
    'publish': stringFilter(lines, "Meteor.publish")
  };
  /*
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
  });
  let handle = (response) => {
    let body = '';
    response.on('data', (part) => body += part);
    response.on('end', () => { next(body); });
    response.on('error', (e) => { console.error(e); });
  };
  pkg.get(url, handle);
  */
};

module.exports = {scanAllJs};

function main() {
  let p = scanAllJs(process.argv[2]);
  console.log(p);
  p.then((x) => {
    console.log("Resolved!");
    console.log(x);
  });
  console.log("Thenned");
  /*
  console.log("OUTCOME");
  let p = scanAllJs(process.argv[2]);
  console.log(p);
  p.then((x) => {
    console.log("ResolveD");
  });
  */
}
//main();