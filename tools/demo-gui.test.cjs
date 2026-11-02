const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { rememberGui, uninstallGui } = require('../src/demo-gui.cjs');
test('GUI removal preserves user files and records on cancel, verifies actual removal', async () => {
 const base = await fs.mkdtemp(path.join(os.tmpdir(), 'alley-gui-remove-'));
 try {
  const target=path.join(base,'cs2-demotracer-gui.exe'), record=path.join(base,'gui.json');
  await fs.writeFile(target,'fixture'); await rememberGui(record,target);
  await fs.writeFile(path.join(base,'personal.dem'),'keep');
  await assert.rejects(uninstallGui(target,record),/官方卸载程序/);
  await fs.writeFile(path.join(base,'uninstall.exe'),'fixture');
  assert.deepEqual(await uninstallGui(target,record,async()=>{}),{removed:false});
  await fs.access(record);
  assert.deepEqual(await uninstallGui(target,record,async(file,dir)=>{assert.equal(dir,base);assert.equal(path.basename(file),'uninstall.exe');await fs.unlink(target);}),{removed:true});
  await assert.rejects(fs.access(record)); assert.equal(await fs.readFile(path.join(base,'personal.dem'),'utf8'),'keep');
 } finally { await fs.rm(base,{recursive:true,force:true}); }
});
