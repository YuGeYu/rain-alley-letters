// Isolated visual preview: account and community responses are local fixtures.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createTestApp, freePort, waitForTarget, connectCdp, waitFor } = require('./cs2-install-runtime-check.cjs');
const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function run() {
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'alley-visual-preview-'));
 const appRoot=createTestApp(base);
 const preload=path.join(appRoot,'src/preload.cjs');
 let source=fs.readFileSync(preload,'utf8').replaceAll('CS2RUNTIME','PreviewGuest');
 source=source.replace("developerAvailable: () => ipcRenderer.invoke('account:developer-available'),",'developerAvailable: async () => false,');
 source=source.replace('getComments: async () => ({ comments: [] }),',"getComments: async () => ({ comments: [], community: { unlimited:false,nextAllowedAt:Math.floor(Date.now()/1000)+3580,serverNow:Math.floor(Date.now()/1000) } }),");
 fs.writeFileSync(preload,source);
 const userData=path.join(base,'profile');fs.mkdirSync(userData);
 fs.mkdirSync(path.join(userData,'downloads'));
 fs.writeFileSync(path.join(userData,'preferences.json'),JSON.stringify({downloadDirectory:path.join(userData,'downloads')}));
 const port=await freePort();const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const proc=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[appRoot,'--remote-debugging-port='+port,'--remote-allow-origins=*','--user-data-dir='+userData],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='';proc.stdout.on('data',c=>output+=c);proc.stderr.on('data',c=>output+=c);
 let socket;
 try {
  const target=await waitForTarget(port,proc).catch(e=>{throw new Error(e.message+' '+output.slice(-3500));});socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});const cdp=connectCdp(socket);
  await waitFor(cdp,"document.body.dataset.page === 'scene'",'Preview did not load');
  await cdp.evaluate("document.documentElement.dataset.theme='dark'");
  const shot=async name=>{const image=await cdp.send('Page.captureScreenshot');fs.writeFileSync(path.join(root,'release',name),Buffer.from(image.data,'base64'));};
  await shot('preview-home-dark.png');
  await cdp.evaluate("import('./celebration.js').then(m=>m.celebrate('cs2-installed',{},window.alleyDesktop))");
  for(let i=0;i<18;i++){await sleep(200);await shot('preview-fireworks-'+String(i).padStart(2,'0')+'.png');}
  await cdp.evaluate("document.querySelector('#appAddressInput').value='rainalley://app/feature/cs2-bots';document.querySelector('#addressForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  await waitFor(cdp,"document.querySelector('#commentSubmit')?.disabled && document.querySelector('#commentSubmit').textContent.includes('等待')",'Shared lock preview missing');
  await cdp.evaluate("document.querySelector('#commentsPanel').scrollIntoView({block:'center'})");await sleep(300);await shot('preview-community-lock.png');
  console.log('Local preview generated: dark home, fireworks sequence, shared countdown. PreviewGuest is a local fixture.');
 }finally{socket?.close();if(proc.exitCode===null)spawnSync('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});try{fs.rmSync(base,{recursive:true,force:true,maxRetries:4,retryDelay:200});}catch{}}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
