/* Flaksefeber: the 10 arenas.
   Each arena describes the sky, mountains, ground, weather and obstacles.
   Arena 1 reads its colours from the CSS variables in style.css (passed in as C). */
export default function makeArenas(C, rgba) {
  /* ---- small drawing helpers used by the sky decorations ---- */
  function disc(g, x, y, r, col, halo, haloA) {
    if (halo) {
      const gr = g.createRadialGradient(x, y, r * 0.5, x, y, halo);
      gr.addColorStop(0, rgba(col, haloA || 0.55));
      gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, halo, 0, 6.283);
      g.fill();
    }
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, r, 0, 6.283);
    g.fill();
  }
  function shadeOf(hex) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.round(v * 0.78 + 10);
    return (
      "#" +
      [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        .map((v) => f(v).toString(16).padStart(2, "0"))
        .join("")
    );
  }
  function lightOf(hex) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.min(255, Math.round(v + (255 - v) * 0.4));
    return (
      "#" +
      [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        .map((v) => f(v).toString(16).padStart(2, "0"))
        .join("")
    );
  }
  // cartoon cloud: one solid shape (a single path and fill, so overlapping
  // parts never show through), flat rounded bottom, soft shadow and a highlight
  function cloud(g, x, y, s, col, a) {
    const k = s * 0.9,
      ox = x - 40 * k,
      oy = y;
    g.save();
    g.beginPath();
    // flat pill-shaped base
    g.rect(ox + 11 * k, oy + 0 * k, 78 * k, 22 * k);
    g.moveTo(ox + 22 * k, oy + 11 * k);
    g.arc(ox + 11 * k, oy + 11 * k, 11 * k, 0, 6.283);
    g.moveTo(ox + 100 * k, oy + 11 * k);
    g.arc(ox + 89 * k, oy + 11 * k, 11 * k, 0, 6.283);
    // round bumps on top
    [
      [24, 3, 16],
      [47, -8, 23],
      [71, -1, 18],
      [86, 7, 11],
    ].forEach((c) => {
      g.moveTo(ox + (c[0] + c[2]) * k, oy + c[1] * k);
      g.arc(ox + c[0] * k, oy + c[1] * k, c[2] * k, 0, 6.283);
    });
    const gr = g.createLinearGradient(0, oy - 30 * k, 0, oy + 22 * k);
    gr.addColorStop(0, rgba(col, a));
    gr.addColorStop(0.55, rgba(col, a));
    gr.addColorStop(1, rgba(shadeOf(col), a));
    g.fillStyle = gr;
    g.fill();
    // soft highlight on the big bump
    g.clip();
    g.fillStyle = rgba(lightOf(col), 0.5 * a);
    g.beginPath();
    g.ellipse(ox + 40 * k, oy - 17 * k, 11 * k, 5.5 * k, -0.5, 0, 6.283);
    g.fill();
    g.restore();
  }
  function poly(g, pts, col) {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fill();
  }

  const arenas = [
    /* 1. Vinterfjellet (the original) */
    {
      name: "Vinterfjellet",
      sky: [C["--sky-hi"], C["--sky-mid"], C["--sky-low"]],
      stars: 1,
      aurora: [C["--aurora"], C["--aurora-2"]],
      glow: { x: 320, y: 470, r: 230, color: C["--sky-low"], a: 0.5 },
      far: {
        cap: C["--snow"],
        shade: C["--snow-shade"],
        rock: C["--rock-far"],
        fog: C["--mist"],
      },
      near: {
        cap: C["--snow"],
        shade: C["--snow-shade"],
        rock: C["--rock-near"],
        fog: C["--mist"],
      },
      mist: C["--mist"],
      forest: { kind: "fir", color: C["--forest-far"] },
      ground: {
        top: C["--snow"],
        shade: C["--snow-shade"],
        near: rgba(C["--snow"], 0.7),
        tuft: C["--reed"],
        kind: "grass",
      },
      weather: {
        shape: "dot",
        colors: [C["--snow"]],
        n: 90,
        vy: [0.35, 0.32],
        vx: [-0.25, -0.12],
        sway: 0.25,
        alpha: [0.45, 0.12, 0.85],
      },
      ob: {
        kind: "fir",
        body: C["--spruce"],
        dark: C["--spruce-dark"],
        trunk: C["--trunk"],
        snow: C["--snow"],
      },
    },

    /* 2. Sommerenga */
    {
      name: "Sommerenga",
      sky: ["#3f8fe0", "#8cc8f2", "#e8f6ff"],
      stars: 0,
      aurora: null,
      glow: { x: 300, y: 200, r: 260, color: "#fff6c8", a: 0.5 },
      deco(g) {
        disc(g, 300, 118, 32, "#fff3a0", 120, 0.6);
        cloud(g, 40, 90, 1.1, "#ffffff", 0.9);
        cloud(g, 150, 190, 0.8, "#ffffff", 0.8);
        cloud(g, 270, 250, 1, "#ffffff", 0.85);
      },
      far: {
        cap: "#ffffff",
        shade: "#cfe0ee",
        rock: "#6f9fb8",
        fog: "#dfeef2",
      },
      near: {
        cap: "#8fd17a",
        shade: "#6cb35a",
        rock: "#4f9a4a",
        fog: "#cfe8c8",
      },
      mist: "#e3f3e0",
      forest: { kind: "round", color: "#5c9a62" },
      ground: {
        top: "#6fc15a",
        shade: "#3f8f3a",
        near: rgba("#8fd876", 0.7),
        tuft: "#2f7a30",
        kind: "grass",
      },
      weather: {
        shape: "dot",
        colors: ["#fff8c0", "#ffffff"],
        n: 40,
        vy: [0.15, 0.15],
        vx: [-0.5, -0.2],
        sway: 0.5,
        alpha: [0.5, 0.1, 0.9],
      },
      ob: {
        kind: "fir",
        body: "#2f8a3c",
        dark: "#124a1f",
        trunk: "#5a3d26",
        snow: null,
      },
    },

    /* 3. Regnskogen */
    {
      name: "Regnskogen",
      sky: ["#1d3b33", "#3f7a63", "#a4cdb3"],
      stars: 0,
      aurora: null,
      glow: { x: 200, y: 300, r: 300, color: "#d6f0c8", a: 0.35 },
      vines: true, // lianas placed at random in the background
      deco(g) {
        disc(g, 260, 140, 36, "#e8f5c0", 110, 0.35);
        cloud(g, 20, 70, 1.3, "#2b4a40", 0.8);
        cloud(g, 190, 40, 1.5, "#2b4a40", 0.85);
        cloud(g, 300, 190, 1.1, "#3d6656", 0.7);
      },
      far: {
        cap: "#6fa88a",
        shade: "#4a8570",
        rock: "#2f5f52",
        fog: "#9fc8b4",
      },
      near: {
        cap: "#3f8a62",
        shade: "#2d7050",
        rock: "#1d4d3c",
        fog: "#7eb39d",
      },
      mist: "#bcd9c5",
      forest: { kind: "round", color: "#2a5e4a" },
      ground: {
        top: "#2f7a45",
        shade: "#1c4f2e",
        near: rgba("#3d9157", 0.7),
        tuft: "#9be08a",
        kind: "grass",
      },
      weather: {
        shape: "streak",
        colors: ["#cfe6ff"],
        n: 70,
        vy: [7, 2],
        vx: [-1.6, -0.4],
        sway: 0,
        alpha: [0.35, 0.1, 0.65],
      },
      ob: {
        kind: "fir",
        body: "#238a45",
        dark: "#0a3a1f",
        trunk: "#4a3526",
        snow: null,
        critters: true, // monkeys, snakes and vines on the trees
      },
    },

    /* 4. Høstskogen */
    {
      name: "Høstskogen",
      sky: ["#6a5a8a", "#e29a6a", "#f8d9a0"],
      stars: 0,
      aurora: null,
      glow: { x: 300, y: 420, r: 260, color: "#ffd9a0", a: 0.55 },
      deco(g) {
        disc(g, 310, 300, 42, "#ffe3a8", 150, 0.6);
        cloud(g, 30, 110, 1.2, "#f2a98a", 0.7);
        cloud(g, 200, 190, 1, "#f6c3a0", 0.7);
        cloud(g, 120, 40, 0.9, "#a88ab0", 0.6);
      },
      far: {
        cap: "#f2d9c0",
        shade: "#d5b79f",
        rock: "#9a7a7a",
        fog: "#e8cdb8",
      },
      near: {
        cap: "#d9822b",
        shade: "#b5602a",
        rock: "#7a4a3a",
        fog: "#d8b093",
      },
      mist: "#f0d9bf",
      forest: { kind: "round", color: "#a85a33" },
      ground: {
        top: "#c98a4a",
        shade: "#8a5a30",
        near: rgba("#e0a15c", 0.7),
        tuft: "#7a4a24",
        kind: "grass",
      },
      weather: {
        shape: "leaf",
        colors: ["#e0662b", "#c93a2b", "#f0a53a", "#a86a2a"],
        n: 36,
        vy: [0.8, 0.5],
        vx: [-0.7, -0.3],
        sway: 0.8,
        alpha: [0.8, 0.05, 0.95],
      },
      ob: {
        kind: "blob",
        body: "#e0732b",
        dark: "#a8391f",
        light: "#f2b23a",
        trunk: "#4a3020",
      },
    },

    /* 5. Ørkenen */
    {
      name: "Ørkenen",
      sky: ["#4a90d9", "#a8d0e8", "#fbe6b8"],
      stars: 0,
      aurora: null,
      glow: { x: 90, y: 180, r: 300, color: "#fff0b8", a: 0.6 },
      deco(g) {
        disc(g, 90, 130, 38, "#fffbe0", 170, 0.7);
        cloud(g, 230, 80, 0.9, "#ffffff", 0.5);
      },
      far: {
        cap: "#f3d9a8",
        shade: "#dcb87c",
        rock: "#c18b52",
        fog: "#f3deb4",
      },
      near: {
        cap: "#f0c685",
        shade: "#d6a35f",
        rock: "#b87a40",
        fog: "#efd2a0",
      },
      mist: "#f3e0bd",
      forest: { kind: "cactus", color: "#b48a4a" },
      ground: {
        top: "#efcf8f",
        shade: "#c9a05a",
        near: rgba("#f6dca0", 0.7),
        tuft: "#9a6b36",
        kind: "rock",
      },
      weather: {
        shape: "dot",
        colors: ["#f5deb0", "#e8c88a"],
        n: 70,
        vy: [0.12, 0.12],
        vx: [-2.2, -0.9],
        sway: 0.15,
        alpha: [0.35, 0.1, 0.7],
      },
      ob: {
        kind: "spire",
        body: "#d9a35a",
        dark: "#a86f33",
        light: "#f0c98a",
        bands: "#b9843f",
      },
    },

    /* 6. Kysten */
    {
      name: "Kysten",
      sky: ["#2d7fc7", "#7ec4e8", "#eaf7fb"],
      stars: 0,
      aurora: null,
      glow: { x: 300, y: 280, r: 240, color: "#fff6d8", a: 0.5 },
      deco(g) {
        disc(g, 300, 205, 28, "#fff6d8", 110, 0.6);
        cloud(g, 30, 100, 1.2, "#ffffff", 0.9);
        cloud(g, 170, 170, 0.8, "#ffffff", 0.85);
      },
      far: {
        cap: "#e8f4f8",
        shade: "#bcd6e0",
        rock: "#7aa0b4",
        fog: "#d5e8f0",
      },
      near: {
        cap: "#9ab8c4",
        shade: "#7a9aa8",
        rock: "#506e80",
        fog: "#b7d4e0",
      },
      mist: "#d5e8f0",
      forest: { kind: "spike", color: "#6c8696" },
      ground: {
        top: "#3aa7c9",
        shade: "#1d6f93",
        near: rgba("#69cbe6", 0.7),
        tuft: "#ffffff",
        kind: "wave",
      },
      weather: {
        shape: "dot",
        colors: ["#ffffff"],
        n: 40,
        vy: [0.1, 0.1],
        vx: [-0.9, -0.4],
        sway: 0.4,
        alpha: [0.4, 0.1, 0.8],
      },
      ob: {
        kind: "spire",
        body: "#6f8794",
        dark: "#42596a",
        light: "#a6bcc8",
        cap: "#f4f8fa",
      },
    },

    /* 7. Vulkanen */
    {
      name: "Vulkanen",
      sky: ["#150a12", "#5a1a1a", "#d9552a"],
      stars: 0.35,
      aurora: null,
      glow: { x: 200, y: 420, r: 300, color: "#ff7a2e", a: 0.5 },
      deco(g) {
        poly(
          g,
          [
            [130, 520],
            [270, 318],
            [300, 308],
            [330, 318],
            [470, 520],
          ],
          "#1a0d10",
        );
        disc(g, 300, 310, 18, "#ff8a3a", 90, 0.85);
        g.strokeStyle = "rgba(255,122,46,.85)";
        g.lineWidth = 3;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(296, 316);
        g.lineTo(282, 390);
        g.moveTo(304, 316);
        g.lineTo(322, 405);
        g.stroke();
        cloud(g, 270, 255, 1.4, "#2a2024", 0.8);
        cloud(g, 30, 150, 1.2, "#2a1519", 0.7);
      },
      far: {
        cap: "#5a3a3a",
        shade: "#432828",
        rock: "#2e1b1d",
        fog: "#6b3030",
      },
      near: {
        cap: "#3b2426",
        shade: "#2a1719",
        rock: "#1d1012",
        fog: "#4d2423",
      },
      mist: "#7a3030",
      forest: { kind: "spike", color: "#2a1519" },
      ground: {
        top: "#2a2024",
        shade: "#120b0d",
        near: rgba("#3a2a2e", 0.7),
        tuft: "#ff6a1f",
        kind: "rock",
      },
      weather: {
        shape: "dot",
        colors: ["#6b6b6b", "#3d3d3d", "#ff7a2e"],
        n: 70,
        vy: [0.6, 0.4],
        vx: [-0.5, -0.25],
        sway: 0.5,
        alpha: [0.4, 0.1, 0.8],
      },
      ob: {
        kind: "spire",
        body: "#2b2226",
        dark: "#120c0e",
        light: "#4a3a40",
        glow: "#ff6a1f",
      },
    },

    /* 8. Kirsebærdalen */
    {
      name: "Kirsebærdalen",
      sky: ["#7aa6e8", "#f3b8d6", "#ffeadf"],
      stars: 0,
      aurora: null,
      glow: { x: 200, y: 260, r: 260, color: "#ffe3ec", a: 0.5 },
      deco(g) {
        disc(g, 330, 120, 26, "#fff3f3", 100, 0.5);
        cloud(g, 30, 130, 1.1, "#ffd6e4", 0.85);
        cloud(g, 200, 70, 0.9, "#ffe6ee", 0.8);
        // Mount Fuji in the distance
        poly(
          g,
          [
            [-40, 520],
            [120, 345],
            [280, 520],
          ],
          "#8f9fd0",
        );
        poly(
          g,
          [
            [120, 345],
            [92, 376],
            [108, 369],
            [121, 384],
            [134, 369],
            [149, 376],
          ],
          "#ffffff",
        );
      },
      far: {
        cap: "#ffffff",
        shade: "#e3d0e6",
        rock: "#9a9fcf",
        fog: "#fbe3ec",
      },
      near: {
        cap: "#f6b5cc",
        shade: "#e08fb0",
        rock: "#9a6fa0",
        fog: "#f6cde0",
      },
      mist: "#fbe3ec",
      forest: { kind: "round", color: "#e6a1b9" },
      ground: {
        top: "#f2c9d6",
        shade: "#d79ab3",
        near: rgba("#f9dde6", 0.7),
        tuft: "#b86a8a",
        kind: "grass",
      },
      weather: {
        shape: "leaf",
        colors: ["#ffc2d6", "#ffa6c4", "#ffffff"],
        n: 50,
        vy: [0.6, 0.4],
        vx: [-0.6, -0.3],
        sway: 0.7,
        alpha: [0.8, 0.05, 0.95],
      },
      ob: {
        kind: "blob",
        body: "#f5a6c4",
        dark: "#d6709a",
        light: "#ffd6e4",
        trunk: "#5a3a34",
      },
    },

    /* 9. Månen */
    {
      name: "Månen",
      sky: ["#05060f", "#141838", "#2a2f66"],
      stars: 1,
      aurora: null,
      glow: { x: 300, y: 300, r: 260, color: "#7a74d0", a: 0.3 },
      deco(g) {
        // the Earth in the sky
        g.save();
        g.beginPath();
        g.arc(300, 130, 40, 0, 6.283);
        g.clip();
        g.fillStyle = "#2c6fd6";
        g.fillRect(250, 80, 100, 100);
        g.fillStyle = "#4fae5a";
        [
          [285, 118, 14, 9],
          [312, 138, 12, 15],
          [296, 154, 9, 6],
        ].forEach((c) => {
          g.beginPath();
          g.ellipse(c[0], c[1], c[2], c[3], 0.5, 0, 6.283);
          g.fill();
        });
        g.strokeStyle = "rgba(255,255,255,.55)";
        g.lineWidth = 3;
        g.beginPath();
        g.arc(300, 125, 28, 3.5, 5);
        g.stroke();
        g.restore();
        const sh = g.createRadialGradient(288, 118, 10, 300, 130, 44);
        sh.addColorStop(0, "rgba(0,0,0,0)");
        sh.addColorStop(1, "rgba(0,0,20,.55)");
        g.fillStyle = sh;
        g.beginPath();
        g.arc(300, 130, 40, 0, 6.283);
        g.fill();
      },
      far: {
        cap: "#c8cbe0",
        shade: "#9a9dbf",
        rock: "#6a6d94",
        fog: "#3a3e70",
      },
      near: {
        cap: "#b3b6d3",
        shade: "#8286ab",
        rock: "#555880",
        fog: "#34385f",
      },
      mist: "#7a74b0",
      forest: { kind: "spike", color: "#4a4e82" },
      ground: {
        top: "#b8bad0",
        shade: "#7a7c9a",
        near: rgba("#cfd1e4", 0.7),
        tuft: "#8a8cab",
        kind: "rock",
      },
      weather: {
        shape: "dot",
        colors: ["#cfe0ff", "#ffffff"],
        n: 40,
        vy: [-0.05, 0.05],
        vx: [-0.15, -0.05],
        sway: 0.15,
        alpha: [0.4, 0.1, 0.85],
      },
      ob: {
        kind: "spire",
        body: "#7ad6e8",
        dark: "#3a8fb0",
        light: "#d6f6ff",
        glow: "#b69cff",
      },
    },

    /* 10. Himmelriket */
    {
      name: "Himmelriket",
      sky: ["#6a8fe0", "#f5b88a", "#ffe9b0"],
      stars: 0,
      aurora: null,
      glow: { x: 200, y: 380, r: 320, color: "#fff0b0", a: 0.6 },
      deco(g) {
        disc(g, 200, 350, 62, "#fff6c8", 230, 0.7);
        const cols = [
          "#ff5a5a",
          "#ff9d4a",
          "#ffe14a",
          "#7ae26a",
          "#4ab4ff",
          "#6a6aff",
          "#b06aff",
        ];
        g.lineWidth = 9;
        cols.forEach((c, i) => {
          g.strokeStyle = rgba(c, 0.35);
          g.beginPath();
          g.arc(200, 560, 340 - i * 9, Math.PI * 1.08, Math.PI * 1.92);
          g.stroke();
        });
        cloud(g, 20, 90, 1.3, "#ffffff", 0.85);
        cloud(g, 250, 60, 1, "#ffffff", 0.8);
        cloud(g, 120, 200, 0.8, "#fff6e8", 0.85);
      },
      far: {
        cap: "#ffffff",
        shade: "#fbe6d0",
        rock: "#e8b8c8",
        fog: "#fff0d0",
      },
      near: {
        cap: "#ffffff",
        shade: "#fff0d8",
        rock: "#f2cf9a",
        fog: "#fff3cf",
      },
      mist: "#fff3cf",
      forest: { kind: "round", color: "#fff6e8" },
      ground: {
        top: "#ffffff",
        shade: "#f6d9a8",
        near: rgba("#fff4d6", 0.7),
        tuft: "#f3c26a",
        kind: "grass",
      },
      weather: {
        shape: "dot",
        colors: ["#fff0a0", "#ffd86a"],
        n: 50,
        vy: [-0.4, -0.25],
        vx: [-0.1, 0],
        sway: 0.3,
        alpha: [0.5, 0.12, 0.95],
      },
      ob: {
        kind: "blob",
        body: "#ffffff",
        dark: "#e9d7b8",
        light: "#fff8e0",
        trunk: "#e8c26a",
      },
    },
  ];

  // shown instead of an arena that is not unlocked yet (keeps it a surprise)
  arenas.mystery = {
    name: "???",
    sky: ["#050b16", "#0f1f38", "#1c3354"],
    stars: 1,
    aurora: null,
    glow: null,
    far: { cap: "#1c2f4d", shade: "#17294a", rock: "#12203a", fog: "#0f1b30" },
    near: { cap: "#14233d", shade: "#101d34", rock: "#0c172b", fog: "#0b1526" },
    mist: "#0f1b30",
    forest: { kind: "fir", color: "#0a1424" },
    ground: {
      top: "#16233a",
      shade: "#0a1220",
      near: rgba("#1c2c48", 0.7),
      tuft: "#2a4068",
      kind: "rock",
    },
    weather: {
      shape: "dot",
      colors: ["#9fb4d6"],
      n: 40,
      vy: [0.2, 0.2],
      vx: [-0.15, -0.05],
      sway: 0.2,
      alpha: [0.3, 0.1, 0.7],
    },
    ob: { kind: "fir", body: "#12203a", dark: "#0a1220", trunk: "#0a1220" },
  };
  return arenas;
};
