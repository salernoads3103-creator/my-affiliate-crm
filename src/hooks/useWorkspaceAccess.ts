import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { accessApi } from "@/services/accessApi";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: string;
  is_super_admin: boolean;
};

export type WorkspaceAccess = {
  workspaceId: string;
  permissions: Record<string, boolean>;
};

export function useWorkspaceAccess() {
  const workspacesQuery = useQuery({
    queryKey: ["workspace-list"],
    queryFn: () => accessApi.get<WorkspaceSummary[]>("/api/workspaces"),
  });
  const workspace = workspacesQuery.data?.[0];
  const accessQuery = useQuery({
    queryKey: ["workspace-access", workspace?.id],
    queryFn: () => accessApi.get<WorkspaceAccess>(`/api/workspaces/${workspace!.id}/access`),
    enabled: Boolean(workspace?.id),
  });
  const userQuery = useQuery({
    queryKey: ["authenticated-user"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data.user;
    },
  });

  return {
    workspace,
    permissions: accessQuery.data?.permissions ?? {},
    isSuperAdmin: workspace?.is_super_admin === true,
    userId: userQuery.data?.id,
    isLoading: workspacesQuery.isLoading || accessQuery.isLoading || userQuery.isLoading,
    error: workspacesQuery.error ?? accessQuery.error ?? userQuery.error,
    refetch: async () => {
      await Promise.all([workspacesQuery.refetch(), accessQuery.refetch(), userQuery.refetch()]);
    },
  };
}

export const ADMINISTRATION_PERMISSION_KEYS = [
  "members.read",
  "members.invite",
  "members.manage_roles",
  "members.assign_admin",
  "permissions.read",
  "permissions.manage",
  "teams.read",
  "teams.manage",
  "audit.read",
] as const;

export function canAccessAdministration(permissions: Record<string, boolean>) {
  return ADMINISTRATION_PERMISSION_KEYS.some((key) => permissions[key] === true);
}
