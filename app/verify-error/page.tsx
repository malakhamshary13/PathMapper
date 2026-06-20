"use client";

import { useState } from "react";

export default function VerifyErrorPage() {
  const [showRateLimitCard, setShowRateLimitCard] = useState(true);

  return (
    <div style={{
      minHeight: "100vh", background: "#0F0F16", color: "#E8E4DC",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "system-ui, sans-serif", padding: 20
    }}>
      <div style={{ maxWidth: 450, width: "100%", display: "flex", flexDirection: "column", gap: 20 }}>
        
        {/* Verification Quota Limit Card Container */}
        <div style={{
          background: "#161622", border: "1px solid #2A2A3E", borderRadius: 16,
          padding: 24, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column", gap: 16
        }}>
          
          {showRateLimitCard ? (
            <div style={{
              background: "#2A1515", border: "1px solid #C45A5A44", borderRadius: 12,
              padding: 16, display: "flex", flexDirection: "column", gap: 12,
              animation: "fadeIn 0.2s ease"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
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
          ) : (
            <div style={{ textAlign: "center", padding: 12 }}>
              <button
                onClick={() => setShowRateLimitCard(true)}
                style={{
                  background: "#5B8A6A", color: "white", border: "none",
                  borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Reset / Show Card Again
              </button>
            </div>
          )}

          <div style={{ textAlign: "center", fontSize: 10, color: "#5F5F6F", marginTop: 4, letterSpacing: "0.2px" }}>
            PathMapper uses AI personas to help you think through your decision.
          </div>
        </div>

        {/* Back Button */}
        <div style={{ textAlign: "center" }}>
          <a href="/" style={{ color: "#5B8A6A", fontSize: 13, textDecoration: "none", fontWeight: 600 }}>
            ← Back to Main App
          </a>
        </div>
      </div>
    </div>
  );
}
