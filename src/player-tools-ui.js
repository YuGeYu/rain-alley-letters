import { cleanTool, UNVERIFIED } from './player-tool-schema.js';
const desktop = window.alleyDesktop;
const $ = id => document.getElementById(id);
const story = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:40px;background:#101820;color:#f0f5fa;font:17px/1.9 'Microsoft YaHei UI',sans-serif}main{max-width:680px;margin:auto}h1{color:#9bd9ff}button{padding:12px 24px;font:inherit;cursor:pointer}</style>
<main><p>一封玩家来信</p><h1>雨停之前的小故事</h1><p>那天，我在巷口捡到一封没有署名的信……</p><button id="read">翻到下一页</button><p id="next" aria-live="polite"></p></main>
<script>document.getElementById('read').onclick=()=>{document.getElementById('next').textContent='信上写着：下次路过，记得带一把伞。';};<\/script></html>`;
const installationPage = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{padding:32px;font:16px/1.8 'Microsoft YaHei UI';background:#101820;color:white}button{font:inherit;padding:12px;cursor:pointer}pre{white-space:pre-wrap}</style>
<h1>我的文件安装工具</h1><p>请先从作者提供的网盘链接下载文件，再选择文件与安装目录。同名文件会保留，不会覆盖。</p>
<!-- 在这里添加自己的网盘分享链接；没有资源时可以不填。 -->
<button id="install">选择文件并安装</button><pre id="status" role="status"></pre>
<script>document.getElementById('install').onclick=async()=>{const b=document.getElementById('install'),s=document.getElementById('status');b.disabled=true;try{const source=await rainTool.chooseFile();if(!source)return;const destination=await rainTool.chooseDirectory();if(!destination)return;s.textContent='正在安装…';const result=await rainTool.call('install',{source,destination});s.textContent='已安装：'+result.installed;}catch(e){s.textContent=e.message;}finally{b.disabled=false;}};<\/script></html>`;
const installationBackend = `const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
module.exports = async (action, args, context) => {
  if (action !== 'install') throw new Error('未知操作');
  if (!path.isAbsolute(args.source) || !path.isAbsolute(args.destination)) throw new Error('请选择完整路径');
  if (!(await fs.stat(args.source)).isFile()) throw new Error('请选择一个文件');
  if (!(await fs.stat(args.destination)).isDirectory()) throw new Error('请选择目录');
  const installed = path.join(args.destination, path.basename(args.source));
  // 安装示例：将用户选中的单个文件复制到目录；同名文件不覆盖。
  // 可替换为自己的解压、配置等流程，并为变更提供备份和恢复。
  await fs.copyFile(args.source, installed, constants.COPYFILE_EXCL);
  return { installed };
};`;

