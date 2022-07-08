const fs = require('fs');
const util = require('./util');
const { ProbeManager, DDPMessage, DDPClient } = require('./ddp');
const confuser = require('./confuser');

const PAGE_SIZE = 1024*1024;

function unpackBE32(buf, start) {
  var n = 0;
  for (var i = 0; i < 4; ++i) {
    n  = n << 8;
    n |= buf[start+i];
  }
  return n;
}

function loadMessages(filename, includePingPong) {
  if (includePingPong === undefined) {
    includePingPong = false;
  }
  const fd = fs.openSync(filename);
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

function loadTargets(filename) {
  const messages = loadMessages(filename);
  const methodMessages = messages.filter((m) => m.msg === 'method' || m.msg === 'sub');
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

function main() {
  var c = new DDPClient({appUrl: 'http://localhost:3000'});
  console.log(c);
  //c.on('sent', (m) => console.log(m));
  var mgr = new ConfuserProbeManager(c, {
    'message': {'msg':'method', 'id':util.randomId(), 'method':'oneStringOrNumber','params':[1]}
  });
  mgr.on('completed', () => {
    console.log("Answers", mgr.answers);
    c.close();
  });
  c.on('ready', () => {mgr.start();});
  c.on('ddpMessage', (m) => (console.log(m)));
  c.start();
}

/*
var paramLists = [[0,1],[0,'yes',false],[0,1,2],['yes',0,true],[{'dog':'cat'}],[{'dog':{'breed':'shihtzu','color':'whatever'}}]];
var types = paramLists.map((e) => typeDescriptor(e));
for (var i = 0; i < types.length; ++i) {
  let confusers = getConfusers(types[i]);
  console.log("params", paramLists[i]);
  //console.log(types[i]);
  console.log("confusers", confusers);
  let msg = {'msg':'method','method':'whatever','params':paramLists[i]};
  let probes = confuserInputs(msg);
  console.log("probes", probes);
  for (var j = 0; j < confusers.length; ++j) {
    for (var k = 0; k < confusers[j].types.length; ++k) {
      //var obj = JSON.parse(JSON.stringify(paramLists[i]));
      //applyConfuserProbeToParams(obj, mutators[j].accessPath, mutators[j].types[k], 0);
      //console.log("SENDING TO SERVER", obj);
    }
  }
  console.log('*************');
};
*/