// Isolated Electron prismatic-effects check and local preview; no online account writes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createTestApp, freePort, waitForTarget, connectCdp, waitFor } = require('./cs2-install-runtime-check.cjs');
const root = path.resolve(__dirname, '..');

async function run() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'alley-prismatic-'));
  const appRoot = createTestApp(base);
  const preload = path.join(appRoot, 'src/preload.cjs');
  let source = fs.readFileSync(preload, 'utf8');
  source = source.replace("getPublicProfile: (username) => ipcRenderer.invoke('profile:get-public', username),", "getPublicProfile: async () => { await new Promise(resolve => setTimeout(resolve, 300)); return { account: { username: 'CS2RUNTIME', createdAt: 1793548800 }, profile: { displayName: '本机预览', bio: '', html: '', css: '' } }; },");
  source = source.replace("logout: () => ipcRenderer.invoke('account:logout'),", "logout: async () => ({ ok: true }),");
  fs.writeFileSync(preload, source);
  const main = path.join(appRoot, 'src/main.cjs');
  fs.appendFileSync(main, `
  ipcMain.handle('test:open-overview-view', async (_event, tabId) => {
    websiteTabIds.add(tabId);
    const view = websiteViews.get(tabId) || createWebsiteView(tabId);
    activeWebsiteId = tabId;
    await view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<html><head><title>标签浮层验证</title></head><body style="background:#193848;color:#fff;font:24px sans-serif;padding:60px"><h1>本机网页预览</h1><p>浮层展开时，这张网页应完整显示在遮罩下方。</p><input value="网页内容保留" /></body></html>'));
    return { id: tabId, url: 'https://vault.600318.xyz/', title: '本机网页预览', loading: false };
  });
  ipcMain.handle('test:effects', async (_event, expression) => websiteViews.get(activeWebsiteId)?.webContents.executeJavaScriptInIsolatedWorld(effectsWorld, [{ code: expression }]));
  ipcMain.handle('test:overview-view-bounds', () => websiteViews.get(activeWebsiteId)?.getBounds());
  `);
  source = fs.readFileSync(preload, 'utf8');
  source = source.replace("openWebsite: async (url, _approved, tabId) => ({ id: tabId || 'test-tab', url, title: '测试分享页', loading: false }),", "openWebsite: async (_url, _approved, tabId) => ipcRenderer.invoke('test:open-overview-view', tabId),");
  source = source.replace('captureWebsiteBackground: tabId =>', "testEffects: expression => ipcRenderer.invoke('test:effects', expression), testViewBounds: () => ipcRenderer.invoke('test:overview-view-bounds'), captureWebsiteBackground: tabId =>");
  fs.writeFileSync(preload, source);
  const port = await freePort();
  const env = { ...process.env, RAIN_ALLEY_TEST_MODE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const preview = process.argv.includes('--preview');
  const proc = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [appRoot, '--remote-debugging-port=' + port, '--remote-allow-origins=*', '--user-data-dir=' + path.join(base, 'profile')], { stdio: preview ? 'ignore' : ['ignore', 'pipe', 'pipe'], detached: preview, env, windowsHide: true });
  let output = '', socket, keep = false;
  proc.stdout?.on('data', chunk => output += chunk);
  proc.stderr?.on('data', chunk => output += chunk);
  try {
    const target = await waitForTarget(port, proc);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const cdp = connectCdp(socket);
    const errors = [];
    socket.addEventListener('message', ({ data }) => { const msg = JSON.parse(data); if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails); });
    await cdp.send('Runtime.enable');
    await waitFor(cdp, "document.body.dataset.page === 'scene'", 'Home did not open.');
    const route = async address => cdp.evaluate(`document.querySelector('#appAddressInput').value=${JSON.stringify(address)}; document.querySelector('#addressForm').dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}))`);
    const openSettings = async () => { await cdp.evaluate("document.querySelector('#settingsButton').click()"); await waitFor(cdp, "document.body.dataset.page === 'settings'", 'Settings did not open.'); };
    const settingsId = () => cdp.evaluate("document.querySelector('#websiteTabs [aria-controls=settingsPage]').dataset.browserTab");
    const clickTab = id => cdp.evaluate(`document.querySelector('[data-browser-tab="${id}"]').click()`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 850, deviceScaleFactor: 1, mobile: false });
    const exists = "!!document.querySelector('.alley-prismatic-effects canvas')";
    const stop = async () => {};
    const pointer = async () => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 510, y: 330 });
      await new Promise(resolve => setTimeout(resolve, 180));
      assert.equal(await cdp.evaluate(exists), false, 'Pointer movement triggered a full-screen effect.');
    };
    await pointer();
    for (const theme of ['dark', 'light']) {
      await cdp.evaluate(`document.documentElement.dataset.theme='${theme}'`);
      await new Promise(resolve => setTimeout(resolve, 650));
      assert.equal(await cdp.evaluate(exists), false, 'Theme change or generic play created a full-screen effect.');
      const shot = await cdp.send('Page.captureScreenshot');
      fs.writeFileSync(path.join(root, `release/preview-prismatic-${theme}.png`), Buffer.from(shot.data, 'base64'));
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
    await waitFor(cdp, '!' + exists, 'Effect did not stop when idle');
    await cdp.evaluate("document.querySelector('#settingsButton').click()");
    await waitFor(cdp, "document.body.dataset.page==='settings'", 'Settings navigation failed.');
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await cdp.evaluate(exists), false, 'Ordinary settings click triggered full-screen effect.');
    assert.equal(await cdp.evaluate("document.activeElement.id"), 'settingsTitle', 'Effect stole focus');
    for (const selector of ['#homeBrowserTab', '#collectionBrowserTab', '#profileBrowserTab']) {
      await stop(); await new Promise(resolve => setTimeout(resolve, 460));
      await cdp.evaluate(`document.querySelector('${selector}').click()`);
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.equal(await cdp.evaluate(exists), false, 'Ordinary navigation triggered full-screen effect: ' + selector);
    }
    await route('rainalley://app/feature/cs2-bots');
    await waitFor(cdp, "document.body.dataset.page === 'detail'", 'Tool missing');
    await stop(); await pointer(); await stop();
    await cdp.evaluate("document.querySelector('#commentInput').value='本机动效测试留言';document.querySelector('#commentForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await cdp.evaluate(exists), false, 'Ordinary form submission triggered full-screen effect.');
    await new Promise(resolve => setTimeout(resolve, 460));
    await cdp.evaluate("document.querySelector('#allTabsButton').click()");
    await waitFor(cdp, "document.querySelector('#allTabsDialog').open", 'Overview did not open');
    assert.equal(await cdp.evaluate(exists), false, 'Opening a dialog triggered a full-screen effect.');
    assert.equal(await cdp.evaluate("document.querySelector('#allTabsDialog').contains(document.activeElement)"), true);
    await cdp.evaluate("document.querySelector('#allTabsClose').click()");
    await stop();
    await cdp.evaluate("document.documentElement.dataset.lightweight='true';document.dispatchEvent(new PointerEvent('pointermove',{clientX:400,clientY:300}))");
    assert.equal(await cdp.evaluate(exists), false, 'Lightweight did not suppress effects');
    await cdp.evaluate("document.documentElement.dataset.lightweight='false'");
    for (const feature of ['prefers-reduced-motion', 'forced-colors']) {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: feature, value: feature==='forced-colors'?'active':'reduce' }] });
      await cdp.evaluate("document.dispatchEvent(new PointerEvent('pointermove',{clientX:400,clientY:300}))");
      assert.equal(await cdp.evaluate(exists), false, feature + ' did not suppress effects');
      await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    }
    await pointer();
    await cdp.evaluate("document.dispatchEvent(new Event('alley:suspend-effects'))");
    assert.equal(await cdp.evaluate(exists), false, 'Suspend did not clean effects');
    await route('https://vault.600318.xyz/');
    await waitFor(cdp, "document.body.dataset.page === 'site'", 'Native fixture missing');
    const native = expression => cdp.evaluate(`window.alleyDesktop.testEffects(${JSON.stringify(expression)})`);
    await native("document.dispatchEvent(new PointerEvent('pointermove',{clientX:400,clientY:300}));true");
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(await native("!!document.querySelector('.alley-prismatic-effects canvas')"), false, 'Embedded page pointer triggered a full-screen layer.');
    await stop(); await new Promise(resolve => setTimeout(resolve, 460));
    await native("document.dispatchEvent(new Event('submit',{bubbles:true}));true");
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await cdp.evaluate(exists), false, 'Embedded website form triggered app-wide effect.');
    assert.equal(await native("document.elementFromPoint(400,300)?.closest('.alley-prismatic-effects') === null"), true);
    await cdp.evaluate("window.alleyDesktop.saveState({lightweight:true})");
    await waitFor(cdp, `window.alleyDesktop.testEffects("!document.querySelector('.alley-prismatic-effects canvas')")`, 'Native lightweight not synced');
    await cdp.evaluate("window.alleyDesktop.saveState({lightweight:false})");
    await cdp.evaluate("document.querySelector('#settingsButton').click()");
    await waitFor(cdp, "document.body.dataset.page === 'settings'", 'Preview settings missing');
    await new Promise(resolve => setTimeout(resolve, 1900));
    assert.deepEqual(errors, [], 'Renderer errors');
    console.log('PASS: no full-screen effect from pointer movement, ordinary clicks/navigation/forms/site actions, retained controls, reduced motion/forced colors/lightweight/suspend.');
    if (preview) { keep = true; proc.unref(); console.log('Local preview remains open: ' + appRoot + ' (PID ' + proc.pid + ')'); }
  } catch (cause) { throw new Error(`${cause.stack || cause}\n${output.slice(-2500)}`); }
  finally {
    socket?.close();
    if (!keep && proc.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  }
}
run().catch(cause => { console.error(cause); process.exitCode = 1; });

