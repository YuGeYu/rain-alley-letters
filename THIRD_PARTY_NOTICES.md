# 开源许可与第三方致谢

雨巷来信完整相应源码：https://github.com/YuGeYu/rain-alley-letters 。分发二进制时，请同时保留本说明及该版本对应的源码获取方式。

Copyright (C) 2026 雨巷来信工作室。雨巷来信自己的代码采用 GNU Affero General Public License v3.0 or later（SPDX: AGPL-3.0-or-later）。完整许可见 LICENSE。软件按现状提供，不作担保。源码包含构建脚本、桌面客户端、服务端和集成适配代码；分发修改版时请标注修改并提供相应源码。

## 随应用分发

- Inventory Simulator v3.7.2，Ian Lucas，MIT：https://github.com/ianlucas/cs2-css-inventory-simulator/tree/v3.7.2 。官方 ZIP 原样保存在 assets/plugins/InventorySimulator-v3.7.2.zip，许可全文为同目录 InventorySimulator-LICENSE.txt。应用只增加安装、共存、卸载与便捷入口，不改动其 DLL。共享运行库从已校验的 CS2BotImprover v1.4.7 包提取，随应用放在 assets/plugins/cs2-shared-runtime.zip，文件清单和校验值见 src/shared-runtime-manifest.json。包含 CounterStrikeSharp（GPL-3.0，https://github.com/roflmuffin/CounterStrikeSharp）、Metamod:Source（GPL 及上游例外，https://github.com/alliedmodders/metamod-source）与 .NET（MIT 及第三方许可，包内 dotnet/LICENSE.txt、ThirdPartyNotices.txt）；依赖与 API 保持原文件。
- LinkSwift 1.1.3，hmjz100 等作者：https://github.com/hmjz100/LinkSwift/tree/v1.1.3 。AGPL-3.0-or-later。原用户脚本、版权头和许可位于 src/linkswift/；雨巷来信的隔离会话、GM API 和 IPC 适配位于 src/main.cjs、src/site-preload.cjs 等文件。修改与适配记录见 docs/开源说明.md。
- jQuery 3.6.0，OpenJS Foundation 及贡献者，MIT。
- SweetAlert2 11.4.8，Tristan Edwards、Limon Monte 及贡献者，MIT。
- SweetAlert2 theme-dark 5.0.26，相关贡献者，MIT。
- js-md5 0.7.3、js-sha256 0.11.1，Chen, Yi-Cyuan，MIT。

上述前端依赖的完整许可副本位于 src/linkswift/third-party-licenses/，与第三方原文件一起保留。LinkSwift 的许可全文位于 src/linkswift/AGPL-3.0-or-later.txt。

Electron 采用 MIT，分发的 Electron 运行时包含 LICENSE.electron.txt 和 LICENSES.chromium.html，Chromium 等组件保留各自许可；请在最终安装包中保留这些文件。electron-builder、NSIS 等构建工具及其插件保留各自许可，不因本项目选择 AGPL 而改变许可。

## 外部获取，不随项目分发

CS2-Bot-Improver v1.4.7，ed0ard 及贡献者：
https://github.com/ed0ard/CS2-Bot-Improver/tree/v1.4.7

主项目 LICENSE 为 AGPL-3.0。Panel/LICENSE 单独使用 PolyForm Strict 1.0.0，限制与主插件不同，不能将 Panel 宣称为本项目 AGPL 授权的代码。Panel 许可：
https://github.com/ed0ard/CS2-Bot-Improver/blob/v1.4.7/Panel/LICENSE

雨巷来信只提供玩家主动获取官方包、哈希校验、复制安装及卸载管理，不包含人机功能插件、Panel 源码或 EXE、VPK 及完整官方 ZIP；上述共享运行库单独随应用附带。卸载清单只记录官方 v1.4.7 文件路径与 SHA-256，供识别文件使用。外部包中的 CounterStrikeSharp、Metamod 等仍按各自许可使用。使用和再次分发官方包前，应分别阅读上游与各依赖许可。

Steam、Counter-Strike 2 及相关名称和素材权利属于各自权利人。雨巷来信与 Valve、各网盘服务及上述上游项目没有官方关联、合作或认可关系。项目许可证不授予第三方商标、服务访问权限或资源包再分发权。
