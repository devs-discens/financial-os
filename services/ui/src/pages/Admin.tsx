import { Fragment, useState, useEffect, useCallback } from 'react'
import { Outlet } from 'react-router-dom'
import StatusBadge from '../components/StatusBadge'
import { EventTypeBadge } from '../components/StatusBadge'
import LoadingSpinner from '../components/LoadingSpinner'
import { getInstitutions, registerInstitution, goLiveInstitution } from '../api/registry'
import {
  listUsers, getUserDetail,
  getDemoUsers, setupDemo, resetUser, injectTransaction,
  getBenchmarks, setBenchmarkOverride, resetBenchmark, resetAllBenchmarks,
} from '../api/admin'
import {
  getBackgroundStatus, getAnomalies, getBackgroundConnections,
  getBackgroundEvents, triggerUserPoll,
} from '../api/background'
import type { BackgroundStatus, Anomaly, BackgroundEvent } from '../types/background'
import type { BackgroundConnection, BackgroundUserConnections } from '../api/background'
import type { Institution } from '../types/registry'
import type { User } from '../types/auth'
import type { DemoUser, DemoSetupResult } from '../api/admin'
import type { BenchmarkBracket } from '../types/progress'

export default function Admin() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold">Admin Panel</h1>
      <Outlet />
    </div>
  )
}

