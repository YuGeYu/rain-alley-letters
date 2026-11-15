// Real standalone client preview; public read-only API requests, isolated account data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {freePort,waitForTarget,connectCdp,waitFor}=require('./cs2-install-runtime-check.cjs');
const root=path.resolve(__dirname,'..');
async function run(){
 const qa=path.join(root,'.work/xcmusic-native-qa');fs.mkdirSync(qa,{recursive:true});
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'xcm-native-')),port=await freePort();
 const exe=process.argv[2]||path.join(root,'vendor/XCMusic/dist_electron/win-unpacked/XCMusic.exe');
 const env={...process.env,RAIN_ALLEY_XCMUSIC_PROFILE:path.join(base,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 const out=fs.openSync(path.join(qa,'native.log'),'w');
 const proc=spawn(exe,['--remote-debugging-port='+port,'--remote-allow-origins=*'],{cwd:path.dirname(exe),env,stdio:['ignore',out,out],detached:true,windowsHide:true});
 proc.unref();
 const target=await waitForTarget(port,proc),socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((res,rej)=>{socket.onopen=res;socket.onerror=rej});
 const cdp=connectCdp(socket),errors=[];
 socket.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)});
 await cdp.send('Runtime.enable');
 await waitFor(cdp,"document.querySelector('#app')?.innerText.length>30",'Native UI failed',45000);
 const state=await cdp.evaluate("({title:document.title,text:document.body.innerText.slice(0,1800),api:window.musicApiAddress,storage:typeof window.desktopStorage,preload:window.electron?.isElectron})");
 console.log(JSON.stringify(state));
 const shot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(qa,'client.png'),Buffer.from(shot.data,'base64'));
 fs.writeFileSync(path.join(qa,'session.json'),JSON.stringify({exe,base,profile:env.RAIN_ALLEY_XCMUSIC_PROFILE,port,pid:proc.pid,errors},null,2));
 console.log('NATIVE_PREVIEW='+JSON.stringify({pid:proc.pid,port,profile:env.RAIN_ALLEY_XCMUSIC_PROFILE,errors}));socket.close();
}
run().catch(e=>{console.error(e);process.exitCode=1});
