"use client";
import { UserButton, SignInButton, SignedIn, SignedOut, useUser } from "@clerk/nextjs";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import type { ChatMessage, DimensionScores, NarrativeOutput, ScoringOutput, StanceOutput, PipelinePhase, PipelineState } from "@/types/pipeline";
import { useStressMonitor } from "@/lib/stress/useStressMonitor";
import { useTypingBehavior } from "@/lib/stress/useTypingBehavior";
import { StressBadge, StressBanner, TypingBadge, StuckDraftNudge } from "@/lib/stress/StressUI";

const INITIAL: PipelineState = {
  raw_input: "",
  consolidated_input: "",
  pre_friend_metadata: null,
  pre_friend_turns: 0,
  extraction: null,
  resolved_premises: [],
  current_checkpoint: null,
  narratives: null,
  scores: null,
  stance: null,
  phase: "pre_friend",
  pending_question: null,
  pending_checkpoint_type: null,
};

const PERSONAS = {
  Sam: { defaultName: "Cora", color: "#8A8A9A", bg: "#16161F", emoji: "", subtitle: "the Coordinator" },
  Dev: { defaultName: "Felix", color: "#E06B4E", bg: "#2A1512", emoji: "", subtitle: "the Fact Checker" },
  Mina: { defaultName: "Paige", color: "#D4839A", bg: "#2A1520", emoji: "", subtitle: "the Pattern Detector" },
  Theo: { defaultName: "Carter", color: "#4AAAA5", bg: "#122A28", emoji: "", subtitle: "the Categorizer" },
  Priya: { defaultName: "Connie", color: "#9B7ED8", bg: "#1E162A", emoji: "", subtitle: "the Confidence Meter" },
  Jordan: { defaultName: "Blair", color: "#D4A843", bg: "#2A2210", emoji: "", subtitle: "the Blindspot Finder" },
} as const;


// ─── Color Themes ─────────────────────────────────────────────────────────────
const THEMES = {
  dark: {
    label: "Dark",
    bg: "#0A0A10",
    surface: "#0F0F16",
    card: "#161622",
    border: "#1E1E2E",
    borderStrong: "#2A2A3E",
    text: "#E8E4DC",
    textMuted: "#8A8A9A",
    textFaint: "#555",
    accent: "#5B8A6A",
    accentHover: "#6C9C7B",
    userBubble: "#2A4A3A",
    userText: "#D4EDDA",
    userBorder: "#3A6A4A33",
    barBg: "#1E1E2E",
    inputBg: "#161622",
  },
  light: {
    label: "Light",
    bg: "#F5F4F0",
    surface: "#FAFAF8",
    card: "#FFFFFF",
    border: "#E0DDD6",
    borderStrong: "#C8C5BC",
    text: "#1A1A22",
    textMuted: "#6B6B78",
    textFaint: "#999",
    accent: "#4A7A5A",
    accentHover: "#3A6A4A",
    userBubble: "#DCF8C6",
    userText: "#1A3020",
    userBorder: "#4A7A5A33",
    barBg: "#E8E5DC",
    inputBg: "#FFFFFF",
  },
  ocean: {
    label: "Ocean",
    bg: "#080E18",
    surface: "#0D1520",
    card: "#121E2E",
    border: "#1A2A3E",
    borderStrong: "#243A52",
    text: "#E4EEF8",
    textMuted: "#7A94B0",
    textFaint: "#445566",
    accent: "#3A7FC0",
    accentHover: "#4A8FD0",
    userBubble: "#1A3A5E",
    userText: "#C8DEFF",
    userBorder: "#3A7FC033",
    barBg: "#1A2A3E",
    inputBg: "#121E2E",
  },
  warm: {
    label: "Warm",
    bg: "#120E08",
    surface: "#18130C",
    card: "#221A10",
    border: "#2E2218",
    borderStrong: "#3E3020",
    text: "#F0E8D8",
    textMuted: "#9A8870",
    textFaint: "#605040",
    accent: "#B08A4A",
    accentHover: "#C09A5A",
    userBubble: "#3A2A10",
    userText: "#FFE8C0",
    userBorder: "#B08A4A33",
    barBg: "#2E2218",
    inputBg: "#221A10",
  },
} as const;

type ThemeKey = keyof typeof THEMES;
type Theme = (typeof THEMES)[ThemeKey];

const dimLabels: Record<string, string> = {
  financial_trajectory: "Financial Trajectory",
  growth_rate: "Growth Rate",
  values_alignment: "Values Alignment",
  social_capital: "Social Capital",
  stability: "Stability",
};

// ─── Encryption Helpers (Responsible AI - AES-GCM Web Crypto) ─────────────────
async function getCryptoKey(password: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const rawKey = enc.encode(password);
  const hash = await window.crypto.subtle.digest("SHA-256", rawKey);
  return window.crypto.subtle.importKey(
    "raw",
    hash,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptAES(password: string, plaintext: string): Promise<string> {
  try {
    const key = await getCryptoKey(password);
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode(plaintext)
    );
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    
    let binary = "";
    for (let i = 0; i < combined.length; i++) {
      binary += String.fromCharCode(combined[i]);
    }
    return btoa(binary);
  } catch (e) {
    console.error("Encryption failed", e);
    return plaintext;
  }
}

async function decryptAES(password: string, base64: string): Promise<string> {
  try {
    const key = await getCryptoKey(password);
    const combined = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    const dec = new TextDecoder();
    return dec.decode(decrypted);
  } catch (e) {
    return base64;
  }
}

// ─── Score Bars ───────────────────────────────────────────────────────────────
function ScoreBar({ label, a, b, barBg }: { label: string; a: number; b: number; barBg: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "#999", width: 120, flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ flex: 1, height: 6, background: "#1E1E2E", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(a / 5) * 100}%`, background: "#3A6A9C", borderRadius: 3, transition: "width 0.6s ease" }} />
        </div>
        <div style={{ fontSize: 10, color: "#777", width: 28, textAlign: "center", flexShrink: 0 }}>{a}:{b}</div>
        <div style={{ flex: 1, height: 6, background: "#1E1E2E", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(b / 5) * 100}%`, background: "#9C7A3A", borderRadius: 3, transition: "width 0.6s ease" }} />
        </div>
      </div>
    </div>
  );
}

// ─── Narrative Cards ──────────────────────────────────────────────────────────
function NarrativeCards({ narratives, scores, theme }: { narratives: NarrativeOutput; scores: ScoringOutput; theme: Theme }) {
  const totalA = Object.values(scores.path_a).reduce((s, v) => s + v, 0);
  const totalB = Object.values(scores.path_b).reduce((s, v) => s + v, 0);
  const dims = ["financial_trajectory", "growth_rate", "values_alignment", "social_capital", "stability"] as Array<keyof DimensionScores>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Path cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: narratives.path_a_label, path: narratives.path_a, color: "#4A7FBF", bg: "#0d1a2a", note: scores.social_capital_note_a },
          { label: narratives.path_b_label, path: narratives.path_b, color: "#B08A5A", bg: "#1a1200", note: scores.social_capital_note_b },
        ].map(({ label, path, color, bg, note }) => (
          <div key={label} style={{ background: bg, border: `1px solid ${color}33`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color, marginBottom: 8 }}>{label}</div>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: "#C0B8AC", margin: "0 0 10px" }}>{path.body}</p>
            <div style={{ fontSize: 11, color: "#888", background: "rgba(0,0,0,0.18)", borderRadius: 6, padding: "6px 10px", lineHeight: 1.5, marginBottom: note ? 8 : 0 }}>
              <span style={{ fontWeight: 600, color: "#aaa" }}>Flip if: </span>{path.flip_condition}
            </div>
            {note && (
              <div style={{ fontSize: 10, color: "#C08A3E", background: "#2A1F10", padding: "6px 10px", borderRadius: 6, lineHeight: 1.4 }}>
                {note}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Scores */}
      <div style={{ background: theme.surface, border: `1px solid ${theme.borderStrong}`, borderRadius: 12, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, fontSize: 11, fontWeight: 600 }}>
          <span style={{ color: "#4A7FBF", textTransform: "uppercase", letterSpacing: "0.5px" }}>{narratives.path_a_label}</span>
          <span style={{ color: "#444", flex: 1, textAlign: "center" }}>vs</span>
          <span style={{ color: "#B08A5A", textTransform: "uppercase", letterSpacing: "0.5px" }}>{narratives.path_b_label}</span>
        </div>
        {dims.map((d) => (
          <ScoreBar key={d} label={dimLabels[d] || d} a={scores.path_a[d]} b={scores.path_b[d]} barBg={theme.barBg} />
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, paddingTop: 10, borderTop: "1px solid #1E1E2E", fontSize: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#4A7FBF" }}>{totalA}/25</span>
          <span style={{ color: "#444", flex: 1, textAlign: "center" }}>Total</span>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#B08A5A" }}>{totalB}/25</span>
        </div>
      </div>
    </div>
  );
}

// ─── Stance Card ──────────────────────────────────────────────────────────────
function StanceCard({ stance }: { stance: StanceOutput }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.5, color: "#E8E4DC" }}>{stance.lean}</div>
      <div style={{ fontSize: 12, color: "#888", background: "rgba(0,0,0,0.18)", borderRadius: 8, padding: "8px 12px", lineHeight: 1.5 }}>
        <span style={{ fontWeight: 600 }}>This changes if: </span>{stance.flip_condition}
      </div>
      <div style={{ fontSize: 13, color: "#A0988E", lineHeight: 1.7 }}>{stance.handback}</div>
    </div>
  );
}

