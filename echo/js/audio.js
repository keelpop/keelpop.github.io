/* ============================================================
   残響 — 音響エンジン
   すべての音を Web Audio API で合成する（音声ファイル不要）。
   ============================================================ */

var SFX = (function () {
  'use strict';

  var ctx = null;
  var master, revSend, revNode, noiseBuf;
  var drone = null;
  var ready = false;

  function makeNoise() {
    var len = Math.floor(ctx.sampleRate * 2);
    var b = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  /* 洞窟らしい残響インパルス応答を生成 */
  function makeIR(sec, decay) {
    var len = Math.floor(ctx.sampleRate * sec);
    var b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = b.getChannelData(c);
      for (var i = 0; i < len; i++) {
        var t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.2);
      }
    }
    return b;
  }

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ready;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);

    revNode = ctx.createConvolver();
    revNode.buffer = makeIR(2.8, 2.2);
    revSend = ctx.createGain();
    revSend.gain.value = 0.6;
    revSend.connect(revNode);
    revNode.connect(master);

    noiseBuf = makeNoise();
    ready = true;
    return true;
  }

  function now() { return ctx.currentTime; }

  /* パンナー（非対応環境ではダミーGainを返す） */
  function panner(v) {
    if (ctx.createStereoPanner) {
      var p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, v || 0));
      return p;
    }
    return ctx.createGain();
  }

  /* node の出力を dry(master) と reverb send に分配 */
  function route(node, send) {
    node.connect(master);
    if (send > 0) {
      var g = ctx.createGain();
      g.gain.value = send;
      node.connect(g);
      g.connect(revSend);
    }
  }

  function env(g, t, peak, atk, rel) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + atk + rel);
  }

  /* ---------------- 足音 ---------------- */
  /* loud: 0=歩き 1=走り  water: 水たまり */
  function step(loud, water, pan) {
    if (!ready) return;
    var t = now();
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.5;

    var f = ctx.createBiquadFilter();
    if (water) {
      f.type = 'bandpass';
      f.frequency.value = 1500 + Math.random() * 900;
      f.Q.value = 0.9;
    } else {
      f.type = 'lowpass';
      f.frequency.value = 380 + loud * 420 + Math.random() * 140;
      f.Q.value = 1.1;
    }

    var g = ctx.createGain();
    var peak = water ? 0.34 : (0.16 + loud * 0.16);
    env(g, t, peak, 0.006, water ? 0.30 : 0.13);

    var p = panner(pan);
    src.connect(f); f.connect(g); g.connect(p);
    route(p, water ? 0.7 : 0.45 + loud * 0.2);
    src.start(t);
    src.stop(t + 0.6);
  }

  /* ---------------- 手を叩く ---------------- */
  function clap(pan) {
    if (!ready) return;
    var t = now();
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;

    var f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.7;

    var g = ctx.createGain();
    env(g, t, 0.42, 0.003, 0.09);

    var p = panner(pan);
    src.connect(f); f.connect(g); g.connect(p);
    route(p, 1.0);
    src.start(t);
    src.stop(t + 0.5);
  }

  /* ---------------- 化け物のうめき ---------------- */
  /* prox: 0(遠い)〜1(至近) */
  function growl(prox, pan) {
    if (!ready || prox <= 0.02) return;
    var t = now();

    var osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(38 + Math.random() * 14, t);
    osc.frequency.linearRampToValueAtTime(26 + Math.random() * 10, t + 0.9);

    var n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    n.loop = true;
    n.playbackRate.value = 0.25;

    var nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 260 + prox * 500;

    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 180 + prox * 340;
    f.Q.value = 3;

    var g = ctx.createGain();
    env(g, t, 0.10 + prox * 0.30, 0.18, 0.85);

    var ng = ctx.createGain();
    ng.gain.value = 0.35;

    var p = panner(pan);
    osc.connect(f); f.connect(g);
    n.connect(nf); nf.connect(ng); ng.connect(g);
    g.connect(p);
    route(p, 0.5);

    osc.start(t); osc.stop(t + 1.3);
    n.start(t); n.stop(t + 1.3);
  }

  /* ---------------- 心臓の鼓動 ---------------- */
  function heart(prox) {
    if (!ready) return;
    var t = now();
    for (var i = 0; i < 2; i++) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      var s = t + i * 0.17;
      o.frequency.setValueAtTime(72, s);
      o.frequency.exponentialRampToValueAtTime(34, s + 0.14);
      var g = ctx.createGain();
      env(g, s, (i === 0 ? 0.34 : 0.22) * (0.35 + prox * 0.65), 0.012, 0.14);
      o.connect(g);
      route(g, 0.15);
      o.start(s); o.stop(s + 0.32);
    }
  }

  /* ---------------- 遺物を拾う ---------------- */
  function pickup() {
    if (!ready) return;
    var t = now();
    var fr = [880, 1320, 1760];
    for (var i = 0; i < fr.length; i++) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fr[i];
      var g = ctx.createGain();
      env(g, t + i * 0.07, 0.14, 0.01, 0.5);
      o.connect(g);
      route(g, 0.8);
      o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.7);
    }
  }

  /* ---------------- 出口の合図 ---------------- */
  function beacon(pan, strong) {
    if (!ready) return;
    var t = now();
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = strong ? 523.25 : 392.0;
    var g = ctx.createGain();
    env(g, t, strong ? 0.10 : 0.05, 0.02, 1.1);
    var p = panner(pan);
    o.connect(g); g.connect(p);
    route(p, 0.9);
    o.start(t); o.stop(t + 1.4);
  }

  /* ---------------- 死 ---------------- */
  function death() {
    if (!ready) return;
    var t = now();
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 1.1);
    var g = ctx.createGain();
    env(g, t, 0.5, 0.005, 1.3);
    src.connect(f); f.connect(g);
    route(g, 0.7);
    src.start(t); src.stop(t + 1.6);

    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 1.2);
    var g2 = ctx.createGain();
    env(g2, t, 0.3, 0.01, 1.2);
    o.connect(g2);
    route(g2, 0.4);
    o.start(t); o.stop(t + 1.5);
  }

  /* ---------------- 脱出 ---------------- */
  function clear() {
    if (!ready) return;
    var t = now();
    var fr = [261.6, 392.0, 523.3, 784.0];
    for (var i = 0; i < fr.length; i++) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fr[i];
      var g = ctx.createGain();
      env(g, t + i * 0.16, 0.12, 0.05, 1.8);
      o.connect(g);
      route(g, 1.0);
      o.start(t + i * 0.16); o.stop(t + i * 0.16 + 2.2);
    }
  }

  /* ---------------- 環境音（低いドローン + 風） ---------------- */
  function ambient(on) {
    if (!ready) return;
    if (on) {
      if (drone) return;
      var t = now();
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 3);
      g.connect(master);

      var o1 = ctx.createOscillator();
      o1.type = 'sine'; o1.frequency.value = 41.2;
      var o2 = ctx.createOscillator();
      o2.type = 'triangle'; o2.frequency.value = 61.9;
      var g2 = ctx.createGain(); g2.gain.value = 0.35;
      o2.connect(g2); g2.connect(g);
      o1.connect(g);

      /* ゆっくり揺れる風 */
      var n = ctx.createBufferSource();
      n.buffer = noiseBuf; n.loop = true; n.playbackRate.value = 0.18;
      var nf = ctx.createBiquadFilter();
      nf.type = 'lowpass'; nf.frequency.value = 220; nf.Q.value = 2;
      var ng = ctx.createGain(); ng.gain.value = 0.5;
      var lfo = ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 0.07;
      var lg = ctx.createGain(); lg.gain.value = 0.3;
      lfo.connect(lg); lg.connect(ng.gain);
      n.connect(nf); nf.connect(ng); ng.connect(g);

      o1.start(t); o2.start(t); n.start(t); lfo.start(t);
      drone = { g: g, nodes: [o1, o2, n, lfo] };
    } else if (drone) {
      var d = drone, tt = now();
      drone = null;
      d.g.gain.cancelScheduledValues(tt);
      d.g.gain.setValueAtTime(Math.max(0.0002, d.g.gain.value), tt);
      d.g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.2);
      setTimeout(function () {
        for (var i = 0; i < d.nodes.length; i++) { try { d.nodes[i].stop(); } catch (e) {} }
      }, 1500);
    }
  }

  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  return {
    init: init, step: step, clap: clap, growl: growl, heart: heart,
    pickup: pickup, beacon: beacon, death: death, clear: clear,
    ambient: ambient, suspend: suspend, resume: resume,
    isReady: function () { return ready; }
  };
})();
