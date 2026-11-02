const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { installDemo } = require('../src/demo-installer.cjs');
const { installInventory } = require('../src/inventory-installer.cjs');
const { installOfficialPayload } = require('../src/cs2-installer.cjs');
const { inspectUninstall, uninstallPayload } = require('../src/cs2-uninstaller.cjs');
const { rememberGui, findGui } = require('../src/demo-gui.cjs');
const assets = path.resolve(__dirname, '../assets/plugins');
const botArchive = process.env.CS2_BOT_IMPROVER_ARCHIVE || 'E:/dow/CS2BotImprover.zip';
const bot = 'addons/counterstrikesharp/plugins/BotAI/BotAI.dll';
const demo = 'addons/counterstrikesharp/plugins/DemoTracer/DemoTracer.dll';
const inv = 'addons/counterstrikesharp/plugins/InventorySimulator/InventorySimulator.dll';
const provider = 'addons/counterstrikesharp/plugins/BotRandomizer/BotRandomizer.dll';
const api = 'addons/counterstrikesharp/api/CounterStrikeSharp.API.dll';
test('real payloads: all six installation orders, shared provider, uninstall/reinstall cycles', { timeout: 360000 }, async () => {
  for (const order of [['demo','bots','inventory'],['demo','inventory','bots'],['bots','demo','inventory'],['bots','inventory','demo'],['inventory','demo','bots'],['inventory','bots','demo']]) {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'alley-demo-cycle-'));
    const root = path.join(base, 'game/csgo'); const file = rel => path.join(root, rel);
    const exists = rel => fs.access(file(rel)).then(() => true, () => false);
    async function write(rel, text) { await fs.mkdir(path.dirname(file(rel)), {recursive:true}); await fs.writeFile(file(rel), text); }
    const install = name => name === 'bots' ? installOfficialPayload({ root, archive: botArchive, keepBackup: false }) : name === 'inventory' ? installInventory({ root, archive: path.join(assets,'InventorySimulator-v3.7.2.zip'), runtimeArchive: path.join(assets,'cs2-shared-runtime.zip'), keepBackup:false }) : installDemo({ root, archive: path.join(assets,'demotracer-css-v1.6.6.zip'), runtimeArchive: path.join(assets,'cs2-shared-runtime.zip'), keepBackup:true });
    const remove = async plugin => { const options = {root, plugin, keepConfig:false, removeShared:true}; const plan=await inspectUninstall(options); return uninstallPayload({...options,fingerprint:plan.fingerprint}); };
    try {
      await write('gameinfo.gi','GameInfo { FileSystem { SearchPaths {\n Game csgo\n Game custom-content\n} } }');
      await write('addons/counterstrikesharp/plugins/Foreign/Foreign.dll','foreign');
      await write('match.dem','personal demo'); await write('replays/personal.dtr','personal replay');
      for (const name of order) await install(name);
      for (const p of [bot,demo,inv,api]) assert.ok(await exists(p), order.join(',')+': '+p);
      assert.ok(!await exists('addons/counterstrikesharp/plugins/Foreign/Foreign.dll'));
      const expected = require('../src/demo-payload-manifest.json').files.find(x=>x.path===provider).sha256;
      const hashProvider = async () => crypto.createHash('sha256').update(await fs.readFile(file(provider))).digest('hex');
      assert.equal(await hashProvider(),expected,'matched provider survives every install order');
      await install('bots'); assert.equal(await hashProvider(),expected,'bot reinstall cannot downgrade replay provider');
      await remove('bots'); for (const p of [demo, inv, provider, api]) assert.ok(await exists(p)); assert.ok(!await exists(bot));
      await install('bots'); await remove('demo'); for (const p of [bot, inv, provider, api]) assert.ok(await exists(p)); assert.ok(!await exists(demo));
      await install('demo'); await remove('inventory'); for (const p of [bot,demo,provider,api]) assert.ok(await exists(p));
      await remove('bots'); assert.ok(await exists(demo)); assert.ok(await exists(api));
      await remove('demo'); assert.ok(!await exists(demo)); assert.ok(!await exists(provider));
      assert.equal(await fs.readFile(file('match.dem'),'utf8'),'personal demo');
      assert.equal(await fs.readFile(file('replays/personal.dtr'),'utf8'),'personal replay');
      assert.match(await fs.readFile(file('gameinfo.gi'),'utf8'),/custom-content/);
      await install('demo'); assert.ok(await exists(demo)); assert.ok(!await exists(bot)); assert.ok(!await exists(inv));
    } finally { await fs.rm(base,{recursive:true,force:true,maxRetries:5}); }
  }
});
test('GUI record remembers the installed executable and rejects setup, missing paths and removed apps', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(),'alley-demo-gui-'));
  try {
    const record=path.join(base,'gui.json'); const target=path.join(base,'cs2-demotracer-gui.exe');
    await fs.writeFile(target,'fixture'); await rememberGui(record,target); assert.equal(await findGui(record,base),target);
    await assert.rejects(rememberGui(record,path.join(base,'demotracer-gui-v1.6.6.exe')),/安装后/);
    await fs.unlink(target); assert.equal(await findGui(record,base),null);
  } finally { await fs.rm(base,{recursive:true,force:true}); }
});
