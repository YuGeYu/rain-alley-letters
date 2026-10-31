const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('./cs2-payload-manifest.json');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const pluginNames = new Set(['BotAI', 'BotAimImprover', 'BotBuy', 'BotControllerImpl', 'BotHiderImpl', 'BotRandomizer', 'BotState', 'NadeSystem', 'RoundDamageRecap'].map(n => n.toLowerCase()));
function shared(relative) {
  const p = relative.toLowerCase();
  if (p.startsWith('addons/counterstrikesharp/plugins/')) return !pluginNames.has(p.split('/')[3]);
  return p.startsWith('addons/counterstrikesharp/') || p.startsWith('addons/metamod/') || (p.startsWith('addons/metamod') && p.endsWith('.vdf') && p.split('/').length === 2);
}
async function stat(file, io) {
  try { return await io.lstat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
// Reject junctions at every ancestor, not only at the final file. Uninstall never
// traverses a player-created link or recursively deletes an addon directory.
async function checked(root, relative, io = fs) {
  const target = path.resolve(root, relative);
  if (!relative || path.isAbsolute(relative) || path.relative(root, target).startsWith('..')) throw new Error('卸载清单路径无效。');
  let current = path.parse(root).root;
  for (const part of path.relative(current, target).split(path.sep)) {
    current = path.join(current, part);
    const info = await stat(current, io);
    if (!info) return null;
    if (info.isSymbolicLink()) throw new Error('插件路径包含链接或目录联接。为保护其他文件，请选择实际游戏目录。');
    if (current === target) return info;
    if (!info.isDirectory()) throw new Error('插件目录结构异常，请检查所选目录。');
  }
  return null;
}
function cleanGameinfo(text, removeShared) {
  // Preserve the current Valve file and all unrelated search paths. Never copy
  // an old upstream gameinfo.gi over a file updated by Steam.
  return text.replace(/^[ \t]*"?Game"?[ \t]+"?csgo[\/](overrides[\/]botprofile\.vpk|addons[\/]metamod)"?[ \t]*(?:\/\/[^\r\n]*)?(?:\r?\n|$)/gim, (line, entry) => entry.toLowerCase().startsWith('addons') && !removeShared ? line : '');
}
async function inspectUninstall({ root, removeShared = false, keepConfig = true, io = fs }) {
  if (!path.isAbsolute(root) || path.basename(root).toLowerCase() !== 'csgo' || path.basename(path.dirname(root)).toLowerCase() !== 'game') throw new Error('请选择 CS2 的 game\\csgo 目录。');
  const gameinfo = await checked(root, 'gameinfo.gi', io);
  if (!gameinfo?.isFile()) throw new Error('未找到 gameinfo.gi，请重新选择游戏目录。');
  const files = [];
  let changed = 0, retainedShared = 0, retainedConfig = 0;
  for (const item of manifest.files) {
    if (item.path === 'gameinfo.gi') continue;
    const info = await checked(root, item.path, io);
    if (!info) continue;
    if (!info.isFile()) throw new Error(`插件文件结构异常：${item.path}`);
    if (!removeShared && shared(item.path)) { retainedShared++; continue; }
    if (keepConfig && (item.path.startsWith('cfg/') || /(?:config|bot_info|map_whitelist|charm_placements).*\.json$/i.test(item.path))) { retainedConfig++; continue; }
    const digest = hash(await io.readFile(path.join(root, item.path)));
    if (digest !== item.sha256) changed++;
    files.push({ path: item.path, digest });
  }
  const original = await io.readFile(path.join(root, 'gameinfo.gi'));
  const cleaned = Buffer.from(cleanGameinfo(original.toString('utf8'), removeShared));
  const editGameinfo = !original.equals(cleaned);
  const fingerprint = hash(JSON.stringify({ root, removeShared, keepConfig, files, gameinfo: hash(original) }));
  return { root, removeShared, keepConfig, files, changed, retainedShared, retainedConfig, editGameinfo, gameinfoDigest: hash(original), fingerprint };
}
async function uninstallPayload({ root, removeShared = false, keepConfig = true, fingerprint, io = fs }) {
  const plan = await inspectUninstall({ root, removeShared, keepConfig, io });
  if (!fingerprint || fingerprint !== plan.fingerprint) throw new Error('文件在预览后发生变化，请重新扫描并确认卸载。');
  if (!plan.files.length && !plan.editGameinfo) return { removed: 0, backup: null, directory: root };
  const backup = path.join(root, `.rain-alley-uninstall-${crypto.randomUUID()}`);
  const journal = { phase: 'preparing', root, removeShared, moved: [], gameinfoEdited: false };
  await io.mkdir(backup);
  const record = () => io.writeFile(path.join(backup, 'rain-alley-uninstall.json'), JSON.stringify(journal, null, 2));
  const original = await io.readFile(path.join(root, 'gameinfo.gi'));
  try {
    await record();
    // Originals remain in a recovery folder even after success. Moving only
    // manifest files also keeps custom files and generated configuration intact.
    for (const item of plan.files) {
      await checked(root, item.path, io);
      if (hash(await io.readFile(path.join(root, item.path))) !== item.digest) throw new Error('插件文件已改变，请重新扫描。');
      await io.mkdir(path.dirname(path.join(backup, item.path)), { recursive: true });
      await io.rename(path.join(root, item.path), path.join(backup, item.path));
      journal.moved.push(item.path); await record();
    }
    if (plan.editGameinfo) {
      await checked(root, 'gameinfo.gi', io);
      if (hash(await io.readFile(path.join(root, 'gameinfo.gi'))) !== plan.gameinfoDigest) throw new Error('游戏配置已改变，请重新扫描。');
      await io.writeFile(path.join(backup, 'gameinfo.gi'), original);
      journal.gameinfoEdited = true; await record();
      await io.writeFile(path.join(root, 'gameinfo.gi'), cleanGameinfo(original.toString('utf8'), removeShared));
    }
    journal.phase = 'committed'; await record();
  } catch (cause) {
    const failures = [];
    if (journal.gameinfoEdited) { try { await io.writeFile(path.join(root, 'gameinfo.gi'), original); } catch { failures.push('gameinfo.gi'); } }
    for (const relative of [...journal.moved].reverse()) {
      try { await io.rename(path.join(backup, relative), path.join(root, relative)); } catch { failures.push(relative); }
    }
    journal.phase = failures.length ? 'recovery-needed' : 'rolled-back'; journal.failures = failures;
    await record().catch(() => {});
    throw new Error(`卸载未完成，${failures.length ? '部分文件需要手动恢复' : '已恢复原文件'}。请关闭 CS2 和 Panel 后重试。恢复记录：${backup}。${cause.message}`);
  }
  return { removed: plan.files.length, gameinfoEdited: plan.editGameinfo, directory: root, backup, retainedShared: plan.retainedShared };
}
module.exports = { inspectUninstall, uninstallPayload, cleanGameinfo };
