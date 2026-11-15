// Local-only integration QA. Uses an isolated BiliDesk profile and never logs in.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { createTestApp, freePort, waitForTarget, connectCdp, waitFor } = require('./cs2-install-runtime-check.cjs');

const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function clientPids(executable) {
  const target = executable.replaceAll("'", "''");
  const script = `$target='${target}'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target } | ForEach-Object { $_.ProcessId }`;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
  return output.split(/\s+/).map(Number).filter(Number.isInteger);
}

async function run() {
  if (process.platform !== 'win32') throw new Error('BiliDesk integration requires Windows.');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'alley-bilidesk-'));
  const appRoot = createTestApp(base, { seedResources: true });
  const userData = path.join(base, 'profile');
  const port = await freePort();
  const env = { ...process.env, RAIN_ALLEY_TEST_MODE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const preview = process.argv.includes('--preview');
  const uiOnly = process.argv.includes('--ui-only');
  const app = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [appRoot, `--remote-debugging-port=${port}`, '--remote-allow-origins=*', `--user-data-dir=${userData}`], {
    cwd: appRoot, env, detached: preview, stdio: 'ignore', windowsHide: true,
  });
  let socket;
  let keepPreview = false;
  let clientExecutable = '';
  try {
    const target = await waitForTarget(port, app);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    const cdp = connectCdp(socket);
    const errors = [];
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    });
    await cdp.send('Runtime.enable');
    await waitFor(cdp, "document.body.dataset.page==='scene'", 'Rain Alley home page did not open.');
    await cdp.evaluate("document.querySelector('#appAddressInput').value='rainalley://app/feature/bilidesk';document.querySelector('#addressForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
    await waitFor(cdp, "document.querySelector('[data-bili-status]') && document.querySelector('.bili-workbench')?.getAttribute('aria-busy')==='false'", 'BiliDesk feature page did not initialize.');
    assert.match(await cdp.evaluate("document.querySelector('#detailTitle').textContent"), /BiliDesk/);
    assert.equal(await cdp.evaluate("document.querySelector('.bili-wordmark img').complete && document.querySelector('.bili-wordmark img').naturalWidth>0"), true, 'BiliDesk icon did not load.');
    assert.equal(await cdp.evaluate('window.alleyDesktop.biliDeskStatus().then(result => result.available)'), true, 'Bundled client resource is missing.');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 700, deviceScaleFactor: 1, mobile: false });
    assert.equal(await cdp.evaluate("document.querySelector('.bili-workbench').scrollWidth <= document.querySelector('.bili-workbench').clientWidth+1"), true, 'BiliDesk feature page overflows at compact desktop size.');
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    if (!uiOnly) {
      await cdp.evaluate("document.querySelector('[data-bili=install]').click()");
      await waitFor(cdp, "document.querySelector('[data-bili-status]').textContent.includes('安装完成')", 'BiliDesk installation failed.', 180000);
      const installed = await cdp.evaluate('window.alleyDesktop.biliDeskStatus()');
      assert.equal(installed.installed, true, 'Installed client did not pass manifest verification.');
      clientExecutable = path.join(installed.directory, 'BiliDesk.exe');
      fs.writeFileSync(path.join(installed.directory, 'user-note.txt'), 'preserve-me');
      fs.appendFileSync(clientExecutable, 'tamper');
      assert.equal(await cdp.evaluate('window.alleyDesktop.biliDeskStatus().then(result => result.damaged)'), true, 'Tampering was not detected.');
      await cdp.evaluate("document.querySelector('[data-bili=repair]').click()");
      await waitFor(cdp, "document.querySelector('[data-bili-status]').textContent.includes('旧程序已完整保存在')", 'BiliDesk repair did not preserve a backup.', 180000);
      const backups = fs.readdirSync(path.dirname(installed.directory)).filter(name => name.startsWith('backup-'));
      assert.ok(backups.some(name => fs.existsSync(path.join(path.dirname(installed.directory), name, 'user-note.txt'))), 'Repair backup lost unknown user files.');

      await cdp.evaluate("document.querySelector('[data-bili=launch]').click()");
      await waitFor(cdp, "document.querySelector('[data-bili-status]').textContent.includes('已发送启动请求')", 'BiliDesk launch request failed.');
      const deadline = Date.now() + 30000;
      let pids = [];
      while (Date.now() < deadline && pids.length === 0) { pids = clientPids(clientExecutable); if (!pids.length) await sleep(250); }
      assert.ok(pids.length > 0, 'BiliDesk process did not remain running after launch.');
      console.log('BILIDESK_EXECUTABLE=' + clientExecutable);
      console.log('BILIDESK_PROFILE=' + path.join(userData, 'bilidesk-preview-profile'));
    }

    await sleep(900);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.join(root, '.work/bilidesk-qa'), { recursive: true });
    fs.writeFileSync(path.join(root, '.work/bilidesk-qa/rain-alley.png'), Buffer.from(screenshot.data, 'base64'));
    assert.deepEqual(errors, [], 'Renderer exceptions occurred.');
    console.log(uiOnly
      ? 'PASS: BiliDesk catalog page, resource status, responsive layout, icon, and no renderer errors.'
      : 'PASS: BiliDesk catalog page, full payload install, integrity detection, backup-preserving repair, native process launch, and no renderer errors.');
    if (preview) {
      keepPreview = true;
      app.unref();
      console.log(`PREVIEW=${appRoot}; PID=${app.pid}; CDP=${port}`);
    }
  } finally {
    socket?.close();
    if (clientExecutable) {
      for (const pid of clientPids(clientExecutable)) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    }
    if (!keepPreview) {
      if (app.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      await sleep(1500);
      try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 30, retryDelay: 500 }); }
      catch (error) {
        if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error;
        console.warn('TEMP_CLEANUP_PENDING=' + base);
      }
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
