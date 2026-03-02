"""
LLM Guardrails — Inbound + Outbound Financial Advisory Scope.

Validates user inputs before LLM calls (inbound) and checks LLM responses
for compliance issues after rehydration (outbound).

Architecture:
  User Input → Inbound Guardrail → PII Filter → LLM → PII Rehydrate → Outbound Guardrail → Response

Production evolution path:
  - MVP (current): Keyword/pattern matching. Fast, zero-cost, no false positives on common queries.
    Catches obvious off-topic and prompt injection.
  - Production: Fine-tuned classifier (BERT/DistilBERT on financial vs non-financial corpus) deployed
    on Triton. Context-aware classification using twin state (e.g., user holds Chewy stock →
    "tell me about cats" might be financial). Outbound classifier trained on regulatory compliance
    corpus. Extract to separate service behind same interface.
  - Interface stability: GuardrailResult dataclass and validate_inbound/validate_outbound signatures
    designed to remain stable when implementation evolves from regex to classifier.
"""

import re
import logging
from dataclasses import dataclass

logger = logging.getLogger("onboarding")


@dataclass
class GuardrailResult:
    """Result of a guardrail validation check."""
    passed: bool
    reason: str | None = None   # Human-readable explanation if blocked
    code: str | None = None     # Machine-readable: "off_topic", "prompt_injection", "compliance", etc.


# Maximum input length (characters)
MAX_INPUT_LENGTH = 2000

# ----- Inbound: Prompt injection patterns -----
_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?previous\s+instructions",
    r"ignore\s+(all\s+)?prior\s+instructions",
    r"ignore\s+(all\s+)?above\s+instructions",
    r"disregard\s+(all\s+)?previous",
    r"you\s+are\s+now\s+(a|an)\s+(?!financial)",
    r"forget\s+(all\s+)?your\s+(previous\s+)?instructions",
    r"new\s+system\s+prompt",
    r"override\s+(your\s+)?(system|instructions)",
    r"act\s+as\s+(a|an)\s+(?!financial)",
    r"pretend\s+(you('re|\s+are)\s+)?(a|an)\s+(?!financial)",
    r"jailbreak",
    r"do\s+anything\s+now",
    r"DAN\s+mode",
]
_INJECTION_RE = re.compile("|".join(_INJECTION_PATTERNS), re.IGNORECASE)

# ----- Inbound: Off-topic patterns -----
_OFF_TOPIC_PATTERNS = [
    # Code generation
    r"write\s+(me\s+)?(a\s+)?(python|javascript|java|c\+\+|ruby|go|rust|sql|html|css)\b",
    r"write\s+(me\s+)?(a\s+)?function\b",
    r"write\s+(me\s+)?(a\s+)?script\b",
    r"write\s+(me\s+)?(a\s+)?program\b",
    r"create\s+(a\s+)?(python|javascript|java|sql)\b",
    r"code\s+(for|to|that)\b",
    r"debug\s+(this|my)\s+(code|script|program)",
    # Creative writing
    r"write\s+(me\s+)?(a\s+)?(poem|story|song|essay|novel|haiku|limerick)\b",
    r"compose\s+(a\s+)?(poem|song|melody|lyric)",
    r"tell\s+(me\s+)?(a\s+)?(story|joke|riddle)\b",
    # Medical/legal
    r"\b(diagnose|diagnosis|symptoms?\s+of|medical\s+condition)\b",
    r"\b(legal\s+case|lawsuit|sue\s+(him|her|them)|legal\s+advice)\b",
    # Unrelated topics
    r"\b(recipe\s+for|how\s+to\s+cook|cooking\s+instructions)\b",
    r"\b(sports?\s+scores?|game\s+results?|who\s+won\s+the)\b",
    r"\b(movie\s+review|film\s+review|rate\s+this\s+movie)\b",
    r"\b(weather\s+(in|for|today|tomorrow|forecast))\b",
    r"\b(translate\s+(this|from|to|into))\b",
]
_OFF_TOPIC_RE = re.compile("|".join(_OFF_TOPIC_PATTERNS), re.IGNORECASE)

# ----- Inbound: Financial keywords (permissive pass) -----
_FINANCIAL_KEYWORDS = [
    "budget", "save", "saving", "savings", "invest", "investing", "investment",
    "mortgage", "rrsp", "tfsa", "resp", "fhsa", "credit", "debt", "income",
    "expense", "expenses", "retirement", "insurance", "tax", "taxes",
    "house", "home", "rent", "renting", "loan", "interest", "portfolio",
    "stock", "stocks", "etf", "dividend", "dividends", "net worth",
    "emergency fund", "down payment", "refinance", "amortization",
    "financial", "finance", "money", "bank", "banking", "account",
    "balance", "payment", "pay off", "payoff", "afford", "spend", "spending",
    "allocation", "asset", "assets", "liability", "liabilities",
    "pension", "annuity", "bond", "bonds", "mutual fund", "gic",
    "capital gains", "inflation", "compound", "apr", "heloc",
    "chequing", "checking", "credit card", "visa", "mastercard",
    "wealth", "salary", "wage", "wages", "bonus", "raise",
    "cost of living", "cash flow", "net income", "gross income",
]
_FINANCIAL_RE = re.compile(
    r"\b(" + "|".join(re.escape(kw) for kw in _FINANCIAL_KEYWORDS) + r")\b",
    re.IGNORECASE,
)

