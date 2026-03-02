export interface Goal {
  id: number
  user_id: string
  raw_text: string
  summary_label: string
  goal_type: string
  target_amount: number | null
  target_date: string | null
  feasibility: 'green' | 'yellow' | 'red'
  feasibility_assessment: string
  cross_goal_impact: string[]
  progress_pct: number
  status: 'active' | 'paused' | 'achieved' | 'abandoned'
  created_at?: string
}

export interface AddGoalResponse {
  goal: Goal
  steps: Array<{ ts: string; action: string; detail: string }>
  elapsed_ms: number
}
