const fs = require('fs');
const util = require('./util');
const { ProbeManager, DDPMessage, DDPClient } = require('./ddp');
const confuser = require('./confuser');

const PAGE_SIZE = 8*1024*1024;

//unpack a 32-bit big endian integer
function unpackBE32(buf, start) {
  var n = 0;
  for (var i = 0; i < 4; ++i) {
    n  = n << 8;
    n |= buf[start+i];
  }
  return n;
}

/**
 * Loads all DDP messages from the specified Burp project file.  Unless the
 * parameter includePingPong is specified and true, pings and pongs are
 * omitted from the output.
 **/
function loadMessages(filename, includePingPong) {
  if (includePingPong === undefined) {
    includePingPong = false;
  }
  const fd = fs.openSync(filename);
  //Read the file one page at a time and find DDP messages as we go along to
  //avoid having to store an entire Burp project file in RAM at once
  let pages = [Buffer.alloc(PAGE_SIZE), Buffer.alloc(PAGE_SIZE)];
  let msgStrings = [];
  let totBytes = 0;
  totBytes += fs.readSync(fd, pages[0], 0, PAGE_SIZE);
  while (true) {
    let bytes = fs.readSync(fd, pages[1], 0, PAGE_SIZE);
    totBytes += bytes;
    if (bytes == 0) {
      break;
    }
    let lastIndex = 0;
    while (true) {
      let everything = Buffer.concat(pages);
      let index = everything.indexOf('["{\\"msg', lastIndex);
      let zero = everything.indexOf('\x00', index);
      if (index == -1) {
        break;
      }
      while (zero == -1) {
        pages.append(Buffer.alloc(PAGE_SIZE));
        bytes = fs.readSync(fd, pages[pages.length - 1], 0, PAGE_SIZE);
        totBytes += bytes;
        everything = Buffer.concat(pages);
        zero = everything.indexOf('\x00', index);
      }
      let start = index;
      let found = false;
      while (start >= 0 && !found) {
        let n1 = unpackBE32(everything, start-4);
        let n2 = unpackBE32(everything, start-8);
        let len = zero - start;
        if (n2 - n1 == 8 && n1 >= len-1 && n1 <= len+1) {
          found = true;
          msgStrings.push(everything.subarray(start, zero).toString());
        }
        --start;
      }
      
      lastIndex = (zero == -1 ? index + 1 : zero);
    }
    if (bytes < PAGE_SIZE) {
      break;
    }
    pages = [pages[pages.length - 1], pages[0]];
  }
  let results = msgStrings.map((m) => DDPMessage.unwrap(m));
  if (!includePingPong) {
    results = results.filter((m) => m.msg != 'ping' && m.msg != 'pong');
  }
  return results;
};

/**
 * Loads client -> server method call and subscription messages, filtering out
 * duplicates with the same parameter type structures.  See messagesEqual below
 * and typeDescriptor/typesEqual in confuser.js.
 **/
function loadTargets(filename) {
  const IGNORE = ['meteor.loginServiceConfiguration', 'meteor_autoupdate_clientVersions', 'login', 'logout'];
  const messages = loadMessages(filename);
  const methodMessages = messages.filter((m) => {
    if (!(m.msg === 'method' || m.msg === 'sub')) {
      return false;
    }
    return !(IGNORE.includes(m.method) || IGNORE.includes(m.name));
  });
  const methods = [];
  methodMessages.forEach((m) => {
    if (messagesUnique(methods, m)) {
      methods.push(m);
    }
  });
  return methods;
};

function messagesUnique(allMessages, newMessage) {
  return allMessages.find((existing) => messagesEqual(existing, newMessage)) === undefined;
}

function messagesEqual(m1, m2) {
  const parse = (m) => {
    if (m.method) {
      return {
        params: m.params ? m.params : [],
        name: m.method,
        type: 'method'
      };
    } else if (m.sub) {
      return {
        params: m.params ? m.params : [],
        name: m.name,
        type: 'sub'
      };
    } else {
      return {
        params: [],
        type: undefined,
        name: undefined
      };
    }
  };
  m1 = parse(m1);
  m2 = parse(m2);
  if (m1.type !== m2.type) {
    return false;
  }
  if (m1.name !== m2.name) {
    return false;
  }
  if (m1.params.length !== m2.params.length) {
    return false;
  }
  for (var i = 0; i < m1.params.length; ++i) {
    if (!confuser.typesEqual(m1, m2)) {
      return false;
    }
  }
  return true;
}

module.exports = {loadMessages, loadTargets};
