import { fetchJSON } from './client'
import type { TwinSnapshot, MetricsResponse, TransactionsResponse } from '../types/twin'

export function getTwinSnapshot(userId: string) {
  return fetchJSON<TwinSnapshot>(`/twin/${userId}`)
}

export function getMetrics(userId: string) {
  return fetchJSON<MetricsResponse>(`/twin/${userId}/metrics`)
}

export function getTransactions(
  userId: string,
  params?: { account_id?: string; category?: string; start_date?: string; end_date?: string; limit?: number },
) {
  const qs = new URLSearchParams()
  if (params?.account_id) qs.set('account_id', params.account_id)
  if (params?.category) qs.set('category', params.category)
  if (params?.start_date) qs.set('start_date', params.start_date)
  if (params?.end_date) qs.set('end_date', params.end_date)
  if (params?.limit) qs.set('limit', String(params.limit))
  const query = qs.toString()
  return fetchJSON<TransactionsResponse>(`/twin/${userId}/transactions${query ? `?${query}` : ''}`)
}
