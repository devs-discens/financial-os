type BadgeVariant =
  | 'active' | 'stale' | 'revoked'
  | 'draft' | 'completed' | 'executing' | 'failed' | 'approved'
  | 'pending' | 'pending_approval'
  | 'mfa_pending'
  | 'manual' | 'council'

const variantStyles: Record<string, string> = {
  active: 'bg-ws-green/15 text-ws-green',
  stale: 'bg-ws-yellow/15 text-ws-yellow',
  revoked: 'bg-ws-red/15 text-ws-red',
  draft: 'bg-ws-muted/15 text-ws-muted',
  completed: 'bg-ws-green/15 text-ws-green',
  executing: 'bg-ws-blue/15 text-ws-blue',
  failed: 'bg-ws-red/15 text-ws-red',
  approved: 'bg-ws-accent/15 text-ws-accent',
  pending: 'bg-ws-muted/15 text-ws-muted',
  pending_approval: 'bg-ws-yellow/15 text-ws-yellow',
  mfa_pending: 'bg-ws-orange/15 text-ws-orange',
  manual: 'bg-ws-muted/15 text-ws-muted',
  council: 'bg-ws-orange/15 text-ws-orange',
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  executing: 'Running',
  completed: 'Complete',
  failed: 'Failed',
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  active: 'Active',
  stale: 'Stale',
  revoked: 'Revoked',
  mfa_pending: 'MFA Pending',
}

export default function StatusBadge({ status }: { status: BadgeVariant | string }) {
  const style = variantStyles[status] ?? 'bg-ws-muted/15 text-ws-muted'
  const label = statusLabels[status] ?? status.replace(/_/g, ' ')
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  )
}

const providerStyles: Record<string, string> = {
  anthropic: 'bg-ws-orange/15 text-ws-orange',
  openai: 'bg-ws-green/15 text-ws-green',
  gemini: 'bg-ws-blue/15 text-ws-blue',
}

export function ProviderBadge({ provider }: { provider: string }) {
  const style = providerStyles[provider] ?? 'bg-ws-muted/15 text-ws-muted'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {provider}
    </span>
  )
}

const nodeTypeStyles: Record<string, string> = {
  check: 'bg-ws-blue/15 text-ws-blue',
  transfer: 'bg-ws-green/15 text-ws-green',
  allocate: 'bg-ws-purple/15 text-ws-purple',
  council: 'bg-ws-orange/15 text-ws-orange',
  manual: 'bg-ws-muted/15 text-ws-muted',
}

export function NodeTypeBadge({ type }: { type: string }) {
  const style = nodeTypeStyles[type] ?? 'bg-ws-muted/15 text-ws-muted'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {type}
    </span>
  )
}

const eventTypeConfig: Record<string, { style: string; label: string }> = {
  background_poll_success: { style: 'bg-ws-green/15 text-ws-green', label: 'Poll Success' },
  background_poll_started: { style: 'bg-ws-blue/15 text-ws-blue', label: 'Poll Started' },
  background_poll_failed: { style: 'bg-ws-red/15 text-ws-red', label: 'Poll Failed' },
  anomaly_detected: { style: 'bg-ws-orange/15 text-ws-orange', label: 'Anomaly' },
  token_refreshed: { style: 'bg-ws-blue/15 text-ws-blue', label: 'Token Refreshed' },
  token_refresh_failed_401: { style: 'bg-ws-red/15 text-ws-red', label: 'Token Failed' },
  consent_revoked: { style: 'bg-ws-red/15 text-ws-red', label: 'Consent Revoked' },
  milestone_achieved: { style: 'bg-ws-purple/15 text-ws-purple', label: 'Milestone' },
}

export function EventTypeBadge({ eventType }: { eventType: string }) {
  const config = eventTypeConfig[eventType]
  const style = config?.style ?? 'bg-ws-muted/15 text-ws-muted'
  const label = config?.label ?? eventType.replace(/_/g, ' ')
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  )
}
