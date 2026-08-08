/*
 * dev/shot.js — headless screenshot helper.
 *
 *   xvfb-run -a npx electron dev/shot.js <page.html> <out.png> [width] [height] [waitMs]
 *
 * Used to eyeball the procedural cat art without a desktop.
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// Electron may inject switches before the script path, so locate ourselves
// rather than trusting a fixed argv offset.
const argv = process.argv.slice(1).filter((a) => !a.startsWith('--'));
const selfIdx = argv.findIndex((a) => a.endsWith('shot.js'));
const [pageArg, outArg, wArg, hArg, waitArg] = argv.slice(selfIdx + 1);

// Allow "dev/detail.html?debug" so pages can expose diagnostic overlays.
const [pagePath, pageQuery] = String(pageArg || 'dev/pose-sheet.html').split('?');
const page = path.resolve(pagePath);
const out = path.resolve(outArg || 'dev/shot.png');
const width = parseInt(wArg || '1280', 10);
const height = parseInt(hArg || '900', 10);
const waitMs = parseInt(waitArg || '1200', 10);

if (!out.endsWith('.png')) {
  console.error(`refusing to write a screenshot to a non-.png path: ${out}`);
  process.exit(1);
}

app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width, height, show: false });
  const errors = [];
  win.webContents.on('console-message', (e) => {
    const level = e.level == null ? e : e.level;
    const message = e.message == null ? '' : e.message;
    if (level === 'error' || level === 3) errors.push(message);
    console.log(`[page:${level}] ${message}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.error('renderer gone', d);
    process.exitCode = 1;
  });

  await win.loadFile(page, pageQuery ? { search: pageQuery } : undefined);
  await new Promise((r) => setTimeout(r, waitMs));
  const pageErrs = await win.webContents.executeJavaScript('window.__errs || []').catch(() => []);
  for (const m of pageErrs) console.error(`[page-error] ${m}`);
  if (pageErrs.length) process.exitCode = 1;
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log(`wrote ${out} (${width}x${height}), page errors: ${errors.length}`);
  if (errors.length) process.exitCode = 1;
  app.quit();
});
