# Fleqo — Frontend

**Stack:** Next.js 16 App Router, React 19 (React Compiler), Tailwind CSS 4, shadcn/ui (Radix base, "radix-nova" style), TanStack Query 5, Better Auth React client, lucide icons, sonner toasts, `next-themes`.
**Audience:** store operators (Owner/Admin) and team members (Member) running an order-sync automation.

## 1. Principles
- **Truthful UI.** Every number is a count of persisted records. Integrations are labelled as mocks (Mock Store, Mock CRM, Mock Sheet) and generated data as synthetic. The public site shows no testimonials, customer logos, usage numbers, awards or certifications.
- **The API is the authority.** Controls are hidden or disabled by role (permissions from `/api/me`), but every action is enforced server-side; a 403 shows as a toast.
- **Every data view has three states:** a skeleton while loading, an error alert with **Try again**, and an empty state that explains the next step.
- **Live where it matters:** dashboard (5 s), executions list (2 s while any run is in flight, otherwise 10 s), execution detail (1.5 s until finished), destination records (5 s).

## 2. Routes
**Public website** (statically prerendered; interactive parts are small client islands)

| Route | Content |
| --- | --- |
| `/` | Landing page (§3) |
| `/docs` | Quick start, concepts, webhook API headers with a signing example, roles, limits |
| `/robots.txt`, `/sitemap.xml`, `/opengraph-image` | Generated; app routes are disallowed in robots |

The header (`components/landing/site-header.tsx`) is sticky and blurs after scrolling. It holds Features, How It Works, Integrations, Demo and Docs links, the theme toggle, auth-aware buttons and an accessible mobile drawer. Signed-in visitors see **Go to Dashboard** instead of Sign in / Get started. The session check uses Better Auth's `get-session`, which returns `200 null` for visitors, so the public site never logs 401s.

**Authentication and onboarding**
- `/sign-in`, `/sign-up`: a form and a brand panel listing real capabilities (hidden on mobile), **Back to home** and the theme toggle. Sign-up asks for name, email, password and confirmation, with show/hide toggles and inline validation. Social buttons appear only for providers configured on the API; OAuth errors (cancelled, account exists, expired) show a fixed friendly message. The **Forgot password?** link (to `/forgot-password` and `/reset-password`) appears only when email is configured. See [authentication.md](./authentication.md).
- `/onboarding`: create an organization, or paste an invite link. Invitations are never listed by email.
- `/invite/[id]`: signed out → **Create account** / **Sign in** (both return via `?next=`); signed in as the invitee → organization, role, inviter, expiry and **Accept invitation**; any other account → "This invitation cannot be used" and **Use a different account**.

**App** (`(app)/layout.tsx` → `AppShell`)
- Desktop (≥ lg): sticky sidebar with the brand, an **organization switcher** (name, role, memberships, "New organization"), navigation, the release label "Workflow Automation v1.1", and a user card with the theme toggle and a one-click sign-out icon.
- Mobile: a top bar whose menu button opens the same content in a left `Sheet`, plus the theme toggle.
- Guard: `/api/me` 401 → `/sign-in?next=<path>` (only same-site relative `next` values are honoured). With no active organization the first membership is selected, or the user goes to `/onboarding`.

