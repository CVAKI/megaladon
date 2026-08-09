'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { exec } = require('child_process');
const { kp, wh, ab, dg } = require('./colors');
const {
  loadConfig, saveConfig,
  loadMemory, saveMemory, updateMemory,
  CONFIG_PATH, MEMORY_PATH, SKILLS_DIR, SESS_DIR,
} = require('./config');

// ─── Web Dashboard ────────────────────────────────────────────────────────────
// Starts a local HTTP server at http://localhost:PORT with a full control panel.
// Accessible via /dashboard command inside Megaladon.
let dashboardServer = null;
const DASH_HTML = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');

function startDashboard(port, cfgRef, memRef, messagesRef, statusRef, version) {
  if (dashboardServer) { console.log('\n  '+kp('Dashboard already running → ')+wh('http://localhost:'+port)); return; }

  const startTime = Date.now();
  dashboardServer = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const cors = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};

    if (url==='/'||url==='') {
      res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});
      res.end(DASH_HTML); return;
    }
    if (url==='/api/status') {
      const mem2=loadMemory();
      const cfg2=loadConfig();
      const upSec=Math.floor((Date.now()-startTime)/1000);
      const mu=process.memoryUsage();
      res.writeHead(200,cors);
      res.end(JSON.stringify({
        ok:true,
        version: version || '4.0.0',
        mode:statusRef.mode,
        model:statusRef.model,
        msgCount:statusRef.msgCount,
        messages:(messagesRef || []).slice(-30),
        config:cfg2,
        memory:mem2,
        node:process.version,
        platform:process.platform+' '+os.arch(),
        memUsage:Math.round(mu.rss/1024/1024)+'MB RSS / '+Math.round(mu.heapUsed/1024/1024)+'MB heap',
        uptime:upSec<60?upSec+'s':Math.floor(upSec/60)+'m '+upSec%60+'s',
        paths:{config:CONFIG_PATH,memory:MEMORY_PATH,skills:SKILLS_DIR,sessions:SESS_DIR},
      })); return;
    }
    if (url==='/api/config'&&req.method==='GET') {
      res.writeHead(200,cors); res.end(JSON.stringify(loadConfig())); return;
    }
    if (url==='/api/config'&&req.method==='POST') {
      let body='';
      req.on('data',c=>body+=c);
      req.on('end',()=>{
        try {
          const d=JSON.parse(body);
          const cfg2=loadConfig();
          if (d.provider) cfg2.provider=d.provider;
          if (d.apiKey!==undefined) cfg2.apiKey=d.apiKey;
          if (d.model) cfg2.model=d.model;
          saveConfig(cfg2);
          res.writeHead(200,cors); res.end(JSON.stringify({ok:true}));
        } catch(e){res.writeHead(400,cors);res.end(JSON.stringify({ok:false,err:e.message}));}
      }); return;
    }
    if (url==='/api/memory'&&req.method==='GET') {
      res.writeHead(200,cors); res.end(JSON.stringify(loadMemory())); return;
    }
    if (url==='/api/memory'&&req.method==='POST') {
      let body='';
      req.on('data',c=>body+=c);
      req.on('end',()=>{
        try {
          const {key,value}=JSON.parse(body);
          const mem2=loadMemory();
          updateMemory(mem2,[{key,value}]); saveMemory(mem2);
          if (memRef) { memRef.facts=mem2.facts; }
          res.writeHead(200,cors); res.end(JSON.stringify({ok:true}));
        } catch(e){res.writeHead(400,cors);res.end(JSON.stringify({ok:false,err:e.message}));}
      }); return;
    }
    if (url.startsWith('/api/memory/')&&req.method==='DELETE') {
      const seg=url.slice('/api/memory/'.length);
      const mem2=loadMemory();
      if (seg==='all') { mem2.facts=[]; mem2.sessionSummaries=[]; }
      else { const i=parseInt(seg); if (!isNaN(i)) mem2.facts.splice(i,1); }
      saveMemory(mem2);
      if (memRef) { memRef.facts=mem2.facts; }
      res.writeHead(200,cors); res.end(JSON.stringify({ok:true})); return;
    }
    res.writeHead(404,cors); res.end(JSON.stringify({ok:false,err:'Not found'}));
  });

  dashboardServer.listen(port, '127.0.0.1', () => {
    console.log('\n  '+kp('✔ Dashboard running → ')+wh('http://localhost:'+port));
    console.log('  '+ab('Open in browser · Updates every 5s · Ctrl+C to quit'));
    try {
      if (process.platform==='win32') exec('start http://localhost:'+port,{shell:true});
      else if (process.platform==='darwin') exec('open http://localhost:'+port);
      else exec('xdg-open http://localhost:'+port);
    } catch(_){}
  });
  dashboardServer.on('error',e=>{
    console.log('\n  '+dg('✘ Dashboard error: ')+e.message);
    if (e.code==='EADDRINUSE') console.log('  '+ab('Port '+port+' already in use. Try /dashboard 7071'));
    dashboardServer=null;
  });
}

module.exports = { startDashboard };