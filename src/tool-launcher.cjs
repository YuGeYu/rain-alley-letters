const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
// Claim synchronously before the first await. The OS check also catches tools
// started from Explorer; child lifetime tracking closes the startup race.
function createToolLauncher({ list = listProcesses, start = spawn, now = Date.now } = {}) {
  const active = new Map();
  function assertClosed(pattern, label) {
    if (list().some(name => pattern.test(name))) throw new Error(`${label}已经运行，请使用已打开的窗口。`);
  }
  async function launch(key, target, pattern, label) {
    if (active.has(key)) throw new Error(`${label}正在启动或运行，请使用已打开的窗口。`);
    const claim = {}; active.set(key, claim);
    try {
      assertClosed(pattern, label);
      await new Promise((resolve, reject) => {
        const child = start(target, [], { cwd: path.dirname(target), detached: true, stdio: 'ignore', windowsHide: false });
        claim.child = child;
        child.once('error', () => { if (active.get(key) === claim) active.delete(key); reject(new Error(`${label}无法启动，请检查文件位置与权限。`)); });
        child.once('exit', () => { if (active.get(key) === claim) active.delete(key); });
        child.once('spawn', () => { child.unref(); resolve(true); });
      });
      return true;
    } catch (cause) { if (active.get(key) === claim) active.delete(key); throw cause; }
  }
  let gameUntil = 0;
  async function launchGame(open, url) {
    if (gameUntil > now()) throw new Error('CS2 正在启动，请稍候，不必重复点击。');
    assertClosed(/^cs2\.exe$/i, 'CS2');
    gameUntil = now() + 15000;
    try { await open(url); return true; } catch (cause) { gameUntil = 0; throw cause; }
  }
  return { launch, launchGame, assertClosed };
}
function listProcesses() {
  const result = spawnSync('tasklist.exe', ['/FO','CSV','/NH'], { encoding:'utf8', windowsHide:true, timeout:5000 });
  if (result.error || result.status !== 0) throw new Error('暂时无法确认工具运行状态，请稍后重试。');
  return result.stdout.split(/\r?\n/).map(line => /^"([^"]+)"/.exec(line)?.[1]).filter(Boolean);
}
module.exports = { createToolLauncher };
