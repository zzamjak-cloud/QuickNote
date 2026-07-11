// 루시드 아이콘 카탈로그.
// - 테마별 큐레이션 카테고리(빠른 탐색용, 한국어 라벨/키워드)
// - "전체" 카테고리는 lucide-react 가 export 하는 모든 아이콘(~1900개)을 동적 열거.
//
// IconPicker 계열은 이미 `import * as LucideIcons` + 동적 조회(LucideIcons[name]) 를 쓰므로
// 라이브러리 전체가 이미 번들에 포함된다. 따라서 전체 열거는 번들 크기를 추가로 늘리지 않는다.

import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type LucidePreset = {
  name: string;
  label: string;
  keywords?: string;
};

export type LucideCategory = {
  id: string;
  label: string;
  items: LucidePreset[];
};

export const LUCIDE_COLOR_PRESETS = [
  "#3f3f46",
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#ca8a04",
  "#9333ea",
  "#0891b2",
  "#db2777",
];

export const LUCIDE_ICON_CATEGORIES: LucideCategory[] = [
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
      { name: "CreditCard", label: "카드", keywords: "credit card payment" },
      { name: "Wallet", label: "지갑", keywords: "wallet money" },
      { name: "Banknote", label: "지폐", keywords: "cash bill money" },
      { name: "PiggyBank", label: "저축", keywords: "savings piggy bank" },
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
  {
    id: "nature",
    label: "자연",
    items: [
      { name: "Sun", label: "해", keywords: "sun sunny day" },
      { name: "Moon", label: "달", keywords: "moon night" },
      { name: "CloudSun", label: "구름해", keywords: "partly cloudy" },
      { name: "CloudRain", label: "비", keywords: "rain weather" },
      { name: "CloudSnow", label: "눈", keywords: "snow weather" },
      { name: "CloudLightning", label: "번개", keywords: "storm lightning" },
      { name: "Wind", label: "바람", keywords: "wind breeze" },
      { name: "Snowflake", label: "눈송이", keywords: "snowflake cold" },
      { name: "Droplet", label: "물방울", keywords: "water drop" },
      { name: "Flame", label: "불", keywords: "fire flame" },
      { name: "Leaf", label: "잎", keywords: "leaf plant" },
      { name: "TreePine", label: "나무", keywords: "tree pine forest" },
      { name: "TreePalm", label: "야자수", keywords: "palm tree beach" },
      { name: "Sprout", label: "새싹", keywords: "sprout grow" },
      { name: "Flower2", label: "꽃", keywords: "flower bloom" },
      { name: "Mountain", label: "산", keywords: "mountain hill" },
      { name: "MountainSnow", label: "설산", keywords: "snow mountain peak" },
      { name: "Waves", label: "파도", keywords: "waves ocean sea" },
      { name: "Rainbow", label: "무지개", keywords: "rainbow" },
      { name: "Star", label: "별", keywords: "star night" },
      { name: "Sparkles", label: "반짝", keywords: "sparkle shine" },
      { name: "Bird", label: "새", keywords: "bird animal" },
      { name: "Fish", label: "물고기", keywords: "fish sea" },
      { name: "Bug", label: "벌레", keywords: "bug insect" },
      { name: "PawPrint", label: "발자국", keywords: "paw animal pet" },
      { name: "Cat", label: "고양이", keywords: "cat pet" },
      { name: "Dog", label: "강아지", keywords: "dog pet" },
      { name: "Rabbit", label: "토끼", keywords: "rabbit bunny" },
      { name: "Turtle", label: "거북이", keywords: "turtle slow" },
      { name: "Squirrel", label: "다람쥐", keywords: "squirrel" },
      { name: "Shell", label: "조개", keywords: "shell sea" },
      { name: "Trees", label: "숲", keywords: "trees forest" },
      { name: "Earth", label: "지구", keywords: "earth globe planet" },
      { name: "Cloud", label: "구름", keywords: "cloud sky" },
      { name: "Thermometer", label: "온도", keywords: "temperature thermometer" },
    ],
  },
  {
    id: "life",
    label: "생활",
    items: [
      { name: "House", label: "집", keywords: "home house" },
      { name: "Building", label: "건물", keywords: "building" },
      { name: "Store", label: "상점", keywords: "store shop" },
      { name: "ShoppingCart", label: "장바구니", keywords: "cart shopping" },
      { name: "ShoppingBag", label: "쇼핑백", keywords: "shopping bag" },
      { name: "Gift", label: "선물", keywords: "gift present" },
      { name: "Cake", label: "케이크", keywords: "cake birthday" },
      { name: "Coffee", label: "커피", keywords: "coffee cup" },
      { name: "Utensils", label: "식사", keywords: "food eat restaurant" },
      { name: "Pizza", label: "피자", keywords: "pizza food" },
      { name: "Apple", label: "사과", keywords: "apple fruit" },
      { name: "Wine", label: "와인", keywords: "wine drink" },
      { name: "Beer", label: "맥주", keywords: "beer drink" },
      { name: "Car", label: "자동차", keywords: "car vehicle" },
      { name: "Bus", label: "버스", keywords: "bus transit" },
      { name: "Train", label: "기차", keywords: "train rail" },
      { name: "Plane", label: "비행기", keywords: "plane flight travel" },
      { name: "Bike", label: "자전거", keywords: "bike cycle" },
      { name: "Ship", label: "배", keywords: "ship boat" },
      { name: "MapPin", label: "위치", keywords: "location pin map" },
      { name: "Bed", label: "침대", keywords: "bed sleep" },
      { name: "Bath", label: "욕조", keywords: "bath shower" },
      { name: "Shirt", label: "옷", keywords: "shirt clothes" },
      { name: "Footprints", label: "발자국", keywords: "footprints walk" },
      { name: "Dumbbell", label: "운동", keywords: "dumbbell gym fitness" },
      { name: "HeartPulse", label: "건강", keywords: "health heart pulse" },
      { name: "Pill", label: "약", keywords: "pill medicine" },
      { name: "Stethoscope", label: "진료", keywords: "stethoscope medical" },
      { name: "GraduationCap", label: "학업", keywords: "graduation education" },
      { name: "Baby", label: "아기", keywords: "baby child" },
      { name: "Dog", label: "반려견", keywords: "dog pet" },
      { name: "Gamepad2", label: "게임", keywords: "game controller" },
      { name: "Dice5", label: "주사위", keywords: "dice game" },
      { name: "Puzzle", label: "퍼즐", keywords: "puzzle piece" },
      { name: "PartyPopper", label: "파티", keywords: "party celebrate" },
    ],
  },
];

