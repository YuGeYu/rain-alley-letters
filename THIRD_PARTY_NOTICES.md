# 开源许可与第三方致谢

雨巷来信完整相应源码：https://github.com/YuGeYu/rain-alley-letters 。分发二进制时，请同时保留本说明及该版本对应的源码获取方式。

Copyright (C) 2026 雨巷来信工作室。雨巷来信自己的代码采用 GNU Affero General Public License v3.0 or later（SPDX: AGPL-3.0-or-later）。完整许可见 LICENSE。软件按现状提供，不作担保。源码包含构建脚本、桌面客户端、服务端和集成适配代码；分发修改版时请标注修改并提供相应源码。

## 随应用分发

- BiliDesk 1.6.2，ABING1111 及贡献者，GPL-3.0：https://github.com/ABING1111/BiliDesk 。完整源码保留于 vendor/BiliDesk；对应修改源码随应用附带为 assets/clients/BiliDesk-1.6.2-source.zip，许可为 BiliDesk-LICENSE.txt。自包含 Windows x64 客户端在 BiliDesk-win-x64.zip，归档与逐文件 SHA-256 见 src/bilidesk-payload-manifest.json。仅增加独立验收数据目录适配，保留原生完整功能和首次使用声明。LibVLCSharp 3.8.0、LibVLCSharp.WPF 3.8.0、VideoLAN.LibVLC.Windows 3.0.24、WebView2 SDK 1.0.4191.47、.NET 10 运行时保留其独立许可与可替换动态库，详见 BiliDesk-NOTICES.txt 和程序内 dependency-licenses。正常启动保留上游用户目录；雨巷不代登录或传输账号。

- DemoTracer Playback Bundle v1.6.12，unicbm 及贡献者，回放组件 AGPL-3.0-only。官方 ZIP 原样位于 assets/plugins/demotracer-css-v1.6.12.zip，许可见同目录 DemoTracer-LICENSE.txt，文件与归档 SHA-256 见 src/demo-payload-manifest.json。对应完整源码及构建说明：https://github.com/unicbm/demotracer/tree/v1.6.12 。来源组件的许可和致谢记录随源码保留。安装适配不修改 DLL；与人机增强共存时使用回放包匹配的 BotRandomizer/API/Harmony，避免旧版覆盖。

- Inventory Simulator v3.8.2，Ian Lucas，MIT：https://github.com/ianlucas/cs2-css-inventory-simulator/tree/v3.8.2 。官方 ZIP 原样保存在 assets/plugins/InventorySimulator-v3.8.2.zip，许可全文为同目录 InventorySimulator-LICENSE.txt。应用只增加安装、共存、卸载与便捷入口，不改动其 DLL。共享运行库从已校验的 CS2BotImprover v1.4.7 包提取，开发源文件位于 assets/plugins/cs2-shared-runtime.zip，安装包排除此大资源，由夸克分享提供，文件清单和校验值见 src/shared-runtime-manifest.json。包含 CounterStrikeSharp（GPL-3.0，https://github.com/roflmuffin/CounterStrikeSharp）、Metamod:Source（GPL 及上游例外，https://github.com/alliedmodders/metamod-source）与 .NET（MIT 及第三方许可，包内 dotnet/LICENSE.txt、ThirdPartyNotices.txt）；依赖与 API 保持原文件。
- CS2 共享运行库更新包：assets/plugins/cs2-runtime-1.0.380-overlay.zip，约 18.1 MB，从已校验的人机增强 1.4.9 官方包提取 46 个更新文件，将外部基础运行库升级到 CounterStrikeSharp 1.0.380 与配套 Metamod/KHook；不附带人机插件。原文件哈希见 src/runtime-overlay-manifest.json。许可沿用上条的 CounterStrikeSharp、Metamod 和相应依赖许可。完整对应源码：CounterStrikeSharp https://github.com/roflmuffin/CounterStrikeSharp/tree/2273dd1631a5719f2cacc6e9abbf67ac0bc30bc0 ，Metamod https://github.com/alliedmodders/metamod-source/tree/170058a2f0dbd58106b7c76bfe88a94672295356 。
- LinkSwift 1.1.3，hmjz100 等作者：https://github.com/hmjz100/LinkSwift/tree/v1.1.3 。AGPL-3.0-or-later。原用户脚本、版权头和许可位于 src/linkswift/；雨巷来信的隔离会话、GM API 和 IPC 适配位于 src/main.cjs、src/site-preload.cjs 等文件。修改与适配记录见 docs/开源说明.md。
- jQuery 3.6.0，OpenJS Foundation 及贡献者，MIT。
- SweetAlert2 11.4.8，Tristan Edwards、Limon Monte 及贡献者，MIT。
- SweetAlert2 theme-dark 5.0.26，相关贡献者，MIT。
- js-md5 0.7.3、js-sha256 0.11.1，Chen, Yi-Cyuan，MIT。

