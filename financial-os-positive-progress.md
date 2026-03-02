# Financial OS: Positive Progress — Gamified Financial Wellness

## Concept

Turn financial health into a visible, rewarding journey. Using the digital financial twin's cross-institutional view, Wealthsimple can show users where they stand, celebrate progress, and provide a constant encouraging companion — especially for those who are behind and need it most.

The design principle is **celebration of progress, not punishment of spending.** Every interaction should feel like a coach who believes in you, not a parent who's disappointed.

---

## The Baseline Problem: Who Provides the Benchmark?

For any of this to work, you need a baseline — "compared to what?" This is a layered problem:

### National/Demographic Baselines
Statistics Canada provides aggregate data on household savings rates, median income by age, average debt levels, homeownership rates by cohort. This is public data that establishes broad benchmarks — "the median Canadian aged 30-35 has X in savings, Y in debt."

But these baselines are coarse. They don't account for city (Toronto vs. Saskatoon cost of living), household composition, income level, or career stage. They're a starting point, not the answer.

### Wealthsimple's Own Aggregate Data (The Real Advantage)
With 3 million twins (anonymized, aggregated), Wealthsimple has something no one else has — **granular peer benchmarking from real financial data across institutions.** Not self-reported survey data. Not single-institution partial views. Actual savings rates, debt levels, spending patterns, investment allocations from real Canadians with complete financial pictures.

This allows peer groups that are actually meaningful:
- "Canadians aged 32-36, household income $95K-$115K, renting in a major city"
- "Self-employed Canadians with both personal and business accounts"
- "First-time home buyers in the consideration stage"

The more users who connect full financial twins, the richer and more specific the peer groups become. This is a data flywheel — every user makes the benchmarks better for every other user.

### Personal Baselines (Most Important)
The most motivating comparison isn't you vs. others — it's you vs. you three months ago. The twin tracks your financial state over time, so the system can say:
- "Your savings rate was 8% in January. It's 14% now."
- "Your credit card debt was $4,200 six months ago. It's $1,800 today."
- "Your net worth has grown $12,400 since you connected your accounts."

This requires no external data at all. It's pure twin history. And it's the most emotionally resonant — nobody can argue with their own progress.

---

## Who Does the Analysis?

### Tier 1: Deterministic Calculations (No LLM Needed)
Most metrics are straightforward math applied to twin data:
- Net worth = total assets - total liabilities
- Savings rate = (income - spending) / income
- Emergency fund coverage = liquid savings / monthly essential expenses
- Debt-to-income ratio = monthly debt payments / monthly gross income
- Credit utilization = total credit used / total credit available
- TFSA/RRSP utilization = contributions to date / lifetime contribution room

These run on every polling cycle. They're fast, deterministic, and cheap. No LLM involved. The twin data feeds into formulas, metrics update, tier calculations adjust.

### Tier 2: Pattern Recognition (ML Models)
Some insights require pattern detection across transaction data:
- Identifying recurring subscriptions the user might have forgotten about
- Detecting spending category trends (dining out increasing month over month)
- Recognizing income pattern changes (freelance income becoming irregular)
- Flagging when a user's behavior is diverging from their stated goals

Wealthsimple's existing ML infrastructure (30+ models on NVIDIA Triton) handles this. Not LLM territory — traditional ML classification and anomaly detection.

### Tier 3: Contextual Narrative and Coaching (LLM — Through PII Filter)
This is where the LLM adds value that calculations and ML can't:
- **Generating the narrative:** Turning raw metrics into a human story. Not "savings rate: 14%, +6% QoQ" but "You've nearly doubled your savings rate since January. At this pace, you'll hit your emergency fund goal by September."
- **Contextual encouragement:** Knowing that the user just paid off a credit card and connecting that to their bigger picture. "That Visa is done. That frees up $340/month — want to see what redirecting that to your TFSA would look like over 5 years?"
- **Milestone celebrations:** Generating personalized, warm, specific messages when the user hits a milestone. Not a generic "congratulations" — something that references their journey.
- **Spending impact analysis:** "That $1,200 purchase would move your emergency fund from 3.2 months to 2.8 months of coverage. You'd still be above the recommended 3-month minimum, but it's worth knowing."
- **Coaching for users who are behind:** This is the most important one. Generating genuinely hopeful, practical, personalized guidance for someone drowning in debt or with zero savings. Not platitudes — specific next steps based on their actual situation.

