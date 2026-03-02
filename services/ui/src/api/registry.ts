import { fetchJSON } from './client'
import type { Institution } from '../types/registry'

export function getInstitutions() {
  return fetchJSON<{ institutions: Institution[]; total: number }>('/registry/institutions')
}

export function registerInstitution(id: string) {
  return fetchJSON<Institution>(`/registry/institutions/${id}/register`, { method: 'POST' })
}

export function goLiveInstitution(id: string) {
  return fetchJSON<Institution>(`/registry/institutions/${id}/go-live`, { method: 'POST' })
}

