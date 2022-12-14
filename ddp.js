const EventEmitter = require('events');
const EJSON = require('ejson');
const WebSocket = require('ws');
const util = require('./util');
const nReadLines = require('n-readlines');
const burp = require('./burp');
const proxyHttp = require('http-proxy-agent');
const proxyHttps = require('https-proxy-agent');
const url = require('url');
const crypto = require('crypto');

const defaultOptions = {
  autoConnect: true,
  autoPong: true,
  trackCollections: true
};
const COLLECTION_MESSAGES = ['added', 'changed', 'removed', 'addedBefore', 'movedBefore'];

/**
 * Utility methods for DDP messages.
 *
 * DDPMessage.unwrap: parses a string received in a server-to-client websocket
 * message and returns the object.
 *
 * DDPmessage.build: returns a stub DDP message object with the specified
 * message type.
 *
 * DDPMessage.wireString: turns an object into the JSON array string Meteor
 * expects to receive over the wire.
 *
 * DDPMessage.idRef: takes a server-to-client message and returns the ID of the
 * referenced client-to-server message.  Checks in fields id, offendingMessage
 * and subs.  Assumes that only one subscription is referenced in subs.
 **/
class DDPMessage {
  static wireString(m) {
    return EJSON.stringify([EJSON.stringify(m)]);
  }
  
  static unwrap(str) {
    if (str.match(/^[a-z]/)) {
      str = str.slice(1);
    }
    if (str.length == 0) {
      return null;
    }
    let data = EJSON.parse(str);
    //TODO: implement support for multiple messages?
    if (Array.isArray(data)) {
      if (data.length != 1) {
        throw new Error("DDP message contained more than one array entry!");
      }
      return EJSON.parse(data[0]);
    } else if (typeof data === 'string') {
      return EJSON.parse(data);
    }
  }
  
  static build(input) {
    if (typeof input === 'string') {
      return {'msg':input};
    }
    return input;
  }
  
  static idRef(m) {
    let id = m.offendingMessage !== undefined ? m.offendingMessage.id : m.id;
    id = m.subs !== undefined && m.subs.length && m.subs.length > 0 ? m.subs[0] : id;
    return id;
  }
};

/**
 * Stores documents in one or more collections and processes added, updated,
 * movedBefore, etc. messages sent server-to-client during the lifetime of a
 * subscription.  This class is urrently used in the harness server to present
 * point-in-time snapshots of publication contents to the HTTP client.  The
 * applyCollectionMsg() function will do nothing and return false if the
 * message argument is not a DDP message that alters the contents of a
 * collection.
 **/
class CollectionStore {
  isCollectionMessage(msg) {
    return COLLECTION_MESSAGES.includes(msg.msg);
  }
  
  constructor(options) {
    this.collections = {};
  }
  
  ensureExists(cname) {
    if (!this.collections.hasOwnProperty(cname)) {
      this.collections[cname] = [];
    }
  }
  
  applyCollectionMsg(msg) {
    if (!this.isCollectionMessage(msg)) {
      return false;
    }
    let cname = msg.collection;
    this.ensureExists(cname);
    let docid = msg.id;
    let before = msg.before;
    if (msg.msg == 'added') {
        let obj = msg.fields;
        obj['id'] = docid;
        this.collections[cname].push(obj);
    } else if (msg.msg == 'changed') {
        let target = this.collections[cname].find((x) => x.id == docid);
        Object.entries(msg.fields).forEach((k, v) => target[k] = v);
    } else if (msg.msg == 'removed') {
        this.collections[cname] = this.collections[cname].filter((x) => x.id != docid);
    } else if (msg.msg == 'addedBefore') {
        let obj = msg.fields;
        obj['id'] = docid;
        let idx = this.collections[cname].findIndex((x) => x.id == before);
        this.collections[cname] = this.collections[cname].slice(0, idx).concat([obj], this.collections[cname].slice(idx));
    } else if (msg.msg == 'movedBefore') {
        let doc = this.collections[cname].find((x) => x.id == docid);
        let rest = this.collections[cname].filter((x) => x.id != docid);
        let idx = rest.findIndex((x) => x.id == before);
        this.collections[cname] = rest.slice(0, idx).concat([doc], rest.slice(idx));
    }
    return true;
  }
  
