const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { extractArchive } = require('../src/cs2-installer.cjs');
const root = path.resolve(__dirname, '..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function run() {
  const archive = process.argv[2] || 'E:/dow/CS2BotImprover (1).zip';
  const source = process.argv[3] || 'E:/dow/CS2-Bot-Improver-1.4.9.zip';
  const archiveBytes = await fs.readFile(archive);
  const hash = digest(archiveBytes);
  const release = JSON.parse(await fs.readFile(path.join(root,'.work/cs2-bots-1.4.9/github-release.json'),'utf8').then(text=>text.replace(/^\uFEFF/,'')));
  const asset = release.assets.find(item=>item.name==='CS2BotImprover.zip');
  if (release.tag_name!=='v1.4.9' || asset.digest!=='sha256:'+hash || asset.size!==archiveBytes.length) throw new Error('本机资源包与 GitHub 官方 v1.4.9 Release 清单不一致。');
  const stage = await fs.mkdtemp(path.join(os.tmpdir(),'alley-bot-manifest-'));
  try {
    await extractArchive(archive, stage);
    const entries = ['addons','backup','cfg','gameinfo.gi','overrides','Panel.exe'];
    const files=[];
    async function walk(folder, prefix='') {
      for (const item of await fs.readdir(folder,{withFileTypes:true})) {
        const rel=path.posix.join(prefix,item.name), file=path.join(folder,item.name);
        if (item.isSymbolicLink()) throw new Error('资源包含链接。');
        if (item.isDirectory()) await walk(file,rel);
        else files.push({path:rel,sha256:digest(await fs.readFile(file))});
      }
    }
    for (const entry of entries) await fs.access(path.join(stage,entry));
    await walk(stage);files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
    const manifest={version:'1.4.9',archiveSha256:hash,archiveBytes:archiveBytes.length,sourceSha256:digest(await fs.readFile(source)),sourceUrl:'https://github.com/ed0ard/CS2-Bot-Improver/tree/v1.4.9',packageUrl:asset.browser_download_url,panelFile:'Panel.exe',installEntries:entries,files};
    const target=path.join(root,'src/cs2-payload-manifest.json');
    const previous=JSON.parse(await fs.readFile(target,'utf8'));
    if(previous.version==='1.4.7')await fs.writeFile(path.join(root,'src/cs2-legacy-payload-manifest.json'),JSON.stringify(previous,null,2)+'\n');
    await fs.writeFile(target,JSON.stringify(manifest,null,2)+'\n');
    console.log(`PASS official v1.4.9: ${files.length} files, ${archiveBytes.length} archive bytes, SHA-256 ${hash}`);
  } finally {await fs.rm(stage,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
