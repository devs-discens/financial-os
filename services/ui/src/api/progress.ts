import { fetchJSON } from './client'
import type {
  ProgressResponse,
  MilestonesResponse,
  StreaksResponse,
  BenchmarksResponse,
} from '../types/progress'

export function getProgress(userId: string) {
  return fetchJSON<ProgressResponse>(`/progress/${userId}`)
}

export function getMilestones(
  userId: string,
  params?: { unacknowledged_only?: boolean; limit?: number; offset?: number },
) {
  const qs = new URLSearchParams()
  if (params?.unacknowledged_only) qs.set('unacknowledged_only', 'true')
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  const query = qs.toString()
  return fetchJSON<MilestonesResponse>(`/progress/${userId}/milestones${query ? `?${query}` : ''}`)
}

export function acknowledgeMilestone(userId: string, milestoneId: number) {
  return fetchJSON<{ acknowledged: boolean; milestone_id: number }>(
    `/progress/${userId}/milestones/${milestoneId}/acknowledge`,
    { method: 'POST' },
  )
}

export function getStreaks(userId: string) {
  return fetchJSON<StreaksResponse>(`/progress/${userId}/streaks`)
}

export function getBenchmarks(userId: string) {
  return fetchJSON<BenchmarksResponse>(`/progress/${userId}/benchmarks`)
}

export function triggerAssessment(userId: string) {
  return fetchJSON<ProgressResponse>(`/progress/${userId}/assess`, { method: 'POST' })
}
