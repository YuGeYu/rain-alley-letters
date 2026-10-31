const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const archive = process.env.CS2_BOT_IMPROVER_ARCHIVE || 'E:\\dow\\CS2BotImprover.zip';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const net = require('node:net');
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function createTestApp(base) {
  const appRoot = path.join(base, 'app');
  fs.mkdirSync(appRoot, { recursive: true });
  for (const folder of ['src', 'assets']) fs.cpSync(path.join(root, folder), path.join(appRoot, folder), { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(appRoot, 'package.json'));
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(path.join(root, name), path.join(appRoot, name));
  const preloadPath = path.join(appRoot, 'src', 'preload.cjs');
  let preload = fs.readFileSync(preloadPath, 'utf8');
  preload = preload.replace("resumeAccount: () => ipcRenderer.invoke('account:resume'),", "resumeAccount: async () => ({ username: 'CS2RUNTIME' }),");
  preload = preload.replace("getComments: (featureId) => ipcRenderer.invoke('module:get-comments', featureId),", "getComments: async () => ({ comments: [] }),");
  preload = preload.replace("addComment: (featureId, body) => ipcRenderer.invoke('module:add-comment', { featureId, body }),", "addComment: async (_featureId, body) => ({ comment: { username: 'CS2RUNTIME', body, createdAt: Math.floor(Date.now() / 1000) } }),");
  preload = preload.replace("openWebsite: (url, approvedByUser = false, tabId) => ipcRenderer.invoke('site:open', url, approvedByUser === true, tabId),", "openWebsite: async (url, _approved, tabId) => ({ id: tabId || 'test-tab', url, title: '测试分享页', loading: false }),");
  assert.ok(preload.includes("title: '测试分享页'"), 'The isolated website-view test hook was not installed.');
  fs.writeFileSync(preloadPath, preload, 'utf8');
  return appRoot;
}

async function waitForTarget(port, processRef) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) throw new Error(`Electron exited during startup (${processRef.exitCode}).`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const page = (await response.json()).find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* wait for the app's debug endpoint */ }
    await sleep(150);
  }
  throw new Error('Electron DevTools did not become available.');
}

function connectCdp(socket) {
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const current = pending.get(message.id); pending.delete(message.id);
    if (message.error) current.reject(new Error(message.error.message)); else current.resolve(message.result || {});
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const current = ++id; pending.set(current, { resolve, reject });
    socket.send(JSON.stringify({ id: current, method, params }));
    setTimeout(() => { if (pending.has(current)) { pending.delete(current); reject(new Error(`DevTools timed out: ${method}`)); } }, 30000).unref?.();
  });
  return {
    send,
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    },
  };
}

async function waitFor(cdp, expression, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(expression).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error(message);
}

function panelPids(executable) {
  const ps = `$target = '${executable.replaceAll("'", "''")}'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target } | ForEach-Object { $_.ProcessId }`;
  const text = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true });
  return new Set(text.split(/\s+/).map(Number).filter(Number.isInteger));
}

