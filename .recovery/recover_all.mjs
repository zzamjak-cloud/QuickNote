// 전체 복구 파이프라인: 서버 page.doc 이 빈 페이지를, 서버 Y-룸 재구성 또는 데스크톱 스냅샷 중
// 본문이 가장 풍부한 소스로 복원한다.
//   기본 = DRY-RUN(쓰기 없음, 계획만). --write 시 백업 후 page.doc upsert.
import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REGION = "ap-northeast-2";
const SNAP_DIR = path.join(process.env.HOME, "Desktop/quicknote-desktop-idb-backup-20260618/snapshots");
const OUT_DIR = path.join(process.env.HOME, "Desktop/AI/QuickNote/.recovery");

function aws(args) {
  return JSON.parse(execFileSync("aws", [...args, "--region", REGION, "--output", "json"], { maxBuffer: 1024 * 1024 * 1024 }).toString());
}

// ---- 본문 판정 ----
function isPlaceholder(json) {
  const c = json?.content;
  if (!c || c.length === 0) return true;
  return c.every((n) => n.type === "paragraph" && (!n.content || n.content.length === 0));
}
function score(json) {
  if (!json || isPlaceholder(json)) return 0;
  return JSON.stringify(json).length;
}
function textOf(json) {
  const out = [];
  const walk = (n) => { if (!n) return; if (n.type === "text" && n.text) out.push(n.text); (n.content || []).forEach(walk); };
  walk(json);
  return out.join(" ");
}

// ---- 소스 1: Y-룸 재구성 ----
function reconstructRoom(room) {
  const j = aws(["dynamodb", "query", "--table-name", "quicknote-rt-ydoc-updates",
    "--key-condition-expression", "pageId = :p",
    "--expression-attribute-values", JSON.stringify({ ":p": { S: room } })]);
  const items = (j.Items || []).sort((a, b) => (a.seq.S < b.seq.S ? -1 : 1));
  const ydoc = new Y.Doc();
  for (const it of items) {
    const b64 = it.update?.S; if (!b64) continue;
    const bytes = Buffer.from(b64, "base64"); if (bytes.length === 0) continue;
    try { Y.applyUpdate(ydoc, new Uint8Array(bytes)); } catch { /* skip */ }
  }
  return yDocToProsemirrorJSON(ydoc, "prosemirror");
}

// ---- 소스 2: 데스크톱 스냅샷 ----
function loadSnapshots() {
  const map = new Map(); // pid -> doc
  for (const f of fs.readdirSync(SNAP_DIR).filter((x) => x.startsWith("snapshot.") && x.endsWith(".json"))) {
    let raw = fs.readFileSync(path.join(SNAP_DIR, f), "utf8").trim();
    let o = raw; for (let i = 0; i < 5 && typeof o === "string"; i++) { try { o = JSON.parse(o); } catch { break; } }
    const pages = o?.pages || {};
    for (const [pid, p] of Object.entries(pages)) {
      if (p && p.doc && score(p.doc) > 0) {
        const prev = map.get(pid);
        if (!prev || score(p.doc) > score(prev)) map.set(pid, p.doc);
      }
    }
  }
  return map;
}

// ---- 룸 맵 (pageId -> [epoch...]) ----
function loadRoomMap() {
  const j = aws(["dynamodb", "scan", "--table-name", "quicknote-rt-ydoc-updates", "--projection-expression", "pageId"]);
  const m = new Map();
  for (const it of j.Items || []) {
    const room = it.pageId.S; if (room.startsWith("db:")) continue;
    const idx = room.indexOf(":"); const ep = room.slice(0, idx), pid = room.slice(idx + 1);
    if (!m.has(pid)) m.set(pid, new Set());
    m.get(pid).add(ep);
  }
  return m;
}

// ---- 타깃: 서버 doc 이 빈 페이지 (삭제 제외, DB행 제외는 소스유무로 자연 처리) ----
function loadEmptyDocPages() {
  let pages = [], startKey = null;
  do {
    const args = ["dynamodb", "scan", "--table-name", "quicknote-page",
      "--projection-expression", "id, title, workspaceId, databaseId, fullPageDatabaseId, deletedAt, #d, updatedAt",
      "--expression-attribute-names", JSON.stringify({ "#d": "doc" })];
    if (startKey) args.push("--exclusive-start-key", JSON.stringify(startKey));
    const j = aws(args);
    for (const it of j.Items || []) {
      if (it.deletedAt?.S) continue;
      let doc = null; const s = it.doc?.S;
      if (s) { try { doc = JSON.parse(s); } catch { doc = null; } }
      if (score(doc) === 0) {
        pages.push({ id: it.id.S, title: it.title?.S || "", ws: it.workspaceId?.S || "",
          databaseId: it.databaseId?.S || null, isDbHome: !!it.fullPageDatabaseId?.S });
      }
    }
    startKey = j.LastEvaluatedKey || null;
  } while (startKey);
  return pages;
}

