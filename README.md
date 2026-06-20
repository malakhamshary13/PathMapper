# PathMapper v1.2
### USAII Global AI Hackathon 2026 — Undergraduate Track, Brief 3

PathMapper is an AI-powered life decision simulator that helps users unpack complex career or life dilemmas. It resolves reasoning biases and contradictions through a group-chat style interaction before mapping two contrasting future paths.

---

## Quick Start (5 minutes)

### 1. Get Free API Keys
* Gemini API Key: Get a free key at https://aistudio.google.com/app/apikey
* Groq API Key (Optional): Get a key at https://console.groq.com/keys (The application automatically falls back to Gemini if your Groq key is rate-limited or missing).
* Clerk Authentication: Sign up for a free developer account at Clerk and create an application instance.

### 2. Install & Run

```bash
# Install dependencies
npm install

# Setup environment variables
cp .env.local.template .env
# Open .env and paste your GEMINI_API_KEY and GROQ_API_KEY

# Install the Clerk CLI globally and authenticate
npm install -g clerk
clerk auth login

# Link your local workspace to your Clerk Application instance
clerk init --app app_3FNINQmj0FiVfcqp47BOqVpa4eb

# Run development server
npm run dev

# Open http://localhost:3000 in your browser
```

### 3. Deploy to Vercel

```bash
npx vercel
# Add the environment variables in your Vercel project settings:
# - GEMINI_API_KEY
# - GROQ_API_KEY
# - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
# - CLERK_SECRET_KEY
# - NEXT_PUBLIC_CLERK_AFTER_SIGN_OUT_URL
```

---

## Detailed System Architecture

PathMapper uses a stateful, dual-model (Groq + Gemini) architecture to guide users through a structured reasoning analysis. The application is built with Next.js 14, React, and TypeScript. All logic is run on the server side in a single request/response cycle to eliminate latency and cross-origin issues.

### 1. Client-Side Presentation Layer (app/page.tsx)
The frontend simulates a WhatsApp group chat with a team of supportive AI friends:
* Sam (the Gatekeeper): Guides the initial intake phase.
* Dev (the Straight Shooter): Challenges contradictions in logic.
* Mina (the Noticer): Points out repetition and emotional cues.
* Theo (the Organizer): Untangles bundled premises.
* Priya (the Steady Encourager): Checks for hedging and wishful thinking.
* Jordan (the Curious One): Investigates omissions and unaddressed variables.

#### Core Frontend Mechanics:
* State Orchestration: The frontend acts as a rendering loop, sending the current PipelineState and the user's latest message to the backend API, and rendering the updated state.
* Delayed Typing Simulation: To maintain conversational flow, when a backend response is returned, the client parses the selected sender persona and displays a matching typing indicator for exactly 1500 milliseconds before displaying the message. This eliminates mismatches where the typing indicator would show one friend while a different friend sent the message.
* Dynamic Visuals: Rendered scoreboards and narrative cards update dynamically based on the state payload.

### 2. Server-Side Execution Pipeline (app/api/chat/route.ts)
The `/api/chat` POST route takes the user's message and the current client state, then runs the appropriate state-machine phase functions:

```
[User Input Received]
         │
         ▼
[Phase 1: Pre-Friend (Richness Gate)] ── (Lacks Signals) ──► [Ask Pre-Friend Question] ──► (Client)
         │ (All Signals Present)
         ▼
[Phase 2: Signal Extraction]
         │ (Extracts Values, Paths, Stated Factors)
         ▼
[Phase 3: Checkpoint Selection] ──────── (Checkpoint Found) ─► [Actor-Critic Response Loop] ──► (Client)
         │ (All Checkpoints Addressed)
         ▼
[Phase 4: Narrative Generation]
         │ (Generates Future Path A & Path B)
         ▼
[Phase 5: Path Scoring]
         │ (Scores 5 Dimensions via TypeScript)
         ▼
[Phase 6: Stance Evaluation] ──────────────────────────────► [Render Narratives & Stance] ──► (Client)
```

