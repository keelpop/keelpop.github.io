/*
 * app.js — the overlay's render loop.
 *
 * Owns the canvas, feeds sensors to the brain, draws the cat and its props, and
 * reports back to the main process. Runs standalone too: if `window.catAPI` is
 * missing (the dev sandbox in a browser), it synthesises sensors from real
 * pointer events so the whole thing can be developed without Electron.
 */
'use strict';

(function () {
  const canvas = document.getElementById('cat');
  const ctx = canvas.getContext('2d');
  const hud = document.getElementById('hud');

  const rig = new CatRig.Rig({ x: 300, y: 500, scale: 0.95 });
  const art = new CatArt.CatArt({ coat: 'brownTabby' });
  const brain = new CatBrain.CatBrain(rig);

  let dpr = 1;
  let cssW = 0;
  let cssH = 0;
  let debug = false;

  let sensors = {
    cursorX: 300,
    cursorY: 300,
    cursorOnStage: true,
    typing: false,
    dragging: false,
    idleSec: 0,
    stage: { x0: 0, y0: 0, x1: 1280, y1: 800 },
    occluders: [],
  };

  // --------------------------------------------------------------- canvas --

  function resize() {
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    // Cap the device ratio: a full-screen canvas at 3x costs more than it looks.
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  brain.setStage({ x0: 0, y0: 0, x1: cssW, y1: cssH });
  rig.x = cssW * 0.35;
  rig.y = cssH - 90;
  rig.snapToPose();

  // ------------------------------------------------------------- plumbing --

  function applyConfig(cfg) {
    if (!cfg) return;
    if (cfg.coat) art.setCoat(cfg.coat);
    if (cfg.scale) rig.scale = cfg.scale;
    if (typeof cfg.debug === 'boolean') {
      debug = cfg.debug;
      hud.style.display = debug ? 'block' : 'none';
    }
    if (typeof cfg.skeleton === 'boolean') art.debug = cfg.skeleton;
    for (const k of ['hunger', 'energy', 'affection']) {
      if (typeof cfg[k] === 'number') brain.needs[k] = cfg[k];
    }
  }

  function applyCommand(cmd) {
    if (!cmd) return;
    switch (cmd.kind) {
      case 'feed':
        brain.feed(cmd.x, cmd.y);
        break;
      case 'come':
      case 'play':
      case 'sleep':
      case 'hide':
        brain.poke(cmd.kind);
        break;
      case 'enterFrom': {
        // The overlay just jumped to another monitor: walk in from the edge
        // nearest the display we came from, rather than teleporting mid-screen.
        const st = brain.stage;
        rig.x = cmd.side === 'left' ? st.x0 - 40 * rig.scale : st.x1 + 40 * rig.scale;
        rig.y = st.y1 - 90;
        rig.snapToPose();
        brain.poke('come');
        break;
      }
      default:
        break;
    }
  }

  if (window.catAPI) {
    window.catAPI.onSensors((data) => { sensors = data; });
    window.catAPI.onConfig(applyConfig);
    window.catAPI.onCommand(applyCommand);
  } else {
    // Browser sandbox: drive the same inputs from real DOM events.
    document.body.style.pointerEvents = 'auto';
    let lastMove = 0;
    let down = false;
    window.addEventListener('pointermove', (e) => {
      sensors.cursorX = e.clientX;
      sensors.cursorY = e.clientY;
      lastMove = performance.now();
      sensors.idleSec = 0;
    });
    window.addEventListener('pointerdown', () => { down = true; });
    window.addEventListener('pointerup', () => { down = false; });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'f') brain.feed(sensors.cursorX, sensors.cursorY + 20);
      if (e.key === 'c') brain.poke('come');
      if (e.key === 'p') brain.poke('play');
      if (e.key === 's') brain.poke('sleep');
      if (e.key === 'h') brain.poke('hide');
      if (e.key === 'd') { debug = !debug; hud.style.display = debug ? 'block' : 'none'; }
      if (e.key === 'k') art.debug = !art.debug;
      if (e.key === 't') sensors.typing = !sensors.typing;
    });
    setInterval(() => {
      sensors.dragging = down;
      sensors.stage = { x0: 0, y0: 0, x1: window.innerWidth, y1: window.innerHeight };
      if (performance.now() - lastMove > 1000) sensors.idleSec += 1;
    }, 250);
    window.__catSandbox = { rig, art, brain, get sensors() { return sensors; } };
  }

  // ------------------------------------------------------------ rendering --

  function drawEffects() {
    const s = rig.scale;
    for (const e of brain.effects) {
      const k = e.t / e.life;
      ctx.save();
      if (e.kind === 'swat') {
        // A quick arc where the paw connected.
        ctx.globalAlpha = (1 - k) * 0.85;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.8 * s;
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const r = (10 + i * 5 + k * 14) * s;
          const a0 = -0.9 + i * 0.18;
          ctx.beginPath();
          ctx.arc(e.x, e.y, r, a0, a0 + 1.1);
          ctx.stroke();
        }
      } else if (e.kind === 'dust') {
        ctx.globalAlpha = (1 - k) * 0.35;
        ctx.fillStyle = 'rgba(220,214,204,1)';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + 0.4;
          const r = (6 + k * 34) * s;
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(a) * r, e.y - Math.abs(Math.sin(a)) * r * 0.35,
            (3.5 - k * 2.5) * s, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  /**
   * Fake being behind a window: erase the overlapping region. The canvas is
   * transparent, so clearing it reveals whatever is actually underneath -- the
   * real window -- and the cat reads as hidden behind it.
   */
  function occlude() {
    const list = sensors.occluders || [];
    for (const o of list) {
      const w = o.x1 - o.x0;
      const h = o.y1 - o.y0;
      if (w <= 0 || h <= 0) continue;
      ctx.clearRect(o.x0, o.y0, w, h);
    }
  }

  let last = performance.now();
  let reportAt = 0;

  function frame(now) {
    const dt = Math.min(1 / 20, Math.max(1e-4, (now - last) / 1000));
    last = now;

    const st = sensors.stage || { x0: 0, y0: 0, x1: cssW, y1: cssH };
    if (st.x1 !== brain.stage.x1 || st.y1 !== brain.stage.y1) brain.setStage(st);
    brain.setOccluders(sensors.occluders || []);

    brain.update(dt, sensors);
    rig.update(dt);

    ctx.clearRect(0, 0, cssW, cssH);

    if (brain.food) {
      CatArt.drawBowl(ctx, brain.food.x, brain.food.y, rig.scale, brain.food.fill);
    }
    art.draw(ctx, rig, rig.y);
    drawEffects();

    // Only pretend to be behind the window while it is deliberately lurking;
    // when it comes to sit on your work it belongs in front.
    const lurking = brain.state === 'hidden' || brain.state === 'peek' ||
      brain.state === 'goHide';
    if (lurking) occlude();

    if (debug) {
      const n = brain.needs;
      hud.textContent =
        `state   ${brain.state}  (${brain.stateT.toFixed(1)}/${brain.stateDur.toFixed(1)}s)\n` +
        `note    ${brain.note}\n` +
        `hunger  ${n.hunger.toFixed(2)}   energy ${n.energy.toFixed(2)}\n` +
        `bored   ${n.boredom.toFixed(2)}   love   ${n.affection.toFixed(2)}\n` +
        `pet     lvl ${brain.pet.level.toFixed(2)} act ${brain.pet.active.toFixed(2)} cd ${brain.pet.cooldown.toFixed(0)}\n` +
        `calm    ${brain.calmT.toFixed(0)}s  mischief ${brain.mischiefCooldown.toFixed(0)}s  hide ${brain.hideCooldown.toFixed(0)}s\n` +
        `typing  ${sensors.typing} (${brain.typingT.toFixed(1)}s)  drag ${sensors.dragging} (${brain.dragT.toFixed(1)}s)\n` +
        `idle    ${sensors.idleSec}s  occluders ${(sensors.occluders || []).length}\n` +
        `pos     ${rig.x.toFixed(0)},${rig.y.toFixed(0)}  dir ${rig.dir.toFixed(2)}  onTop ${brain.wantsOnTop}`;
    }

    if (window.catAPI && now - reportAt > 500) {
      reportAt = now;
      window.catAPI.report({
        wantsOnTop: brain.wantsOnTop,
        note: brain.note,
        state: brain.state,
        needs: {
          hunger: brain.needs.hunger,
          energy: brain.needs.energy,
          affection: brain.needs.affection,
        },
      });
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
