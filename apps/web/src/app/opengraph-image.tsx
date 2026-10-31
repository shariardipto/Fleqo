import { ImageResponse } from "next/og";
import { LOGO_BLOCKS, LOGO_COLORS, LOGO_VIEWBOX } from "@/lib/logo";

export const alt = "Fleqo — Connect your workflows. Automate your business.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Generated social card (no external assets). Colours match the dark theme tokens.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "linear-gradient(135deg, #121320 0%, #1b1d33 55%, #13202b 100%)",
          color: "#f3f4f8",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg viewBox={LOGO_VIEWBOX} width={64} height={64}>
            {LOGO_BLOCKS.map((block) => (
              <path key={block.d} d={block.d} fill={LOGO_COLORS.dark[block.tone - 1]} />
            ))}
          </svg>
          <div style={{ fontSize: 44, fontWeight: 700 }}>Fleqo</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>Connect your workflows. Automate your business.</div>
          <div style={{ fontSize: 30, color: "#b6b9cc", maxWidth: 980 }}>
            Signed webhooks, safe retries and full execution logs for order-sync automation.
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 24, color: "#c9cbf9" }}>
          <span>New order</span>
          <span>→</span>
          <span>Webhook verified</span>
          <span>→</span>
          <span>CRM + Sheet</span>
        </div>
      </div>
    ),
    size,
  );
}
