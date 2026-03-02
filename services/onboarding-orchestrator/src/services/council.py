"""
LLM Council — multi-model reasoning over Digital Financial Twin data.

Two modes:
  - Collaborative: 3 specialists (analyst/strategist/planner) + chairman synthesis
  - Adversarial: bull/bear debate + chairman verdict

All LLM calls go through the PII Filter Gateway for anonymization.
"""

import asyncio
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

logger = logging.getLogger("onboarding")

# Default models per provider for council members
COUNCIL_MODELS = {
    "anthropic": "claude-sonnet-4-20250514",
    "openai": "gpt-4o",
    "gemini": "gemini-2.0-flash",
}

# Provider rotation for council members
PROVIDERS = ["anthropic", "openai", "gemini"]

# Appended to all specialist system prompts to ensure grounding in real data
_GROUNDING = (
    " Ground all analysis in the person's actual financial data provided."
    " Use specific numbers from their profile — real balances, rates, income figures."
    " Be honest about risks and trade-offs. Do not minimize difficulties or"
    " over-promise outcomes. A truthful assessment that helps someone make a"
    " real decision is more valuable than an optimistic one that misleads."
)


def _get_api_key(provider: str) -> str:
    """Get the API key for a given provider from settings."""
    keys = {
        "anthropic": settings.anthropic_api_key,
        "openai": settings.openai_api_key,
        "gemini": settings.gemini_api_key,
    }
    return keys.get(provider, "")


def _step(action: str, detail: str) -> dict:
    """Create a timestamped thinking step entry."""
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "detail": detail,
    }


def extract_entities(snapshot: dict) -> dict:
    """Extract known PII entities from a twin snapshot for PII session creation."""
    names = set()
    institutions = set()

    # User ID often contains a real name pattern
    user_id = snapshot.get("user_id", "")
    if user_id:
        # Convert "alex-chen" → "Alex Chen"
        name = " ".join(part.capitalize() for part in user_id.split("-"))
        if len(name) > 2:
            names.add(name)

    # Institution names from connections
    for conn in snapshot.get("connections", []):
        inst_name = conn.get("institution_name")
        if inst_name:
            institutions.add(inst_name)

    return {
        "names": list(names),
        "institutions": list(institutions),
    }


def format_twin_context(snapshot: dict) -> str:
    """Format twin snapshot data into a human-readable text block for LLM consumption."""
    user_id = snapshot.get("user_id", "unknown")
    # Convert user_id to display name
    display_name = " ".join(part.capitalize() for part in user_id.split("-"))

    metrics = snapshot.get("metrics", {})
    net_worth = metrics.get("net_worth", 0)
    total_assets = metrics.get("total_assets", 0)
    total_liabilities = metrics.get("total_liabilities", 0)

    accounts = snapshot.get("accounts", [])

    lines = [
        f"Financial Profile for {display_name}:",
        f"- Net worth: ${net_worth:,.2f}",
        f"- Total assets: ${total_assets:,.2f} across {len([a for a in accounts if a.get('account_category') in ('DEPOSIT_ACCOUNT',)])} deposit accounts",
        f"- Total liabilities: ${total_liabilities:,.2f}",
        "",
        "Accounts:",
    ]

    # Group accounts by institution
    by_institution: dict[str, list] = {}
    for acct in accounts:
        inst = acct.get("institution_id", "unknown")
        by_institution.setdefault(inst, []).append(acct)

    for inst_id, inst_accounts in by_institution.items():
        for acct in inst_accounts:
            display = acct.get("display_name", acct.get("account_id", ""))
            balance = float(acct.get("balance", 0))
            acct_type = acct.get("account_type", "")
            category = acct.get("account_category", "")
            detail = f"  - {display} ({acct_type}, {category}) at {inst_id}: ${balance:,.2f}"

            # Surface mortgage details so LLMs understand the net worth breakdown
            raw = acct.get("raw_data")
            if raw and category == "LOAN_ACCOUNT":
                if isinstance(raw, str):
                    try:
                        raw = json.loads(raw)
                    except (json.JSONDecodeError, TypeError):
                        raw = {}
                if isinstance(raw, dict):
                    prop_val = raw.get("propertyValue")
                    rate = raw.get("interestRate")
                    renewal = raw.get("maturityDate")
                    extras = []
                    if prop_val:
                        equity = float(prop_val) - abs(balance)
                        extras.append(f"property value: ${float(prop_val):,.2f}, home equity: ${equity:,.2f}")
                    if rate:
                        extras.append(f"rate: {rate}%")
                    if renewal:
                        extras.append(f"renewal: {renewal}")
                    if extras:
                        detail += f" [{', '.join(extras)}]"

            lines.append(detail)

    # Income/expense from computed metrics if available
    monthly_income = metrics.get("monthly_income")
    monthly_expenses = metrics.get("monthly_expenses")
    if monthly_income is not None:
        lines.append("")
        lines.append(f"- Recent monthly income: ${float(monthly_income):,.2f}")
    if monthly_expenses is not None:
        lines.append(f"- Recent monthly expenses: ${float(monthly_expenses):,.2f}")

    txn_count = snapshot.get("transaction_count", 0)
    lines.append("")
    lines.append(f"- Transaction history: {txn_count} transactions on record")

    # Investment holdings
    holdings = snapshot.get("holdings", [])
    if holdings:
        lines.append("")
        lines.append("Investment Holdings:")
        # Group by account
        by_account: dict[str, list] = {}
        for h in holdings:
            acct = h.get("account_id", "unknown")
            by_account.setdefault(acct, []).append(h)
        for acct_id, acct_holdings in by_account.items():
            acct_total = sum(float(h.get("market_value", 0)) for h in acct_holdings)
            lines.append(f"  {acct_id} (${acct_total:,.2f} total):")
            for h in acct_holdings:
                mv = float(h.get("market_value", 0))
                cb = float(h.get("cost_basis", 0))
                gain = mv - cb
                gain_str = f"+${gain:,.2f}" if gain >= 0 else f"-${abs(gain):,.2f}"
                lines.append(
                    f"    - {h.get('symbol', '?')} ({h.get('name', '')}, {h.get('asset_class', '')}): "
                    f"${mv:,.2f} ({gain_str})"
                )

    # Active financial goals
    goals = snapshot.get("goals", [])
    if goals:
        lines.append("")
        lines.append("Active Financial Goals:")
        for g in goals:
            label = g.get("summary_label") or g.get("raw_text", "")
            target = g.get("target_amount")
            feasibility = g.get("feasibility", "unknown")
            progress = float(g.get("progress_pct", 0))
            target_str = f" (target: ${float(target):,.2f})" if target else ""
            lines.append(
                f"  - {label}{target_str} — feasibility: {feasibility}, progress: {progress:.0f}%"
            )

    return "\n".join(lines)


