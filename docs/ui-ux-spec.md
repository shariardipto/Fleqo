# Fleqo — UI/UX Specification (as implemented)

**Stack:** Next.js 16 App Router, React 19 (React Compiler), Tailwind CSS 4, shadcn/ui (Radix base, "radix-nova" style), TanStack Query 5, Better Auth React client, lucide icons, sonner toasts.
**Audience:** store operators (Owner/Admin) and team members (Member) running a demo order-sync automation.

## Principles
- **Truthful UI.** Every number is a count of persisted records; integrations are labelled as mocks and generated data as synthetic ("synthetic" badges, Mock Store / Mock CRM / Mock Sheet names, connection descriptions).
- **The API is the authority.** Controls are hidden or disabled by role (`/api/me` permissions), but every action is enforced server-side; a 403 shows as a toast.
- **Every data view has three states:** skeleton while loading, an error alert with **Try again**, and an empty state that explains the next step.
- **Live where it matters:** dashboard (5 s), executions list (2 s while any run is in flight, otherwise 10 s), execution detail (1.5 s until finished), destination records (5 s).

## Navigation and shell
- Public website: `/` landing page and `/docs` (sticky header with Features, How It Works, Integrations, Demo, Docs; theme switcher; **Sign in / Get Started**, or **Go to Dashboard** when signed in; mobile drawer). Sections and rules: [landing-page.md](./landing-page.md).
- Public auth: `/sign-in`, `/sign-up`: two columns (form + brand panel listing real capabilities; the panel is hidden on mobile), **Back to home** link and theme switcher. Sign-up asks for full name, email, password and **confirm password**, with show/hide toggles and inline validation. Under **"Or continue with"**, only the social providers configured on the API are shown (`/api/public/auth-providers`). OAuth errors (cancelled, account exists, expired) show as a friendly alert. Sign-up goes to `/onboarding` (or back to an invite link via `?next=`).
- `/onboarding`: create an organization, or paste an invite link (shown when the user has no organization). Invitations are never listed by email.
- `/invite/[id]`: invite-link landing page. Signed out → **Create account** / **Sign in** (both return to the link via `?next=`); signed in as the invitee → organization, role, inviter, expiry and **Accept invitation**; any other account → "This invitation cannot be used" + **Use a different account**.
- Authenticated shell (`(app)/layout.tsx` → `AppShell`):
  - Desktop (≥ lg): sticky 16 rem sidebar — brand, **organization switcher** (name + role, list of memberships, "New organization"), nav, **release label** ("Workflow Automation" and `v1.1`), **user card** (name and email) with the **theme switcher** and a **one-click sign-out** icon beside it.
  - Mobile: top bar with a menu button opening the same content in a left `Sheet`, plus the theme switcher.
  - Guard: `/api/me` → 401 redirects to `/sign-in?next=<path>` (only same-site relative `next` values are honoured); no active org → auto-select the first membership or go to `/onboarding`.

