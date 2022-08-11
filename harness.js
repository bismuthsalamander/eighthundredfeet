const ddp = require('./ddp');
const util = require('./util');
const fs = require('fs');
const EJSON = require('ejson');

function harnessServer(opt) {
  const express = require('express');
  const app = express();
  let seedTemplate = fs.readFileSync('./seed.html').toString(); //todo: dir(__file__)?
  let messageText = '';
  if (opt.messagefile && opt.messagefile.length > 0) {
    try {
      messageText = fs.readFileSync(opt.messagefile);
    } catch (e) {
      console.error("Error loading seed file:", e);
      process.exit(1);
    }
  }
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

function getMessageResponse(msg, opt) {
  return new Promise((resolve) => {
    if (typeof msg === 'string') {
      msg = EJSON.parse(msg);
    }
    let client = new ddp.autoClient(opt);
    let msgId = util.randomId();
    let myMsg = util.ejsonClone(msg);
    myMsg.id = msgId;

    client.on('ddpMessage', (m) => {
      let id = ddp.DDPMessage.idRef(m);
      if (id == myMsg.id) {
        if (!client.collections.isEmpty()) {
          resolve({'finalMessage': m, 'collections': client.collections.collections});
        } else {
          resolve(m);
        }
        client.close();
      }
    });
    client.on('booted', () => client.send(myMsg));
    client.on('close', (e) => resolve(e));
    client.on('error', (e) => resolve(e));
    client.on('disconnect', (e) => resolve(e));
    client.start();
  });
}

module.exports = {harnessServer};