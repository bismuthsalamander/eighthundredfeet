const express = require('express');
const ddp = require('./ddp');
const util = require('./util');
const fs = require('fs');
const EJSON = require('ejson');

function harnessServer(opt) {
  const app = express();
  let seedTemplate = fs.readFileSync('./seed.html').toString(); //todo: dir(__file__)?
  let messageText = fs.readFileSync(opt.messagefile);
  let seedPage = seedTemplate.replace('MESSAGES', Buffer.from(messageText).toString('base64'));
  app.use(express.json());
  app.get('/seed', (req, res) => {
    res.send(seedPage);
  });
  app.post('/proxy', async (req, res) => {
    let msg = EJSON.stringify(req.body); //TODO: what if no body?
    if (!msg) {
      res.json({});
    }
    let response = await getMessageResponse(msg, opt);
    res.json(response);
  });
  app.listen(opt.port, '127.0.0.1');
  return app;
}

const COLLECTION_MESSAGES = ['added', 'changed', 'removed', 'addedBefore', 'movedBefore'];

function getMessageResponse(msg, opt) {
  return new Promise((resolve) => {
    if (typeof msg === 'string') {
      msg = EJSON.parse(msg);
    }
    let client = new ddp.autoClient(opt);
    let msgId = util.randomId();
    let myMsg = util.ejsonClone(msg);
    myMsg.id = msgId;

    let collections = {};
    let applyCollectionMsg = (msg) => {
        let cname = msg.collection;
        if (!collections.hasOwnProperty(cname)) {
            collections[cname] = [];
        }
        let docid = msg.id;
        let before = msg.before;
        if (msg.msg == 'added') {
            let obj = msg.fields;
            obj['id'] = docid;
            collections[cname].push(obj);
        } else if (msg.msg == 'changed') {
            let target = collections[cname].find((x) => x.id == docid);
            Object.entries(msg.fields).forEach((k, v) => target[k] = v);
        } else if (msg.msg == 'removed') {
            collections[cname] = collections[cname].filter((x) => x.id != docid);
        } else if (msg.msg == 'addedBefore') {
            let obj = msg.fields;
            obj['id'] = docid;
            let idx = collections[cname].findIndex((x) => x.id == before);
            collections[cname] = collections[cname].slice(0, idx).concat([obj], collections[cname].slice(idx));
        } else if (msg.msg == 'movedBefore') {
            let doc = collections[cname].find((x) => x.id == docid);
            let rest = collections[cname].filter((x) => x.id != docid);
            let idx = rest.findIndex((x) => x.id == before);
            collections[cname] = rest.slice(0, idx).concat([doc], rest.slice(idx));
        }
    };
    client.on('ddpMessage', (m) => {
      let id = ddp.DDPMessage.idRef(m);
      if (id == myMsg.id) {
        if (EJSON.stringify(collections) != EJSON.stringify({})) {
          resolve({'finalMessage': m, 'collections': collections});
        } else {
          resolve(m);
        }
        client.close();
      }
      if (COLLECTION_MESSAGES.includes(m.msg)) {
        applyCollectionMsg(m);
      }
    });
    client.on('booted', () => client.send(myMsg) );
    client.on('close', (e) => resolve(e));
    client.on('error', (e) => resolve(e));
    client.on('disconnect', (e) => resolve(e));
    client.start();
  });
}

module.exports = {harnessServer};