import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { handleRequest, hashPassword } from './index.js';

export function fixture() {
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
export async function seed(f, name, role='player') {
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

test('flat replies, moderation boundaries, tombstones and quota after deletion', async () => {
  const f = fixture(); try {
    const root = await seed(f, 'RootUser', 'root');
    const admin = await seed(f, 'AdminUser');
    f.db.prepare('INSERT INTO community_moderators VALUES (?)').run('AdminUser');
    const player = await seed(f, 'PlayerOne');
    const other = await seed(f, 'PlayerTwo');
    const post = async (token, body, replyToId, feature = 'tool-one') => handleRequest(req('/api/modules/' + feature + '/comments', token, { body, replyToId }), f);
    const remove = (token, id, feature = 'tool-one') => handleRequest(req('/api/modules/' + feature + '/comments/' + id, token, null, 'DELETE'), f);
    const first = await (await post(player, '留言')).json(); const id = first.comment.id;
    const reply = await (await post(root, '回复留言', id)).json();
    const nested = await (await post(root, '回复评论', reply.comment.id)).json();
    const rows = await (await handleRequest(req('/api/modules/tool-one/comments', player, null, 'GET'), f)).json();
    assert.equal(rows.comments.find(c => c.id === nested.comment.id).rootId, id);
    assert.equal(rows.comments.find(c => c.id === nested.comment.id).replyToId, reply.comment.id);
    assert.equal((await post(root, '跨工具', id, 'tool-two')).status, 404);
    assert.equal((await remove(other, id)).status, 403);
    assert.equal((await remove(admin, reply.comment.id)).status, 403);
    assert.equal((await remove(root, id)).status, 200);
    assert.equal((await post(player, '删除不重置等待')).status, 429);
    assert.equal((await post(root, '原留言已删', reply.comment.id)).status, 409);
    assert.equal((await remove(root, reply.comment.id)).status, 200);
    assert.equal((await remove(player, id)).status, 200);
    const deleted = await (await handleRequest(req('/api/modules/tool-one/comments', root, null, 'GET'), f)).json();
    assert.equal(deleted.comments.find(c => c.id === id).body, '');
    assert.ok(deleted.comments.find(c => c.id === nested.comment.id));
    const otherPost = await (await post(other, '管理员可删')).json();
    assert.equal((await remove(admin, otherPost.comment.id)).status, 200);
    assert.equal((await remove('', nested.comment.id)).status, 401);
    const adminPost = await (await post(admin, '管理员自己的内容')).json();
    assert.equal((await remove(root, adminPost.comment.id)).status, 403);
    assert.equal((await remove(admin, adminPost.comment.id)).status, 200);
    const rename = await handleRequest(req('/api/account', admin, { currentPassword:'TestingPassword#123', newUsername:'AdminRenamed' }, 'PUT'), f);
    assert.equal(rename.status, 200); assert.equal((await rename.json()).account.role, 'admin');
    assert.ok(f.db.prepare('SELECT username FROM community_moderators WHERE username=?').get('AdminRenamed'));
  } finally { f.db.close(); }
});

test('thread pagination includes all replies and keeps older roots reachable', async () => {
  const f = fixture(); try {
    const root = await seed(f, 'RootUser', 'root');
    for (let i = 0; i < 24; i++) await handleRequest(req('/api/modules/tool-one/comments', root, { body: '留言' + i }), f);
    for (let i = 0; i < 45; i++) await handleRequest(req('/api/modules/tool-one/comments', root, { body: '评论' + i, replyToId: 24 }), f);
    const page = await (await handleRequest(req('/api/modules/tool-one/comments', root, null, 'GET'), f)).json();
    assert.equal(page.comments.filter(c => !c.rootId).length, 20);
    assert.equal(page.comments.filter(c => c.rootId === 24).length, 45);
    const older = await (await handleRequest(req('/api/modules/tool-one/comments?before=' + page.nextBefore, root, null, 'GET'), f)).json();
    assert.equal(older.comments.length, 4); assert.equal(older.nextBefore, null);
  } finally { f.db.close(); }
});
