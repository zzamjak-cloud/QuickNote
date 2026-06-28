// PWA 아이콘 생성: 로컬 네이티브 앱 아이콘(src-tauri/icons/icon.icns 에서 추출한 512px)을
// 소스로 PWA/모바일 아이콘 PNG 세트 + favicon.svg(래스터 임베드)를 생성한다.
// 실행: node scripts/generate-pwa-icons.mjs
//
// 소스 갱신: 네이티브 아이콘이 바뀌면
//   iconutil -c iconset src-tauri/icons/icon.icns -o /tmp/qn.iconset
//   cp /tmp/qn.iconset/icon_512x512.png scripts/app-icon-512.png
// 후 이 스크립트를 다시 실행한다.
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const publicDir = resolve(root, "public");
const srcPath = resolve(__dirname, "app-icon-512.png"); // 네이티브 앱 아이콘 512px

const src = readFileSync(srcPath);

// 일반 아이콘: 네이티브 아이콘을 그대로 리사이즈.
async function renderFull(size, out) {
  await sharp(src).resize(size, size, { fit: "cover" }).png().toFile(resolve(publicDir, out));
  console.log("generated", out);
}

// maskable: safe zone 80% — 로고를 80%로 축소하고 불투명 흰 배경으로 패딩.
// (네이티브 아이콘은 코너가 투명이라, 런처가 원형/스쿼클로 크롭할 때 비치지 않게 흰 배경 사용.)
async function renderMaskable(size, out) {
  const bg = { r: 255, g: 255, b: 255, alpha: 1 };
  const inner = Math.round(size * 0.8);
  const pad = Math.round((size - inner) / 2);
  const logo = await sharp(src).resize(inner, inner, { fit: "cover" }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: logo, top: pad, left: pad }])
    .png()
    .toFile(resolve(publicDir, out));
  console.log("generated", out);
}

await renderFull(192, "pwa-192x192.png");
await renderFull(512, "pwa-512x512.png");
await renderMaskable(512, "pwa-512x512-maskable.png");
await renderFull(180, "apple-touch-icon.png");

// favicon.svg — 브라우저 탭 아이콘도 네이티브 앱 아이콘과 일치시킨다(SVG 래퍼에 PNG data URI 임베드).
const faviconPng = await sharp(src).resize(64, 64, { fit: "cover" }).png().toBuffer();
const b64 = faviconPng.toString("base64");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><image width="64" height="64" href="data:image/png;base64,${b64}"/></svg>`;
writeFileSync(resolve(publicDir, "favicon.svg"), svg);
console.log("generated favicon.svg");

console.log("done");
