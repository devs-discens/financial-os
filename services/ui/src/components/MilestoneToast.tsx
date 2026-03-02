import type { Milestone } from '../types/progress'

const milestoneIcons: Record<string, string> = {
  net_worth_crossing: '$',
  emergency_fund: '+',
  savings: '^',
  debt_payoff: '!',
  tier_transition: '*',
  personal_best: '=',
}

interface MilestoneToastProps {
  milestones: Milestone[]
  onDismiss: (id: number) => void
}

export default function MilestoneToast({ milestones, onDismiss }: MilestoneToastProps) {
  if (milestones.length === 0) return null

  return (
    <div className="space-y-2">
      {milestones.map((m) => (
        <div
          key={m.id}
          className="flex items-center gap-3 rounded-xl bg-ws-accent/5 border border-ws-accent/20 px-4 py-3 animate-fade-in"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ws-accent/10 text-ws-accent font-bold text-sm">
            {milestoneIcons[m.milestone_type] || '*'}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ws-accent">
              {formatMilestoneTitle(m)}
            </p>
            <p className="text-xs text-ws-muted mt-0.5">
              {new Date(m.achieved_at).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={() => onDismiss(m.id)}
            className="shrink-0 rounded-lg px-2.5 py-1 text-xs text-ws-muted hover:text-ws-text hover:bg-ws-surface transition-colors"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  )
}

function formatMilestoneTitle(m: Milestone): string {
  switch (m.milestone_type) {
    case 'net_worth_crossing':
      return `Net worth reached $${Number(m.milestone_value).toLocaleString()}`
    case 'emergency_fund':
      return `Emergency fund: ${m.milestone_value} month${m.milestone_value !== 1 ? 's' : ''} covered`
    case 'savings':
      return 'First month of positive savings'
    case 'debt_payoff':
      return 'All credit card balances at $0'
    case 'tier_transition': {
      const tier = (m.details as Record<string, string>).tier || 'new tier'
      return `Reached ${tier} tier`
    }
    case 'personal_best':
      return `New personal best: ${m.milestone_key.replace(/_/g, ' ')}`
    default:
      return m.milestone_key.replace(/_/g, ' ')
  }
}