// ─── Typing Dots ──────────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 5, padding: "14px 18px", background: "rgba(22,22,34,0.9)", border: "1px solid #2A2A3E", borderRadius: "4px 18px 18px 18px", width: "fit-content" }}>
      {[0, 200, 400].map((delay) => (
        <span key={delay} style={{
          width: 7, height: 7, background: "#555", borderRadius: "50%", display: "block",
          animation: `dotBounce 1.2s ${delay}ms infinite`
        }} />
      ))}
      <style>{`@keyframes dotBounce { 0%,60%,100%{transform:translateY(0);opacity:.4} 30%{transform:translateY(-5px);opacity:1} }`}</style>
    </div>
  );
}

// ─── Chat Bubble ──────────────────────────────────────────────────────────────
function ChatBubble({ msg, customNames, theme }: { msg: ChatMessage; customNames: Record<string, string>; theme: Theme }) {
  const isUser = msg.role === "user";
  const persona = msg.persona ? PERSONAS[msg.persona as keyof typeof PERSONAS] : null;
  const getFriendName = (name: string) => customNames[name] || (PERSONAS[name as keyof typeof PERSONAS] as any)?.defaultName || name;

  return (
    <div style={{ display: "flex", gap: 10, maxWidth: "92%", alignSelf: isUser ? "flex-end" : "flex-start", flexDirection: isUser ? "row-reverse" : "row", animation: "fadeIn 0.2s ease" }}>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      {!isUser && persona && (
        <div style={{
          width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16, flexShrink: 0, marginTop: 18, background: persona.bg, border: `2px solid ${persona.color}`
        }}
          >{(PERSONAS[msg.persona as keyof typeof PERSONAS] as any)?.defaultName?.[0] ?? msg.persona[0]}</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {!isUser && msg.persona && (
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.3px", marginLeft: 2, color: persona?.color }}>
            {getFriendName(msg.persona)}
          </div>
        )}
        <div style={{
          padding: "12px 16px",
          borderRadius: isUser ? "18px 18px 4px 18px" : "4px 18px 18px 18px",
          fontSize: 14, lineHeight: 1.6,
          background: isUser ? theme.userBubble : (persona?.bg ?? theme.card),
          color: isUser ? theme.userText : theme.text,
          border: `1px solid ${isUser ? theme.userBorder : (persona ? persona.color + "44" : theme.borderStrong)}`,
          maxWidth: msg.type === "narratives" ? 560 : undefined,
        }}>
          {msg.type === "narratives" && msg.metadata ? (
            <NarrativeCards
              narratives={(msg.metadata as { narratives: NarrativeOutput; scores: ScoringOutput }).narratives}
              scores={(msg.metadata as { narratives: NarrativeOutput; scores: ScoringOutput }).scores}
              theme={theme}
            />
          ) : msg.type === "stance" && msg.metadata ? (
            <StanceCard stance={(msg.metadata as { stance: StanceOutput }).stance} />
          ) : (
            <p style={{ margin: 0 }}>{msg.content}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Welcome Screen ───────────────────────────────────────────────────────────
function WelcomeScreen({ onSend, theme }: { onSend: (text: string) => void; theme: Theme }) {
  const examples = [
    {
      label: "Alex (25, Software Engineer) — Stay at stable job vs. join startup",
      value: "I've been at my current company for two years — solid pay, good work-life balance, I know everyone. Then this startup reached out and it's genuinely tempting. Better salary, equity, and the problem they're working on is actually interesting. But startups fail and I have rent. I keep thinking about a job I had before this where things went badly and I had to start over from scratch. The startup would be a step up technically but I'm not sure I'm ready. I guess what I want most is to grow — but also I don't know, I like knowing what to expect. My partner just got promoted and we're thinking about moving in together this year so the timing feels off too."
    },
    {
      label: "Layla (23, Research Assistant) — Accept PhD offer vs. take industry research role",
      value: "I got into a really good PhD program — it's exactly the area I've been working toward. But I also have an offer from a company doing applied research in the same field, better pay obviously, and honestly I'm just tired. Five years of undergrad and research assistant work and I don't know if I have another four to six years of this in me right now. My supervisor keeps telling me the PhD is the right move and I respect him enormously, I've worked with him for two years. But I also wonder if I'm just doing it because it's what people like me are supposed to do. The industry role feels like giving up somehow, even though I know that's not rational. I want to do meaningful research either way. I just don't know if I can keep pushing at this pace."
    },
    {
      label: "Omar (26, Marketing Analyst) — Stay in marketing vs. switch to UX design",
      value: "I've been a marketing analyst for three years and I'm good at it but it feels hollow. I've been teaching myself UX design on the side for about eight months — I actually love it, it's the most engaged I've felt about work in years. There's a bootcamp that could fast-track a transition but it's expensive and there's no guarantee. My friend made a similar switch two years ago and is doing really well now, so it feels possible. I want to do work that actually matters and helps people. But my parents sacrificed a lot for me to have a stable career and I don't want to throw that away. The marketing job pays well. I keep wondering if I'm just romanticizing design because it's new and different, or if this is actually what I should be doing."
    }
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, padding: "40px 20px", textAlign: "center", gap: 12 }}>
      <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: -1, color: "#5B8A6A" }}>PM</div>
      <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1, margin: 0 }}>PathMapper</h1>
      <p style={{ color: "#888", fontSize: 15, maxWidth: 340, lineHeight: 1.5, margin: 0 }}>Your decisions, thought through — not decided for you.</p>
      <div style={{ marginTop: 16, width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.8px", margin: "0 0 4px" }}>Select a scenario to start:</p>
        {examples.map((ex, i) => (
          <button key={i} onClick={() => onSend(ex.value)} style={{
            background: theme.card, border: `1px solid ${theme.borderStrong}`, color: theme.textMuted,
            padding: "14px 18px", borderRadius: 10, textAlign: "left", fontSize: 13, lineHeight: 1.5,
            cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit"
          }}
            onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = "#5B8A6A"; (e.target as HTMLElement).style.color = "#E8E4DC"; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = "#2A2A3E"; (e.target as HTMLElement).style.color = "#B0A898"; }}
          >{ex.label}</button>
        ))}
      </div>
    </div>
  );
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  pipeline: PipelineState;
  updatedAt: number;
}

// ─── Research Panel ───────────────────────────────────────────────────────────
const SIM_DATA: Record<string, { title: string; text: string }> = {
  contradiction: {
    title: "The 'Friend' Intervention (Contradiction)",
    text: "Wait, you said the money is 'insane'—but you mentioned the 80-hour week immediately after. It sounds like you're trying to convince yourself the trade-off is worth it. Is it the money you want, or are you just scared of turning down a 'big' offer?"
  },
  hedging: {
    title: "The 'Friend' Intervention (Hedging)",
    text: "You sound a bit unsure when you say you 'want' the title. If we stripped the title away and just kept the work, would you still be excited, or is this just about how it looks to other people?"
  },
  bundling: {
    title: "The 'Friend' Intervention (Bundling)",
    text: "You're mixing three different things: the paycheck, your burnout, and your reputation. Let's pause. If the money was half as much, would the 80-hour weeks be an automatic 'no'?"
  }
};

function ResearchBarChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {data.map(d => (
        <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 11, color: "#A0988E", width: 200, flexShrink: 0 }}>{d.label}</div>
          <div style={{ flex: 1, height: 14, background: "#1E1E2E", borderRadius: 7, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${d.value}%`, background: d.color, borderRadius: 7, transition: "width 0.6s ease" }} />
          </div>
          <div style={{ fontSize: 11, color: "#777", width: 30, textAlign: "right", flexShrink: 0 }}>{d.value}</div>
        </div>
      ))}
    </div>
  );
}

function ResearchLineChart({
  labels, series
}: { labels: string[]; series: { label: string; color: string; values: number[] }[] }) {
  const w = 560, h = 200, padX = 10, padY = 16;
  const stepX = (w - padX * 2) / (labels.length - 1);
  const toY = (v: number) => h - padY - (v / 100) * (h - padY * 2);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {[0, 25, 50, 75, 100].map(v => (
          <line key={v} x1={padX} x2={w - padX} y1={toY(v)} y2={toY(v)} stroke="#1E1E2E" strokeWidth={1} />
        ))}
        {series.map(s => (
          <polyline
            key={s.label}
            fill="none"
            stroke={s.color}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={s.values.map((v, i) => `${padX + i * stepX},${toY(v)}`).join(" ")}
          />
        ))}
        {series.map(s =>
          s.values.map((v, i) => (
            <circle key={s.label + i} cx={padX + i * stepX} cy={toY(v)} r={3.5} fill={s.color} />
          ))
        )}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", padding: `0 ${padX}px`, fontSize: 10, color: "#666" }}>
        {labels.map(l => <span key={l}>{l}</span>)}
      </div>
      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 4 }}>
        {series.map(s => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#A0988E" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: s.color, display: "inline-block" }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResearchCard({ children, accent }: { children: ReactNode; accent?: string }) {
  return (
    <div style={{
      background: "rgba(0,0,0,0.25)", border: `1px solid ${accent ? accent + "33" : "#2A2A3E"}`,
      borderRadius: 14, padding: 20
    }}>
      {children}
    </div>
  );
}

function ResearchPanel() {
  const [tab, setTab] = useState<"summary" | "checkpoints" | "scoring" | "simulator">("summary");
  const [simType, setSimType] = useState<keyof typeof SIM_DATA | null>(null);

  const subTabs: { id: typeof tab; label: string }[] = [
    { id: "summary", label: "Executive Summary" },
    { id: "checkpoints", label: "Checkpoint Science" },
    { id: "scoring", label: "The Scoring Model" },
    { id: "simulator", label: "Reasoning Simulator" },
  ];

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px 40px" }} className="sidebar-scroll">
      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
        <header style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: "-0.5px" }}>How Humans Decide Careers</h1>
          <p style={{ fontSize: 14, color: "#8A8A9A", fontStyle: "italic", margin: 0 }}>
            Moving beyond the Pros/Cons list into Heuristic Reasoning.
          </p>
        </header>

        {/* Sub-tabs */}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, borderBottom: "1px solid #1E1E2E", paddingBottom: 12 }}>
          {subTabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: tab === t.id ? "#1C1C2C" : "none",
                border: "1px solid " + (tab === t.id ? "#5B8A6A" : "#2A2A3E"),
                color: tab === t.id ? "#E8E4DC" : "#8A8A9A",
                fontWeight: 600, fontSize: 12, cursor: "pointer", padding: "6px 14px", borderRadius: 20,
                transition: "all 0.15s"
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Executive Summary */}
        {tab === "summary" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <ResearchCard>
              <h2 style={{ fontSize: 18, margin: "0 0 10px", fontWeight: 700 }}>The Core Thesis</h2>
              <p style={{ fontSize: 13, lineHeight: 1.7, color: "#C0B8AC", margin: "0 0 10px" }}>
                Career decision-making is rarely a linear calculation of utility. Research suggests humans use{" "}
                <strong style={{ color: "#E8E4DC" }}>&quot;Bounded Rationality&quot;</strong> — we don&apos;t find the perfect solution; we find the first one that satisfies our immediate emotional safety and core identity.
              </p>
              <p style={{ fontSize: 13, lineHeight: 1.7, color: "#C0B8AC", margin: 0 }}>
                When talking to friends, humans provide &quot;noisy&quot; data. They say they want money, but their tone shifts when they talk about time. This research identifies the{" "}
                <strong style={{ color: "#E8E4DC" }}>Cognitive Dissonance</strong> between what we say (Explicit Values) and how we feel (Implicit Fears).
              </p>
            </ResearchCard>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "rgba(91,138,106,0.07)", borderLeft: "3px solid #5B8A6A", borderRadius: 10, padding: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 6px" }}>System 1 Thinking</h3>
                <p style={{ fontSize: 12, color: "#8A8A9A", margin: 0, lineHeight: 1.6 }}>
                  Intuitive, fast, and emotional. This is where &quot;Gut Feelings&quot; and &quot;Fear of Missing Out&quot; live. Most initial career inputs are System 1 noise.
                </p>
              </div>
              <div style={{ background: "rgba(181,131,141,0.07)", borderLeft: "3px solid #B5838D", borderRadius: 10, padding: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 6px" }}>System 2 Thinking</h3>
                <p style={{ fontSize: 12, color: "#8A8A9A", margin: 0, lineHeight: 1.6 }}>
                  Slower, analytical, and effortful. PathMapper&apos;s goal is to force the user into System 2 through strategic &quot;Checkpoints&quot;.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Checkpoint Science */}
        {tab === "checkpoints" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 13, color: "#A0988E", lineHeight: 1.7, margin: 0 }}>
              A &quot;Friend&quot; doesn&apos;t just listen to words; they listen to the <em>gaps</em> between words. Based on conversational analysis, here is the research justification for the PathMapper Checkpoint types.
            </p>

            <ResearchCard accent="#4A5568">
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 8px", color: "#C8C4D8" }}>1. The Contradiction Signal (Cognitive Dissonance)</h3>
              <p style={{ fontSize: 12.5, color: "#A0988E", lineHeight: 1.6, margin: "0 0 16px" }}>
                Humans often use &quot;Professionalism&quot; as a mask for &quot;Safety.&quot; Research shows users will rank &apos;Growth&apos; as #1 but spend 80% of their description talking about &apos;Stability&apos; risks. This is a <strong style={{ color: "#E8E4DC" }}>Value-Action Gap</strong>.
              </p>
              <ResearchBarChart
                data={[
                  { label: "Stated Priority (Money)", value: 90, color: "#B5838D" },
                  { label: "Conversational Focus (Freedom)", value: 45, color: "#8DA399" },
                ]}
              />
              <p style={{ fontSize: 10.5, color: "#666", textAlign: "center", margin: "10px 0 0" }}>
                The Dissonance Gap: Stated vs. Actual Emphasis
              </p>
            </ResearchCard>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 14 }}>
                <h4 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 6px" }}>Hedging (Affective Forecasting)</h4>
                <p style={{ fontSize: 11.5, color: "#8A8A9A", margin: 0, lineHeight: 1.6 }}>
                  When humans say &quot;I guess&quot; or &quot;Maybe,&quot; it signals a lack of <strong style={{ color: "#C0B8AC" }}>Identity Fit</strong>. They are trying on a persona they don&apos;t believe in yet.
                </p>
              </div>
              <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 14 }}>
                <h4 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 6px" }}>Repetition (Anxiety Loops)</h4>
                <p style={{ fontSize: 11.5, color: "#8A8A9A", margin: 0, lineHeight: 1.6 }}>
                  Frequency does not always equal priority. High frequency with high-pitch/urgent vocabulary usually signals <strong style={{ color: "#C0B8AC" }}>Loss Aversion</strong>, not aspiration.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Scoring Model */}
        {tab === "scoring" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 13, color: "#A0988E", lineHeight: 1.7, margin: 0 }}>
              How do we weigh life? Research into <strong style={{ color: "#E8E4DC" }}>Subjective Well-Being (SWB)</strong> shows that certain dimensions have a &quot;Diminishing Return&quot; while others &quot;Compound.&quot;
            </p>

            <ResearchCard>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>Non-Linear Weighting of Career Dimensions</h3>
              <p style={{ fontSize: 11.5, color: "#777", fontStyle: "italic", margin: "0 0 16px" }}>
                The following chart visualizes how humans <em>actually</em> feel value as a career progresses, which should inform the &quot;Deterministic Scoring Layer.&quot;
              </p>
              <ResearchLineChart
                labels={["Entry Level", "Mid-Career", "Senior", "Legacy"]}
                series={[
                  { label: "Weight of Stability", color: "#B5838D", values: [80, 60, 40, 20] },
                  { label: "Weight of Values Alignment", color: "#8DA399", values: [20, 40, 70, 95] },
                ]}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18, fontSize: 12.5, color: "#A0988E", lineHeight: 1.6 }}>
                <p style={{ margin: 0 }}>
                  <strong style={{ color: "#E8E4DC" }}>Financial Trajectory:</strong> Research shows money acts as a &quot;Hygiene Factor.&quot; Below a certain threshold, it&apos;s everything. Above it, its weighting should drop significantly in the model.
                </p>
                <p style={{ margin: 0 }}>
                  <strong style={{ color: "#E8E4DC" }}>Social Capital:</strong> Often ignored by users but acts as the primary &quot;Safety Net.&quot; The scoring model must weigh this higher in &quot;Pivot&quot; scenarios.
                </p>
              </div>
            </ResearchCard>
          </div>
        )}

        {/* Simulator */}
        {tab === "simulator" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 13, color: "#A0988E", lineHeight: 1.7, margin: 0 }}>
              Experience how the &quot;Selection Layer&quot; (Step 2 of the pipeline) chooses a checkpoint based on human reasoning patterns.
            </p>

            <ResearchCard>
              <div style={{ background: "rgba(91,138,106,0.07)", border: "1px solid #5B8A6A33", borderRadius: 10, padding: 14, fontSize: 13, color: "#C0B8AC", fontStyle: "italic", lineHeight: 1.6, marginBottom: 16 }}>
                &quot;I want to take the startup job because the money is insane, but honestly, I&apos;m worried about the 80-hour weeks. But then again, if I don&apos;t do it now, I&apos;ll never get that title...&quot;
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {(["contradiction", "hedging", "bundling"] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setSimType(t)}
                    style={{
                      background: simType === t ? "#1C2C22" : "#161622",
                      border: "1px solid " + (simType === t ? "#5B8A6A" : "#2A2A3E"),
                      color: simType === t ? "#9FD8B0" : "#B8B8C8",
                      padding: "7px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer", transition: "all 0.15s"
                    }}
                  >
                    Notice {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              <div style={{ minHeight: 90, borderTop: "1px solid #1E1E2E", paddingTop: 14 }}>
                {simType ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <h4 style={{ fontSize: 13, fontWeight: 700, color: "#8DA399", margin: 0 }}>{SIM_DATA[simType].title}</h4>
                    <p style={{ fontSize: 13, color: "#E0D8D0", lineHeight: 1.6, margin: 0 }}>{SIM_DATA[simType].text}</p>
                    <div style={{ fontSize: 10, color: "#666", fontFamily: "monospace", marginTop: 4 }}>
                      Pipeline Step 3: Checkpoint Resolution Active
                    </div>
                  </div>
                ) : (
                  <div style={{ color: "#555", textAlign: "center", fontSize: 12, marginTop: 8 }}>
                    Select a pattern to see how a &quot;Friend&quot; would intervene.
                  </div>
                )}
              </div>
            </ResearchCard>
          </div>
        )}

        <footer style={{ textAlign: "center", fontSize: 11, color: "#555", fontStyle: "italic", marginTop: 8 }}>
          Research synthesized for PathMapper — USAII 2026.
        </footer>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function PathMapperApp() {
  const { user, isLoaded: isClerkLoaded } = useUser();
  const encryptionKey = user?.id || "pathmapper-offline-key-secure-2026";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pipeline, setPipeline] = useState<PipelineState>(INITIAL);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [typingPersona, setTypingPersona] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  
  // Custom states for persistence and editing
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [customNames, setCustomNames] = useState<Record<string, string>>({});
  const [showEditModal, setShowEditModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"names" | "security" | "theme">("names");
  const [mainView, setMainView] = useState<"chat" | "research">("chat");
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [isStorageLoaded, setIsStorageLoaded] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [showRateLimitCard, setShowRateLimitCard] = useState(false);
  const [themeKey, setThemeKey] = useState<ThemeKey>("dark");
  const theme = THEMES[themeKey];
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [lockPin, setLockPin] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [setupPinInput, setSetupPinInput] = useState("");
  const [setupPinError, setSetupPinError] = useState(false);

  // Settings -> Security PIN change flow (requires current PIN to set a new one)
  const [currentPinInput, setCurrentPinInput] = useState("");
  const [newPinInput, setNewPinInput] = useState("");
  const [confirmPinInput, setConfirmPinInput] = useState("");
  const [pinChangeError, setPinChangeError] = useState("");
  const [pinChangeSuccess, setPinChangeSuccess] = useState(false);
  
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState("");
  const [sessionToDeleteId, setSessionToDeleteId] = useState<string | null>(null);
  const [showResetNamesConfirm, setShowResetNamesConfirm] = useState(false);

  // ─── Smartwatch Stress Monitor (mock/test data — see lib/stress) ───────────
  const stress = useStressMonitor({ threshold: 70, stableDurationMs: 20_000 });
  const [stressBannerDismissed, setStressBannerDismissed] = useState(false);

  // Banner reappears in full if stress climbs again after being dismissed
  useEffect(() => {
    if (stress.isStable) setStressBannerDismissed(false);
  }, [stress.isStable]);

  // ─── Typing Behavior Monitor (browser-only secondary signal) ───────────────
  const typing = useTypingBehavior({ stuckThresholdMs: 2 * 60 * 1000 });
  const [stuckNudgeDismissed, setStuckNudgeDismissed] = useState(false);

  // Nudge reappears for the *next* stuck stretch even if dismissed for this one
  useEffect(() => {
    if (!typing.isStuck) setStuckNudgeDismissed(false);
  }, [typing.isStuck]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timeoutRefs = useRef<any[]>([]);
  const isSwitchingRef = useRef(false);
  const lastKeyWasBackspaceRef = useRef(false);

  const getFriendName = useCallback((name: string) => {
    return customNames[name] || (PERSONAS[name as keyof typeof PERSONAS] as any)?.defaultName || name;
  }, [customNames]);

  const addMsg = useCallback((msg: Omit<ChatMessage, "id" | "timestamp">) =>
    setMessages(prev => [...prev, { ...msg, id: crypto.randomUUID(), timestamp: Date.now() }]), []);

  // 1. Mount Effect: Load data from localStorage safely
  useEffect(() => {
    if (!isClerkLoaded) return;
    setHasMounted(true);
    setIsStorageLoaded(false);
    const load = async () => {
      try {
        const storedNames = localStorage.getItem("pathmapper_custom_names");
        if (storedNames) {
          let parsed = null;
          const trimmed = storedNames.trim();
          if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            parsed = JSON.parse(trimmed);
          } else {
            const decrypted = await decryptAES(encryptionKey, trimmed);
            parsed = JSON.parse(decrypted);
          }
          if (parsed) setCustomNames(parsed);
        }

        const storedTheme = localStorage.getItem("pathmapper_theme") as ThemeKey | null;
        if (storedTheme && storedTheme in THEMES) setThemeKey(storedTheme);

        const storedPin = localStorage.getItem("pathmapper_lock_pin");
        if (storedPin) {
          const decrypted = await decryptAES(encryptionKey, storedPin);
          if (decrypted) setLockPin(decrypted);
        }
        
        const storedSessions = localStorage.getItem("pathmapper_sessions");
        if (storedSessions) {
          let parsed: ChatSession[] | null = null;
          const trimmed = storedSessions.trim();
          if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            parsed = JSON.parse(trimmed);
          } else {
            const decrypted = await decryptAES(encryptionKey, trimmed);
            parsed = JSON.parse(decrypted);
          }
          if (parsed) {
            setSessions(parsed);
            
            const activeId = localStorage.getItem("pathmapper_current_session_id");
            if (activeId) {
              const activeSession = parsed.find(s => s.id === activeId);
              if (activeSession) {
                isSwitchingRef.current = true;
                setCurrentSessionId(activeId);
                setMessages(activeSession.messages);
                setPipeline(activeSession.pipeline);
                setStarted(true);
                setTimeout(() => {
                  isSwitchingRef.current = false;
                }, 0);
              }
            }
          }
        }
        setIsStorageLoaded(true);
      } catch (e) {
        console.error("Failed to load local storage:", e);
        setIsStorageLoaded(true);
      }
    };
    load();
  }, [encryptionKey, isClerkLoaded]);

  // 1.5. Auto-save Sessions and Custom Names when they change (Async Encryption)
  // 1.5. Auto-save Sessions and Custom Names when they change (Async Encryption)
  useEffect(() => {
    if (!isClerkLoaded || !isStorageLoaded) return;
    const save = async () => {
      try {
        const encrypted = await encryptAES(encryptionKey, JSON.stringify(sessions));
        localStorage.setItem("pathmapper_sessions", encrypted);
      } catch (e) {
        console.error("Failed to save sessions:", e);
      }
    };
    save();
  }, [sessions, encryptionKey, isStorageLoaded, isClerkLoaded]);

  useEffect(() => {
    if (!isClerkLoaded || !isStorageLoaded) return;
    const save = async () => {
      try {
        const encrypted = await encryptAES(encryptionKey, JSON.stringify(customNames));
        localStorage.setItem("pathmapper_custom_names", encrypted);
      } catch (e) {
        console.error("Failed to save custom names:", e);
      }
    };
    save();
  }, [customNames, encryptionKey, isStorageLoaded, isClerkLoaded]);

  useEffect(() => {
    if (!isClerkLoaded || !isStorageLoaded) return;
    const save = async () => {
      try {
        // If the PIN is empty, don't write an empty pin to local storage if we want to prompt for first-time use.
        // Wait, actually writing empty pin is okay, or we can only write it if it's set.
        // If they clear it in settings we might want to save it as empty to prompt again.
        const encrypted = await encryptAES(encryptionKey, lockPin);
        localStorage.setItem("pathmapper_lock_pin", encrypted);
      } catch (e) {
        console.error("Failed to save lock PIN:", e);
      }
    };
    save();
  }, [lockPin, encryptionKey, isStorageLoaded, isClerkLoaded]);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("pathmapper_theme", themeKey);
  }, [themeKey]);

  // 2. Sync Effect: Auto-save messages and pipeline state for current session
  useEffect(() => {
    if (!isClerkLoaded || !isStorageLoaded || !currentSessionId || isSwitchingRef.current || messages.length === 0) return;
    
    setSessions(prev => {
      const sessionIndex = prev.findIndex(s => s.id === currentSessionId);
      let next: ChatSession[];
      
      if (sessionIndex === -1) {
        const firstMsg = messages[0]?.content ?? "New Decision";
        const title = firstMsg.slice(0, 45) + (firstMsg.length > 45 ? "..." : "");
        const newSession: ChatSession = {
          id: currentSessionId,
          title,
          messages,
          pipeline,
          updatedAt: Date.now(),
        };
        next = [newSession, ...prev];
      } else {
        next = prev.map((s, idx) => {
          if (idx === sessionIndex) {
            return {
              ...s,
              messages,
              pipeline,
              updatedAt: Date.now(),
            };
          }
          return s;
        });
      }
      
      next.sort((a, b) => b.updatedAt - a.updatedAt);
      return next;
    });
  }, [messages, pipeline, currentSessionId, isStorageLoaded, isClerkLoaded]);

  // 3. Wiping localStorage on Logout
  const prevUserRef = useRef<any>(null);
  useEffect(() => {
    if (!isClerkLoaded) return;
    if (prevUserRef.current && !user) {
      localStorage.removeItem("pathmapper_sessions");
      localStorage.removeItem("pathmapper_current_session_id");
      localStorage.removeItem("pathmapper_custom_names");
      setSessions([]);
      setMessages([]);
      setPipeline(INITIAL);
      setStarted(false);
      setCurrentSessionId(null);
    }
    prevUserRef.current = user;
  }, [user, isClerkLoaded]);

  // 4. Inactivity Lock (15 Minutes)
  const lastActivityRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!hasMounted) return;

    const updateActivity = () => {
      lastActivityRef.current = Date.now();
    };

    window.addEventListener("mousemove", updateActivity);
    window.addEventListener("keydown", updateActivity);
    window.addEventListener("click", updateActivity);
    window.addEventListener("scroll", updateActivity);

    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current > 15 * 60 * 1000) {
        setIsLocked(true);
      }
    }, 10000);

    return () => {
      window.removeEventListener("mousemove", updateActivity);
      window.removeEventListener("keydown", updateActivity);
      window.removeEventListener("click", updateActivity);
      window.removeEventListener("scroll", updateActivity);
      clearInterval(interval);
    };
  }, [hasMounted]);

  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (isLocked) {
      setPinInput("");
      setPinError(false);
    }
  }, [isLocked]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Load an existing session
  const loadSession = (session: ChatSession) => {
    timeoutRefs.current.forEach(clearTimeout);
    timeoutRefs.current = [];
    isSwitchingRef.current = true;
    
    setCurrentSessionId(session.id);
    localStorage.setItem("pathmapper_current_session_id", session.id);
    setMessages(session.messages);
    setPipeline(session.pipeline);
    setStarted(true);
    setError(null);
    setTypingPersona(null);
    setShowHistoryDrawer(false); // Close mobile drawer if open
    
    setTimeout(() => {
      isSwitchingRef.current = false;
    }, 0);
  };

  // Start renaming a session
  const startRenameSession = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingSessionTitle(session.title);
  };

  // Save renamed session title
  const saveSessionTitle = (id: string) => {
    if (!editingSessionTitle.trim()) {
      setEditingSessionId(null);
      return;
    }
    
    setSessions(prev => {
      const next = prev.map(s => {
        if (s.id === id) {
          return { ...s, title: editingSessionTitle.trim(), updatedAt: Date.now() };
        }
        return s;
      });
      return next;
    });
    
    setEditingSessionId(null);
  };

  // Trigger inline delete request
  const askDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessionToDeleteId(id);
  };

  // Confirm and execute inline delete
  const confirmDeleteSession = (id: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      return next;
    });

    if (currentSessionId === id) {
      reset();
    }
    setSessionToDeleteId(null);
  };

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading || typingPersona) return;

    let activeId = currentSessionId;
    if (!activeId) {
      activeId = crypto.randomUUID();
      setCurrentSessionId(activeId);
      localStorage.setItem("pathmapper_current_session_id", activeId);
    }

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setStarted(true);
    setError(null);
    addMsg({ role: "user", content: trimmed });
    setIsLoading(true);
    setTypingPersona(null);
    typing.registerSend();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: pipeline, user_message: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === "rate_limit_exceeded") {
          setShowRateLimitCard(true);
          setIsLoading(false);
          setTypingPersona(null);
          return;
        }
        throw new Error(data.detail ?? data.error ?? `Server error ${res.status}`);
      }

      setIsLoading(false);

      const targetPersona = data.message?.persona || "Sam";
      setTypingPersona(targetPersona);

      await new Promise<void>(resolve => {
        const id = setTimeout(resolve, 1500);
        timeoutRefs.current.push(id);
      });

      setTypingPersona(null);
      setPipeline(data.state);

      if (data.message) {
        addMsg({
          role: "system",
          content: data.message.content,
          persona: data.message.persona,
          type: data.message.type,
          metadata: data.message.metadata,
        });
      }

      // Stance comes as a second message after narratives
      if (data.message?.type === "narratives" && data.state?.stance) {
        setTypingPersona(targetPersona);

        await new Promise<void>(resolve => {
          const id = setTimeout(resolve, 1500);
          timeoutRefs.current.push(id);
        });

        setTypingPersona(null);

        addMsg({
          role: "system",
          content: data.state.stance.lean,
          persona: data.message.persona,
          type: "stance",
          metadata: { stance: data.state.stance },
        });
      }
    } catch (err) {
      setIsLoading(false);
      setTypingPersona(null);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(`Something went wrong: ${msg}`);
      console.error("Send error:", err);
    }
  }, [pipeline, isLoading, typingPersona, addMsg, currentSessionId, typing]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const reset = () => {
    timeoutRefs.current.forEach(clearTimeout);
    timeoutRefs.current = [];
    setMessages([]);
    setPipeline(INITIAL);
    setStarted(false);
    setInput("");
    setError(null);
    setTypingPersona(null);
    setCurrentSessionId(null);
    typing.reset();
    localStorage.removeItem("pathmapper_current_session_id");
  };

  const handleUnlock = () => {
    if (pinInput === lockPin) {
      setIsLocked(false);
      setPinInput("");
      setPinError(false);
      lastActivityRef.current = Date.now();
    } else {
      setPinError(true);
    }
  };

  const resetPinChangeFields = () => {
    setCurrentPinInput("");
    setNewPinInput("");
    setConfirmPinInput("");
    setPinChangeError("");
    setPinChangeSuccess(false);
  };

  const handlePinChange = () => {
    setPinChangeSuccess(false);

    if (currentPinInput !== lockPin) {
      setPinChangeError("Current PIN is incorrect.");
      return;
    }
    if (newPinInput.length < 4) {
      setPinChangeError("New PIN must be at least 4 characters long.");
      return;
    }
    if (newPinInput === "1234") {
      setPinChangeError("For security, '1234' is not allowed as a PIN. Please choose another.");
      return;
    }
    if (newPinInput !== confirmPinInput) {
      setPinChangeError("New PIN and confirmation do not match.");
      return;
    }
    if (newPinInput === currentPinInput) {
      setPinChangeError("New PIN must be different from your current PIN.");
      return;
    }

    setLockPin(newPinInput);
    setCurrentPinInput("");
    setNewPinInput("");
    setConfirmPinInput("");
    setPinChangeError("");
    setPinChangeSuccess(true);
  };

  const isDone = pipeline.phase === "done";
  const placeholder = pipeline.phase === "pre_friend" || pipeline.phase === "pre_friend_waiting"
    ? "Describe the decision you're facing..."
    : "Your response...";

  const typingConfig = typingPersona ? (PERSONAS[typingPersona as keyof typeof PERSONAS] || PERSONAS.Sam) : PERSONAS.Sam;

  return (
    <div style={{ display: "flex", height: "100dvh", width: "100vw", background: theme.bg, color: theme.text, fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif", overflow: "hidden" }}>
      <style>{`
        @media (max-width: 768px) {
          .desktop-sidebar {
            display: none !important;
          }
          .mobile-menu-btn {
            display: flex !important;
          }
          .desktop-sidebar-toggle-btn {
            display: none !important;
          }
          .main-chat-container {
            border-left: none !important;
            border-right: none !important;
          }
        }
        @media (min-width: 769px) {
          .desktop-sidebar {
            display: flex !important;
          }
          .mobile-menu-btn {
            display: none !important;
          }
          .desktop-sidebar-toggle-btn {
            display: flex !important;
          }
        }
        /* Custom scrollbar for sidebar */
        .sidebar-scroll::-webkit-scrollbar {
          width: 4px;
        }
        .sidebar-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .sidebar-scroll::-webkit-scrollbar-thumb {
          background: #2A2A3E;
          border-radius: 4px;
        }
        @keyframes stressPulse {
          0%, 100% { transform: scale(1); opacity: 0.35; }
          50% { transform: scale(1.9); opacity: 0; }
        }
        @keyframes stressSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes stressFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* DESKTOP SIDEBAR */}
      <aside 
        className="desktop-sidebar" 
        style={{ 
          display: "flex", 
          flexDirection: "column", 
          width: isSidebarOpen ? 260 : 0, 
          borderRight: isSidebarOpen ? `1px solid ${theme.border}` : "0px solid transparent", 
          background: theme.bg, 
          flexShrink: 0, 
          padding: isSidebarOpen ? "16px 12px" : "16px 0", 
          gap: 16,
          overflow: "hidden",
          transition: "width 0.25s cubic-bezier(0.4, 0, 0.2, 1), padding 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.25s cubic-bezier(0.4, 0, 0.2, 1)"
        }}
      >
        <div style={{ width: 236, display: "flex", flexDirection: "column", gap: 16, height: "100%", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700, paddingLeft: 8 }}>
            PathMapper
          </div>
          
          <button onClick={reset} style={{ width: "100%", padding: "10px", borderRadius: 8, background: theme.card, color: theme.text, border: `1px solid ${theme.borderStrong}`, fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "background 0.2s" }}>
            New Decision
          </button>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }} className="sidebar-scroll">
            <div style={{ fontSize: 11, fontWeight: 600, color: theme.textFaint, letterSpacing: "0.8px", textTransform: "uppercase", paddingLeft: 8, marginTop: 10 }}>History</div>
            {sessions.length === 0 ? (
              <div style={{ padding: "12px 8px", fontSize: 12, color: theme.textFaint, fontStyle: "italic" }}>No previous decisions yet.</div>
            ) : (
              sessions.map(s => {
                const isActive = currentSessionId === s.id;
                const isEditing = editingSessionId === s.id;
                const isDeleting = sessionToDeleteId === s.id;

                if (isDeleting) {
                  return (
                    <div
                      key={s.id}
                      onClick={e => e.stopPropagation()}
                      style={{
                        display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 8,
                        background: "#2A1515", border: "1px solid #C45A5A44", animation: "fadeIn 0.2s ease"
                      }}
                    >
                      <div style={{ fontSize: 11, color: "#F0A0A0", fontWeight: 600 }}>Delete this decision?</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => confirmDeleteSession(s.id)}
                          style={{ flex: 1, background: "#C45A5A", border: "none", color: "white", borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}
                        >
                          Yes, Delete
                        </button>
                        <button
                          onClick={() => setSessionToDeleteId(null)}
                          style={{ flex: 1, background: "#222", border: "1px solid #444", color: "#ccc", borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={s.id}
                    onClick={() => loadSession(s)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 8,
                      background: isActive ? "#161B2A" : "transparent",
                      border: `1px solid ${isActive ? "#3E5B8E66" : "transparent"}`,
                      cursor: "pointer", transition: "all 0.15s", color: isActive ? "#9FC0F0" : "#A0A0B0",
                      position: "relative"
                    }}
                    onMouseEnter={e => {
                      if (!isActive && !isEditing) e.currentTarget.style.background = theme.card;
                    }}
                    onMouseLeave={e => {
                      if (!isActive && !isEditing) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1, marginRight: 8 }}>
                      {isEditing ? (
                        <input
                          value={editingSessionTitle}
                          onChange={e => setEditingSessionTitle(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") saveSessionTitle(s.id);
                            if (e.key === "Escape") setEditingSessionId(null);
                          }}
                          onBlur={() => saveSessionTitle(s.id)}
                          onClick={e => e.stopPropagation()}
                          autoFocus
                          style={{
                            background: "#0F0F16", border: "1px solid #3E5B8E", borderRadius: 4,
                            padding: "4px 6px", color: "#E8E4DC", fontSize: 13, width: "100%", outline: "none"
                          }}
                        />
                      ) : (
                        <>
                          <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {s.title}
                          </div>
                          <div style={{ fontSize: 10, color: "#555" }}>
                            {new Date(s.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          </div>
                        </>
                      )}
                    </div>
                    {!isEditing && (
                      <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
                        <button
                          onClick={e => startRenameSession(s, e)}
                          style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 11, padding: 4, fontWeight: 600 }}
                          title="Rename decision"
                          onMouseEnter={e => e.currentTarget.style.color = "#E8E4DC"}
                          onMouseLeave={e => e.currentTarget.style.color = "#666"}
                        >
                          Edit
                        </button>
                        <button
                          onClick={e => askDeleteSession(s.id, e)}
                          style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 11, padding: 4, fontWeight: 600 }}
                          title="Delete history"
                          onMouseEnter={e => e.currentTarget.style.color = "#E05A5A"}
                          onMouseLeave={e => e.currentTarget.style.color = "#666"}
                        >
                          Del
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>

      {/* MOBILE DRAWER */}
      {showHistoryDrawer && (
        <div
          onClick={() => setShowHistoryDrawer(false)}
          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: 280, height: "100%", background: theme.bg, borderRight: `1px solid ${theme.border}`, padding: "16px 12px", display: "flex", flexDirection: "column", gap: 16 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingLeft: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700 }}>
                PathMapper
              </div>
              <button onClick={() => setShowHistoryDrawer(false)} style={{ background: "none", border: "none", color: "#888", fontSize: 16, cursor: "pointer" }}>✕</button>
            </div>

            <button onClick={() => { reset(); setShowHistoryDrawer(false); }} style={{ width: "100%", padding: "10px", borderRadius: 8, background: "#1C1C2C", color: "#E8E4DC", border: "1px solid #2A2A3E", fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              New Decision
            </button>

            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: theme.textFaint, letterSpacing: "0.8px", textTransform: "uppercase", paddingLeft: 8, marginTop: 10 }}>History</div>
              {sessions.length === 0 ? (
                <div style={{ padding: "12px 8px", fontSize: 12, color: theme.textFaint, fontStyle: "italic" }}>No previous decisions yet.</div>
              ) : (
                sessions.map(s => {
                  const isActive = currentSessionId === s.id;
                  const isEditing = editingSessionId === s.id;
                  const isDeleting = sessionToDeleteId === s.id;

                  if (isDeleting) {
                    return (
                      <div
                        key={s.id}
                        onClick={e => e.stopPropagation()}
                        style={{
                          display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 8,
                          background: "#2A1515", border: "1px solid #C45A5A44", animation: "fadeIn 0.2s ease"
                        }}
                      >
                        <div style={{ fontSize: 11, color: "#F0A0A0", fontWeight: 600 }}>Delete this decision?</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            onClick={() => confirmDeleteSession(s.id)}
                            style={{ flex: 1, background: "#C45A5A", border: "none", color: "white", borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}
                          >
                            Yes, Delete
                          </button>
                          <button
                            onClick={() => setSessionToDeleteId(null)}
                            style={{ flex: 1, background: "#222", border: "1px solid #444", color: "#ccc", borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={s.id}
                      onClick={() => loadSession(s)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 8,
                        background: isActive ? "#161B2A" : "transparent",
                        border: `1px solid ${isActive ? "#3E5B8E66" : "transparent"}`,
                        cursor: "pointer", color: isActive ? "#9FC0F0" : "#A0A0B0"
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1, marginRight: 8 }}>
                        {isEditing ? (
                          <input
                            value={editingSessionTitle}
                            onChange={e => setEditingSessionTitle(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter") saveSessionTitle(s.id);
                              if (e.key === "Escape") setEditingSessionId(null);
                            }}
                            onBlur={() => saveSessionTitle(s.id)}
                            onClick={e => e.stopPropagation()}
                            autoFocus
                            style={{
                              background: "#0F0F16", border: "1px solid #3E5B8E", borderRadius: 4,
                              padding: "4px 6px", color: "#E8E4DC", fontSize: 13, width: "100%", outline: "none"
                            }}
                          />
                        ) : (
                          <>
                            <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {s.title}
                            </div>
                            <div style={{ fontSize: 10, color: "#555" }}>
                              {new Date(s.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </div>
                          </>
                        )}
                      </div>
                      {!isEditing && (
                        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
                          <button
                            onClick={e => startRenameSession(s, e)}
                            style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 11, padding: 4, fontWeight: 600 }}
                            title="Rename decision"
                          >
                            Edit
                          </button>
                          <button
                            onClick={e => askDeleteSession(s.id, e)}
                            style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 11, padding: 4, fontWeight: 600 }}
                            title="Delete history"
                          >
                            Del
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* MAIN CHAT AREA */}
      <div className="main-chat-container" style={{ display: "flex", flexDirection: "column", flex: 1, height: "100%", background: theme.surface, borderLeft: `1px solid ${theme.border}`, borderRight: `1px solid ${theme.border}`, position: "relative" }}>
        
        {/* Authenticated Application Header Row */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
          {/* Left Side: App Title and Subtitle */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Desktop Toggle Sidebar Button */}
            <button
              onClick={() => setIsSidebarOpen(prev => !prev)}
              className="desktop-sidebar-toggle-btn"
              style={{
                background: "none", border: "none", color: "#8A8A9A", cursor: "pointer",
                padding: 6, display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: 6, transition: "background 0.15s, color 0.15s"
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "#1C1C2C";
                e.currentTarget.style.color = "#E8E4DC";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = "#8A8A9A";
              }}
              title={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>

            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 700, letterSpacing: "-0.3px" }}>
                <button
                  onClick={() => setShowHistoryDrawer(true)}
                  className="mobile-menu-btn"
                  style={{ display: "none", background: "none", border: "none", color: "#E8E4DC", cursor: "pointer", fontSize: 18, padding: 0, marginRight: 4 }}
                  aria-label="Open History"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                </button>
                PathMapper
                <span style={{ fontSize: 11, background: theme.card, color: theme.accent, padding: "2px 8px", borderRadius: 20, fontWeight: 600, letterSpacing: "0.5px" }}>BETA</span>
              </div>
              <span style={{ color: theme.textMuted, fontSize: 12 }}>
                Active friends: {getFriendName("Sam")}, {getFriendName("Dev")}, {getFriendName("Mina")}, {getFriendName("Theo")}, {getFriendName("Priya")}, {getFriendName("Jordan")}
              </span>
            </div>
          </div>

          {/* Right Side: Navigation Actions & Auth Layout */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <StressBadge
              status={stress.status}
              level={stress.level}
              onConnect={stress.connect}
              onDisconnect={stress.disconnect}
            />
            <TypingBadge
              isStuck={typing.isStuck}
              stuckForMs={typing.stuckForMs}
              typingScore={typing.typingScore}
            />

            <div style={{ display: "flex", gap: 4, background: theme.surface, border: `1px solid ${theme.borderStrong}`, borderRadius: 8, padding: 3 }}>
              <button
                onClick={() => setMainView("chat")}
                style={{
                  background: mainView === "chat" ? theme.card : "none", border: "none",
                  color: mainView === "chat" ? theme.text : theme.textMuted, padding: "5px 12px",
                  borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s"
                }}
              >
                Chat
              </button>
              <button
                onClick={() => setMainView("research")}
                style={{
                  background: mainView === "research" ? theme.card : "none", border: "none",
                  color: mainView === "research" ? theme.text : theme.textMuted, padding: "5px 12px",
                  borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s"
                }}
              >
                Research
              </button>
            </div>

            <button
              onClick={() => {
                setSettingsTab("names");
                setShowEditModal(true);
              }}
              style={{ background: "none", border: `1px solid ${theme.borderStrong}`, color: theme.textMuted, padding: "6px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 500 }}
            >
              Settings
            </button>

            {started && mainView === "chat" && (
              <button onClick={reset} style={{ background: "none", border: `1px solid ${theme.borderStrong}`, color: theme.textMuted, padding: "6px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
                New decision
              </button>
            )}

            {/* Display when the user is completely signed out */}
            <SignedOut>
              <SignInButton mode="modal">
                <button style={{ background: "#5B8A6A", color: "white", border: "none", padding: "6px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "background 0.15s" }}>
                  Sign In
                </button>
              </SignInButton>
            </SignedOut>

            {/* Display when a valid session token is found */}
            <SignedIn>
              <UserButton />
            </SignedIn>
          </div>
        </header>

        {mainView === "research" ? (
          <ResearchPanel />
        ) : (
        <>
        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          <StressBanner
            level={stress.level}
            isElevated={stress.isElevated}
            isStable={stress.isStable}
            secondsElevated={stress.secondsElevated}
            dismissed={stressBannerDismissed}
            onDismiss={() => setStressBannerDismissed(true)}
          />

          {!started
            ? <WelcomeScreen onSend={send} theme={theme} />
            : messages.map(msg => <ChatBubble key={msg.id} msg={msg} customNames={customNames} theme={theme} />)
          }

          {typingPersona && (
            <div style={{ display: "flex", gap: 10, alignSelf: "flex-start", maxWidth: "92%" }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, flexShrink: 0, marginTop: 18, background: typingConfig.bg, border: `2px solid ${typingConfig.color}`
              }}
              >{typingConfig.defaultName?.[0] ?? "?"}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: typingConfig.color, marginLeft: 2 }}>
                  {getFriendName(typingPersona)}
                </div>
                <TypingDots />
              </div>
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12, color: "#C45A5A", padding: "8px 12px", background: "#2A1010", border: "1px solid #C45A5A33", borderRadius: 8, textAlign: "center" }}>
              {error}
              <button onClick={() => setError(null)} style={{ marginLeft: 8, background: "none", border: "none", color: "#C45A5A", cursor: "pointer", fontSize: 12 }}>✕</button>
            </div>
          )}

          {showRateLimitCard && (
            <div style={{
              background: "#2A1515", border: "1px solid #C45A5A44", borderRadius: 12,
              padding: 16, display: "flex", flexDirection: "column", gap: 12,
              animation: "fadeIn 0.2s ease"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: "#F0A0A0" }}>!</span>
                <div style={{ fontSize: 13, color: "#F0A0A0", fontWeight: 600 }}>API Quota Limit Reached</div>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: "#D8A0A0", lineHeight: 1.5 }}>
                We've temporarily run out of AI API tokens for this demo. Please contact the developers at <strong>devs@pathmapper.ai</strong> to get this replenished, or try again shortly.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => setShowRateLimitCard(false)}
                  style={{
                    background: "#222", border: "1px solid #444", color: "#ccc",
                    padding: "6px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer",
                    fontWeight: 600
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${theme.border}`, flexShrink: 0, background: theme.surface }}>
          <StuckDraftNudge
            stuckForMs={typing.stuckForMs}
            dismissed={stuckNudgeDismissed || !typing.isStuck}
            onDismiss={() => setStuckNudgeDismissed(true)}
          />
          {stress.isElevated && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 11.5, color: "#E0A080", marginBottom: 8,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#E06B4E", flexShrink: 0 }} />
              Stress reads {stress.level}/100 right now — worth a breath before deciding.
            </div>
          )}
          {isDone ? (
            <div style={{ textAlign: "center", fontSize: 12, color: theme.textFaint }}>
              Analysis complete. {" "}
              <button onClick={reset} style={{ background: "none", border: "none", color: theme.accent, cursor: "pointer", fontSize: 12, textDecoration: "underline" }}>
                Start a new decision →
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", background: theme.inputBg, border: `1px solid ${theme.borderStrong}`, borderRadius: 14, padding: "10px 12px" }}>
              <textarea
                ref={textareaRef}
                placeholder={placeholder}
                value={input}
                rows={1}
                disabled={isLoading}
                onChange={e => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                  typing.registerKeystroke(lastKeyWasBackspaceRef.current, e.target.value);
                }}
                onKeyDown={e => {
                  lastKeyWasBackspaceRef.current = e.key === "Backspace" || e.key === "Delete";
                  handleKey(e);
                }}
                style={{
                  flex: 1, background: "none", border: "none", outline: "none",
                  color: theme.text, fontSize: 14, lineHeight: 1.5, resize: "none",
                  maxHeight: 120, overflowY: "auto", fontFamily: "inherit"
                }}
              />
              <button
                onClick={() => send(input)}
                disabled={isLoading || !input.trim()}
                style={{
                  width: 34, height: 34, borderRadius: "50%",
                  background: isLoading || !input.trim() ? theme.borderStrong : theme.accent,
                  border: "none", cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, color: "white", fontSize: 16, transition: "background 0.15s"
                }}
                aria-label="Send"
              >↑</button>
            </div>
          )}
          
          <div style={{ textAlign: "center", fontSize: 10, color: theme.textFaint, marginTop: 8, letterSpacing: "0.2px" }}>
            PathMapper uses AI personas to help you think through your decision.
          </div>
        </div>
        </>
        )}
      </div>

      {/* SETTINGS & CUSTOMIZATION MODAL */}
      {showEditModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: theme.card, border: `1px solid ${theme.borderStrong}`, borderRadius: 16, width: "100%", maxWidth: 450, padding: 24, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Settings & Customization</h3>
              <button onClick={() => { setShowEditModal(false); resetPinChangeFields(); }} style={{ background: "none", border: "none", color: "#888", fontSize: 16, cursor: "pointer" }}>✕</button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: `1px solid ${theme.border}`, gap: 16, paddingBottom: 8 }}>
              <button
                onClick={() => setSettingsTab("names")}
                style={{
                  background: "none", border: "none", color: settingsTab === "names" ? theme.text : theme.textMuted,
                  fontWeight: 600, fontSize: 13, cursor: "pointer", padding: "4px 8px",
                  borderBottom: settingsTab === "names" ? `2px solid ${theme.accent}` : "2px solid transparent",
                  transition: "all 0.15s"
                }}
              >
                AI Friends
              </button>
              <button
                onClick={() => { setSettingsTab("security"); resetPinChangeFields(); }}
                style={{
                  background: "none", border: "none", color: settingsTab === "security" ? theme.text : theme.textMuted,
                  fontWeight: 600, fontSize: 13, cursor: "pointer", padding: "4px 8px",
                  borderBottom: settingsTab === "security" ? `2px solid ${theme.accent}` : "2px solid transparent",
                  transition: "all 0.15s"
                }}
              >
                Security PIN
              </button>
              <button
                onClick={() => setSettingsTab("theme")}
                style={{
                  background: "none", border: "none", color: settingsTab === "theme" ? theme.text : theme.textMuted,
                  fontWeight: 600, fontSize: 13, cursor: "pointer", padding: "4px 8px",
                  borderBottom: settingsTab === "theme" ? `2px solid ${theme.accent}` : "2px solid transparent",
                  transition: "all 0.15s"
                }}
              >
                Theme
              </button>
            </div>

            {settingsTab === "names" ? (
              <>
                <p style={{ margin: 0, fontSize: 12, color: theme.textMuted }}>Change the names of your AI friend group. These will show up in the chat conversation.</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxHeight: 260, overflowY: "auto" }} className="sidebar-scroll">
                  {Object.entries(PERSONAS).map(([key, config]) => (
                    <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: config.color, display: "flex", alignItems: "center", gap: 4 }}>
                        <span>{config.emoji}</span> {config.defaultName} <span style={{ color: theme.textFaint, fontSize: 10 }}>— {config.subtitle}</span>
                      </label>
                      <input
                        type="text"
                        placeholder={`e.g. ${config.defaultName}`}
                        value={customNames[key] || ""}
                        onChange={e => {
                          const val = e.target.value;
                          setCustomNames(prev => ({ ...prev, [key]: val }));
                        }}
                        style={{ background: theme.surface, border: `1px solid ${theme.borderStrong}`, borderRadius: 8, padding: "8px 10px", color: theme.text, fontSize: 13, outline: "none" }}
                      />
                    </div>
                  ))}
                </div>
                {showResetNamesConfirm ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "#2A1515", border: "1px solid #C45A5A44", borderRadius: 12, padding: 12, marginTop: 8, animation: "fadeIn 0.2s ease" }}>
                    <div style={{ fontSize: 12, color: "#F0A0A0", fontWeight: 600 }}>Reset all friend names to default? This cannot be undone.</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => {
                          setCustomNames({});
                          setShowResetNamesConfirm(false);
                        }}
                        style={{ flex: 1, background: "#C45A5A", border: "none", color: "white", padding: "6px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: 600 }}
                      >
                        Yes, Reset
                      </button>
                      <button
                        onClick={() => setShowResetNamesConfirm(false)}
                        style={{ flex: 1, background: "#222", border: "1px solid #444", color: "#ccc", padding: "6px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
                    <button onClick={() => setShowResetNamesConfirm(true)} style={{ background: "none", border: "1px solid #C45A5A33", color: "#C45A5A", padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
                      Reset All
                    </button>
                    <button onClick={() => setShowEditModal(false)} style={{ background: theme.accent, border: "none", color: "white", padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      Done
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <p style={{ margin: 0, fontSize: 12, color: theme.textMuted, lineHeight: 1.5 }}>
                  {lockPin
                    ? "Enter your current PIN, then choose a new one to update your session lock."
                    : "Set a custom security PIN to lock/unlock your active session during inactivity."}
                </p>

                {lockPin && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#8A8A9A" }}>Current PIN</label>
                    <input
                      type="password"
                      maxLength={10}
                      placeholder="Enter current PIN"
                      value={currentPinInput}
                      onChange={e => {
                        const val = e.target.value.replace(/[^a-zA-Z0-9]/g, "");
                        setCurrentPinInput(val);
                        setPinChangeError("");
                        setPinChangeSuccess(false);
                      }}
                      style={{ background: theme.surface, border: `1px solid ${theme.borderStrong}`, borderRadius: 8, padding: "10px 12px", color: theme.text, fontSize: 14, outline: "none", letterSpacing: "1px" }}
                    />
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#8A8A9A" }}>New PIN</label>
                  <input
                    type="password"
                    maxLength={10}
                    placeholder="Enter new PIN (e.g. 5829)"
                    value={newPinInput}
                    onChange={e => {
                      const val = e.target.value.replace(/[^a-zA-Z0-9]/g, "");
                      setNewPinInput(val);
                      setPinChangeError("");
                      setPinChangeSuccess(false);
                    }}
                    style={{ background: theme.surface, border: `1px solid ${theme.borderStrong}`, borderRadius: 8, padding: "10px 12px", color: theme.text, fontSize: 14, outline: "none", letterSpacing: "1px" }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#8A8A9A" }}>Confirm New PIN</label>
                  <input
                    type="password"
                    maxLength={10}
                    placeholder="Re-enter new PIN"
                    value={confirmPinInput}
                    onChange={e => {
                      const val = e.target.value.replace(/[^a-zA-Z0-9]/g, "");
                      setConfirmPinInput(val);
                      setPinChangeError("");
                      setPinChangeSuccess(false);
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter") handlePinChange();
                    }}
                    style={{ background: theme.surface, border: `1px solid ${theme.borderStrong}`, borderRadius: 8, padding: "10px 12px", color: theme.text, fontSize: 14, outline: "none", letterSpacing: "1px" }}
                  />
                </div>

                {pinChangeError && (
                  <div style={{ fontSize: 12, color: "#F0A0A0", background: "#2A1515", border: "1px solid #C45A5A33", borderRadius: 8, padding: "8px 10px" }}>
                    {pinChangeError}
                  </div>
                )}
                {pinChangeSuccess && (
                  <div style={{ fontSize: 12, color: "#9FD8B0", background: "#142A1E", border: "1px solid #5B8A6A33", borderRadius: 8, padding: "8px 10px" }}>
                    PIN updated successfully.
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                  <button
                    onClick={() => {
                      resetPinChangeFields();
                      setShowEditModal(false);
                    }}
                    style={{ background: "none", border: `1px solid ${theme.borderStrong}`, color: theme.textMuted, padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}
                  >
                    Close
                  </button>
                  <button
                    onClick={handlePinChange}
                    style={{ background: theme.accent, border: "none", color: "white", padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  >
                    Update PIN
                  </button>
                </div>
              </div>
            )}

            {settingsTab === "theme" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <p style={{ margin: 0, fontSize: 12, color: theme.textMuted, lineHeight: 1.5 }}>
                  Choose a color palette for PathMapper.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {(Object.keys(THEMES) as ThemeKey[]).map(key => {
                    const t = THEMES[key];
                    const isActive = themeKey === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setThemeKey(key)}
                        style={{
                          background: t.surface,
                          border: `2px solid ${isActive ? t.accent : t.border}`,
                          borderRadius: 12, padding: "14px", cursor: "pointer",
                          display: "flex", flexDirection: "column", gap: 8, textAlign: "left",
                          transition: "all 0.15s",
                          boxShadow: isActive ? `0 0 0 2px ${t.accent}44` : "none",
                        }}
                      >
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span style={{ width: 16, height: 16, borderRadius: "50%", background: t.accent }} />
                          <span style={{ width: 16, height: 16, borderRadius: "50%", background: t.userBubble }} />
                          <span style={{ width: 16, height: 16, borderRadius: "50%", background: t.card, border: `1px solid ${t.borderStrong}` }} />
                        </div>
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 700, color: t.text, display: "block" }}>{t.label}</span>
                          {isActive && <span style={{ fontSize: 10, color: t.accent, fontWeight: 600 }}>Active</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setShowEditModal(false)}
                    style={{ background: theme.accent, border: "none", color: "white", padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Force PIN Setup Overlay (First Use Security Enforcement) */}
      {isStorageLoaded && (lockPin === "" || lockPin === "1234") && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(7, 7, 10, 0.85)", backdropFilter: "blur(20px)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          zIndex: 9998, padding: 24, animation: "fadeIn 0.4s ease"
        }}>
          <div style={{
            background: "linear-gradient(135deg, #161624 0%, #0F0F1A 100%)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 24,
            padding: "48px 36px", maxWidth: 420, width: "100%", textAlign: "center",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 24,
            boxShadow: "0 0 50px rgba(91, 138, 106, 0.1), 0 20px 50px rgba(0,0,0,0.7)"
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: "50%", background: "rgba(91, 138, 106, 0.1)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32,
              border: "1px solid rgba(91, 138, 106, 0.2)", marginBottom: 4
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#5B8A6A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#E8E4DC", letterSpacing: "-0.5px" }}>Set Security PIN</h2>
              <p style={{ margin: 0, fontSize: 13, color: "#8A8A9A", lineHeight: 1.6 }}>
                To protect your decision-mapping privacy on shared devices, please set a custom security PIN. This will be required to unlock your session after 15 minutes of inactivity.
              </p>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
              <input
                type="text"
                placeholder="Enter new PIN (e.g. 5829)"
                value={setupPinInput}
                onChange={e => {
                  const val = e.target.value.replace(/[^a-zA-Z0-9]/g, "");
                  setSetupPinInput(val);
                  setSetupPinError(false);
                }}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    if (setupPinInput.length < 4) {
                      setSetupPinError(true);
                    } else if (setupPinInput === "1234") {
                      alert("For security, '1234' is not allowed as a PIN. Please set a custom PIN.");
                    } else {
                      setLockPin(setupPinInput);
                      setSetupPinInput("");
                      setSetupPinError(false);
                    }
                  }
                }}
                style={{
                  width: "100%", background: "rgba(0, 0, 0, 0.3)", border: setupPinError ? "1px solid #C45A5A" : "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: 12, padding: "14px 18px", color: "#E8E4DC", fontSize: 15,
                  textAlign: "center", letterSpacing: "2px", outline: "none", transition: "all 0.2s"
                }}
              />
              {setupPinError ? (
                <span style={{ color: "#C45A5A", fontSize: 12, fontWeight: 500 }}>PIN must be at least 4 characters long.</span>
              ) : (
                <span style={{ color: "#555", fontSize: 11 }}>Use letters or numbers. Minimum 4 characters.</span>
              )}
            </div>

            <button
              onClick={() => {
                if (setupPinInput.length < 4) {
                  setSetupPinError(true);
                } else if (setupPinInput === "1234") {
                  alert("For security, '1234' is not allowed as a PIN. Please set a custom PIN.");
                } else {
                  setLockPin(setupPinInput);
                  setSetupPinInput("");
                  setSetupPinError(false);
                }
              }}
              style={{
                width: "100%", background: "#5B8A6A", color: "white", border: "none",
                borderRadius: 12, padding: "14px 24px", fontSize: 14, fontWeight: 700,
                cursor: "pointer", transition: "all 0.2s", letterSpacing: "0.5px"
              }}
              onMouseEnter={e => (e.target as HTMLElement).style.background = "#6C9C7B"}
              onMouseLeave={e => (e.target as HTMLElement).style.background = "#5B8A6A"}
            >
              Confirm PIN
            </button>
          </div>
        </div>
      )}

      {/* Lock Screen Overlay (Responsible AI) */}
      {isLocked && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(7, 7, 10, 0.85)", backdropFilter: "blur(20px)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          zIndex: 9999, padding: 24, animation: "fadeIn 0.3s ease"
        }}>
          <div style={{
            background: "linear-gradient(135deg, #161624 0%, #0F0F1A 100%)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 24,
            padding: "48px 36px", maxWidth: 420, width: "100%", textAlign: "center",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 24,
            boxShadow: "0 0 50px rgba(91, 138, 106, 0.05), 0 20px 50px rgba(0,0,0,0.7)"
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: "50%", background: "rgba(255, 255, 255, 0.03)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32,
              border: "1px solid rgba(255, 255, 255, 0.08)", marginBottom: 4
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#8A8A9A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#E8E4DC", letterSpacing: "-0.5px" }}>Session Locked</h2>
              <p style={{ margin: 0, fontSize: 13, color: "#8A8A9A", lineHeight: 1.6 }}>
                For your privacy, this decision-mapping session has been locked due to 15 minutes of inactivity. Enter your unlock PIN to resume.
              </p>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
              <input
                type="password"
                placeholder="Enter PIN"
                value={pinInput}
                onChange={e => {
                  setPinInput(e.target.value);
                  setPinError(false);
                }}
                onKeyDown={e => {
                  if (e.key === "Enter") handleUnlock();
                }}
                style={{
                  width: "100%", background: "rgba(0, 0, 0, 0.3)", border: pinError ? "1px solid #C45A5A" : "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: 12, padding: "14px 18px", color: "#E8E4DC", fontSize: 15,
                  textAlign: "center", letterSpacing: "4px", outline: "none", transition: "all 0.2s"
                }}
              />
              {pinError && (
                <span style={{ color: "#C45A5A", fontSize: 12, fontWeight: 500 }}>Incorrect PIN. Please try again.</span>
              )}
            </div>

            <button
              onClick={handleUnlock}
              style={{
                width: "100%", background: "#5B8A6A", color: "white", border: "none",
                borderRadius: 12, padding: "14px 24px", fontSize: 14, fontWeight: 700,
                cursor: "pointer", transition: "all 0.2s", letterSpacing: "0.5px"
              }}
              onMouseEnter={e => (e.target as HTMLElement).style.background = "#6C9C7B"}
              onMouseLeave={e => (e.target as HTMLElement).style.background = "#5B8A6A"}
            >
              Unlock Session
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
