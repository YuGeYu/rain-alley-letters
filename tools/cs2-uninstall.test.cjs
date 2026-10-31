const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inspectUninstall, uninstallPayload } = require('../src/cs2-uninstaller.cjs');
async function fixture(run) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'alley-uninstall-test-'));
  const root = path.join(base, 'game', 'csgo');
  await fs.mkdir(path.join(root, 'addons/BotVision/bin/win64'), { recursive: true });
  await fs.mkdir(path.join(root, 'addons/metamod'), { recursive: true });
  await fs.mkdir(path.join(root, 'cfg'));
  for (const [name, data] of Object.entries({ 'gameinfo.gi': 'GameInfo {\n Game csgo/overrides/botprofile.vpk\n Game csgo/addons/metamod\n Game custom_content\n}\n', 'addons/BotVision/bin/win64/BotVision.dll': 'plugin', 'addons/BotVision/config.json': 'custom config', 'addons/BotVision/player.txt': 'custom file', 'addons/metamod/metaplugins.ini': 'shared', 'cfg/my_bot_normal_config.cfg': 'my config' })) await fs.writeFile(path.join(root, name), data);
  try { await run(root, base); } finally { await fs.rm(base, { recursive: true, force: true }); }
}
test('default uninstall preserves config, shared runtime, unknown files and other search paths', () => fixture(async root => {
  const plan = await inspectUninstall({ root });
  assert.equal(plan.files.length, 1);
  const result = await uninstallPayload({ root, fingerprint: plan.fingerprint });
  assert.equal(result.removed, 1);
  assert.equal(await fs.readFile(path.join(result.backup, 'addons/BotVision/bin/win64/BotVision.dll'), 'utf8'), 'plugin');
  for (const file of ['addons/BotVision/config.json', 'addons/BotVision/player.txt', 'addons/metamod/metaplugins.ini', 'cfg/my_bot_normal_config.cfg']) await fs.access(path.join(root, file));
  const info = await fs.readFile(path.join(root, 'gameinfo.gi'), 'utf8');
  assert.ok(!info.includes('botprofile')); assert.ok(info.includes('addons/metamod')); assert.ok(info.includes('custom_content'));
  const again = await inspectUninstall({ root }); assert.equal(again.files.length, 0); assert.equal(again.editGameinfo, false);
}));
test('full uninstall archives config and shared files with explicit choices', () => fixture(async root => {
  const opts = { root, removeShared: true, keepConfig: false };
  const plan = await inspectUninstall(opts);
  const result = await uninstallPayload({ ...opts, fingerprint: plan.fingerprint });
  assert.equal(result.removed, 4);
  assert.ok(!(await fs.readFile(path.join(root, 'gameinfo.gi'), 'utf8')).includes('addons/metamod'));
  assert.equal(await fs.readFile(path.join(root, 'addons/BotVision/player.txt'), 'utf8'), 'custom file');
}));
test('changed files invalidate the confirmation before touching data', () => fixture(async root => {
  const plan = await inspectUninstall({ root });
  await fs.writeFile(path.join(root, 'addons/BotVision/bin/win64/BotVision.dll'), 'new');
  await assert.rejects(uninstallPayload({ root, fingerprint: plan.fingerprint }), /重新扫描/);
  assert.equal((await fs.readdir(root)).some(n => n.startsWith('.rain-alley-')), false);
}));
test('write failure rolls files and gameinfo back', () => fixture(async root => {
  const original = await fs.readFile(path.join(root, 'gameinfo.gi'), 'utf8');
  const plan = await inspectUninstall({ root }); let failed = false;
  const io = { ...fs, writeFile: async (file, data, ...opts) => { if (file === path.join(root, 'gameinfo.gi') && !failed) { failed = true; throw new Error('disk failure'); } return fs.writeFile(file, data, ...opts); } };
  await assert.rejects(uninstallPayload({ root, fingerprint: plan.fingerprint, io }), /已恢复原文件/);
  assert.equal(await fs.readFile(path.join(root, 'gameinfo.gi'), 'utf8'), original);
  assert.equal(await fs.readFile(path.join(root, 'addons/BotVision/bin/win64/BotVision.dll'), 'utf8'), 'plugin');
}));
test('directory junctions cannot redirect uninstall outside the game', () => fixture(async (root, base) => {
  const outside = path.join(base, 'outside'); await fs.mkdir(outside);
  await fs.rm(path.join(root, 'addons/BotVision'), { recursive: true });
  await fs.symlink(outside, path.join(root, 'addons/BotVision'), 'junction');
  await assert.rejects(inspectUninstall({ root }), /链接|联接/);
}));
