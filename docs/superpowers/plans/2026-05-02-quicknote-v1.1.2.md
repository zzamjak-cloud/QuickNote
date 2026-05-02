# QuickNote v1.1.2 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 11개 작업(슬래시 메뉴 개선, 토글 수정, 이미지 편집 단순화, 복제 기능, 컬럼 드래그, 박스 선택, 핸들 메뉴)을 구현한다.

**Architecture:** 기존 TipTap 2 Extension + Zustand store 패턴을 그대로 따른다. 신규 파일은 `src/hooks/`, `src/lib/tiptapExtensions/`에 추가하고 기존 컴포넌트를 수정한다. 테스트는 vitest.

**Tech Stack:** React 18, TipTap 2, ProseMirror, Zustand, emoji-picker-react, Lucide React, Tailwind CSS, vitest

---

## Plan Task 1: 슬래시 메뉴 — "토글 목록" 제거 + "이모지" 추가

**스펙 항목:** Task 1, Task 6

**Files:**
- Modify: `src/lib/tiptapExtensions/slashItems.ts`
- Modify: `src/components/editor/Editor.tsx`

---

- [ ] **Step 1: "토글 목록" 항목 제거**

`src/lib/tiptapExtensions/slashItems.ts` 에서 193~199줄의 아래 블록을 삭제한다:

```typescript
// 이 블록 전체 삭제 (193-199줄)
{
  title: "토글 목록",
  description: "> + 스페이스와 동일한 접기 블록",
  icon: List,
  keywords: ["toggle list", "토글 목록", "토글목록", "collapse list"],
  command: ({ editor, range }) =>
    editor.chain().focus().deleteRange(range).setToggle().run(),
},
```

- [ ] **Step 2: "이모지" 항목 추가**

`slashItems.ts` 상단 import에 `Smile` 추가:
```typescript
import {
  // ... 기존 imports
  Smile,
} from "lucide-react";
```

"이미지" 항목(131줄) 바로 다음에 "이모지" 항목 추가:
```typescript
{
  title: "이모지",
  description: "이모지 아이콘 삽입",
  icon: Smile,
  keywords: ["emoji", "이모지", "아이콘", "icon", "emoticon"],
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).run();
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("quicknote:open-emoji-picker"));
    }, 0);
  },
},
```

- [ ] **Step 3: Editor.tsx에 이모지 피커 상태 추가**

`Editor.tsx`의 `useState` 선언부에 추가:
```typescript
const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
const emojiInsertPosRef = useRef<number | null>(null);
```

기존 `useEffect(() => { const open = () => setImageOpen(true); ... }, []);` 바로 다음에 추가:
```typescript
useEffect(() => {
  const open = () => {
    if (!editor) return;
    emojiInsertPosRef.current = editor.state.selection.from;
    setEmojiPickerOpen(true);
  };
  window.addEventListener("quicknote:open-emoji-picker", open);
  return () => window.removeEventListener("quicknote:open-emoji-picker", open);
}, [editor]);
```

- [ ] **Step 4: Editor.tsx JSX에 이모지 피커 렌더링 추가**

기존 `<ImageUpload ... />` 바로 아래에 추가:
```tsx
{emojiPickerOpen && (
  <div
    className="fixed inset-0 z-50"
    onMouseDown={(e) => {
      if (e.target === e.currentTarget) setEmojiPickerOpen(false);
    }}
  >
    <div
      className="absolute"
      style={{
        top: (() => {
          if (!editor || emojiInsertPosRef.current === null) return 200;
          try {
            const coords = editor.view.coordsAtPos(emojiInsertPosRef.current);
            return coords.bottom + 8;
          } catch {
            return 200;
          }
        })(),
        left: (() => {
          if (!editor || emojiInsertPosRef.current === null) return 200;
          try {
            const coords = editor.view.coordsAtPos(emojiInsertPosRef.current);
            return coords.left;
          } catch {
            return 200;
          }
        })(),
      }}
    >
      <EmojiPickerReact
        theme={darkMode ? Theme.DARK : Theme.LIGHT}
        emojiStyle={EmojiStyle.NATIVE}
        previewConfig={{ showPreview: false }}
        searchDisabled={false}
        lazyLoadEmojis
        width={320}
        height={380}
        onEmojiClick={(data) => {
          if (editor && emojiInsertPosRef.current !== null) {
            editor
              .chain()
              .focus()
              .insertContentAt(emojiInsertPosRef.current, data.emoji)
              .run();
          }
          setEmojiPickerOpen(false);
        }}
      />
    </div>
  </div>
)}
```

`Editor.tsx` 상단 import에 추가:
```typescript
import EmojiPickerReact, { EmojiStyle, Theme } from "emoji-picker-react";
const darkMode = useSettingsStore((s) => s.darkMode);
```

`useSettingsStore` import 추가:
```typescript
import { useSettingsStore } from "../../store/settingsStore";
```

- [ ] **Step 5: filterSlashItems 테스트 확인**

`src/__tests__/` 에 슬래시 아이템 테스트가 없으면, 기존 빌드 타입 체크로 확인:
```bash
npm run build 2>&1 | tail -20
```
에러 없으면 OK.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/tiptapExtensions/slashItems.ts src/components/editor/Editor.tsx
git commit -m "feat: 슬래시 메뉴 - 토글 목록 중복 제거, 이모지 항목 추가 (#Task1 #Task6)"
```

---

## Plan Task 2: 토글 접기/펼치기 수정 + 세로 라인 제거

**스펙 항목:** Task 2

**Files:**
- Modify: `src/lib/tiptapExtensions/toggle.ts`

---

- [ ] **Step 1: ToggleContent 세로 라인 CSS 제거**

`toggle.ts` 55줄의 `ToggleContent.renderHTML` 에서 `border-l border-zinc-200 dark:border-zinc-700` 제거:

```typescript
// 변경 전:
"data-toggle-content": "",
class: "toggle-content ml-5 border-l border-zinc-200 pl-3 dark:border-zinc-700",

