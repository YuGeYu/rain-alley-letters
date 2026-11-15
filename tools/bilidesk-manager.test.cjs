const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createManager } = require('../src/bilidesk-manager.cjs');
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(),'bili-safety-'));
  const root = path.join(base,'managed');
  const manifest = { version:'test', archiveSha256:'test', files:{'BiliDesk.exe':hash('test-exe')} };
  let launched;
  const manager = createManager({ root, assets:base, manifest, profile:path.join(base,'isolated-profile'), launcher:async (exe,env) => { launched={exe,env}; } });
  return {base,root,manifest,manager,get launched(){return launched;}};
}
test('real disk status, tamper detection and isolated launch environment', async () => {
  const f=await fixture();
  try {
    assert.equal((await f.manager.status()).installed,false);
    await fs.mkdir(f.manager.directory);
    await fs.writeFile(path.join(f.manager.directory,'BiliDesk.exe'),'test-exe');
    assert.equal((await f.manager.status()).installed,true);
    await f.manager.launch();
    assert.equal(f.launched.exe,path.join(f.manager.directory,'BiliDesk.exe'));
    assert.equal(f.launched.env.RAIN_ALLEY_BILIDESK_PROFILE,path.join(f.base,'isolated-profile'));
    await fs.writeFile(path.join(f.manager.directory,'BiliDesk.exe'),'tampered');
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
    await fs.writeFile(path.join(f.base,'BiliDesk-win-x64.zip'),'corrupt');
    await assert.rejects(f.manager.install(),/校验失败/);
    assert.deepEqual(await fs.readdir(f.root),[]);
  }finally{await fs.rm(f.base,{recursive:true,force:true});}
});

test('temporary Windows directory locks recover and other move errors preserve the old install',async(t)=>{
  const f=await fixture();
  const rename=fs.rename;
  let mocked;
  try{
    await f.manager.status();await fs.mkdir(f.manager.directory);
    await fs.writeFile(path.join(f.manager.directory,'personal.txt'),'keep');
    let calls=0;
    mocked=t.mock.method(fs,'rename',async(...args)=>{
      if(++calls<=2)throw Object.assign(new Error('temporary scanner lock'),{code:calls===1?'EPERM':'EBUSY'});
      return rename(...args);
    });
    const result=await f.manager.uninstall();
    assert.equal(calls,3);
    assert.equal(await fs.readFile(path.join(result.backup,'personal.txt'),'utf8'),'keep');
    mocked.mock.restore();
    await rename(result.backup,f.manager.directory);
    calls=0;
    mocked=t.mock.method(fs,'rename',async()=>{calls++;throw Object.assign(new Error('disk failure'),{code:'EIO'});});
    await assert.rejects(f.manager.uninstall(),{code:'EIO'});
    assert.equal(calls,1);
    assert.equal(await fs.readFile(path.join(f.manager.directory,'personal.txt'),'utf8'),'keep');
  }finally{mocked?.mock.restore();await fs.rm(f.base,{recursive:true,force:true});}
});
