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
    // lucide(586 kB), tiptap(470 kB), 앱 소스 번들(923 kB·gzip 270 kB)은 분할 불가 범위
    // 실제 전송 크기(gzip) 기준으로 문제없으므로 경고 임계값을 올림
    chunkSizeWarningLimit: 1000,
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
          // aws-amplify: AppSync/Auth 코드 분리 — 메인 번들에서 ~400 kB 절감
          if (id.includes("node_modules/aws-amplify") || id.includes("node_modules/@aws-amplify")) {
            return "amplify-vendor";
          }
          // IndexedDB 레이어 분리
          if (id.includes("node_modules/dexie")) {
            return "db-vendor";
          }
          // OIDC 인증 클라이언트 분리
          if (id.includes("node_modules/oidc-client-ts") || id.includes("node_modules/jwt-decode")) {
            return "auth-vendor";
          }
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/__tests__/setup.ts",
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
        execArgv: ["--max-old-space-size=6144"],
      },
    },
  },
});
