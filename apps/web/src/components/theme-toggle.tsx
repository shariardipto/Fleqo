"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

type ThemeValue = (typeof THEMES)[number]["value"];

const noopSubscribe = () => () => {};
/** True only after hydration; the stored theme is unknown on the server. */
function useHydrated() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * Theme state backed by next-themes (persisted in localStorage under "theme", applied before
 * first paint). Switching cross-fades with the View Transitions API where available and
 * falls back to an instant switch, always instant under prefers-reduced-motion.
 */
export function useThemePreference() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const hydrated = useHydrated();

  function select(next: ThemeValue) {
    const apply = () => {
      setTheme(next);
      // Apply the class synchronously so the view transition captures the new state.
      const dark = next === "dark" || (next === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      const root = document.documentElement;
      root.classList.toggle("dark", dark);
      root.classList.toggle("light", !dark);
      root.style.colorScheme = dark ? "dark" : "light";
    };
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || typeof document.startViewTransition !== "function") apply();
    else document.startViewTransition(apply);
  }

  return {
    hydrated,
    theme: (hydrated ? (theme as ThemeValue | undefined) : undefined) ?? "system",
    resolvedTheme: hydrated ? resolvedTheme : undefined,
    select,
  };
}

/**
 * One-click light/dark switch for navigation bars. Until the first click the device setting
 * applies; each click then flips to the opposite of what is on screen.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { hydrated, resolvedTheme, select } = useThemePreference();
  const next = resolvedTheme === "dark" ? "light" : "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("text-muted-foreground hover:text-foreground", className)}
      aria-label={hydrated ? `Switch to ${next} theme` : "Toggle theme"}
      data-testid="theme-toggle"
      onClick={() => select(next)}
    >
      {/* <html> gets its theme class before first paint, so CSS shows the right icon even before hydration. */}
      <Moon className="size-4 dark:hidden" aria-hidden />
      <Sun className="hidden size-4 dark:block" aria-hidden />
    </Button>
  );
}

/** Large, labelled selector for the Settings page (a radio group with arrow-key support). */
export function ThemeSelector() {
  const { theme, select } = useThemePreference();

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = THEMES.findIndex((t) => t.value === theme);
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = THEMES[(index + delta + THEMES.length) % THEMES.length];
    select(next.value);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-3" onKeyDown={onKeyDown}>
      {THEMES.map(({ value, label, icon: Icon }) => {
        const selected = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-value={value}
            data-testid={`theme-select-${value}`}
            onClick={() => select(value)}
            className={cn(
              "flex items-center gap-3 rounded-xl border p-4 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring",
              selected ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-muted/60",
            )}
          >
            <span className={cn("flex size-9 items-center justify-center rounded-lg border", selected ? "border-primary/40 bg-primary/10 text-primary" : "bg-muted")}>
              <Icon className="size-4" aria-hidden />
            </span>
            <span>
              <span className="block font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">
                {value === "system" ? "Follow your device" : value === "light" ? "Bright surfaces" : "Easy on the eyes"}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
