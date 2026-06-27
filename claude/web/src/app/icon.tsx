import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Branded "S" tab icon (matches the nav logo).
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0071e3",
          color: "#04121f",
          fontSize: 23,
          fontWeight: 900,
          borderRadius: 7,
        }}
      >
        S
      </div>
    ),
    size
  );
}
