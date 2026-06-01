// 작업 탭 일정 카드용 라벨 — Schedule.id(`${pageId}__${assigneeId}`)에서 원본 작업 DB 행을
// 복원해 공용 TimelineCardPropertyLabels 로 위임한다. 기간(날짜) 컬럼은 타임라인 막대이므로 제외.
import { usePageStore } from "../../store/pageStore";
import { parseScheduleInstanceId } from "../../lib/scheduler/taskAdapter";
import { TimelineCardPropertyLabels } from "../database/TimelineCardPropertyLabels";

type Props = {
  /** Schedule.id (= `${pageId}${INSTANCE_SEPARATOR}${assigneeId}`) */
  scheduleId: string;
  /** 라벨 묶음 wrapper 에 추가할 클래스 (색상·폰트 크기 등) */
  className?: string;
};

export function ScheduleCardPropertyLabels({ scheduleId, className }: Props) {
  const pageId = parseScheduleInstanceId(scheduleId)?.pageId;
  const databaseId = usePageStore((s) => (pageId ? s.pages[pageId]?.databaseId : undefined));
  return (
    <TimelineCardPropertyLabels
      databaseId={databaseId}
      pageId={pageId}
      excludeDateColumns
      className={className}
    />
  );
}
