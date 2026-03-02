import type { ThinkingStep } from './council'

export type NodeType = 'check' | 'transfer' | 'allocate' | 'council' | 'manual'
export type ExecutionType = 'auto' | 'manual' | 'approval_required'
export type NodeStatus = 'pending' | 'approved' | 'executing' | 'completed' | 'failed'
export type DagStatus = 'draft' | 'pending_approval' | 'executing' | 'completed' | 'failed'

export interface DagNode {
  id: number
  dag_id: number
  node_key: string
  title: string
  description: string
  node_type: NodeType
  execution_type: ExecutionType
  status: NodeStatus
  depends_on: string[]
  prerequisites: Record<string, unknown>
  result: Record<string, unknown> | null
  instructions: string | null
  checked: boolean
  checked_at: string | null
}

export interface Dag {
  dag_id: number
  user_id: string
  title: string
  description: string
  source_type: 'manual' | 'council'
  status: DagStatus
  goal_id?: number | null
  council_question: string | null
  nodes: DagNode[]
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface DagSummary {
  dag_id: number
  title: string
  description: string
  source_type: 'manual' | 'council'
  status: DagStatus
  goal_id?: number | null
  council_question?: string | null
  node_count: number
  completed_nodes: number
  created_at: string
  completed_at: string | null
}

export interface GenerateDagRequest {
  user_id: string
  question: string
  council_synthesis?: string
  goal_id?: number
}

export interface GenerateDagResponse {
  dag_id: number
  user_id: string
  title: string
  description: string
  status: 'draft'
  goal_id?: number | null
  nodes: DagNode[]
  steps: ThinkingStep[]
  elapsed_ms: number
}

export interface ExecuteDagResponse {
  dag_id: number
  status: 'completed' | 'failed'
  results: Array<{
    node_key: string
    status: 'completed' | 'failed'
    error?: string
  }>
  steps: ThinkingStep[]
  elapsed_ms: number
}
