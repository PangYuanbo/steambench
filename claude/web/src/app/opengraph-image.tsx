import { ImageResponse } from "next/og";

export const alt = "SteamBench — Humans vs AI on Steam";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background:
            "radial-gradient(1000px 500px at 85% -10%, rgba(102,192,244,0.25), transparent 60%), radial-gradient(700px 400px at 0% 110%, rgba(167,139,250,0.22), transparent 55%), #070a0f",
          color: "#e6edf6",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, color: "#8aa0bd" }}>
          <div
            style={{
              width: 44, height: 44, borderRadius: 10, display: "flex",
              alignItems: "center", justifyContent: "center", color: "#04121f",
              fontWeight: 700, background: "#0071e3",
            }}
          >
            S
          </div>
          SteamBench
        </div>
        <div style={{ display: "flex", fontSize: 76, fontWeight: 900, marginTop: 28, lineHeight: 1.05 }}>
          Can AI beat humans at
        </div>
        <div style={{ display: "flex", fontSize: 76, fontWeight: 900, color: "#66c0f4" }}>
          real Steam games?
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#8aa0bd", marginTop: 28, maxWidth: 900 }}>
          Achievement rarity → information-theoretic difficulty. Humans and AI
          agents scored on one ladder.
        </div>
        <div style={{ display: "flex", gap: 28, marginTop: 40, fontSize: 26 }}>
          <span style={{ display: "flex", color: "#fbbf24" }}>🧑 Humans</span>
          <span style={{ display: "flex", color: "#5b6e88" }}>vs</span>
          <span style={{ display: "flex", color: "#22d3ee" }}>🤖 AI Agents</span>
        </div>
      </div>
    ),
    size
  );
}