| Route | Purpose | Key elements |
| --- | --- | --- |
| `/dashboard` | Status at a glance | Get-started checklist (until the loop is complete); KPI cards: active workflows, runs in 24 h, events received and duplicates ignored, open dead letters, CRM customers, sheet rows, succeeded all-time, in progress; recent runs |
| `/connections` | Mock services | A card per provider: status badge, connection ID, secret (last 4 characters), stats. Admin/Owner: **Connect**, a status switch labelled **Enabled**/**Disabled**, **Rotate secret**; Member: a "View only" note. One-time secret dialog with copy; webhook contract with a signing snippet; **Destination records** tabs (CRM customers, sheet rows) |
| `/workflows` | List | Status, trigger → action chain, success/failure counts, last run, "Show archived", **New workflow** (Admin+) |
| `/workflows/new` | Guided builder | Details → trigger (fixed `order.created`) → actions (include checkboxes, mapping editor, sheet name) → enable → create. Warns with a link when connections are missing |
| `/workflows/[id]` | Detail | Enabled switch, Archive (confirmed), trigger card, ordered action cards with editable mapping, run counts, recent runs |
| `/executions` | Run monitor | Debounced search (event ID, order ID, customer email), status filter; table of status, workflow, event, order total, per-action status × attempts, created |
| `/executions/[id]` | Run detail | Status and **Retry failed actions** (Admin+); dead-letter alert; per-action cards (attempts, duration, error kind, mapped input, result JSON); execution log; event card with raw payload and dispatch generation; dead-letter history |
| `/demo` | Data and simulator | Import (synthetic offline or DummyJSON, with a licence note); simulator (1–100 events; CRM/Sheet fault injection: none, fail 1/2/5, permanent; **Send signed events**, **Re-send first event**); last deliveries; imported records with provenance badges |
| `/team` | Members | Invite by email and role (Admin+) → copyable **invite link** (no email is sent); members with inline role select and remove; pending invitations with **Copy invite link** and cancel |
| `/settings` | Organization | Rename (Owner/Admin), slug, created date, your role, **Appearance** (Light / Dark / System), audit log (Owner/Admin) |

## 3. Landing page (`src/app/page.tsx`, `components/landing/`)
1. **Hero:** headline, Get Started Free / Explore Demo, and an animated pipeline illustration (`hero-visual.tsx`).
2. **Interactive demo** (`interactive-demo.tsx`): runs entirely in the browser with sample data and makes no API calls (asserted by E2E). It computes a real HMAC-SHA256 signature with WebCrypto and a public demo secret, walks received → verified → queued → CRM → Sheet → logged, acknowledges a re-sent event as a duplicate, and simulates a CRM outage whose retry does not repeat completed actions.
3. **Features:** 8 cards describing implemented capabilities only.
4. **How Fleqo works** (`how-it-works.tsx`): 4 steps as an accessible tablist with arrow-key support.
5. **Integrations:** Mock Store, Mock CRM, Mock Sheet and public demo data marked *Available*; Shopify, WooCommerce, Google Sheets and HubSpot under "On the roadmap — planned, not available yet".
6. **Product preview** (`product-preview.tsx`): real screenshots of the app with synthetic data, in the visitor's theme (`next/image`, lazy, responsive).
7. **Security & reliability:** six implemented capabilities, with an explicit "no external certification" note.
8. **Final CTA and footer:** internal links only. No contact, privacy or terms links, because those pages don't exist.

**Motion.** Small CSS keyframes (`animate-flow-dash`, `animate-pulse-ring`) and CSS scroll-driven reveals (`.reveal`). Content is never hidden, so crawlers, full-page captures, print and unsupported browsers see everything. All motion is off under `prefers-reduced-motion`.

**SEO.** Title "Fleqo — Integration & Workflow Automation", description, canonical, Open Graph and Twitter (`summary_large_image`) metadata, and a generated OG image (`app/opengraph-image.tsx`). Set `NEXT_PUBLIC_SITE_URL` in production so canonical and OG URLs use the real domain. Fonts are self-hosted by `next/font`.

**Regenerating the screenshots.** Screens must come from the real app. With the API, worker and web running, create a throwaway tenant with synthetic data and capture `/dashboard`, `/connections`, `/workflows/new` and an execution detail at 1440×900 in light and dark, into `apps/web/public/screens/{dashboard,connections,workflows,executions}-{light,dark}.png` (a short temporary Playwright script is easiest). The image optimizer caches by URL, not content, so afterwards delete `apps/web/.next/cache/images` (and `.next/dev/cache/images` for `next dev`).

## 4. Theme (Light · Dark · System)
- **Provider:** `next-themes` in `src/app/providers.tsx` (`attribute="class"`, `defaultTheme="system"`, `enableSystem`). The choice is stored in `localStorage["theme"]` and shared by every route.
- **No flash:** a blocking script in `<head>` applies the stored or system theme before first paint (`<html suppressHydrationWarning>`). E2E checks the class is correct at `domcontentloaded`.
- **Default:** first visits follow `prefers-color-scheme` live; an explicit choice then wins.
- **Transitions:** `useThemePreference().select()` (`components/theme-toggle.tsx`) cross-fades with the View Transitions API (220 ms) where supported, and is instant under `prefers-reduced-motion`.

| Where | Control |
| --- | --- |
| Public header, auth pages, onboarding, invite page, app sidebar and mobile header | `ThemeToggle`: a one-click light ↔ dark icon button. It flips to the opposite of the theme on screen and stores an explicit choice. Both icons are rendered and CSS (`dark:`) picks one, so it is correct before hydration |
| Settings → Appearance | `ThemeSelector`: a Light / Dark / System radio group, the only way back to following the device |

**Design tokens** (`src/app/globals.css`). Components read semantic CSS variables exposed to Tailwind through `@theme inline`; none hardcodes a palette colour (apart from third-party brand logos).

| Token | Use |
| --- | --- |
| `background`, `surface`, `card`, `popover` | Page, alternate sections, cards, menus |
| `foreground`, `muted-foreground` | Text |
| `primary` / `primary-foreground` | Buttons, links, focus (indigo) |
| `brand`, `brand-2` | Brand gradient and accents (indigo / cyan) |
| `logo-1` … `logo-5` | Logo blocks (teal → indigo ramp, brighter in dark) |
| `success`, `warning`, `info`, `destructive` | AA-contrast status text, icons and tinted badges (`bg-x/10 border-x/35`) |
| `success-solid` | Filled controls such as the status switch track (≥ 3:1 contrast) |
| `border`, `input`, `ring`, `sidebar-*` | Outlines, focus, app sidebar |

Status meaning is the same in both themes: queued neutral, running info, retrying warning, succeeded/active success, failed destructive. To add a meaning, define the token in **both** `:root` and `.dark`, map it in `@theme inline`, and run the accessibility spec.

**Logo and icons.** `apps/web/public/logo.png` is traced into vector geometry in `src/lib/logo.ts` (five blocks forming the "F"). `BrandMark` (`components/brand.tsx`) fills each block with a `--logo-*` token, so it follows the theme. `src/app/icon.svg` switches palette with `prefers-color-scheme`; `favicon.ico` and `apple-icon.png` use the light palette, and the OG card the dark one. After changing the tokens and `LOGO_COLORS` in `src/lib/logo.ts`, run `npm run icons --workspace=apps/web` to regenerate the favicon set.

## 5. Components
- `StatusBadge`: one semantic tone and icon per status (queued, running with spinner, retrying, succeeded, failed, active, inactive, disabled, archived), with a `data-status` attribute for tests.
- `Switch tone="success"`: on/off status toggles (connections, workflow enabled). Read-only roles see the badge and a "View only" note instead of a disabled switch, which would read as "off".
- `MappingEditor`: destination field (label, type, required) ← a source select limited to type-compatible event fields, mirroring the server rules; optional fields allow "Not mapped".
- `ThemeToggle`, `ThemeSelector`, `PageHeader`, `LoadingRows`, `ErrorState`, `EmptyState`, `Brand`.

## 6. Accessibility
- Semantic landmarks (`header`, `aside`, `nav aria-label="Main"`, `main`), a skip link on the landing page, `aria-current="page"` on the active nav item.
- Every control has a visible `<Label>` or an `aria-label`. Status is never colour-only (icon + text); loading regions use `role="status"`.
- Radix primitives (Select, Dialog, AlertDialog, DropdownMenu, Sheet, Tabs, Switch) handle focus and Escape. Scrollable code blocks, logs and tables are labelled, keyboard-focusable regions.
- Tables scroll inside their card on small screens; the mobile E2E spec asserts no page-level horizontal overflow at Pixel 7 width.
- `e2e/accessibility.spec.ts` runs axe-core (WCAG 2.0/2.1 A + AA, including colour contrast) on 14 pages (`/`, `/docs`, `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/onboarding`, `/dashboard`, `/connections`, `/workflows/new`, `/executions`, `/demo`, `/team`, `/settings`) in light **and** dark: 0 serious or critical violations.

## 7. Error handling
- API errors follow `{ error: { code, message, details[], requestId } }`; `errorMessage()` joins field details for toasts.
- TanStack Query does not retry 4xx responses; it retries 5xx and network errors twice.
- Irreversible actions are confirmed (archive); secrets are shown once with an explicit acknowledgement.
