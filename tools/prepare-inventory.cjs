const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname,'..');
const work = path.join(root,'.work/inventory-3.8.2');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const archive = 'E:/dow/InventorySimulator-v3.8.2.zip';
const source = 'E:/dow/cs2-css-inventory-simulator-3.8.2.zip';
if(hash(archive)!=='7e310228ab4852e54c82d8c21a21f913cde946cc7aa149dab7c224ce6781d1ab' || hash(source)!=='fd0812d796fe1a40edf841ebd17a16004e130d0b4c47b20b93584c762bdc5af0') throw new Error('Provided release changed');
for (const [directory,zip] of [['payload',archive],['source',source]]) { const dir=path.join(work,directory);fs.mkdirSync(dir,{recursive:true});execFileSync('tar.exe',['-xf',zip,'-C',dir],{windowsHide:true}); }
const old=require('../src/inventory-payload-manifest.json');
if(old.version!=='3.8.2') fs.writeFileSync(path.join(root,'src/inventory-legacy-payload-manifest.json'),JSON.stringify(old,null,2)+'\n');
const files=[];
function walk(dir,prefix='') {
  for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
    if(item.isSymbolicLink())throw new Error('Unexpected link');
    const rel=path.posix.join(prefix,item.name),file=path.join(dir,item.name);
    if(item.isDirectory())walk(file,rel);else files.push({path:rel,sha256:hash(file)});
  }
}
walk(path.join(work,'payload'));
fs.writeFileSync(path.join(root,'src/inventory-payload-manifest.json'),JSON.stringify({version:'3.8.2',archiveSha256:hash(archive),archiveBytes:fs.statSync(archive).size,sourceSha256:hash(source),sourceUrl:'https://github.com/ianlucas/cs2-css-inventory-simulator/tree/v3.8.2',files},null,2)+'\n');
fs.copyFileSync(archive,path.join(root,'assets/plugins/InventorySimulator-v3.8.2.zip'));
fs.copyFileSync(path.join(work,'source/cs2-css-inventory-simulator-3.8.2/License.txt'),path.join(root,'assets/plugins/InventorySimulator-LICENSE.txt'));
console.log(JSON.stringify({version:'3.8.2',files:files.length,archiveBytes:fs.statSync(archive).size}));
