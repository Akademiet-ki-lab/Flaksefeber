/*
  Deterministic game simulation, shared by the browser and the server.

  The browser plays the game with this code, and records every flap. The server
  replays the same flaps with the same seed and gets the same result, so the
  score, XP and unlocks can't be faked from the client.

  Rules for this file: fixed time step (one step = 1/60 s), no Math.random
  (seeded RNG only), no Math.hypot/sin/cos (only exact IEEE operations), no
  DOM access.

  It is an ES module, so nothing ends up on `window` in the browser.
*/
const CONST = Object.freeze({
  W: 400,
  H: 640,
  GROUND: 552,
  GAP_MIN: 126,
  GAP_MAX: 146,
  SPACING: 215,
  GOAL: 100,
  BASE_SPEED: 2.4,
  STEP_EVERY: 20,
  STEP_BOOST: 0.4,
  GRAV: 0.38,
  FLAP: -6.9,
  MAXFALL: 9.5,
  R: 11,
  FEATHER_AT: 40,
  INVULN: 75,
  MAX_XP: 200,
  TREES_PER_XP: 10,
  EAGLE_X: 110,
  START_Y: 290,
  MAX_FRAMES: 20000, // hard cap for one run (about 5.5 minutes)
  // Competition mode: no goal, the course just keeps coming and gets faster.
  COMP_STEP_EVERY: 10, // trees between each speed increase
  COMP_STEP_BOOST: 0.15,
  COMP_MAX_SPEED: 7.5, // the eagle never moves more than this far per step
  MAX_FRAMES_COMP: 108000, // technical cap for one run (30 minutes)
  CLASSES: Object.freeze([
    "1IM",
    "2IM",
    "1MK",
    "2MK",
    "3MK",
    "1STA",
    "2STA",
    "3STA",
    "1STB",
    "2STB",
    "3STB",
    "Påbygg",
    "Lærere",
  ]),
  ARENA_COUNT: 10,
  SKIN_XP: Object.freeze([0, 20, 40, 70, 100, 140, 200]),
});
const {
  W,
  GROUND,
  GAP_MIN,
  GAP_MAX,
  SPACING,
  GOAL,
  BASE_SPEED,
  STEP_EVERY,
  STEP_BOOST,
  COMP_STEP_EVERY,
  COMP_STEP_BOOST,
  COMP_MAX_SPEED,
  GRAV,
  FLAP,
  MAXFALL,
  R,
  FEATHER_AT,
  INVULN,
  TREES_PER_XP,
  EAGLE_X,
  START_Y,
} = CONST;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// mulberry32: small, fast, fully deterministic
function rngFrom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTree(s, x) {
  const rnd = s.rng;
  const gap = GAP_MIN + rnd() * (GAP_MAX - GAP_MIN);
  const minTop = 55,
    maxTop = GROUND - 55 - gap;
  // anywhere in the full height, but limit the jump from the previous opening
  const target = minTop + rnd() * (maxTop - minTop);
  const gapTop = clamp(target, s.lastGapTop - 230, s.lastGapTop + 230);
  s.lastGapTop = gapTop;
  const gapBottom = gapTop + gap;
  const hT = gapTop + 30,
    hB = GROUND + 8 - gapBottom;
  return {
    x,
    seed: Math.floor(rnd() * 1000),
    gapTop,
    gapBottom,
    scored: false,
    feather: false,
    wT: clamp(58 + hT * 0.3, 72, 128),
    wB: clamp(58 + hB * 0.3, 72, 128),
  };
}

function hitTree(s, t) {
  const parts = [
    { tip: t.gapBottom, base: GROUND + 8, w: t.wB, dir: 1 },
    { tip: t.gapTop, base: -30, w: t.wT, dir: -1 },
  ];
  for (const p of parts) {
    const h = Math.abs(p.base - p.tip);
    for (const dy of [-R, -R / 2, 0, R / 2, R]) {
      const yy = s.y + dy;
      const d = (yy - p.tip) * p.dir;
      if (d < 0 || d > h) continue;
      const hw = (((d / h) * p.w) / 2) * 0.8;
      const reach = Math.sqrt(R * R - dy * dy);
      if (Math.abs(EAGLE_X - t.x) < hw + reach * 0.9) return true;
    }
  }
  return false;
}

