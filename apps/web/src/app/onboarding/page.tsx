"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMe } from "@/hooks/use-me";
import { api, ApiError, errorMessage } from "@/lib/api";

/** Accepts a full invite link (…/invite/<id>) or a bare invitation ID. */
function invitationIdFrom(value: string): string | null {
  const match = value.trim().match(/(?:\/invite\/)?([\w-]{8,64})\/?$/);
  return match ? match[1] : null;
}

export default function OnboardingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const [name, setName] = useState("");
  const [inviteInput, setInviteInput] = useState("");

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace("/sign-in?next=/onboarding");
  }, [me.error, router]);

  const done = async () => {
    await queryClient.invalidateQueries();
    router.replace("/dashboard");
  };

  const create = useMutation({
    mutationFn: () => api("/organizations", { method: "POST", body: { name } }),
    onSuccess: async () => {
      toast.success("Organization created");
      await done();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const inviteId = invitationIdFrom(inviteInput);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <Brand className="mb-6 text-lg" />
      <div className="w-full max-w-md space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="size-4" /> Joining a team?
            </CardTitle>
            <CardDescription>Open the invite link you were given, or paste it here.</CardDescription>
          </CardHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (inviteId) router.push(`/invite/${inviteId}`);
            }}
          >
            <CardContent className="flex gap-2">
              <Input
                aria-label="Invite link"
                placeholder="https://…/invite/…"
                value={inviteInput}
                onChange={(event) => setInviteInput(event.target.value)}
              />
              <Button type="submit" variant="outline" disabled={!inviteId}>
                Open
              </Button>
            </CardContent>
          </form>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4" /> Create your organization
            </CardTitle>
            <CardDescription>
              Everything in Fleqo — connections, workflows and executions — belongs to an organization. You will be its owner.
            </CardDescription>
          </CardHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <CardContent className="space-y-2">
              <Label htmlFor="org-name">Organization name</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme Store"
                required
                minLength={2}
                maxLength={80}
              />
            </CardContent>
            <CardFooter className="mt-6">
              <Button type="submit" className="w-full" disabled={create.isPending || name.trim().length < 2}>
                {create.isPending && <Loader2 className="animate-spin" />}
                Create organization
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </main>
  );
}
