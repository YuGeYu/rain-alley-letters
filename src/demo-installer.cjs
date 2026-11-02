const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { installOfficialPayload, extractArchive } = require('./cs2-installer.cjs');
const { shared } = require('./cs2-ownership.cjs');
const manifest = require('./demo-payload-manifest.json');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
async function installDemo({ root, archive, runtimeArchive, keepBackup }) {
  if (digest(await fs.readFile(archive)) !== manifest.archiveSha256) throw new Error('Demo 重玩资源包校验失败。');
  return installOfficialPayload({ root, archive, keepBackup, entries: ['addons', 'gameinfo.gi'], preserveBot: true, installingDemo: true,
    extract: async (_archive, stage) => {
      const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'alley-demo-resources-'));
      try {
        const runtimeZip = path.join(temp, 'runtime.zip');
        await fs.copyFile(runtimeArchive, runtimeZip);
        if (digest(await fs.readFile(runtimeZip)) !== require('./shared-runtime-manifest.json').archiveSha256) throw new Error('共享运行库校验失败。');
        await extractArchive(runtimeZip, temp);
        for (const item of require('./cs2-payload-manifest.json').files.filter(x => shared(x.path))) {
          const source = path.join(temp, item.path);
          if (digest(await fs.readFile(source)) !== item.sha256) throw new Error('共享运行库文件校验失败。');
          const target = path.join(stage, item.path);
          await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(source, target);
        }
        const zip = path.join(temp, 'demo.zip'); await fs.copyFile(archive, zip);
        const unpack = path.join(temp, 'demo'); await fs.mkdir(unpack); await extractArchive(zip, unpack);
        const payload = path.join(unpack, 'demotracer-css-v1.6.6');
        for (const item of manifest.files) {
          const source = path.join(payload, item.path);
          if (digest(await fs.readFile(source)) !== item.sha256) throw new Error('Demo 重玩文件校验失败。');
          const target = path.join(stage, item.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(source, target);
        }
        await fs.writeFile(path.join(stage, 'gameinfo.gi'), '');
      } finally { await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    } });
}
module.exports = { installDemo };
