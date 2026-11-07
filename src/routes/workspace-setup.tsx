import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { accessApi } from "@/services/accessApi";
import { useLocale } from "@/components/locale-provider";
import { CrmoniaWordmark } from "@/components/brand/CrmoniaWordmark";
import { localizeError, t } from "@/lib/i18n";
import { persistActiveWorkspaceId } from "@/lib/workspace-selection";

export const Route = createFileRoute("/workspace-setup")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { invite: undefined } });
    const { data: workspaces, error: workspaceError } = await supabase.rpc("my_workspaces");
    if (workspaceError) throw workspaceError;
    if (workspaces?.length) throw redirect({ to: "/dashboard" });
  },
  component: WorkspaceSetupPage,
});

function WorkspaceSetupPage() {
  useLocale();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const createWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const result = await accessApi.post<{ id: string }>("/api/workspaces", { name });
      persistActiveWorkspaceId(result.id);
      toast.success(t("Your workspace is ready"));
      await navigate({ to: "/dashboard" });
    } catch (error) {
      toast.error(localizeError(error, t("Could not create your workspace. Try again.")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mountain-shell flex min-h-screen items-center justify-center px-4 py-10">
      <section className="glass w-full max-w-lg rounded-2xl p-6 sm:p-9">
        <div className="mb-7 flex items-center gap-3">
          <CrmoniaWordmark />
        </div>
        <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Building2 className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Set up your workspace")}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t(
            "This workspace belongs to your account. Its products, offers, leads, and integrations stay separate from other workspaces.",
          )}
        </p>

        <form onSubmit={createWorkspace} className="mt-7 space-y-4">
          <div>
            <label htmlFor="workspace-name" className="text-sm font-medium">
              {t("Workspace name")}
            </label>
            <input
              id="workspace-name"
              autoComplete="organization"
              maxLength={100}
              required
              minLength={2}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1.5 w-full rounded-xl bg-input/60 border border-border px-4 py-2.5 outline-none focus:ring-4 focus:ring-ring transition"
              placeholder={t("For example, My e-commerce business")}
            />
          </div>
          <button
            type="submit"
            disabled={saving || name.trim().length < 2}
            className="w-full rounded-xl gradient-brand text-primary-foreground font-medium py-2.5 flex items-center justify-center gap-2 hover:opacity-95 transition disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Create workspace")}
          </button>
        </form>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          {t("Your account will be the workspace admin. You can invite other people later.")}
        </p>
      </section>
    </main>
  );
}
