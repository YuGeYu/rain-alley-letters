export function biliDeskMarkup() {
  return `<div class="bili-workbench"><section class="bili-hero"><div class="bili-wordmark"><img src="./bilidesk-icon.png" alt="" width="64" height="64"><div><span class="page-eyebrow">BILIDESK / WINDOWS</span><h3>喜欢的视频，专注地看。</h3></div></div><p>完整的哔哩哔哩第三方桌面客户端。原生播放器、清爽的浏览体验，把内容留在眼前。</p><div class="bili-badges"><span>1.6.2</span><span>Windows x64</span><span>GPL-3.0 开源</span><span>自带 .NET 运行时</span></div><div class="bili-primary-actions"><button type="button" class="action-secondary" data-bili="download">获取资源包 · 夸克网盘</button><button type="button" class="action-primary" data-bili="install" disabled>选择资源包并安装</button><button type="button" class="action-primary" data-bili="launch" disabled>打开 BiliDesk</button></div><p class="bili-status" data-bili-status role="status" aria-live="polite">正在检查本机客户端…</p></section><div class="bili-feature-grid"><article><span>01 / 发现</span><h4>从推荐到收藏</h4><p>推荐、热门、搜索、动态、番剧、直播，以及收藏与观看历史。</p></article><article><span>02 / 沉浸</span><h4>为观看而生</h4><p>LibVLC 原生播放、弹幕、倍速、全屏与播客模式，保留上游完整体验。</p></article><article><span>03 / 随行</span><h4>整理你的片单</h4><p>扫码登录、消息与下载管理。画质、内容和账号功能以 B 站实际权限为准。</p></article></div><section class="bili-manage"><h4>客户端管理</h4><p>客户端资源包通过夸克网盘提供，不随雨巷安装包附带。先下载 BiliDesk-win-x64.zip，再选择资源包安装；验证通过后会保存到本机，后续修复可复用。首次打开请阅读客户端说明；登录由你在客户端扫码完成。视频使用原生 LibVLC，扫码及部分平台交互使用系统 Microsoft Edge WebView2。</p><div class="bili-tools"><button type="button" class="action-secondary" data-bili="refresh">重新检测</button><button type="button" class="action-secondary" data-bili="repair" disabled>修复安装</button><button type="button" class="action-secondary" data-bili="folder" disabled>安装目录</button><button type="button" class="action-secondary" data-bili="source">对应源码与许可</button><button type="button" class="action-secondary cs2-danger" data-bili="uninstall" disabled>卸下客户端…</button></div><p data-bili-path class="bili-path"></p><p>卸下与修复会将旧程序完整移入恢复备份；账号、设置和下载文件保留。BiliDesk 在独立窗口运行，托盘退出后再修复或卸下。</p><a class="detail-inline-note" href="https://github.com/ABING1111/BiliDesk" target="_blank" rel="noreferrer">上游项目 · ABING1111 / BiliDesk</a></section></div>`;
}
export function bindBiliDeskControls(surface, { desktop, choose, toast, onStatus }) {
  const $ = s => surface.querySelector(s);
  const buttons = [...surface.querySelectorAll('[data-bili]')];
  const status = $('[data-bili-status]');
  let busy = false, current;
  const sync = () => buttons.forEach(button => {
    const action = button.dataset.bili;
    button.disabled = busy || (['install','repair'].includes(action) ? !current?.available : ['launch','folder'].includes(action) ? !current?.installed : action === 'uninstall' ? !(current?.installed || current?.damaged) : false);
    if (action === 'install') button.hidden = Boolean(current?.installed);
    if (action === 'launch') button.hidden = !current?.installed;
    if (action === 'repair') button.hidden = !(current?.installed || current?.damaged);
  });
  const refresh = async () => {
    current = await desktop.biliDeskStatus();
    status.textContent = current.installed ? `已就绪 · BiliDesk ${current.version} · 点击打开，开始观看。` : current.damaged ? '发现已有程序文件，请修复安装后再打开。' : current.available ? `尚未安装 · 夸克资源包 ${(current.archiveBytes / 1048576).toFixed(1)} MB，展开约 ${(current.size / 1048576).toFixed(0)} MB。` : '客户端资源正在准备，完成后即可安装。';
    $('[data-bili-path]').textContent = '程序：' + current.directory + '　｜　个人数据：' + current.profile;
    await onStatus(current); sync();
  };
  const run = async task => {
    if (busy) return;
    busy = true; sync(); $('.bili-workbench').setAttribute('aria-busy', 'true');
    try { await task(); } catch (e) { status.textContent = e.message; toast(e.message, 'error', 7000); }
    finally { busy = false; sync(); $('.bili-workbench').setAttribute('aria-busy', 'false'); }
  };
  buttons.forEach(button => button.addEventListener('click', () => run(async () => {
    const action = button.dataset.bili;
    if (action === 'refresh') return refresh();
    if (action === 'download') { await desktop.downloadResource('bilidesk'); status.textContent = '已打开夸克分享，请下载 BiliDesk-win-x64.zip，完成后选择资源包安装。'; return; }
    if (action === 'install' || action === 'repair') {
      status.textContent = '请选择下载好的 ZIP；正在校验并安装，请稍候…';
      const result = await desktop.biliDeskInstall(); if (result.cancelled) { await refresh(); return; } await refresh();
      status.textContent = '安装完成，可以打开 BiliDesk。' + (result.backup ? '旧程序已完整保存在：' + result.backup : '');
      toast('BiliDesk 已安装，可以开始观看。', 'success');
    } else if (action === 'launch') {
      status.textContent = '正在打开 BiliDesk…'; await desktop.biliDeskLaunch(); status.textContent = '已发送启动请求。首次打开请在客户端阅读说明；已经运行时会唤起原窗口。';
    } else if (action === 'folder') await desktop.biliDeskFolder();
    else if (action === 'source') await desktop.biliDeskSource();
    else if (action === 'uninstall') {
      const yes = await choose('卸下 BiliDesk 客户端？', '请先从托盘退出 BiliDesk。程序会完整移入恢复备份，账号、设置、缓存与下载文件都会保留。', [{ label: '取消', value: false }, { label: '确认卸下', value: true, danger: true }]);
      if (!yes) return;
      status.textContent = '正在卸下客户端并保存备份…';
      const result = await desktop.biliDeskUninstall(); await refresh();
      status.textContent = '客户端已卸下。' + (result.backup ? '恢复备份：' + result.backup : '');
    }
  })));
  void run(refresh);
}
