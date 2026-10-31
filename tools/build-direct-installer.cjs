const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const cacheRoot = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache');
const plugin = fs.readdirSync(cacheRoot).flatMap((name) => {
  const full = path.join(cacheRoot, name);
  if (!name.startsWith('nsis-resources-')) return [];
  const sub = fs.readdirSync(full, { withFileTypes: true }).find((e) => e.isDirectory());
  return sub ? [path.join(full, sub.name, 'plugins', 'x86-unicode')] : [];
}).find((dir) => fs.existsSync(path.join(dir, 'nsis7z.dll')));
const nsis = fs.readdirSync(cacheRoot).flatMap((name) => {
  if (!name.startsWith('nsis-3.0.4.1')) return [];
  const full = path.join(cacheRoot, name);
  return fs.readdirSync(full, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(full, e.name, 'Bin', 'makensis.exe'));
}).find(fs.existsSync);
const sevenZip = fs.readdirSync(cacheRoot).flatMap((name) => {
  if (!name.startsWith('7zip@')) return [];
  const full = path.join(cacheRoot, name);
  return fs.readdirSync(full, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(full, e.name, 'bin', '7za.exe'));
}).find(fs.existsSync);
if (!plugin || !nsis || !sevenZip) throw new Error('本机 NSIS 工具缓存未找到');
const esc = (v) => v.replaceAll('\\', '\\\\');
const archivePath = path.join(root, 'release', 'rain-alley-letters-1.0.0-x64.nsis.7z');
fs.rmSync(archivePath, { force: true });
const archiveBuild = spawnSync(sevenZip, ['a', '-t7z', '-mx=3', '-mmt=2', '-ms=on', '-y', archivePath, '.\\win-unpacked\\*'], {
  cwd: path.join(root, 'release'), encoding: 'utf8', windowsHide: true
});
if (archiveBuild.status !== 0) throw new Error(`应用档案生成失败：${archiveBuild.stderr || archiveBuild.stdout}`);
const archive = path.basename(archivePath);
if (!archive) throw new Error('没有找到 Electron 7z 应用包');
const replacements = {
  '@PLUGIN_DIR@': esc(plugin), '@OUT_FILE@': esc(path.join(root, 'release', '雨巷来信-Setup-1.0.0.exe')),
  '@ICON@': esc(path.join(root, 'assets', 'rain-alley.ico')), '@HEADER@': esc(path.join(root, 'assets', 'installer-header.bmp')),
  '@SIDEBAR@': esc(path.join(root, 'assets', 'installer-sidebar.bmp')), '@APP_PACKAGE@': esc(path.join(root, 'release', archive)),
  '@README@': esc(path.join(root, 'README.md'))
};
let script = fs.readFileSync(path.join(root, 'tools', 'direct-installer.nsi'), 'utf8');
for (const [key, value] of Object.entries(replacements)) script = script.replaceAll(key, value);
const scriptFile = path.join(root, 'release', 'direct-installer.nsi'); fs.writeFileSync(scriptFile, script, 'utf8');
const result = spawnSync(nsis, ['-INPUTCHARSET', 'UTF8', scriptFile], { cwd: root, encoding: 'utf8', stdio: 'inherit', windowsHide: true });
if (result.status !== 0) process.exit(result.status || 1);
fs.rmSync(`${replacements['@OUT_FILE@'].replaceAll('\\', path.sep)}.blockmap`, { force: true });
console.log('Direct NSIS installer created.');
