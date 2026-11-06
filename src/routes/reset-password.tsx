import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useLocale } from "@/components/locale-provider";
import { localizeError, t } from "@/lib/i18n";
import { getAuthenticatedWorkspacePath } from "@/lib/auth/auth-flow";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [{ name: "referrer", content: "no-referrer" }] }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw redirect({ to: "/auth", search: { invite: undefined } });
  },
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  useLocale();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (password.length < 6) {
      setValidationError(t("Min 6 characters"));
      return;
    }
    if (password !== confirmation) {
      setValidationError(t("Passwords do not match"));
      return;
    }

    setValidationError("");
    setSaving(true);
    let passwordUpdated = false;
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      passwordUpdated = true;
      const { data, error: workspacesError } = await supabase.rpc("my_workspaces");
      if (workspacesError) throw workspacesError;
      toast.success(t("Password updated"));
      await navigate({ to: getAuthenticatedWorkspacePath(data?.length ?? 0) });
    } catch (error) {
      const fallback = passwordUpdated
        ? t("Your password changed, but we could not load your workspace. Sign in to continue.")
        : t("Could not update your password. Request a new reset link.");
      toast.error(localizeError(error, fallback));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <section className="glass w-full max-w-lg rounded-3xl p-7 sm:p-9">
        <div className="mb-7 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl gradient-brand flex items-center justify-center text-white">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>
          <span className="text-lg font-semibold tracking-tight">CRMONIA</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Set a new password")}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t("Choose a new password for your account.")}
        </p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          <div>
            <label htmlFor="new-password" className="text-sm font-medium">
              {t("Password")}
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 w-full rounded-xl bg-input/60 border border-border px-4 py-2.5 outline-none focus:ring-4 focus:ring-ring transition"
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className="text-sm font-medium">
              {t("Confirm password")}
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="mt-1.5 w-full rounded-xl bg-input/60 border border-border px-4 py-2.5 outline-none focus:ring-4 focus:ring-ring transition"
            />
          </div>
          {validationError && <p className="text-sm text-destructive">{validationError}</p>}
          <button
            type="submit"
            disabled={saving || password.length < 6 || confirmation.length < 6}
            className="w-full rounded-xl gradient-brand text-primary-foreground font-medium py-2.5 flex items-center justify-center gap-2 hover:opacity-95 transition disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Update password")}
          </button>
        </form>
      </section>
    </main>
  );
}
