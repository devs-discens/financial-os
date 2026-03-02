"""
National and peer benchmark data for financial wellness comparisons.

All data is simulated — no real Stats Canada API. National benchmarks are
static dicts keyed by (age_bracket, income_bracket). Peer benchmarks are
deterministic functions derived from national data + demographic adjustments.

Admin overrides: stored in `benchmark_overrides` table. The `get_national_benchmark`
function accepts an optional `overrides` dict (loaded from DB by the caller) that
merges on top of the hardcoded defaults.
"""

import hashlib
import json
import logging

import asyncpg

logger = logging.getLogger("onboarding")


# ---------------------------------------------------------------------------
# Age/income bracket helpers
# ---------------------------------------------------------------------------

AGE_BRACKETS = ["25-29", "30-34", "35-39", "40-44"]
INCOME_BRACKETS = [
    "under_50k", "50k_75k", "75k_100k", "100k_125k", "125k_150k", "150k_plus",
]


def _age_bracket(age: int) -> str:
    if age < 25:
        return "25-29"
    if age < 30:
        return "25-29"
    if age < 35:
        return "30-34"
    if age < 40:
        return "35-39"
    if age < 45:
        return "40-44"
    return "40-44"


def _income_bracket(income: float) -> str:
    if income < 50000:
        return "under_50k"
    if income < 75000:
        return "50k_75k"
    if income < 100000:
        return "75k_100k"
    if income < 125000:
        return "100k_125k"
    if income < 150000:
        return "125k_150k"
    return "150k_plus"


# ---------------------------------------------------------------------------
# National benchmarks — simulated Stats Canada data
# ---------------------------------------------------------------------------

