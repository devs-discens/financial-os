import { fetchJSON } from './client'
import type { ConnectResponse, MfaSubmitResponse, Connection } from '../types/connection'

export function connectInstitution(institutionId: string, userId: string) {
  return fetchJSON<ConnectResponse>('/onboarding/connect', {
    method: 'POST',
    body: JSON.stringify({ institution_id: institutionId, user_id: userId }),
  })
}

export function submitMfa(connectionId: number, mfaCode: string) {
  return fetchJSON<MfaSubmitResponse>('/onboarding/mfa', {
    method: 'POST',
    body: JSON.stringify({ connection_id: connectionId, mfa_code: mfaCode }),
  })
}

export function listConnections(userId: string) {
  return fetchJSON<{ connections: Connection[] }>(`/connections?user_id=${userId}`)
}
