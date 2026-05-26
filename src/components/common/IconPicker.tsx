import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { insertImageFromFile, MAX_EDITOR_IMAGE_BYTES } from "../../lib/editor/insertImageFromFile";
import { encodeLucidePageIcon } from "../../lib/pageIcon";
import { PageIconDisplay } from "./PageIconDisplay";
import { IconPickerEmoji } from "./IconPickerEmoji";
import { type CustomIconPreset } from "../../lib/iconStorage";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useCustomIconStore } from "../../store/customIconStore";

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
      { name: "Calculator", label: "계산기", keywords: "calculator" },
      { name: "Coins", label: "자산", keywords: "money asset coins" },
      { name: "TrendingUp", label: "상승", keywords: "trend up growth" },
      { name: "TrendingDown", label: "하락", keywords: "trend down decline" },
      { name: "Percent", label: "퍼센트", keywords: "percent ratio" },
      { name: "DollarSign", label: "달러", keywords: "dollar money" },
      { name: "Printer", label: "프린터", keywords: "printer print" },
      { name: "Scan", label: "스캔", keywords: "scan document" },
      { name: "Stamp", label: "도장", keywords: "stamp seal" },
      { name: "PackageSearch", label: "조달", keywords: "procurement supply" },
      { name: "Search", label: "검색", keywords: "search find" },
      { name: "PenSquare", label: "계약", keywords: "contract sign" },
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
      { name: "BellRing", label: "알림중", keywords: "bell ringing" },
      { name: "SortAsc", label: "정렬", keywords: "sort asc order" },
      { name: "Filter", label: "필터", keywords: "filter" },
      { name: "Shuffle", label: "랜덤", keywords: "random shuffle" },
      { name: "Split", label: "분기", keywords: "split branch" },
      { name: "Merge", label: "병합", keywords: "merge combine" },
      { name: "GitFork", label: "포크", keywords: "fork split" },
      { name: "LayoutDashboard", label: "대시보드", keywords: "dashboard overview" },
      { name: "PanelLeft", label: "패널", keywords: "panel sidebar" },
      { name: "Layers3", label: "레이어", keywords: "layers stack" },
      { name: "SquareStack", label: "스택", keywords: "stack cards" },
      { name: "ListChecks", label: "점검 목록", keywords: "checklist items" },
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
      { name: "Paperclip", label: "첨부", keywords: "attach clip" },
      { name: "Upload", label: "업로드", keywords: "upload send" },
      { name: "Download", label: "다운로드", keywords: "download" },
      { name: "Share2", label: "공유", keywords: "share" },
      { name: "Copy", label: "복사", keywords: "copy duplicate" },
      { name: "Clipboard", label: "클립보드", keywords: "clipboard" },
      { name: "FolderArchive", label: "압축 폴더", keywords: "folder zip archive" },
      { name: "FolderLock", label: "잠금 폴더", keywords: "folder locked private" },
      { name: "FileCode2", label: "코드 파일", keywords: "code file" },
      { name: "FileBadge", label: "배지 문서", keywords: "file badge certified" },
      { name: "FileDigit", label: "숫자 문서", keywords: "file number digit" },
      { name: "BookCopy", label: "복제본", keywords: "book copy duplicate" },
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
      { name: "Aperture", label: "조리개", keywords: "aperture lens" },
      { name: "Focus", label: "포커스", keywords: "focus sharp" },
      { name: "Crop", label: "자르기", keywords: "crop trim" },
      { name: "FlipHorizontal", label: "뒤집기", keywords: "flip mirror" },
      { name: "ZoomIn", label: "확대", keywords: "zoom in magnify" },
      { name: "ZoomOut", label: "축소", keywords: "zoom out" },
      { name: "LayoutGrid", label: "레이아웃", keywords: "layout grid" },
      { name: "LayoutTemplate", label: "템플릿", keywords: "template layout" },
      { name: "GalleryThumbnails", label: "갤러리", keywords: "gallery thumbnails" },
      { name: "Sticker", label: "스티커", keywords: "sticker emoji" },
      { name: "Feather", label: "깃털", keywords: "feather write light" },
      { name: "Film", label: "필름", keywords: "film movie strip" },
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
      { name: "Globe", label: "웹", keywords: "web globe internet" },
      { name: "Webhook", label: "웹훅", keywords: "webhook api" },
      { name: "GitCommit", label: "커밋", keywords: "commit git" },
      { name: "GitMerge", label: "병합", keywords: "merge git" },
      { name: "FileJson", label: "JSON 파일", keywords: "json file" },
      { name: "FileCode", label: "코드 파일", keywords: "code file source" },
      { name: "Variable", label: "변수", keywords: "variable programming" },
      { name: "Blocks", label: "블록", keywords: "blocks modules" },
      { name: "CircuitBoard", label: "회로", keywords: "circuit board hardware" },
      { name: "Microchip", label: "칩", keywords: "chip microchip" },
      { name: "Radio", label: "라디오", keywords: "radio signal" },
      { name: "Antenna", label: "안테나", keywords: "antenna signal" },
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
      { name: "Pin", label: "고정", keywords: "pin fixed" },
      { name: "Hash", label: "태그", keywords: "hash tag channel" },
      { name: "AtSign", label: "멘션", keywords: "mention at" },
      { name: "Tag", label: "라벨", keywords: "label tag" },
      { name: "Inbox", label: "수신함", keywords: "inbox receive" },
      { name: "Send", label: "전송", keywords: "send submit" },
      { name: "RotateCcw", label: "되돌리기", keywords: "undo revert" },
      { name: "History", label: "기록", keywords: "history log" },
      { name: "BookmarkCheck", label: "저장됨", keywords: "saved bookmarked" },
      { name: "ThumbsDown", label: "나쁨", keywords: "dislike bad" },
      { name: "Siren", label: "긴급", keywords: "urgent emergency alert" },
      { name: "Activity", label: "활성", keywords: "activity active live" },
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
  size?: "lg" | "md" | "sm";
  /** 이미지 업로드 실패·용량 초과 시 알림 */
  onUploadMessage?: (message: string) => void;
  /** current가 null일 때 표시할 기본 아이콘. 미지정 시 + 아이콘 */
  defaultIcon?: React.ReactNode;
};


