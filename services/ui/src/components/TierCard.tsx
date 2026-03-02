import type { ProgressTier, ScoreComponents } from '../types/progress'

const tierColors: Record<ProgressTier, string> = {
  'Starting Out': 'text-ws-muted',
  'Building': 'text-ws-blue',
  'Growing': 'text-ws-green',
  'Thriving': 'text-ws-purple',
  'Flourishing': 'text-ws-yellow',
}

const tierBarColors: Record<ProgressTier, string> = {
  'Starting Out': 'bg-ws-muted',
  'Building': 'bg-ws-blue',
  'Growing': 'bg-ws-green',
  'Thriving': 'bg-ws-purple',
  'Flourishing': 'bg-ws-yellow',
}

interface TierCardProps {
  tier: ProgressTier
  score: number
  quote: string
  nextTier: string | null
  pointsToNext: number
  components: ScoreComponents
}

const componentLabels: Record<string, string> = {
  savings_rate: 'Savings',
  emergency_fund: 'Emergency',
  dti_trend: 'Debt Ratio',
  credit_utilization: 'Credit Use',
  consistency: 'Consistency',
}

const componentDescriptions: Record<string, string> = {
  savings_rate: 'How much of your income you save each month',
  emergency_fund: 'Months of expenses covered by liquid savings',
  dti_trend: 'Your debt payments relative to your income',
  credit_utilization: 'How much of your available credit you\'re using',
  consistency: 'How steady your financial habits are over time',
}

export default function TierCard({ tier, score, quote, nextTier, pointsToNext, components }: TierCardProps) {
  const color = tierColors[tier] || 'text-ws-accent'
  const barColor = tierBarColors[tier] || 'bg-ws-accent'

  // Find the weakest components — areas to improve
  const sorted = Object.entries(components).sort((a, b) => a[1] - b[1])
  const maxPerComponent = 20

  return (
    <div className="rounded-xl bg-white border border-ws-border p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-ws-muted uppercase tracking-wider">Progress Tier</p>
          <h2 className={`mt-1 text-2xl font-extrabold ${color}`}>{tier}</h2>
          <p className="mt-1 text-sm text-ws-muted italic">{quote}</p>
        </div>
        <div className="text-right">
          <p className={`text-4xl font-extrabold ${color}`}>{score}</p>
          <p className="text-xs text-ws-muted">/100</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-ws-muted mb-1">
          <span>{tier}</span>
          {nextTier && <span>{pointsToNext} points to {nextTier}</span>}
        </div>
        <div className="h-2.5 rounded-full bg-ws-surface overflow-hidden">
          <div
            className={`h-full rounded-full ${barColor} transition-all`}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>

      {/* Score components with mini bars */}
      <div className="mt-5 grid grid-cols-5 gap-3">
        {sorted.map(([key, value]) => (
          <div key={key} className="text-center">
            <p className="text-xs text-ws-muted">{componentLabels[key] || key}</p>
            <p className="text-sm font-bold mt-0.5">{Math.round(value)}/{maxPerComponent}</p>
            <div className="mt-1 h-1 rounded-full bg-ws-surface overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${value >= maxPerComponent * 0.7 ? 'bg-ws-green' : value >= maxPerComponent * 0.4 ? 'bg-ws-orange' : 'bg-ws-red'}`}
                style={{ width: `${(value / maxPerComponent) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Next tier guidance */}
      {nextTier && (
        <div className="mt-5 pt-4 border-t border-ws-border">
          <p className="text-sm font-semibold">How to reach {nextTier}</p>
          <p className="text-xs text-ws-muted mt-1">
            You need {pointsToNext} more points. Focus on your weakest areas:
          </p>
          <div className="mt-2 space-y-1.5">
            {sorted.slice(0, 2).map(([key, value]) => {
              const room = maxPerComponent - Math.round(value)
              if (room <= 0) return null
              return (
                <div key={key} className="flex items-center gap-2 text-xs">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-ws-orange shrink-0" />
                  <span className="text-ws-text">
                    <span className="font-semibold">{componentLabels[key] || key}</span>
                    {' — '}
                    {componentDescriptions[key] || 'Improve this area'}
                    {' '}
                    <span className="text-ws-muted">(up to {room} points available)</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
