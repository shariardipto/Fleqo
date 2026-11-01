import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmailResult } from "@/features/auth/verify-email";

export const metadata: Metadata = { title: "Verify email", robots: { index: false } };

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailResult />
    </Suspense>
  );
}
