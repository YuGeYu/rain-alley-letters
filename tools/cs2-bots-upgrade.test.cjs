const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {installOfficialPayload}=require('../src/cs2-installer.cjs');
const {installDemo}=require('../src/demo-installer.cjs');
const {installInventory}=require('../src/inventory-installer.cjs');
const {inspectUninstall,uninstallPayload}=require('../src/cs2-uninstaller.cjs');
const manifest=require('../src/cs2-payload-manifest.json');
const archive=process.env.CS2_BOT_IMPROVER_ARCHIVE||'E:/dow/CS2BotImprover (1).zip';
const assets=path.resolve(__dirname,'../assets/plugins');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
test('real 1.4.9 upgrade: legacy cleanup, current Valve mode backups, full payload, companion runtime and uninstall',{timeout:240000},async()=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'alley-bots-upgrade-')),root=path.join(base,'game/csgo');
 const file=p=>path.join(root,p),exists=p=>fs.access(file(p)).then(()=>true,()=>false);
 const hash=async p=>digest(await fs.readFile(file(p)));
 async function write(p,text){await fs.mkdir(path.dirname(file(p)),{recursive:true});await fs.writeFile(file(p),text);}
 try {
  assert.equal(digest(await fs.readFile(archive)),manifest.archiveSha256);
  await fs.mkdir(root,{recursive:true});
  await write('gameinfo.gi','GameInfo { FileSystem { SearchPaths {\n Game csgo\n Game player_custom_content\n} } }');
  await write('Panel v1.4.7.exe','old-panel');await write('addons/BotHider/map_whitelist.json','old whitelist');
  await write('addons/ForeignPlugin/foreign.dll','player plugin');await write('replays/player.dem','player recording');
  const result=await installOfficialPayload({root,archive,keepBackup:true});
  assert.equal(await exists('Panel v1.4.7.exe'),false);assert.equal(await exists('addons/BotHider/map_whitelist.json'),false);
  assert.equal(await fs.readFile(path.join(result.backup,'Panel v1.4.7.exe'),'utf8'),'old-panel');
  assert.equal(await fs.readFile(path.join(result.backup,'addons/ForeignPlugin/foreign.dll'),'utf8'),'player plugin');
  for(const item of manifest.files){
   if(['gameinfo.gi','backup/Online/gameinfo.gi','backup/WithBots/gameinfo.gi'].includes(item.path))continue;
   assert.equal(await hash(item.path),item.sha256,item.path+' full upstream payload differs');
  }
  const online=await fs.readFile(file('backup/Online/gameinfo.gi'),'utf8'),bots=await fs.readFile(file('backup/WithBots/gameinfo.gi'),'utf8');
  assert.ok(online.includes('player_custom_content'));assert.ok(!online.includes('addons/metamod'));assert.ok(!online.includes('botprofile.vpk'));
  assert.ok(bots.includes('player_custom_content'));assert.ok(bots.includes('addons/metamod'));assert.ok(bots.includes('botprofile.vpk'));
  const api='addons/counterstrikesharp/api/CounterStrikeSharp.API.dll',native='addons/counterstrikesharp/bin/win64/counterstrikesharp.dll';
  const expected=new Map(manifest.files.map(x=>[x.path,x.sha256]));
  await installDemo({root,archive:path.join(assets,'demotracer-css-v1.6.6.zip'),runtimeArchive:path.join(assets,'cs2-shared-runtime.zip'),keepBackup:false});
  const provider='addons/counterstrikesharp/plugins/BotRandomizer/BotRandomizer.dll';
  const demoProvider=require('../src/demo-payload-manifest.json').files.find(x=>x.path===provider).sha256;
  assert.equal(await hash(api),expected.get(api));assert.equal(await hash(native),expected.get(native));assert.equal(await hash(provider),demoProvider);
  await installOfficialPayload({root,archive,keepBackup:false});assert.equal(await hash(provider),demoProvider);
  await installInventory({root,archive:path.join(assets,'InventorySimulator-v3.8.2.zip'),runtimeArchive:path.join(assets,'cs2-shared-runtime.zip'),keepBackup:false});
  assert.equal(await hash(api),expected.get(api));assert.equal(await hash(native),expected.get(native));assert.equal(await hash(provider),demoProvider);
  const plan=await inspectUninstall({root,keepConfig:false,removeShared:true});
  await uninstallPayload({root,keepConfig:false,removeShared:true,fingerprint:plan.fingerprint});
  assert.equal(await exists('Panel.exe'),false);assert.equal(await exists('backup/WithBots/gameinfo.gi'),false);
  for(const p of ['addons/counterstrikesharp/plugins/DemoTracer/DemoTracer.dll','addons/counterstrikesharp/plugins/InventorySimulator/InventorySimulator.dll',api])assert.ok(await exists(p));
  assert.equal(await fs.readFile(file('replays/player.dem'),'utf8'),'player recording');
 }finally{await fs.rm(base,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
test('legacy Panel remains uninstallable without the old resource archive',async()=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'alley-legacy-panel-')),root=path.join(base,'game/csgo');
 try {await fs.mkdir(root,{recursive:true});await fs.writeFile(path.join(root,'gameinfo.gi'),'GameInfo {}');await fs.writeFile(path.join(root,'Panel v1.4.7.exe'),'legacy');
 const plan=await inspectUninstall({root});assert.ok(plan.files.some(x=>x.path==='Panel v1.4.7.exe'));
 }finally{await fs.rm(base,{recursive:true,force:true});}
});