  isEmpty() {
    return EJSON.stringify(this.collections) == EJSON.stringify({})
  }
};

/**
 * Thin wrapper around a websocket object with its own protocol-level DDP
 * events.  ProbeManagers listen to these events to gather results, and the
 * initLoggers() function listens for logging purposes.
 *
 * Emitted events:
 *
 * booted
 * loginSuccessful
 * loginFailed
 * open
 * ddpMessage
 * close
 * sent
 * error
 *
 * In addition, every message received emits an event whose name matches the
 * message type name (updated, removed, etc.).
 *
 * The constructor's options parameter is an object and must include appUrl or
 * wsUrl.  Authentication information is provided in login, either in
 * options.login.token or options.login.username and options.login.password.
 *
 * Calling start() will open the websocket connection and automatically handle
 * the DDP connect and login messages.  Ping messages sent by the server are
 * responded to automatically.  The booted event is emitted after login
 * succeeds; if no login info was provided, it's emitted after the connect
 * message succeeds.  Usually the probe manager (or other client code) should
 * wait for this event.  Call send() to push a message through.  Call close()
 * to forcibly close the websocket.
 **/
class DDPClient extends EventEmitter {
  constructor(options) {
    super();
    if (options.appUrl && !options.wsUrl) {
      options.wsUrl = this.appToWs(options.appUrl);
    }
    this.opt = {
      ...defaultOptions,
      ...options
    };
    this.connected = false;
    this.ws = undefined;
    this.collections = new CollectionStore();
    this.initLoggers();
    this.bindClientEvents();
  }
  
  initLoggers() {
    this.on('booted', (data) => util.errlog2('booted event', data));
    this.on('loginSuccessful', (data) => util.errlog2('loginSuccessful event', data));
    this.on('loginFailed', (data) => util.errlog1('loginFailed event', data));
    this.on('open', (data) => util.errlog3('open event', data));
    this.on('ddpMessage', (data) => util.errlog3('ddpMessage event', data));
    this.on('close', (data) => util.errlog1('close event', data));
    this.on('sent', (data) => util.errlog3('sent event', data));
  }
  
  bindClientEvents() {
    let client = this;
    if (this.opt.trackCollections) {
      this.on('ddpMessage', (msg) => {
        client.collections.applyCollectionMsg(msg);
      });
    }
    if (this.opt.autoPong) {
      this.on('ping', (msg) => {
        client.send('pong');
      });
    }
    if (this.opt.autoConnect) {
      this.on('open', () => {
        client.connect();
      });
    }
    this.on('connected', (data) => {
      client.connected = true;
      if (client.opt.login) {
        let login = client.opt.login;
        client.opt.loginMsgId = util.randomId();
        let loginMsg = loginMessage(login);
        loginMsg.id = client.opt.loginMsgId;
        client.on('result', (data) => {
          if (data.id != client.opt.loginMsgId) {
            return;
          }
          if (data.result.token) {
            client.sessionToken = data.result.token;
            client.emit('booted', data);
            client.emit('loginSuccessful', data);
          } else {
            client.emit('loginFailed', data);
          }
        });
        client.send(loginMsg);
      } else {
        client.emit('booted');
      }
    });
    this.on('failed', (data) => {
      throw new Error("Connection failed: " + EJSON.stringify(data));
    });
  }
  
