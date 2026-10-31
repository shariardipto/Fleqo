import { CheckCircle2, Circle, Clock, Loader2, RotateCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const styles: Record<string, { className: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  queued: { className: "border-slate-300 text-slate-700 dark:text-slate-300", icon: Clock, label: "Queued" },
  running: { className: "border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200", icon: Loader2, label: "Running" },
  retrying: { className: "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200", icon: RotateCw, label: "Retrying" },
  succeeded: { className: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200", icon: CheckCircle2, label: "Succeeded" },
  failed: { className: "border-red-300 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200", icon: XCircle, label: "Failed" },
  active: { className: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200", icon: CheckCircle2, label: "Active" },
  inactive: { className: "border-slate-300 text-slate-600 dark:text-slate-300", icon: Circle, label: "Inactive" },
  disabled: { className: "border-slate-300 text-slate-600 dark:text-slate-300", icon: Circle, label: "Disabled" },
  archived: { className: "border-slate-300 text-slate-500", icon: Circle, label: "Archived" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const style = styles[status] ?? styles.queued;
  const Icon = style.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium", style.className, className)} data-status={status}>
      <Icon className={cn("size-3", status === "running" && "animate-spin")} aria-hidden />
      {style.label}
    </Badge>
  );
}
