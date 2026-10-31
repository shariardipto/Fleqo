import Link from "next/link";
import { LOGO_BLOCKS, LOGO_VIEWBOX } from "@/lib/logo";
import { cn } from "@/lib/utils";

// Literal class names so Tailwind generates them.
const TONE_FILL = { 1: "fill-logo-1", 2: "fill-logo-2", 3: "fill-logo-3", 4: "fill-logo-4", 5: "fill-logo-5" } as const;

/** Fleqo logo; each block takes its colour from the active theme's --logo-* token. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox={LOGO_VIEWBOX} className={cn("size-7 shrink-0", className)} aria-hidden>
      {LOGO_BLOCKS.map((block) => (
        <path key={block.d} d={block.d} className={TONE_FILL[block.tone]} />
      ))}
    </svg>
  );
}

export function Brand({ className, href = "/dashboard" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 font-semibold tracking-tight", className)} aria-label="Fleqo home">
      <BrandMark />
      <span>Fleqo</span>
    </Link>
  );
}
