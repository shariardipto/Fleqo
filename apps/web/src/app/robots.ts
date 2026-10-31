import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Public marketing pages are indexable; the signed-in application is not.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/docs", "/sign-in", "/sign-up"],
      disallow: ["/api/", "/dashboard", "/connections", "/workflows", "/executions", "/demo", "/team", "/settings", "/onboarding", "/invite/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
