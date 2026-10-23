import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Loader2,
  MailPlus,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { accessApi } from "@/services/accessApi";
import { canAccessAdministration, useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import type { WorkspacePermission, WorkspaceScope } from "@/lib/access/permissions";
import { localizeError, t, translateLabel, type TranslationKey } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";

export const Route = createFileRoute("/_authenticated/administration")({
  component: AdministrationPage,
});

type TabKey = "Overview" | "Users" | "Roles & Permissions" | "Teams" | "Invitations" | "Audit Log";
type Member = {
  user_id: string;
  email: string | null;
  role: string;
  status: string;
  created_at: string;
};
type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
};
type Team = { id: string; name: string; created_at: string };
type Offer = { id: string; name: string; created_at: string };
type MemberPermission = {
  permission_key: string;
  allowed: boolean;
  delegable: boolean;
  scope_type: WorkspaceScope;
  scope_id: string | null;
};
type AuditEvent = {
  id: number;
  actor_id: string | null;
  subject_user_id: string | null;
  action: string;
  details: unknown;
  created_at: string;
};
type InviteResult = { invitationId: string; inviteUrl: string; emailSent: boolean };
type PermissionDefinition = {
  key: WorkspacePermission;
  category: TranslationKey;
  description: TranslationKey;
};

const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  { key: "workspace.read", category: "Workspace", description: "View workspace details" },
  { key: "leads.read", category: "Leads", description: "View leads in the granted data scope" },
  { key: "leads.create", category: "Leads", description: "Create leads in the granted data scope" },
  { key: "leads.update", category: "Leads", description: "Update leads in the granted data scope" },
  { key: "leads.delete", category: "Leads", description: "Delete leads in the granted data scope" },
  { key: "leads.assign", category: "Leads", description: "Assign leads to another operator" },
  { key: "leads.assign_team", category: "Leads", description: "Assign leads to a team" },
  { key: "leads.assign_offer", category: "Leads", description: "Assign leads to an offer" },
  { key: "members.read", category: "Users", description: "View workspace members and invitations" },
  { key: "members.manage_roles", category: "Users", description: "Change workspace member roles" },
  {
    key: "members.assign_admin",
    category: "Users",
    description: "Assign the Admin workspace role",
  },
  { key: "members.invite", category: "Invitations", description: "Invite users to the workspace" },
  { key: "teams.read", category: "Teams", description: "View teams in the granted data scope" },
  { key: "teams.manage", category: "Teams", description: "Create and update workspace teams" },
  { key: "offers.read", category: "Offers", description: "View offers in the granted data scope" },
  { key: "offers.manage", category: "Offers", description: "Create and update workspace offers" },
  {
    key: "permissions.read",
    category: "Permissions",
    description: "View individual permission grants",
  },
  {
    key: "permissions.manage",
    category: "Permissions",
    description: "Manage rights explicitly delegated to this Admin",
  },
  { key: "audit.read", category: "Audit", description: "View workspace access audit events" },
];
const ROLE_OPTIONS = ["admin", "operator", "viewer"] as const;
const PAGE_SIZES = [10, 25, 50];
const EMPTY_MEMBERS: Member[] = [];
const EMPTY_INVITATIONS: Invitation[] = [];
const inputClass =
  "h-10 rounded-lg border border-input bg-background/70 px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

