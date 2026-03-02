import { fetchJSON } from './client'
import type { BackgroundStatus, Anomaly, BackgroundEvent } from '../types/background'

export interface BackgroundConnection {
  connection_id: number
  institution_id: string
  institution_name: string
  status: string
  last_poll_at: string | null
  token_expires_at: string | null
  token_healthy: boolean
  is_on_platform: boolean
  latest_event: { event_type: string; created_at: string } | null
}

export interface BackgroundUserConnections {
  user_id: string
  connections: BackgroundConnection[]
}

export function getBackgroundStatus() {
  return fetchJSON<BackgroundStatus>('/background/status')
}

export function getAnomalies(limit = 50) {
  return fetchJSON<{ anomalies: Anomaly[]; count: number }>(`/background/anomalies?limit=${limit}`)
}

export function getBackgroundConnections() {
  return fetchJSON<{ users: BackgroundUserConnections[]; total_connections: number }>('/background/connections')
}

export function triggerBackgroundPoll() {
  return fetchJSON<BackgroundStatus>('/background/trigger', { method: 'POST' })
}

export function triggerUserPoll(userId: string) {
  return fetchJSON<{ triggered: boolean; user_id: string; polled?: number; results?: unknown[] }>(
    `/background/trigger/${encodeURIComponent(userId)}`,
    { method: 'POST' },
  )
}

export function getBackgroundEvents(opts?: { limit?: number; event_type?: string; institution_id?: string }) {
  const params = new URLSearchParams()
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.event_type) params.set('event_type', opts.event_type)
  if (opts?.institution_id) params.set('institution_id', opts.institution_id)
  const qs = params.toString()
  return fetchJSON<{ events: BackgroundEvent[]; count: number }>(`/background/events${qs ? `?${qs}` : ''}`)
}
