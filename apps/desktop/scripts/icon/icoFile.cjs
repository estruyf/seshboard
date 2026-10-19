// Writes a Windows icon (.ico) from the tile of a 1024×1024 icon, every size Windows asks for. Each size is stored as
// PNG data, which Windows reads since Vista. Shared by ico.cjs (the app's icon) and app-icons.cjs (the colourways).
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
/** The square of the 1024px icon that holds the tile, without macOS's margin and shadow (MAC_TILE in the protocol). */
const TILE = { x: 94, y: 94, width: 836, height: 836 };

/** The .ico's bytes for a tile (an Electron NativeImage, already cropped to TILE). */
function icoFile(tile) {
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
  return Buffer.concat([header, ...images]);
}

module.exports = { icoFile, TILE };
