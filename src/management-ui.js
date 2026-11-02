const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roleName = role => ({root:'雨巷主理人',admin:'管理员',player:'普通用户'}[role] || '普通用户');
const time = value => value ? new Date(value * 1000).toLocaleString('zh-CN') : '暂无记录';
let page, generation = 0;
export function closeManagement() { generation++; page?.remove(); page = null; }
export async function openManagement(desktop, confirm, back) {
  closeManagement();
  const current = generation;
  page = document.createElement('section'); page.className = 'management-page';
  page.innerHTML = `<header class="management-heading"><div><span class="management-eyebrow">RAIN ALLEY · COMMUNITY</span><h1>雨巷后台</h1><p>让每一位巷中来客，都能安心停留。</p></div><button data-back>返回雨巷</button></header><div class="management-toolbar"><form><label>查找账号<input name="search" maxlength="60" placeholder="输入账号名称"></label><button>查找</button></form><button data-refresh>刷新列表</button><button data-audit hidden>操作记录</button></div><p class="management-feedback" role="status" aria-live="polite">正在核验后台权限…</p><div class="management-layout"><section class="management-users" aria-label="用户列表"></section><section class="management-detail" aria-label="用户详情"><p>选择一位用户，查看资料与账户状态。</p></section></div><button data-more hidden>继续载入</button>`;
  document.querySelector('#settingsPage').parentElement.append(page);
  const host = page, find = s => host.querySelector(s);
  let users = [], after = '', query = '', actor, selected = '', busy = false, requestId = 0;
  const feedback = text => { if (current === generation) find('.management-feedback').textContent = text; };
  const valid = () => current === generation;
  find('[data-back]').onclick = back;
  function details(user) {
    selected = user.username;
    const root = actor.role === 'root', ordinary = user.role === 'player', protectedUser = user.role === 'root';
    find('.management-detail').innerHTML = `<span class="management-badge">${roleName(user.role)}</span><h2>${escape(user.profile.displayName || user.username)}</h2><p class="management-account">${escape(user.username)}</p><dl>${[['账户状态',user.disabled?'已停用':'正常'],['禁言状态',user.mutedUntil > Date.now()/1000 ? '禁言至 '+time(user.mutedUntil):'可正常发言'],['禁言原因',user.muteReason || '未填写'],['注册时间',time(user.createdAt)],['最近登录',time(user.lastLoginAt)],['最近活动',time(user.lastSeenAt)],['有效登录数',user.activeSessions],['留言与回复',user.commentsCount],['下次发言时间',user.role==='root'?'不限频次':time(user.nextCommentAt)],['资料更新时间',time(user.profileUpdatedAt)]].map(([key,value])=>`<div><dt>${key}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><details><summary>查看公开页面与样式资料</summary><pre>${escape(JSON.stringify(user.profile,null,2))}</pre></details>${protectedUser?'<p>主理人账户受到保护。</p>':`<form class="management-editor">${(ordinary || root)?'<fieldset><legend>发言管理</legend><label>禁言时长<div class="management-duration"><input name="duration" type="number" min="1" max="43200" value="10"><select name="unit" aria-label="时长单位"><option value="1">分钟</option><option value="60">小时</option><option value="1440">天</option></select></div></label><label>禁言原因<input name="reason" maxlength="200" placeholder="向用户说明原因"></label><button type="button" data-action="mute">设置禁言</button><button type="button" data-action="unmute">解除禁言</button></fieldset>':''}${root?`<fieldset><legend>账号与资料</legend><label>用户身份<select name="role"><option value="player" ${ordinary?'selected':''}>普通用户</option><option value="admin" ${!ordinary?'selected':''}>管理员</option></select></label><button type="button" data-action="role">保存身份</button><label>展示名称<input name="displayName" maxlength="60" value="${escape(user.profile.displayName || '')}"></label><label>个人简介<textarea name="bio" maxlength="500">${escape(user.profile.bio || '')}</textarea></label><button type="button" data-action="profile">保存公开资料</button><button type="button" data-action="status">${user.disabled?'恢复账户':'停用账户'}</button><button type="button" data-action="sessions">撤销所有登录</button></fieldset>`:''}${ordinary?'<fieldset class="management-danger"><legend>删除账户</legend><p>该账号、登录状态与个人资料将被删除，原发言显示为已删除，其他用户的回复保留。</p><label>输入完整账号确认<input name="confirmUsername" autocomplete="off" placeholder="输入待删除账号"></label><button type="button" data-action="delete">删除普通账号</button></fieldset>':''}</form>`}`;
    find('.management-editor')?.addEventListener('submit', e => e.preventDefault());
    for (const button of host.querySelectorAll('[data-action]')) button.onclick = async () => {
      if (busy) return;
      const form = find('.management-editor'), data = new FormData(form);
      let action = button.dataset.action, payload = {action,username:user.username};
      if (action === 'mute') { payload.minutes=Number(data.get('duration'))*Number(data.get('unit')); payload.reason=data.get('reason'); if (!Number.isInteger(payload.minutes)||payload.minutes<1||payload.minutes>43200) return feedback('请填写 1 分钟至 30 天的禁言时长。'); }
      if (action === 'unmute') { payload.action='mute'; payload.minutes=0; }
      if (action === 'role') payload.role=data.get('role');
      if (action === 'status') payload.disabled=!user.disabled;
      if (action === 'profile') { payload.displayName=data.get('displayName'); payload.bio=data.get('bio'); }
      if (action === 'delete') { payload.confirmUsername=data.get('confirmUsername'); if(payload.confirmUsername!==user.username) return feedback('请输入待删除用户的完整账号。'); }
      busy=true; for(const b of form.querySelectorAll('button')) b.disabled=true;
      try {
        if (['delete','role','status','sessions'].includes(action) && !await confirm(button.textContent, `操作对象：${user.username}。${action==='delete'?'删除后无法恢复，请确认。':'确认应用本次更改？'}`, [{label:'取消',value:false},{label:'确认操作',value:true,danger:action==='delete'}])) return;
        if (!valid()) return; await desktop.management(payload); if (!valid()) return; await list(); feedback('更改已保存，列表已刷新。');
      } catch(e) { feedback(e.message || '操作失败，请刷新后再试。'); } finally { busy=false; if(valid()) for(const b of host.querySelectorAll('[data-action]')) b.disabled=false; }
    };
  }
  async function list(more=false) {
    const id=++requestId; feedback('正在读取用户状态…');
    try {
      const result=await desktop.management({action:'list',q:query,after:more?after:''}); if(!valid() || id!==requestId)return;
      actor=result.actor; users=more?[...users,...result.users]:result.users; after=result.nextAfter;
      find('[data-audit]').hidden=actor.role!=='root'; find('[data-more]').hidden=!after;
      find('.management-users').innerHTML=users.map(u=>`<button class="management-user" data-user="${escape(u.username)}"><span><strong>${escape(u.profile.displayName || u.username)}</strong><small>${escape(u.username)}</small></span><span class="management-badge">${roleName(u.role)}${u.disabled?' · 已停用':u.mutedUntil>result.serverNow?' · 禁言中':''}</span></button>`).join('') || '<p>没有找到符合条件的用户。</p>';
      for(const b of host.querySelectorAll('[data-user]')) b.onclick=()=>details(users.find(u=>u.username===b.dataset.user));
      const chosen=users.find(u=>u.username===selected); if(chosen)details(chosen); else {selected='';find('.management-detail').innerHTML='<p>选择一位用户，查看资料与账户状态。</p>';}
      feedback(`${roleName(actor.role)} ${actor.username} · 共 ${result.total} 位${actor.role==='admin'?'普通':''}用户，已载入 ${users.length} 位`);
    } catch(e) { if(valid()&&id===requestId){users=[];find('.management-users').replaceChildren();find('.management-detail').textContent='暂时无法读取，请刷新重试。';feedback(e.message);} }
  }
  find('form').onsubmit=e=>{e.preventDefault();query=new FormData(e.currentTarget).get('search').trim();list();};
  find('[data-refresh]').onclick=()=>list(); find('[data-more]').onclick=()=>list(true);
  find('[data-audit]').onclick=async()=>{try{const result=await desktop.management({action:'audit'});if(!valid())return;find('.management-detail').innerHTML='<h2>最近操作</h2>'+result.entries.map(e=>`<article class="management-log"><strong>${escape(e.actor)} → ${escape(e.target)}</strong><p>${escape(({role:'身份调整',mute:'禁言调整',status:'账户状态',profile:'资料编辑',sessions:'撤销登录',delete:'删除账号'})[e.action] || e.action)} · ${escape(e.detail)}</p><small>${time(e.createdAt)}</small></article>`).join('');}catch(e){feedback(e.message);}};
  await list();
}
