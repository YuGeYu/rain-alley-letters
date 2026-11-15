const bundledFs = require('node:fs/promises');
// Electron treats *.asar as virtual directories. Managed client files must be
// hashed, moved and removed as physical bytes, including a second app.asar.
const fs = process.versions.electron ? require('original-fs').promises : bundledFs;
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function renameDirectory(source, destination) {
  // Windows scanners can briefly hold newly extracted EXEs/DLLs open. Keep
  // the atomic rename and rollback semantics; never copy over an old install.
  for (let attempt = 0; ; attempt++) {
    try { return await fs.rename(source, destination); }
    catch (error) {
      if (attempt >= 19 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(1000, 100 * (attempt + 1))));
    }
  }
}

function createManager({ root, assets, manifest, profile, launcher, archiveProvider, client = 'BiliDesk', profileEnv = 'RAIN_ALLEY_BILIDESK_PROFILE', defaultProfile }) {
  root = path.resolve(root);
  const current = path.join(root, 'current');
  const executable = path.join(current, client + '.exe');
  let busy = false;
  async function safeRoot() {
    // Reject junctions at every existing ancestor, including the managed root.
    for (let node = root; ; node = path.dirname(node)) {
      const stat = await fs.lstat(node).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
      if (stat?.isSymbolicLink()) throw new Error('安装目录包含链接，请先恢复普通文件夹。');
      if (path.dirname(node) === node) break;
    }
    await fs.mkdir(root, { recursive: true });
  }
  function relative(name) {
    if (typeof name !== 'string' || !name || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..' || p.includes(':')) || path.isAbsolute(name)) throw new Error('客户端文件清单无效。');
    return name;
  }
  async function filesIn(dir, prefix = '') {
    const result = [];
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const name = prefix + item.name;
      if (item.isSymbolicLink()) throw new Error('客户端目录中存在链接，已停止操作。');
      if (item.isDirectory()) result.push(...await filesIn(path.join(dir, item.name), name + '/'));
      else if (item.isFile()) result.push(name);
      else throw new Error('客户端目录中存在特殊文件。');
    }
    return result;
  }
  async function verify(dir, exact = false) {
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('客户端目录无效。');
    const found = await filesIn(dir);
    if (exact && found.some(name => !Object.hasOwn(manifest.files, name))) throw new Error('安装包中包含清单外文件。');
    const names = Object.keys(manifest.files);
    // Bounded concurrency avoids hundreds of simultaneous file descriptors.
    for (let i = 0; i < names.length; i += 12) await Promise.all(names.slice(i, i + 12).map(async name => {
      relative(name);
      if (digest(await fs.readFile(path.join(dir, name))) !== manifest.files[name]) throw new Error('客户端文件不完整，请修复安装。');
    }));
  }
  async function status() {
    await safeRoot();
    const available = !!manifest.archiveSha256 && Object.keys(manifest.files || {}).length > 0;
    const present = await fs.lstat(current).then(() => true, e => { if (e.code !== 'ENOENT') throw e; return false; });
    let healthy = false;
    if (present && available) healthy = await verify(current).then(() => true, () => false);
    return { available, external: Boolean(archiveProvider), installed: healthy, damaged: present && !healthy, version: manifest.version, directory: current, profile: profile || defaultProfile || path.join(process.env.LOCALAPPDATA || '', client), size: manifest.unpackedBytes || 0, archiveBytes: manifest.archiveBytes || 0 };
  }
  async function exclusive(task) {
    if (busy) throw new Error(client + ' 正在处理上一个操作，请稍候。');
    busy = true;
    try { await safeRoot(); return await task(); } finally { busy = false; }
  }
  async function assertClosed() {
    const ps = "$ErrorActionPreference='Stop'; $target='" + executable.replaceAll("'", "''") + "'; if(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target }){exit 9}";
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }).catch(e => { throw new Error('请先从 ' + client + ' 托盘菜单退出客户端，再进行安装或卸载。'); });
  }
  async function backupCurrent() {
    const stat = await fs.lstat(current).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (!stat) return null;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('客户端目录不是普通文件夹，已停止操作。');
    // Preserve the entire old directory, including unknown or modified files.
    const backup = path.join(root, 'backup-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
    await renameDirectory(current, backup);
    return backup;
  }
  const install = () => exclusive(async () => {
    if (!(await status()).available) throw new Error('此预览尚未包含客户端资源，请等待资源构建完成。');
    await assertClosed();
    const selectedArchive = archiveProvider ? await archiveProvider() : path.join(assets, client + '-win-x64.zip');
    if (!selectedArchive) return { cancelled: true };
    const stage = await fs.mkdtemp(path.join(root, '.stage-'));
    const zip = stage + '.zip';
    let backup;
    try {
      const bytes = await bundledFs.readFile(selectedArchive);
      if (digest(bytes) !== manifest.archiveSha256) throw new Error('客户端安装包校验失败。');
      await fs.writeFile(zip, bytes, { flag: 'wx' });
      const { stdout } = await run('tar.exe', ['-tf', zip], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      const entries = stdout.split(/\r?\n/).filter(Boolean).map(relative);
      if (entries.length !== Object.keys(manifest.files).length || new Set(entries.map(n => n.toLowerCase())).size !== entries.length || entries.some(n => !Object.hasOwn(manifest.files, n))) throw new Error('安装包路径清单校验失败。');
      await run('tar.exe', ['-xf', zip, '-C', stage], { windowsHide: true });
      await verify(stage, true);
      backup = await backupCurrent();
      try { await renameDirectory(stage, current); } catch (e) { if (backup) await renameDirectory(backup, current); throw e; }
      return { ...await status(), backup };
    } finally { await fs.rm(zip, { force: true }); await fs.rm(stage, { force: true, recursive: true, maxRetries: 6, retryDelay: 250 }); }
  });
  const launch = () => exclusive(async () => {
    if (!(await status()).installed) throw new Error('请先安装或修复 ' + client + '。');
    const env = { ...process.env };
    delete env[profileEnv];
    if (profile) env[profileEnv] = profile;
    if (launcher) await launcher(executable, env);
    else await new Promise((resolve, reject) => {
      const child = spawn(executable, [], { cwd: current, env, detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
    });
    return { launched: true };
  });
  const uninstall = () => exclusive(async () => { await assertClosed(); const backup = await backupCurrent(); return { ...await status(), backup }; });
  return { status, install, launch, uninstall, verify, directory: current, root };
}
module.exports = { createManager };