function AdministrationPage() {
  const { locale } = useLocale();
  const access = useWorkspaceAccess();
  const workspaceId = access.workspace?.id;
  const isSuperAdmin = access.isSuperAdmin;
  const can = (permission: string) => isSuperAdmin || access.permissions[permission] === true;
  const hasMembersRead = can("members.read");
  const hasPermissionView = can("permissions.read");
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>("Overview");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [roleDraft, setRoleDraft] = useState("viewer");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [scopeType, setScopeType] = useState<WorkspaceScope>("workspace");
  const [scopeId, setScopeId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [lastInvite, setLastInvite] = useState<InviteResult | null>(null);
  const [teamName, setTeamName] = useState("");
  const [auditUser, setAuditUser] = useState("");
  const [auditAction, setAuditAction] = useState("all");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");

  const membersQuery = useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => accessApi.get<Member[]>(`/api/workspaces/${workspaceId}/members`),
    enabled: Boolean(workspaceId && hasMembersRead),
  });
  const invitationsQuery = useQuery({
    queryKey: ["workspace-invitations", workspaceId],
    queryFn: () => accessApi.get<Invitation[]>(`/api/workspaces/${workspaceId}/invitations`),
    enabled: Boolean(workspaceId && hasMembersRead),
  });
  const teamsQuery = useQuery({
    queryKey: ["workspace-teams", workspaceId],
    queryFn: () => accessApi.get<Team[]>(`/api/workspaces/${workspaceId}/teams`),
    enabled: Boolean(workspaceId && can("teams.read")),
  });
  const offersQuery = useQuery({
    queryKey: ["workspace-offers", workspaceId],
    queryFn: () => accessApi.get<Offer[]>(`/api/workspaces/${workspaceId}/offers`),
    enabled: Boolean(workspaceId && can("offers.read") && activeTab === "Roles & Permissions"),
  });
  const auditQuery = useQuery({
    queryKey: ["workspace-audit", workspaceId],
    queryFn: () => accessApi.get<AuditEvent[]>(`/api/workspaces/${workspaceId}/audit?limit=500`),
    enabled: Boolean(workspaceId && can("audit.read")),
  });
  const targetPermissionsQuery = useQuery({
    queryKey: ["member-permissions", workspaceId, selectedUserId],
    queryFn: () =>
      accessApi.get<MemberPermission[]>(
        `/api/workspaces/${workspaceId}/permissions?user_id=${encodeURIComponent(selectedUserId)}`,
      ),
    enabled: Boolean(workspaceId && selectedUserId && hasPermissionView),
  });
  const actorPermissionsQuery = useQuery({
    queryKey: ["actor-permissions", workspaceId, access.userId],
    queryFn: () =>
      accessApi.get<MemberPermission[]>(
        `/api/workspaces/${workspaceId}/permissions?user_id=${encodeURIComponent(access.userId!)}`,
      ),
    enabled: Boolean(workspaceId && access.userId && hasPermissionView && !isSuperAdmin),
  });

  const members = membersQuery.data ?? EMPTY_MEMBERS;
  const invitations = invitationsQuery.data ?? EMPTY_INVITATIONS;
  const activeInvitations = useMemo(
    () => invitations.filter((item) => isActiveInvitation(item)),
    [invitations],
  );
  const userRows = useMemo(
    () => [
      ...members.map((member) => ({
        ...member,
        rowId: member.user_id,
        displayStatus: member.status,
        invited: false,
      })),
      ...activeInvitations.map((invite) => ({
        user_id: "",
        email: invite.email,
        role: invite.role,
        status: "invited",
        created_at: invite.created_at,
        rowId: `invite:${invite.id}`,
        displayStatus: "invited",
        invited: true,
      })),
    ],
    [members, activeInvitations],
  );

  const tabs = useMemo(() => {
    const available: TabKey[] = ["Overview"];
    if (hasMembersRead) available.push("Users");
    if (
      hasMembersRead &&
      (can("members.manage_roles") || hasPermissionView || can("permissions.manage"))
    ) {
      available.push("Roles & Permissions");
    }
    if (can("teams.read") || can("teams.manage")) available.push("Teams");
    if (hasMembersRead || can("members.invite")) available.push("Invitations");
    if (can("audit.read")) available.push("Audit Log");
    return available;
    // `can` intentionally reads the current server-provided permission snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMembersRead, hasPermissionView, isSuperAdmin, access.permissions]);

  useEffect(() => {
    if (!tabs.includes(activeTab)) setActiveTab(tabs[0] ?? "Overview");
  }, [activeTab, tabs]);
  useEffect(() => {
    if (!selectedUserId && members.length) setSelectedUserId(members[0]!.user_id);
  }, [members, selectedUserId]);
  useEffect(() => setPage(1), [search, roleFilter, statusFilter, pageSize]);

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      accessApi.patch<{ updated: boolean }>(`/api/workspaces/${workspaceId}/members/${userId}`, {
        role,
      }),
    onSuccess: async () => {
      await invalidateWorkspace(queryClient, workspaceId, ["workspace-members", "workspace-audit"]);
      toast.success(t("Member role updated"));
      setEditingMember(null);
    },
    onError: showMutationError,
  });
  const permissionMutation = useMutation({
    mutationFn: (payload: {
      userId: string;
      permission: WorkspacePermission;
      allowed: boolean | null;
      delegable: boolean;
      scopeType: WorkspaceScope;
      scopeId: string | null;
    }) =>
      accessApi.post<{ updated: boolean }>(`/api/workspaces/${workspaceId}/permissions`, payload),
    onSuccess: async () => {
      await invalidateWorkspace(queryClient, workspaceId, [
        "member-permissions",
        "actor-permissions",
        "workspace-audit",
      ]);
      toast.success(t("Permission override saved"));
    },
    onError: showMutationError,
  });
  const inviteMutation = useMutation({
    mutationFn: () =>
      accessApi.post<InviteResult>(`/api/workspaces/${workspaceId}/invitations`, {
        email: inviteEmail,
        role: inviteRole,
      }),
    onSuccess: async (result) => {
      setLastInvite(result);
      setInviteEmail("");
      await invalidateWorkspace(queryClient, workspaceId, [
        "workspace-invitations",
        "workspace-audit",
      ]);
      toast.success(
        result.emailSent
          ? t("Invitation created and email sent")
          : t("Invitation created; copy its link to share it"),
      );
    },
    onError: showMutationError,
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      accessApi.delete<{ revoked: boolean }>(`/api/workspaces/${workspaceId}/invitations/${id}`),
    onSuccess: async () => {
      await invalidateWorkspace(queryClient, workspaceId, [
        "workspace-invitations",
        "workspace-audit",
      ]);
      toast.success(t("Invitation revoked"));
    },
    onError: showMutationError,
  });
  const teamMutation = useMutation({
    mutationFn: () =>
      accessApi.post<{ id: string }>(`/api/workspaces/${workspaceId}/teams`, { name: teamName }),
    onSuccess: async () => {
      setTeamName("");
      await invalidateWorkspace(queryClient, workspaceId, ["workspace-teams", "workspace-audit"]);
      toast.success(t("Team created"));
    },
    onError: showMutationError,
  });

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return userRows.filter((row) => {
      const matchesQuery =
        !query ||
        (row.email ?? "").toLowerCase().includes(query) ||
        row.user_id.toLowerCase().includes(query);
      const matchesRole = roleFilter === "all" || row.role === roleFilter;
      const normalizedStatus =
        row.displayStatus.toLowerCase() === "active"
          ? "active"
          : row.displayStatus.toLowerCase() === "suspended"
            ? "suspended"
            : "invited";
      const matchesStatus = statusFilter === "all" || normalizedStatus === statusFilter;
      return matchesQuery && matchesRole && matchesStatus;
    });
  }, [userRows, search, roleFilter, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visibleRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  const permissionRows = useMemo(
    () =>
      PERMISSION_DEFINITIONS.reduce<Record<string, PermissionDefinition[]>>((grouped, item) => {
        (grouped[item.category] ??= []).push(item);
        return grouped;
      }, {}),
    [],
  );
  const scopeTarget = scopeType === "workspace" ? null : scopeId || null;
  const targetOverrides = targetPermissionsQuery.data ?? [];
  const actorOverrides = actorPermissionsQuery.data ?? [];
  const scopeOverrides = (permission: WorkspacePermission) =>
    targetOverrides.find(
      (item) =>
        item.permission_key === permission &&
        item.scope_type === scopeType &&
        item.scope_id === scopeTarget,
    );
  const actorCanDelegate = (permission: WorkspacePermission) =>
    actorOverrides.some(
      (item) =>
        item.permission_key === permission &&
        item.allowed &&
        item.delegable &&
        (item.scope_type === "workspace" ||
          (item.scope_type === scopeType && item.scope_id === scopeTarget)),
    );

  const filteredAudit = useMemo(() => {
    const userQuery = auditUser.trim().toLowerCase();
    return (auditQuery.data ?? []).filter((event) => {
      const eventUserIds = `${event.actor_id ?? ""} ${event.subject_user_id ?? ""}`.toLowerCase();
      const namedUsers =
        `${memberEmail(members, event.actor_id)} ${memberEmail(members, event.subject_user_id)}`.toLowerCase();
      const matchesUser =
        !userQuery || eventUserIds.includes(userQuery) || namedUsers.includes(userQuery);
      const matchesAction = auditAction === "all" || event.action === auditAction;
      const date = localDateKey(event.created_at);
      const matchesFrom = !auditFrom || date >= auditFrom;
      const matchesTo = !auditTo || date <= auditTo;
      return matchesUser && matchesAction && matchesFrom && matchesTo;
    });
  }, [auditQuery.data, auditUser, auditAction, auditFrom, auditTo, members]);

  const openRoleEditor = (member: Member) => {
    setEditingMember(member);
    setRoleDraft(member.role);
  };
  const saveRole = () => {
    if (!editingMember || !workspaceId) return;
    if (roleDraft === "admin" && !can("members.assign_admin")) {
      toast.error(t("Your current permissions do not allow assigning the Admin role"));
      return;
    }
    if (
      !window.confirm(
        t("Change {member}'s role to {role}? The change takes effect immediately.", {
          member: editingMember.email ?? "цього учасника",
          role: translateLabel(roleDraft),
        }),
      )
    )
      return;
    roleMutation.mutate({ userId: editingMember.user_id, role: roleDraft });
  };
  const savePermission = (
    definition: PermissionDefinition,
    allowed: boolean | null,
    delegable: boolean,
  ) => {
    if (!selectedUserId || !workspaceId) return;
    const current = scopeOverrides(definition.key);
    const isExistingProtectedDelegation = !isSuperAdmin && current?.delegable === true;
    if (isExistingProtectedDelegation) {
      toast.error(t("This permission is delegated by a Super Admin and cannot be changed here"));
      return;
    }
    if (
      !isSuperAdmin &&
      (!hasPermissionView || !actorCanDelegate(definition.key) || !can("permissions.manage"))
    ) {
      toast.error(t("The server has not delegated this permission and scope to your account"));
      return;
    }
    const action = allowed === null ? "inherit" : allowed ? "allow" : "deny";
    if (
      !window.confirm(
        t("Set {permission} to {action} for this member at the selected scope? A Super Admin deny always takes precedence.", {
          permission: definition.key,
          action: translateLabel(action),
        }),
      )
    )
      return;
    permissionMutation.mutate({
      userId: selectedUserId,
      permission: definition.key,
      allowed,
      delegable: isSuperAdmin ? delegable : false,
      scopeType,
      scopeId: scopeTarget,
    });
  };
  const createInvitation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inviteRole === "admin" && !can("members.assign_admin")) {
      toast.error(t("Your current permissions do not allow inviting Admin users"));
      return;
    }
    inviteMutation.mutate();
  };
  const copyInviteLink = async () => {
    if (!lastInvite) return;
    try {
      await navigator.clipboard.writeText(lastInvite.inviteUrl);
      toast.success(t("Invitation link copied"));
    } catch {
      toast.error(t("Could not access the clipboard. Select and copy the link manually."));
    }
  };

  if (access.isLoading) return <PageLoading label={t("Loading workspace permissions…")} />;
  if (access.error)
    return (
      <ErrorPanel
        title={t("Administration could not be loaded")}
        message={localizeError(access.error, t("We couldn't load the access details. Please try again."))}
        onRetry={access.refetch}
      />
    );
  if (!workspaceId || !canAccessAdministration(access.permissions)) {
    return (
      <EmptyState
        icon={<ShieldCheck className="h-6 w-6" />}
        title={t("Administration is unavailable")}
        detail={t("Your account does not have administrative workspace permissions.")}
      />
    );
  }

  const renderLoadingOrError = (isLoading: boolean, error: Error | null, retry: () => unknown) => {
    if (isLoading) return <InlineLoading />;
    if (error)
      return <ErrorPanel title={t("Could not load data")} message={localizeError(error, t("We couldn't load the data. Please try again."))} onRetry={retry} />;
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            {t("Workspace controls")}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{t("Administration")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Manage access for {workspace}.", { workspace: access.workspace?.name ?? t("this workspace") })}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          {t("Server checked · {role}", { role: isSuperAdmin ? t("Super Admin") : translateLabel(access.workspace?.role ?? "unknown") })}
        </div>
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <div
          role="tablist"
          aria-label={t("Administration sections")}
          className="flex min-w-max gap-1 rounded-xl border border-border bg-card/50 p-1"
        >
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-lg px-3 py-2 text-sm transition ${activeTab === tab ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}
            >
              {t(tab)}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "Overview" && (
        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={t("Workspace members")}
              value={hasMembersRead ? members.length : "—"}
              detail={t(hasMembersRead ? "From the protected member list" : "Requires members.read")}
              loading={hasMembersRead && membersQuery.isLoading}
            />
            <StatCard
              label={t("Active members")}
              value={
                hasMembersRead ? members.filter((item) => item.status === "active").length : "—"
              }
              detail={t("Active workspace memberships")}
              loading={hasMembersRead && membersQuery.isLoading}
            />
            <StatCard
              label={t("Pending invitations")}
              value={hasMembersRead ? activeInvitations.length : "—"}
              detail={t("Invitations not yet expired")}
              loading={hasMembersRead && invitationsQuery.isLoading}
            />
            <StatCard
              label={t("Teams")}
              value={can("teams.read") ? (teamsQuery.data?.length ?? "—") : "—"}
              detail={t(can("teams.read") ? "Visible to your account" : "Requires teams.read")}
              loading={can("teams.read") && teamsQuery.isLoading}
            />
          </div>
          {(membersQuery.error || invitationsQuery.error || teamsQuery.error) && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {t("Some overview counts could not be loaded.")} {localizeError(membersQuery.error ?? invitationsQuery.error ?? teamsQuery.error, t("We couldn't retrieve the summary."))}
            </p>
          )}
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-2xl border border-border bg-card/60 p-5">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">{t("Recent access activity")}</h2>
              </div>
              {can("audit.read") ? (
                auditQuery.isLoading ? (
                  <InlineLoading />
                ) : auditQuery.error ? (
                  <p className="mt-4 text-sm text-destructive">{localizeError(auditQuery.error, t("We couldn't load the activity log."))}</p>
                ) : (auditQuery.data ?? []).slice(0, 5).length ? (
                  <div className="mt-4 divide-y divide-border">
                    {(auditQuery.data ?? []).slice(0, 5).map((event) => (
                      <div
                        key={event.id}
                        className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{humanize(event.action)}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {userLabel(members, event.actor_id)}
                            {event.subject_user_id
                              ? ` → ${userLabel(members, event.subject_user_id)}`
                              : ""}
                          </p>
                        </div>
                        <time className="shrink-0 text-xs text-muted-foreground">
                          {formatDate(event.created_at, true, locale)}
                        </time>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    {t("No access changes are available yet.")}
                  </p>
                )
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  {t("The audit summary requires audit.read.")}
                </p>
              )}
            </section>
            <section className="rounded-2xl border border-border bg-card/60 p-5">
              <h2 className="font-semibold">{t("Your administrative access")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("Capabilities are read from the current server permission checks.")}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {Object.entries(access.permissions)
                  .filter(([, allowed]) => allowed)
                  .map(([permission]) => (
                    <span
                      key={permission}
                      className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs text-primary"
                    >
                      {permission}
                    </span>
                  ))}
                {isSuperAdmin && (
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs text-primary">
                    {t("Super Admin · full workspace access")}
                  </span>
                )}
              </div>
            </section>
          </div>
        </section>
      )}

      {activeTab === "Users" && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card/60 p-4 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className={`${inputClass} w-full pl-9`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("Search email or user ID")}
              />
            </label>
            <select
              className={inputClass}
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              aria-label={t("Filter by role")}
            >
              <option value="all">{t("All roles")}</option>
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {humanize(role)}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label={t("Filter by status")}
            >
              <option value="all">{t("All statuses")}</option>
              <option value="active">{t("Active")}</option>
              <option value="suspended">{t("Suspended")}</option>
              <option value="invited">{t("Invited")}</option>
            </select>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            {t("Team membership is not returned by the current workspace API, so the table does not infer it.")}
          </p>
          {renderLoadingOrError(
            membersQuery.isLoading || invitationsQuery.isLoading,
            (membersQuery.error ?? invitationsQuery.error) as Error | null,
            () => {
              void membersQuery.refetch();
              void invitationsQuery.refetch();
            },
          )}
          {!membersQuery.isLoading &&
            !invitationsQuery.isLoading &&
            !membersQuery.error &&
            !invitationsQuery.error && (
              <div className="overflow-hidden rounded-2xl border border-border bg-card/60">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">{t("Email")}</th>
                        <th className="px-4 py-3">{t("Role")}</th>
                        <th className="px-4 py-3">{t("Team")}</th>
                        <th className="px-4 py-3">{t("Status")}</th>
                        <th className="px-4 py-3">{t("Joined")}</th>
                        <th className="px-4 py-3 text-right">{t("Actions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {visibleRows.map((row) => {
                        const member = row.invited
                          ? null
                          : (row as Member & {
                              rowId: string;
                              invited: false;
                              displayStatus: string;
                            });
                        const invite = row.invited
                          ? invitations.find((item) => `invite:${item.id}` === row.rowId)
                          : null;
                        const canEditRole = Boolean(
                          member &&
                          can("members.manage_roles") &&
                          member.user_id !== access.userId &&
                          (isSuperAdmin || member.role !== "admin"),
                        );
                        const status = row.invited ? "invited" : row.displayStatus;
                        return (
                          <tr key={row.rowId} className="hover:bg-muted/20">
                            <td className="px-4 py-3">
                              <div className="font-medium">{row.email ?? t("Email unavailable")}</div>
                              {member && (
                                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                  {member.user_id}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs">
                                {humanize(row.role)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{t("Not available")}</td>
                            <td className="px-4 py-3">
                              <StatusPill value={status} />
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {row.invited ? "—" : formatDate(row.created_at, false, locale)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-2">
                                {member && (hasPermissionView || can("permissions.manage")) && (
                                  <button
                                    type="button"
                                    className={buttonClass}
                                    onClick={() => {
                                      setSelectedUserId(member.user_id);
                                      setActiveTab("Roles & Permissions");
                                    }}
                                    title={t("View individual permissions")}
                                  >
                                    {t("Permissions")}
                                  </button>
                                )}
                                {member && canEditRole && (
                                  <button
                                    type="button"
                                    className={buttonClass}
                                    onClick={() => openRoleEditor(member)}
                                  >
                                    {t("Change role")}
                                  </button>
                                )}
                                {member &&
                                  can("members.manage_roles") &&
                                  member.user_id === access.userId && (
                                    <span className="self-center text-xs text-muted-foreground">
                                      {t("Your account")}
                                    </span>
                                  )}
                                {member &&
                                  !isSuperAdmin &&
                                  member.role === "admin" &&
                                  can("members.manage_roles") && (
                                    <span
                                      className="self-center text-xs text-muted-foreground"
                                      title={t("The member API does not identify protected Super Admin accounts")}
                                    >
                                      {t("Protected Admin account")}
                                    </span>
                                  )}
                                {invite &&
                                  can("members.invite") &&
                                  invite.invited_by === access.userId && (
                                    <button
                                      type="button"
                                      className={`${buttonClass} text-destructive hover:bg-destructive/10`}
                                      onClick={() => {
                                        if (
                                          window.confirm(
                                            t("Revoke the invitation for {email}?", { email: invite.email }),
                                          )
                                        )
                                          revokeMutation.mutate(invite.id);
                                      }}
                                      disabled={revokeMutation.isPending}
                                    >
                                      {t("Revoke")}
                                    </button>
                                  )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!visibleRows.length && (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-4 py-12 text-center text-sm text-muted-foreground"
                          >
                            {t("No users match these filters.")}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  pageSize={pageSize}
                  total={filteredRows.length}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
              </div>
            )}
          <div className="rounded-xl border border-border bg-background/40 p-3 text-xs text-muted-foreground">
            {t("Suspension and team assignment are not available in the current server API. Super Admin membership protection is enforced by the role RPC; ordinary Admin users cannot edit Admin-level rows here.")}
          </div>
        </section>
      )}

      {activeTab === "Roles & Permissions" && (
        <section className="space-y-4">
          <div className="grid gap-4 rounded-2xl border border-border bg-card/60 p-4 lg:grid-cols-[1fr_1fr_1.2fr]">
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              {t("Member")}
              <select
                className={`${inputClass} mt-1 w-full`}
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                disabled={!members.length}
              >
                {members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.email ?? member.user_id} · {humanize(member.role)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              {t("Permission scope")}
              <select
                className={`${inputClass} mt-1 w-full`}
                value={scopeType}
                onChange={(event) => {
                  setScopeType(event.target.value as WorkspaceScope);
                  setScopeId("");
                }}
              >
                {(["workspace", "team", "operator", "offer"] as WorkspaceScope[]).map((scope) => (
                  <option key={scope} value={scope}>
                    {humanize(scope)}
                  </option>
                ))}
              </select>
            </label>
            {scopeType !== "workspace" && (
              <ScopeTargetInput
                scopeType={scopeType}
                scopeId={scopeId}
                setScopeId={setScopeId}
                members={members}
                teams={teamsQuery.data ?? []}
                offers={offersQuery.data ?? []}
                canListTeams={can("teams.read")}
                canListOffers={can("offers.read")}
              />
            )}
          </div>

          {!hasPermissionView && !isSuperAdmin && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
              {t("Your account can manage some permissions, but lacks permissions.read. The current API cannot show a member’s overrides safely, so editing is disabled until a Super Admin grants permissions.read.")}
            </div>
          )}
          {!members.length && !membersQuery.isLoading && (
            <div className="rounded-xl border border-border p-6 text-sm text-muted-foreground">
              {t("No members are available for permission management.")}
            </div>
          )}
          {renderLoadingOrError(
            membersQuery.isLoading ||
              targetPermissionsQuery.isLoading ||
              (hasPermissionView && !isSuperAdmin && actorPermissionsQuery.isLoading),
            (membersQuery.error ??
              targetPermissionsQuery.error ??
              actorPermissionsQuery.error) as Error | null,
            () => {
              void membersQuery.refetch();
              void targetPermissionsQuery.refetch();
              void actorPermissionsQuery.refetch();
            },
          )}
          {selectedUserId &&
            hasPermissionView &&
            !targetPermissionsQuery.isLoading &&
            !targetPermissionsQuery.error && (
              <div className="space-y-4">
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-background/40 p-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {t("Rows show explicit overrides only. Inherit leaves the member’s workspace role defaults in effect; effective rights for another user are not exposed by the current API.")}
                  </span>
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" /> {t("Super Admin denies take precedence.")}
                  </span>
                </div>
                {Object.entries(permissionRows).map(([category, definitions]) => (
                  <section
                    key={category}
                    className="overflow-hidden rounded-2xl border border-border bg-card/60"
                  >
                    <div className="border-b border-border px-4 py-3">
                      <h2 className="font-semibold">{translateLabel(category)}</h2>
                    </div>
                    <div className="divide-y divide-border">
                      {definitions.map((definition) => {
                        const current = scopeOverrides(definition.key);
                        const currentValue = current
                          ? current.allowed
                            ? "allow"
                            : "deny"
                          : "inherit";
                        const actorCanEdit =
                          isSuperAdmin ||
                          (can("permissions.manage") &&
                            hasPermissionView &&
                            actorCanDelegate(definition.key));
                        const protectedOverride = !isSuperAdmin && current?.delegable === true;
                        const disabledReason =
                          !can("permissions.manage") && !isSuperAdmin
                            ? t("Requires permissions.manage")
                            : !hasPermissionView && !isSuperAdmin
                              ? t("Requires permissions.read to inspect current overrides")
                              : protectedOverride
                                ? t("This override was delegated by a Super Admin")
                                : !isSuperAdmin && !actorCanDelegate(definition.key)
                                  ? t("No matching delegable grant exists for this permission and scope")
                                  : undefined;
                        return (
                          <div
                            key={definition.key}
                            className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_180px_120px] md:items-center"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <code className="text-xs font-semibold text-foreground">
                                  {definition.key}
                                </code>
                                {current?.delegable && (
                                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                                    {t("Delegated")}
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {t(definition.description)}
                              </p>
                            </div>
                            <select
                              aria-label={`${definition.key} override`}
                              className={`${inputClass} w-full`}
                              value={currentValue}
                              disabled={
                                !actorCanEdit ||
                                protectedOverride ||
                                permissionMutation.isPending ||
                                (scopeType !== "workspace" && !scopeId)
                              }
                              title={disabledReason}
                              onChange={(event) =>
                                savePermission(
                                  definition,
                                  event.target.value === "inherit"
                                    ? null
                                    : event.target.value === "allow",
                                  current?.delegable ?? false,
                                )
                              }
                            >
                              <option value="inherit">{t("Inherit")}</option>
                              <option value="allow">{t("Allow")}</option>
                              <option value="deny">{t("Deny")}</option>
                            </select>
                            {isSuperAdmin && (
                              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                <input
                                  type="checkbox"
                                  checked={current?.delegable ?? false}
                                  disabled={!current || permissionMutation.isPending}
                                  title={t("Delegable overrides may be managed by eligible Admin users")}
                                  onChange={(event) =>
                                    savePermission(
                                      definition,
                                      current?.allowed ?? null,
                                      event.target.checked,
                                    )
                                  }
                                />{" "}
                                {t("Delegable")}
                              </label>
                            )}
                            {!isSuperAdmin && disabledReason && (
                              <p className="text-[11px] text-muted-foreground md:col-span-2">
                                {disabledReason}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
                <p className="rounded-xl border border-border bg-background/40 p-3 text-xs text-muted-foreground">
                  {t("No analytics permission keys exist in the current permission catalog. Scope target options are still available.")} {t("Scope target identifiers are checked against the workspace by the server before changes are saved.")}
                </p>
              </div>
            )}
        </section>
      )}

      {activeTab === "Teams" && (
        <section className="space-y-4">
          {can("teams.manage") && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                teamMutation.mutate();
              }}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card/60 p-4 sm:flex-row"
            >
              <input
                className={`${inputClass} flex-1`}
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                maxLength={120}
                placeholder={t("New team name")}
                required
              />
              <button
                type="submit"
                className={primaryButtonClass}
                disabled={teamMutation.isPending || !teamName.trim()}
              >
                {teamMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {t("Create team")}
              </button>
            </form>
          )}
          {can("teams.read") &&
            renderLoadingOrError(teamsQuery.isLoading, teamsQuery.error as Error | null, () =>
              teamsQuery.refetch(),
            )}
          {!can("teams.read") ? (
            <p className="rounded-xl border border-border bg-background/40 p-4 text-sm text-muted-foreground">
              {t("You can create teams, but viewing the team list requires teams.read.")}
            </p>
          ) : !teamsQuery.isLoading && !teamsQuery.error ? (
            <div className="overflow-hidden rounded-2xl border border-border bg-card/60">
              <div className="border-b border-border px-4 py-3">
                <h2 className="font-semibold">{t("Workspace teams")}</h2>
              </div>
              {(teamsQuery.data ?? []).length ? (
                <div className="divide-y divide-border">
                  {teamsQuery.data!.map((team) => (
                    <div
                      key={team.id}
                      className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
                          <Users className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="font-medium">{team.name}</p>
                          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                            {team.id}
                          </p>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t("Created")} {formatDate(team.created_at, false, locale)} · {t("member assignments unavailable")}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {t("No teams are visible in this workspace.")}
                </div>
              )}
            </div>
          ) : null}
          <p className="rounded-xl border border-border bg-background/40 p-3 text-xs text-muted-foreground">
            {t("Teams can be created and used as permission scopes. The current schema has no user-to-team assignment API, so participants are not inferred from lead records.")}
          </p>
        </section>
      )}

      {activeTab === "Invitations" && (
        <section className="space-y-4">
          {can("members.invite") && (
            <form
              onSubmit={createInvitation}
              className="grid gap-3 rounded-2xl border border-border bg-card/60 p-4 lg:grid-cols-[minmax(0,1fr)_200px_auto]"
            >
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                {t("Email address")}
                <input
                  className={`${inputClass} mt-1 w-full`}
                  type="email"
                  required
                  maxLength={255}
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="name@example.com"
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                {t("Initial role")}
                <select
                  className={`${inputClass} mt-1 w-full`}
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value)}
                >
                  {ROLE_OPTIONS.filter(
                    (role) => role !== "admin" || can("members.assign_admin"),
                  ).map((role) => (
                    <option key={role} value={role}>
                      {humanize(role)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className={`${primaryButtonClass} self-end`}
                disabled={inviteMutation.isPending || !inviteEmail.trim()}
              >
                {inviteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MailPlus className="h-4 w-4" />
                )}
                {t("Create invitation")}
              </button>
              {!can("members.assign_admin") && (
                <p className="text-xs text-muted-foreground lg:col-span-3">
                  {t("Assigning the Admin role requires members.assign_admin. Super Admin invitations are not available through workspace invitations.")}
                </p>
              )}
            </form>
          )}
          {lastInvite && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-start gap-3">
                <Check className="mt-0.5 h-4 w-4 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t("Invitation created")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {lastInvite.emailSent
                      ? t("An email was sent through Supabase Auth.")
                      : t("Email delivery was unavailable; copy and share this secure one-time link.")}
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      className={`${inputClass} min-w-0 flex-1 font-mono text-xs`}
                      readOnly
                      value={lastInvite.inviteUrl}
                      aria-label={t("Invitation link")}
                    />
                    <button type="button" className={buttonClass} onClick={copyInviteLink}>
                      <Copy className="h-4 w-4" />
                      {t("Copy link")}
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                  onClick={() => setLastInvite(null)}
                  aria-label={t("Dismiss invitation link")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
          {hasMembersRead &&
            renderLoadingOrError(
              invitationsQuery.isLoading,
              invitationsQuery.error as Error | null,
              () => invitationsQuery.refetch(),
            )}
          {hasMembersRead && !invitationsQuery.isLoading && !invitationsQuery.error && (
            <div className="overflow-hidden rounded-2xl border border-border bg-card/60">
              <div className="border-b border-border px-4 py-3">
                <h2 className="font-semibold">{t("Workspace invitations")}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">{t("Email")}</th>
                      <th className="px-4 py-3">{t("Role")}</th>
                      <th className="px-4 py-3">{t("Status")}</th>
                      <th className="px-4 py-3">{t("Expires")}</th>
                      <th className="px-4 py-3 text-right">{t("Action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {invitations.map((invite) => (
                      <tr key={invite.id}>
                        <td className="px-4 py-3 font-medium">{invite.email}</td>
                        <td className="px-4 py-3">{humanize(invite.role)}</td>
                        <td className="px-4 py-3">
                          <StatusPill value={invitationStatus(invite)} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDate(invite.expires_at, false, locale)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {invite.status === "pending" &&
                          new Date(invite.expires_at).getTime() > Date.now() &&
                          can("members.invite") &&
                          (isSuperAdmin || invite.invited_by === access.userId) ? (
                            <button
                              type="button"
                              className={`${buttonClass} text-destructive hover:bg-destructive/10`}
                              onClick={() => {
                                if (window.confirm(t("Revoke the invitation for {email}?", { email: invite.email })))
                                  revokeMutation.mutate(invite.id);
                              }}
                              disabled={revokeMutation.isPending}
                            >
                              {t("Revoke")}
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!invitations.length && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-12 text-center text-sm text-muted-foreground"
                        >
                          {t("No invitations are available.")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {!hasMembersRead && (
            <p className="rounded-xl border border-border bg-background/40 p-4 text-sm text-muted-foreground">
              {t("You can create invitations. Viewing the invitation list requires members.read.")}
            </p>
          )}
        </section>
      )}

      {activeTab === "Audit Log" && (
        <section className="space-y-4">
          <div className="grid gap-3 rounded-2xl border border-border bg-card/60 p-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              {t("User")}
              <input
                className={`${inputClass} mt-1 w-full`}
                value={auditUser}
                onChange={(event) => setAuditUser(event.target.value)}
                placeholder={t("Email or user ID")}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              {t("Action")}
              <select
                className={`${inputClass} mt-1 w-full`}
                value={auditAction}
                onChange={(event) => setAuditAction(event.target.value)}
              >
                <option value="all">{t("All actions")}</option>
                {[...new Set((auditQuery.data ?? []).map((item) => item.action))]
                  .sort()
                  .map((action) => (
                    <option key={action} value={action}>
                      {humanize(action)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              {t("From")}
              <input
                className={`${inputClass} mt-1 w-full`}
                type="date"
                value={auditFrom}
                onChange={(event) => setAuditFrom(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              {t("To")}
              <input
                className={`${inputClass} mt-1 w-full`}
                type="date"
                value={auditTo}
                onChange={(event) => setAuditTo(event.target.value)}
              />
            </label>
          </div>
          {renderLoadingOrError(auditQuery.isLoading, auditQuery.error as Error | null, () =>
            auditQuery.refetch(),
          )}
          {!auditQuery.isLoading && !auditQuery.error && (
            <div className="overflow-hidden rounded-2xl border border-border bg-card/60">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="font-semibold">{t("Access changes")}</h2>
                <span className="text-xs text-muted-foreground">
                  {t("Showing up to 500 latest events")}
                </span>
              </div>
              <div className="divide-y divide-border">
                {filteredAudit.map((event) => (
                  <details key={event.id} className="group px-4 py-3 open:bg-muted/10">
                    <summary className="flex cursor-pointer list-none flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                          <Clock3 className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium">{humanize(event.action)}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {userLabel(members, event.actor_id)}
                            {event.subject_user_id
                              ? ` · ${t("Access changed for")} ${userLabel(members, event.subject_user_id)}`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <time className="shrink-0 text-xs text-muted-foreground sm:pl-4">
                        {formatDate(event.created_at, true, locale)}
                      </time>
                    </summary>
                    <div className="ml-10 mt-3 grid gap-2 rounded-lg border border-border bg-background/50 p-3 text-xs sm:grid-cols-2">
                      <div>
                        <span className="text-muted-foreground">{t("Actor ID")}</span>
                        <p className="mt-1 break-all font-mono">
                          {event.actor_id ?? t("Unavailable")}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{t("Subject ID")}</span>
                        <p className="mt-1 break-all font-mono">
                          {event.subject_user_id ?? t("Unavailable")}
                        </p>
                      </div>
                      <div className="sm:col-span-2">
                        <span className="text-muted-foreground">{t("Recorded details")}</span>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px]">
                          {formatDetails(event.details)}
                        </pre>
                      </div>
                    </div>
                  </details>
                ))}
                {!filteredAudit.length && (
                  <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {t("No audit events match these filters.")}
                  </p>
                )}
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t("The audit API returns actor and subject IDs plus the recorded action details. Names are shown only when available in the protected member list.")}
          </p>
        </section>
      )}

      {editingMember && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditingMember(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-role-title"
            className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
                <Users className="h-4 w-4" />
              </span>
              <div>
                <h2 id="edit-role-title" className="font-semibold">
                  {t("Change member role")}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {editingMember.email ?? editingMember.user_id}
                </p>
              </div>
            </div>
            <label className="mt-5 block space-y-1 text-xs font-medium text-muted-foreground">
              {t("Workspace role")}
              <select
                className={`${inputClass} mt-1 w-full`}
                value={roleDraft}
                onChange={(event) => setRoleDraft(event.target.value)}
              >
                {ROLE_OPTIONS.filter((role) => role !== "admin" || can("members.assign_admin")).map(
                  (role) => (
                    <option key={role} value={role}>
                      {humanize(role)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <p className="mt-3 flex gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {t("Role changes take effect immediately. A Super Admin cannot be modified by an Admin, and the server enforces this rule.")}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={buttonClass} onClick={() => setEditingMember(null)}>
                {t("Cancel")}
              </button>
              <button
                type="button"
                className={primaryButtonClass}
                disabled={roleMutation.isPending || roleDraft === editingMember.role}
                onClick={saveRole}
              >
                {roleMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{t("Save role")}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ScopeTargetInput({
  scopeType,
  scopeId,
  setScopeId,
  members,
  teams,
  offers,
  canListTeams,
  canListOffers,
}: {
  scopeType: WorkspaceScope;
  scopeId: string;
  setScopeId: (value: string) => void;
  members: Member[];
  teams: Team[];
  offers: Offer[];
  canListTeams: boolean;
  canListOffers: boolean;
}) {
  const title = `${humanize(scopeType)} ${t("scope target")}`;
  const operatorOptions = members.filter(
    (member) => member.role === "operator" && member.status === "active",
  );
  let options: { id: string; name: string }[] | null = null;
  if (scopeType === "team" && canListTeams) options = teams.map(({ id, name }) => ({ id, name }));
  if (scopeType === "offer" && canListOffers)
    options = offers.map(({ id, name }) => ({ id, name }));
  if (scopeType === "operator")
    options = operatorOptions.map((member) => ({
      id: member.user_id,
      name: member.email ?? member.user_id,
    }));
  return (
    <label className="space-y-1 text-xs font-medium text-muted-foreground">
      {title}
      {options ? (
        <select
          className={`${inputClass} mt-1 w-full`}
          value={scopeId}
          onChange={(event) => setScopeId(event.target.value)}
        >
          <option value="">{t("Choose a {scope}", { scope: humanize(scopeType).toLowerCase() })}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          className={`${inputClass} mt-1 w-full font-mono text-xs`}
          value={scopeId}
          onChange={(event) => setScopeId(event.target.value)}
          placeholder={t("Scope ID (UUID)")}
        />
      )}
      {!options && (
        <span className="block text-[10px]">
          {t("A valid workspace scope ID is required; the server validates it.")}
        </span>
      )}
    </label>
  );
}

function StatCard({
  label,
  value,
  detail,
  loading,
}: {
  label: string;
  value: string | number;
  detail: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-2 text-2xl font-semibold tracking-tight">
        {loading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : value}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const statusClass =
    normalized === "active"
      ? "border-success/30 bg-success/10 text-success"
      : normalized === "suspended" || normalized === "revoked"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : normalized === "accepted"
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-warning/30 bg-warning/10 text-warning";
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${statusClass}`}>
      {translateLabel(value)}
    </span>
  );
}

function Pagination({
  page,
  totalPages,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>
        {t("Showing {start}–{end} of {total}", { start, end, total })}
      </span>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <label className="flex items-center gap-2">
          {t("Rows")}
          <select
            className="h-8 rounded-md border border-input bg-background px-2"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span>
          {t("Page {page} / {totalPages}", { page, totalPages })}
        </span>
        <button
          type="button"
          className="rounded-md border border-border p-1.5 hover:bg-muted disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={t("Previous page")}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="rounded-md border border-border p-1.5 hover:bg-muted disabled:opacity-40"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label={t("Next page")}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function InlineLoading() {
  return (
    <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {t("Loading…")}
    </div>
  );
}

function PageLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function ErrorPanel({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => unknown;
}) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <h2 className="font-medium text-destructive">{title}</h2>
      <p className="mt-1 break-words text-sm text-muted-foreground">{message}</p>
      <button
        type="button"
        className={`${buttonClass} mt-3`}
        onClick={() => {
          void onRetry();
        }}
      >
        {t("Retry")}
      </button>
    </div>
  );
}

function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="grid min-h-64 place-content-center justify-items-center rounded-2xl border border-border bg-card/60 p-8 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
        {icon}
      </span>
      <h1 className="mt-4 text-xl font-semibold">{title}</h1>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function isActiveInvitation(invite: Invitation) {
  return invite.status === "pending" && new Date(invite.expires_at).getTime() > Date.now();
}

function invitationStatus(invite: Invitation) {
  if (invite.status === "pending" && new Date(invite.expires_at).getTime() <= Date.now())
    return "Expired";
  return humanize(invite.status);
}

function memberEmail(members: Member[], id: string | null) {
  return members.find((member) => member.user_id === id)?.email ?? "";
}

function userLabel(members: Member[], id: string | null) {
  if (!id) return t("Unknown user");
  return memberEmail(members, id) || id;
}

function humanize(value: string) {
  return translateLabel(value);
}

function formatDate(value: string, includeTime = true, locale: "uk" | "en" = "uk") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("Unavailable");
  return new Intl.DateTimeFormat(
    locale === "uk" ? "uk-UA" : "en-US",
    includeTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" },
  ).format(date);
}

function localDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatDetails(value: unknown) {
  try {
    return JSON.stringify(value, null, 2) ?? t("No details recorded");
  } catch {
    return t("Details unavailable");
  }
}

function showMutationError(error: Error) {
  toast.error(localizeError(error, t("The server rejected this change")));
}

async function invalidateWorkspace(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string | undefined,
  keys: string[],
) {
  if (!workspaceId) return;
  await Promise.all(
    keys.map((key) => queryClient.invalidateQueries({ queryKey: [key, workspaceId] })),
  );
}