All LLM calls go through the PII filter. The LLM generates narratives about "Jane Doe" with perturbed numbers. The response is rehydrated before the user sees it. The coaching feels personal because the real numbers are restored — but the LLM never saw them.

---

## The Tier System

### Design Principles
- Tiers reflect **composite financial health**, not wealth. Someone earning $50K with no debt, 3 months emergency fund, and a consistent savings rate should tier higher than someone earning $200K with maxed credit cards and no savings.
- Movement between tiers is based on **trajectory and behavior**, not just current state. Improving consistently matters more than starting from a strong position.
- Dropping a tier is communicated gently with clear guidance on what changed and how to recover. Never punitive.
- Tier names should feel aspirational, not judgmental. No "bronze" or "basic" — frame around progress.

### Possible Tier Structure

| Tier | Criteria | Spirit |
|---|---|---|
| **Starting Out** | Just connected, building baseline | "Welcome — let's see where you are" |
| **Building** | Positive savings rate, reducing debt, or establishing emergency fund | "You're making moves" |
| **Growing** | Emergency fund > 2 months, debt decreasing, consistent contributions | "Real momentum" |
| **Thriving** | Emergency fund > 4 months, low debt-to-income, diversified investments, on track for goals | "You're ahead of the game" |
| **Flourishing** | Strong across all dimensions, peer group top quartile, goals on track or exceeded | "Financial freedom in sight" |

### Tier Calculation
A weighted composite score across core health metrics:
- Savings rate (weight: high)
- Emergency fund coverage (weight: high)
- Debt-to-income trend (weight: high — trend matters more than absolute level)
- Credit utilization (weight: medium)
- Investment diversification (weight: medium)
- Goal progress (weight: medium)
- Consistency/streak (weight: medium — rewards sustained behavior)

Recalculated on each polling cycle. Tier changes trigger milestone events.

---

## Milestones and Celebrations

### Automated Milestone Detection
The system watches for moments worth celebrating:

**Net worth milestones:** Crossing $0 (out of negative net worth — huge moment), $10K, $25K, $50K, $100K, $250K, $500K.

**Debt milestones:** Paying off a credit card entirely. Paying off all consumer debt. Mortgage balance crossing below a round number. Going debt-free.

**Savings milestones:** First month with positive savings rate. Emergency fund reaching 1 month, 2 months, 3 months. TFSA maxed for the year. RRSP contribution hitting target.

**Streaks:** Consecutive weeks/months of positive savings. Consecutive months staying within budget. Consecutive months of investment contributions. Consecutive months of debt reduction.

**Tier transitions:** Moving up a tier. Maintaining a tier for 6 months, 12 months.

**Personal bests:** Highest savings rate month. Lowest spending month. Longest streak.

### How Celebrations Are Delivered
- **In-app moment:** A warm, specific, personalized message when the user opens the app. Not a generic badge — a message that references their journey. "Six months ago you had $800 in savings and two maxed credit cards. Today your emergency fund covers 2.3 months and that Visa is paid off. That's real."
- **Voice (Willow):** For major milestones, Willow could deliver the celebration by voice. "Hey, I noticed your net worth just crossed $100K. That's a big deal."
- **Shareable moments (optional):** User can choose to share a milestone — "I just hit 6 months debt-free" — without revealing any actual numbers. Celebration without exposure.

---

## Spending Impact Analysis

### Real-Time Decision Support
When the twin has a complete picture, every spending decision can be contextualized:

