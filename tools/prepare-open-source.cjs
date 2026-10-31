// Local source preview only. Never initializes Git, commits, creates a remote, or uploads.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[^0-9]/g, '');
const out = path.join(root, 'release', 'opensource-preview-' + stamp);
const files = ['.gitignore', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'package.json', 'package-lock.json', 'start.cjs', 'cloudflare-config.json', 'installer.template.nsi', '设计规范.md', '功能模块规范.md'];
const dirs = ['src', 'assets', 'design-system', 'docs'];
const excludedTools = new Set(['install-local-cs2.cjs', 'prepare-developer.cjs', 'verify-deployment.cjs', 'packaged-root-check.cjs']);
function walk(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Source preview refuses links: ' + name);
    if (entry.isDirectory()) walk(name); else files.push(name);
  }
}
for (const dir of dirs) walk(dir);
for (const entry of fs.readdirSync(path.join(root, 'tools'))) if (!excludedTools.has(entry)) files.push('tools/' + entry);
for (const file of ['package.json', 'package-lock.json', 'README.md', 'cloudflare.config.ts', 'vite.config.ts']) files.push('cloudflare/auth-api/' + file);
walk('cloudflare/auth-api/src'); walk('cloudflare/auth-api/migrations');
const suspicious = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /gh[pousr]_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{40,}/, /AKIA[0-9A-Z]{16}/];
const manifest = [];
for (const name of files) {
  const full = path.join(root, name);
  if (fs.lstatSync(full).isSymbolicLink() || !fs.statSync(full).isFile()) throw new Error('Unexpected file: ' + name);
  const data = fs.readFileSync(full);
  if (suspicious.some(pattern => pattern.test(data.toString('utf8')))) throw new Error('Possible secret: ' + name);
  if (['.exe', '.dll', '.zip', '.vpk', '.db', '.sqlite', '.enc', '.pem', '.key'].includes(path.extname(name).toLowerCase())) throw new Error('Private or external binary file: ' + name);
  manifest.push({ path: name, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
}
fs.mkdirSync(out, { recursive: true });
for (const item of manifest) { const target = path.join(out, item.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, item.path), target); }
// The checked-in installer is machine-specific; regenerate it from the template.
const template = fs.readFileSync(path.join(root, 'installer.template.nsi'), 'utf8');
// A portable repository must not commit the generated absolute-path installer.
fs.writeFileSync(path.join(out, 'installer.nsi'), template.replaceAll('@APP_BUILD_DIR@', 'release\\win-unpacked').replaceAll('@README_PATH@', 'README.md'));
const installer = fs.readFileSync(path.join(out, 'installer.nsi'));
manifest.push({ path: 'installer.nsi', bytes: installer.length, sha256: crypto.createHash('sha256').update(installer).digest('hex') });
fs.writeFileSync(path.join(out, 'SOURCE_MANIFEST.json'), JSON.stringify({ preparedAt: new Date().toISOString(), uploaded: false, files: manifest }, null, 2));
console.log(JSON.stringify({ directory: out, files: manifest.length, secretPatterns: suspicious.length, uploaded: false }));
