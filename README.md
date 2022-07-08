# eighthundredfeet

NodeJS tool for attacking MeteorJS applications

## Installation and usage

- `git clone https://gitlab.levs3c.group/csmith/eighthundredfeet.git`
- `npm install`
- `node ./ehf.js [command] [args]`

## Examples

`node ./ehf.js userbuster -u http://example.com/ -w userlist.txt -c 5 -p 3 #brute-force usernames (5 attempts per connection, 3 simultaneous connections)
node ./ehf.js methodbuster -u http://example.com/ -w methodlist.txt -l hstamper:grace01! #brute-force methods after logging in as hstamper
node ./ehf.js pubbuster -u http://example.com/ -w publist.txt -l hstamper:grace01! #brute-force publications after logging in as hstamper
node ./ehf.js dumpmessages -b app.burp method #dump all method call messages from Burp project (replace 'method' with 'sub' to  extract subscriptions; add argument 'unique' to remove apparent duplicates)
node ./ehf.js dumpconfusertargets -b app.burp >confuser.json #dump method call and subscription messages with unique parameter types from Burp project
node ./ehf.js confuser -u http://example.com/ -m confuser.json #run type confusion attacks using the specified messages as templates
`
