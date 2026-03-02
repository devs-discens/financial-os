export interface BackgroundStatus {
  running: boolean
  cycle_count: number
  last_cycle_at: string | null
  last_cycle_ms: number
  poll_interval_seconds: number
  background_enabled: boolean
}

export interface Anomaly {
  id: number
  connection_id: number
  institution_id: string
  details: {
    account_id: string
    pct_change: number
    detail: string
    [key: string]: unknown
  }
  created_at: string
}

export type BackgroundEventType =
  | 'background_poll_success'
  | 'background_poll_failed'
  | 'background_poll_started'
  | 'anomaly_detected'
  | 'token_refreshed'
  | 'token_refresh_failed_401'
  | 'consent_revoked'
  | 'milestone_achieved'

export interface BackgroundEvent {
  id: number
  connection_id: number | null
  institution_id: string
  event_type: BackgroundEventType | string
  details: Record<string, unknown>
  created_at: string
}
