//todo fix usage of -l flag
const opt = {
  named: [
    {
      'flag': 'l',
      'name': 'login',
      'description': 'login credentials (username:password)',
      'samplevalue': 'username:password'
    },
    {
      'flag': 't',
      'name': 'token',
      'description': 'existing login token (run localStorage[\'Meteor.loginToken\'] in your browser console)',
      'samplevalue': 'abcdef0123465789'
    },
    {
      'flag': 'b',
      'name': 'burpfile',
      'description': 'Burp file to read from',
      'samplevalue': 'app.burp'
    },
    {
      'flag': 'u',
      'name': 'urlbase',
      'description': 'base URL of application',
      'samplevalue': 'https://meteor.example.com/'
    },
    {
      'flag': 'm',
      'name': 'messagefile',
      'description': 'file with JSON dump of messages (generate with "dumpconfusertargets -b burp.burp" or "dumpmessages method unique -b burp.burp")',
      'samplevalue': 'messages.json'
    },
    {
      'flag': 'w',
      'name': 'wordlist',
      'description': 'wordlist for brute forcing methods (./ehf.js methodbuster -w wordlist.txt) or subscriptions (./ehf.js subbuster -w wordlist.txt)',
      'samplevalue': 'directories.txt'
    },
    {
      'flag': 'U',
      'name': 'username',
      'description': 'username for brute forcing passwords (./ehf.js passwordbuster -U admin -w wordlist.txt)',
      'samplevalue': 'passwords.txt'
    },
    {
      'flag': 'P',
      'name': 'proxy',
      'description': 'proxy server for websocket traffic (e.g., -p 127.0.0.1:8080)',
      'samplevalue': '127.0.0.1:8080'
    },
    {
      'flag': 'c',
      'name': 'concurrency',
      'description': 'number of concurrent probes for one probe manager (see also -p/--parallelism; total concurrent messages = concurrency * parallelism)',
      'samplevalue': '5'
    },
    {
      'flag': 'p',
      'name': 'parallelism',
      'description': 'number of parallel probe managers for one brute forcing task (see also -c/--concurrency; total concurrent messages = concurrency * parallelism)',
      'samplevalue': '3'
    },
  ],
  flags: [
    {
      'flag': 'v',
      'name': 'verbose',
      'description': 'verbose (use -vv or -vvv for even more output)'
    }
  ]
};

function argParse(args) {
  let results = {
    pos: []
  };

  let onlyPositional = false;
  let openParam = undefined;
  args.forEach((arg) => {
    if (onlyPositional) {
      results.pos.push(arg);
      return;
    }
    if (openParam !== undefined) {
      results[openParam.name] = arg;
      openParam = undefined;
      return;
    }
    let ticks = 0;
    while (arg.length > ticks && arg[ticks] == '-') {
      ++ticks;
    }
    arg = arg.substring(ticks);
    if (ticks === 2) {
      if (arg === '') {
        onlyPositional = true;
        return;
      }
      let namedMatch = opt.named.find((f) => f.name == arg);
      if (namedMatch !== undefined) {
        results[namedMatch.name] = null;
        openParam = namedMatch;
      }
    }
    if (ticks == 1) {
      for (var i = 0; i < arg.length; ++i) {
        let ch = arg[i];
        let flagMatch = opt.flags.find((f) => f.flag == ch);
        let namedMatch = opt.named.find((f) => f.flag == ch);
        if (flagMatch !== undefined && (namedMatch === undefined || i < arg.length - 1)) {
          if (!results.hasOwnProperty(flagMatch.name)) {
            results[flagMatch.name] = 0;
          }
          ++results[flagMatch.name];
        } else if (namedMatch !== undefined) {
          results[namedMatch.name] = null;
          openParam = namedMatch;
        }
      }
    } else {
      results.pos.push(arg);
    }
  });
  if (openParam !== undefined) {
    console.error("Parameter " + openParam.name + " (-" + openParam.flag + ") needs a value");
    return null;
  }
  return results;
}

function required(args, requiredArgs) {
  requiredArgs.forEach((a) => {
    if (!args[a]) {
      const arg = opt.find((x) => x.name == a);
      console.error("error: missing argument", arg.name, "(-" + arg.flag + ")");
      process.exit(1);
    }
  });
}

module.exports = {argParse, required};