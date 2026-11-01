# Fleqo — Public Website

## 1. Routes
| Route | Type | Notes |
| --- | --- | --- |
| `/` | Public, statically prerendered | Landing page |
| `/docs` | Public, static | Quick start, concepts, webhook API (with a signing example), roles, limits |
| `/sign-in`, `/sign-up` | Public | Redesigned; social buttons only for configured providers |
| `/onboarding`, `/invite/[id]` | Signed-in users | Unchanged behaviour, theme switcher added |
| `/dashboard` and all app routes | Protected | Unchanged; redirect to `/sign-in?next=…` without a session |
| `/robots.txt`, `/sitemap.xml`, `/opengraph-image` | Generated | App routes are disallowed in robots |

Visitors who are signed in see **Go to Dashboard** instead of Sign in / Get started, in the header and the CTAs. The session check uses Better Auth's `get-session`, which returns `200 null` for visitors, so the public site never logs 401 errors.

## 2. Sections (`apps/web/src/app/page.tsx`)
1. **Header** (`components/landing/site-header.tsx`): sticky, gains a blurred background after scrolling; Features, How It Works, Integrations, Demo, Docs; theme switcher; auth-aware buttons; accessible mobile drawer.
2. **Hero:** headline, supporting text, Get Started Free / Explore Demo, and an animated pipeline illustration (`hero-visual.tsx`, labelled "Illustration").
3. **Interactive demo** (`interactive-demo.tsx`): runs **entirely in the browser** with sample data and makes no API calls (asserted by E2E). It computes a real HMAC-SHA256 signature with WebCrypto using a public demo secret, walks the received → verified → queued → CRM → Sheet → logged steps, acknowledges a re-sent event as a duplicate, and can simulate a CRM outage with a retry that does not repeat completed actions.
4. **Features:** 8 cards describing implemented capabilities only.
5. **How Fleqo works** (`how-it-works.tsx`): 4 steps as an accessible tablist with arrow-key support and an accurate illustration per step.
6. **Integrations:** Mock Store, Mock CRM, Mock Sheet and public demo data marked *Available*; Shopify, WooCommerce, Google Sheets and HubSpot under **"On the roadmap — planned, not available yet"**.
7. **Product preview** (`product-preview.tsx`): **real screenshots** of the app with synthetic data (`apps/web/public/screens/*-{light,dark}.png`), shown in the visitor's theme via `next/image` (lazy, responsive sizes).
8. **Security & reliability:** six implemented capabilities, with an explicit "no external certification" note.
9. **Final CTA** and **footer** (internal links only, plus the owner's "Powered by" link). No contact, privacy or terms links are shown, because those pages don't exist.

No testimonials, customer logos, usage numbers, awards or certifications are shown.

## 3. Motion and accessibility
- Hero pipeline and demo use small CSS keyframes (`animate-flow-dash`, `animate-pulse-ring`). Sections rise slightly into place with **CSS scroll-driven animations** (`.reveal`). Content is never hidden, so crawlers, full-page captures, print and unsupported browsers always see everything.
- Everything is disabled under `prefers-reduced-motion`; the hero then shows the final state.
- There's a skip link, semantic landmarks and headings, and focus-visible rings; the mobile menu is a Radix dialog. axe WCAG AA checks pass in both themes.

## 4. SEO and performance
- Metadata: title "Fleqo — Integration & Workflow Automation", description, canonical, Open Graph and Twitter (`summary_large_image`), plus a generated OG image (`app/opengraph-image.tsx`). Set **`NEXT_PUBLIC_SITE_URL`** in production so canonical and OG URLs use the real domain.
- The landing and docs pages are **statically prerendered**; interactive parts are small client islands. Fonts are self-hosted by `next/font`; screenshots are lazy-loaded and resized by `next/image`.
- Production security headers (CSP, HSTS, Permissions-Policy) apply to all pages.

## 5. Regenerating the product screenshots
Screens must come from the real app. With API, worker and web running (any local stack), create a throwaway tenant with synthetic data and capture `/dashboard`, `/connections`, `/workflows/new` and an execution detail at 1440×900, in light and dark, into `apps/web/public/screens/{dashboard,connections,workflows,executions}-{light,dark}.png`. A short temporary Playwright script is the easiest way (the v1.1 screens were last recaptured after the sidebar, logo and theme-toggle changes). The image optimizer caches by URL, not by file content, so after replacing the files delete `apps/web/.next/cache/images` (and `.next/dev/cache/images` for `next dev`), or old screenshots keep being served.
