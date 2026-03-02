import { Fragment, useState, useEffect, useCallback } from 'react'
import MetricCard from '../components/MetricCard'
import StatusBadge from '../components/StatusBadge'
import { formatCurrency } from '../components/FormatCurrency'
import Modal from '../components/Modal'
import EmptyState from '../components/EmptyState'
import LoadingSpinner from '../components/LoadingSpinner'
import { getTwinSnapshot, getMetrics, getTransactions } from '../api/twin'
import { getInstitutions } from '../api/registry'
import { connectInstitution, submitMfa } from '../api/onboarding'
import { useAuth } from '../contexts/AuthContext'
import type { User } from '../types/auth'
import type { TwinSnapshot, MetricsResponse, Transaction, Holding } from '../types/twin'
import type { Institution } from '../types/registry'

export default function TwinDashboard() {
  const { user } = useAuth()
  const USER_ID = user!.id
  const [twin, setTwin] = useState<TwinSnapshot | null>(null)
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [loading, setLoading] = useState(true)
  const [showConnect, setShowConnect] = useState(false)

  // Filters
  const [filterAccount, setFilterAccount] = useState('')
  const [filterCategory, setFilterCategory] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const [snap, met, txn, inst] = await Promise.all([
        getTwinSnapshot(USER_ID),
        getMetrics(USER_ID),
        getTransactions(USER_ID, { limit: 100 }),
        getInstitutions(),
      ])
      setTwin(snap)
      setMetrics(met)
      setTransactions(txn.transactions)
      setInstitutions(inst.institutions)
    } catch {
      // If twin doesn't exist yet, we still want institutions
      try {
        const inst = await getInstitutions()
        setInstitutions(inst.institutions)
      } catch { /* ignore */ }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <LoadingSpinner />

  const connectedIds = new Set(twin?.connections.map((c) => c.institution_id) ?? [])
  const liveInstitutions = institutions.filter((i) => i.status === 'live')

  const currentMetrics = metrics?.current ?? {}
  const netWorth = twin?.metrics.net_worth ?? 0
  const income = currentMetrics['monthly_income']?.value
  const expenses = currentMetrics['monthly_expenses']?.value
  const dti = currentMetrics['debt_to_income']?.value

  // Group accounts by institution
  const accountsByInstitution = new Map<string, TwinSnapshot['accounts']>()
  if (twin) {
    for (const acc of twin.accounts) {
      const key = acc.institution_id
      if (!accountsByInstitution.has(key)) accountsByInstitution.set(key, [])
      accountsByInstitution.get(key)!.push(acc)
    }
  }

  // Filtered transactions
  const filtered = transactions.filter((t) => {
    if (filterAccount && t.account_id !== filterAccount) return false
    if (filterCategory && !t.category.toLowerCase().includes(filterCategory.toLowerCase())) return false
    return true
  })

  // Unique accounts for filter dropdown
  const accountOptions = twin?.accounts.map((a) => ({ id: a.account_id, label: `${a.display_name} (${a.masked_number})` })) ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold">Financial Picture</h1>
          {twin && (
            <p className="mt-1 text-xs text-ws-muted">
              Last updated {new Date(twin.snapshot_at).toLocaleString()}
            </p>
          )}
        </div>
        <button
          onClick={() => setShowConnect(true)}
          className="rounded-lg bg-ws-accent px-4 py-2 text-sm font-semibold text-white hover:bg-ws-accent-dim transition-colors"
        >
          Link Financial Source
        </button>
      </div>

      {/* Profile Card */}
      {user?.profile?.age && <ProfileCard user={user} />}

      {/* Goals section hidden — dashboard is a financial snapshot, goals belong in a workflow context */}

      {!twin || twin.account_count === 0 ? (
        <EmptyState
          message="No financial sources linked yet"
          detail="Link a financial source to build your Financial Picture"
          action={{ label: 'Link Financial Source', onClick: () => setShowConnect(true) }}
        />
      ) : (
        <>
          {/* Metrics Row */}
          <div className="grid grid-cols-4 gap-4">
            <MetricCard label="Net Worth" value={formatCurrency(netWorth)} />
            <MetricCard label="Monthly Income" value={income != null ? formatCurrency(income) : '--'} />
            <MetricCard label="Monthly Expenses" value={expenses != null ? formatCurrency(expenses) : '--'} />
            <MetricCard label="Debt-to-Income Ratio" value={dti != null ? `${(dti * 100).toFixed(1)}%` : '--'} subtitle="How much of your income goes to debt payments" />
          </div>

          {/* Accounts by Institution */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold">Accounts</h2>
            {twin.connections.map((conn) => {
              const accs = accountsByInstitution.get(conn.institution_id) ?? []
              const isOnPlatform = conn.institution_id === 'wealthsimple'
              const connHoldings = (twin.holdings ?? []).filter(
                (h) => accs.some((a) => a.account_id === h.account_id)
              )
              // Group holdings by account
              const holdingsByAccount = new Map<string, Holding[]>()
              for (const h of connHoldings) {
                if (!holdingsByAccount.has(h.account_id)) holdingsByAccount.set(h.account_id, [])
                holdingsByAccount.get(h.account_id)!.push(h)
              }
              return (
                <div key={conn.id} className="rounded-xl bg-white border border-ws-border p-4 shadow-sm">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="font-semibold">{conn.institution_name}</span>
                    <StatusBadge status={conn.status} />
                    {isOnPlatform && (
                      <span className="rounded-full bg-ws-purple/10 text-ws-purple px-2 py-0.5 text-xs font-medium">
                        On Platform
                      </span>
                    )}
                    {conn.last_poll_at && !isOnPlatform && (
                      <span className="text-xs text-ws-muted ml-auto">
                        Polled {new Date(conn.last_poll_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {accs.map((acc) => {
                      const accHoldings = holdingsByAccount.get(acc.account_id) ?? []
                      return (
                        <div key={acc.account_id} className="rounded-lg bg-ws-bg border border-ws-border p-3">
                          <p className="text-sm font-semibold">{acc.display_name}</p>
                          <p className="text-xs text-ws-muted">{acc.account_type} &middot; {acc.masked_number}</p>
                          <p className={`mt-2 text-lg font-bold ${
                            acc.account_category === 'DEPOSIT_ACCOUNT' ? 'text-ws-green' : 'text-ws-red'
                          }`}>
                            {formatCurrency(Number(acc.balance))}
                          </p>
                          {accHoldings.length > 0 && (
                            <div className="mt-3 border-t border-ws-border/50 pt-2">
                              <p className="text-xs text-ws-muted font-semibold mb-1">Holdings</p>
                              {accHoldings.map((h) => {
                                const gain = h.market_value - h.cost_basis
                                return (
                                  <div key={h.symbol} className="flex items-center justify-between py-0.5 text-xs">
                                    <div className="flex items-center gap-1.5">
                                      <span className={`h-1.5 w-1.5 rounded-full ${
                                        h.asset_class === 'etf' ? 'bg-ws-blue'
                                        : h.asset_class === 'equity' ? 'bg-ws-green'
                                        : h.asset_class === 'crypto' ? 'bg-ws-orange'
                                        : h.asset_class === 'fixed_income' ? 'bg-ws-purple'
                                        : 'bg-ws-muted'
                                      }`} />
                                      <span className="font-semibold">{h.symbol}</span>
                                    </div>
                                    <div className="text-right">
                                      <span>{formatCurrency(h.market_value)}</span>
                                      <span className={`ml-1 ${gain >= 0 ? 'text-ws-green' : 'text-ws-red'}`}>
                                        {gain >= 0 ? '+' : ''}{formatCurrency(gain)}
                                      </span>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Asset/Liability Breakdown */}
          {(Object.keys(twin.metrics.asset_breakdown).length > 0 ||
            Object.keys(twin.metrics.liability_breakdown).length > 0) && (
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-white border border-ws-border p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-ws-muted mb-3">Asset Breakdown</h3>
                {Object.entries(twin.metrics.asset_breakdown).map(([key, val]) => (
                  <div key={key} className="flex justify-between py-1.5 text-sm">
                    <span className="text-ws-muted">{key}</span>
                    <span className="text-ws-green font-semibold">{formatCurrency(val)}</span>
                  </div>
                ))}
                <div className="mt-2 pt-2 border-t border-ws-border flex justify-between text-sm font-bold">
                  <span>Total Assets</span>
                  <span className="text-ws-green">{formatCurrency(twin.metrics.total_assets)}</span>
                </div>
              </div>
              <div className="rounded-xl bg-white border border-ws-border p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-ws-muted mb-3">Liability Breakdown</h3>
                {Object.entries(twin.metrics.liability_breakdown).map(([key, val]) => (
                  <div key={key} className="flex justify-between py-1.5 text-sm">
                    <span className="text-ws-muted">{key}</span>
                    <span className="text-ws-red font-semibold">{formatCurrency(val)}</span>
                  </div>
                ))}
                <div className="mt-2 pt-2 border-t border-ws-border flex justify-between text-sm font-bold">
                  <span>Total Liabilities</span>
                  <span className="text-ws-red">{formatCurrency(twin.metrics.total_liabilities)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Portfolio Allocation */}
          {twin.metrics.investment_breakdown && (
            <div className="rounded-xl bg-white border border-ws-border p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-ws-muted mb-3">Portfolio Allocation</h3>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <p className="text-xs text-ws-muted">Total Market Value</p>
                  <p className="text-lg font-bold text-ws-green">
                    {formatCurrency(twin.metrics.investment_breakdown.total_market_value)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ws-muted">Total Cost Basis</p>
                  <p className="text-lg font-bold">
                    {formatCurrency(twin.metrics.investment_breakdown.total_cost_basis)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ws-muted">Unrealized Gain/Loss</p>
                  <p className={`text-lg font-bold ${
                    twin.metrics.investment_breakdown.unrealized_gain >= 0 ? 'text-ws-green' : 'text-ws-red'
                  }`}>
                    {twin.metrics.investment_breakdown.unrealized_gain >= 0 ? '+' : ''}
                    {formatCurrency(twin.metrics.investment_breakdown.unrealized_gain)}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-ws-muted font-semibold">By Asset Class</p>
                {Object.entries(twin.metrics.investment_breakdown.by_asset_class).map(([cls, val]) => {
                  const pct = twin.metrics.investment_breakdown!.total_market_value > 0
                    ? (val / twin.metrics.investment_breakdown!.total_market_value * 100)
                    : 0
                  const colors: Record<string, string> = {
                    etf: 'bg-ws-blue', equity: 'bg-ws-green', crypto: 'bg-ws-orange',
                    fixed_income: 'bg-ws-purple', cash: 'bg-ws-muted',
                  }
                  return (
                    <div key={cls} className="flex items-center gap-3">
                      <div className={`h-2 w-2 rounded-full ${colors[cls] ?? 'bg-ws-muted'}`} />
                      <span className="text-sm w-28 capitalize">{cls.replace('_', ' ')}</span>
                      <div className="flex-1 h-2 rounded-full bg-ws-surface overflow-hidden">
                        <div
                          className={`h-full rounded-full ${colors[cls] ?? 'bg-ws-muted'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold w-24 text-right">{formatCurrency(val)}</span>
                      <span className="text-xs text-ws-muted w-12 text-right">{pct.toFixed(1)}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Transactions */}
          <TransactionsSection
            transactions={filtered}
            accounts={twin.accounts}
            accountOptions={accountOptions}
            filterAccount={filterAccount}
            setFilterAccount={setFilterAccount}
            filterCategory={filterCategory}
            setFilterCategory={setFilterCategory}
          />
        </>
      )}

      {/* Connect Bank Modal */}
      <LinkSourceModal
        isOpen={showConnect}
        onClose={() => setShowConnect(false)}
        institutions={liveInstitutions.filter((i) => !connectedIds.has(i.id))}
        onConnected={fetchData}
        userId={USER_ID}
      />
    </div>
  )
}

function ProfileCard({ user }: { user: User }) {
  const p = user.profile!
  return (
    <div className="rounded-xl bg-white border border-ws-border p-5 shadow-sm">
      <div className="flex items-start gap-5">
        {/* Avatar */}
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ws-accent text-lg font-bold text-white">
          {user.display_name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
        </div>

        {/* Info grid */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3">
            <h2 className="text-lg font-bold">{user.display_name}</h2>
            <span className="text-sm text-ws-muted">{p.age}yo</span>
          </div>
          <p className="text-sm text-ws-muted mt-0.5">{p.occupation} at {p.employer}</p>

          <div className="mt-3 grid grid-cols-4 gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-xs text-ws-muted uppercase tracking-wider">Location</span>
              <p className="font-semibold">{p.city}, {p.province}</p>
            </div>
            <div>
              <span className="text-xs text-ws-muted uppercase tracking-wider">Income</span>
              <p className="font-semibold">{formatCurrency(p.income)}/yr</p>
            </div>
            <div>
              <span className="text-xs text-ws-muted uppercase tracking-wider">Status</span>
              <p className="font-semibold">{p.relationship_status}</p>
            </div>
            <div>
              <span className="text-xs text-ws-muted uppercase tracking-wider">Housing</span>
              <p className="font-semibold">{p.housing_status}{p.dependents > 0 ? ` · ${p.dependents} dep.` : ''}</p>
            </div>
          </div>

          {/* Financial goal tags hidden — static profile aspirations not needed on snapshot view */}
        </div>
      </div>
    </div>
  )
}

/* GoalsSection hidden — dashboard is a financial snapshot, goals will move to a workflow context.
   Component preserved here for reuse when goals get a dedicated page. */

function TransactionsSection({
  transactions,
  accounts,
  accountOptions,
  filterAccount,
  setFilterAccount,
  filterCategory,
  setFilterCategory,
}: {
  transactions: Transaction[]
  accounts: TwinSnapshot['accounts']
  accountOptions: { id: string; label: string }[]
  filterAccount: string
  setFilterAccount: (v: string) => void
  filterCategory: string
  setFilterCategory: (v: string) => void
}) {
  const [expandedTxn, setExpandedTxn] = useState<number | null>(null)

  return (
    <div className="rounded-xl bg-white border border-ws-border p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Recent Transactions</h2>
        <div className="flex gap-3">
          <select
            value={filterAccount}
            onChange={(e) => setFilterAccount(e.target.value)}
            className="rounded-lg bg-ws-bg border border-ws-border px-3 py-1.5 text-sm text-ws-text focus:outline-none focus:border-ws-accent"
          >
            <option value="">All accounts</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Filter category..."
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="rounded-lg bg-ws-bg border border-ws-border px-3 py-1.5 text-sm text-ws-text placeholder-ws-muted w-40 focus:outline-none focus:border-ws-accent"
          />
        </div>
      </div>
      {transactions.length === 0 ? (
        <p className="text-sm text-ws-muted py-4 text-center">No transactions</p>
      ) : (
        <div className="divide-y divide-ws-border/50">
          {transactions.slice(0, 50).map((t) => {
            const acc = accounts.find((a) => a.account_id === t.account_id)
            const isExpanded = expandedTxn === t.id
            return (
              <Fragment key={t.id}>
                <button
                  onClick={() => setExpandedTxn(isExpanded ? null : t.id)}
                  className="w-full text-left py-2.5 flex items-center gap-4 hover:bg-ws-bg/50 transition-colors px-1"
                >
                  <span className="text-xs text-ws-muted whitespace-nowrap w-20">
                    {new Date(t.posted_date).toLocaleDateString()}
                  </span>
                  <span className="text-sm flex-1 truncate">{t.description}</span>
                  <span className={`text-sm font-semibold whitespace-nowrap ${
                    t.transaction_type === 'CREDIT' ? 'text-ws-green' : 'text-ws-red'
                  }`}>
                    {t.transaction_type === 'CREDIT' ? '+' : '-'}{formatCurrency(Math.abs(Number(t.amount)))}
                  </span>
                  <span className="text-xs text-ws-muted">{isExpanded ? '−' : '+'}</span>
                </button>
                {isExpanded && (
                  <div className="px-1 pb-3 pt-1 grid grid-cols-3 gap-x-6 gap-y-1 text-xs">
                    <div>
                      <span className="text-ws-muted">Category</span>
                      <p className="font-semibold">{t.category}</p>
                    </div>
                    <div>
                      <span className="text-ws-muted">Account</span>
                      <p className="font-semibold">{acc?.display_name ?? t.account_id}</p>
                    </div>
                    <div>
                      <span className="text-ws-muted">Type</span>
                      <p className="font-semibold">{t.transaction_type}</p>
                    </div>
                    {acc && (
                      <div>
                        <span className="text-ws-muted">Account Number</span>
                        <p className="font-semibold">{acc.masked_number}</p>
                      </div>
                    )}
                    <div>
                      <span className="text-ws-muted">Transaction ID</span>
                      <p className="font-mono font-semibold">{t.id}</p>
                    </div>
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}

function LinkSourceModal({
  isOpen,
  onClose,
  institutions,
  onConnected,
  userId,
}: {
  isOpen: boolean
  onClose: () => void
  institutions: Institution[]
  onConnected: () => void
  userId: string
}) {
  const [selected, setSelected] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [mfaState, setMfaState] = useState<{ connectionId: number; message: string } | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [error, setError] = useState('')

  const handleConnect = async () => {
    if (!selected) return
    setConnecting(true)
    setError('')
    try {
      const res = await connectInstitution(selected, userId)
      if (res.status === 'connected' || res.status === 'already_connected') {
        onConnected()
        handleClose()
      } else if (res.status === 'mfa_required') {
        setMfaState({ connectionId: res.connection_id, message: res.message })
      } else if (res.status === 'not_available') {
        setError(res.message)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setConnecting(false)
    }
  }

  const handleMfa = async () => {
    if (!mfaState || !mfaCode) return
    setConnecting(true)
    setError('')
    try {
      await submitMfa(mfaState.connectionId, mfaCode)
      onConnected()
      handleClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'MFA failed')
    } finally {
      setConnecting(false)
    }
  }

  const handleClose = () => {
    setSelected('')
    setMfaState(null)
    setMfaCode('')
    setError('')
    setConnecting(false)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Link Financial Source">
      {mfaState ? (
        <div className="space-y-4">
          <p className="text-sm text-ws-muted">{mfaState.message}</p>
          <input
            type="text"
            placeholder="Enter MFA code (hint: 123456)"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            className="w-full rounded-lg bg-ws-bg border border-ws-border px-3 py-2 text-sm text-ws-text placeholder-ws-muted focus:outline-none focus:border-ws-accent"
            autoFocus
          />
          <button
            onClick={handleMfa}
            disabled={connecting || !mfaCode}
            className="w-full rounded-lg bg-ws-accent px-4 py-2 text-sm font-semibold text-white hover:bg-ws-accent-dim transition-colors disabled:opacity-50"
          >
            {connecting ? 'Verifying...' : 'Submit Code'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {institutions.length === 0 ? (
            <p className="text-sm text-ws-muted">All available institutions are already connected.</p>
          ) : (
            <>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="w-full rounded-lg bg-ws-bg border border-ws-border px-3 py-2 text-sm text-ws-text focus:outline-none focus:border-ws-accent"
              >
                <option value="">Select an institution...</option>
                {institutions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} {i.mfaRequired ? '(MFA)' : ''}
                  </option>
                ))}
              </select>
              <button
                onClick={handleConnect}
                disabled={connecting || !selected}
                className="w-full rounded-lg bg-ws-accent px-4 py-2 text-sm font-semibold text-white hover:bg-ws-accent-dim transition-colors disabled:opacity-50"
              >
                {connecting ? 'Connecting...' : 'Connect'}
              </button>
            </>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-ws-red">{error}</p>}
    </Modal>
  )
}
