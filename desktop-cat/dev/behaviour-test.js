/*
 * dev/behaviour-test.js — drives the brain with synthetic sensors and checks
 * that each advertised behaviour actually fires.
 *
 *   node dev/behaviour-test.js
 *
 * Pure Node: rig.js and brain.js have no DOM dependencies, so the whole
 * behaviour layer is testable without a display.
 */
'use strict';

global.window = global;
require('../src/renderer/rig.js');
require('../src/renderer/brain.js');

const STAGE = { x0: 0, y0: 0, x1: 1440, y1: 860 };
const DT = 1 / 60;

let failures = 0;

function fresh(overrides) {
  const rig = new global.CatRig.Rig({ x: 500, y: 700, scale: 1 });
  const brain = new global.CatBrain.CatBrain(rig, overrides);
  brain.setStage(STAGE);
  rig.snapToPose();
  return { rig, brain };
}

/**
 * Step the simulation, calling `sensorFn(t, brain, rig)` for each frame's
 * sensor payload. Stops early when `until(brain)` is satisfied.
 */
function run(ctx, seconds, sensorFn, until) {
  const { rig, brain } = ctx;
  const steps = Math.round(seconds / DT);
  const seen = new Set();
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    brain.update(DT, sensorFn(t, brain, rig));
    rig.update(DT);
    seen.add(brain.state);
    if (!Number.isFinite(rig.x) || !Number.isFinite(rig.y)) {
      throw new Error(`non-finite position after ${t.toFixed(2)}s`);
    }
    if (until && until(brain)) return { seen, t, stopped: true };
  }
  return { seen, t: seconds, stopped: false };
}

function check(name, ok, detail) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** A cursor sitting on the cat's flank. */
function onBody(rig) {
  const n = rig.spine[2];
  return { x: n.x, y: n.y };
}

// ---------------------------------------------------------------- petting --

section('stroking the cat');
{
  const ctx = fresh();
  // Oscillate across the body: back-and-forth is what reads as stroking.
  const res = run(ctx, 12, (t, brain, rig) => {
    const p = onBody(rig);
    return {
      cursorX: p.x + Math.sin(t * 9) * 26,
      cursorY: p.y,
      idleSec: 0, typing: false, dragging: false, stage: STAGE, occluders: [],
    };
  }, (b) => b.state === 'beingPetted');
  check('starts being stroked', res.stopped, `states: ${[...res.seen]}`);

  // Keep going: it should fill up and then take itself off.
  const res2 = run(ctx, 60, (t, brain, rig) => {
    const p = onBody(rig);
    return {
      cursorX: p.x + Math.sin(t * 9) * 26,
      cursorY: p.y,
      idleSec: 0, typing: false, dragging: false, stage: STAGE, occluders: [],
    };
  }, (b) => b.state === 'satisfiedLeave');
  check('walks off once satisfied', res2.stopped, `state: ${ctx.brain.state}`);
  check('will not be re-stroked immediately', ctx.brain.pet.cooldown > 30,
    `cooldown ${ctx.brain.pet.cooldown.toFixed(0)}s`);
}

// Simply passing the cursor over the cat must NOT count as affection.
{
  const ctx = fresh();
  const res = run(ctx, 8, (t, brain, rig) => ({
    // One straight sweep across the whole screen, through the cat.
    cursorX: (t / 8) * STAGE.x1,
    cursorY: rig.spine[2].y,
    idleSec: 0, typing: false, dragging: false, stage: STAGE, occluders: [],
  }));
  check('a single pass is not stroking', !res.seen.has('beingPetted'),
    `states: ${[...res.seen]}`);
}

// --------------------------------------------------------------- dragging --

section('watching you drag something');
{
  const ctx = fresh();
  const res = run(ctx, 6, (t) => ({
    cursorX: 700 + t * 40,
    cursorY: 300,
    idleSec: 0, typing: false, dragging: true, stage: STAGE, occluders: [],
  }), (b) => b.state === 'watchDrag');
  check('locks on while dragging', res.stopped, `states: ${[...res.seen]}`);
  check('pupils blown', ctx.rig.pupilTarget > 0.9, String(ctx.rig.pupilTarget));
  check('tail thrashing', ctx.rig.tailWhip > 0.9, String(ctx.rig.tailWhip));

  // Letting go should settle it again.
  const res2 = run(ctx, 10, () => ({
    cursorX: 900, cursorY: 300,
    idleSec: 0, typing: false, dragging: false, stage: STAGE, occluders: [],
  }), (b) => b.state !== 'watchDrag');
  check('relaxes after the drop', res2.stopped, `state: ${ctx.brain.state}`);
}

// ---------------------------------------------------------------- typing ---

section('sitting on your work while you type');
{
  const ctx = fresh();
  // A fresh cat holds off on mischief for the first half-minute or so; clear
  // that so the test measures the behaviour rather than the cooldown.
  ctx.brain.mischiefCooldown = 0;
  const windowRect = { x0: 200, y0: 120, x1: 1000, y1: 640 };
  // Park the cat off to one side so "walked to the window" means something.
  ctx.rig.x = 1300;
  ctx.rig.y = 800;
  ctx.rig.snapToPose();
  const res = run(ctx, 60, () => ({
    cursorX: 620, cursorY: 400,
    idleSec: 0, typing: true, dragging: false,
    stage: STAGE, occluders: [windowRect],
  }), (b) => b.state === 'sitOnWork');
  check('comes over and settles on the window', res.stopped,
    `states: ${[...res.seen]}`);
  if (res.stopped) {
    const inside = ctx.rig.x > windowRect.x0 && ctx.rig.x < windowRect.x1 &&
      ctx.rig.y > windowRect.y0 && ctx.rig.y < windowRect.y1;
    check('lands inside the window it targeted', inside,
      `pos=${ctx.rig.x.toFixed(0)},${ctx.rig.y.toFixed(0)} ` +
      `window=${windowRect.x0}..${windowRect.x1} / ${windowRect.y0}..${windowRect.y1}`);
    check('stays in front while sitting on your work', ctx.brain.wantsOnTop === true);
  }
}

