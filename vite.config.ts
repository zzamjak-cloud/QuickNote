/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isTauri = process.env.TAURI_ARCH !== undefined;

export default defineConfig({
  plugins: [react()],
  clearScreen: !isTauri,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    ...(isTauri && { target: ["es2021", "chrome105", "safari14"] }),
    minify: isTauri && process.env.TAURI_DEBUG ? false : "esbuild",
    sourcemap: isTauri ? !!process.env.TAURI_DEBUG : false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
            return "react-vendor";
          }
          if (id.includes("node_modules/@tiptap/")) {
            return "tiptap-vendor";
          }
          if (id.includes("node_modules/@dnd-kit/")) {
            return "dnd-vendor";
          }
          if (id.includes("node_modules/lucide-react")) {
            return "lucide-vendor";
          }
          if (id.includes("node_modules/lowlight") || id.includes("node_modules/highlight.js")) {
            return "lowlight-vendor";
          }
          if (id.includes("emoji-picker-react")) {
            return "emoji-picker-vendor";
          }
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/__tests__/setup.ts",
  },
});
