import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ArrowRight, Languages, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { accessApi } from "@/services/accessApi";
import { localizeError, t, translateLabel, type Locale, type TranslationKey } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";
import { CrmoniaWordmark } from "@/components/brand/CrmoniaWordmark";
import { persistActiveWorkspaceId } from "@/lib/workspace-selection";
import {
  getAuthenticatedWorkspacePath,
  getPasswordRecoveryRedirectUrl,
} from "@/lib/auth/auth-flow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type FormValues = { email: string; password: string };
type AuthMode = "sign-in" | "sign-up" | "request-reset";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ name: "referrer", content: "no-referrer" }] }),
  validateSearch: (search: Record<string, unknown>): { invite?: string } => ({
    ...(typeof search.invite === "string" ? { invite: search.invite } : {}),
  }),
  component: AuthPage,
});

function AuthPage() {
  const { locale, setLocale } = useLocale();
  const { invite: inviteToken } = Route.useSearch();
  const [mode, setMode] = useState<AuthMode>(inviteToken ? "sign-up" : "sign-in");
  const [loading, setLoading] = useState(false);
  const [invitation, setInvitation] = useState<{
    email: string;
    role: string;
    workspace_name: string;
  } | null>(null);
  const [invitationError, setInvitationError] = useState<TranslationKey | "">("");
  const [accepting, setAccepting] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [passwordResetRequested, setPasswordResetRequested] = useState(false);
  const acceptingRef = useRef(false);
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ shouldUnregister: true });

  const acceptInvitation = useCallback(
    async (token: string) => {
      if (acceptingRef.current) return;
      acceptingRef.current = true;
      setAccepting(true);
      try {
        const accepted = await accessApi.post<{ workspaceId: string }>("/api/invitations/accept", {
          token,
        });
        persistActiveWorkspaceId(accepted.workspaceId);
        const currentUrl = new URL(window.location.href);
        if (currentUrl.searchParams.has("invite")) {
          currentUrl.searchParams.delete("invite");
          window.history.replaceState(
            window.history.state,
            "",
            `${currentUrl.pathname}${currentUrl.search}`,
          );
        }
        toast.success(t("Invitation accepted"));
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
        setInvitationError("Invitation is invalid or expired");
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
          const message = localizeError(error, t("Could not accept invitation"));
          setInvitationError("Could not accept invitation");
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
      if (mode === "request-reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(values.email.trim(), {
          redirectTo: getPasswordRecoveryRedirectUrl(window.location.origin),
        });
        if (error) throw error;
        setPasswordResetRequested(true);
        return;
      }

      if (mode === "sign-up") {
        if (inviteToken) {
          if (!invitation) throw new Error("Invitation is invalid or expired");
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
            toast.success(t("Check your email to confirm the account and accept the invitation"));
          }
        } else {
          const redirectUrl = new URL("/workspace-setup", window.location.origin);
          const { data, error } = await supabase.auth.signUp({
            email: values.email,
            password: values.password,
            options: { emailRedirectTo: redirectUrl.toString() },
          });
          if (error) throw error;
          if (data.session) {
            await navigate({ to: "/workspace-setup" });
          } else {
            setAwaitingConfirmation(true);
            toast.success(t("Check your email to confirm your account, then create a workspace."));
          }
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
          await navigate({ to: "/workspace-setup" });
          return;
        }
        toast.success(t("Welcome back"));
        await navigate({ to: getAuthenticatedWorkspacePath(workspaces.length) });
      }
    } catch (e) {
      const fallback =
        mode === "request-reset"
          ? t("Could not send a reset link. Try again later.")
          : t("We couldn't sign you in or create your account. Check your details and try again.");
      const msg = localizeError(e, fallback);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mountain-shell auth-page-shell relative min-h-screen">
      <div className="absolute left-6 top-6 z-10 sm:left-10 sm:top-10">
        <CrmoniaWordmark size="sidebar" showMark />
      </div>

      <main className="flex min-h-screen items-center justify-center p-5 pt-24 sm:p-12 sm:pt-28 lg:justify-end lg:pr-[10vw]">
        <div className="glass w-full max-w-sm rounded-2xl p-6 sm:p-8">
          <div className="mb-5 flex justify-end">
            <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
              <SelectTrigger
                aria-label={t("Language")}
                className="h-9 w-36 rounded-lg border-border bg-background/70 text-sm"
              >
                <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
                <SelectValue>{locale === "uk" ? t("Ukrainian") : t("English")}</SelectValue>
              </SelectTrigger>
              <SelectContent position="popper" side="bottom" align="end" sideOffset={4}>
                <SelectItem value="uk">{t("Ukrainian")}</SelectItem>
                <SelectItem value="en">{t("English")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">
            {mode === "request-reset"
              ? t("Reset your password")
              : mode === "sign-in"
                ? t("Welcome back")
                : inviteToken
                  ? t("Accept your invitation")
                  : t("Create your CRMONIA account")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "request-reset"
              ? t(
                  "Enter your account email and we’ll send a password reset link if the account exists.",
                )
              : mode === "sign-in"
                ? t("Sign in to access your workspace.")
                : inviteToken
                  ? invitation
                    ? t("Create an account to join {workspace}.", {
                        workspace: invitation.workspace_name,
                      })
                    : t("Checking your invitation…")
                  : t("Create an account, confirm your email, then set up your own workspace.")}
          </p>
          {invitationError && (
            <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {t(invitationError)}
            </p>
          )}
          {invitation && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("Invitation for {email} · {role}", {
                email: invitation.email,
                role: translateLabel(invitation.role),
              })}
            </p>
          )}
          {accepting && (
            <p className="mt-3 text-sm text-muted-foreground">{t("Accepting invitation…")}</p>
          )}
          {awaitingConfirmation && !inviteToken && (
            <p className="mt-3 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {t("Check your email to confirm your account, then create a workspace.")}
            </p>
          )}
          {passwordResetRequested && mode === "request-reset" && (
            <p className="mt-3 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {t("If an account uses this email, a password reset link is on its way.")}
            </p>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4">
            <div>
              <label className="text-sm font-medium">{t("Email")}</label>
              <input
                type="email"
                autoComplete="email"
                {...register("email", {
                  required: t("Email is required"),
                  pattern: {
                    value: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
                    message: t("Enter a valid email"),
                  },
                })}
                className="mt-1.5 w-full rounded-xl bg-input/60 border border-border px-4 py-2.5 outline-none focus:ring-4 focus:ring-ring transition"
                placeholder="name@example.com"
              />
              {errors.email && (
                <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>
            {mode !== "request-reset" && (
              <div>
                <label className="text-sm font-medium">{t("Password")}</label>
                <input
                  type="password"
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  {...register("password", {
                    required: t("Password is required"),
                    minLength: { value: 6, message: t("Min 6 characters") },
                  })}
                  className="mt-1.5 w-full rounded-xl bg-input/60 border border-border px-4 py-2.5 outline-none focus:ring-4 focus:ring-ring transition"
                  placeholder="••••••••"
                />
                {errors.password && (
                  <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>
            )}

            {mode === "sign-in" && !inviteToken && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => {
                    setPasswordResetRequested(false);
                    setMode("request-reset");
                  }}
                  className="text-sm text-primary font-medium hover:underline"
                >
                  {t("Forgot your password?")}
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={
                loading || accepting || (mode === "sign-up" && !!inviteToken && !invitation)
              }
              className="w-full rounded-xl gradient-brand text-primary-foreground font-medium py-2.5 flex items-center justify-center gap-2 hover:opacity-95 active:scale-[0.99] transition disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {mode === "request-reset"
                    ? t("Send reset link")
                    : mode === "sign-in"
                      ? t("Sign in")
                      : t("Create account")}
                  {mode !== "request-reset" && <ArrowRight className="h-4 w-4" />}
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "request-reset" ? (
              <button
                type="button"
                onClick={() => {
                  setPasswordResetRequested(false);
                  setMode("sign-in");
                }}
                className="text-primary font-medium hover:underline"
              >
                {t("Back to sign in")}
              </button>
            ) : inviteToken ? (
              mode === "sign-in" ? (
                <>
                  {t("New to the workspace?")}{" "}
                  <button
                    type="button"
                    onClick={() => setMode("sign-up")}
                    className="text-primary font-medium hover:underline"
                  >
                    {t("Create account")}
                  </button>
                </>
              ) : (
                <>
                  {t("Already have an account?")}{" "}
                  <button
                    type="button"
                    onClick={() => setMode("sign-in")}
                    className="text-primary font-medium hover:underline"
                  >
                    {t("Sign in")}
                  </button>
                </>
              )
            ) : mode === "sign-in" ? (
              <>
                {t("New to CRMONIA?")}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setAwaitingConfirmation(false);
                    setMode("sign-up");
                  }}
                  className="text-primary font-medium hover:underline"
                >
                  {t("Create account")}
                </button>
              </>
            ) : (
              <>
                {t("Already have an account?")}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setAwaitingConfirmation(false);
                    setMode("sign-in");
                  }}
                  className="text-primary font-medium hover:underline"
                >
                  {t("Sign in")}
                </button>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
