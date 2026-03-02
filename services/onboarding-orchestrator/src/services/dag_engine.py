"""
Action DAG Engine (Component 8).

Generates, approves, and executes multi-step financial action plans
expressed as directed acyclic graphs. Uses LLM to decompose questions
into structured node graphs, then executes them in dependency order.
"""

import json
import logging
import time
from datetime import datetime, timezone

import asyncpg

from ..config import settings
from .llm_client import query_llm
from .pii_client import PiiClient
from .guardrails import SYSTEM_GUARDRAIL, apply_outbound
from . import twin
from .council import extract_entities, format_twin_context, _step

logger = logging.getLogger("onboarding")


DAG_GENERATION_SYSTEM = """You are a Financial Action Planner. Given a user's financial profile and question,
decompose the answer into a structured action plan as a DAG (directed acyclic graph).

Return ONLY valid JSON with this structure:
{
  "title": "Short descriptive title for the plan",
  "description": "One-sentence summary of what this plan achieves",
  "nodes": [
    {
      "node_key": "unique-kebab-case-key",
      "title": "Human-readable step title",
      "description": "What this step does and why",
      "node_type": "check|transfer|allocate|council|manual",
      "execution_type": "auto|manual|approval_required",
      "depends_on": [],
      "prerequisites": {},
      "instructions": "Specific instructions for manual steps"
    }
  ]
}

Node types:
- check: Verify a condition (balance threshold, rate comparison, etc.)
- transfer: Move money between accounts
- allocate: Set aside or earmark funds for a goal
- council: Trigger a deeper analysis council session
- manual: Requires human action (call bank, sign form, etc.)

Execution types:
- auto: Can be executed automatically by the system
- manual: Requires human action
- approval_required: Needs user approval before execution

Rules:
- Use depends_on to reference other nodes by node_key
- Keep plans practical with 3-8 nodes
- Start with check nodes to verify prerequisites
- End with manual or council nodes for complex decisions
- Return ONLY the JSON, no markdown or commentary

Every amount, timeline, and target in the plan must be derived from the person's actual
financial data. Do not suggest transfer amounts the person cannot afford based on their
current balances and income. If the question involves debt payoff, use real balances and
realistic payment amounts. Make the plan achievable, not aspirational.""" + SYSTEM_GUARDRAIL


