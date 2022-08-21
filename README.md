# eighthundredfeet

NodeJS tool for attacking MeteorJS applications

## Installation and usage

- `git clone https://gitlab.levs3c.group/csmith/eighthundredfeet.git`
- `npm install`
- `node ./ehf.js [command] [args]`

## Examples

- `node ./ehf.js userbuster -u http://example.com/ -w userlist.txt -c 5 -p 3 #brute-force usernames (5 attempts per connection, 3 simultaneous connections)`
- `node ./ehf.js methodbuster -u http://example.com/ -w methodlist.txt -l hstamper:grace01! #brute-force methods after logging in as hstamper`
- `node ./ehf.js pubbuster -u http://example.com/ -w publist.txt -l hstamper:grace01! #brute-force publications after logging in as hstamper`
- `node ./ehf.js dumpmessages -b app.burp method #dump all method call messages from Burp project (replace 'method' with 'sub' to  extract subscriptions; add argument 'unique' to remove apparent duplicates)`
- `node ./ehf.js dumpconfusertargets -b app.burp >targets.txt #dump method call and subscription messages with unique parameter types from Burp project`
- `node ./ehf.js confuser -u http://example.com/ -m targets.txt #run type confusion attacks using the specified messages as templates`
- `node ./ehf.js harness -u http://example.com/ -m targets.txt -L 9020 #open harness test server at localhost:9020

## Brief code tour

The client-side implementation of DDP is found in ddp.js.  The class DDPMessage contains static functions to aid in translating between JavaScript objects and their representation on the wire as DDP messages.  DDPClient is a thin wrapper around a WebSocket object that extends EventEmitter and provides its own set of high-level events, such as connected, booted, and ddpMessage, which can be used to control and monitor exchanged messages.  Most important is the booted event, which is emitted when the client has completed its connection handshake, including logging in if authentication data was provided to the DDPClient constructor.

To any task involving a series of messages generated from a list of inputs, such as guessing at publication or method names, eighthundredfeet uses an instance of the ProbeManager class.  This class handles the work of turning each input into a DDP message, sending that message to the server, pairing the responses with the original messages, and recording results.  The caller must supply two callbacks to the ProbeManager class’s constructor.  The generateMessage callback accepts the original input value as a parameter and returns the DDP message for that input.  The generateAnswer callback accepts the response message as a parameter and returns an object representing the logical result of that message. 

Type confusion attacks are implemented in confuser.js.  Parameters to methods or publications can take on any structure representable in Meteor’s EJSON extension, and type confusion attacks should target every level of a nested object.  To accomplish that goal, the confuser system generates a type descriptor for each parameter.  A type descriptor is a representation of the object’s structure and the original types of scalar values appearing in the object.  The confuser system then generates an array of instructions to switch the type of a value found somewhere in the original parameter.  Finally, the ConfuserProbeManager class sends each message and look for the default Match failed error messages that indicate server-side type validation errors.  Think of this process like running Burp Intruder in its Sniper mode with insertion points for every scalar value found in each parameter.

## Adapting eighthundredfeet to other WebSocket applications

If you are attacking a WebSocket application that is not built on Meteor and uses a protocol other than DDP, ddp.js will need to be modified to match the target application's communication protocol.  First, the static functions in the DDPMessage class should be rewritten to match the application's message format, and the function DDPClient.send() may need to change accordingly as well.  Most of the other changes to the DDPClient class should be in the event handlers in the bindClientEvents() and start() functions.  All of the high-level events like connected, loginSuccessful, ddpMessage and the events specific to a message type (see the line client.emit(msg.msg, msg) in ddp.js) should be replaced with events that make sense for the target application's messaging protocol.

In a Burp project file, each WebSocket message is stored in plain text, preceded by two length fields formatted as 32-bit big-endian integers.  The second field is the length of the message itself, and the first field is the length of the entire record (the message length plus eight bytes for the two length fields).  Along with the length fields, the algorithm in burp.js that extracts DDP messages from a Burp project file looks for JSON formatting.  Changing the JSON string search on line 43 of burp.js to a rule that fits the target app's message format should be enough to enable eighthundredfeet to extract relevant WebSocket messages.
