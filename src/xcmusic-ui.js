export function xcMusicMarkup() {
  return `<div class="xcm-workbench"><section class="xcm-hero"><div class="xcm-wordmark"><img src="./xcmusic-icon.png" alt="" width="64" height="64"><div><span class="page-eyebrow">XCMUSIC / WINDOWS</span><h3>让喜欢的旋律，陪你走一程。</h3></div></div><p>完整的网易云音乐第三方桌面客户端。在线曲库与本地音乐，在熟悉的旋律里，留一段属于自己的时间。</p><div class="xcm-badges"><span>0.3.1</span><span>Windows x64</span><span>MIT 开源</span><span>完整 Electron 桌面端</span></div><div class="xcm-primary-actions"><button type="button" class="action-secondary" data-xcm="download">获取资源包 · 夸克网盘</button><button type="button" class="action-primary" data-xcm="install" disabled>选择资源包并安装</button><button type="button" class="action-primary" data-xcm="launch" disabled>打开 XCMusic</button></div><p class="xcm-status" data-xcm-status role="status" aria-live="polite">正在检查本机客户端…</p></section><div class="xcm-feature-grid"><article><span>01 / 发现</span><h4>找到下一首喜欢</h4><p>搜索歌曲、歌单、专辑与歌手，管理收藏与音乐云盘。</p></article><article><span>02 / 沉浸</span><h4>听见每一处细节</h4><p>逐字歌词、均衡器、音量均衡、输出设备选择与多种主题，保留上游完整界面。</p></article><article><span>03 / 随行</span><h4>把音乐带在身边</h4><p>扫码登录、本地音乐与下载管理。可播放曲目、音质与下载权限以网易云音乐实际授权为准。</p></article></div><section class="xcm-manage"><h4>客户端管理</h4><p>客户端资源包通过夸克网盘提供，不随雨巷安装包附带。先下载 XCMusic-win-x64.zip，再选择资源包安装；验证通过后会保存到本机，后续修复可复用。首次打开请阅读客户端说明；登录由你在客户端扫码完成。自带桌面运行环境与本机音乐 API，无需另行部署服务；设置与播放记录保存在独立桌面数据文件中。</p><div class="xcm-tools"><button type="button" class="action-secondary" data-xcm="refresh">重新检测</button><button type="button" class="action-secondary" data-xcm="repair" disabled>修复安装</button><button type="button" class="action-secondary" data-xcm="folder" disabled>安装目录</button><button type="button" class="action-secondary" data-xcm="source">对应源码与许可</button><button type="button" class="action-secondary cs2-danger" data-xcm="uninstall" disabled>卸下客户端…</button></div><p data-xcm-path class="xcm-path"></p><p>卸下与修复会将旧程序完整移入恢复备份；账号、设置和下载文件保留。XCMusic 在独立窗口运行，托盘退出后再修复或卸下。</p><a class="detail-inline-note" href="https://github.com/yiktllw/XCMusic" target="_blank" rel="noreferrer">上游项目 · yiktllw / XCMusic</a></section></div>`;
}
export function bindXCMusicControls(surface, { desktop, choose, toast, onStatus }) {
  const $ = s => surface.querySelector(s);
  const buttons = [...surface.querySelectorAll('[data-xcm]')];
  const status = $('[data-xcm-status]');
  let busy = false, current;
  const sync = () => buttons.forEach(button => {
    const action = button.dataset.xcm;
    button.disabled = busy || (['install','repair'].includes(action) ? !current?.available : ['launch','folder'].includes(action) ? !current?.installed : action === 'uninstall' ? !(current?.installed || current?.damaged) : false);
    if (action === 'install') button.hidden = Boolean(current?.installed);
    if (action === 'launch') button.hidden = !current?.installed;
    if (action === 'repair') button.hidden = !(current?.installed || current?.damaged);
  });
  const refresh = async () => {
    current = await desktop.xcMusicStatus();
    status.textContent = current.installed ? `已就绪 · XCMusic ${current.version} · 点击打开，开始聆听。` : current.damaged ? '发现已有程序文件，请修复安装后再打开。' : current.available ? `尚未安装 · 夸克资源包 ${(current.archiveBytes / 1048576).toFixed(1)} MB，展开约 ${(current.size / 1048576).toFixed(0)} MB。` : '客户端资源正在准备，完成后即可安装。';
    $('[data-xcm-path]').textContent = '程序：' + current.directory + '　｜　个人数据：' + current.profile;
    await onStatus(current); sync();
  };
  const run = async task => {
    if (busy) return;
    busy = true; sync(); $('.xcm-workbench').setAttribute('aria-busy', 'true');
    try { await task(); } catch (e) { status.textContent = e.message; toast(e.message, 'error', 7000); }
    finally { busy = false; sync(); $('.xcm-workbench').setAttribute('aria-busy', 'false'); }
  };
  buttons.forEach(button => button.addEventListener('click', () => run(async () => {
    const action = button.dataset.xcm;
    if (action === 'refresh') return refresh();
    if (action === 'download') { await desktop.downloadResource('xcmusic'); status.textContent = '已打开夸克分享，请下载 XCMusic-win-x64.zip，完成后选择资源包安装。'; return; }
    if (action === 'install' || action === 'repair') {
      status.textContent = '请选择下载好的 ZIP；正在校验并安装，请稍候…';
      const result = await desktop.xcMusicInstall(); if (result.cancelled) { await refresh(); return; } await refresh();
      status.textContent = '安装完成，可以打开 XCMusic。' + (result.backup ? '旧程序已完整保存在：' + result.backup : '');
      toast('XCMusic 已安装，可以开始聆听。', 'success');
    } else if (action === 'launch') {
      status.textContent = '正在打开 XCMusic…'; await desktop.xcMusicLaunch(); status.textContent = '已发送启动请求。首次打开请在客户端阅读说明；已经运行时会唤起原窗口。';
    } else if (action === 'folder') await desktop.xcMusicFolder();
    else if (action === 'source') await desktop.xcMusicSource();
    else if (action === 'uninstall') {
      const yes = await choose('卸下 XCMusic 客户端？', '请先从托盘退出 XCMusic。程序会完整移入恢复备份，账号、设置、缓存与下载文件都会保留。', [{ label: '取消', value: false }, { label: '确认卸下', value: true, danger: true }]);
      if (!yes) return;
      status.textContent = '正在卸下客户端并保存备份…';
      const result = await desktop.xcMusicUninstall(); await refresh();
      status.textContent = '客户端已卸下。' + (result.backup ? '恢复备份：' + result.backup : '');
    }
  })));
  void run(refresh);
}
