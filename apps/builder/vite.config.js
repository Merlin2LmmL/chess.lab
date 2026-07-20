import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/chess.lab/builder/" : "/",
  server: { port: 5174 },
  optimizeDeps: {
    exclude: ["@chess-lab/chsengine-core"],
  },
}));
