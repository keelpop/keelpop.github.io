/*
 * rig.js — the cat's body.
 *
 * A small skeletal animation system: a spine that lags behind the hips, a tail
 * that is a proper spring chain, two-bone IK legs with a no-slip gait, and a
 * head that can look at things. Everything is integrated in world space so the
 * cat carries its own inertia when it starts and stops.
 *
 * Exposes window.CatRig.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- math ----

  const TAU = Math.PI * 2;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[randInt(0, arr.length - 1)];
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

  /** Frame-rate independent exponential approach. `rate` is per second. */
  const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));

  /** Shortest-path angle interpolation. */
  function angleDamp(cur, target, rate, dt) {
    let d = (target - cur) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return cur + d * (1 - Math.exp(-rate * dt));
  }

  /** Cheap smooth pseudo-noise in [-1,1]; deterministic per seed. */
  function noise(t, seed) {
    return (
      Math.sin(t * 1.0 + seed * 7.13) * 0.55 +
      Math.sin(t * 2.31 + seed * 3.77) * 0.3 +
      Math.sin(t * 5.17 + seed * 11.9) * 0.15
    );
  }

  /**
   * Two-bone IK. Returns the joint (knee/elbow) position.
   * `bend` = +1 / -1 selects which side the joint pops out to.
   */
  function solveIK(ax, ay, bx, by, la, lb, bend) {
    let dx = bx - ax;
    let dy = by - ay;
    let d = Math.hypot(dx, dy);
    const maxD = (la + lb) * 0.999;
    const minD = Math.abs(la - lb) * 1.001 + 0.001;
    if (d > maxD) d = maxD;
    if (d < minD) d = minD;
    if (d < 1e-6) d = 1e-6;
    // Re-normalise the direction to the (possibly clamped) length.
    const inv = 1 / Math.max(1e-6, Math.hypot(dx, dy));
    dx *= inv;
    dy *= inv;
    const a = (d * d + la * la - lb * lb) / (2 * d);
    const h = Math.sqrt(Math.max(0, la * la - a * a));
    return {
      x: ax + dx * a - dy * h * bend,
      y: ay + dy * a + dx * h * bend,
      // The effective (clamped) foot position, so drawing never breaks.
      fx: ax + dx * d,
      fy: ay + dy * d,
    };
  }

  // --------------------------------------------------------------- poses ----
  //
  // Local coordinates: `f` = forward (towards the nose), `u` = up from the
  // ground. One unit ~= 0.5cm of real cat, so a grown cat is ~52 units from hip
  // to shoulder, stands ~51 units at the withers, has a ~23 unit head and a
  // ~50 unit tail. Spine nodes sit at mid-body height, not on the back line.

  const SPINE_R = [14.8, 14.0, 14.0, 15.4, 14.8, 9.4]; // body half-thickness

  function P(f, u) {
    return { f, u };
  }

  const POSES = {
    stand: {
      spine: [P(0, 37.0), P(13, 38.5), P(26, 38.5), P(39, 37.5), P(52, 36.0), P(59, 44.0)],
      head: P(68, 54.0),
      headAngle: -0.10,
      frontFoot: 54, frontFootU: 0,
      hindFoot: -2, hindFootU: 0,
      legMode: 'ik',
      tail: { curl: -0.08, lift: 0.6, front: false },
      ear: 0,
      squash: 1,
    },
    walk: {
      spine: [P(0, 36.0), P(13, 37.6), P(26, 37.6), P(39, 36.6), P(52, 35.2), P(59, 43.0)],
      head: P(68, 52.5),
      headAngle: -0.06,
      frontFoot: 54, frontFootU: 0,
      hindFoot: -2, hindFootU: 0,
      legMode: 'ik',
      tail: { curl: -0.04, lift: 0.8, front: false },
      ear: 0,
      squash: 1,
    },
    sit: {
      // Rear on the floor, spine climbing steeply, front legs nearly straight.
      spine: [P(0, 13.0), P(3.5, 20.0), P(8, 26.5), P(13, 32.0), P(18, 37.0), P(22, 42.0)],
      head: P(29, 51.5),
      headAngle: -0.04,
      frontFoot: 26, frontFootU: 0,
      hindFoot: 20, hindFootU: 0,
      legMode: 'ik',
      tail: { curl: 0.5, lift: 0.0, front: true },
      ear: 0,
      squash: 1,
    },
    loaf: {
      spine: [P(0, 16.0), P(12, 19.0), P(24, 20.0), P(36, 20.0), P(47, 19.0), P(53, 23.0)],
      head: P(61, 33.0),
      headAngle: -0.02,
      frontFoot: 60, frontFootU: 0,
      hindFoot: 8, hindFootU: 0,
      legMode: 'tuck',
      tail: { curl: 0.75, lift: -0.1, front: true },
      ear: 0,
      squash: 1.03,
    },
    sleep: {
      spine: [P(4, 15.0), P(15, 21.0), P(26, 23.0), P(36, 21.0), P(44, 18.0), P(48, 18.0)],
      head: P(53, 16.0),
      headAngle: 0.6,
      frontFoot: 58, frontFootU: 0,
      hindFoot: 8, hindFootU: 0,
      legMode: 'tuck',
      tail: { curl: 1.2, lift: -0.25, front: true },
      ear: -0.3,
      squash: 1.06,
    },
    crouch: {
      spine: [P(0, 24.0), P(13, 27.0), P(26, 28.0), P(39, 26.0), P(52, 23.0), P(60, 28.0)],
      head: P(68, 32.0),
      headAngle: 0.06,
      frontFoot: 56, frontFootU: 0,
      hindFoot: 2, hindFootU: 0,
      legMode: 'ik',
      tail: { curl: 0.05, lift: -0.1, front: false },
      ear: -0.1,
      squash: 1.02,
    },
    pounce: {
      // Airborne: the feet leave the ground, so they get their own height.
      spine: [P(0, 30.0), P(13, 38.0), P(26, 44.0), P(39, 46.0), P(52, 44.0), P(60, 45.0)],
      head: P(69, 52.0),
      headAngle: 0.12,
      frontFoot: 74, frontFootU: 26,
      hindFoot: -24, hindFootU: 8,
      legMode: 'ik',
      tail: { curl: -0.45, lift: 0.95, front: false },
      ear: -0.05,
      squash: 0.95,
    },
    stretch: {
      spine: [P(0, 34.0), P(14, 40.0), P(28, 44.0), P(41, 40.0), P(53, 30.0), P(60, 27.0)],
      head: P(68, 28.0),
      headAngle: 0.28,
      frontFoot: 66, frontFootU: 0,
      hindFoot: -2, hindFootU: 0,
      legMode: 'ik',
      tail: { curl: -0.4, lift: 1.0, front: false },
      ear: 0,
      squash: 1,
    },
  };

  function blankPose() {
    return {
      spine: [P(0, 0), P(0, 0), P(0, 0), P(0, 0), P(0, 0), P(0, 0)],
      head: P(0, 0),
      headAngle: 0,
      frontFoot: 0, frontFootU: 0,
      hindFoot: 0, hindFootU: 0,
      legMode: 'ik',
      tail: { curl: 0, lift: 0, front: false },
      ear: 0,
      squash: 1,
    };
  }

  /** Blend `dst` towards named pose `name`. Mutates dst. */
  function blendPose(dst, name, rate, dt) {
    const src = POSES[name] || POSES.stand;
    const k = 1 - Math.exp(-rate * dt);
    for (let i = 0; i < dst.spine.length; i++) {
      dst.spine[i].f = lerp(dst.spine[i].f, src.spine[i].f, k);
      dst.spine[i].u = lerp(dst.spine[i].u, src.spine[i].u, k);
    }
    dst.head.f = lerp(dst.head.f, src.head.f, k);
    dst.head.u = lerp(dst.head.u, src.head.u, k);
    dst.headAngle = lerp(dst.headAngle, src.headAngle, k);
    dst.frontFoot = lerp(dst.frontFoot, src.frontFoot, k);
    dst.hindFoot = lerp(dst.hindFoot, src.hindFoot, k);
    dst.frontFootU = lerp(dst.frontFootU, src.frontFootU || 0, k);
    dst.hindFootU = lerp(dst.hindFootU, src.hindFootU || 0, k);
    dst.tail.curl = lerp(dst.tail.curl, src.tail.curl, k);
    dst.tail.lift = lerp(dst.tail.lift, src.tail.lift, k);
    dst.ear = lerp(dst.ear, src.ear, k);
    dst.squash = lerp(dst.squash, src.squash, k);
    // Discrete properties snap once we are mostly there.
    dst.tail.front = src.tail.front;
    dst.legMode = src.legMode;
    return dst;
  }

  // ----------------------------------------------------------------- rig ----

  const TAIL_SEGMENTS = 11;
  const TAIL_LEN = 4.6; // per segment, local units

  class Rig {
    constructor(opts) {
      opts = opts || {};
      this.scale = opts.scale || 1.0;
      this.x = opts.x || 200;
      this.y = opts.y || 200;
      this.vx = 0;
      this.vy = 0;

      this.dir = 1; // signed facing, |dir| kept >= MIN_DIR
      this.dirTarget = 1;

      this.pose = blendPose(blankPose(), 'sit', 1e9, 1);
      this.poseName = 'sit';
      this.poseRate = 6;

      // World-space spine nodes with velocity, so the back lags the hips.
      this.spine = SPINE_R.map((r, i) => ({ x: this.x, y: this.y, vx: 0, vy: 0, r }));

      this.head = { x: this.x, y: this.y, vx: 0, vy: 0, angle: 0 };
      this.neckAngle = 0;

      this.tail = [];
      for (let i = 0; i < TAIL_SEGMENTS; i++) {
        this.tail.push({ x: this.x, y: this.y, px: this.x, py: this.y });
      }

      // legs: 0 front-far, 1 front-near, 2 hind-far, 3 hind-near
      this.legs = [
        { front: true, near: false, phase: 0.52 },
        { front: true, near: true, phase: 0.0 },
        { front: false, near: false, phase: 0.02 },
        { front: false, near: true, phase: 0.5 },
      ].map((l) => Object.assign(l, {
        footX: this.x, footY: this.y,
        plantX: this.x, plantY: this.y,
        prevPlantX: this.x, prevPlantY: this.y,
        lift: 0, swinging: false,
        kneeX: this.x, kneeY: this.y,
        hipX: this.x, hipY: this.y,
      }));

      this.gaitPhase = 0;
      this.speed = 0;
      this.bob = 0;
      this.bodyPitch = 0;

      // Look / attention
      this.lookX = this.x + 100;
      this.lookY = this.y - 30;
      this.lookWeight = 0; // 0 = neutral head, 1 = fully tracking
      this.headYaw = 0;
      this.headPitch = 0;

      // Face
      this.eyeOpen = 1;
      this.eyeOpenTarget = 1;
      this.pupil = 0.4; // 0 slit .. 1 blown
      this.pupilTarget = 0.4;
      this.blinkT = rand(2, 6);
      this.blinking = 0;
      this.mouthOpen = 0;

      // Mood-ish rendering knobs the brain writes to
      this.earFold = 0; // 0 up, 1 flat back
      this.earTwitch = [0, 0];
      this.purr = 0;
      this.tailWhip = 0; // 0 lazy sway .. 1 agitated thrash
      this.arch = 0; // back arch (halloween cat)
      this.pawSwipe = 0; // 0..1 animation drive for a paw strike
      this.pawSwipeLeg = 1;
      this.groom = 0;

      this.t = rand(0, 100);
      this.seed = rand(0, 100);

      // Where the near-front paw actually ends up, for hit tests / effects.
      this.pawTipX = this.x;
      this.pawTipY = this.y;

      this.snapToPose();
    }

    // Local (forward, up) -> world.
    l2w(f, u, out) {
      const s = this.scale;
      const o = out || {};
      o.x = this.x + f * this.dir * s;
      o.y = this.y - u * s * this.pose.squash;
      return o;
    }

    get facingRight() {
      return this.dir >= 0;
    }

    setPose(name, rate) {
      this.poseName = name;
      if (rate != null) this.poseRate = rate;
    }

    face(dirSign) {
      this.dirTarget = dirSign >= 0 ? 1 : -1;
    }

    lookAt(x, y, weight) {
      this.lookX = x;
      this.lookY = y;
      if (weight != null) this.lookWeight = weight;
    }

    blink(strength) {
      this.blinking = Math.max(this.blinking, strength == null ? 1 : strength);
    }

    /** Force the whole skeleton to the current pose with no easing. */
    snapToPose() {
      blendPose(this.pose, this.poseName, 1e9, 1);
      const p = {};
      for (let i = 0; i < this.spine.length; i++) {
        this.l2w(this.pose.spine[i].f, this.pose.spine[i].u, p);
        this.spine[i].x = p.x;
        this.spine[i].y = p.y;
        this.spine[i].vx = this.spine[i].vy = 0;
      }
      this.l2w(this.pose.head.f, this.pose.head.u, p);
      this.head.x = p.x;
      this.head.y = p.y;
      const base = this.spine[0];
      for (let i = 0; i < this.tail.length; i++) {
        this.tail[i].x = this.tail[i].px = base.x - this.dir * i * TAIL_LEN * this.scale;
        this.tail[i].y = this.tail[i].py = base.y - i * 0.6 * this.scale;
      }
      for (const leg of this.legs) {
        const f = leg.front ? this.pose.frontFoot : this.pose.hindFoot;
        const u = leg.front ? this.pose.frontFootU : this.pose.hindFootU;
        this.l2w(f, u, p);
        leg.footX = leg.plantX = leg.prevPlantX = p.x;
        leg.footY = leg.plantY = leg.prevPlantY = p.y;
      }
    }

    // ------------------------------------------------------------- update --

    update(dt) {
      dt = Math.min(dt, 1 / 20); // never integrate a huge step
      this.t += dt;

      blendPose(this.pose, this.poseName, this.poseRate, dt);

      // Facing: keep a minimum |dir| so the cat never degenerates to a line.
      const MIN_DIR = 0.34;
      this.dir = damp(this.dir, this.dirTarget, 7, dt);
      if (Math.abs(this.dir) < MIN_DIR) {
        this.dir = (this.dir >= 0 ? 1 : -1) * MIN_DIR;
      }

      this.speed = Math.hypot(this.vx, this.vy);

      this.#updateGait(dt);
      this.#updateSpine(dt);
      this.#updateHead(dt);
      this.#updateFace(dt);
      this.#updateLegs(dt);
      this.#updateTail(dt);
      this.#updateEars(dt);
    }

    #updateGait(dt) {
      // Stride length grows with speed; cadence too, but sub-linearly.
      const sp = this.speed / this.scale;
      const cadence = clamp(0.35 + sp * 0.030, 0, 3.4);
      this.gaitPhase = (this.gaitPhase + cadence * dt) % 1;

      const moving = sp > 3;
      const bobAmp = moving ? clamp(sp * 0.055, 0, 3.0) : 0;
      const target = moving ? Math.sin(this.gaitPhase * TAU * 2) * bobAmp : 0;
      this.bob = damp(this.bob, target, 18, dt);

      const breath = Math.sin(this.t * (this.purr > 0.2 ? 3.1 : 1.05)) * (moving ? 0.15 : 0.42);
      const tremor = this.purr > 0.05 ? Math.sin(this.t * 46) * 0.22 * this.purr : 0;
      this.breath = breath + tremor;
    }

    #updateSpine(dt) {
      const p = {};
      const archLift = this.arch;
      for (let i = 0; i < this.spine.length; i++) {
        const sp = this.pose.spine[i];
        // Arch bows the middle of the back upward.
        const mid = 1 - Math.abs((i / (this.spine.length - 1)) - 0.45) / 0.55;
        const u = sp.u + this.bob + this.breath * (i > 1 ? 1 : 0.4) + archLift * 9 * Math.max(0, mid);
        this.l2w(sp.f, u, p);
        const n = this.spine[i];
        // Stiffer at the hips, looser towards the shoulders: the back follows.
        const k = 260 - i * 22;
        const c = 2 * Math.sqrt(k) * 0.95;
        n.vx += (p.x - n.x) * k * dt - n.vx * c * dt;
        n.vy += (p.y - n.y) * k * dt - n.vy * c * dt;
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        n.r = SPINE_R[i] * (1 + this.breath * 0.02);
      }
    }

    #updateHead(dt) {
      const p = this.l2w(this.pose.head.f, this.pose.head.u + this.bob * 0.6 + this.breath * 0.3, {});
      const k = 190;
      const c = 2 * Math.sqrt(k) * 0.9;
      const h = this.head;
      h.vx += (p.x - h.x) * k * dt - h.vx * c * dt;
      h.vy += (p.y - h.y) * k * dt - h.vy * c * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;

      // Look-at, expressed as yaw (towards/away from the viewer) and pitch.
      const neck = this.spine[this.spine.length - 1];
      const dx = (this.lookX - h.x) * (this.dir >= 0 ? 1 : -1);
      const dy = this.lookY - h.y;
      const wantPitch = clamp(Math.atan2(dy, Math.max(24, Math.abs(dx))) * 0.85, -0.75, 0.85);
      // Negative dx means the target is behind the cat -> turn the head back.
      const wantYaw = clamp(-dx / (150 * this.scale), -1, 1);
      const w = this.lookWeight;
      this.headPitch = angleDamp(this.headPitch, wantPitch * w, 8, dt);
      this.headYaw = damp(this.headYaw, wantYaw * w, 7, dt);
      this.head.angle = angleDamp(
        this.head.angle,
        this.pose.headAngle + this.headPitch,
        9,
        dt
      );
      this.neckAngle = Math.atan2(h.y - neck.y, (h.x - neck.x) * (this.dir >= 0 ? 1 : -1));
    }

    #updateFace(dt) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) {
        this.blinking = 1;
        this.blinkT = rand(2.2, 7.5);
      }
      if (this.blinking > 0) {
        this.blinking -= dt * 7.5;
        if (this.blinking < 0) this.blinking = 0;
      }
      this.eyeOpen = damp(this.eyeOpen, this.eyeOpenTarget, 12, dt);
      const blinkAmt = Math.sin(clamp(this.blinking, 0, 1) * Math.PI);
      this.eyeLid = clamp(this.eyeOpen * (1 - blinkAmt), 0, 1);
      this.pupil = damp(this.pupil, this.pupilTarget, 6, dt);
      this.mouthOpen = damp(this.mouthOpen, this.mouthOpenTarget || 0, 9, dt);
    }

    #updateLegs(dt) {
      const p = {};
      const shoulder = this.spine[4];
      const hip = this.spine[0];
      const sp = this.speed / this.scale;
      const moving = sp > 3;
      const stride = clamp(16 + sp * 0.42, 16, 46) * this.scale;
      const tuck = this.pose.legMode === 'tuck';

      for (const leg of this.legs) {
        const attach = leg.front ? shoulder : hip;
        // Near legs sit slightly forward of the far ones (a hint of perspective).
        const lateral = (leg.near ? 1 : -1) * 3.2 * this.scale;
        leg.hipX = attach.x + lateral * 0.4 * this.dir;
        leg.hipY = attach.y + (leg.near ? 1.0 : -2.0) * this.scale;

        const stanceF = leg.front ? this.pose.frontFoot : this.pose.hindFoot;
        const stanceU = leg.front ? this.pose.frontFootU : this.pose.hindFootU;
        this.l2w(stanceF + (leg.near ? 2.0 : -2.0), stanceU, p);
        const stanceX = p.x + lateral * 0.15;
        const stanceY = p.y;

        if (tuck || !moving) {
          leg.swinging = false;
          leg.lift = damp(leg.lift, 0, 14, dt);
          leg.footX = damp(leg.footX, stanceX, 11, dt);
          leg.footY = damp(leg.footY, stanceY, 11, dt);
          leg.plantX = leg.footX;
          leg.plantY = leg.footY;
        } else {
          const ph = (this.gaitPhase + leg.phase) % 1;
          const SWING = 0.34; // fraction of the cycle spent in the air
          if (ph < SWING) {
            if (!leg.swinging) {
              leg.swinging = true;
              leg.prevPlantX = leg.footX;
              leg.prevPlantY = leg.footY;
              const nx = this.vx / Math.max(1e-6, this.speed);
              const ny = this.vy / Math.max(1e-6, this.speed);
              leg.plantX = stanceX + nx * stride * 0.5;
              leg.plantY = stanceY + ny * stride * 0.5;
            }
            const s = ph / SWING;
            const e = smoothstep(s);
            leg.footX = lerp(leg.prevPlantX, leg.plantX, e);
            leg.footY = lerp(leg.prevPlantY, leg.plantY, e);
            leg.lift = Math.sin(s * Math.PI) * (leg.front ? 9.5 : 8.2) * this.scale;
          } else {
            leg.swinging = false;
            leg.lift = damp(leg.lift, 0, 26, dt);
            // Planted: the foot stays put in the world, so no sliding.
          }
        }

        // A paw swipe overrides the near front leg entirely.
        let fx = leg.footX;
        let fy = leg.footY - leg.lift;
        if (this.pawSwipe > 0 && leg.front && leg.near === (this.pawSwipeLeg === 1)) {
          const s = this.pawSwipe;
          const swing = Math.sin(s * Math.PI);
          const reach = 40 * this.scale * swing;
          const ang = -0.9 + s * 1.9;
          fx = leg.hipX + Math.cos(ang) * reach * this.dir;
          fy = leg.hipY - Math.abs(Math.sin(ang)) * reach * 0.75 - 6 * this.scale * swing;
        }

        const la = (leg.front ? 20.0 : 22.0) * this.scale;
        const lb = (leg.front ? 19.0 : 21.0) * this.scale;
        // Cat elbows point back, stifles point forward.
        const bend = (leg.front ? 1 : -1) * (this.dir >= 0 ? 1 : -1);
        const ik = solveIK(leg.hipX, leg.hipY, fx, fy, la, lb, bend);
        leg.kneeX = ik.x;
        leg.kneeY = ik.y;
        leg.drawFootX = ik.fx;
        leg.drawFootY = ik.fy;

        if (leg.front && leg.near) {
          this.pawTipX = ik.fx + this.dir * 5 * this.scale;
          this.pawTipY = ik.fy - 2 * this.scale;
        }
      }

      if (this.pawSwipe > 0) {
        this.pawSwipe = clamp(this.pawSwipe + dt * 3.4, 0, 1.0001);
        if (this.pawSwipe >= 1) this.pawSwipe = 0;
      }
    }

    #updateTail(dt) {
      const base = this.spine[0];
      const segLen = TAIL_LEN * this.scale;
      const t0 = this.tail[0];
      t0.x = base.x - this.dir * 5 * this.scale;
      t0.y = base.y - 7 * this.scale;

      const whip = this.tailWhip;
      const waveFreq = lerp(1.5, 8.5, whip);
      const waveAmp = lerp(0.055, 0.30, whip);
      const curl = this.pose.tail.curl;
      const lift = this.pose.tail.lift;

      // Base direction: away from the head, tilted up by `lift`.
      const sgn = this.dir >= 0 ? 1 : -1;
      // Build the whole target shape from angles first. Feeding the *actual*
      // lagged positions back into the angle accumulator (the obvious way to
      // write this) couples the spring to its own error and settles into a
      // permanent kink near the base.
      let ang = Math.atan2(-lift * 1.4, -this.dir);
      let tx = t0.x;
      let ty = t0.y;
      const droop = 1 - clamp(lift, 0, 1) * 0.85;

      for (let i = 1; i < this.tail.length; i++) {
        const n = this.tail[i];
        const f = i / (this.tail.length - 1);

        // `lift` keeps curving the tail up over the back; `curl` sweeps it the
        // other way, down and around the feet. Both flip with the facing.
        ang += sgn * (lift * 0.085 - curl * 0.30) +
          Math.sin(this.t * waveFreq - i * 0.55) * waveAmp * (0.25 + f);
        tx += Math.cos(ang) * segLen;
        ty += Math.sin(ang) * segLen + droop * 0.05 * segLen * i * 0.35;

        // Verlet with heavy damping: inertia without the jitter.
        const vx = (n.x - n.px) * 0.86;
        const vy = (n.y - n.py) * 0.86;
        n.px = n.x;
        n.py = n.y;
        const k = 0.34 - f * 0.12;
        n.x += vx + (tx - n.x) * k;
        n.y += vy + (ty - n.y) * k;

        // Hard length constraint keeps it from stretching.
        const prev = this.tail[i - 1];
        const dx = n.x - prev.x;
        const dy = n.y - prev.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        n.x = prev.x + (dx / d) * segLen;
        n.y = prev.y + (dy / d) * segLen;
      }
    }

    #updateEars(dt) {
      for (let i = 0; i < 2; i++) {
        const n = noise(this.t * 1.4, this.seed + i * 3);
        // Random flicks, more often when alert.
        const flick = n > 0.86 ? (n - 0.86) * 4 : 0;
        this.earTwitch[i] = damp(this.earTwitch[i], flick * 0.35, 14, dt);
      }
    }

    /** Rough body bounding box in world space, for hit tests. */
    bounds(pad) {
      pad = pad == null ? 6 : pad;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const add = (x, y, r) => {
        x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r);
        x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r);
      };
      for (const n of this.spine) add(n.x, n.y, n.r * this.scale * 0.9);
      add(this.head.x, this.head.y, 15 * this.scale);
      for (const l of this.legs) add(l.drawFootX || l.footX, l.drawFootY || l.footY, 4 * this.scale);
      return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    }

    /** Squared distance from a point to the nearest body segment centre. */
    distanceTo(px, py) {
      let best = Infinity;
      const consider = (x, y, r) => {
        const d = Math.hypot(px - x, py - y) - r;
        if (d < best) best = d;
      };
      for (const n of this.spine) consider(n.x, n.y, n.r * this.scale * 0.85);
      consider(this.head.x, this.head.y, 13 * this.scale);
      return best;
    }
  }

  global.CatRig = {
    Rig,
    POSES,
    math: { TAU, clamp, lerp, smoothstep, rand, randInt, pick, dist, damp, angleDamp, noise, solveIK },
  };
})(typeof window !== 'undefined' ? window : globalThis);
