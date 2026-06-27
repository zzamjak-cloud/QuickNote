// PWA 아이콘 생성: public/favicon.svg → PNG 세트
// 실행: node scripts/generate-pwa-icons.mjs
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const publicDir = resolve(root, "public");
const bg = "#0f172a"; // theme/background color 와 일치

const svgPath = resolve(publicDir, "favicon.svg");
const svg = readFileSync(svgPath);

// 일반 아이콘: SVG 를 가득 채워 렌더(이미 둥근 사각 배경 포함)
async function renderFull(size, out) {
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: bg })
    .png()
    .toFile(resolve(publicDir, out));
  console.log("generated", out);
}

// maskable: safe zone 80% — 로고를 80% 크기로 축소하고 단색 배경으로 패딩
async function renderMaskable(size, out) {
  const inner = Math.round(size * 0.8);
  const pad = Math.round((size - inner) / 2);
  const logo = await sharp(svg, { density: 384 })
    .resize(inner, inner, { fit: "contain", background: bg })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: bg,
    },
  })
    .composite([{ input: logo, top: pad, left: pad }])
    .png()
    .toFile(resolve(publicDir, out));
  console.log("generated", out);
}

await renderFull(192, "pwa-192x192.png");
await renderFull(512, "pwa-512x512.png");
await renderMaskable(512, "pwa-512x512-maskable.png");
await renderFull(180, "apple-touch-icon.png");
console.log("done");
