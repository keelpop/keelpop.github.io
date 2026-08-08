/*
 * preload.js — the only bridge between the overlay and the main process.
 *
 * Context isolation stays on and node integration stays off; the renderer gets
 * three callbacks in and one report out, and nothing else.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('catAPI', {
  /** Per-frame sensor payload: cursor, typing, dragging, stage, occluders. */
  onSensors: (cb) => ipcRenderer.on('cat:sensors', (_e, data) => cb(data)),
  /** Settings changes: coat, scale. */
  onConfig: (cb) => ipcRenderer.on('cat:config', (_e, data) => cb(data)),
  /** One-shot commands from the tray: feed, come, play, sleep, hide. */
  onCommand: (cb) => ipcRenderer.on('cat:command', (_e, data) => cb(data)),
  /** Renderer -> main: whether to float on top, plus mood for the tray tooltip. */
  report: (data) => ipcRenderer.send('cat:report', data),
});
