/*
 * main.js — the overlay, the sensor loop and the tray.
 *
 * The cat lives in one transparent, frameless, click-through window that covers
 * a whole display's work area. Because the window ignores mouse events
 * entirely, it can never steal a click: the cat is "touched" by watching where
 * the cursor goes, not by receiving events. That keeps it out of your way, and
 * means stroking works even though the window is untouchable.
 *
 * Going "behind" other windows is done two ways: dropping alwaysOnTop for a
 * genuine disappearance, and erasing the part of the canvas that overlaps the
 * foreground window so the cat looks occluded by it while still on top.
 */
'use strict';

const {
  app, BrowserWindow, screen, ipcMain, Tray, Menu,
  globalShortcut, nativeImage, powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');

const { Sensors } = require('./sensors');
const { Store } = require('./store');
const { foregroundWindow } = require('./window-probe');

const DEBUG = process.argv.includes('--cat-debug');
// Separate flag: the skeleton overlay is useful when tuning poses, but it
// obscures the art, so the HUD does not imply it.
const SKELETON = process.argv.includes('--cat-skeleton');
const TICK_MS = 1000 / 60;
const PROBE_MS = 2500;
const DISPLAY_SWITCH_DELAY = 2.0; // seconds of cursor on another screen

if (process.platform === 'linux') {
  // Transparent windows need an ARGB visual, which is not the default here.
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

let win = null;
let tray = null;
let store = null;
let sensors = null;

let currentDisplayId = null;
let otherDisplayT = 0;
let onTop = true;
let paused = false;
let occluders = [];
let report = { wantsOnTop: true, note: 'starting', needs: null, hiddenBehind: false };
let tickTimer = null;
let probeTimer = null;
let lastTickAt = Date.now();

// --------------------------------------------------------------- window ----

function displayById(id) {
  return screen.getAllDisplays().find((d) => d.id === id) || screen.getPrimaryDisplay();
}

function createWindow(display) {
  const wa = display.workArea;
  win = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    acceptFirstMouse: false,
    show: false,
    // A panel floats above full-screen spaces on macOS.
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  // Completely transparent to input, forever. `forward` keeps Windows sending
  // move notifications to the window without making it clickable.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (process.platform === 'darwin') win.setWindowButtonVisibility(false);

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  // ready-to-show can beat the renderer's script execution, so config is sent
  // again once the document has finished loading and the listener exists.
  win.webContents.on('did-finish-load', sendConfig);
  win.once('ready-to-show', () => {
    if (!paused) win.showInactive();
    sendConfig();
    maybeScreenshot();
  });
  win.on('closed', () => { win = null; });

  currentDisplayId = display.id;
  return win;
}

function moveToDisplay(display) {
  if (!win || display.id === currentDisplayId) return;
  const prev = displayById(currentDisplayId).workArea;
  const wa = display.workArea;
  win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height });
  currentDisplayId = display.id;
  // Tell the cat to walk in from whichever edge faces the display it left.
  const fromRight = wa.x > prev.x;
  win.webContents.send('cat:command', {
    kind: 'enterFrom',
    side: fromRight ? 'left' : 'right',
  });
}

function currentWorkArea() {
  return displayById(currentDisplayId).workArea;
}

// --------------------------------------------------------------- sensors ---

function toLocal(wa, rect) {
  return {
    x0: rect.x0 - wa.x,
    y0: rect.y0 - wa.y,
    x1: rect.x1 - wa.x,
    y1: rect.y1 - wa.y,
  };
}

function tick() {
  if (!win || win.isDestroyed() || paused) return;
  const now = Date.now();
  const dt = Math.min(0.1, Math.max(1e-3, (now - lastTickAt) / 1000));
  lastTickAt = now;

  const pt = screen.getCursorScreenPoint();
  const s = sensors.sample(pt, dt);

  // Follow the cursor to another monitor, but only if it stays there.
  if (store.data.followCursorAcrossDisplays) {
    const under = screen.getDisplayNearestPoint(pt);
    if (under.id !== currentDisplayId) {
      otherDisplayT += dt;
      if (otherDisplayT > DISPLAY_SWITCH_DELAY) {
        otherDisplayT = 0;
        moveToDisplay(under);
      }
    } else {
      otherDisplayT = 0;
    }
  }

  const wa = currentWorkArea();
  win.webContents.send('cat:sensors', {
    cursorX: pt.x - wa.x,
    cursorY: pt.y - wa.y,
    cursorOnStage: pt.x >= wa.x && pt.x < wa.x + wa.width &&
      pt.y >= wa.y && pt.y < wa.y + wa.height,
    typing: s.typing,
    dragging: s.dragging,
    idleSec: s.idleSec,
    stage: { x0: 0, y0: 0, x1: wa.width, y1: wa.height },
    occluders: occluders.map((r) => toLocal(wa, r)),
  });
}

async function probe() {
  if (paused) return;
  try {
    const rect = await foregroundWindow();
    occluders = rect ? [rect] : [];
  } catch (_) {
    occluders = [];
  }
}

function sendConfig() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('cat:config', {
    scale: store.data.scale,
    coat: store.data.coat,
    debug: DEBUG,
    skeleton: SKELETON,
    hunger: store.data.hunger,
    energy: store.data.energy,
    affection: store.data.affection,
  });
}

function command(kind, extra) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('cat:command', Object.assign({ kind }, extra));
}

