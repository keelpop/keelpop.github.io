/*
 * window-probe.js — where is the window you are actually working in?
 *
 * Electron has no cross-platform API for the foreground window's geometry, so
 * this shells out per platform. It is best-effort by design: the cat only uses
 * the answer to pick a nicer place to lurk or to sit, and falls back to screen
 * edges when the probe returns nothing.
 *
 * Called at most every few seconds, never on the render path.
 */
'use strict';

const { execFile } = require('child_process');

const TIMEOUT = 900;

function run(cmd, args) {
  return new Promise((resolve) => {
    let done = false;
    const child = execFile(cmd, args, { timeout: TIMEOUT }, (err, stdout) => {
      if (done) return;
      done = true;
      resolve(err ? null : String(stdout));
    });
    child.on('error', () => {
      if (done) return;
      done = true;
      resolve(null);
    });
  });
}

const PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  public struct R { public int L, T, Rg, B; }
}
"@
$h = [W]::GetForegroundWindow()
$r = New-Object W+R
if ([W]::GetWindowRect($h, [ref]$r)) { "$($r.L) $($r.T) $($r.Rg) $($r.B)" }
`;

const OSA_SCRIPT = `
tell application "System Events"
  try
    set p to first application process whose frontmost is true
    set w to first window of p
    set {x, y} to position of w
    set {ww, hh} to size of w
    return (x as text) & " " & (y as text) & " " & ((x + ww) as text) & " " & ((y + hh) as text)
  end try
end tell
`;

function parseRect(text) {
  if (!text) return null;
  const nums = String(text).trim().split(/[\s,]+/).map(Number);
  if (nums.length < 4 || nums.some((n) => !Number.isFinite(n))) return null;
  const [x0, y0, x1, y1] = nums;
  if (x1 - x0 < 80 || y1 - y0 < 60) return null;
  return { x0, y0, x1, y1 };
}

/** @returns {Promise<{x0:number,y0:number,x1:number,y1:number}|null>} */
async function foregroundWindow() {
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT,
    ]);
    return parseRect(out);
  }

  if (process.platform === 'darwin') {
    // Needs Accessibility permission; without it osascript errors and we get
    // null, which is exactly the graceful degradation we want.
    const out = await run('osascript', ['-e', OSA_SCRIPT]);
    return parseRect(out);
  }

  // X11: xdotool if it is installed, otherwise xprop + xwininfo.
  const geo = await run('xdotool', ['getactivewindow', 'getwindowgeometry', '--shell']);
  if (geo) {
    const g = {};
    for (const line of geo.split('\n')) {
      const [k, v] = line.split('=');
      if (k && v) g[k.trim()] = Number(v);
    }
    if (Number.isFinite(g.X) && Number.isFinite(g.WIDTH)) {
      return parseRect(`${g.X} ${g.Y} ${g.X + g.WIDTH} ${g.Y + g.HEIGHT}`);
    }
  }

  const active = await run('xprop', ['-root', '_NET_ACTIVE_WINDOW']);
  const id = active && active.match(/(0x[0-9a-f]+)/i);
  if (!id) return null;
  const info = await run('xwininfo', ['-id', id[1]]);
  if (!info) return null;
  const num = (re) => {
    const m = info.match(re);
    return m ? Number(m[1]) : NaN;
  };
  const x = num(/Absolute upper-left X:\s+(-?\d+)/);
  const y = num(/Absolute upper-left Y:\s+(-?\d+)/);
  const w = num(/Width:\s+(\d+)/);
  const h = num(/Height:\s+(\d+)/);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return parseRect(`${x} ${y} ${x + w} ${y + h}`);
}

module.exports = { foregroundWindow };
