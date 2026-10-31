Unicode true
RequestExecutionLevel user
SetCompressor zlib
!include "MUI2.nsh"
!include "LogicLib.nsh"
!addplugindir "@PLUGIN_DIR@"

Name "雨巷来信"
OutFile "@OUT_FILE@"
InstallDir "$LOCALAPPDATA\Programs\雨巷来信"
InstallDirRegKey HKCU "Software\RainAlley\Letters" "InstallLocation"
BrandingText "雨巷来信 · 雨后的街角"
!define MUI_ABORTWARNING
!define MUI_ICON "@ICON@"
!define MUI_UNICON "@ICON@"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "@HEADER@"
!define MUI_WELCOMEFINISHPAGE_BITMAP "@SIDEBAR@"
!define MUI_FINISHPAGE_RUN "$INSTDIR\雨巷来信.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动雨巷来信"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "主程序"
  SetShellVarContext current
  InitPluginsDir
  File /oname=$PLUGINSDIR\app.7z "@APP_PACKAGE@"
  SetOutPath "$INSTDIR"
  CreateDirectory "$PLUGINSDIR\7z-out"
  ; Nsis7z::Extract 不返回 success 字符串。先保存安装目录，再把档案解到临时目录。
  Push $OUTDIR
  SetOutPath "$PLUGINSDIR\7z-out"
  Nsis7z::Extract "$PLUGINSDIR\app.7z"
  Pop $0 ; 恢复刚才保存的安装目录（$OUTDIR）
  SetOutPath $0
  ClearErrors
  CopyFiles /SILENT "$PLUGINSDIR\7z-out\*" "$INSTDIR"
  IfErrors InstallCopyFailed
  File /oname=README.txt "@README@"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\雨巷来信"
  CreateShortcut "$SMPROGRAMS\雨巷来信\雨巷来信.lnk" "$INSTDIR\雨巷来信.exe" "" "$INSTDIR\雨巷来信.exe" 0
  CreateShortcut "$DESKTOP\雨巷来信.lnk" "$INSTDIR\雨巷来信.exe" "" "$INSTDIR\雨巷来信.exe" 0
  WriteRegStr HKCU "Software\RainAlley\Letters" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RainAlleyLetters" "DisplayName" "雨巷来信"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RainAlleyLetters" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  Goto InstallSectionDone
InstallCopyFailed:
  MessageBox MB_OK|MB_ICONSTOP "应用文件解压失败。请检查磁盘空间和安装目录权限后重试。"
  Abort
InstallSectionDone:
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\雨巷来信.lnk"
  Delete "$SMPROGRAMS\雨巷来信\雨巷来信.lnk"
  RMDir "$SMPROGRAMS\雨巷来信"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\RainAlley\Letters"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RainAlleyLetters"
SectionEnd