type IconPickerPanelProps = {
  title?: string;
  footer?: ReactNode;
  onPickEmoji: (emoji: string) => void;
  onPickLucide: (name: string, color: string) => void;
  onPickCustom?: (icon: string) => void;
  onRequestCustomUpload?: () => void;
  customIcons?: CustomIconPreset[];
  onDeleteCustomIcon?: (id: string) => void;
};

export function IconPickerPanel({
  title: _title = "페이지 아이콘",
  footer,
  onPickEmoji,
  onPickLucide,
  onPickCustom,
  onRequestCustomUpload: _onRequestCustomUpload,
  customIcons = [],
  onDeleteCustomIcon,
}: IconPickerPanelProps) {
  const [color, setColor] = useState(DEFAULT_LUCIDE_COLOR);
  const [colorOpen, setColorOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<"lucide" | "emoji" | "custom">("lucide");
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
        <div className="mb-2 flex items-center">
          {/* 좌측 스페이서 — 색상 버튼과 너비 균형 */}
          <div className="w-6 shrink-0" />
          {/* 탭 버튼 중앙 정렬 */}
          <div className="flex flex-1 justify-center">
            <div className="flex rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800">
              {(["lucide", "emoji", "custom"] as const).map((menu) => (
                <button
                  key={menu}
                  type="button"
                  onClick={() => { setActiveMenu(menu); setColorOpen(false); }}
                  className={[
                    "rounded px-2 py-1 text-xs",
                    activeMenu === menu
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                      : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
                  ].join(" ")}
                >
                  {menu === "lucide" ? "루시드" : menu === "emoji" ? "이모지" : "커스텀"}
                </button>
              ))}
            </div>
          </div>
          {/* 색상 드롭다운 버튼 — 루시드 탭에서만 표시 */}
          <div className="relative w-6 shrink-0">
            {activeMenu === "lucide" ? (
              <>
                <button
                  type="button"
                  onClick={() => setColorOpen((v) => !v)}
                  className="h-5 w-5 rounded-full border-2 border-white shadow ring-1 ring-zinc-300 dark:border-zinc-900 dark:ring-zinc-600"
                  style={{ backgroundColor: color }}
                  aria-label="색상 선택"
                  title="색상 선택"
                />
                {colorOpen ? (
                  <div className="absolute right-0 top-7 z-20 rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                    <div className="flex flex-wrap gap-1.5" style={{ width: 120 }}>
                      {LUCIDE_COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => { setColor(preset); setColorOpen(false); }}
                          className={[
                            "h-5 w-5 rounded-full border",
                            color === preset
                              ? "border-zinc-900 ring-2 ring-zinc-300 dark:border-white dark:ring-zinc-600"
                              : "border-zinc-200 dark:border-zinc-700",
                          ].join(" ")}
                          style={{ backgroundColor: preset }}
                          aria-label={`색상 ${preset}`}
                          title={preset}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        {/* 세 탭 모두 항상 마운트 — CSS display로 전환해 재렌더 방지 */}
        <div className="h-[360px] overflow-hidden">
          {/* 루시드 탭 */}
          <div className="flex h-full flex-col" style={{ display: activeMenu === "lucide" ? "flex" : "none" }}>
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
              <div className="grid grid-cols-6 gap-1">
                {visibleLucideIcons.map((item) => {
                  const Icon = getLucideIcon(item.name);
                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => pickLucideIcon(item.name)}
                      className="flex h-11 w-full items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      title={item.label}
                      aria-label={item.label}
                    >
                      <Icon size={24} color={color} strokeWidth={1.9} />
                    </button>
                  );
                })}
                {visibleLucideIcons.length === 0 ? (
                  <div className="col-span-6 py-6 text-center text-xs text-zinc-400">
                    검색 결과가 없습니다.
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* 이모지 탭 — 항상 마운트, Suspense는 최초 1회만 */}
          <div className="h-full" style={{ display: activeMenu === "emoji" ? "block" : "none" }}>
            <Suspense
              fallback={
                <div className="h-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
              }
            >
              <IconPickerEmoji onPick={onPickEmoji} />
            </Suspense>
          </div>

          {/* 커스텀 탭 */}
          <div className="flex h-full flex-col" style={{ display: activeMenu === "custom" ? "flex" : "none" }}>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {customIcons.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-400">
                  등록된 커스텀 아이콘이 없습니다.
                  <br />
                  <span className="text-zinc-300 dark:text-zinc-600">아래 이미지 업로드 버튼을 사용하세요.</span>
                </div>
              ) : (
                <div className="grid grid-cols-6 gap-1">
                  {customIcons.map((item) => (
                    <div key={item.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => onPickCustom?.(item.src)}
                        className="relative flex h-11 w-full items-center justify-center overflow-hidden rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        title={item.label}
                        aria-label={item.label}
                      >
                        <PageIconDisplay icon={item.src} size="md" className="!h-9 !w-9" imgClassName="!h-9 !w-9" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteCustomIcon?.(item.id)}
                        className="absolute right-0.5 top-0.5 z-10 hidden h-4 w-4 items-center justify-center rounded-full bg-zinc-600 text-white group-hover:flex dark:bg-zinc-500"
                        title="삭제"
                        aria-label="아이콘 삭제"
                      >
                        <LucideIcons.X size={9} strokeWidth={2.5} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {footer ? (
        <div className="flex flex-col gap-0.5 border-t border-zinc-200 p-1.5 dark:border-zinc-700">
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
  defaultIcon,
}: Props) {
  const [open, setOpen] = useState(false);
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // 워크스페이스 공유 커스텀 아이콘 — 모든 멤버가 같은 목록을 본다.
  // 서버 fetch 후 store 에 캐시, 페이지 첫 진입 시 1회 호출.
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const customIconsByWs = useCustomIconStore((s) => s.byWorkspace);
  const fetchCustomIcons = useCustomIconStore((s) => s.fetch);
  const addCustomIconSrv = useCustomIconStore((s) => s.add);
  const removeCustomIconSrv = useCustomIconStore((s) => s.remove);
  const customIcons: CustomIconPreset[] = useMemo(() => {
    if (!workspaceId) return [];
    return (customIconsByWs[workspaceId] ?? []).map((i) => ({
      id: i.id,
      src: i.src,
      label: i.label || "커스텀 아이콘",
    }));
  }, [customIconsByWs, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    void fetchCustomIcons(workspaceId);
  }, [workspaceId, fetchCustomIcons]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const openPicker = () => {
    if (open) { setOpen(false); return; }
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      const panelW = 340;
      const panelH = 380;
      let left = rect.left;
      let top = rect.bottom + 4;
      if (left + panelW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - panelW - 8);
      if (top + panelH > window.innerHeight - 8) top = Math.max(8, rect.top - panelH - 4);
      setPopoverCoords({ top, left });
    }
    setOpen(true);
  };

  const trigger =
    size === "lg" ? (
      <button
        type="button"
        onClick={openPicker}
        className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md text-5xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label="페이지 아이콘"
      >
        {current ? (
          <PageIconDisplay icon={current} size="lg" />
        ) : (
          defaultIcon ?? <LucideIcons.Plus size={18} className="text-zinc-400" />
        )}
      </button>
    ) : size === "md" ? (
      <button
        type="button"
        onClick={openPicker}
        className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded text-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label="페이지 아이콘"
      >
        {current ? (
          <PageIconDisplay icon={current} size="md" />
        ) : (
          <PageIconDisplay icon={null} size="md" />
        )}
      </button>
    ) : (
      <button
        type="button"
        onClick={openPicker}
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

  const onPickImageFile = async (file: File | undefined, savePreset = true) => {
    if (!file || !file.type.startsWith("image/")) return;
    const ok = await insertImageFromFile(
      file,
      async (attrs) => {
        if (savePreset && workspaceId) {
          // 워크스페이스 공유 아이콘으로 등록 — 모든 멤버가 즉시 볼 수 있음.
          try {
            await addCustomIconSrv({
              workspaceId,
              src: attrs.src,
              label: file.name || "커스텀 아이콘",
            });
          } catch (err) {
            console.error("[IconPicker] addCustomIcon 실패", err);
          }
        }
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
      {open && popoverCoords && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: popoverCoords.top, left: popoverCoords.left, zIndex: 9999 }}
        >
          <IconPickerPanel
            onPickLucide={(name, nextColor) => {
              onChange(encodeLucidePageIcon(name, nextColor));
              setOpen(false);
            }}
            onPickEmoji={(emoji) => {
              onChange(emoji);
              setOpen(false);
            }}
            onPickCustom={(icon) => {
              onChange(icon);
              setOpen(false);
            }}
            onRequestCustomUpload={() => fileRef.current?.click()}
            customIcons={customIcons}
            onDeleteCustomIcon={(id) => {
              if (!workspaceId) return;
              void removeCustomIconSrv(id, workspaceId).catch((err) => {
                console.error("[IconPicker] deleteCustomIcon 실패", err);
              });
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
                {current ? (
                  <button
                    type="button"
                    onClick={() => {
                      onChange(null);
                      setOpen(false);
                    }}
                    className="group flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <div className="h-5 w-5 shrink-0 overflow-hidden rounded opacity-70 group-hover:opacity-100">
                      <PageIconDisplay icon={current} size="sm" />
                    </div>
                    <span>아이콘 제거</span>
                  </button>
                ) : null}
              </>
            }
          />
        </div>,
        document.body
      )}
    </div>
  );
}
