/**
 * Fleqo logo, traced from public/logo.png (3126 × 3145 px) and scaled to a 100-unit width.
 * Blocks are painted in order and each one reaches slightly under the block painted after it, so
 * no background hairline shows between neighbours at small sizes. `tone` runs from 1 (lightest,
 * the top bar) to 5 (darkest) and maps to the --logo-1…5 theme tokens in globals.css.
 */
export const LOGO_VIEWBOX = "0 0 100 100.6";

export const LOGO_BLOCKS = [
  { tone: 1, d: "M20.15 0H100V52.35H0V20.15A20.15 20.15 0 0 1 20.15 0Z" },
  { tone: 2, d: "M0 27.64H75.3V52.95H0Z" },
  { tone: 3, d: "M37.05 52.35H75.3V78.23H37.05Z" },
  { tone: 5, d: "M0 52.35H37.65V78.83H0Z" },
  { tone: 4, d: "M0 78.23H37.65V100.6H0Z" },
] as const;

/** sRGB equivalents of the --logo-* tokens, for images that cannot read CSS variables (icons, OG card). */
export const LOGO_COLORS = {
  light: ["#66d2ce", "#37b1bb", "#0692b1", "#0a71b1", "#3846b1"],
  dark: ["#77e3de", "#53c8d2", "#39aacc", "#448bcb", "#5867c8"],
} as const;