const section = document.createElement('section');
section.className = 'player-community'; section.setAttribute('aria-labelledby','communityHeading');
section.innerHTML = `<header class="player-heading"><div><span class="player-eyebrow">由玩家写给玩家</span><h2 id="communityHeading">玩家来信</h2><p>小工具、小故事、你的灵感，都可以有一个页面。</p></div><button type="button" class="player-primary" id="creatorOpen">制作并上传工具</button></header>
<div class="player-toolbar"><div role="group" aria-label="作品范围"><button id="communityAll" type="button" aria-pressed="true">所有来信</button><button id="communityMine" type="button" aria-pressed="false">我的作品</button></div><button id="communityRefresh" type="button">刷新</button></div>
<p class="player-notice">${UNVERIFIED}。玩家作品均可正常打开。</p><div id="communityCards" class="player-cards"></div><p id="communityStatus" role="status" aria-live="polite"></p><button type="button" id="communityMore" hidden>继续阅读来信</button>`;
const home = $('sceneHomePage');
home?.insertBefore(section, home.querySelector('.hero-feature-zone'));
const editor = document.createElement('dialog');
editor.className = 'player-editor';editor.id='playerEditor';editor.setAttribute('aria-labelledby','creatorTitle');
editor.innerHTML = `<form id="creatorForm"><header class="player-heading"><div><span class="player-eyebrow">创作工坊 · 本机草稿</span><h2 id="creatorTitle">寄出你的工具来信</h2></div><button type="button" id="creatorClose" aria-label="关闭创作工坊">×</button></header>
<p>页面是每个作品的起点。可以只写一段故事，也可以让页面与自己的安装后端协作。</p>
<div class="player-editor-grid"><div class="player-fields"><label>工具名称 <span>必填 · 最多 60 字</span><input id="creatorName" maxlength="60" required placeholder="给你的作品起个名字"></label>
<label>工具介绍 <span>必填 · 最多 2000 字</span><textarea id="creatorDescription" maxlength="2000" rows="5" required placeholder="介绍用途、使用方法与适用环境"></textarea></label>
<label>资源包网盘链接 <span>可选 · 每行一条，最多 12 条</span><textarea id="creatorLinks" rows="3" placeholder="没有资源包可以留空；也可以直接写在页面里"></textarea></label><p class="player-hint">不上传资源包本体，不论大小都使用网盘分享链接。提取码可写在页面或介绍中。</p>
<details><summary>制作说明与页面接口</summary><p>HTML 最多 192 KiB，后端 JavaScript 最多 96 KiB，总请求最多 320 KiB（按 UTF-8 字节）。支持内嵌样式与脚本、HTTPS 在线依赖；建议单文件，不依赖本地相对路径。</p><p>页面可以调用 <code>await rainTool.call('操作', 参数)</code>、<code>await rainTool.chooseFile()</code>、<code>await rainTool.chooseDirectory()</code> 和 <code>await rainTool.openLink('https://…')</code>。选择取消时返回 null。</p><p>后端使用 CommonJS：<code>module.exports = async (action, args, { dataDirectory }) => { return 结果; };</code>。可使用 Node 文件、进程和网络能力，用户同意后才执行。每次调用最长 60 秒，参数与返回值各最多 64 KiB，一次执行一个操作。关闭窗口停止后端。</p><p>每账号最多 50 个工具，每小时最多提交 10 次，每天最多 30 次；每次浏览返回 20 个。修改会检查版本，避免覆盖别处的新内容。发布后直接展示，均标记未经检验。</p></details>
</div><div class="player-source"><div class="player-source-heading"><label for="creatorHtml">HTML 页面 <small>必填 · 192 KiB</small></label><button type="button" data-import="html">导入 HTML</button></div><textarea id="creatorHtml" class="player-code" spellcheck="false" required aria-label="HTML 页面源码"></textarea>
<div class="player-source-heading"><label for="creatorBackend">JavaScript 后端 <small>可选 · 96 KiB</small></label><button type="button" data-import="backend">导入 JS</button></div><textarea id="creatorBackend" class="player-code player-backend" spellcheck="false" aria-label="JavaScript 后端源码" placeholder="留空就是仅前端作品"></textarea></div></div>
<div class="player-examples"><span>从示例开始</span><button type="button" id="creatorStory">故事页面</button><button type="button" id="creatorInstall">文件安装工具</button><button type="button" id="creatorNew">新建空白作品</button></div>
<footer class="player-editor-footer"><p id="creatorStatus" role="status" aria-live="polite">草稿只保存在本机；预览不会上传。</p><div><button type="button" id="creatorSave">保存草稿</button><button type="button" id="creatorPreview">本机预览</button><button class="player-primary" type="submit" id="creatorPublish">发布来信</button></div></footer></form>`;
document.body.append(editor);
const sourceDialog = document.createElement('dialog');sourceDialog.className='player-editor player-inspect';sourceDialog.setAttribute('aria-labelledby','toolSourceTitle');
sourceDialog.innerHTML='<header class="player-heading"><h2 id="toolSourceTitle">作品源码</h2><button type="button" aria-label="关闭源码">×</button></header><p>源码来自作者，未经检验。可在运行前阅读页面与后端。</p><label>HTML 页面<textarea class="player-code" readonly id="toolSourceHtml"></textarea></label><label>JavaScript 后端<textarea class="player-code" readonly id="toolSourceBackend"></textarea></label>';
sourceDialog.querySelector('button').onclick=()=>sourceDialog.close();document.body.append(sourceDialog);
let mine=false,next=null,username='',busy=false,editing={},saveTimer,saveQueue=Promise.resolve();
const fields=['Name','Description','Html','Backend','Links'];
function values(){return { ...editing,name:$('creatorName').value,description:$('creatorDescription').value,html:$('creatorHtml').value,backend:$('creatorBackend').value,links:$('creatorLinks').value.split('\n').map(s=>s.trim()).filter(Boolean) };}
function fill(tool={}) {editing=tool.id?{id:tool.id,revision:tool.revision}:{};for(const key of fields)$('creator'+key).value=key==='Links'?(tool.links||[]).join('\n'):(tool[key.toLowerCase()]||'');$('creatorTitle').textContent=tool.id?'修改你的工具来信':'寄出你的工具来信';$('creatorPublish').textContent=tool.id?'保存并更新':'发布来信';}
function status(message){$('creatorStatus').textContent=message;}
function save(){const draft=values();saveQueue=saveQueue.catch(()=>{}).then(()=>desktop.communitySaveDraft(draft));return saveQueue;}
function openEditor(){editor.showModal();$('creatorName').focus();}
function control(text,fn){const button=document.createElement('button');button.type='button';button.textContent=text;button.onclick=async()=>{button.disabled=true;try{await fn();}catch(e){$('communityStatus').textContent=e.message;}finally{button.disabled=false;}};return button;}
async function refresh(more=false){
 if(busy)return;busy=true;$('communityRefresh').disabled=true;$('communityMore').disabled=true;$('communityCards').setAttribute('aria-busy','true');
 try{username=(await desktop.resumeAccount())?.username||'';const result=await desktop.communityList(more?next:null,mine);if(!more)$('communityCards').replaceChildren();
 for(const tool of result.tools){const card=document.createElement('article');card.className='player-card';const badge=document.createElement('span');badge.className='player-badge';badge.textContent='未经检验';const title=document.createElement('h3');title.textContent=tool.name;const desc=document.createElement('p');desc.textContent=tool.description;const by=document.createElement('small');by.textContent=`${tool.owner} · ${tool.hasBackend?'页面 + 本机后端':'页面作品'} · 第 ${tool.revision} 版`;const actions=document.createElement('div');actions.className='player-card-actions';actions.append(control('打开作品',()=>desktop.communityOpen(tool.id)),control('查看源码',async()=>{const data=(await desktop.communityGet(tool.id)).tool;$('toolSourceTitle').textContent=data.name+' · 源码';$('toolSourceHtml').value=data.html;$('toolSourceBackend').value=data.backend||'（仅前端作品）';sourceDialog.showModal();}));
 if(username.toLowerCase()===tool.owner.toLowerCase()){actions.append(control('编辑',async()=>{if(editor.open)editor.close();fill((await desktop.communityGet(tool.id)).tool);openEditor();}),control('删除',async()=>{if(!window.confirm('删除“'+tool.name+'”？本机草稿仍会保留。'))return;await desktop.communityDelete(tool.id);await refresh();}));}
 card.append(badge,title,desc,by,actions);$('communityCards').append(card);}
 next=result.next;$('communityMore').hidden=!next;$('communityStatus').textContent=result.tools.length?`已展示 ${$('communityCards').children.length} 封来信${next?'，还可以继续加载。':'。'}`:(more?'已读到最后。':mine?'还没有发布作品，来写第一封工具来信吧。':'这里等着第一封玩家来信。');
 }catch(e){$('communityStatus').textContent='暂时未能读取玩家来信：'+e.message+' 你仍可以制作、保存和预览本机草稿。';}finally{busy=false;$('communityRefresh').disabled=false;$('communityMore').disabled=false;$('communityCards').setAttribute('aria-busy','false');}
}
$('creatorOpen').onclick=openEditor;$('creatorClose').onclick=()=>editor.close();
$('communityRefresh').onclick=()=>refresh();$('communityMore').onclick=()=>refresh(true);
for(const [id,value]of [['communityAll',false],['communityMine',true]])$(id).onclick=()=>{mine=value;$('communityAll').setAttribute('aria-pressed',String(!mine));$('communityMine').setAttribute('aria-pressed',String(mine));refresh();};
$('creatorForm').oninput=()=>{clearTimeout(saveTimer);saveTimer=setTimeout(()=>save().then(()=>status('草稿已保存到本机。')).catch(e=>status(e.message)),800);};
editor.addEventListener('close',()=>{clearTimeout(saveTimer);save().catch(()=>{});});
$('creatorSave').onclick=()=>save().then(()=>status('草稿已保存到本机。')).catch(e=>status(e.message));
for(const button of editor.querySelectorAll('[data-import]'))button.onclick=async()=>{try{const source=await desktop.communityImport(button.dataset.import);if(source!==null){$(button.dataset.import==='html'?'creatorHtml':'creatorBackend').value=source;await save();status('源码已导入，草稿已保存。');}}catch(e){status(e.message);}};
$('creatorPreview').onclick=async()=>{try{const tool=cleanTool(values());await desktop.communityOpen(tool);status('已打开本机预览窗口，尚未上传。');}catch(e){status(e.message);}};
function replaceDraft(tool){if(fields.some(key=>$('creator'+key).value.trim())&&!window.confirm('替换当前编辑内容？需要保留时，请先复制源码。'))return;fill(tool);save().catch(e=>status(e.message));status('示例已载入，修改后可在本机预览。');}
$('creatorStory').onclick=()=>replaceDraft({name:'雨停之前的小故事',description:'一封可以翻页的小故事，没有资源包，也不需要后端。',html:story});
$('creatorInstall').onclick=()=>replaceDraft({name:'我的文件安装工具',description:'选择已从网盘下载的单个文件，安装到你指定的目录。同名文件不覆盖。',html:installationPage,backend:installationBackend});
$('creatorNew').onclick=()=>replaceDraft({});
$('creatorForm').onsubmit=async event=>{event.preventDefault();const button=$('creatorPublish');button.disabled=true;try{const input=values();cleanTool(input);status('正在发布来信…');const result=await desktop.communityPublish(input);editing={id:result.id,revision:result.revision};await save();$('creatorPublish').textContent='保存并更新';status('来信已发布，大家可以在首页打开。');await refresh();}catch(e){status(e.message);}finally{button.disabled=false;}};
desktop.communityLoadDraft().then(draft=>{if(draft)fill(draft);}).catch(()=>{});
refresh();
