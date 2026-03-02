import { fetchJSON } from './client'
import type {
  CollaborativeResponse,
  AdversarialResponse,
  CouncilSessionSummary,
  CouncilSession,
} from '../types/council'

export function runCollaborative(userId: string, question: string, goalId?: number) {
  return fetchJSON<CollaborativeResponse>('/council/collaborative', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, question, goal_id: goalId }),
  })
}

export function runAdversarial(userId: string, question: string, goalId?: number) {
  return fetchJSON<AdversarialResponse>('/council/adversarial', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, question, goal_id: goalId }),
  })
}

export function checkSimilar(userId: string, question: string) {
  return fetchJSON<{ matches: CouncilSessionSummary[]; count: number }>(
    '/council/check-similar',
    {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, question }),
    },
  )
}

export function listSessions(userId: string, limit = 20) {
  return fetchJSON<{ sessions: CouncilSessionSummary[]; count: number }>(
    `/council/sessions?user_id=${userId}&limit=${limit}`,
  )
}

export function getSession(sessionId: number) {
  return fetchJSON<CouncilSession>(`/council/sessions/${sessionId}`)
}

export function archiveSession(sessionId: number) {
  return fetchJSON<{ status: string; session_id: number }>(`/council/sessions/${sessionId}`, {
    method: 'DELETE',
  })
}

export function linkSessionToGoal(sessionId: number, goalId: number) {
  return fetchJSON<{ status: string; session_id: number; goal_id: number }>(
    `/council/sessions/${sessionId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ goal_id: goalId }),
    },
  )
}
