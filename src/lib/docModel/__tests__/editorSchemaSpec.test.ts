// 에디터 스키마 스냅샷(editorSchemaSpec.json) 드리프트 검사.
// 확장/스키마를 바꿨다면 `npm run gen:editor-schema` 로 재생성 후 커밋한다(서버 MCP Lambda 가 사용).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getSchema } from "@tiptap/core";
import { createLowlight, common } from "lowlight";
import { buildEditorExtensions } from "../../../components/editor/useEditorExtensions";
import { EDITOR_UNIQUE_ID_TYPES } from "../../blocks/editorPolicy";
import { serializeSchema } from "../editorSchemaSpec";

const SPEC_PATH = resolve(__dirname, "../editorSchemaSpec.json");

// dateInline.value 기본값이 todayValue()(스키마 생성 시점 날짜)라 시각을 고정해 스냅샷을 결정적으로 만든다.
// ⚠ 서버는 이 기본값에 의존하지 말고 dateInline 생성 시 value 를 항상 명시해야 한다.
const FIXED_NOW = new Date("2000-01-01T12:00:00Z");

const BASE_PARAMS = {
  isFullPageDatabase: false,
  effectivePageId: null,
  myMemberId: undefined,
  collabDoc: null,
  collabAwareness: null,
} as const;

function liveSpec(lowlight: boolean) {
  const lowlightApi = lowlight ? createLowlight(common) : null;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
  try {
    const spec = serializeSchema(getSchema(buildEditorExtensions({ ...BASE_PARAMS, lowlightApi })), {
      uniqueIdTypes: EDITOR_UNIQUE_ID_TYPES,
    });
    // JSON 왕복으로 undefined 값을 정규화해 커밋된 파일과 동일 조건에서 비교한다.
    return JSON.parse(JSON.stringify(spec));
  } finally {
    vi.useRealTimers();
  }
}

describe("editorSchemaSpec", () => {
  it("커밋된 스냅샷이 라이브 에디터 스키마와 일치한다", () => {
    const live = liveSpec(false);
    if (process.env.UPDATE_EDITOR_SCHEMA === "1") {
      writeFileSync(SPEC_PATH, `${JSON.stringify(live, null, 2)}\n`);
    }
    expect(existsSync(SPEC_PATH)).toBe(true);
    const committed = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
    expect(committed).toEqual(live);
  });

  it("lowlight 유무와 무관하게 동일 스키마(codeBlock 노드 스펙 동일)", () => {
    expect(liveSpec(true)).toEqual(liveSpec(false));
  });
});
