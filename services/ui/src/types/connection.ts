export interface ConnectedAccount {
  account_id: string
  account_type: string
  account_category: 'DEPOSIT_ACCOUNT' | 'LOAN_ACCOUNT' | 'LOC_ACCOUNT'
  display_name: string
  masked_number: string
  currency: string
  balance: number
  balance_type: string
}

export interface ConnectResponseConnected {
  status: 'connected'
  connection_id: number
  institution_id: string
  institution_name: string
  template_cached: boolean
  discovery_elapsed_ms: number
  reasoning?: string | null
  accounts: ConnectedAccount[]
}

export interface ConnectResponseAlreadyConnected {
  status: 'already_connected'
  connection_id: number
  institution_id: string
  institution_name: string
  connected_at: string
  accounts: ConnectedAccount[]
}

export interface ConnectResponseMfa {
  status: 'mfa_required'
  connection_id: number
  mfa_session: string
  message: string
  template_cached: boolean
  discovery_elapsed_ms: number
}

export interface ConnectResponseNotAvailable {
  status: 'not_available'
  institution_id: string
  institution_status: 'pending' | 'not_registered'
  message: string
}

export type ConnectResponse =
  | ConnectResponseConnected
  | ConnectResponseAlreadyConnected
  | ConnectResponseMfa
  | ConnectResponseNotAvailable

export interface MfaSubmitResponse {
  status: 'connected'
  connection_id: number
  institution_id: string
  accounts: ConnectedAccount[]
}

export interface Connection {
  id: number
  user_id: string
  institution_id: string
  institution_name: string
  status: 'active' | 'mfa_pending' | 'revoked'
  connected_at: string
  last_poll_at?: string
}
