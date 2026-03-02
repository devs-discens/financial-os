import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import MarkdownContent from '../components/MarkdownContent'
import ThinkingSteps from '../components/ThinkingSteps'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import StatusBadge, { NodeTypeBadge } from '../components/StatusBadge'
import { runCollaborative, runAdversarial, checkSimilar, listSessions, getSession, archiveSession, linkSessionToGoal } from '../api/council'
import { listDags, getDag, generateDag, approveNodes, executeDag, archiveDag } from '../api/dags'
import { listGoals, addGoal, deleteGoal, generateGoalPlan, checkSimilarGoal } from '../api/goals'
import type { SimilarGoalMatch } from '../api/goals'
import { ApiError } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import type { CollaborativeResponse, AdversarialResponse, CouncilResponse, CouncilSessionSummary } from '../types/council'
import type { ThinkingStep } from '../types/council'
import type { DagSummary, Dag, DagNode } from '../types/dag'
import type { Goal } from '../types/goals'

const COUNCIL_LOADING_MESSAGES = [
  'Fetching financial data...',
  'Anonymizing context...',
  'Querying AI models...',
  'Synthesizing results...',
]

const GOAL_LOADING_MESSAGES = [
  'Analyzing your financial data...',
  'Assessing feasibility...',
  'Checking cross-goal impacts...',
]

const GENERATE_MESSAGES = [
  'Fetching financial context...',
  'Anonymizing data...',
  'Generating action plan...',
  'Building dependency graph...',
]

type Mode = 'collaborative' | 'adversarial'

const feasibilityColors: Record<string, string> = {
  green: 'bg-ws-green',
  yellow: 'bg-ws-orange',
  red: 'bg-ws-red',
}

const feasibilityLabels: Record<string, string> = {
  green: 'Achievable',
  yellow: 'Challenging',
  red: 'Very Difficult',
}

const goalTypeBadgeColors: Record<string, string> = {
  savings: 'bg-ws-blue/15 text-ws-blue',
  debt_payoff: 'bg-ws-red/15 text-ws-red',
  investment: 'bg-ws-purple/15 text-ws-purple',
  purchase: 'bg-ws-orange/15 text-ws-orange',
  emergency_fund: 'bg-ws-green/15 text-ws-green',
  retirement: 'bg-ws-accent/15 text-ws-accent',
  income: 'bg-ws-blue/15 text-ws-blue',
  other: 'bg-ws-muted/15 text-ws-muted',
}

function goalTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    savings: 'Savings',
    debt_payoff: 'Debt Payoff',
    investment: 'Investment',
    purchase: 'Purchase',
    emergency_fund: 'Emergency Fund',
    retirement: 'Retirement',
    income: 'Income',
    other: 'Other',
  }
  return labels[type] || type
}

