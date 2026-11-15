// Local-only integration QA. No NetEase Music login and no account writes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const {createTestApp,freePort,waitForTarget,connectCdp,waitFor}=require('./cs2-install-runtime-check.cjs');
const root=path.resolve(__dirname,'..');
async function run(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'alley-xcmusic-'));
 const appRoot=createTestApp(base, { seedResources: true }), port=await freePort();
 const env={...process.env,RAIN_ALLEY_TEST_MODE:'1'}; delete env.ELECTRON_RUN_AS_NODE;
 const preview=process.argv.includes('--preview'),uiOnly=process.argv.includes('--ui-only');
 const proc=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[appRoot,'--remote-debugging-port='+port,'--remote-allow-origins=*','--user-data-dir='+path.join(base,'profile')],{env,detached:preview,stdio:'ignore',windowsHide:true});
 let socket,keep=false;
 try{
  const target=await waitForTarget(port,proc);socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  const cdp=connectCdp(socket),errors=[];
  socket.addEventListener('message',({data})=>{const msg=JSON.parse(data);if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails);});
  await cdp.send('Runtime.enable');
  await waitFor(cdp,"document.body.dataset.page==='scene'",'Home missing');
  await cdp.evaluate("document.querySelector('#appAddressInput').value='rainalley://app/feature/xcmusic';document.querySelector('#addressForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  await waitFor(cdp,"document.querySelector('[data-xcm-status]') && document.querySelector('.xcm-workbench')?.getAttribute('aria-busy')==='false'",'XCMusic page missing');
  assert.match(await cdp.evaluate("document.querySelector('#detailTitle').textContent"),/XCMusic/);
  assert.equal(await cdp.evaluate("document.querySelector('.xcm-wordmark img').complete && document.querySelector('.xcm-wordmark img').naturalWidth>0"),true,'Client icon failed to load');
  // Compact desktop layouts remain vertically scrollable without clipping controls.
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:800,height:700,deviceScaleFactor:1,mobile:false});
  assert.equal(await cdp.evaluate("document.querySelector('.xcm-workbench').scrollWidth <= document.querySelector('.xcm-workbench').clientWidth+1"),true,'Workbench overflows');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  if(!uiOnly){
   assert.equal(await cdp.evaluate('window.alleyDesktop.xcMusicStatus().then(x=>x.available)'),true);
   await cdp.evaluate("document.querySelector('[data-xcm=install]').click()");
   await waitFor(cdp,"document.querySelector('[data-xcm-status]').textContent.includes('安装完成')",'Real install failed',120000);
   const status=await cdp.evaluate('window.alleyDesktop.xcMusicStatus()');assert.equal(status.installed,true);
   fs.writeFileSync(path.join(status.directory,'user-note.txt'),'preserve-me');
   fs.appendFileSync(path.join(status.directory,'resources/app.asar'),'tamper');
   assert.equal(await cdp.evaluate('window.alleyDesktop.xcMusicStatus().then(x=>x.damaged)'),true);
   // Repair through the UI; the whole modified directory must survive in backup.
   await cdp.evaluate("document.querySelector('[data-xcm=repair]').click()");
   await waitFor(cdp,"document.querySelector('[data-xcm-status]').textContent.includes('旧程序已完整保存')",'Repair failed',120000);
   const backups=fs.readdirSync(path.dirname(status.directory)).filter(x=>x.startsWith('backup-'));
   assert.ok(backups.some(x=>fs.existsSync(path.join(path.dirname(status.directory),x,'user-note.txt'))));
   // The retained tool surface receives asynchronous state changes after a tab switch.
   const id=await cdp.evaluate("document.querySelector('#websiteTabs [aria-selected=true]').dataset.browserTab");
   await cdp.evaluate("document.querySelector('#settingsButton').click()");
   await cdp.evaluate(`document.querySelector('[data-browser-tab="${id}"]').click()`);
   assert.equal(await cdp.evaluate("document.querySelectorAll('.xcm-workbench').length"),1);
   await cdp.evaluate("document.querySelector('[data-xcm=launch]').click()");
   await waitFor(cdp,"document.querySelector('[data-xcm-status]').textContent.includes('已发送启动请求')",'Native launch failed',30000);
   console.log('NATIVE_EXECUTABLE='+path.join(status.directory,'XCMusic.exe'));
   console.log('NATIVE_PROFILE='+status.profile);
  }
  await new Promise(r=>setTimeout(r,1900));
  const shot=await cdp.send('Page.captureScreenshot',{format:'png'});
  fs.mkdirSync(path.join(root,'.work/xcmusic-qa'),{recursive:true});
  fs.writeFileSync(path.join(root,'.work/xcmusic-qa/rain-alley.png'),Buffer.from(shot.data,'base64'));
  assert.deepEqual(errors,[],'Renderer errors');
  console.log(uiOnly ? 'PASS: catalog/tool tab UI and no renderer errors (binary tests not run).' : 'PASS: catalog/tool tab, real payload install, tamper detection, repair backup, native launch request, retained tab and no renderer errors.');
  if(preview){keep=true;proc.unref();console.log('PREVIEW='+appRoot+'; PID='+proc.pid+'; CDP='+port);}
 }finally{socket?.close();if(!keep&&proc.exitCode===null)spawnSync('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
