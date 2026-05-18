import { useEffect, useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { matchesMemberSearchQuery, sortByKoreanName, type MemberSearchTarget } from "../lib/memberSearch";

type MemberSuggestionItem = MemberSearchTarget & {
  memberId: string;
  status?: string;
};

type UseMemberSuggestionDropdownArgs<T extends MemberSuggestionItem> = {
  members: T[];
  query: string;
  excludedMemberIds: string[];
  dropdownWrapRef: RefObject<HTMLElement | null>;
  activeOnly?: boolean;
};

type UseMemberSuggestionDropdownResult<T extends MemberSuggestionItem> = {
  suggestionMembers: T[];
  isSuggestionOpen: boolean;
  highlightedIndex: number;
  setSuppressSuggestions: (next: boolean) => void;
  handleQueryChange: (value: string, onChange: (next: string) => void) => void;
  handleKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
    onSelectMemberId: (memberId: string) => void,
  ) => void;
  selectMember: (memberId: string, onSelectMemberId: (memberId: string) => void) => void;
};

export function useMemberSuggestionDropdown<T extends MemberSuggestionItem>({
  members,
  query,
  excludedMemberIds,
  dropdownWrapRef,
  activeOnly = true,
}: UseMemberSuggestionDropdownArgs<T>): UseMemberSuggestionDropdownResult<T> {
  const [suppressSuggestions, setSuppressSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const suggestionMembers = useMemo(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];
    const excludedIdSet = new Set(excludedMemberIds);
    return sortByKoreanName(
      members
        .filter((member) => !excludedIdSet.has(member.memberId))
        .filter((member) => (activeOnly
          ? String(member.status ?? "active").toLowerCase() === "active"
          : true))
        .filter((member) => matchesMemberSearchQuery(member, trimmedQuery)),
    );
  }, [activeOnly, excludedMemberIds, members, query]);

  const isSuggestionOpen =
    !suppressSuggestions &&
    query.trim().length > 0 &&
    suggestionMembers.length > 0;

  useEffect(() => {
    if (!isSuggestionOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownWrapRef.current?.contains(target)) return;
      setSuppressSuggestions(true);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownWrapRef, isSuggestionOpen]);

  useEffect(() => {
    if (!isSuggestionOpen) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex((prev) => {
      if (prev < 0) return -1;
      if (prev >= suggestionMembers.length) return suggestionMembers.length - 1;
      return prev;
    });
  }, [isSuggestionOpen, suggestionMembers.length]);

  const selectMember = (memberId: string, onSelectMemberId: (id: string) => void) => {
    onSelectMemberId(memberId);
    setSuppressSuggestions(true);
    setHighlightedIndex(-1);
  };

  const handleQueryChange = (value: string, onChange: (next: string) => void) => {
    onChange(value);
    setSuppressSuggestions(false);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    onSelectMemberId: (memberId: string) => void,
  ) => {
    if (!isSuggestionOpen) return;
    const suggestionCount = suggestionMembers.length;
    if (suggestionCount <= 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((prev) => {
        if (prev < 0) return 0;
        return (prev + 1) % suggestionCount;
      });
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((prev) => {
        if (prev < 0) return suggestionCount - 1;
        return prev <= 0 ? suggestionCount - 1 : prev - 1;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const targetIndex = highlightedIndex < 0 ? 0 : highlightedIndex;
      const targetMember = suggestionMembers[targetIndex];
      if (!targetMember) return;
      selectMember(targetMember.memberId, onSelectMemberId);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSuppressSuggestions(true);
    }
  };

  return {
    suggestionMembers,
    isSuggestionOpen,
    highlightedIndex,
    setSuppressSuggestions,
    handleQueryChange,
    handleKeyDown,
    selectMember,
  };
}