"This $1,200 purchase would:"
- Reduce your emergency fund from 3.2 to 2.8 months coverage
- Keep you in the Growing tier (you'd need to drop below 2 months to move down)
- Delay your TFSA goal by approximately 3 weeks
- Still leave you above the recommended minimums

Not blocking the purchase. Not guilt-tripping. Just providing the full picture so the decision is informed. The user might still buy the couch — and that's fine. They just know what it means.

### Category-Level Insights
- "Your dining out spending is $680/month — that's 40% above your peer group average. Redirecting $200/month of that to your TFSA would add ~$12,400 over 5 years with average returns."
- "Your subscription services total $187/month across 11 services. Want to see which ones you've used least?"

Again — information, not judgment. The user decides.

---

## The Companion for People Who Are Behind

This is the most important use case and the one most financial tools completely fail at.

### The Problem
Most financial apps are designed for people who are already doing okay. Dashboards showing investment returns and portfolio diversification are useless — and actively discouraging — to someone with $47,000 in credit card debt, no savings, and a paycheck-to-paycheck reality.

These users don't need a dashboard. They need hope. They need someone to say "here's a way out" and mean it specifically for their situation.

### The Financial OS Approach

**Start from where they are, not where they should be.** No comparison to peers (that would be cruel). No "you should have 3 months emergency fund" when they're $40K in debt. The baseline is their own starting point.

**Celebrate tiny wins relentlessly.** Paid $50 more than the minimum on the credit card this month? That's worth acknowledging. Went one week without adding new debt? That's a streak worth tracking. Savings account went from $0 to $200? That's a milestone.

**Show the math of hope.** "At your current pace of paying $200/month above minimums, your Visa will be paid off in 14 months. When that happens, you'll have $540/month freed up. If you redirect half of that to your next card, you'll be consumer-debt-free in 26 months." The LLM can generate these projections personalized to their exact situation — specific dates, specific amounts, specific sequence.

**Be the voice that says "you can do this" with receipts.** Not empty encouragement. Evidence-based optimism. "You've reduced your total debt by $2,400 in 4 months. That's faster than 60% of people who started in a similar position. At this rate, here's where you'll be in a year."

**Adapt to setbacks without judgment.** If they backslide — took on new debt, missed a payment, broke a streak — the companion doesn't disappear or scold. "Rough month. It happens. You're still $1,800 ahead of where you started. Here's how to get back on track." The relationship has to survive bad months.

**Proactive nudges at the right moments.** The twin knows their payday schedule. The companion can nudge on payday: "Payday just hit. Want to send $100 to the Visa before it gets absorbed into spending? That would keep your payoff timeline on track." Timed, specific, actionable.

### The Voice Channel
For users who are struggling, the voice companion (via Willow) could be transformative. Reading a dashboard is passive and easy to ignore. A warm voice saying "Hey, I just wanted you to know your credit card balance dropped below $3,000 for the first time since you started. You're doing this" — that lands differently.

---

## What Makes This Only Possible Now

**The cross-institutional twin.** Peer benchmarks and financial health scoring require the full picture. No single bank can do this. Open banking + the twin makes it real.

**LLM-generated personalized narrative.** The coaching, celebration messages, spending impact explanations, and hope-giving projections all require natural language generation that's contextually aware and emotionally appropriate. This is an LLM capability that's only recently become reliable enough for sensitive financial contexts.

**The compound effect of both.** The deterministic layer (calculations, metrics, tier scoring) provides the data. The LLM layer provides the human-feeling interpretation. Neither works without the other. A calculation can tell you your savings rate is 14%. Only the LLM can say "You've nearly doubled your savings rate since January. At this pace, you'll hit your emergency fund goal by September — two months ahead of schedule."

---

## Guardrails

- **Never shame.** No "you're behind your peers" for struggling users. Peer comparisons are opt-in and only shown when the comparison is encouraging.
- **Never block purchases.** Spending impact is informational. The system informs, the user decides.
- **Never create anxiety.** If tier calculations would cause stress, the user can hide them. Progress tracking should be motivating, not another source of financial anxiety.
- **Clinical sensitivity.** Financial stress correlates with mental health challenges. The companion's tone must be informed by this — encouraging without being dismissive of how hard it is.
- **PII protection applies fully.** All LLM-generated coaching and narrative goes through the PII filter. The warmth is real. The data is perturbed.
