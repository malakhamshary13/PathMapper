import type { NarrativeOutput, ScoringOutput, DimensionScores, ResolvedPremise, NarrativeTags } from "@/types/pipeline";

// ─── Keyword Fallback Config (from v1) ───────────────────────────────────────
const KEYWORDS: Record<keyof DimensionScores, { pos: string[]; neg: string[] }> = {
  financial_trajectory: {
    pos: ["salary", "compensation", "equity", "raise", "income", "financial", "pay", "bonus", "profit", "earn", "money", "wealth"],
    neg: ["debt", "risk", "uncertain", "variable", "less money", "pay cut", "reduced", "lower salary", "broke"],
  },
  growth_rate: {
    pos: ["learn", "grow", "skill", "develop", "advance", "opportunity", "challenge", "expand", "new", "experience", "leadership", "mentor", "progress"],
    neg: ["stuck", "plateau", "stagnant", "same", "routine", "limit", "ceiling", "no room", "bored"],
  },
  values_alignment: {
    pos: ["purpose", "meaning", "impact", "passion", "mission", "align", "authentic", "believe", "care", "matter", "fulfil"],
    neg: ["compromise", "against", "conflict", "drain", "hollow", "empty", "wrong", "misalign"],
  },
  social_capital: {
    pos: ["team", "connect", "relationship", "community", "friend", "family", "support", "network", "colleague", "partner", "belong"],
    neg: ["alone", "isolat", "remote", "distant", "disconnect", "leave behind", "lose touch"],
  },
  stability: {
    pos: ["stable", "security", "safe", "certain", "reliable", "consistent", "predictable", "established", "proven", "steady"],
    neg: ["unstable", "uncertain", "risk", "volatile", "unpredictable", "fail", "startup risk", "unknown"],
  },
};

function scoreText(text: string, kw: { pos: string[]; neg: string[] }): number {
  const lower = text.toLowerCase();
  const pos = kw.pos.filter((k) => lower.includes(k)).length;
  const neg = kw.neg.filter((k) => lower.includes(k)).length;
  let score = 3;
  if (pos >= 3) score += 1;
  else if (pos >= 1) score += 0.5;
  if (neg >= 2) score -= 1;
  else if (neg >= 1) score -= 0.5;
  return Math.max(1, Math.min(5, Math.round(score)));
}

// ─── Deterministic Tag-Based Scoring (§7) ────────────────────────────────────

function scoreFinancial(tags: NarrativeTags): number {
  const traj = tags.income_trajectory;
  const debt = tags.debt_or_cost_exposure;

  if (traj === "up" && !debt) return 5;
  if (traj === "up" && debt) return 4;
  if ((traj === "flat" || traj === "variable") && !debt) return 3;
  if (traj === "variable" && debt) return 2;
  if (traj === "down" || (traj === "flat" && debt)) return 1;
  return 3;
}

function scoreGrowth(tags: NarrativeTags): number {
  const skillsCount = tags.skill_growth_mentions?.length ?? 0;
  const optCount = tags.optionality_mentions?.length ?? 0;
  const promo = tags.promotion_pathway;

  if (skillsCount >= 2 && optCount >= 1 && promo) return 5;
  if (skillsCount >= 2 && (promo || optCount >= 1)) return 4;
  if (skillsCount >= 1 || promo) {
    // but not both with optionality (interpreted as score 3)
    return 3;
  }
  if (skillsCount >= 1 && !promo && optCount === 0) return 2;
  if (skillsCount === 0 && !promo && optCount === 0) return 1;
  return 3;
}

function scoreValues(tags: NarrativeTags): number {
  const matches = tags.values_match_statements?.length ?? 0;
  const conflicts = tags.values_conflict_statements?.length ?? 0;

  if (matches >= 2 && conflicts === 0) return 5;
  if (matches >= 2 && conflicts === 1) return 4;
  if (matches === 1 && conflicts <= 1) return 3;
  if (matches === 0 && conflicts <= 1) return 2;
  if (conflicts >= 1 && matches === 0) return 1;
  return 3;
}

function scoreSocial(tags: NarrativeTags): number {
  const growth = tags.network_growth;
  const rel = tags.relationship_quality_signal;
  const rep = tags.reputation_signal;

  if (rel === "negative" || rep === "negative") return 1;
  if (growth && rel === "positive" && rep === "positive") return 5;
  if (growth && (rel === "positive" || rep === "positive")) return 4;
  if (rel === "positive" || rep === "positive" || growth) return 3;
  if (rel === "neutral" || rep === "neutral" || rel === "not_mentioned" || rep === "not_mentioned") return 2;
  return 2;
}

