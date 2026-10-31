// All game files and the account fixture live in a disposable test directory.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createTestApp, freePort, waitForTarget, connectCdp, waitFor } = require('./cs2-install-runtime-check.cjs');
const root = path.resolve(__dirname, '..');
const preview = process.argv.includes('--preview');
async function run() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-alley-uninstall-ui-'));
  const appRoot = createTestApp(base);
  const csgo = path.join(base, 'game', 'csgo'); fs.mkdirSync(csgo, { recursive: true });
  const archive = process.env.CS2_BOT_IMPROVER_ARCHIVE || 'E:/dow/CS2BotImprover.zip';
  assert.ok(fs.existsSync(archive), 'Set CS2_BOT_IMPROVER_ARCHIVE to the official release ZIP.');
  assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), require('../src/cs2-payload-manifest.json').archiveSha256, 'Official archive hash mismatch');
  const extracted = spawnSync('tar.exe', ['-xf', archive, '-C', csgo], { windowsHide: true });
  assert.equal(extracted.status, 0, 'Official archive extraction failed');
  fs.mkdirSync(path.join(csgo, 'addons', 'PlayerPlugin'), { recursive: true });
  fs.writeFileSync(path.join(csgo, 'addons', 'PlayerPlugin', 'keep.txt'), 'player data');
  const profile = path.join(base, 'profile'); fs.mkdirSync(profile);
  const downloads = path.join(base, 'downloads'); fs.mkdirSync(downloads);
  fs.writeFileSync(path.join(profile, 'preferences.json'), JSON.stringify({ downloadDirectory: downloads, cs2Directory: csgo }));
  const port = await freePort();
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const proc = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [appRoot, '--remote-debugging-port=' + port, '--remote-allow-origins=*', '--user-data-dir=' + profile], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env });
  let output = ''; proc.stdout.on('data', c => output += c); proc.stderr.on('data', c => output += c);
  let socket;
  let previewReady = false;
  try {
    const target = await waitForTarget(port, proc); socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const cdp = connectCdp(socket);
    await waitFor(cdp, "document.body.dataset.page === 'scene'", 'No home page');
    assert.ok((await cdp.evaluate('window.alleyDesktop.getOpenSourceNotices()')).includes('PolyForm Strict'));
    await cdp.evaluate("document.querySelector('#appAddressInput').value='rainalley://app/feature/cs2-bots';document.querySelector('#addressForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
    await waitFor(cdp, "Boolean(document.querySelector('#uninstallCs2Package'))", 'No uninstall entry');
    await cdp.evaluate(`document.querySelector('#cs2Directory').value=${JSON.stringify(csgo)}`);
    const click = async label => cdp.evaluate(`[...document.querySelectorAll('.cs2-modal-actions button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);
    await cdp.evaluate("document.querySelector('#uninstallCs2Package').click()");
    await click('取消卸载');
    assert.ok(fs.existsSync(path.join(csgo, 'Panel v1.4.7.exe')));
    await cdp.evaluate("document.querySelector('#uninstallCs2Package').click()");
    await click('保留配置'); await click('保留运行库');
    await waitFor(cdp, "document.querySelector('#cs2ModalTitle')?.textContent==='确认卸载人机增强？'", 'No scan confirmation');
    assert.equal(await cdp.evaluate("document.activeElement.textContent"), '取消卸载');
    fs.mkdirSync(path.join(root, 'release'), { recursive: true });
    for (const theme of ['dark', 'light']) {
      await cdp.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      const shot = await cdp.send('Page.captureScreenshot');
      fs.writeFileSync(path.join(root, 'release', `preview-cs2-uninstall-${theme}.png`), Buffer.from(shot.data, 'base64'));
    }
    await cdp.evaluate("document.documentElement.dataset.theme='dark'");
    if (preview) {
      previewReady = true;
      socket.close(); proc.unref(); proc.stdout.destroy(); proc.stderr.destroy();
      console.log(JSON.stringify({ preview: true, pid: proc.pid, directory: base, note: 'Isolated account and temporary game files. No real game data is modified.' }));
      return;
    }
    await click('取消卸载');
    assert.ok(fs.existsSync(path.join(csgo, 'Panel v1.4.7.exe')));
    await cdp.evaluate("document.querySelector('#uninstallCs2Package').click()"); await click('保留配置'); await click('保留运行库');
    await waitFor(cdp, "document.querySelector('#cs2ModalTitle')?.textContent==='确认卸载人机增强？'", 'No confirmation');
    await click('确认卸载');
    await waitFor(cdp, "document.querySelector('#cs2UninstallResult')?.textContent.includes('恢复备份')", 'Uninstall failed', 60000);
    assert.ok(!fs.existsSync(path.join(csgo, 'Panel v1.4.7.exe')));
    assert.ok(!fs.existsSync(path.join(csgo, 'addons/BotVision/bin/win64/BotVision.dll')));
    assert.ok(!fs.existsSync(path.join(csgo, 'addons/counterstrikesharp/plugins/BotAI/BotAI.dll')));
    assert.ok(fs.existsSync(path.join(csgo, 'addons/counterstrikesharp/api/CounterStrikeSharp.API.dll')));
    assert.ok(fs.existsSync(path.join(csgo, 'cfg/my_bot_normal_config.cfg')));
    assert.equal(fs.readFileSync(path.join(csgo, 'addons/PlayerPlugin/keep.txt'), 'utf8'), 'player data');
    assert.ok(!fs.readFileSync(path.join(csgo, 'gameinfo.gi'), 'utf8').includes('csgo/overrides/botprofile.vpk'));
    assert.equal(await cdp.evaluate("document.querySelector('#detailStatus').textContent"), '已卸载');
    console.log('CS2 uninstall runtime passed: official ZIP, cancel, choices, scan, confirmation, real IPC, archive backup, shared/config/custom-file retention, dark/light screenshots.');
  } catch (cause) { throw new Error(cause.stack + '\n' + output.slice(-3000)); }
  finally {
    socket?.close();
    if (!previewReady) {
      if (proc.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (error) { console.warn('Temporary preview cleanup pending: ' + base + ': ' + error.message); }
    }
  }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
