import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import type { PipelineState, CheckpointType, ResolutionTag } from "@/types/pipeline";
import { callLLMJSON, callLLM } from "@/lib/pipeline/llm-client";
import {
  PRE_FRIEND_RICHNESS_PROMPT,
  PRE_FRIEND_QUESTION_PROMPTS,
  RICHNESS_SIGNAL_PRIORITY,
  EXTRACTION_PROMPT,
  CHECKPOINT_SELECTION_PROMPT,
  CHECKPOINT_RESOLUTION_PROMPTS,
  NARRATIVE_GENERATION_PROMPT,
  STANCE_PROMPT,
} from "@/lib/pipeline/prompts";
import {
  RichnessEvaluationSchema,
  ExtractionSchema,
  CheckpointSelectionSchema,
  NarrativeSchema,
  StanceSchema,
} from "@/lib/schemas";
import { scorePaths, totalScore } from "@/lib/pipeline/scoring";
import type {
  ExtractionOutput,
  CheckpointSelectionOutput,
  ResolvedPremise,
  NarrativeOutput,
  ScoringOutput,
  StanceOutput,
  RichnessEvaluation,
} from "@/types/pipeline";

const CHECKPOINT_FRIEND_MAP: Record<string, string> = {
  contradiction: "Dev",
  bundling: "Theo",
  repetition: "Mina",
  hedging: "Priya",
  omission: "Jordan",
};