function scoreStability(tags: NarrativeTags): number {
  const pred = tags.predictability_signal;
  const risks = tags.disruption_risk_mentions?.length ?? 0;

  if (pred === "low" || risks >= 3) return 1;
  if (pred === "high" && risks === 0) return 5;
  if (pred === "high" && risks === 1) return 4;
  if (pred === "medium" && risks <= 1) return 3;
  if (pred === "medium" && risks >= 2) return 2;
  return 3;
}

export function scorePaths(narratives: NarrativeOutput, resolved_premises: ResolvedPremise[]): ScoringOutput {
  const dims: (keyof DimensionScores)[] = [
    "financial_trajectory",
    "growth_rate",
    "values_alignment",
    "social_capital",
    "stability",
  ];

  const path_a = {} as DimensionScores;
  const path_b = {} as DimensionScores;
  const reasoning = {} as ScoringOutput["reasoning"];

  let social_capital_note_a: string | null = null;
  let social_capital_note_b: string | null = null;

  // Process Path A
  if (narratives.path_a.tags) {
    const tags = narratives.path_a.tags;
    path_a.financial_trajectory = scoreFinancial(tags);
    path_a.growth_rate = scoreGrowth(tags);
    path_a.values_alignment = scoreValues(tags);
    path_a.social_capital = scoreSocial(tags);
    path_a.stability = scoreStability(tags);

    if (
      !tags.network_growth &&
      tags.relationship_quality_signal === "not_mentioned" &&
      tags.reputation_signal === "not_mentioned"
    ) {
      social_capital_note_a = "Social capital impact not addressed in narrative — user may want to consider this.";
    }
  } else {
    // Fallback to keyword-based
    const body = narratives.path_a.body;
    path_a.financial_trajectory = scoreText(body, KEYWORDS.financial_trajectory);
    path_a.growth_rate = scoreText(body, KEYWORDS.growth_rate);
    path_a.values_alignment = scoreText(body, KEYWORDS.values_alignment);
    path_a.social_capital = scoreText(body, KEYWORDS.social_capital);
    path_a.stability = scoreText(body, KEYWORDS.stability);
  }

  // Process Path B
  if (narratives.path_b.tags) {
    const tags = narratives.path_b.tags;
    path_b.financial_trajectory = scoreFinancial(tags);
    path_b.growth_rate = scoreGrowth(tags);
    path_b.values_alignment = scoreValues(tags);
    path_b.social_capital = scoreSocial(tags);
    path_b.stability = scoreStability(tags);

    if (
      !tags.network_growth &&
      tags.relationship_quality_signal === "not_mentioned" &&
      tags.reputation_signal === "not_mentioned"
    ) {
      social_capital_note_b = "Social capital impact not addressed in narrative — user may want to consider this.";
    }
  } else {
    // Fallback to keyword-based
    const body = narratives.path_b.body;
    path_b.financial_trajectory = scoreText(body, KEYWORDS.financial_trajectory);
    path_b.growth_rate = scoreText(body, KEYWORDS.growth_rate);
    path_b.values_alignment = scoreText(body, KEYWORDS.values_alignment);
    path_b.social_capital = scoreText(body, KEYWORDS.social_capital);
    path_b.stability = scoreText(body, KEYWORDS.stability);
  }

  // Build reasoning text for debugging/UI
  for (const dim of dims) {
    const kw = KEYWORDS[dim];
    const scoreValA = path_a[dim];
    const scoreValB = path_b[dim];

    reasoning[dim] = {
      a: `Score ${scoreValA}/5 — based on narrative tags analysis`,
      b: `Score ${scoreValB}/5 — based on narrative tags analysis`,
    };
  }

  return {
    path_a,
    path_b,
    reasoning,
    social_capital_note_a,
    social_capital_note_b,
  };
}

export function totalScore(scores: DimensionScores, weights?: Partial<DimensionScores>): number {
  const w = {
    financial_trajectory: 1,
    growth_rate: 1,
    values_alignment: 1,
    social_capital: 1,
    stability: 1,
    ...weights,
  };
  const weighted = (Object.keys(w) as Array<keyof DimensionScores>).reduce((s, k) => s + scores[k] * w[k], 0);
  const max = 5 * (Object.values(w).reduce((s, v) => s + v, 0));
  return Math.round((weighted / max) * 100);
}
