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
  preload = preload.replace('chooseCs2Directory:', "testBounds: () => ipcRenderer.invoke('test:bounds'), testLink: url => ipcRenderer.invoke('test:link', url), testExternal: () => ipcRenderer.invoke('test:external'), chooseCs2Directory:");
  fs.writeFileSync(preloadPath, preload);
  const mainPath = path.join(appRoot, 'src/main.cjs');
  fs.appendFileSync(mainPath, '\nconst testExternal=[];shell.openExternal=async url=>{testExternal.push(url);};ipcMain.handle("test:external",()=>testExternal);ipcMain.handle("test:bounds",()=>[...websiteViews.values()].map(v=>v.getBounds()));ipcMain.handle("test:link",async(_e,url)=>websiteViews.get(activeWebsiteId).webContents.executeJavaScript("window.open("+JSON.stringify(url)+")",true));\n');
  const http = require('node:http');
  const server = http.createServer((_req, res) => res.end('<!doctype html><meta charset="utf-8"><body style="height:3000px;background:#183044;color:white"><h1>本机跳转与滚动验证</h1></body>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const port = await freePort(); const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const proc = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [appRoot, '--remote-debugging-port=' + port, '--remote-allow-origins=*', '--user-data-dir=' + profile], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env });
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
    await route('rainalley://app/feature/cs2-inventory');
    await waitFor(cdp, "document.querySelector('#inventoryDirectory')?.value.length > 0", 'No inventory page');
    await cdp.evaluate("document.querySelector('#inventoryInstall').click()"); await click('否，取消安装');
    assert.ok(!fs.existsSync(path.join(game, 'addons')));
    await cdp.evaluate("document.querySelector('#inventoryInstall').click()"); await click('是，继续安装'); await click('取消安装');
    assert.ok(!fs.existsSync(path.join(game, 'addons')));
    await shot('preview-inventory-dark.png');
    await cdp.evaluate("document.documentElement.dataset.theme='light'"); await shot('preview-inventory-light.png');
    await cdp.evaluate("document.documentElement.dataset.theme='dark';document.querySelector('#inventoryInstall').click()"); await click('是，继续安装'); await click('保留备份');
    await waitFor(cdp, "document.querySelector('#inventoryStatus')?.textContent.includes('饰品工坊已安装')", 'IPC install failed', 90000);
    assert.ok(fs.existsSync(path.join(game, 'addons/counterstrikesharp/plugins/InventorySimulator/InventorySimulator.dll')));
    assert.ok(!fs.existsSync(path.join(game, 'addons/counterstrikesharp/plugins/BotAI/BotAI.dll')));
    await cdp.evaluate("document.querySelector('#inventoryUninstall').click()"); await click('保留配置');
    await waitFor(cdp, "document.querySelector('#cs2ModalTitle')?.textContent==='确认卸载饰品工坊？'", 'No uninstall preview'); await click('确认卸载');
    await waitFor(cdp, "document.querySelector('#inventoryStatus')?.textContent.includes('恢复备份')", 'IPC uninstall failed');
    assert.ok(!fs.existsSync(path.join(game, 'addons/counterstrikesharp/plugins/InventorySimulator/InventorySimulator.dll')));
    await route(url);
    await waitFor(cdp, 'window.alleyDesktop.testBounds().then(a=>a.some(b=>b.width>0))', 'Native website not visible');
    await cdp.evaluate("window.alleyDesktop.testLink('ccswitch://v1/import?resource=provider&test=1')");
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(await cdp.evaluate("document.querySelector('#siteWarningOverlay').hidden"), true, 'Disabled protocol should not open confirmation');
    assert.deepEqual(await cdp.evaluate('window.alleyDesktop.testExternal()'), []);
    await cdp.evaluate('window.alleyDesktop.saveState({allowExternalProtocols:true})');
    // Reload state through the real preference path, leaving website process isolated.
    await cdp.send('Page.reload'); await waitFor(cdp, "document.body.dataset.page === 'scene'", 'No reloaded home'); await route(url);
    await waitFor(cdp, 'window.alleyDesktop.testBounds().then(a=>a.some(b=>b.width>0))', 'Native website not restored');
    await cdp.evaluate("window.alleyDesktop.testLink('ccswitch://v1/import?resource=provider&test=1')");
    await waitFor(cdp, "!document.querySelector('#siteWarningOverlay').hidden", 'No protocol confirmation');
    await waitFor(cdp, 'window.alleyDesktop.testBounds().then(a=>a.every(b=>b.width===0))', 'Modal failed to hide native website');
    for (let i=0;i<4;i++) {
      await cdp.send('Input.dispatchMouseEvent', { type:'mouseWheel', x:700, y:500, deltaX:0, deltaY:300 });
      await cdp.evaluate("window.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('scroll'))");
      await new Promise(resolve => setTimeout(resolve, 60));
      assert.ok((await cdp.evaluate('window.alleyDesktop.testBounds()')).every(b=>b.width===0));
    }
    await shot('preview-protocol-confirmation.png');
    await cdp.evaluate("document.querySelector('#siteWarningCancel').click()");
    await waitFor(cdp, 'window.alleyDesktop.testBounds().then(a=>a.some(b=>b.width>0))', 'Cancel did not restore website');
    await cdp.evaluate("window.alleyDesktop.testLink('ccswitch://v1/import?test=2')");
    await waitFor(cdp, "!document.querySelector('#siteWarningOverlay').hidden", 'No second confirmation');
    await cdp.evaluate("document.querySelector('#siteWarningOpen').click()");
    await waitFor(cdp, 'window.alleyDesktop.testExternal().then(a=>a.length===1)', 'Confirmed protocol was not dispatched');
    assert.equal((await cdp.evaluate('window.alleyDesktop.testExternal()'))[0], 'ccswitch://v1/import?test=2');
    await route('rainalley://app/feature/cs2-inventory');
    console.log('Inventory runtime passed: real install/uninstall IPC, both cancel steps, bundled ZIP, shared runtime only, native WebContentsView remains hidden through wheel/resize, default-off protocol, confirmed OS dispatch, screenshots.');
    if (preview) { keep = true; socket.close(); proc.unref(); proc.stdout.destroy(); proc.stderr.destroy(); console.log(JSON.stringify({ preview:true,pid:proc.pid,directory:base })); }
  } catch (error) { throw new Error(error.stack + '\n' + output.slice(-3000)); }
  finally {
    socket?.close(); server.close();
    if (!keep) { if (proc.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { stdio:'ignore',windowsHide:true }); fs.rmSync(base, { recursive:true,force:true,maxRetries:5,retryDelay:200 }); }
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
