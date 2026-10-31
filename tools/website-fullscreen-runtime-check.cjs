const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {createTestApp,freePort,waitForTarget,connectCdp,waitFor}=require('./cs2-install-runtime-check.cjs');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'alley-fullscreen-')),appRoot=createTestApp(base),profile=path.join(base,'profile');
 fs.mkdirSync(profile);fs.mkdirSync(path.join(profile,'downloads'));fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({downloadDirectory:path.join(profile,'downloads'),allowedHosts:['127.0.0.1','bilibili.com'],allowHttp:true,allowLocalNetwork:true}));
 const pf=path.join(appRoot,'src/preload.cjs');let p=fs.readFileSync(pf,'utf8');
 p=p.replace("openWebsite: async (url, _approved, tabId) => ({ id: tabId || 'test-tab', url, title: '测试分享页', loading: false }),","openWebsite: (url, approvedByUser = false, tabId) => ipcRenderer.invoke('site:open', url, approvedByUser === true, tabId),");
 p=p.replace('chooseCs2Directory:',"testSite: (action, value) => ipcRenderer.invoke('test:site', action, value), chooseCs2Directory:");fs.writeFileSync(pf,p);
 fs.appendFileSync(path.join(appRoot,'src/main.cjs'),`
ipcMain.handle('test:site',async(_e,action,value)=>{
 const v=websiteViews.get(activeWebsiteId);
 if(action==='shot'){const img=await v.webContents.capturePage();fsSync.writeFileSync(value,img.toPNG());return true;}
 if(action==='eval')return v.webContents.executeJavaScript(value,true);
 if(action==='key'){v.webContents.sendInputEvent({type:'keyDown',keyCode:value});v.webContents.sendInputEvent({type:'keyUp',keyCode:value});return true;}
 if(action==='state')return {fullscreen:windowRef.isFullScreen(),id:fullscreenWebsiteId,bounds:v?.getBounds(),size:windowRef.getContentSize()};
 if(action==='health'){const r=await net.fetch(value,{signal:AbortSignal.timeout(20000)});return {status:r.status,url:r.url};}
});`);
 const server=require('node:http').createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end(req.url==='/frame'?'<body style="background:#152334;color:white"><h1>嵌入播放器</h1><button id="full" onclick="document.body.requestFullscreen()">进入全屏</button>':'<body style="margin:0;background:#16202c;color:#fff;font:24px sans-serif"><h1>雨巷来信 · 全屏验证</h1><button id="full" onclick="document.documentElement.requestFullscreen()">进入全屏</button><iframe allowfullscreen src="/frame" style="width:600px;height:300px"></iframe></body>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/';
 const port=await freePort(),env={...process.env,RAIN_ALLEY_TEST_MODE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const proc=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[appRoot,'--remote-debugging-port='+port,'--remote-allow-origins=*','--user-data-dir='+profile],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});let output='',socket;proc.stdout.on('data',c=>output+=c);proc.stderr.on('data',c=>output+=c);
 try{
 const target=await waitForTarget(port,proc);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});const cdp=connectCdp(socket);
 await waitFor(cdp,"document.body.dataset.page==='scene'",'No home');
 const call=(a,v)=>cdp.evaluate('window.alleyDesktop.testSite('+JSON.stringify(a)+','+JSON.stringify(v)+')');
 const route=v=>cdp.evaluate("document.querySelector('#appAddressInput').value="+JSON.stringify(v)+";document.querySelector('#addressForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
 const shot=async n=>{await delay(350);const r=await cdp.send('Page.captureScreenshot');fs.writeFileSync(path.join(root,'release',n),Buffer.from(r.data,'base64'));};
 const prefs=await cdp.evaluate('window.alleyDesktop.getState()');for(const h of ['maomaochongmiao.600318.xyz','mistport.600318.xyz','career.600318.xyz','usc.600318.xyz'])assert.ok(prefs.preferences.allowedHosts.includes(h));
 const features=await cdp.evaluate("import('./features.js').then(m=>m.features.filter(f=>['cat-stickers','bilibili','mistport','cs-career','useless-skills'].includes(f.id)))");assert.equal(features.length,5);assert.ok(features.every(f=>f.availability==='ready'&&f.siteUrl));
 await route('rainalley://app/catalog?category=website');await shot('preview-websites.png');
 await route(url);await waitFor(cdp,"window.alleyDesktop.testSite('state').then(s=>s.bounds?.width>0)",'No view');
 await call('eval','document.querySelector("#full").click()');
 await waitFor(cdp,"window.alleyDesktop.testSite('state').then(s=>s.fullscreen&&s.id&&s.bounds.x===0&&s.bounds.y===0&&s.bounds.width===s.size[0]&&s.bounds.height===s.size[1])",'Fullscreen bounds failed');
 await cdp.evaluate("window.dispatchEvent(new Event('resize'))");await delay(250);let s=await call('state');assert.equal(s.bounds.height,s.size[1]);await call('shot',path.join(root,'release/preview-website-fullscreen.png'));
 await call('key','Escape');await waitFor(cdp,"window.alleyDesktop.testSite('state').then(s=>!s.fullscreen&&!s.id&&s.bounds.y>0)",'Esc restore failed');assert.equal(await call('eval','!!document.fullscreenElement'),false);
 await call('eval','document.querySelector("iframe").contentDocument.querySelector("#full").click()');await waitFor(cdp,"window.alleyDesktop.testSite('state').then(s=>s.fullscreen)",'Iframe fullscreen failed');await call('key','Escape');await waitFor(cdp,"window.alleyDesktop.testSite('state').then(s=>!s.fullscreen)",'Iframe exit failed');
 await call('eval','document.querySelector("#full").click()');await waitFor(cdp,"window.alleyDesktop.testSite('state').then(s=>s.fullscreen)",'Repeat fullscreen failed');await route('rainalley://app/home');await waitFor(cdp,"window.alleyDesktop.testSite('state').then(s=>!s.fullscreen&&!s.id&&(!s.bounds||s.bounds.width===0))",'Home restore failed').catch(async e=>{console.log(await call('state'));console.log(await cdp.evaluate('document.body.dataset.page'));throw e;});
 const checks=['Five catalog entries ready','Old allowlist migrated','Native fullscreen fills content and survives renderer resize','Esc exits and restores bounds','Iframe enters and exits fullscreen','Home exits fullscreen and hides native view'];console.log(JSON.stringify({checks}));
 let bilibili;
 try {
 await route('https://www.bilibili.com/video/BV1GJ411x7h7/');
 await delay(5000); assert.ok(await call('eval','!!document.querySelector(".bpx-player-ctrl-full")'),'Bilibili player unavailable');
 await call('eval','document.querySelector(".bpx-player-ctrl-full").click()');
 await waitFor(cdp,"window.alleyDesktop.testSite('state').then(s=>s.fullscreen&&s.id&&s.bounds.height===s.size[1])",'Bilibili fullscreen failed',10000);
 await delay(500);await call('shot',path.join(root,'release/preview-bilibili-fullscreen.png'));
 await call('key','Escape');await waitFor(cdp,"window.alleyDesktop.testSite('state').then(s=>!s.fullscreen&&!s.id&&s.bounds.y>0)",'Bilibili Esc failed',10000);
 bilibili={passed:true};checks.push('Real Bilibili player fullscreen button and Esc passed');
 } catch(e){bilibili={passed:false,error:e.message};}
 const health=await Promise.all(features.map(async f=>{try{return {id:f.id,...await call('health',f.siteUrl)};}catch(e){return {id:f.id,error:e.message};}}));
 fs.writeFileSync(path.join(root,'release/website-fullscreen-verification.json'),JSON.stringify({checks,bilibili,health},null,2));console.log(JSON.stringify({health}));
 }catch(e){throw new Error(e.stack+'\n'+output.slice(-2500));}finally{socket?.close();server.close();if(proc.exitCode===null)spawnSync('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});await delay(500);try{fs.rmSync(base,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch(e){console.warn(base+': '+e.code);}}
}
run().catch(e=>{console.error(e);process.exitCode=1;});



