# 雨巷来信集成说明

上游：<https://github.com/ABING1111/BiliDesk>，版本 1.6.2，GPL-3.0。
原始源码来自用户提供的 BiliDesk-1.6.2.zip。完整上游功能、署名、许可和免责声明保留。

2026-11-05 修改：新增 RainAlleyProfile.cs，仅为开发与验收允许通过
`RAIN_ALLEY_BILIDESK_PROFILE` 指定独立的绝对路径，并为该路径生成独立的单实例标识。
未设置时仍使用上游默认 `%LOCALAPPDATA%\BiliDesk` 及单实例名称。
此机制用于隔离本机预览，不复制、读取或迁移玩家已有账号数据。

本地预览构建（自包含 .NET 10 x64，保留 LibVLC）：

```powershell
dotnet publish BiliDesk/BiliDesk.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -p:PublishTrimmed=false -o ../../.work/bilidesk-publish
```

雨巷集成管理器、目录详情页及构建资源脚本位于主项目的 src/bilidesk-* 与 tools/prepare-bilidesk.cjs。
发布附带对应源码压缩包、上游 LICENSE 和依赖许可。视频、直播和账号服务仍由 B 站提供，
可用清晰度及账号操作由平台权限决定。
