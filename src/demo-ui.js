export function demoMarkup() {
  return `<div class="demo-workbench"><p class="cs2-download-note">把精彩对局变成下一次练习。回放插件 1.6.12 已随雨巷附带；共享运行库请先从夸克下载 cs2-shared-runtime.zip，首次安装时选择资源包；随附运行库更新会自动补齐 1.0.380。可与人机增强、饰品工坊自由搭配。</p><section class="demo-step"><span class="page-eyebrow">第一步 · 准备游戏</span><h3>装入回放插件</h3><label>CS2 游戏目录<input id="demoDirectory" readonly placeholder="自动识别或选择游戏目录" /></label><div class="demo-actions"><button class="action-secondary" id="demoChoose">选择目录</button><button class="action-secondary" id="demoRefresh">重新检测</button></div><p id="demoStatus" role="status" class="cs2-download-note">正在识别插件…</p><button class="action-secondary" id="demoRuntimeDownload">获取共享运行库 · 夸克网盘</button><button class="action-primary" id="demoInstall">一键安装回放插件</button></section><section class="demo-step"><span class="page-eyebrow">第二步 · 整理回放</span><h3>回放管理 · DemoTracer</h3><p>导入 Demo、分析比赛、挑选回合并导出到回放库。保留官方完整界面与功能。</p><p id="demoGuiStatus" role="status" class="cs2-download-note">正在查找已安装的程序…</p><div class="demo-actions"><button class="action-primary" id="demoGuiOpen">打开 DemoTracer</button><button class="action-secondary" id="demoGuiLocate">定位已安装程序</button><button class="action-secondary" id="demoGuiInstall">选择安装包安装／更新</button><button class="action-secondary" id="demoGuiDownload">从官方获取 1.6.12 并安装</button></div><div class="demo-actions"><button class="action-secondary" id="demoGuiRefresh">刷新程序状态</button><button class="action-secondary" id="demoGuiFolder">打开 GUI 安装目录</button><button class="action-secondary cs2-danger" id="demoGuiUninstall">卸载 DemoTracer GUI…</button></div><p class="cs2-download-note">GUI 需要 Windows 10/11 与 Microsoft Edge WebView2。官方 GUI 为免费使用的专有软件，许可不允许再分发，因此不随雨巷附带；首次安装后，后续直接启动已安装程序。GUI 与回放插件请保持 1.6.12 配套。</p></section><section class="demo-step"><span class="page-eyebrow">第三步 · 重温对局</span><h3>进入本机练习</h3><div class="demo-actions"><button class="action-primary" id="demoLaunch">启动 CS2 · 本机回放</button><button class="action-secondary" id="demoRuntime">复制运行环境检查命令</button><button class="action-secondary" id="demoStop">复制停止回放命令</button><button class="action-secondary" id="demoConfig">复制配置检查命令</button><button class="action-secondary" id="demoReload">复制重新加载命令</button><button class="action-secondary" id="demoFolder">打开回放插件目录</button></div><p>在 DemoTracer 中选择游戏目录，打开已转换比赛并复制播放命令；进入对应的本机地图后粘贴到服务器控制台。人机增强也可以通过 Panel 启动；饰品工坊使用 exec rain-alley-inventory.cfg 与 !ws。请勿对正在重演的机器人同时执行其他控制命令。</p><p>卸载仅移除回放组件；已安装的 GUI、原始 Demo、回放库和个人文件保留。可随时重新安装。</p><button class="action-secondary cs2-danger" id="demoUninstall">卸载回放插件…</button></section><a class="detail-inline-note" href="https://github.com/unicbm/demotracer" target="_blank" rel="noreferrer">上游项目 · unicbm/DemoTracer · 回放组件 AGPL-3.0-only</a></div>`;
}
export function bindDemoControls(surface, { desktop, choose, toast, onStatus }) {
  const $ = selector => surface.querySelector(selector);
  const workbench = $('.demo-workbench');
  const field = $('#demoDirectory'), status = $('#demoStatus');
  let busy = false;
  const run = async operation => { if (busy) return; busy = true; const buttons = [...surface.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true); workbench.setAttribute('aria-busy', 'true'); try { await operation(); } catch (cause) { status.textContent = cause.message; toast(cause.message, 'error', 7000); } finally { busy = false; buttons.forEach(b => b.disabled = false); workbench.setAttribute('aria-busy', 'false'); syncGuiButtons(); } };
  const refresh = async () => {
    if (!field.value) { status.textContent = '请选择 CS2 游戏目录。'; return; }
    const result = await desktop.getCs2Status(field.value);
    status.textContent = '回放：' + (result.demo ? (result.demoVersion ? '已安装 ' + result.demoVersion + (result.demoVersion !== '1.6.12' ? '（可更新）' : '') : '已安装（版本未知，可重新安装）') : '未安装') + ' · 人机增强：' + (result.bots ? '已安装' : '未安装') + ' · 饰品工坊：' + (result.inventory ? '已安装' : '未安装');
    await onStatus(result);
  };
  let guiTarget = null;
  const syncGuiButtons = () => { for (const id of ['#demoGuiOpen', '#demoGuiFolder', '#demoGuiUninstall']) $(id).disabled = busy || !guiTarget; };
  const guiRefresh = async () => {
    const info = await desktop.demoGuiStatus(); guiTarget = info?.executable || null; syncGuiButtons();
    $('#demoGuiStatus').textContent = guiTarget ? '已找到 GUI ' + (info.version || '（版本未知）') + '：' + guiTarget + (info.version !== '1.6.12' ? '。建议安装／更新为 1.6.12，与回放插件配套。' : '。后续直接打开已安装程序。') : '尚未找到 DemoTracer，可选择官方安装包安装，或定位已有程序。';
  };
  // Tool tabs retain their DOM while inactive; finish updates on that same
  // surface even if the user switched tabs during installation.
  desktop.findCs2Directory().then(async value => { if (!field.dataset.chosen && !field.value) field.value = value || ''; await refresh(); }).catch(cause => { status.textContent = cause.message; });
  guiRefresh().catch(cause => { $('#demoGuiStatus').textContent = cause.message; });
  $('#demoRuntimeDownload').onclick = () => run(() => desktop.downloadResource('cs2-runtime'));
  $('#demoChoose').onclick = () => run(async () => { const value = await desktop.chooseCs2Directory(); if (value) { field.dataset.chosen = 'true'; field.value = value; await refresh(); } });
  $('#demoRefresh').onclick = () => run(refresh);
  $('#demoInstall').onclick = () => run(async () => {
    if (!field.value) throw new Error('请先选择 CS2 游戏目录。');
    const cleanOtherPlugins = await choose('清理其他 CS2 插件？', '安装回放插件会清理其他插件，保留雨巷的人机增强、饰品工坊及共享组件。选择“否”会取消整个安装。请先关闭 CS2 和 Panel。', [{ label: '否，取消安装', value: false }, { label: '是，继续安装', value: true, primary: true }]);
    if (!cleanOtherPlugins) return;
    const keepBackup = await choose('保留文件备份？', '备份保存在所选游戏目录下。不保留备份时，安装失败也会尝试恢复原文件；恢复失败会保留恢复资料。', [{ label: '取消安装', value: null }, { label: '不保留备份', value: false }, { label: '保留备份', value: true, primary: true }]);
    if (keepBackup === null) return;
    status.textContent = '正在准备共享运行库、校验并安装回放组件，请稍候…首次使用时可能需要选择运行库 ZIP。';
    const result = await desktop.installDemo(field.value, { cleanOtherPlugins, keepBackup }); if (result.cancelled) return;
    await refresh(); const message = '回放插件已安装。' + (result.backup ? '备份：' + result.backup : '') + (result.cleanupPending?.length ? '部分临时文件待系统释放后清理。' : ''); status.textContent += '。' + message; toast(message, 'success', 7000);
  });
  $('#demoUninstall').onclick = () => run(async () => {
    if (!field.value) throw new Error('请先选择 CS2 游戏目录。');
    const keepConfig = await choose('保留回放配置？', 'Demo、回放库、GUI 和个人文件始终保留。人机增强、饰品工坊及所需共享组件继续保留。', [{ label: '取消卸载', value: null }, { label: '移除附带配置', value: false }, { label: '保留配置', value: true, primary: true }]);
    if (keepConfig === null) return;
    const plan = await desktop.inspectDemoUninstall(field.value, keepConfig);
    if (!plan.files.length) { toast('未找到可卸载的回放文件。'); return; }
    const confirmed = await choose('确认卸载回放插件？', '将移走 ' + plan.files.length + ' 个文件，其中 ' + plan.changed + ' 个与附带资源不同。移除文件会存入恢复备份。请先关闭 CS2 和 Panel。', [{ label: '取消卸载', value: false }, { label: '确认卸载', value: true, danger: true }]);
    if (!confirmed) return;
    const result = await desktop.uninstallDemo(field.value, { keepConfig, confirmed, fingerprint: plan.fingerprint }); if (result.cancelled) return; await refresh(); status.textContent += '。恢复备份：' + result.backup; toast('回放插件已卸载，恢复备份：' + result.backup, 'success', 7000);
  });
  syncGuiButtons();
  $('#demoGuiRefresh').onclick = () => run(guiRefresh);
  $('#demoGuiFolder').onclick = () => run(() => desktop.openDemoGuiFolder());
  $('#demoGuiUninstall').onclick = () => run(async () => {
    $('#demoGuiStatus').textContent = '等待官方卸载程序完成，请保留个人回放资料…';
    try { const result = await desktop.uninstallDemoGui(); if (!result.cancelled) toast(result.removed ? 'DemoTracer GUI 已卸载。' : '程序仍在，请关闭 GUI 后重试或在 Windows 设置中检查。', result.removed ? 'success' : 'warning'); } finally { await guiRefresh(); }
  });
  $('#demoGuiOpen').onclick = () => run(() => desktop.launchDemoGui());
  $('#demoGuiLocate').onclick = () => run(async () => { await desktop.locateDemoGui(); await guiRefresh(); });
  for (const [id, download] of [['#demoGuiInstall', false], ['#demoGuiDownload', true]]) $(id).onclick = () => run(async () => {
    const result = await desktop.installDemoGui(download); if (!result.cancelled) { await guiRefresh(); toast('DemoTracer 已打开，后续可直接使用“打开 DemoTracer”。', 'success'); }
  });
  $('#demoLaunch').onclick = () => run(() => desktop.launchDemoGame());
  $('#demoFolder').onclick = () => run(() => desktop.openDemoFolder(field.value));
  for (const [id, command] of [['#demoRuntime', 'dtr_runtime'], ['#demoStop', 'dtr_stop all'], ['#demoConfig', 'dtr_config_status'], ['#demoReload', 'css_plugins reload DemoTracer']]) $(id).onclick = () => run(async () => { await desktop.copyText(command); toast('已复制：' + command + '，请在本机服务器控制台执行。'); });
}

