const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
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
  const archive = path.resolve(__dirname, '../assets/plugins/InventorySimulator-v3.7.2.zip');
  const runtimeArchive = process.env.CS2_BOT_IMPROVER_ARCHIVE || 'E:/dow/CS2BotImprover.zip';
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
    assert.ok(!await exists('Panel v1.4.7.exe'));
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
    assert.equal(await fs.readFile(file('inventories.json'), 'utf8'), '{"player":"keep"}');
    await installInventory({ root, archive, runtimeArchive, keepBackup: false });
    assert.ok(await exists(bot)); assert.ok(await exists(inventory));
    await remove('inventory'); await remove('bots');
    assert.ok(!await exists(bot)); assert.ok(!await exists(inventory)); assert.ok(!await exists(api));
  } finally { await fs.rm(base, { recursive: true, force: true, maxRetries: 5 }); }
});