function feedAtCursor() {
  const pt = screen.getCursorScreenPoint();
  const wa = currentWorkArea();
  command('feed', { x: pt.x - wa.x, y: pt.y - wa.y });
}

/**
 * Development helper: `--cat-screenshot=out.png [--cat-shot-delay=ms]` grabs the
 * live overlay and exits, so the real app can be checked on a headless machine.
 */
function maybeScreenshot() {
  const arg = process.argv.find((a) => a.startsWith('--cat-screenshot='));
  if (!arg) return;
  const out = arg.slice('--cat-screenshot='.length);
  const delayArg = process.argv.find((a) => a.startsWith('--cat-shot-delay='));
  const delay = delayArg ? parseInt(delayArg.split('=')[1], 10) : 4000;
  setTimeout(async () => {
    try {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(out, img.toPNG());
      console.log(`[desktop-cat] wrote ${out}; cat is ${report.note}`);
    } catch (err) {
      console.error('[desktop-cat] screenshot failed:', err.message);
      process.exitCode = 1;
    }
    app.quit();
  }, delay);
}

// ------------------------------------------------------------------ tray ---

function trayIcon() {
  // macOS menu bars want a monochrome template image; everyone else gets colour.
  const names = process.platform === 'darwin'
    ? ['trayTemplate.png', 'tray.png']
    : ['tray@2x.png', 'tray.png'];
  for (const name of names) {
    const p = path.join(__dirname, '../../assets', name);
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  }
  return nativeImage.createEmpty();
}

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Desktop Cat');
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const coats = ['brownTabby', 'grey', 'black', 'cream'];
  const coatLabels = {
    brownTabby: '茶トラ (brown tabby)',
    grey: 'グレー (grey)',
    black: '黒 (black)',
    cream: 'クリーム (cream)',
  };
  const sizes = [['小', 0.7], ['中', 0.95], ['大', 1.3]];

  const menu = Menu.buildFromTemplate([
    { label: 'ごはんをあげる', accelerator: 'CommandOrControl+Alt+F', click: feedAtCursor },
    { label: 'おいで', click: () => command('come') },
    { label: '遊ぶ', click: () => command('play') },
    { label: '寝かせる', click: () => command('sleep') },
    { label: 'かくれる', click: () => command('hide') },
    { type: 'separator' },
    {
      label: '毛色',
      submenu: coats.map((c) => ({
        label: coatLabels[c],
        type: 'radio',
        checked: store.data.coat === c,
        click: () => { store.set({ coat: c }); sendConfig(); },
      })),
    },
    {
      label: '大きさ',
      submenu: sizes.map(([label, v]) => ({
        label,
        type: 'radio',
        checked: Math.abs(store.data.scale - v) < 0.01,
        click: () => { store.set({ scale: v }); sendConfig(); },
      })),
    },
    { type: 'separator' },
    {
      label: paused ? '猫を出す' : '猫をしまう',
      click: () => {
        paused = !paused;
        if (paused) { win.hide(); } else { win.showInactive(); lastTickAt = Date.now(); }
        refreshTrayMenu();
      },
    },
    {
      label: `D&D検出: ${sensors.mode}`,
      enabled: false,
    },
    { label: '終了', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ------------------------------------------------------------------ boot ---

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) win.showInactive();
  });

  app.whenReady().then(() => {
    if (process.platform === 'darwin' && app.dock) app.dock.hide();

    store = new Store();
    sensors = new Sensors({
      dragHeuristic: store.data.dragHeuristic,
      nativeInputHook: store.data.nativeInputHook,
    });

    const start = () => {
      createWindow(screen.getPrimaryDisplay());
      buildTray();
      lastTickAt = Date.now();
      tickTimer = setInterval(tick, TICK_MS);
      probeTimer = setInterval(probe, PROBE_MS);
      probe();

      globalShortcut.register('CommandOrControl+Alt+F', feedAtCursor);

      screen.on('display-removed', () => {
        if (!screen.getAllDisplays().some((d) => d.id === currentDisplayId)) {
          moveToDisplay(screen.getPrimaryDisplay());
        }
      });
      screen.on('display-metrics-changed', (_e, display) => {
        if (display.id === currentDisplayId && win) {
          const wa = display.workArea;
          win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height });
        }
      });
    };

    // On Linux the compositor needs a moment before a transparent window will
    // actually be transparent; creating it immediately can give a black box.
    if (process.platform === 'linux') setTimeout(start, 250);
    else start();
  });

  ipcMain.on('cat:report', (_e, data) => {
    report = data || report;
    if (win && !win.isDestroyed() && typeof data.wantsOnTop === 'boolean' &&
        data.wantsOnTop !== onTop) {
      onTop = data.wantsOnTop;
      if (onTop) win.setAlwaysOnTop(true, 'screen-saver');
      else win.setAlwaysOnTop(false);
    }
    if (tray && data.note) tray.setToolTip(`Desktop Cat — ${data.note}`);
    if (data.needs) {
      store.set({
        hunger: data.needs.hunger,
        energy: data.needs.energy,
        affection: data.needs.affection,
      });
    }
  });

  app.on('window-all-closed', () => app.quit());

  app.on('will-quit', () => {
    if (tickTimer) clearInterval(tickTimer);
    if (probeTimer) clearInterval(probeTimer);
    globalShortcut.unregisterAll();
    if (sensors) sensors.stop();
    if (store) store.saveNow();
  });
}
