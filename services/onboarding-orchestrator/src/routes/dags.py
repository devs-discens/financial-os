import logging
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..db.database import get_pool
from ..services import dag_engine
from ..services.guardrails import validate_inbound
from ..middleware.auth import get_optional_user, resolve_user_id, AuthUser

logger = logging.getLogger("onboarding")
router = APIRouter(prefix="/dags", tags=["dags"])


class GenerateRequest(BaseModel):
    user_id: str = "alex-chen"
    question: str
    council_synthesis: str | None = None
    goal_id: int | None = None


class ApproveRequest(BaseModel):
    node_keys: list[str]


class ToggleNodeRequest(BaseModel):
    checked: bool


@router.post("/generate")
async def generate_dag(
    req: GenerateRequest,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    req.user_id = resolve_user_id(auth_user, req.user_id)

    guard = validate_inbound(req.question)
    if not guard.passed:
        return JSONResponse(status_code=422, content={"error": guard.code, "message": guard.reason})

    pool = get_pool()
    try:
        result = await dag_engine.generate_dag(
            pool, req.user_id, req.question, req.council_synthesis, req.goal_id,
        )
        return result
    except (ValueError, RuntimeError) as e:
        logger.error("DAG generate failed: %s", e)
        raise HTTPException(502, str(e))


@router.get("")
async def list_dags(
    user_id: str = Query("alex-chen"),
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    user_id = resolve_user_id(auth_user, user_id)
    pool = get_pool()
    dags = await dag_engine.list_dags(pool, user_id)
    return {"dags": dags, "count": len(dags)}


@router.get("/{dag_id}")
async def get_dag(dag_id: int):
    pool = get_pool()
    dag = await dag_engine.get_dag(pool, dag_id)
    if dag is None:
        raise HTTPException(404, f"DAG {dag_id} not found")
    return dag


@router.delete("/{dag_id}")
async def archive_dag(
    dag_id: int,
    auth_user: AuthUser | None = Depends(get_optional_user),
):
    """Archive (soft-delete) an action plan."""
    pool = get_pool()
    archived = await dag_engine.archive_dag(pool, dag_id)
    if not archived:
        raise HTTPException(404, f"DAG {dag_id} not found or already archived")
    return {"status": "archived", "dag_id": dag_id}


@router.patch("/{dag_id}/nodes/{node_key}")
async def toggle_node_checked(dag_id: int, node_key: str, req: ToggleNodeRequest):
    pool = get_pool()
    updated = await dag_engine.toggle_node_checked(pool, dag_id, node_key, req.checked)
    if not updated:
        raise HTTPException(404, f"Node '{node_key}' not found in DAG {dag_id}")
    dag = await dag_engine.get_dag(pool, dag_id)
    return dag


@router.post("/{dag_id}/approve")
async def approve_nodes(dag_id: int, req: ApproveRequest):
    pool = get_pool()
    result = await dag_engine.approve_nodes(pool, dag_id, req.node_keys)
    return result


@router.post("/{dag_id}/execute")
async def execute_dag(dag_id: int):
    pool = get_pool()
    result = await dag_engine.execute_dag(pool, dag_id)
    return result
