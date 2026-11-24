/*
  Pure game rules for the server side (no database, no network), so they can
  be tested in Node. lib/server/game.ts does the I/O around these functions.
*/
import Sim, { type Klass } from "../game/sim";

export type Progress = {
  bests: number[]; // record per arena
  arenas: number; // arenas 0..arenas-1 are unlocked
  arena: number; // chosen arena
  xp: number;
  skin: number; // chosen skin
  seq: number; // goes up with every finished run
};
export type PublicProgress = Omit<Progress, "seq">;
export type RunInfo = { seq: number; arena: number; seed: number; startedAt: number };
export type CompRunInfo = { seed: number; startedAt: number };
export type FinishResult = {
  score: number;
  won: boolean;
  xpGained: number;
  newBest: boolean;
  unlockedArena: boolean;
  allCleared: boolean;
};
export type RunError = { error: "rejected" | "stale" };

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
const isInt = (v: unknown, a: number, b: number): v is number =>
  Number.isInteger(v) && (v as number) >= a && (v as number) <= b;

const newProgress = (): Progress => ({
  bests: Array<number>(ARENA_COUNT).fill(0),
  arenas: 1, // arenas 0..arenas-1 are unlocked
  arena: 0, // chosen arena
  xp: 0,
  skin: 0, // chosen skin
  seq: 0, // goes up with every finished run
});
const publicProgress = (p: Progress): PublicProgress => ({
  bests: p.bests,
  arenas: p.arenas,
  arena: p.arena,
  xp: p.xp,
  skin: p.skin,
});
const canPlayArena = (p: Progress, arena: unknown): arena is number =>
  isInt(arena, 0, p.arenas - 1);
const canUseSkin = (p: Progress, skin: unknown): skin is number =>
  isInt(skin, 0, SKIN_XP.length - 1) && SKIN_XP[skin] <= p.xp;

/*
  p   = progress row, run = {seq, arena, seed, startedAt (ms)}.
  Returns {error} or {next, result}. `next` is the new progress row.
*/
function computeFinish(
  p: Progress,
  run: RunInfo,
  inputs: unknown,
  frames: unknown,
  now: number,
): RunError | { error?: undefined; next: Progress; result: FinishResult } {
  if (!Array.isArray(inputs) || inputs.length > MAX_FRAMES)
    return { error: "rejected" };
  if (!isInt(frames, 1, MAX_FRAMES)) return { error: "rejected" };
  let prev = -1;
  for (const n of inputs as unknown[]) {
    if (!isInt(n, 0, frames - 1) || n <= prev) return { error: "rejected" };
    prev = n;
  }
  if (run.seq !== p.seq) return { error: "stale" };
  const age = now - run.startedAt;
  if (!(age >= 0) || age > RUN_TTL) return { error: "rejected" };

  const r = Sim.replay(run.seed, inputs as number[], frames);
  // a run can't be played faster than real time (60 steps per second)
  if (age < (r.frames / 60) * 1000 * 0.8 - 2000) return { error: "rejected" };

  const next: Progress = { ...p, bests: p.bests.slice(), seq: p.seq + 1 };
  const result: FinishResult = {
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
function computeCompetition(
  run: CompRunInfo,
  inputs: unknown,
  frames: unknown,
  now: number,
): RunError | { error?: undefined; result: { score: number; frames: number } } {
  if (!Array.isArray(inputs) || inputs.length > MAX_FRAMES_COMP)
    return { error: "rejected" };
  if (!isInt(frames, 1, MAX_FRAMES_COMP)) return { error: "rejected" };
  let prev = -1;
  for (const n of inputs as unknown[]) {
    if (!isInt(n, 0, frames - 1) || n <= prev) return { error: "rejected" };
    prev = n;
  }
  const age = now - run.startedAt;
  if (!(age >= 0) || age > RUN_TTL_COMP) return { error: "rejected" };
  const r = Sim.replay(run.seed, inputs as number[], frames, true);
  if (age < (r.frames / 60) * 1000 * 0.8 - 2000) return { error: "rejected" };
  return { result: { score: r.score, frames: r.frames } };
}

// a name for the leaderboard: 1-20 visible characters, no control characters
function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const len = Array.from(s).length;
  return len >= 1 && len <= 20 ? s : null;
}
const isClass = (k: unknown): k is Klass =>
  typeof k === "string" && (CLASSES as readonly string[]).includes(k);
function validCompetitor(name: unknown, klass: unknown): { name: string; klass: Klass } | null {
  const n = cleanName(name);
  return n && isClass(klass) ? { name: n, klass } : null;
}

export {
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
