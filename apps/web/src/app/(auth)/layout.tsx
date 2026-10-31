import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <Brand className="mb-6 text-lg" href="/sign-in" />
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-6 max-w-sm text-center text-xs text-muted-foreground">
        Demo MVP: integrations are PostgreSQL-backed mocks; all generated orders are labeled synthetic.
      </p>
    </main>
  );
}
