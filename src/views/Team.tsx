import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Copy, Trash2, ShieldCheck, Mail, Check, Info } from "lucide-react";
import {
  Card,
  SectionTitle,
  Button,
  Badge,
  Modal,
  Input,
  Select,
  Field,
  Table,
  EmptyState,
  PageSkeleton,
} from "@/components/ui";
import { useOrg } from "@/lib/hooks/useOrg";
import { useAuth } from "@/lib/hooks/useAuth";
import {
  listMembers,
  listInvites,
  listAllModuleAccess,
  createInvite,
  revokeInvite,
  updateMemberRole,
  removeMember,
  setModuleAccess,
} from "@/lib/api/team";
import { MODULES, MODULE_GROUPS, defaultModulesFor } from "@/lib/modules";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { OrgMember, Role } from "@/lib/api/database.types";

const ROLES: Role[] = ["owner", "admin", "partner", "manager", "staff", "accountant", "viewer"];

const roleTone: Record<Role, "violet" | "rose" | "cyan" | "green" | "amber" | "neutral"> = {
  owner: "violet",
  admin: "rose",
  partner: "violet",
  manager: "cyan",
  staff: "green",
  accountant: "amber",
  viewer: "neutral",
};

function InviteForm({ onDone }: { onDone: (link: string) => void }) {
  const { org } = useOrg();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");

  const invite = useMutation({
    mutationFn: () => createInvite(org!.id, email.trim(), role),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ["org", org?.id, "invites"] });
      const link = `${window.location.origin}/auth?invite=${inv.code}`;
      navigator.clipboard?.writeText(link).catch(() => {});
      toast.success("Invite created", "Link copied — share it with your teammate");
      onDone(link);
    },
    onError: (e) => toast.error("Could not create invite", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <Field label="Teammate's email">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="chef@restaurant.com" autoFocus />
      </Field>
      <Field label="Role">
        <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.filter((r) => r !== "owner").map((r) => (
            <option key={r} value={r}>
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="rounded-xl border border-line bg-white/[0.02] p-3 text-xs text-zinc-400">
        <p className="font-medium text-zinc-300">Default modules for {role}:</p>
        <p className="mt-1">
          {defaultModulesFor(role)
            .map((id) => MODULES.find((m) => m.id === id)?.name)
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="mt-1.5 text-zinc-500">You can fine-tune per-module access after they join.</p>
      </div>
      <Button className="w-full" disabled={!email.includes("@") || invite.isPending} onClick={() => invite.mutate()}>
        {invite.isPending ? "Creating…" : "Create Invite Link"}
      </Button>
    </div>
  );
}

function ModuleMatrix({ member }: { member: OrgMember }) {
  const { org } = useOrg();
  const qc = useQueryClient();
  const accessQ = useQuery({
    queryKey: ["org", org?.id, "module_access"],
    queryFn: () => listAllModuleAccess(org!.id),
    enabled: !!org,
  });

  const rows = accessQ.data ?? [];
  const memberRows = rows.filter((r) => r.user_id === member.user_id);
  const hasAccess = (moduleId: string) => {
    const row = memberRows.find((r) => r.module_id === moduleId);
    if (row) return row.can_access;
    return defaultModulesFor(member.role).includes(moduleId);
  };

  const toggle = useMutation({
    mutationFn: ({ moduleId, value }: { moduleId: string; value: boolean }) =>
      setModuleAccess(org!.id, member.user_id, moduleId, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org", org?.id, "module_access"] });
      qc.invalidateQueries({ queryKey: ["orgContext"] });
    },
    onError: (e) => toast.error("Could not update access", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">
        Choose exactly which modules <span className="font-semibold text-white">{member.full_name || member.email}</span> can
        see. Changes apply on their next page load.
      </p>
      {MODULE_GROUPS.map((group) => (
        <div key={group}>
          <p className="mb-1.5 text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">{group}</p>
          <div className="flex flex-wrap gap-2">
            {MODULES.filter((m) => m.group === group).map((m) => {
              const on = hasAccess(m.id);
              const locked = member.role === "owner";
              return (
                <button
                  key={m.id}
                  disabled={locked || toggle.isPending}
                  onClick={() => toggle.mutate({ moduleId: m.id, value: !on })}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-default disabled:opacity-60",
                    on
                      ? "border-brand-400/40 bg-brand-400/10 text-brand-300"
                      : "border-line bg-white/[0.02] text-zinc-500",
                  )}
                >
                  <m.icon className="h-3.5 w-3.5" />
                  {m.name}
                  {on && <Check className="h-3 w-3" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {member.role === "owner" && (
        <p className="text-xs text-zinc-500">Owners always have access to every module.</p>
      )}
    </div>
  );
}

export default function Team() {
  const { org, isAdmin } = useOrg();
  const { user, isDemo } = useAuth();
  const qc = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [editingAccess, setEditingAccess] = useState<OrgMember | null>(null);

  const membersQ = useQuery({
    queryKey: ["org", org?.id, "members"],
    queryFn: () => listMembers(org!.id),
    enabled: !!org,
  });
  const invitesQ = useQuery({
    queryKey: ["org", org?.id, "invites"],
    queryFn: () => listInvites(org!.id),
    enabled: !!org,
  });

  const members = membersQ.data ?? [];
  const invites = invitesQ.data ?? [];

  const changeRole = async (m: OrgMember, role: Role) => {
    try {
      await updateMemberRole(org!.id, m.user_id, role);
      qc.invalidateQueries({ queryKey: ["org", org?.id, "members"] });
      toast.success("Role updated", `${m.full_name || m.email} is now ${role}`);
    } catch (e) {
      toast.error("Could not change role", e instanceof Error ? e.message : "");
    }
  };

  const remove = async (m: OrgMember) => {
    try {
      await removeMember(org!.id, m.user_id);
      qc.invalidateQueries({ queryKey: ["org", org?.id, "members"] });
      toast.success("Member removed", `${m.full_name || m.email} no longer has access`);
    } catch (e) {
      toast.error("Could not remove member", e instanceof Error ? e.message : "");
    }
  };

  const copyLink = (code: string) => {
    const link = `${window.location.origin}/auth?invite=${code}`;
    navigator.clipboard?.writeText(link);
    toast.success("Invite link copied", "Share it with your teammate");
  };

  if (membersQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Team & Access"
        subtitle="Invite people, set roles, and control exactly which modules each person sees."
        action={
          isAdmin && (
            <Button onClick={() => setInviting(true)}>
              <UserPlus className="h-4 w-4" /> Invite Teammate
            </Button>
          )
        }
      />

      {isDemo && (
        <Card className="flex items-start gap-3 border-amber-soft/20 bg-amber-soft/5 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-soft" />
          <p className="text-sm text-amber-soft">
            Demo mode — invites and multi-user access need the Supabase backend. Add your project
            credentials to <code className="rounded bg-white/10 px-1 text-xs">.env</code> and paste{" "}
            <code className="rounded bg-white/10 px-1 text-xs">supabase/setup.sql</code> into the SQL editor.
          </p>
        </Card>
      )}

      <Card>
        <div className="border-b border-line p-4">
          <h3 className="font-semibold text-white">Members</h3>
          <p className="text-xs text-zinc-500">{members.length} in this workspace</p>
        </div>
        <Table headers={["Member", "Role", "Joined", "Module Access", ""]}>
          {members.map((m) => (
            <tr key={m.user_id} className="hover:bg-white/[0.02]">
              <td className="px-4 py-3">
                <p className="font-medium text-white">
                  {m.full_name || "—"}
                  {m.user_id === user?.id && <span className="ml-2 text-xs text-zinc-500">(you)</span>}
                </p>
                <p className="text-xs text-zinc-500">{m.email}</p>
              </td>
              <td className="px-4 py-3">
                {isAdmin && m.role !== "owner" && m.user_id !== user?.id ? (
                  <Select
                    value={m.role}
                    onChange={(e) => changeRole(m, e.target.value as Role)}
                    className="w-32 py-1.5 text-xs"
                  >
                    {ROLES.filter((r) => r !== "owner").map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge tone={roleTone[m.role]} className="capitalize">
                    <ShieldCheck className="h-3 w-3" /> {m.role}
                  </Badge>
                )}
              </td>
              <td className="px-4 py-3 text-zinc-400">{new Date(m.joined_at).toLocaleDateString()}</td>
              <td className="px-4 py-3">
                <button
                  onClick={() => setEditingAccess(m)}
                  disabled={!isAdmin}
                  className="cursor-pointer text-xs font-medium text-accent-400 hover:underline disabled:cursor-default disabled:text-zinc-600"
                >
                  Configure modules
                </button>
              </td>
              <td className="px-4 py-3">
                {isAdmin && m.role !== "owner" && m.user_id !== user?.id && (
                  <button
                    onClick={() => remove(m)}
                    className="cursor-pointer rounded-lg p-1.5 text-zinc-500 hover:bg-rose-soft/10 hover:text-rose-soft"
                    title="Remove member"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card>
        <div className="border-b border-line p-4">
          <h3 className="font-semibold text-white">Pending Invites</h3>
          <p className="text-xs text-zinc-500">Share the link — they sign up with the code prefilled</p>
        </div>
        {invites.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="No pending invites"
            hint={isAdmin ? "Invite teammates and choose their role + modules." : "Admins can invite teammates here."}
            action={
              isAdmin && !isDemo ? (
                <Button onClick={() => setInviting(true)}>
                  <UserPlus className="h-4 w-4" /> Invite Teammate
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table headers={["Email", "Role", "Expires", ""]}>
            {invites.map((inv) => (
              <tr key={inv.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-medium text-white">{inv.email}</td>
                <td className="px-4 py-3">
                  <Badge tone={roleTone[inv.role]} className="capitalize">{inv.role}</Badge>
                </td>
                <td className="px-4 py-3 text-zinc-400">{new Date(inv.expires_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5">
                    <button onClick={() => copyLink(inv.code)} className="cursor-pointer rounded-lg bg-white/5 p-1.5 text-zinc-300 hover:bg-white/10" title="Copy invite link">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        await revokeInvite(org!.id, inv.id);
                        qc.invalidateQueries({ queryKey: ["org", org?.id, "invites"] });
                        toast.info("Invite revoked");
                      }}
                      className="cursor-pointer rounded-lg bg-rose-soft/10 p-1.5 text-rose-soft hover:bg-rose-soft/20"
                      title="Revoke"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={inviting} onClose={() => setInviting(false)} title="Invite Teammate">
        <InviteForm
          onDone={(link) => {
            setInviting(false);
            setInviteLink(link);
          }}
        />
      </Modal>

      <Modal open={!!inviteLink} onClose={() => setInviteLink(null)} title="Invite link ready">
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">Send this link to your teammate — the invite code is prefilled at signup:</p>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-white/[0.02] p-3">
            <code className="flex-1 truncate text-xs text-brand-300">{inviteLink}</code>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(inviteLink!);
                toast.success("Copied");
              }}
              className="cursor-pointer rounded-lg bg-white/5 p-1.5 text-zinc-300 hover:bg-white/10"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <Button className="w-full" onClick={() => setInviteLink(null)}>
            Done
          </Button>
        </div>
      </Modal>

      <Modal
        open={!!editingAccess}
        onClose={() => setEditingAccess(null)}
        title={`Module access — ${editingAccess?.full_name || editingAccess?.email || ""}`}
        wide
      >
        {editingAccess && <ModuleMatrix member={editingAccess} />}
      </Modal>
    </div>
  );
}
