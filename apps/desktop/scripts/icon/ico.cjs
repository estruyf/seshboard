// Builds the Windows icon (.ico) from the 1024×1024 PNG, with Electron's image functions so it runs on
// any OS. Windows icons fill their square, so the macOS margin and shadow are cropped off first, as for
// the sidebar's icon (icoFile.cjs).
// Usage: electron scripts/icon/ico.cjs <in.png> <out.ico>
const { app, nativeImage } = require('electron');
const { writeFileSync } = require('node:fs');
const { icoFile, TILE } = require('./icoFile.cjs');

const [input, output] = process.argv.slice(-2);

app.dock?.hide();
app.whenReady().then(() => {
  writeFileSync(output, icoFile(nativeImage.createFromPath(input).crop(TILE)));
  app.exit(0);
});
