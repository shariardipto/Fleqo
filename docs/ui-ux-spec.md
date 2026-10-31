# Fleqo — UI/UX Specification (as implemented)

**Stack:** Next.js 16 App Router, React 19 (React Compiler), Tailwind CSS 4, shadcn/ui (Radix base, "radix-nova" style), TanStack Query 5, Better Auth React client, lucide icons, sonner toasts.
**Audience:** store operators (Owner/Admin) and team members (Member) running a demo order-sync automation.

## Principles
- **Truthful UI.** Every number is a count of persisted records; integrations are labelled as mocks and generated data as synthetic (sidebar badge, "synthetic" badges, connection descriptions).
- **The API is the authority.** Controls are hidden or disabled by role (`/api/me` permissions), but every action is enforced server-side; a 403 shows as a toast.
- **Every data view has three states:** skeleton while loading, an error alert with **Try again**, and an empty state that explains the next step.
- **Live where it matters:** dashboard (5 s), executions list (2 s while any run is in flight, otherwise 10 s), execution detail (1.5 s until finished), destination records (5 s).

## Navigation and shell
- Public: `/sign-in`, `/sign-up` (centered card, brand, MVP disclaimer).
- `/onboarding`: create an organization, or paste an invite link (shown when the user has no organization). Invitations are never listed by email.
- `/invite/[id]`: invite-link landing page. Signed out → **Create account** / **Sign in** (both return to the link via `?next=`); signed in as the invitee → organization, role, inviter, expiry and **Accept invitation**; any other account → "This invitation cannot be used" + **Use a different account**.
- Authenticated shell (`(app)/layout.tsx` → `AppShell`):
  - Desktop (≥ lg): sticky 16 rem sidebar — brand, **organization switcher** (name + role, list of memberships, "New organization"), nav, mock-data badge, **user menu** (sign out).
  - Mobile: top bar with a menu button opening the same content in a left `Sheet`.
  - Guard: `/api/me` → 401 redirects to `/sign-in?next=<path>` (only same-site relative `next` values are honoured); no active org → auto-select the first membership or go to `/onboarding`.

## Pages
| Route | Purpose | Key elements |
| --- | --- | --- |
| `/dashboard` | Status at a glance | Get-started checklist (until the loop is complete); KPI cards: active workflows, runs 24 h, events received + duplicates ignored, open dead letters, CRM customers, sheet rows, succeeded all-time, in progress; recent runs list |
| `/connections` | Mock services | One card per provider: status badge, connection ID, secret •••• last 4, stats. Admin/Owner: **Connect**, a green status switch whose label follows the state (**Enabled**/**Disabled**; only the switch being saved is locked), **Rotate secret**. Member: a "View only" note instead of controls (a greyed-out switch would read as "off" next to "Active"). One-time **secret dialog** with copy; webhook contract with a signing snippet; **Destination records** tabs (CRM customers, Sheet rows; load more) |
| `/workflows` | List | Status badge, trigger → action chain, success/failure counts, last run, "Show archived" switch, **New workflow** (Admin+) |
| `/workflows/new` | Guided builder | 1 Details · 2 Trigger (fixed `order.created`) · 3 Actions (include checkboxes, **mapping editor**, sheet name) · Enable immediately · Create. Warns with a link when connections are missing |
| `/workflows/[id]` | Detail | Enabled switch, Archive (confirm dialog), trigger card, ordered action cards with editable mapping + Save/Discard, run counts, recent runs |
| `/executions` | Run monitor | Search (event ID / order ID / customer email, debounced), status filter, table: status, workflow, event (+synthetic), order total, per-action status ×attempts, created; load more |
| `/executions/[id]` | Run detail | Status + **Retry failed actions** (Admin+, failed runs); dead-letter alert; per-action cards (attempts, duration, error kind, error, mapped input, result JSON); execution log table (time, step, attempt, message, colour by level); event card (type, source, synthetic, received/signed, duplicates ignored, dispatch generation, raw payload); dead-letter history |
| `/demo` | Data + simulator | Import (source select: synthetic offline / DummyJSON, record count, result with licence note); simulator (count 1–100, CRM/Sheet fault injection: none / fail 1 / fail 2 / fail 5 / permanent, **Send signed events**, **Re-send first event**); last deliveries (accepted/duplicate, links to runs); imported records tabs with provenance badges |
| `/team` | Members | Invite (email + role; Admin+) → **invite link** box with copy (no email is sent); members table with inline role select / remove (per permission); pending invitations with **Copy invite link** and cancel; role explanations |
| `/settings` | Organization | Rename (Owner/Admin), slug / created / your role, audit log (Owner/Admin) |

## Components
- `StatusBadge` — one colour + icon per status (queued, running with spinner, retrying, succeeded, failed, active, inactive, disabled, archived); `data-status` attribute for tests.
- `Switch tone="success"` — used for on/off status toggles (connections, workflow enabled): the checked track is emerald in both themes, matching the "Active" badge (≥ 3:1 contrast, asserted by E2E). Read-only roles never see a disabled status switch; they get the badge and a "View only" note.
- `MappingEditor` — destination field (label, type, required *) ← source select limited to type-compatible event fields (mirrors server rules); optional fields allow "Not mapped".
- `PageHeader`, `LoadingRows`, `ErrorState`, `EmptyState`, `Brand`.

## Accessibility
- Semantic landmarks (`aside`, `nav aria-label="Main"`, `main`, `header`); `aria-current="page"` on the active nav item.
- Every form control has a visible `<Label>` or an `aria-label` (switches, icon buttons, selects).
- Status is never colour-only (icon + text); loading regions use `role="status"`.
- Keyboard: Radix primitives (Select, Dialog, AlertDialog, DropdownMenu, Sheet, Tabs, Switch) give focus management and Escape handling.
- Tables scroll horizontally inside their card on small screens; the Playwright mobile spec asserts no page-level horizontal overflow at Pixel 7 width.
- Light/dark themes follow the system (`next-themes`); status colours have dark variants.

## Error handling
- API errors use the `{ error: { code, message, details[], requestId } }` contract; `errorMessage()` joins field details for toasts.
- TanStack Query does not retry 4xx responses; it retries 5xx and network errors twice.
- Destructive or irreversible actions use confirmation (archive); secrets are shown once with an explicit acknowledgement.
