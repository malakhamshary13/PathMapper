"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ─── Typing Behavior Monitor ───────────────────────────────────────────────────
 *
 * A secondary, complementary stress signal that lives entirely in the
 * browser — no device needed. It watches how the person interacts with the
 * main message textarea and derives a 0-100 "typing stress" score from:
 *
 *  1. Keystroke cadence — bursts of fast typing followed by long pauses
 *     read as more agitated than a steady pace.
 *  2. Backspace ratio — heavy editing/deleting relative to characters typed.
 *  3. "Stuck drafting" — the headline signal you asked for: the person has
 *     been working on the SAME unsent message for a long stretch (default
 *     2 minutes) without hitting send. This is tracked independently as
 *     `isStuck` / `stuckForMs` because it's a distinct, very legible signal
 *     ("they wrote and rewrote this and still haven't sent it") rather than
 *     just another input into the blended number.
 *
 * This never reads message content — only timing and edit metadata — so it
 * stays a behavioral signal, not a content/sentiment analyzer.
 */

export interface UseTypingBehaviorOptions {
  /** How long the draft can sit unchanged-in-substance before flagging "stuck". */
  stuckThresholdMs?: number;
  /** Backspace keystrokes ÷ total keystrokes above this ratio reads as heavy editing. */
  heavyEditRatio?: number;
}

export interface TypingBehaviorResult {
  /** 0-100 blended score from cadence + backspace ratio (NOT including the stuck flag). */
  typingScore: number;
  /** True once the same draft has been open, unsent, past stuckThresholdMs. */
  isStuck: boolean;
  /** How long (ms) the current draft has been open without being sent. */
  stuckForMs: number;
  /** Backspaces as a fraction of all keystrokes in the current draft. */
  editRatio: number;
  /** Call on every keystroke/change in the textarea. */
  registerKeystroke: (isBackspace: boolean, currentValue: string) => void;
  /** Call when the message is actually sent — resets the stuck timer & counters. */
  registerSend: () => void;
  reset: () => void;
}

const DEFAULT_STUCK_MS = 2 * 60 * 1000; // 2 minutes
const DEFAULT_HEAVY_EDIT_RATIO = 0.45;
const BURST_WINDOW_MS = 800; // keystrokes within this window count as one "burst"
const LONG_PAUSE_MS = 4000; // a gap this long after a burst reads as hesitation

export function useTypingBehavior(options: UseTypingBehaviorOptions = {}): TypingBehaviorResult {
  const { stuckThresholdMs = DEFAULT_STUCK_MS, heavyEditRatio = DEFAULT_HEAVY_EDIT_RATIO } = options;

  const [typingScore, setTypingScore] = useState(0);
  const [isStuck, setIsStuck] = useState(false);
  const [stuckForMs, setStuckForMs] = useState(0);
  const [editRatio, setEditRatio] = useState(0);

  const draftStartRef = useRef<number | null>(null); // when the current unsent draft was first touched
  const lastKeystrokeRef = useRef<number | null>(null);
  const keystrokeCountRef = useRef(0);
  const backspaceCountRef = useRef(0);
  const burstGapsRef = useRef<number[]>([]); // recent inter-keystroke gaps
  const pauseFlagsRef = useRef(0); // count of long pauses mid-draft
  const lastValueLengthRef = useRef(0);

  const stuckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    draftStartRef.current = null;
    lastKeystrokeRef.current = null;
    keystrokeCountRef.current = 0;
    backspaceCountRef.current = 0;
    burstGapsRef.current = [];
    pauseFlagsRef.current = 0;
    lastValueLengthRef.current = 0;
    setTypingScore(0);
    setIsStuck(false);
    setStuckForMs(0);
    setEditRatio(0);
  }, []);

  const registerSend = useCallback(() => {
    reset();
  }, [reset]);

  const registerKeystroke = useCallback((isBackspace: boolean, currentValue: string) => {
    const now = Date.now();

    if (draftStartRef.current === null) {
      draftStartRef.current = now;
    }

    if (lastKeystrokeRef.current !== null) {
      const gap = now - lastKeystrokeRef.current;
      if (gap >= LONG_PAUSE_MS) pauseFlagsRef.current += 1;
      burstGapsRef.current.push(gap);
      if (burstGapsRef.current.length > 40) burstGapsRef.current.shift();
    }
    lastKeystrokeRef.current = now;

    keystrokeCountRef.current += 1;
    if (isBackspace) backspaceCountRef.current += 1;
    lastValueLengthRef.current = currentValue.length;

    // If the draft was fully cleared, treat as a fresh draft (not "stuck" anymore)
    // unless they immediately keep typing — small clears don't reset the clock,
    // but emptying the box back to nothing does.
    if (currentValue.length === 0) {
      draftStartRef.current = now;
      pauseFlagsRef.current = 0;
    }

    const ratio = keystrokeCountRef.current > 0
      ? backspaceCountRef.current / keystrokeCountRef.current
      : 0;
    setEditRatio(ratio);

    // Cadence component: more long pauses + higher edit ratio = higher score.
    const pauseScore = Math.min(50, pauseFlagsRef.current * 8);
    const editScore = Math.min(50, (ratio / heavyEditRatio) * 50);
    setTypingScore(Math.round(Math.min(100, pauseScore + editScore)));
  }, [heavyEditRatio]);

  // Live "stuck drafting" timer — independent of keystroke events so it keeps
  // counting even during a long pause (which is exactly the case we care about).
  useEffect(() => {
    stuckTimerRef.current = setInterval(() => {
      if (draftStartRef.current === null || lastValueLengthRef.current === 0) {
        if (isStuck) setIsStuck(false);
        setStuckForMs(0);
        return;
      }
      const elapsed = Date.now() - draftStartRef.current;
      setStuckForMs(elapsed);
      setIsStuck(elapsed >= stuckThresholdMs);
    }, 1000);
    return () => {
      if (stuckTimerRef.current) clearInterval(stuckTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stuckThresholdMs]);

  return {
    typingScore,
    isStuck,
    stuckForMs,
    editRatio,
    registerKeystroke,
    registerSend,
    reset,
  };
}
