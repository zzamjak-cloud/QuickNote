import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { insertImageFromFile, MAX_EDITOR_IMAGE_BYTES } from "../../lib/editor/insertImageFromFile";
import { encodeLucidePageIcon } from "../../lib/pageIcon";
import { PageIconDisplay } from "./PageIconDisplay";

const LazyIconPickerEmoji = lazy(() =>
  import("./IconPickerEmoji").then((m) => ({ default: m.IconPickerEmoji })),
);

const MAX_ICON_BYTES = Math.min(5 * 1024 * 1024, MAX_EDITOR_IMAGE_BYTES);
const DEFAULT_LUCIDE_COLOR = "#3f3f46";
type LucidePreset = {
  name: string;
  label: string;
  keywords?: string;
};

type LucideCategory = {
  id: string;
  label: string;
  items: LucidePreset[];
};

const LUCIDE_ICON_CATEGORIES: LucideCategory[] = [
  {
    id: "work",
    label: "업무",
    items: [
      { name: "Briefcase", label: "업무", keywords: "work business" },
      { name: "Building2", label: "회사", keywords: "company office" },
      { name: "Handshake", label: "협업", keywords: "partner collaboration" },
      { name: "Users", label: "팀", keywords: "team members" },
      { name: "UserRound", label: "사용자", keywords: "person profile" },
      { name: "Presentation", label: "발표", keywords: "deck meeting" },
      { name: "ClipboardList", label: "체크리스트", keywords: "checklist" },
      { name: "FileChartColumn", label: "보고서", keywords: "report chart" },
      { name: "ChartNoAxesColumn", label: "지표", keywords: "metrics chart" },
      { name: "ReceiptText", label: "영수증", keywords: "receipt invoice" },
      { name: "Landmark", label: "기관", keywords: "bank org" },
      { name: "BadgeDollarSign", label: "매출", keywords: "sales money" },
      { name: "Megaphone", label: "공지", keywords: "announce marketing" },
      { name: "Mail", label: "메일", keywords: "email" },
      { name: "Phone", label: "전화", keywords: "call" },
      { name: "Video", label: "화상", keywords: "video meeting" },
      { name: "MessagesSquare", label: "대화", keywords: "chat messages" },
      { name: "ContactRound", label: "연락처", keywords: "contact" },
      { name: "Network", label: "조직도", keywords: "org network" },
      { name: "Workflow", label: "워크플로우", keywords: "workflow process" },
      { name: "FileSpreadsheet", label: "스프레드시트", keywords: "sheet excel" },
      { name: "ChartPie", label: "차트", keywords: "pie chart" },
      { name: "ChartSpline", label: "추세", keywords: "trend graph" },
      { name: "Scale", label: "검토", keywords: "legal review balance" },
    ],
  },
  {
    id: "planning",
    label: "계획",
    items: [
      { name: "CalendarDays", label: "일정", keywords: "calendar schedule" },
      { name: "CalendarClock", label: "마감", keywords: "deadline time" },
      { name: "Clock3", label: "시간", keywords: "time" },
      { name: "AlarmClock", label: "알림", keywords: "alarm reminder" },
      { name: "Timer", label: "타이머", keywords: "timer" },
      { name: "Target", label: "목표", keywords: "goal objective" },
      { name: "Milestone", label: "마일스톤", keywords: "milestone" },
      { name: "Route", label: "경로", keywords: "roadmap route" },
      { name: "Map", label: "지도", keywords: "map plan" },
      { name: "Flag", label: "플래그", keywords: "flag priority" },
      { name: "ListTodo", label: "할 일", keywords: "todo task" },
      { name: "CheckSquare", label: "체크", keywords: "done check" },
      { name: "CircleDashed", label: "진행중", keywords: "progress" },
      { name: "CircleCheck", label: "완료", keywords: "complete done" },
      { name: "CircleAlert", label: "주의", keywords: "warning alert" },
      { name: "CircleX", label: "취소", keywords: "cancel fail" },
      { name: "Kanban", label: "칸반", keywords: "kanban board" },
      { name: "Columns3", label: "컬럼", keywords: "columns layout" },
      { name: "Table2", label: "테이블", keywords: "table grid" },
      { name: "GanttChartSquare", label: "간트", keywords: "gantt timeline" },
      { name: "Hourglass", label: "대기", keywords: "pending waiting" },
      { name: "Repeat2", label: "반복", keywords: "repeat recurring" },
      { name: "RefreshCw", label: "갱신", keywords: "refresh update" },
      { name: "MoveRight", label: "다음", keywords: "next move" },
    ],
  },
  {
    id: "knowledge",
    label: "문서",
    items: [
      { name: "FileText", label: "문서", keywords: "doc page note" },
      { name: "Files", label: "문서들", keywords: "files docs" },
      { name: "Folder", label: "폴더", keywords: "folder" },
      { name: "FolderOpen", label: "열린 폴더", keywords: "open folder" },
      { name: "Archive", label: "보관", keywords: "archive" },
      { name: "BookOpen", label: "자료", keywords: "book wiki" },
      { name: "Library", label: "라이브러리", keywords: "library" },
      { name: "Bookmark", label: "북마크", keywords: "bookmark" },
      { name: "Newspaper", label: "뉴스", keywords: "news article" },
      { name: "NotebookText", label: "노트", keywords: "notebook memo" },
      { name: "StickyNote", label: "메모", keywords: "sticky note" },
      { name: "PenLine", label: "작성", keywords: "write edit" },
      { name: "Pencil", label: "편집", keywords: "edit pencil" },
      { name: "Highlighter", label: "강조", keywords: "highlight" },
      { name: "Quote", label: "인용", keywords: "quote" },
      { name: "Link", label: "링크", keywords: "url link" },
      { name: "FilePlus2", label: "새 문서", keywords: "new file" },
      { name: "FilePenLine", label: "문서 편집", keywords: "file edit" },
      { name: "FileSearch", label: "문서 검색", keywords: "file search" },
      { name: "FileCheck2", label: "승인 문서", keywords: "file approved" },
      { name: "BookMarked", label: "책갈피", keywords: "marked book" },
      { name: "BookText", label: "텍스트북", keywords: "book text" },
      { name: "ScrollText", label: "스크롤", keywords: "scroll text" },
      { name: "Tags", label: "태그", keywords: "tags labels" },
    ],
  },
  {
    id: "creative",
    label: "창작",
    items: [
      { name: "Lightbulb", label: "아이디어", keywords: "idea" },
      { name: "Sparkles", label: "중요", keywords: "spark magic" },
      { name: "Palette", label: "디자인", keywords: "design color" },
      { name: "Brush", label: "브러시", keywords: "paint" },
      { name: "Image", label: "이미지", keywords: "image picture" },
      { name: "Camera", label: "카메라", keywords: "photo" },
      { name: "Clapperboard", label: "영상", keywords: "movie video" },
      { name: "Music", label: "음악", keywords: "music audio" },
      { name: "Mic", label: "녹음", keywords: "microphone audio" },
      { name: "WandSparkles", label: "마법", keywords: "magic ai" },
      { name: "Shapes", label: "도형", keywords: "shape" },
      { name: "Layers", label: "레이어", keywords: "layers" },
      { name: "Component", label: "컴포넌트", keywords: "component" },
      { name: "Frame", label: "프레임", keywords: "frame" },
      { name: "DraftingCompass", label: "설계", keywords: "draft" },
      { name: "Scissors", label: "편집", keywords: "cut edit" },
      { name: "Paintbrush", label: "페인트", keywords: "paint brush" },
      { name: "PaintBucket", label: "채우기", keywords: "fill color" },
      { name: "Pipette", label: "스포이드", keywords: "eyedropper color" },
      { name: "PenTool", label: "펜툴", keywords: "pen vector" },
      { name: "Spline", label: "스플라인", keywords: "curve vector" },
      { name: "Origami", label: "접기", keywords: "origami creative" },
      { name: "BadgePlus", label: "추가", keywords: "add badge" },
      { name: "Sparkle", label: "반짝임", keywords: "sparkle" },
    ],
  },
  {
    id: "tech",
    label: "기술",
    items: [
      { name: "Code2", label: "코드", keywords: "code dev" },
      { name: "Terminal", label: "터미널", keywords: "terminal cli" },
      { name: "Braces", label: "JSON", keywords: "json braces" },
      { name: "Bug", label: "버그", keywords: "bug issue" },
      { name: "GitBranch", label: "브랜치", keywords: "git branch" },
      { name: "GitPullRequest", label: "PR", keywords: "pull request" },
      { name: "Database", label: "데이터베이스", keywords: "database db" },
      { name: "Server", label: "서버", keywords: "server" },
      { name: "Cloud", label: "클라우드", keywords: "cloud" },
      { name: "Cpu", label: "CPU", keywords: "cpu chip" },
      { name: "HardDrive", label: "저장소", keywords: "drive storage" },
      { name: "Wifi", label: "네트워크", keywords: "wifi network" },
      { name: "ShieldCheck", label: "보안", keywords: "security" },
      { name: "KeyRound", label: "키", keywords: "key auth" },
      { name: "Bot", label: "AI", keywords: "bot ai" },
      { name: "Brain", label: "지능", keywords: "brain ai" },
      { name: "Boxes", label: "패키지", keywords: "packages modules" },
      { name: "Box", label: "박스", keywords: "box package" },
      { name: "Container", label: "컨테이너", keywords: "container docker" },
      { name: "Monitor", label: "모니터", keywords: "desktop monitor" },
      { name: "Smartphone", label: "모바일", keywords: "mobile phone" },
      { name: "Tablet", label: "태블릿", keywords: "tablet" },
      { name: "Cable", label: "케이블", keywords: "cable connection" },
      { name: "Unplug", label: "분리", keywords: "unplug disconnect" },
    ],
  },
  {
    id: "status",
    label: "상태",
    items: [
      { name: "Star", label: "별", keywords: "star favorite" },
      { name: "Heart", label: "관심", keywords: "heart love" },
      { name: "ThumbsUp", label: "좋음", keywords: "like" },
      { name: "Flame", label: "핫", keywords: "hot fire" },
      { name: "Zap", label: "빠름", keywords: "fast energy" },
      { name: "Rocket", label: "런칭", keywords: "rocket launch" },
      { name: "Trophy", label: "성과", keywords: "trophy win" },
      { name: "Award", label: "수상", keywords: "award" },
      { name: "Medal", label: "메달", keywords: "medal" },
      { name: "Gem", label: "가치", keywords: "gem value" },
      { name: "Bell", label: "알림", keywords: "notification" },
      { name: "Eye", label: "보기", keywords: "view eye" },
      { name: "Lock", label: "잠금", keywords: "lock private" },
      { name: "Unlock", label: "공개", keywords: "unlock" },
      { name: "Circle", label: "기본", keywords: "default dot" },
      { name: "Square", label: "사각", keywords: "square" },
      { name: "Triangle", label: "삼각", keywords: "triangle" },
      { name: "Diamond", label: "다이아", keywords: "diamond" },
      { name: "BadgeCheck", label: "인증", keywords: "verified badge" },
      { name: "BadgeAlert", label: "경고", keywords: "badge alert" },
      { name: "BadgeX", label: "거절", keywords: "badge reject" },
      { name: "BadgeInfo", label: "정보", keywords: "badge info" },
      { name: "ShieldAlert", label: "보안 경고", keywords: "shield alert" },
      { name: "ShieldX", label: "차단", keywords: "shield blocked" },
    ],
  },
];
const LUCIDE_COLOR_PRESETS = [
  "#3f3f46",
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#ca8a04",
  "#9333ea",
  "#0891b2",
  "#db2777",
];