def _build_synthesis_prompt(question: str, responses: list[dict]) -> str:
    """Build the chairman synthesis prompt from individual council responses."""
    parts = [
        "You are the Chairman of a Financial Council. Three specialists have analyzed the same question.",
        "Your task is to synthesize their analyses into a single, cohesive recommendation.",
        "",
        f"Question: {question}",
        "",
    ]

    roles = ["Financial Analyst", "Financial Strategist", "Financial Planner"]
    for i, resp in enumerate(responses):
        role = roles[i] if i < len(roles) else f"Specialist {i + 1}"
        content = resp.get("content", "(no response)")
        parts.append(f"── {role} ──")
        parts.append(content)
        parts.append("")

    parts.extend([
        "── Your synthesis ──",
        "Synthesize the above analyses into actionable advice. Highlight key agreements,",
        "note any important disagreements, and provide a clear recommendation.",
    ])

    return "\n".join(parts)


def _build_verdict_prompt(
    question: str, bull_response: dict, bear_response: dict, context: str,
) -> str:
    """Build the chairman verdict prompt for adversarial mode."""
    bull_content = bull_response.get("content", "(no response)")
    bear_content = bear_response.get("content", "(no response)")

    return "\n".join([
        "You are the Chairman of a Financial Council presiding over a structured debate.",
        "Two advocates have presented opposing cases. Review both arguments in light of",
        "the financial data, then deliver your verdict.",
        "",
        f"Question: {question}",
        "",
        f"Financial Context:\n{context}",
        "",
        "── Bull Case (FOR) ──",
        bull_content,
        "",
        "── Bear Case (AGAINST) ──",
        bear_content,
        "",
        "── Your Verdict ──",
        "Weigh both arguments against the financial data. Identify which points are",
        "strongest, which are weakest, and deliver a clear verdict with reasoning.",
        "Include specific conditions or thresholds that would change your recommendation.",
    ])


