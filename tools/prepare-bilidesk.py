"""Prepare complete BiliDesk binaries, corresponding patched sources and notices."""
from pathlib import Path
import hashlib, json, os, zipfile

root = Path(__file__).resolve().parent.parent
previous = json.loads((root / 'src/bilidesk-payload-manifest.json').read_text(encoding='utf-8'))
published = root / '.work/bilidesk-publish'
vendor = root / 'vendor/BiliDesk'
assets = root / 'assets/clients'
assets.mkdir(parents=True, exist_ok=True)
required = ['BiliDesk.exe', 'BiliDesk.dll', 'coreclr.dll', 'hostfxr.dll',
            'PresentationFramework.dll', 'LibVLCSharp.dll', 'libvlc/win-x64/libvlc.dll',
            'libvlc/win-x64/libvlccore.dll']
for name in required:
    if not (published / name).is_file():
        raise RuntimeError('Missing runtime file: ' + name)

notices = '''BiliDesk 1.6.2 / Rain Alley integration, 2026-11-05
Upstream: https://github.com/ABING1111/BiliDesk
Copyright: BiliDesk contributors. License: GPL-3.0 (see BiliDesk-LICENSE.txt).
Corresponding complete patched source: BiliDesk-1.6.2-source.zip, supplied alongside the binary.
Changes: optional isolated QA data directory and single-instance identity. Default user profile unchanged.
Build: .NET SDK 10, dotnet publish BiliDesk/BiliDesk.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -p:PublishTrimmed=false

This is a third-party client, not affiliated with Bilibili. All upstream features, credits and first-run disclaimer retained.
Components (unmodified dependency binaries):
LibVLCSharp / LibVLCSharp.WPF 3.8.0: LGPL-2.1-or-later
  https://code.videolan.org/videolan/LibVLCSharp/-/tree/3.8.0
VideoLAN.LibVLC.Windows 3.0.24: LGPL-2.1-or-later; bundled codec/plugin licenses also apply.
  https://get.videolan.org/vlc/3.0.24/ (corresponding VLC source distribution)
  https://code.videolan.org/videolan/vlc
Microsoft.Web.WebView2 1.0.4191.47: Microsoft WebView2 SDK license, included from NuGet.
  https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4191.47
.NET 10 runtime and Windows Desktop runtime: MIT and third-party notices shipped with runtime.
  https://github.com/dotnet/runtime ; https://github.com/dotnet/wpf
Native LGPL libraries are shipped as separate replaceable DLLs; no single-file embedding or trimming.
Dependency license material from the official NuGet archives is in dependency-licenses/.
'''
(published / 'BiliDesk-LICENSE.txt').write_bytes((vendor / 'LICENSE').read_bytes())
(published / 'BiliDesk-NOTICES.txt').write_text(notices, encoding='utf-8')
packages = Path(os.environ['USERPROFILE']) / '.nuget/packages'
for package, version in [('libvlcsharp','3.8.0'), ('libvlcsharp.wpf','3.8.0'),
                         ('videolan.libvlc.windows','3.0.24'), ('microsoft.web.webview2','1.0.4191.47'),
                         ('microsoft.netcore.app.runtime.win-x64','10.0.9'),
                         ('microsoft.windowsdesktop.app.runtime.win-x64','10.0.9')]:
    archive = packages / package / version / f'{package}.{version}.nupkg'
    if not archive.is_file():
        raise RuntimeError('Missing dependency package: ' + str(archive))
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            if not name.endswith('/') and any(term in Path(name).name.lower() for term in ['license','licence','copying','notice','copyright']):
                target = published / 'dependency-licenses' / package / name
                if '..' in Path(name).parts or name.startswith('/'):
                    raise RuntimeError('Unsafe dependency path')
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(z.read(name))

lgpl = vendor / 'third-party-licenses/LGPL-2.1.txt'
if not lgpl.is_file() or b'GNU LESSER GENERAL PUBLIC LICENSE' not in lgpl.read_bytes():
    raise RuntimeError('Missing LGPL 2.1 license text')
for package in ['libvlcsharp','libvlcsharp.wpf','videolan.libvlc.windows']:
    target = published / 'dependency-licenses' / package / 'LGPL-2.1.txt'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(lgpl.read_bytes())

with zipfile.ZipFile(assets / 'BiliDesk-1.6.2-source.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for item in sorted(vendor.rglob('*')):
        if item.is_file() and not any(part in {'bin','obj','.vs','.git'} for part in item.relative_to(vendor).parts):
            z.write(item, 'BiliDesk/' + item.relative_to(vendor).as_posix())

files, unpacked = {}, 0
with zipfile.ZipFile(assets / 'BiliDesk-win-x64.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for item in sorted(published.rglob('*')):
        if not item.is_file(): continue
        name = item.relative_to(published).as_posix()
        data = item.read_bytes()
        files[name] = hashlib.sha256(data).hexdigest()
        unpacked += len(data)
        z.write(item, name)
archive = (assets / 'BiliDesk-win-x64.zip').read_bytes()
manifest = dict(version='1.6.2', archiveSha256=hashlib.sha256(archive).hexdigest(),
                sourceSha256=hashlib.sha256((assets / 'BiliDesk-1.6.2-source.zip').read_bytes()).hexdigest(),
                originalSourceSha256=hashlib.sha256(Path('E:/dow/BiliDesk-1.6.2.zip').read_bytes()).hexdigest() if Path('E:/dow/BiliDesk-1.6.2.zip').is_file() else previous.get('originalSourceSha256', ''),
                archiveBytes=len(archive), unpackedBytes=unpacked, files=files)
(root / 'src/bilidesk-payload-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
for name in ['BiliDesk-LICENSE.txt','BiliDesk-NOTICES.txt']:
    (assets / name).write_bytes((published / name).read_bytes())
# The resized 128px upstream icon is checked into src/bilidesk-icon.png.
print(json.dumps({k:v for k,v in manifest.items() if k != 'files'}, indent=2))
print('Files:',len(files))