NATIONAL_BENCHMARKS: dict[tuple[str, str], dict] = {
    # 25-29 brackets
    ("25-29", "under_50k"): {
        "median_savings_rate": 0.05,
        "median_emergency_fund_months": 0.8,
        "median_dti_ratio": 0.15,
        "median_net_worth": 8000,
        "median_credit_utilization": 0.42,
        "homeownership_rate": 0.08,
    },
    ("25-29", "50k_75k"): {
        "median_savings_rate": 0.09,
        "median_emergency_fund_months": 1.4,
        "median_dti_ratio": 0.18,
        "median_net_worth": 22000,
        "median_credit_utilization": 0.32,
        "homeownership_rate": 0.15,
    },
    ("25-29", "75k_100k"): {
        "median_savings_rate": 0.12,
        "median_emergency_fund_months": 1.8,
        "median_dti_ratio": 0.19,
        "median_net_worth": 38000,
        "median_credit_utilization": 0.26,
        "homeownership_rate": 0.22,
    },
    ("25-29", "100k_125k"): {
        "median_savings_rate": 0.14,
        "median_emergency_fund_months": 2.3,
        "median_dti_ratio": 0.20,
        "median_net_worth": 55000,
        "median_credit_utilization": 0.20,
        "homeownership_rate": 0.28,
    },
    ("25-29", "125k_150k"): {
        "median_savings_rate": 0.16,
        "median_emergency_fund_months": 2.8,
        "median_dti_ratio": 0.21,
        "median_net_worth": 72000,
        "median_credit_utilization": 0.18,
        "homeownership_rate": 0.32,
    },
    ("25-29", "150k_plus"): {
        "median_savings_rate": 0.19,
        "median_emergency_fund_months": 3.5,
        "median_dti_ratio": 0.22,
        "median_net_worth": 95000,
        "median_credit_utilization": 0.14,
        "homeownership_rate": 0.38,
    },
    # 30-34 brackets
    ("30-34", "under_50k"): {
        "median_savings_rate": 0.04,
        "median_emergency_fund_months": 0.9,
        "median_dti_ratio": 0.18,
        "median_net_worth": 12000,
        "median_credit_utilization": 0.45,
        "homeownership_rate": 0.12,
    },
    ("30-34", "50k_75k"): {
        "median_savings_rate": 0.08,
        "median_emergency_fund_months": 1.6,
        "median_dti_ratio": 0.20,
        "median_net_worth": 32000,
        "median_credit_utilization": 0.34,
        "homeownership_rate": 0.22,
    },
    ("30-34", "75k_100k"): {
        "median_savings_rate": 0.11,
        "median_emergency_fund_months": 2.0,
        "median_dti_ratio": 0.21,
        "median_net_worth": 48000,
        "median_credit_utilization": 0.28,
        "homeownership_rate": 0.30,
    },
    ("30-34", "100k_125k"): {
        "median_savings_rate": 0.12,
        "median_emergency_fund_months": 2.1,
        "median_dti_ratio": 0.22,
        "median_net_worth": 62000,
        "median_credit_utilization": 0.25,
        "homeownership_rate": 0.35,
    },
    ("30-34", "125k_150k"): {
        "median_savings_rate": 0.15,
        "median_emergency_fund_months": 2.7,
        "median_dti_ratio": 0.23,
        "median_net_worth": 82000,
        "median_credit_utilization": 0.21,
        "homeownership_rate": 0.40,
    },
    ("30-34", "150k_plus"): {
        "median_savings_rate": 0.18,
        "median_emergency_fund_months": 3.4,
        "median_dti_ratio": 0.24,
        "median_net_worth": 110000,
        "median_credit_utilization": 0.16,
        "homeownership_rate": 0.45,
    },
    # 35-39 brackets
    ("35-39", "under_50k"): {
        "median_savings_rate": 0.03,
        "median_emergency_fund_months": 1.0,
        "median_dti_ratio": 0.20,
        "median_net_worth": 15000,
        "median_credit_utilization": 0.48,
        "homeownership_rate": 0.18,
    },
    ("35-39", "50k_75k"): {
        "median_savings_rate": 0.07,
        "median_emergency_fund_months": 1.7,
        "median_dti_ratio": 0.22,
        "median_net_worth": 40000,
        "median_credit_utilization": 0.36,
        "homeownership_rate": 0.30,
    },
    ("35-39", "75k_100k"): {
        "median_savings_rate": 0.10,
        "median_emergency_fund_months": 2.2,
        "median_dti_ratio": 0.23,
        "median_net_worth": 58000,
        "median_credit_utilization": 0.30,
        "homeownership_rate": 0.38,
    },
    ("35-39", "100k_125k"): {
        "median_savings_rate": 0.13,
        "median_emergency_fund_months": 2.5,
        "median_dti_ratio": 0.24,
        "median_net_worth": 78000,
        "median_credit_utilization": 0.24,
        "homeownership_rate": 0.44,
    },
    ("35-39", "125k_150k"): {
        "median_savings_rate": 0.16,
        "median_emergency_fund_months": 3.0,
        "median_dti_ratio": 0.25,
        "median_net_worth": 100000,
        "median_credit_utilization": 0.19,
        "homeownership_rate": 0.50,
    },
    ("35-39", "150k_plus"): {
        "median_savings_rate": 0.20,
        "median_emergency_fund_months": 4.0,
        "median_dti_ratio": 0.25,
        "median_net_worth": 140000,
        "median_credit_utilization": 0.14,
        "homeownership_rate": 0.55,
    },
    # 40-44 brackets
    ("40-44", "under_50k"): {
        "median_savings_rate": 0.02,
        "median_emergency_fund_months": 1.1,
        "median_dti_ratio": 0.22,
        "median_net_worth": 18000,
        "median_credit_utilization": 0.50,
        "homeownership_rate": 0.22,
    },
    ("40-44", "50k_75k"): {
        "median_savings_rate": 0.06,
        "median_emergency_fund_months": 1.8,
        "median_dti_ratio": 0.24,
        "median_net_worth": 48000,
        "median_credit_utilization": 0.38,
        "homeownership_rate": 0.35,
    },
    ("40-44", "75k_100k"): {
        "median_savings_rate": 0.09,
        "median_emergency_fund_months": 2.3,
        "median_dti_ratio": 0.25,
        "median_net_worth": 68000,
        "median_credit_utilization": 0.32,
        "homeownership_rate": 0.44,
    },
    ("40-44", "100k_125k"): {
        "median_savings_rate": 0.12,
        "median_emergency_fund_months": 2.7,
        "median_dti_ratio": 0.26,
        "median_net_worth": 92000,
        "median_credit_utilization": 0.26,
        "homeownership_rate": 0.50,
    },
    ("40-44", "125k_150k"): {
        "median_savings_rate": 0.15,
        "median_emergency_fund_months": 3.2,
        "median_dti_ratio": 0.26,
        "median_net_worth": 120000,
        "median_credit_utilization": 0.20,
        "homeownership_rate": 0.55,
    },
    ("40-44", "150k_plus"): {
        "median_savings_rate": 0.19,
        "median_emergency_fund_months": 4.2,
        "median_dti_ratio": 0.27,
        "median_net_worth": 165000,
        "median_credit_utilization": 0.15,
        "homeownership_rate": 0.60,
    },
}


