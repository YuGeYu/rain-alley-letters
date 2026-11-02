// Isolated Electron preview; no online community writes.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {createTestApp,freePort,waitForTarget,connectCdp,waitFor}=require('./cs2-install-runtime-check.cjs');
const root=path.resolve(__dirname,'..');
async function run(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'alley-tabs-community-'));const appRoot=createTestApp(base);const preload=path.join(appRoot,'src/preload.cjs');
 let source=fs.readFileSync(preload,'utf8');
 source="let previewComments=[{id:1,username:'雨巷来客',body:'人机增强很好用，期待更多工具。',createdAt:1793548800,canDelete:true},{id:2,username:'CS2RUNTIME',body:'谢谢建议，欢迎分享使用感受。',createdAt:1793548900,rootId:1,replyToId:1,canDelete:true},{id:3,username:'雨巷来客',body:'回复也可以直接留在留言下面。',createdAt:1793549000,rootId:1,replyToId:2,canDelete:true}];\n"+source;
 source=source.replace('getComments: async () => ({ comments: [] }),', 'getComments: async () => ({comments:previewComments,community:{unlimited:true,nextAllowedAt:0,serverNow:Date.now()/1000}}),');
 source=source.split('\n').map(line=>line.includes('addComment: async') ? "  addComment: async (_featureId,body,replyToId)=>{const target=previewComments.find(c=>c.id===replyToId);const comment={id:previewComments.length+1,username:'CS2RUNTIME',body,createdAt:Date.now()/1000,replyToId,rootId:target?target.rootId||target.id:null,canDelete:true};previewComments.push(comment);return {comment};}," : line).join('\n');
 source=source.replace("deleteComment: (featureId, id) => ipcRenderer.invoke('module:delete-comment', { featureId, id }),","deleteComment: async (_featureId,id)=>{const c=previewComments.find(c=>c.id===id);c.deleted=true;c.body='';c.canDelete=false;return {ok:true};},");
 fs.writeFileSync(preload,source);const port=await freePort();const env={...process.env,RAIN_ALLEY_TEST_MODE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const proc=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[appRoot,'--remote-debugging-port='+port,'--remote-allow-origins=*','--user-data-dir='+path.join(base,'profile')],{stdio:['ignore','pipe','pipe'],env,windowsHide:true});
 let output='';proc.stdout.on('data',c=>output+=c);proc.stderr.on('data',c=>output+=c);let socket,keep=false;
 try{const target=await waitForTarget(port,proc).catch(e=>{throw new Error(e.message+' '+output.slice(-4000));});socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{socket.onopen=ok;socket.onerror=no;});const cdp=connectCdp(socket);
 await waitFor(cdp,"document.body.dataset.page==='scene'",'Home failed: '+output);
 const open=async(id,title)=>{await cdp.evaluate("document.querySelector('#appAddressInput').value='rainalley://app/feature/"+id+"';document.querySelector('#addressForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");await waitFor(cdp,"document.querySelector('#detailTitle').textContent==="+JSON.stringify(title),'Tool missing: '+title);};
 await open('cs2-bots','CS2 人机增强');await waitFor(cdp,"document.querySelectorAll('.comment-reply').length===2",'Flat replies missing');
 assert.equal(await cdp.evaluate("document.querySelector('[data-browser-tab=home]').getAttribute('aria-selected')"),'false');
 await cdp.evaluate("document.querySelector('#commentInput').value='未寄出的草稿'");await open('cs2-demo','Demo 重玩插件');await open('cs2-bots','CS2 人机增强');
 assert.equal(await cdp.evaluate("document.querySelector('#commentInput').value"),'未寄出的草稿');assert.equal(await cdp.evaluate("document.querySelectorAll('#websiteTabs .browser-tab').length"),2);
 await cdp.evaluate("document.querySelector('[data-reply-comment=\"3\"]').click();document.querySelector('#commentInput').value='回复评论仍合入原留言';document.querySelector('#commentForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
 await waitFor(cdp,"document.querySelectorAll('.comment-reply').length===3",'Reply submit failed');assert.equal(await cdp.evaluate("document.querySelectorAll('.comment-replies .comment-replies').length"),0);
 assert.ok(await cdp.evaluate("document.querySelector('[data-comment-id=\"4\"] blockquote').textContent.includes('回复也可以')"));
 await cdp.evaluate("document.querySelector('[data-delete-comment=\"2\"]').click()");await waitFor(cdp,"!!document.querySelector('.cs2-modal-overlay')",'Delete dialog missing');
 await cdp.evaluate("[...document.querySelectorAll('.cs2-modal-overlay button')].find(b=>b.textContent.includes('确认删除')).click()");await waitFor(cdp,"document.querySelector('[data-comment-id=\"2\"] p').textContent.includes('已删除')",'Delete failed');
 assert.equal(await cdp.evaluate("document.querySelector('[data-comment-id=\"3\"] blockquote').textContent"),'引用的内容已删除');
 await cdp.evaluate("document.querySelector('#commentsPanel').scrollIntoView({block:'center'})");await new Promise(ok=>setTimeout(ok,300));const shot=await cdp.send('Page.captureScreenshot');fs.writeFileSync(path.join(root,'release/preview-tool-tabs-comments.png'),Buffer.from(shot.data,'base64'));
 await open('cs2-demo','Demo 重玩插件');
 await cdp.evaluate("document.querySelector('#websiteTabs .browser-tab.is-active [data-close-browser-tab]').click()");
 await waitFor(cdp,"document.querySelector('#detailTitle').textContent==='CS2 人机增强' && document.querySelectorAll('#websiteTabs .browser-tab').length===1",'Closing a tool did not select its neighbor');
 console.log('PASS: independent tool tabs, close/fallback, retained drafts, flat quoted replies, reply submission, deletion/tombstones. Screenshot: release/preview-tool-tabs-comments.png');
 if(process.argv.includes('--preview')){keep=true;proc.unref();proc.stdout.destroy();proc.stderr.destroy();console.log('Local fixture preview remains open: '+appRoot);}
 }finally{socket?.close();if(!keep&&proc.exitCode===null)spawnSync('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});

