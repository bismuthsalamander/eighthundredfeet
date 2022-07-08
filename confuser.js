const { ProbeManager, DDPMessage, DDPClient } = require('./ddp');
const util = require('./util');

function typeDescriptor(x) {
  if (typeof x !== 'object') {
    return typeof x;
  }
  if (Array.isArray(x)) {
    return x.map((y) => typeDescriptor(y));
  }
  var keys = Object.keys(x).sort();
  var obj = {};
  keys.forEach((k) => {
    obj[k] = typeDescriptor(x[k])
  });
  return obj;
}

function typesEqual(a, b) {
  return JSON.stringify(typeDescriptor(a)) === JSON.stringify(typeDescriptor(b));
}

const scalarTypes = ['string', 'number', 'boolean'];
const allTypes = ['string', 'number', 'boolean', 'object'];

let f = (a, b) => [].concat(...a.map(a => b.map(b => [].concat(a, b))));
let cartesian = (a, b, ...c) => b ? cartesian(f(a, b), ...c) : a;

function maxCount(a) {
  let count = 0;
  a.forEach((entry) => {
    count = (entry.length > count) ? entry.length : count;
  });
  return count;
}

function getConfusers(td) {
  return getConfusersRec(td).filter((x) => x.accessPath.length > 0);
}

function getConfusersRec(td) {
  if (typeof td === 'string') {
    let newTypes = allTypes.filter((x) => x !== td);
    return [{'accessPath':[], 'types':newTypes}];
  }
  if (Array.isArray(td)) {
    let confusers = [];
    let inner = td.map((x) => getConfusersRec(x));
    for (var i = 0; i < inner.length; ++i) {
      for (var j = 0; j < inner[i].length; ++j) {
        confusers.push({
          'accessPath':[i].concat(inner[i][j].accessPath),
          'types': inner[i][j].types
        });
      }
    }
    confusers.push({
      'accessPath':[],
      'types':scalarTypes
    });
    return confusers;
  }
  var keys = Object.keys(td).sort();
  let confusers = [];
  keys.forEach((k) => {
    let inner = getConfusersRec(td[k]);
    inner.forEach((m) => {
      confusers.push({
        'accessPath':[k].concat(m.accessPath),
        'types':m.types
      });
    });
  });
  confusers.push({
    'accessPath':[],
    'types':scalarTypes
  });
  return confusers;
}

const values = {
  'object': {'key': 'value'},
  'number': 5,
  'string': 'helloworld',
  'boolean': true
};

function makeValue(type) {
  return values[type];
}

function parseAccessor(a) {
  if (a[0] == 'i') {
    return parseInt(a.slice(1));
  }
  return a.slice(1);
}

function applyConfuserProbeToParams(params, probe) {
  let n = probe.accessPath.length;
  let t = params;
  for (var i = 0; i < n - 1; ++i) {
    t = t[probe.accessPath[i]];
  }
  t[probe.accessPath[n - 1]] = makeValue(probe.type);
}

function inputsFromConfusers(confusers) {
  //this is so confusing
  //each confuser has one access path and a list of types
  //turn it into a list of single-type probe inputs
  //map each confuser into an array, then flatten
  //use reduce instead of flat because i'm currently on node 10 (ubuntu, why)
  console.log("Making inputs");
  console.log(confusers);
  let inp = confusers.map((c) => (c.types.map((t) => ({
    'accessPath': c.accessPath,
    'type': t,
    'name': c.accessPath.join('.') + "-" + t
  })))).reduce((x,y) => x.concat(y));
  return inp;
}

function confuserInputs(message) {
  if (!message.params || !message.params.length) {
    return [];
  }
  let td = typeDescriptor(message.params);
  let c = getConfusers(td);
  return inputsFromConfusers(c);
}

class ConfuserProbeManager extends ProbeManager {
  constructor(client, options) {
    super(client, options);
    let mgr = this;
    let td = typeDescriptor(this.opt.message.params);
    let confusers = getConfusers(td);
    this.opt.inputs = inputsFromConfusers(confusers);
    console.log("Inputs",this.opt.inputs,"\n****************");
    this.opt.baseMessage = util.ejsonClone(this.opt.message);
    this.opt.generateMessage = (x) => {
      let msg = util.ejsonClone(mgr.opt.baseMessage);
      applyConfuserProbeToParams(msg.params, x);
      return msg;
    };
    this.opt.generateAnswer = (x) => {
      if (x.error && x.error.error === 400 && x.error.reason === 'Match failed') {
        return undefined;
      }
      return x;
    };
  }
};

module.exports = {typeDescriptor, getConfusers, applyConfuserProbeToParams, typesEqual, ConfuserProbeManager};