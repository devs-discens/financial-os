"""
PII entity detector — finds PII in text using known entity lists and regex patterns.

The caller provides known entities (names, institutions) when creating a session.
The detector uses these as a lookup list rather than attempting NER. Regex patterns
handle structured PII (dollar amounts, account numbers, dates, percentages).
"""

import logging
import re
from dataclasses import dataclass

logger = logging.getLogger("pii-filter")


@dataclass
class Detection:
    entity_type: str  # "name", "amount", "account_number", "institution", "date", "percentage"
    value: str
    start: int
    end: int


# ── Regex patterns ──

# Dollar amounts: $1,234.56 or $1234.56 or $1,234 or $1234
AMOUNT_PATTERN = re.compile(r'\$[\d,]+(?:\.\d{1,2})?')

# Account numbers: 4+ consecutive digits (not part of a larger word)
ACCOUNT_NUMBER_PATTERN = re.compile(r'\b\d{4,}\b')

# Dates: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, Month DD YYYY, etc.
DATE_PATTERNS = [
    re.compile(r'\b\d{4}-\d{2}-\d{2}\b'),                          # 2026-01-15
    re.compile(r'\b\d{1,2}/\d{1,2}/\d{4}\b'),                      # 01/15/2026
    re.compile(r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b', re.IGNORECASE),  # January 15, 2026
    re.compile(r'\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b', re.IGNORECASE),    # 15 January 2026
]

# Percentages: 4.89% or 0.5%
PERCENTAGE_PATTERN = re.compile(r'\b\d+(?:\.\d+)?%')


def detect(text: str, known_entities: dict) -> list[Detection]:
    """
    Detect PII entities in text.

    known_entities format:
    {
        "names": ["Alex Chen", "Jane Doe"],
        "institutions": ["Maple Direct", "Heritage Financial"],
    }

    Returns list of Detection objects sorted by start position, longest first
    for overlapping detections.
    """
    detections: list[Detection] = []

    # ── Known entity matching (names, institutions) ──
    for name in known_entities.get("names", []):
        for match in re.finditer(re.escape(name), text, re.IGNORECASE):
            detections.append(Detection("name", match.group(), match.start(), match.end()))

    for inst in known_entities.get("institutions", []):
        for match in re.finditer(re.escape(inst), text, re.IGNORECASE):
            detections.append(Detection("institution", match.group(), match.start(), match.end()))

    # ── Dollar amounts ──
    for match in AMOUNT_PATTERN.finditer(text):
        detections.append(Detection("amount", match.group(), match.start(), match.end()))

    # ── Percentages (before account numbers to avoid overlap) ──
    percentage_spans = set()
    for match in PERCENTAGE_PATTERN.finditer(text):
        detections.append(Detection("percentage", match.group(), match.start(), match.end()))
        percentage_spans.add((match.start(), match.end()))

    # ── Account numbers (skip if overlaps with amount or percentage) ──
    amount_spans = {(d.start, d.end) for d in detections if d.entity_type == "amount"}
    for match in ACCOUNT_NUMBER_PATTERN.finditer(text):
        span = (match.start(), match.end())
        # Skip if this digit sequence is part of a dollar amount, percentage, or date
        overlaps = False
        for existing_start, existing_end in amount_spans | percentage_spans:
            if match.start() >= existing_start and match.end() <= existing_end:
                overlaps = True
                break
        if not overlaps:
            detections.append(Detection("account_number", match.group(), match.start(), match.end()))

    # ── Dates ──
    for pattern in DATE_PATTERNS:
        for match in pattern.finditer(text):
            detections.append(Detection("date", match.group(), match.start(), match.end()))

    # Deduplicate overlapping detections — keep the longest match
    detections = _deduplicate(detections)

    logger.debug(
        "Detector → found %d entities: %s",
        len(detections),
        [(d.entity_type, d.value) for d in detections],
    )

    return detections


def _deduplicate(detections: list[Detection]) -> list[Detection]:
    """Remove overlapping detections, keeping the longest match."""
    if not detections:
        return detections

    # Sort by start position, then by length descending (prefer longer matches)
    detections.sort(key=lambda d: (d.start, -(d.end - d.start)))

    result = []
    last_end = -1
    for d in detections:
        if d.start >= last_end:
            result.append(d)
            last_end = d.end

    return result
