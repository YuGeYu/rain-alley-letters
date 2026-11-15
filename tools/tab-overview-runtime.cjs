// Isolated Electron tab-overview check and local preview; no online account writes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createTestApp, freePort, waitForTarget, connectCdp, waitFor } = require('./cs2-install-runtime-check.cjs');
const root = path.resolve(__dirname, '..');

async function run() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'alley-tab-overview-'));
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
  ipcMain.handle('test:overview-view-bounds', () => websiteViews.get(activeWebsiteId)?.getBounds());
  `);
  source = fs.readFileSync(preload, 'utf8');
  source = source.replace("openWebsite: async (url, _approved, tabId) => ({ id: tabId || 'test-tab', url, title: '测试分享页', loading: false }),", "openWebsite: async (_url, _approved, tabId) => ipcRenderer.invoke('test:open-overview-view', tabId),");
  source = source.replace('captureWebsiteBackground: tabId =>', "testViewBounds: () => ipcRenderer.invoke('test:overview-view-bounds'), captureWebsiteBackground: tabId =>");
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 760, deviceScaleFactor: 1, mobile: false });
    await route('rainalley://app/feature/cs2-bots');
    await waitFor(cdp, "document.body.dataset.page === 'detail'", 'Tool not opened');
    await cdp.evaluate("document.querySelector('#commentInput').value='标签切换保留草稿'");
    const tool = await cdp.evaluate("document.querySelector('#websiteTabs [aria-selected=true]').dataset.browserTab");
    await openSettings();
    for (let i = 0; i < 24; i++) {
      await cdp.evaluate("document.querySelector('#newBrowserTabButton').click()");
      await waitFor(cdp, `document.querySelectorAll('#websiteTabs .browser-tab').length === ${i + 3}`, 'New tab missing');
    }
    const last = await cdp.evaluate("document.querySelector('#websiteTabs [aria-selected=true]').dataset.browserTab");
    const geometry = "[...document.querySelectorAll('#websiteTabs .browser-tab')].map(t=>({width:t.getBoundingClientRect().width, close:t.querySelector('.browser-tab-close').getBoundingClientRect().left-t.getBoundingClientRect().left}))";
    const before = await cdp.evaluate(geometry);
    assert.ok(before.every(t => t.width === 136 && Math.abs(t.close - before[0].close) < 0.01));
    const targetRect = await cdp.evaluate("(()=>{const b=document.querySelector('#websiteTabs .browser-tab:last-child .browser-tab-close').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()");
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...targetRect });
    assert.deepEqual(await cdp.evaluate(geometry), before, 'Hover moved close controls');
    for (const width of [1440, 900, 1000]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 760, deviceScaleFactor: 1, mobile: false });
      assert.ok((await cdp.evaluate(geometry)).every(t => t.width === 136));
      assert.equal(await cdp.evaluate("(()=>{const b=document.querySelector('#allTabsButton').getBoundingClientRect();return b.right<=innerWidth && b.width>0})()"), true);
    }
    const open = async () => { await cdp.evaluate("document.querySelector('#allTabsButton').click()"); await waitFor(cdp, "document.querySelector('#allTabsDialog').open", 'Overview missing'); };
    await open();
    assert.equal(await cdp.evaluate("document.querySelectorAll('#allTabsList .all-tabs-row').length"), 29);
    assert.equal(await cdp.evaluate("document.querySelector('#allTabsList').scrollHeight > document.querySelector('#allTabsList').clientHeight"), true);
    assert.equal(await cdp.evaluate("document.activeElement.dataset.overviewTab"), last);
    // Native dialog must contain keyboard focus and Escape must preserve the current page.
    await cdp.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9 });
    assert.equal(await cdp.evaluate("document.querySelector('#allTabsDialog').contains(document.activeElement)"), true);
    await cdp.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
    await waitFor(cdp, "!document.querySelector('#allTabsDialog').open", 'Escape failed');
    assert.equal(await cdp.evaluate("document.activeElement.id"), 'allTabsButton');
    assert.equal(await cdp.evaluate("document.querySelector('#websiteTabs [aria-selected=true]').dataset.browserTab"), last);
    await open();
    await cdp.evaluate(`document.querySelector('[data-overview-tab="${tool}"]').click()`);
    await waitFor(cdp, "document.body.dataset.page === 'detail'", 'Hidden tool not reachable');
    assert.equal(await cdp.evaluate("document.querySelector('#commentInput').value"), '标签切换保留草稿');
    await open();
    await cdp.evaluate("document.querySelector('#allTabsList').scrollTop=450");
    const scroll = await cdp.evaluate("document.querySelector('#allTabsList').scrollTop");
    await cdp.evaluate(`document.querySelector('[data-overview-close="${last}"]').click()`);
    await waitFor(cdp, "document.querySelectorAll('#allTabsList .all-tabs-row').length === 28", 'List close failed');
    assert.equal(await cdp.evaluate("document.querySelector('#allTabsList').scrollTop"), scroll);
    await cdp.evaluate(`document.querySelector('[data-overview-close="${tool}"]').focus(); document.querySelector('[data-overview-close="${tool}"]').click()`);
    await waitFor(cdp, `!document.querySelector('[data-overview-tab="${tool}"]')`, 'Active tool not closed');
    assert.equal(await cdp.evaluate("document.querySelector('#allTabsDialog').open"), true);
    assert.equal(await cdp.evaluate("document.querySelector('#allTabsDialog').contains(document.activeElement)"), true);
    await cdp.evaluate("document.querySelector('#allTabsClose').click()");
    await route('https://vault.600318.xyz/');
    await waitFor(cdp, "document.body.dataset.page === 'site'", 'Native fixture not opened');
    await waitFor(cdp, "window.alleyDesktop.testViewBounds().then(b=>b?.width>0)", 'Native view invisible');
    await new Promise(resolve => setTimeout(resolve, 700));
    await open();
    await waitFor(cdp, "window.alleyDesktop.testViewBounds().then(b=>b.width===0)", "Native view remained above dialog");
    assert.equal(await cdp.evaluate("!!document.querySelector('.website-modal-background')"), true);
    await cdp.evaluate("document.querySelector('#allTabsClose').click()");
    await waitFor(cdp, "window.alleyDesktop.testViewBounds().then(b=>b.width>0)", 'Native view not restored');
    assert.equal(await cdp.evaluate("!!document.querySelector('.website-modal-background')"), false);
    await open();
    for (const theme of ['light', 'dark']) {
      await cdp.evaluate(`document.documentElement.dataset.theme='${theme}'; document.querySelector('#allTabsList').scrollTop=0`);
      const shot = await cdp.send('Page.captureScreenshot');
      fs.writeFileSync(path.join(root, `release/preview-tab-overview-${theme}.png`), Buffer.from(shot.data, 'base64'));
    }
    assert.deepEqual(errors, [], 'Renderer exceptions');
    console.log('PASS: 26 fixed-width tabs, hover/resize stability, reachable overview, scroll, hidden-tab switch, draft retention, close/focus retention, Escape/focus containment, real native view snapshot/hide/restore.');
    if (preview) { keep = true; proc.unref(); console.log('Local preview remains open: ' + appRoot + ' (PID ' + proc.pid + ')'); }
  } catch (cause) { throw new Error(`${cause.stack || cause}\n${output.slice(-2500)}`); }
  finally {
    socket?.close();
    if (!keep && proc.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  }
}
run().catch(cause => { console.error(cause); process.exitCode = 1; });

