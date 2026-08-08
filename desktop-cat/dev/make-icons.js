/*
 * dev/make-icons.js — render assets/*.png from dev/icon.html.
 *
 *   xvfb-run -a npx electron dev/make-icons.js --no-sandbox
 *
 * Regenerate whenever the icon drawing changes; the PNGs are committed so a
 * plain `npm start` needs no build step.
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();

const OUT = path.resolve(__dirname, '../assets');

// Tray icons are template-style monochrome on macOS and full colour elsewhere;
// shipping both lets main.js pick without platform-specific drawing code.
const JOBS = [
  { name: 'tray.png', size: 22, mono: false },
  { name: 'tray@2x.png', size: 44, mono: false },
  { name: 'trayTemplate.png', size: 22, mono: true },
  { name: 'trayTemplate@2x.png', size: 44, mono: true },
  { name: 'icon-256.png', size: 256, mono: false },
  { name: 'icon-512.png', size: 512, mono: false },
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 600, height: 600, show: false });
  await win.loadFile(path.join(__dirname, 'icon.html'));
  fs.mkdirSync(OUT, { recursive: true });

  for (const job of JOBS) {
    const dataUrl = await win.webContents.executeJavaScript(
      `drawIcon(${job.size}, ${job.mono})`
    );
    const b64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(path.join(OUT, job.name), Buffer.from(b64, 'base64'));
    console.log(`wrote assets/${job.name} (${job.size}px)`);
  }
  app.quit();
});
