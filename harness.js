const express = require('express');
const ddp = require('./ddp');
const util = require('./util');
const fs = require('fs');

function harnessServer(opt) {
  const app = express();
  console.log(opt);
  let seedTemplate = fs.readFileSync('./seed.html').toString(); //todo: dir(__file__)?
  console.log(seedTemplate); 
  let messageText = fs.readFileSync(opt.messagefile);
  let seedPage = seedTemplate.replace('MESSAGES', Buffer.from(messageText).toString('base64'));
  app.use(express.json());
  app.get('/seed', (req, res) => {
    res.send(seedPage);
  });
  app.post('/proxy', async (req, res) => {
    let msg = req.body; //TODO: what if no body?
    if (!msg) {
      res.json({});
    }
    let response = await(getMessageResponse(msg, opt));
    res.json(response);
  });
  app.get('/seed', (req, res) => {
  });
  app.listen(9010);
  return app;
}

function getMessageResponse(msg, opt) {
  return new Promise((resolve) => {
    let client = new ddp.autoClient(opt);
    let msgId = util.randomId();
    let myMsg = util.ejsonClone(msg);
    myMsg.id = msgId;
    client.on('ddpMessage', (m) => {
      let id = m.offendingMessage !== undefined ? m.offendingMessage.id : m.id;
      if (id !== myMsg.id) {
        return;
      }
      resolve(m);
      client.close();
    });
    client.on('ready', () => client.send(myMsg));
    client.on('close', (e) => resolve(e));
    client.on('error', (e) => resolve(e));
    client.on('disconnect', (e) => resolve(e));
    client.start();
  });
}

module.exports = {harnessServer};