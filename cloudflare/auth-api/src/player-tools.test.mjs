import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,seed } from '../../../tools/player-tools-fixture.mjs';
import { handleRequest } from './index.js';
const tool={name:'玩家故事',description:'没有资源包也没有后端。',html:'<main><h1>雨巷故事</h1><p>一封信。</p></main>',backend:'',links:[]};
const req=(method,path,token,body)=>new Request('https://local.test/api/tools'+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
test('publish frontend without links, public listing, backend source, ownership and revision',async()=>{
 const f=fixture();try{const token=await seed(f,'CreatorOne'),other=await seed(f,'CreatorTwo');
 assert.equal((await handleRequest(req('POST','',null,tool),f)).status,401);
 const created=await handleRequest(req('POST','',token,tool),f);assert.equal(created.status,201);const {id}=await created.json();
 const list=await(await handleRequest(req('GET',''),f)).json();assert.equal(list.tools.length,1);assert.equal(list.tools[0].verified,false);assert.match(list.tools[0].notice,/未经检验/);assert.equal(list.tools[0].html,undefined);
 const full=await(await handleRequest(req('GET','/'+id),f)).json();assert.deepEqual(full.tool.links,[]);assert.equal(full.tool.html,tool.html);
 assert.equal((await handleRequest(req('PUT','/'+id,other,{...tool,revision:1}),f)).status,403);
 assert.equal((await handleRequest(req('PUT','/'+id,token,{...tool,backend:'module.exports = async () => 1;',revision:1}),f)).status,200);
 assert.equal((await handleRequest(req('PUT','/'+id,token,{...tool,revision:1}),f)).status,409);
 assert.equal((await handleRequest(req('DELETE','/'+id,other),f)).status,403);
 assert.equal((await handleRequest(req('DELETE','/'+id,token),f)).status,200);
 assert.equal((await handleRequest(req('GET','/'+id),f)).status,404);
 }finally{f.db.close();}
});
test('reject backend-only, resource uploads, invalid links, oversize and streaming bodies',async()=>{
 const f=fixture();try{const token=await seed(f,'CreatorOne');
 for(const body of [{...tool,html:''},{...tool,html:'<!-- page -->'},{...tool,archive:'xxx'},{...tool,links:['https://example.com/package.zip']},{...tool,html:'<p>'+ '雨'.repeat(70000)+'</p>'},{...tool,html:'<a href="data:application/zip;base64,AAAA">资源包</a>'}]) assert.equal((await handleRequest(req('POST','',token,body),f)).status,400);
 assert.equal((await handleRequest(req('POST','',token,{...tool,links:['https://pan.quark.cn/s/example']}),f)).status,201);
 const request=new Request('https://local.test/api/tools',{method:'POST',headers:{authorization:'Bearer '+token},body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(' '.repeat(330000)));c.close();}}),duplex:'half'});
 assert.equal((await handleRequest(request,f)).status,400);
 }finally{f.db.close();}
});
test('hourly quota persists through rename and caps concurrent submissions',async()=>{
 const f=fixture();try{const token=await seed(f,'CreatorOne');
 for(let n=0;n<9;n++)assert.equal((await handleRequest(req('POST','',token,tool),f)).status,201);
 const rename=new Request('https://local.test/api/account',{method:'PUT',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({currentPassword:'LocalPreviewPassword#123',newUsername:'CreatorNew'})});
 assert.equal((await handleRequest(rename,f)).status,200);assert.equal(f.db.prepare('SELECT count(*) AS n FROM player_tools WHERE username=?').get('CreatorNew').n,9);
 const responses=await Promise.all([1,2,3].map(()=>handleRequest(req('POST','',token,tool),f)));
 assert.deepEqual(responses.map(x=>x.status).sort(),[201,429,429]);
 }finally{f.db.close();}
});
test('daily quota, per-owner cap, mine filter and cursor pagination',async()=>{
 const f=fixture();try{const token=await seed(f,'CreatorOne');await seed(f,'CreatorTwo');
 const insert=f.db.prepare('INSERT INTO player_tools(username,name,description,html,backend,links_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
 for(let i=0;i<50;i++)insert.run('CreatorOne','工具'+i,'介绍','<p>页面</p>','','[]',1,1);
 insert.run('CreatorTwo','别人的故事','介绍','<p>页面</p>','','[]',1,1);
 assert.equal((await handleRequest(req('POST','',token,tool),f)).status,409);
 const first=await(await handleRequest(req('GET',''),f)).json();assert.equal(first.tools.length,20);assert.equal(first.next,32);
 const second=await(await handleRequest(req('GET','?before='+first.next),f)).json();assert.equal(second.tools[0].id,31);
 const mine=await(await handleRequest(req('GET','?mine=1',token),f)).json();assert.ok(mine.tools.every(t=>t.owner==='CreatorOne'));
 f.db.prepare('DELETE FROM player_tools WHERE username=?').run('CreatorOne');
 const key=f.db.prepare('SELECT quota_key FROM player_tool_publishers').get().quota_key;
 const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('tools:daily:'+key))).toString('hex');
 f.db.prepare('UPDATE auth_throttle SET attempts=30 WHERE bucket_hash=?').run(hash);
 assert.equal((await handleRequest(req('POST','',token,tool),f)).status,429);
 }finally{f.db.close();}
});
