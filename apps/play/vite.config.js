import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/chess.lab/play/" : "/",
  server: { port: 5173 },
  optimizeDeps: {
    exclude: ["@chess-lab/chsengine-core"],
  },
}));
