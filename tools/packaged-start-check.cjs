const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'release', 'win-unpacked');
const executable = path.join(appDir, '雨巷来信.exe');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForTarget(port, processRef) {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) throw new Error(`Packaged app exited during startup (${processRef.exitCode}).`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const page = (await response.json()).find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch (error) { lastError = error; }
    await sleep(200);
  }
  throw new Error(`Packaged app DevTools did not become available: ${lastError?.message || 'timeout'}`);
}

async function main() {
  assert.ok(fs.existsSync(executable), `Packaged executable is missing: ${executable}`);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-alley-packaged-smoke-'));
  const port = await freePort();
  const processRef = spawn(executable, [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${userData}`,
  ], {
    cwd: appDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, RAIN_ALLEY_TEST_MODE: '1' },
  });
  let output = '';
  processRef.stdout.on('data', (chunk) => { output += chunk.toString(); });
  processRef.stderr.on('data', (chunk) => { output += chunk.toString(); });
  let socket;
  try {
    const target = await waitForTarget(port, processRef);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('Could not connect to packaged app DevTools.')), { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      let message;
      try { message = JSON.parse(data); } catch { return; }
      if (!message.id || !pending.has(message.id)) return;
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || 'DevTools command failed'));
      else resolve(message.result || {});
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`DevTools timed out: ${method}`));
      }, 15000).unref?.();
    });
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    };
    await send('Page.enable');
    await send('Runtime.enable');
    const deadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await evaluate("Boolean(document.querySelector('#authScreen') && !document.querySelector('#authScreen').hidden)").catch(() => false);
      if (ready) break;
      await sleep(100);
    }
    assert.ok(ready, 'The packaged app did not reach the first-run authentication screen.');
    // First-run registration is one-click, so inspect its current notice and action instead of a removed username field.
    const screen = await evaluate(`(() => ({
      title: document.title,
      authVisible: !document.querySelector('#authScreen').hidden,
      registerVisible: !document.querySelector('#registerForm').hidden,
      authLedeFont: getComputedStyle(document.querySelector('.auth-lede')).fontSize,
      privacyNoteFont: getComputedStyle(document.querySelector('.privacy-note')).fontSize,
      registerButtonFont: getComputedStyle(document.querySelector('#registerSubmit')).fontSize,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      pageBackground: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      storedAccount: window.alleyDesktop.getState().then((state) => state.username),
    }))()`);
    assert.ok(screen.title.includes('雨巷来信'), 'Packaged app title is incorrect.');
    assert.ok(screen.authVisible && screen.registerVisible, 'The first-run register screen is not visible.');
    assert.equal(screen.authLedeFont, '14px', `Packaged authentication description is too small: ${screen.authLedeFont}.`);
    assert.equal(screen.privacyNoteFont, '14px', `Packaged privacy notice is too small: ${screen.privacyNoteFont}.`);
    assert.equal(screen.registerButtonFont, '14px', `Packaged register button text is too small: ${screen.registerButtonFont}.`);
    assert.equal(screen.pageBackground, '#000000', 'Packaged default theme is not pure black.');
    assert.equal(await evaluate('window.alleyDesktop.getState().then((state) => state.username)'), null, 'The isolated first-run profile unexpectedly contains an account.');
    const exited = new Promise((resolve) => processRef.once('exit', resolve));
    void evaluate('window.alleyDesktop.quit()').catch(() => {});
    await Promise.race([
      exited,
      sleep(12000).then(() => { throw new Error('Timed out waiting for the packaged app to exit.'); }),
    ]);
    socket.close();
    console.log('packaged start ok: first-run authentication, input readability, neutral black theme, and isolated user data.');
  } catch (error) {
    try { socket?.close(); } catch {}
    if (processRef.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(processRef.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    throw new Error(`${error.message}\nPackaged app output:\n${output.slice(-4500)}`);
  } finally {
    try { fs.rmSync(userData, { recursive: true, force: true }); }
    catch (error) { console.error(`Temporary packaged test data remain at ${userData}: ${error.message}`); }
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