export default function YourPlan() {
  const { user } = useAuth()
  const USER_ID = user!.id
  const location = useLocation()
  const prefill = location.state as { prefillQuestion?: string; goalId?: number } | null
  const goalsSectionRef = useRef<HTMLElement>(null)

  // --- Council / Adviser state ---
  const [mode, setMode] = useState<Mode>('collaborative')
  const [question, setQuestion] = useState(prefill?.prefillQuestion ?? '')
  const [activeGoalId, setActiveGoalId] = useState<number | undefined>(prefill?.goalId)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CouncilResponse | null>(null)
  const [error, setError] = useState('')
  const [similarMatches, setSimilarMatches] = useState<CouncilSessionSummary[]>([])
  const [checkingSimlar, setCheckingSimilar] = useState(false)
  const [showSimilarBanner, setShowSimilarBanner] = useState(false)

  // --- Past Sessions state ---
  const [sessions, setSessions] = useState<CouncilSessionSummary[]>([])
  const [expandedSessionId, setExpandedSessionId] = useState<number | null>(null)
  const [sessionLoading, setSessionLoading] = useState(false)

  // --- Goals state ---
  const [goals, setGoals] = useState<Goal[]>([])
  const [goalText, setGoalText] = useState('')
  const [goalLoading, setGoalLoading] = useState(false)
  const [goalError, setGoalError] = useState('')
  const [goalSteps, setGoalSteps] = useState<ThinkingStep[]>([])
  const [expandedGoalId, setExpandedGoalId] = useState<number | null>(null)
  const [goalPlanLoading, setGoalPlanLoading] = useState<number | null>(null)
  const [showGoalInput, setShowGoalInput] = useState(false)
  const [similarGoalMatches, setSimilarGoalMatches] = useState<SimilarGoalMatch[]>([])
  const [showSimilarGoalBanner, setShowSimilarGoalBanner] = useState(false)
  const [checkingGoalSimilar, setCheckingGoalSimilar] = useState(false)

  // --- Action Plans state ---
  const [dags, setDags] = useState<DagSummary[]>([])
  const [expandedDagId, setExpandedDagId] = useState<number | null>(null)
  const [dagDetail, setDagDetail] = useState<Dag | null>(null)
  const [dagDetailLoading, setDagDetailLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genSteps, setGenSteps] = useState<ThinkingStep[]>([])
  const [dagActionLoading, setDagActionLoading] = useState(false)
  const [execSteps, setExecSteps] = useState<ThinkingStep[]>([])
  const [dagError, setDagError] = useState('')

  const fetchGoals = useCallback(async () => {
    try {
      const res = await listGoals(USER_ID)
      setGoals(res.goals)
    } catch { /* ignore */ }
  }, [USER_ID])

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
    fetchGoals()
    fetchDags()
    fetchSessions()
  }, [fetchGoals, fetchDags, fetchSessions])

  // Auto-submit prefilled questions
  useEffect(() => {
    if (prefill?.prefillQuestion && question === prefill.prefillQuestion) {
      window.history.replaceState({}, '')
    }
  }, [prefill, question])

  // --- Council handlers ---
  const handleSubmit = async () => {
    if (!question.trim() || loading) return

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
        return
      }
    } catch {
      // similarity check failed — proceed directly
    }
    setCheckingSimilar(false)
    await runCouncilQuery()
  }

  const runCouncilQuery = async () => {
    setLoading(true)
    setResult(null)
    setShowSimilarBanner(false)
    setError('')
    try {
      const res = mode === 'collaborative'
        ? await runCollaborative(USER_ID, question, activeGoalId)
        : await runAdversarial(USER_ID, question, activeGoalId)
      setResult(res)
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

  const handleArchiveSession = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await archiveSession(sessionId)
      await fetchSessions()
    } catch { /* ignore */ }
  }

  const handleGeneratePlan = async () => {
    if (!result || generating) return
    const synthesis = result.mode === 'collaborative'
      ? (result as CollaborativeResponse).synthesis
      : (result as AdversarialResponse).chairman_verdict.content
    setGenerating(true)
    setGenSteps([])
    setDagError('')
    try {
      const res = await generateDag({
        user_id: USER_ID,
        question,
        council_synthesis: synthesis || undefined,
        goal_id: activeGoalId,
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
        goal_id: res.goal_id,
        council_question: question,
        nodes: res.nodes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
      })
      document.getElementById('plans-section')?.scrollIntoView({ behavior: 'smooth' })
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

  // --- "Track as Goal" from conversation result ---
  const handleTrackAsGoal = async () => {
    if (!question.trim() || goalLoading) return
    setGoalLoading(true)
    setGoalError('')
    setGoalSteps([])
    setSimilarGoalMatches([])
    setShowSimilarGoalBanner(false)

    // Check for similar goals first
    try {
      setCheckingGoalSimilar(true)
      const similar = await checkSimilarGoal(USER_ID, question.trim())
      setCheckingGoalSimilar(false)
      if (similar.count > 0) {
        setSimilarGoalMatches(similar.matches)
        setShowSimilarGoalBanner(true)
        setGoalLoading(false)
        goalsSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
        return
      }
    } catch {
      setCheckingGoalSimilar(false)
    }

    // No similar goals — create directly
    await createGoalFromText(question.trim())
  }

  const createGoalFromText = async (text: string) => {
    setGoalLoading(true)
    setGoalError('')
    setGoalSteps([])
    try {
      const res = await addGoal(USER_ID, text)
      setGoalSteps(res.steps)
      const newGoalId = res.goal.id
      setActiveGoalId(newGoalId)
      setExpandedGoalId(newGoalId)
      setShowSimilarGoalBanner(false)
      setSimilarGoalMatches([])

      // Link the current session to the new goal (retroactive linking)
      if (result?.session_id) {
        try {
          await linkSessionToGoal(result.session_id, newGoalId)
        } catch { /* non-blocking */ }
      }

      await Promise.all([fetchGoals(), fetchSessions()])
      goalsSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const body = e.body as { message?: string } | null
        setGoalError(body?.message ?? 'That goal is outside the scope of financial advisory.')
      } else {
        setGoalError(e instanceof Error ? e.message : 'Failed to add goal')
      }
    } finally {
      setGoalLoading(false)
    }
  }

  // --- "Debate This?" — re-run same question adversarial ---
  const handleDebateThis = () => {
    setMode('adversarial')
    setResult(null)
    // runCouncilQuery will pick up the current question and adversarial mode
    setTimeout(() => runCouncilQuery(), 0)
  }

  // --- Goal handlers ---
  const handleAddGoal = async () => {
    if (!goalText.trim() || goalLoading) return
    setGoalLoading(true)
    setGoalError('')
    setGoalSteps([])
    setSimilarGoalMatches([])
    setShowSimilarGoalBanner(false)

    // Check for similar goals first
    try {
      setCheckingGoalSimilar(true)
      const similar = await checkSimilarGoal(USER_ID, goalText.trim())
      setCheckingGoalSimilar(false)
      if (similar.count > 0) {
        setSimilarGoalMatches(similar.matches)
        setShowSimilarGoalBanner(true)
        setGoalLoading(false)
        return
      }
    } catch {
      setCheckingGoalSimilar(false)
    }

    await createGoalDirectly()
  }

  const createGoalDirectly = async () => {
    setGoalLoading(true)
    setGoalError('')
    setGoalSteps([])
    try {
      const res = await addGoal(USER_ID, goalText.trim())
      setGoalSteps(res.steps)
      setGoalText('')
      setShowGoalInput(false)
      await fetchGoals()
      setExpandedGoalId(res.goal.id)
      setShowSimilarGoalBanner(false)
      setSimilarGoalMatches([])
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const body = e.body as { message?: string } | null
        setGoalError(body?.message ?? 'That goal is outside the scope of financial advisory.')
      } else {
        setGoalError(e instanceof Error ? e.message : 'Failed to add goal')
      }
    } finally {
      setGoalLoading(false)
    }
  }

  const handleDeleteGoal = async (goalId: number) => {
    try {
      await deleteGoal(USER_ID, goalId)
      await fetchGoals()
      if (expandedGoalId === goalId) setExpandedGoalId(null)
    } catch { /* ignore */ }
  }

  const handleGetAdvice = (goal: Goal) => {
    const label = goal.summary_label || goal.raw_text
    const feasibility = goal.feasibility
    setQuestion(
      `I have a financial goal: "${label}" (currently assessed as ${feasibility} feasibility). ` +
      `What specific steps should I take to achieve this goal, and how does it fit with my overall financial picture?`
    )
    setActiveGoalId(goal.id)
    setMode('collaborative')
    setResult(null)
    document.getElementById('adviser-section')?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleCreateGoalPlan = async (goal: Goal) => {
    setGoalPlanLoading(goal.id)
    setDagError('')
    try {
      const res = await generateGoalPlan(USER_ID, goal.id)
      setGenSteps(res.steps)
      await fetchDags()
      setExpandedDagId(res.dag_id)
      setDagDetail({
        dag_id: res.dag_id,
        user_id: res.user_id,
        title: res.title,
        description: res.description,
        source_type: 'council',
        status: res.status,
        goal_id: res.goal_id,
        council_question: null,
        nodes: res.nodes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
      })
      document.getElementById('plans-section')?.scrollIntoView({ behavior: 'smooth' })
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const body = e.body as { message?: string } | null
        setDagError(body?.message ?? 'Plan generation failed — outside advisory scope.')
      } else {
        setDagError(e instanceof Error ? e.message : 'Plan generation failed')
      }
    } finally {
      setGoalPlanLoading(null)
    }
  }

  // --- DAG handlers ---
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

  const handleArchiveDag = async (dagId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await archiveDag(dagId)
      if (expandedDagId === dagId) {
        setExpandedDagId(null)
        setDagDetail(null)
      }
      await fetchDags()
    } catch { /* ignore */ }
  }

  // Build a goal label lookup for linking
  const goalLabelMap: Record<number, string> = {}
  for (const g of goals) {
    goalLabelMap[g.id] = g.summary_label || g.raw_text
  }

  const hasPending = dagDetail?.nodes.some((n) => n.status === 'pending')
  const hasApproved = dagDetail?.nodes.some((n) => n.status === 'approved')

  return (
    <div className="space-y-8">
      {/* ===== Section 1: Ask Your Adviser ===== */}
      <section id="adviser-section">
        <h2 className="text-lg font-extrabold mb-4">Ask Your Adviser</h2>

        {activeGoalId && goalLabelMap[activeGoalId] && (
          <div className="flex items-center gap-2 mb-3 text-xs">
            <span className="inline-flex items-center rounded-full bg-ws-purple/10 text-ws-purple px-2.5 py-1 font-medium">
              Linked to: {goalLabelMap[activeGoalId]}
            </span>
            <button
              onClick={() => setActiveGoalId(undefined)}
              className="text-ws-muted hover:text-ws-text"
            >
              Clear
            </button>
          </div>
        )}

        <div className="flex gap-3">
          <input
            type="text"
            placeholder={mode === 'collaborative'
              ? "What's on your mind about money?"
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
            Ask
          </button>
        </div>

        {/* Mode toggle — secondary, below input */}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex rounded-lg bg-ws-surface border border-ws-border overflow-hidden">
            <button
              onClick={() => { setMode('collaborative'); setResult(null); setSimilarMatches([]); setShowSimilarBanner(false) }}
              title="Three AI specialists analyze your question together, then a chairman synthesizes one unified answer"
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'collaborative' ? 'bg-ws-accent text-white' : 'text-ws-muted hover:text-ws-text'
              }`}
            >
              Get a Recommendation
            </button>
            <button
              onClick={() => { setMode('adversarial'); setResult(null); setSimilarMatches([]); setShowSimilarBanner(false) }}
              title="A bull advocate argues for and a bear advocate argues against, then a chairman delivers a balanced verdict"
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === 'adversarial' ? 'bg-ws-accent text-white' : 'text-ws-muted hover:text-ws-text'
              }`}
            >
              Debate a Decision
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-ws-red mt-2">{error}</p>}

        {/* Similar Questions Banner */}
        {showSimilarBanner && similarMatches.length > 0 && (
          <div className="mt-3 rounded-xl bg-ws-purple/5 border border-ws-purple/20 p-4 space-y-3">
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
                      {match.goal_id && goalLabelMap[match.goal_id] && (
                        <span className="text-xs text-ws-purple/70 font-medium">
                          Goal: {goalLabelMap[match.goal_id]}
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
          <div className="mt-3">
            <LoadingSpinner
              messages={checkingSimlar ? ['Checking for similar questions...'] : COUNCIL_LOADING_MESSAGES}
              showElapsed
            />
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="mt-4 space-y-4">
            {result.mode === 'collaborative' && (
              <CollaborativeResult
                result={result as CollaborativeResponse}
                onGeneratePlan={handleGeneratePlan}
                onTrackAsGoal={handleTrackAsGoal}
                onDebateThis={handleDebateThis}
                generating={generating}
                goalLoading={goalLoading}
              />
            )}
            {result.mode === 'adversarial' && (
              <AdversarialResult
                result={result as AdversarialResponse}
                onGeneratePlan={handleGeneratePlan}
                onTrackAsGoal={handleTrackAsGoal}
                generating={generating}
                goalLoading={goalLoading}
              />
            )}

            {/* Similar goal banner — shown when Track as Goal detects duplicates */}
            {showSimilarGoalBanner && similarGoalMatches.length > 0 && (
              <SimilarGoalBanner
                matches={similarGoalMatches}
                onCreateNew={() => createGoalFromText(question.trim())}
                loading={goalLoading}
              />
            )}

            {goalError && <p className="text-sm text-ws-red">{goalError}</p>}
            {checkingGoalSimilar && <p className="text-xs text-ws-muted">Checking for similar goals...</p>}
            {goalSteps.length > 0 && !goalLoading && <ThinkingSteps steps={goalSteps} />}

            <QueryInspector result={result} />
            <ThinkingSteps steps={result.steps} />
          </div>
        )}
      </section>

      {/* ===== Section 2: Past Conversations ===== */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-extrabold">Our Past Conversations</h2>
          {sessions.length > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-ws-muted/15 text-ws-muted text-xs font-semibold px-1.5">
              {sessions.length}
            </span>
          )}
        </div>

        {sessions.length === 0 ? (
          <EmptyState message="No conversations yet" detail="Ask your adviser a question and our conversations will appear here" />
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => {
              const linkedGoalLabel = s.goal_id ? goalLabelMap[s.goal_id] : null
              const linkedPlans = dags.filter((d) => d.council_question === s.question || (s.goal_id && d.goal_id === s.goal_id))
              const isExpanded = expandedSessionId === s.session_id

              return (
                <SessionCard
                  key={s.session_id}
                  session={s}
                  expanded={isExpanded}
                  onToggle={() => setExpandedSessionId(isExpanded ? null : s.session_id)}
                  onLoad={() => handleLoadSession(s.session_id)}
                  onArchive={(e) => handleArchiveSession(s.session_id, e)}
                  linkedGoalLabel={linkedGoalLabel}
                  linkedPlanCount={linkedPlans.length}
                />
              )
            })}
          </div>
        )}
      </section>

      {/* ===== Section 3: Your Goals ===== */}
      <section ref={goalsSectionRef}>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-extrabold">Your Goals</h2>
          {goals.length > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-ws-muted/15 text-ws-muted text-xs font-semibold px-1.5">
              {goals.length}
            </span>
          )}
          {!showGoalInput && (
            <button
              onClick={() => setShowGoalInput(true)}
              className="text-xs font-semibold text-ws-accent hover:text-ws-accent-dim transition-colors ml-auto"
            >
              + Add a goal manually
            </button>
          )}
        </div>

        {/* Manual goal input — collapsible */}
        {showGoalInput && (
          <div className="mb-4">
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Describe a financial goal..."
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddGoal()}
                disabled={goalLoading}
                className="flex-1 rounded-lg bg-white border border-ws-border px-4 py-2.5 text-sm text-ws-text placeholder-ws-muted disabled:opacity-50 shadow-sm focus:outline-none focus:border-ws-accent"
              />
              <button
                onClick={handleAddGoal}
                disabled={goalLoading || !goalText.trim()}
                className="rounded-lg bg-ws-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-ws-accent-dim transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {goalLoading ? 'Analyzing...' : 'Add Goal'}
              </button>
              <button
                onClick={() => { setShowGoalInput(false); setGoalText(''); setGoalError(''); setSimilarGoalMatches([]); setShowSimilarGoalBanner(false) }}
                className="rounded-lg border border-ws-border px-3 py-2.5 text-sm text-ws-muted hover:text-ws-text transition-colors"
              >
                Cancel
              </button>
            </div>
            {goalError && <p className="text-sm text-ws-red mt-2">{goalError}</p>}
          </div>
        )}

        {/* Similar goal banner for manual add */}
        {showSimilarGoalBanner && similarGoalMatches.length > 0 && showGoalInput && (
          <SimilarGoalBanner
            matches={similarGoalMatches}
            onCreateNew={createGoalDirectly}
            loading={goalLoading}
          />
        )}

        {goalLoading && <LoadingSpinner messages={GOAL_LOADING_MESSAGES} showElapsed />}
        {goalSteps.length > 0 && !goalLoading && <ThinkingSteps steps={goalSteps} />}

        {/* Goal Cards */}
        {goals.length === 0 && !goalLoading ? (
          <EmptyState
            message="No goals yet"
            detail="Goals emerge from conversations — ask your adviser a question, then track it as a goal. Or add one manually above."
          />
        ) : (
          <div className="space-y-3">
            {goals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                expanded={expandedGoalId === goal.id}
                onToggle={() => setExpandedGoalId(expandedGoalId === goal.id ? null : goal.id)}
                onGetAdvice={() => handleGetAdvice(goal)}
                onCreatePlan={() => handleCreateGoalPlan(goal)}
                onArchive={() => handleDeleteGoal(goal.id)}
                planLoading={goalPlanLoading === goal.id}
                linkedDags={dags.filter((d) => d.goal_id === goal.id)}
                linkedSessions={sessions.filter((s) => s.goal_id === goal.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ===== Section 4: Your Action Plans ===== */}
      <section id="plans-section">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-extrabold">Your Action Plans</h2>
          {dags.length > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-ws-muted/15 text-ws-muted text-xs font-semibold px-1.5">
              {dags.length}
            </span>
          )}
        </div>

        {generating && <LoadingSpinner messages={GENERATE_MESSAGES} showElapsed />}
        {dagError && <p className="text-sm text-ws-red mb-3">{dagError}</p>}

        {dags.length === 0 && !generating ? (
          <EmptyState message="No action plans yet" detail="Ask your adviser a question and create a plan from the results, or generate one from a goal" />
        ) : (
          <div className="space-y-3">
            {dags.map((d) => {
              const isExpanded = expandedDagId === d.dag_id
              return (
                <div key={d.dag_id} className="rounded-xl bg-white border border-ws-border shadow-sm overflow-hidden">
                  {/* Header — always visible, same pattern as sessions and goals */}
                  <button
                    onClick={() => selectDag(d.dag_id)}
                    className="w-full text-left px-5 py-4 hover:bg-ws-surface/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold truncate flex-1">{d.title}</span>
                      <span className="text-xs text-ws-muted shrink-0">{new Date(d.created_at).toLocaleDateString()}</span>
                      <span className="text-xs text-ws-muted">{isExpanded ? '▼' : '▶'}</span>
                    </div>
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-5 pb-4 border-t border-ws-border pt-3 space-y-3">
                      {/* Metadata badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={d.status} />
                        <StatusBadge status={d.source_type} />
                        <span className="text-xs text-ws-muted">{d.completed_nodes}/{d.node_count} steps</span>
                        {d.goal_id && goalLabelMap[d.goal_id] && (
                          <span className="inline-flex items-center rounded-full bg-ws-purple/10 text-ws-purple px-2 py-0.5 text-xs font-medium">
                            For: {goalLabelMap[d.goal_id]}
                          </span>
                        )}
                        {d.council_question && (
                          <span className="inline-flex items-center text-xs text-ws-muted truncate max-w-[300px]" title={d.council_question}>
                            From: &ldquo;{d.council_question.substring(0, 50)}{d.council_question.length > 50 ? '...' : ''}&rdquo;
                          </span>
                        )}
                      </div>

                      {dagDetailLoading ? (
                        <LoadingSpinner />
                      ) : dagDetail ? (
                        <>
                          <p className="text-xs text-ws-muted">{dagDetail.description}</p>

                          <div className="space-y-0">
                            {dagDetail.nodes.map((node, i) => (
                              <NodeCard key={node.node_key} node={node} isLast={i === dagDetail.nodes.length - 1} />
                            ))}
                          </div>

                          {genSteps.length > 0 && <ThinkingSteps steps={genSteps} />}
                          {execSteps.length > 0 && <ThinkingSteps steps={execSteps} />}

                          {/* Actions */}
                          <div className="flex items-center gap-2 pt-1">
                            {hasPending && (
                              <button
                                onClick={handleApproveAll}
                                disabled={dagActionLoading}
                                className="rounded-lg bg-ws-accent px-4 py-2 text-xs font-semibold text-white hover:bg-ws-accent-dim transition-colors disabled:opacity-50"
                              >
                                {dagActionLoading ? 'Approving...' : 'Approve All'}
                              </button>
                            )}
                            {hasApproved && (
                              <button
                                onClick={handleExecute}
                                disabled={dagActionLoading}
                                className="rounded-lg bg-ws-blue px-4 py-2 text-xs font-semibold text-white hover:bg-ws-blue/80 transition-colors disabled:opacity-50"
                              >
                                {dagActionLoading ? 'Executing...' : 'Execute'}
                              </button>
                            )}
                            <button
                              onClick={(e) => handleArchiveDag(d.dag_id, e)}
                              className="ml-auto rounded-lg border border-ws-border px-3 py-2 text-xs text-ws-muted hover:text-ws-red hover:border-ws-red/30 transition-colors"
                            >
                              Archive
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

// =====================
// Sub-components
// =====================

function SimilarGoalBanner({
  matches,
  onCreateNew,
  loading,
}: {
  matches: SimilarGoalMatch[]
  onCreateNew: () => void
  loading: boolean
}) {
  return (
    <div className="rounded-xl bg-ws-orange/5 border border-ws-orange/20 p-4 space-y-3 mb-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ws-orange">Similar goal already exists</span>
        <button
          onClick={onCreateNew}
          disabled={loading}
          className="rounded-lg bg-ws-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-ws-accent-dim transition-colors disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create New Anyway'}
        </button>
      </div>
      <div className="space-y-2">
        {matches.map((m) => (
          <div key={m.id} className="flex items-center gap-3 rounded-lg bg-white border border-ws-border p-3 shadow-sm">
            <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${feasibilityColors[m.feasibility] ?? 'bg-ws-muted'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ws-text truncate">{m.summary_label || m.raw_text}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-ws-muted">{Math.round(m.similarity * 100)}% similar</span>
                <span className="text-xs text-ws-muted">{new Date(m.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SessionCard({
  session,
  expanded,
  onToggle,
  onLoad,
  onArchive,
  linkedGoalLabel,
  linkedPlanCount,
}: {
  session: CouncilSessionSummary
  expanded: boolean
  onToggle: () => void
  onLoad: () => void
  onArchive: (e: React.MouseEvent) => void
  linkedGoalLabel: string | null
  linkedPlanCount: number
}) {
  return (
    <div className="rounded-xl bg-white border border-ws-border shadow-sm overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-4 hover:bg-ws-surface/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold flex-1 truncate">{session.question}</span>
          <span className="text-xs text-ws-muted shrink-0">
            {new Date(session.created_at).toLocaleDateString()}
          </span>
          <span className="text-xs text-ws-muted">{expanded ? '▼' : '▶'}</span>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-5 pb-4 border-t border-ws-border pt-3 space-y-3">
          {/* Metadata badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={session.mode} />
            {session.elapsed_ms != null && (
              <span className="text-xs text-ws-muted">{(session.elapsed_ms / 1000).toFixed(1)}s</span>
            )}
            {linkedGoalLabel && (
              <span className="inline-flex items-center rounded-full bg-ws-purple/10 text-ws-purple px-2 py-0.5 text-xs font-medium">
                Goal: {linkedGoalLabel}
              </span>
            )}
            {linkedPlanCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-ws-accent/10 text-ws-accent px-2 py-0.5 text-xs font-medium">
                {linkedPlanCount} plan{linkedPlanCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Synthesis preview */}
          {session.synthesis && (
            <p className="text-xs text-ws-muted">{session.synthesis.substring(0, 300)}{session.synthesis.length > 300 ? '...' : ''}</p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={(e) => { e.stopPropagation(); onLoad() }}
              className="rounded-lg bg-ws-accent px-4 py-2 text-xs font-semibold text-white hover:bg-ws-accent-dim transition-colors"
            >
              Load Conversation
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onArchive(e) }}
              className="ml-auto rounded-lg border border-ws-border px-3 py-2 text-xs text-ws-muted hover:text-ws-red hover:border-ws-red/30 transition-colors"
            >
              Archive
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function GoalCard({
  goal,
  expanded,
  onToggle,
  onGetAdvice,
  onCreatePlan,
  onArchive,
  planLoading,
  linkedDags,
  linkedSessions,
}: {
  goal: Goal
  expanded: boolean
  onToggle: () => void
  onGetAdvice: () => void
  onCreatePlan: () => void
  onArchive: () => void
  planLoading: boolean
  linkedDags: DagSummary[]
  linkedSessions: CouncilSessionSummary[]
}) {
  return (
    <div className="rounded-xl bg-white border border-ws-border shadow-sm overflow-hidden">
      {/* Header — always visible, same pattern as sessions and plans */}
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-4 hover:bg-ws-surface/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold flex-1 truncate">
            {goal.summary_label || goal.raw_text}
          </span>
          <span className="text-xs text-ws-muted shrink-0">
            {goal.created_at ? new Date(goal.created_at).toLocaleDateString() : ''}
          </span>
          <span className="text-xs text-ws-muted">{expanded ? '▼' : '▶'}</span>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-5 pb-4 border-t border-ws-border pt-3 space-y-3">
          {/* Metadata badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${goalTypeBadgeColors[goal.goal_type] ?? goalTypeBadgeColors.other}`}>
              {goalTypeLabel(goal.goal_type)}
            </span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
              goal.feasibility === 'green' ? 'bg-ws-green/15 text-ws-green'
                : goal.feasibility === 'yellow' ? 'bg-ws-orange/15 text-ws-orange'
                : 'bg-ws-red/15 text-ws-red'
            }`}>
              {feasibilityLabels[goal.feasibility] ?? goal.feasibility}
            </span>
            {linkedSessions.length > 0 && (
              <span className="inline-flex items-center rounded-full bg-ws-purple/10 text-ws-purple px-2 py-0.5 text-xs font-medium">
                {linkedSessions.length} discussion{linkedSessions.length !== 1 ? 's' : ''}
              </span>
            )}
            {linkedDags.length > 0 && (
              <span className="inline-flex items-center rounded-full bg-ws-accent/10 text-ws-accent px-2 py-0.5 text-xs font-medium">
                {linkedDags.length} plan{linkedDags.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Progress bar */}
          {goal.target_amount != null && (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-ws-border rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    goal.feasibility === 'green' ? 'bg-ws-green'
                      : goal.feasibility === 'yellow' ? 'bg-ws-orange'
                      : 'bg-ws-red'
                  }`}
                  style={{ width: `${Math.min(goal.progress_pct, 100)}%` }}
                />
              </div>
              <span className="text-xs text-ws-muted shrink-0">{Math.round(goal.progress_pct)}%</span>
              <span className="text-xs text-ws-muted shrink-0">
                Target: ${goal.target_amount.toLocaleString()}
              </span>
            </div>
          )}

          {/* Assessment */}
          <div className="prose prose-sm max-w-none">
            <MarkdownContent content={goal.feasibility_assessment} />
          </div>

          {/* Target date */}
          {goal.target_date && (
            <p className="text-xs text-ws-muted">
              Target date: {new Date(goal.target_date).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          )}

          {/* Cross-goal impacts */}
          {goal.cross_goal_impact.length > 0 && (
            <div className="rounded-lg bg-ws-orange/5 border border-ws-orange/20 p-3">
              <p className="text-xs font-semibold text-ws-orange mb-1">Cross-Goal Impacts</p>
              <ul className="list-disc list-inside text-xs text-ws-text space-y-0.5">
                {goal.cross_goal_impact.map((impact, i) => (
                  <li key={i}>{impact}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={(e) => { e.stopPropagation(); onGetAdvice() }}
              className="rounded-lg bg-ws-accent px-4 py-2 text-xs font-semibold text-white hover:bg-ws-accent-dim transition-colors"
            >
              Get Advice
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onCreatePlan() }}
              disabled={planLoading}
              className="rounded-lg bg-ws-purple px-4 py-2 text-xs font-semibold text-white hover:bg-ws-purple/80 transition-colors disabled:opacity-50"
            >
              {planLoading ? 'Generating...' : 'Create Action Plan'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onArchive() }}
              className="ml-auto rounded-lg border border-ws-border px-3 py-2 text-xs text-ws-muted hover:text-ws-red hover:border-ws-red/30 transition-colors"
            >
              Archive
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CollaborativeResult({
  result,
  onGeneratePlan,
  onTrackAsGoal,
  onDebateThis,
  generating,
  goalLoading,
}: {
  result: CollaborativeResponse
  onGeneratePlan: () => void
  onTrackAsGoal: () => void
  onDebateThis: () => void
  generating: boolean
  goalLoading: boolean
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="space-y-4">
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

      <div className="rounded-xl bg-ws-accent/5 border border-ws-accent/20 p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold text-ws-accent">Synthesis</span>
          <div className="flex items-center gap-2">
            <button
              onClick={onTrackAsGoal}
              disabled={goalLoading}
              className="rounded-lg border border-ws-accent text-ws-accent px-3 py-1.5 text-xs font-semibold hover:bg-ws-accent hover:text-white transition-colors disabled:opacity-50"
            >
              {goalLoading ? 'Creating...' : 'Track as Goal'}
            </button>
            <button
              onClick={onDebateThis}
              className="rounded-lg border border-ws-border text-ws-muted px-3 py-1.5 text-xs font-semibold hover:text-ws-text hover:border-ws-accent/30 transition-colors"
            >
              Debate This?
            </button>
            <button
              onClick={onGeneratePlan}
              disabled={generating}
              className="rounded-lg bg-ws-purple px-4 py-2 text-sm font-semibold text-white hover:bg-ws-purple/80 transition-colors disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Create Action Plan'}
            </button>
          </div>
        </div>
        <MarkdownContent content={result.synthesis} />
        <div className="mt-3 text-xs text-ws-muted">
          {(result.elapsed_ms / 1000).toFixed(1)}s total
        </div>
      </div>
    </div>
  )
}

function AdversarialResult({
  result,
  onGeneratePlan,
  onTrackAsGoal,
  generating,
  goalLoading,
}: {
  result: AdversarialResponse
  onGeneratePlan: () => void
  onTrackAsGoal: () => void
  generating: boolean
  goalLoading: boolean
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const cases = [
    { key: 'bull', label: 'Bull Advocate', color: 'text-ws-green', data: result.bull_case },
    { key: 'bear', label: 'Bear Advocate', color: 'text-ws-red', data: result.bear_case },
  ]

  return (
    <div className="space-y-4">
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

      <div className="rounded-xl bg-ws-accent/5 border border-ws-accent/20 p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold text-ws-accent">Verdict</span>
          <div className="flex items-center gap-2">
            <button
              onClick={onTrackAsGoal}
              disabled={goalLoading}
              className="rounded-lg border border-ws-accent text-ws-accent px-3 py-1.5 text-xs font-semibold hover:bg-ws-accent hover:text-white transition-colors disabled:opacity-50"
            >
              {goalLoading ? 'Creating...' : 'Track as Goal'}
            </button>
            <button
              onClick={onGeneratePlan}
              disabled={generating}
              className="rounded-lg bg-ws-purple px-4 py-2 text-sm font-semibold text-white hover:bg-ws-purple/80 transition-colors disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Create Action Plan'}
            </button>
          </div>
        </div>
        <MarkdownContent content={result.chairman_verdict.content} />
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
      <div className="flex flex-col items-center mr-4 w-4">
        <div className={`h-3 w-3 rounded-full shrink-0 mt-5 ${statusDotStyles[node.status] ?? 'bg-ws-muted'}`} />
        {!isLast && <div className="w-px flex-1 bg-ws-border" />}
      </div>
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
