const fs = require('fs');
const { argParse, required } = require('./parse');
const burp = require('./burp');
const confuser = require('./confuser');
const util = require('./util');
const ddp = require('./ddp');
const {usageShort, usage} = require('./help');
const harness = require('./harness');
const staticanalysis = require('./static');
const ejson = require('ejson');

args = argParse(process.argv.slice(2));
if (args.verbose) {
  util.VERBOSITY = args.verbose;
}

let client = undefined;

if (['appjs', 'static', 'staticanalysis', 'checksec'].includes(args.pos[0])) {
  required(args, 'urlbase');
  let badpkg = ['insecure', 'autopublish'];
  staticanalysis.scanAllJs(args.urlbase).then((data) => {
    if (data.call.length) {
      console.log("Methods called from client-side JS:");
      console.log("-----------------------------------");
      console.log(data.call.join("\n") + "\n");
    }
    if (data.method.length) {
      console.log("Leaked server-side method definitions:");
      console.log("--------------------------------------");
      console.log(data.method.join("\n") + "\n");
    }
    if (data.subscribe.length) {
      console.log("Publications subscribed to in client-side JS:");
      console.log("---------------------------------------------");
      console.log(data.subscribe.join("\n") + "\n");
    }
    if (data.method.length) {
      console.log("Leaked server-side publication definitions:");
      console.log("-------------------------------------------");
      console.log(data.publish.join("\n") + "\n");
    }
    if (data.pkg.length) {
      let bad = data.pkg.filter((x) => badpkg.includes(x));
      if (bad.length) {
        console.log("*** INSECURE PACKAGES: ***");
        console.log("--------------------------");
        console.log(bad.join("\n") + "\n");
      }
      console.log("Enabled packages:");
      console.log("-----------------");
      console.log(data.pkg.map((x) => x + (badpkg.includes(x) ? ' ***INSECURE***' : '')).join("\n") + "\n");
    }
    
  });
} else if (args.pos[0] == 'dumpmessages' || args.pos[0] == 'dumpconfusertargets') {
  required(args, ['burpfile']);
  const burpfile = args.burpfile;
  let msg = undefined;
  if (args.pos[0] == 'dumpmessages') {
    msg = burp.loadMessages(burpfile);
    let msgfilter = new Set();
  
    for (var i = 1; i < args.pos.length; ++i) {
      if (['method', 'methods'].includes(args.pos[i])) {
        msgfilter.add('method');
      } else if (['sub', 'subscribe', 'subscription'].includes(args.pos[i])) {
        msgfilter.add('sub');
      } else if (['client', 'clientonly'].includes(args.pos[i])) {
        msgfilter.add('sub');
        msgfilter.add('method');
      }
    }
    if (msgfilter.size > 0) {
      util.errlog1("Dumping these messages:", Array.from(msgfilter).join(", "));
      msg = msg.filter((x) => msgfilter.has(x.msg));
    }
  } else {
    msg = burp.loadTargets(burpfile);
  }
  console.log(JSON.stringify(msg, null, 4));
} else if (args.pos[0] == 'confuser') {
  //todo rewrite this
  //todo figure out right way to do parallelism?
  //todo i think we have confusers dump their probes into a queue and go
  let client = autoinit(args);
  required(args, ['messagefile', 'urlbase']);
  const msgfile = args.messagefile;
  fs.readFile(msgfile, (err, data) => {
    if (err) {
      util.errlog0(err);
      process.exit(1);
    }
    let msgs = JSON.parse(data.toString());
    msgs = msgs.filter((m) => m.params && m.params.length && m.params.length > 0);
    let output = {};
    let remaining = msgs.length;
    let managers = msgs.map((msg) => {
      var mgr = new confuser.ConfuserProbeManager(client, {'message': msg});
      mgr.on('completed', () => {
        output[JSON.stringify(mgr.opt.message)] = mgr.answers;
        --remaining;
        util.errlog2("Probe manager completed;", remaining, "remaining");
        if (remaining === 0) {
          console.log(output);
          client.ws.close();
        }
      });
      return mgr;
    });
    client.on('ready', () => {
      util.errlog1("Connected; starting", managers.length, "managers");
      managers.forEach((m) => m.start());
    });
    client.start();
  });
} else if (args.pos[0] == 'methodbuster' || args.pos[0] == 'brutemethods') {
  required(args, ['wordlist', 'urlbase']);
  
  //TODO: turn this into a global default rather than a per-command default?
  if (!args.parallelism) {
    args.parallelism = 1;
  }

  let answers = {};
  let mgrs = [];
  let completed = 0;
  for (var i = 0; i < args.parallelism; ++i) {
    let mgr = new ddp.FileProbeManager(ddp.autoClient(args), {
      filename: args.wordlist,
      lineDelta: args.parallelism,
      startIndex: i,
      generateMessage: (n) => ({'msg':'method', 'method':n.name}),
      generateAnswer: (m) => (m.error && m.error.error == 404) ? undefined : m
    });
    mgr.on('completed', () => {
      answers = {...answers, ...mgr.answers};
      mgr.client.ws.close();
      ++completed;
      if (completed == args.parallelism) {
        console.log(answers);
      }
    });
    mgrs.push(mgr);
    mgr.forceStart();
  }
} else if (['pubbuster', 'publicationbuster', 'brutepubs', 'brutepublications'].includes(args.pos[0])) {
  //todo copy methodbuster
  required(args, ['wordlist', 'urlbase']);
  
  //TODO: turn this into a global default rather than a per-command default?
  if (!args.parallelism) {
    args.parallelism = 1;
  }

  let answers = {};
  let mgrs = [];
  let completed = 0;
  for (var i = 0; i < args.parallelism; ++i) {
    let mgr = new ddp.FileProbeManager(ddp.autoClient(args), {
      filename: args.wordlist,
      lineDelta: args.parallelism,
      startIndex: i,
      generateMessage: (n) => ({'msg':'sub', 'name':n.name}),
      generateAnswer: (m) => (m.error && m.error.error == 404) ? undefined : m
    });
    mgr.on('completed', () => {
      answers = {...answers, ...mgr.answers};
      mgr.client.ws.close();
      ++completed;
      if (completed == args.parallelism) {
        console.log(answers);
      }
    });
    mgrs.push(mgr);
    mgr.forceStart();
  }
} else if (['bruteusers', 'enumusers', 'userenum', 'enumuser', 'userbuster'].includes(args.pos[0])) {
  //todo support parallelism and don't read the whole file into memory?
  let opt = {
    clientOpt: ddp.autoClientOpt(args)
  };
  let userlist = fs.readFileSync(args.wordlist).toString();
  let mgr = new ddp.QuiverProbeManager({
    ...opt,
    inputs: userlist.split("\n"),
    generateMessage: (n) => ddp.loginMessage({'username':n.name,'password':'fake'}),
    generateAnswer: (m) => (m.error && m.error.reason === 'User not found') ? undefined : m
  });
  mgr.on('completed', () => {
    console.log(mgr.answers);
  });
  mgr.start();
} else if (['brutepasswords', 'passwordbuster', 'brutepass', 'passbuster'].includes(args.pos[0])) {
  //todo: support parallelism
  let opt = {
    clientOpt: ddp.autoClientOpt(args)
  };
  let username = args.username;
  let passwordlist = fs.readFileSync(args.wordlist).toString();
  let mgr = new ddp.QuiverProbeManager({
    ...opt,
    inputs: passwordlist.split("\n"),
    generateMessage: (n) => ddp.loginMessage({'username':username,'password':n.name}),
    generateAnswer: (m) => (m.error && m.error.reason === 'Incorrect password') ? undefined : m
  });
  mgr.on('completed', () => {
    console.log(mgr.answers);
  });
  mgr.on('ddpMessage', (msg) => {
    if (msg.result && msg.result.token) {
      mgr.stop();
      mgr.emit('completed');
    }
  });
  mgr.start();
} else if (['harness', 'harnessserver'].includes(args.pos[0])) {
  if (!args.named.port) {
    args.named.port = 9010;
  }
  let server = harness.harnessServer(args);
} else {
  if (args.pos[0]) {
    util.errlog0("unrecognized command", args.pos[0]);
    usageShort();
  } else {
    util.errlog0("please specify a command");
    usageShort();
  }
  process.exit(1);
}
