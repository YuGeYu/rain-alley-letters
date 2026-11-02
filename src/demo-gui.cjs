const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const manifest = require('./demo-payload-manifest.json');
const executable = 'cs2-demotracer-gui.exe';
const launcher = require('./tool-launcher.cjs').createToolLauncher();
async function findGui(record, localAppData) {
  const candidates = [];
  try { candidates.push(JSON.parse(await fs.readFile(record, 'utf8')).executable); } catch {}
  candidates.push(path.join(localAppData, 'Programs', 'DemoTracer', executable), path.join(localAppData, 'DemoTracer', executable));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'DemoTracer' } | ForEach-Object { if ($_.InstallLocation) { $_.InstallLocation } }"], { encoding: 'utf8', windowsHide: true });
  for (const directory of (result.stdout || '').split(/\r?\n/).filter(Boolean)) candidates.push(path.join(directory.trim(), executable));
  for (const candidate of candidates) if (typeof candidate === 'string' && path.isAbsolute(candidate) && path.basename(candidate).toLowerCase() === executable) {
    try { if ((await fs.stat(candidate)).isFile()) return candidate; } catch {}
  }
  return null;
}
async function rememberGui(record, target) {
  if (path.basename(target).toLowerCase() !== executable || !(await fs.stat(target)).isFile()) throw new Error('请选择安装后的 cs2-demotracer-gui.exe，不要选择安装包。');
  await fs.mkdir(path.dirname(record), { recursive: true }); await fs.writeFile(record, JSON.stringify({ executable: target })); return target;
}
async function installGui(installer, destination, record) {
  const digest = crypto.createHash('sha256').update(await fs.readFile(installer)).digest('hex');
  if (digest !== manifest.guiSha256) throw new Error('请选择官方 demotracer-gui-v1.6.6.exe 安装包，文件校验未通过。');
  // NSIS /D must be last. Remember the installed application, never setup.
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'alley-demo-gui-setup-'));
  try {
    const localInstaller = path.join(staging, 'demotracer-gui-v1.6.6.exe');
    await fs.copyFile(installer, localInstaller);
    if (crypto.createHash('sha256').update(await fs.readFile(localInstaller)).digest('hex') !== manifest.guiSha256) throw new Error('安装程序副本校验失败。');
    await new Promise((resolve, reject) => {
      const child = spawn(localInstaller, ['/S', '/D=' + destination], { windowsHide: true, stdio: 'ignore' });
      child.once('error', () => reject(new Error('Windows 未允许启动 GUI 安装程序。请手动安装官方包，再使用“定位已安装程序”。')));
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('GUI 安装未完成，退出码：' + code)));
    });
  } finally { await fs.rm(staging, { recursive: true, force: true, maxRetries: 5 }).catch(() => {}); }
  return rememberGui(record, path.join(destination, executable));
}
async function launchGui(target) {
  return launcher.launch('demo-gui', target, /^cs2-demotracer-gui\.exe$/i, 'DemoTracer');
}
// Only the official NSIS uninstaller beside the validated GUI is eligible.
// Never recursively delete the install folder: it may contain user replays.
async function uninstallGui(target, record, run = runUninstaller) {
  const directory = path.dirname(target);
  if (path.basename(target).toLowerCase() !== executable || !(await fs.lstat(target)).isFile()) throw new Error('无法确认 GUI 程序位置，请重新定位。');
  const uninstaller = path.join(directory, 'uninstall.exe');
  const info = await fs.lstat(uninstaller).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error('未找到官方卸载程序，请在 Windows 设置 → 应用中卸载 DemoTracer。');
  await run(uninstaller, directory);
  try { await fs.access(target); } catch {
    await fs.rm(record, { force: true }); return { removed: true };
  }
  return { removed: false };
}
function runUninstaller(file, directory) {
  return new Promise((resolve, reject) => {
    // _?= runs NSIS in place so waiting for exit also waits for the real uninstall.
    const child = spawn(file, ['_?=' + directory], { cwd: directory, windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('GUI 卸载未完成，退出码：' + code)));
  });
}
module.exports = { findGui, rememberGui, installGui, launchGui, uninstallGui };
