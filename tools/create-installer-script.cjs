const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pathForNsis = (relative) => path.join(root, relative).replaceAll('/', '\\');
const replacements = {
  '@APP_BUILD_DIR@': pathForNsis('release/win-unpacked'),
  '@README_PATH@': pathForNsis('README.md')
};
let script = fs.readFileSync(path.join(root, 'installer.template.nsi'), 'utf8');
for (const [placeholder, value] of Object.entries(replacements)) script = script.replaceAll(placeholder, value);
if (/@[A-Z_]+@/.test(script)) throw new Error('NSIS 模板仍有未展开的路径');
fs.writeFileSync(path.join(root, 'installer.nsi'), script, 'utf8');
fs.copyFileSync(path.join(root, 'README.md'), path.join(root, 'release/win-unpacked/README.txt'));
console.log('已准备 NSIS 脚本与应用内说明文件。');