// 변경 후:
"data-toggle-content": "",
class: "toggle-content ml-4 pl-2",
```

- [ ] **Step 2: ProseMirror click 플러그인 추가 (접기/펼치기)**

`toggle.ts` 상단에 import 추가:
```typescript
import { InputRule, Node, mergeAttributes, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
```

`Toggle` 노드 정의 안에 `addProseMirrorPlugins` 추가 (`addCommands` 다음):
```typescript
addProseMirrorPlugins() {
  return [
    new Plugin({
      key: new PluginKey("toggleFold"),
      props: {
        handleClick(view, _pos, event) {
          const target = event.target as HTMLElement;
          const summary = target.closest?.("summary.toggle-header");
          if (!summary) return false;
          const detailsEl = summary.parentElement;
          if (!detailsEl || detailsEl.tagName !== "DETAILS") return false;

          let nodePos: number | null = null;
          view.state.doc.descendants((node, pos) => {
            if (node.type.name === "toggle") {
              const dom = view.nodeDOM(pos);
              if (dom === detailsEl) {
                nodePos = pos;
                return false;
              }
            }
            return true;
          });
          if (nodePos === null) return false;
          const node = view.state.doc.nodeAt(nodePos);
          if (!node) return false;

          event.preventDefault();
          const tr = view.state.tr.setNodeMarkup(nodePos, undefined, {
            ...node.attrs,
            open: !node.attrs.open,
          });
          view.dispatch(tr);
          return true;
        },
      },
    }),
  ];
},
```

- [ ] **Step 3: 빌드 타입 체크**

```bash
npm run build 2>&1 | tail -20
```
에러 없으면 OK.

- [ ] **Step 4: 커밋**

```bash
git add src/lib/tiptapExtensions/toggle.ts
git commit -m "fix: 토글 블록 세로 라인 제거, 클릭으로 접기/펼치기 기능 수정 (#Task2)"
```

---

## Plan Task 3: 이모지 단축코드 Extension

**스펙 항목:** Task 7

**Files:**
- Create: `src/lib/tiptapExtensions/emojiShortcode.ts`
- Modify: `src/components/editor/Editor.tsx`

---

- [ ] **Step 1: 이모지 매핑 + Extension 파일 생성**

`src/lib/tiptapExtensions/emojiShortcode.ts` 신규 생성:

```typescript
import { Extension, InputRule } from "@tiptap/core";

const EMOJI_MAP: Record<string, string> = {
  체크: "✅",
  확인: "✔️",
  별: "⭐",
  하트: "❤️",
  불: "🔥",
  웃음: "😊",
  경고: "⚠️",
  정보: "ℹ️",
  아이디어: "💡",
  메모: "📝",
  집: "🏠",
  사람: "👤",
  손: "👋",
  박수: "👏",
  엄지: "👍",
  금지: "🚫",
  질문: "❓",
  느낌표: "❗",
  시계: "🕐",
  달력: "📅",
  책: "📚",
  링크: "🔗",
  잠금: "🔒",
  열쇠: "🔑",
  검색: "🔍",
  설정: "⚙️",
  삭제: "🗑️",
  복사: "📋",
  저장: "💾",
  편집: "✏️",
  화살표위: "⬆️",
  화살표아래: "⬇️",
  화살표왼쪽: "⬅️",
  화살표오른쪽: "➡️",
  check: "✅",
  star: "⭐",
  heart: "❤️",
  fire: "🔥",
  warning: "⚠️",
  info: "ℹ️",
  idea: "💡",
  note: "📝",
  pin: "📌",
  flag: "🚩",
};

export const EmojiShortcode = Extension.create({
  name: "emojiShortcode",

  addInputRules() {
    return [
      new InputRule({
        find: /:([a-zA-Z가-힣]+):$/,
        handler: ({ chain, range, match }) => {
          const keyword = (match[1] ?? "").toLowerCase();
          const emoji = EMOJI_MAP[keyword];
          if (!emoji) return null;
          chain().deleteRange(range).insertContent(emoji).run();
        },
      }),
    ];
  },
});
```

- [ ] **Step 2: Editor.tsx 에 Extension 등록**

`Editor.tsx` import에 추가:
```typescript
import { EmojiShortcode } from "../../lib/tiptapExtensions/emojiShortcode";
```

`extensions` 배열에 추가 (PageMention 다음):
```typescript
EmojiShortcode,
```

- [ ] **Step 3: 빌드 체크**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 4: 커밋**

```bash
git add src/lib/tiptapExtensions/emojiShortcode.ts src/components/editor/Editor.tsx
git commit -m "feat: 이모지 단축코드 지원 - :체크: 입력시 이모지 자동 삽입 (#Task7)"
```

---

## Plan Task 4: 이미지 편집 단순화

**스펙 항목:** Task 5

**Files:**
- Modify: `src/components/editor/ImageBubbleToolbar.tsx`
- Modify: `src/components/editor/ImageEditModal.tsx`

---

- [ ] **Step 1: ImageBubbleToolbar 버튼 교체**

`src/components/editor/ImageBubbleToolbar.tsx` 를 다음으로 교체:

```typescript
import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Crop, Square } from "lucide-react";
import { NodeSelection } from "@tiptap/pm/state";
import { ImageEditModal } from "./ImageEditModal";

type Props = {
  editor: Editor;
};

export function ImageBubbleToolbar({ editor }: Props) {
  const [cropOpen, setCropOpen] = useState(false);

  const sel = editor.state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== "image") {
    return null;
  }

  const imagePos = sel.from;
  const node = sel.node;
  const hasOutline = Number(node.attrs.outlineWidth ?? 0) > 0;

  const toggleOutline = () => {
    if (hasOutline) {
      editor
        .chain()
        .focus()
        .updateAttributes("image", { outlineWidth: 0 })
        .run();
    } else {
      editor
        .chain()
        .focus()
        .updateAttributes("image", { outlineWidth: 1, outlineColor: "#000000" })
        .run();
    }
  };

  return (
    <>
      <div className="flex items-center gap-0.5 border-l border-zinc-200 pl-1 dark:border-zinc-700">
        <button
          type="button"
          title="이미지 크롭"
          onClick={() => setCropOpen(true)}
          className={[
            "flex h-7 items-center gap-1 rounded px-2 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800",
            "text-zinc-700 dark:text-zinc-200",
          ].join(" ")}
        >
          <Crop size={14} />
        </button>
        <button
          type="button"
          title="1px 검은색 아웃라인 토글"
          onClick={toggleOutline}
          className={[
            "flex h-7 items-center gap-1 rounded px-2 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800",
            hasOutline
              ? "text-zinc-900 dark:text-zinc-100"
              : "text-zinc-400 dark:text-zinc-500",
          ].join(" ")}
        >
          <Square size={14} />
        </button>
      </div>
      <ImageEditModal
        editor={editor}
        open={cropOpen}
        imagePos={imagePos}
        onClose={() => setCropOpen(false)}
      />
    </>
  );
}
```

- [ ] **Step 2: ImageEditModal에서 아웃라인 UI 제거**

`src/components/editor/ImageEditModal.tsx` 에서 아웃라인 관련 섹션(OUTLINE_COLORS, outlineWidth/outlineColor UI)을 제거하고 크롭 기능만 남긴다. 

`ImageAttrs` 타입을 단순화:
```typescript
type ImageAttrs = {
  cropTop: number;
  cropLeft: number;
  cropWidth: number;
  cropHeight: number;
  width: number | null;
  height: number | null;
};
```

`attrsFromNode` 함수를 단순화:
```typescript
function attrsFromNode(editor: Editor, pos: number): ImageAttrs | null {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "image") return null;
  const a = node.attrs as Record<string, unknown>;
  const wRaw = a.width;
  const hRaw = a.height;
  return {
    cropTop: Number(a.cropTop ?? 0),
    cropLeft: Number(a.cropLeft ?? 0),
    cropWidth: Number(a.cropWidth ?? 100),
    cropHeight: Number(a.cropHeight ?? 100),
    width: wRaw != null && Number.isFinite(Number(wRaw)) ? Number(wRaw) : null,
    height: hRaw != null && Number.isFinite(Number(hRaw)) ? Number(hRaw) : null,
  };
}
```

적용 버튼 로직에서 크롭 attrs만 업데이트하도록 수정 (`outlineWidth`, `outlineColor` 제거).

- [ ] **Step 3: 빌드 체크**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 4: 커밋**

```bash
git add src/components/editor/ImageBubbleToolbar.tsx src/components/editor/ImageEditModal.tsx
git commit -m "feat: 이미지 편집 단순화 - 크롭/아웃라인 토글 버튼으로 교체 (#Task5)"
```

---

## Plan Task 5: Store 확장 — duplicatePage + fullWidth

**스펙 항목:** Task 8(전체너비), Task 9(페이지 복제)

**Files:**
- Modify: `src/store/settingsStore.ts`
- Modify: `src/store/pageStore.ts`
- Modify: `src/__tests__/pageStore.test.ts`

---

- [ ] **Step 1: settingsStore에 fullWidth 추가 (테스트 먼저)**

`src/__tests__/pageStore.test.ts` 에 테스트 추가 (아직 없으면 settingsStore 테스트를 해당 파일에 추가하거나 별도 파일 생성):

```typescript
// 기존 pageStore.test.ts 파일 하단에 추가 or 별도 파일
import { useSettingsStore } from "../store/settingsStore";

