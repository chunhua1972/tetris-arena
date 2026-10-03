import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/tetris-arena/" : "/",
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    testTimeout: 30000,
  },
  build: { target: "es2022" },
});
