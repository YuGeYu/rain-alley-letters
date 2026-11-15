const { app, BrowserWindow, ipcMain, dialog, shell, utilityProcess } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function registerPlayerTools({ ensureTrusted, requestApi, brandWindow, getToken, getParent }) {
  const hosts = new Map();
  const schema = import('./player-tool-schema.js');
  let draftWrites = Promise.resolve();
  const draftPath = () => path.join(app.getPath('userData'), 'player-tool-draft.json');
  const handle = (name, fn) => ipcMain.handle('community:' + name, (event, ...args) => { ensureTrusted(event); return fn(...args); });
  handle('list', (before, mine) => {
    if (before != null && (!Number.isSafeInteger(before) || before < 1)) throw new Error('分页位置无效。');
    return requestApi('/api/tools?' + new URLSearchParams({ ...(before ? {before:String(before)}:{}), ...(mine?{mine:'1'}:{}) }), {token:getToken()});
  });
  const validId = id => { if (!Number.isSafeInteger(id) || id < 1) throw new Error('工具编号无效。'); return id; };
  handle('get', id => requestApi('/api/tools/' + validId(id), {token:getToken()}));
  handle('publish', async input => {
    if (!getToken()) throw new Error('请登录后再发布工具。');
    const tool = (await schema).cleanTool(input);
    if (input.id) { validId(input.id); tool.revision = input.revision; }
    return requestApi('/api/tools' + (input.id?'/'+input.id:''), {method:input.id?'PUT':'POST',body:tool,token:getToken()});
  });
  handle('delete', id => requestApi('/api/tools/' + validId(id), {method:'DELETE',token:getToken()}));
  handle('load-draft', async () => { try { return JSON.parse(await fs.readFile(draftPath(),'utf8')); } catch { return null; } });
  handle('save-draft', draft => {
    const raw = JSON.stringify(draft);
    if (Buffer.byteLength(raw)>327680) throw new Error('草稿超过 320 KiB，请精简代码。');
    draftWrites = draftWrites.catch(()=>{}).then(async()=>{
    await fs.mkdir(path.dirname(draftPath()),{recursive:true});
    await fs.writeFile(draftPath()+'.tmp',raw,'utf8');
    await fs.rename(draftPath()+'.tmp',draftPath());
    return true;
    });
    return draftWrites;
  });
  handle('import', async kind => {
    if (!['html','backend'].includes(kind)) throw new Error('文件类型无效。');
    const picked = await dialog.showOpenDialog(getParent(), {title:kind==='html'?'导入 HTML 页面':'导入 JavaScript 后端',properties:['openFile'],filters:[{name:kind==='html'?'HTML 页面':'JavaScript 后端',extensions:kind==='html'?['html','htm']:['js','cjs']}]});
    if (picked.canceled) return null;
    const max = (await schema).TOOL_LIMITS[kind];
    if ((await fs.stat(picked.filePaths[0])).size > max) throw new Error('源码文件超过大小上限。');
    return fs.readFile(picked.filePaths[0],'utf8');
  });
  handle('open', async input => {
    let tool;
    if (typeof input === 'number') tool = (await requestApi('/api/tools/'+validId(input),{token:getToken()})).tool;
    else tool = { ...(await schema).cleanTool(input), owner:'本机草稿' };
    if (tool.backend) { try { new (require('node:vm').Script)(tool.backend); } catch(cause) { throw new Error('后端 JavaScript 语法有误：'+cause.message); } }
    return openTool(tool);
  });
  function state(event) {
    const host = hosts.get(event.sender.id);
    if (!host || event.senderFrame !== event.sender.mainFrame) throw new Error('不允许的工具调用。');
    return host;
  }
  ipcMain.handle('player-tool:choose', async (event, kind) => {
    const host = state(event);
    if (!['directory','file'].includes(kind)) throw new Error('选择类型无效。');
    const selected = await dialog.showOpenDialog(host.window,{title:host.tool.name+' · 选择'+(kind==='directory'?'目录':'文件'),properties:[kind==='directory'?'openDirectory':'openFile']});
    return selected.canceled ? null : selected.filePaths[0];
  });
  async function external(url) {
    const u = new URL(url);
    if (!['https:','http:'].includes(u.protocol) || u.username || u.password || String(url).length>4096) throw new Error('仅支持网页和网盘链接。');
    await shell.openExternal(u.href);
    return true;
  }
  ipcMain.handle('player-tool:link', (event,url) => {state(event); return external(url);});
  ipcMain.handle('player-tool:call', async (event,action,args) => {
    const host = state(event);
    if (!host.tool.backend) throw new Error('这个作品没有后端功能。');
    if (host.busy) throw new Error('工具正在处理，请稍候。');
    if (typeof action !== 'string' || !/^[\w.-]{1,64}$/.test(action) || Buffer.byteLength(JSON.stringify(args) || '')>65536) throw new Error('操作名称或参数无效。');
    host.busy = true;
    try {
      if (!host.child) {
        const consent = await dialog.showMessageBox(host.window,{type:'question',title:'允许工具执行本机后端？',message:host.tool.name+' · '+host.tool.owner,detail:'此工具未经检验。后端拥有当前 Windows 用户的文件、网络及程序执行权限，可安装程序和修改文件。仅在信任作者与源码时允许。本次许可仅适用于当前工具窗口。关闭窗口会停止后端进程，已经启动的外部程序仍可能继续运行。',buttons:['取消','允许本次运行'],defaultId:0,cancelId:0,noLink:true});
        if (consent.response !== 1) throw new Error('已取消本机后端运行，仍可继续浏览页面。');
        if (host.window.isDestroyed()) throw new Error('工具窗口已关闭。');
        const hash = crypto.createHash('sha256').update(host.tool.backend).digest('hex');
        const dir = path.join(app.getPath('userData'),'player-tools',hash);
        await fs.mkdir(dir,{recursive:true});
        await fs.writeFile(path.join(dir,'backend.cjs'),host.tool.backend,'utf8');
        host.child = utilityProcess.fork(path.join(__dirname,'player-tool-runner.cjs'),[path.join(dir,'backend.cjs'),dir],{cwd:dir,serviceName:'玩家工具：'+host.tool.name,stdio:'ignore',execArgv:['--max-old-space-size=128'],env:Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','PATH','USERPROFILE','APPDATA','LOCALAPPDATA'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))});
        const child = host.child;
        child.once('exit',()=>{if(host.child===child)host.child=null;});
      }
      return await new Promise((resolve,reject) => {
        const child = host.child;
        const cleanup = () => {clearTimeout(timer);child.removeListener('message',message);child.removeListener('exit',exit);host.pending=null;};
        const message = data => {if(data.id !== 1)return;cleanup();data.error?reject(new Error(data.error)):resolve(data.result);};
        const exit = () => {cleanup();host.child=null;reject(new Error('工具后端已退出。'));};
        const timer = setTimeout(()=>{cleanup();child.kill();host.child=null;reject(new Error('后端运行超过 60 秒，已停止；请将长任务拆分为多步。'));},60000);
        host.pending=()=>{cleanup();reject(new Error('工具窗口已关闭。'));};
        child.on('message',message);child.once('exit',exit);
        child.postMessage({id:1,action,args});
      });
    } finally {host.busy=false;}
  });
  async function openTool(tool) {
    if (hosts.size >= 8) throw new Error('最多同时打开 8 个玩家作品，请先关闭一个窗口。');
    const win = new BrowserWindow({width:1040,height:780,minWidth:480,minHeight:400,title:tool.name+' · 未经检验',icon:path.join(__dirname,'../assets/rain-alley.ico'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'player-tool-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webviewTag:false,partition:'player-tool-'+crypto.randomUUID(),webSecurity:true,navigateOnDragDrop:false}});
    brandWindow(win);
    const host = { window:win,tool,child:null,busy:false,pending:null };
    hosts.set(win.webContents.id,host);
    const isolatedSession = win.webContents.session;
    isolatedSession.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
    isolatedSession.setPermissionCheckHandler(()=>false);
    isolatedSession.on('will-download',event=>event.preventDefault());
    const csp = "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src https: data:; font-src https:; connect-src https:; media-src https:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    isolatedSession.webRequest.onHeadersReceived((details,callback)=>callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':[csp]}}));
    const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    // Use an opaque data origin; no app origin, account cookies or account bridge.
    const banner = `<aside style="position:relative;z-index:2147483647;display:block!important;padding:14px 20px;background:#fff0bc;color:#3a2c00;font:14px/1.6 'Microsoft YaHei UI',sans-serif"><strong>${escape(tool.name)}</strong> · ${escape(tool.owner || '玩家作品')}<br>未经检验，请擦亮眼睛选择合适的那一个${(tool.links||[]).map((url,index)=>`<br><a href="${escape(url)}" target="_blank">资源网盘链接 ${index+1}</a>`).join('')}</aside>`;
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${banner}${tool.html}</body></html>`;
    win.webContents.on('will-navigate',(event,url)=>{event.preventDefault();external(url).catch(()=>{});});
    win.webContents.setWindowOpenHandler(({url})=>{external(url).catch(()=>{});return {action:'deny'};});
    win.webContents.on('page-title-updated',event=>{event.preventDefault();});
    const webId = win.webContents.id;
    win.on('closed',()=>{hosts.delete(webId);host.pending?.();host.child?.kill();isolatedSession.closeAllConnections().catch(()=>{});});
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
    return {opened:true};
  }
}
module.exports = { registerPlayerTools };
