// Isolated UI fixture: never connects management operations to live accounts.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {createTestApp,freePort,waitForTarget,connectCdp,waitFor}=require('./cs2-install-runtime-check.cjs');
const root=path.resolve(__dirname,'..');
async function run(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'alley-management-preview-')), appRoot=createTestApp(base), preload=path.join(appRoot,'src/preload.cjs');
 let source=fs.readFileSync(preload,'utf8');
 const users=[['RainAlleyRoot','雨巷主理人','root'],['RainWalker','雨后散步的人','player'],['AlleyKeeper','巷口守望者','admin'],['EveningLetter','晚风来信','player']].map(([username,displayName,role])=>({username,role,createdAt:1793376000,mutedUntil:0,muteReason:'',disabled:false,lastLoginAt:1793676000,lastSeenAt:1793676300,commentsCount:8,activeSessions:1,nextCommentAt:0,profileUpdatedAt:1793376000,profile:{displayName,bio:'雨停以后，在巷口相遇。',html:'',css:''}}));
 source='let previewUsers='+JSON.stringify(users)+';\n'+source;
 source=source.replace("resumeAccount: async () => ({ username: 'CS2RUNTIME' }),","resumeAccount: async () => ({username:'RainAlleyRoot',role:'root'}),");
 source=source.replace("management: (value) => ipcRenderer.invoke('account:management', value),",`management: async v => { if(v.action==='list'){const rows=previewUsers.filter(u=>!v.q||u.username.toLowerCase().includes(v.q.toLowerCase()));return {users:rows,total:rows.length,nextAfter:null,serverNow:Date.now()/1000,actor:{username:'RainAlleyRoot',role:'root'}};} if(v.action==='audit')return {entries:[]}; const u=previewUsers.find(u=>u.username===v.username); if(v.action==='role')u.role=v.role;if(v.action==='mute'){u.mutedUntil=v.minutes?Math.floor(Date.now()/1000)+v.minutes*60:0;u.muteReason=v.reason||'';}if(v.action==='status')u.disabled=v.disabled;if(v.action==='delete')previewUsers=previewUsers.filter(x=>x!==u);if(v.action==='profile'){u.profile.displayName=v.displayName;u.profile.bio=v.bio;}return {ok:true}; },`);
 source=source.replace("getPublicProfile: (username) => ipcRenderer.invoke('profile:get-public', username),","getPublicProfile: async () => ({profile:{displayName:'雨巷主理人',bio:''}}),");
 fs.writeFileSync(preload,source);const port=await freePort(),env={...process.env,RAIN_ALLEY_TEST_MODE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const proc=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[appRoot,'--remote-debugging-port='+port,'--remote-allow-origins=*','--user-data-dir='+path.join(base,'profile')],{stdio:['ignore','pipe','pipe'],env,windowsHide:true});
 let socket,keep=false,output='';proc.stdout.on('data',c=>output+=c);proc.stderr.on('data',c=>output+=c);
 try{const target=await waitForTarget(port,proc).catch(e=>{throw Error(e.message+output.slice(-1800));});socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{socket.onopen=ok;socket.onerror=no;});const cdp=connectCdp(socket);
 await waitFor(cdp,"document.body.dataset.page==='scene'",'Home missing');
 assert.equal(await cdp.evaluate("document.querySelector('#managementEntry').hidden"),false);
 await cdp.evaluate("document.querySelector('#accountMenuButton').click();document.querySelector('#managementEntry').click()");
 await waitFor(cdp,"document.querySelectorAll('[data-user]').length===4",'Management list missing');
 await cdp.evaluate("document.querySelector('[data-user=RainWalker]').click()");
 assert.equal(await cdp.evaluate("!!document.querySelector('[data-action=role]') && !!document.querySelector('[data-action=delete]')"),true);
 await cdp.evaluate("document.querySelector('[name=duration]').value='2';document.querySelector('[name=unit]').value='1440';document.querySelector('[name=reason]').value='预览：保持友善交流';document.querySelector('[data-action=mute]').click()");
 await waitFor(cdp,"document.querySelector('.management-detail').textContent.includes('禁言至')",'Mute feedback missing');
 const shot=async name=>{const result=await cdp.send('Page.captureScreenshot');fs.writeFileSync(path.join(root,'release',name),Buffer.from(result.data,'base64'));};
 await shot('preview-management-dark.png');
 await cdp.evaluate("document.documentElement.dataset.theme='light'");await new Promise(r=>setTimeout(r,350));await shot('preview-management-light.png');
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:960,height:720,deviceScaleFactor:1,mobile:false});
 assert.equal(await cdp.evaluate("document.querySelector('.management-page').scrollWidth<=document.querySelector('.management-page').clientWidth"),true);
 await cdp.send('Emulation.clearDeviceMetricsOverride');
 await cdp.evaluate("document.documentElement.dataset.theme='dark';document.querySelector('[data-user=RainAlleyRoot]').click()");
 assert.equal(await cdp.evaluate("document.querySelectorAll('[data-action]').length"),0);
 await cdp.evaluate("document.querySelector('[data-user=RainWalker]').click();document.querySelector('[name=confirmUsername]').value='RainWalker';document.querySelector('[data-action=delete]').click()");
 await waitFor(cdp,"!!document.querySelector('.cs2-modal-overlay')",'Delete dialog missing');
 await cdp.evaluate("[...document.querySelectorAll('.cs2-modal-overlay button')].find(b=>b.textContent==='取消').click()");
 assert.equal(await cdp.evaluate("document.querySelectorAll('[data-user]').length"),4);
 await cdp.evaluate("document.querySelector('[data-action=unmute]').click()");
 await waitFor(cdp,"!document.querySelector('.management-detail').textContent.includes('禁言至')",'Unmute failed');
 await cdp.evaluate("document.querySelector('[data-back]').click()");
 assert.equal(await cdp.evaluate("document.body.dataset.page==='scene' && !document.querySelector('.management-page')"),true);
 await cdp.evaluate("document.querySelector('#managementEntry').click()");await waitFor(cdp,"document.querySelectorAll('[data-user]').length===4",'Reopen failed');
 await cdp.evaluate("document.querySelector('[data-user=RainWalker]').click()");
 console.log('PASS: root entry, user list/details, custom mute/unmute, protected root, deletion confirmation/cancel, theme screenshots, 960px overflow, exit/reopen. Fixtures only.');
 if(process.argv.includes('--preview')){keep=true;proc.unref();proc.stdout.destroy();proc.stderr.destroy();console.log('Preview remains open: '+appRoot);}
 }finally{socket?.close();if(!keep&&proc.exitCode===null)spawnSync('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
