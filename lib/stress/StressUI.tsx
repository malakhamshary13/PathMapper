"use client";
import { useState } from "react";
import type { StressStatus } from "./useStressMonitor";

// ─── Design tokens (local to the stress feature) ──────────────────────────────
// Kept consistent with PathMapper's existing dark palette, but with a
// deliberate "live data" register: tabular numerals for the score, a status
// ring instead of a flat dot, and calmer motion than a generic alert toast.

const TONE = {
  calm: { fg: "#7FBF8F", ring: "#5B8A6A", soft: "#16241B", border: "#5B8A6A33" },
  watch: { fg: "#E0BD6B", ring: "#D4A843", soft: "#241F12", border: "#D4A84333" },
  high: { fg: "#F0926E", ring: "#E06B4E", soft: "#2A1512", border: "#E06B4E40" },
} as const;

type Tone = { fg: string; ring: string; soft: string; border: string };

function toneFor(level: number): Tone {
  if (level >= 70) return TONE.high;
  if (level >= 40) return TONE.watch;
  return TONE.calm;
}

function labelFor(level: number): string {
  if (level >= 70) return "High";
  if (level >= 40) return "Elevated";
  return "Calm";
}

const numerals: React.CSSProperties = {
  fontFamily: "'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};

// ─── Status ring (replaces the flat dot) ───────────────────────────────────────

function StatusRing({ level, size = 8, pulsing }: { level: number; size?: number; pulsing?: boolean }) {
  const tone = toneFor(level);
  return (
    <span style={{ position: "relative", width: size, height: size, display: "inline-flex", flexShrink: 0 }}>
      {pulsing && (
        <span
          style={{
            position: "absolute", inset: -3, borderRadius: "50%",
            background: tone.ring, opacity: 0.35,
            animation: "stressPulse 2.2s ease-in-out infinite",
          }}
        />
      )}
      <span style={{
        width: size, height: size, borderRadius: "50%", background: tone.ring,
        boxShadow: `0 0 6px ${tone.ring}99`, position: "relative",
      }} />
    </span>
  );
}

// ─── Header Badge ──────────────────────────────────────────────────────────────

export function StressBadge({
  status,
  level,
  onConnect,
  onDisconnect,
}: {
  status: StressStatus;
  level: number | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const [hover, setHover] = useState(false);

  if (status === "disconnected") {
    return (
      <button
        onClick={onConnect}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: hover ? "#14141F" : "none", border: "1px solid #2A2A3E",
          color: hover ? "#C8C8D4" : "#6A6A7A",
          padding: "6px 12px", borderRadius: 8, fontSize: 12,
          cursor: "pointer", fontWeight: 500, transition: "all 0.15s",
        }}
        title="Connect a smartwatch to monitor stress (simulated demo data)"
      >
        <span>Connect watch</span>
      </button>
    );
  }

  if (status === "connecting") {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 7,
        border: "1px solid #2A2A3E", color: "#8A8A9A",
        padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: "50%", border: "1.5px solid #8A8A9A55",
          borderTopColor: "#8A8A9A", animation: "stressSpin 0.7s linear infinite",
        }} />
        Pairing…
      </div>
    );
  }

  const tone = level !== null ? toneFor(level) : TONE.calm;
  const label = level !== null ? labelFor(level) : "—";

  return (
    <button
      onClick={onDisconnect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`Stress ${level ?? "—"}/100 (${label}) — tap to disconnect watch`}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        background: hover ? "#14141F" : "none",
        border: `1px solid ${hover ? tone.border : "#2A2A3E"}`,
        color: "#D8D8E0", padding: "6px 12px", borderRadius: 8, fontSize: 12,
        cursor: "pointer", fontWeight: 500, transition: "all 0.15s",
      }}
    >
      <StatusRing level={level ?? 0} pulsing={level !== null && level >= 70} />
      <span style={{ ...numerals, fontWeight: 600 }}>{level ?? "—"}</span>
      <span style={{ color: "#6A6A7A", fontSize: 11, minWidth: 52, textAlign: "left" }}>
        {hover ? "Disconnect" : label}
      </span>
    </button>
  );
}

// ─── Typing-behavior chip (secondary signal, header) ───────────────────────────

