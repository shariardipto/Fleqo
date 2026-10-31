import { CheckCircle2, Circle, Clock, Loader2, RotateCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Semantic tokens only (globals.css): the same status reads the same in light and dark mode.
const tone = {
  neutral: "border-border bg-muted/60 text-muted-foreground",
  info: "border-info/35 bg-info/10 text-info",
  warning: "border-warning/35 bg-warning/10 text-warning",
  success: "border-success/35 bg-success/10 text-success",
  danger: "border-destructive/35 bg-destructive/10 text-destructive",
};

const styles: Record<string, { className: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  queued: { className: tone.neutral, icon: Clock, label: "Queued" },
  running: { className: tone.info, icon: Loader2, label: "Running" },
  retrying: { className: tone.warning, icon: RotateCw, label: "Retrying" },
  succeeded: { className: tone.success, icon: CheckCircle2, label: "Succeeded" },
  failed: { className: tone.danger, icon: XCircle, label: "Failed" },
  active: { className: tone.success, icon: CheckCircle2, label: "Active" },
  inactive: { className: tone.neutral, icon: Circle, label: "Inactive" },
  disabled: { className: tone.neutral, icon: Circle, label: "Disabled" },
  archived: { className: tone.neutral, icon: Circle, label: "Archived" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const style = styles[status] ?? styles.queued;
  const Icon = style.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium", style.className, className)} data-status={status}>
      <Icon className={cn("size-3", status === "running" && "animate-spin motion-reduce:animate-none")} aria-hidden />
      {style.label}
    </Badge>
  );
}
