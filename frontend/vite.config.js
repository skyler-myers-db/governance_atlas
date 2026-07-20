import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return id.includes("node_modules") ? "vendor" : undefined;
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    // Live-API dev loop: ATLAS_DEV_PROXY_TARGET + ATLAS_DEV_PROXY_TOKEN proxy
    // /api to a deployed app so visual work renders real governed data
    // without a deploy round-trip. No env vars → no proxy (unchanged).
    proxy: process.env.ATLAS_DEV_PROXY_TARGET
      ? {
          "/api": {
            target: process.env.ATLAS_DEV_PROXY_TARGET,
            changeOrigin: true,
            headers: process.env.ATLAS_DEV_PROXY_TOKEN
              ? { Authorization: `Bearer ${process.env.ATLAS_DEV_PROXY_TOKEN}` }
              : {},
          },
        }
      : undefined,
  },
  test: {
    environment: "jsdom",
    fileParallelism: false,
    setupFiles: "./src/test/setup.js",
    testTimeout: 30_000,
  },
});
