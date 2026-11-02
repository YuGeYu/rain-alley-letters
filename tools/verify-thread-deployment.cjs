// Isolated live acceptance; never print passwords, recovery data or tokens.
const {app,net}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const vault=require('../src/developer-vault.cjs');
const suffix=crypto.randomBytes(5).toString('hex');
const report={feature:'thread-qa-'+suffix,accounts:['ThreadQA_'+suffix,'ThreadQB_'+suffix],checks:[],cleanupRequired:true};
const file=path.join(__dirname,'../release/thread-deployment-verification.json');
app.whenReady().then(async()=>{
 const tokens=[];
 async function call(route,method='GET',body,token){const r=await net.fetch('https://auth.600318.xyz'+route,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});return {status:r.status,data:await r.json()};}
 try{
  assert.equal((await call('/health')).status,200);report.checks.push('Electron strict HTTPS health 200');
  const credentials=await vault.read();assert.ok(credentials);
  const root=await call('/api/login','POST',credentials);assert.equal(root.status,200);assert.equal(root.data.account.role,'root');const rt=root.data.session.token;tokens.push(rt);
  const ps=[];for(const username of report.accounts){const r=await call('/api/register','POST',{username,password:crypto.randomBytes(24).toString('hex')});assert.equal(r.status,201);ps.push(r.data.session.token);tokens.push(r.data.session.token);}
  const route='/api/modules/'+report.feature+'/comments';
  const first=await call(route,'POST',{body:'隔离验收留言'},ps[0]);assert.equal(first.status,201);const id=first.data.comment.id;
  const reply=await call(route,'POST',{body:'隔离验收评论',replyToId:id},ps[1]);assert.equal(reply.status,201);
  const nested=await call(route,'POST',{body:'隔离验收引用回复',replyToId:reply.data.comment.id},rt);assert.equal(nested.status,201);
  const list=await call(route,'GET',null,rt);assert.equal(list.status,200);const c=list.data.comments.find(c=>c.id===nested.data.comment.id);assert.equal(c.rootId,id);assert.equal(c.replyToId,reply.data.comment.id);report.checks.push('live replies flatten under original message with quoted target');
  assert.equal((await call(route+'/'+id,'DELETE',null,ps[1])).status,403);report.checks.push('player cannot delete another player message');
  assert.equal((await call(route+'/'+reply.data.comment.id,'DELETE',null,ps[1])).status,200);report.checks.push('player deletes own reply during hourly lock');
  assert.equal((await call(route,'POST',{body:'不得绕过等待'},ps[1])).status,429);report.checks.push('deletion preserves shared hourly quota');
  assert.equal((await call(route+'/'+id,'DELETE',null,rt)).status,200);report.checks.push('root deletes ordinary player message');
  const after=await call(route,'GET',null,rt);assert.equal(after.data.comments.find(c=>c.id===id).body,'');assert.ok(after.data.comments.find(c=>c.id===nested.data.comment.id));report.checks.push('deleted body hidden and other replies retained');
  report.passed=true;
 }finally{for(const token of tokens)await call('/api/logout','POST',{},token).catch(()=>{});fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}).catch(e=>{console.error('Live thread verification failed: '+e.message);process.exitCode=1;}).finally(()=>app.quit());
