const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { freePort, waitForTarget, connectCdp } = require('./cs2-install-runtime-check.cjs');
(async () => {
 const realProfile = process.argv.includes('--real-profile');
 const base = realProfile ? path.join(process.env.APPDATA, '雨巷来信') : fs.mkdtempSync(path.join(os.tmpdir(), 'alley-taskbar-'));
 if (!realProfile) { fs.mkdirSync(path.join(base, 'downloads')); fs.writeFileSync(path.join(base, 'preferences.json'), JSON.stringify({ downloadDirectory: path.join(base, 'downloads') })); }
 const port = await freePort();
 const executable = path.join(process.env.LOCALAPPDATA,'Programs','雨巷来信','雨巷来信.exe');
 const app = spawn(executable, ['--user-data-dir=' + base, '--remote-debugging-port=' + port, '--remote-allow-origins=*'], {stdio:['ignore','pipe','pipe'],windowsHide:true});
 app.stderr.on('data', data => process.stderr.write(data));
 const page = await waitForTarget(port, app); const socket = new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((resolve,reject) => {socket.onopen=resolve;socket.onerror=reject;});
 const cdp = connectCdp(socket);
 await cdp.evaluate('window.alleyDesktop.restore()');
 const state = await cdp.evaluate('window.alleyDesktop.getState()');
 console.log(JSON.stringify({port,pid:app.pid,userData:base,cs2Archive:state.preferences.cs2Archive,installed:state.installedFeatures}));
 setInterval(()=>{},10000);
})().catch(error=>{console.error(error);process.exitCode=1;});
