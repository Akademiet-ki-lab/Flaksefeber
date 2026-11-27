/*
  The whole game in the browser: drawing, input and talking to the server.

  This is an ES module that Next.js bundles. Nothing is put on `window`, so
  scripts pasted into the console can't reach the simulation or the game state.
*/
import Sim from "./sim";
import type { State, Tree, Klass } from "./sim";
import makeArenas from "./arenas";
import type {
  Arena,
  CssTokens,
  Forest,
  RidgeColors,
  FirObstacle,
  BlobObstacle,
  SpireObstacle,
  Pt,
} from "./arenas";

/** Eagle colours for one skin. */
interface Palette {
  eagle: string;
  dark: string;
  belly: string;
  head: string;
  tail: string;
  beak: string;
}
/** A skin, unlocked at `xp` XP. */
interface Skin {
  name: string;
  xp: number;
  c: Palette;
}
type GameMode = "normal" | "comp";
type GameState = "ready" | "play" | "dying" | "landed" | "over" | "won";
/** Name and class shown during a competition run (from the account). */
interface Competitor {
  name: string;
  klass: Klass;
}
/** The run being played, sent to the server to verify. */
interface Run {
  runToken: string | null;
  inputs: number[];
  frames: number;
  mode: GameMode;
  who: Competitor | null;
}
/** Effect particle (puffs of feathers, snow ...). */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  decay: number;
  g: number;
  color: string;
}
/** One weather particle (snowflake, raindrop, leaf ...). */
interface Flake {
  x: number;
  y: number;
  r: number;
  ph: number;
  col: string;
  a: number;
}
/** One streak of the snowstorm (competition, after STORM_AT trees). */
interface StormFlake {
  x: number;
  y: number;
  r: number; // thickness
  k: number; // 0..1: how fast and how long it is
}
/** Hanging liana in the background (rainforest). */
interface Vine {
  x: number;
  len: number;
  lean: number;
  w: number;
  leaves: number;
  ph: number;
  z: number;
  shade: boolean;
}
/** Shape of a mountain ridge (sum of three |sin| waves). */
interface Ridge {
  base: number;
  a1: number;
  a2: number;
  a3: number;
  ph1: number;
  ph2: number;
  ph3: number;
}
/** A ridge pre-drawn into an offscreen canvas. */
interface RidgeTile {
  top: number;
  img: HTMLCanvasElement;
}
/* ---- what /api/game answers (see lib/server/game.ts) ---- */
interface Progress {
  bests: number[];
  arenas: number;
  arena: number;
  xp: number;
  skin: number;
}
/** The logged-in account for competition mode. */
interface Account {
  username: string;
  displayName: string;
  klass: Klass;
}
interface SessionData {
  progress: Progress;
  account: Account | null;
}
interface RunStartData {
  runId: string;
  seed: number;
}
// normal runs get progress + {score, xpGained, newBest, unlockedArena?, allCleared?};
// competition runs get {score, best, newBest, rank}
interface RunFinishData {
  progress: Progress;
  result: {
    score: number;
    newBest: boolean;
    xpGained: number;
    unlockedArena?: boolean;
    allCleared?: boolean;
    best: number;
    rank: number | null;
  };
}
interface LeaderboardRow {
  rank: number;
  name: string;
  klass: string;
  score: number;
  me: boolean;
}
interface LeaderboardData {
  rows: LeaderboardRow[];
  me: { best: number; name: string; klass: string; rank: number | null } | null;
}
/** EventTarget that may be an element (window and document have no closest()). */
type MaybeElement = EventTarget & { closest?: Element["closest"] };

let started = false;

