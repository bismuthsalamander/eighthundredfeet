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
  autoPong: true
};

class DDPMessage {
  constructor(obj) {
    this.message = obj;
  }
  
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
};

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
    this.initLoggers();
  }
  
  initLoggers() {
    this.on('ready', (data) => util.errlog2('ready event', data));
    this.on('loginSuccessful', (data) => util.errlog2('loginSuccessful event', data));
    this.on('loginFailed', (data) => util.errlog1('loginFailed event', data));
    this.on('open', (data) => util.errlog3('open event', data));
    this.on('ddpMessage', (data) => util.errlog3('ddpMessage event', data));
    this.on('close', (data) => util.errlog1('close event', data));
    this.on('sent', (data) => util.errlog3('sent event', data));
  }
  
  start() {
    if (this.ws !== undefined) {
      throw new Error("DDP client already started");
    }
    
    let client = this;
    if (!this.opt.wsUrl) {
      throw new Error("No websocket URL supplied");
    }
    this.on('message', (data) => {
    });
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
          if (data.id != client.loginMsgId) {
            return;
          }
          if (data.result.token) {
            client.sessionToken = data.result.token;
            client.emit('ready', data);
            client.emit('loginSuccessful', data);
          } else {
            client.emit('loginFailed', data);
          }
        });
        client.send(loginMsg);
      } else {
        client.emit('ready');
      }
    });
    this.on('failed', (data) => {
      throw new Error("Connection failed: " + EJSON.stringify(data));
    });
    
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
    this.ws.close();
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

const defaultManagerOptions = {
  concurrency: 5,
  recordUndefinedAnswers: false,
  generateAnswer: (m) => m,
  generateMessage: (m) => ({'msg':m})
};

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
    this.client.once('ready', () => mgr.start());
    this.client.start();
  }
  
  start() {
    let manager = this;
    this.client.on('ddpMessage', (m) => {
      let id = m.offendingMessage !== undefined ? m.offendingMessage.id : m.id;
      let probe =  manager.probes[id];
      if (!probe) {
        return;
      }
      let answer = manager.opt.generateAnswer(m, probe);
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
    let message = this.opt.generateMessage(input);
    message.id = util.randomId();
    this.probes[message.id] = {...input, 'message': message};
    this.client.send(message);
  }
};

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
      let answer = manager.opt.generateAnswer(m, probe);
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
    this.client.on('ready', () => {
      let p = undefined;
      while (!this.opt.stopped && this.belowCapacity() && (p = this.getNextProbe()) !== null) {
        this.addProbe(p);
      }
    });
    this.client.start();
  }
};

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

function passwordParameter(pw) {
  return {'digest': crypto.createHash('sha256').update(pw).digest('hex'),'algorithm':'sha-256'};
}

function loginMessage(opt) {
  let loginMsg = {'msg': 'method', 'method': 'login', 'params': []};
  if (opt.username && opt.password) {
    loginMsg.params = [{'user':{'username':opt.username},'password':passwordParameter(opt.password)}];
  } else if (opt.token) {
    loginMsg.params = [{'resume':opt.token}];
  }
  //TODO: do I error here or just chill?
  return loginMsg;
}

module.exports = {FileProbeManager, ProbeManager, DDPClient, DDPMessage, QuiverProbeManager, loginMessage, passwordParameter };