/* ============================================================
   息を殺して — Breathless
   音を投げて暗闇を測り、鼓動を殺して化け物をやり過ごす
   ============================================================ */

(function () {
  'use strict';

  /* ---------------- 定数 ---------------- */

  var TILE = 32;              // 1マスの内部解像度(px)
  var SCALE = TILE / 24;      // 線や点の太さをTILEに追従させる
  var VIEW_TILES = 9.5;       // 画面の短辺に収まるマス数（縦持ちでは横9.5マス）
  var DT = 1 / 60;
  var MAXR = 5000;            // 音の粒子の最大数

  var WALK_SPD = 2.45;        // マス/秒
  var RUN_SPD = 4.30;
  var HOLD_SPD_MUL = 0.55;    // 息を止めている間の減速
  var RUN_THRESHOLD = 0.62;
  var PLAYER_R = 0.30;
  var DEATH_DIST = 0.52;

  var CLICK_COOL = 1.15;      // 舌打ち
  var CALL_COOL = 6.5;        // 呼ぶ
  var BREATH_DRAIN = 0.145;   // 息の消費 (毎秒)
  var BREATH_REFILL = 0.19;
  var GASP_LOCK = 1.6;        // 喘いだあと息を止められない時間

  /* 音の種類ごとのパラメータ
     n:粒子数 spd:速さ life:寿命 hear:化け物に聞こえる距離 */
  var SND = {
    walk:  { n: 26,  spd: 8.5,  life: 1.00, hear: 4.5 },
    run:   { n: 40,  spd: 9.5,  life: 1.60, hear: 11.0 },
    water: { n: 52,  spd: 9.5,  life: 1.90, hear: 14.0 },
    click: { n: 38,  spd: 12.0, life: 2.50, hear: 3.2 },
    call:  { n: 112, spd: 11.0, life: 3.00, hear: 20.0 },
    gasp:  { n: 60,  spd: 9.5,  life: 1.60, hear: 10.0 },
    open:  { n: 54,  spd: 9.0,  life: 1.70, hear: 0 },
    beast: { n: 16,  spd: 8.0,  life: 0.90, hear: 0 },
    sleep: { n: 10,  spd: 5.0,  life: 0.75, hear: 0 },
    goal:  { n: 22,  spd: 7.0,  life: 0.95, hear: 0 }
  };

  var CLICK_ARC = 0.55;       // 舌打ちの広がり(rad)

  /* 波の種類 */
  var T_SELF = 0, T_BEAST = 1, T_GOAL = 2, T_HEART = 3;
  /* 0=標準 / 1=色覚対応（青・黄・白 ― 赤緑や第2色覚でも見分けられる組み合わせ） */
  var PALETTES = [
    [[150, 230, 255], [255, 110, 45], [120, 255, 170], [185, 135, 255]],
    [[ 90, 190, 255], [255, 190, 20], [255, 255, 255], [190, 160, 255]]
  ];
  var ETCH_COLORS = ['rgba(96,168,196,', 'rgba(112,150,190,'];
  var COLORS = PALETTES[0];
  /* 記憶の地図に刻むのは自分の探査音と目印だけ。化け物と鼓動は残らない */
  var ETCHES = [true, false, true, false];
  /* 鼓動は「体から漏れた音」なので、探査音より控えめに描く */
  var BRIGHT = [1, 1, 1, 0.5];
  var ETCH_COLOR = ETCH_COLORS[0];
  var BR = 1;                 // 明るさ倍率（設定から）

  var SET_KEY = 'breathless_settings_v1';
  var settings = {
    bright: 100, palette: 0,
    danger: true, checkpoint: true, grab: true, vibe: true
  };

  var CHECK_SAFE_DIST = 7;    // この距離に化け物がいなければ安全とみなす
  var GRAB_TIME = 0.95;       // 振りほどきの猶予(秒)
  var GRAB_NEED = 230;        // 振りほどきに必要な指の移動量(CSS px)
  var RESPAWN_GRACE = 2.2;    // 復帰直後の無敵時間

  var BOUNCE_COST = 0.22;
  var STORE_KEY = 'breathless_progress_v1';

  /* ---------------- DOM ---------------- */

  var cv = document.getElementById('game');
  var ctx = cv.getContext('2d');
  var $ = function (id) { return document.getElementById(id); };

  var elHud = $('hud'), elLevelName = $('levelName'), elRelic = $('relicInfo');
  var elClickFill = $('clickFill'), elFlash = $('flash'), elHint = $('hint');
  var elBreath = $('breathBar'), elHeartDot = $('heartDot');
  var elCallBtn = $('callBtn'), elHoldBtn = $('holdBtn');
  var elDeath = $('deathCount'), elGrabWrap = $('grabWrap'), elGrabBar = $('grabBar');
  var hintTimer = null, beatTimer = null;

  var screens = {
    title: $('titleScreen'), select: $('selectScreen'), howto: $('howtoScreen'),
    pause: $('pauseScreen'), dead: $('deadScreen'), clear: $('clearScreen'),
    settings: $('settingsScreen')
  };

  /* ---------------- 状態 ---------------- */

  var mode = 'title';
  var levelIdx = 0;
  var unlocked = 1;

  var W = 0, H = 0;
  var solid = null, water = null;
  var exitPos = { x: 0, y: 0 };
  var relics = [], beasts = [], relicsLeft = 0;

  var player = {
    x: 0, y: 0, dx: 0, dy: -1,
    stepAcc: 0, crumbAcc: 0, alive: true
  };

  /* 体の状態 ― この3つがこのゲームの心臓部 */
  var fear = 0;               // 0..1  近くに化け物がいるほど、走るほど上がる
  var breath = 1;             // 0..1  息を止めていると減る
  var holding = false;        // 息を止めているか
  var gaspLock = 0;
  var heartT = 0;

  var clickCd = 0, callCd = 0;
  var goalT = 0, relicT = 0, growlT = 0, flowT = 0;
  var deathCause = '', elapsed = 0;
  var lastFlowOk = false;

  /* 死んで最初からやり直す苦行をなくすための復帰点 */
  var cp = { x: 0, y: 0 };
  var cpT = 0, deaths = 0, grace = 0;

  /* 掴まれた状態 ― 即死ではなく、振りほどく猶予を挟む */
  var grab = { on: false, t: 0, got: 0, beast: null };

  /* 音の粒子 */
  var pX = new Float32Array(MAXR), pY = new Float32Array(MAXR);
  var pVX = new Float32Array(MAXR), pVY = new Float32Array(MAXR);
  var pLife = new Float32Array(MAXR), pMax = new Float32Array(MAXR);
  var pType = new Uint8Array(MAXR);
  var pHead = 0;

  /* 波面を「点」で描くためのバッファ（種類4 × 明るさ3段） */
  var BUCKETS = 3;
  var dotBuf = [], dotLen = [];
  for (var i = 0; i < 4 * BUCKETS; i++) {
    dotBuf.push(new Float32Array(MAXR * 6));
    dotLen.push(0);
  }

  /* 壁に当たった瞬間の面（壁沿いの短い線分）*/
  var markBuf = [], markLen = [];
  for (var j = 0; j < 4; j++) { markBuf.push(new Float32Array(6000)); markLen.push(0); }

  /* 2枚重ね：mem = 刻まれた記憶の地図 / live = いま鳴っている音 */
  var mem = document.createElement('canvas'), mctx = mem.getContext('2d');
  var live = document.createElement('canvas'), lctx = live.getContext('2d');
  var memFadeT = 0;

  /* 周辺減光と危険グローは毎フレーム作ると重いので焼いておく */
  var vig = document.createElement('canvas'), vctx = vig.getContext('2d');
  var vigKey = '';
  var dang = document.createElement('canvas'), dctx = dang.getContext('2d');
  var dangerKey = '';

  /* いま画面に映っている世界座標の矩形。live の更新はここだけに絞る */
  var view = { x: 0, y: 0, w: 0, h: 0 };
  var prevView = null;

  var flow = null, flowQ = null;

  /* ---------------- 便利関数 ---------------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function isSolid(x, y) {
    var tx = x | 0, ty = y | 0;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true;
    return solid[ty * W + tx] === 1;
  }

  function isWater(x, y) {
    var tx = x | 0, ty = y | 0;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
    return water[ty * W + tx] === 1;
  }

  function show(name) {
    for (var k in screens) screens[k].classList.add('hidden');
    if (screens[name]) screens[name].classList.remove('hidden');
  }

  function loadProgress() {
    try {
      var v = parseInt(localStorage.getItem(STORE_KEY), 10);
      unlocked = (isFinite(v) && v > 0) ? Math.min(v, LEVELS.length) : 1;
    } catch (e) { unlocked = 1; }
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SET_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        for (var k in settings) if (o[k] !== undefined) settings[k] = o[k];
      }
    } catch (e) {}
    applySettings();
  }

  function saveSettings() {
    try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) {}
    applySettings();
  }

  function applySettings() {
    BR = settings.bright / 100;
    COLORS = PALETTES[settings.palette] || PALETTES[0];
    ETCH_COLOR = ETCH_COLORS[settings.palette] || ETCH_COLORS[0];
    vigKey = '';        // 明るさが変わるので焼き直す
    dangerKey = '';
  }

  function saveProgress() {
    try { localStorage.setItem(STORE_KEY, String(unlocked)); } catch (e) {}
  }

  function vibrate(p) {
    if (!settings.vibe) return;
    if (navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} }
  }

  function panOf(x) { return clamp((x - player.x) / 9, -1, 1); }

  /* ---------------- ステージ読み込み ---------------- */

  function loadLevel(idx) {
    var L = LEVELS[idx];
    H = L.map.length;
    W = L.map[0].length;

    solid = new Uint8Array(W * H);
    water = new Uint8Array(W * H);
    relics = [];
    beasts = [];
    exitPos = { x: 1.5, y: 1.5 };

    for (var y = 0; y < H; y++) {
      var row = L.map[y];
      for (var x = 0; x < W; x++) {
        var c = row.charAt(x);
        var cx = x + 0.5, cy = y + 0.5;
        if (c === '#') { solid[y * W + x] = 1; continue; }
        if (c === '~') water[y * W + x] = 1;
        if (c === 'P') { player.x = cx; player.y = cy; }
        else if (c === 'E') { exitPos.x = cx; exitPos.y = cy; }
        else if (c === '*') relics.push({ x: cx, y: cy, got: false });
        else if (c === 'M' || c === 'S') {
          beasts.push({
            x: cx, y: cy, hx: cx, hy: cy,
            awake: c === 'M', alertT: 0,
            wdx: 0, wdy: 0, wanderT: 0,
            stepT: 0, pulseT: Math.random() * 2,
            listenT: 0, nextListen: 3 + Math.random() * 4,
            speed: c === 'M' ? 2.05 : 2.35
          });
        }
      }
    }

    relicsLeft = relics.length;
    player.dx = 0; player.dy = -1;
    player.stepAcc = 0; player.crumbAcc = 0;
    player.alive = true;

    fear = 0; breath = 1; gaspLock = 0; heartT = 0;
    cp.x = player.x; cp.y = player.y;
    cpT = 0; deaths = 0; grace = RESPAWN_GRACE;
    endGrab();
    setHolding(false);

    flow = new Int32Array(W * H);
    flowQ = new Int32Array(W * H);

    mem.width = live.width = W * TILE;
    mem.height = live.height = H * TILE;
    mctx.fillStyle = lctx.fillStyle = '#000';
    mctx.fillRect(0, 0, mem.width, mem.height);
    lctx.fillRect(0, 0, live.width, live.height);
    memFadeT = 0;

    prevView = null;
    for (var i = 0; i < MAXR; i++) pLife[i] = 0;

    clickCd = 0; callCd = 0; goalT = 1.2; relicT = 0.6;
    growlT = 0; flowT = 0; elapsed = 0;
    stick.active = false; stick.mx = 0; stick.my = 0; stick.pointerId = null;

    elLevelName.textContent = (idx + 1) + '. ' + L.name;
    updateRelicHud();
    updateDeathHud();

    elHint.textContent = L.hint;
    elHint.classList.add('on');
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { elHint.classList.remove('on'); }, 6000);

    /* 真っ暗なまま放り出さないよう、開始時だけ周囲を測る（化け物には聞こえない） */
    emit(player.x, player.y, SND.open, T_SELF);
  }

  function updateRelicHud() {
    if (relics.length === 0) { elRelic.textContent = ''; return; }
    elRelic.textContent = '遺物 ' + (relics.length - relicsLeft) + ' / ' + relics.length;
  }

  /* ---------------- 音の波 ---------------- */

  /* dirA/arc を渡すと、その方向へ細く飛ぶ（舌打ち用） */
  function emit(x, y, cfg, type, dirA, arc) {
    var n = cfg.n;
    var base = Math.random() * Math.PI * 2;
    for (var i = 0; i < n; i++) {
      var a = arc
        ? dirA - arc / 2 + arc * ((i + 0.5) / n) + (Math.random() - 0.5) * 0.02
        : base + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.05;
      var s = cfg.spd * (0.92 + Math.random() * 0.16);
      var k = pHead;
      pHead = (pHead + 1) % MAXR;
      pX[k] = x; pY[k] = y;
      pVX[k] = Math.cos(a) * s;
      pVY[k] = Math.sin(a) * s;
      pLife[k] = pMax[k] = cfg.life * (0.9 + Math.random() * 0.2);
      pType[k] = type;
    }
    if (cfg.hear > 0) alertBeasts(x, y, cfg.hear);
  }

  function alertBeasts(x, y, radius) {
    for (var i = 0; i < beasts.length; i++) {
      var b = beasts[i];
      var d = Math.hypot(b.x - x, b.y - y);
      if (d >= radius) continue;
      if (!b.awake) {
        b.awake = true;
        emit(b.x, b.y, SND.beast, T_BEAST);
        SFX.growl(0.9, panOf(b.x));
        vibrate([40, 60, 90]);
      }
      b.hx = x; b.hy = y;
      b.listenT = 0;
      /* 大きな音ほど長く執着する */
      b.alertT = Math.max(b.alertT, 2.0 + radius * 0.35 + (radius - d) * 0.25);
    }
  }

  function addDot(t, r, x, y) {
    var b = r > 0.66 ? 2 : (r > 0.33 ? 1 : 0);
    var bi = t * BUCKETS + b;
    var n = dotLen[bi], buf = dotBuf[bi];
    if (n + 2 > buf.length) return;
    buf[n] = x; buf[n + 1] = y;
    dotLen[bi] = n + 2;
  }

  function addMark(t, x1, y1, x2, y2) {
    var n = markLen[t], buf = markBuf[t];
    if (n + 4 > buf.length) return;
    buf[n] = x1; buf[n + 1] = y1; buf[n + 2] = x2; buf[n + 3] = y2;
    markLen[t] = n + 4;
  }

  function clearBatches() {
    for (var i = 0; i < 4 * BUCKETS; i++) dotLen[i] = 0;
    for (var j = 0; j < 4; j++) markLen[j] = 0;
  }

  function updateRays(dt) {
    for (var k = 0; k < MAXR; k++) {
      var life = pLife[k];
      if (life <= 0) continue;

      var x = pX[k], y = pY[k], vx = pVX[k], vy = pVY[k];
      var t = pType[k];
      var hitX = false, hitY = false;

      var nx = x + vx * dt;
      if (isSolid(nx, y)) { vx = -vx; nx = x + vx * dt; life -= BOUNCE_COST; hitX = true; }
      var ny = y + vy * dt;
      if (isSolid(nx, ny)) { vy = -vy; ny = y + vy * dt; life -= BOUNCE_COST; hitY = true; }

      life -= dt;
      pX[k] = nx; pY[k] = ny; pVX[k] = vx; pVY[k] = vy; pLife[k] = life;
      if (life <= 0) continue;

      var r = life / pMax[k];
      addDot(t, r, nx, ny);

      /* 当たった壁面を、壁に沿った短い線分として記録する */
      if (hitX) {
        var fx = Math.round(x);
        addMark(t, fx, y - 0.24, fx, y + 0.24);
      }
      if (hitY) {
        var fy = Math.round(y);
        addMark(t, x - 0.24, fy, x + 0.24, fy);
      }
    }
  }

  /* ---------------- 経路探索 ---------------- */

  function computeFlow(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
    if (solid[ty * W + tx] === 1) return false;
    flow.fill(-1);
    var head = 0, tail = 0;
    var start = ty * W + tx;
    flow[start] = 0;
    flowQ[tail++] = start;
    while (head < tail) {
      var cur = flowQ[head++];
      var cx = cur % W, cy = (cur / W) | 0;
      var d = flow[cur] + 1;
      for (var i = 0; i < 4; i++) {
        var nx = cx + (i === 0 ? 1 : i === 1 ? -1 : 0);
        var ny = cy + (i === 2 ? 1 : i === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var ni = ny * W + nx;
        if (solid[ni] === 1 || flow[ni] !== -1) continue;
        flow[ni] = d;
        flowQ[tail++] = ni;
      }
    }
    return true;
  }

  function moveEntity(e, dx, dy, r) {
    var nx = e.x + dx;
    if (!isSolid(nx + (dx > 0 ? r : -r), e.y - r * 0.7) &&
        !isSolid(nx + (dx > 0 ? r : -r), e.y + r * 0.7)) {
      e.x = nx;
    }
    var ny = e.y + dy;
    if (!isSolid(e.x - r * 0.7, ny + (dy > 0 ? r : -r)) &&
        !isSolid(e.x + r * 0.7, ny + (dy > 0 ? r : -r))) {
      e.y = ny;
    }
  }

  /* ---------------- 化け物 ---------------- */

  function updateBeasts(dt) {
    flowT -= dt;
    if (flowT <= 0) {
      flowT = 0.35;
      lastFlowOk = computeFlow(player.x | 0, player.y | 0);
    }
    var flowOk = lastFlowOk;

    for (var i = 0; i < beasts.length; i++) {
      var b = beasts[i];

      if (!b.awake) {
        b.pulseT -= dt;
        if (b.pulseT <= 0) { b.pulseT = 3.4; emit(b.x, b.y, SND.sleep, T_BEAST); }
        continue;
      }

      /* 立ち止まって耳を澄ます ― この間は完全な無音になり、位置を見失う */
      if (b.listenT > 0) {
        b.listenT -= dt;
        if (b.alertT > 0) b.alertT -= dt;
        checkContact(b);
        continue;
      }

      b.nextListen -= dt;
      if (b.nextListen <= 0) {
        b.listenT = 1.1 + Math.random() * 1.6;
        b.nextListen = 3.5 + Math.random() * 4.0;
        continue;
      }

      if (b.alertT > 0) b.alertT -= dt;

      var tx, ty, speed;
      if (b.alertT > 0) {
        speed = b.speed;
        var chase = Math.hypot(b.x - player.x, b.y - player.y) < 4.5 || b.alertT > 4;
        if (chase && flowOk) {
          var best = -1, bx = 0, by = 0;
          var cd = flow[(b.y | 0) * W + (b.x | 0)];
          for (var d = 0; d < 4; d++) {
            var nx2 = (b.x | 0) + (d === 0 ? 1 : d === 1 ? -1 : 0);
            var ny2 = (b.y | 0) + (d === 2 ? 1 : d === 3 ? -1 : 0);
            if (nx2 < 0 || ny2 < 0 || nx2 >= W || ny2 >= H) continue;
            var fv = flow[ny2 * W + nx2];
            if (fv < 0) continue;
            if (best < 0 || fv < best) { best = fv; bx = nx2 + 0.5; by = ny2 + 0.5; }
          }
          if (best >= 0 && (cd < 0 || best < cd)) { tx = bx; ty = by; }
          else { tx = player.x; ty = player.y; }
        } else {
          tx = b.hx; ty = b.hy;
          /* 音のした場所まで来て何もいなければ、そこで耳を澄ます */
          if (Math.hypot(b.x - tx, b.y - ty) < 0.4) {
            b.alertT = 0;
            b.listenT = 1.4 + Math.random() * 1.4;
          }
        }
      } else {
        speed = b.speed * 0.42;
        b.wanderT -= dt;
        if (b.wanderT <= 0 || (b.wdx === 0 && b.wdy === 0)) {
          b.wanderT = 1.2 + Math.random() * 2.2;
          var a = Math.random() * Math.PI * 2;
          b.wdx = Math.cos(a); b.wdy = Math.sin(a);
        }
        tx = b.x + b.wdx * 2; ty = b.y + b.wdy * 2;
      }

      var ddx = tx - b.x, ddy = ty - b.y;
      var len = Math.hypot(ddx, ddy);
      if (len > 0.001) {
        var ox = b.x, oy = b.y;
        moveEntity(b, (ddx / len) * speed * dt, (ddy / len) * speed * dt, 0.32);
        var moved = Math.hypot(b.x - ox, b.y - oy);
        if (moved < speed * dt * 0.3) b.wanderT = 0;

        b.stepT -= moved;
        if (b.stepT <= 0) {
          b.stepT = b.alertT > 0 ? 0.62 : 0.85;
          emit(b.x, b.y, SND.beast, T_BEAST);
        }
      }

      checkContact(b);
    }
  }

  function checkContact(b) {
    if (!player.alive || grab.on || grace > 0) return;
    if (Math.hypot(b.x - player.x, b.y - player.y) >= DEATH_DIST) return;

    var cause = b.alertT > 0 ? '追いつかれた。' : '暗闇の中で、何かに触れた。';
    if (!settings.grab) { die(cause); return; }

    /* 一発死にせず、振りほどく猶予を与える */
    grab.on = true;
    grab.t = GRAB_TIME;
    grab.got = 0;
    grab.beast = b;
    deathCause = cause;
    setHolding(false);
    SFX.growl(1, panOf(b.x));
    vibrate([120, 60, 120, 60, 120]);
    elGrabWrap.classList.add('on');
  }

  function updateGrab(dt) {
    if (!grab.on) return;

    var b = grab.beast;
    if (b) {
      /* 掴んでいる間、化け物は音を漏らし続ける */
      b.stepT = 0;
      emit(b.x, b.y, { n: 6, spd: 7, life: 0.4, hear: 0 }, T_BEAST);
    }

    grab.t -= dt;
    elGrabBar.style.transform = 'scaleX(' + clamp(grab.got / GRAB_NEED, 0, 1).toFixed(3) + ')';

    if (grab.got >= GRAB_NEED) {
      /* 振りほどいた ― 化け物を突き放し、少しのあいだ無敵 */
      endGrab();
      grace = RESPAWN_GRACE * 0.7;
      if (b) {
        var a = Math.atan2(b.y - player.y, b.x - player.x);
        moveEntity(b, Math.cos(a) * 1.1, Math.sin(a) * 1.1, 0.32);
        b.alertT = 0;
        b.listenT = 2.4;
      }
      emit(player.x, player.y, SND.gasp, T_SELF);
      SFX.gasp();
      fear = 1;
      breath = Math.min(breath, 0.35);
      vibrate([40, 40, 40]);
      return;
    }

    if (grab.t <= 0) { endGrab(); die(deathCause); }
  }

  function endGrab() {
    grab.on = false;
    grab.beast = null;
    elGrabWrap.classList.remove('on');
  }

  /* ---------------- 体（恐怖・鼓動・息） ---------------- */

  function setHolding(on) {
    if (on === holding) return;
    holding = on;
    SFX.setMuffle(on);
    elHoldBtn.classList.toggle('on', on);
  }

  function nearestBeast() {
    var near = 999, nb = null;
    for (var i = 0; i < beasts.length; i++) {
      if (!beasts[i].awake) continue;
      var d = Math.hypot(beasts[i].x - player.x, beasts[i].y - player.y);
      if (d < near) { near = d; nb = beasts[i]; }
    }
    return { d: near, b: nb };
  }

  function updateBody(dt, running) {
    var n = nearestBeast();

    /* 恐怖 ― 近いほど、走るほど上がる。息を止めると早く落ち着く */
    var prox = n.b ? clamp(1 - n.d / 9, 0, 1) : 0;
    fear += dt * (prox * 0.75 + (running ? 0.18 : 0));
    fear -= dt * (holding ? 0.45 : 0.22);
    fear = clamp(fear, 0, 1);

    /* 息 */
    if (gaspLock > 0) { gaspLock -= dt; setHolding(false); }
    if (holding) {
      breath -= dt * BREATH_DRAIN;
      if (breath <= 0) {
        breath = 0;
        setHolding(false);
        gaspLock = GASP_LOCK;
        SFX.gasp();
        emit(player.x, player.y, SND.gasp, T_SELF);
        vibrate([60, 40, 60]);
      }
    } else {
      breath = Math.min(1, breath + dt * BREATH_REFILL);
    }

    /* 鼓動 ― 息を止めていない限り、これ自体が音として漏れる */
    var bpm = 54 + fear * 86;
    heartT -= dt;
    if (heartT <= 0) {
      heartT = 60 / bpm;
      SFX.heart(fear, holding);
      beatDot();
      if (!holding) {
        emit(player.x, player.y,
             { n: 8, spd: 6.0, life: 0.26, hear: 1.1 + fear * 2.5 }, T_HEART);
      }
      if (fear > 0.7) vibrate(24);
    }

    /* うめき声 */
    if (n.b && n.d < 12) {
      growlT -= dt;
      if (growlT <= 0) {
        growlT = 2.6 + Math.random() * 3.2 - prox * 1.2;
        SFX.growl(prox, panOf(n.b.x));
      }
    }
  }

  function beatDot() {
    elHeartDot.classList.add('beat');
    if (beatTimer) clearTimeout(beatTimer);
    beatTimer = setTimeout(function () { elHeartDot.classList.remove('beat'); }, 90);
  }

  /* ---------------- プレイヤー ---------------- */

  function updatePlayer(dt) {
    if (!player.alive || grab.on) return false;
    if (grace > 0) grace -= dt;

    /* 化け物が近くにいない場所を通ったら、そこを復帰点として憶えておく */
    cpT -= dt;
    if (cpT <= 0) {
      cpT = 0.4;
      if (Math.hypot(player.x - cp.x, player.y - cp.y) > 2.5 &&
          nearestBeast().d > CHECK_SAFE_DIST) {
        cp.x = player.x; cp.y = player.y;
      }
    }

    var ix = stick.mx, iy = stick.my;
    var mag = Math.hypot(ix, iy);
    var running = false;

    if (mag > 0.001) {
      running = (mag >= RUN_THRESHOLD || keys.shift) && !holding;
      var spd = running ? RUN_SPD : WALK_SPD * clamp(mag / RUN_THRESHOLD, 0.35, 1);
      if (holding) spd *= HOLD_SPD_MUL;

      player.dx = ix / mag; player.dy = iy / mag;

      var ox = player.x, oy = player.y;
      moveEntity(player, player.dx * spd * dt, player.dy * spd * dt, PLAYER_R);
      var moved = Math.hypot(player.x - ox, player.y - oy);

      /* 歩いた跡は自分の記憶として薄く残る */
      player.crumbAcc += moved;
      if (player.crumbAcc >= 0.45) { player.crumbAcc = 0; crumb(player.x, player.y); }

      player.stepAcc += moved;
      var interval = running ? 1.25 : 0.90;
      if (player.stepAcc >= interval) {
        player.stepAcc = 0;
        var inWater = isWater(player.x, player.y);
        var base = inWater ? SND.water : (running ? SND.run : SND.walk);
        /* 息を止めていると足音も抑えられる */
        var cfg = {
          n: base.n, spd: base.spd, life: base.life * (holding ? 0.78 : 1),
          hear: base.hear * (holding ? 0.42 : 1)
        };
        emit(player.x, player.y, cfg, T_SELF);
        SFX.step(running ? 1 : 0, inWater, 0);
        if (inWater) vibrate(18);
      }
    }

    for (var i = 0; i < relics.length; i++) {
      var r = relics[i];
      if (r.got) continue;
      if (Math.hypot(r.x - player.x, r.y - player.y) < 0.6) {
        r.got = true;
        relicsLeft--;
        updateRelicHud();
        SFX.pickup();
        emit(r.x, r.y, SND.goal, T_GOAL);
        vibrate([20, 40, 20]);
      }
    }

    if (relicsLeft === 0 &&
        Math.hypot(exitPos.x - player.x, exitPos.y - player.y) < 0.7) {
      win();
    }
    return running;
  }

  function updateBeacons(dt) {
    goalT -= dt;
    if (goalT <= 0) {
      var open = relicsLeft === 0;
      goalT = open ? 2.2 : 3.6;
      emit(exitPos.x, exitPos.y,
           open ? SND.goal : { n: 14, spd: 6.0, life: 0.65, hear: 0 }, T_GOAL);
      if (Math.hypot(exitPos.x - player.x, exitPos.y - player.y) < 22) {
        SFX.beacon(panOf(exitPos.x), open);
      }
    }
    if (relicsLeft > 0) {
      relicT -= dt;
      if (relicT <= 0) {
        relicT = 2.4;
        for (var i = 0; i < relics.length; i++) {
          if (!relics[i].got) {
            emit(relics[i].x, relics[i].y,
                 { n: 12, spd: 5.5, life: 0.70, hear: 0 }, T_GOAL);
          }
        }
      }
    }
  }

  /* ---------------- 描画 ---------------- */

  function crumb(x, y) {
    mctx.globalCompositeOperation = 'source-over';
    mctx.fillStyle = 'rgba(74,118,140,0.32)';
    var s = 2 * SCALE;
    mctx.fillRect(x * TILE - s / 2, y * TILE - s / 2, s, s);
  }

  function computeView() {
    var cw = cv.width, ch = cv.height;
    /* 短辺に VIEW_TILES マスが収まる倍率。縦持ちでは縦に長く見える */
    var px = Math.min(cw, ch) / (VIEW_TILES * TILE);
    var vw = cw / px, vh = ch / px;
    var fit = Math.min(1, mem.width / vw, mem.height / vh);
    vw *= fit; vh *= fit;
    view.w = vw; view.h = vh;
    view.x = clamp(player.x * TILE - vw / 2, 0, Math.max(0, mem.width - vw));
    view.y = clamp(player.y * TILE - vh / 2, 0, Math.max(0, mem.height - vh));
  }

  /* 画面外は描いても見えないので、映った瞬間に消しておく */
  function refreshLiveRegion(x, y, w, h) {
    lctx.globalCompositeOperation = 'source-over';
    var p = prevView;
    if (!p || x + w <= p.x || p.x + p.w <= x || y + h <= p.y || p.y + p.h <= y) {
      lctx.fillStyle = '#000';
      lctx.fillRect(x, y, w, h);
    } else {
      lctx.fillStyle = '#000';
      if (x < p.x) lctx.fillRect(x, y, p.x - x, h);
      if (x + w > p.x + p.w) lctx.fillRect(p.x + p.w, y, x + w - (p.x + p.w), h);
      if (y < p.y) lctx.fillRect(x, y, w, p.y - y);
      if (y + h > p.y + p.h) lctx.fillRect(x, p.y + p.h, w, y + h - (p.y + p.h));
    }
    prevView = { x: x, y: y, w: w, h: h };
  }

  function drawWorld() {
    /* --- 記憶の地図：ゆっくりとだけ薄れる --- */
    memFadeT++;
    if (memFadeT >= 30) {
      memFadeT = 0;
      mctx.globalCompositeOperation = 'source-over';
      mctx.fillStyle = 'rgba(0,0,0,0.03)';
      mctx.fillRect(0, 0, mem.width, mem.height);
    }
    /* 加算合成だと何度も当たった壁が白く飛ぶので、上書き合成で色に収束させる */
    mctx.globalCompositeOperation = 'source-over';
    mctx.strokeStyle = ETCH_COLOR + (0.16 * BR).toFixed(3) + ')';
    mctx.lineWidth = 2.2 * SCALE;
    mctx.lineCap = 'butt';
    mctx.beginPath();
    var any = false;
    for (var t = 0; t < 4; t++) {
      if (!ETCHES[t]) continue;
      var mb = markBuf[t], mn = markLen[t];
      for (var m = 0; m < mn; m += 4) {
        mctx.moveTo(mb[m] * TILE, mb[m + 1] * TILE);
        mctx.lineTo(mb[m + 2] * TILE, mb[m + 3] * TILE);
        any = true;
      }
    }
    if (any) mctx.stroke();

    /* --- いま鳴っている音：速く消える（可視範囲だけ更新する） --- */
    var m = TILE * 2;
    var vx = Math.max(0, view.x - m), vy = Math.max(0, view.y - m);
    var vw = Math.min(live.width, view.x + view.w + m) - vx;
    var vh = Math.min(live.height, view.y + view.h + m) - vy;
    refreshLiveRegion(vx, vy, vw, vh);
    lctx.fillStyle = 'rgba(0,0,0,0.26)';
    lctx.fillRect(vx, vy, vw, vh);
    lctx.globalCompositeOperation = 'lighter';

    /* 波面の点 */
    for (var ty = 0; ty < 4; ty++) {
      var col = COLORS[ty];
      for (var b = 0; b < BUCKETS; b++) {
        var bi = ty * BUCKETS + b;
        var n = dotLen[bi];
        if (n === 0) continue;
        var a = (0.16 + b * 0.26) * BRIGHT[ty] * BR;
        var sz = (1.3 + b * 0.5) * SCALE;
        lctx.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + a.toFixed(3) + ')';
        var buf = dotBuf[bi];
        for (var k = 0; k < n; k += 2) {
          var dx = buf[k] * TILE, dy = buf[k + 1] * TILE;
          if (dx < vx || dy < vy || dx > vx + vw || dy > vy + vh) continue;
          lctx.fillRect(dx - sz / 2, dy - sz / 2, sz, sz);
        }
      }
    }

    /* 反射した瞬間の壁面は強く光る */
    lctx.lineWidth = 2.4 * SCALE;
    lctx.lineCap = 'butt';
    for (var t2 = 0; t2 < 4; t2++) {
      var mn2 = markLen[t2];
      if (mn2 === 0) continue;
      var c2 = COLORS[t2], mb2 = markBuf[t2];
      lctx.strokeStyle = 'rgba(' + c2[0] + ',' + c2[1] + ',' + c2[2] + ',' +
                         (0.42 * BRIGHT[t2] * BR).toFixed(3) + ')';
      lctx.beginPath();
      for (var m2 = 0; m2 < mn2; m2 += 4) {
        lctx.moveTo(mb2[m2] * TILE, mb2[m2 + 1] * TILE);
        lctx.lineTo(mb2[m2 + 2] * TILE, mb2[m2 + 3] * TILE);
      }
      lctx.stroke();
    }

    /* 自分の足 */
    if (player.alive) {
      var px = player.x * TILE, py = player.y * TILE;
      var nx = -player.dy, ny = player.dx;
      lctx.fillStyle = holding ? 'rgba(120,190,215,0.30)' : 'rgba(170,235,255,0.42)';
      var fs = 3 * SCALE;
      for (var s = -1; s <= 1; s += 2) {
        lctx.fillRect(px + nx * s * 3.4 * SCALE - fs / 2,
                      py + ny * s * 3.4 * SCALE - fs / 2, fs, fs);
      }
    }
    lctx.globalCompositeOperation = 'source-over';
    mctx.globalCompositeOperation = 'source-over';
  }

  function buildVignette(cw, ch, tight) {
    var key = cw + 'x' + ch + (tight ? 'T' : 'N') + BR.toFixed(2);
    if (key === vigKey) return;
    vigKey = key;
    vig.width = cw; vig.height = ch;
    var inner = Math.min(cw, ch) * (tight ? 0.20 : 0.30);
    var g = vctx.createRadialGradient(cw / 2, ch / 2, inner,
                                      cw / 2, ch / 2, Math.max(cw, ch) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + clamp(0.80 / BR, 0.42, 0.92).toFixed(3) + ')');
    vctx.clearRect(0, 0, cw, ch);
    vctx.fillStyle = g;
    vctx.fillRect(0, 0, cw, ch);
  }

  /* 危険の方向を画面の縁に滲ませる。
     位置までは教えないが「どっちから来ているか」だけは常にわかるようにする。
     ＝ 何も分からないまま殺される事故を減らすための救済 */
  function buildDangerSprite(r) {
    var key = r + '|' + settings.palette;
    if (key === dangerKey) return;
    dangerKey = key;
    dang.width = dang.height = r * 2;
    var c = COLORS[T_BEAST];
    var g = dctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',1)');
    g.addColorStop(0.45, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0.28)');
    g.addColorStop(1, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)');
    dctx.clearRect(0, 0, r * 2, r * 2);
    dctx.fillStyle = g;
    dctx.fillRect(0, 0, r * 2, r * 2);
  }

  function drawDanger(cw, ch) {
    if (!settings.danger || !player.alive) return;
    var n = nearestBeast();
    if (!n.b || n.d > 13) return;

    var r = Math.round(Math.min(cw, ch) * 0.42);
    buildDangerSprite(r);

    var prox = clamp(1 - n.d / 13, 0, 1);
    var a = (n.b.alertT > 0 ? 0.42 : 0.20) * prox * prox;
    if (grab.on) a = 0.6;

    /* カメラが地図の端で止まっているとプレイヤーは画面中央にいないので、
       画面中央ではなく実際の自分の位置を基準に方向を取る */
    var sc = cw / view.w;
    var psx = (player.x * TILE - view.x) * sc;
    var psy = (player.y * TILE - view.y) * sc;

    var ang = Math.atan2(n.b.y - player.y, n.b.x - player.x);
    var ex = psx + Math.cos(ang) * cw * 0.62;
    var ey = psy + Math.sin(ang) * ch * 0.58;

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.drawImage(dang, ex - r, ey - r);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawScreen() {
    var cw = cv.width, ch = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.drawImage(mem, view.x, view.y, view.w, view.h, 0, 0, cw, ch);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(live, view.x, view.y, view.w, view.h, 0, 0, cw, ch);
    ctx.globalCompositeOperation = 'source-over';

    /* 周辺減光 ― 息を止めると視界が締まる */
    buildVignette(cw, ch, holding);
    ctx.drawImage(vig, 0, 0);

    drawDanger(cw, ch);

    if (mode === 'play' && stick.active && stick.pointerId !== null) {
      var s = dpr;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.arc(stick.ox * s, stick.oy * s, stick.radius * s, 0, 6.2832);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.beginPath();
      ctx.arc((stick.ox + stick.mx * stick.radius) * s,
              (stick.oy + stick.my * stick.radius) * s, 14 * s, 0, 6.2832);
      ctx.fill();
    }
  }

  /* ---------------- 勝敗 ---------------- */

  function die(cause) {
    if (!player.alive) return;
    player.alive = false;
    deathCause = cause;
    mode = 'dead';
    deaths++;
    endGrab();
    setHolding(false);
    SFX.death();
    vibrate([90, 50, 200]);
    emit(player.x, player.y, { n: 90, spd: 7, life: 1.6, hear: 0 }, T_BEAST);

    elFlash.classList.add('on');
    setTimeout(function () { elFlash.classList.remove('on'); }, 60);

    /* チェックポイントがあるなら、地図も遺物も残したまま復帰する。
       ステージ丸ごとやり直させないのが、この作りでいちばん効く改善 */
    if (settings.checkpoint) {
      setTimeout(function () {
        if (mode !== 'dead') return;
        respawn();
      }, 1250);
      return;
    }

    setTimeout(function () {
      if (mode !== 'dead') return;
      $('deadMsg').textContent = deathCause;
      elHud.classList.add('hidden');
      show('dead');
    }, 1100);
  }

  function respawn() {
    player.x = cp.x; player.y = cp.y;
    player.dx = 0; player.dy = -1;
    player.stepAcc = 0; player.crumbAcc = 0;
    player.alive = true;
    fear = 0; breath = 1; gaspLock = 0; heartT = 0;
    grace = RESPAWN_GRACE;
    mode = 'play';

    /* 復帰地点の目の前で待ち構えられないよう、追跡は一度切る */
    for (var i = 0; i < beasts.length; i++) {
      beasts[i].alertT = 0;
      beasts[i].listenT = 1.2 + Math.random();
    }

    updateDeathHud();
    emit(player.x, player.y, SND.open, T_SELF);
  }

  function updateDeathHud() {
    if (deaths === 0) { elDeath.classList.remove('on'); elDeath.textContent = ''; return; }
    elDeath.textContent = '死 ×' + deaths;
    elDeath.classList.add('on');
  }

  function win() {
    if (!player.alive || mode !== 'play') return;
    player.alive = false;
    mode = 'clear';
    setHolding(false);
    SFX.clear();
    vibrate([30, 60, 30, 60, 120]);

    if (levelIdx + 1 >= unlocked && unlocked < LEVELS.length) {
      unlocked = levelIdx + 2;
      saveProgress();
    }

    setTimeout(function () {
      if (mode !== 'clear') return;
      var last = levelIdx >= LEVELS.length - 1;
      var mm = Math.floor(elapsed / 60), ss = Math.floor(elapsed % 60);
      $('clearMsg').textContent =
        (last ? 'すべての闇を抜けた。' : LEVELS[levelIdx].name + ' を抜けた。') +
        '  ' + mm + ':' + (ss < 10 ? '0' : '') + ss;
      $('nextBtn').textContent = last ? 'はじめにもどる' : 'つぎへ';
      elHud.classList.add('hidden');
      show('clear');
    }, 1400);
  }

  /* ---------------- 行動 ---------------- */

  function doClick() {
    if (mode !== 'play' || clickCd > 0 || !player.alive) return;
    clickCd = CLICK_COOL;
    emit(player.x, player.y, SND.click, T_SELF,
         Math.atan2(player.dy, player.dx), CLICK_ARC);
    SFX.click();
    vibrate(12);
  }

  function doCall() {
    if (mode !== 'play' || callCd > 0 || !player.alive) return;
    callCd = CALL_COOL;
    emit(player.x, player.y, SND.call, T_SELF);
    SFX.call();
    vibrate(45);
  }

  /* ---------------- 入力 ---------------- */

  var stick = {
    active: false, pointerId: null,
    ox: 0, oy: 0, mx: 0, my: 0, radius: 64,
    downT: 0, moved: 0, lastX: 0, lastY: 0
  };
  var keys = { up: 0, down: 0, left: 0, right: 0, shift: false };

  function pointerPos(e) {
    var r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  cv.addEventListener('pointerdown', function (e) {
    if (mode !== 'play' || stick.pointerId !== null) return;
    e.preventDefault();
    var p = pointerPos(e);
    stick.pointerId = e.pointerId;
    stick.active = true;
    stick.ox = p.x; stick.oy = p.y;
    stick.mx = 0; stick.my = 0;
    stick.downT = performance.now();
    stick.moved = 0;
    stick.lastX = p.x; stick.lastY = p.y;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  });

  cv.addEventListener('pointermove', function (e) {
    if (stick.pointerId !== e.pointerId) return;
    e.preventDefault();
    var p = pointerPos(e);
    /* 掴まれている間は、指を振った量がそのまま脱出ゲージになる */
    if (grab.on) grab.got += Math.hypot(p.x - stick.lastX, p.y - stick.lastY);
    stick.lastX = p.x; stick.lastY = p.y;

    var dx = p.x - stick.ox, dy = p.y - stick.oy;
    var d = Math.hypot(dx, dy);
    stick.moved = Math.max(stick.moved, d);
    if (d > stick.radius) {
      stick.ox += dx * (1 - stick.radius / d);
      stick.oy += dy * (1 - stick.radius / d);
      dx = p.x - stick.ox; dy = p.y - stick.oy;
    }
    stick.mx = dx / stick.radius;
    stick.my = dy / stick.radius;
  });

  function endPointer(e) {
    if (stick.pointerId !== e.pointerId) return;
    var dur = performance.now() - stick.downT;
    if (dur < 240 && stick.moved < 14) doClick();
    stick.pointerId = null;
    stick.active = false;
    stick.mx = 0; stick.my = 0;
  }
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);

  /* 〈息〉は押している間だけ有効 */
  elHoldBtn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (mode === 'play' && gaspLock <= 0 && breath > 0.02) setHolding(true);
  });
  function releaseHold(e) { if (e) e.preventDefault(); setHolding(false); }
  elHoldBtn.addEventListener('pointerup', releaseHold);
  elHoldBtn.addEventListener('pointercancel', releaseHold);
  elHoldBtn.addEventListener('pointerleave', releaseHold);

  elCallBtn.addEventListener('click', function (e) { e.preventDefault(); doCall(); });

  window.addEventListener('keydown', function (e) {
    if (!e.key || e.repeat) {
      if (e.key && e.key.toLowerCase() === 'f') e.preventDefault();
      return;
    }
    var k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') { keys.up = 1; if (grab.on) grab.got += 55; }
    else if (k === 's' || k === 'arrowdown') { keys.down = 1; if (grab.on) grab.got += 55; }
    else if (k === 'a' || k === 'arrowleft') { keys.left = 1; if (grab.on) grab.got += 55; }
    else if (k === 'd' || k === 'arrowright') { keys.right = 1; if (grab.on) grab.got += 55; }
    else if (k === 'shift') keys.shift = true;
    else if (k === ' ') doClick();
    else if (k === 'e') doCall();
    else if (k === 'f') { if (mode === 'play' && gaspLock <= 0 && breath > 0.02) setHolding(true); }
    else if (k === 'escape') { if (mode === 'play') pause(); return; }
    else return;
    e.preventDefault();
  });

  window.addEventListener('keyup', function (e) {
    if (!e.key) return;
    var k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') keys.up = 0;
    else if (k === 's' || k === 'arrowdown') keys.down = 0;
    else if (k === 'a' || k === 'arrowleft') keys.left = 0;
    else if (k === 'd' || k === 'arrowright') keys.right = 0;
    else if (k === 'shift') keys.shift = false;
    else if (k === 'f') setHolding(false);
  });

  function applyKeyboard() {
    if (stick.pointerId !== null) return;
    var kx = keys.right - keys.left, ky = keys.down - keys.up;
    if (kx || ky) {
      var m = Math.hypot(kx, ky);
      var f = keys.shift ? 1 : RUN_THRESHOLD * 0.9;
      stick.mx = (kx / m) * f;
      stick.my = (ky / m) * f;
    } else if (!stick.active) {
      stick.mx = 0; stick.my = 0;
    }
  }

  /* ---------------- 画面遷移 ---------------- */

  function startLevel(idx) {
    levelIdx = idx;
    loadLevel(idx);
    mode = 'play';
    show(null);
    elHud.classList.remove('hidden');
    SFX.init();
    SFX.ambient(true);
  }

  function pause() {
    if (mode !== 'play') return;
    mode = 'pause';
    setHolding(false);
    stick.pointerId = null; stick.active = false;
    stick.mx = 0; stick.my = 0;
    elHud.classList.add('hidden');
    show('pause');
  }

  function resume() {
    if (mode !== 'pause') return;
    mode = 'play';
    show(null);
    elHud.classList.remove('hidden');
    SFX.resume();
  }

  function toSelect() {
    mode = 'select';
    setHolding(false);
    SFX.ambient(false);
    elHud.classList.add('hidden');
    buildLevelList();
    show('select');
  }

  function buildLevelList() {
    var list = $('levelList');
    list.innerHTML = '';
    for (var i = 0; i < LEVELS.length; i++) {
      (function (idx) {
        var L = LEVELS[idx];
        var locked = idx + 1 > unlocked;
        var cleared = idx + 1 < unlocked;
        var b = document.createElement('button');
        b.className = 'lvBtn' + (locked ? ' locked' : '') + (cleared ? ' cleared' : '');
        b.innerHTML =
          '<span class="no">' + (idx + 1) + '</span>' +
          '<span class="nm">' + (locked ? '？？？' : L.name) +
          '<span class="dsc">' + (locked ? '前のステージを抜けると開く' : L.desc) + '</span></span>' +
          '<span class="st">' + (locked ? '🔒' : (cleared ? '✓' : '')) + '</span>';
        if (!locked) b.addEventListener('click', function () { startLevel(idx); });
        list.appendChild(b);
      })(i);
    }
  }

  /* ---------------- 設定画面 ---------------- */

  var setReturn = 'select';

  function openSettings(from) {
    setReturn = from;
    $('setBright').value = settings.bright;
    $('brightVal').textContent = settings.bright + '%';
    $('setPalette').value = String(settings.palette);
    $('setDanger').checked = !!settings.danger;
    $('setCheck').checked = !!settings.checkpoint;
    $('setGrab').checked = !!settings.grab;
    $('setVibe').checked = !!settings.vibe;
    mode = 'settings';
    show('settings');
  }

  $('setBright').addEventListener('input', function () {
    settings.bright = parseInt(this.value, 10);
    $('brightVal').textContent = settings.bright + '%';
    saveSettings();
  });
  $('setPalette').addEventListener('change', function () {
    settings.palette = parseInt(this.value, 10);
    saveSettings();
  });
  $('setDanger').addEventListener('change', function () { settings.danger = this.checked; saveSettings(); });
  $('setCheck').addEventListener('change', function () { settings.checkpoint = this.checked; saveSettings(); });
  $('setGrab').addEventListener('change', function () { settings.grab = this.checked; saveSettings(); });
  $('setVibe').addEventListener('change', function () { settings.vibe = this.checked; saveSettings(); });

  $('settingsBtn').addEventListener('click', function () { openSettings('select'); });
  $('pauseSetBtn').addEventListener('click', function () { openSettings('pause'); });
  $('setBack').addEventListener('click', function () {
    if (setReturn === 'pause') { mode = 'pause'; show('pause'); }
    else toSelect();
  });

  $('startBtn').addEventListener('click', function () {
    SFX.init();
    var stage = document.getElementById('stage');
    if (stage.requestFullscreen) { try { stage.requestFullscreen(); } catch (e) {} }
    toSelect();
  });
  $('howtoBtn').addEventListener('click', function () { mode = 'howto'; show('howto'); });
  $('howtoBack').addEventListener('click', toSelect);
  $('resetBtn').addEventListener('click', function () {
    if (confirm('クリア記録を消しますか？')) { unlocked = 1; saveProgress(); buildLevelList(); }
  });
  $('pauseBtn').addEventListener('click', pause);
  $('resumeBtn').addEventListener('click', resume);
  $('retryBtn').addEventListener('click', function () { startLevel(levelIdx); });
  $('quitBtn').addEventListener('click', toSelect);
  $('againBtn').addEventListener('click', function () { startLevel(levelIdx); });
  $('deadQuitBtn').addEventListener('click', toSelect);
  $('clearQuitBtn').addEventListener('click', toSelect);
  $('nextBtn').addEventListener('click', function () {
    if (levelIdx >= LEVELS.length - 1) toSelect();
    else startLevel(levelIdx + 1);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (mode === 'play') pause(); SFX.suspend(); }
    else SFX.resume();
  });

  /* ---------------- リサイズ ---------------- */

  var dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.floor(cv.clientWidth * dpr);
    cv.height = Math.floor(cv.clientHeight * dpr);
    stick.radius = Math.max(52, Math.min(cv.clientWidth, cv.clientHeight) * 0.17);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });

  /* ---------------- HUD ---------------- */

  function updateHud() {
    elClickFill.style.transform = 'scaleX(' + (1 - clickCd / CLICK_COOL).toFixed(3) + ')';
    elBreath.style.transform = 'scaleY(' + breath.toFixed(3) + ')';
    elBreath.classList.toggle('low', breath < 0.3);
    elCallBtn.classList.toggle('cooling', callCd > 0);
    elHoldBtn.classList.toggle('cooling', gaspLock > 0 || breath <= 0.02);
  }

  /* ---------------- メインループ ---------------- */

  var acc = 0, last = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    var el = Math.min((now - last) / 1000, 0.1);
    last = now;

    if (mode !== 'play' && mode !== 'dead' && mode !== 'clear') return;

    acc += el;
    clearBatches();
    var steps = 0;
    while (acc >= DT && steps < 6) {
      acc -= DT;
      steps++;
      if (mode === 'play') {
        elapsed += DT;
        applyKeyboard();
        updateGrab(DT);
        var running = updatePlayer(DT);
        updateBody(DT, running);
        updateBeasts(DT);
        updateBeacons(DT);
        if (clickCd > 0) clickCd = Math.max(0, clickCd - DT);
        if (callCd > 0) callCd = Math.max(0, callCd - DT);
      }
      updateRays(DT);
    }

    computeView();
    drawWorld();
    drawScreen();
    if (mode === 'play') updateHud();
  }

  /* ---------------- 起動 ---------------- */

  loadProgress();
  loadSettings();
  resize();
  show('title');
  requestAnimationFrame(frame);
})();
