const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createManager } = require('../src/xcmusic-manager.cjs');
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(),'xcm-safety-'));
  const root = path.join(base,'managed');
  const manifest = { version:'test', archiveSha256:'test', files:{'XCMusic.exe':hash('test-exe')} };
  let launched;
  const manager = createManager({ root, assets:base, manifest, profile:path.join(base,'isolated-profile'), launcher:async (exe,env) => { launched={exe,env}; } });
  return {base,root,manifest,manager,get launched(){return launched;}};
}
test('real disk status, tamper detection and isolated launch environment', async () => {
  const f=await fixture();
  try {
    assert.equal((await f.manager.status()).installed,false);
    await fs.mkdir(f.manager.directory);
    await fs.writeFile(path.join(f.manager.directory,'XCMusic.exe'),'test-exe');
    assert.equal((await f.manager.status()).installed,true);
    await f.manager.launch();
    assert.equal(f.launched.exe,path.join(f.manager.directory,'XCMusic.exe'));
    assert.equal(f.launched.env.RAIN_ALLEY_XCMUSIC_PROFILE,path.join(f.base,'isolated-profile'));
    await fs.writeFile(path.join(f.manager.directory,'XCMusic.exe'),'tampered');
    assert.equal((await f.manager.status()).damaged,true);
    await assert.rejects(f.manager.launch(),/安装或修复/);
  } finally {await fs.rm(f.base,{recursive:true,force:true});}
});
test('uninstall preserves unknown files and personal profile in recovery backup',async()=>{
  const f=await fixture();
  try {
    await f.manager.status(); await fs.mkdir(f.manager.directory);
    await fs.writeFile(path.join(f.manager.directory,'personal.txt'),'keep');
    await fs.mkdir(path.join(f.base,'isolated-profile')); await fs.writeFile(path.join(f.base,'isolated-profile','session'),'keep-login');
    const result=await f.manager.uninstall();
    assert.equal(await fs.readFile(path.join(result.backup,'personal.txt'),'utf8'),'keep');
    assert.equal(await fs.readFile(path.join(f.base,'isolated-profile','session'),'utf8'),'keep-login');
    assert.equal((await f.manager.status()).installed,false);
  }finally{await fs.rm(f.base,{recursive:true,force:true});}
});
test('refuses linked installation roots and archives failing integrity', async()=>{
  const f=await fixture();
  try{
    await fs.mkdir(path.join(f.base,'other')); await fs.symlink(path.join(f.base,'other'),f.root,'junction');
    await assert.rejects(f.manager.status(),/链接/);
    await fs.unlink(f.root);
    await fs.writeFile(path.join(f.base,'XCMusic-win-x64.zip'),'corrupt');
    await assert.rejects(f.manager.install(),/校验失败/);
    assert.deepEqual(await fs.readdir(f.root),[]);
  }finally{await fs.rm(f.base,{recursive:true,force:true});}
});
