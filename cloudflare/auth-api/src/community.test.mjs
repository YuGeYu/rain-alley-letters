import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { handleRequest, hashPassword } from './index.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const name of fs.readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(fs.readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const wrap = (sql, args=[]) => ({
    bind(...values) { return wrap(sql, values); },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r=db.prepare(sql).run(...args); return { meta: { changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid) } }; },
  });
  const DB = { prepare: sql => wrap(sql), async batch(statements) { db.exec('BEGIN'); try { const out=[]; for(const s of statements) out.push(await s.run()); db.exec('COMMIT'); return out; } catch(e) {db.exec('ROLLBACK');throw e;} } };
  return { db, DB };
}
async function seed(f, name, role='player') {
  const h=await hashPassword('TestingPassword#123');
  f.db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?)').run(name,h.salt,h.hash,h.iterations,1,role);
  const token=crypto.getRandomValues(new Uint8Array(32)).toHex();
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toHex();
  f.db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash,name,Math.floor(Date.now()/1000)+10000,1);
  return token;
}
const req=(path, token, body, method='POST')=>new Request('https://test.local'+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
test('shared hourly lock, validation failures, concurrent sends, restart and boundary',async()=>{
  const f=fixture(); try {
    const token=await seed(f,'PlayerOne');
    assert.equal((await handleRequest(req('/api/modules/tool-one/comments',token,{body:''}),f)).status,400);
    const responses=await Promise.all(['one','two'].map(x=>handleRequest(req('/api/modules/tool-'+x+'/comments',token,{body:x}),f)));
    assert.deepEqual(responses.map(x=>x.status).sort(),[201,429]);
    const blocked=await handleRequest(req('/api/modules/tool-three/comments',token,{body:'hello'}),f);
    assert.equal(blocked.status,429); assert.ok(Number(blocked.headers.get('retry-after'))>3500);
    const listing=await handleRequest(req('/api/modules/tool-three/comments',token,null,'GET'),f);
    assert.ok((await listing.json()).community.nextAllowedAt>Date.now()/1000);
    f.db.prepare('UPDATE comments SET created_at=?').run(Math.floor(Date.now()/1000)-3600);
    assert.equal((await handleRequest(req('/api/modules/tool-three/comments',token,{body:'now'}),f)).status,201);
  } finally { f.db.close(); }
});
test('root has no community quota; rename preserves role and player rename preserves lock',async()=>{
  const f=fixture(); try {
    const token=await seed(f,'RootUser','root');
    for(let i=0;i<8;i++) assert.equal((await handleRequest(req('/api/modules/tool-one/comments',token,{body:'root'}),f)).status,201);
    const renamed=await handleRequest(req('/api/account',token,{currentPassword:'TestingPassword#123',newUsername:'RootRenamed'},'PUT'),f);
    assert.equal(renamed.status,200);assert.equal((await renamed.json()).account.role,'root');
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role='root'").get().n,1);
    const p=await seed(f,'PlayerOne');
    await handleRequest(req('/api/modules/tool-one/comments',p,{body:'player'}),f);
    assert.equal((await handleRequest(req('/api/account',p,{currentPassword:'TestingPassword#123',newUsername:'PlayerRenamed'},'PUT'),f)).status,200);
    assert.equal((await handleRequest(req('/api/modules/tool-two/comments',p,{body:'player'}),f)).status,429);
    assert.equal((await handleRequest(req('/api/modules/tool-two/comments',token,{body:'root'}),f)).status,201);
  } finally { f.db.close(); }
});
test('registration ignores client role escalation',async()=>{
  const f=fixture();try {
    const response=await handleRequest(req('/api/register','',{username:'NewPlayer',password:'TestingPassword#123',role:'root'}),f);
    assert.equal(response.status,201); assert.equal(f.db.prepare('SELECT role FROM accounts WHERE username=?').get('NewPlayer').role,'player');
  }finally{f.db.close();}
});