export function startGame() {
  if (started) return; // React may mount twice in development
  started = true;

  // game rules come from the shared simulation (sim.js), which the server
  // also uses to replay and verify every run
  const {
    W,
    H,
    GROUND,
    GOAL,
    GRAV,
    R,
    MAX_XP, // max level; level = total XP
    TREES_PER_XP, // 1 XP for every 10th tree
    FEATHER_AT, // a golden feather appears after this many trees in a run
    STORM_AT, // competition: a snowstorm (only drawn, changes nothing in the game) after this many trees
  } = Sim.CONST;
  const LEGACY_KEYS = [
    "orneflukt-auth", // old Supabase login, no longer used
    "orneflukt-competitor", // name + class from before accounts
    "orneflukt-best",
    "orneflukt-bests",
    "orneflukt-arenas",
    "orneflukt-arena",
    "orneflukt-xp",
    "orneflukt-skin",
    "orneflukt-sig",
  ];
  const reduce = !!(
    // (old browsers may lack matchMedia, so it is checked first)
    (window as Partial<Window>).matchMedia &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  /* ---- tokens from CSS ---- */
  const cs = getComputedStyle(document.documentElement);
  const C: CssTokens = {};
  [
    "--night",
    "--sky-hi",
    "--sky-mid",
    "--sky-low",
    "--snow",
    "--snow-shade",
    "--spruce",
    "--spruce-dark",
    "--trunk",
    "--eagle",
    "--eagle-dark",
    "--eagle-belly",
    "--eagle-head",
    "--tail",
    "--beak",
    "--aurora",
    "--aurora-2",
    "--rock-far",
    "--rock-near",
    "--mist",
    "--forest-far",
    "--reed",
    "--ink",
    "--red",
  ].forEach((n) => {
    C[n] = cs.getPropertyValue(n).trim();
  });
  function rgba(hex: string, a: number) {
    const n = parseInt(hex.slice(1), 16);
    return (
      "rgba(" +
      ((n >> 16) & 255) +
      "," +
      ((n >> 8) & 255) +
      "," +
      (n & 255) +
      "," +
      a +
      ")"
    );
  }
  const rnd = (i: number) => {
    const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

  /* ---- skins: unlocked with XP (xp = XP needed) ---- */
  const DEFAULT_PAL: Palette = {
    eagle: C["--eagle"],
    dark: C["--eagle-dark"],
    belly: C["--eagle-belly"],
    head: C["--eagle-head"],
    tail: C["--tail"],
    beak: C["--beak"],
  };
  const LOCKED_PAL: Palette = {
    eagle: "#1d3049",
    dark: "#14243a",
    belly: "#27415f",
    head: "#2a4566",
    tail: "#2a4566",
    beak: "#2a4566",
  };
  const SKINS: Skin[] = [
    { name: "Havørn", xp: 0, c: DEFAULT_PAL },
    {
      name: "Kongeørn",
      xp: 20,
      c: {
        eagle: "#8a5a22",
        dark: "#4a2f10",
        belly: "#c89a52",
        head: "#e8b84a",
        tail: "#f0e6c8",
        beak: "#f2b632",
      },
    },
    {
      name: "Snøørn",
      xp: 40,
      c: {
        eagle: "#cfd8e3",
        dark: "#7d8ea3",
        belly: "#f2f6fa",
        head: "#ffffff",
        tail: "#ffffff",
        beak: "#f2a03a",
      },
    },
    {
      name: "Nattørn",
      xp: 70,
      c: {
        eagle: "#2b2f4a",
        dark: "#14172b",
        belly: "#4a5080",
        head: "#6c72b0",
        tail: "#9aa0d8",
        beak: "#ffd45e",
      },
    },
    {
      name: "Nordlysørn",
      xp: 100,
      c: {
        eagle: "#1f8f72",
        dark: "#0f4a40",
        belly: "#7dffc0",
        head: "#c58bff",
        tail: "#7dffc0",
        beak: "#fff2a8",
      },
    },
    {
      name: "Ildørn",
      xp: 140,
      c: {
        eagle: "#b8321f",
        dark: "#5c1209",
        belly: "#ff9a3c",
        head: "#ffd27a",
        tail: "#ff7a2e",
        beak: "#ffe14d",
      },
    },
    {
      name: "Gullørn",
      xp: 200,
      c: {
        eagle: "#d4a017",
        dark: "#7a5a05",
        belly: "#fff0a0",
        head: "#fff7c8",
        tail: "#ffffff",
        beak: "#ff7a1a",
      },
    },
  ];

  const ARENAS = makeArenas(C, rgba);
  let A: Arena = ARENAS[0];

  /* ---- DOM ---- */
  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T; // every id exists in app/page.tsx
  const stage = $("stage"),
    frameEl = $("frame"),
    canvas = $<HTMLCanvasElement>("c"),
    ctx = canvas.getContext("2d")!; // a 2D context is always available for a fresh canvas
  const intro = $("intro"),
    tapEl = $("tap");
  const endEl = $("end"),
    endTitle = $("endTitle"),
    endScore = $("endScore"),
    endBest = $("endBest");
  const lvlEl = $("lvl"),
    xpFill = $("xpFill"),
    skinPrev = $("skinPrev"),
    skinNext = $("skinNext"),
    skinName = $("skinName"),
    skinInfo = $("skinInfo"),
    endXp = $("endXp"),
    recordEl = $("record"),
    arenaPrev = $("arenaPrev"),
    arenaNext = $("arenaNext"),
    arenaName = $("arenaName"),
    arenaInfo = $("arenaInfo"),
    featherInfo = $("featherInfo");
  const againBtn = $<HTMLButtonElement>("again"),
    shareBtn = $<HTMLButtonElement>("share"),
    shareMsg = $("shareMsg"),
    shareOut = $("shareOut"),
    shareText = $<HTMLInputElement>("shareText");
  const menu = $("menu"),
    compForm = $("compForm"),
    lb = $("lb"),
    classBox = $("klasser"),
    compMe = $("compMe"),
    meName = $("meName"),
    meInfo = $("meInfo"),
    loginForm = $<HTMLFormElement>("loginForm"),
    loginUser = $<HTMLInputElement>("loginUser"),
    loginPass = $<HTMLInputElement>("loginPass"),
    loginMsg = $("loginMsg"),
    registerForm = $<HTMLFormElement>("registerForm"),
    registerScroll = $<HTMLButtonElement>("registerScroll"),
    regUser = $<HTMLInputElement>("regUser"),
    regName = $<HTMLInputElement>("regName"),
    regPass = $<HTMLInputElement>("regPass"),
    regPass2 = $<HTMLInputElement>("regPass2"),
    regMsg = $("regMsg"),
    lbRows = $("lbRows"),
    lbTabs = $("lbTabs"),
    compHud = $("compHud"),
    hudName = $("hudName"),
    hudBest = $("hudBest"),
    classes = Sim.CONST.CLASSES;
  let selectedClass: Klass | null = null, // chosen when making an account
    account: Account | null = null, // logged in (needed for competition mode)
    gameMode: GameMode = "normal",
    competitor: Competitor | null = null,
    leaderboardClass: Klass | null = null,
    compBest = 0,
    compRank: number | null = null;
  const isKlass = (k: unknown): k is Klass =>
    (classes as readonly unknown[]).includes(k);

  let view = 1;
  let cacheDirty = true,
    skyLayer: HTMLCanvasElement | null = null,
    glowLayer: HTMLCanvasElement | null = null,
    farTile: RidgeTile | null = null,
    nearTile: RidgeTile | null = null;
  const grads: Record<string, CanvasGradient> = {};
  function fit() {
    const r = stage.getBoundingClientRect();
    // fill the window's height (the cap only stops it on huge screens); the
    // canvas resolution is capped below, so a bigger game isn't slower
    const s = Math.max(0.2, Math.min(r.width / W, r.height / H, 3));
    frameEl.style.width = W * s + "px";
    frameEl.style.height = H * s + "px";
    frameEl.style.fontSize = Math.max(11, 16 * s) + "px";
    // cap the backing-store size: very high resolutions make every frame slow
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (s * dpr > 2) dpr = Math.max(1, 2 / s);
    const cw = Math.round(W * s * dpr),
      ch = Math.round(H * s * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    view = cw / W;
    cacheDirty = true;
  }
  if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);
  window.addEventListener("resize", fit);
  fit();
  if (document.fonts && document.fonts.load)
    document.fonts.load('52px "Fjalla One"');

  /* ---- state ---- */
  const eagle = {
    x: 110,
    y: 290,
    vy: 0,
    rot: 0,
    phase: 0,
    energy: 0,
    scale: 1,
    alpha: 1,
  };
  let state: GameState = "ready"; // ready | play | dying | landed | over | won
  let score = 0,
    best = 0;
  let scroll = 0,
    frame = 0;
  let trees: Tree[] = [],
    particles: Particle[] = [];
  let shake = 0,
    flash = 0,
    scorePop = 0;
  let landedT = 0,
    winT = 0,
    winHold = 0,
    winStartY = 290;
  let sim: State | null = null, // the running simulation (sim.js)
    run: Run | null = null, // {runToken, inputs, frames} for the server to verify
    acc = 0, // steps owed to the simulation (it runs at a fixed 60 per second)
    flapQueued = false,
    starting = false,
    endWaiting = false,
    gen = 0, // bumped whenever we leave the game; stale async work checks it
    sessionP: Promise<boolean> | null = null;
  let endShown = false,
    endAt = 0;
  let xp = 0,
    equipped = 0, // skin used in the game
    skinIdx = 0, // skin shown in the menu
    runXp = 0,
    runUnlocked: string[] = [];
  let toast = 0, // frames left of the "feather picked up" message
    feather = false, // golden feather active in this run
    invuln = 0,
    bestBeaten = false;
  let arenaUnlocked = 1, // arenas 1..arenaUnlocked can be played
    arenaEq = 0, // arena used in the game
    arenaIdx = 0, // arena shown in the menu
    arenaMsg = "",
    arenaToast = 0,
    bests = ARENAS.map(() => 0); // record per arena
  let storm = 0, // 0..1: how strong the snowstorm is (fades in and out)
    stormNote = 0, // frames left of the "snowstorm" message
    stormFlakes: StormFlake[] = [];
  let flakes: Flake[] = [],
    vines: Vine[] = []; // random hanging lianas in the background (rainforest)

  /* ---- progress lives on the server ----
     The player is identified by a random id in an httpOnly cookie that
     JavaScript can't read or change. Progress sits in a database on the
     server. Every run is sent to /api/game, which replays it and decides
     score, XP and unlocks. Editing localStorage gives nothing. */
  let online = false, // false = no server: the game can be played, nothing is saved
    saveNote = "", // shown on the end screen when something couldn't be saved
    finishing: Promise<void> | null = null; // promise while the server verifies the last run
  let chain = Promise.resolve(); // all server calls run one after another
  const enqueue = (fn: () => Promise<void>) => (chain = chain.then(fn, fn));

  async function post<T>(
    action: string,
    body: object,
  ): Promise<{ status: number; data: T | null }> {
    const r = await fetch("/api/game", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action }, body)),
      cache: "no-store",
    });
    let data: T | null = null;
    try {
      data = (await r.json()) as T;
    } catch (e) {}
    return { status: r.status, data };
  }
  // parseInt turns its argument into a string first, so numbers are fine too
  const toInt = parseInt as (v: unknown, radix: number) => number;
  function applyProgress(p: Progress) {
    bests = ARENAS.map((_, i) => clamp(toInt(p.bests[i], 10) || 0, 0, GOAL));
    arenaUnlocked = clamp(toInt(p.arenas, 10) || 1, 1, ARENAS.length);
    arenaEq = toInt(p.arena, 10) || 0;
    xp = clamp(toInt(p.xp, 10) || 0, 0, MAX_XP);
    equipped = toInt(p.skin, 10) || 0;
    if (!(equipped >= 0 && equipped < SKINS.length) || SKINS[equipped].xp > xp)
      equipped = 0;
    if (!(arenaEq >= 0 && arenaEq < arenaUnlocked)) arenaEq = 0;
  }
  // asks the server for this player's progress
  async function loadSession() {
    try {
      LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
    try {
      const res = await post<SessionData>("session", {});
      if (res.status === 200 && res.data && res.data.progress) {
        online = true;
        applyProgress(res.data.progress);
        account = res.data.account ?? null;
        return true;
      }
    } catch (e) {}
    online = false;
    return false;
  }
  // the chosen arena and skin are saved on the server (it checks they're unlocked)
  function saveProgress() {
    if (!online) return;
    enqueue(async () => {
      try {
        await post("select", { arena: arenaEq, skin: equipped });
      } catch (e) {}
    });
  }
  const isArenaUnlocked = (i: number) => i < arenaUnlocked;
  function makeFlakes() {
    const w = A.weather;
    const n = reduce ? Math.round(w.n * 0.4) : w.n;
    flakes = Array.from({ length: n }, (_, i) => {
      const r = 0.7 + Math.random() * 2.3;
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        r,
        ph: Math.random() * 6.28,
        col: w.colors[i % w.colors.length],
        a: clamp(w.alpha[0] + r * w.alpha[1], 0, w.alpha[2]),
      };
    });
  }
  function makeVines() {
    vines = [];
    if (!A.vines) return;
    const n = reduce ? 6 : 10;
    for (let i = 0; i < n; i++)
      vines.push({
        x: Math.random() * 800,
        len: 50 + Math.random() * 150,
        lean: (Math.random() - 0.5) * 30,
        w: 1.6 + Math.random() * 1.6,
        leaves: 3 + Math.floor(Math.random() * 4),
        ph: Math.random() * 6.28,
        z: 0.2 + Math.random() * 0.25, // parallax speed
        shade: Math.random() < 0.5,
      });
  }
  function setArena(i: number) {
    arenaIdx = i;
    A = isArenaUnlocked(i) ? ARENAS[i] : ARENAS.mystery;
    best = bests[i];
    makeFlakes();
    makeVines();
    cacheDirty = true;
  }
  // locked arenas can be browsed, but their background and name stay hidden
  function changeArena(d: number) {
    setArena((arenaIdx + d + ARENAS.length) % ARENAS.length);
    if (isArenaUnlocked(arenaIdx)) {
      arenaEq = arenaIdx;
      saveProgress();
    }
    updateMenu();
  }
  // local record, only for showing it right away; the server decides the real one
  function recordBest() {
    if (gameMode === "comp") {
      if (score > compBest) compBest = score;
      return;
    }
    if (score > best) {
      best = score;
      bests[arenaIdx] = best;
      bestBeaten = true;
    }
  }
  const isUnlocked = (i: number) => SKINS[i].xp <= xp;
  function pal() {
    return isUnlocked(skinIdx) ? SKINS[skinIdx].c : LOCKED_PAL;
  }
  function updateMenu() {
    const sk = SKINS[skinIdx];
    recordEl.textContent =
      gameMode === "comp"
        ? "Ingen grense. Hvor langt kommer du?"
        : isArenaUnlocked(arenaIdx)
          ? "Din rekord er " + best + " av " + GOAL + " trær"
          : "Klar " +
            GOAL +
            " trær i arena " +
            arenaUnlocked +
            " for å låse opp";
    arenaName.textContent = A.name;
    arenaInfo.textContent = "Arena " + (arenaIdx + 1) + " av " + ARENAS.length;
    featherInfo.textContent =
      "Nå " + FEATHER_AT + " trær: plukk gullfjæren, så tåler du ett tretreff";
    lvlEl.textContent = "Level " + xp + " av " + MAX_XP;
    const nextI = SKINS.findIndex((x) => x.xp > xp);
    let from = 0,
      to: number = MAX_XP;
    if (nextI >= 0) {
      from = SKINS[nextI - 1].xp;
      to = SKINS[nextI].xp;
    }
    xpFill.style.width =
      (to > from ? clamp(((xp - from) / (to - from)) * 100, 0, 100) : 100) +
      "%";
    skinName.textContent = isUnlocked(skinIdx) ? sk.name : "Låst skin";
    skinInfo.textContent = isUnlocked(skinIdx)
      ? skinIdx === equipped
        ? nextI >= 0
          ? "Neste skinn: " +
            SKINS[nextI].name +
            " ved level " +
            SKINS[nextI].xp
          : "Alle skins er låst opp"
        : sk.name
      : "Låses opp ved level " + sk.xp;
  }
  function changeSkin(d: number) {
    skinIdx = (skinIdx + d + SKINS.length) % SKINS.length;
    if (isUnlocked(skinIdx)) {
      equipped = skinIdx;
      saveProgress();
    }
    updateMenu();
  }

  /* ---- scenery data ---- */
  const stars = Array.from({ length: 36 }, (_, i) => ({
    x: rnd(i + 1) * W,
    y: rnd(i + 90) * 230,
    r: 0.5 + rnd(i + 200) * 1.1,
    p: rnd(i + 300) * 6,
  }));
  const farRidge: Ridge = {
    base: 432,
    a1: 92,
    a2: 40,
    a3: 18,
    ph1: 0.6,
    ph2: 1.9,
    ph3: 0.3,
  };
  const nearRidge: Ridge = {
    base: 478,
    a1: 70,
    a2: 32,
    a3: 14,
    ph1: 2.4,
    ph2: 0.7,
    ph3: 1.5,
  };

  setArena(arenaEq);

  /* ---- particles ---- */
  function puff(
    x: number,
    y: number,
    n: number,
    color: string,
    spread: number,
    grav: number,
  ) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x: x + (Math.random() * 16 - 8),
        y,
        vx: (Math.random() * 3.2 - 1.6) * spread,
        vy: -(0.8 + Math.random() * 2.4),
        r: 1.5 + Math.random() * 2.5,
        life: 1,
        decay: 0.012 + Math.random() * 0.013,
        g: grav,
        color,
      });
    }
  }

  /* ---- game flow ---- */
  function reset() {
    trees = [];
    particles = [];
    score = 0;
    scroll = scroll || 0;
    eagle.x = 110;
    eagle.y = 290;
    eagle.vy = 0;
    eagle.rot = 0;
    eagle.scale = 1;
    eagle.alpha = 1;
    eagle.energy = 0;
    sim = null;
    run = null;
    acc = 0;
    flapQueued = false;
    feather = false;
    invuln = 0;
    winT = 0;
    winHold = 0;
    landedT = 0;
    shake = 0;
    flash = 0;
    scorePop = 0;
    endShown = false;
    endEl.hidden = true;
    state = "ready";
    compHud.hidden = gameMode !== "comp";
    intro.classList.toggle("comp", gameMode === "comp");
    if (gameMode === "comp") {
      menu.hidden = compForm.hidden = lb.hidden = true;
      hudName.textContent = competitor!.name + " · " + competitor!.klass; // set before entering comp mode
      hudBest.textContent = "Beste: " + compBest;
    }
    intro.hidden = false;
    $("toMenu").hidden = false;
    tapEl.textContent =
      best > 0 ? "Trykk for å prøve igjen" : "Trykk for å flakse";
    skinIdx = equipped;
    if (arenaIdx !== arenaEq) setArena(arenaEq);
    arenaToast = 0;
    updateMenu();
  }
  async function start() {
    if (starting) return;
    starting = true;
    const myGen = gen;
    // wait for the server, then ask for a run (seed + token to verify it later)
    let seed: number | null = null,
      runToken: string | null = null;
    try {
      await sessionP;
      if (online) {
        await chain;
        // a locked skin/arena can only be previewed; play with the last unlocked one
        if (!isUnlocked(skinIdx)) skinIdx = equipped;
        if (!isArenaUnlocked(arenaIdx)) setArena(arenaEq);
        const { status, data } = await post<RunStartData>(
          "run-start",
          gameMode === "comp" ? { mode: "comp" } : { arena: arenaIdx },
        );
        if (status === 200 && data) {
          seed = data.seed;
          runToken = data.runId;
        } else if (status === 401 && gameMode === "comp") {
          // the login ran out (or a teacher set a new password): log in again
          starting = false;
          account = null;
          if (myGen === gen) {
            intro.hidden = true;
            $("toMenu").hidden = true;
            compHud.hidden = true;
            showCompForm("login", "Du er logget ut. Logg inn igjen.");
          }
          return;
        } else {
          await loadSession();
        }
      }
    } catch (e) {}
    // the player went back to the menu while we were waiting: drop this start
    if (myGen !== gen) return;
    if (gameMode !== "comp" && !isUnlocked(skinIdx)) skinIdx = equipped;
    if (gameMode !== "comp" && !isArenaUnlocked(arenaIdx)) setArena(arenaEq);
    if (runToken === null) {
      // no server: play without saving
      seed = Math.floor(Math.random() * 4294967296);
      saveNote = "Ikke lagret: ingen kontakt med serveren.";
    } else saveNote = "";
    arenaToast = 150;
    arenaMsg = "";
    makeVines(); // new random lianas every run
    runXp = 0;
    runUnlocked = [];
    bestBeaten = false;
    toast = 0;
    storm = 0;
    stormNote = 0;
    sim = Sim.create(seed as number, gameMode === "comp"); // from the server, or random above
    run = {
      runToken,
      inputs: [],
      frames: 0,
      mode: gameMode,
      who: competitor,
    };
    acc = 0;
    flapQueued = false;
    eagle.y = sim.y;
    eagle.vy = 0;
    syncTrees();
    state = "play";
    starting = false;
    intro.hidden = true;
    $("toMenu").hidden = true;
    if (document.activeElement && (document.activeElement as HTMLElement).blur)
      (document.activeElement as HTMLElement).blur(); // Space must not re-click a focused button
    flap();
  }
  function flap() {
    flapQueued = true; // applied at the next simulation step
    eagle.energy = 1;
  }
  function syncTrees() {
    trees = sim!.trees.map((t) => Object.assign({}, t));
  }
  // one fixed step of the simulation; the server replays exactly these steps
  // (only called while playing, when sim and run are set)
  function stepOnce() {
    const fl = flapQueued;
    flapQueued = false;
    if (fl) run!.inputs.push(sim!.frame);
    const ev = Sim.step(sim!, fl);
    scroll += sim!.speed;
    eagle.y = sim!.y;
    eagle.vy = sim!.vy;
    feather = sim!.feather;
    invuln = sim!.invuln;
    score = sim!.score;
    syncTrees();
    if (ev.scored) scorePop = 1;
    if (ev.scored && sim!.comp && sim!.score === STORM_AT) stormNote = 180;
    if (ev.pickup) {
      toast = 150;
      puff(ev.pickup.x, ev.pickup.y, 14, "#f5c542", 1.4, 0.03);
      puff(ev.pickup.x, ev.pickup.y, 8, "#fff3b0", 1.2, 0.03);
      if (!reduce) flash = 0.25;
    }
    if (ev.featherUsed) {
      eagle.energy = 1;
      if (!reduce) {
        shake = 8;
        flash = 0.35;
      }
      puff(eagle.x, eagle.y, 14, "#f5c542", 1.4, 0.03);
      puff(eagle.x, eagle.y, 8, "#fff3b0", 1.2, 0.03);
    }
    if (sim!.status === "play") return;
    run!.frames = sim!.frame;
    if (sim!.status === "won") win();
    else die();
  }
  // sends the run to the server, which replays it and decides score, XP and unlocks
  function submitRun() {
    const r = run;
    run = null;
    if (!r || !r.runToken || !online) return;
    const comp = r.mode === "comp";
    finishing = enqueue(async () => {
      try {
        const body = {
          runId: r.runToken,
          inputs: r.inputs,
          frames: r.frames,
        };
        const { status, data } = await post<RunFinishData>("run-finish", body);
        if (status === 200 && data && data.result) {
          if (comp) {
            score = data.result.score;
            compBest = data.result.best;
            compRank = data.result.rank;
            bestBeaten = data.result.newBest;
            hudBest.textContent = "Beste: " + compBest;
          } else {
            const before = xp;
            applyProgress(data.progress);
            const res = data.result;
            score = res.score;
            runXp = res.xpGained;
            runUnlocked = SKINS.filter(
              (sk) => sk.xp > before && sk.xp <= xp,
            ).map((sk) => sk.name);
            bestBeaten = res.newBest;
            best = bests[arenaIdx];
            arenaMsg = res.unlockedArena
              ? "Ny arena låst opp! Hva venter?"
              : res.allCleared
                ? "Du har klart alle " + ARENAS.length + " arenaene!"
                : "";
          }
        } else {
          saveNote = "Ikke lagret: serveren godtok ikke runden.";
          await loadSession(); // pick up the newest progress
        }
      } catch (e) {
        saveNote = "Ikke lagret: ingen kontakt med serveren.";
      }
      finishing = null;
    });
  }
  function die() {
    state = "dying";
    eagle.vy = -2.5;
    if (!reduce) {
      shake = 10;
      flash = 0.5;
    }
    feather = false;
    recordBest();
    puff(eagle.x, eagle.y, 10, pal().head, 1.2, 0.03);
    puff(eagle.x, eagle.y, 8, pal().eagle, 1.2, 0.03);
    submitRun();
  }
  function win() {
    state = "won";
    score = GOAL;
    recordBest();
    winT = 0;
    winHold = 0;
    winStartY = eagle.y;
    submitRun();
  }
  function showEnd(kind: "won" | "over") {
    if (finishing) {
      // wait until the server has verified the run
      if (!endWaiting) {
        endWaiting = true;
        const myGen = gen;
        finishing.then(() => {
          if (myGen !== gen) return; // left for the menu meanwhile
          endWaiting = false;
          showEnd(kind);
        });
      }
      return;
    }
    endShown = true;
    state = kind === "won" ? "won" : "over";
    const newBest = bestBeaten;
    endTitle.textContent =
      gameMode === "comp"
        ? bestBeaten
          ? "Ny personlig rekord!"
          : "Runden er over"
        : kind === "won"
          ? "WOW, du er veldig flink! Men klarer du det igjen?"
          : "Au! Du traff et tre.";
    endScore.textContent = String(score);
    $("endUnit").textContent = gameMode === "comp" ? "trær" : "av 100 trær";
    endBest.textContent =
      gameMode === "comp"
        ? compRank
          ? "Du er nummer " + compRank + " på topplista!"
          : "Personlig rekord: " + compBest
        : kind === "won"
          ? "Full score. Alle 100 trær." + (arenaMsg ? " " + arenaMsg : "")
          : newBest && score > 0
            ? "Ny rekord!"
            : "Rekord: " + best;
    let xpText =
      runXp > 0
        ? "+" + runXp + " XP · Level " + xp
        : "Ingen XP denne gangen. Du får 1 XP for hvert " +
          TREES_PER_XP +
          ". tre.";
    if (gameMode === "comp") xpText = ""; // no XP in competition mode
    if (xp >= MAX_XP && gameMode !== "comp")
      xpText = "Maks level (" + MAX_XP + ")! " + xpText;
    if (saveNote) xpText = saveNote;
    if (runUnlocked.length)
      xpText += " Låst opp: " + runUnlocked.join(", ") + "!";
    endXp.textContent = xpText;
    endXp.hidden = !xpText;
    shareMsg.textContent = "";
    shareOut.hidden = true;
    endEl.hidden = false;
    $("endLb").hidden = gameMode !== "comp";
    $("endMenu").hidden = false;
    $("endMenu").textContent = "Meny";
    againBtn.textContent =
      gameMode === "comp" ? "Spill igjen" : "Spill på nytt";
    endAt = performance.now() + 500;
    setTimeout(() => {
      if (!endEl.hidden) againBtn.focus({ preventScroll: true });
    }, 600);
  }
  function restart() {
    reset();
  }

  // true while the start screen (not the menu, form or leaderboard) is showing
  const canStart = () => state === "ready" && !intro.hidden && !starting;
  function action() {
    if (state === "ready") {
      if (canStart()) start();
    } else if (state === "play") flap();
  }

  // Only events from a real keyboard, mouse or finger count. Events made by a
  // script (dispatchEvent, el.click() ...) have isTrusted === false.
  frameEl.addEventListener("pointerdown", (e) => {
    if (!e.isTrusted) return;
    if ((e.target as Element).closest("a,button,input,label,.card,.end")) return;
    e.preventDefault();
    action();
  });
  window.addEventListener("keydown", (e) => {
    if (!e.isTrusted) return;
    const target = e.target as MaybeElement | null;
    const onControl =
      target && target.closest && target.closest("a,button,input");
    // typing in a text field must never steer the game
    if (target && target.closest && target.closest("input,textarea"))
      return;
    if (
      e.code === "Space" ||
      e.code === "ArrowUp" ||
      e.code === "KeyW" ||
      e.code === "Enter"
    ) {
      if (endShown) {
        if (onControl || !lb.hidden) return;
        e.preventDefault();
        if (performance.now() > endAt) restart();
        return;
      }
      if (e.code === "Enter") return;
      e.preventDefault();
      if (e.repeat) return;
      action();
    } else if (
      (e.code === "ArrowLeft" || e.code === "ArrowRight") &&
      state === "ready" &&
      !intro.hidden &&
      gameMode !== "comp" &&
      !endShown
    ) {
      e.preventDefault();
      changeSkin(e.code === "ArrowLeft" ? -1 : 1);
    }
  });
  arenaPrev.addEventListener("click", () => changeArena(-1));
  arenaNext.addEventListener("click", () => changeArena(1));
  skinPrev.addEventListener("click", () => changeSkin(-1));
  skinNext.addEventListener("click", () => changeSkin(1));
  againBtn.addEventListener("click", restart);
  $("toMenu").addEventListener("click", showMenu);
  $("endMenu").addEventListener("click", showMenu);
  function showMenu() {
    // Reset every overlay together so returning from competition cannot leave
    // the end screen, form, or leaderboard underneath the main menu.
    gen++;
    gameMode = "normal";
    competitor = null;
    endShown = false;
    endWaiting = false;
    starting = false;
    reset(); // eagle, trees and effects back to a clean start scene
    compHud.hidden = true;
    $("toMenu").hidden = true;
    intro.classList.remove("comp");
    intro.hidden = true;
    endEl.hidden = true;
    compForm.hidden = true;
    lb.hidden = true;
    menu.hidden = false;
  }
  $("modeNormal").addEventListener("click", () => {
    gameMode = "normal";
    menu.hidden = true;
    reset();
  });
  /* ---- competition mode: needs an account ----
     The server knows who is logged in (httpOnly cookie). Players make their own
     account; only an admin can change a password. */
  function updateRegisterScroll() {
    const hasMore =
      registerForm.scrollHeight > registerForm.clientHeight + 1 &&
      registerForm.scrollTop + registerForm.clientHeight < registerForm.scrollHeight - 2;
    registerScroll.hidden = registerForm.hidden || !hasMore;
  }
  if (typeof ResizeObserver !== "undefined") {
    const registerResizeObserver = new ResizeObserver(updateRegisterScroll);
    registerResizeObserver.observe(registerForm);
  }
  registerForm.addEventListener("scroll", updateRegisterScroll, { passive: true });
  window.addEventListener("resize", updateRegisterScroll);
  registerScroll.addEventListener("click", () => {
    registerForm.scrollBy({
      top: Math.max(140, registerForm.clientHeight * 0.7),
      behavior: "smooth",
    });
  });
  function showCompForm(view: "me" | "login" | "register", msg = "") {
    menu.hidden = true;
    compForm.hidden = false;
    compMe.hidden = view !== "me";
    loginForm.hidden = view !== "login";
    registerForm.hidden = view !== "register";
    registerScroll.hidden = true;
    if (view === "register") {
      registerForm.scrollTop = 0;
      requestAnimationFrame(updateRegisterScroll);
    }
    loginMsg.textContent = view === "login" ? msg : "";
    regMsg.textContent = view === "register" ? msg : "";
    if (view === "me" && account) {
      meName.textContent = account.displayName;
      meInfo.textContent = account.klass + " · brukernavn: " + account.username;
      $("compGo").focus();
    } else if (view === "login") loginUser.focus();
    else if (view === "register") regUser.focus();
  }
  $("modeComp").addEventListener("click", async () => {
    await sessionP; // know whether someone is logged in
    showCompForm(account ? "me" : "login");
  });
  $("formBack").addEventListener("click", showMenu);
  $("toRegister").addEventListener("click", () => showCompForm("register"));
  $("toLogin").addEventListener("click", () => showCompForm("login"));
  classes.forEach((klass) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = klass;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      selectedClass = klass;
      [...classBox.children].forEach((x) => {
        x.classList.toggle("on", x === b);
        x.setAttribute("aria-pressed", String(x === b));
      });
    });
    classBox.appendChild(b);
  });

  const ACCOUNT_ERRORS: Record<string, string> = {
    wrong_login: "Feil brukernavn eller passord.",
    rate: "For mange forsøk. Vent litt og prøv igjen.",
    bad_username: "Brukernavnet må ha 2–32 tegn: bokstaver, tall, . _ -",
    bad_name: "Visningsnavnet må ha 1–20 tegn.",
    bad_klass: "Velg klassen din.",
    bad_password: "Passordet må ha minst 6 tegn.",
    taken: "Brukernavnet er tatt. Velg et annet.",
  };
  let formBusy = false;
  // send a login or new-account request; on success the player is logged in
  async function accountRequest(
    action: "account-login" | "account-register",
    body: object,
    msgEl: HTMLElement,
    btn: HTMLButtonElement,
  ) {
    if (formBusy) return;
    formBusy = true;
    btn.disabled = true;
    msgEl.textContent = "";
    try {
      const { status, data } = await post<{ account?: Account; error?: string }>(action, body);
      if (status === 200 && data && data.account) {
        account = data.account;
        loginPass.value = regPass.value = regPass2.value = "";
        showCompForm("me");
      } else
        msgEl.textContent =
          (data && data.error && ACCOUNT_ERRORS[data.error]) || "Noe gikk galt. Prøv igjen.";
    } catch (_) {
      msgEl.textContent = "Fikk ikke kontakt med serveren.";
    }
    formBusy = false;
    btn.disabled = false;
  }
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    accountRequest(
      "account-login",
      { username: loginUser.value, password: loginPass.value },
      loginMsg,
      $<HTMLButtonElement>("loginBtn"),
    );
  });
  registerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!selectedClass) return void (regMsg.textContent = ACCOUNT_ERRORS.bad_klass);
    if (regPass.value.length < 6) return void (regMsg.textContent = ACCOUNT_ERRORS.bad_password);
    if (regPass.value !== regPass2.value)
      return void (regMsg.textContent = "Passordene er ikke like.");
    accountRequest(
      "account-register",
      {
        username: regUser.value,
        displayName: regName.value,
        klass: selectedClass,
        password: regPass.value,
      },
      regMsg,
      $<HTMLButtonElement>("regBtn"),
    );
  });
  $("logoutBtn").addEventListener("click", async () => {
    try {
      await post("account-logout", {});
    } catch (_) {}
    account = null;
    showCompForm("login");
  });
  $("compGo").addEventListener("click", async () => {
    if (!account || formBusy) return;
    formBusy = true;
    const myGen = gen;
    let best0 = 0;
    try {
      const q = await post<LeaderboardData>("leaderboard", {});
      const me = q.data?.me;
      if (me) best0 = me.best || 0;
    } catch (_) {}
    formBusy = false;
    if (myGen !== gen || !account) return; // back to the menu while loading
    competitor = { name: account.displayName, klass: account.klass };
    gameMode = "comp";
    compBest = best0;
    compForm.hidden = true;
    reset();
    start();
  });
  async function openLeaderboard(klass: Klass | null = null) {
    leaderboardClass = klass;
    lb.hidden = false;
    menu.hidden = true;
    endEl.hidden = true;
    lbRows.innerHTML = '<div class="empty">Laster toppliste …</div>';
    lbTabs.replaceChildren();
    [null, ...classes].forEach((k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (k === klass ? " on" : "");
      b.textContent = k || "Alle";
      b.addEventListener("click", () => openLeaderboard(k));
      lbTabs.appendChild(b);
    });
    try {
      const { status, data } = await post<LeaderboardData>(
        "leaderboard",
        klass ? { klass } : {},
      );
      if (status !== 200) throw Error("offline");
      const rows = data!.rows || []; // no JSON body throws into the catch below, as before
      if (!rows.length)
        lbRows.innerHTML =
          '<div class="empty">Ingen resultater ennå. Bli den første!</div>';
      else {
        const table = document.createElement("table");
        rows.forEach((r) => {
          const tr = document.createElement("tr");
          if (r.me) tr.className = "me";
          [
            String(r.rank),
            r.name + (r.me ? " (deg)" : ""),
            r.klass,
            String(r.score),
          ].forEach((v, i) => {
            const td = document.createElement("td");
            td.className = ["n", "", "k", "s"][i];
            td.textContent = v;
            tr.appendChild(td);
          });
          table.appendChild(tr);
        });
        lbRows.replaceChildren(table);
      }
    } catch (_) {
      lbRows.innerHTML =
        '<div class="empty">Topplista kunne ikke lastes. Sjekk nettforbindelsen.</div>';
    }
  }
  $("menuLb").addEventListener("click", () => openLeaderboard());
  $("endLb").addEventListener("click", () => openLeaderboard());
  $("lbClose").addEventListener("click", () => {
    lb.hidden = true;
    if (gameMode === "comp" && endShown) endEl.hidden = false;
    else menu.hidden = false;
  });
  shareBtn.addEventListener("click", () => {
    const text =
      score >= GOAL
        ? "Jeg klarte alle 100 trær i Flaksefeber! Klarer du det?"
        : "Jeg fløy forbi " +
          score +
          (score === 1 ? " tre" : " trær") +
          " i Flaksefeber. Klarer du å slå meg?";
    const manual = () => {
      shareOut.hidden = false;
      shareText.value = text;
      shareText.focus();
      shareText.select();
      shareMsg.textContent = "Merk teksten og kopier den.";
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            shareOut.hidden = false;
            shareText.value = text;
            shareMsg.textContent = "Kopiert. Lim den inn i en melding.";
          })
          .catch(manual);
      } else manual();
    } catch (err) {
      manual();
    }
  });

  /* ---- update ---- */
  function update(f: number) {
    frame += f;
    if (shake > 0) shake = Math.max(0, shake - 0.7 * f);
    if (flash > 0) flash = Math.max(0, flash - 0.03 * f);
    if (scorePop > 0) scorePop = Math.max(0, scorePop - 0.06 * f);
    eagle.energy = Math.max(0, eagle.energy - 0.035 * f);
    eagle.phase += (0.2 + 0.45 * eagle.energy) * f;

    const wt = A.weather;
    for (const fl of flakes) {
      fl.y += (wt.vy[0] + fl.r * wt.vy[1]) * f;
      fl.x +=
        (Math.sin(frame * 0.02 + fl.ph) * wt.sway +
          wt.vx[0] +
          fl.r * wt.vx[1]) *
        f;
      if (fl.y > H + 4) {
        fl.y = -4;
        fl.x = Math.random() * W;
      } else if (fl.y < -8) {
        fl.y = H + 4;
        fl.x = Math.random() * W;
      }
      if (fl.x < -10) fl.x = W + 10;
      else if (fl.x > W + 10) fl.x = -10;
    }
    updateStorm(f);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * f;
      p.y += p.vy * f;
      p.vy += p.g * f;
      p.life -= p.decay * f;
      if (p.life <= 0) particles.splice(i, 1);
    }

    if (state === "ready") {
      scroll += 1.0 * f;
      eagle.energy = Math.max(eagle.energy, 0.3);
      eagle.y = 290 + Math.sin(frame * 0.07) * 9;
      eagle.rot = Math.sin(frame * 0.07) * 0.05;
    } else if (state === "play") {
      updatePlay(f);
    } else if (state === "dying") {
      eagle.vy = Math.min(eagle.vy + GRAV * f, 11);
      eagle.y += eagle.vy * f;
      eagle.rot += (2.9 - eagle.rot) * Math.min(1, 0.07 * f);
      if (eagle.y >= GROUND - 9) {
        eagle.y = GROUND - 9;
        eagle.vy = 0;
        state = "landed";
        landedT = 0;
        puff(eagle.x, GROUND - 6, 26, C["--snow"], 1.6, 0.08);
        if (!reduce) shake = 6;
      }
    } else if (state === "landed" || state === "over") {
      // Freeze the scenery at the collision point while the result is shown.
      eagle.rot += (2.9 - eagle.rot) * Math.min(1, 0.1 * f);
      if (state === "landed") {
        landedT += f;
        if (landedT > 28) showEnd("over");
      }
    } else if (state === "won") {
      winT = Math.min(1, winT + f / 230);
      const p = winT;
      const e1 = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      eagle.x = 110 + 155 * e1;
      eagle.y =
        winStartY +
        (330 - winStartY) * e1 +
        Math.sin(frame * 0.06) * 5 * (1 - e1);
      eagle.scale = 1 - 0.9 * (1 - Math.pow(1 - p, 2));
      eagle.alpha = 1 - 0.4 * p;
      eagle.rot = -0.18;
      eagle.energy = Math.max(eagle.energy, 0.7 * (1 - p) + 0.15);
      scroll += 1.8 * f;
      for (const t of trees) t.x -= 2.4 * f;
      if (winT >= 1 && !endShown) {
        winHold += f;
        if (winHold > 35) showEnd("won");
      }
    }
  }

  function updatePlay(f: number) {
    // the simulation runs at a fixed 60 steps per second, whatever the screen rate
    acc += f;
    for (let n = 0; acc >= 1 && state === "play" && n < 4; n++) {
      acc -= 1;
      stepOnce();
    }
    if (state !== "play") return;
    // smooth drawing between two steps
    eagle.y = sim!.y + sim!.vy * acc;
    for (const t of trees) t.x -= sim!.speed * acc;
    eagle.rot +=
      (clamp(sim!.vy * 0.07, -0.5, 1.2) - eagle.rot) * Math.min(1, 0.25 * f);
    if (toast > 0) toast = Math.max(0, toast - f);
    if (stormNote > 0) stormNote = Math.max(0, stormNote - f);
    if (arenaToast > 0) arenaToast = Math.max(0, arenaToast - f);
  }

  /* ---- drawing ---- */
  /* ---- cached layers: static scenery is drawn once, then just blitted ---- */
  function makeLayer(
    w: number,
    h: number,
    draw: (g: CanvasRenderingContext2D) => void,
  ) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * view));
    c.height = Math.max(1, Math.round(h * view));
    const g = c.getContext("2d")!; // always available for a fresh canvas
    g.scale(c.width / w, c.height / h);
    draw(g);
    return c;
  }
  function ridgeTile(p: Ridge, c: RidgeColors): RidgeTile {
    const top = p.base - (p.a1 + p.a2 + p.a3);
    // 800 is the pattern period; 4 extra px let neighbouring tiles overlap (no seam)
    return {
      top,
      img: makeLayer(804, GROUND - top, (g) => {
        g.translate(0, -top);
        const gr = g.createLinearGradient(0, top, 0, GROUND);
        gr.addColorStop(0, c.cap);
        gr.addColorStop(0.2, c.cap);
        gr.addColorStop(0.27, c.shade);
        gr.addColorStop(0.36, c.rock);
        gr.addColorStop(1, c.fog);
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(0, GROUND);
        for (let x = 0; x <= 804; x += 4) g.lineTo(x, ridgeY(x, p));
        g.lineTo(804, GROUND);
        g.closePath();
        g.fill();
      }),
    };
  }
  function buildCaches() {
    cacheDirty = false;
    for (const k in grads) delete grads[k];
    skyLayer = makeLayer(W + 20, H + 20, (g) => {
      g.translate(10, 10);
      const gr = g.createLinearGradient(0, 0, 0, GROUND);
      gr.addColorStop(0, A.sky[0]);
      gr.addColorStop(0.55, A.sky[1]);
      gr.addColorStop(1, A.sky[2]);
      g.fillStyle = gr;
      g.fillRect(-10, -10, W + 20, H + 20);
      if (A.deco) {
        g.save();
        A.deco(g);
        g.restore();
      }
    });
    const gw = A.glow;
    glowLayer = gw
      ? makeLayer(W, H, (g) => {
          const gl = g.createRadialGradient(gw.x, gw.y, 0, gw.x, gw.y, gw.r);
          gl.addColorStop(0, rgba(gw.color, gw.a));
          gl.addColorStop(1, rgba(gw.color, 0));
          g.fillStyle = gl;
          g.fillRect(0, 0, W, H);
        })
      : null;
    farTile = ridgeTile(farRidge, A.far);
    nearTile = ridgeTile(nearRidge, A.near);
  }
  function vgrad(
    key: string,
    y0: number,
    y1: number,
    stops: [number, string][],
  ) {
    let g = grads[key];
    if (!g) {
      g = ctx.createLinearGradient(0, y0, 0, y1);
      for (const st of stops) g.addColorStop(st[0], st[1]);
      grads[key] = g;
    }
    return g;
  }

  function drawSky() {
    ctx.drawImage(skyLayer!, -10, -10, W + 20, H + 20); // built by buildCaches() in render()

    if (A.stars > 0) {
      ctx.fillStyle = C["--snow"];
      for (const s of stars) {
        ctx.globalAlpha =
          A.stars * (reduce ? 0.45 : 0.3 + 0.3 * Math.sin(frame * 0.03 + s.p));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (A.aurora) {
      const t = reduce ? 0 : frame * 0.012;
      ribbon(70, 46, 0.011, t, A.aurora[0], 0.22);
      ribbon(125, 36, 0.016, -t * 0.8 + 2, A.aurora[1], 0.12);
    }

    if (glowLayer) ctx.drawImage(glowLayer, 0, 0, W, H);
  }
  function ribbon(
    y0: number,
    amp: number,
    k: number,
    t: number,
    color: string,
    a: number,
  ) {
    const pts: Pt[] = [];
    for (let x = 0; x <= W; x += 10) {
      pts.push([
        x,
        y0 + amp * Math.sin(x * k + t) + 18 * Math.sin(x * k * 2.3 - t * 1.3),
      ]);
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    for (let i = pts.length - 1; i >= 0; i--) {
      ctx.lineTo(
        pts[i][0],
        pts[i][1] + 70 + 28 * Math.sin(pts[i][0] * 0.03 + t),
      );
    }
    ctx.closePath();
    ctx.fillStyle = vgrad("aur" + y0, y0 - 60, y0 + 170, [
      [0, rgba(color, 0)],
      [0.35, rgba(color, a)],
      [1, rgba(color, 0)],
    ]);
    ctx.fill();
  }

  function ridgeY(x: number, p: Ridge) {
    return (
      p.base -
      (p.a1 * (1 - Math.abs(Math.sin((Math.PI * x) / 400 + p.ph1))) +
        p.a2 * (1 - Math.abs(Math.sin((Math.PI * x) / 160 + p.ph2))) +
        p.a3 * (1 - Math.abs(Math.sin((Math.PI * x) / 100 + p.ph3))))
    );
  }
  function drawRidge(tile: RidgeTile, off: number) {
    const h = GROUND - tile.top;
    ctx.drawImage(tile.img, -off, tile.top, 804, h);
    ctx.drawImage(tile.img, 800 - off, tile.top, 804, h);
  }
  function fir(x: number, by: number, h: number, w: number) {
    const Rr = [
      [0, -1],
      [0.38, -0.62],
      [0.2, -0.62],
      [0.68, -0.3],
      [0.34, -0.3],
      [1, 0],
    ];
    ctx.beginPath();
    ctx.moveTo(x + Rr[0][0] * w, by + Rr[0][1] * h);
    for (let i = 1; i < Rr.length; i++)
      ctx.lineTo(x + Rr[i][0] * w, by + Rr[i][1] * h);
    for (let i = Rr.length - 1; i >= 0; i--)
      ctx.lineTo(x - Rr[i][0] * w, by + Rr[i][1] * h);
    ctx.closePath();
    ctx.fill();
  }
  function farShape(
    kind: Forest["kind"],
    x: number,
    by: number,
    h: number,
    w: number,
  ) {
    if (kind === "fir") fir(x, by, h, w);
    else if (kind === "round") {
      ctx.beginPath();
      ctx.ellipse(x, by - h * 0.55, w * 0.9, h * 0.45, 0, 0, 6.283);
      ctx.fill();
      ctx.fillRect(x - 1.5, by - h * 0.2, 3, h * 0.2);
    } else if (kind === "cactus") {
      ctx.fillRect(x - w * 0.25, by - h, w * 0.5, h);
      ctx.fillRect(x - w, by - h * 0.45, w * 0.8, w * 0.35);
      ctx.fillRect(x - w, by - h * 0.67, w * 0.35, h * 0.22 + w * 0.35);
      ctx.fillRect(x + w * 0.2, by - h * 0.3, w * 0.8, w * 0.35);
      ctx.fillRect(x + w * 0.65, by - h * 0.52, w * 0.35, h * 0.22 + w * 0.35);
    } else if (kind === "spike") {
      ctx.beginPath();
      ctx.moveTo(x - w * 0.7, by);
      ctx.lineTo(x - w * 0.1, by - h);
      ctx.lineTo(x + w * 0.2, by - h * 0.55);
      ctx.lineTo(x + w * 0.7, by);
      ctx.closePath();
      ctx.fill();
    }
  }
  function drawFarForest(off: number) {
    ctx.fillStyle = A.forest.color;
    const N = 27,
      per = 800 / N;
    for (let i = 0; i < N; i++) {
      const wx = i * per + rnd(i) * per * 0.6;
      const hgt = 34 + rnd(i + 50) * 30,
        wd = 9 + rnd(i + 90) * 7;
      const sx = (((wx - off) % 800) + 800) % 800;
      for (const x of [sx, sx - 800]) {
        if (x < -30 || x > W + 30) continue;
        farShape(A.forest.kind, x, GROUND - 2, hgt, wd);
      }
    }
  }

  function drawVines() {
    for (const v of vines) {
      const sx = (((v.x - scroll * v.z) % 800) + 800) % 800;
      for (const x of [sx, sx - 800]) {
        if (x < -30 || x > W + 30) continue;
        const sw = Math.sin(frame * 0.03 + v.ph) * 4;
        ctx.strokeStyle = v.shade ? "#25672f" : "#2f7a3a";
        ctx.lineWidth = v.w;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x, -5);
        ctx.quadraticCurveTo(x + v.lean + sw, v.len / 2, x + sw * 0.6, v.len);
        ctx.stroke();
        ctx.fillStyle = v.shade ? "#348a3c" : "#3f9a48";
        for (let k = 1; k <= v.leaves; k++) {
          const t = k / (v.leaves + 0.6);
          ctx.beginPath();
          ctx.ellipse(
            x +
              (v.lean + sw) * t * (1 - t) * 2 +
              sw * 0.6 * t * t +
              (k % 2 ? 6 : -6),
            v.len * t,
            6,
            2.6,
            k % 2 ? 0.5 : -0.5,
            0,
            6.283,
          );
          ctx.fill();
        }
      }
    }
  }
  function spruce(
    cx: number,
    tipY: number,
    baseY: number,
    w: number,
    snowy: boolean,
    ob: FirObstacle,
  ) {
    const h = baseY - tipY,
      trunkH = Math.min(26, h * 0.12),
      body = h - trunkH;
    ctx.fillStyle = ob.trunk;
    ctx.fillRect(cx - 5, baseY - trunkH - 6, 10, trunkH + 12);
    const n = Math.max(3, Math.min(7, Math.round(body / 46)));
    for (let i = 0; i < n; i++) {
      const ya = tipY + body * (i / (n + 0.35));
      const yb = tipY + body * ((i + 1.35) / (n + 0.35));
      const hwb = (((yb - tipY) / body) * w) / 2;
      ctx.fillStyle = ob.body;
      ctx.beginPath();
      ctx.moveTo(cx, ya);
      ctx.lineTo(cx + hwb, yb);
      ctx.quadraticCurveTo(cx, yb - 7, cx - hwb, yb);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba(ob.dark, 0.55);
      ctx.beginPath();
      ctx.moveTo(cx, ya);
      ctx.lineTo(cx + hwb, yb);
      ctx.quadraticCurveTo(cx + hwb * 0.5, yb - 5, cx, yb - 3.5);
      ctx.closePath();
      ctx.fill();
      if (snowy && ob.snow) {
        const f = 0.52,
          yy = ya + (yb - ya) * f,
          sx = hwb * f;
        ctx.fillStyle = ob.snow;
        ctx.beginPath();
        ctx.moveTo(cx, ya - 1);
        ctx.lineTo(cx + sx, yy);
        ctx.quadraticCurveTo(cx + sx * 0.5, yy + 9, cx, yy + 1);
        ctx.quadraticCurveTo(cx - sx * 0.5, yy + 9, cx - sx, yy);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  // leafy tree built from stacked blobs, same cone shape as the hitbox
  function blobTree(
    cx: number,
    tipY: number,
    baseY: number,
    w: number,
    ob: BlobObstacle,
  ) {
    const h = baseY - tipY,
      trunkH = Math.min(26, h * 0.12),
      body = h - trunkH;
    if (ob.trunk) {
      ctx.fillStyle = ob.trunk;
      ctx.fillRect(cx - 5, baseY - trunkH - 6, 10, trunkH + 12);
    }
    const n = Math.max(4, Math.min(16, Math.round(body / 22)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.8) / (n + 0.2);
      const y = tipY + body * t,
        hw = (w / 2) * t,
        r = Math.max(12, hw * 0.5, (body / n) * 0.62);
      const xs = hw < 16 ? [0] : [-hw * 0.5, 0, hw * 0.5];
      ctx.fillStyle = ob.dark;
      for (const dx of xs) {
        ctx.beginPath();
        ctx.arc(cx + dx + 2, y + 3, r, 0, 6.283);
        ctx.fill();
      }
      ctx.fillStyle = ob.body;
      for (const dx of xs) {
        ctx.beginPath();
        ctx.arc(cx + dx, y, r, 0, 6.283);
        ctx.fill();
      }
      ctx.fillStyle = ob.light;
      for (const dx of xs) {
        ctx.beginPath();
        ctx.arc(cx + dx - r * 0.3, y - r * 0.35, r * 0.34, 0, 6.283);
        ctx.fill();
      }
    }
  }
  // rock spire / crystal: two facets, optional bands, cap and glowing edge
  function spireTree(
    cx: number,
    tipY: number,
    baseY: number,
    w: number,
    ob: SpireObstacle,
    seed: number,
  ) {
    const h = baseY - tipY,
      hw = (w / 2) * 0.92;
    const L: Pt[] = [],
      Rr: Pt[] = [];
    for (let k = 1; k <= 3; k++) {
      const f = k / 4;
      const y = tipY + h * f;
      L.push([cx - hw * f * (1 + (rnd(seed + k) - 0.5) * 0.25), y]);
      Rr.push([cx + hw * f * (1 + (rnd(seed + k + 9) - 0.5) * 0.25), y]);
    }
    const ridgeX = cx + hw * 0.12;
    poly([[cx, tipY], ...L, [cx - hw, baseY], [ridgeX, baseY]], ob.body);
    poly([[cx, tipY], ...Rr, [cx + hw, baseY], [ridgeX, baseY]], ob.dark);
    if (ob.bands) {
      ctx.strokeStyle = ob.bands;
      ctx.lineWidth = 3;
      for (const f of [0.35, 0.55, 0.75]) {
        ctx.beginPath();
        ctx.moveTo(cx - hw * f * 0.9, tipY + h * f);
        ctx.lineTo(cx + hw * f * 0.9, tipY + h * f);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = ob.light;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, tipY + 2);
    ctx.lineTo(L[1][0] + 2, L[1][1]);
    ctx.stroke();
    if (ob.cap)
      poly(
        [
          [cx, tipY],
          [cx - hw * 0.2, tipY + h * 0.2],
          [cx - hw * 0.05, tipY + h * 0.16],
          [cx + hw * 0.08, tipY + h * 0.22],
          [cx + hw * 0.2, tipY + h * 0.2],
        ],
        ob.cap,
      );
    if (ob.glow) {
      ctx.lineCap = "round";
      ctx.strokeStyle = rgba(ob.glow, 0.3);
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(cx, tipY + 4);
      ctx.lineTo(ridgeX, baseY);
      ctx.stroke();
      ctx.strokeStyle = rgba(ob.glow, 0.9);
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }
  function poly(pts: Pt[], col: string) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fill();
  }
  /* ---- rainforest critters (decoration only, no hitbox) ---- */
  function monkey(
    x: number,
    y: number,
    sc: number,
    dir: number,
    hang: boolean,
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir * sc, sc);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#5e361b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-6, -5);
    if (hang) ctx.quadraticCurveTo(-16, 2, -12, 11);
    else ctx.bezierCurveTo(-18, -4, -20, -21, -12, -21);
    ctx.stroke();
    if (hang) {
      ctx.strokeStyle = "#7a4a2a";
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(-3, -15);
      ctx.lineTo(-1, -33);
      ctx.moveTo(5, -15);
      ctx.lineTo(2, -33);
      ctx.stroke();
    }
    ctx.fillStyle = "#7a4a2a";
    ctx.beginPath();
    ctx.ellipse(0, -9, 8, 9, 0, 0, 6.283);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-4, -1, 4, 2.6, 0, 0, 6.283);
    ctx.ellipse(5, -1, 4, 2.6, 0, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = "#dcb98e";
    ctx.beginPath();
    ctx.ellipse(1.5, -8, 4.5, 6, 0, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = "#7a4a2a";
    ctx.beginPath();
    ctx.arc(2, -22, 7.2, 0, 6.283);
    ctx.arc(-5, -22.5, 3.2, 0, 6.283);
    ctx.arc(9, -22.5, 3.2, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = "#e8c9a0";
    ctx.beginPath();
    ctx.arc(-5, -22.5, 1.7, 0, 6.283);
    ctx.arc(9, -22.5, 1.7, 0, 6.283);
    ctx.ellipse(4, -21, 5.2, 4.6, 0, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = "#1a120b";
    ctx.beginPath();
    ctx.arc(2.6, -23, 1, 0, 6.283);
    ctx.arc(6.6, -23, 1, 0, 6.283);
    ctx.fill();
    ctx.strokeStyle = "#7a4a2a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(4.6, -20.2, 1.9, 0.3, 2.8);
    ctx.stroke();
    if (hang) {
      ctx.fillStyle = "#7a4a2a";
      ctx.beginPath();
      ctx.arc(-1, -33, 2.2, 0, 6.283);
      ctx.arc(2, -33, 2.2, 0, 6.283);
      ctx.fill();
    }
    ctx.restore();
  }
  function snakeAt(
    x0: number,
    y0: number,
    dx: number,
    dy: number,
    amp: number,
    waves: number,
    w: number,
  ) {
    const n = 20,
      ph = frame * 0.05,
      pts: Pt[] = [];
    // dx, dy = direction of travel; the wave is sideways to that
    const len = Math.hypot(dx, dy),
      ux = dx / len,
      uy = dy / len;
    for (let i = 0; i <= n; i++) {
      const t = i / n,
        o = amp * Math.sin(t * waves * 6.283 + ph);
      pts.push([x0 + dx * t - uy * o, y0 + dy * t + ux * o]);
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    };
    ctx.strokeStyle = "#1f5a16";
    ctx.lineWidth = w + 2.4;
    path();
    ctx.strokeStyle = "#58c23a";
    ctx.lineWidth = w;
    path();
    ctx.strokeStyle = "#f1d545";
    ctx.lineWidth = w * 0.45;
    ctx.setLineDash([2.5, 5]);
    path();
    ctx.setLineDash([]);
    // head, eyes and tongue
    const a = pts[n],
      b = pts[n - 1];
    const ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
    ctx.save();
    ctx.translate(a[0], a[1]);
    ctx.rotate(ang);
    ctx.strokeStyle = "#d6403a";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(w * 0.9, 0);
    ctx.lineTo(w * 1.9, 0);
    ctx.lineTo(w * 2.4, -1.8);
    ctx.moveTo(w * 1.9, 0);
    ctx.lineTo(w * 2.4, 1.8);
    ctx.stroke();
    ctx.fillStyle = "#58c23a";
    ctx.beginPath();
    ctx.ellipse(w * 0.2, 0, w * 1.1, w * 0.85, 0, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = "#fff6a8";
    ctx.beginPath();
    ctx.arc(w * 0.4, -w * 0.4, w * 0.3, 0, 6.283);
    ctx.arc(w * 0.4, w * 0.4, w * 0.3, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = "#1a120b";
    ctx.beginPath();
    ctx.arc(w * 0.45, -w * 0.4, w * 0.14, 0, 6.283);
    ctx.arc(w * 0.45, w * 0.4, w * 0.14, 0, 6.283);
    ctx.fill();
    ctx.restore();
  }
  function vine(ax: number, ay: number, len: number) {
    const sw = Math.sin(frame * 0.04 + ax) * 3;
    ctx.strokeStyle = "#3f8a3a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(ax + sw, ay + len / 2, ax + sw * 0.5, ay + len);
    ctx.stroke();
    ctx.fillStyle = "#4fb04a";
    for (let k = 1; k <= 3; k++) {
      ctx.beginPath();
      ctx.ellipse(
        ax + sw * 0.5 * (k / 3) + (k % 2 ? 4 : -4),
        ay + (len * k) / 3.4,
        4.5,
        2,
        k % 2 ? 0.5 : -0.5,
        0,
        6.283,
      );
      ctx.fill();
    }
  }
  function drawCritters(t: Tree) {
    const sd = t.seed,
      cx = t.x;
    const side = sd % 2 ? 1 : -1;
    // tree growing from the ground
    {
      const tipY = t.gapBottom,
        base = GROUND + 8,
        h = base - tipY,
        w = t.wB,
        kind = sd % 3;
      if (kind === 0) {
        const f = 0.3,
          hx = cx + side * (w / 2) * f * 0.85 + side * 4,
          hy = tipY + h * f + 3;
        ctx.strokeStyle = "#5a3d26";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(hx - 12, hy);
        ctx.lineTo(hx + 12, hy);
        ctx.stroke();
        monkey(hx, hy, 1, side, false);
      } else if (kind === 1) {
        snakeAt(cx - side * 6, base - 6, 0, -(h * 0.55), 9, 3, 4.5);
      }
    }
    // tree hanging from the top
    {
      const tipY = t.gapTop,
        hT = tipY + 30,
        w = t.wT,
        kind = (sd + 1) % 3,
        f = 0.5,
        ax = cx - side * (w / 2) * f * 0.8,
        ay = tipY - hT * f,
        space = tipY + 4 - ay;
      if (kind === 0 && space >= 40) {
        snakeAt(ax, ay, 0, Math.min(46, space), 3.5, 1.2, 4.5);
      } else if (kind === 1 && space >= 44) {
        const L = Math.min(30, space - 34);
        vine(ax, ay, L);
        monkey(ax, ay + L + 34, 1, -side, true);
      } else if (kind === 2 && space >= 20) {
        vine(ax, ay, Math.min(55, space));
      }
    }
  }
  function drawObstacle(
    cx: number,
    tipY: number,
    baseY: number,
    w: number,
    snowy: boolean,
    seed: number,
  ) {
    const ob = A.ob;
    if (ob.kind === "blob") blobTree(cx, tipY, baseY, w, ob);
    else if (ob.kind === "spire") spireTree(cx, tipY, baseY, w, ob, seed);
    else spruce(cx, tipY, baseY, w, snowy, ob);
  }
  function drawTrees() {
    for (const t of trees) {
      if (t.x < -90 || t.x > W + 90) continue;
      if (t.feather) {
        const fy = (t.gapTop + t.gapBottom) / 2 + Math.sin(frame * 0.08) * 5;
        const gl = ctx.createRadialGradient(t.x, fy, 2, t.x, fy, 30);
        gl.addColorStop(
          0,
          "rgba(255,214,90," + (0.55 + 0.25 * Math.sin(frame * 0.12)) + ")",
        );
        gl.addColorStop(1, "rgba(255,214,90,0)");
        ctx.fillStyle = gl;
        ctx.beginPath();
        ctx.arc(t.x, fy, 30, 0, 6.283);
        ctx.fill();
        drawFeather(t.x, fy, 1.5);
      }
      drawObstacle(t.x, t.gapBottom, GROUND + 8, t.wB, true, t.seed);
      ctx.save();
      ctx.scale(1, -1);
      drawObstacle(t.x, -t.gapTop, 30, t.wT, false, t.seed + 3);
      ctx.restore();
      if (A.ob.critters) drawCritters(t);
    }
  }

  function drawGround() {
    const off = scroll;
    const gd = A.ground;
    ctx.fillStyle = gd.top;
    ctx.beginPath();
    ctx.moveTo(-10, H + 10);
    for (let x = -10; x <= W + 10; x += 5) {
      ctx.lineTo(
        x,
        GROUND +
          3 * Math.sin((x + off) * 0.045) +
          2 * Math.sin((x + off) * 0.11 + 1.3),
      );
    }
    ctx.lineTo(W + 10, H + 10);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = vgrad("gshade", GROUND, H, [
      [0, rgba(gd.shade, 0)],
      [1, rgba(gd.shade, 0.9)],
    ]);
    ctx.fillRect(-10, GROUND, W + 20, H - GROUND + 10);

    ctx.fillStyle = gd.near;
    ctx.beginPath();
    ctx.moveTo(-10, H + 10);
    for (let x = -10; x <= W + 10; x += 5) {
      ctx.lineTo(
        x,
        GROUND +
          34 +
          5 * Math.sin((x + off * 1.25) * 0.03) +
          3 * Math.sin((x + off * 1.25) * 0.09),
      );
    }
    ctx.lineTo(W + 10, H + 10);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = gd.tuft;
    ctx.fillStyle = gd.tuft;
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    for (let k = 0; k < 5; k++) {
      const wx = k * 72 + rnd(k + 7) * 30;
      const by = GROUND + 28 + rnd(k + 20) * 34;
      const sx = (((wx - off * 1.25) % 360) + 360) % 360;
      for (const x of [sx, sx + 360]) {
        if (x > W + 10) continue;
        ctx.beginPath();
        if (gd.kind === "wave") {
          ctx.arc(x, by, 7, Math.PI * 1.1, Math.PI * 1.9);
          ctx.stroke();
        } else if (gd.kind === "rock") {
          ctx.ellipse(x, by - 2, 3.4, 2.2, 0, 0, 6.283);
          ctx.fill();
        } else {
          ctx.moveTo(x, by);
          ctx.lineTo(x - 2, by - 9);
          ctx.moveTo(x, by);
          ctx.lineTo(x + 1, by - 12);
          ctx.moveTo(x, by);
          ctx.lineTo(x + 4, by - 8);
          ctx.stroke();
        }
      }
    }
  }

  /* ---- snowstorm: only for show, nothing here touches the simulation ---- */
  const stormOn = () => state === "play" && !!sim && sim.comp && sim.score >= STORM_AT;
  // 0..1, comes and goes in gusts (steady with reduced motion)
  const gust = () =>
    reduce
      ? 0.5
      : clamp(0.5 + 0.35 * Math.sin(frame * 0.011) + 0.15 * Math.sin(frame * 0.037 + 1.3), 0, 1);
  function updateStorm(f: number) {
    storm = clamp(storm + (stormOn() ? 0.007 : -0.02) * f, 0, 1);
    if (storm <= 0) return;
    if (!stormFlakes.length) {
      const n = reduce ? 50 : 150;
      stormFlakes = Array.from({ length: n }, () => ({
        x: Math.random() * (W + 80),
        y: Math.random() * H,
        r: 1 + Math.random() * 1.8,
        k: Math.random(),
      }));
    }
    const wind = 0.7 + 0.8 * gust();
    for (const fl of stormFlakes) {
      fl.x -= (5 + fl.k * 6) * wind * f;
      fl.y += (1.6 + fl.k * 2) * f;
      if (fl.y > H + 6) {
        fl.y = -6;
        fl.x = Math.random() * (W + 80);
      }
      if (fl.x < -40) fl.x = W + 40;
    }
  }
  // a pale haze over the trees (the eagle is drawn after it, so it stays clear)
  function drawStormHaze() {
    if (storm <= 0) return;
    ctx.fillStyle = rgba(C["--snow"], storm * (0.1 + 0.32 * gust()));
    ctx.fillRect(-10, -10, W + 20, H + 20);
  }
  // streaks of snow blowing sideways, in front of everything
  function drawStormFlakes() {
    if (storm <= 0) return;
    const wind = 0.7 + 0.8 * gust();
    ctx.strokeStyle = C["--snow"];
    ctx.lineCap = "round";
    for (const fl of stormFlakes) {
      ctx.globalAlpha = storm * (0.35 + 0.35 * fl.k);
      ctx.lineWidth = fl.r;
      ctx.beginPath();
      ctx.moveTo(fl.x, fl.y);
      ctx.lineTo(fl.x + (5 + fl.k * 6) * wind * 2.2, fl.y - (1.6 + fl.k * 2) * 2.2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
  }

  function drawFlakes() {
    const wt = A.weather;
    for (const fl of flakes) {
      ctx.globalAlpha = fl.a;
      if (wt.shape === "streak") {
        ctx.strokeStyle = fl.col;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(
          fl.x - (wt.vx[0] + fl.r * wt.vx[1]) * 2.5,
          fl.y - (wt.vy[0] + fl.r * wt.vy[1]) * 2.5,
        );
        ctx.lineTo(fl.x, fl.y);
        ctx.stroke();
      } else if (wt.shape === "leaf") {
        ctx.fillStyle = fl.col;
        ctx.beginPath();
        ctx.ellipse(
          fl.x,
          fl.y,
          fl.r * 1.8,
          fl.r,
          fl.ph + frame * 0.04,
          0,
          6.283,
        );
        ctx.fill();
      } else {
        ctx.fillStyle = fl.col;
        ctx.beginPath();
        ctx.arc(fl.x, fl.y, fl.r, 0, 6.283);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  let P = DEFAULT_PAL;
  function wingShape(th: number, fill: string, shade: string | null) {
    ctx.save();
    ctx.translate(4, -3);
    ctx.rotate(th);
    ctx.beginPath();
    ctx.moveTo(4, -1);
    ctx.quadraticCurveTo(-14, -14, -40, -10);
    ctx.lineTo(-36, -5);
    ctx.lineTo(-40, -2);
    ctx.lineTo(-33, 1);
    ctx.lineTo(-36, 5);
    ctx.lineTo(-27, 6);
    ctx.lineTo(-28, 10);
    ctx.lineTo(-17, 9);
    ctx.lineTo(-17, 13);
    ctx.lineTo(-6, 10);
    ctx.lineTo(4, 6);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (shade) {
      ctx.fillStyle = shade;
      ctx.fill();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,.28)";
    ctx.stroke();
    if (!shade) {
      ctx.fillStyle = P.eagle;
      ctx.beginPath();
      ctx.ellipse(-8, -2, 11, 5, 0.05, 0, 6.283);
      ctx.fill();
    }
    ctx.restore();
  }
  function drawEagle() {
    const e = eagle;
    P = pal();
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.rot);
    ctx.scale(e.scale, e.scale);
    if (feather && state === "play") {
      // golden aura while the feather is active
      const pulse = 0.5 + 0.5 * Math.sin(frame * 0.12);
      const aura = ctx.createRadialGradient(0, 0, 4, 0, 0, 42);
      aura.addColorStop(0, "rgba(255,214,90," + (0.35 + 0.2 * pulse) + ")");
      aura.addColorStop(1, "rgba(255,214,90,0)");
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(0, 0, 42, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha =
      invuln > 0 && Math.floor(frame / 4) % 2 ? e.alpha * 0.4 : e.alpha;

    let th: number;
    if (state === "dying") th = 1.15 + 0.25 * Math.sin(frame * 0.6);
    else if (state === "landed" || state === "over") th = 0.55;
    else th = 0.2 + (0.25 + 0.75 * e.energy) * Math.sin(e.phase);

    // far wing
    wingShape(th * 0.8 + 0.1, P.dark, "rgba(0,0,0,.28)");
    // tail
    ctx.fillStyle = P.tail;
    ctx.beginPath();
    ctx.moveTo(-11, -4);
    ctx.lineTo(-34, -7);
    ctx.lineTo(-37, 1);
    ctx.lineTo(-33, 7);
    ctx.lineTo(-11, 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(60,40,25,.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(-35, -2);
    ctx.moveTo(-14, 3);
    ctx.lineTo(-34, 4);
    ctx.stroke();
    // talons
    ctx.strokeStyle = P.beak;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-2, 10);
    ctx.lineTo(1, 15);
    ctx.moveTo(5, 10);
    ctx.lineTo(8, 15);
    ctx.stroke();
    // body
    ctx.fillStyle = P.eagle;
    ctx.beginPath();
    ctx.ellipse(-3, 2, 18, 10.5, 0.12, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = P.belly;
    ctx.beginPath();
    ctx.ellipse(-1, 6, 12, 4.8, 0.1, 0, 6.283);
    ctx.fill();
    // neck and head
    ctx.fillStyle = P.head;
    ctx.beginPath();
    ctx.ellipse(8, -2, 9, 7, -0.5, 0, 6.283);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(13, -6, 8.2, 0, 6.283);
    ctx.fill();
    // beak
    ctx.fillStyle = P.beak;
    ctx.beginPath();
    ctx.moveTo(18, -10);
    ctx.bezierCurveTo(25, -11, 31, -8, 31, -2);
    ctx.bezierCurveTo(29, -3, 27, -3, 25, -3);
    ctx.lineTo(18, -3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(60,40,25,.45)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // eye and brow
    ctx.fillStyle = "#1a120b";
    ctx.beginPath();
    ctx.arc(16.5, -8, 2.2, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(17.1, -8.7, 0.7, 0, 6.283);
    ctx.fill();
    ctx.strokeStyle = P.dark;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(13, -12.4);
    ctx.lineTo(19.5, -9.6);
    ctx.stroke();
    // near wing
    wingShape(th, P.dark, null);

    ctx.restore();
  }

  function drawFeather(x: number, y: number, s: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.6);
    ctx.scale(s, s);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#8a5a00";
    ctx.lineWidth = 1.6;
    ctx.fillStyle = "#f5c542";
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.quadraticCurveTo(11, -4, 0, 10);
    ctx.quadraticCurveTo(-11, -4, 0, -16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(0, 19);
    ctx.stroke();
    ctx.restore();
  }

  function drawScore() {
    if (state === "ready") return;
    if (arenaToast > 0 && state === "play") {
      ctx.save();
      ctx.globalAlpha = Math.min(1, arenaToast / 30);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.font = '800 16px "Nunito Sans", system-ui, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = rgba(C["--night"], 0.7);
      const txt = "Arena " + (arenaIdx + 1) + ": " + A.name;
      ctx.strokeText(txt, W / 2, 180);
      ctx.fillStyle = C["--snow"];
      ctx.fillText(txt, W / 2, 180);
      ctx.restore();
    }
    if (toast > 0 && state === "play") {
      ctx.save();
      ctx.globalAlpha = Math.min(1, toast / 30);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.font = '800 16px "Nunito Sans", system-ui, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = rgba(C["--night"], 0.7);
      ctx.strokeText("Gullfjær! Du tåler ett tretreff", W / 2, 190);
      ctx.fillStyle = "#f5c542";
      ctx.fillText("Gullfjær! Du tåler ett tretreff", W / 2, 190);
      ctx.restore();
    }
    if (stormNote > 0 && state === "play") {
      ctx.save();
      ctx.globalAlpha = Math.min(1, stormNote / 30);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.font = '800 16px "Nunito Sans", system-ui, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = rgba(C["--night"], 0.7);
      ctx.strokeText("Snøstorm! Sikten blir dårlig", W / 2, 215);
      ctx.fillStyle = C["--snow"];
      ctx.fillText("Snøstorm! Sikten blir dårlig", W / 2, 215);
      ctx.restore();
    }
    if (feather && state === "play") {
      drawFeather(W / 2 - 38, 142, 1.3);
      ctx.save();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.font = '800 14px "Nunito Sans", system-ui, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = rgba(C["--night"], 0.6);
      ctx.strokeText("Gullfjær", W / 2 - 20, 142);
      ctx.fillStyle = "#f5c542";
      ctx.fillText("Gullfjær", W / 2 - 20, 142);
      ctx.restore();
    }
    const s = 1 + 0.3 * scorePop;
    ctx.save();
    ctx.translate(W / 2, 84);
    ctx.scale(s, s);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    ctx.font = '52px "Fjalla One", Impact, "Arial Narrow", sans-serif';
    ctx.lineWidth = 7;
    ctx.strokeStyle = rgba(C["--night"], 0.55);
    ctx.strokeText(String(score), 0, 0);
    ctx.fillStyle = C["--snow"];
    ctx.fillText(String(score), 0, 0);
    ctx.font = '700 13px "Nunito Sans", system-ui, sans-serif';
    ctx.lineWidth = 4;
    const unit = gameMode === "comp" ? "trær" : "av " + GOAL + " trær";
    ctx.strokeText(unit, 0, 20);
    ctx.fillText(unit, 0, 20);
    ctx.restore();
  }

  function render() {
    if (cacheDirty) buildCaches();
    ctx.setTransform(view, 0, 0, view, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake > 0)
      ctx.translate(
        (Math.random() - 0.5) * shake,
        (Math.random() - 0.5) * shake,
      );

    drawSky();
    // (both tiles are built by buildCaches() above)
    drawRidge(farTile!, (scroll * 0.08) % 800);
    drawRidge(nearTile!, (scroll * 0.2) % 800);
    ctx.fillStyle = vgrad("mist", 420, GROUND, [
      [0, rgba(A.mist, 0)],
      [1, rgba(A.mist, 0.6)],
    ]);
    ctx.fillRect(-10, 420, W + 20, GROUND - 420);
    drawFarForest((scroll * 0.5) % 800);
    if (vines.length) drawVines();
    // Gameplay obstacles belong to the active run, not to menu backgrounds.
    if (
      state === "play" ||
      state === "dying" ||
      state === "landed" ||
      state === "won"
    )
      drawTrees();
    drawGround();
    drawFlakes();
    drawParticles();
    drawStormHaze();
    drawEagle();
    drawStormFlakes();

    ctx.restore();
    if (flash > 0) {
      ctx.fillStyle = rgba(C["--snow"], flash);
      ctx.fillRect(0, 0, W, H);
    }
    drawScore();
  }

  /* ---- loop ---- */
  showMenu();
  sessionP = loadSession().then((ok) => {
    // progress from the server: show the right arena, skin and level
    if (state === "ready" && !starting) {
      skinIdx = equipped;
      setArena(arenaEq);
      updateMenu();
    }
    return ok;
  });
  let last = performance.now();
  function loop(now: number) {
    const dt = Math.min(now - last, 50);
    last = now;
    update(dt / 16.667);
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