const ALL_LUCIDE_PRESETS = Array.from(
  new Map(
    LUCIDE_ICON_CATEGORIES.flatMap((c) => c.items).map(
      (item) => [item.name, item],
    ),
  ).values(),
);

function getLucideIcon(name: string): LucideIcon {
  return (
    (LucideIcons as unknown as Record<string, LucideIcon | undefined>)[name] ??
    LucideIcons.Circle
  );
}

function matchesLucideSearch(item: LucidePreset, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${item.name} ${item.label} ${item.keywords ?? ""}`
    .toLowerCase()
    .includes(q);
}

type Props = {
  current: string | null;
  onChange: (icon: string | null) => void;
  // 인라인 컴팩트 모드: 사이드바·트리에서 작은 아이콘 버튼만 노출
  size?: "lg" | "sm";
  /** 이미지 업로드 실패·용량 초과 시 알림 */
  onUploadMessage?: (message: string) => void;
};

type IconPickerPanelProps = {
  title?: string;
  footer?: ReactNode;
  onPickEmoji: (emoji: string) => void;
  onPickLucide: (name: string, color: string) => void;
};

export function IconPickerPanel({
  title = "페이지 아이콘",
  footer,
  onPickEmoji,
  onPickLucide,
}: IconPickerPanelProps) {
  const [color, setColor] = useState(DEFAULT_LUCIDE_COLOR);
  const [activeMenu, setActiveMenu] = useState<"lucide" | "emoji">("lucide");
  const [activeLucideCategory, setActiveLucideCategory] = useState("all");
  const [lucideQuery, setLucideQuery] = useState("");

  const activeCategory =
    LUCIDE_ICON_CATEGORIES.find((category) => category.id === activeLucideCategory) ??
    LUCIDE_ICON_CATEGORIES[0];
  const visibleLucideIcons = useMemo(() => {
    if (lucideQuery.trim()) {
      return ALL_LUCIDE_PRESETS.filter((item) => matchesLucideSearch(item, lucideQuery));
    }
    if (activeLucideCategory === "all") return ALL_LUCIDE_PRESETS;
    return activeCategory?.items ?? [];
  }, [activeCategory, activeLucideCategory, lucideQuery]);

  const pickLucideIcon = (name: string) => onPickLucide(name, color);

  return (
    <div className="w-[320px] rounded-md border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 p-2 dark:border-zinc-700">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
            {title}
          </span>
          <div className="flex rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800">
            {(["lucide", "emoji"] as const).map((menu) => (
              <button
                key={menu}
                type="button"
                onClick={() => setActiveMenu(menu)}
                className={[
                  "rounded px-2 py-1 text-xs",
                  activeMenu === menu
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
                ].join(" ")}
              >
                {menu === "lucide" ? "루시드" : "이모지"}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[360px] overflow-hidden">
          {activeMenu === "lucide" ? (
            <div className="flex h-full flex-col">
            <div className="mb-2 flex flex-wrap gap-1">
              {LUCIDE_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setColor(preset)}
                  className={[
                    "h-5 w-5 rounded-full border",
                    color === preset
                      ? "border-zinc-900 ring-2 ring-zinc-300 dark:border-white dark:ring-zinc-600"
                      : "border-zinc-200 dark:border-zinc-700",
                  ].join(" ")}
                  style={{ backgroundColor: preset }}
                  aria-label={`아이콘 색상 ${preset}`}
                  title={preset}
                />
              ))}
            </div>
            <div className="mb-2 flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-950">
              <LucideIcons.Search size={14} className="shrink-0 text-zinc-400" />
              <input
                value={lucideQuery}
                onChange={(event) => setLucideQuery(event.target.value)}
                placeholder="아이콘 검색"
                className="h-8 min-w-0 flex-1 bg-transparent text-xs text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
              {lucideQuery ? (
                <button
                  type="button"
                  onClick={() => setLucideQuery("")}
                  className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  aria-label="검색어 지우기"
                >
                  <LucideIcons.X size={13} />
                </button>
              ) : null}
            </div>
            {!lucideQuery.trim() ? (
              <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
                {[{ id: "all", label: "전체" }, ...LUCIDE_ICON_CATEGORIES].map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setActiveLucideCategory(category.id)}
                    className={[
                      "shrink-0 rounded px-2 py-1 text-xs",
                      activeLucideCategory === category.id
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
                    ].join(" ")}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="grid grid-cols-8 gap-1">
                {visibleLucideIcons.map((item) => {
                  const Icon = getLucideIcon(item.name);
                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => pickLucideIcon(item.name)}
                      className="flex h-8 w-8 items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      title={item.label}
                      aria-label={item.label}
                    >
                      <Icon size={18} color={color} strokeWidth={1.9} />
                    </button>
                  );
                })}
                {visibleLucideIcons.length === 0 ? (
                  <div className="col-span-8 py-6 text-center text-xs text-zinc-400">
                    검색 결과가 없습니다.
                  </div>
                ) : null}
              </div>
            </div>
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="h-[360px] w-[304px] animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
              }
            >
              <LazyIconPickerEmoji onPick={onPickEmoji} />
            </Suspense>
          )}
        </div>
      </div>
      {footer ? (
        <div className="flex flex-col gap-0.5 border-t border-zinc-200 p-1.5 dark:border-zinc-700">
          {activeMenu !== "lucide" ? (
            <button
              type="button"
              onClick={() => setActiveMenu("lucide")}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <LucideIcons.FileText size={14} className="shrink-0 text-zinc-500" />
              루시드 아이콘 보기
            </button>
          ) : null}
          {footer}
        </div>
      ) : null}
    </div>
  );
}

// 카테고리 탭 + 검색이 내장된 emoji-picker-react 기반 아이콘 picker.
export function IconPicker({
  current,
  onChange,
  size = "lg",
  onUploadMessage,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const trigger =
    size === "lg" ? (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md text-3xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label="페이지 아이콘"
      >
        {current ? (
          <PageIconDisplay icon={current} size="lg" />
        ) : (
          <LucideIcons.Plus size={18} className="text-zinc-400" />
        )}
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded text-base hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label="페이지 아이콘"
      >
        {current ? (
          <PageIconDisplay icon={current} size="sm" />
        ) : (
          <PageIconDisplay icon={null} size="sm" />
        )}
      </button>
    );

  const onPickImageFile = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    const ok = await insertImageFromFile(
      file,
      (attrs) => {
        onChange(attrs.src);
        setOpen(false);
      },
      {
        maxBytes: MAX_ICON_BYTES,
        onSizeExceeded: (mb) => {
          onUploadMessage?.(`아이콘 이미지는 ${(MAX_ICON_BYTES / 1024 / 1024).toFixed(0)}MB 이하만 가능합니다 (현재 ${mb.toFixed(1)}MB).`);
        },
      },
    );
    if (!ok && file.size <= MAX_ICON_BYTES) {
      onUploadMessage?.("이미지 업로드에 실패했습니다.");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="relative" ref={ref}>
      {trigger}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onPickImageFile(e.target.files?.[0])}
      />
      {open && (
        <div className="absolute left-0 top-14 z-50">
          <IconPickerPanel
            onPickLucide={(name, nextColor) => {
              onChange(encodeLucidePageIcon(name, nextColor));
              setOpen(false);
            }}
            onPickEmoji={(emoji) => {
              onChange(emoji);
              setOpen(false);
            }}
            footer={
              <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <LucideIcons.ImagePlus size={14} className="shrink-0 text-zinc-500" />
              이미지 업로드
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
            >
              아이콘 제거
            </button>
              </>
            }
          />
        </div>
      )}
    </div>
  );
}
