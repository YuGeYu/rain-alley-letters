const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { installOfficialPayload, extractArchive } = require('./cs2-installer.cjs');
const { shared } = require('./cs2-ownership.cjs');
const runtimeManifest = require('./cs2-payload-manifest.json');
const inventoryManifest = require('./inventory-payload-manifest.json');
const configPath = 'cfg/rain-alley-inventory.cfg';
async function installInventory({ root, archive, runtimeArchive, keepBackup }) {
  const digest = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  if (digest !== inventoryManifest.archiveSha256) throw new Error('随应用附带的库存资源包校验失败。');
  return installOfficialPayload({ root, archive, keepBackup, entries: ['addons', 'cfg', 'gameinfo.gi'], preserveBot: true,
    extract: async (_archive, stage) => {
      // Reuse compatible runtime files only, without installing bot features.
      const runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'alley-shared-runtime-'));
      try {
        // Native tar cannot read Electron ASAR virtual paths.
        const localRuntime = path.join(runtime, 'runtime.zip');
        await fs.copyFile(runtimeArchive, localRuntime);
        const runtimeDigest = crypto.createHash('sha256').update(await fs.readFile(localRuntime)).digest('hex');
        const bundledManifest = require('./shared-runtime-manifest.json');
        if (![runtimeManifest.archiveSha256, bundledManifest.archiveSha256].includes(runtimeDigest)) throw new Error('共享运行库资源校验失败。');
        await extractArchive(localRuntime, runtime);
        for (const item of runtimeManifest.files.filter(x => shared(x.path))) {
          const target = path.join(stage, item.path);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.copyFile(path.join(runtime, item.path), target);
        }
        const core = path.join(stage, 'addons/counterstrikesharp/configs/core.json');
        const defaults = JSON.parse(await fs.readFile(core, 'utf8'));
        defaults.ServerLanguage = 'zh-Hans';
        await fs.writeFile(core, JSON.stringify(defaults, null, 2));
      } finally { await fs.rm(runtime, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
      // Windows tar cannot read inside app.asar; materialize the bundled ZIP.
      const bundled = path.join(stage, 'inventory.zip');
      await fs.copyFile(archive, bundled);
      await extractArchive(bundled, stage);
      await fs.unlink(bundled);
      for (const item of inventoryManifest.files) {
        if (crypto.createHash('sha256').update(await fs.readFile(path.join(stage, item.path))).digest('hex') !== item.sha256) throw new Error('库存资源文件校验失败。');
      }
      await fs.writeFile(path.join(stage, 'gameinfo.gi'), '');
      const { checked } = require('./cs2-uninstaller.cjs');
      await checked(root, configPath);
      const existing = await fs.readFile(path.join(root, configPath)).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      const destination = path.join(stage, configPath);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, existing || 'invsim_url "https://inventory.cstrike.app"\ninvsim_ws_enabled true\ninvsim_ws_immediately true\ninvsim_wslogin false\ninvsim_stattrak_ignore_bots true\n');
    } });
}
module.exports = { installInventory, configPath };