# Province cost-of-living multipliers (applied to expense-related fields)
PROVINCE_COL_MULTIPLIER = {
    "ON": 1.15,
    "BC": 1.22,
    "AB": 0.95,
    "QC": 0.88,
    "MB": 0.85,
    "SK": 0.87,
    "NS": 0.92,
    "NB": 0.84,
    "NL": 0.90,
    "PE": 0.83,
}

# City-level expense adjustments (relative to province average)
CITY_EXPENSE_MULTIPLIER = {
    "Toronto": 1.12,
    "Vancouver": 1.15,
    "Calgary": 0.98,
    "Ottawa": 1.02,
    "Montreal": 0.95,
    "Edmonton": 0.96,
    "Winnipeg": 0.94,
    "Halifax": 0.97,
}


# ---------------------------------------------------------------------------
# Lookup functions
# ---------------------------------------------------------------------------

def _bracket_key(age_bracket: str, income_bracket: str) -> str:
    """Create a string key for DB storage: '30-34:100k_125k'."""
    return f"{age_bracket}:{income_bracket}"


def get_national_benchmark(
    age: int, income: float, province: str = "ON",
    overrides: dict[str, dict] | None = None,
) -> dict:
    """Look up national benchmark for an age/income bracket, adjusted by province.

    If `overrides` is provided (loaded from DB), matching bracket overrides
    are merged on top of the hardcoded defaults.
    """
    ab = _age_bracket(age)
    ib = _income_bracket(income)
    key = (ab, ib)

    benchmark = NATIONAL_BENCHMARKS.get(key)
    if benchmark is None:
        # Fallback to closest bracket
        benchmark = NATIONAL_BENCHMARKS[("30-34", "75k_100k")]

    result = dict(benchmark)

    # Apply DB overrides if any exist for this bracket
    if overrides:
        bk = _bracket_key(ab, ib)
        if bk in overrides:
            result.update(overrides[bk])

    result["age_bracket"] = ab
    result["income_bracket"] = ib
    result["province"] = province

    # Apply province cost-of-living multiplier to expense-related fields
    col = PROVINCE_COL_MULTIPLIER.get(province, 1.0)
    # Higher COL → lower savings rate, more emergency fund needed, higher DTI
    result["median_savings_rate"] = round(result["median_savings_rate"] / col, 4)
    result["median_emergency_fund_months"] = round(
        result["median_emergency_fund_months"] * col, 1,
    )
    result["median_dti_ratio"] = round(result["median_dti_ratio"] * col, 4)

    return result


def get_peer_benchmark(
    age: int,
    income: float,
    city: str = "Toronto",
    housing_status: str = "Renting",
    dependents: int = 0,
    overrides: dict[str, dict] | None = None,
) -> dict:
    """
    Generate deterministic peer-group benchmark from demographics.

    Uses a hash of the demographics to produce a stable seed, then adjusts
    the national benchmark based on housing, dependents, and city.
    """
    # 1. Deterministic seed from demographics
    demo_str = f"{age}:{income}:{city}:{housing_status}:{dependents}"
    seed = int(hashlib.sha256(demo_str.encode()).hexdigest()[:8], 16)

    # 2. Start from national benchmark
    province = _city_to_province(city)
    national = get_national_benchmark(age, income, province, overrides=overrides)

    # 3. Apply adjustments
    savings_rate = national["median_savings_rate"]
    emergency_months = national["median_emergency_fund_months"]
    dti = national["median_dti_ratio"]
    net_worth = national["median_net_worth"]
    credit_util = national["median_credit_utilization"]

    # Renters: lower net worth, slightly higher savings rate
    if housing_status == "Renting":
        net_worth *= 0.65
        savings_rate *= 1.10
    elif housing_status == "Homeowner":
        net_worth *= 1.35
        savings_rate *= 0.92
        dti *= 1.15  # Mortgage increases DTI

    # Per dependent: savings rate -6%, expenses +15% (affects emergency fund)
    if dependents > 0:
        savings_rate *= (1 - 0.06 * dependents)
        emergency_months *= (1 + 0.12 * dependents)
        net_worth *= (1 - 0.08 * dependents)

    # City-level adjustment
    city_mult = CITY_EXPENSE_MULTIPLIER.get(city, 1.0)
    savings_rate /= city_mult
    emergency_months *= city_mult

    # 4. Peer count from seed (8,000 - 23,000)
    peer_count = 8000 + (seed % 15001)

    # 5. Build description
    age_bracket = _age_bracket(age)
    housing_desc = "renters" if housing_status == "Renting" else "homeowners"
    dep_desc = f" with {dependents} dependent{'s' if dependents != 1 else ''}" if dependents > 0 else ""
    peer_description = (
        f"{peer_count:,} Canadians aged {age_bracket}, "
        f"earning ${income/1000:.0f}k, {housing_desc}{dep_desc} in {city}"
    )

    return {
        "peer_savings_rate": round(savings_rate, 4),
        "peer_emergency_fund_months": round(emergency_months, 1),
        "peer_dti_ratio": round(dti, 4),
        "peer_net_worth": round(net_worth),
        "peer_credit_utilization": round(credit_util, 4),
        "peer_count": peer_count,
        "peer_description": peer_description,
        "age_bracket": age_bracket,
        "income_bracket": _income_bracket(income),
        "city": city,
        "housing_status": housing_status,
        "dependents": dependents,
    }


