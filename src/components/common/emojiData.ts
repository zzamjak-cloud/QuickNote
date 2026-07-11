// 이모지 피커용 카테고리·데이터 소스.
// emoji-picker-react 의 영어/한국어 데이터셋을 합쳐 한·영 동시 검색을 지원하고,
// 코드포인트 범위로 "스마일리 & 감정" 과 "사람 & 신체" 를 분리해 카테고리를 세분화한다.
//
// 데이터는 모듈 로드 시 1회만 파싱해 캐시하므로 패널 마운트마다의 비용은 없다.
// (JSON import 는 IconPickerEmoji 가 기존에 쓰던 것과 동일한 번들이라 추가 비용 없음)

import rawEmojiEn from "emoji-picker-react/dist/data/emojis.json";
import rawEmojiKo from "emoji-picker-react/dist/data/emojis-ko.json";

type RawEmoji = { n: string[]; u: string; a: string };
type RawEmojiFile = { emojis: Record<string, RawEmoji[]> };

export type EmojiItem = { emoji: string; label: string; searchKey: string };

// 원본 데이터셋의 8개 대분류 그룹 id.
const SOURCE_GROUPS = [
  "smileys_people",
  "animals_nature",
  "food_drink",
  "travel_places",
  "activities",
  "objects",
  "symbols",
  "flags",
] as const;

// 피커에 노출할 최종 카테고리. smileys_people 은 코드포인트로 감정/신체 2개로 쪼갠다.
export const EMOJI_CATEGORIES = [
  { id: "smileys", label: "스마일리 & 감정" },
  { id: "people", label: "사람 & 신체" },
  { id: "animals_nature", label: "동물 & 자연" },
  { id: "food_drink", label: "음식 & 음료" },
  { id: "travel_places", label: "여행 & 장소" },
  { id: "activities", label: "활동" },
  { id: "objects", label: "사물" },
  { id: "symbols", label: "기호" },
  { id: "flags", label: "깃발" },
] as const;

export type EmojiCategoryId = (typeof EMOJI_CATEGORIES)[number]["id"];

// "사람 & 신체(People & Body)" 로 분류할 기본 코드포인트 구간(16진수).
// 나머지 smileys_people 원소는 "스마일리 & 감정" 으로 간다.
// 정확한 CLDR 분류가 아니라 대략적 범위이며, 두 카테고리 모두 검색·탐색이 가능하므로
// 소수의 경계 오분류는 정합성 문제가 아니다.
const PEOPLE_BODY_RANGES: Array<[number, number]> = [
  [0x1f440, 0x1f450], // 눈·귀·코·입·혀·손 등 신체
  [0x1f466, 0x1f487], // 사람·역할·이발 등
  [0x1f574, 0x1f575], // 정장 입고 뜬 사람·탐정
  [0x1f57a, 0x1f57a], // 춤추는 남자
  [0x1f590, 0x1f590], // 손가락 편 손
  [0x1f595, 0x1f596], // 가운뎃손가락·벌컨 인사
  [0x1f645, 0x1f64f], // 각종 사람 제스처
  [0x1f6b4, 0x1f6b6], // 자전거·산악자전거·걷기
  [0x1f6c0, 0x1f6c0], // 목욕
  [0x1f6cc, 0x1f6cc], // 침대에 누운 사람
  [0x1f90c, 0x1f90c], // 오므린 손가락
  [0x1f90f, 0x1f90f], // 꼬집는 손
  [0x1f918, 0x1f91f], // 손 기호(뿔·러브유 등)
  [0x1f926, 0x1f926], // 이마 짚기
  [0x1f930, 0x1f939], // 임신·수유·왕자·공주 등
  [0x1f93c, 0x1f93e], // 레슬링·수구·핸드볼
  [0x1f977, 0x1f977], // 닌자
  [0x1f9b5, 0x1f9b7], // 다리·발·이빨
  [0x1f9bb, 0x1f9bb], // 보청기 낀 귀
  [0x1f9cd, 0x1f9cf], // 서있는·무릎꿇은·못 듣는 사람
  [0x1f9d1, 0x1f9df], // 사람·성인·판타지 인물
  [0x261d, 0x261d], // 위를 가리키는 손가락
  [0x270a, 0x270d], // 주먹·손·브이·쓰는 손
  [0x1fac3, 0x1fac5], // 임신한 남자·사람·왕관 쓴 사람
  [0x1faf0, 0x1faf8], // 각종 손 동작
];

function isPeopleBody(unified: string): boolean {
  const base = parseInt(unified.split("-")[0] ?? "", 16);
  if (Number.isNaN(base)) return false;
  return PEOPLE_BODY_RANGES.some(([start, end]) => base >= start && base <= end);
}

function toEmoji(unified: string): string {
  try {
    return String.fromCodePoint(...unified.split("-").map((h) => parseInt(h, 16)));
  } catch {
    return "";
  }
}

// unified → 한국어 이름 배열 맵. 한·영 검색을 위해 라벨은 한국어, 검색어는 한·영 병합.
function buildKoNameMap(): Map<string, string[]> {
  const ko = (rawEmojiKo as RawEmojiFile).emojis;
  const map = new Map<string, string[]>();
  for (const group of SOURCE_GROUPS) {
    for (const e of ko[group] ?? []) map.set(e.u, e.n);
  }
  return map;
}

function buildCategories(): Record<EmojiCategoryId, EmojiItem[]> {
  const en = (rawEmojiEn as RawEmojiFile).emojis;
  const koNames = buildKoNameMap();

  const result = Object.fromEntries(
    EMOJI_CATEGORIES.map((c) => [c.id, [] as EmojiItem[]]),
  ) as Record<EmojiCategoryId, EmojiItem[]>;

  const push = (catId: EmojiCategoryId, e: RawEmoji) => {
    const emoji = toEmoji(e.u);
    if (!emoji) return;
    const ko = koNames.get(e.u) ?? [];
    // 라벨은 한국어 마지막 이름(전체명) 우선, 없으면 영어.
    const label = ko.at(-1) ?? e.n.at(-1) ?? e.u;
    result[catId].push({
      emoji,
      label,
      searchKey: [...ko, ...e.n].join(" ").toLowerCase(),
    });
  };

  for (const group of SOURCE_GROUPS) {
    const items = en[group] ?? [];
    if (group === "smileys_people") {
      for (const e of items) push(isPeopleBody(e.u) ? "people" : "smileys", e);
    } else {
      // 나머지 그룹은 id 가 최종 카테고리와 1:1 대응.
      for (const e of items) push(group as EmojiCategoryId, e);
    }
  }
  return result;
}

export const EMOJI_MAP: Record<EmojiCategoryId, EmojiItem[]> = buildCategories();
export const ALL_EMOJIS: EmojiItem[] = EMOJI_CATEGORIES.flatMap((c) => EMOJI_MAP[c.id]);
