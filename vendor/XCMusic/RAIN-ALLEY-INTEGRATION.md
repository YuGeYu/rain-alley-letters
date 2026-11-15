# Rain Alley Windows integration

Original source: https://github.com/yiktllw/XCMusic, supplied XCMusic-master.zip, package version 0.3.1, MIT.

The full Vue/Electron application is retained. Rain Alley supplies a standalone Windows x64 client and manages its installation separately from personal data. Electron is supplied from the host workspace runtime. No Tauri fallback is used because upstream marks it incomplete.

Desktop adaptations: optional absolute RAIN_ALLEY_XCMUSIC_PROFILE for isolated preview; synchronous desktop-state JSON persistence in place of browser storage; private loopback API on a dynamically assigned port, ready before renderer startup; explicit preload isolation; restored single-instance window visibility; corrected application icons; default musical-note cover for local tracks without embedded artwork. No account login or rights bypass is performed.

Build in PowerShell: npm ci --ignore-scripts; $env:ELECTRON_OVERRIDE_DIST_PATH=(Resolve-Path ../../node_modules/electron/dist).Path; node node_modules/@vue/cli-service/bin/vue-cli-service.js electron:build --dir --win --x64. The override lets the legacy build plugin discover the supplied Electron runtime without downloading a second copy. Client resource preparation is tools/prepare-xcmusic.py in the Rain Alley workspace. Corresponding patched source excludes node_modules, dist and generated build output. Dependency license texts ship with the standalone client. Normal user data remains in %APPDATA%/xc-music independently of the program directory.

From the Rain Alley root, `node tools/build-xcmusic.cjs` supplies the Electron override automatically. Windows resource editing is disabled because modified runtime executables were denied execution on the preview machine. The original Electron executable is renamed XCMusic.exe without modifying its bytes. Window/tray icons and AppUserModelID are set by the application. The EXE file properties retain Electron's original product information and Explorer executable icon; they are not represented as a custom signed XCMusic binary.
