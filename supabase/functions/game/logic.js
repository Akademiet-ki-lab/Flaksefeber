/*
  Pure game rules for the server side (no database, no network), so they can
  be tested in Node. index.ts does the I/O around these functions.
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./sim.js"));
  else root.GameLogic = factory(root.Sim);
})(typeof self !== "undefined" ? self : this, function (Sim) {
  "use strict";
  const {
    GOAL,
    MAX_XP,
    TREES_PER_XP,
    ARENA_COUNT,
    SKIN_XP,
    MAX_FRAMES,
    MAX_FRAMES_COMP,
    CLASSES,
  } = Sim.CONST;
  const RUN_TTL = 30 * 60 * 1000;
  const RUN_TTL_COMP = 60 * 60 * 1000;
  const isInt = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;

  const newProgress = () => ({
    bests: Array(ARENA_COUNT).fill(0),
    arenas: 1, // arenas 0..arenas-1 are unlocked
    arena: 0, // chosen arena
    xp: 0,
    skin: 0, // chosen skin
    seq: 0, // goes up with every finished run
  });
  const publicProgress = (p) => ({
    bests: p.bests,
    arenas: p.arenas,
    arena: p.arena,
    xp: p.xp,
    skin: p.skin,
  });
  const canPlayArena = (p, arena) => isInt(arena, 0, p.arenas - 1);
  const canUseSkin = (p, skin) =>
    isInt(skin, 0, SKIN_XP.length - 1) && SKIN_XP[skin] <= p.xp;

  /*
    p   = progress row, run = {seq, arena, seed, startedAt (ms)}.
    Returns {error} or {next, result}. `next` is the new progress row.
  */
  function computeFinish(p, run, inputs, frames, now) {
    if (!Array.isArray(inputs) || inputs.length > MAX_FRAMES)
      return { error: "rejected" };
    if (!isInt(frames, 1, MAX_FRAMES)) return { error: "rejected" };
    let prev = -1;
    for (const n of inputs) {
      if (!isInt(n, 0, frames - 1) || n <= prev) return { error: "rejected" };
      prev = n;
    }
    if (run.seq !== p.seq) return { error: "stale" };
    const age = now - run.startedAt;
    if (!(age >= 0) || age > RUN_TTL) return { error: "rejected" };

    const r = Sim.replay(run.seed, inputs, frames);
    // a run can't be played faster than real time (60 steps per second)
    if (age < (r.frames / 60) * 1000 * 0.8 - 2000) return { error: "rejected" };

    const next = { ...p, bests: p.bests.slice(), seq: p.seq + 1 };
    const result = {
      score: r.score,
      won: r.won,
      xpGained: 0,
      newBest: false,
      unlockedArena: false,
      allCleared: false,
    };
    if (r.score > next.bests[run.arena]) {
      next.bests[run.arena] = r.score;
      result.newBest = true;
    }
    const xp = Math.min(MAX_XP, next.xp + Math.floor(r.score / TREES_PER_XP));
    result.xpGained = xp - next.xp;
    next.xp = xp;
    if (r.won) {
      if (run.arena < ARENA_COUNT - 1) {
        const n = run.arena + 1;
        if (n + 1 > next.arenas) {
          next.arenas = n + 1;
          result.unlockedArena = true;
        }
        next.arena = n;
      } else result.allCleared = true;
    }
    return { next, result };
  }

  /*
    Competition run: no progress, XP or unlocks, only a score for the
    leaderboard. run = {seed, startedAt (ms)}. Returns {error} or {result}.
  */
  function computeCompetition(run, inputs, frames, now) {
    if (!Array.isArray(inputs) || inputs.length > MAX_FRAMES_COMP)
      return { error: "rejected" };
    if (!isInt(frames, 1, MAX_FRAMES_COMP)) return { error: "rejected" };
    let prev = -1;
    for (const n of inputs) {
      if (!isInt(n, 0, frames - 1) || n <= prev) return { error: "rejected" };
      prev = n;
    }
    const age = now - run.startedAt;
    if (!(age >= 0) || age > RUN_TTL_COMP) return { error: "rejected" };
    const r = Sim.replay(run.seed, inputs, frames, true);
    if (age < (r.frames / 60) * 1000 * 0.8 - 2000) return { error: "rejected" };
    return { result: { score: r.score, frames: r.frames } };
  }

  // a name for the leaderboard: 1-20 visible characters, no control characters
  function cleanName(v) {
    if (typeof v !== "string") return null;
    const s = v
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069<>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const len = Array.from(s).length;
    return len >= 1 && len <= 20 ? s : null;
  }
  const isClass = (k) => typeof k === "string" && CLASSES.includes(k);
  function validCompetitor(name, klass) {
    const n = cleanName(name);
    return n && isClass(klass) ? { name: n, klass } : null;
  }

  return {
    computeCompetition,
    cleanName,
    isClass,
    validCompetitor,
    CLASSES,
    newProgress,
    publicProgress,
    canPlayArena,
    canUseSkin,
    computeFinish,
    GOAL,
  };
});
