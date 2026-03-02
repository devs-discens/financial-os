import { fetchJSON } from './client'
import type { Goal, AddGoalResponse } from '../types/goals'
import type { GenerateDagResponse } from '../types/dag'

export function listGoals(userId: string) {
  return fetchJSON<{ goals: Goal[]; count: number }>(`/goals/${userId}`)
}

export function addGoal(userId: string, text: string) {
  return fetchJSON<AddGoalResponse>(`/goals/${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

export function updateGoal(userId: string, goalId: number, text: string) {
  return fetchJSON<AddGoalResponse>(`/goals/${userId}/${goalId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

export function deleteGoal(userId: string, goalId: number) {
  return fetchJSON<{ status: string; goal_id: number }>(`/goals/${userId}/${goalId}`, {
    method: 'DELETE',
  })
}

export function discussGoal(userId: string, goalId: number) {
  return fetchJSON<Record<string, unknown>>(`/goals/${userId}/${goalId}/discuss`, {
    method: 'POST',
  })
}

export function generateGoalPlan(userId: string, goalId: number) {
  return fetchJSON<GenerateDagResponse>(`/goals/${userId}/${goalId}/plan`, {
    method: 'POST',
  })
}

export interface SimilarGoalMatch {
  id: number
  summary_label: string
  goal_type: string
  feasibility: string
  raw_text: string
  progress_pct: number
  similarity: number
  created_at: string
}

export function checkSimilarGoal(userId: string, text: string, threshold = 0.80) {
  return fetchJSON<{ matches: SimilarGoalMatch[]; count: number }>(`/goals/${userId}/check-similar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, threshold }),
  })
}
