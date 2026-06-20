"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ─── Smartwatch Stress Monitor (MOCK / TEST DATA SOURCE) ──────────────────────
 *
 * This is a FAKE data source standing in for a real smartwatch integration
 * (e.g. Apple HealthKit, Google Fit / Health Connect, Garmin, Fitbit, or a
 * direct BLE heart-rate-variability feed). It simulates a 0–100 "stress
 * level" reading that drifts over time and occasionally spikes, the way a
 * real HRV-derived stress score would.
 *
 * To swap in a real device later: replace `tickFakeReading()` with a call
 * into the real SDK/bridge, and replace `connect()` with the real pairing
 * flow. Nothing in the component layer (StressBadge / StressBanner) needs
 * to change — they only consume the hook's return value below.
 */

export type StressStatus = "disconnected" | "connecting" | "connected";

export interface StressReading {
  level: number; // 0-100
  timestamp: number;
}

export interface UseStressMonitorOptions {
  /** Stress level (0-100) at or above which we consider the user "elevated". */
  threshold?: number;
  /**
   * How many consecutive milliseconds the reading must stay BELOW threshold
   * before we clear the alert. This is the "stay until stable" behavior —
   * a single dip under the line doesn't immediately clear the warning.
   */
  stableDurationMs?: number;
  /** How often the fake watch pushes a new reading. */
  tickIntervalMs?: number;
  /** Auto-connect on mount instead of requiring the user to tap Connect. */
  autoConnect?: boolean;
}

export interface UseStressMonitorResult {
  status: StressStatus;
  level: number | null;
  history: StressReading[];
  isElevated: boolean;
  /** True only once the reading has been back under threshold for stableDurationMs. */
  isStable: boolean;
  secondsElevated: number;
  connect: () => void;
  disconnect: () => void;
  /** Test helper: force a specific reading immediately (useful for demos / QA). */
  simulateReading: (level: number) => void;
}

const DEFAULT_THRESHOLD = 70;
const DEFAULT_STABLE_MS = 20_000; // 20s back under threshold before we clear the alert
const DEFAULT_TICK_MS = 4_000;
const HISTORY_LIMIT = 60;

/**
 * Generates the next fake reading via a bounded random walk, with an
 * occasional stress "spike" injected to make the demo feel alive.
 */
function nextFakeLevel(prev: number): number {
  const drift = (Math.random() - 0.5) * 14; // normal wobble
  const spike = Math.random() < 0.08 ? Math.random() * 35 : 0; // occasional spike
  const decay = prev > 60 ? -3 : 0; // gently pulls high readings back down over time
  const next = prev + drift + spike + decay;
  return Math.max(4, Math.min(100, Math.round(next)));
}

export function useStressMonitor(options: UseStressMonitorOptions = {}): UseStressMonitorResult {
  const {
    threshold = DEFAULT_THRESHOLD,
    stableDurationMs = DEFAULT_STABLE_MS,
    tickIntervalMs = DEFAULT_TICK_MS,
    autoConnect = false,
  } = options;

  const [status, setStatus] = useState<StressStatus>("disconnected");
  const [level, setLevel] = useState<number | null>(null);
  const [history, setHistory] = useState<StressReading[]>([]);
  const [isStable, setIsStable] = useState(true);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const belowSinceRef = useRef<number | null>(null);
  const elevatedSinceRef = useRef<number | null>(null);
  const [secondsElevated, setSecondsElevated] = useState(0);
  const stableTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pushReading = useCallback((newLevel: number) => {
    const reading: StressReading = { level: newLevel, timestamp: Date.now() };
    setLevel(newLevel);
    setHistory(prev => {
      const next = [...prev, reading];
      return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
    });
  }, []);

  const tickFakeReading = useCallback(() => {
    setLevel(prev => {
      const base = prev ?? 35 + Math.random() * 20;
      const next = nextFakeLevel(base);
      pushReading(next);
      return next;
    });
  }, [pushReading]);

  const connect = useCallback(() => {
    if (status === "connected" || status === "connecting") return;
    setStatus("connecting");
    // Simulate the BLE/HealthKit pairing handshake delay.
    const id = setTimeout(() => {
      setStatus("connected");
      tickFakeReading();
    }, 900);
    return () => clearTimeout(id);
  }, [status, tickFakeReading]);

  const disconnect = useCallback(() => {
    setStatus("disconnected");
    setLevel(null);
    setHistory([]);
    belowSinceRef.current = null;
    elevatedSinceRef.current = null;
    setIsStable(true);
    setSecondsElevated(0);
  }, []);

  const simulateReading = useCallback((forcedLevel: number) => {
    if (status !== "connected") setStatus("connected");
    pushReading(Math.max(0, Math.min(100, forcedLevel)));
  }, [pushReading, status]);

  // Periodic fake readings while "connected"
  useEffect(() => {
    if (status !== "connected") {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(tickFakeReading, tickIntervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [status, tickIntervalMs, tickFakeReading]);

  // Optional auto-connect
  useEffect(() => {
    if (autoConnect) connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isElevated = level !== null && level >= threshold;

  // Track stability: must be continuously below threshold for stableDurationMs
  // before we flip back to "stable". A single good reading doesn't clear it.
  useEffect(() => {
    if (level === null) return;

    if (isElevated) {
      belowSinceRef.current = null;
      setIsStable(false);
      if (elevatedSinceRef.current === null) elevatedSinceRef.current = Date.now();
    } else {
      if (belowSinceRef.current === null) belowSinceRef.current = Date.now();
      const elapsed = Date.now() - belowSinceRef.current;
      if (elapsed >= stableDurationMs) {
        setIsStable(true);
        elevatedSinceRef.current = null;
      }
    }
  }, [level, isElevated, stableDurationMs]);

  // Live "seconds elevated" counter for the banner copy
  useEffect(() => {
    if (stableTimerRef.current) clearInterval(stableTimerRef.current);
    stableTimerRef.current = setInterval(() => {
      if (elevatedSinceRef.current) {
        setSecondsElevated(Math.floor((Date.now() - elevatedSinceRef.current) / 1000));
      } else {
        setSecondsElevated(0);
      }
    }, 1000);
    return () => {
      if (stableTimerRef.current) clearInterval(stableTimerRef.current);
    };
  }, []);

  return {
    status,
    level,
    history,
    isElevated,
    isStable,
    secondsElevated,
    connect,
    disconnect,
    simulateReading,
  };
}
