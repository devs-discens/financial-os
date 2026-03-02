import asyncpg
import json
import logging
import time
from .http_client import get_http_client
from .llm_client import query_llm
from ..config import settings

logger = logging.getLogger("onboarding")

TEMPLATE_REASONING_SYSTEM = """You are a financial data integration specialist analyzing Open Banking (FDX v6) configurations for Canadian financial institutions.

Your job: analyze a bank's FDX discovery document and determine the optimal integration template for building a Digital Financial Twin.

You MUST respond with valid JSON only — no markdown, no code fences, no explanation outside the JSON. The JSON must have exactly these fields:
{
  "recommended_scopes": ["SCOPE1", "SCOPE2"],
  "mfa_required": true/false,
  "polling_interval_seconds": <integer>,
  "reasoning_text": "<one paragraph explaining your analysis>"
}

Guidelines:
- recommended_scopes: Select from the scopes_supported in the FDX config. Include all scopes that would contribute to building a comprehensive financial twin. Always include ACCOUNT_DETAILED and BALANCES if available.
- mfa_required: Determine from the institution name, capabilities, and any hints in the config. Mortgage lenders, wealth managers, and institutions with sensitive data typically require MFA.
- polling_interval_seconds: Base this on the type of institution:
  - Standard retail banking (chequing, credit cards): 300s (5 min)
  - Mortgage/loan institutions: 3600s (1 hour) — balances change slowly
  - Business banking: 600s (10 min) — more frequent transactions
  - Investment/wealth: 900s (15 min)
- reasoning_text: Explain your analysis in one clear paragraph."""


async def get_cached_template(pool: asyncpg.Pool, institution_id: str) -> dict | None:
    logger.debug("TemplateDiscovery → checking cache for %s", institution_id)
    row = await pool.fetchrow(
        "SELECT * FROM institution_templates WHERE institution_id = $1",
        institution_id,
    )
    if row is None:
        logger.debug("TemplateDiscovery ← cache miss for %s", institution_id)
        return None
    logger.debug("TemplateDiscovery ← cache hit for %s (discovered_at=%s)", institution_id, row["discovered_at"])
    return dict(row)


async def discover_and_cache_template(
    pool: asyncpg.Pool, institution_id: str, base_url: str, institution_name: str
) -> dict:
    """
    Fetch .well-known/fdx-configuration from the bank, use an LLM to reason
    over the capabilities, build a template, and cache it in PostgreSQL.
    """
    start = time.monotonic()
    logger.debug(
        "TemplateDiscovery → discover institution=%s base_url=%s",
        institution_id, base_url,
    )

    # Step 1: Fetch FDX discovery document
    fdx_url = f"{base_url}/.well-known/fdx-configuration"
    logger.debug("TemplateDiscovery → fetching FDX config from %s", fdx_url)
    client = await get_http_client()
    resp = await client.get(fdx_url)
    resp.raise_for_status()
    fdx_config = resp.json()
    logger.debug(
        "TemplateDiscovery ← FDX config: version=%s scopes=%s endpoints=%s",
        fdx_config.get("fdx_version"),
        fdx_config.get("scopes_supported"),
        list(k for k in fdx_config if "endpoint" in k),
    )

    # Step 2: LLM reasoning over capabilities
    reasoning = await _reason_over_capabilities(fdx_config, institution_name)
    logger.debug(
        "TemplateDiscovery ← reasoning result: scopes=%s mfa=%s polling=%ds",
        reasoning["recommended_scopes"], reasoning["mfa_required"],
        reasoning["polling_interval_seconds"],
    )

    # Step 3: Store template
    logger.debug("TemplateDiscovery → caching template for %s in DB", institution_id)
    await pool.execute(
        """
        INSERT INTO institution_templates
            (institution_id, institution_name, base_url, fdx_version,
             authorize_endpoint, token_endpoint, revoke_endpoint,
             accounts_endpoint, scopes_supported, mfa_required,
             polling_interval_seconds, discovery_method)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (institution_id) DO UPDATE SET
            base_url = EXCLUDED.base_url,
            authorize_endpoint = EXCLUDED.authorize_endpoint,
            token_endpoint = EXCLUDED.token_endpoint,
            revoke_endpoint = EXCLUDED.revoke_endpoint,
            accounts_endpoint = EXCLUDED.accounts_endpoint,
            scopes_supported = EXCLUDED.scopes_supported,
            mfa_required = EXCLUDED.mfa_required,
            polling_interval_seconds = EXCLUDED.polling_interval_seconds,
            discovered_at = now()
        """,
        institution_id,
        institution_name,
        base_url,
        fdx_config.get("fdx_version", "6.0"),
        fdx_config["authorization_endpoint"],
        fdx_config["token_endpoint"],
        fdx_config.get("revocation_endpoint", ""),
        fdx_config.get("accounts_endpoint", f"{base_url}/fdx/v6/accounts"),
        reasoning["recommended_scopes"],
        reasoning["mfa_required"],
        reasoning["polling_interval_seconds"],
        "llm_assisted",
    )

    elapsed_ms = round((time.monotonic() - start) * 1000)
    logger.info(
        "TemplateDiscovery complete for %s in %dms (LLM-assisted, model=%s)",
        institution_id, elapsed_ms, settings.llm_model,
    )

    template = await get_cached_template(pool, institution_id)
    return {
        **template,
        "discovery_elapsed_ms": elapsed_ms,
        "reasoning": reasoning,
    }