export function TypingBadge({
  isStuck,
  stuckForMs,
  typingScore,
}: {
  isStuck: boolean;
  stuckForMs: number;
  typingScore: number;
}) {
  if (!isStuck && typingScore < 35) return null; // stay quiet unless there's something worth flagging

  const minutes = Math.floor(stuckForMs / 60000);
  const seconds = Math.floor((stuckForMs % 60000) / 1000);
  const timeStr = isStuck ? `${minutes}:${seconds.toString().padStart(2, "0")}` : null;

  return (
    <div
      title={isStuck
        ? "Same draft open without sending for a while"
        : "Typing pattern shows some hesitation"}
      style={{
        display: "flex", alignItems: "center", gap: 7,
        border: `1px solid ${isStuck ? TONE.watch.border : "#2A2A3E"}`,
        color: isStuck ? TONE.watch.fg : "#8A8A9A",
        padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500,
        background: isStuck ? TONE.watch.soft + "88" : "none",
      }}
    >
      {isStuck
        ? <span>Stuck on a reply <span style={numerals}>{timeStr}</span></span>
        : <span>Hesitant typing</span>}
    </div>
  );
}

// ─── Warning Banner (watch-driven, primary) ────────────────────────────────────

export function StressBanner({
  level,
  isElevated,
  isStable,
  secondsElevated,
  onDismiss,
  dismissed,
}: {
  level: number | null;
  isElevated: boolean;
  isStable: boolean;
  secondsElevated: number;
  onDismiss: () => void;
  dismissed: boolean;
}) {
  if (!isElevated && isStable) return null;

  if (dismissed && isElevated) {
    return (
      <button
        onClick={onDismiss} // tapping the slim strip re-expands it
        style={{
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 11.5, color: TONE.high.fg, padding: "2px 4px 6px 4px",
          background: "none", border: "none", cursor: "pointer", textAlign: "left",
          width: "100%",
        }}
      >
        <StatusRing level={level ?? 70} size={6} pulsing />
        Stress still reads <span style={numerals}>{level}</span>/100 — minimized
      </button>
    );
  }
  if (dismissed) return null;

  const minutes = Math.floor(secondsElevated / 60);
  const seconds = secondsElevated % 60;
  const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  return (
    <div style={{
      background: `linear-gradient(135deg, ${TONE.high.soft} 0%, #1F1410 100%)`,
      border: `1px solid ${TONE.high.border}`,
      borderRadius: 14,
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      animation: "stressFadeIn 0.25s ease",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10, flexShrink: 0,
          background: TONE.high.soft, border: `1px solid ${TONE.high.border}`,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
          fontWeight: 800, color: TONE.high.fg,
        }}>
          !
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 13.5, color: TONE.high.fg, fontWeight: 700 }}>
              Stress reading is high
            </span>
            <span style={{ ...numerals, fontSize: 13, color: "#D8B0A0", fontWeight: 600 }}>
              {level}/100
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: "#D8B0A0", lineHeight: 1.55 }}>
            Elevated for {timeStr}. This might not be the steadiest moment to lock in
            a big decision — strong emotion can crowd out the tradeoffs that matter.
            You can keep going, but consider a few slow breaths first, or come back
            once things settle.
          </p>
        </div>
        <button
          onClick={onDismiss}
          style={{
            background: "none", border: "none", color: "#D8B0A0",
            cursor: "pointer", fontSize: 14, padding: 2, flexShrink: 0, opacity: 0.7,
          }}
          title="Minimize (reappears if stress rises again)"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ─── Stuck-drafting nudge (typing-behavior driven, secondary, near input) ──────

export function StuckDraftNudge({
  stuckForMs,
  onDismiss,
  dismissed,
}: {
  stuckForMs: number;
  onDismiss: () => void;
  dismissed: boolean;
}) {
  if (dismissed) return null;

  const minutes = Math.floor(stuckForMs / 60000);
  const seconds = Math.floor((stuckForMs % 60000) / 1000);
  const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: TONE.watch.soft, border: `1px solid ${TONE.watch.border}`,
      borderRadius: 10, padding: "8px 12px", marginBottom: 8,
      animation: "stressFadeIn 0.2s ease",
    }}>
      <span style={{ flex: 1, fontSize: 12, color: TONE.watch.fg, lineHeight: 1.4 }}>
        You've been on this reply for <span style={{ ...numerals, fontWeight: 600 }}>{timeStr}</span> without
        sending — take your time, there's no rush to get the wording perfect.
      </span>
      <button
        onClick={onDismiss}
        style={{ background: "none", border: "none", color: TONE.watch.fg, cursor: "pointer", fontSize: 12, opacity: 0.7, flexShrink: 0 }}
      >
        ✕
      </button>
    </div>
  );
}

// Note: keyframes (stressPulse, stressSpin, stressFadeIn) used by the
// components above are defined once in app/page.tsx's global <style> block.
