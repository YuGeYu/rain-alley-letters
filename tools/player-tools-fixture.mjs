import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { hashPassword } from '../cloudflare/auth-api/src/index.js';
export function fixture(filename=':memory:') {
 const db=new DatabaseSync(filename);
 for(const file of fs.readdirSync(new URL('../cloudflare/auth-api/migrations/',import.meta.url)).sort()) db.exec(fs.readFileSync(new URL('../cloudflare/auth-api/migrations/'+file,import.meta.url),'utf8'));
 const wrap=(sql,args=[])=>({bind(...v){return wrap(sql,v);},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}});
 return {db,DB:{prepare:sql=>wrap(sql),async batch(rows){db.exec('BEGIN');try{const out=[];for(const row of rows)out.push(await row.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}}};
}
export async function seed(f,name) {
 const h=await hashPassword('LocalPreviewPassword#123');
 f.db.prepare('INSERT INTO accounts(username,password_salt,password_hash,password_iterations,created_at,role) VALUES(?,?,?,?,?,?)').run(name,h.salt,h.hash,h.iterations,Math.floor(Date.now()/1000),'player');
 const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
 f.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash,name,Math.floor(Date.now()/1000)+86400,1);
 return token;
}
