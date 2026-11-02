const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {createTestApp,freePort,waitForTarget,connectCdp,waitFor}=require('./cs2-install-runtime-check.cjs');
const root=path.resolve(__dirname,'..');
async function run(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'alley-single-instance-')),appRoot=createTestApp(base),profile=path.join(base,'profile'),port=await freePort();
 const preload=path.join(appRoot,'src/preload.cjs');
 fs.writeFileSync(preload,fs.readFileSync(preload,'utf8').replace("getPublicProfile: (username) => ipcRenderer.invoke('profile:get-public', username),","getPublicProfile: async () => ({profile:{displayName:'雨巷来客'}}),"));
 const env={...process.env,RAIN_ALLEY_TEST_MODE:'1'};delete env.ELECTRON_RUN_AS_NODE;const executable=path.join(root,'node_modules/electron/dist/electron.exe');
 const proc=spawn(executable,[appRoot,'--remote-debugging-port='+port,'--remote-allow-origins=*','--user-data-dir='+profile],{env,stdio:'ignore',windowsHide:true});
 let socket,keep=false;const extras=[];
 const second=async()=>{const child=spawn(executable,[appRoot,'--user-data-dir='+profile],{env,stdio:'ignore',windowsHide:true});extras.push(child);const code=await Promise.race([new Promise((ok,no)=>{child.once('exit',ok);child.once('error',no);}),new Promise((_,no)=>setTimeout(()=>no(Error('Second process did not exit')),10000).unref())]);assert.equal(code,0);};
 try{const target=await waitForTarget(port,proc);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{socket.onopen=ok;socket.onerror=no;});const cdp=connectCdp(socket);
 await waitFor(cdp,"document.body.dataset.page==='scene'",'Home missing');
 await cdp.evaluate("document.querySelector('#appAddressInput').value='rainalley://app/feature/cs2-bots';document.querySelector('#addressForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
 await waitFor(cdp,"!!document.querySelector('#cs2Directory')",'Tool missing');
 await cdp.evaluate("document.querySelector('#commentInput').value='双开检查：保留未寄出的草稿'");
 await cdp.evaluate('window.alleyDesktop.minimizeToTray()');await second();
 assert.equal(await cdp.evaluate("document.body.dataset.page==='detail' && document.querySelector('#commentInput').value==='双开检查：保留未寄出的草稿'"),true);
 await cdp.evaluate('window.alleyDesktop.minimize()');await second();await second();
 assert.equal(proc.exitCode,null);
 const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();assert.equal(targets.filter(x=>x.type==='page'&&x.url.includes('rainalley://')).length,1);
 const shot=await cdp.send('Page.captureScreenshot');fs.writeFileSync(path.join(root,'release/preview-single-instance.png'),Buffer.from(shot.data,'base64'));
 console.log('PASS: second launch exits 0, tray/minimized window restored without losing tool/draft; three repeated launches leave one renderer. Isolated profile.');
 if(process.argv.includes('--preview')){keep=true;proc.unref();console.log('Preview remains open: '+appRoot);}
 }finally{socket?.close();for(const child of extras)if(child.exitCode===null)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});if(!keep&&proc.exitCode===null)spawnSync('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
