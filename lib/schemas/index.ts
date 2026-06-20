import { z } from "zod";

// ─── Pre-Friend Richness (§0.2) ──────────────────────────────────────────────

export const RichnessEvaluationSchema = z.object({
  signals_present: z.array(
    z.enum(["decision_framing", "stated_factor", "temporal_context", "emotional_signal", "personal_stake"])
  ),
  signals_absent: z.array(
    z.enum(["decision_framing", "stated_factor", "temporal_context", "emotional_signal", "personal_stake"])
  ),
  is_crisis: z.boolean(),
  is_nonsense: z.boolean(),
});

// ─── Step 1: Extraction ──────────────────────────────────────────────────────

export const ExtractionSchema = z.object({
  values: z.array(z.string()).min(1),
  priorities: z.array(z.string()).min(1),
  signals: z.object({
    contradiction: z.boolean(),
    repetition: z.array(z.string()),
    bundling: z.boolean(),
    hedging: z.boolean(),
    omission: z.array(z.string()),
  }),
});

// ─── Step 2: Checkpoint Selection (§3.3) ─────────────────────────────────────

export const CheckpointSelectionSchema = z.object({
  checkpoint_type: z
    .enum(["contradiction", "bundling", "repetition", "hedging", "omission"])
    .nullable(),
  reason: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  detected_others: z.array(
    z.enum(["contradiction", "bundling", "repetition", "hedging", "omission"])
  ).default([]),
});

// ─── Step 4: Narrative Tags (§7.2) ───────────────────────────────────────────

export const NarrativeTagsSchema = z.object({
  path_id: z.enum(["A", "B"]),
  income_signal: z.string().default(""),
  income_trajectory: z.enum(["up", "flat", "down", "variable"]).default("flat"),
  debt_or_cost_exposure: z.boolean().default(false),
  skill_growth_mentions: z.array(z.string()).default([]),
  optionality_mentions: z.array(z.string()).default([]),
  promotion_pathway: z.boolean().default(false),
  values_match_statements: z.array(z.string()).default([]),
  values_conflict_statements: z.array(z.string()).default([]),
  network_growth: z.boolean().default(false),
  relationship_quality_signal: z.enum(["positive", "neutral", "negative", "not_mentioned"]).default("not_mentioned"),
  reputation_signal: z.enum(["positive", "neutral", "negative", "not_mentioned"]).default("not_mentioned"),
  predictability_signal: z.enum(["high", "medium", "low"]).default("medium"),
  disruption_risk_mentions: z.array(z.string()).default([]),
  flip_condition: z.string().default(""),
});

// ─── Step 4: Narrative Output ────────────────────────────────────────────────

export const NarrativeSchema = z.object({
  path_a_label: z.string().min(2),
  path_b_label: z.string().min(2),
  path_a: z.object({
    body: z.string().min(20),
    flip_condition: z.string().min(5),
    tags: NarrativeTagsSchema.optional(),
  }),
  path_b: z.object({
    body: z.string().min(20),
    flip_condition: z.string().min(5),
    tags: NarrativeTagsSchema.optional(),
  }),
});

// ─── Step 6: Stance ──────────────────────────────────────────────────────────

export const StanceSchema = z.object({
  lean: z.string().min(5),
  flip_condition: z.string().min(5),
  handback: z.string().min(10),
});