// A freshly fed cat should leave you alone even while you type.
{
  const ctx = fresh();
  ctx.brain.feed(600, 700);
  run(ctx, 60, () => ({
    cursorX: 620, cursorY: 400,
    idleSec: 0, typing: false, dragging: false, stage: STAGE, occluders: [],
  }), (b) => b.calmT > 0);
  check('a meal buys peace and quiet', ctx.brain.calmT > 60,
    `calm ${ctx.brain.calmT.toFixed(0)}s`);
  const res = run(ctx, 45, () => ({
    cursorX: 620, cursorY: 400,
    idleSec: 0, typing: true, dragging: false, stage: STAGE, occluders: [],
  }));
  check('does not sit on your work while calm', !res.seen.has('goSitOnWork'),
    `states: ${[...res.seen]}`);
}

// ------------------------------------------------------------------ food ---

section('feeding');
{
  const ctx = fresh({ hunger: 0.9 });
  ctx.brain.feed(300, 720);
  check('bowl appears', !!ctx.brain.food);
  const res = run(ctx, 40, () => ({
    cursorX: 1200, cursorY: 200,
    idleSec: 0, typing: false, dragging: false, stage: STAGE, occluders: [],
  }), (b) => b.state === 'eat');
  check('walks to the bowl and eats', res.stopped, `states: ${[...res.seen]}`);

  const res2 = run(ctx, 30, () => ({
    cursorX: 1200, cursorY: 200,
    idleSec: 0, typing: false, dragging: false, stage: STAGE, occluders: [],
  }), (b) => b.food === null);
  check('finishes the bowl', res2.stopped);
  check('no longer hungry', ctx.brain.needs.hunger < 0.05,
    String(ctx.brain.needs.hunger.toFixed(2)));
}

// ------------------------------------------------------------------ hide ---

section('disappearing behind things');
{
  const ctx = fresh();
  ctx.brain.poke('hide');
  const res = run(ctx, 40, () => ({
    cursorX: 700, cursorY: 400,
    idleSec: 30, typing: false, dragging: false,
    stage: STAGE, occluders: [{ x0: 200, y0: 120, x1: 1000, y1: 640 }],
  }), (b) => b.state === 'hidden');
  check('reaches a hiding place', res.stopped, `states: ${[...res.seen]}`);
  check('drops behind the other windows', ctx.brain.wantsOnTop === false);

  const res2 = run(ctx, 60, () => ({
    cursorX: 700, cursorY: 400,
    idleSec: 30, typing: false, dragging: false,
    stage: STAGE, occluders: [{ x0: 200, y0: 120, x1: 1000, y1: 640 }],
  }), (b) => b.state === 'peek');
  check('comes back out to peek', res2.stopped, `state: ${ctx.brain.state}`);
  // `until` stops on the frame the state flips, before the new state's own
  // code has run, so give it a moment to actually start peeking.
  run(ctx, 1, () => ({
    cursorX: 700, cursorY: 400,
    idleSec: 30, typing: false, dragging: false,
    stage: STAGE, occluders: [{ x0: 200, y0: 120, x1: 1000, y1: 640 }],
  }));
  check('floats on top again to be seen', ctx.brain.wantsOnTop === true);
  check('is watching the cursor', ctx.rig.lookWeight > 0.9,
    `lookWeight ${ctx.rig.lookWeight.toFixed(2)} state ${ctx.brain.state}`);
}

// ------------------------------------------------------------------ play ---

section('batting at the cursor');
{
  const ctx = fresh();
  ctx.brain.poke('play');
  const res = run(ctx, 90, (t, brain, rig) => ({
    // Cursor twitching about just in front of its nose.
    cursorX: rig.x + 90 + Math.sin(t * 6) * 70,
    cursorY: rig.y - 30 + Math.cos(t * 5) * 40,
    idleSec: 0, typing: false, dragging: false, stage: STAGE, occluders: [],
  }), (b) => b.state === 'swat');
  check('stalks then swats', res.stopped, `states: ${[...res.seen]}`);
  check('a pounce or a stalk led into it',
    res.seen.has('stalk') || res.seen.has('pounce'), `states: ${[...res.seen]}`);
}

// ------------------------------------------------------------ endurance ---

section('long run');
{
  const ctx = fresh();
  const res = run(ctx, 3600, (t, brain, rig) => ({
    cursorX: 720 + Math.sin(t * 0.3) * 600,
    cursorY: 430 + Math.cos(t * 0.21) * 350,
    idleSec: t % 300 < 120 ? 200 : 0,
    typing: t % 300 > 200,
    dragging: t % 97 < 3,
    stage: STAGE, occluders: [{ x0: 200, y0: 120, x1: 1000, y1: 640 }],
  }));
  check('one simulated hour without breaking', true);
  check('visits a good spread of behaviours', res.seen.size >= 8,
    `${res.seen.size}: ${[...res.seen].join(', ')}`);
  const st = ctx.brain.stage;
  const inBounds = ctx.rig.x > st.x0 - 120 && ctx.rig.x < st.x1 + 120 &&
    ctx.rig.y > st.y0 && ctx.rig.y <= st.y1 + 1;
  check('stayed on screen', inBounds,
    `pos ${ctx.rig.x.toFixed(0)},${ctx.rig.y.toFixed(0)}`);
}

console.log(`\n${failures === 0 ? 'all behaviour checks passed' : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
