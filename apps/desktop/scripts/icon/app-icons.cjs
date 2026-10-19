// Renders the app icon colourways for app-icons.mjs, in one Electron run: each SVG once at 1024×1024 with Chromium,
// as render.cjs does, then every file made from it, scaled down (or cropped to the tile first, as ico.cjs does).
// Usage: electron scripts/icon/app-icons.cjs <jobs.json>
//   jobs.json: [{ svg: "<svg…>", outputs: [{ file, size, tile?: true, ico?: true }] }]
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { icoFile, TILE } = require('./icoFile.cjs');

const jobs = JSON.parse(readFileSync(process.argv[process.argv.length - 1], 'utf8'));
app.dock?.hide();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  for (const job of jobs) {
    const html = `<!doctype html><html><body style="margin:0;background:transparent">
      <img src="data:image/svg+xml;base64,${Buffer.from(job.svg).toString('base64')}" width="1024" height="1024" style="display:block">
    </body></html>`;
    await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const image = (await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })).resize({ width: 1024, height: 1024, quality: 'best' });
    for (const output of job.outputs) {
      const source = output.tile ? image.crop(TILE) : image;
      const bytes = output.ico ? icoFile(source) : source.resize({ width: output.size, height: output.size, quality: 'best' }).toPNG();
      writeFileSync(output.file, bytes);
    }
  }
  app.exit(0);
});
