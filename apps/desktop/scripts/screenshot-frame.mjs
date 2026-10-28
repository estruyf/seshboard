/**
 * Puts the raw README screenshots in a macOS window frame (rounded corners, traffic lights, shadow)
 * on a backdrop that matches their theme. An Electron main script, run by scripts/screenshots.ts:
 *   electron scripts/screenshot-frame.mjs <raw dir> <out dir> <window width in points>
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, nativeImage } from 'electron';

const [inDir, outDir, pointsArg] = process.argv.slice(-3);
const points = Number(pointsArg);
/** Width of the app window in the framed image, in pixels: sharp on a Retina README, without huge files. */
const WIDTH = 1760;
const PAD = 88;

const BACKDROP = {
  light: 'radial-gradient(120% 90% at 15% 0%, #fff3bf 0%, rgba(255,243,191,0) 55%), linear-gradient(160deg, #f6f7fb 0%, #e3e8f2 100%)',
  dark: 'radial-gradient(120% 90% at 15% 0%, rgba(255,212,59,0.16) 0%, rgba(255,212,59,0) 55%), linear-gradient(160deg, #262c3a 0%, #0f1218 100%)',
};

function page(src, width, height, scheme) {
  const scale = width / points;
  // The window's own traffic lights aren't in the capture: draw them where the app puts them (16, 18).
  const lights = ['#ff5f57', '#febc2e', '#28c840']
    .map((colour, i) => `<i style="left:${(16 + i * 20) * scale}px;top:${18 * scale}px;width:${12 * scale}px;height:${12 * scale}px;background:${colour}"></i>`)
    .join('');
  return `<!doctype html><html><head><style>
    html, body { margin: 0; width: ${width + PAD * 2}px; height: ${height + PAD * 2}px; overflow: hidden; background: ${BACKDROP[scheme]}; }
    .window { position: absolute; left: ${PAD}px; top: ${PAD}px; width: ${width}px; height: ${height}px; border-radius: ${12 * scale}px; overflow: hidden;
      box-shadow: 0 ${30 * scale}px ${70 * scale}px rgba(0,0,0,${scheme === 'dark' ? 0.55 : 0.22}), 0 0 0 1px rgba(${scheme === 'dark' ? '255,255,255,0.12' : '0,0,0,0.12'}); }
    .window img { display: block; width: ${width}px; height: ${height}px; }
    i { position: absolute; border-radius: 50%; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.18); }
  </style></head><body><div class="window"><img src="${src}">${lights}</div></body></html>`;
}

app.dock?.hide();
app.whenReady().then(async () => {
  // Data URLs this big don't load: each page and its image go through a temporary folder.
  const work = mkdtempSync(join(tmpdir(), 'seshboard-frame-'));
  const files = readdirSync(inDir).filter((name) => name.endsWith('.png') && name !== 'failed.png');
  // One offscreen window for every image: opening a fresh one each time fails to load from the second on.
  const win = new BrowserWindow({ show: false, useContentSize: true, frame: false, webPreferences: { offscreen: true } });
  for (const name of files) {
    const raw = nativeImage.createFromPath(join(inDir, name));
    const image = raw.resize({ width: WIDTH, quality: 'best' });
    const { width, height } = image.getSize();
    const scheme = name.includes('-light') ? 'light' : 'dark';
    win.setContentSize(width + PAD * 2, height + PAD * 2);
    writeFileSync(join(work, name), image.toPNG());
    writeFileSync(join(work, `${name}.html`), page(name, width, height, scheme));
    await win.loadFile(join(work, `${name}.html`));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const framed = await win.webContents.capturePage();
    writeFileSync(join(outDir, name), framed.toPNG());
    console.log(`  ${name} ${framed.getSize().width}×${framed.getSize().height}`);
  }
  win.destroy();
  rmSync(work, { recursive: true, force: true });
  app.exit(0);
}).catch((error) => {
  console.error(`✗ framing failed: ${error.message}`);
  app.exit(1);
});
