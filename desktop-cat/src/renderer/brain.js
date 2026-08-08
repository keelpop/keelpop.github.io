/*
 * brain.js — what the cat decides to do.
 *
 * A priority-interrupt state machine on top of a small drive model (hunger,
 * energy, boredom, affection). Sensors arrive from the main process each frame:
 * where the cursor is, whether you are typing, whether you are dragging
 * something, how long the machine has been idle. The cat reacts to those and
 * otherwise gets on with its own life.
 *
 * Exposes window.CatBrain.
 */
(function (global) {
  'use strict';

  const M = global.CatRig.math;
  const { clamp, lerp, damp, rand, randInt, pick, smoothstep } = M;

  // Drive rates, in "units per second".
  const HUNGER_RATE = 1 / (3.5 * 3600);   // peckish after a few hours
  const ENERGY_DRAIN = 1 / (2.2 * 3600);
  const ENERGY_RECOVER = 1 / (25 * 60);
  const BOREDOM_RATE = 1 / (6 * 60);
  const AFFECTION_DECAY = 1 / (40 * 60);

  // How long a full meal keeps the cat well-behaved.
  const CALM_AFTER_MEAL = 6 * 60;
  // After a good session of being stroked it wants to be left alone.
  const PET_COOLDOWN = 100;

  // States with no goal of their own; the only ones the idle timer may end.
  const IDLE_STATES = new Set(['sitIdle', 'lookAround', 'groom', 'napLoaf', 'stretchOut']);

  class CatBrain {
    constructor(rig, opts) {
      opts = opts || {};
      this.rig = rig;
      this.stage = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
      this.occluders = [];

      this.state = 'sitIdle';
      this.stateT = 0;
      this.stateDur = rand(3, 7);
      this.prevState = null;

      this.needs = {
        hunger: opts.hunger == null ? 0.35 : opts.hunger,
        energy: opts.energy == null ? 0.8 : opts.energy,
        affection: opts.affection == null ? 0.5 : opts.affection,
        boredom: 0.3,
      };

      this.calmT = 0;
      this.food = null;
      this.pet = { level: 0, active: 0, cooldown: 0, satisfaction: 0 };
      this.mischiefCooldown = rand(20, 60);
      this.hideCooldown = rand(90, 240);
      this.wantsOnTop = true;

      this.cursor = { x: 0, y: 0, vx: 0, vy: 0, speed: 0, stillT: 0 };
      this.cursorHist = [];
      this.typing = false;
      this.typingT = 0;
      this.idleSec = 0;
      this.dragging = false;
      this.dragT = 0;

      this.target = null;      // {x, y, speed}
      this.hideSpot = null;
      this.note = '';          // short human-readable status
      this.effects = [];       // transient visual effects for the renderer
    }

    // -------------------------------------------------------------- stage --

    setStage(rect) {
      this.stage = rect;
      const r = this.rig;
      r.x = clamp(r.x, rect.x0 + 40, rect.x1 - 40);
      r.y = clamp(r.y, rect.y0 + 60, rect.y1 - 10);
    }

    setOccluders(list) {
      this.occluders = list || [];
    }

    feed(x, y) {
      const st = this.stage;
      this.food = {
        x: clamp(x, st.x0 + 60, st.x1 - 60),
        y: clamp(y, st.y0 + 80, st.y1 - 20),
        fill: 1,
      };
      // A bowl appearing trumps whatever it was doing.
      this._enter('beg');
    }

    /** Nudge the cat's mood directly, e.g. from a tray menu. */
    poke(kind) {
      if (kind === 'sleep') { this.needs.energy = 0.05; this._enter('goSleep'); }
      if (kind === 'play') { this.needs.boredom = 1; this.mischiefCooldown = 0; }
      if (kind === 'hide') { this.hideCooldown = 0; this._enter('goHide'); }
      if (kind === 'come') {
        this._enter('walkTo');
        this.target = { x: this.cursor.x, y: this.cursor.y + 6, speed: 150 };
      }
    }

    // ------------------------------------------------------------- update --

    update(dt, sensors) {
      const r = this.rig;
      this._readSensors(dt, sensors);
      this._updateNeeds(dt);
      this._detectPetting(dt);

      this.stateT += dt;
      if (this.calmT > 0) this.calmT -= dt;
      if (this.mischiefCooldown > 0) this.mischiefCooldown -= dt;
      if (this.hideCooldown > 0) this.hideCooldown -= dt;
      if (this.pet.cooldown > 0) this.pet.cooldown -= dt;

      this._interrupts();

      const fn = CatBrain.STATES[this.state];
      if (fn) fn.call(this, dt);
      else this._enter('sitIdle');

      this._keepOnStage(dt);
      this._decayEffects(dt);
    }

    _readSensors(dt, s) {
      s = s || {};
      const c = this.cursor;
      if (s.cursorX != null) {
        const dx = s.cursorX - c.x;
        const dy = s.cursorY - c.y;
        const inv = dt > 0 ? 1 / dt : 0;
        c.vx = damp(c.vx, dx * inv, 12, dt);
        c.vy = damp(c.vy, dy * inv, 12, dt);
        c.x = s.cursorX;
        c.y = s.cursorY;
        c.speed = Math.hypot(c.vx, c.vy);
        if (Math.hypot(dx, dy) < 1.2) c.stillT += dt;
        else c.stillT = 0;

        this.cursorHist.push({ x: c.x, y: c.y, t: this.rig.t });
        while (this.cursorHist.length > 120) this.cursorHist.shift();
      }

      this.idleSec = s.idleSec == null ? 0 : s.idleSec;
      // Input happening while the pointer sits still means hands on keyboard.
      this.typing = !!s.typing;
      this.typingT = this.typing ? this.typingT + dt : 0;
      this.dragging = !!s.dragging;
      this.dragT = this.dragging ? this.dragT + dt : 0;
    }

    _updateNeeds(dt) {
      const n = this.needs;
      const asleep = this.state === 'sleep';
      n.hunger = clamp(n.hunger + HUNGER_RATE * dt, 0, 1);
      n.energy = clamp(
        n.energy + (asleep ? ENERGY_RECOVER : -ENERGY_DRAIN) * dt, 0, 1
      );
      n.boredom = clamp(n.boredom + (asleep ? 0 : BOREDOM_RATE) * dt, 0, 1);
      n.affection = clamp(n.affection - AFFECTION_DECAY * dt, 0, 1);
    }

    /**
     * Stroking is a cursor moving back and forth across the cat's body. Count
     * direction reversals rather than raw movement, so simply passing over the
     * cat on the way somewhere else does not read as affection.
     */
    _detectPetting(dt) {
      const r = this.rig;
      const p = this.pet;
      const onBody = r.distanceTo(this.cursor.x, this.cursor.y) < 10 * r.scale;
      let reversals = 0;
      let path = 0;
      if (onBody && this.cursorHist.length > 6) {
        const h = this.cursorHist;
        let lastSign = 0;
        for (let i = Math.max(1, h.length - 90); i < h.length; i++) {
          const dx = h[i].x - h[i - 1].x;
          path += Math.hypot(dx, h[i].y - h[i - 1].y);
          const sign = dx > 0.8 ? 1 : dx < -0.8 ? -1 : 0;
          if (sign !== 0) {
            if (lastSign !== 0 && sign !== lastSign) reversals++;
            lastSign = sign;
          }
        }
      }
      const stroking = onBody && reversals >= 3 && path > 60;
      p.active = stroking ? Math.min(1, p.active + dt * 3) : Math.max(0, p.active - dt * 1.5);
      if (stroking) {
        p.level = clamp(p.level + dt * 0.22, 0, 1);
        this.needs.affection = clamp(this.needs.affection + dt * 0.05, 0, 1);
      } else {
        p.level = Math.max(0, p.level - dt * 0.10);
      }
    }

    // --------------------------------------------------------- interrupts --

    _interrupts() {
      const st = this.state;
      const r = this.rig;

      // Food beats everything.
      if (this.food && this.food.fill > 0.02 && st !== 'beg' && st !== 'eat') {
        return this._enter('beg');
      }

      // Being stroked, unless it has just had enough of that. A cat in prey
      // mode does not flip to purring because you jiggled the mouse on it, so
      // hunting outranks affection until the hunt is over.
      if (this.pet.active > 0.6 && this.pet.cooldown <= 0 &&
          st !== 'beingPetted' && st !== 'eat' &&
          st !== 'stalk' && st !== 'pounce' && st !== 'swat') {
        return this._enter('beingPetted');
      }

      // You are dragging something around: fascinating.
      if (this.dragT > 0.25 && st !== 'watchDrag' && st !== 'beingPetted' &&
          st !== 'eat' && this.calmT <= 0) {
        return this._enter('watchDrag');
      }

      // You have been typing steadily for a while: time to be in the way.
      if (this.typingT > 7 && this.calmT <= 0 && this.mischiefCooldown <= 0 &&
          st !== 'sitOnWork' && st !== 'goSitOnWork' && st !== 'beingPetted' &&
          st !== 'eat' && st !== 'watchDrag') {
        this.mischiefCooldown = rand(150, 320);
        return this._enter('goSitOnWork');
      }

      // The cursor is playing right in front of its face.
      const d = r.distanceTo(this.cursor.x, this.cursor.y);
      const playful = this.needs.boredom > 0.45 && this.needs.energy > 0.25;
      if (playful && this.calmT <= 0 && this.cursor.speed > 90 &&
          d < 200 * r.scale && this.mischiefCooldown <= 0 &&
          (st === 'sitIdle' || st === 'wander' || st === 'groom' || st === 'napLoaf')) {
        this.mischiefCooldown = rand(25, 70);
        return this._enter('stalk');
      }

      // Nothing pressing: run out the clock, but only on the aimless states.
      // Purposeful ones own their exit, so timing them out here would cut them
      // off halfway (a stalk that never pounces, a hide that never peeks).
      if (IDLE_STATES.has(st) && this.stateT >= this.stateDur) {
        this._chooseIdleState();
      }
    }

    _chooseIdleState() {
      const n = this.needs;
      const st = this.stage;

      if (n.energy < 0.2) return this._enter('goSleep');
      if (this.hideCooldown <= 0 && Math.random() < 0.5) {
        this.hideCooldown = rand(150, 420);
        return this._enter('goHide');
      }
      if (n.boredom > 0.7 && n.energy > 0.35 && Math.random() < 0.5) {
        return this._enter('wander');
      }

      const roll = Math.random();
      if (this.calmT > 0) {
        // Post-meal: dozing and grooming only.
        return this._enter(roll < 0.55 ? 'napLoaf' : 'groom');
      }
      if (roll < 0.26) return this._enter('sitIdle');
      if (roll < 0.44) return this._enter('groom');
      if (roll < 0.62) return this._enter('wander');
      if (roll < 0.74) return this._enter('napLoaf');
      if (roll < 0.84) return this._enter('stretchOut');
      if (roll < 0.93) return this._enter('lookAround');
      return this._enter('sitIdle');
    }

    _enter(state) {
      if (state === this.state) { this.stateT = 0; return; }
      this.prevState = this.state;
      this.state = state;
      this.stateT = 0;
      this.stateDur = 4;
      this.target = null;
      // Default to floating on top; only the deliberately-lurking states opt
      // out, and this keeps an interrupted hide from leaving the cat buried.
      this.wantsOnTop = true;
      const init = CatBrain.ENTERS[state];
      if (init) init.call(this);
    }

    // ------------------------------------------------------------- motion --

    /** Walk towards a point. Returns true once it has arrived. */
    _moveToward(tx, ty, speed, dt) {
      const r = this.rig;
      const dx = tx - r.x;
      const dy = ty - r.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) {
        r.vx = damp(r.vx, 0, 10, dt);
        r.vy = damp(r.vy, 0, 10, dt);
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        return true;
      }
      // Ease into and out of the walk so it does not start at full speed.
      const ramp = smoothstep(Math.min(1, d / (60 * r.scale)));
      const want = speed * r.scale * ramp;
      r.vx = damp(r.vx, (dx / d) * want, 4.5, dt);
      r.vy = damp(r.vy, (dy / d) * want * 0.55, 4.5, dt);
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      if (Math.abs(r.vx) > 6 * r.scale) r.face(r.vx > 0 ? 1 : -1);
      return false;
    }

    _stop(dt) {
      const r = this.rig;
      r.vx = damp(r.vx, 0, 12, dt);
      r.vy = damp(r.vy, 0, 12, dt);
      r.x += r.vx * dt;
      r.y += r.vy * dt;
    }

    _keepOnStage(dt) {
      const r = this.rig;
      const st = this.stage;
      // Peeking states are allowed to hang off the edge; everything else is not.
      const peeking = this.state === 'peek' || this.state === 'goHide' || this.state === 'hidden';
      const padX = peeking ? -70 * r.scale : 30 * r.scale;
      const lo = st.x0 + padX;
      const hi = st.x1 - padX;
      if (r.x < lo) { r.x = lo; r.vx = Math.abs(r.vx) * 0.2; }
      if (r.x > hi) { r.x = hi; r.vx = -Math.abs(r.vx) * 0.2; }
      const yLo = st.y0 + 70 * r.scale;
      const yHi = st.y1 - 4;
      if (r.y < yLo) { r.y = yLo; r.vy = Math.abs(r.vy) * 0.2; }
      if (r.y > yHi) { r.y = yHi; r.vy = -Math.abs(r.vy) * 0.2; }
    }

    _randomSpot() {
      const st = this.stage;
      return {
        x: rand(st.x0 + 80, st.x1 - 80),
        // Cats keep to the lower part of a surface more than the middle.
        y: rand(st.y0 + (st.y1 - st.y0) * 0.45, st.y1 - 12),
      };
    }

    /** Somewhere it can lurk mostly out of sight. */
    _pickHideSpot() {
      const st = this.stage;
      const r = this.rig;
      const options = [
        { x: st.x0 - 30 * r.scale, y: rand(st.y1 - 220, st.y1 - 20), from: 'left' },
        { x: st.x1 + 30 * r.scale, y: rand(st.y1 - 220, st.y1 - 20), from: 'right' },
      ];
      // A window edge is a better hiding place than the screen edge.
      for (const o of this.occluders) {
        if (o.x1 - o.x0 < 200 || o.y1 - o.y0 < 120) continue;
        options.push({ x: o.x0 - 10 * r.scale, y: o.y1 - rand(20, 90), from: 'window' });
        options.push({ x: o.x1 + 10 * r.scale, y: o.y1 - rand(20, 90), from: 'window' });
      }
      return pick(options);
    }

    _look(x, y, weight, dt) {
      this.rig.lookAt(x, y, weight);
    }

    _effect(kind, x, y) {
      this.effects.push({ kind, x, y, t: 0, life: kind === 'swat' ? 0.4 : 0.8 });
      if (this.effects.length > 12) this.effects.shift();
    }

    _decayEffects(dt) {
      for (const e of this.effects) e.t += dt;
      this.effects = this.effects.filter((e) => e.t < e.life);
    }

  }

  // Kept off the prototype as plain tables so each state reads as one unit:
  // ENTERS[s] runs once on transition, STATES[s] runs every frame.

  CatBrain.ENTERS = {
    sitIdle() {
      this.stateDur = rand(4, 11);
      this.rig.setPose('sit', 5);
    },
    lookAround() {
      this.stateDur = rand(4, 8);
      this.rig.setPose('sit', 5);
      this.lookPoints = [];
      for (let i = 0; i < 3; i++) {
        const sp = this._randomSpot();
        this.lookPoints.push(sp);
      }
    },
    groom() {
      this.stateDur = rand(6, 14);
      this.rig.setPose('sit', 4);
    },
    napLoaf() {
      this.stateDur = rand(20, 70);
      this.rig.setPose('loaf', 2.5);
    },
    stretchOut() {
      this.stateDur = 2.6;
      this.rig.setPose('stretch', 3);
    },
    wander() {
      this.stateDur = rand(6, 16);
      this.target = this._randomSpot();
      this.target.speed = rand(45, 85);
      this.rig.setPose('walk', 4);
    },
    walkTo() {
      this.stateDur = 12;
      this.rig.setPose('walk', 4);
    },
    goSleep() {
      this.stateDur = 12;
      this.target = this._randomSpot();
      this.target.y = Math.max(this.target.y, this.stage.y1 - 120);
      this.target.speed = 40;
      this.rig.setPose('walk', 3);
    },
    sleep() {
      this.stateDur = rand(120, 420);
      this.rig.setPose('sleep', 1.6);
    },
    goHide() {
      this.hideSpot = this._pickHideSpot();
      this.stateDur = 14;
      this.rig.setPose('walk', 4);
    },
    hidden() {
      this.stateDur = rand(8, 30);
      this.rig.setPose('loaf', 3);
      // Genuinely drop behind the other windows for a while.
      this.wantsOnTop = false;
    },
    peek() {
      this.stateDur = rand(5, 14);
      this.rig.setPose('crouch', 4);
      this.wantsOnTop = true;
    },
    watchDrag() {
      this.stateDur = 30;
      this.rig.setPose('sit', 6);
    },
    goSitOnWork() {
      this.stateDur = 10;
      // Plant itself right where you are working.
      const o = this.occluders[0];
      const cx = o ? (o.x0 + o.x1) / 2 : this.cursor.x;
      const cy = o ? lerp(o.y0, o.y1, 0.55) : this.cursor.y;
      this.target = { x: cx + rand(-60, 60), y: clamp(cy, this.stage.y0 + 90, this.stage.y1 - 20), speed: 70 };
      this.rig.setPose('walk', 4);
      this.wantsOnTop = true;
    },
    sitOnWork() {
      this.stateDur = rand(40, 150);
      this.rig.setPose('loaf', 2.2);
    },
    stalk() {
      this.stateDur = rand(2.5, 5);
      this.rig.setPose('crouch', 5);
    },
    pounce() {
      this.stateDur = 0.75;
      this.rig.setPose('pounce', 14);
      this.pounceFrom = { x: this.rig.x, y: this.rig.y };
      this.pounceTo = { x: this.cursor.x - this.rig.dir * 26 * this.rig.scale, y: this.cursor.y + 8 };
    },
    swat() {
      this.stateDur = 1.9;
      this.rig.setPose('crouch', 6);
      this.swatCount = randInt(1, 3);
      this.swatNext = 0.15;
    },
    beg() {
      this.stateDur = 25;
      this.rig.setPose('walk', 4);
    },
    eat() {
      this.stateDur = 11;
      this.rig.setPose('loaf', 3);
    },
    beingPetted() {
      this.stateDur = 60;
      this.rig.setPose('loaf', 3);
      this.pet.satisfaction = this.pet.satisfaction || 0;
    },
    satisfiedLeave() {
      this.stateDur = 14;
      this.target = this._randomSpot();
      this.target.speed = rand(55, 90);
      this.rig.setPose('walk', 4);
      this.pet.cooldown = PET_COOLDOWN;
      this.pet.level = 0;
      this.pet.satisfaction = 0;
    },
  };

  CatBrain.STATES = {
    sitIdle(dt) {
      const r = this.rig;
      this.note = 'sitting';
      this._stop(dt);
      r.tailWhip = 0.12;
      r.pupilTarget = 0.45;
      r.earFold = 0;
      r.eyeOpenTarget = 1;
      // Glances your way now and then.
      const glance = Math.sin(this.stateT * 0.5) > 0.4 ? 0.8 : 0.2;
      this._look(this.cursor.x, this.cursor.y, glance, dt);
    },

    lookAround(dt) {
      const r = this.rig;
      this.note = 'looking around';
      this._stop(dt);
      r.tailWhip = 0.2;
      r.pupilTarget = 0.5;
      const i = Math.min(this.lookPoints.length - 1, Math.floor(this.stateT / 2));
      const p = this.lookPoints[i] || this.cursor;
      this._look(p.x, p.y, 0.9, dt);
      if (p.x < r.x) r.face(-1); else r.face(1);
    },

    groom(dt) {
      const r = this.rig;
      this.note = 'grooming';
      this._stop(dt);
      r.tailWhip = 0.08;
      r.pupilTarget = 0.35;
      r.eyeOpenTarget = 0.55;
      // Licks a shoulder: head down and rocking, with the odd pause.
      const ph = this.stateT * 2.6;
      const licking = Math.sin(this.stateT * 0.55) > -0.3;
      const bob = licking ? Math.sin(ph) * 0.5 + 0.5 : 0;
      this._look(r.x + r.dir * 12 * r.scale, r.y - 14 * r.scale - bob * 8 * r.scale, 0.9, dt);
      r.mouthOpenTarget = licking ? 0.25 + bob * 0.2 : 0;
      if (!licking) this._look(this.cursor.x, this.cursor.y, 0.5, dt);
    },

    napLoaf(dt) {
      const r = this.rig;
      this.note = 'dozing';
      this._stop(dt);
      r.tailWhip = 0.05;
      r.pupilTarget = 0.7;
      r.eyeOpenTarget = this.stateT % 9 < 5 ? 0.2 : 0.6;
      r.earFold = 0.15;
      r.purr = 0.25;
      this._look(this.cursor.x, this.cursor.y, 0.35, dt);
      if (this.stateT > this.stateDur * 0.75 && this.needs.energy < 0.5) {
        this._enter('sleep');
      }
    },

    stretchOut(dt) {
      const r = this.rig;
      this.note = 'stretching';
      this._stop(dt);
      r.tailWhip = 0.3;
      r.eyeOpenTarget = 0.3;
      r.mouthOpenTarget = this.stateT > 0.8 && this.stateT < 1.6 ? 0.9 : 0;
      this._look(r.x + r.dir * 60 * r.scale, r.y + 10 * r.scale, 0.6, dt);
    },

    wander(dt) {
      const r = this.rig;
      this.note = 'wandering';
      r.setPose(Math.hypot(r.vx, r.vy) > 8 * r.scale ? 'walk' : 'stand', 5);
      r.tailWhip = 0.18;
      r.pupilTarget = 0.4;
      const t = this.target;
      if (!t || this._moveToward(t.x, t.y, t.speed, dt) || this.stateT > this.stateDur) {
        this._enter('sitIdle');
        return;
      }
      // Watches where it is going, with the occasional glance at the cursor.
      const glanceAtYou = Math.sin(this.stateT * 0.8) > 0.75;
      if (glanceAtYou) this._look(this.cursor.x, this.cursor.y, 0.8, dt);
      else this._look(t.x, t.y - 20 * r.scale, 0.45, dt);
    },

    walkTo(dt) {
      const r = this.rig;
      this.note = 'coming over';
      r.setPose('walk', 5);
      const t = this.target;
      if (!t || this._moveToward(t.x, t.y, t.speed, dt) || this.stateT > this.stateDur) {
        return this._enter('sitIdle');
      }
      this._look(t.x, t.y, 0.6, dt);
    },

    goSleep(dt) {
      const r = this.rig;
      this.note = 'finding a spot';
      r.setPose('walk', 4);
      const t = this.target;
      if (!t || this._moveToward(t.x, t.y, t.speed, dt) || this.stateT > this.stateDur) {
        return this._enter('sleep');
      }
      this._look(t.x, t.y, 0.4, dt);
    },

    sleep(dt) {
      const r = this.rig;
      this.note = 'asleep';
      this._stop(dt);
      r.tailWhip = 0.02;
      r.eyeOpenTarget = 0;
      r.earFold = 0.35;
      r.purr = 0.5;
      r.pupilTarget = 0.8;
      r.lookWeight = 0;
      // Wakes up when it has slept off its tiredness, or just because.
      if (this.needs.energy > 0.85 || this.stateT > this.stateDur) {
        this._enter('stretchOut');
      }
    },

    goHide(dt) {
      const r = this.rig;
      this.note = 'sloping off';
      r.setPose('walk', 4);
      r.tailWhip = 0.1;
      const t = this.hideSpot;
      if (!t) return this._enter('sitIdle');
      // Arrival is judged on x alone; the spot is deliberately off-screen.
      const arrived = Math.abs(r.x - t.x) < 12 && Math.abs(r.y - t.y) < 20;
      this._moveToward(t.x, t.y, 80, dt);
      this._look(t.x, t.y, 0.4, dt);
      if (arrived || this.stateT > this.stateDur) this._enter('hidden');
    },

    hidden(dt) {
      const r = this.rig;
      this.note = 'out of sight';
      this._stop(dt);
      r.tailWhip = 0.1;
      r.pupilTarget = 0.55;
      this._look(this.cursor.x, this.cursor.y, 0.5, dt);
      if (this.stateT > this.stateDur) this._enter('peek');
    },

    peek(dt) {
      const r = this.rig;
      this.note = 'watching you';
      // Creeps just far enough out to get a look at you.
      const t = this.hideSpot;
      const st = this.stage;
      const outX = t && t.x < (st.x0 + st.x1) / 2
        ? st.x0 + 26 * r.scale
        : st.x1 - 26 * r.scale;
      this._moveToward(outX, r.y, 34, dt);
      r.face(outX < (st.x0 + st.x1) / 2 ? 1 : -1);
      r.tailWhip = 0.35;
      r.pupilTarget = 0.85;
      r.earFold = 0;
      r.eyeOpenTarget = 1;
      this._look(this.cursor.x, this.cursor.y, 1, dt);
      if (this.stateT > this.stateDur) {
        // Either comes out properly or ducks back for another round.
        if (Math.random() < 0.55) this._enter('wander');
        else this._enter('hidden');
      }
    },

    watchDrag(dt) {
      const r = this.rig;
      this.note = 'very interested';
      this._stop(dt);
      r.setPose('sit', 7);
      // Every muscle locked on: wide pupils, ears forward, tail thrashing.
      r.pupilTarget = 1;
      r.eyeOpenTarget = 1;
      r.earFold = 0;
      r.tailWhip = 1;
      r.purr = 0;
      this._look(this.cursor.x, this.cursor.y, 1, dt);
      r.face(this.cursor.x >= r.x ? 1 : -1);
      // Fidgeting: tiny weight shifts and the odd involuntary paw twitch.
      r.x += Math.sin(this.stateT * 7.5) * 0.22 * r.scale;
      if (Math.random() < dt * 0.7 && r.pawSwipe === 0) {
        r.pawSwipe = 0.001;
        r.pawSwipeLeg = 1;
      }
      // Once you stop dragging it stays keyed up for a moment, then relaxes.
      if ((!this.dragging && this.stateT > 1.2) || this.stateT > this.stateDur) {
        this._enter(Math.random() < 0.45 ? 'stalk' : 'sitIdle');
      }
    },

    goSitOnWork(dt) {
      const r = this.rig;
      this.note = 'coming to sit on your work';
      r.setPose('walk', 4);
      const t = this.target;
      if (!t || this._moveToward(t.x, t.y, t.speed, dt) || this.stateT > this.stateDur) {
        return this._enter('sitOnWork');
      }
      this._look(t.x, t.y, 0.5, dt);
    },

    sitOnWork(dt) {
      const r = this.rig;
      this.note = 'sitting on your work';
      this._stop(dt);
      r.tailWhip = 0.1;
      r.pupilTarget = 0.5;
      r.earFold = 0.1;
      r.purr = 0.4;
      r.eyeOpenTarget = 0.75;
      // Mostly ignores you, then turns round to check you noticed.
      const checkOnYou = Math.sin(this.stateT * 0.32) > 0.55;
      this._look(this.cursor.x, this.cursor.y, checkOnYou ? 1 : 0.15, dt);
      if (this.stateT > this.stateDur) this._enter('wander');
    },

    stalk(dt) {
      const r = this.rig;
      this.note = 'stalking the cursor';
      r.setPose('crouch', 6);
      r.tailWhip = 0.55;
      r.pupilTarget = 1;
      r.earFold = 0;
      r.eyeOpenTarget = 1;
      this._look(this.cursor.x, this.cursor.y, 1, dt);

      const dx = this.cursor.x - r.x;
      const dist = Math.hypot(dx, this.cursor.y - r.y);
      r.face(dx >= 0 ? 1 : -1);

      if (dist > 70 * r.scale) {
        // Creeps in low and slow.
        this._moveToward(this.cursor.x - Math.sign(dx) * 60 * r.scale, this.cursor.y + 6, 42, dt);
      } else {
        this._stop(dt);
        // The wiggle before the launch.
        r.x += Math.sin(this.stateT * 13) * 0.5 * r.scale;
      }

      if (this.stateT > this.stateDur) {
        if (dist < 130 * r.scale && this.needs.energy > 0.3) this._enter('pounce');
        else this._enter('swat');
      }
    },

    pounce(dt) {
      const r = this.rig;
      this.note = 'pouncing';
      r.setPose('pounce', 16);
      r.tailWhip = 0.8;
      r.pupilTarget = 1;
      this._look(this.cursor.x, this.cursor.y, 1, dt);
      const k = clamp(this.stateT / this.stateDur, 0, 1);
      const arc = Math.sin(k * Math.PI);
      const a = this.pounceFrom, b = this.pounceTo;
      r.x = lerp(a.x, b.x, smoothstep(k));
      r.y = lerp(a.y, b.y, smoothstep(k)) - arc * 34 * r.scale;
      r.vx = (b.x - a.x) * 1.6;
      r.vy = 0;
      if (k >= 1) {
        this._effect('dust', r.x, r.y);
        this.needs.boredom = clamp(this.needs.boredom - 0.35, 0, 1);
        this.needs.energy = clamp(this.needs.energy - 0.02, 0, 1);
        this._enter('swat');
      }
    },

    swat(dt) {
      const r = this.rig;
      this.note = 'batting at the cursor';
      r.setPose('crouch', 6);
      r.tailWhip = 0.7;
      r.pupilTarget = 1;
      this._stop(dt);
      this._look(this.cursor.x, this.cursor.y, 1, dt);
      r.face(this.cursor.x >= r.x ? 1 : -1);

      this.swatNext -= dt;
      if (this.swatNext <= 0 && this.swatCount > 0) {
        this.swatCount--;
        this.swatNext = rand(0.35, 0.6);
        r.pawSwipe = 0.001;
        r.pawSwipeLeg = 1;
        // If the paw actually reaches the cursor, mark the hit.
        const reach = Math.hypot(this.cursor.x - r.pawTipX, this.cursor.y - r.pawTipY);
        if (reach < 46 * r.scale) this._effect('swat', this.cursor.x, this.cursor.y);
      }
      if (this.stateT > this.stateDur) {
        this.needs.boredom = clamp(this.needs.boredom - 0.3, 0, 1);
        this._enter(Math.random() < 0.4 ? 'groom' : 'sitIdle');
      }
    },

    beg(dt) {
      const r = this.rig;
      const f = this.food;
      if (!f) return this._enter('sitIdle');
      this.note = 'heading for the bowl';
      r.setPose('walk', 5);
      r.tailWhip = 0.4;
      r.pupilTarget = 0.7;
      const standX = f.x - r.dir * 22 * r.scale;
      const arrived = Math.abs(r.x - (f.x - 24 * r.scale)) < 16 && Math.abs(r.y - f.y) < 14;
      this._moveToward(f.x - 24 * r.scale, f.y, 130, dt);
      this._look(f.x, f.y, 0.9, dt);
      r.mouthOpenTarget = Math.sin(this.stateT * 3) > 0.8 ? 0.7 : 0;
      if (arrived || this.stateT > this.stateDur) {
        r.face(1);
        this._enter('eat');
      }
    },

    eat(dt) {
      const r = this.rig;
      const f = this.food;
      if (!f) return this._enter('sitIdle');
      this.note = 'eating';
      this._stop(dt);
      r.setPose('loaf', 4);
      r.tailWhip = 0.06;
      r.earFold = 0.1;
      r.pupilTarget = 0.5;
      r.eyeOpenTarget = 0.5;
      // Head down in the bowl, chewing.
      const chew = Math.sin(this.stateT * 7.5);
      this._look(f.x, f.y + 6 * r.scale + chew * 3 * r.scale, 1, dt);
      r.mouthOpenTarget = chew > 0 ? 0.5 : 0.05;
      f.fill = Math.max(0, f.fill - dt / this.stateDur);
      this.needs.hunger = clamp(this.needs.hunger - dt / this.stateDur, 0, 1);

      if (f.fill <= 0.02 || this.stateT > this.stateDur) {
        this.food = null;
        // A fed cat is a well-behaved cat, for a while.
        this.calmT = CALM_AFTER_MEAL;
        this.needs.hunger = 0;
        this.needs.boredom = clamp(this.needs.boredom - 0.3, 0, 1);
        this._enter('groom');
      }
    },

    beingPetted(dt) {
      const r = this.rig;
      this.note = 'being stroked';
      this._stop(dt);
      r.setPose(this.pet.level > 0.5 ? 'loaf' : 'sit', 3);
      r.tailWhip = 0.06;
      r.purr = 1;
      r.earFold = 0.35;
      r.pupilTarget = 0.25;
      r.eyeOpenTarget = lerp(0.6, 0.08, this.pet.level);
      // Leans into the hand.
      const lean = this.cursor.x > r.x ? 1 : -1;
      r.face(lean);
      r.x += lean * 3 * r.scale * dt;
      this._look(this.cursor.x, this.cursor.y, 0.8, dt);
      // Slow blinks: the cat equivalent of a compliment.
      if (Math.random() < dt * 0.5) r.blink(1);

      this.pet.satisfaction += dt * (this.pet.active > 0.5 ? 0.09 : 0.02);
      if (this.pet.satisfaction >= 1) {
        this.needs.affection = 1;
        this._enter('satisfiedLeave');
      } else if (this.pet.active < 0.15 && this.stateT > 2.5) {
        // You stopped. It stays contented rather than storming off.
        this._enter('napLoaf');
      }
    },

    satisfiedLeave(dt) {
      const r = this.rig;
      this.note = 'had enough, thanks';
      r.setPose('walk', 4);
      r.tailWhip = 0.25;
      r.purr = 0.3;
      r.earFold = 0.1;
      const t = this.target;
      if (!t || this._moveToward(t.x, t.y, t.speed, dt) || this.stateT > this.stateDur) {
        return this._enter(Math.random() < 0.6 ? 'napLoaf' : 'groom');
      }
      this._look(t.x, t.y, 0.4, dt);
    },
  };

  global.CatBrain = { CatBrain };
})(typeof window !== 'undefined' ? window : globalThis);
