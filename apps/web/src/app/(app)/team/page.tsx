"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Loader2, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingRows } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCan, useMe } from "@/hooks/use-me";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

interface TeamResponse {
  members: { id: string; role: string; createdAt: string; user: { id: string; name: string; email: string } }[];
  invitations: { id: string; email: string; role: string; expiresAt: string }[];
}

// The invitation ID is the secret: invitees can only accept through this link (no email lookup).
const inviteLink = (id: string) => `${window.location.origin}/invite/${id}`;

function CopyLinkButton({ link, label = "Copy invite link" }: { link: string; label?: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Invite link copied"))}
    >
      <Link2 /> {label}
    </Button>
  );
}

const ROLE_HELP: Record<string, string> = {
  owner: "Everything, including members and organization settings",
  admin: "Connections, workflows, imports, retries and invitations",
  member: "View workflows/executions and run the simulator",
};

export default function TeamPage() {
  const can = useCan();
  const me = useMe();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const team = useQuery({ queryKey: ["team"], queryFn: () => api<TeamResponse>("/team") });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["team"] });
  const onError = (error: unknown) => toast.error(errorMessage(error));

  const [lastInvite, setLastInvite] = useState<{ email: string; link: string } | null>(null);
  const invite = useMutation({
    mutationFn: () => api<{ invitation: { id: string; email: string } }>("/team/invitations", { method: "POST", body: { email, role } }),
    onSuccess: (result) => {
      setLastInvite({ email: result.invitation.email, link: inviteLink(result.invitation.id) });
      toast.success(`Invitation created for ${result.invitation.email}. Share the invite link with them.`);
      setEmail("");
      refresh();
    },
    onError,
  });
  const changeRole = useMutation({
    mutationFn: ({ id, role: next }: { id: string; role: string }) => api(`/team/members/${id}`, { method: "PATCH", body: { role: next } }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/team/members/${id}`, { method: "DELETE" }), onSuccess: refresh, onError });
  const cancel = useMutation({ mutationFn: (id: string) => api(`/team/invitations/${id}`, { method: "DELETE" }), onSuccess: refresh, onError });

  return (
    <>
      <PageHeader title="Team" description="Members of this organization and their roles. Permissions are enforced by the API on every request." />
      {can("invitation", "create") && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="size-4" /> Invite a teammate
            </CardTitle>
            <CardDescription>
              No email is sent in the MVP. Share the invite link privately; the invitee signs in with this exact address and accepts. Anyone
              without the link cannot see the invitation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                invite.mutate();
              }}
            >
              <div className="flex-1 space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger id="invite-role" className="w-full sm:w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending && <Loader2 className="animate-spin" />} Invite
              </Button>
            </form>
            {lastInvite && (
              <div className="mt-4 space-y-2 rounded-lg border bg-muted/40 p-3 text-sm" role="status" data-testid="invite-link-box">
                <p>
                  Invite link for <span className="font-medium">{lastInvite.email}</span> (expires in 48 hours):
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input readOnly value={lastInvite.link} className="font-mono text-xs" aria-label="Invite link" />
                  <CopyLinkButton link={lastInvite.link} label="Copy" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {team.isPending ? (
        <LoadingRows />
      ) : team.isError ? (
        <ErrorState error={team.error} onRetry={() => team.refetch()} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Members ({team.data.members.length})</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.data.members.map((member) => {
                    const isSelf = member.user.id === me.data?.user.id;
                    return (
                      <TableRow key={member.id}>
                        <TableCell>
                          {member.user.name} {isSelf && <Badge variant="secondary">you</Badge>}
                        </TableCell>
                        <TableCell>{member.user.email}</TableCell>
                        <TableCell>
                          {can("member", "update") && !isSelf ? (
                            <Select value={member.role} onValueChange={(next) => changeRole.mutate({ id: member.id, role: next })}>
                              <SelectTrigger className="w-32" aria-label={`Role for ${member.user.email}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {["owner", "admin", "member"].map((r) => (
                                  <SelectItem key={r} value={r} className="capitalize">
                                    {r}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="capitalize" title={ROLE_HELP[member.role]}>
                              {member.role}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDateTime(member.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          {can("member", "delete") && !isSelf && (
                            <Button variant="ghost" size="icon" aria-label={`Remove ${member.user.email}`} onClick={() => remove.mutate(member.id)}>
                              <Trash2 />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {team.data.invitations.length > 0 && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Pending invitations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {team.data.invitations.map((invitation) => (
                  <div key={invitation.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
                    <span className="font-medium">{invitation.email}</span>
                    <Badge variant="outline" className="capitalize">
                      {invitation.role}
                    </Badge>
                    <span className="text-xs text-muted-foreground">expires {formatDateTime(invitation.expiresAt)}</span>
                    <div className="ml-auto flex gap-2">
                      <CopyLinkButton link={inviteLink(invitation.id)} />
                      {can("invitation", "cancel") && (
                        <Button variant="outline" size="sm" onClick={() => cancel.mutate(invitation.id)}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Roles</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm sm:grid-cols-3">
                {Object.entries(ROLE_HELP).map(([name, help]) => (
                  <div key={name} className="rounded-lg border p-3">
                    <dt className="font-medium capitalize">{name}</dt>
                    <dd className="text-muted-foreground">{help}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
