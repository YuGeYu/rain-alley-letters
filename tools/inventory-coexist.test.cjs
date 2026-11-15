const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { installInventory, configPath } = require('../src/inventory-installer.cjs');
const { installOfficialPayload } = require('../src/cs2-installer.cjs');
const { inspectUninstall, uninstallPayload } = require('../src/cs2-uninstaller.cjs');
const { externalProtocol } = require('../src/external-protocol.cjs');
test('external protocol defaults, custom imports and script/file rejection', () => {
  assert.throws(() => externalProtocol('ccswitch://v1/import?test=1', false), /默认关闭/);
  assert.equal(externalProtocol('ccswitch://v1/import?test=1', true), 'ccswitch://v1/import?test=1');
  for (const url of ['file:///C:/Windows/test', 'javascript:alert(1)', 'data:text/html,hello', 'rainalley://app/']) assert.throws(() => externalProtocol(url, true));
  assert.throws(() => externalProtocol('ccswitch://test\n', true));
});
test('real ZIP lifecycle: standalone, both install orders, both uninstalls, reinstall and backups', { timeout: 180000 }, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'alley-coexist-'));
  const root = path.join(base, 'game/csgo');
  const archive = path.resolve(__dirname, '../assets/plugins/InventorySimulator-v3.8.2.zip');
  const runtimeArchive = process.env.CS2_BOT_IMPROVER_ARCHIVE || 'E:/dow/CS2BotImprover (1).zip';
  const file = rel => path.join(root, rel);
  const exists = rel => fs.access(file(rel)).then(() => true, () => false);
  const bot = 'addons/counterstrikesharp/plugins/BotAI/BotAI.dll';
  const inventory = 'addons/counterstrikesharp/plugins/InventorySimulator/InventorySimulator.dll';
  const api = 'addons/counterstrikesharp/api/CounterStrikeSharp.API.dll';
  async function write(rel, content) { await fs.mkdir(path.dirname(file(rel)), { recursive: true }); await fs.writeFile(file(rel), content); }
  async function remove(plugin, removeShared = true) {
    const options = { root, plugin, removeShared, keepConfig: false };
    const plan = await inspectUninstall(options);
    await uninstallPayload({ ...options, fingerprint: plan.fingerprint });
    return plan;
  }
  try {
    await write('gameinfo.gi', 'GameInfo { FileSystem { SearchPaths {\n Game csgo\n Game custom-player-content\n} } }');
    await write('addons/counterstrikesharp/plugins/OtherPlugin/Other.dll', 'third party');
    await write('addons/metamod/thirdparty.vdf', 'third party loader');
    const first = await installInventory({ root, archive, runtimeArchive, keepBackup: true });
    assert.ok(await exists(inventory)); assert.ok(await exists(api)); assert.ok(!await exists(bot));
    assert.ok(!await exists('Panel.exe'));
    assert.ok(!await exists('addons/metamod/BotController.vdf'));
    assert.equal(await fs.readFile(path.join(first.backup, 'addons/counterstrikesharp/plugins/OtherPlugin/Other.dll'), 'utf8'), 'third party');
    assert.ok(!await exists('addons/metamod/thirdparty.vdf'));
    assert.ok((await fs.readFile(file('gameinfo.gi'), 'utf8')).includes('custom-player-content'));
    await write(configPath, 'invsim_ws_enabled true\ninvsim_ws_cooldown 12\n');
    await write('inventories.json', '{"player":"keep"}');
    await installOfficialPayload({ root, archive: runtimeArchive, keepBackup: false });
    assert.ok(await exists(bot)); assert.ok(await exists(inventory));
    assert.ok((await fs.readFile(file(configPath), 'utf8')).includes('12'));
    const botsRemoved = await remove('bots');
    assert.equal(botsRemoved.removeShared, false);
    assert.ok(!await exists(bot)); assert.ok(await exists(inventory)); assert.ok(await exists(api));
    assert.ok(!await exists('addons/metamod/BotController.vdf'));
    assert.ok((await fs.readFile(file('gameinfo.gi'), 'utf8')).includes('addons/metamod'));
    await installOfficialPayload({ root, archive: runtimeArchive, keepBackup: false });
    await remove('inventory');
    assert.ok(await exists(bot)); assert.ok(!await exists(inventory)); assert.ok(await exists(api));
    assert.ok(!await exists('addons/counterstrikesharp/gamedata/inventory-simulator.json'),'inventory gamedata is owned by inventory, not the shared host');
    assert.equal(await fs.readFile(file('inventories.json'), 'utf8'), '{"player":"keep"}');
    await installInventory({ root, archive, runtimeArchive, keepBackup: false });
    assert.ok(await exists(bot)); assert.ok(await exists(inventory));
    await remove('inventory'); await remove('bots');
    assert.ok(!await exists(bot)); assert.ok(!await exists(inventory)); assert.ok(!await exists(api));
  } finally { await fs.rm(base, { recursive: true, force: true, maxRetries: 5 }); }
});

