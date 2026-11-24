"use client";

import { useEffect } from "react";

// Starts the canvas game once the page markup is in place. The game code is
// bundled as a module, so it never shows up as a global on `window`.
export default function Game() {
  useEffect(() => {
    import("../lib/game/client").then((m) => m.startGame());
  }, []);
  return null;
}
