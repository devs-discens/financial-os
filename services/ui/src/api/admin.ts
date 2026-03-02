import { fetchJSON } from './client'
import type { User } from '../types/auth'
import type { BenchmarkBracketsResponse } from '../types/progress'

interface UserDetail {
  user: User
  connections: Array<Record<string, unknown>>
}

export function listUsers() {
  return fetchJSON<{ users: User[] }>('/admin/users')
}

export function getUserDetail(userId: string) {
  return fetchJSON<UserDetail>(`/admin/users/${userId}`)
}

export function listAllConnections() {
  return fetchJSON<{ connections: Array<Record<string, unknown>> }>('/admin/connections')
}

// ── Demo endpoints ──

export interface DemoBankStatus {
  institution_id: string
  consented_accounts: string[] | null
  status: string
  connected_at: string | null
}

export interface DemoUser {
  user_id: string
  persona: string
  banks: DemoBankStatus[]
}

export interface DemoSetupResult {
  users: Array<{
    user_id: string
    connections: Array<{
      institution_id: string
      status: string
      connection_id?: number
      accounts?: Array<Record<string, unknown>>
      error?: string
    }>
  }>
}

export function getDemoUsers() {
  return fetchJSON<{ users: DemoUser[] }>('/admin/demo/users')
}

export function setupDemo() {
  return fetchJSON<DemoSetupResult>('/admin/demo/setup', { method: 'POST' })
}

export function adminConnect(userId: string, institutionId: string, accountIds?: string[]) {
  return fetchJSON<Record<string, unknown>>('/admin/demo/connect', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      institution_id: institutionId,
      account_ids: accountIds ?? null,
    }),
  })
}

export function resetUser(userId: string) {
  return fetchJSON<{ status: string; user_id: string }>(`/admin/demo/reset-user/${userId}`, {
    method: 'POST',
  })
}

export function injectTransaction(params: {
  user_id: string
  institution_id: string
  account_id: string
  description: string
  amount: number
  transaction_type?: string
  category?: string
}) {
  return fetchJSON<Record<string, unknown>>('/admin/demo/inject-transaction', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

// ── Benchmark management ──

export function getBenchmarks() {
  return fetchJSON<BenchmarkBracketsResponse>('/admin/benchmarks')
}

export function setBenchmarkOverride(bracketKey: string, values: Record<string, number>) {
  return fetchJSON<{ bracket_key: string; overrides: Record<string, number> }>(
    '/admin/benchmarks',
    {
      method: 'PUT',
      body: JSON.stringify({ bracket_key: bracketKey, values }),
    },
  )
}

export function resetBenchmark(bracketKey: string) {
  return fetchJSON<{ reset: boolean }>(`/admin/benchmarks/${bracketKey}`, {
    method: 'DELETE',
  })
}

export function resetAllBenchmarks() {
  return fetchJSON<{ reset: boolean; count: number }>('/admin/benchmarks/reset-all', {
    method: 'POST',
  })
}
