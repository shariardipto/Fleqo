import { cn } from "@/lib/utils";

/**
 * Fades content in as it scrolls into view using CSS scroll-driven animations (see `.reveal` in
 * globals.css). Pure CSS: content is never hidden when the feature, JavaScript or motion is unavailable.
 */
export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("reveal", className)}>{children}</div>;
}
