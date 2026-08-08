/*
 * draw.js — turns a Rig into something that looks like a cat.
 *
 * Everything is drawn procedurally with Canvas 2D: a variable-width silhouette
 * built from the spine, gradient volume shading, mackerel tabby striping
 * clipped to the body, per-frame fur strokes along the outline, and a head that
 * blends between a profile and a three-quarter keyframe so it can look at you.
 *
 * Exposes window.CatArt.
 */
(function (global) {
  'use strict';

  const M = global.CatRig.math;
  const { clamp, lerp, smoothstep, noise, TAU } = M;

  // -------------------------------------------------------------- palette ---

  const COATS = {
    brownTabby: {
      light: '#d0b898',
      mid: '#ab8c6a',
      dark: '#7a6146',
      shadow: '#584535',
      stripe: '#4f3d2c',
      belly: '#e6dac9',
      furTip: '#e2cfb2',
      rim: 'rgba(196,218,255,0.30)',
      nose: '#c98d86',
      innerEar: '#cf9b91',
      pad: '#b07d76',
      iris: '#c9a63c',
      irisEdge: '#8a6a1c',
      whisker: 'rgba(255,250,240,0.72)',
    },
    grey: {
      light: '#c3c7cc',
      mid: '#9aa0a7',
      dark: '#6d747c',
      shadow: '#4e545b',
      stripe: '#454b52',
      belly: '#e2e5e8',
      furTip: '#d8dde2',
      rim: 'rgba(200,220,255,0.32)',
      nose: '#b98d8d',
      innerEar: '#c49a9a',
      pad: '#9c7b7b',
      iris: '#7fae6a',
      irisEdge: '#4a7340',
      whisker: 'rgba(255,255,255,0.75)',
    },
    black: {
      light: '#4a464a',
      mid: '#332f33',
      dark: '#211e22',
      shadow: '#151316',
      stripe: '#1a171a',
      belly: '#403c41',
      furTip: '#6b656d',
      rim: 'rgba(190,214,255,0.38)',
      nose: '#4a3b3b',
      innerEar: '#6b5252',
      pad: '#3a2f2f',
      iris: '#d8b03c',
      irisEdge: '#8f6d18',
      whisker: 'rgba(255,255,255,0.60)',
    },
    cream: {
      light: '#f0e2cd',
      mid: '#dcc7a9',
      dark: '#b79f80',
      shadow: '#93795c',
      stripe: '#a98a64',
      belly: '#faf2e6',
      furTip: '#fdf3e2',
      rim: 'rgba(200,220,255,0.26)',
      nose: '#d79c94',
      innerEar: '#e3aca2',
      pad: '#c78f87',
      iris: '#5fa3c4',
      irisEdge: '#356d8c',
      whisker: 'rgba(255,255,255,0.8)',
    },
  };

  // ------------------------------------------------------------ geometry ---

  /** Catmull-Rom sample of an array of {x,y} (or numbers via `get`). */
  function crSample(pts, t, get) {
    const n = pts.length;
    const seg = clamp(t, 0, 0.999999) * (n - 1);
    const i = Math.floor(seg);
    const f = seg - i;
    const g = get || ((p) => p);
    const p0 = g(pts[Math.max(0, i - 1)]);
    const p1 = g(pts[i]);
    const p2 = g(pts[Math.min(n - 1, i + 1)]);
    const p3 = g(pts[Math.min(n - 1, i + 2)]);
    const f2 = f * f;
    const f3 = f2 * f;
    const a = -0.5 * f3 + f2 - 0.5 * f;
    const b = 1.5 * f3 - 2.5 * f2 + 1;
    const c = -1.5 * f3 + 2 * f2 + 0.5 * f;
    const d = 0.5 * f3 - 0.5 * f2;
    if (typeof p1 === 'number') return p0 * a + p1 * b + p2 * c + p3 * d;
    return {
      x: p0.x * a + p1.x * b + p2.x * c + p3.x * d,
      y: p0.y * a + p1.y * b + p2.y * c + p3.y * d,
    };
  }

  /** Trace a closed smooth path through `pts` using midpoint quadratics. */
  function closedSpline(ctx, pts) {
    const n = pts.length;
    if (n < 3) return;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    let m0 = mid(pts[n - 1], pts[0]);
    ctx.moveTo(m0.x, m0.y);
    for (let i = 0; i < n; i++) {
      const cur = pts[i];
      const next = pts[(i + 1) % n];
      const m = mid(cur, next);
      ctx.quadraticCurveTo(cur.x, cur.y, m.x, m.y);
    }
    ctx.closePath();
  }

  // Body cross-section profile, per spine node: distance above / below the
  // centreline. Deep chest, tucked waist, full rump.
  const R_UP = [14.0, 13.8, 13.0, 12.4, 11.6, 8.0];
  const R_DOWN = [13.4, 9.6, 10.4, 14.4, 14.2, 9.2];

  const OUTLINE_N = 22;

  /**
   * Build the body silhouette: an array of {x, y, nx, ny} points going around
   * the body (top from rear to front, then bottom from front to rear).
   */
  function buildBody(rig, out) {
    const s = rig.scale;
    const nodes = rig.spine;

    // Virtual end nodes so the rump and neck taper instead of ending flat.
    const hip = nodes[0], lum = nodes[1];
    const neck = nodes[5], sho = nodes[4];
    const rearLen = Math.hypot(hip.x - lum.x, hip.y - lum.y) || 1;
    const frontLen = Math.hypot(neck.x - sho.x, neck.y - sho.y) || 1;
    const ctrl = [
      { x: hip.x + ((hip.x - lum.x) / rearLen) * 9 * s, y: hip.y + ((hip.y - lum.y) / rearLen) * 9 * s },
      hip, lum, nodes[2], nodes[3], sho, neck,
      { x: neck.x + ((neck.x - sho.x) / frontLen) * 4 * s, y: neck.y + ((neck.y - sho.y) / frontLen) * 4 * s },
    ];
    const rUp = [3.0, R_UP[0], R_UP[1], R_UP[2], R_UP[3], R_UP[4], R_UP[5], 3.2];
    const rDn = [3.0, R_DOWN[0], R_DOWN[1], R_DOWN[2], R_DOWN[3], R_DOWN[4], R_DOWN[5], 3.2];

    const top = [];
    const bot = [];
    const cl = [];
    for (let k = 0; k < OUTLINE_N; k++) {
      const t = k / (OUTLINE_N - 1);
      const c = crSample(ctrl, t);
      const cPrev = crSample(ctrl, Math.max(0, t - 0.02));
      const cNext = crSample(ctrl, Math.min(1, t + 0.02));
      let tx = cNext.x - cPrev.x;
      let ty = cNext.y - cPrev.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      // Perpendicular, chosen to point "up" on screen.
      let nx = ty, ny = -tx;
      if (ny > 0) { nx = -nx; ny = -ny; }
      const ru = crSample(rUp, t) * s;
      const rd = crSample(rDn, t) * s;
      cl.push({ x: c.x, y: c.y, nx, ny, ru, rd });
      top.push({ x: c.x + nx * ru, y: c.y + ny * ru, nx, ny });
      bot.push({ x: c.x - nx * rd, y: c.y - ny * rd, nx: -nx, ny: -ny });
    }

    const pts = out || [];
    pts.length = 0;
    for (let k = 0; k < OUTLINE_N; k++) pts.push(top[k]);
    for (let k = OUTLINE_N - 1; k >= 0; k--) pts.push(bot[k]);
    return { pts, cl };
  }

  /**
   * Soften a silhouette into fur: a blurred halo of the outline colour plus
   * short, dense strokes. Deterministic per index so the coat does not boil.
   */
  function furEdge(ctx, pts, rig, coat, opts) {
    const s = rig.scale;
    const len = opts.len == null ? 2.4 : opts.len;
    const w = opts.width == null ? 0.5 : opts.width;
    const alpha = opts.alpha == null ? 1 : opts.alpha;

    // Halo first: a soft wide stroke of the silhouette breaks the hard edge.
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.22 * alpha;
    ctx.strokeStyle = coat.mid;
    ctx.lineWidth = 1.8 * s;
    ctx.beginPath();
    closedSpline(ctx, pts);
    ctx.stroke();
    ctx.restore();

    // Then individual hairs, interpolated between outline points so the density
    // does not depend on how many points the caller gave us.
    ctx.save();
    ctx.lineCap = 'round';
    const SUB = 3;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      for (let k = 0; k < SUB; k++) {
        const t = k / SUB;
        const x = lerp(p.x, q.x, t);
        const y = lerp(p.y, q.y, t);
        const nx0 = lerp(p.nx, q.nx, t);
        const ny0 = lerp(p.ny, q.ny, t);
        const idx = i * SUB + k;
        const n1 = noise(rig.t * 0.5, idx * 1.7);
        const n2 = noise(rig.t * 0.8 + 11, idx * 0.9);
        const jitter = n2 * 0.5;
        const nx = nx0 * Math.cos(jitter) - ny0 * Math.sin(jitter);
        const ny = nx0 * Math.sin(jitter) + ny0 * Math.cos(jitter);
        const L = len * (0.45 + 0.55 * Math.abs(n1)) * s;
        ctx.strokeStyle = idx % 3 === 0 ? coat.furTip : coat.mid;
        ctx.globalAlpha = (idx % 3 === 0 ? 0.34 : 0.42) * alpha;
        ctx.lineWidth = w * s;
        ctx.beginPath();
        ctx.moveTo(x - nx * 1.2 * s, y - ny * 1.2 * s);
        ctx.lineTo(x + nx * L, y + ny * L);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- head ---
  //
  // Two hand-authored silhouettes, blended by `frontality`: 0 = pure profile,
  // 1 = looking back over the shoulder at you. Local units, x forward, y up.

  const HEAD_PROFILE = [
    [-9.5, 5.5], [-5.5, 10.0], [-0.5, 11.0], [4.5, 10.0], [8.6, 7.6],
    [11.4, 4.4], [13.2, 1.4], [12.4, -1.8], [10.2, -3.4], [9.6, -6.6],
    [5.0, -8.6], [-1.5, -8.8], [-7.5, -6.6], [-10.0, -1.0],
  ];
  const HEAD_FRONT = [
    [-10.0, 4.5], [-7.5, 9.4], [-2.5, 11.4], [3.0, 11.4], [7.6, 9.2],
    [9.8, 5.4], [10.6, 1.6], [10.0, -2.6], [8.4, -5.0], [6.6, -7.6],
    [2.0, -9.6], [-3.6, -9.4], [-8.0, -7.0], [-10.4, -2.0],
  ];

  function headPoint(i, f) {
    const a = HEAD_PROFILE[i], b = HEAD_FRONT[i];
    return { f: lerp(a[0], b[0], f), u: lerp(a[1], b[1], f) };
  }

  /** Local (forward, up) -> world, for a rotated + mirrored part. */
  function makeXf(ox, oy, angle, scale, mirror) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return function (f, u) {
      const x = f, y = -u;
      return {
        x: ox + (x * c - y * s) * scale * mirror,
        y: oy + (x * s + y * c) * scale,
      };
    };
  }

  // ----------------------------------------------------------------- art ---

  class CatArt {
    constructor(opts) {
      opts = opts || {};
      this.coat = COATS[opts.coat] || COATS.brownTabby;
      this.coatName = COATS[opts.coat] ? opts.coat : 'brownTabby';
      this._body = [];
      this.debug = false;
    }

    setCoat(name) {
      if (COATS[name]) {
        this.coat = COATS[name];
        this.coatName = name;
      }
    }

    static get coats() {
      return Object.keys(COATS);
    }

    /** Draw the whole cat. `groundY` is where the contact shadow lands. */
    draw(ctx, rig, groundY) {
      const coat = this.coat;
      const s = rig.scale;
      const mirror = rig.dir >= 0 ? 1 : -1;
      const squeeze = clamp(Math.abs(rig.dir), 0.34, 1);

      const { pts, cl } = buildBody(rig, this._body);

      ctx.save();
      this.#shadow(ctx, rig, groundY == null ? rig.y : groundY);
      this.#tail(ctx, rig, false);
      this.#legs(ctx, rig, 'behind');
      this.#body(ctx, rig, pts, cl, squeeze);
      this.#legs(ctx, rig, 'front');
      this.#ruff(ctx, rig);
      this.#head(ctx, rig, mirror, squeeze);
      this.#tail(ctx, rig, true);
      ctx.restore();

      if (this.debug) this.#debug(ctx, rig);
    }

    #shadow(ctx, rig, groundY) {
      const s = rig.scale;
      const cx = rig.x + rig.dir * 26 * s;
      const height = clamp((groundY - rig.y) / (40 * s), 0, 1);
      const spread = lerp(1, 1.6, height);
      const rx = 44 * s * spread * clamp(Math.abs(rig.dir) + 0.25, 0, 1.15);
      const ry = 8 * s * spread;
      const g = ctx.createRadialGradient(cx, groundY, 0, cx, groundY, Math.max(rx, ry));
      const a = lerp(0.30, 0.10, height);
      g.addColorStop(0, `rgba(12,10,14,${a})`);
      g.addColorStop(0.55, `rgba(12,10,14,${a * 0.55})`);
      g.addColorStop(1, 'rgba(12,10,14,0)');
      ctx.save();
      ctx.translate(cx, groundY);
      ctx.scale(1, ry / Math.max(rx, ry));
      ctx.translate(-cx, -groundY);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, groundY, Math.max(rx, ry), 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    #body(ctx, rig, pts, cl, squeeze) {
      const coat = this.coat;
      const s = rig.scale;

      const b = rig.bounds(10);
      ctx.save();
      ctx.beginPath();
      closedSpline(ctx, pts);

      // Volume: light from above-front, deep shadow under the belly.
      const g = ctx.createLinearGradient(0, b.y0, 0, b.y1);
      g.addColorStop(0, coat.light);
      g.addColorStop(0.38, coat.mid);
      g.addColorStop(0.78, coat.dark);
      g.addColorStop(1, coat.shadow);
      ctx.fillStyle = g;
      ctx.fill();

      ctx.clip();

      // Pale belly / chest.
      const chest = cl[Math.floor(OUTLINE_N * 0.72)];
      const bg = ctx.createRadialGradient(
        chest.x, chest.y + chest.rd * 0.5, 2 * s,
        chest.x, chest.y + chest.rd * 0.4, 34 * s
      );
      bg.addColorStop(0, coat.belly);
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = bg;
      ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      ctx.globalAlpha = 1;

      // Mackerel tabby: a dorsal stripe plus ribs curving down the flanks.
      ctx.lineCap = 'round';
      ctx.strokeStyle = coat.stripe;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 3.4 * s;
      ctx.beginPath();
      for (let k = 1; k < OUTLINE_N - 2; k++) {
        const c = cl[k];
        const x = c.x + c.nx * c.ru * 0.72;
        const y = c.y + c.ny * c.ru * 0.72;
        if (k === 1) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Ribs: mostly straight down the flank, swept slightly towards the rear.
      ctx.lineWidth = 2.6 * s;
      ctx.globalAlpha = 0.24;
      for (let k = 2; k < OUTLINE_N - 3; k += 2) {
        const c = cl[k];
        // Tangent, pointing towards the tail.
        const tx = -c.ny, ty = c.nx;
        const sweep = (0.16 + 0.10 * Math.sin(k * 1.7)) * c.rd;
        ctx.beginPath();
        ctx.moveTo(c.x + c.nx * c.ru * 0.62, c.y + c.ny * c.ru * 0.62);
        ctx.quadraticCurveTo(
          c.x + tx * sweep * 0.5, c.y + ty * sweep * 0.5,
          c.x - c.nx * c.rd * 0.85 + tx * sweep, c.y - c.ny * c.rd * 0.85 + ty * sweep
        );
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Occlusion where the legs meet the body, and along the underside.
      const ao = ctx.createLinearGradient(0, b.y1 - 26 * s, 0, b.y1);
      ao.addColorStop(0, 'rgba(0,0,0,0)');
      ao.addColorStop(1, 'rgba(20,14,10,0.34)');
      ctx.fillStyle = ao;
      ctx.fillRect(b.x0, b.y1 - 26 * s, b.x1 - b.x0, 26 * s);

      // Rim light along the top: the glow of the screen you are staring at.
      ctx.strokeStyle = coat.rim;
      ctx.lineWidth = 1.6 * s;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      for (let k = 1; k < OUTLINE_N; k++) {
        const p = pts[k];
        if (k === 1) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Interior fur: barely-there strokes lying along the coat, just enough to
      // keep the fill from looking like flat paint.
      ctx.globalAlpha = 0.055;
      ctx.strokeStyle = coat.furTip;
      ctx.lineWidth = 0.7 * s;
      for (let k = 1; k < OUTLINE_N - 1; k++) {
        const c = cl[k];
        const tx = -c.ny, ty = c.nx; // towards the tail
        for (let j = -1; j <= 1; j++) {
          const off = j * 0.4;
          const px = c.x + c.nx * c.ru * off;
          const py = c.y + c.ny * c.ru * off;
          const jit = noise(rig.t * 0.4, k * 3 + j) * 0.35;
          const dx = tx * Math.cos(jit) - ty * Math.sin(jit);
          const dy = tx * Math.sin(jit) + ty * Math.cos(jit);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + dx * 2.6 * s, py + dy * 2.6 * s);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // Silhouette fur, drawn outside the clip so it breaks the outline.
      furEdge(ctx, pts, rig, coat, { len: 2.6, width: 0.55 });
    }

    /**
     * The neck. Bridges the gap between the tapered body and the skull, which
     * otherwise meet in a visible notch whenever the head turns or lifts.
     */
    #ruff(ctx, rig) {
      const coat = this.coat;
      const s = rig.scale;
      const neck = rig.spine[5];
      const h = rig.head;
      const dx = h.x - neck.x, dy = h.y - neck.y;
      const len = Math.hypot(dx, dy) || 1e-6;
      const nx = -dy / len, ny = dx / len;
      const wa = 10.0 * s;
      const wb = 8.0 * s;
      // Reach a little past the head centre so the skull always covers the join.
      const ex = h.x + (dx / len) * 3 * s;
      const ey = h.y + (dy / len) * 3 * s;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(neck.x + nx * wa, neck.y + ny * wa);
      ctx.quadraticCurveTo(
        (neck.x + ex) / 2 + nx * wb * 1.05, (neck.y + ey) / 2 + ny * wb * 1.05,
        ex + nx * wb, ey + ny * wb
      );
      ctx.lineTo(ex - nx * wb, ey - ny * wb);
      ctx.quadraticCurveTo(
        (neck.x + ex) / 2 - nx * wb * 1.05, (neck.y + ey) / 2 - ny * wb * 1.05,
        neck.x - nx * wa, neck.y - ny * wa
      );
      ctx.closePath();
      const g = ctx.createLinearGradient(
        neck.x + nx * wa, neck.y + ny * wa,
        neck.x - nx * wa, neck.y - ny * wa
      );
      g.addColorStop(0, coat.light);
      g.addColorStop(0.5, coat.mid);
      g.addColorStop(1, coat.dark);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    }

    /**
     * Legs, in two passes.
     *
     * `behind` draws the far legs and every thigh; `front` draws only the near
     * legs' lower limbs and paws. Thighs belong to the body mass, so drawing
     * them before the torso lets the torso hide them -- otherwise a tightly
     * folded haunch (a sitting cat) paints a pale tube across the flank.
     */
    #legs(ctx, rig, pass) {
      const coat = this.coat;
      const s = rig.scale;
      const tuck = rig.pose.legMode === 'tuck';
      const behind = pass === 'behind';

      for (const leg of rig.legs) {
        const near = leg.near;
        // Far legs are entirely behind the torso; near legs are split.
        if (!near && !behind) continue;
        const fx = leg.drawFootX == null ? leg.footX : leg.drawFootX;
        const fy = leg.drawFootY == null ? leg.footY : leg.drawFootY;

        ctx.save();
        if (!near) {
          ctx.globalAlpha = 0.9;
          ctx.filter = 'brightness(0.78)';
        }

        if (tuck) {
          // Only the paws show; they belong in the front pass.
          if (behind && near) { ctx.restore(); continue; }
          // Lying down: only the paws show, tucked under the chest.
          ctx.fillStyle = coat.light;
          ctx.beginPath();
          ctx.ellipse(fx, fy - 2.2 * s, 7.5 * s, 3.6 * s, 0, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = 'rgba(80,62,44,0.30)';
          ctx.lineWidth = 0.8 * s;
          for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.moveTo(fx + rig.dir * (4 + i * 2.2) * s, fy - 4.6 * s);
            ctx.lineTo(fx + rig.dir * (5.4 + i * 2.2) * s, fy - 1.4 * s);
            ctx.stroke();
          }
          ctx.restore();
          continue;
        }

        // A cat's limb tapers hard: a thick muscled upper, a thin wrist.
        const upperTop = (leg.front ? 9.0 : 11.0) * s;
        const upperEnd = (leg.front ? 5.6 : 6.4) * s;
        const lowerTop = (leg.front ? 5.2 : 5.8) * s;
        const lowerEnd = (leg.front ? 3.0 : 3.2) * s;

        if (behind) {
          this.#limb(ctx, leg.hipX, leg.hipY, leg.kneeX, leg.kneeY, upperTop, upperEnd, coat, 0);
        }
        if (!near || !behind) {
          this.#limb(ctx, leg.kneeX, leg.kneeY, fx, fy, lowerTop, lowerEnd, coat, 1);
        }
        if (near && behind) { ctx.restore(); continue; }

        // Paw.
        const pd = Math.atan2(fy - leg.kneeY, fx - leg.kneeX);
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(pd - Math.PI / 2);
        ctx.fillStyle = coat.light;
        ctx.beginPath();
        ctx.ellipse(0, -1.0 * s, 4.6 * s, 3.4 * s, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(70,54,38,0.28)';
        ctx.lineWidth = 0.7 * s;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 1.7 * s, -3.4 * s);
          ctx.lineTo(i * 2.1 * s, -0.4 * s);
          ctx.stroke();
        }
        ctx.restore();
        ctx.restore();
      }
    }

    #limb(ctx, ax, ay, bx, by, wa, wb, coat, seg) {
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1e-6;
      const nx = -dy / len, ny = dx / len;
      // A short, thick segment would have its bulge overshoot the endpoints and
      // fold into a visible spike, so cap it against the segment length.
      const bulge = Math.min((wa + wb) * 0.14, len * 0.20);
      ctx.beginPath();
      // Rounded cap at the top so the limb reads as a capsule, not a plank.
      ctx.arc(ax, ay, wa * 0.5, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false);
      ctx.quadraticCurveTo(
        (ax + bx) / 2 + nx * bulge,
        (ay + by) / 2 + ny * bulge,
        bx + nx * wb * 0.5,
        by + ny * wb * 0.5
      );
      ctx.arc(bx, by, wb * 0.5, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
      ctx.quadraticCurveTo(
        (ax + bx) / 2 - nx * bulge,
        (ay + by) / 2 - ny * bulge,
        ax - nx * wa * 0.5,
        ay - ny * wa * 0.5
      );
      ctx.closePath();
      // Light from above-front: bright along the leading edge, dark behind.
      const g = ctx.createLinearGradient(ax + nx * wa, ay + ny * wa, ax - nx * wa, ay - ny * wa);
      g.addColorStop(0, coat.light);
      g.addColorStop(0.42, coat.mid);
      g.addColorStop(1, seg ? coat.dark : coat.shadow);
      ctx.fillStyle = g;
      ctx.fill();
      // A faint contour keeps overlapping limbs from merging into one mass.
      ctx.strokeStyle = 'rgba(40,28,18,0.18)';
      ctx.lineWidth = 0.7 * (wa / 9);
      ctx.stroke();
    }

    #tail(ctx, rig, front) {
      if (!!rig.pose.tail.front !== front) return;
      const coat = this.coat;
      const s = rig.scale;
      const t = rig.tail;

      // Build both sides of a tapering tube.
      const left = [], right = [];
      for (let i = 0; i < t.length; i++) {
        const p = t[i];
        const q = t[Math.min(t.length - 1, i + 1)];
        const r = t[Math.max(0, i - 1)];
        let dx = q.x - r.x, dy = q.y - r.y;
        const d = Math.hypot(dx, dy) || 1;
        dx /= d; dy /= d;
        const f = i / (t.length - 1);
        // Thick at the base, a slight brush towards the tip.
        const w = lerp(3.4, 2.3, smoothstep(f)) * (1 + 0.18 * Math.sin(f * 3.1)) * s;
        left.push({ x: p.x - dy * w, y: p.y + dx * w, nx: -dy, ny: dx });
        right.push({ x: p.x + dy * w, y: p.y - dx * w, nx: dy, ny: -dx });
      }
      const outline = left.concat(right.reverse());

      ctx.save();
      ctx.beginPath();
      closedSpline(ctx, outline);
      const bb = { y0: Math.min(...t.map((p) => p.y)) - 8 * s, y1: Math.max(...t.map((p) => p.y)) + 8 * s };
      const g = ctx.createLinearGradient(0, bb.y0, 0, bb.y1);
      g.addColorStop(0, coat.light);
      g.addColorStop(0.5, coat.mid);
      g.addColorStop(1, coat.dark);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.clip();
      // Rings.
      ctx.strokeStyle = coat.stripe;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 2.4 * s;
      for (let i = 2; i < t.length - 1; i += 2) {
        const p = t[i], q = t[i + 1] || t[i];
        let dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        ctx.beginPath();
        ctx.moveTo(p.x - (-dy / d) * 5 * s, p.y - (dx / d) * 5 * s);
        ctx.lineTo(p.x + (-dy / d) * 5 * s, p.y + (dx / d) * 5 * s);
        ctx.stroke();
      }
      // Dark tip.
      const tip = t[t.length - 1];
      const tg = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 9 * s);
      tg.addColorStop(0, coat.stripe);
      tg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = tg;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 9 * s, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();

      furEdge(ctx, outline, rig, coat, { len: 2.2, width: 0.45, alpha: 0.85 });
    }

    #head(ctx, rig, mirror, squeeze) {
      const coat = this.coat;
      const s = rig.scale;
      const yaw = rig.headYaw;
      const frontality = clamp(Math.abs(yaw), 0, 1);
      // Turning back over the shoulder also swings the whole head round.
      const angle = rig.head.angle + yaw * -0.30 * mirror * mirror;
      const xf = makeXf(rig.head.x, rig.head.y, angle, s, mirror);
      const screenAngle = angle * mirror;

      // --- ears: far one first, behind the skull -------------------------
      this.#ear(ctx, rig, xf, screenAngle, frontality, mirror, false);

      // --- skull silhouette ---------------------------------------------
      const outline = [];
      for (let i = 0; i < HEAD_PROFILE.length; i++) {
        const p = headPoint(i, frontality);
        const w = xf(p.f, p.u);
        outline.push(w);
      }
      // Outward normals from the head centre, for fur.
      for (let i = 0; i < outline.length; i++) {
        const p = outline[i];
        let nx = p.x - rig.head.x, ny = p.y - rig.head.y;
        const d = Math.hypot(nx, ny) || 1;
        p.nx = nx / d; p.ny = ny / d;
      }

      ctx.save();
      ctx.beginPath();
      closedSpline(ctx, outline);
      const top = xf(0, 11), bottom = xf(0, -9);
      const g = ctx.createLinearGradient(top.x, top.y, bottom.x, bottom.y);
      g.addColorStop(0, coat.light);
      g.addColorStop(0.45, coat.mid);
      g.addColorStop(1, coat.dark);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.clip();

      // Muzzle and chin are paler.
      const muz = xf(lerp(10.5, 0.5, frontality), -2.2);
      const mg = ctx.createRadialGradient(muz.x, muz.y, 0.5 * s, muz.x, muz.y, 9.5 * s);
      mg.addColorStop(0, coat.belly);
      mg.addColorStop(0.7, coat.belly);
      mg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(muz.x, muz.y, 10 * s, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Forehead tabby "M".
      ctx.strokeStyle = coat.stripe;
      ctx.globalAlpha = 0.26;
      ctx.lineWidth = 1.7 * s;
      for (let i = -1; i <= 1; i++) {
        const a = xf(1.5 + i * 2.4 * lerp(0.4, 1, frontality), 10.4);
        const b2 = xf(4.6 + i * 2.0 * lerp(0.4, 1, frontality), 5.2);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Cheek shadow behind the muzzle.
      const cheek = xf(lerp(3.0, 0.0, frontality), -4.5);
      const cg = ctx.createRadialGradient(cheek.x, cheek.y, 0, cheek.x, cheek.y, 11 * s);
      cg.addColorStop(0, 'rgba(40,28,18,0.22)');
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cheek.x, cheek.y, 11 * s, 0, TAU);
      ctx.fill();
      ctx.restore();

      furEdge(ctx, outline, rig, coat, { len: 2.3, width: 0.5 });

      // --- eyes ----------------------------------------------------------
      const farAlpha = smoothstep((frontality - 0.10) / 0.40);
      if (farAlpha > 0.01) {
        ctx.globalAlpha = farAlpha;
        this.#eye(ctx, rig, xf, screenAngle, mirror, frontality, true);
        ctx.globalAlpha = 1;
      }
      this.#eye(ctx, rig, xf, screenAngle, mirror, frontality, false);

      // --- nose, mouth, whiskers ----------------------------------------
      this.#face(ctx, rig, xf, screenAngle, mirror, frontality);

      // --- near ear, in front of the skull ------------------------------
      this.#ear(ctx, rig, xf, screenAngle, frontality, mirror, true);
    }

    #ear(ctx, rig, xf, screenAngle, frontality, mirror, near) {
      const coat = this.coat;
      const s = rig.scale;
      const idx = near ? 0 : 1;
      const fold = rig.earFold;
      const twitch = rig.earTwitch[idx];

      // Base slides forward and apart as the head turns towards us.
      const bf = near ? lerp(-2.0, 5.0, frontality) : lerp(-6.2, -5.2, frontality);
      const bu = near ? lerp(8.4, 9.0, frontality) : lerp(9.4, 9.0, frontality);

      // Ear axis: straight up when alert, swivelled back and flattened when not.
      const ea = fold * 1.15 + twitch * 0.45 * (near ? 1 : -1);
      const h = lerp(11.2, 7.2, fold) * (near ? 1 : 0.94);
      const w = 5.7 * (near ? 1 : 0.92);
      const ax = -Math.sin(ea), au = Math.cos(ea);   // axis (forward, up)
      const px = Math.cos(ea), pu = Math.sin(ea);    // perpendicular

      const L = (df, du) => xf(bf + df, bu + du);
      const baseBack = L(-px * w, -pu * w);
      const baseFront = L(px * w, pu * w);
      const tip = L(ax * h, au * h);
      const cBack = L(-px * w * 0.85 + ax * h * 0.7, -pu * w * 0.85 + au * h * 0.7);
      const cFront = L(px * w * 0.75 + ax * h * 0.62, pu * w * 0.75 + au * h * 0.62);

      ctx.save();
      if (!near) ctx.filter = 'brightness(0.78)';
      ctx.beginPath();
      ctx.moveTo(baseBack.x, baseBack.y);
      ctx.quadraticCurveTo(cBack.x, cBack.y, tip.x, tip.y);
      ctx.quadraticCurveTo(cFront.x, cFront.y, baseFront.x, baseFront.y);
      ctx.quadraticCurveTo(L(0, -2.5).x, L(0, -2.5).y, baseBack.x, baseBack.y);
      ctx.closePath();
      const base = L(0, 0);
      const g = ctx.createLinearGradient(tip.x, tip.y, base.x, base.y);
      g.addColorStop(0, coat.dark);
      g.addColorStop(0.55, coat.mid);
      g.addColorStop(1, coat.light);
      ctx.fillStyle = g;
      ctx.fill();

      // Inner ear: the near one faces us in profile, the far one only when the
      // head has turned enough to show its inside.
      const innerVis = near
        ? clamp(1 - fold * 1.4, 0, 1)
        : clamp((frontality - 0.35) * 1.8 - fold, 0, 1);
      if (innerVis > 0.02) {
        ctx.save();
        ctx.clip();
        const iTip = L(ax * h * 0.72, au * h * 0.72);
        const ig = ctx.createLinearGradient(iTip.x, iTip.y, base.x, base.y);
        ig.addColorStop(0, 'rgba(0,0,0,0)');
        ig.addColorStop(0.35, coat.innerEar);
        ig.addColorStop(1, coat.pad);
        ctx.globalAlpha = 0.55 * innerVis;
        ctx.fillStyle = ig;
        ctx.beginPath();
        ctx.moveTo(L(-px * w * 0.5, -pu * w * 0.5).x, L(-px * w * 0.5, -pu * w * 0.5).y);
        ctx.quadraticCurveTo(
          L(-px * w * 0.3 + ax * h * 0.6, -pu * w * 0.3 + au * h * 0.6).x,
          L(-px * w * 0.3 + ax * h * 0.6, -pu * w * 0.3 + au * h * 0.6).y,
          iTip.x, iTip.y
        );
        ctx.quadraticCurveTo(
          L(px * w * 0.45 + ax * h * 0.4, pu * w * 0.45 + au * h * 0.4).x,
          L(px * w * 0.45 + ax * h * 0.4, pu * w * 0.45 + au * h * 0.4).y,
          L(px * w * 0.55, pu * w * 0.55).x, L(px * w * 0.55, pu * w * 0.55).y
        );
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Ear furnishings: the wisps of fur inside the front edge.
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = coat.furTip;
      ctx.lineWidth = 0.55 * s;
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const t = 0.15 + i * 0.2;
        const from = L(px * w * 0.55 + ax * h * t, pu * w * 0.55 + au * h * t);
        const to = L(px * w * 0.1 + ax * h * (t + 0.22), pu * w * 0.1 + au * h * (t + 0.22));
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    #eye(ctx, rig, xf, screenAngle, mirror, frontality, far) {
      const coat = this.coat;
      const s = rig.scale;
      // A real cat's eye is ~2cm across on a 9cm-wide head. Enlarging it a
      // little keeps it readable at desktop-pet size; enlarging it a lot turns
      // the frontal view into a pair of goggles.
      const ef = far
        ? lerp(2.0, -3.8, frontality)
        : lerp(6.6, 4.2, frontality);
      const eu = lerp(3.3, 3.7, frontality);
      const c = xf(ef, eu);

      const openness = clamp(rig.eyeLid == null ? rig.eyeOpen : rig.eyeLid, 0, 1);
      const wScale = far ? lerp(0.4, 1, frontality) : lerp(1, 1.05, frontality);
      const rx = 2.9 * s * wScale;
      const ry = 2.4 * s * clamp(openness, 0.02, 1);

      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(screenAngle);

      // Socket shadow.
      ctx.fillStyle = 'rgba(40,28,18,0.20)';
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * 1.25, Math.max(ry, 1.2 * s) * 1.3, 0, 0, TAU);
      ctx.fill();

      if (openness > 0.06) {
        // Almond eye opening.
        ctx.beginPath();
        ctx.moveTo(-rx, 0);
        ctx.quadraticCurveTo(-rx * 0.35, -ry * 1.45, rx * 0.85, -ry * 0.5);
        ctx.quadraticCurveTo(rx * 0.4, ry * 1.35, -rx, 0);
        ctx.closePath();
        ctx.save();
        ctx.clip();

        // Iris.
        const ig = ctx.createRadialGradient(-rx * 0.15, -ry * 0.2, 0.4 * s, 0, 0, rx * 1.15);
        ig.addColorStop(0, coat.iris);
        ig.addColorStop(0.62, coat.iris);
        ig.addColorStop(1, coat.irisEdge);
        ctx.fillStyle = ig;
        ctx.fillRect(-rx * 1.5, -ry * 2, rx * 3, ry * 4);

        // Slit pupil, tracking a little towards whatever it is watching.
        const look = clamp((rig.lookX - rig.head.x) / (120 * s), -1, 1) * mirror;
        const pupilW = lerp(0.28, 1.9, clamp(rig.pupil, 0, 1)) * s;
        ctx.fillStyle = '#120f0d';
        ctx.beginPath();
        ctx.ellipse(look * rx * 0.28, 0, pupilW, ry * 1.25, 0, 0, TAU);
        ctx.fill();

        // Wet specular.
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.ellipse(-rx * 0.42, -ry * 0.45, 0.95 * s, 0.72 * s, -0.4, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.ellipse(rx * 0.35, ry * 0.35, 0.6 * s, 0.45 * s, 0, 0, TAU);
        ctx.fill();
        ctx.restore();

        // Lid line.
        ctx.strokeStyle = 'rgba(26,18,12,0.75)';
        ctx.lineWidth = 0.85 * s;
        ctx.beginPath();
        ctx.moveTo(-rx, 0);
        ctx.quadraticCurveTo(-rx * 0.35, -ry * 1.45, rx * 0.85, -ry * 0.5);
        ctx.stroke();
      } else {
        // Closed: a soft crease.
        ctx.strokeStyle = 'rgba(40,28,18,0.7)';
        ctx.lineWidth = 1.0 * s;
        ctx.beginPath();
        ctx.moveTo(-rx, 0);
        ctx.quadraticCurveTo(0, ry * 1.6 + 0.9 * s, rx, -0.3 * s);
        ctx.stroke();
      }
      ctx.restore();
    }

    #face(ctx, rig, xf, screenAngle, mirror, frontality) {
      const coat = this.coat;
      const s = rig.scale;
      // Fully turned towards us the nose has to sit between the two eyes
      // (which land at f = +4.2 and -3.8), not out on the near cheek.
      const noseF = lerp(12.3, 0.4, frontality);
      const noseU = lerp(0.9, 1.4, frontality);
      const n = xf(noseF, noseU);

      // Nose leather.
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.rotate(screenAngle);
      ctx.fillStyle = coat.nose;
      ctx.beginPath();
      ctx.moveTo(-1.9 * s, -0.9 * s);
      ctx.quadraticCurveTo(0, -1.9 * s, 1.9 * s, -0.7 * s);
      ctx.quadraticCurveTo(1.4 * s, 1.5 * s, 0, 1.9 * s);
      ctx.quadraticCurveTo(-1.5 * s, 1.4 * s, -1.9 * s, -0.9 * s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(60,30,30,0.5)';
      ctx.beginPath();
      ctx.ellipse(-0.9 * s, 0.2 * s, 0.42 * s, 0.28 * s, 0.3, 0, TAU);
      ctx.ellipse(0.9 * s, 0.2 * s, 0.42 * s, 0.28 * s, -0.3, 0, TAU);
      ctx.fill();

      // Mouth: the little cat "w" under the nose.
      ctx.strokeStyle = 'rgba(60,42,30,0.55)';
      ctx.lineWidth = 0.8 * s;
      ctx.beginPath();
      ctx.moveTo(0, 2.0 * s);
      ctx.lineTo(0, 3.1 * s);
      ctx.stroke();
      const open = rig.mouthOpen;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 3.1 * s);
        ctx.quadraticCurveTo(side * 1.6 * s, (3.4 + open * 1.4) * s, side * 3.0 * s, (2.6 + open * 1.2) * s);
        ctx.stroke();
      }
      if (open > 0.15) {
        ctx.fillStyle = 'rgba(90,40,45,0.75)';
        ctx.beginPath();
        ctx.ellipse(0, (3.9 + open * 1.0) * s, 2.1 * s * open, 1.7 * s * open, 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();

      // Whisker pads. `side` +1 is the pad on the near cheek, -1 the far one,
      // which only comes into view once the head has turned towards us.
      const padF = lerp(9.4, 0.6, frontality);
      for (const side of [-1, 1]) {
        const sideVis = side > 0 ? 1 : smoothstep((frontality - 0.05) / 0.5) * 0.85;
        if (sideVis < 0.03) continue;

        // In profile both pads point forward (we just see one of them); turned
        // towards us they have to fan to opposite sides of the muzzle.
        const fanDir = lerp(1, side, frontality);
        const padOff = side * lerp(0, 3.0, frontality);

        const root = xf(padF + padOff, -1.2);
        ctx.save();
        ctx.globalAlpha = 0.28 * sideVis;
        ctx.fillStyle = coat.belly;
        ctx.beginPath();
        ctx.ellipse(root.x, root.y, 3.2 * s, 2.4 * s, screenAngle, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.strokeStyle = coat.whisker;
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.72 * sideVis;
        // Four whiskers per pad, fanning from slightly-up to well-down, each
        // drooping under its own weight. All in head-local space, so they
        // rotate and mirror with the head for free.
        for (let i = 0; i < 4; i++) {
          const t = i / 3;
          const sway = noise(rig.t * 1.2 + i * 0.7, 3 + side * 2) * 0.06 +
            Math.min(0.12, rig.speed * 0.0012);
          // Elevation above/below the muzzle axis, in local radians.
          const a = lerp(0.28, -0.44, t) + sway;
          const len = (14.5 - t * 2.5) * (0.8 + frontality * 0.2) *
            (side > 0 ? 1 : 0.92);
          const fromU = -0.6 + i * 0.5;
          const fromF = padF + padOff - i * 0.3 * fanDir;
          const p0 = xf(fromF, fromU);
          const p1 = xf(
            fromF + Math.cos(a) * len * 0.5 * fanDir,
            fromU + Math.sin(a) * len * 0.5
          );
          // Droop grows with length: real whiskers sag towards the tip.
          const p2 = xf(
            fromF + Math.cos(a) * len * fanDir,
            fromU + Math.sin(a) * len - len * 0.16
          );
          ctx.lineWidth = (0.55 - t * 0.10) * s;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      // Brow whiskers: short, springing up and forward over the eye.
      ctx.save();
      ctx.strokeStyle = coat.whisker;
      ctx.globalAlpha = 0.45;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const fromF = lerp(6.2, 3.6, frontality) + i * 1.0;
        const fromU = 7.0 + i * 0.4;
        const a = 0.85 - i * 0.22;
        const len = 8.5 - i * 0.8;
        const p0 = xf(fromF, fromU);
        const p1 = xf(fromF + Math.cos(a) * len * 0.5, fromU + Math.sin(a) * len * 0.55);
        const p2 = xf(fromF + Math.cos(a) * len, fromU + Math.sin(a) * len - len * 0.1);
        ctx.lineWidth = 0.5 * s;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    #debug(ctx, rig) {
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#0ff';
      ctx.beginPath();
      for (let i = 0; i < rig.spine.length; i++) {
        const n = rig.spine[i];
        if (i === 0) ctx.moveTo(n.x, n.y);
        else ctx.lineTo(n.x, n.y);
      }
      ctx.lineTo(rig.head.x, rig.head.y);
      ctx.stroke();
      ctx.strokeStyle = '#f0f';
      ctx.beginPath();
      for (let i = 0; i < rig.tail.length; i++) {
        const n = rig.tail[i];
        if (i === 0) ctx.moveTo(n.x, n.y);
        else ctx.lineTo(n.x, n.y);
      }
      ctx.stroke();
      ctx.strokeStyle = '#ff0';
      for (const l of rig.legs) {
        ctx.beginPath();
        ctx.moveTo(l.hipX, l.hipY);
        ctx.lineTo(l.kneeX, l.kneeY);
        ctx.lineTo(l.drawFootX || l.footX, l.drawFootY || l.footY);
        ctx.stroke();
      }
      const b = rig.bounds();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------- props ----

  /** A food bowl, drawn on the ground. */
  function drawBowl(ctx, x, y, scale, fill) {
    const s = scale;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y + 1 * s, 20 * s, 6 * s, 0, 0, TAU);
    ctx.fillStyle = 'rgba(10,8,12,0.25)';
    ctx.fill();

    // Bowl body.
    ctx.beginPath();
    ctx.moveTo(x - 17 * s, y - 8 * s);
    ctx.quadraticCurveTo(x - 15 * s, y + 4 * s, x, y + 4.5 * s);
    ctx.quadraticCurveTo(x + 15 * s, y + 4 * s, x + 17 * s, y - 8 * s);
    ctx.closePath();
    const g = ctx.createLinearGradient(x, y - 8 * s, x, y + 5 * s);
    g.addColorStop(0, '#8fa6c4');
    g.addColorStop(1, '#43536b');
    ctx.fillStyle = g;
    ctx.fill();

    // Rim.
    ctx.beginPath();
    ctx.ellipse(x, y - 8 * s, 17 * s, 5 * s, 0, 0, TAU);
    ctx.fillStyle = '#2f3b4d';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y - 8 * s, 14.5 * s, 3.8 * s, 0, 0, TAU);
    ctx.fillStyle = '#1b2430';
    ctx.fill();

    // Kibble, shrinking as it gets eaten.
    if (fill > 0.02) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y - 8 * s, 14 * s, 3.6 * s, 0, 0, TAU);
      ctx.clip();
      for (let i = 0; i < 26; i++) {
        const a = i * 2.399;
        const r = Math.sqrt((i + 1) / 26) * 13 * s * (0.35 + 0.65 * fill);
        const px = x + Math.cos(a) * r;
        const py = y - 8 * s + Math.sin(a) * r * 0.28 - fill * 1.5 * s;
        ctx.fillStyle = i % 3 === 0 ? '#7b4f2c' : '#96633a';
        ctx.beginPath();
        ctx.ellipse(px, py, 1.7 * s, 1.3 * s, a, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  global.CatArt = { CatArt, COATS, drawBowl, buildBody, closedSpline };
})(typeof window !== 'undefined' ? window : globalThis);
