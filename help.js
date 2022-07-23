const util = require('./util');

function usageShort() {
  //let cmd = process.argv.slice(0, 2).join(" ");
  let cmd = "node ehf.js";
  util.errlog0("usage:", cmd, "[command] [arg] -u baseUrl");
  util.errlog0();
  util.errlog0("EXAMPLES:\n");
  util.errlog0(cmd, "userbuster -u http://example.com/ -w userlist.txt -c 5 -p 3 #brute-force usernames (5 attempts per connection, 3 simultaneous connections)");
  util.errlog0(cmd, "methodbuster -u http://example.com/ -w methodlist.txt -l hstamper:grace01! #brute-force methods after logging in as hstamper");
  util.errlog0(cmd, "pubbuster -u http://example.com/ -w publist.txt -l hstamper:grace01! #brute-force publications after logging in as hstamper");
  util.errlog0(cmd, "dumpmessages -b app.burp method #dump all method call messages from Burp project (replace 'method' with 'sub' to  extract subscriptions; add argument 'unique' to remove apparent duplicates)");
  util.errlog0(cmd, "dumpconfusertargets -b app.burp >confuser.json #dump method call and subscription messages with unique parameter types from Burp project");
  util.errlog0(cmd, "confuser -u http://example.com/ -m confuser.json #run type confusion attacks using the specified messages as templates");
}

function usage() {
  usageShort();
}

module.exports = {usage, usageShort};
