// Exercises real Electron IPC and file writes using an isolated API fixture.
// No requests or registrations reach production; exported secrets stay in temp.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {createTestApp,freePort,waitForTarget,connectCdp,waitFor}=require('./cs2-install-runtime-check.cjs');
const root=path.resolve(__dirname,'..');
async function run(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'alley-auth-preview-')),appRoot=createTestApp(base),preload=path.join(appRoot,'src/preload.cjs'),main=path.join(appRoot,'src/main.cjs'),exportsFolder=path.join(base,'exports');
 fs.mkdirSync(exportsFolder);
 let source=fs.readFileSync(preload,'utf8');
 source=source.replace("resumeAccount: async () => ({ username: 'CS2RUNTIME' }),","resumeAccount: () => ipcRenderer.invoke('account:resume'),");
 source=source.replace("developerAvailable: () => ipcRenderer.invoke('account:developer-available'),","developerAvailable: async () => false,");
 fs.writeFileSync(preload,source);
 let mainSource=fs.readFileSync(main,'utf8');
 mainSource=mainSource.replace("async function requestApi(route, { method = 'GET', body, token } = {}) {",`const fixtureAccounts = new Map();
app.setPath('pictures', ${JSON.stringify(exportsFolder)});
async function requestApi(route, { method = 'GET', body, token } = {}) {
 if(route==='/api/register'){if(fixtureAccounts.has(body.username))throw Error('这个账号已被使用，请换一个账号名。');fixtureAccounts.set(body.username,body.password);return {account:{username:body.username,role:'player'},session:{token:'a'.repeat(64),expiresAt:Math.floor(Date.now()/1000)+10000}};}
 if(route==='/api/login'){if(fixtureAccounts.get(body.username)!==body.password)throw Error('账号或密码不正确，请检查后重试。');return {account:{username:body.username,role:'player'},session:{token:'a'.repeat(64),expiresAt:Math.floor(Date.now()/1000)+10000}};}
 if(route==='/api/logout')return {ok:true};
 if(route==='/api/session')return {account:{username:authSession?.username||'LocalReader',role:'player'}};
 if(route.startsWith('/api/profiles/'))return {profile:{displayName:'雨巷来客'}};
 throw Error('Isolated fixture rejected network request');
`);
 assert.ok(mainSource.includes('const fixtureAccounts'));fs.writeFileSync(main,mainSource);
 const env={...process.env,RAIN_ALLEY_TEST_MODE:'1'};delete env.ELECTRON_RUN_AS_NODE;const port=await freePort();
 const proc=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[appRoot,'--remote-debugging-port='+port,'--remote-allow-origins=*','--user-data-dir='+path.join(base,'profile')],{stdio:['ignore','pipe','pipe'],env,windowsHide:true});
 let socket,keep=false,output='';proc.stdout.on('data',c=>output+=c);proc.stderr.on('data',c=>output+=c);
 try{
 const target=await waitForTarget(port,proc).catch(e=>{throw Error(e.message+output.slice(-1200));});socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{socket.onopen=ok;socket.onerror=no;});const cdp=connectCdp(socket);
 await waitFor(cdp,"!document.querySelector('#authScreen').hidden && !document.querySelector('#loginForm').hidden",'Login must be default');
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1100,height:900,deviceScaleFactor:1,mobile:false});
 const shot=async name=>{const img=await cdp.send('Page.captureScreenshot');fs.writeFileSync(path.join(root,'release',name),Buffer.from(img.data,'base64'));};
 await shot('preview-auth-login.png');
 const submit=id=>cdp.evaluate(`document.querySelector('#${id}').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);
 await cdp.evaluate("document.querySelector('[data-auth-view=register]').click()");
 await shot('preview-auth-register.png');
 await cdp.evaluate("document.querySelector('#registerUsername').value='LocalReader';document.querySelector('#registerPassword').value='PreviewPassword123';document.querySelector('#registerPasswordConfirm').value='DifferentPassword123'");await submit('registerForm');
 assert.equal(await cdp.evaluate("document.querySelector('#registerPasswordConfirm').getAttribute('aria-invalid')"),'true');
 await cdp.evaluate("document.querySelector('[data-password-toggle=registerPassword]').click()");assert.equal(await cdp.evaluate("document.querySelector('#registerPassword').type"),'text');
 await cdp.evaluate("document.querySelector('#registerPasswordConfirm').value='PreviewPassword123'");await submit('registerForm');
 await waitFor(cdp,"document.querySelector('#authScreen').hidden",'Custom registration failed');
 assert.equal(await cdp.evaluate("document.querySelector('#registerPassword').value"),'');
 assert.equal(await cdp.evaluate("document.querySelector('#credentialsOverlay').hidden"),true);
 assert.equal(await cdp.evaluate("window.alleyDesktop.saveCredentialText().then(()=>false,()=>true)"),true);
 const logout=async()=>{await cdp.evaluate("document.querySelector('#accountMenuButton').click();document.querySelector('#logoutButton').click()");await waitFor(cdp,"!document.querySelector('#authScreen').hidden",'Logout failed');};
 await logout();
 await cdp.evaluate("document.querySelector('[data-auth-view=register]').click();document.querySelector('#registerUsername').value='LocalReader';document.querySelector('#registerPassword').value='PreviewPassword123';document.querySelector('#registerPasswordConfirm').value='PreviewPassword123'");await submit('registerForm');
 await waitFor(cdp,"document.querySelector('#authFeedback').textContent.includes('已被使用')",'Duplicate account feedback missing');
 await cdp.evaluate("document.querySelector('[data-auth-view=login]').click();document.querySelector('#loginUsername').value='LocalReader';document.querySelector('#loginPassword').value='wrong'");await submit('loginForm');
 await waitFor(cdp,"document.querySelector('#authFeedback').textContent.includes('不正确')",'Wrong password feedback missing');
 await cdp.evaluate("document.querySelector('#loginPassword').value='PreviewPassword123'");await submit('loginForm');await waitFor(cdp,"document.querySelector('#authScreen').hidden",'Login failed');
 await logout();await cdp.evaluate("document.querySelector('#quickRegisterButton').click()");
 await waitFor(cdp,"!document.querySelector('#credentialsOverlay').hidden && !document.querySelector('#credentialDoneButton').disabled",'Quick registration/image failed');
 const pngs=fs.readdirSync(path.join(exportsFolder,'雨巷来信')).filter(n=>n.endsWith('.png'));assert.equal(pngs.length,1);
 await cdp.evaluate("document.querySelector('#credentialTextButton').click()");
 await waitFor(cdp,"document.querySelector('#credentialTextStatus').textContent.includes('TXT 已保存')",'Text export failed');
 const files=fs.readdirSync(path.join(exportsFolder,'雨巷来信')),txt=files.find(n=>n.endsWith('.txt'));assert.ok(txt);
 const text=fs.readFileSync(path.join(exportsFolder,'雨巷来信',txt),'utf8');assert.ok(text.startsWith('\uFEFF'));
 const match=/账号：(YX[A-Za-z0-9]{8})\r\n密码：([^\r\n]+)/.exec(text);assert.ok(match);
 assert.ok(pngs[0].startsWith(match[1]));
 const valid=await cdp.evaluate('window.alleyDesktop.login('+JSON.stringify({username:match[1],password:match[2]})+').then(()=>true)');assert.equal(valid,true);
 await cdp.evaluate("document.querySelector('#credentialDoneButton').click()");
 assert.equal(await cdp.evaluate("window.alleyDesktop.saveCredentialText().then(()=>false,()=>true)"),true);
 await logout();await cdp.evaluate("document.querySelector('[data-auth-view=register]').click();document.documentElement.dataset.theme='light'");await new Promise(r=>setTimeout(r,250));await shot('preview-auth-register-light.png');
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:960,height:680,deviceScaleFactor:1,mobile:false});
 assert.equal(await cdp.evaluate("document.querySelector('#authScreen').scrollWidth<=document.querySelector('#authScreen').clientWidth"),true);
 await cdp.evaluate("document.querySelector('#registerSubmit').scrollIntoView({block:'center'})");
 assert.equal(await cdp.evaluate("document.querySelector('#registerSubmit').getBoundingClientRect().bottom<=innerHeight"),true);
 await cdp.send('Emulation.clearDeviceMetricsOverride');await cdp.evaluate("document.querySelector('[data-auth-view=login]').click();document.documentElement.dataset.theme='dark'");
 console.log('PASS: default login, custom registration, validation, duplicate and wrong-password errors, show/hide, quick registration, actual PNG/TXT writes and TXT login, secret cleanup, light theme and 960x680 scrolling. Isolated API only.');
 if(process.argv.includes('--preview')){keep=true;proc.unref();proc.stdout.destroy();proc.stderr.destroy();console.log('Preview remains open: '+appRoot);}
 }finally{socket?.close();if(!keep&&proc.exitCode===null)spawnSync('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