async def _query_council_member(
    prompt: str, system: str, provider: str, role: str,
) -> dict:
    """Query a single council member LLM. Returns response dict with role metadata."""
    model = COUNCIL_MODELS.get(provider, "")
    api_key = _get_api_key(provider)

    start = time.monotonic()
    result = await query_llm(
        prompt=prompt,
        system=system,
        provider=provider,
        model=model,
        api_key=api_key,
        max_tokens=settings.llm_max_tokens,
        temperature=0.3,
        timeout=90.0,
    )
    elapsed_ms = round((time.monotonic() - start) * 1000)

    if result is None:
        logger.warning("Council ← %s (%s) failed after %dms", role, provider, elapsed_ms)
        return {
            "role": role,
            "provider": provider,
            "model": model,
            "content": f"[{role} analysis unavailable — {provider} did not respond]",
            "tokens": {"input": 0, "output": 0, "total": 0},
            "elapsed_ms": elapsed_ms,
            "error": True,
        }

    logger.info("Council ← %s (%s) responded in %dms", role, provider, elapsed_ms)
    return {
        "role": role,
        "provider": provider,
        "model": model,
        "content": result["content"],
        "tokens": result.get("tokens", {}),
        "elapsed_ms": elapsed_ms,
    }


async def run_collaborative(pool: asyncpg.Pool, user_id: str, question: str) -> dict:
    """
    Run collaborative council mode:
    3 specialists (analyst/strategist/planner) + chairman synthesis.
    """
    start = time.monotonic()
    logger.info("Council → collaborative mode user=%s question='%s'", user_id, question[:80])
    steps = []

    pii = PiiClient()

    # 1. Get twin snapshot
    steps.append(_step("twin_snapshot", "Fetching financial data for user"))
    snapshot = await twin.get_twin_snapshot(pool, user_id)
    context = format_twin_context(snapshot)

    # 2. Create PII session with known entities
    steps.append(_step("pii_session", "Creating anonymization session"))
    entities = extract_entities(snapshot)
    session_id = await pii.create_session(entities)

    try:
        # 3. Filter context + question
        steps.append(_step("pii_filter", "Anonymizing financial context and question"))
        filtered_context = await pii.filter_text(session_id, context)
        filtered_question = await pii.filter_text(session_id, question)

        # 4. Query 3 models in parallel with different roles
        analyst_prompt = (
            f"Analyze the following financial profile and answer the question.\n\n"
            f"{filtered_context}\n\n"
            f"Question: {filtered_question}"
        )
        strategist_prompt = (
            f"Review the following financial profile. Identify opportunities, risks, "
            f"and strategic considerations.\n\n"
            f"{filtered_context}\n\n"
            f"Question: {filtered_question}"
        )
        planner_prompt = (
            f"Review the following financial profile. Assess financial goals, gaps, "
            f"and create a prioritized action plan.\n\n"
            f"{filtered_context}\n\n"
            f"Question: {filtered_question}"
        )

        steps.append(_step("query_analyst", "Querying Financial Analyst"))
        steps.append(_step("query_strategist", "Querying Financial Strategist"))
        steps.append(_step("query_planner", "Querying Financial Planner"))

        responses = await asyncio.gather(
            _query_council_member(
                analyst_prompt,
                system="You are a Financial Analyst. Focus on numbers, ratios, trends, and quantitative analysis." + _GROUNDING + SYSTEM_GUARDRAIL,
                provider=PROVIDERS[0],
                role="Financial Analyst",
            ),
            _query_council_member(
                strategist_prompt,
                system="You are a Financial Strategist. Focus on opportunities, risks, market positioning, and strategic moves." + _GROUNDING + SYSTEM_GUARDRAIL,
                provider=PROVIDERS[1],
                role="Financial Strategist",
            ),
            _query_council_member(
                planner_prompt,
                system="You are a Financial Planner. Focus on goals, timelines, savings plans, and practical next steps." + _GROUNDING + SYSTEM_GUARDRAIL,
                provider=PROVIDERS[2],
                role="Financial Planner",
            ),
        )

        # 5. Chairman synthesis
        steps.append(_step("chairman_synthesis", "Chairman synthesizing specialist analyses"))
        synthesis_prompt = _build_synthesis_prompt(filtered_question, responses)
        chairman = await _query_council_member(
            synthesis_prompt,
            system="You are the Chairman of a Financial Council. Synthesize specialist analyses into clear, actionable advice." + _GROUNDING + SYSTEM_GUARDRAIL,
            provider=PROVIDERS[0],
            role="Chairman",
        )

        # 6. Rehydrate all responses
        steps.append(_step("rehydrate", "Restoring real names and values in responses"))
        rehydrated_responses = []
        for resp in responses:
            rehydrated_content = await pii.rehydrate_text(session_id, resp["content"])
            rehydrated_responses.append({**resp, "content": rehydrated_content})

        rehydrated_synthesis = await pii.rehydrate_text(session_id, chairman["content"])

        # Outbound guardrail — flag compliance issues with disclaimer
        rehydrated_synthesis = apply_outbound(rehydrated_synthesis)

        elapsed_ms = round((time.monotonic() - start) * 1000)
        steps.append(_step("complete", f"Collaborative council complete in {elapsed_ms}ms"))
        logger.info("Council ← collaborative complete in %dms", elapsed_ms)

        return {
            "mode": "collaborative",
            "user_id": user_id,
            "question": question,
            "responses": rehydrated_responses,
            "synthesis": rehydrated_synthesis,
            "chairman": {**chairman, "content": rehydrated_synthesis},
            "pii_session_id": session_id,
            "elapsed_ms": elapsed_ms,
            "steps": steps,
            "raw_context": context,
            "raw_question": question,
            "filtered_context": filtered_context,
            "filtered_question": filtered_question,
        }

    finally:
        await pii.delete_session(session_id)


