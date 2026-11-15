"""Prepare full XCMusic desktop runtime and corresponding patched sources locally."""
from pathlib import Path
import hashlib, json, zipfile, shutil
root=Path(__file__).resolve().parent.parent
vendor=root/'vendor/XCMusic'
published=vendor/'dist_electron/win-unpacked'
assets=root/'assets/clients'
assets.mkdir(parents=True,exist_ok=True)
for name in ['XCMusic.exe','resources/app.asar','LICENSE.electron.txt','LICENSES.chromium.html']:
    if not (published/name).is_file(): raise RuntimeError('Missing complete runtime file: '+name)
notices='''XCMusic 0.3.1 / Rain Alley Windows integration
Upstream: https://github.com/yiktllw/XCMusic
Copyright XCMusic contributors; MIT license, see XCMusic-LICENSE.txt.
Corresponding complete patched source: XCMusic-0.3.1-source.zip.
Original user-supplied archive: XCMusic-master.zip.
Full Electron/Vue client retained, including local music, download, lyrics, themes,
search, QR login and account interfaces. Platform authorization applies to all music.
Changes: desktop JSON state instead of browser localStorage; isolated preview data;
private dynamic loopback API; startup ordering; corrected Windows icon and runtime.
Build instructions and integration changes are in RAIN-ALLEY-INTEGRATION.md.
Electron runtime MIT and Chromium third-party licenses are supplied alongside the client.
@yiktllw/ncm-api 4.24.2: MIT, Binaryify and contributors.
Dependency license and package metadata are in dependency-licenses/.
This is an independent third-party client, not an official NetEase product.
'''
(published/'XCMusic-LICENSE.txt').write_bytes((vendor/'LICENSE').read_bytes())
(published/'XCMusic-NOTICES.txt').write_text(notices,encoding='utf-8')
# Retain license texts and package metadata for dependencies, including nested packages.
for package in (vendor/'node_modules').rglob('package.json'):
    if not package.is_file(): continue
    try: meta=json.loads(package.read_text(encoding='utf-8'))
    except (ValueError,UnicodeError): continue
    if not meta.get('name') or not meta.get('version'): continue
    rel=package.parent.relative_to(vendor/'node_modules')
    dest=published/'dependency-licenses'/rel
    for item in package.parent.iterdir():
        if item.is_file() and (item.name=='package.json' or any(x in item.name.lower() for x in ['license','licence','copying','notice','copyright'])):
            dest.mkdir(parents=True,exist_ok=True);shutil.copyfile(item,dest/item.name)
with zipfile.ZipFile(assets/'XCMusic-0.3.1-source.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for directory,dirs,files in __import__('os').walk(vendor):
        dirs[:]=[x for x in dirs if x not in {'node_modules','dist','dist_electron','.git','.husky'}]
        for name in sorted(files):
            item=Path(directory)/name
            z.write(item,'XCMusic/'+item.relative_to(vendor).as_posix())
files={};unpacked=0
with zipfile.ZipFile(assets/'XCMusic-win-x64.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for item in sorted(published.rglob('*')):
        if not item.is_file():continue
        name=item.relative_to(published).as_posix();data=item.read_bytes()
        files[name]=hashlib.sha256(data).hexdigest();unpacked+=len(data);z.write(item,name)
archive=(assets/'XCMusic-win-x64.zip').read_bytes()
manifest=dict(version='0.3.1',archiveSha256=hashlib.sha256(archive).hexdigest(),sourceSha256=hashlib.sha256((assets/'XCMusic-0.3.1-source.zip').read_bytes()).hexdigest(),originalSourceSha256=hashlib.sha256(Path('E:/dow/XCMusic-master.zip').read_bytes()).hexdigest(),archiveBytes=len(archive),unpackedBytes=unpacked,files=files)
(root/'src/xcmusic-payload-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for name in ['XCMusic-LICENSE.txt','XCMusic-NOTICES.txt']:shutil.copyfile(published/name,assets/name)
print(json.dumps({k:v for k,v in manifest.items() if k!='files'},indent=2));print('Files:',len(files))
