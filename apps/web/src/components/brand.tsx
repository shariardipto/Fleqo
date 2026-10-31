import { Workflow } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function Brand({ className, href = "/dashboard" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Workflow className="size-4" aria-hidden />
      </span>
      Fleqo
    </Link>
  );
}
