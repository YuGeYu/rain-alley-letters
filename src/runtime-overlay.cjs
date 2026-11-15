const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('./runtime-overlay-manifest.json');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
async function hasCompatibleRuntime(root) {
  const { shared, demoOverlap } = require('./cs2-ownership.cjs');
  const { checked } = require('./cs2-uninstaller.cjs');
  try {
    const core='addons/counterstrikesharp/configs/core.json';
    if (!(await checked(root,core))?.isFile()) return false;
    const config=JSON.parse(await fs.readFile(path.join(root,core),'utf8'));
    if (!config || typeof config!=='object' || Array.isArray(config)) return false;
  } catch { return false; }
  for (const item of require('./cs2-payload-manifest.json').files.filter(item=>shared(item.path) && !demoOverlap(item.path) && !item.path.includes('/configs/'))) {
    try {
      const info=await checked(root,item.path);
      if(!info?.isFile() || hash(await fs.readFile(path.join(root,item.path)))!==item.sha256) return false;
    } catch { return false; }
  }
  return true;
}
async function applyRuntimeOverlay(stage, temp, extract) {
  const archive = path.join(temp,'runtime-overlay.zip');
  await fs.copyFile(path.join(__dirname,'../assets/plugins/cs2-runtime-1.0.380-overlay.zip'),archive);
  if (hash(await fs.readFile(archive))!==manifest.archiveSha256) throw new Error('共享运行库更新包校验失败。');
  const unpack = path.join(temp,'runtime-overlay'); await fs.mkdir(unpack);
  await extract(archive,unpack);
  for (const item of manifest.files) {
    const source = path.join(unpack,item.path);
    if(hash(await fs.readFile(source))!==item.sha256) throw new Error('共享运行库更新文件校验失败。');
    const target = path.join(stage,item.path);
    await fs.mkdir(path.dirname(target),{recursive:true}); await fs.copyFile(source,target);
  }
}
module.exports = { applyRuntimeOverlay, hasCompatibleRuntime };
