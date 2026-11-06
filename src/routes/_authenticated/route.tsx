import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { WorkspaceSelectionProvider } from "@/components/workspace/WorkspaceSelectionProvider";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { invite: undefined } });
    const { data: workspaces, error: workspaceError } = await supabase.rpc("my_workspaces");
    if (workspaceError) throw workspaceError;
    if (!workspaces?.length) {
      throw redirect({ to: "/workspace-setup" });
    }
    return { user: data.user };
  },
  component: () => (
    <WorkspaceSelectionProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </WorkspaceSelectionProvider>
  ),
});