async def run_adversarial(pool: asyncpg.Pool, user_id: str, question: str) -> dict:
    """
    Run adversarial/debate council mode:
    Bull/bear opening arguments + chairman verdict.
    """
    start = time.monotonic()
    logger.info("Council → adversarial mode user=%s question='%s'", user_id, question[:80])
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
        # 3. Filter context + question
        steps.append(_step("pii_filter", "Anonymizing financial context and question"))
        filtered_context = await pii.filter_text(session_id, context)
        filtered_question = await pii.filter_text(session_id, question)

        # 4. Round 1: Opening arguments (parallel, blind)
        bull_prompt = (
            f"Make the strongest possible case FOR the following proposition. "
            f"Use the financial data to support your argument.\n\n"
            f"Financial Context:\n{filtered_context}\n\n"
            f"Proposition: {filtered_question}"
        )
        bear_prompt = (
            f"Make the strongest possible case AGAINST the following proposition. "
            f"Use the financial data to support your argument.\n\n"
            f"Financial Context:\n{filtered_context}\n\n"
            f"Proposition: {filtered_question}"
        )

        steps.append(_step("query_bull", "Querying Bull Advocate"))
        steps.append(_step("query_bear", "Querying Bear Advocate"))

        bull_response, bear_response = await asyncio.gather(
            _query_council_member(
                bull_prompt,
                system="You are a Bull Advocate. Make the strongest case FOR the proposition. Be persuasive and use data." + _GROUNDING + SYSTEM_GUARDRAIL,
                provider=PROVIDERS[0],
                role="Bull Advocate",
            ),
            _query_council_member(
                bear_prompt,
                system="You are a Bear Advocate. Make the strongest case AGAINST the proposition. Be persuasive and use data." + _GROUNDING + SYSTEM_GUARDRAIL,
                provider=PROVIDERS[1],
                role="Bear Advocate",
            ),
        )

        # 5. Chairman verdict
        steps.append(_step("chairman_verdict", "Chairman reviewing arguments and delivering verdict"))
        verdict_prompt = _build_verdict_prompt(
            filtered_question, bull_response, bear_response, filtered_context,
        )
        chairman = await _query_council_member(
            verdict_prompt,
            system="You are the Chairman of a Financial Council. Deliver an impartial verdict based on the arguments and data." + _GROUNDING + SYSTEM_GUARDRAIL,
            provider=PROVIDERS[2],
            role="Chairman",
        )

        # 6. Rehydrate all responses
        steps.append(_step("rehydrate", "Restoring real names and values in responses"))
        rehydrated_bull = await pii.rehydrate_text(session_id, bull_response["content"])
        rehydrated_bear = await pii.rehydrate_text(session_id, bear_response["content"])
        rehydrated_verdict = await pii.rehydrate_text(session_id, chairman["content"])

        # Outbound guardrail — flag compliance issues with disclaimer
        rehydrated_verdict = apply_outbound(rehydrated_verdict)

        elapsed_ms = round((time.monotonic() - start) * 1000)
        steps.append(_step("complete", f"Adversarial council complete in {elapsed_ms}ms"))
        logger.info("Council ← adversarial complete in %dms", elapsed_ms)

        return {
            "mode": "adversarial",
            "user_id": user_id,
            "question": question,
            "bull_case": {**bull_response, "content": rehydrated_bull},
            "bear_case": {**bear_response, "content": rehydrated_bear},
            "chairman_verdict": {**chairman, "content": rehydrated_verdict},
            "pii_session_id": session_id,
            "elapsed_ms": elapsed_ms,
            "steps": steps,
            "raw_context": context,
            "raw_question": question,
            "filtered_context": filtered_context,
            "filtered_question": filtered_question,
        }

    finally:
        await pii.delete_session(session_id)
