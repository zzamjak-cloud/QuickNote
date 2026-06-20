import {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { findEmojiShortcode } from "../../../lib/tiptapExtensions/emojiShortcode";

// 무거운 아이콘 패널은 /이모지 메뉴를 통해 열릴 때만 지연 로드.
const IconPickerPanel = lazy(() =>
  import("../../common/IconPickerPanel").then((m) => ({
    default: m.IconPickerPanel,
  })),
);

// "/이모지" 슬래시 커맨드 — 라인 시작 또는 공백 뒤의 `/키워드` 만 인식.
const SLASH_PATTERN = /(^|\s)\/([^\s/]*)$/;
const SLASH_KEYWORDS = ["이모지", "emoji", "아이콘", "icon"];

function slashMatches(query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return SLASH_KEYWORDS.some((k) => k.toLowerCase().startsWith(q));
}

type Coords = { top: number; left: number };

/**
 * 데이터베이스 텍스트 셀.
 * - `:체크 ` 등 이모지 단축어를 Space 입력 시 치환(에디터 본문과 동일 매핑).
 * - `/이모지` 슬래시 → 이모지 전용 피커를 열어 caret 위치에 이모지 삽입.
 * 저장 형식은 plain string 그대로(이모지는 유니코드 문자).
 */
export function TextCell({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // 값 변경 후 적용할 caret 위치 — controlled input 이라 재렌더 후 복원.
  const pendingCaretRef = useRef<number | null>(null);
  // 이모지 삽입 시 항상 최신 값을 참조하기 위한 ref.
  const valueRef = useRef(value);
  valueRef.current = value;

  const [slashMenu, setSlashMenu] = useState<{
    start: number;
    end: number;
    coords: Coords;
  } | null>(null);
  const [pickerCoords, setPickerCoords] = useState<Coords | null>(null);
  // 피커가 이모지를 삽입할 위치.
  const insertAtRef = useRef(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (pendingCaretRef.current == null) return;
    const el = inputRef.current;
    const pos = pendingCaretRef.current;
    pendingCaretRef.current = null;
    if (el) {
      el.focus();
      el.setSelectionRange(pos, pos);
    }
  }, [value]);

  // 메뉴·피커가 열려 있을 때 바깥 클릭으로 닫기.
  useEffect(() => {
    if (!slashMenu && !pickerCoords) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (inputRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      if (pickerRef.current?.contains(t)) return;
      setSlashMenu(null);
      setPickerCoords(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [slashMenu, pickerCoords]);

  const cellCoords = (): Coords => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return { top: 0, left: 0 };
    return { top: rect.bottom + 4, left: Math.max(8, rect.left) };
  };

  const refreshSlashMenu = (nextValue: string, caret: number) => {
    const before = nextValue.slice(0, caret);
    const match = before.match(SLASH_PATTERN);
    if (!match || !slashMatches(match[2] ?? "")) {
      setSlashMenu(null);
      return;
    }
    const start = caret - (match[2]?.length ?? 0) - 1; // `/` 위치
    setSlashMenu({ start, end: caret, coords: cellCoords() });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    onChange(next);
    refreshSlashMenu(next, e.target.selectionStart ?? next.length);
  };

  const replaceShortcode = (): boolean => {
    const el = inputRef.current;
    if (!el) return false;
    const caret = el.selectionStart ?? value.length;
    if (caret !== (el.selectionEnd ?? caret)) return false;
    const hit = findEmojiShortcode(value.slice(0, caret));
    if (!hit) return false;
    const from = caret - hit.shortcodeLength;
    const next = value.slice(0, from) + hit.emoji + " " + value.slice(caret);
    pendingCaretRef.current = from + hit.emoji.length + 1;
    onChange(next);
    return true;
  };

  const runEmojiCommand = () => {
    if (!slashMenu) return;
    const base = value.slice(0, slashMenu.start) + value.slice(slashMenu.end);
    insertAtRef.current = slashMenu.start;
    onChange(base);
    setPickerCoords(slashMenu.coords);
    setSlashMenu(null);
  };

  const insertEmoji = (emoji: string) => {
    const at = insertAtRef.current;
    const base = valueRef.current;
    const next = base.slice(0, at) + emoji + base.slice(at);
    pendingCaretRef.current = at + emoji.length;
    onChange(next);
    setPickerCoords(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (slashMenu) {
      if (e.key === "Enter") {
        e.preventDefault();
        runEmojiCommand();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashMenu(null);
        return;
      }
    }
    if (
      e.key === " " &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      replaceShortcode()
    ) {
      e.preventDefault();
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setSlashMenu(null)}
        className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none focus:border-zinc-300 dark:focus:border-zinc-600"
      />
      {slashMenu &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: slashMenu.coords.top, left: slashMenu.coords.left }}
            className="z-[760] w-40 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <button
              type="button"
              // 입력 blur 로 메뉴가 닫히기 전에 실행되도록 mousedown 사용.
              onMouseDown={(e) => {
                e.preventDefault();
                runEmojiCommand();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <span className="text-base leading-none">😀</span>
              <span>이모지</span>
            </button>
          </div>,
          document.body,
        )}
      {pickerCoords &&
        createPortal(
          <div
            ref={pickerRef}
            style={{ position: "fixed", top: pickerCoords.top, left: pickerCoords.left, zIndex: 9999 }}
          >
            <Suspense fallback={null}>
              <IconPickerPanel
                emojiOnly
                onPickEmoji={insertEmoji}
                onPickLucide={() => {}}
              />
            </Suspense>
          </div>,
          document.body,
        )}
    </>
  );
}