---

## How It Works: Phase by Phase

### Phase 1: Pre-Friend Richness Gate
* Logic: When a user enters their dilemma, the backend calls `runPreFriendRichness` to check for five essential decision dimensions (financial trajectory, growth, values alignment, social capital, stability).
* Prompting: If any priority dimensions are missing, the assistant asks follow-up questions (maximum 3 turns) to extract this context before entering the main loop.

### Phase 2: Signal Extraction
* Logic: The combined user input is processed by `runExtraction` to produce a structured JSON metadata block representing:
  - Stated values (e.g. money, security, freedom)
  - Path options (e.g. corporate job vs. startup)
  - Core variables (e.g. relocation, marriage)

### Phase 3: Checkpoint Loop
* Logic: The backend evaluates the extracted data and conversation history against five reasoning checkpoints:
  1. Contradiction (Dev): Highlighting conflicting goals (e.g. wanting high wealth but refusing high-growth risks).
  2. Bundling (Theo): Separating independent decisions (e.g. separating the career choice from a marriage timeline).
  3. Repetition (Mina): Pointing out emotional fixation on single terms (e.g. money).
  4. Hedging (Priya): Addressing non-committal or passive stances.
  5. Omission (Jordan): Bringing up variables the user omitted but implied.
* Resolution: For each active checkpoint, the associated friend asks a target question. The user's answer is evaluated by `runResolvePremise` and marked as resolved.

### Phase 4: Actor-Critic Response Loop (Groq + Gemini Critic)
For conversational turns, PathMapper runs a generator-critic loop (`callLLM`):
* Actor (Groq): Calls the primary generator (`llama-3.3-70b-versatile`) to draft the response in the selected friend's persona.
* Critic (Gemini): Evaluates the draft using a verification prompt checking for casual WhatsApp style, empathy, length constraints, and robotic/clinical keywords.
* Revisions: If the Critic is unsatisfied, the Actor is called again with the Critic's specific feedback. This loop runs for a maximum of 2 revisions to avoid latency.
* Fallback: If Groq hits a 429 rate limit, the loop falls back automatically to Gemini (`gemini-2.0-flash`), which is configured with strict JSON mode configurations (`responseMimeType: "application/json"`) to ensure JSON integrity.

### Phase 5: Narrative Generation & Path Scoring
* Narratives: Once all checkpoints are cleared, `runNarrativeGeneration` uses Gemini to construct two vivid, realistic future scenarios (Path A and Path B) that are directly bound by the resolved premises.
* Scoring: A deterministic TypeScript scoring system (`scorePaths`) evaluates the paths against the five core dimensions based on the conversation's resolved premises, outputting a clear numerical comparison (out of 25).

### Phase 6: Stance Evaluation
* Final Lean: Gemini evaluates the scored paths to formulate an overall recommended lean and a "flip condition" (e.g. what would have to change for the other path to win).
* Human Agency Handback: To ensure ethical AI, the loop concludes with a direct handback outlining what variables only the user can decide, reinforcing human agency.

---

## Environment Variables

Copy `.env.local.template` to `.env` and fill in the values:

```env
# API Keys (Required)
GEMINI_API_KEY=AIzaSy...           # Get free at https://aistudio.google.com
GROQ_API_KEY=gsk_...               # Get free at https://console.groq.com

# Clerk v5 Authentication Credentials
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_YourClerkPublishableKeyHere
CLERK_SECRET_KEY=sk_test_YourClerkSecretKeyHere
NEXT_PUBLIC_CLERK_AFTER_SIGN_OUT_URL=/

# App configuration
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

---

## Responsible AI & Mitigations

* Mitigation of Bias: The advisor persona always terminates the session with an explicit handback statement to ensure users do not treat the AI's lean as an absolute instruction.
* Human-in-the-Loop Design: Dimension weights and tradeoff balances are derived directly from the user's answers, serving as a reflection tool rather than an automated decision maker.
