const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createTestApp, freePort, waitForTarget, connectCdp, waitFor } = require('./cs2-install-runtime-check.cjs');
const root = path.resolve(__dirname, '..');
const preview = process.argv.includes('--preview');
async function run() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'alley-inventory-ui-'));
  const appRoot = createTestApp(base);
  const game = path.join(base, 'game/csgo'); fs.mkdirSync(game, { recursive: true });
  fs.writeFileSync(path.join(game, 'gameinfo.gi'), 'GameInfo { FileSystem { SearchPaths {\n Game csgo\n} } }');
  const profile = path.join(base, 'profile'); fs.mkdirSync(profile); fs.mkdirSync(path.join(profile, 'downloads'));
  fs.writeFileSync(path.join(profile, 'preferences.json'), JSON.stringify({ cs2Directory: game, cs2Archive: 'E:/dow/CS2BotImprover.zip', downloadDirectory: path.join(profile, 'downloads'), allowHttp: true, allowLocalNetwork: true, allowedHosts: ['127.0.0.1'] }));
  // Restore the real native web view; only account/community responses are fixtures.
  const preloadPath = path.join(appRoot, 'src/preload.cjs');
  let preload = fs.readFileSync(preloadPath, 'utf8');
  preload = preload.replace("openWebsite: async (url, _approved, tabId) => ({ id: tabId || 'test-tab', url, title: '测试分享页', loading: false }),", "openWebsite: (url, approvedByUser = false, tabId) => ipcRenderer.invoke('site:open', url, approvedByUser === true, tabId),");
  preload = preload.replace('chooseCs2Directory:', "testCopy: () => ipcRenderer.invoke('test:copy'), testBounds: () => ipcRenderer.invoke('test:bounds'), testLink: url => ipcRenderer.invoke('test:link', url), testExternal: () => ipcRenderer.invoke('test:external'), chooseCs2Directory:");
  fs.writeFileSync(preloadPath, preload);
  const mainPath = path.join(appRoot, 'src/main.cjs');
  fs.appendFileSync(mainPath, '\nconst testExternal=[];shell.openExternal=async url=>{testExternal.push(url);};ipcMain.handle("test:external",()=>testExternal);ipcMain.handle("test:bounds",()=>[...websiteViews.values()].map(v=>v.getBounds()));ipcMain.handle("test:link",async(_e,url)=>websiteViews.get(activeWebsiteId).webContents.executeJavaScript("window.open("+JSON.stringify(url)+")",true));\n');
  fs.appendFileSync(mainPath, "\nconst originalClipboard = clipboard.readText();\napp.on('will-quit', () => clipboard.writeText(originalClipboard));\nipcMain.handle('test:copy', async () => {\n const c = websiteViews.get(activeWebsiteId).webContents;\n c.focus();\n await c.executeJavaScript(\"navigator.clipboard.writeText('/猪圈签到')\", true);\n const text = await clipboard.readText();\n const denied = await c.executeJavaScript(\"navigator.clipboard.readText().then(()=>false,()=>true)\", true);\n await clipboard.writeText(await originalClipboard);\n return { text, denied };\n});\n");
  let launchRoot = appRoot;
  if (process.argv.includes('--asar')) { launchRoot = path.join(base, 'app.asar'); await require('@electron/asar').createPackage(appRoot, launchRoot); }
  const http = require('node:http');
  const server = http.createServer((_req, res) => res.end('<!doctype html><meta charset="utf-8"><body style="height:3000px;background:#183044;color:white"><h1>本机跳转与滚动验证</h1></body>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const port = await freePort(); const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const proc = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [launchRoot, '--remote-debugging-port=' + port, '--remote-allow-origins=*', '--user-data-dir=' + profile], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env });
  let output = ''; proc.stdout.on('data', c => output += c); proc.stderr.on('data', c => output += c);
  let socket, keep = false;
  try {
    const target = await waitForTarget(port, proc); socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const cdp = connectCdp(socket);
    await waitFor(cdp, "document.body.dataset.page === 'scene'", 'No home');
    const route = async value => cdp.evaluate("document.querySelector('#appAddressInput').value=" + JSON.stringify(value) + ";document.querySelector('#addressForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
    const click = async label => cdp.evaluate("[...document.querySelectorAll('.cs2-modal-actions button')].find(b=>b.textContent===" + JSON.stringify(label) + ').click()');
    const shot = async name => { await new Promise(resolve => setTimeout(resolve, 300)); const value = await cdp.send('Page.captureScreenshot'); fs.writeFileSync(path.join(root, 'release', name), Buffer.from(value.data, 'base64')); };
    await route('rainalley://app/feature/cs2-demo');
    await waitFor(cdp, "document.querySelector('#demoDirectory')?.value.length > 0", 'No inventory page');
    await cdp.evaluate("document.querySelector('#demoInstall').click()"); await click('否，取消安装');
    assert.ok(!fs.existsSync(path.join(game, 'addons')));
    await cdp.evaluate("document.querySelector('#demoInstall').click()"); await click('是，继续安装'); await click('取消安装');
    assert.ok(!fs.existsSync(path.join(game, 'addons')));
    await waitFor(cdp, "!document.querySelector('#demoGuiRefresh').disabled", 'Previous cancelled operation did not settle');
    await cdp.evaluate("document.querySelector('#demoGuiRefresh').click(); document.querySelector('#demoGuiStatus').scrollIntoView({block:'center'})");
    await waitFor(cdp, "document.querySelector('.demo-workbench').getAttribute('aria-busy')==='false'", 'GUI refresh did not finish');
    assert.ok(await cdp.evaluate("!!document.querySelector('#demoGuiUninstall') && !!document.querySelector('#demoGuiFolder')"));
    await shot('preview-demo-dark.png');
    await cdp.evaluate("document.documentElement.dataset.theme='light'"); await shot('preview-demo-light.png');
    await cdp.evaluate("document.documentElement.dataset.theme='dark';document.querySelector('#demoInstall').click()"); await click('是，继续安装'); await click('保留备份');
    await waitFor(cdp, "document.querySelector('#demoStatus')?.textContent.includes('回放插件已安装')", 'IPC install failed', 90000);
    assert.ok(fs.existsSync(path.join(game, 'addons/counterstrikesharp/plugins/DemoTracer/DemoTracer.dll')));
    assert.ok(!fs.existsSync(path.join(game, 'addons/counterstrikesharp/plugins/BotAI/BotAI.dll')));
    await cdp.evaluate("document.querySelector('#demoUninstall').click()"); await click('保留配置');
    await waitFor(cdp, "document.querySelector('#cs2ModalTitle')?.textContent==='确认卸载回放插件？'", 'No uninstall preview'); await click('确认卸载');
    await waitFor(cdp, "document.querySelector('#demoStatus')?.textContent.includes('恢复备份')", 'IPC uninstall failed');
    assert.ok(!fs.existsSync(path.join(game, 'addons/counterstrikesharp/plugins/DemoTracer/DemoTracer.dll')));
    await cdp.evaluate("const link=document.querySelector('.demo-workbench a'); link.href=" + JSON.stringify(url) + "; link.click()");
    await waitFor(cdp, "document.body.dataset.page==='site'", 'Tool source link did not open website');
    await route(url);
    await waitFor(cdp, 'window.alleyDesktop.testBounds().then(a=>a.some(b=>b.width>0))', 'Native website not visible');
    await new Promise(resolve=>setTimeout(resolve,500));
    await cdp.evaluate("document.querySelector('#downloadFolderButton').click()");
    await waitFor(cdp, "!document.querySelector('#downloadsOverlay').hidden && !!document.querySelector('.website-modal-background')", 'No background');
    assert.ok(await cdp.evaluate("document.querySelector('.website-modal-background').naturalWidth>0"));
    await waitFor(cdp, 'window.alleyDesktop.testBounds().then(a=>a.every(b=>b.width===0))', 'Native view not hidden');
    await shot('preview-downloads-web-background.png');
    await cdp.evaluate("document.querySelector('#downloadsClose').click()");
    await waitFor(cdp, 'window.alleyDesktop.testBounds().then(a=>a.some(b=>b.width>0))', 'View not restored');
    assert.equal(await cdp.evaluate("!!document.querySelector('.website-modal-background')"),false);
    await route('rainalley://app/feature/cs2-demo');
    console.log('PASS: Demo install/uninstall, both cancellation steps, downloads captured background and native view restoration.');
    if (preview) { keep = true; socket.close(); proc.unref(); proc.stdout.destroy(); proc.stderr.destroy(); console.log(JSON.stringify({ preview:true,pid:proc.pid,directory:base })); }
  } catch (error) { throw new Error(error.stack + '\n' + output.slice(-3000)); }
  finally {
    socket?.close(); server.close();
    if (!keep) { if (proc.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { stdio:'ignore',windowsHide:true }); fs.rmSync(base, { recursive:true,force:true,maxRetries:5,retryDelay:200 }); }
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