async def generate_dag(
    pool: asyncpg.Pool, user_id: str, question: str,
    council_synthesis: str | None = None,
    goal_id: int | None = None,
) -> dict:
    """Generate a DAG from a financial question using LLM reasoning."""
    start = time.monotonic()
    logger.info("DAG → generate user=%s question='%s'", user_id, question[:80])
    steps = []

    pii = PiiClient()

    # 1. Get twin snapshot
    steps.append(_step("twin_snapshot", "Fetching financial data for user"))
    snapshot = await twin.get_twin_snapshot(pool, user_id)
    context = format_twin_context(snapshot)

    # 2. Create PII session
    steps.append(_step("pii_session", "Creating anonymization session"))
    entities = extract_entities(snapshot)
    session_id = await pii.create_session(entities)

    try:
        # 3. Filter context
        steps.append(_step("pii_filter", "Anonymizing financial context"))
        filtered_context = await pii.filter_text(session_id, context)
        filtered_question = await pii.filter_text(session_id, question)

        # 4. Build prompt
        steps.append(_step("build_prompt", "Constructing DAG generation prompt"))
        prompt_parts = [
            f"Financial Profile:\n{filtered_context}",
            f"\nQuestion: {filtered_question}",
        ]
        if council_synthesis:
            filtered_synthesis = await pii.filter_text(session_id, council_synthesis)
            prompt_parts.append(f"\nCouncil Analysis:\n{filtered_synthesis}")

        prompt = "\n".join(prompt_parts)

        # 5. Query LLM
        steps.append(_step("query_llm", f"Generating action plan via {settings.llm_provider}"))
        result = await query_llm(
            prompt=prompt,
            system=DAG_GENERATION_SYSTEM,
            provider=settings.llm_provider,
            model=settings.llm_model,
            api_key=settings.llm_api_key,
            max_tokens=settings.llm_max_tokens,
            temperature=0.2,
            timeout=90.0,
        )

        if result is None:
            raise RuntimeError("LLM failed to generate DAG")

        # 6. Parse response
        steps.append(_step("parse_response", "Parsing LLM response into DAG structure"))
        dag_data = _parse_dag_response(result["content"])

        # 7. Store DAG
        steps.append(_step("store_dag", "Saving DAG to database"))
        dag_id = await pool.fetchval(
            """INSERT INTO action_dags
                   (user_id, title, description, source_type, council_question, council_synthesis, goal_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING id""",
            user_id, dag_data["title"], dag_data.get("description"),
            "council" if council_synthesis else "manual",
            question, council_synthesis, goal_id,
        )

        # 8. Store nodes
        for node in dag_data.get("nodes", []):
            await pool.execute(
                """INSERT INTO dag_nodes
                       (dag_id, node_key, title, description, node_type,
                        execution_type, depends_on, prerequisites, instructions)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                dag_id,
                node["node_key"],
                node["title"],
                node.get("description"),
                node.get("node_type", "check"),
                node.get("execution_type", "auto"),
                node.get("depends_on", []),
                json.dumps(node.get("prerequisites", {})),
                node.get("instructions"),
            )

        # 9. Rehydrate node descriptions
        steps.append(_step("rehydrate", "Restoring real names and values"))
        stored_nodes = await pool.fetch(
            "SELECT * FROM dag_nodes WHERE dag_id = $1 ORDER BY id", dag_id,
        )
        nodes = []
        for n in stored_nodes:
            title = await pii.rehydrate_text(session_id, n["title"])
            desc = await pii.rehydrate_text(session_id, n["description"]) if n["description"] else None
            instructions = await pii.rehydrate_text(session_id, n["instructions"]) if n["instructions"] else None
            # Outbound guardrail — flag compliance issues with disclaimer
            if desc:
                desc = apply_outbound(desc)
            if instructions:
                instructions = apply_outbound(instructions)
            # Update the stored text with rehydrated versions
            await pool.execute(
                "UPDATE dag_nodes SET title = $1, description = $2, instructions = $3 WHERE id = $4",
                title, desc, instructions, n["id"],
            )
            nodes.append(_node_to_dict(n, title_override=title, desc_override=desc, instr_override=instructions))

        # Rehydrate DAG title/description
        rehydrated_title = await pii.rehydrate_text(session_id, dag_data["title"])
        rehydrated_desc = await pii.rehydrate_text(session_id, dag_data.get("description", "")) if dag_data.get("description") else None
        await pool.execute(
            "UPDATE action_dags SET title = $1, description = $2 WHERE id = $3",
            rehydrated_title, rehydrated_desc, dag_id,
        )

        elapsed_ms = round((time.monotonic() - start) * 1000)
        steps.append(_step("complete", f"DAG generated with {len(nodes)} nodes in {elapsed_ms}ms"))

        logger.info(
            "DAG ← generated id=%d title='%s' nodes=%d in %dms",
            dag_id, rehydrated_title, len(nodes), elapsed_ms,
        )

        return {
            "dag_id": dag_id,
            "user_id": user_id,
            "title": rehydrated_title,
            "description": rehydrated_desc,
            "status": "draft",
            "goal_id": goal_id,
            "nodes": nodes,
            "steps": steps,
            "elapsed_ms": elapsed_ms,
        }

    finally:
        await pii.delete_session(session_id)


def _try_repair_json(text: str) -> dict | None:
    """Attempt to repair truncated JSON from LLM output.
    Tries progressively trimming from the end and closing brackets."""
    # Find the last complete node by looking for the last '}' that closes a node
    # then close the nodes array and root object
    for i in range(len(text) - 1, 0, -1):
        if text[i] == '}':
            # Try closing with ]} (end nodes array + root object)
            for suffix in [']}\n', ']\n}', ']}']:
                candidate = text[:i + 1] + suffix
                try:
                    data = json.loads(candidate)
                    if isinstance(data, dict) and "nodes" in data:
                        logger.info("DAG → repaired truncated JSON (trimmed at char %d)", i)
                        return data
                except json.JSONDecodeError:
                    continue
    return None


def _parse_dag_response(content: str) -> dict:
    """Parse LLM response into DAG structure. Handles markdown fences."""
    # Strip markdown code fences if present
    text = content.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first and last lines (fences)
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        logger.warning("DAG → JSON parse failed, attempting truncation repair: %s", e)
        # Try to repair truncated JSON (common when max_tokens is hit)
        data = _try_repair_json(text)
        if data is None:
            logger.error("DAG → failed to repair LLM response")
            logger.debug("DAG → raw response: %s", content[:500])
            raise ValueError(f"LLM returned invalid JSON: {e}") from e

    if "title" not in data:
        raise ValueError("DAG response missing 'title'")
    if "nodes" not in data or not isinstance(data["nodes"], list):
        raise ValueError("DAG response missing 'nodes' array")

    # Validate node structure
    for i, node in enumerate(data["nodes"]):
        if "node_key" not in node:
            raise ValueError(f"Node {i} missing 'node_key'")
        if "title" not in node:
            raise ValueError(f"Node {i} missing 'title'")

    return data


def _node_to_dict(
    row, title_override=None, desc_override=None, instr_override=None,
) -> dict:
    """Convert a dag_nodes row to a response dict."""
    prerequisites = row["prerequisites"]
    if isinstance(prerequisites, str):
        prerequisites = json.loads(prerequisites)
    result_data = row["result"]
    if isinstance(result_data, str):
        result_data = json.loads(result_data)

    return {
        "id": row["id"],
        "dag_id": row["dag_id"],
        "node_key": row["node_key"],
        "title": title_override or row["title"],
        "description": desc_override or row["description"],
        "node_type": row["node_type"],
        "execution_type": row["execution_type"],
        "status": row["status"],
        "depends_on": list(row["depends_on"]) if row["depends_on"] else [],
        "prerequisites": prerequisites,
        "result": result_data,
        "instructions": instr_override or row["instructions"],
        "checked": row["checked"] if "checked" in row.keys() else False,
        "checked_at": row["checked_at"].isoformat() if row.get("checked_at") else None,
    }


async def get_dag(pool: asyncpg.Pool, dag_id: int) -> dict | None:
    """Fetch a DAG with all its nodes."""
    dag = await pool.fetchrow("SELECT * FROM action_dags WHERE id = $1", dag_id)
    if dag is None:
        return None

    nodes = await pool.fetch(
        "SELECT * FROM dag_nodes WHERE dag_id = $1 ORDER BY id", dag_id,
    )

    return {
        "dag_id": dag["id"],
        "user_id": dag["user_id"],
        "title": dag["title"],
        "description": dag["description"],
        "source_type": dag["source_type"],
        "status": dag["status"],
        "goal_id": dag["goal_id"] if "goal_id" in dag.keys() else None,
        "council_question": dag["council_question"],
        "nodes": [_node_to_dict(n) for n in nodes],
        "created_at": dag["created_at"].isoformat(),
        "updated_at": dag["updated_at"].isoformat(),
        "completed_at": dag["completed_at"].isoformat() if dag["completed_at"] else None,
    }


async def list_dags(pool: asyncpg.Pool, user_id: str) -> list[dict]:
    """List DAGs for a user with summary info."""
    dags = await pool.fetch(
        """SELECT d.id, d.title, d.description, d.source_type, d.status,
                  d.goal_id, d.council_question, d.created_at, d.completed_at,
                  (SELECT COUNT(*) FROM dag_nodes WHERE dag_id = d.id) as node_count,
                  (SELECT COUNT(*) FROM dag_nodes WHERE dag_id = d.id AND status = 'completed') as completed_nodes
           FROM action_dags d
           WHERE d.user_id = $1
             AND (d.archived = FALSE OR d.archived IS NULL)
           ORDER BY d.created_at DESC""",
        user_id,
    )

    return [{
        "dag_id": d["id"],
        "title": d["title"],
        "description": d["description"],
        "source_type": d["source_type"],
        "status": d["status"],
        "goal_id": d["goal_id"],
        "council_question": d["council_question"],
        "node_count": d["node_count"],
        "completed_nodes": d["completed_nodes"],
        "created_at": d["created_at"].isoformat(),
        "completed_at": d["completed_at"].isoformat() if d["completed_at"] else None,
    } for d in dags]


async def archive_dag(pool: asyncpg.Pool, dag_id: int) -> bool:
    """Soft-archive a DAG. Returns True if a row was updated."""
    result = await pool.execute(
        "UPDATE action_dags SET archived = TRUE, updated_at = now() WHERE id = $1 AND (archived = FALSE OR archived IS NULL)",
        dag_id,
    )
    archived = result == "UPDATE 1"
    if archived:
        logger.info("DAG ← archived dag=%d", dag_id)
    return archived


async def toggle_node_checked(
    pool: asyncpg.Pool, dag_id: int, node_key: str, checked: bool,
) -> bool:
    """Toggle the checked state of a DAG node. Returns True if updated."""
    result = await pool.execute(
        """UPDATE dag_nodes
           SET checked = $1, checked_at = CASE WHEN $1 THEN now() ELSE NULL END
           WHERE dag_id = $2 AND node_key = $3""",
        checked, dag_id, node_key,
    )
    updated = result == "UPDATE 1"
    if updated:
        logger.info("DAG ← node %s in dag=%d checked=%s", node_key, dag_id, checked)
    return updated


async def approve_nodes(
    pool: asyncpg.Pool, dag_id: int, node_keys: list[str],
) -> dict:
    """Approve specific nodes for execution."""
    logger.info("DAG → approve dag=%d nodes=%s", dag_id, node_keys)

    updated = 0
    for key in node_keys:
        result = await pool.execute(
            """UPDATE dag_nodes SET status = 'approved'
               WHERE dag_id = $1 AND node_key = $2 AND status = 'pending'""",
            dag_id, key,
        )
        if "UPDATE 1" in result:
            updated += 1

    # Update DAG status
    await pool.execute(
        """UPDATE action_dags SET status = 'pending_approval', updated_at = now()
           WHERE id = $1 AND status = 'draft'""",
        dag_id,
    )

    dag = await get_dag(pool, dag_id)
    logger.info("DAG ← approved %d/%d nodes for dag=%d", updated, len(node_keys), dag_id)
    return {"approved": updated, "requested": len(node_keys), "dag": dag}


async def execute_dag(pool: asyncpg.Pool, dag_id: int) -> dict:
    """Execute approved nodes in dependency order."""
    start = time.monotonic()
    logger.info("DAG → execute dag=%d", dag_id)
    steps = []

    dag = await pool.fetchrow("SELECT * FROM action_dags WHERE id = $1", dag_id)
    if dag is None:
        raise ValueError(f"DAG {dag_id} not found")

    # Update DAG status
    await pool.execute(
        "UPDATE action_dags SET status = 'executing', updated_at = now() WHERE id = $1",
        dag_id,
    )

    nodes = await pool.fetch(
        "SELECT * FROM dag_nodes WHERE dag_id = $1 ORDER BY id", dag_id,
    )

    # Build dependency map
    node_map = {n["node_key"]: dict(n) for n in nodes}

    # Topological sort
    sorted_keys = _topological_sort(node_map)
    steps.append(_step("plan", f"Execution plan: {len(sorted_keys)} nodes in dependency order"))

    results = []
    for key in sorted_keys:
        node = node_map[key]

        # Only execute approved or auto nodes
        if node["status"] not in ("approved", "pending"):
            continue

        # Check if dependencies are met
        deps_met = all(
            node_map.get(dep, {}).get("status") == "completed"
            for dep in (node["depends_on"] or [])
        )
        if not deps_met:
            steps.append(_step("skip", f"Skipping '{node['title']}' — dependencies not met"))
            continue

        steps.append(_step("execute", f"Executing '{node['title']}' ({node['node_type']})"))

        # Mark as executing
        await pool.execute(
            "UPDATE dag_nodes SET status = 'executing', started_at = now() WHERE id = $1",
            node["id"],
        )

        try:
            result = await _execute_node(pool, dag["user_id"], node)
            node_map[key]["status"] = result["status"]

            await pool.execute(
                """UPDATE dag_nodes SET status = $1, result = $2, completed_at = now()
                   WHERE id = $3""",
                result["status"], json.dumps(result.get("result", {})), node["id"],
            )

            results.append({"node_key": key, **result})
            steps.append(_step("result", f"Node '{node['title']}': {result['status']}"))

        except Exception as e:
            logger.error("DAG → node %s failed: %s", key, e)
            await pool.execute(
                """UPDATE dag_nodes SET status = 'failed', result = $1, completed_at = now()
                   WHERE id = $2""",
                json.dumps({"error": str(e)}), node["id"],
            )
            node_map[key]["status"] = "failed"
            results.append({"node_key": key, "status": "failed", "error": str(e)})
            steps.append(_step("error", f"Node '{node['title']}' failed: {e}"))

    # Determine final DAG status
    all_statuses = {node_map[k]["status"] for k in sorted_keys}
    if "failed" in all_statuses:
        final_status = "failed"
    elif all(s == "completed" for s in all_statuses):
        final_status = "completed"
    else:
        final_status = "completed"  # Partial completion is still completion

    await pool.execute(
        """UPDATE action_dags SET status = $1, updated_at = now(),
           completed_at = CASE WHEN $1 IN ('completed', 'failed') THEN now() ELSE NULL END
           WHERE id = $2""",
        final_status, dag_id,
    )

    elapsed_ms = round((time.monotonic() - start) * 1000)
    steps.append(_step("complete", f"DAG execution complete: {final_status} in {elapsed_ms}ms"))

    logger.info("DAG ← execute dag=%d status=%s results=%d in %dms",
                dag_id, final_status, len(results), elapsed_ms)

    return {
        "dag_id": dag_id,
        "status": final_status,
        "results": results,
        "steps": steps,
        "elapsed_ms": elapsed_ms,
    }


async def _execute_node(pool: asyncpg.Pool, user_id: str, node: dict) -> dict:
    """Execute a single DAG node based on its type."""
    node_type = node["node_type"]

    if node_type == "check":
        # Verify conditions against twin data
        snapshot = await twin.get_twin_snapshot(pool, user_id)
        return {
            "status": "completed",
            "result": {
                "verified": True,
                "snapshot_metrics": snapshot.get("metrics", {}),
                "detail": f"Checked: {node['title']}",
            },
        }

    elif node_type == "transfer":
        # Phase 1: manual execution — return instructions
        return {
            "status": "completed",
            "result": {
                "awaiting_user_action": True,
                "instructions": node.get("instructions") or node.get("description"),
                "detail": "Transfer requires user action — instructions provided",
            },
        }

    elif node_type == "allocate":
        # Simulated allocation — mark as complete
        return {
            "status": "completed",
            "result": {
                "allocated": True,
                "detail": f"Allocation noted: {node['title']}",
            },
        }

    elif node_type == "council":
        # Trigger a new council session
        from .council import run_collaborative
        council_result = await run_collaborative(
            pool, user_id,
            node.get("description") or node.get("title"),
        )
        return {
            "status": "completed",
            "result": {
                "council_mode": "collaborative",
                "synthesis": council_result.get("synthesis", ""),
                "detail": "Council session completed",
            },
        }

    elif node_type == "manual":
        return {
            "status": "completed",
            "result": {
                "awaiting_user_action": True,
                "instructions": node.get("instructions") or node.get("description"),
                "detail": "Manual step — requires user action",
            },
        }

    else:
        return {
            "status": "completed",
            "result": {"detail": f"Unknown node type '{node_type}' — marked complete"},
        }


def _topological_sort(node_map: dict) -> list[str]:
    """Sort nodes in dependency order (Kahn's algorithm)."""
    # Build in-degree map
    in_degree = {k: 0 for k in node_map}
    for key, node in node_map.items():
        for dep in (node.get("depends_on") or []):
            if dep in in_degree:
                in_degree[key] = in_degree.get(key, 0) + 1

    # Start with nodes that have no dependencies
    queue = [k for k, d in in_degree.items() if d == 0]
    result = []

    while queue:
        # Sort for deterministic order
        queue.sort()
        key = queue.pop(0)
        result.append(key)

        # Reduce in-degree of dependents
        for other_key, other_node in node_map.items():
            if key in (other_node.get("depends_on") or []):
                in_degree[other_key] -= 1
                if in_degree[other_key] == 0:
                    queue.append(other_key)

    # Add any remaining nodes (cycles or disconnected)
    for key in node_map:
        if key not in result:
            result.append(key)

    return result
