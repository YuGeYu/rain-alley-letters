const { app, nativeImage } = require('electron');
const path = require('node:path');
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const root = path.resolve(__dirname, '..');
  for (const file of [path.join(root, 'assets/rain-alley.ico'), path.join(root, 'release/win-unpacked/resources/app.asar/assets/rain-alley.ico')]) {
    const image = nativeImage.createFromPath(file);
    console.log(JSON.stringify({ file, empty: image.isEmpty(), size: image.getSize() }));
  }
  app.quit();
});
