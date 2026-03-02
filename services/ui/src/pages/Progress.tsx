import { useState, useEffect, useCallback } from 'react'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import TierCard from '../components/TierCard'
import ProgressMetricCard from '../components/ProgressMetricCard'
import BenchmarkBar from '../components/BenchmarkBar'
import StreakCard from '../components/StreakCard'
import { formatCurrency } from '../components/FormatCurrency'
import { getProgress, getMilestones } from '../api/progress'
import { useAuth } from '../contexts/AuthContext'
import type { ProgressResponse, Milestone } from '../types/progress'

export default function Progress() {
  const { user } = useAuth()
  const USER_ID = user!.id
  const [progress, setProgress] = useState<ProgressResponse | null>(null)
  const [allMilestones, setAllMilestones] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAllMilestones, setShowAllMilestones] = useState(false)
  const [showFullAssessment, setShowFullAssessment] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const [prog, ms] = await Promise.all([
        getProgress(USER_ID),
        getMilestones(USER_ID, { limit: 50 }),
      ])
      setProgress(prog)
      setAllMilestones(ms.milestones)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load progress')
    } finally {
      setLoading(false)
    }
  }, [USER_ID])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <LoadingSpinner />

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-extrabold">Progress</h1>
        <EmptyState
          message="Could not load progress"
          detail={error}
          action={{ label: 'Retry', onClick: fetchData }}
        />
      </div>
    )
  }

  if (!progress) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-extrabold">Progress</h1>
        <EmptyState
          message="No progress data yet"
          detail="Connect a bank and wait for a background poll cycle to generate metrics"
        />
      </div>
    )
  }

  const { metrics, benchmarks, streaks, encouragement } = progress
  const { national, peer } = benchmarks

  const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`
  const fmtMo = (v: number) => `${v.toFixed(1)} mo`

  // Split milestones: latest vs rest
  const latestMilestone = allMilestones.length > 0 ? allMilestones[0] : null
  const olderMilestones = allMilestones.slice(1)

  // Combine encouragement messages into a paragraph
  const assessmentParagraph = encouragement?.messages.map((m) => m.message).join(' ') || ''

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-2xl font-extrabold">Progress</h1>

      {/* Assessment — combined paragraph */}
      {encouragement && assessmentParagraph && (
        <div className="rounded-xl bg-white border border-ws-border p-5 shadow-sm">
          <h2 className="text-lg font-bold mb-3">Assessment</h2>

          {/* Summary paragraph — always shown */}
          {encouragement.summary ? (
            <p className="text-sm text-ws-text leading-relaxed">{encouragement.summary}</p>
          ) : (
            <p className="text-sm text-ws-text leading-relaxed">{assessmentParagraph}</p>
          )}

          {/* Detailed messages — collapsed, skip first (already shown as summary) */}
          {encouragement.summary && encouragement.messages.length > 1 && (
            <>
              {showFullAssessment && (
                <div className="mt-3 pt-3 border-t border-ws-border/50 space-y-2">
                  {encouragement.messages.slice(1).map((msg, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-ws-muted">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-ws-accent mt-1.5 shrink-0" />
                      <span>{msg.message}</span>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => setShowFullAssessment(!showFullAssessment)}
                className="mt-3 text-xs font-semibold text-ws-accent hover:text-ws-accent-dim transition-colors"
              >
                {showFullAssessment ? 'Show less' : `View ${encouragement.messages.length - 1} detailed insight${encouragement.messages.length - 1 === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </div>
      )}

      {/* Tier hero card */}
      <TierCard
        tier={progress.progress_tier}
        score={progress.progress_score}
        quote={progress.tier_quote}
        nextTier={progress.next_tier}
        pointsToNext={progress.points_to_next}
        components={progress.score_components}
      />

      {/* Progress metrics grid */}
      <div className="grid grid-cols-4 gap-4">
        <ProgressMetricCard
          label="Savings Rate"
          value={fmtPct(metrics.savings_rate)}
          subtitle={metrics.savings_rate > 0
            ? 'You\'re saving money each month'
            : 'You\'re spending more than you earn'}
          peerValue={fmtPct(peer.peer_savings_rate)}
          nationalValue={fmtPct(national.median_savings_rate)}
        />
        <ProgressMetricCard
          label="Emergency Fund"
          value={fmtMo(metrics.emergency_fund_months)}
          subtitle={`${formatCurrency(progress.details.liquid_deposits)} in liquid savings covers this many months of essential expenses`}
          peerValue={fmtMo(peer.peer_emergency_fund_months)}
          nationalValue={fmtMo(national.median_emergency_fund_months)}
        />
        <ProgressMetricCard
          label="Credit Utilization"
          value={fmtPct(metrics.credit_utilization)}
          subtitle={`Using ${formatCurrency(progress.details.total_credit_used)} of ${formatCurrency(progress.details.total_credit_limit)} available credit`}
          peerValue={fmtPct(peer.peer_credit_utilization)}
          nationalValue={fmtPct(national.median_credit_utilization)}
        />
        <ProgressMetricCard
          label="Debt-to-Income Ratio"
          value={fmtPct(metrics.dti)}
          subtitle={metrics.dti < 0.30
            ? 'Your debt payments are a manageable share of your income'
            : 'Your debt payments are taking a large share of your income'}
          peerValue={fmtPct(peer.peer_dti_ratio)}
          nationalValue={fmtPct(national.median_dti_ratio)}
        />
      </div>

      {/* Benchmark comparison */}
      <div className="rounded-xl bg-white border border-ws-border p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-bold">How You Compare</h2>
          <p className="text-xs text-ws-muted mt-1">{peer.peer_description}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          <BenchmarkBar
            label="Savings Rate"
            you={metrics.savings_rate * 100}
            peer={peer.peer_savings_rate * 100}
            national={national.median_savings_rate * 100}
            format={(v) => `${v.toFixed(1)}%`}
          />
          <BenchmarkBar
            label="Emergency Fund"
            you={metrics.emergency_fund_months}
            peer={peer.peer_emergency_fund_months}
            national={national.median_emergency_fund_months}
            format={(v) => `${v.toFixed(1)} mo`}
          />
          <BenchmarkBar
            label="Credit Utilization"
            you={metrics.credit_utilization * 100}
            peer={peer.peer_credit_utilization * 100}
            national={national.median_credit_utilization * 100}
            format={(v) => `${v.toFixed(1)}%`}
            lowerIsBetter
          />
          <BenchmarkBar
            label="Debt-to-Income Ratio"
            you={metrics.dti * 100}
            peer={peer.peer_dti_ratio * 100}
            national={national.median_dti_ratio * 100}
            format={(v) => `${v.toFixed(1)}%`}
            lowerIsBetter
          />
        </div>
      </div>

      {/* Streaks */}
      {streaks.length > 0 && (
        <div>
          <h2 className="text-lg font-bold mb-3">Streaks</h2>
          <div className="grid grid-cols-2 gap-4">
            {streaks.map((s) => (
              <StreakCard key={s.id} streak={s} />
            ))}
          </div>
        </div>
      )}

      {/* Milestones — latest only, expand for the rest */}
      {allMilestones.length > 0 && (
        <div className="rounded-xl bg-white border border-ws-border p-5 shadow-sm">
          <h2 className="text-lg font-bold mb-4">Milestones</h2>

          {/* Latest milestone — always shown */}
          {latestMilestone && (
            <div className="flex items-center gap-3 py-2">
              <div className={`h-2.5 w-2.5 rounded-full ${latestMilestone.acknowledged ? 'bg-ws-muted' : 'bg-ws-accent'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{formatMilestoneLabel(latestMilestone)}</p>
                {latestMilestone.narrative && (
                  <p className="text-xs text-ws-muted mt-0.5">{latestMilestone.narrative}</p>
                )}
              </div>
              <span className="text-xs text-ws-muted shrink-0">
                {new Date(latestMilestone.achieved_at).toLocaleDateString()}
              </span>
            </div>
          )}

          {/* Older milestones — collapsed by default */}
          {olderMilestones.length > 0 && (
            <>
              {showAllMilestones && (
                <div className="mt-2 space-y-1 border-t border-ws-border/50 pt-2">
                  {olderMilestones.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 py-1.5">
                      <div className={`h-2 w-2 rounded-full ${m.acknowledged ? 'bg-ws-muted' : 'bg-ws-accent'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{formatMilestoneLabel(m)}</p>
                      </div>
                      <span className="text-xs text-ws-muted shrink-0">
                        {new Date(m.achieved_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => setShowAllMilestones(!showAllMilestones)}
                className="mt-3 text-xs font-semibold text-ws-accent hover:text-ws-accent-dim transition-colors"
              >
                {showAllMilestones ? 'Show less' : `View ${olderMilestones.length} earlier milestone${olderMilestones.length === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </div>
      )}

    </div>
  )
}

function formatMilestoneLabel(m: Milestone): string {
  switch (m.milestone_type) {
    case 'net_worth_crossing':
      return `Net worth reached $${Number(m.milestone_value).toLocaleString()}`
    case 'emergency_fund':
      return `Emergency fund covers ${m.milestone_value} month${m.milestone_value !== 1 ? 's' : ''} of expenses`
    case 'savings':
      return 'First month of positive savings'
    case 'debt_payoff':
      return 'All credit card balances paid off'
    case 'tier_transition': {
      const tier = (m.details as Record<string, string>).tier || 'new tier'
      return `Reached ${tier} tier`
    }
    case 'personal_best':
      return `New personal best: ${m.milestone_key.replace(/_/g, ' ')}`
    case 'goal_progress': {
      const goalLabel = (m.details as Record<string, unknown>)?.goal_label || 'Goal'
      const threshold = (m.details as Record<string, unknown>)?.threshold || 0
      return `${goalLabel}: ${threshold}% progress`
    }
    case 'goal_achieved': {
      const achievedLabel = (m.details as Record<string, unknown>)?.goal_label || 'Goal'
      return `Goal achieved: ${achievedLabel}`
    }
    default:
      return m.milestone_key.replace(/_/g, ' ')
  }
}