export function RegistryTab() {
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchInstitutions = useCallback(async () => {
    try {
      const res = await getInstitutions()
      setInstitutions(res.institutions)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchInstitutions() }, [fetchInstitutions])

  const handleRegister = async (id: string) => {
    setActionLoading(id)
    try {
      await registerInstitution(id)
      await fetchInstitutions()
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const handleGoLive = async (id: string) => {
    setActionLoading(id)
    try {
      await goLiveInstitution(id)
      await fetchInstitutions()
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-3">
      {institutions.map((inst) => (
        <div key={inst.id} className="rounded-xl bg-white border border-ws-border p-4 flex items-center gap-4 shadow-sm">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <span className="font-semibold">{inst.name}</span>
              <StatusBadge status={inst.status} />
            </div>
            <p className="text-xs text-ws-muted mt-1">
              {inst.id} &middot; {inst.baseUrl}
              {inst.mfaRequired && ' &middot; MFA required'}
            </p>
          </div>
          <div className="flex gap-2">
            {inst.status === 'not_registered' && (
              <button
                onClick={() => handleRegister(inst.id)}
                disabled={actionLoading === inst.id}
                className="rounded-lg bg-ws-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-ws-accent-dim transition-colors disabled:opacity-50"
              >
                {actionLoading === inst.id ? 'Registering...' : 'Register'}
              </button>
            )}
            {inst.status === 'pending' && (
              <button
                onClick={() => handleGoLive(inst.id)}
                disabled={actionLoading === inst.id}
                className="rounded-lg bg-ws-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-ws-green/80 transition-colors disabled:opacity-50"
              >
                {actionLoading === inst.id ? 'Going live...' : 'Go Live'}
              </button>
            )}
            {inst.status === 'live' && (
              <span className="text-xs text-ws-green font-semibold px-3 py-1.5">Active</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function UsersTab() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [userConnections, setUserConnections] = useState<Array<Record<string, unknown>>>([])
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    listUsers()
      .then((res) => setUsers(res.users))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const toggleUser = async (userId: string) => {
    if (expandedUser === userId) {
      setExpandedUser(null)
      return
    }
    setExpandedUser(userId)
    setDetailLoading(true)
    try {
      const res = await getUserDetail(userId)
      setUserConnections(res.connections)
    } catch {
      setUserConnections([])
    } finally {
      setDetailLoading(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-3">
      {users.map((u) => (
        <div key={u.id} className="rounded-xl bg-white border border-ws-border overflow-hidden shadow-sm">
          <button
            onClick={() => toggleUser(u.id)}
            className="w-full text-left p-4 flex items-center gap-4 hover:bg-ws-bg transition-colors"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ws-accent text-xs font-bold text-white shrink-0">
              {u.display_name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{u.display_name}</span>
                <StatusBadge status={u.role} />
              </div>
              <p className="text-xs text-ws-muted">{u.username}</p>
            </div>
            <span className="text-xs text-ws-muted">
              {expandedUser === u.id ? 'collapse' : 'expand'}
            </span>
          </button>

          {expandedUser === u.id && (
            <div className="border-t border-ws-border px-4 py-3">
              {detailLoading ? (
                <p className="text-xs text-ws-muted">Loading connections...</p>
              ) : userConnections.length === 0 ? (
                <p className="text-xs text-ws-muted">No connections</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-ws-muted font-semibold">{userConnections.length} connection(s)</p>
                  {userConnections.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span>{String(c.institution_name)}</span>
                      <StatusBadge status={String(c.status)} />
                      {c.connected_at != null && (
                        <span className="text-xs text-ws-muted ml-auto">
                          {new Date(String(c.connected_at)).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function DemoTab() {
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([])
  const [loading, setLoading] = useState(true)
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupResult, setSetupResult] = useState<DemoSetupResult | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [injectForm, setInjectForm] = useState<{
    userId: string; institutionId: string; accountId: string
  } | null>(null)
  const [injectFields, setInjectFields] = useState({
    description: '', amount: '', type: 'DEBIT', category: '',
  })

  const fetchDemoUsers = useCallback(async () => {
    try {
      const res = await getDemoUsers()
      setDemoUsers(res.users)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchDemoUsers() }, [fetchDemoUsers])

  const handleSetup = async () => {
    setSetupLoading(true)
    setSetupResult(null)
    try {
      const res = await setupDemo()
      setSetupResult(res)
      await fetchDemoUsers()
    } catch { /* ignore */ }
    finally { setSetupLoading(false) }
  }

  const handleReset = async (userId: string) => {
    setActionLoading(`reset-${userId}`)
    try {
      await resetUser(userId)
      await fetchDemoUsers()
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const handleInject = async () => {
    if (!injectForm) return
    setActionLoading(`inject-${injectForm.accountId}`)
    try {
      await injectTransaction({
        user_id: injectForm.userId,
        institution_id: injectForm.institutionId,
        account_id: injectForm.accountId,
        description: injectFields.description,
        amount: parseFloat(injectFields.amount),
        transaction_type: injectFields.type,
        category: injectFields.category || undefined,
      })
      setInjectForm(null)
      setInjectFields({ description: '', amount: '', type: 'DEBIT', category: '' })
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-4">
      {/* Setup button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSetup}
          disabled={setupLoading}
          className="rounded-lg bg-ws-accent px-4 py-2 text-sm font-semibold text-white hover:bg-ws-accent-dim transition-colors disabled:opacity-50"
        >
          {setupLoading ? 'Setting up...' : 'Setup Demo'}
        </button>
        <span className="text-xs text-ws-muted">
          Connect all seed users to their designated banks
        </span>
      </div>

      {/* Setup result */}
      {setupResult && (
        <div className="rounded-xl bg-ws-bg border border-ws-border p-4 text-sm">
          <p className="font-semibold mb-2">Setup Result</p>
          {setupResult.users.map((u) => (
            <div key={u.user_id} className="mb-1">
              <span className="font-mono text-xs">{u.user_id}</span>
              {u.connections.map((c, i) => (
                <span key={i} className="ml-2">
                  <StatusBadge status={c.status} />
                  <span className="text-xs text-ws-muted ml-1">{c.institution_id}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Inject form modal */}
      {injectForm && (
        <div className="rounded-xl bg-ws-bg border border-ws-accent/30 p-4 space-y-3">
          <p className="font-semibold text-sm">
            Inject Transaction &mdash; {injectForm.accountId}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Description"
              value={injectFields.description}
              onChange={(e) => setInjectFields({ ...injectFields, description: e.target.value })}
              className="col-span-2 rounded bg-white border border-ws-border px-3 py-1.5 text-sm focus:outline-none focus:border-ws-accent"
            />
            <input
              placeholder="Amount"
              type="number"
              step="0.01"
              value={injectFields.amount}
              onChange={(e) => setInjectFields({ ...injectFields, amount: e.target.value })}
              className="rounded bg-white border border-ws-border px-3 py-1.5 text-sm focus:outline-none focus:border-ws-accent"
            />
            <select
              value={injectFields.type}
              onChange={(e) => setInjectFields({ ...injectFields, type: e.target.value })}
              className="rounded bg-white border border-ws-border px-3 py-1.5 text-sm focus:outline-none focus:border-ws-accent"
            >
              <option value="DEBIT">DEBIT</option>
              <option value="CREDIT">CREDIT</option>
            </select>
            <input
              placeholder="Category (optional)"
              value={injectFields.category}
              onChange={(e) => setInjectFields({ ...injectFields, category: e.target.value })}
              className="rounded bg-white border border-ws-border px-3 py-1.5 text-sm focus:outline-none focus:border-ws-accent"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleInject}
              disabled={!injectFields.description || !injectFields.amount || actionLoading !== null}
              className="rounded-lg bg-ws-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-ws-accent-dim transition-colors disabled:opacity-50"
            >
              Inject
            </button>
            <button
              onClick={() => setInjectForm(null)}
              className="rounded-lg bg-white border border-ws-border px-3 py-1.5 text-xs text-ws-muted hover:text-ws-text transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* User cards */}
      {demoUsers.map((u) => (
        <div key={u.user_id} className="rounded-xl bg-white border border-ws-border overflow-hidden shadow-sm">
          <button
            onClick={() => setExpandedUser(expandedUser === u.user_id ? null : u.user_id)}
            className="w-full text-left p-4 flex items-center gap-4 hover:bg-ws-bg transition-colors"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ws-accent text-xs font-bold text-white shrink-0">
              {u.user_id.split('-').map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{u.user_id}</span>
                {u.banks.every((b) => b.status === 'active') && u.banks.length > 0 ? (
                  <StatusBadge status="active" />
                ) : u.banks.some((b) => b.status === 'active') ? (
                  <StatusBadge status="partial" />
                ) : (
                  <StatusBadge status="not_connected" />
                )}
              </div>
              <p className="text-xs text-ws-muted truncate">{u.persona}</p>
            </div>
            <div className="flex gap-1">
              {u.banks.map((b) => (
                <span
                  key={b.institution_id}
                  className={`w-2 h-2 rounded-full ${
                    b.status === 'active' ? 'bg-ws-green' : 'bg-ws-border'
                  }`}
                  title={`${b.institution_id}: ${b.status}`}
                />
              ))}
            </div>
          </button>

          {expandedUser === u.user_id && (
            <div className="border-t border-ws-border px-4 py-3 space-y-3">
              {/* Bank connections */}
              {u.banks.map((b) => (
                <div key={b.institution_id} className="flex items-center gap-3 text-sm">
                  <span className="font-mono text-xs w-40 truncate">{b.institution_id}</span>
                  <StatusBadge status={b.status} />
                  {b.consented_accounts && (
                    <span className="text-xs text-ws-muted">
                      {b.consented_accounts.length} account(s) consented
                    </span>
                  )}
                  {!b.consented_accounts && b.status === 'active' && (
                    <span className="text-xs text-ws-muted">all accounts</span>
                  )}
                  {b.connected_at && (
                    <span className="text-xs text-ws-muted ml-auto">
                      {new Date(b.connected_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              ))}

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t border-ws-border/50">
                <button
                  onClick={() => handleReset(u.user_id)}
                  disabled={actionLoading === `reset-${u.user_id}`}
                  className="rounded-lg bg-ws-red/10 text-ws-red px-3 py-1.5 text-xs font-semibold hover:bg-ws-red/20 transition-colors disabled:opacity-50"
                >
                  {actionLoading === `reset-${u.user_id}` ? 'Resetting...' : 'Reset User'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const BENCHMARK_FIELDS = [
  { key: 'median_savings_rate', label: 'Savings Rate', format: 'pct' },
  { key: 'median_emergency_fund_months', label: 'Emergency Fund (mo)', format: 'num' },
  { key: 'median_dti_ratio', label: 'DTI Ratio', format: 'pct' },
  { key: 'median_net_worth', label: 'Net Worth ($)', format: 'dollar' },
  { key: 'median_credit_utilization', label: 'Credit Utilization', format: 'pct' },
  { key: 'homeownership_rate', label: 'Homeownership Rate', format: 'pct' },
]

export function BenchmarksTab() {
  const [brackets, setBrackets] = useState<BenchmarkBracket[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [resettingAll, setResettingAll] = useState(false)

  const fetchBenchmarks = useCallback(async () => {
    try {
      const res = await getBenchmarks()
      setBrackets(res.brackets)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchBenchmarks() }, [fetchBenchmarks])

  const startEdit = (b: BenchmarkBracket) => {
    setEditing(b.bracket_key)
    const vals: Record<string, string> = {}
    for (const f of BENCHMARK_FIELDS) {
      vals[f.key] = String(b.values[f.key] ?? '')
    }
    setEditValues(vals)
  }

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const values: Record<string, number> = {}
      for (const f of BENCHMARK_FIELDS) {
        const v = parseFloat(editValues[f.key])
        if (!isNaN(v)) values[f.key] = v
      }
      await setBenchmarkOverride(editing, values)
      setEditing(null)
      await fetchBenchmarks()
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  const handleReset = async (bracketKey: string) => {
    try {
      await resetBenchmark(bracketKey)
      await fetchBenchmarks()
    } catch { /* ignore */ }
  }

  const handleResetAll = async () => {
    setResettingAll(true)
    try {
      await resetAllBenchmarks()
      await fetchBenchmarks()
    } catch { /* ignore */ }
    finally { setResettingAll(false) }
  }

  if (loading) return <LoadingSpinner />

  const overrideCount = brackets.filter((b) => b.has_overrides).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-ws-muted">
            {brackets.length} brackets &middot; {overrideCount} with overrides
          </p>
        </div>
        <button
          onClick={handleResetAll}
          disabled={resettingAll || overrideCount === 0}
          className="rounded-lg bg-ws-red/10 text-ws-red px-3 py-1.5 text-xs font-semibold hover:bg-ws-red/20 transition-colors disabled:opacity-50"
        >
          {resettingAll ? 'Resetting...' : 'Reset All to Defaults'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white border border-ws-border shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ws-border text-left text-xs text-ws-muted uppercase tracking-wider">
              <th className="px-4 py-3 pr-3">Bracket</th>
              {BENCHMARK_FIELDS.map((f) => (
                <th key={f.key} className="px-3 py-3 text-right">{f.label}</th>
              ))}
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {brackets.map((b) => (
              <tr
                key={b.bracket_key}
                className={`border-b border-ws-border/50 ${b.has_overrides ? 'bg-ws-accent/5' : ''}`}
              >
                <td className="px-4 py-2 pr-3 whitespace-nowrap">
                  <span className="font-mono text-xs">{b.age_bracket}</span>
                  <span className="text-ws-muted mx-1">/</span>
                  <span className="font-mono text-xs">{b.income_bracket}</span>
                  {b.has_overrides && (
                    <span className="ml-2 text-xs text-ws-accent font-semibold">modified</span>
                  )}
                </td>

                {editing === b.bracket_key ? (
                  <>
                    {BENCHMARK_FIELDS.map((f) => (
                      <td key={f.key} className="px-3 py-2">
                        <input
                          type="number"
                          step={f.format === 'dollar' ? '1000' : '0.01'}
                          value={editValues[f.key]}
                          onChange={(e) => setEditValues({ ...editValues, [f.key]: e.target.value })}
                          className="w-full rounded bg-ws-bg border border-ws-border px-2 py-1 text-xs text-right focus:outline-none focus:border-ws-accent"
                        />
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="rounded bg-ws-accent px-2 py-1 text-xs font-semibold text-white hover:bg-ws-accent-dim mr-1 disabled:opacity-50"
                      >
                        {saving ? '...' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="rounded bg-white border border-ws-border px-2 py-1 text-xs text-ws-muted hover:text-ws-text"
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    {BENCHMARK_FIELDS.map((f) => {
                      const val = b.values[f.key]
                      const isOverridden = b.has_overrides && b.defaults[f.key] !== val
                      return (
                        <td key={f.key} className={`px-3 py-2 text-right font-mono text-xs ${isOverridden ? 'text-ws-accent font-bold' : 'text-ws-muted'}`}>
                          {f.format === 'pct' ? `${(val * 100).toFixed(1)}%`
                            : f.format === 'dollar' ? `$${val.toLocaleString()}`
                            : val.toFixed(1)}
                        </td>
                      )
                    })}
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => startEdit(b)}
                        className="rounded bg-ws-surface border border-ws-border px-2 py-1 text-xs text-ws-muted hover:text-ws-text mr-1"
                      >
                        Edit
                      </button>
                      {b.has_overrides && (
                        <button
                          onClick={() => handleReset(b.bracket_key)}
                          className="rounded bg-ws-red/10 text-ws-red px-2 py-1 text-xs hover:bg-ws-red/20"
                        >
                          Reset
                        </button>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EventDetails({ event }: { event: BackgroundEvent }) {
  const d = event.details
  switch (event.event_type) {
    case 'background_poll_success':
      return (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          {d.accounts_updated != null && <><span className="text-ws-muted">Accounts Updated</span><span>{String(d.accounts_updated)}</span></>}
          {d.transactions_pulled != null && <><span className="text-ws-muted">Transactions Pulled</span><span>{String(d.transactions_pulled)}</span></>}
          {d.metrics_computed != null && <><span className="text-ws-muted">Metrics Computed</span><span>{d.metrics_computed ? 'Yes' : 'No'}</span></>}
          {d.duration_ms != null && <><span className="text-ws-muted">Duration</span><span>{Number(d.duration_ms).toFixed(0)}ms</span></>}
        </div>
      )
    case 'background_poll_failed':
      return (
        <div className="text-xs">
          {d.error ? <p className="text-ws-red">{String(d.error)}</p> : null}
          {d.status_code ? <p className="text-ws-muted mt-1">Status: {String(d.status_code)}</p> : null}
        </div>
      )
    case 'anomaly_detected':
      return (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          {d.account_id ? <><span className="text-ws-muted">Account</span><span className="font-mono">{String(d.account_id)}</span></> : null}
          {d.pct_change != null ? <><span className="text-ws-muted">Change</span><span className="text-ws-orange font-semibold">{(Number(d.pct_change) * 100).toFixed(1)}%</span></> : null}
          {d.detail ? <><span className="text-ws-muted">Detail</span><span>{String(d.detail)}</span></> : null}
        </div>
      )
    case 'token_refreshed':
      return (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          {d.new_expires_at ? <><span className="text-ws-muted">New Expiry</span><span>{new Date(String(d.new_expires_at)).toLocaleString()}</span></> : null}
        </div>
      )
    case 'token_refresh_failed_401':
    case 'consent_revoked':
      return (
        <div className="text-xs">
          {d.error ? <p className="text-ws-red">{String(d.error)}</p> : null}
          {d.detail ? <p className="text-ws-muted">{String(d.detail)}</p> : null}
        </div>
      )
    case 'milestone_achieved':
      return (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          {d.milestone_type ? <><span className="text-ws-muted">Type</span><span>{String(d.milestone_type)}</span></> : null}
          {d.description ? <><span className="text-ws-muted">Description</span><span>{String(d.description)}</span></> : null}
        </div>
      )
    default: {
      const entries = Object.entries(d)
      if (entries.length === 0) return <p className="text-xs text-ws-muted">No details</p>
      return (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          {entries.map(([k, v]) => (
            <Fragment key={k}>
              <span className="text-ws-muted">{k.replace(/_/g, ' ')}</span>
              <span className="font-mono truncate">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
            </Fragment>
          ))}
        </div>
      )
    }
  }
}

const FAILED_EVENTS = new Set([
  'background_poll_failed', 'consent_revoked',
])
const PARTIAL_EVENTS = new Set([
  'anomaly_detected', 'token_refresh_failed_401',
])

type ConnectionHealth = 'successful' | 'partial' | 'failed'

function classifyConnection(c: BackgroundConnection): ConnectionHealth {
  if (!c.latest_event) return 'successful'
  if (FAILED_EVENTS.has(c.latest_event.event_type)) return 'failed'
  if (PARTIAL_EVENTS.has(c.latest_event.event_type)) return 'partial'
  if (!c.token_healthy) return 'partial'
  return 'successful'
}

const HEALTH_CONFIG: Record<ConnectionHealth, { label: string; bg: string; border: string; text: string; dot: string }> = {
  successful: { label: 'Successful', bg: 'bg-ws-green/5', border: 'border-ws-green/20', text: 'text-ws-green', dot: 'bg-ws-green' },
  partial:    { label: 'Partially Failed', bg: 'bg-ws-orange/5', border: 'border-ws-orange/20', text: 'text-ws-orange', dot: 'bg-ws-orange' },
  failed:     { label: 'Failed', bg: 'bg-ws-red/5', border: 'border-ws-red/20', text: 'text-ws-red', dot: 'bg-ws-red' },
}

function UserConnectionCard({ user, onRefresh }: { user: BackgroundUserConnections; onRefresh: () => Promise<void> }) {
  const [expandedGroup, setExpandedGroup] = useState<ConnectionHealth | null>(null)
  const [connectionEvents, setConnectionEvents] = useState<Record<string, BackgroundEvent[]>>({})
  const [expandedConnection, setExpandedConnection] = useState<number | null>(null)
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null)
  const [eventsLoading, setEventsLoading] = useState<number | null>(null)
  const [triggering, setTriggering] = useState(false)
  const [pollResult, setPollResult] = useState<{ polled: number; at: Date } | null>(null)

  const pollable = user.connections.filter((c) => !c.is_on_platform)

  const groups: Record<ConnectionHealth, BackgroundConnection[]> = { successful: [], partial: [], failed: [] }
  for (const c of pollable) {
    groups[classifyConnection(c)].push(c)
  }

  const toggleGroup = (g: ConnectionHealth) => {
    setExpandedGroup(expandedGroup === g ? null : g)
    setExpandedConnection(null)
  }

  const toggleConnection = async (c: BackgroundConnection) => {
    if (expandedConnection === c.connection_id) {
      setExpandedConnection(null)
      return
    }
    setExpandedConnection(c.connection_id)
    if (!connectionEvents[c.institution_id]) {
      setEventsLoading(c.connection_id)
      try {
        const res = await getBackgroundEvents({ limit: 20, institution_id: c.institution_id })
        setConnectionEvents((prev) => ({ ...prev, [c.institution_id]: res.events }))
      } catch { /* ignore */ }
      finally { setEventsLoading(null) }
    }
  }

  const handleTrigger = async () => {
    setTriggering(true)
    setPollResult(null)
    try {
      const result = await triggerUserPoll(user.user_id)
      setPollResult({ polled: result.polled ?? 0, at: new Date() })
      setConnectionEvents({})
      await onRefresh()
    } catch { /* ignore */ }
    finally { setTriggering(false) }
  }

  // Determine card border color based on worst status
  const hasFailures = groups.failed.length > 0
  const hasPartial = groups.partial.length > 0
  const cardBorder = hasFailures ? 'border-ws-red/40' : hasPartial ? 'border-ws-orange/40' : 'border-ws-border'

  const latestPollAt = pollable.reduce<string | null>((latest, c) => {
    if (!c.last_poll_at) return latest
    if (!latest) return c.last_poll_at
    return c.last_poll_at > latest ? c.last_poll_at : latest
  }, null)

  const displayTime = pollResult
    ? pollResult.at.toLocaleTimeString()
    : latestPollAt
      ? new Date(latestPollAt).toLocaleTimeString()
      : null

  return (
    <div className={`rounded-xl bg-white border ${cardBorder} overflow-hidden shadow-sm`}>
      <div className="px-4 py-3 bg-ws-bg border-b border-ws-border flex items-center gap-3">
        <span className="font-semibold text-sm">{user.user_id}</span>
        <div className="flex items-center gap-2 ml-auto">
          {(['successful', 'partial', 'failed'] as const).map((g) => {
            if (groups[g].length === 0) return null
            const cfg = HEALTH_CONFIG[g]
            return (
              <span key={g} className={`flex items-center gap-1.5 text-xs font-medium ${cfg.text}`}>
                <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                {groups[g].length} {cfg.label}
              </span>
            )
          })}
          {displayTime && (
            <span className={`text-xs ${pollResult ? 'font-semibold text-ws-green' : 'text-ws-muted'}`}>
              {displayTime}
            </span>
          )}
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="rounded-lg bg-ws-accent px-3 py-1 text-xs font-semibold text-white hover:bg-ws-accent-dim transition-colors disabled:opacity-50"
          >
            {triggering ? 'Polling...' : 'Poll'}
          </button>
        </div>
      </div>

      <div className="divide-y divide-ws-border/50">
        {(['successful', 'partial', 'failed'] as const).map((g) => {
          if (groups[g].length === 0) return null
          const cfg = HEALTH_CONFIG[g]
          const isExpanded = expandedGroup === g
          return (
            <div key={g}>
              <button
                onClick={() => toggleGroup(g)}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors hover:bg-ws-bg/50 ${isExpanded ? cfg.bg : ''}`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`} />
                <span className={`text-sm font-semibold ${cfg.text}`}>{cfg.label}</span>
                <span className={`text-xs ${cfg.text}`}>{groups[g].length}</span>
                <span className="text-xs text-ws-muted ml-auto">{isExpanded ? '−' : '+'}</span>
              </button>
              {isExpanded && (
                <div className={`${cfg.bg} border-t ${cfg.border}`}>
                  {groups[g].map((c) => (
                    <div key={c.connection_id} className={`border-b ${cfg.border} last:border-b-0`}>
                      <button
                        onClick={() => toggleConnection(c)}
                        className="w-full text-left px-6 py-2.5 flex items-center gap-3 hover:bg-white/40 transition-colors"
                      >
                        <span className="font-semibold text-sm w-40 truncate">{c.institution_name}</span>
                        <StatusBadge status={c.status} />
                        <div className={`h-2 w-2 rounded-full ${c.token_healthy ? 'bg-ws-green' : 'bg-ws-red'}`} title={c.token_healthy ? 'Token healthy' : 'Token expired'} />
                        <span className="text-xs text-ws-muted ml-auto whitespace-nowrap">
                          {c.last_poll_at ? `Polled ${new Date(c.last_poll_at).toLocaleString()}` : 'Never polled'}
                        </span>
                        {c.latest_event && (
                          <EventTypeBadge eventType={c.latest_event.event_type} />
                        )}
                        <span className="text-xs text-ws-muted">{expandedConnection === c.connection_id ? '−' : '+'}</span>
                      </button>
                      {expandedConnection === c.connection_id && (
                        <div className="px-6 py-3 bg-white/60">
                          {eventsLoading === c.connection_id ? (
                            <p className="text-xs text-ws-muted">Loading events...</p>
                          ) : (connectionEvents[c.institution_id] ?? []).length === 0 ? (
                            <p className="text-xs text-ws-muted">No recent events</p>
                          ) : (
                            <div className="space-y-1">
                              <p className="text-xs text-ws-muted font-semibold mb-2">Recent Events</p>
                              {(connectionEvents[c.institution_id] ?? []).map((ev) => (
                                <div key={ev.id} className="rounded-lg bg-ws-bg/50 overflow-hidden">
                                  <button
                                    onClick={() => setExpandedEvent(expandedEvent === ev.id ? null : ev.id)}
                                    className="w-full text-left px-2.5 py-2 flex items-center gap-2 hover:bg-ws-bg transition-colors"
                                  >
                                    <EventTypeBadge eventType={ev.event_type} />
                                    <span className="text-xs text-ws-muted ml-auto">
                                      {new Date(ev.created_at).toLocaleString()}
                                    </span>
                                    <span className="text-xs text-ws-muted">{expandedEvent === ev.id ? '−' : '+'}</span>
                                  </button>
                                  {expandedEvent === ev.id && (
                                    <div className="px-2.5 pb-2.5 pt-1 border-t border-ws-border/30">
                                      <EventDetails event={ev} />
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

      </div>
    </div>
  )
}

export function BackgroundTab() {
  const [status, setStatus] = useState<BackgroundStatus | null>(null)
  const [anomalies, setAnomalies] = useState<Anomaly[]>([])
  const [users, setUsers] = useState<BackgroundUserConnections[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const [s, a, c] = await Promise.allSettled([
      getBackgroundStatus(),
      getAnomalies(100),
      getBackgroundConnections(),
    ])
    if (s.status === 'fulfilled') setStatus(s.value)
    if (a.status === 'fulfilled') setAnomalies(a.value.anomalies)
    if (c.status === 'fulfilled') setUsers(c.value.users)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <LoadingSpinner />

  const statusDot = status
    ? status.running
      ? 'bg-ws-green'
      : status.background_enabled
        ? 'bg-ws-yellow'
        : 'bg-ws-muted'
    : 'bg-ws-muted'

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="rounded-xl bg-white border border-ws-border p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${statusDot}`} />
          <div>
            <p className="text-sm font-semibold">
              {status ? (status.running ? 'Background Active' : 'Background Idle') : 'Connecting...'}
            </p>
            {status && (
              <p className="text-xs text-ws-muted">
                Cycle #{status.cycle_count}
                {status.last_cycle_ms != null && status.last_cycle_ms > 0 && ` (${(status.last_cycle_ms / 1000).toFixed(1)}s)`}
                {status.last_cycle_at && ` · Last: ${new Date(status.last_cycle_at).toLocaleString()}`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Anomalies */}
      {anomalies.length > 0 && (
        <div className="rounded-xl bg-ws-red/5 border border-ws-red/20 p-4">
          <h3 className="text-sm font-semibold text-ws-red mb-2">{anomalies.length} Anomalies Detected</h3>
          <div className="space-y-2">
            {anomalies.slice(0, 5).map((a) => (
              <div key={a.id} className="text-xs text-ws-muted">
                <span className="font-mono">{a.institution_id}</span>
                {' · '}
                {a.details?.detail || a.details?.account_id || 'Balance anomaly'}
                {' · '}
                <span>{new Date(a.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-user connections with health grouping (only users with external connections) */}
      {users
        .filter((u) => u.connections.some((c) => !c.is_on_platform))
        .map((u) => (
          <UserConnectionCard key={u.user_id} user={u} onRefresh={fetchData} />
        ))}

      {users.length === 0 && (
        <p className="text-sm text-ws-muted text-center py-8">No connections found. Run Demo Setup first.</p>
      )}
    </div>
  )
}
