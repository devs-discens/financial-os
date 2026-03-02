import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import StatusBadge, { NodeTypeBadge } from '../components/StatusBadge'
import ThinkingSteps from '../components/ThinkingSteps'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import { listDags, getDag, generateDag, approveNodes, executeDag } from '../api/dags'
import { ApiError } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import type { DagSummary, Dag, DagNode } from '../types/dag'
import type { ThinkingStep } from '../types/council'

const GENERATE_MESSAGES = [
  'Fetching financial context...',
  'Anonymizing data...',
  'Generating action plan...',
  'Building dependency graph...',
]

export default function ActionPlans() {
  const { user } = useAuth()
  const USER_ID = user!.id
  const location = useLocation()
  const prefill = location.state as { question?: string; synthesis?: string } | null

  const [dags, setDags] = useState<DagSummary[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<Dag | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)

  // Generate form
  const [showGenerate, setShowGenerate] = useState(!!prefill?.question)
  const [genQuestion, setGenQuestion] = useState(prefill?.question ?? '')
  const [genSynthesis, setGenSynthesis] = useState(prefill?.synthesis ?? '')
  const [generating, setGenerating] = useState(false)
  const [genSteps, setGenSteps] = useState<ThinkingStep[]>([])

  // Action state
  const [actionLoading, setActionLoading] = useState(false)
  const [execSteps, setExecSteps] = useState<ThinkingStep[]>([])
  const [error, setError] = useState('')

  const fetchDags = useCallback(async () => {
    try {
      const res = await listDags(USER_ID)
      setDags(res.dags)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchDags() }, [fetchDags])

  const selectDag = async (dagId: number) => {
    setSelectedId(dagId)
    setDetailLoading(true)
    setExecSteps([])
    setError('')
    try {
      const d = await getDag(dagId)
      setDetail(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load DAG')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleGenerate = async () => {
    if (!genQuestion.trim() || generating) return
    setGenerating(true)
    setGenSteps([])
    setError('')
    try {
      const res = await generateDag({
        user_id: USER_ID,
        question: genQuestion,
        council_synthesis: genSynthesis || undefined,
      })
      setGenSteps(res.steps)
      await fetchDags()
      setSelectedId(res.dag_id)
      setDetail({
        dag_id: res.dag_id,
        user_id: res.user_id,
        title: res.title,
        description: res.description,
        source_type: genSynthesis ? 'council' : 'manual',
        status: res.status,
        council_question: genQuestion,
        nodes: res.nodes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
      })
      setShowGenerate(false)
      setGenQuestion('')
      setGenSynthesis('')
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const body = e.body as { message?: string } | null
        setError(body?.message ?? 'That question is outside the scope of financial advisory.')
      } else {
        setError(e instanceof Error ? e.message : 'Generation failed')
      }
    } finally {
      setGenerating(false)
    }
  }

  const handleApproveAll = async () => {
    if (!detail) return
    setActionLoading(true)
    setError('')
    try {
      const pendingKeys = detail.nodes.filter((n) => n.status === 'pending').map((n) => n.node_key)
      if (pendingKeys.length === 0) return
      const res = await approveNodes(detail.dag_id, pendingKeys)
      setDetail(res.dag)
      await fetchDags()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approval failed')
    } finally {
      setActionLoading(false)
    }
  }

  const handleExecute = async () => {
    if (!detail) return
    setActionLoading(true)
    setExecSteps([])
    setError('')
    try {
      const res = await executeDag(detail.dag_id)
      setExecSteps(res.steps)
      // Refresh the detail
      const d = await getDag(detail.dag_id)
      setDetail(d)
      await fetchDags()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Execution failed')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) return <LoadingSpinner />

  const hasPending = detail?.nodes.some((n) => n.status === 'pending')
  const hasApproved = detail?.nodes.some((n) => n.status === 'approved')

  return (
    <div className="flex gap-6 h-[calc(100vh-4rem)]">
      {/* Left Panel — DAG List */}
      <div className="w-80 shrink-0 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-extrabold">Action Plans</h1>
          <button
            onClick={() => setShowGenerate(!showGenerate)}
            className="rounded-lg bg-ws-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-ws-accent-dim transition-colors"
          >
            {showGenerate ? 'Cancel' : 'Generate Plan'}
          </button>
        </div>

        {/* Generate Form */}
        {showGenerate && (
          <div className="mb-4 rounded-xl bg-white border border-ws-border p-3 space-y-2 shadow-sm">
            <textarea
              placeholder="What financial goal or decision would you like an action plan for?"
              value={genQuestion}
              onChange={(e) => setGenQuestion(e.target.value)}
              rows={2}
              className="w-full rounded-lg bg-ws-bg border border-ws-border px-3 py-2 text-sm text-ws-text placeholder-ws-muted resize-none focus:outline-none focus:border-ws-accent"
            />
            {genSynthesis && (
              <p className="text-xs text-ws-muted px-1">Includes council analysis</p>
            )}
            {error && <p className="text-xs text-ws-red px-1">{error}</p>}
            <button
              onClick={handleGenerate}
              disabled={generating || !genQuestion.trim()}
              className="w-full rounded-lg bg-ws-accent px-3 py-2 text-sm font-semibold text-white hover:bg-ws-accent-dim transition-colors disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate'}
            </button>
          </div>
        )}

        {generating && <LoadingSpinner messages={GENERATE_MESSAGES} showElapsed />}

        {/* DAG List */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {dags.length === 0 && !generating ? (
            <EmptyState message="No action plans yet" detail="Generate one from the council or above" />
          ) : (
            dags.map((d) => (
              <button
                key={d.dag_id}
                onClick={() => selectDag(d.dag_id)}
                className={`w-full text-left rounded-xl p-3 border transition-colors shadow-sm ${
                  selectedId === d.dag_id
                    ? 'bg-white border-ws-accent/50'
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
            ))
          )}
        </div>
      </div>

      {/* Right Panel — DAG Detail */}
      <div className="flex-1 overflow-y-auto">
        {detailLoading ? (
          <LoadingSpinner />
        ) : detail ? (
          <div className="space-y-4">
            {/* Detail Header */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold">{detail.title}</h2>
                  <StatusBadge status={detail.status} />
                </div>
                <p className="mt-1 text-sm text-ws-muted">{detail.description}</p>
              </div>
              <div className="flex gap-2">
                {hasPending && (
                  <button
                    onClick={handleApproveAll}
                    disabled={actionLoading}
                    className="rounded-lg bg-ws-accent px-4 py-2 text-sm font-semibold text-white hover:bg-ws-accent-dim transition-colors disabled:opacity-50"
                  >
                    {actionLoading ? 'Approving...' : 'Approve All'}
                  </button>
                )}
                {hasApproved && (
                  <button
                    onClick={handleExecute}
                    disabled={actionLoading}
                    className="rounded-lg bg-ws-blue px-4 py-2 text-sm font-semibold text-white hover:bg-ws-blue/80 transition-colors disabled:opacity-50"
                  >
                    {actionLoading ? 'Executing...' : 'Execute'}
                  </button>
                )}
              </div>
            </div>

            {error && <p className="text-sm text-ws-red">{error}</p>}

            {/* Node Flow */}
            <div className="space-y-0">
              {detail.nodes.map((node, i) => (
                <NodeCard key={node.node_key} node={node} isLast={i === detail.nodes.length - 1} />
              ))}
            </div>

            {/* Steps */}
            {genSteps.length > 0 && <ThinkingSteps steps={genSteps} />}
            {execSteps.length > 0 && <ThinkingSteps steps={execSteps} />}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-ws-muted">Select an action plan to view details</p>
          </div>
        )}
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
