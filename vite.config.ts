/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const isTauri = process.env.TAURI_ARCH !== undefined;

// PWA 는 웹(Vercel) 빌드 전용 — Tauri 데스크톱 빌드에서는 SW/manifest 를 생성하지 않는다.
const pwaPlugin = VitePWA({
  registerType: "prompt", // 자동 reload 금지 — 편집 중 데이터 손실 방지(usePwaUpdate 가 사용자 확인)
  injectRegister: null, // virtual:pwa-register 로 직접 등록(usePwaUpdate)
  includeAssets: ["favicon.svg", "apple-touch-icon.png"],
  manifest: {
    name: "QuickNote",
    short_name: "QuickNote",
    description: "팀 노트·DB·플로우차트",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: "#0f172a",
    background_color: "#0f172a",
    lang: "ko",
    icons: [
      { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
      {
        src: "pwa-512x512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  },
  workbox: {
    // 정적 셸·해시 자산만 프리캐시. API/인증/동적 데이터는 SW 가 가로채지 않는다.
    globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: false, // 사용자 확인 후에만 새 SW 활성화
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
  },
  // dev 에서는 SW 비활성(기본) — 인증/HMR 간섭 방지. preview/prod 빌드에서만 동작.
  devOptions: { enabled: false },
});

export default defineConfig({
  plugins: [react(), !isTauri && pwaPlugin].filter(Boolean),
  // Tauri 빌드는 PWA 플러그인을 제외하므로 virtual:pwa-register 가 없다.
  // usePwaUpdate 의 동적 import 가 빌드타임에 해석 실패하지 않도록 스텁으로 대체.
  ...(isTauri && {
    resolve: {
      alias: { "virtual:pwa-register": "/src/lib/pwa/registerStub.ts" },
    },
  }),
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
          // lowlight/highlight.js 는 named vendor 청크로 묶지 않는다 — Editor 가 동적 import
          // 하므로 named chunk 로 두면 Vite 가 eager modulepreload(+테마 CSS eager)로 승격시킨다.
          // 규칙을 빼면 동적 import 경계로 자연 코드분할되어 lazy 로드된다.
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
  },
});
