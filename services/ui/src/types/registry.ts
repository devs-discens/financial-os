export interface Institution {
  id: string
  name: string
  status: 'live' | 'pending' | 'not_registered'
  baseUrl: string
  fdxVersion: string
  capabilities: string[]
  mfaRequired?: boolean
  registeredAt: string | null
  goLiveAt: string | null
}
