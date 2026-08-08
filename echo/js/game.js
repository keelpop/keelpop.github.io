/* ============================================================
   残響 — Echo in the Dark
   音の波紋だけで世界を見るホラーゲーム本体
   ============================================================ */

(function () {
  'use strict';

  /* ---------------- 定数 ---------------- */

  var TILE = 24;              // 1マスの内部解像度(px)
  var VIEW_TILES = 12.5;      // 画面の縦に収まるマス数
  var DT = 1 / 60;            // 物理の固定ステップ
  var MAXR = 7000;            // 音の粒子の最大数

  var WALK_SPD = 2.45;        // マス/秒
  var RUN_SPD = 4.30;
  var RUN_THRESHOLD = 0.62;   // スティック倒し量がこれ以上で「走る」
  var PLAYER_R = 0.30;

  var CLAP_COOL = 3.2;        // 手を叩くクールタイム(秒)
  var DEATH_DIST = 0.52;

  /* 音の種類ごとのパラメータ
     n:粒子数 spd:速さ life:寿命 hear:化け物に聞こえる距離 */
  var SND = {
    walk:  { n: 30, spd: 8.5,  life: 1.10, hear: 5.5 },
    run:   { n: 44, spd: 9.5,  life: 1.70, hear: 12.0 },
    water: { n: 56, spd: 9.5,  life: 2.00, hear: 15.0 },
    clap:  { n: 96, spd: 11.0, life: 2.60, hear: 19.0 },
    beast: { n: 18, spd: 8.0,  life: 1.00, hear: 0 },
    sleep: { n: 12, spd: 5.0,  life: 0.85, hear: 0 },
    beacon:{ n: 24, spd: 7.0,  life: 1.00, hear: 0 }
  };

  var T_WHITE = 0, T_RED = 1, T_GOLD = 2;
  var COLORS = [[205, 226, 255], [255, 62, 62], [255, 205, 120]];
  var BOUNCE_COST = 0.22;     // 1回反射するごとに失う寿命
  var STORE_KEY = 'echo_progress_v1';

  /* ---------------- DOM ---------------- */

  var cv = document.getElementById('game');
  var ctx = cv.getContext('2d');
  var $ = function (id) { return document.getElementById(id); };

  var elHud = $('hud'), elLevelName = $('levelName'), elRelic = $('relicInfo');
  var elClapFill = $('clapFill'), elFlash = $('flash'), elHint = $('hint');
  var hintTimer = null;
  var screens = {
    title: $('titleScreen'), select: $('selectScreen'), howto: $('howtoScreen'),
    pause: $('pauseScreen'), dead: $('deadScreen'), clear: $('clearScreen')
  };

  /* ---------------- 状態 ---------------- */

  var mode = 'title';         // title|select|howto|play|pause|dead|clear
  var levelIdx = 0;
  var unlocked = 1;

  var W = 0, H = 0;
  var solid = null, water = null;
  var player = { x: 0, y: 0, dx: 0, dy: -1, stepAcc: 0, alive: true };
  var exitPos = { x: 0, y: 0 };
  var relics = [];
  var beasts = [];
  var relicsLeft = 0;

  var clapCd = 0;
  var beaconT = 0, relicT = 0, heartT = 0, growlT = 0, flowT = 0;
  var deathCause = '';
  var elapsed = 0;

  /* 音の粒子（型付き配列） */
  var pX = new Float32Array(MAXR), pY = new Float32Array(MAXR);
  var pPX = new Float32Array(MAXR), pPY = new Float32Array(MAXR);
  var pVX = new Float32Array(MAXR), pVY = new Float32Array(MAXR);
  var pLife = new Float32Array(MAXR), pMax = new Float32Array(MAXR);
  var pType = new Uint8Array(MAXR);
  var pHead = 0;

  /* 描画バッチ（種類3 × 明るさ4段） */
  var BUCKETS = 4;
  var segBuf = [], segLen = [];
  for (var i = 0; i < 3 * BUCKETS; i++) {
    segBuf.push(new Float32Array(MAXR * 4));
    segLen.push(0);
  }

  /* 残響を焼き付ける世界サイズのキャンバス */
  var trail = document.createElement('canvas');
  var tctx = trail.getContext('2d');

  /* 経路探索用フローフィールド */
  var flow = null;
  var flowQ = null;

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

  function saveProgress() {
    try { localStorage.setItem(STORE_KEY, String(unlocked)); } catch (e) {}
  }

  function vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
  }

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
            x: cx, y: cy, hx: cx, hy: cy,      // hx,hy = 最後に音を聞いた場所
            awake: c === 'M', alertT: 0,
            wdx: 0, wdy: 0, wanderT: 0,
            stepT: 0, pulseT: Math.random() * 2,
            speed: c === 'M' ? 2.05 : 2.35     // 眠っていたものは起きると速い
          });
        }
      }
    }

    relicsLeft = relics.length;
    player.dx = 0; player.dy = -1;
    player.stepAcc = 0;
    player.alive = true;

    flow = new Int32Array(W * H);
    flowQ = new Int32Array(W * H);

    trail.width = W * TILE;
    trail.height = H * TILE;
    tctx.fillStyle = '#000';
    tctx.fillRect(0, 0, trail.width, trail.height);

    for (var i = 0; i < MAXR; i++) pLife[i] = 0;

    clapCd = 0; beaconT = 1.2; relicT = 0.6;
    heartT = 0; growlT = 0; flowT = 0; elapsed = 0;
    stick.active = false; stick.mx = 0; stick.my = 0;

    elLevelName.textContent = (idx + 1) + '. ' + L.name;
    updateRelicHud();

    /* 開始時だけヒントを数秒だけ出す */
    elHint.textContent = L.hint;
    elHint.classList.add('on');
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { elHint.classList.remove('on'); }, 5200);

    /* 真っ暗なまま放り出さないよう、開始時だけ周囲を見せる（化け物には聞こえない） */
    emit(player.x, player.y, { n: 56, spd: 9.0, life: 1.9, hear: 0 }, T_WHITE);
  }

  function updateRelicHud() {
    if (relics.length === 0) { elRelic.textContent = ''; return; }
    elRelic.textContent = '遺物 ' + (relics.length - relicsLeft) + ' / ' + relics.length;
  }

  /* ---------------- 音の波 ---------------- */

  function emit(x, y, cfg, type) {
    var n = cfg.n;
    var base = Math.random() * Math.PI * 2;
    for (var i = 0; i < n; i++) {
      var a = base + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.05;
      var s = cfg.spd * (0.92 + Math.random() * 0.16);
      var k = pHead;
      pHead = (pHead + 1) % MAXR;
      pX[k] = pPX[k] = x;
      pY[k] = pPY[k] = y;
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
      if (d < radius) {
        if (!b.awake) {
          b.awake = true;
          emit(b.x, b.y, SND.beast, T_RED);   // 目覚めの咆哮
          SFX.growl(0.9, panOf(b.x));
          vibrate([40, 60, 90]);
        }
        b.hx = x; b.hy = y;
        b.alertT = Math.max(b.alertT, 6.5 + (radius - d) * 0.35);
      }
    }
  }

  /* 壁に当たった点は少し強く光らせる ― これで壁面の形が読み取れる */
  var hitBuf = [new Float32Array(4096), new Float32Array(4096), new Float32Array(4096)];
  var hitLen = [0, 0, 0];

  function addHit(t, x, y, r) {
    var n = hitLen[t];
    if (n + 3 > hitBuf[t].length) return;
    hitBuf[t][n] = x; hitBuf[t][n + 1] = y; hitBuf[t][n + 2] = r;
    hitLen[t] = n + 3;
  }

  function clearSegments() {
    for (var i = 0; i < 3 * BUCKETS; i++) segLen[i] = 0;
    hitLen[0] = hitLen[1] = hitLen[2] = 0;
  }

  /* 1フレームに複数ステップ回る場合もあるので、線分は溜めてから一度に描く */
  function updateRays(dt) {
    for (var k = 0; k < MAXR; k++) {
      var life = pLife[k];
      if (life <= 0) continue;

      var x = pX[k], y = pY[k], vx = pVX[k], vy = pVY[k];
      pPX[k] = x; pPY[k] = y;

      var hit = false;
      var nx = x + vx * dt;
      if (isSolid(nx, y)) { vx = -vx; nx = x + vx * dt; life -= BOUNCE_COST; hit = true; }
      var ny = y + vy * dt;
      if (isSolid(nx, ny)) { vy = -vy; ny = y + vy * dt; life -= BOUNCE_COST; hit = true; }

      life -= dt;
      if (hit && life > 0) addHit(pType[k], x, y, life / pMax[k]);
      pX[k] = nx; pY[k] = ny; pVX[k] = vx; pVY[k] = vy; pLife[k] = life;
      if (life <= 0) continue;

      /* 明るさで4段に振り分けて、まとめて描く */
      var r = life / pMax[k];
      var b = r > 0.72 ? 3 : (r > 0.46 ? 2 : (r > 0.2 ? 1 : 0));
      var bi = pType[k] * BUCKETS + b;
      var buf = segBuf[bi], n = segLen[bi];
      if (n + 4 <= buf.length) {
        buf[n] = pPX[k]; buf[n + 1] = pPY[k]; buf[n + 2] = nx; buf[n + 3] = ny;
        segLen[bi] = n + 4;
      }
    }
  }

  /* ---------------- 経路探索（プレイヤーへのフローフィールド） ---------------- */

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

  /* ---------------- 移動（軸ごとに壁で止める） ---------------- */

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

  function panOf(x) {
    return clamp((x - player.x) / 9, -1, 1);
  }

  function updateBeasts(dt) {
    var flowOk = false;
    flowT -= dt;
    if (flowT <= 0) {
      flowT = 0.35;
      flowOk = computeFlow(player.x | 0, player.y | 0);
      lastFlowOk = flowOk;
    }
    flowOk = lastFlowOk;

    for (var i = 0; i < beasts.length; i++) {
      var b = beasts[i];

      if (!b.awake) {
        /* 眠っている間もゆっくり脈打つ ― 位置は伝わる */
        b.pulseT -= dt;
        if (b.pulseT <= 0) {
          b.pulseT = 3.4;
          emit(b.x, b.y, SND.sleep, T_RED);
        }
        continue;
      }

      if (b.alertT > 0) b.alertT -= dt;

      var tx, ty, speed;
      if (b.alertT > 0) {
        speed = b.speed;
        /* 目標へ向かうフローに従う（プレイヤーを見失っていれば最後に聞いた場所へ） */
        var chase = Math.hypot(b.x - player.x, b.y - player.y) < 4.5 || b.alertT > 4;
        if (chase && flowOk) {
          var best = -1, bx = 0, by = 0;
          var ctile = ((b.y | 0) * W + (b.x | 0));
          var cd = flow[ctile];
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
          if (Math.hypot(b.x - tx, b.y - ty) < 0.4) b.alertT = 0;
        }
      } else {
        /* 徘徊 */
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
        if (moved < speed * dt * 0.3) { b.wanderT = 0; }  // 壁にぶつかったら向きを変える

        /* 足音（赤い波） */
        b.stepT -= moved;
        if (b.stepT <= 0) {
          b.stepT = b.alertT > 0 ? 0.62 : 0.85;
          emit(b.x, b.y, SND.beast, T_RED);
        }
      }

      /* 接触 = 死 */
      if (player.alive && Math.hypot(b.x - player.x, b.y - player.y) < DEATH_DIST) {
        die(b.alertT > 0 ? '追いつかれた。' : '暗闇の中で、何かに触れた。');
      }
    }
  }
  var lastFlowOk = false;

  /* ---------------- 緊張感の演出（心音とうめき） ---------------- */

  function updateTension(dt) {
    var near = 999, nearB = null;
    for (var i = 0; i < beasts.length; i++) {
      if (!beasts[i].awake) continue;
      var d = Math.hypot(beasts[i].x - player.x, beasts[i].y - player.y);
      if (d < near) { near = d; nearB = beasts[i]; }
    }
    if (!nearB || near > 11) { heartT = 0; return; }

    var prox = clamp(1 - near / 11, 0, 1);

    heartT -= dt;
    if (heartT <= 0) {
      heartT = 1.35 - prox * 0.75;
      SFX.heart(prox);
      if (prox > 0.75) vibrate(28);
    }

    growlT -= dt;
    if (growlT <= 0) {
      growlT = 2.6 + Math.random() * 3.2 - prox * 1.2;
      SFX.growl(prox, panOf(nearB.x));
    }
  }

  /* ---------------- プレイヤー ---------------- */

  function updatePlayer(dt) {
    if (!player.alive) return;

    var ix = stick.mx, iy = stick.my;
    var mag = Math.hypot(ix, iy);
    if (mag > 0.001) {
      var run = mag >= RUN_THRESHOLD || keys.shift;
      var spd = run ? RUN_SPD : WALK_SPD * clamp(mag / RUN_THRESHOLD, 0.35, 1);
      var dx = (ix / mag) * spd * dt, dy = (iy / mag) * spd * dt;
      player.dx = ix / mag; player.dy = iy / mag;

      var ox = player.x, oy = player.y;
      moveEntity(player, dx, dy, PLAYER_R);
      var moved = Math.hypot(player.x - ox, player.y - oy);

      /* 一定距離ごとに足音 */
      player.stepAcc += moved;
      var interval = run ? 1.25 : 0.90;
      if (player.stepAcc >= interval) {
        player.stepAcc = 0;
        var inWater = isWater(player.x, player.y);
        var cfg = inWater ? SND.water : (run ? SND.run : SND.walk);
        emit(player.x, player.y, cfg, T_WHITE);
        SFX.step(run ? 1 : 0, inWater, 0);
        if (inWater) vibrate(18);
      }
    }

    /* 遺物 */
    for (var i = 0; i < relics.length; i++) {
      var r = relics[i];
      if (r.got) continue;
      if (Math.hypot(r.x - player.x, r.y - player.y) < 0.6) {
        r.got = true;
        relicsLeft--;
        updateRelicHud();
        SFX.pickup();
        emit(r.x, r.y, SND.beacon, T_GOLD);
        vibrate([20, 40, 20]);
      }
    }

    /* 出口 */
    if (relicsLeft === 0 &&
        Math.hypot(exitPos.x - player.x, exitPos.y - player.y) < 0.7) {
      win();
    }
  }

  /* ---------------- 目印の脈動 ---------------- */

  function updateBeacons(dt) {
    beaconT -= dt;
    if (beaconT <= 0) {
      var open = relicsLeft === 0;
      beaconT = open ? 2.2 : 3.6;
      var cfg = open ? SND.beacon : { n: 16, spd: 6.0, life: 0.75, hear: 0 };
      emit(exitPos.x, exitPos.y, cfg, T_GOLD);
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
            emit(relics[i].x, relics[i].y, { n: 14, spd: 5.5, life: 0.8, hear: 0 }, T_GOLD);
          }
        }
      }
    }
  }

  /* ---------------- 描画 ---------------- */

  function drawWorld() {
    /* 残像を少しずつ闇に沈める */
    tctx.globalCompositeOperation = 'source-over';
    tctx.fillStyle = 'rgba(0,0,0,0.135)';
    tctx.fillRect(0, 0, trail.width, trail.height);

    tctx.globalCompositeOperation = 'lighter';
    tctx.lineCap = 'round';
    tctx.lineWidth = 1.7;

    for (var t = 0; t < 3; t++) {
      var col = COLORS[t];
      for (var b = 0; b < BUCKETS; b++) {
        var bi = t * BUCKETS + b;
        var n = segLen[bi];
        if (n === 0) continue;
        var a = (0.09 + b * 0.17) * (t === T_RED ? 1.15 : 1.0);
        tctx.strokeStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + a.toFixed(3) + ')';
        tctx.beginPath();
        var buf = segBuf[bi];
        for (var k = 0; k < n; k += 4) {
          tctx.moveTo(buf[k] * TILE, buf[k + 1] * TILE);
          tctx.lineTo(buf[k + 2] * TILE, buf[k + 3] * TILE);
        }
        tctx.stroke();
      }
    }

    /* 反射点 */
    for (var t2 = 0; t2 < 3; t2++) {
      var n2 = hitLen[t2];
      if (n2 === 0) continue;
      var c2 = COLORS[t2], hb = hitBuf[t2];
      tctx.fillStyle = 'rgba(' + c2[0] + ',' + c2[1] + ',' + c2[2] + ',0.30)';
      for (var h = 0; h < n2; h += 3) {
        var s2 = 1.2 + hb[h + 2] * 1.9;
        tctx.fillRect(hb[h] * TILE - s2 / 2, hb[h + 1] * TILE - s2 / 2, s2, s2);
      }
    }

    /* 自分の足 ― 常にうっすら見えている */
    if (player.alive) {
      var px = player.x * TILE, py = player.y * TILE;
      var nx = -player.dy, ny = player.dx;
      tctx.fillStyle = 'rgba(200,220,255,0.30)';
      for (var s = -1; s <= 1; s += 2) {
        tctx.beginPath();
        tctx.arc(px + nx * s * 3.4, py + ny * s * 3.4, 1.7, 0, 6.2832);
        tctx.fill();
      }
    }
    tctx.globalCompositeOperation = 'source-over';
  }

  function drawScreen() {
    var cw = cv.width, ch = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);

    /* ステージが小さければ全体が収まるように縮める（縦横比は保つ） */
    var viewH = VIEW_TILES * TILE;
    var viewW = viewH * (cw / ch);
    var fit = Math.min(1, trail.width / viewW, trail.height / viewH);
    viewW *= fit; viewH *= fit;

    var sx = clamp(player.x * TILE - viewW / 2, 0, Math.max(0, trail.width - viewW));
    var sy = clamp(player.y * TILE - viewH / 2, 0, Math.max(0, trail.height - viewH));

    ctx.drawImage(trail, sx, sy, viewW, viewH, 0, 0, cw, ch);

    /* 周辺減光 */
    var g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.30,
                                     cw / 2, ch / 2, Math.max(cw, ch) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);

    /* 操作中のスティックをうっすら表示 */
    if (mode === 'play' && stick.active && stick.pointerId !== null) {
      /* stick は CSS ピクセル基準なので描画解像度に合わせる */
      var s = dpr;
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.arc(stick.ox * s, stick.oy * s, stick.radius * s, 0, 6.2832);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
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
    SFX.death();
    vibrate([90, 50, 200]);
    emit(player.x, player.y, { n: 90, spd: 7, life: 1.6, hear: 0 }, T_RED);

    elFlash.classList.add('on');
    setTimeout(function () { elFlash.classList.remove('on'); }, 60);

    setTimeout(function () {
      if (mode !== 'dead') return;
      $('deadMsg').textContent = deathCause;
      elHud.classList.add('hidden');
      show('dead');
    }, 1100);
  }

  function win() {
    if (!player.alive || mode !== 'play') return;
    player.alive = false;
    mode = 'clear';
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

  /* ---------------- 入力 ---------------- */

  var stick = {
    active: false, pointerId: null,
    ox: 0, oy: 0, mx: 0, my: 0, radius: 64,
    downT: 0, moved: 0
  };
  var keys = { up: 0, down: 0, left: 0, right: 0, shift: false };

  function doClap() {
    if (mode !== 'play' || clapCd > 0 || !player.alive) return;
    clapCd = CLAP_COOL;
    emit(player.x, player.y, SND.clap, T_WHITE);
    SFX.clap(0);
    vibrate(35);
  }

  function pointerPos(e) {
    var r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  cv.addEventListener('pointerdown', function (e) {
    if (mode !== 'play') return;
    if (stick.pointerId !== null) return;
    e.preventDefault();
    var p = pointerPos(e);
    stick.pointerId = e.pointerId;
    stick.active = true;
    stick.ox = p.x; stick.oy = p.y;
    stick.mx = 0; stick.my = 0;
    stick.downT = performance.now();
    stick.moved = 0;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  });

  cv.addEventListener('pointermove', function (e) {
    if (stick.pointerId !== e.pointerId) return;
    e.preventDefault();
    var p = pointerPos(e);
    var dx = p.x - stick.ox, dy = p.y - stick.oy;
    var d = Math.hypot(dx, dy);
    stick.moved = Math.max(stick.moved, d);
    /* 指が離れすぎたら原点を引きずる */
    if (d > stick.radius) {
      stick.ox += dx * (1 - stick.radius / d);
      stick.oy += dy * (1 - stick.radius / d);
      dx = p.x - stick.ox; dy = p.y - stick.oy; d = stick.radius;
    }
    stick.mx = dx / stick.radius;
    stick.my = dy / stick.radius;
  });

  function endPointer(e) {
    if (stick.pointerId !== e.pointerId) return;
    var dur = performance.now() - stick.downT;
    if (dur < 240 && stick.moved < 14) doClap();
    stick.pointerId = null;
    stick.active = false;
    stick.mx = 0; stick.my = 0;
  }
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);

  window.addEventListener('keydown', function (e) {
    if (!e.key) return;
    var k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') keys.up = 1;
    else if (k === 's' || k === 'arrowdown') keys.down = 1;
    else if (k === 'a' || k === 'arrowleft') keys.left = 1;
    else if (k === 'd' || k === 'arrowright') keys.right = 1;
    else if (k === 'shift') keys.shift = true;
    else if (k === ' ') { e.preventDefault(); doClap(); }
    else if (k === 'escape' && mode === 'play') pause();
    else return;
    if (k !== 'escape') e.preventDefault();
  });

  window.addEventListener('keyup', function (e) {
    if (!e.key) return;
    var k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') keys.up = 0;
    else if (k === 's' || k === 'arrowdown') keys.down = 0;
    else if (k === 'a' || k === 'arrowleft') keys.left = 0;
    else if (k === 'd' || k === 'arrowright') keys.right = 0;
    else if (k === 'shift') keys.shift = false;
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

  /* ボタン配線 */
  $('startBtn').addEventListener('click', function () {
    SFX.init();
    /* 没入感のため全画面へ（対応していなければ黙って続行） */
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

  /* ---------------- メインループ ---------------- */

  var acc = 0, last = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    var el = Math.min((now - last) / 1000, 0.1);
    last = now;

    if (mode !== 'play' && mode !== 'dead' && mode !== 'clear') return;

    acc += el;
    clearSegments();
    var steps = 0;
    while (acc >= DT && steps < 6) {
      acc -= DT;
      steps++;
      if (mode === 'play') {
        elapsed += DT;
        applyKeyboard();
        updatePlayer(DT);
        updateBeasts(DT);
        updateBeacons(DT);
        updateTension(DT);
        if (clapCd > 0) clapCd = Math.max(0, clapCd - DT);
      }
      updateRays(DT);
    }

    drawWorld();
    drawScreen();
    elClapFill.style.transform = 'scaleX(' + (1 - clapCd / CLAP_COOL).toFixed(3) + ')';
  }

  /* ---------------- 起動 ---------------- */

  loadProgress();
  resize();
  show('title');
  requestAnimationFrame(frame);
})();
