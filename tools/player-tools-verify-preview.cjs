const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
async function run(){
 const s=JSON.parse(fs.readFileSync('.work/player-tools-preview/state.json'));
 const targets=await(await fetch('http://127.0.0.1:'+s.port+'/json/list')).json();
 const target=targets.find(t=>t.id===s.installTarget);
 const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
 const c=require('./cs2-install-runtime-check.cjs').connectCdp(socket);
 const result=await c.evaluate('window.installProbe');
 assert.ok(result.result?.installed,JSON.stringify(result));
 assert.deepEqual(fs.readFileSync(result.result.installed),fs.readFileSync(s.source));
 const shot=await c.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.work/player-tools-preview/installed.png',Buffer.from(shot.data,'base64'));
 const args=JSON.stringify({source:s.source,destination:s.destination});
 const again=await c.evaluate(`rainTool.call('install',${args}).then(()=>'unexpected overwrite').catch(e=>e.message)`);
 assert.match(again,/EEXIST/);assert.deepEqual(fs.readFileSync(result.result.installed),fs.readFileSync(s.source));
 const appAccess=await c.evaluate("Promise.all([rainTool.call('unknown',{}).catch(e=>e.message),Promise.resolve(typeof alleyDesktop)])");
 assert.match(appAccess[0],/未知操作/);assert.equal(appAccess[1],'undefined');
 console.log('PASS: actual utility process installed exact file bytes, same-name overwrite rejected, error recovery and app bridge isolation.');
 fs.writeFileSync('.work/player-tools-preview/verification.json',JSON.stringify({passed:true,installed:result.result.installed,noOverwrite:true,bridgeIsolated:true},null,2));
 socket.close();
 if(process.argv.includes('--finish')){
   const mainTarget=targets.find(t=>t.url.startsWith('rainalley://app/'));
   const mainSocket=new WebSocket(mainTarget.webSocketDebuggerUrl);await new Promise(r=>mainSocket.onopen=r);
   const main=require('./cs2-install-runtime-check.cjs').connectCdp(mainSocket);
   const closeSocket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>closeSocket.onopen=r);
   await require('./cs2-install-runtime-check.cjs').connectCdp(closeSocket).send('Page.close');closeSocket.close();
   await main.evaluate("document.querySelector('#playerEditor').close();document.querySelector('#creatorOpen').focus()");
   const home=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.work/player-tools-preview/homepage-published.png',Buffer.from(home.data,'base64'));
   mainSocket.close();
 }
}
run().catch(e=>{console.error(e);process.exit(1);});