  start() {
    if (this.ws !== undefined) {
      throw new Error("DDP client already started");
    }
    
    let client = this;
    if (!this.opt.wsUrl) {
      throw new Error("No websocket URL supplied");
    }
    //reinitialize collections in case the client ever disconnects/reconnects
    this.collections = new CollectionStore();
    
    
    let agent = undefined;
    if (this.opt.proxy) {
      let opt = url.parse(this.opt.wsUrl);
      if (this.opt.wsUrl.index('ws://') == 0) {
        agent = new proxyHttp(opt);
      } else {
        agent = new ProxyHttps(opt);
      }
      this.ws = new WebSocket(this.opt.wsUrl, {agent: agent});
    } else {
      this.ws = new WebSocket(this.opt.wsUrl);
    }
    this.ws.on('open', () => {
      client.emit('open');
    });
    this.ws.on('message', (data) => {
      data = data.toString();
      let msg = DDPMessage.unwrap(data);
      if (!msg) {
        return;
      }
      client.emit('ddpMessage', msg);
      client.emit(msg.msg, msg);
    });
    this.ws.on('close', (event) => {
      client.emit('close', event);
    });
    this.ws.on('error', (event) => {
      client.emit('error', event);
    });
  }
  
  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }
  
  reconnect() {
    let client = this;
    if (this.ws) {
      //calling start() on the ws's close event does not caues an infinite
      //reconnection loop because the client makes a new ws object when it
      //reconnects.
      this.ws.on('close', () => {client.start()});
      this.ws.close();
      this.ws = undefined;
    }
  }
  
  send(message) {
    if (message.constructor.name === 'String') {
      message = DDPMessage.build(message);
    }
    this._sendStr(DDPMessage.wireString(message));
  }
  
  _sendStr(messageStr) {
    this.ws.send(messageStr);
    this.emit('sent', messageStr);
  }
  
  connect() {
    this.send({'msg':'connect','version':'1','support':['1','pre2','pre1']});
  }
  
  appToWs(appUrl) {
    if (appUrl.match(/^https?:\/\//)) {
      appUrl = appUrl.replace(/^http/, 'ws');
    }
    return this.appendWsPath(appUrl);
  }
    
  appendWsPath(url) {
    if (!url.endsWith('/')) {
      url = url + '/';
    }
    url += ['sockjs', util.randomDigits(3), util.randomLetters(8), 'websocket'].join('/');
    return url;
  }
};

/**
 * Helper functions for generating client objects from command-line options.
 * Currently automatically errors out and exits if arguments are invalid.
 **/
function autoClientOpt(args) {
  let opt = {appUrl: args.urlbase};
  if (args.username && args.password) {
    opt.login = {username: args.username, password: args.password};
  } else if (args.login) {
    if (typeof args.login === 'string') {
      opt.login = {
        'username': args.login.substring(0, args.login.indexOf(':')), 
        'password': args.login.substring(args.login.indexOf(':') + 1)
      };
    }
  } else if (args.token) {
    opt.login = {token: args.token};
  } else if (args.username) {
    util.errlog0('error: username specified but no password (-p password)');
    process.exit(1);
  } else if (args.password) {
    util.errlog0('error: password specified but no username (-u username)');
    process.exit(1);
  }
  opt.proxy = args.proxy ? args.proxy : undefined;
  opt.concurrency = args.concurrency ? args.concurrency : undefined;
  return opt;
}

function autoClient(args) {
  let opt = autoClientOpt(args);
  return new DDPClient(opt);
}

const defaultManagerOptions = {
  concurrency: 5,
  recordUndefinedAnswers: false,
  generateAnswer: (m) => m,
  generateMessage: (m) => ({'msg':m})
};

