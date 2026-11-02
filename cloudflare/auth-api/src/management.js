const deletedIdentity = '__deleted__';
// These predicates run inside each write, so a concurrent demotion cannot keep
// an old session's management privileges. Clients never supply actor identity.
const actorRoot = "EXISTS(SELECT 1 FROM accounts a WHERE a.username=?1 AND a.role='root')";
const actorStaff = "EXISTS(SELECT 1 FROM accounts a WHERE a.username=?1 AND (a.role='root' OR EXISTS(SELECT 1 FROM community_moderators m WHERE m.username=a.username)))";
const ordinary = "EXISTS(SELECT 1 FROM accounts t WHERE t.username=?2 AND t.role='player' AND NOT EXISTS(SELECT 1 FROM community_moderators m WHERE m.username=t.username))";
const targetExists = "EXISTS(SELECT 1 FROM accounts t WHERE t.username=?2 AND t.role!='root')";
export async function management(request, env, { authenticate, readJson, json, error, cleanProfile }) {
  const actor = await authenticate(env, request);
  if (!actor) return error(401,'登录已失效，请重新登录。');
  if (!['root','admin'].includes(actor.role)) return error(403,'只有雨巷主理人和管理员可以进入后台。');
  const url = new URL(request.url);
  if (url.pathname === '/api/management/users' && request.method === 'GET') {
    const q=(url.searchParams.get('q')||'').trim().slice(0,60), after=url.searchParams.get('after')||'';
    const scope=actor.role==='root'?'1=1':"a.role='player' AND m.username IS NULL";
    const where=`a.username!='${deletedIdentity}' AND ${scope} AND (?1='' OR instr(lower(a.username),lower(?1))>0) AND a.username>?2 COLLATE NOCASE`;
    const rows=await env.DB.prepare(`SELECT a.username,a.role,a.created_at AS createdAt,m.username AS moderator,COALESCE(s.muted_until,0) AS mutedUntil,COALESCE(s.mute_reason,'') AS muteReason,COALESCE(s.disabled,0) AS disabled,COALESCE(s.last_login_at,0) AS lastLoginAt,COALESCE(s.last_seen_at,0) AS lastSeenAt,p.profile_json AS profileJson,p.updated_at AS profileUpdatedAt,(SELECT COUNT(*) FROM comments c WHERE c.username=a.username) AS commentsCount,(SELECT COUNT(*) FROM sessions v WHERE v.username=a.username AND v.expires_at>?3) AS activeSessions,(SELECT MAX(created_at)+3600 FROM comments c WHERE c.username=a.username) AS nextCommentAt FROM accounts a LEFT JOIN community_moderators m ON m.username=a.username LEFT JOIN account_status s ON s.username=a.username LEFT JOIN profiles p ON p.username=a.username WHERE ${where} ORDER BY a.username COLLATE NOCASE LIMIT 51`).bind(q,after,Math.floor(Date.now()/1000)).all();
    const users=rows.results.slice(0,50).map(row=>{let profile={};try{profile=JSON.parse(row.profileJson||'{}');}catch{} const {profileJson,moderator,...rest}=row;return {...rest,disabled:!!row.disabled,role:row.role==='root'?'root':moderator?'admin':'player',profile};});
    const count=await env.DB.prepare(`SELECT COUNT(*) AS total FROM accounts a LEFT JOIN community_moderators m ON m.username=a.username WHERE a.username!='${deletedIdentity}' AND ${scope} AND (?1='' OR instr(lower(a.username),lower(?1))>0)`).bind(q).first();
    return json({users,total:count.total,nextAfter:rows.results.length>50?users.at(-1).username:null,serverNow:Math.floor(Date.now()/1000),actor:{username:actor.username,role:actor.role}});
  }
  if(url.pathname==='/api/management/audit' && request.method==='GET'){
    if(actor.role!=='root')return error(403,'操作记录仅向主理人开放。');
    const rows=await env.DB.prepare('SELECT actor,target,action,detail,created_at AS createdAt FROM management_audit ORDER BY id DESC LIMIT 100').all();return json({entries:rows.results});
  }
  const match=/^\/api\/management\/users\/([^/]+)$/.exec(url.pathname);
  if(!match || !['PATCH','DELETE'].includes(request.method))return error(405,'不支持该后台操作。');
  let target;try{target=decodeURIComponent(match[1]);}catch{return error(400,'账号格式不正确。');}
  if(!/^[A-Za-z0-9_-]{4,24}$/.test(target)||target.toLowerCase()===deletedIdentity)return error(400,'账号无效。');
  const input=await readJson(request);
  if(!input)return error(400,'操作参数无效。');
  const action=request.method==='DELETE'?'delete':input.action;
  const targetRow=await env.DB.prepare('SELECT username,role FROM accounts WHERE username=?1').bind(target).first();
  if(!targetRow)return error(404,'这位用户不存在，可能已被删除。');
  if(targetRow.role==='root')return error(403,'主理人账户受到保护。');
  const permission=action==='role'||action==='status'||action==='profile'||action==='sessions'?`${actorRoot} AND ${targetExists}`:action==='mute'?`(${actorRoot} AND ${targetExists}) OR (${actorStaff} AND ${ordinary})`:`${actorStaff} AND ${ordinary}`;
  const bind=[actor.username,targetRow.username];
  let statements=[], detail='';
  if(action==='role'){
    if(!['admin','player'].includes(input.role))return error(400,'请选择管理员或普通用户。');
    detail=input.role;
    const sql=input.role==='admin'?`INSERT OR IGNORE INTO community_moderators(username) SELECT ?2 WHERE ${permission}`:`DELETE FROM community_moderators WHERE username=?2 AND ${permission}`;
    statements.push(env.DB.prepare(sql).bind(...bind));
  }else if(action==='mute'){
    if(!Number.isInteger(input.minutes)||input.minutes<0||input.minutes>43200)return error(400,'禁言时间需为 1 分钟至 30 天；0 表示解除禁言。');
    const reason=typeof input.reason==='string'?input.reason.trim().slice(0,200):'';
    const until=input.minutes?Math.floor(Date.now()/1000)+input.minutes*60:0;detail=JSON.stringify({minutes:input.minutes,reason});
    statements.push(env.DB.prepare(`INSERT INTO account_status(username,muted_until,mute_reason) SELECT ?2,?3,?4 WHERE ${permission} ON CONFLICT(username) DO UPDATE SET muted_until=excluded.muted_until,mute_reason=excluded.mute_reason`).bind(...bind,until,reason));
  }else if(action==='status'){
    if(typeof input.disabled!=='boolean')return error(400,'账户状态无效。');detail=input.disabled?'disabled':'enabled';
    statements.push(env.DB.prepare(`INSERT INTO account_status(username,disabled) SELECT ?2,?3 WHERE ${permission} ON CONFLICT(username) DO UPDATE SET disabled=excluded.disabled`).bind(...bind,input.disabled?1:0));
  }else if(action==='profile'){
    if(typeof input.displayName!=='string'||typeof input.bio!=='string')return error(400,'资料格式无效。');
    const old=await env.DB.prepare('SELECT profile_json AS data FROM profiles WHERE username=?1').bind(targetRow.username).first();let profile={};try{profile=JSON.parse(old?.data||'{}');}catch{}
    profile=cleanProfile({...profile,displayName:input.displayName,bio:input.bio});if(!profile)return error(400,'资料格式无效。');detail='更新展示名称与简介';
    statements.push(env.DB.prepare(`INSERT INTO profiles(username,profile_json,updated_at) SELECT ?2,?3,?4 WHERE ${permission} ON CONFLICT(username) DO UPDATE SET profile_json=excluded.profile_json,updated_at=excluded.updated_at`).bind(...bind,JSON.stringify(profile),Math.floor(Date.now()/1000)));
  }else if(action==='sessions'){
    detail='撤销登录';statements.push(env.DB.prepare(`DELETE FROM sessions WHERE username=?2 AND ${permission}`).bind(...bind));
  }else if(action==='delete'){
    if(input.confirmUsername!==targetRow.username)return error(400,'请输入完整账号以确认删除。');
    detail='删除普通账户；保留其他用户回复';
    // Batch is atomic. The last statement deletes the account; FK cascades remove
    // sessions/profile/state. Tombstones preserve replies written by other people.
    statements.push(env.DB.prepare(`UPDATE comments SET username='${deletedIdentity}',body='内容已删除',deleted_at=COALESCE(deleted_at,?3) WHERE username=?2 AND ${permission}`).bind(...bind,Math.floor(Date.now()/1000)));
    statements.push(env.DB.prepare(`DELETE FROM accounts WHERE username=?2 AND ${permission}`).bind(...bind));
  }else{return error(400,'未知后台操作。');}
  // Audit and mutation share the transaction; a failed write cannot lose its log.
  statements.unshift(env.DB.prepare(`INSERT INTO management_audit(actor,target,action,detail,created_at) SELECT ?1,?2,?3,?4,?5 WHERE (${permission})`).bind(...bind,action,detail,Math.floor(Date.now()/1000)));
  const results=await env.DB.batch(statements);
  if(!results.at(-1)?.meta?.changes)return error(409,'权限或账户状态已经变化，或没有需要修改的内容。请刷新后再试。');
  return json({ok:true});
}
