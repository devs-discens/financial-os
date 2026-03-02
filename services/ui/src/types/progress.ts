export type ProgressTier = 'Starting Out' | 'Building' | 'Growing' | 'Thriving' | 'Flourishing'

export interface ScoreComponents {
  savings_rate: number
  emergency_fund: number
  dti_trend: number
  credit_utilization: number
  consistency: number
}

export interface ProgressMetrics {
  savings_rate: number
  emergency_fund_months: number
  credit_utilization: number
  dti: number
}

export interface ProgressDetails {
  liquid_deposits: number
  monthly_essentials: number
  total_credit_used: number
  total_credit_limit: number
}

export interface NationalBenchmark {
  median_savings_rate: number
  median_emergency_fund_months: number
  median_dti_ratio: number
  median_net_worth: number
  median_credit_utilization: number
  homeownership_rate: number
  age_bracket: string
  income_bracket: string
  province: string
}

export interface PeerBenchmark {
  peer_savings_rate: number
  peer_emergency_fund_months: number
  peer_dti_ratio: number
  peer_net_worth: number
  peer_credit_utilization: number
  peer_count: number
  peer_description: string
  age_bracket: string
  income_bracket: string
  city: string
  housing_status: string
  dependents: number
}

export interface Milestone {
  id: number
  user_id: string
  milestone_type: string
  milestone_key: string
  milestone_value: number
  details: Record<string, unknown>
  narrative: string | null
  acknowledged: boolean
  achieved_at: string
}

export interface Streak {
  id: number
  user_id: string
  streak_type: string
  current_count: number
  longest_count: number
  last_checked_at: string
  streak_start_at: string | null
}

export interface PersonalBest {
  milestone_key: string
  milestone_value: number
  details: Record<string, unknown>
  achieved_at: string
}

export interface EncouragementMessage {
  type: 'celebration' | 'encouragement' | 'guidance' | 'win' | 'opportunity'
  metric?: string
  message: string
}

export interface Encouragement {
  messages: EncouragementMessage[]
  summary: string
  title?: string
}

export interface ProgressResponse {
  user_id: string
  progress_score: number
  progress_tier: ProgressTier
  tier_quote: string
  next_tier: string | null
  points_to_next: number
  score_components: ScoreComponents
  metrics: ProgressMetrics
  details: ProgressDetails
  benchmarks: {
    national: NationalBenchmark
    peer: PeerBenchmark
  }
  recent_milestones: Milestone[]
  streaks: Streak[]
  encouragement: Encouragement
  new_milestones?: Record<string, unknown>[]
}

export interface BenchmarkBracket {
  bracket_key: string
  age_bracket: string
  income_bracket: string
  values: Record<string, number>
  has_overrides: boolean
  defaults: Record<string, number>
}

export interface BenchmarkBracketsResponse {
  brackets: BenchmarkBracket[]
}

export interface MilestonesResponse {
  milestones: Milestone[]
  total: number
}

export interface StreaksResponse {
  streaks: Streak[]
  personal_bests: PersonalBest[]
}

export interface BenchmarksResponse {
  user_id: string
  national: NationalBenchmark
  peer: PeerBenchmark
}
