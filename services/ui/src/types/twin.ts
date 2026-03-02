export interface TwinAccount {
  id: number
  connection_id: number
  account_id: string
  account_type: string
  account_category: 'DEPOSIT_ACCOUNT' | 'LOAN_ACCOUNT' | 'LOC_ACCOUNT'
  display_name: string
  masked_number: string
  currency: string
  balance: number
  balance_type: string
  valid_from: string
  institution_id: string
}

export interface TwinConnection {
  id: number
  institution_id: string
  institution_name: string
  status: 'active' | 'mfa_pending' | 'revoked'
  connected_at: string
  last_poll_at?: string
}

export interface Holding {
  id: number
  connection_id: number
  account_id: string
  symbol: string
  name: string
  asset_class: 'equity' | 'etf' | 'fixed_income' | 'crypto' | 'cash'
  quantity: number
  cost_basis: number
  market_value: number
  currency: string
  as_of: string
  institution_id: string
}

export interface InvestmentBreakdown {
  total_market_value: number
  total_cost_basis: number
  unrealized_gain: number
  by_asset_class: Record<string, number>
  by_account: Record<string, number>
}

export interface BalanceMetrics {
  net_worth: number
  total_assets: number
  total_liabilities: number
  asset_breakdown: Record<string, number>
  liability_breakdown: Record<string, number>
  investment_breakdown?: InvestmentBreakdown
}

export interface TwinSnapshot {
  user_id: string
  snapshot_at: string
  connections: TwinConnection[]
  accounts: TwinAccount[]
  holdings: Holding[]
  goals: Array<Record<string, unknown>>
  metrics: BalanceMetrics
  account_count: number
  institution_count: number
  transaction_count: number
}

export interface MetricEntry {
  metric_type: string
  metric_value: number
  computed_at: string
}

export interface CurrentMetric {
  value: number
  breakdown: Record<string, number>
  computed_at: string
}

export interface MetricsResponse {
  user_id: string
  current: Record<string, CurrentMetric>
  history: MetricEntry[]
}

export interface Transaction {
  id: number
  connection_id: number
  account_id: string
  transaction_id: string
  posted_date: string
  amount: number
  description: string
  category: string
  transaction_type: 'CREDIT' | 'DEBIT'
  pulled_at: string
  institution_id: string
}

export interface TransactionsResponse {
  transactions: Transaction[]
  count: number
}