/**
 * Base class for all probe managers, which take a series of inputs, translate
 * each one into a probe message, send that message, and record the result.
 * Mandatory keys in the options object are inputs (an array of arbitrary
 * objects, such as strings from a wordlist), generateMessage and
 * generateAnswer.  generateMessage is a callback that takes an input and
 * returns a message object.  If the original inputs were strings, they'll
 * be turned into {'name':input} objects so that generateMessage will always
 * receive an object as input.  generateAnswer is a callback that takes two
 * inputs: the response message, and an object with the original probe data.
 * If your original input was the string "password123," the probe data object
 * will look like this: {'name':'password123','message':{...}}, where 'message'
 * is the full DDP message object generated by the generateMessage callback.
 * 
 * Read some of the examples in ehf.js and hopefully it'll make sense.
 *
 * If you're subclassing ProbeManager, as is done in FileProbeManager and
 * QuiverProbeManager, you may want to override the functions getNextProbe()
 * and outOfInputs().  See QuiverProbeManager for an example of overriding
 * other functions to make deeper changes to the ProbeManager's logic.
 *
 * Other options:
 *
 * concurrency: the number of probes that the manager will run at once.
 *
 * recordUndefinedAnswers: if false or unspecified, any time generateAnswer
 * returns undefined, the answer won't be recorded at all.
 **/
class ProbeManager extends EventEmitter {
  constructor(client, options) {
    super();
    this.client = client;
    this.opt = {
      ...defaultManagerOptions,
      ...options,
      stopped: false,
      completed: false
    };
    this.answers = {};
    this.probes = {};
  }
  
  forceStart() {
    let mgr = this;
    this.client.once('booted', () => mgr.start());
    this.client.start();
  }
  
  start() {
    let manager = this;
    this.client.on('ddpMessage', (m) => {
      let id = DDPMessage.idRef(m);
      let probe =  manager.probes[id];
      if (!probe) {
        return;
      }
      let answer = manager.opt.generateAnswer(m, probe, manager.client);
      if (answer !== undefined || this.opt.recordUndefinedAnswers) {
        manager.answers[probe.name] = answer;
      }
      delete manager.probes[id];
      
      manager.refillQueue();
      if (manager.isCompleted()) {
        manager.opt.completed = true;
        manager.emit('completed');
      }
    });
    this.client.on('error', () => manager.stop());
    this.client.on('disconnected', () => manager.stop()); //TODO implement client autoreconnect?
    this.refillQueue();
  }
  
  stop() {
    this.opt.stopped = true;
  }
  
  refillQueue() {
    let p;
    while (!this.opt.stopped && this.belowCapacity() && (p = this.getNextProbe()) !== null) {
      this.addProbe(p);
    }
  }
  
  belowCapacity() {
    return this.opt.concurrency === 0 || this.numPending() < this.opt.concurrency;
  }
  
  numPending() {
    return Object.keys(this.probes).length;
  }
  
  getNextProbe() {
    if (this.opt.inputs.length == 0) {
      return null;
    }
    return this.opt.inputs.shift();
  }
  
  outOfInputs() {
    return this.opt.inputs.length == 0;
  }
  
  isCompleted() {
    return this.numPending() == 0 && this.outOfInputs();
  }
  
  addProbe(input) {
    if (typeof input == 'string') {
      input = {'name': input};
    }
    //We use this try/catch block because when fuzzing, generateMessage will
    //cause a JSON deserialization exception if the replacement creates an
    //invalid payload.  Other testing has indicated that Meteor properly
    //rejects all invalid JSON, so we can just skip those inputs.
    let message = undefined;
    try {
      message = this.opt.generateMessage(input);
      message.id = util.randomId();
    } catch (e) {
      util.errlog1("skipping probe for input", input, "because generateMessage caused exception", e);
      return;
    }
    this.probes[message.id] = {...input, 'message': message};
    this.client.send(message);
  }
};

/**
 * This probe manager does NOT take a client as a constructor parameter.
 * Instead, it fires off options.concurrency probes, waits for the responses,
 * then closes the client and starts a new one.  This class is designed for use
 * in attacks against endpoints that are protected by the DDP rate limiter,
 * which, sadly, only rate limits a single DDP connection.
 **/
class QuiverProbeManager extends ProbeManager {
  constructor(options) {
    super(undefined, options);
  }
  
