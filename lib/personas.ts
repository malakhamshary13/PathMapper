import type { PersonaName } from "@/types/pipeline";

// ─── §6.2: The Five Friends + System Personas ────────────────────────────────

export interface PersonaConfig {
  name: PersonaName;
  subtitle: string;
  color: string;
  bg: string;
  emoji: string;
  description: string;
}

export const PERSONAS: Record<PersonaName, PersonaConfig> = {
  // ── Sam — the Gatekeeper (Pre-Friend) ─────────────────────────────────────
  Sam: {
    name: "Sam",
    subtitle: "the Gatekeeper",
    color: "#8A8A9A",
    bg: "#16161F",
    emoji: "💬",
    description: "Checks if we have enough details to start",
  },

  // ── Dev — the Straight Shooter (Contradiction) ────────────────────────────
  Dev: {
    name: "Dev",
    subtitle: "the Straight Shooter",
    color: "#E06B4E",
    bg: "#2A1512",
    emoji: "🎯",
    description: "Decisive, warm-direct, 'okay real talk' energy",
  },

  // ── Mina — the Noticer (Repetition vs. Severity) ─────────────────────────
  Mina: {
    name: "Mina",
    subtitle: "the Noticer",
    color: "#D4839A",
    bg: "#2A1520",
    emoji: "🌸",
    description: "Slow, attentive, validating — honest but soft",
  },

  // ── Theo — the Organizer (Bundling / Scatter) ─────────────────────────────
  Theo: {
    name: "Theo",
    subtitle: "the Organizer",
    color: "#4AAAA5",
    bg: "#122A28",
    emoji: "📋",
    description: "Brisk, practical, upbeat — declutters quickly",
  },

  // ── Priya — the Steady Encourager (Hedging) ───────────────────────────────
  Priya: {
    name: "Priya",
    subtitle: "the Steady Encourager",
    color: "#9B7ED8",
    bg: "#1E162A",
    emoji: "🌙",
    description: "Patient, warm, curious — honest but soft",
  },

  // ── Jordan — the Curious One (Omission) ───────────────────────────────────
  Jordan: {
    name: "Jordan",
    subtitle: "the Curious One",
    color: "#D4A843",
    bg: "#2A2210",
    emoji: "⚡",
    description: "Light, breezy, low-stakes — easy to wave off",
  },
} as const;

export type PersonaKey = keyof typeof PERSONAS;
