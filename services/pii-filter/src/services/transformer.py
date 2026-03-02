"""
PII transformer — anonymize text and rehydrate LLM responses.

Anonymization replaces detected PII with consistent fake values per session.
Rehydration reverses the mapping, replacing anonymized values with originals.

Key design decisions:
- Names become obviously synthetic labels ("Person A", "Person B") — never
  real-sounding names that could be confused with actual people
- Institutions become "Institution A", "Institution B", etc.
- Labels rotate across sessions (random seed per session) so the same real
  user doesn't always map to the same alias — prevents temporal correlation
- Dollar amounts are proportionally shifted (not randomized) so relative
  comparisons still make sense to the LLM
- Replacements applied longest-first to avoid partial matches
- All mappings stored in the session for bidirectional lookup
"""

import logging
import re
import random
from datetime import datetime, timedelta

from .session_store import Session
from .detector import Detection

logger = logging.getLogger("pii-filter")

# ── Synthetic label pools ──
# Obviously non-real labels so no one's identity is implicated.
# The session's random seed picks a starting offset into these lists,
# so the same real person maps to different labels across sessions.
PERSON_LABELS = [
    "Person A", "Person B", "Person C", "Person D", "Person E",
    "Person F", "Person G", "Person H", "Person J", "Person K",
    "Person L", "Person M", "Person N", "Person P", "Person Q",
]

INSTITUTION_LABELS = [
    "Institution A", "Institution B", "Institution C",
    "Institution D", "Institution E", "Institution F",
    "Institution G", "Institution H",
]


def anonymize(text: str, detections: list[Detection], session: Session) -> str:
    """
    Replace detected PII entities with anonymized values.

    Uses session's stored mappings for consistency — same real value always
    maps to the same anonymized value within a session.

    Returns the anonymized text.
    """
    if not detections:
        return text

    rng = random.Random(session.seed)

    # Sort detections by start position descending so we can replace right-to-left
    # without invalidating positions
    sorted_detections = sorted(detections, key=lambda d: d.start, reverse=True)

    result = text
    entities_found = []

    for detection in sorted_detections:
        real_value = detection.value
        anonymized = _get_or_create_replacement(real_value, detection.entity_type, session, rng)
        result = result[:detection.start] + anonymized + result[detection.end:]
        entities_found.append({
            "type": detection.entity_type,
            "original": real_value,
            "replacement": anonymized,
        })

    logger.debug(
        "Transformer → anonymized %d entities, text_length %d→%d",
        len(entities_found), len(text), len(result),
    )

    return result


def rehydrate(text: str, session: Session) -> str:
    """
    Replace anonymized values in LLM response with original real values.

    Applied longest-first to avoid partial match issues (e.g., "Bank A" before "Bank").
    """
    if not session.entity_map:
        return text

    result = text

    # Sort by anonymized value length descending — replace longest first
    sorted_mappings = sorted(
        session.entity_map.items(),
        key=lambda kv: len(kv[0]),
        reverse=True,
    )

    for anonymized, real_value in sorted_mappings:
        result = result.replace(anonymized, real_value)

    logger.debug(
        "Transformer → rehydrated using %d mappings, text_length %d→%d",
        len(sorted_mappings), len(text), len(result),
    )

    return result


def _get_or_create_replacement(
    real_value: str,
    entity_type: str,
    session: Session,
    rng: random.Random,
) -> str:
    """Get existing anonymized value or create a new one. Stores in session maps."""
    # Check if we already have a mapping for this real value
    if real_value in session.reverse_map:
        return session.reverse_map[real_value]

    # Create a new anonymized value based on entity type
    if entity_type == "name":
        anonymized = _anonymize_name(real_value, session, rng)
    elif entity_type == "amount":
        anonymized = _anonymize_amount(real_value, session)
    elif entity_type == "institution":
        anonymized = _anonymize_institution(real_value, session, rng)
    elif entity_type == "account_number":
        anonymized = _anonymize_account_number(real_value, rng)
    elif entity_type == "date":
        anonymized = _anonymize_date(real_value, session)
    elif entity_type == "percentage":
        anonymized = _anonymize_percentage(real_value, session, rng)
    else:
        anonymized = "[REDACTED]"

    # Store bidirectional mapping
    session.entity_map[anonymized] = real_value
    session.reverse_map[real_value] = anonymized

    return anonymized