  initClient() {
    //TODO: decompose this better to use a super function
    if (this.client && this.client.ws) {
      this.client.ws.close();
    }
    this.client = undefined;
    this.client = new DDPClient(this.opt.clientOpt);
    let manager = this;
    this.client.on('ddpMessage', (m) => {
      let id = m.offendingMessage !== undefined ? m.offendingMessage.id : m.id;
      let probe =  manager.probes[id];
      if (!probe) {
        return;
      }
      let answer = manager.opt.generateAnswer(m, probe, manager.client);
      if (answer !== undefined || manager.opt.recordUndefinedAnswers) {
        manager.answers[probe.name] = answer;
      }
      delete manager.probes[id];
      
      if (manager.isQuiverCompleted()) {
        if (manager.isCompleted()) {
          manager.opt.completed = true;
          manager.emit('completed');
          manager.client.ws.close();
        } else {
          manager.refillAndFireQuiver();
        }
      }
    });
    this.client.on('error', () => manager.stop());
    this.client.on('disconnected', () => manager.stop()); //TODO implement client autoreconnect?
  }
  
  start() {
    this.refillAndFireQuiver();
  }
  
  stop() {
    this.opt.stopped = true;
  }
  
  isQuiverCompleted() {
    return this.numPending() === 0;
  }
  
  refillAndFireQuiver() {
    if (this.opt.stopped) {
      return;
    }
    this.emit('refillStarted');
    this.initClient();
    let manager = this;
    this.client.on('booted', () => {
      let p = undefined;
      while (!this.opt.stopped && this.belowCapacity() && (p = this.getNextProbe()) !== null) {
        this.addProbe(p);
      }
    });
    this.client.start();
  }
};

/**
 * This class takes a filename option and reads inputs from that file instead
 * of taking an array of strings (or objects) in the options object.  The
 * startIndex and lineDelta parameters can be used to have multiple managers
 * read from the same file.  If you have three managers reading from the same
 * file, give them all a lineDelta of 3, and give each a startIndex of 0, 1 or
 * 2.  When each manager reads its next input, it will jump ahead three lines
 * at a time instead of one.  The problem with this approach is that each
 * manager has to read the entire file.  TODO: build a separate class that
 * reads the file line by line, caches each individual line and deletes each
 * one after all the constituent managers are after that point in the file.
 */
class FileProbeManager extends ProbeManager {
  constructor(client, options) {
    super(client, options);
    this.file = new nReadLines(this.opt.filename);
    this.fileEmpty = false;
    if (this.opt.startIndex) {
      for (var i = 0; i < this.opt.startIndex; ++i) {
        this.file.next();
      }
    }
    if (!this.opt.lineDelta) {
      this.opt.lineDelta = 1;
    }
  }
  
  getNextProbe() {
    let line = undefined;
    for (var i = 0; i < this.opt.lineDelta; ++i) {
      line = this.file.next();
    }
    if (line === false) {
      this.fileEmpty = true;
      return null;
    }
    return line.toString().trim();
  }
  
  outOfInputs() {
    if (this.fileEmpty) {
      return true;
    }
    if (this.file.eofReached && this.file.linesCache.length === 0) {
      this.fileEmpty = true;
      return true;
    }
    return false;
  }
};

//helper to generate a password parameter for a login message.
function passwordParameter(pw) {
  return {'digest': crypto.createHash('sha256').update(pw).digest('hex'),'algorithm':'sha-256'};
}

//helper to generate a login message.
function loginMessage(opt) {
  let loginMsg = {'msg': 'method', 'method': 'login', 'params': []};
  if ((opt.username || opt.email) && opt.password) {
    let userParam = opt.username ? {'username':opt.username} : {'email':opt.email}
    loginMsg.params = [{'user':userParam,'password':passwordParameter(opt.password)}];
  } else if (opt.token) {
    loginMsg.params = [{'resume':opt.token}];
  }
  //TODO: do I error here or just chill?
  return loginMsg;
}

module.exports = {FileProbeManager, ProbeManager, DDPClient, DDPMessage, QuiverProbeManager, loginMessage, passwordParameter, autoClient, autoClientOpt};