上述前端依赖的完整许可副本位于 src/linkswift/third-party-licenses/，与第三方原文件一起保留。LinkSwift 的许可全文位于 src/linkswift/AGPL-3.0-or-later.txt。

Electron 采用 MIT，分发的 Electron 运行时包含 LICENSE.electron.txt 和 LICENSES.chromium.html，Chromium 等组件保留各自许可；请在最终安装包中保留这些文件。electron-builder、NSIS 等构建工具及其插件保留各自许可，不因本项目选择 AGPL 而改变许可。

## 外部获取，不随项目分发

DemoTracer GUI v1.6.12 使用专有许可，允许个人和商业免费使用，但不授予再分发权。雨巷不附带该安装程序或 GUI 二进制，仅提供用户主动选择官方安装包或从官方 Release 获取、校验、安装及启动的入口。许可副本见 assets/plugins/DemoTracer-DESKTOP-LICENSE.txt。官方下载：https://github.com/unicbm/demotracer/releases/tag/v1.6.12 。GUI、回放插件版本应匹配，WebView2 由用户设备提供。

CS2-Bot-Improver v1.4.9，ed0ard 及贡献者：
https://github.com/ed0ard/CS2-Bot-Improver/tree/v1.4.9

主项目 LICENSE 为 AGPL-3.0。Panel/LICENSE 单独使用 PolyForm Strict 1.0.0，限制与主插件不同，不能将 Panel 宣称为本项目 AGPL 授权的代码。Panel 许可：
https://github.com/ed0ard/CS2-Bot-Improver/blob/v1.4.9/Panel/LICENSE

雨巷来信只提供玩家主动获取官方包、哈希校验、复制安装及卸载管理，不包含人机功能插件、Panel 源码或 EXE、VPK 及完整官方 ZIP；上述共享运行库通过夸克分享单独提供。卸载清单记录官方 v1.4.9 与旧版 v1.4.7 文件路径及 SHA-256，供识别文件使用。外部包中的 CounterStrikeSharp、Metamod 等仍按各自许可使用。使用和再次分发官方包前，应分别阅读上游与各依赖许可。

Steam、Counter-Strike 2 及相关名称和素材权利属于各自权利人。雨巷来信与 Valve、各网盘服务及上述上游项目没有官方关联、合作或认可关系。项目许可证不授予第三方商标、服务访问权限或资源包再分发权。
- XCMusic 0.3.1，YiktLLW 及贡献者，MIT：https://github.com/yiktllw/XCMusic 。完整源码保留于 vendor/XCMusic；修改后的对应源码随应用附带为 assets/clients/XCMusic-0.3.1-source.zip，许可为 XCMusic-LICENSE.txt。完整 Electron / Vue Windows x64 客户端为 XCMusic-win-x64.zip，归档与逐文件 SHA-256 见 src/xcmusic-payload-manifest.json。修改包括独立验收数据目录、桌面文件存储、本机动态 API 端口及启动适配。Electron / Chromium 与 @yiktllw/ncm-api 4.24.2（MIT）等依赖许可随客户端提供，见 XCMusic-NOTICES.txt、LICENSE.electron.txt、LICENSES.chromium.html 和 dependency-licenses。保留上游功能与署名；雨巷不代登录，不改变平台歌曲授权。