// comp = competition mode (no goal, faster every COMP_STEP_EVERY trees)
function create(seed, comp) {
  const s = {
    comp: !!comp,
    rng: rngFrom(seed),
    status: "play", // play | dead | won
    frame: 0, // steps taken so far
    y: START_Y,
    vy: 0,
    speed: BASE_SPEED,
    score: 0,
    trees: [],
    lastGapTop: 170,
    feather: false, // golden feather picked up and not yet used
    invuln: 0,
    featherDue: false,
    featherSpawned: false,
  };
  s.trees = [makeTree(s, W + 130)];
  return s;
}

/*
  Advance one step. `flap` = the player pressed during this step.
  Returns the events of this step (the browser uses them for effects).
*/
function step(s, flap) {
  const ev = { scored: 0, xpTicks: 0, pickup: null, featherUsed: false };
  if (s.status !== "play") return ev;
  const frame = s.frame++;
  if (flap || frame === 0) s.vy = FLAP; // the first step always flaps

  // faster every STEP_EVERY trees, eased in smoothly
  const target = s.comp
    ? Math.min(
        COMP_MAX_SPEED,
        BASE_SPEED + Math.floor(s.score / COMP_STEP_EVERY) * COMP_STEP_BOOST,
      )
    : BASE_SPEED + Math.floor(s.score / STEP_EVERY) * STEP_BOOST;
  s.speed += (target - s.speed) * 0.04;
  s.vy = Math.min(s.vy + GRAV, MAXFALL);
  s.y += s.vy;
  if (s.y < 10) {
    s.y = 10;
    if (s.vy < 0) s.vy = 0;
  }

  const trees = s.trees;
  for (const t of trees) t.x -= s.speed;
  while (trees.length && trees[0].x < -90) trees.shift();
  const last = trees[trees.length - 1];
  if (!last || last.x < W + 130 - SPACING)
    trees.push(makeTree(s, (last ? last.x : W + 130 - SPACING) + SPACING));

  for (const t of trees) {
    if (!t.scored && t.x < EAGLE_X) {
      t.scored = true;
      s.score++;
      ev.scored++;
      if (s.score % TREES_PER_XP === 0) ev.xpTicks++;
      if (s.score === FEATHER_AT && !s.featherSpawned) s.featherDue = true;
      if (!s.comp && s.score >= GOAL) {
        s.status = "won";
        return ev;
      }
    }
  }

  // golden feather: in the gap of the furthest tree, ahead of the eagle
  if (s.featherDue) {
    const ahead = trees[trees.length - 1];
    if (ahead && !ahead.scored) {
      ahead.feather = true;
      s.featherDue = false;
      s.featherSpawned = true;
    }
  }
  for (const t of trees) {
    if (!t.feather) continue;
    const fy = (t.gapTop + t.gapBottom) / 2;
    const dx = t.x - EAGLE_X,
      dy = fy - s.y;
    if (Math.sqrt(dx * dx + dy * dy) < 34) {
      t.feather = false;
      s.feather = true;
      ev.pickup = { x: t.x, y: fy };
    }
  }

  if (s.y + R >= GROUND - 2) {
    s.status = "dead";
    s.feather = false;
    return ev;
  }
  if (s.invuln > 0) s.invuln = Math.max(0, s.invuln - 1);
  for (const t of trees) {
    if (Math.abs(t.x - EAGLE_X) < 90 && hitTree(s, t)) {
      if (s.invuln > 0) continue;
      if (s.feather) {
        // the golden feather absorbs one hit
        s.feather = false;
        s.invuln = INVULN;
        s.vy = FLAP * 0.6;
        ev.featherUsed = true;
        continue;
      }
      s.status = "dead";
      return ev;
    }
  }
  return ev;
}

/*
  Replay a whole run. `inputs` = ascending step numbers where the player
  flapped. Runs until the eagle dies, wins, or `frames` steps are used.
*/
function replay(seed, inputs, frames, comp) {
  const s = create(seed, comp);
  const set = new Set(inputs);
  const max = Math.min(frames, comp ? CONST.MAX_FRAMES_COMP : CONST.MAX_FRAMES);
  while (s.status === "play" && s.frame < max) step(s, set.has(s.frame));
  return {
    score: s.score,
    won: s.status === "won",
    dead: s.status === "dead",
    frames: s.frame,
  };
}

const Sim = Object.freeze({ CONST, create, step, replay, rngFrom });
export default Sim;
export { CONST, create, step, replay, rngFrom };