test('3.8.2 upgrade and legacy uninstall preserve inventory data, configuration and unknown owned files', {timeout:90000}, async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'alley-inventory-upgrade-'));
  const root=path.join(base,'game/csgo'), assets=path.resolve(__dirname,'../assets/plugins');
  const file=rel=>path.join(root,rel), manifest=require('../src/inventory-payload-manifest.json');
  const dll='addons/counterstrikesharp/plugins/InventorySimulator/InventorySimulator.dll';
  const gamedata='addons/counterstrikesharp/gamedata/inventory-simulator.json';
  async function write(rel,data){await fs.mkdir(path.dirname(file(rel)),{recursive:true});await fs.writeFile(file(rel),data);}
  try {
    await write('gameinfo.gi','GameInfo { FileSystem { SearchPaths {\n Game csgo\n Game custom-content\n} } }');
    const legacy=require('../src/inventory-legacy-payload-manifest.json');
    // Build an actual legacy installation directly from the preserved official ZIP.
    await require('../src/cs2-installer.cjs').extractArchive(path.resolve(__dirname,'../.work/inventory-3.8.2/InventorySimulator-v3.7.2.zip'),root);
    const legacyPlan=await inspectUninstall({root,plugin:'inventory',keepConfig:true});
    assert.equal(legacyPlan.changed,0); assert.equal(legacyPlan.files.length,legacy.files.length);
    const removed=await uninstallPayload({root,plugin:'inventory',keepConfig:true,fingerprint:legacyPlan.fingerprint});
    await assert.rejects(fs.access(file(gamedata)));
    assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(removed.backup,dll))).digest('hex'),legacy.files.find(x=>x.path===dll).sha256);
    await require('../src/cs2-installer.cjs').extractArchive(path.resolve(__dirname,'../.work/inventory-3.8.2/InventorySimulator-v3.7.2.zip'),root);
    await write(configPath,'invsim_ws_enabled true\ninvsim_ws_cooldown 12\n');
    const personal='addons/counterstrikesharp/plugins/InventorySimulator/personal-note.txt';
    await write(personal,'player note');await write('inventories.json','personal inventory');
    await write('addons/counterstrikesharp/plugins/Foreign/Foreign.dll','foreign');
    const archive=path.join(assets,'InventorySimulator-v3.8.2.zip'), corrupt=path.join(base,'corrupt.zip');await fs.writeFile(corrupt,'corrupted');
    await assert.rejects(installInventory({root,archive:corrupt,keepBackup:false}),/校验失败/);
    assert.equal(await fs.readFile(file('addons/counterstrikesharp/plugins/Foreign/Foreign.dll'),'utf8'),'foreign');
    const result=await installInventory({root,archive,runtimeArchive:path.join(assets,'cs2-shared-runtime.zip'),keepBackup:true});
    assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(result.backup,dll))).digest('hex'),legacy.files.find(x=>x.path===dll).sha256);
    for(const item of manifest.files) assert.equal(crypto.createHash('sha256').update(await fs.readFile(file(item.path))).digest('hex'),item.sha256);
    await installInventory({root,archive,keepBackup:false});
    assert.equal(await fs.readFile(file(personal),'utf8'),'player note');assert.equal(await fs.readFile(file('inventories.json'),'utf8'),'personal inventory');
    assert.match(await fs.readFile(file(configPath),'utf8'),/cooldown 12/);
    await assert.rejects(fs.access(file('addons/counterstrikesharp/plugins/BotAI/BotAI.dll')));
    const plan=await inspectUninstall({root,plugin:'inventory',keepConfig:false});assert.equal(plan.files.length,manifest.files.length+1);assert.equal(plan.changed,1,'the custom CFG has no upstream default digest');
    await uninstallPayload({root,plugin:'inventory',keepConfig:false,fingerprint:plan.fingerprint});
    await assert.rejects(fs.access(file(gamedata)));await assert.rejects(fs.access(file(configPath)));
    assert.equal(await fs.readFile(file(personal),'utf8'),'player note');assert.equal(await fs.readFile(file('inventories.json'),'utf8'),'personal inventory');
  } finally {await fs.rm(base,{recursive:true,force:true,maxRetries:5});}
});