// ─── §0.2: Run Pre-Friend Richness Gate ──────────────────────────────────────
async function runPreFriendRichness(consolidated_input: string): Promise<RichnessEvaluation> {
  const result = await callLLMJSON<RichnessEvaluation>({
    provider: "auto",
    systemPrompt: PRE_FRIEND_RICHNESS_PROMPT,
    userMessage: consolidated_input,
    maxTokens: 300,
    temperature: 0.1,
  });
  const parsed = RichnessEvaluationSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(`Richness validation: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data as RichnessEvaluation;
}

// ─── Step 1: Extract values and signals ──────────────────────────────────────
async function runExtraction(
  raw_input: string,
  input_quality: "full" | "partial"
): Promise<ExtractionOutput> {
  const systemPrompt = EXTRACTION_PROMPT + (
    input_quality === "partial"
      ? "\n\nCRITICAL: input_quality is partial. Do NOT detect or list any Omission signals."
      : ""
  );

  const result = await callLLMJSON<ExtractionOutput>({
    provider: "auto",
    systemPrompt,
    userMessage: raw_input,
    maxTokens: 800,
    temperature: 0.2,
  });
  const parsed = ExtractionSchema.safeParse(result);
  if (!parsed.success) throw new Error(`Extraction validation: ${JSON.stringify(parsed.error.issues)}`);
  return parsed.data as ExtractionOutput;
}

// ─── Step 2: Select next checkpoint ──────────────────────────────────────────
async function runCheckpointSelection(
  extraction: ExtractionOutput,
  resolved_premises: ResolvedPremise[],
  input_quality: "full" | "partial"
): Promise<CheckpointSelectionOutput> {
  const alreadyResolved = resolved_premises.map((p) => p.checkpoint_type).filter(Boolean);

  // If input quality is partial, Omission checkpoint is disabled / marked as resolved
  if (input_quality === "partial" && !alreadyResolved.includes("omission")) {
    alreadyResolved.push("omission");
  }

  const userMessage = `
EXTRACTION:
Values: ${extraction.values.join(", ")}
Priorities: ${extraction.priorities.join(", ")}
Signals:
  - contradiction: ${extraction.signals.contradiction}
  - repetition: ${extraction.signals.repetition.join(", ") || "none"}
  - bundling: ${extraction.signals.bundling}
  - hedging: ${extraction.signals.hedging}
  - omission: ${extraction.signals.omission.join(", ") || "none"}

ALREADY RESOLVED (do NOT select these again): ${alreadyResolved.join(", ") || "none"}

Select the next checkpoint to resolve. Return null if all signals are resolved.`.trim();

  const result = await callLLMJSON<CheckpointSelectionOutput>({
    provider: "auto",
    systemPrompt: CHECKPOINT_SELECTION_PROMPT,
    userMessage,
    maxTokens: 300,
    temperature: 0.1,
  });
  const parsed = CheckpointSelectionSchema.safeParse(result);
  if (!parsed.success) throw new Error(`Checkpoint selection validation: ${JSON.stringify(parsed.error.issues)}`);
  return parsed.data as CheckpointSelectionOutput;
}

const FRIEND_REACTION_PROMPTS: Record<string, { name: string; reactions: string[]; guidance: string }> = {
  contradiction: {
    name: "Dev",
    reactions: [
      "Wait, hold up. That doesn't really add up.",
      "Okay, I get where you're coming from, but...",
      "Ah, gotcha, but honestly..."
    ],
    guidance: "Be direct, logical, and slightly blunt. Validate quickly but call out the conflict immediately."
  },
  bundling: {
    name: "Theo",
    reactions: [
      "Got it. That is a lot to process at once.",
      "Okay, I see what you mean. Let's look at it piece by piece.",
      "Right, that makes sense."
    ],
    guidance: "Be structured and organized. Validate briefly, then focus on separating the threads."
  },
  repetition: {
    name: "Mina",
    reactions: [
      "Oh wow, yeah, that sounds super stressful.",
      "Ugh, I feel you on that, it's so exhausting.",
      "Honestly, I totally get why you're worried about that."
    ],
    guidance: "Be warm, highly empathetic, and cautious. Validate deeply, showing you understand the stress."
  },
  hedging: {
    name: "Priya",
    reactions: [
      "Yeah, that gut feeling is so real.",
      "Oh totally, it's hard when you're not 100% sure about it.",
      "Yeah, I hear you."
    ],
    guidance: "Be authentic and gut-check focused. Validate naturally and ask what their heart is telling them."
  },
  omission: {
    name: "Jordan",
    reactions: [
      "Yeah, absolutely. Growth is huge.",
      "Oh yeah, that makes perfect sense.",
      "Totally, you've got to look out for your future."
    ],
    guidance: "Be career-focused and ambitious. Validate quickly, then ask about the missing big-picture element."
  }
};

// ─── Step 3a: Get checkpoint question ────────────────────────────────────────
async function runGetQuestion(
  checkpoint_type: CheckpointType,
  extraction: ExtractionOutput,
  raw_input: string,
  lastUserResponse?: string
): Promise<string> {
  const systemPrompt = CHECKPOINT_RESOLUTION_PROMPTS[checkpoint_type as string];
  if (!systemPrompt) throw new Error(`No prompt for checkpoint type: ${checkpoint_type}`);

  const info = FRIEND_REACTION_PROMPTS[checkpoint_type as string];
  let reactionGuidance = "";
  if (lastUserResponse && info) {
    reactionGuidance = `
The user just responded: "${lastUserResponse}"
Since this is a follow-up in the group chat, you MUST start your response by casually reacting/validating this response in your unique voice.
Guidance: ${info.guidance}
Examples of how you might start:
${info.reactions.map(r => `- "${r}"`).join("\n")}

Do NOT use the exact examples unless they fit perfectly. Use your own style, but make it natural, casual, and conversational.
`;
  }

  const userMessage = `
The person's original statement:
"${raw_input}"

Key values I've extracted: ${extraction.values.join(", ")}
Key priorities: ${extraction.priorities.join(", ")}
${reactionGuidance}

Write your response now (in character, 2-3 sentences max, no preamble):`.trim();

  return callLLM({ provider: "auto", systemPrompt, userMessage, maxTokens: 200, temperature: 0.7 });
}

// ─── Step 3b: Resolve premise and tag from user answer ────────────────────────
async function runResolvePremise(
  checkpoint_type: CheckpointType,
  question_asked: string,
  user_response: string
): Promise<{ resolved_premise: string; resolution_tag: ResolutionTag }> {
  const resolvePrompt = `You are a decision clarity system. Given a checkpoint question, the user's response, and the checkpoint type, extract:
1. A single clear resolved premise: a concrete, specific fact about this person's situation that is now established as true. Stated as a declarative sentence.
2. A resolution tag. Select the most appropriate tag based on the checkpoint type and response:

For checkpoint_type = 'contradiction':
- 'resolved_anchor': User named their real priority/anchor.

For checkpoint_type = 'bundling':
- 'scope_selected': User chose one sub-problem to focus on.

For checkpoint_type = 'repetition':
- 'priority_confirmed': User confirmed the recurring topic is a top priority.
- 'anxiety_flagged': User indicated the topic is a worry/fear rather than a priority.

For checkpoint_type = 'hedging':
- 'confidence_confirmed': User confirmed the hedged value with high confidence.
- 'confidence_revised': User revised or downplayed the priority.

For checkpoint_type = 'omission':
- 'acknowledged_non_factor': User explained why the missing factor is not relevant.
- 'new_information': User introduced new information about the missing factor.

Return ONLY a JSON object:
{
  "resolved_premise": "one clear sentence",
  "resolution_tag": "resolved_anchor" | "priority_confirmed" | "anxiety_flagged" | "scope_selected" | "deferred_scope" | "confidence_confirmed" | "confidence_revised" | "acknowledged_non_factor" | "new_information"
}`;

  const userMessage = `
Checkpoint type: ${checkpoint_type}
Question asked: "${question_asked}"
User's response: "${user_response}"

Extract the resolved premise and resolution tag.`.trim();

  const result = await callLLMJSON<{ resolved_premise: string; resolution_tag: ResolutionTag }>({
    provider: "auto",
    systemPrompt: resolvePrompt,
    userMessage,
    maxTokens: 200,
    temperature: 0.1,
  });
  return result;
}

// ─── Step 4: Generate narratives ──────────────────────────────────────────────
async function runNarratives(
  raw_input: string,
  resolved_premises: ResolvedPremise[]
): Promise<NarrativeOutput> {
  const premisesText = resolved_premises
    .map((p, i) => `${i + 1}. [Tag: ${p.resolution_tag}] ${p.resolved_premise}`)
    .join("\n");

  const userMessage = `
ORIGINAL SITUATION:
"${raw_input}"

RESOLVED PREMISES (established facts — treat these as hard constraints, not context):
${premisesText || "None — use the situation directly."}

Generate two paths for this person. Make sure to generate the narrative bodies AND populate the structured tags objects for both paths.`.trim();

  const result = await callLLMJSON<NarrativeOutput>({
    provider: "auto",
    systemPrompt: NARRATIVE_GENERATION_PROMPT,
    userMessage,
    maxTokens: 1400,
    temperature: 0.4,
  });
  const parsed = NarrativeSchema.safeParse(result);
  if (!parsed.success) throw new Error(`Narrative validation: ${JSON.stringify(parsed.error.issues)}`);
  return parsed.data as NarrativeOutput;
}

// ─── Step 6: Generate stance ──────────────────────────────────────────────────
async function runStance(
  narratives: NarrativeOutput,
  scores: ScoringOutput
): Promise<StanceOutput> {
  const scoreA = totalScore(scores.path_a);
  const scoreB = totalScore(scores.path_b);

  const flipA = narratives.path_a.tags?.flip_condition || narratives.path_a.flip_condition;
  const flipB = narratives.path_b.tags?.flip_condition || narratives.path_b.flip_condition;

  const userMessage = `
PATH A: ${narratives.path_a_label}
Narrative: "${narratives.path_a.body}"
Flip condition: "${flipA}"
Total score: ${scoreA}/100
Dimension scores: Financial ${scores.path_a.financial_trajectory}/5, Growth ${scores.path_a.growth_rate}/5, Values ${scores.path_a.values_alignment}/5, Social ${scores.path_a.social_capital}/5, Stability ${scores.path_a.stability}/5

PATH B: ${narratives.path_b_label}
Narrative: "${narratives.path_b.body}"
Flip condition: "${flipB}"
Total score: ${scoreB}/100
Dimension scores: Financial ${scores.path_b.financial_trajectory}/5, Growth ${scores.path_b.growth_rate}/5, Values ${scores.path_b.values_alignment}/5, Social ${scores.path_b.social_capital}/5, Stability ${scores.path_b.stability}/5

Deliver the lean, flip condition (copied or closely paraphrased from recommended path narrative data), and handback.`.trim();

  const result = await callLLMJSON<StanceOutput>({
    provider: "auto",
    systemPrompt: STANCE_PROMPT,
    userMessage,
    maxTokens: 400,
    temperature: 0.3,
  });
  const parsed = StanceSchema.safeParse(result);
  if (!parsed.success) throw new Error(`Stance validation: ${JSON.stringify(parsed.error.issues)}`);
  return parsed.data as StanceOutput;
}

// ─── MAIN PIPELINE ORCHESTRATOR ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { state, user_message }: { state: PipelineState; user_message?: string } =
      await req.json();

    let nextState: PipelineState = {
      ...state,
      resolved_premises: [...(state.resolved_premises ?? [])],
    };
    let responseMessage: {
      content: string;
      persona?: string;
      type?: string;
      metadata?: unknown;
    } | null = null;

    // ── PHASE: pre_friend or pre_friend_waiting ────────────────────────────────
    if (nextState.phase === "input" || nextState.phase === "pre_friend" || nextState.phase === "pre_friend_waiting") {
      const currentInput = user_message ?? "";

      // Stitch inputs together
      if (nextState.consolidated_input) {
        nextState.consolidated_input += `\nUser response: ${currentInput}`;
      } else {
        nextState.consolidated_input = currentInput;
      }

      // Increment turn counter
      if (nextState.phase === "pre_friend_waiting") {
        nextState.pre_friend_turns = (nextState.pre_friend_turns ?? 0) + 1;
      } else {
        nextState.pre_friend_turns = 0;
        nextState.phase = "pre_friend";
      }

      // Check richness
      const richness = await runPreFriendRichness(nextState.consolidated_input);

      if (richness.is_crisis) {
        nextState.phase = "done";
        nextState.pre_friend_metadata = {
          input_quality: "crisis_exit",
          signals_present: richness.signals_present,
          signals_absent: richness.signals_absent,
          followup_turns: nextState.pre_friend_turns,
        };
        responseMessage = {
          content: "It sounds like you're going through something hard. I am a decision analysis tool and not equipped for crisis support. Please contact the 988 Suicide & Crisis Lifeline by calling or texting 988 (in US/Canada), or reach out to a local health professional or helpline.",
          persona: "Sam",
          type: "text",
        };
        return NextResponse.json({ state: nextState, message: responseMessage });
      }

      if (richness.is_nonsense && nextState.pre_friend_turns >= 2) {
        nextState.phase = "done";
        responseMessage = {
          content: "Hey, it doesn't really sound like there's a specific decision you're working through right now. Let me know when you have one and we can talk!",
          persona: "Sam",
          type: "text",
        };
        return NextResponse.json({ state: nextState, message: responseMessage });
      }

      const passedGate = richness.signals_present.length >= 3;
      const hitCap = nextState.pre_friend_turns >= 3;

      if (passedGate || hitCap) {
        nextState.raw_input = nextState.consolidated_input;
        nextState.pre_friend_metadata = {
          input_quality: passedGate ? "full" : "partial",
          signals_present: richness.signals_present,
          signals_absent: richness.signals_absent,
          followup_turns: nextState.pre_friend_turns,
        };
        // Move to checkpoint loop
        nextState.phase = "checkpoint_loop";
      } else {
        // Find highest priority missing signal
        const missingSignal = RICHNESS_SIGNAL_PRIORITY.find((sig) =>
          richness.signals_absent.includes(sig as any)
        );

        if (missingSignal && PRE_FRIEND_QUESTION_PROMPTS[missingSignal]) {
          const questionPrompt = PRE_FRIEND_QUESTION_PROMPTS[missingSignal];
          const question = await callLLM({
            provider: "auto",
            systemPrompt: questionPrompt,
            userMessage: `Context: consolidated input so far is "${nextState.consolidated_input}"`,
            maxTokens: 200,
            temperature: 0.7,
          });

          nextState.pending_question = question;
          nextState.pending_checkpoint_type = null;
          nextState.phase = "pre_friend_waiting";
          responseMessage = {
            content: question,
            persona: "Sam",
            type: "text",
          };
          return NextResponse.json({ state: nextState, message: responseMessage });
        } else {
          nextState.raw_input = nextState.consolidated_input;
          nextState.pre_friend_metadata = {
            input_quality: "partial",
            signals_present: richness.signals_present,
            signals_absent: richness.signals_absent,
            followup_turns: nextState.pre_friend_turns,
          };
          nextState.phase = "checkpoint_loop";
        }
      }
    }

    // ── PHASE: checkpoint selection & loop entry ────────────────────────────────
    if (nextState.phase === "checkpoint_loop") {
      const inputQuality = nextState.pre_friend_metadata?.input_quality === "partial" ? "partial" : "full";

      if (!nextState.extraction) {
        nextState.extraction = await runExtraction(nextState.raw_input, inputQuality);
      }

      const alreadyResolved = nextState.resolved_premises.map((p) => p.checkpoint_type).filter(Boolean);
      let checkpoint: CheckpointSelectionOutput;

      if (nextState.raw_input.includes("[TEST-ALL]")) {
        const priorityOrder = ["contradiction", "bundling", "repetition", "hedging", "omission"] as ("contradiction" | "bundling" | "repetition" | "hedging" | "omission")[];
        const nextType = priorityOrder.find(t => !alreadyResolved.includes(t));
        if (nextType) {
          checkpoint = {
            checkpoint_type: nextType as any,
            reason: `Forced test-all checkpoint: ${nextType}`,
            confidence: "high",
            detected_others: priorityOrder.filter(t => t !== nextType && !alreadyResolved.includes(t))
          };
        } else {
          checkpoint = {
            checkpoint_type: null,
            reason: "All forced test-all checkpoints resolved",
            confidence: "high",
            detected_others: []
          };
        }
      } else {
        checkpoint = await runCheckpointSelection(
          nextState.extraction,
          nextState.resolved_premises,
          inputQuality
        );

        if (!checkpoint.checkpoint_type && nextState.resolved_premises.length < 3) {
          const priorityOrder = ["contradiction", "bundling", "repetition", "hedging", "omission"] as ("contradiction" | "bundling" | "repetition" | "hedging" | "omission")[];
          const allowedOrder = inputQuality === "partial"
            ? priorityOrder.filter(t => t !== "omission")
            : priorityOrder;
          const nextType = allowedOrder.find(t => !alreadyResolved.includes(t));
          if (nextType) {
            checkpoint = {
              checkpoint_type: nextType as any,
              reason: `Enforcing conversation depth (turn ${nextState.resolved_premises.length + 1})`,
              confidence: "high",
              detected_others: allowedOrder.filter(t => t !== nextType && !alreadyResolved.includes(t))
            };
          }
        }
      }
      nextState.current_checkpoint = checkpoint;

      if (!checkpoint.checkpoint_type) {
        nextState.phase = "narratives";
      } else {
        const isFollowUp = nextState.resolved_premises.length > 0;
        const question = await runGetQuestion(
          checkpoint.checkpoint_type,
          nextState.extraction,
          nextState.raw_input,
          isFollowUp ? user_message : undefined
        );
        nextState.pending_question = question;
        nextState.pending_checkpoint_type = checkpoint.checkpoint_type;
        nextState.phase = "awaiting_user";

        const friendPersona = CHECKPOINT_FRIEND_MAP[checkpoint.checkpoint_type] ?? "Dev";
        responseMessage = {
          content: question,
          persona: friendPersona as any,
          type: "text",
        };
      }
    }

    // ── PHASE: awaiting user answer to checkpoint question ───────────────────────
    else if (nextState.phase === "awaiting_user" && user_message) {
      nextState.raw_input += `\nUser response to ${nextState.pending_checkpoint_type}: ${user_message}`;

      const resolved = await runResolvePremise(
        nextState.pending_checkpoint_type,
        nextState.pending_question ?? "",
        user_message
      );

      nextState.resolved_premises = [
        ...nextState.resolved_premises,
        {
          checkpoint_type: nextState.pending_checkpoint_type,
          question_asked: nextState.pending_question ?? "",
          user_response: user_message,
          resolved_premise: resolved.resolved_premise,
          resolution_tag: resolved.resolution_tag,
        },
      ];

      const inputQuality = nextState.pre_friend_metadata?.input_quality === "partial" ? "partial" : "full";
      const alreadyResolved = nextState.resolved_premises.map((p) => p.checkpoint_type).filter(Boolean);
      let nextCheckpoint: CheckpointSelectionOutput;

      if (nextState.raw_input.includes("[TEST-ALL]")) {
        const priorityOrder = ["contradiction", "bundling", "repetition", "hedging", "omission"] as ("contradiction" | "bundling" | "repetition" | "hedging" | "omission")[];
        const nextType = priorityOrder.find(t => !alreadyResolved.includes(t));
        if (nextType) {
          nextCheckpoint = {
            checkpoint_type: nextType as any,
            reason: `Forced test-all checkpoint: ${nextType}`,
            confidence: "high",
            detected_others: priorityOrder.filter(t => t !== nextType && !alreadyResolved.includes(t))
          };
        } else {
          nextCheckpoint = {
            checkpoint_type: null,
            reason: "All forced test-all checkpoints resolved",
            confidence: "high",
            detected_others: []
          };
        }
      } else {
        nextCheckpoint = await runCheckpointSelection(
          nextState.extraction as ExtractionOutput,
          nextState.resolved_premises,
          inputQuality
        );

        if (!nextCheckpoint.checkpoint_type && nextState.resolved_premises.length < 3) {
          const priorityOrder = ["contradiction", "bundling", "repetition", "hedging", "omission"] as ("contradiction" | "bundling" | "repetition" | "hedging" | "omission")[];
          const allowedOrder = inputQuality === "partial"
            ? priorityOrder.filter(t => t !== "omission")
            : priorityOrder;
          const nextType = allowedOrder.find(t => !alreadyResolved.includes(t));
          if (nextType) {
            nextCheckpoint = {
              checkpoint_type: nextType as any,
              reason: `Enforcing conversation depth (turn ${nextState.resolved_premises.length + 1})`,
              confidence: "high",
              detected_others: allowedOrder.filter(t => t !== nextType && !alreadyResolved.includes(t))
            };
          }
        }
      }
      nextState.current_checkpoint = nextCheckpoint;

      if (!nextCheckpoint.checkpoint_type) {
        nextState.phase = "narratives";
        nextState.pending_question = null;
        nextState.pending_checkpoint_type = null;
      } else {
        const question = await runGetQuestion(
          nextCheckpoint.checkpoint_type,
          nextState.extraction as ExtractionOutput,
          nextState.raw_input,
          user_message
        );
        nextState.pending_question = question;
        nextState.pending_checkpoint_type = nextCheckpoint.checkpoint_type;
        nextState.phase = "awaiting_user";

        const friendPersona = CHECKPOINT_FRIEND_MAP[nextCheckpoint.checkpoint_type] ?? "Dev";
        responseMessage = {
          content: question,
          persona: friendPersona as any,
          type: "text",
        };
      }
    }

    // ── PHASE: generate narratives + scores + stance in one shot ────────────────
    if (nextState.phase === "narratives") {
      const narratives = await runNarratives(
        nextState.raw_input,
        nextState.resolved_premises
      );
      nextState.narratives = narratives;

      // Step 5 — deterministic tag-based
      const scores = scorePaths(narratives, nextState.resolved_premises);
      nextState.scores = scores;

      // Step 6 — stance
      const stance = await runStance(narratives, scores);
      nextState.stance = stance;
      nextState.phase = "done";

      // Dynamically select which friend persona presents final scoreboard
      const presentingFriend = (resolved_premises: ResolvedPremise[], pre_friend_turns: number) => {
        if (resolved_premises.length > 0) {
          const lastPremise = resolved_premises[resolved_premises.length - 1];
          if (lastPremise.checkpoint_type) {
            return CHECKPOINT_FRIEND_MAP[lastPremise.checkpoint_type] ?? "Dev";
          }
        }
        return pre_friend_turns > 0 ? "Sam" : "Dev";
      };
      const persona = presentingFriend(nextState.resolved_premises, nextState.pre_friend_turns);

      // Return narratives+scores as first message; stance will come as second via client timer
      responseMessage = {
        content: "Okay, I put this together to show what both paths would actually look like for you. Take a look:",
        persona: persona as any,
        type: "narratives",
        metadata: { narratives, scores },
      };
    }

    return NextResponse.json({ state: nextState, message: responseMessage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Chat pipeline error:", message);
    const isRateLimit = message.toLowerCase().includes("429") || 
                        message.toLowerCase().includes("quota") || 
                        message.toLowerCase().includes("rate limit") || 
                        message.toLowerCase().includes("exhausted");
    return NextResponse.json(
      { 
        error: isRateLimit ? "rate_limit_exceeded" : "Pipeline failed", 
        detail: message 
      },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
export const maxDuration = 60;
