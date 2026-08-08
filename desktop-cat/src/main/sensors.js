/*
 * sensors.js — figuring out what you are doing, without getting in the way.
 *
 * Everything here is read-only observation of input state. Two signals matter
 * to the cat and neither is directly available from Electron:
 *
 *   typing   - hands on the keyboard rather than on the mouse. Derived from
 *              powerMonitor.getSystemIdleTime(): if the OS says input happened
 *              within the last second but the pointer has not moved, you are
 *              typing. No key logging, no key identities, no native code.
 *
 *   dragging - a button held down while the pointer moves. This genuinely needs
 *              a global input hook. `uiohook-napi` provides one, but it is not a
 *              declared dependency: install it yourself and set
 *              `nativeInputHook: true` in state.json to use it. By default
 *              `dragHeuristic` falls back to "a long uninterrupted pointer
 *              sweep", which correlates with dragging and text selection but is
 *              not exact.
 */
'use strict';

const { powerMonitor } = require('electron');

class Sensors {
  constructor(opts) {
    opts = opts || {};
    this.dragHeuristic = opts.dragHeuristic !== false;
    // Opt-in only. libuiohook is not a declared dependency and has been seen to
    // raise from native code *after* require() returns, which no try/catch can
    // contain -- so it is never loaded unless the user asks for it.
    this.wantHook = opts.nativeInputHook === true;

    this.hook = null;
    this.hookError = null;
    this.buttonDown = false;
    this.buttonDownAt = 0;
    this.buttonDownPos = { x: 0, y: 0 };

    this.lastPos = { x: 0, y: 0 };
    this.stillT = 0;
    this.movingT = 0;
    this.sweepDist = 0;
    this.dragging = false;

    if (this.wantHook) this._tryLoadHook();
  }

  get mode() {
    return this.hook ? 'native' : this.dragHeuristic ? 'heuristic' : 'off';
  }

  _tryLoadHook() {
    try {
      // Not in package.json; present only if the user installed it themselves.
      const { uIOhook } = require('uiohook-napi');
      uIOhook.on('mousedown', (e) => {
        this.buttonDown = true;
        this.buttonDownAt = Date.now();
        this.buttonDownPos = { x: e.x, y: e.y };
      });
      uIOhook.on('mouseup', () => {
        this.buttonDown = false;
      });
      uIOhook.start();
      this.hook = uIOhook;
    } catch (err) {
      this.hookError = err && err.message ? err.message : String(err);
    }
  }

  stop() {
    if (this.hook) {
      try { this.hook.stop(); } catch (_) { /* shutting down anyway */ }
      this.hook = null;
    }
  }

  /**
   * @param {{x:number,y:number}} pos current cursor position
   * @param {number} dt seconds since the previous sample
   */
  sample(pos, dt) {
    const moved = Math.hypot(pos.x - this.lastPos.x, pos.y - this.lastPos.y);
    this.lastPos = { x: pos.x, y: pos.y };

    if (moved < 1.2) {
      this.stillT += dt;
      this.movingT = 0;
      this.sweepDist = 0;
    } else {
      this.stillT = 0;
      this.movingT += dt;
      this.sweepDist += moved;
    }

    let idleSec = 0;
    try {
      idleSec = powerMonitor.getSystemIdleTime();
    } catch (_) {
      idleSec = 0;
    }

    // Input in the last second, but the pointer has been parked: keyboard.
    const typing = idleSec === 0 && this.stillT > 0.45;

    if (this.hook) {
      const heldFor = this.buttonDown ? Date.now() - this.buttonDownAt : 0;
      const travel = this.buttonDown
        ? Math.hypot(pos.x - this.buttonDownPos.x, pos.y - this.buttonDownPos.y)
        : 0;
      // A press that has moved a real distance is a drag, not a click.
      this.dragging = this.buttonDown && heldFor > 180 && travel > 14;
    } else if (this.dragHeuristic) {
      this.dragging = this.movingT > 0.9 && this.sweepDist > 300;
    } else {
      this.dragging = false;
    }

    return { typing, dragging: this.dragging, idleSec };
  }
}

module.exports = { Sensors };
