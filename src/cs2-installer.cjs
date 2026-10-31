const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { owned, retainedRuntime } = require('./cs2-ownership.cjs');

const INSTALL_ENTRIES = ['addons', 'cfg', 'gameinfo.gi', 'overrides', 'Panel v1.4.7.exe'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function retryBusy(operation) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); } catch (error) {
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code) || attempt >= 4) throw error;
      await sleep(150 * (attempt + 1));
    }
  }
}
async function exists(file, io) { try { await io.lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
function extractArchive(archive, stage) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar.exe', ['-xf', archive, '-C', stage], { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('官方 ZIP 解压失败。')));
  });
}

// A committed install must never roll back because antivirus/Windows still holds
// an extracted DLL open. Rollback storage lives outside the extraction directory.
async function installOfficialPayload({ root, archive, keepBackup, io = fs, extract = extractArchive, entries = INSTALL_ENTRIES, preserveBot = false }) {
  const stage = await io.mkdtemp(path.join(os.tmpdir(), 'rain-alley-cs2-'));
  const rollback = path.join(root, `.rain-alley-${keepBackup ? 'backup' : 'rollback'}-${crypto.randomUUID()}`);
  const journal = { root, archive, phase: 'preparing', moved: [], installed: [], created: [] };
  const journalPath = path.join(rollback, 'rain-alley-transaction.json');
  const record = () => io.writeFile(journalPath, JSON.stringify(journal, null, 2), 'utf8');
  async function assertAncestors(target) {
    let current = path.parse(target).root;
    for (const part of path.relative(current, target).split(path.sep)) {
      current = path.join(current, part);
      if (!await exists(current, io)) break;
      if ((await io.lstat(current)).isSymbolicLink()) throw new Error('插件路径包含链接或目录联接。');
    }
  }
  async function cleanup(directory) {
    try { await io.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); return null; }
    catch { return directory; }
  }
  async function moveOld(relative) {
    const source = path.join(root, relative);
    await assertAncestors(source);
    if (!await exists(source, io)) return;
    const target = path.join(rollback, relative);
    await io.mkdir(path.dirname(target), { recursive: true });
    await retryBusy(() => io.rename(source, target));
    journal.moved.push(relative); await record();
  }
  async function copyTree(source, relative) {
    const target = path.join(root, relative);
    await assertAncestors(target);
    const info = await io.lstat(source);
    if (info.isSymbolicLink()) throw new Error('安装文件包含不支持的链接。');
    if (!info.isDirectory()) {
      if (relative.replaceAll('\\', '/').toLowerCase().startsWith('addons/counterstrikesharp/configs/') && await exists(target, io)) return;
      if (await exists(target, io)) await moveOld(relative);
      // Record before copy: a failed write can leave a partial destination.
      journal.installed.push(relative); await record();
      await retryBusy(() => io.copyFile(source, target)); return;
    }
    if (await exists(target, io)) {
      const targetInfo = await io.lstat(target);
      if (targetInfo.isSymbolicLink()) throw new Error('游戏插件路径是链接，请选择实际游戏目录。');
      if (!targetInfo.isDirectory()) await moveOld(relative);
    }
    if (!await exists(target, io)) { await io.mkdir(target, { recursive: true }); journal.created.push(relative); }
    for (const entry of await io.readdir(source)) await copyTree(path.join(source, entry), path.join(relative, entry));
  }
  try {
    await extract(archive, stage);
    for (const name of entries) if (!await exists(path.join(stage, name), io)) throw new Error('官方 ZIP 缺少所需文件，未开始安装。');
    // Validate the destination root before touching plugin files.
    await assertAncestors(root);
    if ((await io.lstat(root)).isSymbolicLink()) throw new Error('请选择实际游戏目录。');
    await io.mkdir(rollback); await record();
    // Walk nested CSS plugins too; companion ownership is independent of UI flags.
    const allowed = new Set();
    async function collect(dir, prefix = '') {
      for (const item of await io.readdir(dir, { withFileTypes: true })) {
        const rel = path.posix.join(prefix, item.name);
        if (item.isSymbolicLink()) throw new Error('安装资源包含链接。');
        if (item.isDirectory()) await collect(path.join(dir, item.name), rel);
        else allowed.add(rel.toLowerCase());
      }
    }
    await collect(stage);
    async function clean(dir, prefix) {
      if (!await exists(dir, io)) return;
      await assertAncestors(dir);
      for (const item of await io.readdir(dir, { withFileTypes: true })) {
        const rel = path.posix.join(prefix, item.name);
        if (item.isSymbolicLink()) throw new Error('插件路径包含链接或目录联接。');
        if (item.isDirectory()) {
          await clean(path.join(dir, item.name), rel);
          await io.rmdir(path.join(dir, item.name)).catch(error => { if (!['ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; });
        }
        else if (!allowed.has(rel.toLowerCase()) && !owned(rel) && !retainedRuntime(rel)) await moveOld(rel);
      }
    }
    await clean(path.join(root, 'addons'), 'addons');
    if (entries.includes('gameinfo.gi') && await exists(path.join(root, 'gameinfo.gi'), io)) {
      await assertAncestors(path.join(root, 'gameinfo.gi'));
      let current = await io.readFile(path.join(root, 'gameinfo.gi'), 'utf8');
      if (/SearchPaths\s*\{/i.test(current)) {
        const paths = ['csgo/addons/metamod'];
        if (!preserveBot) paths.unshift('csgo/overrides/botprofile.vpk');
        for (const entry of paths) if (!current.toLowerCase().includes(entry)) current = current.replace(/(SearchPaths\s*\{)/i, '$1\n\t\t\tGame\t' + entry);
        await io.writeFile(path.join(stage, 'gameinfo.gi'), current);
      } else if (preserveBot) throw new Error('gameinfo.gi 缺少 SearchPaths，无法安全启用插件。');
    }
    journal.phase = 'installing'; await record();
    for (const name of entries) await copyTree(path.join(stage, name), name);
    journal.phase = 'committed'; await record();
  } catch (cause) {
    const failures = [];
    for (const relative of [...journal.installed].reverse()) {
      try { await retryBusy(() => io.rm(path.join(root, relative), { force: true })); } catch { failures.push(relative); }
    }
    for (const relative of [...journal.created].reverse()) await io.rmdir(path.join(root, relative)).catch(() => {});
    for (const relative of [...journal.moved].reverse()) {
      try { await io.mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await retryBusy(() => io.rename(path.join(rollback, relative), path.join(root, relative))); }
      catch { failures.push(relative); }
    }
    const pendingStage = await cleanup(stage);
    // Never delete a backup that failed to restore. This also applies when the
    // player declined persistent backups: their original files take precedence.
    if (failures.length) {
      journal.phase = 'recovery-needed'; journal.failures = failures; await record().catch(() => {});
      throw new Error(`安装未完成，部分文件仍被占用。原文件与恢复记录已保留在：${rollback}。请关闭 CS2 和 Panel 后重试。`);
    }
    await cleanup(rollback);
    const detail = ['EBUSY', 'EPERM', 'EACCES'].includes(cause.code) ? '文件正在被占用，请关闭 CS2 和 Panel，等待安全软件扫描结束后重试。' : cause.message;
    throw new Error(`安装未完成，已恢复原文件。${detail}${pendingStage ? ` 临时目录待清理：${pendingStage}` : ''}`);
  }
  // Cleanup is outside the transaction. Locked staging DLLs do not undo success.
  const cleanupPending = [await cleanup(stage)];
  if (!keepBackup) cleanupPending.push(await cleanup(rollback));
  return { installed: true, directory: root, backup: keepBackup ? rollback : null, cleanupPending: cleanupPending.filter(Boolean) };
}
module.exports = { installOfficialPayload, INSTALL_ENTRIES, extractArchive };
