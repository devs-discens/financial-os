import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import MarkdownContent from '../components/MarkdownContent'
import ThinkingSteps from '../components/ThinkingSteps'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import StatusBadge, { NodeTypeBadge } from '../components/StatusBadge'
import { runCollaborative, runAdversarial, checkSimilar, listSessions, getSession } from '../api/council'
import { listDags, getDag, generateDag, approveNodes, executeDag } from '../api/dags'
import { ApiError } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import type { CollaborativeResponse, AdversarialResponse, CouncilResponse, CouncilSessionSummary } from '../types/council'
import type { ThinkingStep } from '../types/council'
import type { DagSummary, Dag, DagNode } from '../types/dag'

const LOADING_MESSAGES = [
  'Fetching financial data...',
  'Anonymizing context...',
  'Querying AI models...',
  'Synthesizing results...',
]

const GENERATE_MESSAGES = [
  'Fetching financial context...',
  'Anonymizing data...',
  'Generating action plan...',
  'Building dependency graph...',
]

type Mode = 'collaborative' | 'adversarial'

export default function Explore() {
  const { user } = useAuth()
  const USER_ID = user!.id
  const location = useLocation()
  const prefill = location.state as { prefillQuestion?: string } | null
  const [mode, setMode] = useState<Mode>('collaborative')
  const [question, setQuestion] = useState(prefill?.prefillQuestion ?? '')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CouncilResponse | null>(null)
  const [error, setError] = useState('')

  // Similarity state
  const [similarMatches, setSimilarMatches] = useState<CouncilSessionSummary[]>([])
  const [checkingSimlar, setCheckingSimilar] = useState(false)
  const [showSimilarBanner, setShowSimilarBanner] = useState(false)

  // Action Plans state
  const [dags, setDags] = useState<DagSummary[]>([])
  const [expandedDagId, setExpandedDagId] = useState<number | null>(null)
  const [dagDetail, setDagDetail] = useState<Dag | null>(null)
  const [dagDetailLoading, setDagDetailLoading] = useState(false)
  const [dagsExpanded, setDagsExpanded] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genSteps, setGenSteps] = useState<ThinkingStep[]>([])
  const [dagActionLoading, setDagActionLoading] = useState(false)
  const [execSteps, setExecSteps] = useState<ThinkingStep[]>([])
  const [dagError, setDagError] = useState('')

  // Past Sessions state
  const [sessions, setSessions] = useState<CouncilSessionSummary[]>([])
  const [sessionsExpanded, setSessionsExpanded] = useState(false)
  const [sessionLoading, setSessionLoading] = useState(false)

  const fetchDags = useCallback(async () => {
    try {
      const res = await listDags(USER_ID)
      setDags(res.dags)
    } catch { /* ignore */ }
  }, [USER_ID])

  const fetchSessions = useCallback(async () => {
    try {
      const res = await listSessions(USER_ID)
      setSessions(res.sessions)
    } catch { /* ignore */ }
  }, [USER_ID])

  useEffect(() => {
    fetchDags()
    fetchSessions()
  }, [fetchDags, fetchSessions])

  const handleSubmit = async () => {
    if (!question.trim() || loading) return

    // Step 1: Check for similar questions first
    setCheckingSimilar(true)
    setSimilarMatches([])
    setShowSimilarBanner(false)
    setError('')
    try {
      const similar = await checkSimilar(USER_ID, question)
      if (similar.count > 0) {
        setSimilarMatches(similar.matches)
        setShowSimilarBanner(true)
        setCheckingSimilar(false)
        return // pause — user decides to view previous or ask anyway
      }
    } catch {
      // similarity check failed — proceed directly
    }
    setCheckingSimilar(false)

    // No matches — proceed with council call
    await runCouncilQuery()
  }

  const runCouncilQuery = async () => {
    setLoading(true)
    setResult(null)
    setShowSimilarBanner(false)
    setError('')
    try {
      const res = mode === 'collaborative'
        ? await runCollaborative(USER_ID, question)
        : await runAdversarial(USER_ID, question)
      setResult(res)
      // Refresh sessions list to include the new one
      fetchSessions()
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const body = e.body as { message?: string } | null
        setError(body?.message ?? 'That question is outside the scope of financial advisory.')
      } else {
        setError(e instanceof Error ? e.message : 'Query failed')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleViewPrevious = async (sessionId: number) => {
    setSessionLoading(true)
    setShowSimilarBanner(false)
    setError('')
    try {
      const session = await getSession(sessionId)
      setResult(session.response)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load previous session')
    } finally {
      setSessionLoading(false)
    }
  }

  const handleLoadSession = async (sessionId: number) => {
    setSessionLoading(true)
    setError('')
    try {
      const session = await getSession(sessionId)
      setResult(session.response)
      setQuestion(session.question)
      setMode(session.mode as Mode)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load session')
    } finally {
      setSessionLoading(false)
    }
  }

  const handleGeneratePlan = async () => {
    if (!result || generating) return
    const synthesis = result.mode === 'collaborative'
      ? (result as CollaborativeResponse).synthesis
      : (result as AdversarialResponse).chairman_verdict.content
    setGenerating(true)
    setGenSteps([])
    setDagError('')
    setDagsExpanded(true)
    try {
      const res = await generateDag({
        user_id: USER_ID,
        question,
        council_synthesis: synthesis || undefined,
      })
      setGenSteps(res.steps)
      await fetchDags()
      setExpandedDagId(res.dag_id)
      setDagDetail({
        dag_id: res.dag_id,
        user_id: res.user_id,
        title: res.title,
        description: res.description,
        source_type: synthesis ? 'council' : 'manual',
        status: res.status,
        council_question: question,
        nodes: res.nodes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
      })
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const body = e.body as { message?: string } | null
        setDagError(body?.message ?? 'That question is outside the scope of financial advisory.')
      } else {
        setDagError(e instanceof Error ? e.message : 'Generation failed')
      }
    } finally {
      setGenerating(false)
    }
  }

  const selectDag = async (dagId: number) => {
    if (expandedDagId === dagId) {
      setExpandedDagId(null)
      setDagDetail(null)
      return
    }
    setExpandedDagId(dagId)
    setDagDetailLoading(true)
    setExecSteps([])
    setDagError('')
    try {
      const d = await getDag(dagId)
      setDagDetail(d)
    } catch (e) {
      setDagError(e instanceof Error ? e.message : 'Failed to load plan')
    } finally {
      setDagDetailLoading(false)
    }
  }

  const handleApproveAll = async () => {
    if (!dagDetail) return
    setDagActionLoading(true)
    setDagError('')
    try {
      const pendingKeys = dagDetail.nodes.filter((n) => n.status === 'pending').map((n) => n.node_key)
      if (pendingKeys.length === 0) return
      const res = await approveNodes(dagDetail.dag_id, pendingKeys)
      setDagDetail(res.dag)
      await fetchDags()
    } catch (e) {
      setDagError(e instanceof Error ? e.message : 'Approval failed')
    } finally {
      setDagActionLoading(false)
    }
  }

  const handleExecute = async () => {
    if (!dagDetail) return
    setDagActionLoading(true)
    setExecSteps([])
    setDagError('')
    try {
      const res = await executeDag(dagDetail.dag_id)
      setExecSteps(res.steps)
      const d = await getDag(dagDetail.dag_id)
      setDagDetail(d)
      await fetchDags()
    } catch (e) {
      setDagError(e instanceof Error ? e.message : 'Execution failed')
    } finally {
      setDagActionLoading(false)
    }
  }

  const hasPending = dagDetail?.nodes.some((n) => n.status === 'pending')
  const hasApproved = dagDetail?.nodes.some((n) => n.status === 'approved')

  return (
    <div className="space-y-6">
      {/* Section 1: Ask */}
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-extrabold">Plan & Explore</h1>
        <div className="flex rounded-lg bg-ws-surface border border-ws-border overflow-hidden">
          <button
            onClick={() => { setMode('collaborative'); setResult(null); setSimilarMatches([]); setShowSimilarBanner(false) }}
            title="Three AI specialists analyze your question together, then a chairman synthesizes one unified answer"
            className={`px-4 py-2 text-sm font-semibold transition-colors ${
              mode === 'collaborative' ? 'bg-ws-accent text-white' : 'text-ws-muted hover:text-ws-text'
            }`}
          >
            Collaborative
          </button>
          <button
            onClick={() => { setMode('adversarial'); setResult(null); setSimilarMatches([]); setShowSimilarBanner(false) }}
            title="A bull advocate argues for and a bear advocate argues against, then a chairman delivers a balanced verdict"
            className={`px-4 py-2 text-sm font-semibold transition-colors ${
              mode === 'adversarial' ? 'bg-ws-accent text-white' : 'text-ws-muted hover:text-ws-text'
            }`}
          >
            Adversarial
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <input
          type="text"
          placeholder={mode === 'collaborative'
            ? 'Ask about your budget, investments, savings goals, or financial health...'
            : 'Explore a financial decision — e.g., should I refinance my mortgage?'}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          disabled={loading || checkingSimlar}
          className="flex-1 rounded-lg bg-white border border-ws-border px-4 py-3 text-sm text-ws-text placeholder-ws-muted disabled:opacity-50 shadow-sm focus:outline-none focus:border-ws-accent"
        />
        <button
          onClick={handleSubmit}
          disabled={loading || checkingSimlar || !question.trim()}
          className="rounded-lg bg-ws-accent px-6 py-3 text-sm font-semibold text-white hover:bg-ws-accent-dim transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          Explore
        </button>
      </div>

      {error && <p className="text-sm text-ws-red">{error}</p>}

      {/* Similar Questions Banner */}
      {showSimilarBanner && similarMatches.length > 0 && (
        <div className="rounded-xl bg-ws-purple/5 border border-ws-purple/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-ws-purple">You've explored similar questions</span>
            <button
              onClick={runCouncilQuery}
              className="rounded-lg bg-ws-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-ws-accent-dim transition-colors"
            >
              Ask Anyway
            </button>
          </div>
          <div className="space-y-2">
            {similarMatches.map((match) => (
              <div
                key={match.session_id}
                className="flex items-center gap-3 rounded-lg bg-white border border-ws-border p-3 shadow-sm"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusBadge status={match.mode} />
                    {match.similarity != null && (
                      <span className="text-xs text-ws-purple font-medium">
                        {Math.round(match.similarity * 100)}% similar
                      </span>
                    )}
                    <span className="text-xs text-ws-muted ml-auto">
                      {new Date(match.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm text-ws-text truncate">{match.question}</p>
                  {match.synthesis && (
                    <p className="text-xs text-ws-muted mt-1 line-clamp-2">{match.synthesis.substring(0, 150)}...</p>
                  )}
                </div>
                <button
                  onClick={() => handleViewPrevious(match.session_id)}
                  className="shrink-0 rounded-lg bg-ws-surface border border-ws-border px-3 py-1.5 text-xs font-semibold text-ws-text hover:bg-ws-border transition-colors"
                >
                  View Previous
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {(loading || checkingSimlar || sessionLoading) && (
        <LoadingSpinner
          messages={checkingSimlar ? ['Checking for similar questions...'] : LOADING_MESSAGES}
          showElapsed
        />
      )}

      {/* Section 2: Results */}
      {result && result.mode === 'collaborative' && (
        <CollaborativeResult result={result as CollaborativeResponse} onGeneratePlan={handleGeneratePlan} generating={generating} />
      )}
      {result && result.mode === 'adversarial' && (
        <AdversarialResult result={result as AdversarialResponse} onGeneratePlan={handleGeneratePlan} generating={generating} />
      )}

      {result && (
        <>
          <QueryInspector result={result} />
          <ThinkingSteps steps={result.steps} />
        </>
      )}

      {/* Section 3: Your Action Plans */}
      <div className="rounded-xl bg-white border border-ws-border shadow-sm overflow-hidden">
        <button
          onClick={() => setDagsExpanded(!dagsExpanded)}
          className="flex items-center gap-3 w-full px-5 py-4 text-left hover:bg-ws-surface transition-colors"
        >
          <span className="text-xs text-ws-muted">{dagsExpanded ? '▼' : '▶'}</span>
          <span className="text-sm font-bold flex-1">Your Action Plans</span>
          {dags.length > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-ws-accent/15 text-ws-accent text-xs font-semibold px-1.5">
              {dags.length}
            </span>
          )}
        </button>

        {dagsExpanded && (
          <div className="px-5 pb-4 space-y-3 border-t border-ws-border pt-3">
            {generating && <LoadingSpinner messages={GENERATE_MESSAGES} showElapsed />}
            {dagError && <p className="text-sm text-ws-red">{dagError}</p>}

            {dags.length === 0 && !generating ? (
              <EmptyState message="No action plans yet" detail="Explore a question above, then generate a plan from the results" />
            ) : (
              dags.map((d) => (
                <div key={d.dag_id}>
                  <button
                    onClick={() => selectDag(d.dag_id)}
                    className={`w-full text-left rounded-xl p-3 border transition-colors shadow-sm ${
                      expandedDagId === d.dag_id
                        ? 'bg-ws-surface border-ws-accent/50'
                        : 'bg-white border-ws-border hover:border-ws-accent/30'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold truncate flex-1">{d.title}</span>
                      <StatusBadge status={d.status} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-ws-muted">
                      <StatusBadge status={d.source_type} />
                      <span>{d.completed_nodes}/{d.node_count} nodes</span>
                      <span className="ml-auto">{new Date(d.created_at).toLocaleDateString()}</span>
                    </div>
                  </button>

                  {expandedDagId === d.dag_id && (
                    <div className="mt-2 ml-4 space-y-3">
                      {dagDetailLoading ? (
                        <LoadingSpinner />
                      ) : dagDetail ? (
                        <>
                          <div className="flex items-start justify-between">
                            <p className="text-xs text-ws-muted">{dagDetail.description}</p>
                            <div className="flex gap-2 shrink-0 ml-3">
                              {hasPending && (
                                <button
                                  onClick={handleApproveAll}
                                  disabled={dagActionLoading}
                                  className="rounded-lg bg-ws-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-ws-accent-dim transition-colors disabled:opacity-50"
                                >
                                  {dagActionLoading ? 'Approving...' : 'Approve All'}
                                </button>
                              )}
                              {hasApproved && (
                                <button
                                  onClick={handleExecute}
                                  disabled={dagActionLoading}
                                  className="rounded-lg bg-ws-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-ws-blue/80 transition-colors disabled:opacity-50"
                                >
                                  {dagActionLoading ? 'Executing...' : 'Execute'}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="space-y-0">
                            {dagDetail.nodes.map((node, i) => (
                              <NodeCard key={node.node_key} node={node} isLast={i === dagDetail.nodes.length - 1} />
                            ))}
                          </div>

                          {genSteps.length > 0 && <ThinkingSteps steps={genSteps} />}
                          {execSteps.length > 0 && <ThinkingSteps steps={execSteps} />}
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Section 4: Past Sessions */}
      <div className="rounded-xl bg-white border border-ws-border shadow-sm overflow-hidden">
        <button
          onClick={() => setSessionsExpanded(!sessionsExpanded)}
          className="flex items-center gap-3 w-full px-5 py-4 text-left hover:bg-ws-surface transition-colors"
        >
          <span className="text-xs text-ws-muted">{sessionsExpanded ? '▼' : '▶'}</span>
          <span className="text-sm font-bold flex-1">Past Sessions</span>
          {sessions.length > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-ws-purple/15 text-ws-purple text-xs font-semibold px-1.5">
              {sessions.length}
            </span>
          )}
        </button>

        {sessionsExpanded && (
          <div className="px-5 pb-4 space-y-2 border-t border-ws-border pt-3">
            {sessions.length === 0 ? (
              <EmptyState message="No past sessions" detail="Your council conversations will appear here" />
            ) : (
              sessions.map((s) => (
                <button
                  key={s.session_id}
                  onClick={() => handleLoadSession(s.session_id)}
                  className="w-full text-left rounded-lg bg-ws-surface border border-ws-border p-3 hover:border-ws-accent/30 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <StatusBadge status={s.mode} />
                    {s.elapsed_ms != null && (
                      <span className="text-xs text-ws-muted">{(s.elapsed_ms / 1000).toFixed(1)}s</span>
                    )}
                    <span className="text-xs text-ws-muted ml-auto">
                      {new Date(s.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm text-ws-text truncate">{s.question}</p>
                  {s.synthesis && (
                    <p className="text-xs text-ws-muted mt-1 line-clamp-2">{s.synthesis.substring(0, 150)}...</p>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CollaborativeResult({ result, onGeneratePlan, generating }: { result: CollaborativeResponse; onGeneratePlan: () => void; generating: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      {/* Specialist Responses — collapsed by default */}
      <div className="rounded-xl bg-white border border-ws-border shadow-sm divide-y divide-ws-border overflow-hidden">
        {result.responses.map((r) => {
          const label = r.role.replace(/^Financial\s+/i, '')
          return (
            <div key={r.role}>
              <button
                onClick={() => setExpanded(expanded === r.role ? null : r.role)}
                className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-ws-surface transition-colors"
              >
                <span className="text-xs text-ws-muted">{expanded === r.role ? '▼' : '▶'}</span>
                <span className="text-sm font-bold flex-1">{label}</span>
                <span className="text-xs text-ws-muted">{(r.elapsed_ms / 1000).toFixed(1)}s</span>
              </button>
              {expanded === r.role && (
                <div className="px-4 pb-4 pt-1">
                  <MarkdownContent content={r.content} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Chairman Synthesis */}
      <div className="rounded-xl bg-ws-accent/5 border border-ws-accent/20 p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold text-ws-accent">Synthesis</span>
          <button
            onClick={onGeneratePlan}
            disabled={generating}
            className="rounded-lg bg-ws-purple px-4 py-2 text-sm font-semibold text-white hover:bg-ws-purple/80 transition-colors disabled:opacity-50"
          >
            {generating ? 'Generating...' : 'Generate Action Plan'}
          </button>
        </div>
        <MarkdownContent content={result.synthesis} />
        <div className="mt-3 text-xs text-ws-muted">
          {(result.elapsed_ms / 1000).toFixed(1)}s total
        </div>
      </div>
    </div>
  )
}

function QueryInspector({ result }: { result: CouncilResponse }) {
  const [expanded, setExpanded] = useState(false)

  if (!result.raw_context) return null

  return (
    <div className="rounded-xl bg-white border border-ws-border p-4 shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-semibold text-ws-muted hover:text-ws-text transition-colors w-full text-left"
      >
        <span className="text-xs">{expanded ? '▼' : '▶'}</span>
        Query Inspector
      </button>
      {expanded && (
        <div className="mt-4 space-y-4">
          {/* Context comparison */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-bold text-ws-muted uppercase tracking-wider mb-2">Raw Context</h4>
              <pre className="rounded-lg bg-ws-bg border border-ws-border p-3 text-xs text-ws-text font-mono whitespace-pre-wrap overflow-auto max-h-64">
                {result.raw_context}
              </pre>
            </div>
            <div>
              <h4 className="text-xs font-bold text-ws-accent uppercase tracking-wider mb-2">PII-Filtered Context</h4>
              <pre className="rounded-lg bg-ws-accent/5 border border-ws-accent/20 p-3 text-xs text-ws-text font-mono whitespace-pre-wrap overflow-auto max-h-64">
                {result.filtered_context}
              </pre>
            </div>
          </div>

          {/* Question comparison */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-bold text-ws-muted uppercase tracking-wider mb-2">Raw Question</h4>
              <pre className="rounded-lg bg-ws-bg border border-ws-border p-3 text-xs text-ws-text font-mono whitespace-pre-wrap">
                {result.raw_question}
              </pre>
            </div>
            <div>
              <h4 className="text-xs font-bold text-ws-accent uppercase tracking-wider mb-2">PII-Filtered Question</h4>
              <pre className="rounded-lg bg-ws-accent/5 border border-ws-accent/20 p-3 text-xs text-ws-text font-mono whitespace-pre-wrap">
                {result.filtered_question}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AdversarialResult({ result, onGeneratePlan, generating }: { result: AdversarialResponse; onGeneratePlan: () => void; generating: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const cases = [
    { key: 'bull', label: 'Bull Advocate', color: 'text-ws-green', data: result.bull_case },
    { key: 'bear', label: 'Bear Advocate', color: 'text-ws-red', data: result.bear_case },
  ]

  return (
    <div className="space-y-4">
      {/* Bull vs Bear — collapsed by default */}
      <div className="rounded-xl bg-white border border-ws-border shadow-sm divide-y divide-ws-border overflow-hidden">
        {cases.map(({ key, label, color, data }) => (
          <div key={key}>
            <button
              onClick={() => setExpanded(expanded === key ? null : key)}
              className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-ws-surface transition-colors"
            >
              <span className="text-xs text-ws-muted">{expanded === key ? '▼' : '▶'}</span>
              <span className={`text-sm font-bold flex-1 ${color}`}>{label}</span>
              <span className="text-xs text-ws-muted">{(data.elapsed_ms / 1000).toFixed(1)}s</span>
            </button>
            {expanded === key && (
              <div className="px-4 pb-4 pt-1">
                <MarkdownContent content={data.content} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Chairman Verdict */}
      <div className="rounded-xl bg-ws-accent/5 border border-ws-accent/20 p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold text-ws-accent">Verdict</span>
          <button
            onClick={onGeneratePlan}
            disabled={generating}
            className="rounded-lg bg-ws-purple px-4 py-2 text-sm font-semibold text-white hover:bg-ws-purple/80 transition-colors disabled:opacity-50"
          >
            {generating ? 'Generating...' : 'Generate Action Plan'}
          </button>
        </div>
        <MarkdownContent content={result.chairman_verdict.content} />
        <div className="mt-3 text-xs text-ws-muted">
          {(result.elapsed_ms / 1000).toFixed(1)}s total
        </div>
      </div>
    </div>
  )
}

const statusDotStyles: Record<string, string> = {
  pending: 'bg-ws-muted',
  approved: 'bg-ws-accent',
  executing: 'bg-ws-blue animate-pulse',
  completed: 'bg-ws-green',
  failed: 'bg-ws-red',
}

function NodeCard({ node, isLast }: { node: DagNode; isLast: boolean }) {
  const [showResult, setShowResult] = useState(false)

  return (
    <div className="relative flex">
      {/* Timeline connector */}
      <div className="flex flex-col items-center mr-4 w-4">
        <div className={`h-3 w-3 rounded-full shrink-0 mt-5 ${statusDotStyles[node.status] ?? 'bg-ws-muted'}`} />
        {!isLast && <div className="w-px flex-1 bg-ws-border" />}
      </div>

      {/* Node card */}
      <div className="flex-1 rounded-xl bg-white border border-ws-border p-4 mb-3 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">{node.title}</span>
          <NodeTypeBadge type={node.node_type} />
          <StatusBadge status={node.execution_type} />
          <StatusBadge status={node.status} />
        </div>
        <p className="mt-1 text-xs text-ws-muted">{node.description}</p>

        {node.depends_on.length > 0 && (
          <p className="mt-2 text-xs text-ws-muted">
            Depends on: {node.depends_on.join(', ')}
          </p>
        )}

        {node.instructions && (
          <div className="mt-2 rounded-lg bg-ws-bg border border-ws-border p-2">
            <p className="text-xs text-ws-muted">Instructions:</p>
            <p className="text-xs mt-1">{node.instructions}</p>
          </div>
        )}

        {node.result && (
          <div className="mt-2">
            <button
              onClick={() => setShowResult(!showResult)}
              className="text-xs text-ws-accent font-semibold hover:text-ws-accent-dim"
            >
              {showResult ? 'Hide result' : 'Show result'}
            </button>
            {showResult && (
              <pre className="mt-1 rounded-lg bg-ws-bg border border-ws-border p-2 text-xs text-ws-muted overflow-x-auto">
                {JSON.stringify(node.result, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
