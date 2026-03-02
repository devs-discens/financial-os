"""
Debug endpoints for testing LLM client and other internal services.
Only registered when LOG_LEVEL=DEBUG — never exposed in production.
"""

import logging
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import settings
from ..services.llm_client import query_llm

logger = logging.getLogger("onboarding")
router = APIRouter(prefix="/debug", tags=["debug"])


class LLMRequest(BaseModel):
    prompt: str
    provider: str = ""
    model: str = ""
    system_prompt: str = ""
    max_tokens: int = 1024
    temperature: float = 0.2


@router.post("/llm")
async def debug_llm(req: LLMRequest):
    """Direct LLM query for testing — provider/model default to config settings."""
    provider = req.provider or settings.llm_provider
    model = req.model or settings.llm_model

    api_keys = {
        "anthropic": settings.anthropic_api_key,
        "openai": settings.openai_api_key,
        "gemini": settings.gemini_api_key,
    }
    api_key = api_keys.get(provider, "")

    if not api_key:
        raise HTTPException(status_code=400, detail=f"No API key configured for provider: {provider}")

    logger.debug(
        "DebugLLM → provider=%s model=%s prompt_length=%d system_length=%d",
        provider, model, len(req.prompt), len(req.system_prompt),
    )

    start = time.monotonic()
    result = await query_llm(
        prompt=req.prompt,
        system=req.system_prompt,
        provider=provider,
        model=model,
        api_key=api_key,
        max_tokens=req.max_tokens,
        temperature=req.temperature,
    )
    elapsed_ms = round((time.monotonic() - start) * 1000)

    if result is None:
        raise HTTPException(status_code=502, detail=f"LLM query failed for provider: {provider}")

    logger.debug(
        "DebugLLM ← provider=%s model=%s elapsed=%dms tokens=%s",
        provider, model, elapsed_ms, result.get("tokens"),
    )

    return {
        "content": result["content"],
        "tokens": result["tokens"],
        "provider": provider,
        "model": model,
        "elapsed_ms": elapsed_ms,
    }
