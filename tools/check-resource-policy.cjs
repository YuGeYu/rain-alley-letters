const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const limit = 50_000_000;
function check() {
  const resources = require('../src/external-resources.json');
  const files = require('../package.json').build.files;
  const excluded = new Set(files.filter(item => typeof item === 'string' && item.startsWith('!')).map(item => item.slice(1)));
  const registered = new Map(Object.values(resources).map(resource => [resource.localPath, resource]));
  for (const resource of registered.values()) {
    if (!excluded.has(resource.localPath)) throw new Error('大资源必须排除出安装包：' + resource.localPath);
    const url = new URL(resource.quarkUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'pan.quark.cn' || !/^\/s\/[a-z0-9]+$/i.test(url.pathname)) throw new Error('缺少有效夸克分享：' + resource.localPath);
    const local = path.join(root, resource.localPath);
    if (fs.existsSync(local) && (fs.statSync(local).size !== resource.bytes || require('node:crypto').createHash('sha256').update(fs.readFileSync(local)).digest('hex') !== resource.sha256)) throw new Error('本地资源已改变，请重新上传并更新夸克资源清单：' + resource.localPath);
  }
  function walk(dir) {
    for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = dir + '/' + item.name;
      if (item.isSymbolicLink()) throw new Error('打包资源不允许链接：' + file);
      if (item.isDirectory()) walk(file);
      else if (fs.statSync(path.join(root, file)).size > limit && (!registered.has(file) || !excluded.has(file))) throw new Error('超过 50 MB 的资源不能随安装包附带：' + file);
    }
  }
  walk('src'); walk('assets');
  console.log('PASS: 50 MB 资源规范，3 个大资源使用夸克分享且排除打包。');
}
module.exports = check;
if (require.main === module) check();
