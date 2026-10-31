const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { createTestApp, freePort, waitForTarget, connectCdp, waitFor } = require('./cs2-install-runtime-check.cjs');
const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
 const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-alley-spectrum-test-'));
 const appRoot = createTestApp(base); const userData = path.join(base, 'user-data'); fs.mkdirSync(userData);
 fs.mkdirSync(path.join(userData, 'downloads'));
 fs.writeFileSync(path.join(userData, 'preferences.json'), JSON.stringify({ downloadDirectory: path.join(userData, 'downloads') }));
 const archive = path.join(base, 'official-selection.zip'); fs.writeFileSync(archive, 'selection-only-fixture');
 // Only the chooser is substituted in the copied test app; production IPC and
 // preferences implement the actual persistence behavior under test.
 const mainFile = path.join(appRoot, 'src/main.cjs');
 let main = fs.readFileSync(mainFile, 'utf8');
 const chooser = "const result = await dialog.showOpenDialog(windowRef, { title: '选择 CS2 Bot Improver 官方 ZIP', properties: ['openFile'], filters: [{ name: 'ZIP', extensions: ['zip'] }] });";
 assert.ok(main.includes(chooser));
 main = main.replace(chooser, 'const result = { canceled: false, filePaths: [' + JSON.stringify(archive) + '] };');
 fs.writeFileSync(mainFile, main);
 let app, socket, cdp;
 async function start() {
   const port = await freePort();
   app = spawn(path.join(root,'node_modules/electron/dist/electron.exe'), [appRoot, '--remote-debugging-port=' + port, '--remote-allow-origins=*', '--user-data-dir=' + userData], { stdio:['ignore','pipe','pipe'], windowsHide:true });
   let output = ''; app.stdout.on('data', c => output += c); app.stderr.on('data', c => output += c);
   const target = await waitForTarget(port, app).catch(error => { throw new Error(error.message + '\n' + output.slice(-5000)); }); socket = new WebSocket(target.webSocketDebuggerUrl);
   await new Promise((resolve,reject) => { socket.onopen=resolve; socket.onerror=reject; }); cdp = connectCdp(socket);
   await waitFor(cdp, "document.body.dataset.page === 'scene'", 'Home did not load');
 }
 async function detail() { await cdp.evaluate("document.querySelector('#appAddressInput').value='rainalley://app/feature/cs2-bots'; document.querySelector('#addressForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))"); await waitFor(cdp, "Boolean(document.querySelector('#cs2Archive'))", 'Detail did not load'); }
 async function stop() { const exited = new Promise(resolve=>app.once('exit',resolve)); void cdp.evaluate('window.alleyDesktop.quit()').catch(() => {}); await exited; socket.close(); }
 const selection = "document.querySelector('#cs2Archive').value === " + JSON.stringify(archive);
 try {
   await start(); await detail();
   await cdp.evaluate("document.querySelector('#chooseCs2Archive').click()");
   await waitFor(cdp, selection, 'ZIP selection missing');
   assert.equal(JSON.parse(fs.readFileSync(path.join(userData,'preferences.json'))).cs2Archive, archive);
   await cdp.send('Page.reload'); await waitFor(cdp, "document.body.dataset.page === 'scene'", 'Reload did not finish'); await detail();
   await waitFor(cdp, selection, 'ZIP did not survive reload');
   for (const theme of ['dark','light']) {
     await cdp.evaluate('document.documentElement.dataset.theme=' + JSON.stringify(theme));
     const style = await cdp.evaluate("(()=>{let b=getComputedStyle(document.querySelector('#installCs2Package'));let h=getComputedStyle(document.querySelector('#detailTitle'));return {background:b.backgroundImage,animation:b.animationName,color:b.color,title:h.backgroundImage,overflow:document.documentElement.scrollWidth>innerWidth}})()");
     assert.match(style.background,/linear-gradient/); assert.equal(style.animation,'alley-spectrum'); assert.match(style.title,/linear-gradient/); assert.equal(style.overflow,false);
     const box = await cdp.evaluate("(()=>{const b=document.querySelector('#installCs2Package').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()");
     await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...box});
     const hover = await cdp.evaluate("(()=>{const b=getComputedStyle(document.querySelector('#installCs2Package'));return {background:b.backgroundImage,color:b.color}})()");
     assert.match(hover.background,/linear-gradient/); assert.equal(hover.color,'rgb(16, 23, 37)');
     const shot = await cdp.send('Page.captureScreenshot'); fs.writeFileSync(path.join(root,'release','spectrum-' + theme + '.png'),Buffer.from(shot.data,'base64'));
   }
   await cdp.send('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] });
   assert.equal(await cdp.evaluate("getComputedStyle(document.querySelector('#installCs2Package')).animationName"),'none');
   assert.equal(await cdp.evaluate("import('./celebration.js').then(m=>m.celebrate('cs2-installed',{},window.alleyDesktop))"),false);
   await cdp.send('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'no-preference'}] });
   assert.equal(await cdp.evaluate("import('./celebration.js').then(m=>m.celebrate('ordinary-click',{},window.alleyDesktop))"),false);
   assert.equal(await cdp.evaluate("import('./celebration.js').then(m=>m.celebrate('cs2-installed',{lightweight:true},window.alleyDesktop))"),false);
   assert.equal(await cdp.evaluate("import('./celebration.js').then(m=>m.celebrate('cs2-installed',{},window.alleyDesktop))"),true);
   assert.equal(await cdp.evaluate("document.querySelectorAll('.celebration-spark').length"),640);
   assert.equal(await cdp.evaluate("getComputedStyle(document.querySelector('.alley-celebration')).pointerEvents"),'none');
   await sleep(650); const shot=await cdp.send('Page.captureScreenshot'); fs.writeFileSync(path.join(root,'release','celebration.png'),Buffer.from(shot.data,'base64'));
   assert.equal(await cdp.evaluate("import('./celebration.js').then(m=>m.celebrate('account-created',{},window.alleyDesktop))"),false);
   await waitFor(cdp, "!document.querySelector('.alley-celebration')", 'Celebration failed to clean itself up', 10000);
   await stop(); await start(); await detail();
   await waitFor(cdp, selection, 'ZIP did not survive restart');
   assert.equal(await cdp.evaluate("import('./celebration.js').then(m=>m.celebrate('account-created',{},window.alleyDesktop))"),false);
   fs.unlinkSync(archive); const status=await cdp.evaluate('window.alleyDesktop.getCs2Archive()'); assert.equal(status.available,false); assert.equal(status.path,archive);
   await stop(); console.log('Spectrum runtime ok: ZIP selection/reload/restart/missing file; both themes; reduced motion; milestone gating; persistent cooldown; 640 sparks; cleanup.');
 } finally { if(app?.exitCode===null) spawnSync('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{stdio:'ignore',windowsHide:true}); try{socket?.close();}catch{} try { fs.rmSync(base,{recursive:true,force:true,maxRetries:5,retryDelay:200}); } catch(error) { console.warn('Test temporary directory remains:', base, error.message); } }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
