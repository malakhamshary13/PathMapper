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
        <head>
          <style>{`
            @import url('https://fonts.cdnfonts.com/css/sf-pro-display');
          `}</style>
        </head>
        <body style={{ margin: 0, padding: 0, height: "100dvh", overflow: "hidden", background: "#0A0A0F", fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}