/*
 * store.js — settings and the cat's mood, persisted between runs.
 *
 * Small enough that a single JSON file in userData is the right answer. Writes
 * are debounced because the cat's drives change every frame.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  scale: 0.95,
  coat: 'brownTabby',
  dragHeuristic: true,
  // Exact drag detection via a global input hook. Requires installing
  // `uiohook-napi` separately; see the README.
  nativeInputHook: false,
  followCursorAcrossDisplays: true,
  // Persisted drives, so the cat is not reborn ravenous every launch.
  hunger: 0.35,
  energy: 0.8,
  affection: 0.5,
};

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'state.json');
    this.data = Object.assign({}, DEFAULTS);
    this._timer = null;
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      for (const key of Object.keys(DEFAULTS)) {
        if (parsed[key] !== undefined) this.data[key] = parsed[key];
      }
    } catch (_) {
      // First run, or the file is unreadable: defaults are fine either way.
    }
    return this.data;
  }

  set(patch) {
    Object.assign(this.data, patch);
    this.saveSoon();
  }

  saveSoon(delayMs) {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveNow(), delayMs == null ? 4000 : delayMs);
  }

  saveNow() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('[desktop-cat] could not save state:', err.message);
    }
  }
}

module.exports = { Store, DEFAULTS };