// ================= 실행 =================
const WRITE = process.argv.includes("--write");
console.log("스냅샷 로드..."); const snap = loadSnapshots(); console.log("  스냅샷 본문보유 페이지:", snap.size);
console.log("룸 맵 로드..."); const rooms = loadRoomMap(); console.log("  Y-룸 보유 페이지:", rooms.size);
console.log("빈 doc 페이지 스캔..."); const targets = loadEmptyDocPages(); console.log("  서버 빈 doc 페이지:", targets.length);

const plan = [];
let i = 0;
for (const t of targets) {
  i++;
  const cands = [];
  // Y-룸 (에폭별)
  for (const ep of rooms.get(t.id) || []) {
    try { const json = reconstructRoom(`${ep}:${t.id}`); if (score(json) > 0) cands.push({ src: `yroom:${ep}`, json }); } catch { /* */ }
  }
  // 스냅샷
  if (snap.has(t.id)) cands.push({ src: "snapshot", json: snap.get(t.id) });
  if (cands.length === 0) continue;
  cands.sort((a, b) => score(b.json) - score(a.json));
  const best = cands[0];
  plan.push({ id: t.id, title: t.title, ws: t.ws, isDbHome: t.isDbHome, databaseId: t.databaseId,
    source: best.src, len: score(best.json), textLen: textOf(best.json).length,
    preview: textOf(best.json).slice(0, 80).replace(/\s+/g, " "), json: best.json });
  if (i % 25 === 0) console.error(`  진행 ${i}/${targets.length} ...`);
}

plan.sort((a, b) => b.len - a.len);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "restore_plan.json"), JSON.stringify(plan, null, 0));
console.log(`\n=== 복구 계획: ${plan.length} 페이지 ===`);
const bySrc = {}; for (const p of plan) bySrc[p.source.split(":")[0]] = (bySrc[p.source.split(":")[0]] || 0) + 1;
console.log("소스 분포:", bySrc);
console.log("상위 25 미리보기:");
for (const p of plan.slice(0, 25)) console.log(`  [${p.source}] len=${p.len} "${p.title.slice(0,30)}" :: ${p.preview}`);

if (!WRITE) { console.log("\n(DRY-RUN — 쓰기 없음. restore_plan.json 저장됨)"); process.exit(0); }

// ---- WRITE: 백업 후 upsert ----
console.log("\n=== WRITE 모드: 현재 doc 백업 후 복원 ===");
const backup = {};
for (const p of plan) {
  const cur = aws(["dynamodb", "get-item", "--table-name", "quicknote-page",
    "--key", JSON.stringify({ id: { S: p.id } }), "--projection-expression", "#d, updatedAt",
    "--expression-attribute-names", JSON.stringify({ "#d": "doc" })]);
  backup[p.id] = cur.Item || null;
}
fs.writeFileSync(path.join(OUT_DIR, `server_doc_backup_${Date.now()}.json`), JSON.stringify(backup));
console.log("  백업 저장:", Object.keys(backup).length, "페이지");

let ok = 0, fail = 0;
for (const p of plan) {
  const nowIso = new Date().toISOString();
  const docStr = JSON.stringify(p.json);
  try {
    aws(["dynamodb", "update-item", "--table-name", "quicknote-page",
      "--key", JSON.stringify({ id: { S: p.id } }),
      "--update-expression", "SET #d = :doc, updatedAt = :u",
      "--expression-attribute-names", JSON.stringify({ "#d": "doc" }),
      "--expression-attribute-values", JSON.stringify({ ":doc": { S: docStr }, ":u": { S: nowIso } })]);
    ok++;
  } catch (e) { fail++; console.error("  실패", p.id, e.message.slice(0, 120)); }
  if ((ok + fail) % 25 === 0) console.error(`  쓰기 ${ok + fail}/${plan.length}`);
}
console.log(`\n=== 완료: 복원 ${ok} 성공 / ${fail} 실패 ===`);
