const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { installOfficialPayload } = require('../src/cs2-installer.cjs');
async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alley-transaction-test-'));
  await fs.mkdir(path.join(root, 'addons', 'old'), { recursive: true });
  await fs.writeFile(path.join(root, 'addons', 'old', 'mine.txt'), 'original-plugin');
  await fs.writeFile(path.join(root, 'gameinfo.gi'), 'original-gameinfo');
  const extract = async (_archive, stage) => {
    for (const name of ['addons/new', 'cfg', 'overrides']) await fs.mkdir(path.join(stage, name), { recursive: true });
    for (const name of ['addons/new/plugin.dll', 'gameinfo.gi', 'Panel v1.4.7.exe']) await fs.writeFile(path.join(stage, name), 'official');
  };
  try { await run(root, extract); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
test('cleanup EBUSY after commit keeps successfully installed files', () => fixture(async (root, extract) => {
  const pending = [];
  const io = { ...fs, rm: async (file, options) => { if (path.basename(file).startsWith('rain-alley-cs2-')) { pending.push(file); throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } return fs.rm(file, options); } };
  const result = await installOfficialPayload({ root, archive: 'fixture', keepBackup: false, io, extract });
  assert.equal(result.installed, true); assert.equal(result.cleanupPending.length, 1);
  assert.equal(await fs.readFile(path.join(root, 'gameinfo.gi'), 'utf8'), 'official');
  assert.equal(await fs.readFile(path.join(root, 'addons/new/plugin.dll'), 'utf8'), 'official');
  for (const folder of pending) await fs.rm(folder, { recursive: true, force: true });
}));
test('copy failure restores overwritten files and removed plugins', () => fixture(async (root, extract) => {
  const io = { ...fs, copyFile: async (source, destination) => { if (source.endsWith('gameinfo.gi')) { await fs.writeFile(destination, 'partial'); throw new Error('injected disk failure'); } return fs.copyFile(source, destination); } };
  await assert.rejects(installOfficialPayload({ root, archive: 'fixture', keepBackup: false, io, extract }), /已恢复原文件/);
  assert.equal(await fs.readFile(path.join(root, 'gameinfo.gi'), 'utf8'), 'original-gameinfo');
  assert.equal(await fs.readFile(path.join(root, 'addons/old/mine.txt'), 'utf8'), 'original-plugin');
  assert.equal((await fs.readdir(root)).some(name => name.startsWith('.rain-alley-')), false);
}));
test('rollback failure preserves original data even when backup was declined', () => fixture(async (root, extract) => {
  const io = { ...fs, copyFile: async () => { throw new Error('injected copy failure'); }, rename: async (source, target) => { if (source.includes('.rain-alley-rollback-')) throw new Error('injected restore failure'); return fs.rename(source, target); } };
  await assert.rejects(installOfficialPayload({ root, archive: 'fixture', keepBackup: false, io, extract }), /恢复记录已保留/);
  const backup = (await fs.readdir(root)).find(name => name.startsWith('.rain-alley-rollback-'));
  assert.ok(backup); assert.equal(await fs.readFile(path.join(root, backup, 'addons/old/mine.txt'), 'utf8'), 'original-plugin');
  assert.equal(JSON.parse(await fs.readFile(path.join(root, backup, 'rain-alley-transaction.json'), 'utf8')).phase, 'recovery-needed');
}));