def _city_to_province(city: str) -> str:
    """Map city name to province code."""
    mapping = {
        "Toronto": "ON",
        "Ottawa": "ON",
        "Vancouver": "BC",
        "Calgary": "AB",
        "Edmonton": "AB",
        "Montreal": "QC",
        "Winnipeg": "MB",
        "Halifax": "NS",
    }
    return mapping.get(city, "ON")


# ---------------------------------------------------------------------------
# Admin: DB-backed benchmark overrides
# ---------------------------------------------------------------------------

BENCHMARK_FIELDS = [
    "median_savings_rate",
    "median_emergency_fund_months",
    "median_dti_ratio",
    "median_net_worth",
    "median_credit_utilization",
    "homeownership_rate",
]


async def load_overrides(pool: asyncpg.Pool) -> dict[str, dict]:
    """Load all benchmark overrides from DB. Returns {bracket_key: {field: value}}."""
    rows = await pool.fetch("SELECT bracket_key, overrides FROM benchmark_overrides")
    result = {}
    for r in rows:
        ovr = r["overrides"]
        if isinstance(ovr, str):
            ovr = json.loads(ovr)
        result[r["bracket_key"]] = ovr
    return result


async def get_all_benchmarks_with_overrides(pool: asyncpg.Pool) -> list[dict]:
    """Return all bracket benchmarks with any overrides applied. For admin display."""
    overrides = await load_overrides(pool)

    result = []
    for ab in AGE_BRACKETS:
        for ib in INCOME_BRACKETS:
            key = (ab, ib)
            bk = _bracket_key(ab, ib)
            defaults = dict(NATIONAL_BENCHMARKS.get(key, {}))
            ovr = overrides.get(bk, {})
            merged = {**defaults, **ovr}
            result.append({
                "bracket_key": bk,
                "age_bracket": ab,
                "income_bracket": ib,
                "values": merged,
                "has_overrides": bool(ovr),
                "defaults": defaults,
            })
    return result


async def set_benchmark_override(
    pool: asyncpg.Pool, bracket_key: str, values: dict,
) -> dict:
    """Set override values for a bracket. Only known fields are accepted."""
    # Validate bracket key
    parts = bracket_key.split(":")
    if len(parts) != 2 or parts[0] not in AGE_BRACKETS or parts[1] not in INCOME_BRACKETS:
        raise ValueError(f"Invalid bracket_key: {bracket_key}")

    # Filter to only known fields
    filtered = {k: v for k, v in values.items() if k in BENCHMARK_FIELDS}
    if not filtered:
        raise ValueError("No valid benchmark fields provided")

    await pool.execute(
        """INSERT INTO benchmark_overrides (bracket_key, overrides, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (bracket_key)
           DO UPDATE SET overrides = $2, updated_at = now()""",
        bracket_key, json.dumps(filtered),
    )
    logger.info("Benchmarks ← override set for %s: %s", bracket_key, filtered)
    return {"bracket_key": bracket_key, "overrides": filtered}


async def reset_benchmark_override(pool: asyncpg.Pool, bracket_key: str) -> bool:
    """Remove override for a specific bracket. Returns True if found."""
    result = await pool.execute(
        "DELETE FROM benchmark_overrides WHERE bracket_key = $1", bracket_key,
    )
    logger.info("Benchmarks ← override reset for %s", bracket_key)
    return result == "DELETE 1"


async def reset_all_overrides(pool: asyncpg.Pool) -> int:
    """Remove all benchmark overrides. Returns count deleted."""
    result = await pool.execute("DELETE FROM benchmark_overrides")
    count = int(result.split()[-1]) if result else 0
    logger.info("Benchmarks ← all overrides reset (%d deleted)", count)
    return count
