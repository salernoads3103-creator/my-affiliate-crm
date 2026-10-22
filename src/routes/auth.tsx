import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { accessApi } from "@/services/accessApi";

type FormValues = { email: string; password: string };

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ name: "referrer", content: "no-referrer" }] }),
  validateSearch: (search: Record<string, unknown>): { invite?: string } => ({
    ...(typeof search.invite === "string" ? { invite: search.invite } : {}),
  }),
  component: AuthPage,
});

function AuthPage() {
  const { invite: inviteToken } = Route.useSearch();
  const [mode, setMode] = useState<"sign-in" | "sign-up">(inviteToken ? "sign-up" : "sign-in");
  const [loading, setLoading] = useState(false);
  const [invitation, setInvitation] = useState<{
    email: string;
    role: string;
    workspace_name: string;
  } | null>(null);
  const [invitationError, setInvitationError] = useState("");
  const [accepting, setAccepting] = useState(false);
  const acceptingRef = useRef(false);
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>();

  const acceptInvitation = useCallback(
    async (token: string) => {
      if (acceptingRef.current) return;
      acceptingRef.current = true;
      setAccepting(true);
      try {
        await accessApi.post<{ workspaceId: string }>("/api/invitations/accept", { token });
        const currentUrl = new URL(window.location.href);
        if (currentUrl.searchParams.has("invite")) {
          currentUrl.searchParams.delete("invite");
          window.history.replaceState(
            window.history.state,
            "",
            `${currentUrl.pathname}${currentUrl.search}`,
          );
        }
        toast.success("Invitation accepted");
        await navigate({ to: "/dashboard" });
      } finally {
        acceptingRef.current = false;
        setAccepting(false);
      }
    },
    [navigate],
  );

  useEffect(() => {
    if (!inviteToken) {
      setInvitation(null);
      setInvitationError("");
      setMode("sign-in");
      return;
    }

    setMode("sign-up");
    setInvitationError("");
    let cancelled = false;
    accessApi
      .post<{ email: string; role: string; workspace_name: string }>("/api/invitations/validate", {
        token: inviteToken,
      })
      .then((result) => {
        if (cancelled) return;
        setInvitation(result);
        setValue("email", result.email);
      })
      .catch((error) => {
        if (cancelled) return;
        setInvitation(null);
        setInvitationError(
          error instanceof Error ? error.message : "Invitation is invalid or expired",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [inviteToken, setValue]);

  useEffect(() => {
    if (!inviteToken || !invitation) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) {
        void acceptInvitation(inviteToken).catch((error) => {
          const message = error instanceof Error ? error.message : "Could not accept invitation";
          setInvitationError(message);
          toast.error(message);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [inviteToken, invitation, acceptInvitation]);

  const onSubmit = async (values: FormValues) => {
    setLoading(true);
    try {
      if (mode === "sign-up") {
        if (!inviteToken || !invitation) {
          throw new Error("A valid invitation is required to create an account");
        }
        if (values.email.trim().toLowerCase() !== invitation.email.toLowerCase()) {
          throw new Error("Use the email address that received the invitation");
        }
        const redirectUrl = new URL("/auth", window.location.origin);
        redirectUrl.searchParams.set("invite", inviteToken);
        const { data, error } = await supabase.auth.signUp({
          email: values.email,
          password: values.password,
          options: { emailRedirectTo: redirectUrl.toString() },
        });
        if (error) throw error;
        if (data.session) {
          await acceptInvitation(inviteToken);
        } else {
          toast.success("Check your email to confirm the account and accept the invitation");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: values.email,
          password: values.password,
        });
        if (error) throw error;
        if (inviteToken) {
          if (!invitation) throw new Error("Invitation is invalid or expired");
          await acceptInvitation(inviteToken);
          return;
        }
        const { data: workspaces, error: workspaceError } = await supabase.rpc("my_workspaces");
        if (workspaceError) throw workspaceError;
        if (!workspaces?.length) {
          throw new Error(
            "This account has no workspace access. Ask a workspace administrator for an invitation.",
          );
        }
        toast.success("Welcome back");
        await navigate({ to: "/dashboard" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden">
        <div className="absolute inset-0 gradient-brand opacity-90" />
        <div className="absolute -bottom-32 -right-32 w-[28rem] h-[28rem] rounded-full bg-white/20 blur-3xl" />
        <div className="absolute -top-24 -left-24 w-[22rem] h-[22rem] rounded-full bg-white/10 blur-3xl" />
        <div className="relative z-10 text-white">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
              <Sparkles className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold tracking-tight">Lumen CRM</span>
          </div>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.6 }}
          className="relative z-10 text-white"
        >
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            Turn conversations into conversions.
          </h1>
          <p className="mt-4 text-white/80 max-w-md">
            A premium lead management workspace built for modern teams. Track every prospect,
            measure every touchpoint, ship with confidence.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-4 max-w-md">
            {["Realtime stats", "Status pipelines", "Premium UX"].map((t) => (
              <div key={t} className="rounded-2xl bg-white/10 backdrop-blur px-4 py-3 text-sm">
                {t}
              </div>
            ))}
          </div>
        </motion.div>
        <div className="relative z-10 text-xs text-white/60">© Lumen CRM</div>
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md glass rounded-3xl p-8 sm:p-10"
        >
          <div className="lg:hidden mb-6 flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl gradient-brand flex items-center justify-center text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold">Lumen CRM</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">
            {mode === "sign-in" ? "Welcome back" : "Accept your invitation"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "sign-in"
              ? "Sign in to access your workspace."
              : invitation
                ? `Create an account to join ${invitation.workspace_name}.`
                : "Checking your invitation…"}
          </p>
          {invitationError && (
            <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {invitationError}
            </p>
          )}
          {invitation && (
            <p className="mt-3 text-xs text-muted-foreground">
              Invitation for {invitation.email} · {invitation.role}
            </p>
          )}
          {accepting && <p className="mt-3 text-sm text-muted-foreground">Accepting invitation…</p>}

          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4">
            <div>
              <label className="text-sm font-medium">Email</label>
              <input
                type="email"
                autoComplete="email"
                {...register("email", {
                  required: "Email is required",
                  pattern: { value: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, message: "Enter a valid email" },
                })}
                className="mt-1.5 w-full rounded-xl bg-input/60 border border-border px-4 py-2.5 outline-none focus:ring-4 focus:ring-ring transition"
                placeholder="you@company.com"
              />
              {errors.email && (
                <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">Password</label>
              <input
                type="password"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                {...register("password", {
                  required: "Password is required",
                  minLength: { value: 6, message: "Min 6 characters" },
                })}
                className="mt-1.5 w-full rounded-xl bg-input/60 border border-border px-4 py-2.5 outline-none focus:ring-4 focus:ring-ring transition"
                placeholder="••••••••"
              />
              {errors.password && (
                <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || accepting || (mode === "sign-up" && !invitation)}
              className="w-full rounded-xl gradient-brand text-primary-foreground font-medium py-2.5 flex items-center justify-center gap-2 hover:opacity-95 active:scale-[0.99] transition disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {mode === "sign-in" ? "Sign in" : "Create account"}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {inviteToken ? (
              mode === "sign-in" ? (
                <>
                  New to the workspace?{" "}
                  <button
                    type="button"
                    onClick={() => setMode("sign-up")}
                    className="text-primary font-medium hover:underline"
                  >
                    Create account
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => setMode("sign-in")}
                    className="text-primary font-medium hover:underline"
                  >
                    Sign in
                  </button>
                </>
              )
            ) : (
              <>Workspace access is invitation-only. Ask an administrator to invite your account.</>
            )}
          </div>
          <Link to="/" className="hidden" />
        </motion.div>
      </div>
    </div>
  );
}
