import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "PathMapper — Decisions, Thought Through",
  description: "An AI-powered life decision simulator that resolves reasoning contradictions before mapping your paths.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body style={{ margin: 0, padding: 0, height: "100dvh", overflow: "hidden", background: "#0A0A0F" }}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}