## Pages
| Route | Purpose | Key elements |
| --- | --- | --- |
| `/` | Public landing page | Hero with animated pipeline illustration; in-browser interactive demo (signed event → verify → queue → CRM → Sheet → log; duplicate and outage scenarios; no API calls); features; how it works (tabs); integrations (available mocks + clearly labelled roadmap); real product screenshots per theme; security & reliability; CTA; footer |
| `/docs` | Public documentation | Quick start, concepts, webhook API headers + signing example, roles, MVP limits |
| `/dashboard` | Status at a glance | Get-started checklist (until the loop is complete); KPI cards: active workflows, runs 24 h, events received + duplicates ignored, open dead letters, CRM customers, sheet rows, succeeded all-time, in progress; recent runs list |
| `/connections` | Mock services | One card per provider: status badge, connection ID, secret •••• last 4, stats. Admin/Owner: **Connect**, a green status switch whose label follows the state (**Enabled**/**Disabled**; only the switch being saved is locked), **Rotate secret**. Member: a "View only" note instead of controls (a greyed-out switch would read as "off" next to "Active"). One-time **secret dialog** with copy; webhook contract with a signing snippet; **Destination records** tabs (CRM customers, Sheet rows; load more) |
| `/workflows` | List | Status badge, trigger → action chain, success/failure counts, last run, "Show archived" switch, **New workflow** (Admin+) |
| `/workflows/new` | Guided builder | 1 Details · 2 Trigger (fixed `order.created`) · 3 Actions (include checkboxes, **mapping editor**, sheet name) · Enable immediately · Create. Warns with a link when connections are missing |
| `/workflows/[id]` | Detail | Enabled switch, Archive (confirm dialog), trigger card, ordered action cards with editable mapping + Save/Discard, run counts, recent runs |
| `/executions` | Run monitor | Search (event ID / order ID / customer email, debounced), status filter, table: status, workflow, event (+synthetic), order total, per-action status ×attempts, created; load more |
| `/executions/[id]` | Run detail | Status + **Retry failed actions** (Admin+, failed runs); dead-letter alert; per-action cards (attempts, duration, error kind, error, mapped input, result JSON); execution log table (time, step, attempt, message, colour by level); event card (type, source, synthetic, received/signed, duplicates ignored, dispatch generation, raw payload); dead-letter history |
| `/demo` | Data + simulator | Import (source select: synthetic offline / DummyJSON, record count, result with licence note); simulator (count 1–100, CRM/Sheet fault injection: none / fail 1 / fail 2 / fail 5 / permanent, **Send signed events**, **Re-send first event**); last deliveries (accepted/duplicate, links to runs); imported records tabs with provenance badges |
| `/team` | Members | Invite (email + role; Admin+) → **invite link** box with copy (no email is sent); members table with inline role select / remove (per permission); pending invitations with **Copy invite link** and cancel; role explanations |
| `/settings` | Organization | Rename (Owner/Admin), slug / created / your role, **Appearance** (Light / Dark / System), audit log (Owner/Admin) |

## Components
- `StatusBadge` — one semantic tone + icon per status (queued, running with spinner, retrying, succeeded, failed, active, inactive, disabled, archived), built on theme tokens; `data-status` attribute for tests.
- `Switch tone="success"` — used for on/off status toggles (connections, workflow enabled): the checked track uses the `success-solid` token in both themes, matching the "Active" badge (≥ 3:1 contrast, asserted by E2E). Read-only roles never see a disabled status switch; they get the badge and a "View only" note.
- `ThemeToggle` (one-click light ↔ dark icon button) and `ThemeSelector` (Light / Dark / System radio group in Settings). See [theme-architecture.md](./theme-architecture.md).
- `MappingEditor` — destination field (label, type, required *) ← source select limited to type-compatible event fields (mirrors server rules); optional fields allow "Not mapped".
- `PageHeader`, `LoadingRows`, `ErrorState`, `EmptyState`, `Brand` (the Fleqo logo, coloured by the theme's `--logo-*` tokens, plus the wordmark; see [theme-architecture.md §4](./theme-architecture.md#4-logo-and-icons)).

## Accessibility
- Semantic landmarks (`aside`, `nav aria-label="Main"`, `main`, `header`); `aria-current="page"` on the active nav item.
- Every form control has a visible `<Label>` or an `aria-label` (switches, icon buttons, selects).
- Status is never colour-only (icon + text); loading regions use `role="status"`.
- Keyboard: Radix primitives (Select, Dialog, AlertDialog, DropdownMenu, Sheet, Tabs, Switch) give focus management and Escape handling.
- Tables scroll horizontally inside their card on small screens; the Playwright mobile spec asserts no page-level horizontal overflow at Pixel 7 width.
- Light / Dark / System themes (`next-themes`), persisted per browser and applied before first paint; all colours come from semantic tokens defined for both themes.
- Scrollable code blocks, logs and tables are keyboard-focusable regions with labels.
- `apps/web/e2e/accessibility.spec.ts` runs axe-core (WCAG 2.0/2.1 A + AA, including colour contrast) on 12 public and app pages in light **and** dark: 0 serious/critical violations.

## Error handling
- API errors use the `{ error: { code, message, details[], requestId } }` contract; `errorMessage()` joins field details for toasts.
- TanStack Query does not retry 4xx responses; it retries 5xx and network errors twice.
- Destructive or irreversible actions use confirmation (archive); secrets are shown once with an explicit acknowledgement.
