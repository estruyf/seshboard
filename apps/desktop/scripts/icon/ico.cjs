// Builds the Windows icon (.ico) from the 1024×1024 PNG, with Electron's image functions so it runs on
// any OS. Windows icons fill their square, so the macOS margin and shadow are cropped off first, as for
// the sidebar's icon. Each size is stored as PNG data, which Windows reads since Vista.
// Usage: electron scripts/icon/ico.cjs <in.png> <out.ico>
const { app, nativeImage } = require('electron');
const { writeFileSync } = require('node:fs');

const [input, output] = process.argv.slice(-2);
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
/** The square of the 1024px icon that holds the tile, without macOS's margin and shadow. */
const TILE = { x: 94, y: 94, width: 836, height: 836 };

app.dock?.hide();
app.whenReady().then(() => {
  const tile = nativeImage.createFromPath(input).crop(TILE);
  const images = SIZES.map((size) => tile.resize({ width: size, height: size, quality: 'best' }).toPNG());
  // ICONDIR (6 bytes), one ICONDIRENTRY (16 bytes) per size, then the images.
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((png, i) => {
    const entry = 6 + 16 * i;
    // A width or height of 256 is written as 0.
    header.writeUInt8(SIZES[i] % 256, entry);
    header.writeUInt8(SIZES[i] % 256, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  writeFileSync(output, Buffer.concat([header, ...images]));
  app.exit(0);
});
