import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Sim from "../lib/game/sim.js";
import * as L from "../lib/server/logic.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log("ok  " + name);
};

// simple bot: aims for the middle of the next opening
function play(seed, maxFrames) {
  const s = Sim.create(seed);
  const inputs = [];
  while (s.status === "play" && s.frame < maxFrames) {
    const nx = s.trees.find((x) => x.x > 110 - 75);
    const target = nx ? nx.gapBottom - 20 : 290; // low in the opening
    const flap = s.y > target;
    if (flap) inputs.push(s.frame);
    Sim.step(s, flap);
  }
  return { inputs, frames: s.frame, s };
}

t("skin and arena data match client.js / arenas.js", () => {
  const js = fs.readFileSync(path.join(root, "lib/game/client.js"), "utf8");
  const skins = js.slice(js.indexOf("const SKINS = ["), js.indexOf("const ARENAS"));
  const xps = [...skins.matchAll(/^\s{4,6}xp: (\d+)|\{ name: "[^"]+", xp: (\d+)/gm)].map(
    (m) => +(m[1] || m[2]),
  );
  assert.deepStrictEqual(xps, [...Sim.CONST.SKIN_XP]);
  const arenas = fs.readFileSync(path.join(root, "lib/game/arenas.js"), "utf8");
  const names = [...arenas.matchAll(/^\s{4,8}name: "/gm)].length;
  assert.ok(names >= Sim.CONST.ARENA_COUNT, "arena count " + names);
});

t("replay gives the same result as live play", () => {
  for (const seed of [1, 42, 123456789, 4294967295]) {
    const live = play(seed, 20000);
    const r = Sim.replay(seed, live.inputs, live.frames);
    assert.strictEqual(r.score, live.s.score);
    assert.strictEqual(r.frames, live.frames);
    assert.strictEqual(r.won, live.s.status === "won");
  }
});

t("a different seed gives a different course", () => {
  const a = Sim.create(1).trees[0].gapTop;
  const b = Sim.create(2).trees[0].gapTop;
  assert.notStrictEqual(a, b);
});

t("doing nothing dies with score 0", () => {
  const r = Sim.replay(7, [], 20000);
  assert.strictEqual(r.score, 0);
  assert.ok(r.dead);
});

const base = () => ({ ...L.newProgress() });
const runOf = (seed, seq, arena, ageMs) => ({
  seq,
  arena,
  seed,
  startedAt: Date.now() - ageMs,
});

t("server counts score/XP from the replay only", () => {
  const live = play(99, 20000);
  const p = base();
  const out = L.computeFinish(p, runOf(99, 0, 0, 10 * 60 * 1000), live.inputs, live.frames, Date.now());
  assert.ok(!out.error, out.error);
  assert.strictEqual(out.result.score, live.s.score);
  assert.strictEqual(out.next.xp, Math.floor(live.s.score / 10));
  assert.strictEqual(out.next.seq, 1);
  assert.strictEqual(out.next.bests[0], live.s.score);
});

t("a winning run unlocks the next arena and selects it", () => {
  let win = null;
  for (let seed = 1; seed < 400 && !win; seed++) {
    const g = play(seed, 20000);
    if (g.s.status === "won") win = { seed, g };
  }
  assert.ok(win, "the test bot should win at least one seed");
  const out = L.computeFinish(base(), runOf(win.seed, 0, 0, 10 * 60 * 1000), win.g.inputs, win.g.frames, Date.now());
  assert.ok(out.result.won);
  assert.strictEqual(out.result.score, 100);
  assert.strictEqual(out.next.arenas, 2);
  assert.strictEqual(out.next.arena, 1);
  assert.strictEqual(out.next.xp, 10);
  assert.ok(out.result.unlockedArena);
});

t("cheating attempts are rejected or give nothing", () => {
  const live = play(5, 20000);
  const now = Date.now();
  const old = 10 * 60 * 1000;
  // too fast: a run reported as faster than real time
  assert.strictEqual(L.computeFinish(base(), runOf(5, 0, 0, 500), live.inputs, live.frames, now).error, "rejected");
  // wrong progress version (old/forked token)
  assert.strictEqual(L.computeFinish({ ...base(), seq: 3 }, runOf(5, 0, 0, old), live.inputs, live.frames, now).error, "stale");
  // garbage inputs
  assert.strictEqual(L.computeFinish(base(), runOf(5, 0, 0, old), [5, 3], 100, now).error, "rejected");
  assert.strictEqual(L.computeFinish(base(), runOf(5, 0, 0, old), [0.5], 100, now).error, "rejected");
  assert.strictEqual(L.computeFinish(base(), runOf(5, 0, 0, old), [], 1e9, now).error, "rejected");
  // made-up flaps for the wrong seed don't give the claimed score
  const fake = L.computeFinish(base(), runOf(6, 0, 0, old), live.inputs, live.frames, now);
  assert.ok(!fake.error);
  assert.ok(fake.result.score <= 100);
  // claiming 100 trees with no flaps = dies at once
  const idle = L.computeFinish(base(), runOf(5, 0, 0, old), [], 20000, now);
  assert.strictEqual(idle.result.score, 0);
});

t("locked arenas and skins can't be chosen", () => {
  const p = base();
  assert.ok(L.canPlayArena(p, 0));
  assert.ok(!L.canPlayArena(p, 1));
  assert.ok(!L.canPlayArena(p, -1));
  assert.ok(!L.canPlayArena(p, "9"));
  assert.ok(L.canUseSkin(p, 0));
  assert.ok(!L.canUseSkin(p, 6));
  assert.ok(L.canUseSkin({ ...p, xp: 200 }, 6));
});

console.log("\n" + n + " tester OK");
