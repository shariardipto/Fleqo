"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Brand } from "@/components/brand";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/hooks/use-me";
import { api, ApiError, errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { formatDateTime } from "@/lib/format";

interface InvitationDetails {
  id: string;
  role: string;
  email: string;
  expiresAt: string;
  organization: { id: string; name: string };
  inviterEmail: string;
}

export default function InvitePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const signedIn = me.isSuccess;
  const next = encodeURIComponent(`/invite/${id}`);

  const invitation = useQuery({
    queryKey: ["invitation", id],
    queryFn: () => api<{ invitation: InvitationDetails }>(`/invitations/${id}`),
    enabled: signedIn,
  });
  const accept = useMutation({
    mutationFn: () => api(`/invitations/${id}/accept`, { method: "POST" }),
    onSuccess: async () => {
      toast.success("Welcome aboard");
      await queryClient.invalidateQueries();
      router.replace("/dashboard");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  async function switchAccount() {
    await authClient.signOut();
    queryClient.clear();
    router.replace(`/sign-in?next=${next}`);
  }

  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <Brand className="mb-6 text-lg" href="/dashboard" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailCheck className="size-4" /> Organization invitation
          </CardTitle>
          <CardDescription>Invitations can only be accepted by the email address they were sent to.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {unauthenticated ? (
            <p>Sign in or create an account with the invited email address to continue.</p>
          ) : me.isPending || invitation.isPending ? (
            <div className="space-y-2" role="status" aria-label="Loading invitation">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : invitation.isError ? (
            <Alert variant="destructive">
              <AlertTitle>This invitation cannot be used</AlertTitle>
              <AlertDescription>
                {errorMessage(invitation.error)}. You are signed in as {me.data?.user.email}. It may have expired, been cancelled, or been
                sent to a different address.
              </AlertDescription>
            </Alert>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-testid="invitation-details">
              <dt className="text-muted-foreground">Organization</dt>
              <dd className="font-medium">{invitation.data.invitation.organization.name}</dd>
              <dt className="text-muted-foreground">Role</dt>
              <dd className="capitalize">{invitation.data.invitation.role}</dd>
              <dt className="text-muted-foreground">Invited by</dt>
              <dd>{invitation.data.invitation.inviterEmail}</dd>
              <dt className="text-muted-foreground">Expires</dt>
              <dd>{formatDateTime(invitation.data.invitation.expiresAt)}</dd>
            </dl>
          )}
        </CardContent>
        <CardFooter className="mt-4 flex flex-wrap gap-2">
          {unauthenticated ? (
            <>
              <Button asChild>
                <Link href={`/sign-up?next=${next}`}>Create account</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/sign-in?next=${next}`}>Sign in</Link>
              </Button>
            </>
          ) : invitation.isSuccess ? (
            <Button onClick={() => accept.mutate()} disabled={accept.isPending}>
              {accept.isPending && <Loader2 className="animate-spin" />} Accept invitation
            </Button>
          ) : invitation.isError ? (
            <Button variant="outline" onClick={switchAccount}>
              Use a different account
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </main>
  );
}
