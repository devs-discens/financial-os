import { fetchJSON } from './client'
import type { Dag, DagSummary, GenerateDagRequest, GenerateDagResponse, ExecuteDagResponse } from '../types/dag'

export function generateDag(req: GenerateDagRequest) {
  return fetchJSON<GenerateDagResponse>('/dags/generate', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function listDags(userId: string) {
  return fetchJSON<{ dags: DagSummary[]; count: number }>(`/dags?user_id=${userId}`)
}

export function getDag(dagId: number) {
  return fetchJSON<Dag>(`/dags/${dagId}`)
}

export function approveNodes(dagId: number, nodeKeys: string[]) {
  return fetchJSON<{ approved: number; requested: number; dag: Dag }>(`/dags/${dagId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ node_keys: nodeKeys }),
  })
}

export function executeDag(dagId: number) {
  return fetchJSON<ExecuteDagResponse>(`/dags/${dagId}/execute`, {
    method: 'POST',
  })
}

export function archiveDag(dagId: number) {
  return fetchJSON<{ status: string; dag_id: number }>(`/dags/${dagId}`, {
    method: 'DELETE',
  })
}
