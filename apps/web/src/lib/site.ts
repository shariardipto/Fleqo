/** Public site origin for canonical URLs, Open Graph and the sitemap (set NEXT_PUBLIC_SITE_URL in production). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Release shown in the app sidebar. */
export const APP_VERSION = "1.1";
