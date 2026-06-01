import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CalendarRange,
  ClipboardList,
  Flag,
  Layers,
  MousePointer2,
  Plane,
  X,
} from "lucide-react";

type GuideTabId = "common" | "milestone" | "feature" | "task";

type GuideTab = {
  id: GuideTabId;
  label: string;
};

type GuideSection = {
  title: string;
  icon: typeof CalendarRange;
  items: string[];
};

const GUIDE_TABS: GuideTab[] = [
  { id: "common", label: "공통" },
  { id: "milestone", label: "마일스톤" },
  { id: "feature", label: "피처" },
  { id: "task", label: "작업" },
];

const GUIDE_CONTENT: Record<GuideTabId, GuideSection[]> = {
  common: [
    {
      title: "화면 전환과 범위 선택",
      icon: MousePointer2,
      items: [
        "상단의 마일스톤, 피처, 작업 탭으로 관리할 데이터 종류를 전환합니다.",
        "조직, 팀, 프로젝트 선택 드롭다운으로 현재 보고 싶은 범위를 좁힙니다.",
        "연간, 월간, 주간 보기와 오늘 버튼을 사용해 타임라인 위치를 빠르게 맞춥니다.",
      ],
    },
    {
      title: "타임라인 조작",
      icon: CalendarRange,
      items: [
        "줌 버튼으로 날짜 축의 밀도를 조절합니다. 연간 보기에서는 열너비도 별도로 조절할 수 있습니다.",
        "마일스톤/피처 타임라인의 첫 컬럼은 경계선을 드래그해 너비를 조절할 수 있습니다.",
        "항목 이름을 클릭하면 첫 일정 카드 위치로 이동하고, 오른쪽 아이콘을 누르면 피커뷰로 엽니다.",
      ],
    },
  ],
  milestone: [
    {
      title: "마일스톤의 역할",
      icon: Flag,
      items: [
        "마일스톤은 프로젝트의 큰 목표나 릴리즈 구간을 날짜 범위로 정리하는 상위 항목입니다.",
        "피처와 작업은 마일스톤에 연결해 범위별 진행 상황을 함께 볼 수 있습니다.",
        "첫 컬럼의 마일스톤 항목은 드래그앤드롭으로 순서를 바꿀 수 있고, 변경 순서는 서버에 저장됩니다.",
      ],
    },
    {
      title: "마일스톤 생성",
      icon: ClipboardList,
      items: [
        "마일스톤 DB에서 새 행을 추가한 뒤 제목, 기간, 조직/팀/프로젝트 값을 입력합니다.",
        "기간 컬럼에 시작일과 종료일을 넣으면 타임라인 카드가 자동으로 표시됩니다.",
        "색상 컬럼을 지정하면 타임라인 카드 색상이 해당 값으로 표시됩니다.",
      ],
    },
  ],
  feature: [
    {
      title: "피처의 역할",
      icon: Layers,
      items: [
        "피처는 마일스톤 안에서 실제로 구현하거나 검증해야 하는 기능 단위입니다.",
        "피처 탭에서는 마일스톤 필터를 사용해 특정 마일스톤에 연결된 피처만 볼 수 있습니다.",
        "피처 항목도 첫 컬럼에서 드래그앤드롭으로 정렬할 수 있고, 순서는 서버에 동기화됩니다.",
      ],
    },
    {
      title: "피처 생성",
      icon: ClipboardList,
      items: [
        "피처 DB에서 새 행을 추가하고 제목, 기간, 마일스톤, 담당 범위 정보를 입력합니다.",
        "마일스톤 링크를 지정하면 마일스톤 기준 필터와 범위 선택에서 함께 사용됩니다.",
        "기간이 비어 있으면 타임라인에 카드가 보이지 않으므로 시작일과 종료일을 먼저 확인합니다.",
      ],
    },
  ],
  task: [
    {
      title: "일정 카드",
      icon: CalendarRange,
      items: [
        "작업 탭의 타임라인 빈 영역을 드래그하거나 DB 행을 추가해 일정 카드를 생성합니다.",
        "카드는 담당자, 기간, 프로젝트, 상태, 피처/마일스톤 연결 정보를 기준으로 표시됩니다.",
        "카드를 드래그하면 날짜를 이동하고, 가장자리를 조절하면 기간을 변경합니다.",
      ],
    },
    {
      title: "연차 카드와 특이사항 카드",
      icon: Plane,
      items: [
        "연차는 연차 프리셋 또는 연차 카드 유형으로 생성하며 일반 작업과 다른 색상으로 구분됩니다.",
        "특이사항은 일정 설명이나 특이사항용 프리셋을 사용해 남기면 주간 확인 시 누락을 줄일 수 있습니다.",
        "겹치는 일정이 많으면 구성원별 행이 자동으로 늘어나며, 필요 시 구성원 설정에서 행 개수를 조정합니다.",
      ],
    },
    {
      title: "구성원 탭과 주간 MM",
      icon: AlertTriangle,
      items: [
        "구성원 탭은 드래그앤드롭으로 순서를 바꿀 수 있고, 그 순서대로 작업 타임라인 행도 표시됩니다.",
        "통합 탭에서는 전체 구성원 일정을 보고, Shift+클릭으로 여러 구성원을 함께 선택할 수 있습니다.",
        "주간 MM은 주간 보기 하단 패널에서 해당 주차의 프로젝트별 투입 비율을 입력합니다. 합계가 100%가 되도록 조정한 뒤 저장합니다.",
      ],
    },
  ],
};

type Props = {
  onClose: () => void;
};

export function SchedulerGuideModal({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<GuideTabId>("common");
  const sections = useMemo(() => GUIDE_CONTENT[activeTab], [activeTab]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[650] flex items-center justify-center bg-zinc-950/45 px-4 py-6"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lc-scheduler-guide-title"
        className="flex max-h-[min(760px,calc(100vh-48px))] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 id="lc-scheduler-guide-title" className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              LC스케줄러 사용가이드
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              처음 접근한 사용자가 일정 구조와 입력 흐름을 빠르게 이해할 수 있도록 정리했습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="사용가이드 닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-zinc-200 px-5 pt-3 dark:border-zinc-800">
          <div className="flex gap-1" role="tablist" aria-label="사용가이드 카테고리">
            {GUIDE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-green-600 text-white"
                    : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 overflow-y-auto p-5 md:grid-cols-2">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <section
                key={section.title}
                className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="mb-3 flex items-center gap-2">
                  <Icon className="h-4 w-4 text-green-600" />
                  <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                    {section.title}
                  </h3>
                </div>
                <ul className="space-y-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                  {section.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