# ----- Outbound: Compliance patterns -----
_RETURN_PROMISE_PATTERNS = [
    r"guaranteed\s+return",
    r"guaranteed\s+to\s+(earn|make|grow|return|yield)",
    r"will\s+earn\s+\d+\s*%",
    r"risk[- ]free\s+return",
    r"guaranteed\s+\d+\s*%",
    r"promise\s+(you|a)\s+\d+\s*%\s+return",
]
_RETURN_PROMISE_RE = re.compile("|".join(_RETURN_PROMISE_PATTERNS), re.IGNORECASE)

_PROFESSIONAL_ADVICE_PATTERNS = [
    r"as\s+your\s+(tax|legal|financial)\s+advis[eo]r",
    r"I\s+recommend\s+you\s+file\s+your\s+taxes\s+as",
    r"you\s+should\s+claim\s+.{0,30}(deduction|credit|exemption)",
    r"I\s+am\s+(a\s+)?(certified|licensed|registered)\s+(financial|tax|investment)",
]
_PROFESSIONAL_ADVICE_RE = re.compile("|".join(_PROFESSIONAL_ADVICE_PATTERNS), re.IGNORECASE)

_HARMFUL_PATTERNS = [
    r"take\s+out\s+a\s+payday\s+loan",
    r"cash\s+advance\s+to\s+invest",
    r"borrow\s+(money\s+)?to\s+gamble",
    r"max\s+out\s+your\s+credit\s+cards?\s+to\s+invest",
    r"withdraw\s+(from\s+)?(your\s+)?retirement\s+to\s+gamble",
]
_HARMFUL_RE = re.compile("|".join(_HARMFUL_PATTERNS), re.IGNORECASE)

OUTBOUND_DISCLAIMER = (
    "\n\n---\n*This is informational only and does not constitute professional financial, tax, or investment advice. "
    "Consult a qualified professional before making financial decisions.*"
)

# ----- System prompt reinforcement -----
SYSTEM_GUARDRAIL = (
    "\n\nIMPORTANT: You are a financial advisory assistant. "
    "Only respond to questions related to personal finance, budgeting, investing, debt management, "
    "savings, retirement planning, insurance, real estate, and related financial topics. "
    "If a question is clearly unrelated to finance, politely decline and redirect to financial topics. "
    "Never provide specific tax filing advice, guarantee investment returns, or recommend illegal financial activities. "
    "Always clarify that your responses are informational and not professional financial advice."
)


def validate_inbound(text: str, context: str | None = None) -> GuardrailResult:
    """
    Validate user input before PII anonymization and LLM calls.

    Checks (in order):
    1. Empty or too long → reject
    2. Prompt injection patterns → reject
    3. Off-topic patterns → reject
    4. Financial keyword found → pass immediately
    5. Otherwise → pass (ambiguous input let through; system prompts keep LLM on-topic)
    """
    # 1. Basic validation
    if not text or not text.strip():
        return GuardrailResult(
            passed=False,
            reason="Please enter a question or description.",
            code="invalid_input",
        )

    if len(text) > MAX_INPUT_LENGTH:
        return GuardrailResult(
            passed=False,
            reason=f"Input is too long ({len(text)} characters). Please keep it under {MAX_INPUT_LENGTH} characters.",
            code="invalid_input",
        )

    stripped = text.strip()

    # 2. Prompt injection detection
    if _INJECTION_RE.search(stripped):
        logger.warning("Guardrail → blocked prompt injection: '%s'", stripped[:80])
        return GuardrailResult(
            passed=False,
            reason="That looks like it might be trying to modify the system's behavior. Please ask a financial question instead.",
            code="prompt_injection",
        )

    # 3. Off-topic detection (only if no financial keywords present)
    has_financial = bool(_FINANCIAL_RE.search(stripped))

    if not has_financial and _OFF_TOPIC_RE.search(stripped):
        logger.info("Guardrail → blocked off-topic: '%s'", stripped[:80])
        return GuardrailResult(
            passed=False,
            reason="That doesn't appear to be related to your finances. Try asking about your budget, investments, savings goals, or financial health.",
            code="off_topic",
        )

    # 4 & 5. Financial keyword found or ambiguous → pass
    return GuardrailResult(passed=True)


def validate_outbound(text: str) -> GuardrailResult:
    """
    Check LLM response for compliance issues after rehydration.

    Flags problematic content and appends a disclaimer — does NOT block.
    Returns the (possibly modified) text via the reason field when flagged.
    """
    if not text:
        return GuardrailResult(passed=True)

    flagged_code = None

    # 1. Specific return promises
    if _RETURN_PROMISE_RE.search(text):
        flagged_code = "compliance_return_promise"
        logger.info("Guardrail → flagged return promise in outbound")

    # 2. Unauthorized professional advice
    elif _PROFESSIONAL_ADVICE_RE.search(text):
        flagged_code = "compliance_professional_advice"
        logger.info("Guardrail → flagged professional advice in outbound")

    # 3. Harmful financial recommendations
    elif _HARMFUL_RE.search(text):
        flagged_code = "compliance_harmful"
        logger.info("Guardrail → flagged harmful recommendation in outbound")

    if flagged_code:
        return GuardrailResult(
            passed=True,  # Don't block, just flag
            reason=text + OUTBOUND_DISCLAIMER,
            code=flagged_code,
        )

    return GuardrailResult(passed=True)


def apply_outbound(text: str) -> str:
    """Convenience: validate outbound and return the (possibly disclaimered) text."""
    result = validate_outbound(text)
    if result.code and result.reason:
        return result.reason
    return text
