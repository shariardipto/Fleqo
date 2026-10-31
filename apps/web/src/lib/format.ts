export function formatMoney(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(value: string | Date | null | undefined) {
  if (!value) return "—";
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(seconds, "second");
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86400), "day");
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function durationMs(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const ACTION_LABELS: Record<string, string> = {
  "mock_crm.upsert_customer": "CRM · Upsert customer",
  "mock_sheet.append_order": "Sheet · Append order",
};

export const actionLabel = (provider: string, actionType: string) =>
  ACTION_LABELS[`${provider}.${actionType}`] ?? `${provider}.${actionType}`;
