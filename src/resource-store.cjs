const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function createResourceStore({ cache, resources, chooseFile }) {
  const get = id => {
    if (!Object.hasOwn(resources, id)) throw new Error('未找到所需资源。');
    return resources[id];
  };
  async function valid(file, resource) {
    const stat = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== resource.bytes) return false;
    return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex') === resource.sha256;
  }
  async function acquire(id) {
    const resource = get(id);
    await fs.mkdir(cache, { recursive: true });
    if ((await fs.lstat(cache)).isSymbolicLink()) throw new Error('资源缓存目录包含链接，已停止操作。');
    const target = path.join(cache, resource.sha256 + '.zip');
    if (await valid(target, resource)) return target;
    const selected = await chooseFile(resource);
    if (!selected) return null;
    const temporary = path.join(cache, crypto.randomUUID() + '.zip');
    try {
      await fs.copyFile(selected, temporary, require('node:fs').constants.COPYFILE_EXCL);
      if (!await valid(temporary, resource)) throw new Error('资源包校验未通过，请从夸克分享下载「' + resource.fileName + '」，不要解压或修改。');
      // Only replace our own content-addressed cache; never change the selected file.
      const existing = await fs.lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
      if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('资源缓存文件异常。');
      await fs.rename(temporary, target);
      return target;
    } finally { await fs.rm(temporary, { force: true }); }
  }
  return { get, acquire };
}
module.exports = { createResourceStore };
