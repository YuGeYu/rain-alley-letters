// Rebuild the local, redistributable playback assets from the supplied releases.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const work = path.join(root, '.work/demo-1.6.12');
const source = path.join(work, 'source/demotracer-1.6.12');
const payload = path.join(work, 'payload/demotracer-css-v1.6.12');
const assets = path.join(root, 'assets/plugins');
for (const [file,expected] of [['E:/dow/demotracer-1.6.12.zip','2542b98f574aaa39f13689939d1284599e7a5043ee401ff68724841fcdcd82fd'],['E:/dow/demotracer-css-v1.6.12.zip','6109159c9777f7e4e71d56b3bc8bbfc885272b648c39084af7acd1d815c0bc10'],['E:/dow/demotracer-gui-v1.6.12.exe','6672228d235ddeacf3166cbd71c672fa6605ca6a5beb4dcf1c8d84b406c61630']]) if(hash(file)!==expected) throw new Error('Release changed: '+file);
for (const [directory,zip] of [[source,'E:/dow/demotracer-1.6.12.zip'],[payload,'E:/dow/demotracer-css-v1.6.12.zip']]) if(!fs.existsSync(directory)) { fs.mkdirSync(path.dirname(directory),{recursive:true});execFileSync('tar.exe',['-xf',zip,'-C',path.dirname(directory)],{windowsHide:true}); }
const old = require('../src/demo-payload-manifest.json');
if (old.version !== '1.6.12') fs.writeFileSync(path.join(root,'src/demo-legacy-payload-manifest.json'), JSON.stringify(old,null,2)+'\n');
const files = [];
function walk(dir, prefix = '') {
  for (const item of fs.readdirSync(dir,{withFileTypes:true})) {
    const rel = path.posix.join(prefix,item.name), full = path.join(dir,item.name);
    if (item.isSymbolicLink()) throw new Error('Unexpected link');
    if (item.isDirectory()) walk(full,rel); else files.push({path:rel,sha256:hash(full)});
  }
}
walk(payload);
const receipt = JSON.parse(fs.readFileSync(path.join(payload,'addons/demotracer-install.v1.json')));
for (const item of receipt.files) if (hash(path.join(payload,item.path)) !== item.sha256) throw new Error('Upstream receipt mismatch: '+item.path);
const archive = 'E:/dow/demotracer-css-v1.6.12.zip';
fs.copyFileSync(archive,path.join(assets,'demotracer-css-v1.6.12.zip'));
fs.writeFileSync(path.join(root,'src/demo-payload-manifest.json'),JSON.stringify({version:'1.6.12',archiveSha256:hash(archive),archiveBytes:fs.statSync(archive).size,sourceSha256:hash('E:/dow/demotracer-1.6.12.zip'),guiSha256:hash('E:/dow/demotracer-gui-v1.6.12.exe'),guiBytes:fs.statSync('E:/dow/demotracer-gui-v1.6.12.exe').size,sourceUrl:'https://github.com/unicbm/demotracer/tree/v1.6.12',files},null,2)+'\n');
for (const [from,to] of [['LICENSE','DemoTracer-LICENSE.txt'],['DESKTOP_LICENSE.txt','DemoTracer-DESKTOP-LICENSE.txt'],['TRADEMARKS.md','DemoTracer-TRADEMARKS.md'],['server/plugins/DemoTracer/THIRD_PARTY_NOTICES.md','DemoTracer-THIRD_PARTY_NOTICES.md']]) fs.copyFileSync(path.join(source,from),path.join(assets,to));
// The old Quark runtime is CSS 1.0.378. A small overlay upgrades it to the
// verified Bot Improver 1.4.9 host (CSS 1.0.380 / shared KHook) without bundling
// the >50 MB runtime or installing bot features for replay-only players.
const { shared } = require('../src/cs2-ownership.cjs');
const current = require('../src/cs2-payload-manifest.json');
const previous = new Map(require('../src/shared-runtime-manifest.json').files.map(x=>[x.path,x.sha256]));
const changed = current.files.filter(x=>shared(x.path) && previous.get(x.path)!==x.sha256);
const overlay = path.join(work,'runtime-overlay'); fs.mkdirSync(overlay,{recursive:true});
execFileSync('tar.exe',['-xf','E:/dow/CS2BotImprover (1).zip','-C',overlay,...changed.map(x=>x.path)],{windowsHide:true});
for (const item of changed) if(hash(path.join(overlay,item.path))!==item.sha256) throw new Error('Runtime mismatch');
const zip = path.join(assets,'cs2-runtime-1.0.380-overlay.zip');
execFileSync('tar.exe',['-a','-cf',zip,'-C',overlay,'addons'],{windowsHide:true});
if (fs.statSync(zip).size>50_000_000) throw new Error('Runtime overlay exceeds resource policy');
fs.writeFileSync(path.join(root,'src/runtime-overlay-manifest.json'),JSON.stringify({version:'CSS 1.0.380',archiveSha256:hash(zip),archiveBytes:fs.statSync(zip).size,sourceArchiveSha256:current.archiveSha256,files:changed},null,2)+'\n');
console.log(JSON.stringify({version:'1.6.12',files:files.length,overlayFiles:changed.length,overlayBytes:fs.statSync(zip).size,guiBundled:false}));
