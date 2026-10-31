const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

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
async function installOfficialPayload({ root, archive, keepBackup, io = fs, extract = extractArchive }) {
  const stage = await io.mkdtemp(path.join(os.tmpdir(), 'rain-alley-cs2-'));
  const rollback = path.join(root, `.rain-alley-${keepBackup ? 'backup' : 'rollback'}-${crypto.randomUUID()}`);
  const journal = { root, archive, phase: 'preparing', moved: [], installed: [], created: [] };
  const journalPath = path.join(rollback, 'rain-alley-transaction.json');
  const record = () => io.writeFile(journalPath, JSON.stringify(journal, null, 2), 'utf8');
  async function cleanup(directory) {
    try { await io.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); return null; }
    catch { return directory; }
  }
  async function moveOld(relative) {
    const source = path.join(root, relative);
    if (!await exists(source, io)) return;
    const target = path.join(rollback, relative);
    await io.mkdir(path.dirname(target), { recursive: true });
    await retryBusy(() => io.rename(source, target));
    journal.moved.push(relative); await record();
  }
  async function copyTree(source, relative) {
    const target = path.join(root, relative);
    const info = await io.lstat(source);
    if (info.isSymbolicLink()) throw new Error('安装文件包含不支持的链接。');
    if (!info.isDirectory()) {
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
    for (const name of INSTALL_ENTRIES) if (!await exists(path.join(stage, name), io)) throw new Error('官方 ZIP 缺少所需文件，未开始安装。');
    // Validate the destination root before touching plugin files.
    if ((await io.lstat(root)).isSymbolicLink()) throw new Error('请选择实际游戏目录。');
    await io.mkdir(rollback); await record();
    const targetAddons = path.join(root, 'addons');
    const official = new Set((await io.readdir(path.join(stage, 'addons'))).map((name) => name.toLowerCase()));
    if (await exists(targetAddons, io)) {
      if ((await io.lstat(targetAddons)).isSymbolicLink()) throw new Error('addons 是链接，请先检查游戏目录。');
      const entries = await io.readdir(targetAddons, { withFileTypes: true });
      for (const entry of entries) if (entry.isDirectory() && !official.has(entry.name.toLowerCase())) await moveOld(path.join('addons', entry.name));
    }
    journal.phase = 'installing'; await record();
    for (const name of INSTALL_ENTRIES) await copyTree(path.join(stage, name), name);
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
module.exports = { installOfficialPayload, INSTALL_ENTRIES };