describe("settingsStore", () => {
  it("toggleFullWidth이 fullWidth를 토글한다", () => {
    const store = useSettingsStore.getState();
    expect(store.fullWidth).toBe(false);
    store.toggleFullWidth();
    expect(useSettingsStore.getState().fullWidth).toBe(true);
    store.toggleFullWidth();
    expect(useSettingsStore.getState().fullWidth).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npm test -- --run 2>&1 | tail -20
```
Expected: `fullWidth` is not a function 에러

- [ ] **Step 3: settingsStore에 fullWidth 추가**

`src/store/settingsStore.ts` 의 `SettingsState` 타입에 추가:
```typescript
type SettingsState = {
  // ... 기존
  fullWidth: boolean;
};
```

`SettingsActions` 에 추가:
```typescript
type SettingsActions = {
  // ... 기존
  toggleFullWidth: () => void;
};
```

`create` 내부 초기값에 추가:
```typescript
fullWidth: false,
```

`create` 내부 액션에 추가:
```typescript
toggleFullWidth: () => set((s) => ({ fullWidth: !s.fullWidth })),
```

- [ ] **Step 4: pageStore에 duplicatePage 테스트 작성**

기존 `src/__tests__/pageStore.test.ts` 에 추가:

```typescript
describe("pageStore - duplicatePage", () => {
  beforeEach(() => {
    usePageStore.setState({ pages: {}, activePageId: null });
  });

  it("페이지를 복제하면 원본 바로 다음에 삽입된다", () => {
    const store = usePageStore.getState();
    const id = store.createPage("원본");
    usePageStore.getState().duplicatePage(id);
    const pages = Object.values(usePageStore.getState().pages);
    expect(pages).toHaveLength(2);
    const copy = pages.find((p) => p.id !== id);
    expect(copy?.title).toBe("원본 (복사본)");
    expect(copy?.parentId).toBe(null);
  });

  it("자식 페이지도 함께 복제된다", () => {
    const store = usePageStore.getState();
    const parentId = store.createPage("부모");
    usePageStore.getState().createPage("자식", parentId);
    usePageStore.getState().duplicatePage(parentId);
    const pages = Object.values(usePageStore.getState().pages);
    expect(pages).toHaveLength(4); // 원본 부모+자식, 복제 부모+자식
  });
});
```

- [ ] **Step 5: 테스트 실행 → 실패 확인**

```bash
npm test -- --run 2>&1 | tail -20
```
Expected: `duplicatePage is not a function`

- [ ] **Step 6: pageStore에 duplicatePage 구현**

`src/store/pageStore.ts` 의 `PageStoreActions` 타입에 추가:
```typescript
type PageStoreActions = {
  // ... 기존
  duplicatePage: (id: string) => string;
};
```

`create` 내부에 구현 추가:
```typescript
duplicatePage: (id) => {
  const state = get();
  const source = state.pages[id];
  if (!source) return "";

  const cloneMap = new Map<string, string>(); // 구 id → 새 id

  const cloneSubtree = (pageId: string): void => {
    const page = state.pages[pageId];
    if (!page) return;
    const clonedId = newId();
    cloneMap.set(pageId, clonedId);
    const children = Object.values(state.pages).filter(
      (p) => p.parentId === pageId
    );
    for (const child of children) {
      cloneSubtree(child.id);
    }
  };
  cloneSubtree(id);

  const now = Date.now();
  const newPages: PageMap = {};
  for (const [origId, newPageId] of cloneMap.entries()) {
    const orig = state.pages[origId]!;
    const isRoot = origId === id;
    newPages[newPageId] = {
      ...orig,
      id: newPageId,
      title: isRoot ? `${orig.title} (복사본)` : orig.title,
      parentId: isRoot
        ? orig.parentId
        : cloneMap.get(orig.parentId ?? "") ?? orig.parentId,
      order: isRoot ? orig.order + 0.5 : orig.order,
      createdAt: now,
      updatedAt: now,
    };
  }

  // 같은 부모의 형제 order 재정규화
  set((s) => {
    const merged = { ...s.pages, ...newPages };
    const siblings = Object.values(merged)
      .filter((p) => p.parentId === source.parentId)
      .sort((a, b) => a.order - b.order);
    siblings.forEach((p, i) => {
      merged[p.id] = { ...merged[p.id]!, order: i };
    });
    return { pages: merged };
  });

  return cloneMap.get(id) ?? "";
},
```

- [ ] **Step 7: 테스트 실행 → 통과 확인**

```bash
npm test -- --run 2>&1 | tail -20
```
Expected: all tests pass

- [ ] **Step 8: 커밋**

```bash
git add src/store/settingsStore.ts src/store/pageStore.ts src/__tests__/
git commit -m "feat: pageStore.duplicatePage, settingsStore.fullWidth 추가 (#Task8 #Task9 storeLayer)"
```

---

## Plan Task 6: TopBar 페이지 메뉴 버튼

**스펙 항목:** Task 8

**Files:**
- Modify: `src/components/layout/TopBar.tsx`

---

- [ ] **Step 1: TopBar 메뉴 버튼 구현**

`src/components/layout/TopBar.tsx` 전체를 교체:

```typescript
import { ChevronRight, Moon, Sun, MoreHorizontal } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import type { Page } from "../../types/page";
import { useSettingsStore } from "../../store/settingsStore";
import { usePageStore } from "../../store/pageStore";

export function TopBar() {
  const darkMode = useSettingsStore((s) => s.darkMode);
  const toggleDarkMode = useSettingsStore((s) => s.toggleDarkMode);
  const fullWidth = useSettingsStore((s) => s.fullWidth);
  const toggleFullWidth = useSettingsStore((s) => s.toggleFullWidth);
  const activeId = usePageStore((s) => s.activePageId);
  const pages = usePageStore((s) => s.pages);
  const setActive = usePageStore((s) => s.setActivePage);
  const duplicatePage = usePageStore((s) => s.duplicatePage);
  const deletePage = usePageStore((s) => s.deletePage);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // breadcrumb
  const breadcrumb: { id: string; title: string; icon: string | null }[] = [];
  if (activeId) {
    let cursor: string | null = activeId;
    while (cursor !== null) {
      const page: Page | undefined = pages[cursor];
      if (!page) break;
      breadcrumb.unshift({ id: page.id, title: page.title, icon: page.icon });
      cursor = page.parentId;
    }
  }

  // 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  // 전역 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !activeId) return;
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        void navigator.clipboard.writeText(`quicknote://page/${activeId}`);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId]);

  const handleDuplicate = () => {
    if (!activeId) return;
    const newId = duplicatePage(activeId);
    if (newId) setActive(newId);
    setMenuOpen(false);
  };

  const handleDelete = () => {
    if (!activeId) return;
    deletePage(activeId);
    setMenuOpen(false);
  };

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-1 items-center gap-1 overflow-hidden text-xs text-zinc-500 dark:text-zinc-400">
        {breadcrumb.length === 0 ? (
          <span>페이지를 선택하거나 새로 만드세요</span>
        ) : (
          breadcrumb.map((node, idx) => (
            <div key={node.id} className="flex items-center gap-1">
              {idx > 0 && (
                <ChevronRight size={12} className="text-zinc-300" />
              )}
              <button
                type="button"
                onClick={() => setActive(node.id)}
                className={[
                  "flex items-center gap-1 truncate rounded px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  idx === breadcrumb.length - 1
                    ? "text-zinc-900 dark:text-zinc-100"
                    : "",
                ].join(" ")}
              >
                <span>{node.icon ?? "·"}</span>
                <span className="max-w-32 truncate">
                  {node.title || "제목 없음"}
                </span>
              </button>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggleDarkMode}
          className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="다크 모드 토글"
          title="다크 모드 토글"
        >
          {darkMode ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {activeId && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label="페이지 메뉴"
              title="페이지 메뉴"
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      `quicknote://page/${activeId}`
                    );
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span>링크 복사</span>
                  <span className="text-xs text-zinc-400">⌘L</span>
                </button>
                <button
                  type="button"
                  onClick={handleDuplicate}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span>페이지 복제</span>
                  <span className="text-xs text-zinc-400">⌘D</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    toggleFullWidth();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span>전체 너비</span>
                  <span className="text-xs text-zinc-400">
                    {fullWidth ? "✓" : ""}
                  </span>
                </button>
                <hr className="my-1 border-zinc-200 dark:border-zinc-700" />
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex w-full items-center px-3 py-2 text-left text-sm text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  페이지 삭제
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Editor.tsx에 전체 너비 적용**

`Editor.tsx`에 `fullWidth` 구독 추가 및 max-w 조건부 적용:

```typescript
// Editor 함수 내 상단에 추가
const fullWidth = useSettingsStore((s) => s.fullWidth);
```

JSX에서 `max-w-3xl`을 조건부로:
```tsx
// 변경 전:
<div className="relative mx-auto w-full max-w-3xl">

// 변경 후:
<div className={`relative mx-auto w-full ${fullWidth ? "max-w-none px-4" : "max-w-3xl"}`}>
```

- [ ] **Step 3: 빌드 체크**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 4: 커밋**

```bash
git add src/components/layout/TopBar.tsx src/components/editor/Editor.tsx
git commit -m "feat: TopBar 페이지 메뉴 버튼 추가 (링크복사/복제/전체너비/삭제) (#Task8)"
```

---

## Plan Task 7: Sidebar Cmd+D 페이지 복제

**스펙 항목:** Task 9

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

---

- [ ] **Step 1: Sidebar에 Cmd+D 핸들러 추가**

`src/components/layout/Sidebar.tsx`를 읽고 `activeId`를 추적하는 `useEffect`에 keydown 리스너 추가.

기존 import에 추가:
```typescript
import { usePageStore } from "../../store/pageStore";
```
(이미 있으면 `duplicatePage` 추가만)

`Sidebar` 컴포넌트 내에 추가:
```typescript
const duplicatePage = usePageStore((s) => s.duplicatePage);
const setActivePage = usePageStore((s) => s.setActivePage);
const activePageId = usePageStore((s) => s.activePageId);

useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    // 에디터가 포커스되어 있으면 Sidebar의 Cmd+D 가 발동하지 않아야 함
    const activeEl = document.activeElement;
    const isEditorFocused =
      activeEl?.classList.contains("ProseMirror") ||
      activeEl?.closest(".ProseMirror") !== null;
    if (isEditorFocused) return;

    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "d" || e.key === "D") && activePageId) {
      e.preventDefault();
      const newId = duplicatePage(activePageId);
      if (newId) setActivePage(newId);
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [activePageId, duplicatePage, setActivePage]);
```

- [ ] **Step 2: 빌드 체크**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 3: 커밋**

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "feat: 사이드바 Cmd+D 페이지 복제 기능 (#Task9)"
```

---

## Plan Task 8: Editor Cmd+D 블럭 복제

**스펙 항목:** Task 10

**Files:**
- Modify: `src/components/editor/Editor.tsx`

---

- [ ] **Step 1: BlockDuplicate Extension 추가**

`Editor.tsx` import에 추가:
```typescript
import { Extension } from "@tiptap/core";
```

`extensions` 배열 내 맨 마지막에 추가:
```typescript
Extension.create({
  name: "blockDuplicate",
  addKeyboardShortcuts() {
    return {
      "Mod-d": () => {
        const { state, view } = this.editor;
        const { $from } = state.selection;
        if ($from.depth < 1) return false;

        // 문서 최상위 블럭 (depth=1) 복제
        const nodeStart = $from.before(1);
        const node = $from.node(1);
        if (!node) return false;

        const insertAt = nodeStart + node.nodeSize;
        const tr = state.tr.insert(insertAt, node.copy(node.content));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
}),
```

- [ ] **Step 2: 빌드 체크 + Sidebar Cmd+D 우선순위 검증**

Editor ProseMirror가 `Mod-d`를 처리하므로 에디터 포커스 시 항상 블럭 복제가 우선. Sidebar 핸들러는 `isEditorFocused` 체크로 에디터 포커스 시 동작하지 않음 — 두 기능이 충돌하지 않는다.

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 3: 커밋**

```bash
git add src/components/editor/Editor.tsx
git commit -m "feat: 에디터 Cmd+D 블럭 복제 기능 (#Task10)"
```

---

## Plan Task 9: 컬럼 분할 드래그

**스펙 항목:** Task 3

**Files:**
- Modify: `src/components/editor/Editor.tsx`
- Modify: `src/index.css`

---

- [ ] **Step 1: index.css에 column-drop 시각적 스타일 추가**

`src/index.css` 파일 끝에 추가:
```css
/* 컬럼 드롭 인디케이터 */
.qn-column-drop-indicator {
  position: fixed;
  top: 0;
  width: 2px;
  background: transparent;
  border-left: 2px dashed #3b82f6;
  pointer-events: none;
  z-index: 100;
}
```

- [ ] **Step 2: Editor.tsx에 column drop state + dragover 리스너 추가**

`Editor.tsx`에 상태 및 ref 추가:
```typescript
const columnDropRef = useRef<{
  side: "left" | "right";
  targetBlockStart: number;
} | null>(null);

const [columnDropIndicator, setColumnDropIndicator] = useState<{
  x: number;
  top: number;
  height: number;
} | null>(null);
```

에디터 준비 후 `useEffect`에 dragover/dragend 리스너 추가:
```typescript
useEffect(() => {
  if (!editor) return;
  const dom = editor.view.dom;

  const clearDrop = () => {
    columnDropRef.current = null;
    setColumnDropIndicator(null);
  };

  const onDragOver = (e: DragEvent) => {
    if (!document.body.classList.contains("quicknote-block-dragging")) return;
    e.preventDefault();

    // 대상 블럭 찾기
    const coords = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (!coords) { clearDrop(); return; }
    let $pos;
    try { $pos = editor.state.doc.resolve(coords.pos); } catch { clearDrop(); return; }

    // 최상위 블럭(depth=1) 찾기
    let targetNode = null;
    let targetStart = -1;
    for (let d = $pos.depth; d >= 1; d--) {
      const n = $pos.node(d);
      if (n.isBlock && n.type.name !== "doc") {
        if (d === 1 || $pos.node(d - 1).type.name === "doc") {
          targetNode = n;
          targetStart = $pos.before(d);
          break;
        }
      }
    }
    if (!targetNode || targetStart < 0) { clearDrop(); return; }

    const domEl = editor.view.nodeDOM(targetStart);
    const el = domEl instanceof HTMLElement ? domEl : (domEl as Node | null)?.parentElement;
    if (!el) { clearDrop(); return; }
    const rect = el.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const pct = relX / rect.width;

    if (pct < 0.3) {
      columnDropRef.current = { side: "left", targetBlockStart: targetStart };
      setColumnDropIndicator({ x: rect.left - 1, top: rect.top, height: rect.height });
    } else if (pct > 0.7) {
      columnDropRef.current = { side: "right", targetBlockStart: targetStart };
      setColumnDropIndicator({ x: rect.right - 1, top: rect.top, height: rect.height });
    } else {
      clearDrop();
    }
  };

  dom.addEventListener("dragover", onDragOver);
  dom.addEventListener("dragleave", clearDrop);
  document.addEventListener("dragend", clearDrop);
  return () => {
    dom.removeEventListener("dragover", onDragOver);
    dom.removeEventListener("dragleave", clearDrop);
    document.removeEventListener("dragend", clearDrop);
  };
}, [editor]);
```

- [ ] **Step 3: editorProps.handleDrop에 column split 처리 추가**

`editorProps`의 `handleDrop`을 다음과 같이 수정:
```typescript
handleDrop: (
  view: import("@tiptap/pm/view").EditorView,
  event: DragEvent,
  _slice: unknown,
  moved: boolean,
) => {
  // 컬럼 분할 드롭 처리
  if (moved && columnDropRef.current) {
    const { side, targetBlockStart } = columnDropRef.current;
    columnDropRef.current = null;
    setColumnDropIndicator(null);

    const sel = view.state.selection;
    // NodeSelection은 Editor.tsx 상단에 이미 추가한 import 사용
    if (!(sel instanceof NodeSelection)) return false;

    const draggedStart = sel.from;
    const draggedNode = sel.node;
    const targetNode = view.state.doc.nodeAt(targetBlockStart);
    if (!targetNode || draggedStart === targetBlockStart) return false;

    const { schema } = view.state;
    if (!schema.nodes.column || !schema.nodes.columnLayout) return false;

    event.preventDefault();

    const pos1 = Math.min(draggedStart, targetBlockStart);
    const pos2 = Math.max(draggedStart, targetBlockStart);
    const node1 = view.state.doc.nodeAt(pos1)!;
    const node2 = view.state.doc.nodeAt(pos2)!;

    // side: 드래그한 블럭이 왼쪽(left)에 놓이는지 오른쪽(right)에 놓이는지
    const leftNode =
      side === "left"
        ? (draggedStart < targetBlockStart ? draggedNode : targetNode)
        : (draggedStart < targetBlockStart ? targetNode : draggedNode);
    const rightNode =
      side === "left"
        ? (draggedStart < targetBlockStart ? targetNode : draggedNode)
        : (draggedStart < targetBlockStart ? draggedNode : targetNode);

    const col1 = schema.nodes.column.create({}, leftNode.copy(leftNode.content));
    const col2 = schema.nodes.column.create({}, rightNode.copy(rightNode.content));
    const layout = schema.nodes.columnLayout.create({ cols: 2 }, [col1, col2]);

    const tr = view.state.tr;
    // 높은 위치부터 삭제 (낮은 위치 영향 없음)
    tr.delete(pos2, pos2 + node2.nodeSize);
    tr.delete(pos1, pos1 + node1.nodeSize);
    tr.insert(pos1, layout);
    view.dispatch(tr.scrollIntoView());
    return true;
  }

  // 기존 이미지 드롭 처리
  if (moved) return false;
  // ... 기존 코드 (이미지 파일 드롭)
```

`NodeSelection` import 추가 (Editor.tsx 상단):
```typescript
import { NodeSelection } from "@tiptap/pm/state";
```

- [ ] **Step 4: 인디케이터 JSX 추가**

Editor JSX 반환부 안에, `<BlockHandles>` 아래 추가:
```tsx
{columnDropIndicator && (
  <div
    className="qn-column-drop-indicator"
    style={{
      left: columnDropIndicator.x,
      top: columnDropIndicator.top,
      height: columnDropIndicator.height,
    }}
  />
)}
```

- [ ] **Step 5: 빌드 체크**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 6: 커밋**

```bash
git add src/components/editor/Editor.tsx src/index.css
git commit -m "feat: 블럭 드래그로 컬럼 분할 기능 구현 (#Task3)"
```

---

## Plan Task 10: 박스 드래그 다중 블럭 선택

**스펙 항목:** Task 4

**Files:**
- Create: `src/hooks/useBoxSelect.ts`
- Modify: `src/components/editor/Editor.tsx`
- Modify: `src/index.css`

---

- [ ] **Step 1: index.css에 box-select 스타일 추가**

`src/index.css` 파일 끝에 추가:
```css
/* 박스 선택 */
.qn-box-select-rect {
  position: fixed;
  border: 2px dashed #3b82f6;
  background: rgba(59, 130, 246, 0.05);
  pointer-events: none;
  z-index: 50;
}

.block-selected {
  outline: 2px solid rgba(59, 130, 246, 0.5);
  border-radius: 4px;
  background: rgba(59, 130, 246, 0.04);
}
```

- [ ] **Step 2: useBoxSelect 훅 생성**

`src/hooks/useBoxSelect.ts` 신규 생성:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

type Rect = { x: number; y: number; w: number; h: number };

export function useBoxSelect(editor: Editor | null) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<Rect | null>(null);
  const [selectedStarts, setSelectedStarts] = useState<number[]>([]);
  const activeRef = useRef(false);

  const clearSelection = useCallback(() => {
    setSelectedStarts([]);
    document
      .querySelectorAll(".block-selected")
      .forEach((el) => el.classList.remove("block-selected"));
  }, []);

  const getTopLevelBlocks = useCallback((): { el: HTMLElement; pos: number }[] => {
    if (!editor) return [];
    const result: { el: HTMLElement; pos: number }[] = [];
    editor.state.doc.forEach((node, offset) => {
      const dom = editor.view.nodeDOM(offset);
      const el = dom instanceof HTMLElement ? dom : (dom as Node | null)?.parentElement;
      if (el) result.push({ el, pos: offset });
    });
    return result;
  }, [editor]);

  const updateSelection = useCallback(
    (rect: Rect) => {
      const blocks = getTopLevelBlocks();
      const newStarts: number[] = [];
      blocks.forEach(({ el, pos }) => {
        const br = el.getBoundingClientRect();
        const intersects =
          br.left < rect.x + rect.w &&
          br.right > rect.x &&
          br.top < rect.y + rect.h &&
          br.bottom > rect.y;
        if (intersects) {
          el.classList.add("block-selected");
          newStarts.push(pos);
        } else {
          el.classList.remove("block-selected");
        }
      });
      setSelectedStarts(newStarts);
    },
    [getTopLevelBlocks],
  );

  useEffect(() => {
    if (!editor) return;
    const container = editor.view.dom.parentElement;
    if (!container) return;

    const onMouseDown = (e: MouseEvent) => {
      // 텍스트 편집 영역 클릭은 무시 (ProseMirror가 처리)
      const target = e.target as HTMLElement;
      const isProseMirrorContent =
        target.closest(".ProseMirror") !== null &&
        target !== editor.view.dom.parentElement;

      // 빈 공간(ProseMirror 외부 또는 에디터 컨테이너 자체) 클릭 시에만 rubber-band
      if (isProseMirrorContent) return;
      if (e.button !== 0) return;

      startRef.current = { x: e.clientX, y: e.clientY };
      activeRef.current = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!startRef.current) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;

      if (!activeRef.current && Math.sqrt(dx * dx + dy * dy) < 8) return;
      activeRef.current = true;

      const rect: Rect = {
        x: Math.min(e.clientX, startRef.current.x),
        y: Math.min(e.clientY, startRef.current.y),
        w: Math.abs(dx),
        h: Math.abs(dy),
      };
      setDragRect(rect);
      updateSelection(rect);
    };

    const onMouseUp = () => {
      startRef.current = null;
      setDragRect(null);
      if (!activeRef.current) {
        clearSelection();
      }
      activeRef.current = false;
    };

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [editor, updateSelection, clearSelection]);

  // Escape / 빈 공간 클릭으로 선택 해제
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedStarts.length > 0) {
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedStarts, clearSelection]);

  // 선택된 블럭 삭제
  useEffect(() => {
    if (!editor || selectedStarts.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (document.activeElement?.closest(".ProseMirror")) return;
      e.preventDefault();
      const tr = editor.state.tr;
      // 높은 위치부터 삭제
      const sorted = [...selectedStarts].sort((a, b) => b - a);
      for (const pos of sorted) {
        const node = editor.state.doc.nodeAt(pos);
        if (!node) continue;
        const mappedPos = tr.mapping.map(pos);
        tr.delete(mappedPos, mappedPos + node.nodeSize);
      }
      editor.view.dispatch(tr);
      clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, selectedStarts, clearSelection]);

  return { dragRect, selectedStarts, clearSelection };
}
```

- [ ] **Step 3: Editor.tsx에 훅 연결**

`Editor.tsx` import에 추가:
```typescript
import { useBoxSelect } from "../../hooks/useBoxSelect";
```

`Editor` 컴포넌트 내에 추가:
```typescript
const { dragRect } = useBoxSelect(editor);
```

JSX 반환부 최상위 `<div>` 안에 rubber-band 오버레이 추가 (`columnDropIndicator` 아래):
```tsx
{dragRect && dragRect.w > 8 && dragRect.h > 8 && (
  <div
    className="qn-box-select-rect"
    style={{
      left: dragRect.x,
      top: dragRect.y,
      width: dragRect.w,
      height: dragRect.h,
    }}
  />
)}
```

- [ ] **Step 4: 빌드 체크**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 5: 커밋**

```bash
git add src/hooks/useBoxSelect.ts src/components/editor/Editor.tsx src/index.css
git commit -m "feat: 박스 드래그 다중 블럭 선택 기능 (#Task4)"
```

---

## Plan Task 11: 블럭 핸들 클릭 메뉴

**스펙 항목:** Task 11

**Files:**
- Modify: `src/components/editor/BlockHandles.tsx`

---

- [ ] **Step 1: BlockHandles.tsx 핸들 클릭 메뉴 구현**

`BlockHandles.tsx` 전체를 새 버전으로 교체. 핵심 변경:
1. `mousedown` 타이머 (200ms): 이내 mouseup → 메뉴 팝업, 초과 + drag → 기존 드래그
2. 메뉴 항목: 타입 변경, 복제, 삭제, 콜아웃 프리셋(조건부)
3. 콜아웃 프리셋 `💡` 버튼 제거

전체 파일 교체:

```tsx
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import {
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  List,
  CheckSquare,
  Code2,
  Quote,
  ChevronRight,
  Lightbulb,
  Pilcrow,
  Copy,
  Trash2,
  LayoutTemplate,
} from "lucide-react";
import {
  CALLOUT_PRESETS,
  type CalloutPresetId,
} from "../../lib/tiptapExtensions/calloutPresets";
import { startBlockNativeDrag } from "../../lib/startBlockNativeDrag";

type HoverInfo = {
  rect: DOMRect;
  blockStart: number;
  depth: number;
  node: PMNode;
};

type Props = {
  editor: Editor | null;
};

const SKIP_HANDLE_TYPES = new Set(["columnLayout", "column"]);
const HANDLE_STRIP_PX = 32;
const MIN_HANDLE_LEFT = 6;
const GUTTER_LEFT_PX = 56;
const RECT_PAD_X = 20;
const RECT_PAD_Y = 18;

function hoverFromResolvedPos(editor: Editor, $pos: ResolvedPos): HoverInfo | null {
  let best: HoverInfo | null = null;
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (!n.isBlock || n.type.name === "doc") continue;
    if (SKIP_HANDLE_TYPES.has(n.type.name)) continue;
    const start = $pos.before(d);
    const dom = editor.view.nodeDOM(start);
    const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
    if (!el) continue;
    const candidate: HoverInfo = {
      rect: el.getBoundingClientRect(),
      blockStart: start,
      depth: d,
      node: n,
    };
    if (!best || candidate.depth > best.depth) best = candidate;
  }
  return best;
}

function blockAtPoint(editor: Editor, clientX: number, clientY: number): HoverInfo | null {
  const view = editor.view;
  const byStart = new Map<number, HoverInfo>();

  const considerPosition = (pos: number) => {
    let $pos: ResolvedPos;
    try {
      const max = editor.state.doc.content.size;
      $pos = editor.state.doc.resolve(Math.min(Math.max(0, pos), max));
    } catch { return; }
    const h = hoverFromResolvedPos(editor, $pos);
    if (!h) return;
    const prev = byStart.get(h.blockStart);
    if (!prev || h.depth > prev.depth) byStart.set(h.blockStart, h);
  };

  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (coords) considerPosition(coords.pos);

  let stack: Element[] = [];
  try { stack = document.elementsFromPoint(clientX, clientY) as Element[]; } catch {}

  for (const raw of stack) {
    if (!(raw instanceof HTMLElement)) continue;
    if (!view.dom.contains(raw)) continue;
    let el: HTMLElement | null = raw;
    let steps = 0;
    while (el && el !== view.dom && steps++ < 24) {
      try { const p = view.posAtDOM(el, 0); considerPosition(p); break; } catch {}
      el = el.parentElement;
    }
  }

  if (byStart.size === 0) return null;
  let best: HoverInfo | null = null;
  for (const h of byStart.values()) {
    if (!best || h.depth > best.depth) best = h;
  }
  return best;
}

const TYPE_MENU_ITEMS = [
  { label: "본문", icon: Pilcrow, cmd: (e: Editor) => e.chain().focus().setParagraph().run() },
  { label: "제목 1", icon: Heading1, cmd: (e: Editor) => e.chain().focus().setHeading({ level: 1 }).run() },
  { label: "제목 2", icon: Heading2, cmd: (e: Editor) => e.chain().focus().setHeading({ level: 2 }).run() },
  { label: "제목 3", icon: Heading3, cmd: (e: Editor) => e.chain().focus().setHeading({ level: 3 }).run() },
  { label: "글머리 목록", icon: List, cmd: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { label: "할 일", icon: CheckSquare, cmd: (e: Editor) => e.chain().focus().toggleTaskList().run() },
  { label: "인용", icon: Quote, cmd: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { label: "코드 블록", icon: Code2, cmd: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
  { label: "토글", icon: ChevronRight, cmd: (e: Editor) => e.chain().focus().setToggle().run() },
  { label: "콜아웃", icon: Lightbulb, cmd: (e: Editor) => e.chain().focus().setCallout("idea").run() },
];

export function BlockHandles({ editor }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const dragCommittedRef = useRef(false);
  const clickTimerRef = useRef<number | null>(null);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);

  const computeHover = useCallback(
    (e: MouseEvent) => {
      if (!editor) return null;
      return blockAtPoint(editor, e.clientX, e.clientY);
    },
    [editor],
  );

  useEffect(() => {
    if (!editor) return;
    const root = containerRef.current?.parentElement;
    if (!root) return;

    const onMove = (e: MouseEvent) => {
      if (menuOpen) return;
      setHover(computeHover(e));
    };
    const onLeave = (e: MouseEvent) => {
      if (menuOpen) return;
      const related = e.relatedTarget as Node | null;
      if (related && root.contains(related)) return;
      setHover(null);
    };

    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, computeHover, menuOpen]);

  // 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) &&
          !containerRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setPresetOpen(false);
        setTypeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  useEffect(() => {
    if (!editor || !hover) return;
    const refreshRect = () => {
      setHover((h) => {
        if (!h || !editor) return h;
        const dom = editor.view.nodeDOM(h.blockStart);
        const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
        if (!el) return null;
        return { ...h, rect: el.getBoundingClientRect() };
      });
    };
    const scroller = containerRef.current?.closest(".overflow-y-auto") ?? window;
    scroller.addEventListener("scroll", refreshRect, { passive: true });
    window.addEventListener("resize", refreshRect, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", refreshRect);
      window.removeEventListener("resize", refreshRect);
    };
  }, [editor, hover?.blockStart]);

  const wrapper = containerRef.current?.parentElement;
  const wrapperRect = wrapper?.getBoundingClientRect();

  const bar =
    hover && wrapperRect
      ? (() => {
          const top = hover.rect.top - wrapperRect.top + 2;
          const rawLeft = hover.rect.left - wrapperRect.left - HANDLE_STRIP_PX;
          const left = Math.max(MIN_HANDLE_LEFT, rawLeft);
          return { top, left };
        })()
      : null;

  const onGripPointerDown = (e: React.PointerEvent) => {
    dragCommittedRef.current = false;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
    }, 200);
  };

  const onGripDragStart = (e: React.DragEvent) => {
    if (!editor || !hover) return;
    // 타이머 남아있으면 (200ms 이내) 드래그가 아닌 클릭으로 처리 가능하지만
    // dragstart 가 발생하면 드래그로 확정
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    dragCommittedRef.current = true;
    e.stopPropagation();
    document.body.classList.add("quicknote-block-dragging");
    startBlockNativeDrag(editor, e.nativeEvent, hover.blockStart, hover.node);
  };

  const onGripDragEnd = () => {
    document.body.classList.remove("quicknote-block-dragging");
  };

  const onGripClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragCommittedRef.current) {
      // 순수 클릭: 메뉴 열기
      setMenuOpen((v) => !v);
      setPresetOpen(false);
      setTypeMenuOpen(false);
    }
  };

  const duplicateBlock = () => {
    if (!editor || !hover) return;
    const { blockStart, node } = hover;
    const insertAt = blockStart + node.nodeSize;
    const tr = editor.state.tr.insert(insertAt, node.copy(node.content));
    editor.view.dispatch(tr.scrollIntoView());
    setMenuOpen(false);
  };

  const deleteBlock = () => {
    if (!editor || !hover) return;
    const { blockStart, node } = hover;
    const tr = editor.state.tr.delete(blockStart, blockStart + node.nodeSize);
    editor.view.dispatch(tr);
    setMenuOpen(false);
    setHover(null);
  };

  const applyCalloutPreset = (preset: CalloutPresetId) => {
    if (!editor || !hover) return;
    editor
      .chain()
      .focus()
      .setNodeSelection(hover.blockStart)
      .updateCalloutPreset(preset)
      .run();
    setPresetOpen(false);
    setMenuOpen(false);
  };

  const isCallout = hover?.node.type.name === "callout";

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-10">
      {hover && bar && wrapperRect ? (
        <div
          className="pointer-events-auto absolute z-30 flex items-start"
          style={{ top: bar.top, left: bar.left }}
        >
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              draggable
              onPointerDown={onGripPointerDown}
              onDragStart={onGripDragStart}
              onDragEnd={onGripDragEnd}
              onClick={onGripClick}
              title="클릭: 메뉴 | 드래그: 블록 이동"
              className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-md border border-transparent bg-white/90 text-zinc-500 shadow-sm ring-1 ring-zinc-200/80 hover:bg-zinc-50 hover:text-zinc-800 active:cursor-grabbing dark:bg-zinc-900/90 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <GripVertical size={15} />
            </button>

            {menuOpen && (
              <div className="absolute left-8 top-0 z-50 w-48 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                {/* 타입 변경 */}
                <div className="relative">
                  <button
                    type="button"
                    onMouseEnter={() => setTypeMenuOpen(true)}
                    onMouseLeave={() => setTypeMenuOpen(false)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <span className="flex items-center gap-2">
                      <Pilcrow size={14} />
                      타입 변경
                    </span>
                    <span className="text-zinc-400">›</span>
                  </button>
                  {typeMenuOpen && (
                    <div
                      className="absolute left-full top-0 z-50 w-40 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
                      onMouseEnter={() => setTypeMenuOpen(true)}
                      onMouseLeave={() => setTypeMenuOpen(false)}
                    >
                      {TYPE_MENU_ITEMS.map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => {
                            if (hover) {
                              editor.chain().focus().setNodeSelection(hover.blockStart).run();
                            }
                            item.cmd(editor);
                            setMenuOpen(false);
                            setTypeMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <item.icon size={14} />
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 콜아웃 프리셋 (콜아웃 블럭일 때만) */}
                {isCallout && (
                  <div className="relative">
                    <button
                      type="button"
                      onMouseEnter={() => setPresetOpen(true)}
                      onMouseLeave={() => setPresetOpen(false)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span className="flex items-center gap-2">
                        <LayoutTemplate size={14} />
                        프리셋
                      </span>
                      <span className="text-zinc-400">›</span>
                    </button>
                    {presetOpen && (
                      <div
                        className="absolute left-full top-0 z-50 max-h-64 w-56 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
                        onMouseEnter={() => setPresetOpen(true)}
                        onMouseLeave={() => setPresetOpen(false)}
                      >
                        {CALLOUT_PRESETS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => applyCalloutPreset(p.id)}
                            className="flex w-full items-start gap-2 px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <span className="w-6 shrink-0 text-center text-base leading-6">
                              {p.emoji || "·"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="font-medium text-zinc-800 dark:text-zinc-100">
                                {p.label}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <hr className="my-1 border-zinc-200 dark:border-zinc-700" />

                {/* 복제 */}
                <button
                  type="button"
                  onClick={duplicateBlock}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Copy size={14} />
                  복제
                </button>

                {/* 삭제 */}
                <button
                  type="button"
                  onClick={deleteBlock}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Trash2 size={14} />
                  삭제
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: 빌드 체크**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 3: 전체 테스트**

```bash
npm test -- --run 2>&1 | tail -20
```

- [ ] **Step 4: 커밋**

```bash
git add src/components/editor/BlockHandles.tsx
git commit -m "feat: 블럭 핸들 클릭 메뉴 구현 - 타입변경/복제/삭제/콜아웃프리셋, 콜아웃 💡버튼 제거 (#Task11)"
```

---

## 완료 후 검증 체크리스트

- [ ] `npm run build` 에러 없음
- [ ] `npm test -- --run` 모든 테스트 통과
- [ ] 브라우저에서 `npm run dev` 후 아래 항목 수동 확인:
  - [ ] Task 1: 슬래시 메뉴에 "토글 목록" 없음, "이모지" 있음
  - [ ] Task 2: 토글 블럭 클릭으로 접기/펼치기, 세로 라인 없음
  - [ ] Task 3: `:체크:` 입력 후 ✅ 로 변환
  - [ ] Task 4: 이미지 선택 시 크롭+아웃라인 버튼 2개 표시
  - [ ] Task 5: 페이지 우측 상단 `⋯` 메뉴에 4개 항목
  - [ ] Task 6: Cmd+D로 사이드바 페이지 복제
  - [ ] Task 7: 에디터 내 Cmd+D로 현재 블럭 복제
  - [ ] Task 8: 블럭 드래그 시 좌우 30% 영역에 파란 점선 표시
  - [ ] Task 9: 에디터 빈 공간 드래그로 rubber-band 선택
  - [ ] Task 10: 핸들 클릭 시 메뉴, 드래그 시 이동
