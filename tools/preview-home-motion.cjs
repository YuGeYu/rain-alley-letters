// Run the real Electron renderer with isolated identity/profile fixtures.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {createTestApp,freePort,waitForTarget,connectCdp,waitFor}=require('./cs2-install-runtime-check.cjs');
const root=path.resolve(__dirname,'..');
async function run(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'alley-home-motion-')),appRoot=createTestApp(base),preload=path.join(appRoot,'src/preload.cjs');
 let source=fs.readFileSync(preload,'utf8').replaceAll('CS2RUNTIME','PreviewGuest');
 source=source.replace("getPublicProfile: (username) => ipcRenderer.invoke('profile:get-public', username),","getPublicProfile: async () => ({profile:{displayName:'雨巷来客'}}),");
 source=source.replace("developerAvailable: () => ipcRenderer.invoke('account:developer-available'),","developerAvailable: async () => false,");
 fs.writeFileSync(preload,source);
 const env={...process.env,RAIN_ALLEY_TEST_MODE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const port=await freePort(),proc=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[appRoot,'--remote-debugging-port='+port,'--remote-allow-origins=*','--user-data-dir='+path.join(base,'profile')],{stdio:['ignore','pipe','pipe'],env,windowsHide:true});
 let socket,keep=false,output='';proc.stdout.on('data',c=>output+=c);proc.stderr.on('data',c=>output+=c);
 try{
 const target=await waitForTarget(port,proc).catch(e=>{throw Error(e.message+output.slice(-1200));});socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{socket.onopen=ok;socket.onerror=no;});const cdp=connectCdp(socket);
 await waitFor(cdp,"document.body.dataset.page==='scene' && document.querySelectorAll('.home-envelope').length===6",'Home missing');
 await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 const names=await cdp.evaluate("[getComputedStyle(document.querySelector('.envelope-home-heading')).animationName,getComputedStyle(document.querySelector('.hero-feature-zone')).animationName]");assert.deepEqual(names,['alley-home-arrive','alley-home-arrive']);
 await cdp.evaluate("document.querySelector('#accountPopover').hidden=true");
 await new Promise(r=>setTimeout(r,700));
 const position=await cdp.evaluate("(()=>{const r=document.querySelector('.home-envelope-open').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+45}})()");
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...position});await new Promise(r=>setTimeout(r,300));
 assert.notEqual(await cdp.evaluate("getComputedStyle(document.querySelector('.home-envelope-art')).transform"),'none');
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:20,y:120});
 // Save a small sequence to review real motion; all frames come from Electron.
 await cdp.evaluate("document.querySelector('#openCollectionButton').click();document.querySelector('[data-browser-tab=home]').click()");
 for(let i=0;i<5;i++){await new Promise(r=>setTimeout(r,90));const shot=await cdp.send('Page.captureScreenshot');fs.writeFileSync(path.join(root,'release',`preview-home-motion-${i}.png`),Buffer.from(shot.data,'base64'));}
 await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 assert.equal(await cdp.evaluate("getComputedStyle(document.querySelector('.hero-feature-zone')).animationName"),'none');
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...position});
 assert.equal(await cdp.evaluate("getComputedStyle(document.querySelector('.home-envelope-art')).transform"),'none');
 await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await cdp.evaluate("document.documentElement.dataset.lightweight='true'");
 assert.equal(await cdp.evaluate("getComputedStyle(document.querySelector('.envelope-home-heading')).animationName"),'none');
 await cdp.evaluate("document.documentElement.dataset.lightweight='false';document.documentElement.dataset.effectsPaused='true'");
 assert.equal(await cdp.evaluate("getComputedStyle(document.querySelector('.hero-feature-zone')).animationName"),'none');
 await cdp.evaluate("document.documentElement.dataset.effectsPaused='false'");
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:20,y:120});
 await new Promise(r=>setTimeout(r,650));
 const shot=await cdp.send('Page.captureScreenshot');fs.writeFileSync(path.join(root,'release','preview-home-motion.png'),Buffer.from(shot.data,'base64'));
 assert.equal(await cdp.evaluate("document.querySelector('#sceneHomePage').scrollWidth<=document.querySelector('#sceneHomePage').clientWidth"),true);
 console.log('PASS: Electron home entrance, hover, live reduced-motion, lightweight, background pause, six initial cards and no horizontal overflow.');
 if(process.argv.includes('--preview')){keep=true;proc.unref();proc.stdout.destroy();proc.stderr.destroy();console.log('Preview remains open: '+appRoot);}
 }finally{socket?.close();if(!keep&&proc.exitCode===null)spawnSync('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
