# Fleqo — Theme Architecture (Light · Dark · System)

## 1. How it works
- **Provider:** `next-themes` in `apps/web/src/app/providers.tsx` — `attribute="class"`, `defaultTheme="system"`, `enableSystem`. It writes `light`/`dark` on `<html>` and sets `color-scheme`.
- **Persistence:** the choice is stored in `localStorage["theme"]` (`light` | `dark` | `system`) and shared by every route on the origin: landing, docs, auth, onboarding, invite and the app.
- **No flash:** next-themes injects a tiny blocking script in `<head>` that applies the stored or system theme before first paint. `<html suppressHydrationWarning>` avoids React's attribute mismatch warning. Verified by E2E: the class is already correct at `domcontentloaded`.
- **Default:** first visits follow `prefers-color-scheme` live (E2E switches the emulated OS preference and the page follows). An explicit choice then wins over later device changes.
- **Transitions:** `useThemePreference().select()` (in `components/theme-toggle.tsx`) cross-fades using the View Transitions API (220 ms) where supported, falls back to an instant switch, and is always instant under `prefers-reduced-motion`.

## 2. Controls
| Where | Component |
| --- | --- |
| Landing/docs header (desktop and mobile), auth pages, onboarding, invite page | `ThemeToggle` — **one-click** light ↔ dark icon button, no menu |
| App sidebar footer and mobile app header | `ThemeToggle` |
| Settings → Appearance | `ThemeSelector` — a labelled Light / Dark / System radio group (arrow keys move and select); the only place to go back to following the device |

`ThemeToggle` flips to the opposite of the theme on screen: until the first click a visitor follows the device setting, and each click stores an explicit `light` or `dark`. It shows a moon in light mode and a sun in dark mode, and its label names the action ("Switch to dark theme"). Both icons are rendered and CSS (`dark:`) picks one, so the icon is correct before hydration; the label is "Toggle theme" until hydration so server and client HTML match.

## 3. Design tokens (`apps/web/src/app/globals.css`)
All components read semantic CSS variables exposed to Tailwind through `@theme inline`. No component hardcodes a palette colour (`grep` for `-(red|emerald|amber|…)-[0-9]` in `src` returns 0, excluding the provider brand logos).

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `background`, `surface`, `card`, `popover` | off-white / white | deep cool neutrals | page, alternate sections, cards, menus |
| `foreground`, `muted-foreground` | near-black / slate | near-white / light slate | text |
| `primary` / `primary-foreground` | indigo 0.50 L / white | light indigo 0.74 L / near-black | buttons, links, focus |
| `brand`, `brand-2` | indigo / cyan | light indigo / light cyan | brand gradient, accents |
| `logo-1` … `logo-5` | teal → indigo ramp | brighter teal → indigo ramp | logo blocks (§4) |
| `success`, `warning`, `info`, `destructive` | AA text tones (≈0.5 L) | AA text tones (≈0.8 L) | status text, icons, tinted badges (`bg-x/10 border-x/35`) |
| `success-solid` | 0.56 L green | 0.64 L green | filled controls (status switch track) |
| `border`, `input`, `ring` | subtle neutrals | 9–14 % white | outlines and focus |
| `sidebar-*` | | | app sidebar |

Status meaning is identical in both themes: queued/neutral, running/info, retrying/warning, succeeded/active/success, failed/destructive.

## 4. Logo and icons
- **Source:** `apps/web/public/logo.png` (owner artwork), traced into vector geometry in `src/lib/logo.ts` (five blocks forming the "F").
- **Colours:** each block uses a `--logo-1…5` token, lightest (top bar) to darkest: a teal → indigo ramp that ends on the primary indigo, so the mark matches buttons, links and the brand gradient. Dark mode has its own brighter ramp. `BrandMark` (`components/brand.tsx`) renders the SVG with `fill-logo-*` classes, so it follows the theme like any other component.
- **Favicon set** (`src/app`): `icon.svg` switches palette with the browser's `prefers-color-scheme`; `favicon.ico` (16/32/48) and `apple-icon.png` (180, light tile) use the light palette, because raster icons cannot follow a theme. The Open Graph card draws the mark with the dark palette.
- **Changing colours or shape:** edit the tokens in `globals.css` and the matching sRGB values in `src/lib/logo.ts` (`LOGO_COLORS`), then run `npm run icons --workspace=apps/web` to regenerate the favicon set.

## 5. Accessibility verification
- **axe-core** (`apps/web/e2e/accessibility.spec.ts`, WCAG 2.0/2.1 A + AA incl. colour contrast) has **0 serious or critical violations** on `/`, `/docs`, `/sign-in`, `/sign-up`, `/dashboard`, `/connections`, `/workflows/new`, `/executions`, `/demo`, `/team`, `/settings` and `/onboarding`, in **both** light and dark.
- Fixed while auditing: scrollable code blocks, logs and tables are now focusable regions; the org switcher's accessible name contains its visible text; the Demo-data record filter uses pressed buttons instead of tabs without panels.
- The status switch keeps ≥ 3:1 contrast against its card in both themes (`connections-permissions.spec.ts`).
- Focus rings use `ring` (brand) on every interactive element; all motion is disabled under `prefers-reduced-motion`.

## 6. Adding a component
Use semantic utilities (`bg-card`, `text-muted-foreground`, `border-border`, `text-success`, `bg-warning/10`, `bg-primary`). If a new meaning is needed, add a token to **both** `:root` and `.dark`, map it in `@theme inline`, and check contrast with the accessibility spec.