// 큐레이션 프리셋을 name → preset 으로 합쳐 두어, 전체 목록에서 한국어 라벨/키워드를 재사용한다.
const CURATED_BY_NAME = new Map<string, LucidePreset>(
  LUCIDE_ICON_CATEGORIES.flatMap((c) => c.items).map((item) => [item.name, item]),
);

// PascalCase 아이콘 export 만 추린다. "…Icon" 별칭·"Lucide…" 별칭·비아이콘 export 제외.
function isLikelyIconExport(name: string, value: unknown): boolean {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) return false;
  if (name.endsWith("Icon")) return false;
  if (name.startsWith("Lucide")) return false;
  return typeof value === "object" || typeof value === "function";
}

// CamelCase 이름을 검색용 공백 구분 소문자 키워드로 변환. (예: "FileCode2" → "file code 2")
function humanizeName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .toLowerCase();
}

// lucide-react 가 노출하는 모든 아이콘을 동적 열거해 프리셋으로 구성(이름순).
// 큐레이션에 있으면 한국어 라벨/키워드를 우선 사용하고, 없으면 이름 기반으로 생성.
export const ALL_LUCIDE_PRESETS: LucidePreset[] = Object.entries(
  LucideIcons as unknown as Record<string, unknown>,
)
  .filter(([name, value]) => isLikelyIconExport(name, value))
  .map(([name]): LucidePreset => {
    const curated = CURATED_BY_NAME.get(name);
    if (curated) return curated;
    return { name, label: name, keywords: humanizeName(name) };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

export function getLucideIcon(name: string): LucideIcon {
  return (
    (LucideIcons as unknown as Record<string, LucideIcon | undefined>)[name] ??
    LucideIcons.Circle
  );
}

export function matchesLucideSearch(item: LucidePreset, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${item.name} ${item.label} ${item.keywords ?? ""}`
    .toLowerCase()
    .includes(q);
}
