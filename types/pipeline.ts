// ─── Pre-Friend: Input Richness Gate (§0) ────────────────────────────────────

export type RichnessSignal =
  | "decision_framing"
  | "stated_factor"
  | "temporal_context"
  | "emotional_signal"
  | "personal_stake";

export interface PreFriendMetadata {
  input_quality: "full" | "partial" | "crisis_exit";
  signals_present: RichnessSignal[];
  signals_absent: RichnessSignal[];
  followup_turns: number;
}

export interface RichnessEvaluation {
  signals_present: RichnessSignal[];
  signals_absent: RichnessSignal[];
  is_crisis: boolean;
  is_nonsense: boolean;
}

// ─── Step 1: Extraction ───────────────────────────────────────────────────────

export interface ExtractionSignals {
  contradiction: boolean;
  repetition: string[];
  bundling: boolean;
  hedging: boolean;
  omission: string[];
}

export interface ExtractionOutput {
  values: string[];
  priorities: string[];
  signals: ExtractionSignals;
}

// ─── Step 2: Checkpoint Selection (§3.2) ─────────────────────────────────────

export type CheckpointType =
  | "contradiction"
  | "bundling"
  | "repetition"
  | "hedging"
  | "omission"
  | null;

/** Priority order per §3.2 — index = priority (0 = highest) */
export const CHECKPOINT_PRIORITY: Exclude<CheckpointType, null>[] = [
  "contradiction",
  "bundling",
  "repetition",
  "hedging",
  "omission",
];

/** Maps each checkpoint type to its assigned friend (§6.2) */
export const CHECKPOINT_FRIEND_MAP: Record<Exclude<CheckpointType, null>, FriendName> = {
  contradiction: "Dev",
  bundling: "Theo",
  repetition: "Mina",
  hedging: "Priya",
  omission: "Jordan",
};

export interface CheckpointSelectionOutput {
  checkpoint_type: CheckpointType;
  reason: string;
  confidence: "high" | "medium" | "low";
  detected_others: Exclude<CheckpointType, null>[];
}

// ─── Step 3: Checkpoint Resolution (§3.1) ────────────────────────────────────

export type ResolutionTag =
  | "resolved_anchor"       // Contradiction — user named the real anchor
  | "priority_confirmed"    // Repetition — topic is a genuine priority
  | "anxiety_flagged"       // Repetition — topic is worry, not priority
  | "scope_selected"        // Bundling — user chose which sub-problem to focus on
  | "deferred_scope"        // Bundling — the other sub-problem, logged for later
  | "confidence_confirmed"  // Hedging — user confirmed the priority
  | "confidence_revised"    // Hedging — user revised the priority
  | "acknowledged_non_factor" // Omission — user explained the omission
  | "new_information";      // Omission — user introduced new info

export interface ResolvedPremise {
  checkpoint_type: CheckpointType;
  question_asked: string;
  user_response: string;
  resolved_premise: string;
  resolution_tag?: ResolutionTag;
}

// ─── Step 4: Narrative Generation (§7.2) ─────────────────────────────────────

export interface NarrativeTags {
  path_id: "A" | "B";
  income_signal: string;
  income_trajectory: "up" | "flat" | "down" | "variable";
  debt_or_cost_exposure: boolean;
  skill_growth_mentions: string[];
  optionality_mentions: string[];
  promotion_pathway: boolean;
  values_match_statements: string[];
  values_conflict_statements: string[];
  network_growth: boolean;
  relationship_quality_signal: "positive" | "neutral" | "negative" | "not_mentioned";
  reputation_signal: "positive" | "neutral" | "negative" | "not_mentioned";
  predictability_signal: "high" | "medium" | "low";
  disruption_risk_mentions: string[];
  flip_condition: string;
}

export interface PathNarrative {
  body: string;
  flip_condition: string;
  tags?: NarrativeTags;
}

export interface NarrativeOutput {
  path_a: PathNarrative;
  path_b: PathNarrative;
  path_a_label: string;
  path_b_label: string;
}

// ─── Step 5: Scoring — Deterministic (§7) ────────────────────────────────────

export interface DimensionScores {
  financial_trajectory: number;  // 1-5
  growth_rate: number;           // 1-5
  values_alignment: number;      // 1-5
  social_capital: number;        // 1-5
  stability: number;             // 1-5
}

export interface PathScoreOutput {
  path_id: "A" | "B";
  scores: DimensionScores;
  social_capital_note: string | null;
  flip_condition: string;
}

export interface ScoringOutput {
  path_a: DimensionScores;
  path_b: DimensionScores;
  reasoning: Record<keyof DimensionScores, { a: string; b: string }>;
  social_capital_note_a: string | null;
  social_capital_note_b: string | null;
}

// ─── Step 6: Stance + Handback (§8) ──────────────────────────────────────────

export interface StanceOutput {
  lean: string;
  flip_condition: string;
  handback: string;
}

// ─── Friend Personas (§6.2) ──────────────────────────────────────────────────

export type FriendName = "Dev" | "Mina" | "Theo" | "Priya" | "Jordan" | "Sam";

export type PersonaName = FriendName;

// ─── Full Pipeline State ──────────────────────────────────────────────────────

export type PipelinePhase =
  | "pre_friend"          // §0 — evaluating input richness
  | "pre_friend_waiting"  // §0 — waiting for user response to richness question
  | "input"               // legacy compat — immediate pass-through for rich input
  | "checkpoint_loop"     // Step 2 — selecting next checkpoint
  | "awaiting_user"       // Step 3 — waiting for user answer to checkpoint question
  | "narratives"          // Step 4 — generating narratives
  | "scores"              // Step 5 — scoring
  | "stance"              // Step 6 — stance + handback
  | "done";               // Pipeline complete

export interface PipelineState {
  raw_input: string;
  consolidated_input: string;         // Pre-Friend output: original + follow-ups stitched
  pre_friend_metadata: PreFriendMetadata | null;
  pre_friend_turns: number;
  extraction: ExtractionOutput | null;
  resolved_premises: ResolvedPremise[];
  current_checkpoint: CheckpointSelectionOutput | null;
  narratives: NarrativeOutput | null;
  scores: ScoringOutput | null;
  stance: StanceOutput | null;
  phase: PipelinePhase;
  pending_question: string | null;
  pending_checkpoint_type: CheckpointType;
}

// ─── Chat Message ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "system";
  content: string;
  persona?: PersonaName;
  type?: "text" | "narratives" | "scores" | "stance" | "typing";
  metadata?: Record<string, unknown>;
  timestamp: number;
}