async def _reason_over_capabilities(fdx_config: dict, institution_name: str) -> dict:
    """
    Use a real LLM to reason over an institution's FDX capabilities.
    Falls back to heuristic-based reasoning if the LLM call fails.
    """
    prompt = (
        f"Analyze the following FDX v6 discovery document for '{institution_name}' "
        f"and determine the optimal integration template.\n\n"
        f"FDX Configuration:\n{json.dumps(fdx_config, indent=2)}"
    )

    logger.debug(
        "LLMReasoning → provider=%s model=%s prompt_length=%d system_length=%d",
        settings.llm_provider, settings.llm_model,
        len(prompt), len(TEMPLATE_REASONING_SYSTEM),
    )
    logger.debug("LLMReasoning → prompt:\n%s", prompt)

    result = await query_llm(
        prompt=prompt,
        system=TEMPLATE_REASONING_SYSTEM,
        provider=settings.llm_provider,
        model=settings.llm_model,
        api_key=settings.llm_api_key,
        max_tokens=settings.llm_max_tokens,
        temperature=0.2,
    )

    if result is not None:
        logger.debug(
            "LLMReasoning ← raw response (tokens=%s):\n%s",
            result.get("tokens"), result["content"],
        )
        try:
            # Strip any markdown code fences the LLM might add
            content = result["content"].strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[1]
            if content.endswith("```"):
                content = content.rsplit("```", 1)[0]
            content = content.strip()

            parsed = json.loads(content)
            logger.info(
                "LLMReasoning complete for %s (tokens: %s)",
                institution_name, result.get("tokens"),
            )
            return {
                "recommended_scopes": parsed["recommended_scopes"],
                "mfa_required": parsed["mfa_required"],
                "polling_interval_seconds": parsed["polling_interval_seconds"],
                "reasoning_text": parsed["reasoning_text"],
            }
        except (json.JSONDecodeError, KeyError) as e:
            logger.warning(
                "LLMReasoning ← invalid JSON for %s, falling back: %s\nRaw content: %s",
                institution_name, e, result["content"],
            )

    # Fallback: heuristic reasoning if LLM is unavailable or returns bad data
    logger.warning("LLMReasoning → using heuristic fallback for %s", institution_name)
    return _heuristic_reasoning(fdx_config, institution_name)


def _heuristic_reasoning(fdx_config: dict, institution_name: str) -> dict:
    """Fallback heuristic reasoning when LLM is unavailable."""
    scopes = fdx_config.get("scopes_supported", [])
    name_lower = institution_name.lower()

    mfa_required = any(kw in name_lower for kw in ("heritage", "mortgage", "wealth"))
    recommended_scopes = scopes if scopes else [
        "ACCOUNT_BASIC", "ACCOUNT_DETAILED", "TRANSACTIONS", "BALANCES"
    ]

    if any(kw in name_lower for kw in ("heritage", "mortgage", "loan")):
        polling_interval = 3600
    elif any(kw in name_lower for kw in ("frontier", "business")):
        polling_interval = 600
    else:
        polling_interval = 300

    result = {
        "recommended_scopes": recommended_scopes,
        "mfa_required": mfa_required,
        "polling_interval_seconds": polling_interval,
        "reasoning_text": (
            f"[Heuristic fallback] Analyzed {institution_name}'s FDX config. "
            f"Supports {len(scopes)} scopes. Polling interval: {polling_interval}s."
        ),
    }
    logger.debug("HeuristicReasoning ← result: %s", result)
    return result
