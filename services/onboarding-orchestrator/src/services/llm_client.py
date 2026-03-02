"""
Lightweight multi-provider LLM client for the onboarding orchestrator.
Adapted from Jarvis-EA llm_client.py — supports Anthropic, OpenAI, and Gemini.
"""

import json
import logging
import time
from typing import Any

from .http_client import get_http_client

logger = logging.getLogger("onboarding")

# API endpoints
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


def _mask_key(key: str) -> str:
    """Mask an API key for safe logging — show first 8 and last 4 chars."""
    if len(key) <= 16:
        return "***"
    return f"{key[:8]}...{key[-4:]}"


async def query_llm(
    prompt: str,
    system: str = "",
    provider: str = "",
    model: str = "",
    api_key: str = "",
    max_tokens: int = 1024,
    temperature: float = 0.2,
    timeout: float = 60.0,
) -> dict | None:
    """
    Query an LLM provider and return the response.

    Args:
        provider: "anthropic", "openai", or "gemini"
        model: Provider-specific model ID (e.g. "claude-opus-4-6")
        api_key: API key for the provider

    Returns dict with 'content' (str) and 'tokens' (dict) on success, None on failure.
    """
    if not api_key:
        logger.error("LLM query failed: no API key for provider %s", provider)
        return None

    logger.debug(
        "LLMClient → provider=%s model=%s key=%s max_tokens=%d temperature=%.1f timeout=%.0fs",
        provider, model, _mask_key(api_key), max_tokens, temperature, timeout,
    )

    start = time.monotonic()

    if provider == "anthropic":
        result = await _query_anthropic(model, prompt, system, api_key, max_tokens, temperature, timeout)
    elif provider == "openai":
        result = await _query_openai(model, prompt, system, api_key, max_tokens, temperature, timeout)
    elif provider == "gemini":
        result = await _query_gemini(model, prompt, system, api_key, max_tokens, temperature, timeout)
    else:
        logger.error("Unknown LLM provider: %s", provider)
        return None

    elapsed_ms = round((time.monotonic() - start) * 1000)
    if result:
        logger.debug(
            "LLMClient ← response in %dms tokens=%s content_length=%d",
            elapsed_ms, result.get("tokens"), len(result.get("content", "")),
        )
    else:
        logger.warning("LLMClient ← failed after %dms", elapsed_ms)

    return result


async def _query_anthropic(
    model: str, prompt: str, system: str, api_key: str,
    max_tokens: int, temperature: float, timeout: float,
) -> dict | None:
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if system:
        payload["system"] = system

    logger.debug("LLMClient → Anthropic POST %s model=%s", ANTHROPIC_API_URL, model)

    try:
        client = await get_http_client()
        resp = await client.post(ANTHROPIC_API_URL, headers=headers, json=payload, timeout=timeout)
        logger.debug("LLMClient ← Anthropic status=%d", resp.status_code)
        resp.raise_for_status()
        data = resp.json()
        content = data.get("content", [{}])[0].get("text", "")
        usage = data.get("usage", {})
        tokens = {
            "input": usage.get("input_tokens", 0),
            "output": usage.get("output_tokens", 0),
            "total": usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
        }
        return {"content": content, "tokens": tokens}
    except Exception as e:
        logger.error("Anthropic query failed (%s): %s", model, e)
        return None


async def _query_openai(
    model: str, prompt: str, system: str, api_key: str,
    max_tokens: int, temperature: float, timeout: float,
) -> dict | None:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    logger.debug("LLMClient → OpenAI POST %s model=%s", OPENAI_CHAT_URL, model)

    try:
        client = await get_http_client()
        resp = await client.post(OPENAI_CHAT_URL, headers=headers, json=payload, timeout=timeout)
        logger.debug("LLMClient ← OpenAI status=%d", resp.status_code)
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        tokens = {
            "input": usage.get("prompt_tokens", 0),
            "output": usage.get("completion_tokens", 0),
            "total": usage.get("total_tokens", 0),
        }
        return {"content": content, "tokens": tokens}
    except Exception as e:
        logger.error("OpenAI query failed (%s): %s", model, e)
        return None


async def _query_gemini(
    model: str, prompt: str, system: str, api_key: str,
    max_tokens: int, temperature: float, timeout: float,
) -> dict | None:
    url = f"{GEMINI_API_BASE}/{model}:generateContent"
    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}

    contents = []
    if system:
        contents.append({"role": "user", "parts": [{"text": system}]})
        contents.append({"role": "model", "parts": [{"text": "Understood."}]})
    contents.append({"role": "user", "parts": [{"text": prompt}]})

    payload: dict[str, Any] = {"contents": contents}
    if max_tokens:
        payload["generationConfig"] = {
            "maxOutputTokens": max_tokens,
            "temperature": temperature,
        }

    logger.debug("LLMClient → Gemini POST %s model=%s", url, model)

    try:
        client = await get_http_client()
        resp = await client.post(url, json=payload, headers=headers, timeout=timeout)
        logger.debug("LLMClient ← Gemini status=%d", resp.status_code)
        resp.raise_for_status()
        data = resp.json()
        candidates = data.get("candidates", [])
        text = ""
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts)
        usage = data.get("usageMetadata", {})
        tokens = {
            "input": usage.get("promptTokenCount", 0),
            "output": usage.get("candidatesTokenCount", 0),
            "total": usage.get("totalTokenCount", 0),
        }
        return {"content": text, "tokens": tokens}
    except Exception as e:
        logger.error("Gemini query failed (%s): %s", model, e)
        return None


async def embed_text(text: str, api_key: str) -> list[float] | None:
    """
    Generate an embedding vector using OpenAI text-embedding-3-small (1536 dims).

    Returns list of floats on success, None on failure (consistent with query_llm pattern).
    """
    if not api_key:
        logger.error("embed_text failed: no OpenAI API key")
        return None

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "text-embedding-3-small",
        "input": text,
    }

    try:
        client = await get_http_client()
        resp = await client.post(OPENAI_EMBEDDINGS_URL, headers=headers, json=payload, timeout=15.0)
        resp.raise_for_status()
        data = resp.json()
        embedding = data["data"][0]["embedding"]
        logger.debug("embed_text ← %d dimensions", len(embedding))
        return embedding
    except Exception as e:
        logger.error("embed_text failed: %s", e)
        return None
