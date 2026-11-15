const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createTestApp,freePort,waitForTarget,connectCdp,waitFor}=require('./cs2-install-runtime-check.cjs');
async function connect(target){const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});return {socket,cdp:connectCdp(socket)};}
async function run(){
 const root=path.resolve(__dirname,'..'),base=fs.mkdtempSync(path.join(os.tmpdir(),'alley-player-tools-'));
 const {fixture,seed}=await import('./player-tools-fixture.mjs');const {handleRequest}=await import('../cloudflare/auth-api/src/index.js');
 const f=fixture(),token=await seed(f,'CreatorOne');
 const server=http.createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);const request=new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(bytes.length?{body:bytes}:{})});const response=await handleRequest(request,f);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){console.error(e);res.writeHead(500);res.end(JSON.stringify({error:e.message}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const api='http://127.0.0.1:'+server.address().port;
 const appRoot=createTestApp(base);
 let main=fs.readFileSync(path.join(appRoot,'src/main.cjs'),'utf8').replace('let authSession;',`let authSession = ${JSON.stringify({username:'CreatorOne',token,role:'player',expiresAt:Math.floor(Date.now()/1000)+86400})};`).replace('net.fetch(apiUrl(route),','net.fetch('+JSON.stringify(api)+' + route,');
 fs.writeFileSync(path.join(appRoot,'src/main.cjs'),main);
 const preload=path.join(appRoot,'src/preload.cjs');fs.writeFileSync(preload,fs.readFileSync(preload,'utf8').replace("resumeAccount: async () => ({ username: 'CS2RUNTIME' }),","resumeAccount: async () => ({ username: 'CreatorOne' }),"));
 const port=await freePort(),env={...process.env,RAIN_ALLEY_TEST_MODE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[appRoot,'--remote-debugging-port='+port,'--remote-allow-origins=*','--user-data-dir='+path.join(base,'profile')],{cwd:appRoot,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='';app.stdout.on('data',chunk=>output+=chunk);app.stderr.on('data',chunk=>output+=chunk);
 let target;try{target=await waitForTarget(port,app);}catch(e){throw new Error(e.message+'\n'+output.slice(-5000));}
 const {socket,cdp}=await connect(target);
 socket.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.method==='Page.javascriptDialogOpening')cdp.send('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});});
 await cdp.send('Page.enable');
 const out=path.join(root,'.work/player-tools-preview');fs.mkdirSync(out,{recursive:true});
 const shot=async(name,client=cdp)=>{const image=await client.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(image.data,'base64'));};
 await waitFor(cdp,"!!document.querySelector('#creatorOpen') && document.body.dataset.page==='scene'",'community homepage did not load');
 await waitFor(cdp,"document.querySelector('#communityStatus').textContent.includes('第一封')",'local API did not return empty listing');
 await cdp.evaluate("document.querySelector('#creatorOpen').click();document.querySelector('#creatorStory').click()");
 await shot('creator-story');
 await cdp.evaluate("document.querySelector('#creatorPreview').click()");
 let targets;for(let n=0;n<80;n++){targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();if(targets.some(x=>x.url.startsWith('data:')))break;await new Promise(r=>setTimeout(r,100));}
 const storyTarget=targets.find(x=>x.url.startsWith('data:'));assert.ok(storyTarget,'standalone tool page opened');
 const story=await connect(storyTarget);await waitFor(story.cdp,"!!document.querySelector('#read')",'story not rendered');
 assert.equal(await story.cdp.evaluate("typeof window.alleyDesktop"),'undefined');
 assert.equal(await story.cdp.evaluate("typeof require"),'undefined');
 assert.equal(await story.cdp.evaluate("try{localStorage.setItem('probe','1');'allowed'}catch(e){'blocked'}"),'blocked');
 await story.cdp.evaluate("document.querySelector('#read').click()");assert.match(await story.cdp.evaluate("document.querySelector('#next').textContent"),/带一把伞/);await shot('story-running',story.cdp);await story.cdp.send('Page.close');story.socket.close();
 await cdp.evaluate("document.querySelector('#creatorForm').requestSubmit()");
 await waitFor(cdp,"document.querySelector('#creatorStatus').textContent.includes('来信已发布')",'UI publish failed');
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM player_tools').get().n,1);
 await cdp.evaluate("document.querySelector('#creatorClose').click()");await shot('homepage-published');
 await cdp.send('Page.reload');await waitFor(cdp,"document.querySelectorAll('.player-card').length===1",'published tool missing after reload');
 await cdp.evaluate("document.querySelector('#creatorOpen').click();document.querySelector('#creatorInstall').click()");
 await waitFor(cdp,"document.querySelector('#creatorBackend').value.includes('copyFile')",'install template not loaded');
 const dest=path.join(base,'installed');fs.mkdirSync(dest);const source=path.join(base,'player-resource.txt');fs.writeFileSync(source,'Rain Alley real installation verification\n','utf8');
 await shot('creator-install');
 await cdp.evaluate("document.querySelector('#creatorPreview').click()");
 for(let n=0;n<80;n++){targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();if(targets.some(x=>x.url.startsWith('data:')))break;await new Promise(r=>setTimeout(r,100));}
 const installTarget=targets.find(x=>x.url.startsWith('data:'));assert.ok(installTarget);
 const install=await connect(installTarget);await waitFor(install.cdp,"!!document.querySelector('#install')",'install page not rendered');
 await install.cdp.evaluate(`window.installProbe={pending:true};rainTool.call('install',${JSON.stringify({source,destination:dest})}).then(result=>{window.installProbe={result};document.querySelector('#status').textContent='已安装：'+result.installed;}).catch(e=>window.installProbe={error:e.message});'started'`);
 fs.writeFileSync(path.join(out,'state.json'),JSON.stringify({base,appRoot,port,api,pid:app.pid,installTarget:installTarget.id,source,destination:dest},null,2));
 console.log('PASS: real local Worker handlers + SQLite, UI publish/reload, frontend interaction, account bridge isolation and opaque storage.');
 console.log('WAITING_NATIVE_CONSENT '+path.join(out,'state.json'));
 socket.close();install.socket.close();
 // Keep this local-only API and the visible native preview alive for review.
 app.once('exit',()=>{server.close();f.db.close();});
}
run().catch(e=>{console.error(e);process.exit(1);});
