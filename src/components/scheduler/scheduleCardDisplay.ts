import type { Schedule } from "../../store/schedulerStore"

export const COMPACT_CARD_ZOOM_THRESHOLD = 0.5

export function shouldUseCompactScheduleCard(zoomLevel: number): boolean {
  return zoomLevel <= COMPACT_CARD_ZOOM_THRESHOLD
}

export function getScheduleCardContentOffset({
  scrollLeft,
  cardLeft,
  cardWidth,
  minVisibleWidth = 36,
}: {
  scrollLeft: number
  cardLeft: number
  cardWidth: number
  minVisibleWidth?: number
}): number {
  const clampedVisibleWidth = Math.max(24, Math.min(minVisibleWidth, cardWidth))
  if (cardWidth <= clampedVisibleWidth) return 0
  const rawOffset = Math.max(0, scrollLeft - cardLeft)
  return Math.min(rawOffset, cardWidth - clampedVisibleWidth)
}

export function getScheduleScopeName(
  schedule: Schedule,
  scopes: {
    projects?: Array<{ id: string; name: string }>
    teams?: Array<{ teamId: string; name: string }>
    organizations?: Array<{ organizationId: string; name: string }>
  },
): string {
  if (schedule.projectId) {
    const project = scopes.projects?.find((item) => item.id === schedule.projectId)
    if (project) return project.name
  }

  if (schedule.teamId) {
    const team = scopes.teams?.find((item) => item.teamId === schedule.teamId)
    if (team) return team.name
  }

  if (schedule.organizationId) {
    const organization = scopes.organizations?.find((item) => item.organizationId === schedule.organizationId)
    if (organization) return organization.name
  }

  return "기타 업무"
}
