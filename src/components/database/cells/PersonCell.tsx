// 사람(person) 셀 — 칩 배열 형태로 멤버를 관리.
// DatabaseCell.tsx 에서 분리 — 동작 변경 없음.
//  - @ 또는 일반 텍스트 입력 시 팝업 열림
//  - 팝업 열림: ArrowUp/Down 팝업 항목 이동, Enter 확정
//  - 팝업 닫힘: ArrowLeft/Right 칩 단위 이동 (chipFocusIdx)
//  - 칩 선택 상태: Backspace/Delete → 해당 칩 삭제
//  - 빈 input에서 Backspace → 마지막 칩 삭제

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CellValue } from "../../../types/database";
import { searchMembersForMentionApi } from "../../../lib/sync/memberApi";
import { normalizePersonValue, personChipColor } from "./utils";
import { useMemberStore } from "../../../store/memberStore";

export function PersonCell({
  value,
  onChange,
}: {
  value: string | string[];
  onChange: (v: CellValue) => void;
}) {
  // string[]으로 정규화 — 콤마 구분 기존 데이터 포함
  const chips = normalizePersonValue(value);
  const members = useMemberStore((s) => s.members);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const [items, setItems] = useState<Array<{ memberId: string; name: string; jobRole: string }>>([]);
  // 팝업 항목 커서
  const [activeIdx, setActiveIdx] = useState(0);
  // 칩 선택 커서: -1 = input 포커스, 0..chips.length-1 = 해당 칩 선택
  const [chipFocusIdx, setChipFocusIdx] = useState(-1);

  // 팝업 위치 갱신
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 220) });
  }, [draft, open]);

  // 멤버 검색
  useEffect(() => {
    let cancelled = false;
    if (!open) return;
    void (async () => {
      const query = draft.startsWith("@") ? draft.slice(1) : draft;
      const found = await searchMembersForMentionApi(query, 8);
      if (!cancelled) {
        setItems(found);
        setActiveIdx(0);
      }
    })();
    return () => { cancelled = true; };
  }, [open, draft]);

  const memberNameById = new Map(members.map((member) => [member.memberId, member.name]));
  const chipLabel = (raw: string) => memberNameById.get(raw) ?? raw;

  const addChip = (memberId: string) => {
    if (!chips.includes(memberId)) {
      onChange([...chips, memberId]);
    }
    setDraft("");
    setOpen(false);
    setChipFocusIdx(-1);
    inputRef.current?.focus();
  };

  const removeChipAt = (idx: number) => {
    const next = chips.filter((_, i) => i !== idx);
    onChange(next);
    // 삭제 후 인접 칩 또는 input으로 포커스 이동
    if (next.length === 0) {
      setChipFocusIdx(-1);
      inputRef.current?.focus();
    } else {
      setChipFocusIdx(Math.min(idx, next.length - 1));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 팝업 열림: Up/Down/Enter는 팝업 항목 이동
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, items.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (items[activeIdx]) addChip(items[activeIdx].memberId);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        setDraft("");
        return;
      }
    }

    // 팝업 닫힘: 칩 이동 로직
    if (!open) {
      if (e.key === "ArrowLeft" && (e.currentTarget.selectionStart ?? 0) === 0 && draft === "") {
        e.preventDefault();
        // 칩이 있으면 마지막 칩으로 이동
        if (chips.length > 0) setChipFocusIdx(chips.length - 1);
        return;
      }
      if (e.key === "ArrowRight" && draft === "") {
        e.preventDefault();
        // chipFocusIdx가 -1이면 이미 input — 무시
        return;
      }
    }

    // Backspace: 텍스트 없을 때 마지막 칩 삭제
    if (e.key === "Backspace" && draft === "" && !open) {
      e.preventDefault();
      if (chips.length > 0) removeChipAt(chips.length - 1);
    }
  };

  // 칩 선택 상태에서 키보드 처리
  const handleChipKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>, idx: number) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setChipFocusIdx(idx > 0 ? idx - 1 : 0);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (idx < chips.length - 1) {
        setChipFocusIdx(idx + 1);
      } else {
        // 마지막 칩 → input으로 복귀
        setChipFocusIdx(-1);
        inputRef.current?.focus();
      }
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      removeChipAt(idx);
    } else if (e.key !== "Tab" && e.key !== "Shift") {
      // 다른 키 → 칩 선택 해제 후 input 포커스
      setChipFocusIdx(-1);
      inputRef.current?.focus();
    }
  };

  return (
    <>
      {/* group: hover/focus-within 시 border 표시 */}
      <div
        ref={wrapperRef}
        className="group flex min-h-[28px] w-full min-w-0 flex-nowrap items-center gap-1 overflow-hidden rounded border border-transparent px-1 py-0.5 hover:border-zinc-300 focus-within:border-zinc-300 dark:hover:border-zinc-600 dark:focus-within:border-zinc-600"
      >
        {/* 칩 목록 — select 옵션 스타일과 동일, 선택 시 ring 하이라이트, X 버튼 hover 시 표시 */}
        {chips.map((name, idx) => (
          <span
            key={`${name}-${idx}`}
            tabIndex={0}
            role="button"
            aria-label={`${chipLabel(name)} 키보드로 이동`}
            onKeyDown={(e) => handleChipKeyDown(e, idx)}
            onFocus={() => setChipFocusIdx(idx)}
            onBlur={() => {
              window.setTimeout(() => {
                if (document.activeElement === inputRef.current) return;
                setChipFocusIdx(-1);
              }, 50);
            }}
            className={[
              "group/chip relative inline-flex cursor-default items-center gap-0.5 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium text-white outline-none",
              chipFocusIdx === idx ? "ring-2 ring-white ring-offset-1" : "",
            ].join(" ")}
            style={{ backgroundColor: personChipColor(name) }}
          >
            {chipLabel(name)}
            {/* 칩 X 버튼 — hover 시 표시 */}
            <button
              type="button"
              tabIndex={-1}
              aria-label={`${chipLabel(name)} 제거`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                removeChipAt(idx);
              }}
              className="ml-0.5 hidden rounded-full p-px leading-none hover:bg-white/30 group-hover/chip:flex"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </span>
        ))}
        {/* @ 입력 필드 — 비어있을 때는 너비 0으로 숨김, hover/focus 시 노출 */}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            setChipFocusIdx(-1);
            setOpen(v.length > 0);
          }}
          onFocus={() => {
            setChipFocusIdx(-1);
            if (draft.length > 0) setOpen(true);
          }}
          onBlur={() => { window.setTimeout(() => setOpen(false), 150); }}
          onKeyDown={handleKeyDown}
          placeholder={chips.length === 0 ? "@ 이름 입력" : ""}
          className={[
            "bg-transparent text-xs outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600",
            // 빈 상태: 평소 w-0 숨김, hover/focus 시 노출
            draft === ""
              ? "w-0 min-w-0 opacity-0 group-hover:w-auto group-hover:min-w-[60px] group-hover:opacity-100 focus:w-auto focus:min-w-[60px] focus:opacity-100"
              : "min-w-[60px] flex-1",
          ].join(" ")}
        />
      </div>
      {open && coords && createPortal(
        <div
          style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="z-[700] max-h-52 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {items.length === 0 ? (
            <div className="px-2 py-1 text-xs text-zinc-500">멤버 검색 결과가 없습니다.</div>
          ) : (
            items.map((m, idx) => (
              <button
                key={m.memberId}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addChip(m.memberId)}
                className={[
                  "flex w-full items-center justify-between rounded px-2 py-1 text-left",
                  idx === activeIdx
                    ? "bg-zinc-100 dark:bg-zinc-800"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                ].join(" ")}
              >
                <span className="truncate">{m.name}</span>
                <span className="ml-2 shrink-0 text-xs text-zinc-500">{m.jobRole}</span>
              </button>
            ))
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