def _anonymize_name(name: str, session: Session, rng: random.Random) -> str:
    """Replace a name with a synthetic label (Person A, Person B, etc.).

    The session's random seed determines the starting offset into the label
    pool, so the same real person maps to different labels across sessions.
    """
    # Count how many names we've already mapped to pick the next sequential label
    name_count = sum(1 for v in session.entity_map.values()
                     if any(v == e for e in session.known_entities.get("names", [])))

    # Offset by session seed so labels rotate across sessions
    idx = (session.seed + name_count) % len(PERSON_LABELS)
    return PERSON_LABELS[idx]


def _anonymize_amount(amount_str: str, session: Session) -> str:
    """Shift dollar amount by session's consistent factor, preserving format."""
    # Parse the numeric value
    clean = amount_str.replace("$", "").replace(",", "")
    try:
        value = float(clean)
    except ValueError:
        return amount_str

    shifted = value * session.amount_factor

    # Preserve format (with/without decimals, with/without commas)
    has_decimals = "." in amount_str
    has_commas = "," in amount_str

    if has_decimals:
        formatted = f"{shifted:,.2f}" if has_commas else f"{shifted:.2f}"
    else:
        formatted = f"{int(shifted):,}" if has_commas else str(int(shifted))

    return f"${formatted}"


def _anonymize_institution(name: str, session: Session, rng: random.Random) -> str:
    """Replace institution name with a synthetic label (Institution A, etc.).

    Offset by session seed so labels rotate across sessions.
    """
    inst_count = sum(1 for v in session.entity_map.values()
                     if any(v == e for e in session.known_entities.get("institutions", [])))
    # Use a different offset than names to avoid A/A collisions
    idx = (session.seed // 7 + inst_count) % len(INSTITUTION_LABELS)
    return INSTITUTION_LABELS[idx]


def _anonymize_account_number(number: str, rng: random.Random) -> str:
    """Replace with random digits of the same length."""
    return "".join(str(rng.randint(0, 9)) for _ in range(len(number)))


def _anonymize_date(date_str: str, session: Session) -> str:
    """Shift date by session's consistent offset."""
    offset = timedelta(days=session.date_offset_days)

    # Try parsing common formats
    formats = [
        ("%Y-%m-%d", "%Y-%m-%d"),
        ("%m/%d/%Y", "%m/%d/%Y"),
        ("%d/%m/%Y", "%d/%m/%Y"),
    ]

    for parse_fmt, output_fmt in formats:
        try:
            dt = datetime.strptime(date_str, parse_fmt)
            shifted = dt + offset
            return shifted.strftime(output_fmt)
        except ValueError:
            continue

    # Try month-name formats
    month_formats = [
        ("%B %d, %Y", "%B %d, %Y"),
        ("%B %d %Y", "%B %d %Y"),
        ("%b %d, %Y", "%b %d, %Y"),
        ("%b %d %Y", "%b %d %Y"),
        ("%d %B %Y", "%d %B %Y"),
        ("%d %b %Y", "%d %b %Y"),
    ]

    for parse_fmt, output_fmt in month_formats:
        try:
            dt = datetime.strptime(date_str, parse_fmt)
            shifted = dt + offset
            return shifted.strftime(output_fmt)
        except ValueError:
            continue

    # Couldn't parse — return as-is (logged by detector)
    return date_str


def _anonymize_percentage(pct_str: str, session: Session, rng: random.Random) -> str:
    """Slightly perturb percentage value."""
    clean = pct_str.replace("%", "")
    try:
        value = float(clean)
    except ValueError:
        return pct_str

    shift = rng.uniform(-session._percentage_shift, session._percentage_shift) if hasattr(session, '_percentage_shift') else rng.uniform(-0.5, 0.5)
    shifted = value + shift

    # Preserve decimal format
    if "." in clean:
        decimal_places = len(clean.split(".")[1])
        return f"{shifted:.{decimal_places}f}%"
    else:
        return f"{shifted:.0f}%"
