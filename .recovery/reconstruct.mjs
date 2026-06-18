// Y-룸(rt-ydoc-updates) → ProseMirror JSON 재구성 (앱 yDocToJson 과 동일 경로)
// 서버 쓰기 없음 (읽기 + 재구성만). chunked 업데이트는 rt-chunks 에서 보충.
import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import { execFileSync } from "node:child_process";

const REGION = "ap-northeast-2";

function aws(args) {
  const out = execFileSync("aws", [...args, "--region", REGION, "--output", "json"], {
    maxBuffer: 1024 * 1024 * 512,
  });
  return JSON.parse(out.toString());
}

// 한 룸의 모든 업데이트(seq 오름차순) base64 배열
export function fetchRoomUpdates(room) {
  const j = aws([
    "dynamodb", "query",
    "--table-name", "quicknote-rt-ydoc-updates",
    "--key-condition-expression", "pageId = :p",
    "--expression-attribute-values", JSON.stringify({ ":p": { S: room } }),
  ]);
  const items = (j.Items || []).sort((a, b) => (a.seq.S < b.seq.S ? -1 : 1));
  return items.map((i) => ({ seq: i.seq.S, b64: i.update?.S ?? "", chunkKey: i.chunkKey?.S, n: i.n?.N }));
}

// chunked 업데이트 보충: rt-chunks 에서 bufKey 로 조각 모아 결합
function fetchChunk(bufKey) {
  const j = aws([
    "dynamodb", "query",
    "--table-name", "quicknote-rt-chunks",
    "--key-condition-expression", "bufKey = :b",
    "--expression-attribute-values", JSON.stringify({ ":b": { S: bufKey } }),
  ]);
  const items = (j.Items || []).sort((a, b) => Number(a.i.N) - Number(b.i.N));
  return Buffer.concat(items.map((it) => Buffer.from((it.data?.B ?? it.chunk?.B ?? it.data?.S ?? ""), it.data?.B || it.chunk?.B ? undefined : "base64")));
}

export function reconstructRoom(room) {
  const updates = fetchRoomUpdates(room);
  const ydoc = new Y.Doc();
  let applied = 0;
  for (const u of updates) {
    let bytes = null;
    if (u.b64 && u.b64 !== "AAA=") bytes = Buffer.from(u.b64, "base64");
    else if (u.chunkKey) {
      try { bytes = fetchChunk(u.chunkKey); } catch { /* skip */ }
    } else if (u.b64) {
      bytes = Buffer.from(u.b64, "base64");
    }
    if (!bytes || bytes.length === 0) continue;
    try { Y.applyUpdate(ydoc, new Uint8Array(bytes)); applied++; } catch (e) { /* skip bad */ }
  }
  const json = yDocToProsemirrorJSON(ydoc, "prosemirror");
  const fragLen = ydoc.getXmlFragment("prosemirror").length;
  return { json, fragLen, updateCount: updates.length, applied };
}

export function textOf(json) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === "text" && n.text) out.push(n.text);
    (n.content || []).forEach(walk);
  };
  walk(json);
  return out.join(" ");
}

// CLI: node reconstruct.mjs <room1> <room2> ...
if (process.argv[2]) {
  for (const room of process.argv.slice(2)) {
    try {
      const r = reconstructRoom(room);
      const t = textOf(r.json);
      console.log(`\n[${room}] updates=${r.updateCount} applied=${r.applied} fragLen=${r.fragLen} textLen=${t.length}`);
      console.log("  미리보기:", t.slice(0, 220).replace(/\s+/g, " "));
    } catch (e) {
      console.log(`\n[${room}] ERROR: ${e.message}`);
    }
  }
}
