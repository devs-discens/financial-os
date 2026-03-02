export interface ThinkingStep {
  ts: string
  action: string
  detail: string
}

export interface CouncilMemberResponse {
  role: string
  provider: 'anthropic' | 'openai' | 'gemini'
  model: string
  content: string
  tokens: { input: number; output: number; total: number }
  elapsed_ms: number
  error?: boolean
}

export interface CollaborativeResponse {
  mode: 'collaborative'
  user_id: string
  question: string
  responses: CouncilMemberResponse[]
  synthesis: string
  chairman: CouncilMemberResponse
  pii_session_id: string
  elapsed_ms: number
  steps: ThinkingStep[]
  raw_context: string
  raw_question: string
  filtered_context: string
  filtered_question: string
  session_id?: number
  goal_id?: number | null
}

export interface AdversarialResponse {
  mode: 'adversarial'
  user_id: string
  question: string
  bull_case: CouncilMemberResponse
  bear_case: CouncilMemberResponse
  chairman_verdict: CouncilMemberResponse
  pii_session_id: string
  elapsed_ms: number
  steps: ThinkingStep[]
  raw_context: string
  raw_question: string
  filtered_context: string
  filtered_question: string
  session_id?: number
  goal_id?: number | null
}

export type CouncilResponse = CollaborativeResponse | AdversarialResponse

export interface CouncilSessionSummary {
  session_id: number
  mode: 'collaborative' | 'adversarial'
  question: string
  synthesis: string | null
  elapsed_ms: number | null
  goal_id?: number | null
  similarity?: number
  created_at: string
}

export interface CouncilSession extends CouncilSessionSummary {
  user_id: string
  response: CouncilResponse
}
