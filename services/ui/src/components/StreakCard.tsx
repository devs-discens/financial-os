import type { Streak } from '../types/progress'

const streakLabels: Record<string, string> = {
  positive_savings: 'Positive Savings',
  debt_reduction: 'Debt Reduction',
}

const streakDescriptions: Record<string, string> = {
  positive_savings: 'Consecutive cycles with savings > 0',
  debt_reduction: 'Consecutive cycles reducing credit utilization',
}

interface StreakCardProps {
  streak: Streak
}

export default function StreakCard({ streak }: StreakCardProps) {
  const label = streakLabels[streak.streak_type] || streak.streak_type
  const description = streakDescriptions[streak.streak_type] || ''
  const isActive = streak.current_count > 0

  return (
    <div className="rounded-xl bg-white border border-ws-border p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`text-xl ${isActive ? 'text-ws-orange' : 'text-ws-muted'}`}>
          {isActive ? '^' : '-'}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs text-ws-muted">{description}</p>
        </div>
      </div>

      <div className="mt-3 flex items-baseline gap-4">
        <div>
          <p className={`text-2xl font-extrabold ${isActive ? 'text-ws-orange' : 'text-ws-muted'}`}>
            {streak.current_count}
          </p>
          <p className="text-xs text-ws-muted">Current</p>
        </div>
        <div>
          <p className="text-lg font-bold text-ws-accent">{streak.longest_count}</p>
          <p className="text-xs text-ws-muted">Best</p>
        </div>
      </div>
    </div>
  )
}