async function run() {
  if (process.platform !== 'win32') {
    console.log('CS2 install runtime skipped: the installer depends on Windows tar and executable launching.');
    return;
  }
  if (!fs.existsSync(archive)) {
    console.log('CS2 install runtime skipped: set CS2_BOT_IMPROVER_ARCHIVE to the official v1.4.7 ZIP to enable the integration check.');
    return;
  }
  assert.ok(fs.existsSync(electron), 'Electron executable is missing.');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex').toUpperCase();
  assert.equal(digest, 'EFFB3C9C76301F74DA1582FB167B44FA12B86772C2CACC91848767C27DB92E67', 'The local plugin ZIP is not the pinned v1.4.7 release.');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-alley-cs2-install-'));
  const appRoot = createTestApp(base);
  const userData = path.join(base, 'user-data'); fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(path.join(userData, 'downloads'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'preferences.json'), JSON.stringify({ downloadDirectory: path.join(userData, 'downloads') }));
  const game = path.join(base, 'steamapps', 'common', 'Counter-Strike Global Offensive');
  const csgo = path.join(game, 'game', 'csgo');
  fs.mkdirSync(path.join(game, 'game', 'bin', 'win64'), { recursive: true });
  fs.mkdirSync(path.join(csgo, 'addons', 'RainAlleyOldPlugin'), { recursive: true });
  fs.writeFileSync(path.join(csgo, 'gameinfo.gi'), 'original-gameinfo');
  fs.writeFileSync(path.join(csgo, 'addons', 'RainAlleyOldPlugin', 'preserve-me.txt'), 'original-plugin');

  const panelTarget = path.join(csgo, 'Panel v1.4.7.exe');
  const existingPanels = panelPids(panelTarget);
  const port = await freePort();
  const app = spawn(electron, [appRoot, `--remote-debugging-port=${port}`, '--remote-allow-origins=*', `--user-data-dir=${userData}`], {
    cwd: appRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: path.dirname(electron), RAIN_ALLEY_TEST_MODE: '1' },
  });
  let output = '';
  app.stdout.on('data', (chunk) => { output += chunk.toString(); });
  app.stderr.on('data', (chunk) => { output += chunk.toString(); });
  let socket;
  try {
    const target = await waitForTarget(port, app);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    const cdp = connectCdp(socket);
    await cdp.send('Runtime.enable');
    await waitFor(cdp, "document.body.dataset.page === 'scene'", 'Test app did not reach the home page.');

    await cdp.evaluate("document.querySelector('#appAddressInput').value='rainalley://app/feature/cs2-bots'; document.querySelector('#addressForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
    await waitFor(cdp, "Boolean(document.querySelector('#installCs2Package'))", 'CS2 detail page did not render.');
    await cdp.evaluate(`document.querySelector('#cs2Directory').value=${JSON.stringify(csgo)}; document.querySelector('#cs2Archive').value=${JSON.stringify(archive)};`);

    await cdp.evaluate("document.querySelector('#installCs2Package').click()");
    await waitFor(cdp, "document.querySelector('.cs2-modal h2')?.textContent === '清理其他 CS2 插件？'", 'Cleanup confirmation did not appear as an app modal.');
    assert.equal(await cdp.evaluate("document.querySelector('.cs2-modal').getAttribute('aria-modal')"), 'true');
    await cdp.evaluate("[...document.querySelectorAll('.cs2-modal-actions button')].find((button)=>button.textContent.includes('取消安装')).click()");
    await waitFor(cdp, "!document.querySelector('.cs2-modal-overlay')", 'Decline-cleanup modal did not close.');
    assert.equal(fs.readFileSync(path.join(csgo, 'gameinfo.gi'), 'utf8'), 'original-gameinfo', 'Declining cleanup modified the game directory.');
    assert.ok(fs.existsSync(path.join(csgo, 'addons', 'RainAlleyOldPlugin', 'preserve-me.txt')), 'Declining cleanup removed the other plugin.');

    const clickAndChoose = async (choice) => {
      await cdp.evaluate("document.querySelector('#toast').textContent=''");
      await cdp.evaluate("document.querySelector('#installCs2Package').click()");
      await waitFor(cdp, "document.querySelector('.cs2-modal h2')?.textContent === '清理其他 CS2 插件？'", 'Cleanup modal did not appear.');
      await cdp.evaluate("[...document.querySelectorAll('.cs2-modal-actions button')].find((button)=>button.textContent.includes('是，继续安装')).click()");
      await waitFor(cdp, "document.querySelector('.cs2-modal h2')?.textContent === '保留文件备份？'", 'Backup modal did not appear.');
      await cdp.evaluate(` [...document.querySelectorAll('.cs2-modal-actions button')].find((button)=>button.textContent.trim() === ${JSON.stringify(choice)}).click()`);
    };

    await clickAndChoose('保留备份');
    await waitFor(cdp, "document.querySelector('#toast').textContent.includes('插件已安装并打开 Panel')", 'Install did not finish and report that Panel was opened.', 180000);
    const firstToast = await cdp.evaluate("document.querySelector('#toast').textContent");
    const backupFolders = fs.readdirSync(csgo).filter((name) => name.startsWith('.rain-alley-backup-'));
    assert.equal(backupFolders.length, 1, `Expected one persistent backup folder, got ${backupFolders.length}; toast=${firstToast}; entries=${fs.readdirSync(csgo).join(',')}.`);
    const backup = path.join(csgo, backupFolders[0]);
    assert.equal(fs.readFileSync(path.join(backup, 'gameinfo.gi'), 'utf8'), 'original-gameinfo', 'Original gameinfo.gi was not backed up.');
    assert.equal(fs.readFileSync(path.join(backup, 'addons', 'RainAlleyOldPlugin', 'preserve-me.txt'), 'utf8'), 'original-plugin', 'Removed plugin was not backed up.');
    assert.ok(fs.existsSync(path.join(csgo, 'addons', 'counterstrikesharp', 'api', 'CounterStrikeSharp.API.dll')), 'Official plugin files were not installed.');
    assert.ok(fs.existsSync(panelTarget), 'Official Panel executable was not installed.');
    assert.equal(fs.readFileSync(path.join(csgo, 'gameinfo.gi')).length > 100, true, 'The official gameinfo.gi was not copied as a file.');

    for (const pid of panelPids(panelTarget)) if (!existingPanels.has(pid)) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    for (let attempt = 0; attempt < 40 && panelPids(panelTarget).size; attempt += 1) await sleep(100);

    fs.mkdirSync(path.join(csgo, 'addons', 'AnotherOldPlugin'), { recursive: true });
    fs.writeFileSync(path.join(csgo, 'addons', 'AnotherOldPlugin', 'marker.txt'), 'temporary');
    const backupsBefore = fs.readdirSync(csgo).filter((name) => name.startsWith('.rain-alley-backup-')).length;
    await clickAndChoose('不保留备份');
    await waitFor(cdp, "document.querySelector('#toast').textContent.includes('插件已安装并打开 Panel')", 'No-backup install did not finish.', 180000);
    assert.equal(fs.readdirSync(csgo).filter((name) => name.startsWith('.rain-alley-backup-')).length, backupsBefore, 'No-backup install created a persistent backup folder.');
    assert.ok(!fs.existsSync(path.join(csgo, 'addons', 'AnotherOldPlugin')), 'Confirmed stale plugin was not cleaned.');
    await cdp.evaluate("document.querySelector('#cs2QuarkCommentLink').click()");
    await waitFor(cdp, "document.querySelector('#appAddressInput').value === 'https://pan.quark.cn/s/2e9f1139858b'", 'Quark share link did not route into the app website view.');
    await cdp.evaluate('window.alleyDesktop.quit()');
    await Promise.race([new Promise((resolve) => app.once('exit', resolve)), sleep(12000).then(() => { throw new Error('Test app did not exit cleanly.'); })]);
    socket.close();
    console.log('CS2 install runtime ok: modal cancel, persistent/no-backup install, stale-plugin handling, file copy, Panel launch, and share link routing.');
  } catch (cause) {
    try { socket?.close(); } catch {}
    if (app.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    throw new Error(`${cause.stack || cause}\nElectron output:\n${output.slice(-5000)}`);
  } finally {
    for (const pid of panelPids(panelTarget)) if (!existingPanels.has(pid)) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try { fs.rmSync(base, { recursive: true, force: true }); break; }
      catch (cause) { if (attempt === 7) console.error(`Temporary CS2 test files remain at ${base}: ${cause.message}`); else await sleep(250); }
    }
  }
}

module.exports = { createTestApp, freePort, waitForTarget, connectCdp, waitFor };
if (require.main === module) run().catch((cause) => { console.error(cause.stack || cause); process.exitCode = 1; });
