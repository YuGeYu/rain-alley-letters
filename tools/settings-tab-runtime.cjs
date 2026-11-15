// Isolated Electron settings-tab check and local preview; no online account writes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createTestApp, freePort, waitForTarget, connectCdp, waitFor } = require('./cs2-install-runtime-check.cjs');
const root = path.resolve(__dirname, '..');

async function run() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'alley-settings-tab-'));
  const appRoot = createTestApp(base);
  const preload = path.join(appRoot, 'src/preload.cjs');
  let source = fs.readFileSync(preload, 'utf8');
  source = source.replace("getPublicProfile: (username) => ipcRenderer.invoke('profile:get-public', username),", "getPublicProfile: async () => { await new Promise(resolve => setTimeout(resolve, 300)); return { account: { username: 'CS2RUNTIME', createdAt: 1793548800 }, profile: { displayName: '本机预览', bio: '', html: '', css: '' } }; },");
  source = source.replace("logout: () => ipcRenderer.invoke('account:logout'),", "logout: async () => ({ ok: true }),");
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
    await openSettings();
    const id = await settingsId();
    assert.equal(await cdp.evaluate("document.querySelector('#websiteTabs [aria-controls=settingsPage]').getAttribute('aria-selected')"), 'true');
    assert.equal(await cdp.evaluate("document.querySelector('#homeBrowserTab').getAttribute('aria-selected')"), 'false');
    assert.equal(await cdp.evaluate("document.activeElement.id"), 'settingsTitle');
    // A delayed profile response must not overwrite text already entered by the user.
    await cdp.evaluate("document.querySelector('#accountDisplayNameSetting').value='尚未保存的展示名称'; document.querySelector('#accountUsernameSetting').value='UNSAVED_NAME'; document.querySelector('#accountCurrentPasswordSetting').value='fixture-only-draft'");
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(await cdp.evaluate("document.querySelector('#accountDisplayNameSetting').value"), '尚未保存的展示名称');
    await cdp.evaluate("document.querySelector('#settingsPage').scrollTop=280; document.querySelector('#downloadsEnabledSetting').checked=false; document.querySelector('#downloadsEnabledSetting').dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#homeBrowserTab').click()");
    await waitFor(cdp, "document.querySelector('#settingsSaveStatus').textContent.includes('已即时保存')", 'Autosave was lost after switching away.');
    await clickTab(id);
    await waitFor(cdp, "document.body.dataset.page === 'settings'", 'Settings tab did not reactivate.');
    assert.equal(await cdp.evaluate("document.querySelector('#settingsPage').scrollTop"), 280);
    assert.equal(await cdp.evaluate("document.querySelector('#accountDisplayNameSetting').value"), '尚未保存的展示名称');
    assert.equal(await cdp.evaluate("document.querySelector('#accountCurrentPasswordSetting').value"), 'fixture-only-draft');
    assert.equal(await cdp.evaluate("document.querySelector('#accountUsernameSetting').value"), 'UNSAVED_NAME');
    await openSettings();
    await route('rainalley://app/settings');
    assert.equal(await settingsId(), id);
    assert.equal(await cdp.evaluate("document.querySelectorAll('#websiteTabs [aria-controls=settingsPage]').length"), 1);
    await clickTab('profile');
    await waitFor(cdp, "document.querySelector('#profileTitle').textContent === '本机预览'", 'Profile did not load.');
    await clickTab(id);
    assert.equal(await cdp.evaluate("document.querySelector('#accountDisplayNameSetting').value"), '尚未保存的展示名称');
    await route('rainalley://app/feature/cs2-bots');
    await waitFor(cdp, "document.body.dataset.page === 'detail'", 'Tool tab did not open.');
    await cdp.evaluate("document.querySelector('#commentInput').value='保留工具草稿'");
    const toolId = await cdp.evaluate("document.querySelector('#websiteTabs [aria-selected=true]').dataset.browserTab");
    await openSettings();
    await route('https://vault.600318.xyz/');
    await waitFor(cdp, "document.body.dataset.page === 'site'", 'Website did not open from settings.');
    assert.equal(await cdp.evaluate("document.querySelectorAll('#websiteTabs .browser-tab').length"), 3);
    await clickTab(id);
    assert.equal(await cdp.evaluate("document.querySelector('#appAddressInput').value"), 'rainalley://app/settings');
    await clickTab(toolId);
    assert.equal(await cdp.evaluate("document.querySelector('#commentInput').value"), '保留工具草稿');
    // Closing a background settings tab must not change the selected tool.
    await cdp.evaluate(`document.querySelector('[data-close-browser-tab="${id}"]').click()`);
    await waitFor(cdp, "!document.querySelector('#websiteTabs [aria-controls=settingsPage]')", 'Settings did not close.');
    assert.equal(await cdp.evaluate("document.querySelector('#websiteTabs [aria-selected=true]').dataset.browserTab"), toolId);
    assert.equal(await cdp.evaluate("document.querySelector('#accountCurrentPasswordSetting').value"), '');
    await openSettings();
    assert.equal(await cdp.evaluate("document.querySelector('#downloadsEnabledSetting').checked"), false);
    const reopened = await settingsId();
    await cdp.evaluate(`document.querySelector('#downloadsEnabledSetting').checked=true; document.querySelector('#downloadsEnabledSetting').dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('[data-close-browser-tab="${reopened}"]').click()`);
    await waitFor(cdp, "document.body.dataset.page !== 'settings'", 'Closing active settings did not select a neighbor.');
    await openSettings();
    assert.equal(await cdp.evaluate("document.querySelector('#downloadsEnabledSetting').checked"), true);
    // Logout must discard account drafts and the settings tab.
    await cdp.evaluate("document.querySelector('#accountCurrentPasswordSetting').value='fixture-only-draft'; document.querySelector('#logoutButton').click()");
    await waitFor(cdp, "!document.querySelector('#websiteTabs [aria-controls=settingsPage]')", 'Logout retained settings tab.');
    assert.equal(await cdp.evaluate("document.querySelector('#accountCurrentPasswordSetting').value"), '');
    await cdp.send('Page.reload');
    await waitFor(cdp, "document.body.dataset.page === 'scene'", 'Reload did not reach home.');
    await route('rainalley://app/feature/cs2-bots');
    await waitFor(cdp, "document.body.dataset.page === 'detail'", 'Preview tool missing.');
    await openSettings();
    await new Promise(resolve => setTimeout(resolve, 450));
    for (const [theme, width, height] of [['light', 1000, 760], ['dark', 1440, 960]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await cdp.evaluate(`document.querySelector('#themeSelect').value='${theme}'; document.querySelector('#themeSelect').dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#settingsPage').scrollTop=0`);
      await waitFor(cdp, `document.documentElement.dataset.theme === '${theme}'`, 'Theme did not update.');
      assert.equal(await cdp.evaluate("document.querySelector('#settingsPage').scrollWidth > document.querySelector('#settingsPage').clientWidth"), false);
      const shot = await cdp.send('Page.captureScreenshot');
      fs.writeFileSync(path.join(root, `release/preview-settings-tab-${theme}.png`), Buffer.from(shot.data, 'base64'));
    }
    assert.deepEqual(errors, [], 'Unexpected renderer errors.');
    console.log('PASS: singleton settings tab, focus/selection/address, retained drafts/scroll, delayed-profile safety, autosave after switch/close, tool/website isolation, close fallback, logout cleanup, responsive light/dark layout.');
    if (process.argv.includes('--preview')) {
      keep = true; proc.unref();
      console.log('Local fixture preview remains open: ' + appRoot);
    }
  } catch (cause) { throw new Error(`${cause.stack || cause}\n${output.slice(-2500)}`); }
  finally {
    socket?.close();
    if (!keep && proc.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  }
}
run().catch(cause => { console.error(cause); process.exitCode = 1; });
